import { NextRequest, NextResponse } from 'next/server';
import { exaContents } from '@/lib/exa';
import { claudeJSON, claudeJSONWithImages } from '@/lib/anthropic';
import { EXTRACT_SYSTEM_PROMPT, PROMPT_VERSION } from '@/lib/prompts';
import { ExtractedMenu } from '@/lib/schema';

export const runtime = 'nodejs';
export const maxDuration = 120;

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
  'mexico-city', 'cdmx', 'cmx', 'toronto', 'katy', 'pearland',
];

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

/**
 * Find URLs of likely menu images in a page's HTML. These are the images
 * we'll send to Claude vision when text extraction is empty.
 */
function findMenuImageUrls(html: string, baseUrl: string): string[] {
  if (!html) return [];
  const found: { url: string; score: number }[] = [];

  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    // Get src or data-src
    const srcMatch =
      tag.match(/\bdata-image=["']([^"']+)["']/i) ||
      tag.match(/\bdata-src=["']([^"']+)["']/i) ||
      tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    let src = srcMatch[1].trim();
    if (!src || src.startsWith('data:')) continue;

    let abs: URL;
    try {
      abs = new URL(src, baseUrl);
    } catch {
      continue;
    }

    const url = abs.toString().split('?')[0];
    const path = abs.pathname.toLowerCase();
    const filename = path.split('/').pop() || '';

    // Exclude non-menu image kinds
    if (/logo|favicon|icon|avatar|profile|sprite|tracking|pixel/i.test(path)) continue;

    let score = 0;

    // Filename / path hints
    if (/menu/i.test(path)) score += 5;
    if (/food|dishes|carte|cuisine/i.test(path)) score += 2;

    // Size hints
    const wMatch = tag.match(/\bwidth=["']?(\d+)/i);
    const hMatch = tag.match(/\bheight=["']?(\d+)/i);
    const dimMatch = tag.match(/\bdata-image-dimensions=["'](\d+)x(\d+)["']/i);
    const w = wMatch ? parseInt(wMatch[1], 10) : 0;
    const h = hMatch ? parseInt(hMatch[1], 10) : 0;
    const dw = dimMatch ? parseInt(dimMatch[1], 10) : 0;
    const dh = dimMatch ? parseInt(dimMatch[2], 10) : 0;

    if (Math.max(w, h, dw, dh) >= 1500) score += 4;
    else if (Math.max(w, h, dw, dh) >= 800) score += 2;
    else if (Math.max(w, h, dw, dh) > 0 && Math.max(w, h, dw, dh) < 300) {
      // Tiny images are decorations
      score -= 3;
    }

    // Tall images are typical of menu boards / printed menus
    if ((dh > 0 && dh > dw * 1.3) || (h > 0 && h > w * 1.3)) score += 2;

    // Squarespace and WordPress CDN paths are usually content images
    if (/squarespace-cdn\.com|wp-content\/uploads|cloudinary\.com|imgix\.net/i.test(url))
      score += 1;

    if (score >= 2) {
      // For Squarespace, request a large but reasonable size
      let serveUrl = url;
      if (/squarespace-cdn\.com/i.test(url)) {
        serveUrl = url + '?format=2500w';
      }
      found.push({ url: serveUrl, score });
    }
  }

  // Dedup by base URL, keep highest score
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

// POST /api/extract { url, restaurantName? }
//
// Three-stage strategy:
//   1. Gather candidate URLs (homepage links matching menu patterns + common
//      paths) and fetch all in parallel via Exa (livecrawl handles SPAs).
//   2. Send combined text content to Claude for one-shot extraction.
//   3. If extraction comes back with zero dishes, find menu IMAGES in the
//      page HTML and send those to Claude vision. Many restaurants (esp.
//      Squarespace + Korean BBQ + small sushi places) upload menus as JPGs.
export async function POST(req: NextRequest) {
  try {
    const { url, restaurantName } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    // ---- Step 1: gather candidate URLs ----
    const candidates = new Set<string>();
    candidates.add(url);

    const homepageHtml = await rawFetch(url);
    if (homepageHtml) {
      for (const link of findMenuLinks(homepageHtml, url)) {
        candidates.add(link);
      }
    }
    for (const c of commonMenuUrls(url)) {
      candidates.add(c);
    }

    const ordered = [url, ...Array.from(candidates).filter((c) => c !== url)];
    const urls = ordered.slice(0, 7);

    // ---- Step 2: fetch all candidates in parallel via Exa contents ----
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

    let menu: ExtractedMenu | null = null;
    let dishes = 0;
    let extractionMethod: 'text' | 'vision' | 'none' = 'none';

    // ---- Step 2a: try text-based extraction if we have content ----
    if (sources.length > 0) {
      const perSourceBudget = Math.floor(48000 / Math.max(sources.length, 1));
      const combined = sources
        .map((s) => `=== Source: ${s.url} ===\n${s.content.slice(0, perSourceBudget)}`)
        .join('\n\n');

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

      try {
        const textMenu = await claudeJSON<ExtractedMenu>({
          system: EXTRACT_SYSTEM_PROMPT,
          user: userMsg,
          maxTokens: 12000,
        });
        const textDishes = totalDishes(textMenu);
        if (textDishes > 0) {
          menu = textMenu;
          dishes = textDishes;
          extractionMethod = 'text';
        }
      } catch (e) {
        console.error('text extraction error', (e as Error).message);
      }
    }

    // ---- Step 3: vision fallback for image-based menus ----
    if (dishes === 0) {
      // Collect menu image URLs from all the candidate pages
      const allHtml: string[] = [];
      if (homepageHtml) allHtml.push(homepageHtml);

      // Fetch HTML of the other candidate URLs (in parallel) so we can find images
      const otherUrls = urls.filter((u) => u !== url).slice(0, 4);
      const otherHtml = await Promise.allSettled(otherUrls.map((u) => rawFetch(u)));
      for (const r of otherHtml) {
        if (r.status === 'fulfilled' && r.value) allHtml.push(r.value);
      }

      const imageUrls = new Set<string>();
      for (let i = 0; i < allHtml.length; i++) {
        const html = allHtml[i];
        const u = i === 0 ? url : otherUrls[i - 1];
        for (const img of findMenuImageUrls(html, u)) {
          imageUrls.add(img);
        }
      }

      const imageList = Array.from(imageUrls).slice(0, 6);

      if (imageList.length > 0) {
        const visionUserMsg = [
          restaurantName ? `Restaurant hint: ${restaurantName}` : '',
          `Source URL: ${url}`,
          `These are images of the restaurant's menu (${imageList.length} image${imageList.length === 1 ? '' : 's'}).`,
          '',
          'Read every dish from every section visible in the images. Many restaurants put their entire menu on a single image, so look carefully at section headings and list every individual dish under each heading. Group dishes by section as the menu does. Apply the same paraphrasing rule: write each dish "note" in your own words, not the menu prose verbatim.',
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
          const visionDishes = totalDishes(visionMenu);
          if (visionDishes > 0) {
            menu = visionMenu;
            dishes = visionDishes;
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
            "We fetched the restaurant's site but could not identify any menu dishes — neither in the text content nor in any visible menu images. The menu may live on a third-party platform we did not try.",
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

    // Strip prices defensively
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
      sources_used: sources.length,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
