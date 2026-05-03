import { NextRequest, NextResponse } from 'next/server';
import { exaContents } from '@/lib/exa';
import { claudeJSON } from '@/lib/anthropic';
import { EXTRACT_SYSTEM_PROMPT, PROMPT_VERSION } from '@/lib/prompts';
import { ExtractedMenu } from '@/lib/schema';

export const runtime = 'nodejs';
export const maxDuration = 90;

// Patterns for paths that likely contain menu content
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
  'mexico-city', 'cdmx', 'cmx', 'toronto',
];

async function rawFetch(url: string): Promise<string> {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/pdf,*/*;q=0.9',
        'Accept-Language': 'en-AU,en-US;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });
    return await r.text();
  } catch {
    return '';
  }
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
    ) {
      continue;
    }

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
      const clean = abs.toString().replace(/[#?].*$/, '');
      found.add(clean);
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
      '/menu',
      '/menus',
      '/food',
      '/dinner',
      '/lunch',
      '/brunch',
      '/breakfast',
      '/our-menu',
      '/drinks',
      '/wine',
      '/cocktails',
      '/banquet',
      '/dinner-menu',
    ];
    for (const path of paths) {
      out.push(root + path);
    }
  } catch {
    // ignore
  }
  return Array.from(new Set(out));
}

function totalDishes(menu: ExtractedMenu | null | undefined): number {
  if (!menu?.sections) return 0;
  return menu.sections.reduce((n, s) => n + (s.items?.length ?? 0), 0);
}

// POST /api/extract { url, restaurantName? }
//
// Strategy: aggressively gather menu content from multiple pages on the
// restaurant's site, combine them, and send the combined text to Claude
// for extraction in a single pass. This handles the common case where
// a restaurant has separate /menu, /banquet, /drinks, /city pages OR a
// PDF menu OR a Squarespace site that puts the menu on /<location>.
export async function POST(req: NextRequest) {
  try {
    const { url, restaurantName } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    // ---- Step 1: gather candidate URLs ----
    const candidates = new Set<string>();
    candidates.add(url);

    // Parse homepage HTML for menu-relevant links
    const homepageHtml = await rawFetch(url);
    if (homepageHtml) {
      for (const link of findMenuLinks(homepageHtml, url)) {
        candidates.add(link);
      }
    }

    // Add common menu URL patterns as fallbacks
    for (const c of commonMenuUrls(url)) {
      candidates.add(c);
    }

    // Cap candidates for cost/latency. Keep the original first.
    const ordered = [url, ...Array.from(candidates).filter((c) => c !== url)];
    const urls = ordered.slice(0, 7);

    // ---- Step 2: fetch all candidates in parallel via Exa contents ----
    // Exa livecrawl handles SPAs and PDFs.
    const fetched = await Promise.allSettled(
      urls.map((u) =>
        exaContents([u], 'always')
          .then((r) => ({ url: u, content: r[0]?.text ?? '' }))
          .catch(() => ({ url: u, content: '' }))
      )
    );

    const sources = fetched
      .filter((r): r is PromiseFulfilledResult<{ url: string; content: string }> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((s) => s.content && s.content.length > 200);

    if (sources.length === 0) {
      return NextResponse.json(
        {
          error:
            "Could not fetch any content from this restaurant's site. The domain may be blocking automated requests.",
          url,
          urls_tried: urls.length,
        },
        { status: 502 }
      );
    }

    // ---- Step 3: combine source text ----
    // Keep each source under a budget so the combined payload fits in context.
    const perSourceBudget = Math.floor(48000 / Math.max(sources.length, 1));
    const combined = sources
      .map((s) => `=== Source: ${s.url} ===\n${s.content.slice(0, perSourceBudget)}`)
      .join('\n\n');

    // ---- Step 4: send combined content to Claude for one-shot extraction ----
    const userMsg = [
      restaurantName ? `Restaurant hint: ${restaurantName}` : '',
      `Sources fetched: ${sources.length}`,
      sources.map((s, i) => `  [${i + 1}] ${s.url}`).join('\n'),
      '',
      "Combined source content from the restaurant's website (multiple pages concatenated):",
      '---',
      combined,
      '---',
      '',
      'Extract EVERY dish you can find across ALL menu sections — à la carte, banquet, set menus, breakfast, lunch, dinner, brunch, drinks, wine, cocktails, dessert. Group by section name as the source uses. If a dish appears in multiple sources, include it once in the most specific section. Comprehensiveness matters.',
    ]
      .filter(Boolean)
      .join('\n');

    const menu = await claudeJSON<ExtractedMenu>({
      system: EXTRACT_SYSTEM_PROMPT,
      user: userMsg,
      maxTokens: 12000,
    });

    const dishes = totalDishes(menu);
    if (!menu || dishes === 0) {
      return NextResponse.json(
        {
          error:
            "We fetched the restaurant's site but the extractor found no dishes. The menu may live on a third-party platform we did not try, or the site may render its menu in a format we cannot parse.",
          url,
          sources_tried: urls.length,
          sources_fetched: sources.length,
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

    // Strip prices defensively (in case the LLM left any)
    for (const section of result.sections ?? []) {
      for (const item of section.items ?? []) {
        delete (item as Record<string, unknown>).price;
      }
    }

    return NextResponse.json({
      menu: result,
      prompt_version: PROMPT_VERSION,
      total_dishes: dishes,
      sources_used: sources.length,
      sources: sources.map((s) => s.url),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
