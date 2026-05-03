import { NextRequest, NextResponse } from 'next/server';
import { exaContents, exaSearch } from '@/lib/exa';
import { claudeJSON, claudeJSONWithImages } from '@/lib/anthropic';
import { EXTRACT_SYSTEM_PROMPT, PROMPT_VERSION } from '@/lib/prompts';
import { ExtractedMenu } from '@/lib/schema';

export const runtime = 'nodejs';
export const maxDuration = 180;

// ---------- Patterns ----------

const MENU_PATH_PATTERNS = [
  /\/menus?(\/|$)/i,
  /\/food(\/|$)/i,
  /\/dinner(\/|$)/i,
  /\/lunch(\/|$)/i,
  /\/brunch(\/|$)/i,
  /\/breakfast(\/|$)/i,
  /\/drinks?(\/|$)/i,
  /\/wine(\/|$)/i,
  /\/cocktails?(\/|$)/i,
  /\/banquet(\/|$)/i,
  /\/dessert(\/|$)/i,
  /\/dishes(\/|$)/i,
  /\/our[-_]menu(\/|$)/i,
  /\/dinner[-_]menu(\/|$)/i,
  /\/lunch[-_]menu(\/|$)/i,
  /\.pdf$/i,
];

const CITY_HINTS = [
  'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'auckland',
  'london', 'manchester', 'edinburgh',
  'paris', 'rome', 'milan', 'barcelona', 'madrid', 'berlin', 'amsterdam',
  'tokyo', 'osaka', 'hong-kong', 'singapore', 'bangkok',
  'new-york', 'nyc', 'manhattan', 'brooklyn', 'la', 'los-angeles',
  'chicago', 'sf', 'san-francisco', 'miami', 'boston', 'seattle',
  'mexico-city', 'cdmx', 'cmx', 'toronto', 'katy', 'pearland',
];

// Domains we trust as good third-party menu sources when the restaurant's
// own site is blocked or thin. Ranked roughly by content quality.
const THIRD_PARTY_MENU_DOMAINS = [
  'opentable.com', 'opentable.com.au', 'opentable.co.uk',
  'tripadvisor.com', 'tripadvisor.com.au', 'tripadvisor.co.uk',
  'yelp.com', 'yelp.com.au',
  'zomato.com',
  'thefork.com', 'thefork.com.au',
  'google.com', // Google Maps cached menu pages
  'theinfatuation.com',
  'eater.com',
  'timeout.com',
  'concreteplayground.com',
  'broadsheet.com.au',
  'goodfood.com.au',
  'gourmettraveller.com.au',
  'grubhub.com',
  'doordash.com',
  'ubereats.com',
  'menupages.com',
  'menupix.com',
  'singleplatform.com',
];

// Bot-challenge / paywall fingerprints in returned content
const BOT_BLOCK_PATTERNS = [
  /thinks you might be a robot/i,
  /please complete the captcha/i,
  /just a moment\.\.\./i,
  /checking your browser before/i,
  /enable cookies and reload/i,
  /access denied/i,
  /403\s*forbidden/i,
];

// ---------- Helpers ----------

async function rawFetch(url: string): Promise<string> {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.9',
        'Accept-Language': 'en-AU,en-US;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });
    return await r.text();
  } catch {
    return '';
  }
}

function isBotBlocked(text: string): boolean {
  if (!text || text.length < 50) return false;
  return BOT_BLOCK_PATTERNS.some((re) => re.test(text));
}

function findMenuLinks(html: string, baseUrl: string): string[] {
  const found = new Set<string>();
  if (!html) return [];

  let baseHost: string;
  try {
    baseHost = new URL(baseUrl).hostname.replace(/^www\./, '');
  } catch {
    return [];
  }

  const hrefRe = /href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1].trim();
    if (
      !href ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:')
    )
      continue;

    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (abs.hostname.replace(/^www\./, '') !== baseHost) continue;

    const path = abs.pathname.toLowerCase();
    const matchesMenu = MENU_PATH_PATTERNS.some((re) => re.test(path));
    const matchesCity = CITY_HINTS.some((c) => path.includes('/' + c));
    const looksLikeMenuFile = /menu|food|dinner|lunch|brunch|drink|wine|cocktail|banquet/i.test(path);

    if (matchesMenu || matchesCity || looksLikeMenuFile) {
      found.add(abs.toString().replace(/[#?].*$/, ''));
    }
  }
  return Array.from(found);
}

function commonMenuUrls(baseUrl: string): string[] {
  const out: string[] = [];
  try {
    const u = new URL(baseUrl);
    const root = `${u.protocol}//${u.hostname}`;
    const paths = [
      '/menu', '/menus', '/food', '/dinner', '/lunch', '/brunch',
      '/breakfast', '/our-menu', '/drinks', '/wine', '/cocktails',
      '/banquet', '/dinner-menu',
    ];
    for (const path of paths) out.push(root + path);
  } catch {
    // ignore
  }
  return Array.from(new Set(out));
}

function findMenuImageUrls(html: string, baseUrl: string): string[] {
  if (!html) return [];
  const found: { url: string; score: number }[] = [];

  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const srcMatch =
      tag.match(/\bdata-image=["']([^"']+)["']/i) ||
      tag.match(/\bdata-src=["']([^"']+)["']/i) ||
      tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const src = srcMatch[1].trim();
    if (!src || src.startsWith('data:')) continue;

    let abs: URL;
    try {
      abs = new URL(src, baseUrl);
    } catch {
      continue;
    }
    const url = abs.toString().split('?')[0];
    const path = abs.pathname.toLowerCase();
    if (/logo|favicon|icon|avatar|profile|sprite|tracking|pixel/i.test(path)) continue;

    let score = 0;
    if (/menu/i.test(path)) score += 5;
    if (/food|dishes|carte|cuisine/i.test(path)) score += 2;

    const wMatch = tag.match(/\bwidth=["']?(\d+)/i);
    const hMatch = tag.match(/\bheight=["']?(\d+)/i);
    const dimMatch = tag.match(/\bdata-image-dimensions=["'](\d+)x(\d+)["']/i);
    const w = wMatch ? parseInt(wMatch[1], 10) : 0;
    const h = hMatch ? parseInt(hMatch[1], 10) : 0;
    const dw = dimMatch ? parseInt(dimMatch[1], 10) : 0;
    const dh = dimMatch ? parseInt(dimMatch[2], 10) : 0;

    const maxDim = Math.max(w, h, dw, dh);
    if (maxDim >= 1500) score += 4;
    else if (maxDim >= 800) score += 2;
    else if (maxDim > 0 && maxDim < 300) score -= 3;

    if ((dh > 0 && dh > dw * 1.3) || (h > 0 && h > w * 1.3)) score += 2;
    if (/squarespace-cdn\.com|wp-content\/uploads|cloudinary\.com|imgix\.net/i.test(url))
      score += 1;

    if (score >= 2) {
      let serveUrl = url;
      if (/squarespace-cdn\.com/i.test(url)) serveUrl = url + '?format=2500w';
      found.push({ url: serveUrl, score });
    }
  }

  const byUrl = new Map<string, number>();
  for (const f of found) {
    const cur = byUrl.get(f.url) ?? 0;
    if (f.score > cur) byUrl.set(f.url, f.score);
  }

  return Array.from(byUrl.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([u]) => u)
    .slice(0, 8);
}

function totalDishes(menu: ExtractedMenu | null | undefined): number {
  if (!menu?.sections) return 0;
  return menu.sections.reduce((n, s) => n + (s.items?.length ?? 0), 0);
}

function rankThirdPartyResults(
  results: { url: string; title?: string; summary?: string; text?: string }[],
  excludeDomain: string | null
): typeof results {
  const ranked = results.map((r) => {
    let host = '';
    try {
      host = new URL(r.url).hostname.replace(/^www\./, '');
    } catch {
      return { ...r, _score: -100 };
    }
    if (excludeDomain && host === excludeDomain) return { ...r, _score: -100 };

    let score = 0;
    // Boost trusted third-party menu domains
    for (let i = 0; i < THIRD_PARTY_MENU_DOMAINS.length; i++) {
      if (host === THIRD_PARTY_MENU_DOMAINS[i] || host.endsWith('.' + THIRD_PARTY_MENU_DOMAINS[i])) {
        score += 10 - i * 0.2;
        break;
      }
    }
    // Boost menu-relevant URL paths
    const path = (() => {
      try {
        return new URL(r.url).pathname.toLowerCase();
      } catch {
        return '';
      }
    })();
    if (/menu/i.test(path)) score += 2;
    if (/\.pdf$/i.test(path)) score += 2;

    // Snippet hints
    const text = `${r.title || ''} ${r.summary || ''} ${r.text || ''}`.toLowerCase();
    if (/menu/.test(text)) score += 1;
    if (/dish|appetizer|entree|main|dessert/.test(text)) score += 1;

    return { ...r, _score: score };
  });
  return (ranked as (typeof results[number] & { _score: number })[])
    .filter((r) => r._score > -100)
    .sort((a, b) => (b as { _score: number })._score - (a as { _score: number })._score);
}

// ---------- Main route ----------

export async function POST(req: NextRequest) {
  try {
    const { url, restaurantName } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    let originalDomain: string | null = null;
    try {
      originalDomain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      // fall through
    }

    // ============ STAGE 1 — restaurant's own site ============
    const ownSiteCandidates = new Set<string>();
    ownSiteCandidates.add(url);

    const homepageHtml = await rawFetch(url);
    const homepageBlocked = isBotBlocked(homepageHtml);

    if (homepageHtml && !homepageBlocked) {
      for (const link of findMenuLinks(homepageHtml, url)) ownSiteCandidates.add(link);
    }
    for (const c of commonMenuUrls(url)) ownSiteCandidates.add(c);

    const ownUrls = Array.from(ownSiteCandidates).slice(0, 6);

    const ownFetched = await Promise.allSettled(
      ownUrls.map((u) =>
        exaContents([u], 'always')
          .then((r) => ({ url: u, content: r[0]?.text ?? '' }))
          .catch(() => ({ url: u, content: '' }))
      )
    );

    const ownSources = ownFetched
      .filter((r): r is PromiseFulfilledResult<{ url: string; content: string }> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((s) => s.content && s.content.length > 200 && !isBotBlocked(s.content));

    // ============ STAGE 2 — third-party web sources ============
    // Always do this in parallel — even if the own site works, third parties
    // often have additional menu sections (lunch, drinks) that the homepage
    // doesn't show. The combined corpus is richer.
    const queries = [
      restaurantName ? `"${restaurantName}" menu` : `${url} menu`,
      restaurantName ? `${restaurantName} menu items dishes` : '',
      restaurantName ? `${restaurantName} restaurant menu price` : '',
    ].filter(Boolean);

    const searchResults = await Promise.allSettled(
      queries.map((q) => exaSearch(q, 8))
    );

    const allResults = searchResults
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof exaSearch>>>).value);

    // Dedup by URL
    const seenUrls = new Set<string>(ownUrls);
    const uniqueThirdParty = allResults.filter((r) => {
      if (seenUrls.has(r.url)) return false;
      seenUrls.add(r.url);
      return true;
    });

    const ranked = rankThirdPartyResults(uniqueThirdParty, originalDomain);
    const thirdPartyUrls = ranked.slice(0, 5).map((r) => r.url);

    const thirdPartyFetched = await Promise.allSettled(
      thirdPartyUrls.map((u) =>
        exaContents([u], 'fallback')
          .then((r) => ({ url: u, content: r[0]?.text ?? '' }))
          .catch(() => ({ url: u, content: '' }))
      )
    );

    const thirdPartySources = thirdPartyFetched
      .filter((r): r is PromiseFulfilledResult<{ url: string; content: string }> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((s) => s.content && s.content.length > 200);

    // ============ STAGE 3 — combined text extraction ============
    const allSources = [...ownSources, ...thirdPartySources];
    let menu: ExtractedMenu | null = null;
    let dishes = 0;
    let extractionMethod: 'text' | 'vision' | 'mixed' | 'none' = 'none';
    let sourcesUsed = 0;

    if (allSources.length > 0) {
      const perSourceBudget = Math.floor(60000 / Math.max(allSources.length, 1));
      const combined = allSources
        .map((s) => `=== Source: ${s.url} ===\n${s.content.slice(0, perSourceBudget)}`)
        .join('\n\n');

      const userMsg = [
        restaurantName ? `Restaurant: ${restaurantName}` : '',
        `Sources fetched: ${allSources.length} (${ownSources.length} from the restaurant's site, ${thirdPartySources.length} from third-party listings)`,
        '',
        "Combined source content (multiple pages and external listings concatenated):",
        '---',
        combined,
        '---',
        '',
        "Extract EVERY dish from EVERY menu section across all the sources combined. Sources may include the restaurant's own pages, OpenTable, Tripadvisor, Yelp, food blog reviews, and other listings — pull menu items from all of them. Group by section as the menu uses (à la carte, banquet, lunch, dinner, drinks, wine, cocktails, dessert). De-dupe across sources by dish name. Comprehensiveness matters.",
      ]
        .filter(Boolean)
        .join('\n');

      try {
        const textMenu = await claudeJSON<ExtractedMenu>({
          system: EXTRACT_SYSTEM_PROMPT,
          user: userMsg,
          maxTokens: 16000,
        });
        if (totalDishes(textMenu) > 0) {
          menu = textMenu;
          dishes = totalDishes(textMenu);
          extractionMethod = 'text';
          sourcesUsed = allSources.length;
        }
      } catch (e) {
        console.error('text extraction error', (e as Error).message);
      }
    }

    // ============ STAGE 4 — vision fallback for image-based menus ============
    if (dishes === 0) {
      const allHtml: string[] = [];
      if (homepageHtml) allHtml.push(homepageHtml);

      const otherUrls = ownUrls.filter((u) => u !== url).slice(0, 4);
      const otherHtml = await Promise.allSettled(otherUrls.map((u) => rawFetch(u)));
      for (const r of otherHtml) {
        if (r.status === 'fulfilled' && r.value) allHtml.push(r.value);
      }

      const imageUrls = new Set<string>();
      for (let i = 0; i < allHtml.length; i++) {
        const html = allHtml[i];
        const u = i === 0 ? url : otherUrls[i - 1];
        for (const img of findMenuImageUrls(html, u)) imageUrls.add(img);
      }

      const imageList = Array.from(imageUrls).slice(0, 6);
      if (imageList.length > 0) {
        const visionUserMsg = [
          restaurantName ? `Restaurant: ${restaurantName}` : '',
          `Source URL: ${url}`,
          `Menu images attached (${imageList.length}).`,
          '',
          'Read every dish from every section visible in the images. Group by section as the menu does. Apply the paraphrasing rule.',
        ]
          .filter(Boolean)
          .join('\n');

        try {
          const visionMenu = await claudeJSONWithImages<ExtractedMenu>({
            system: EXTRACT_SYSTEM_PROMPT,
            user: visionUserMsg,
            imageUrls: imageList,
            maxTokens: 12000,
          });
          if (totalDishes(visionMenu) > 0) {
            menu = visionMenu;
            dishes = totalDishes(visionMenu);
            extractionMethod = 'vision';
          }
        } catch (e) {
          console.error('vision extraction error', (e as Error).message);
        }
      }
    }

    if (!menu || dishes === 0) {
      return NextResponse.json(
        {
          error:
            "We searched the restaurant's own site and several third-party listings (OpenTable, Tripadvisor, Yelp, food blogs) and could not identify any menu dishes. The menu may be on a delivery platform or social media we did not try.",
          url,
          own_sources_tried: ownUrls.length,
          own_sources_fetched: ownSources.length,
          third_party_tried: thirdPartyUrls.length,
          third_party_fetched: thirdPartySources.length,
          original_blocked: homepageBlocked,
        },
        { status: 502 }
      );
    }

    const result: ExtractedMenu = {
      ...menu,
      source_url: url,
      source_format: /\.pdf$/i.test(url) ? 'pdf' : 'html',
      extracted_at: new Date().toISOString(),
    };

    for (const section of result.sections ?? []) {
      for (const item of section.items ?? []) {
        delete (item as Record<string, unknown>).price;
      }
    }

    return NextResponse.json({
      menu: result,
      prompt_version: PROMPT_VERSION,
      total_dishes: dishes,
      extraction_method: extractionMethod,
      sources_used: sourcesUsed || allSources.length,
      own_sources: ownSources.length,
      third_party_sources: thirdPartySources.length,
      original_blocked: homepageBlocked,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
