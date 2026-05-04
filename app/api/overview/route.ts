import { NextRequest, NextResponse } from 'next/server';
import { exaContents, exaSearch } from '@/lib/exa';
import { claudeJSON } from '@/lib/anthropic';
import { OVERVIEW_SYSTEM_PROMPT, PROMPT_VERSION } from '@/lib/prompts';
import { RestaurantOverview } from '@/lib/schema';
import {
  isGoogleMapsConfigured,
  searchPlace,
  checkBusinessStatus,
  getStaticMapUrl,
  bookingUrl,
  type PlaceDetails,
} from '@/lib/google-places';
import {
  getCachedPlace,
  isStatusStale,
  placeCacheKey,
  refreshStatus,
  savePlace,
  type CachedPlace,
} from '@/lib/places-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Trusted sources for restaurant overview info (rating, address, description)
const OVERVIEW_SOURCE_DOMAINS = [
  'tripadvisor.com', 'tripadvisor.com.au', 'tripadvisor.co.uk',
  'yelp.com', 'yelp.com.au',
  'opentable.com', 'opentable.com.au', 'opentable.co.uk',
  'zomato.com', 'thefork.com', 'thefork.com.au',
  'google.com', 'maps.google.com',
  'eater.com', 'theinfatuation.com', 'timeout.com',
  'goodfood.com.au', 'concreteplayground.com', 'broadsheet.com.au',
  'gourmettraveller.com.au',
];

function isLikelyLogoImage(url: string | undefined): boolean {
  if (!url) return false;
  return /logo|favicon|cropped-|^.*-32x32\./i.test(url);
}

function rankOverviewResults(
  results: { url: string; image?: string }[],
  ownDomain: string | null
): typeof results {
  return results
    .map((r) => {
      let host = '';
      try {
        host = new URL(r.url).hostname.replace(/^www\./, '');
      } catch {
        return { ...r, _score: -100 };
      }
      let score = 0;
      // Boost the restaurant's own site
      if (ownDomain && host === ownDomain) score += 5;
      // Boost trusted overview sources
      for (let i = 0; i < OVERVIEW_SOURCE_DOMAINS.length; i++) {
        if (host === OVERVIEW_SOURCE_DOMAINS[i] || host.endsWith('.' + OVERVIEW_SOURCE_DOMAINS[i])) {
          score += 8 - i * 0.2;
          break;
        }
      }
      return { ...r, _score: score };
    })
    .filter((r) => r._score > -100)
    .sort(
      (a, b) =>
        ((b as typeof results[number] & { _score: number })._score) -
        ((a as typeof results[number] & { _score: number })._score)
    );
}

/**
 * Fetch (with two-tier cache) Google Places data for a restaurant.
 * Tier A: 90-day full cache. Tier B: 7-day business_status refresh.
 *
 * If GOOGLE_MAPS_API_KEY is not set, returns null and the route
 * gracefully degrades to Exa-only (no maps, no Google rating).
 */
async function getCachedOrFetchPlace(
  name: string,
  city: string
): Promise<CachedPlace | PlaceDetails | null> {
  if (!isGoogleMapsConfigured()) return null;
  const key = placeCacheKey(name, city);

  // Tier A lookup
  const cached = await getCachedPlace(key);
  if (cached) {
    // Tier B: lazy refresh of business_status if stale
    if (isStatusStale(cached) && cached.placeId) {
      try {
        const fresh = await checkBusinessStatus(cached.placeId);
        return await refreshStatus(key, cached, fresh);
      } catch (e) {
        console.warn('status refresh failed:', (e as Error).message);
        // Keep stale status — better than blocking the user
      }
    }
    return cached;
  }

  // Cache miss — full fetch + save
  try {
    const place = await searchPlace(name, city);
    if (!place) return null;
    return await savePlace(key, place);
  } catch (e) {
    console.warn('Places searchText failed:', (e as Error).message);
    return null;
  }
}

// POST /api/overview { url, name, city? }
// Returns: { overview: RestaurantOverview }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = (body.url ?? '').toString().trim();
    const name = (body.name ?? '').toString().trim();
    const city = (body.city ?? '').toString().trim();

    if (!url || !name) {
      return NextResponse.json({ error: 'url and name required' }, { status: 400 });
    }

    let ownDomain: string | null = null;
    try {
      ownDomain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      // ignore
    }

    // Kick off Google Places (cached) and Exa scraping in parallel
    const placePromise = getCachedOrFetchPlace(name, city);

    // Search for the restaurant across the web
    const queries = [
      city ? `${name} ${city} restaurant` : `${name} restaurant`,
      city ? `${name} ${city} reviews rating` : `${name} reviews rating`,
      city ? `${name} ${city} address phone` : `${name} address phone`,
    ];

    const searchResults = await Promise.allSettled(queries.map((q) => exaSearch(q, 6)));
    const allResults = searchResults
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof exaSearch>>>).value);

    // Dedup by URL
    const seenUrls = new Set<string>();
    const unique = allResults.filter((r) => {
      if (seenUrls.has(r.url)) return false;
      seenUrls.add(r.url);
      return true;
    });

    const ranked = rankOverviewResults(unique, ownDomain);
    // Always include the restaurant's own URL first
    const fetchUrls = [url];
    for (const r of ranked) {
      if (!fetchUrls.includes(r.url)) fetchUrls.push(r.url);
      if (fetchUrls.length >= 6) break;
    }

    // Fetch contents from all chosen sources in parallel
    const fetched = await Promise.allSettled(
      fetchUrls.map((u) =>
        exaContents([u], 'fallback')
          .then((r) => ({
            url: u,
            content: r[0]?.text ?? '',
            image: r[0]?.image,
          }))
          .catch(() => ({ url: u, content: '', image: undefined as string | undefined }))
      )
    );

    const sources = fetched
      .filter(
        (r): r is PromiseFulfilledResult<{ url: string; content: string; image?: string }> =>
          r.status === 'fulfilled'
      )
      .map((r) => r.value)
      .filter((s) => s.content && s.content.length > 200);

    // Collect candidate images from search results AND fetched contents
    const imageCandidates = new Set<string>();
    for (const r of ranked) {
      if (r.image && !isLikelyLogoImage(r.image)) imageCandidates.add(r.image);
    }
    for (const s of sources) {
      if (s.image && !isLikelyLogoImage(s.image)) imageCandidates.add(s.image);
    }

    let overview: RestaurantOverview | null = null;

    if (sources.length > 0) {
      const perSourceBudget = Math.floor(28000 / Math.max(sources.length, 1));
      const combined = sources
        .map(
          (s) =>
            `=== Source: ${s.url} ===\n${s.content.slice(0, perSourceBudget)}`
        )
        .join('\n\n');

      const userMsg = [
        `Restaurant: ${name}${city ? ` (${city})` : ''}`,
        `Restaurant own URL: ${url}`,
        '',
        'Combined source content:',
        '---',
        combined,
        '---',
        '',
        'Produce the structured restaurant overview JSON now. Description in your own words; never copy source prose verbatim.',
      ]
        .filter(Boolean)
        .join('\n');

      try {
        overview = await claudeJSON<RestaurantOverview>({
          system: OVERVIEW_SYSTEM_PROMPT,
          user: userMsg,
          maxTokens: 3000,
        });
      } catch (e) {
        console.error('overview extraction error', (e as Error).message);
      }
    }

    if (!overview) {
      // Fallback: minimal overview using just the inputs
      overview = {
        name,
        city: city || null,
        address: null,
        cuisine: null,
        rating: null,
        description: null,
        highlights: [],
        website: url,
      };
    }

    // Attach images
    overview.images = Array.from(imageCandidates).slice(0, 6);
    overview.website = overview.website || url;

    // ---- Merge in Google Places data (if available) ----
    const place = await placePromise;
    if (place) {
      // Google's factual data wins over scraped data
      if (place.formattedAddress) overview.address = place.formattedAddress;
      if (place.phoneNumber) overview.phone = place.phoneNumber;
      if (place.websiteUri) overview.website = place.websiteUri;

      // Google rating replaces scraped rating (user wanted Google reviews specifically)
      if (typeof place.rating === 'number') {
        overview.rating = {
          score: place.rating,
          source: 'Google',
          count: place.userRatingCount ?? undefined,
        };
      }

      overview.place_id = place.placeId;
      overview.latitude = place.latitude;
      overview.longitude = place.longitude;
      overview.business_status = place.businessStatus;
      overview.google_maps_uri = place.googleMapsUri;

      // Static maps — only if we have coordinates
      if (place.latitude != null && place.longitude != null) {
        overview.regional_map_url = getStaticMapUrl({
          lat: place.latitude,
          lng: place.longitude,
          zoom: 5,
          width: 600,
          height: 400,
          marker: true,
        });
        overview.street_map_url = getStaticMapUrl({
          lat: place.latitude,
          lng: place.longitude,
          zoom: 17,
          width: 600,
          height: 400,
          marker: true,
        });
      }

      // Booking URL — OpenTable search (works whether or not the restaurant is on it)
      overview.booking_url = bookingUrl(place.name || name, city);
    } else if (city || name) {
      // Even without Places API, give them an OpenTable search link
      overview.booking_url = bookingUrl(name, city);
    }

    return NextResponse.json({ overview, prompt_version: PROMPT_VERSION });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
