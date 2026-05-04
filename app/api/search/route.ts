import { NextRequest, NextResponse } from 'next/server';
import { exaSearch } from '@/lib/exa';

export const runtime = 'nodejs';
export const maxDuration = 30;

const KNOWN_LOCATIONS = [
  'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'auckland', 'hobart', 'darwin', 'canberra', 'gold coast',
  'london', 'manchester', 'edinburgh', 'glasgow', 'bristol', 'liverpool',
  'paris', 'lyon', 'marseille',
  'rome', 'milan', 'florence', 'venice', 'bologna',
  'barcelona', 'madrid', 'seville',
  'berlin', 'munich', 'hamburg',
  'amsterdam', 'rotterdam',
  'tokyo', 'osaka', 'kyoto', 'fukuoka',
  'hong kong', 'singapore', 'bangkok', 'kuala lumpur', 'jakarta', 'manila',
  'mumbai', 'delhi', 'bengaluru', 'kolkata',
  'new york', 'nyc', 'manhattan', 'brooklyn', 'queens', 'bronx',
  'los angeles', 'beverly hills', 'santa monica',
  'chicago', 'san francisco', 'oakland', 'berkeley',
  'miami', 'boston', 'seattle', 'portland', 'austin', 'dallas', 'houston', 'denver',
  'philadelphia', 'washington dc', 'atlanta', 'las vegas',
  'mexico city', 'cdmx', 'guadalajara', 'monterrey',
  'toronto', 'vancouver', 'montreal',
  'dubai', 'abu dhabi', 'doha',
  'cape town', 'johannesburg',
  'sao paulo', 'rio de janeiro', 'buenos aires', 'lima', 'santiago',
  'harvey, la', 'marietta, ga', 'bend, or', 'katy, tx', 'pearland, tx',
];

function detectLocation(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const loc of KNOWN_LOCATIONS) {
    const re = new RegExp(`\\b${loc.replace('.', '\\.')}\\b`, 'i');
    if (re.test(lower)) {
      return loc
        .split(' ')
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ');
    }
  }
  return null;
}

function extractAddressHint(text: string): string | null {
  if (!text) return null;
  const streetRe = /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Pkwy|Parkway|Wharf|Place|Pl|Lane|Ln|Drive|Dr)\.?\b/;
  const m = text.match(streetRe);
  return m ? m[0] : null;
}

function cleanTitle(title: string | undefined, fallback: string): string {
  if (!title) return fallback;
  return title
    .replace(/\s*[-|·]\s*Menu\b.*$/i, '')
    .replace(/^Menu\s*[-|·]\s*/i, '')
    .replace(/\s*\|\s*Order Online.*$/i, '')
    .replace(/\bRestaurant\b\s*$/i, '')
    .trim();
}

// POST /api/search
//   Body: { name: "China Doll", city?: "Sydney" }
//     (also accepts legacy { query: "..." } for backward compatibility)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name: string = (body.name ?? body.query ?? '').toString().trim();
    const city: string = (body.city ?? '').toString().trim();

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Build the query — both fields included if city is provided.
    const queryParts = [name];
    if (city) queryParts.push(city);
    queryParts.push('restaurant menu');
    const enrichedQuery = queryParts.join(' ');

    const results = await exaSearch(enrichedQuery, 10);

    const cityLower = city.toLowerCase();
    const cityTokens = cityLower
      .split(/[\s,]+/)
      .filter((t) => t.length >= 2);
    const nameLower = name.toLowerCase();
    const nameTokens = nameLower
      .split(/[\s,]+/)
      .filter((t) => t.length >= 3);

    const ranked = results
      .map((r) => {
        const url = r.url.toLowerCase();
        const host = (() => {
          try {
            return new URL(r.url).hostname.replace(/^www\./, '');
          } catch {
            return '';
          }
        })();
        let score = 0;

        // Strong: official menu pages
        if (/\/menus?\b/i.test(url)) score += 0.4;
        if (/\.pdf$/i.test(url)) score += 0.4;
        if (/\/(dinner|lunch|breakfast|brunch)-?menu/i.test(url)) score += 0.35;

        // Restaurant has its own domain (not a third-party platform)
        if (
          !/ubereats|doordash|deliveroo|grubhub|seamless|opentable|resy|sevenrooms|tock|tripadvisor|yelp|zomato|thefork|google\.com/i.test(
            url
          )
        ) {
          score += 0.2;
        }

        // Penalise delivery / reservation / listicle when an own-site option exists
        if (/ubereats|doordash|deliveroo|grubhub|seamless/i.test(url)) score -= 0.2;
        if (/opentable|resy|sevenrooms|tock/i.test(url)) score -= 0.05;
        if (/timeout|eater|infatuation|tripadvisor|yelp/i.test(url)) score -= 0.15;

        // Detect location for the UI / for ranking against the city field
        const allText = `${r.title || ''} ${r.summary || ''} ${r.text || ''}`;
        const allLower = allText.toLowerCase();
        const detectedLocation = detectLocation(allText);
        const address = extractAddressHint(allText);

        // BIG BOOST when the user-supplied city matches detected location or appears in the result
        if (city) {
          // Strong: detected location matches user city
          if (
            detectedLocation &&
            (detectedLocation.toLowerCase() === cityLower ||
              detectedLocation.toLowerCase().includes(cityLower) ||
              cityLower.includes(detectedLocation.toLowerCase()))
          ) {
            score += 1.0;
          }
          // Good: city tokens appear in URL hostname (e.g. ".com.au" for Sydney)
          for (const token of cityTokens) {
            if (host.includes(token)) score += 0.4;
            if (allLower.includes(token)) score += 0.2;
          }
          // Country-domain hints
          if (cityLower.includes('sydney') || cityLower.includes('melbourne') || cityLower.includes('brisbane') || cityLower.includes('perth') || cityLower.includes('adelaide')) {
            if (host.endsWith('.au') || host.endsWith('.com.au')) score += 0.5;
          }
          if (cityLower.includes('london') || cityLower.includes('manchester') || cityLower.includes('edinburgh')) {
            if (host.endsWith('.uk') || host.endsWith('.co.uk')) score += 0.5;
          }
          if (cityLower.includes('tokyo') || cityLower.includes('osaka') || cityLower.includes('kyoto')) {
            if (host.endsWith('.jp') || host.endsWith('.co.jp')) score += 0.5;
          }
        }

        // Boost when restaurant name tokens appear in URL/title
        for (const token of nameTokens) {
          if (host.includes(token)) score += 0.1;
          if ((r.title || '').toLowerCase().includes(token)) score += 0.05;
        }

        return {
          ...r,
          _score: score,
          _hostname: host,
          _location: detectedLocation,
          _address: address,
        };
      })
      .sort((a, b) => b._score - a._score);

    const top = ranked.slice(0, 8).map((r) => ({
      name: cleanTitle(r.title, name),
      url: r.url,
      hostname: r._hostname,
      location: r._location,
      address: r._address,
      snippet: r.summary?.slice(0, 200),
      score: r._score,
    }));

    return NextResponse.json({ name, city, results: top });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
