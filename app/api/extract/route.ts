import { NextRequest, NextResponse } from 'next/server';
import { exaContents, exaSearch } from '@/lib/exa';
import { claudeJSON } from '@/lib/anthropic';
import { EXTRACT_SYSTEM_PROMPT, PROMPT_VERSION } from '@/lib/prompts';
import { ExtractedMenu } from '@/lib/schema';

export const runtime = 'nodejs';
export const maxDuration = 90;

function totalDishes(menu: ExtractedMenu | null | undefined): number {
  if (!menu?.sections) return 0;
  return menu.sections.reduce((n, s) => n + (s.items?.length ?? 0), 0);
}

async function tryExtract(
  url: string,
  restaurantName?: string
): Promise<{ menu: ExtractedMenu | null; charsFetched: number }> {
  try {
    const contents = await exaContents([url], 'always');
    const page = contents[0];
    if (!page?.text || page.text.length < 200) {
      return { menu: null, charsFetched: page?.text?.length ?? 0 };
    }
    const userMsg = [
      restaurantName ? `Restaurant hint: ${restaurantName}` : '',
      `Source URL: ${url}`,
      '',
      'Source content:',
      '---',
      page.text.slice(0, 22000),
      '---',
      '',
      'Produce the structured menu JSON now. Extract every dish you can find in the source text. If there are clear menu sections, group dishes by those.',
    ]
      .filter(Boolean)
      .join('\n');

    const menu = await claudeJSON<ExtractedMenu>({
      system: EXTRACT_SYSTEM_PROMPT,
      user: userMsg,
      maxTokens: 8000,
    });
    return { menu, charsFetched: page.text.length };
  } catch (e) {
    console.error('tryExtract error', url, (e as Error).message);
    return { menu: null, charsFetched: 0 };
  }
}

// POST /api/extract { url, restaurantName? }
// Returns: ExtractedMenu
//
// Strategy: try the given URL first. If extraction yields fewer than 5 dishes,
// search the same domain for a more menu-rich page (Squarespace, custom CMSes
// often put menus on /menu, /<city>, /food, /dinner — paths we can't always
// guess). Try the top candidates and pick whichever gives the most dishes.
export async function POST(req: NextRequest) {
  try {
    const { url, restaurantName } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    // ---- Pass 1: extract from the given URL ----
    let bestMenu: ExtractedMenu | null = null;
    let bestUrl = url;
    let bestDishes = 0;

    const first = await tryExtract(url, restaurantName);
    if (first.menu) {
      bestMenu = first.menu;
      bestDishes = totalDishes(first.menu);
    }

    // ---- Pass 2: if sparse, search the same domain for menu pages ----
    if (bestDishes < 5) {
      const baseDomain = (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })();

      if (baseDomain) {
        // Search both for menu pages and for the restaurant + menu items
        const queries = [
          `${restaurantName || ''} site:${baseDomain} menu`.trim(),
          `${restaurantName || ''} site:${baseDomain} dinner food dishes`.trim(),
        ];

        const candidatesSeen = new Set<string>();
        candidatesSeen.add(url);

        for (const q of queries) {
          let results: Awaited<ReturnType<typeof exaSearch>> = [];
          try {
            results = await exaSearch(q, 6);
          } catch (e) {
            continue;
          }

          for (const r of results) {
            if (candidatesSeen.has(r.url)) continue;
            // Same-site only
            try {
              const cd = new URL(r.url).hostname.replace(/^www\./, '');
              if (cd !== baseDomain) continue;
            } catch {
              continue;
            }
            candidatesSeen.add(r.url);

            const result = await tryExtract(r.url, restaurantName);
            const dishes = totalDishes(result.menu);
            if (dishes > bestDishes && result.menu) {
              bestMenu = result.menu;
              bestUrl = r.url;
              bestDishes = dishes;
              if (dishes >= 10) break;
            }
          }
          if (bestDishes >= 10) break;
        }
      }
    }

    // ---- Pass 3: fallback — broad menu search if still empty ----
    if (bestDishes < 3) {
      try {
        const broad = await exaSearch(`${restaurantName || url} menu items dishes`, 5);
        const seen = new Set<string>([url, bestUrl]);
        for (const r of broad.slice(0, 3)) {
          if (seen.has(r.url)) continue;
          seen.add(r.url);
          const result = await tryExtract(r.url, restaurantName);
          const dishes = totalDishes(result.menu);
          if (dishes > bestDishes && result.menu) {
            bestMenu = result.menu;
            bestUrl = r.url;
            bestDishes = dishes;
            if (dishes >= 8) break;
          }
        }
      } catch (e) {
        // non-fatal
      }
    }

    if (!bestMenu || bestDishes === 0) {
      return NextResponse.json(
        {
          error:
            'No menu items could be extracted from this restaurant. The site may be heavily JavaScript-rendered, behind a login, or the menu may live on a third-party platform we did not try. We attempted the homepage and several follow-up pages on the same domain.',
          url: bestUrl,
        },
        { status: 502 }
      );
    }

    const result: ExtractedMenu = {
      ...bestMenu,
      source_url: bestUrl,
      source_format: /\.pdf$/i.test(bestUrl) ? 'pdf' : 'html',
      extracted_at: new Date().toISOString(),
    };

    // Strip any prices that might have slipped through (defence in depth)
    for (const section of result.sections ?? []) {
      for (const item of section.items ?? []) {
        delete (item as Record<string, unknown>).price;
      }
    }

    return NextResponse.json({
      menu: result,
      prompt_version: PROMPT_VERSION,
      total_dishes: bestDishes,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
