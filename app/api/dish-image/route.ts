import { NextRequest, NextResponse } from 'next/server';
import { dishCacheKey, getCachedImageUrl, saveImage, isR2Configured } from '@/lib/image-cache';
import { generateDishImage } from '@/lib/gemini';
import { exaSearch } from '@/lib/exa';

export const runtime = 'nodejs';
export const maxDuration = 90;

// The locked style template — every dish image gets this same framing.
// Only the dish description varies. Keeps the gallery visually unified.
const STYLE_PROMPT = `Editorial food photography. A single dish on a large warm-white ceramic plate, photographed directly overhead at a 90-degree top-down angle. Natural soft daylight from the upper-left. Neutral oat-linen tablecloth background. No human hands, no props, no text overlays, no menu cards. Centred composition with the plate filling about 75% of the frame. Photorealistic, magazine-quality, restaurant-trade-press style — think Bon Appétit / Wired food photography. Subtle shallow depth of field on the plate edge.

The dish: {DISH_DESCRIPTION}

Render exactly one plate, exactly one dish. Do not add side dishes, garnishes-on-side, multiple plates, or text.`;

function isLikelyFoodPhoto(url: string | undefined): boolean {
  if (!url) return false;
  // Skip logos, icons, sprites, generic stock images
  if (/logo|favicon|cropped-|sprite|avatar|icon|placeholder/i.test(url)) return false;
  // Hint: food photo URLs often contain the dish or restaurant name
  return true;
}

/**
 * Tier 1: Find an image on the restaurant's own page that's near the dish name.
 * Uses simple DOM-position proximity — the closest <img> within 5KB of the
 * dish-name match in the HTML.
 */
async function findSiteImage(sourceUrl: string, dishName: string): Promise<string | null> {
  if (!sourceUrl) return null;
  let html: string;
  try {
    const r = await fetch(sourceUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    html = await r.text();
  } catch {
    return null;
  }

  const dishLower = dishName.toLowerCase();
  // Try a few search strategies for the dish position
  const positions: number[] = [];
  let from = 0;
  while (true) {
    const idx = html.toLowerCase().indexOf(dishLower, from);
    if (idx === -1) break;
    positions.push(idx);
    from = idx + dishLower.length;
    if (positions.length > 5) break;
  }
  if (positions.length === 0) return null;

  // Find all img tags with positions
  const imgRe = /<img\b[^>]*>/gi;
  const imgs: { url: string; pos: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const srcMatch =
      tag.match(/\bdata-image=["']([^"']+)["']/i) ||
      tag.match(/\bdata-src=["']([^"']+)["']/i) ||
      tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    let src = srcMatch[1].trim();
    if (!src || src.startsWith('data:')) continue;
    if (!isLikelyFoodPhoto(src)) continue;

    // Resolve to absolute URL
    let abs: URL;
    try {
      abs = new URL(src, sourceUrl);
    } catch {
      continue;
    }
    // Prefer larger images
    const dimMatch = tag.match(/\bdata-image-dimensions=["'](\d+)x(\d+)/i);
    if (dimMatch) {
      const w = parseInt(dimMatch[1], 10);
      const h = parseInt(dimMatch[2], 10);
      if (Math.max(w, h) < 400) continue;
    }
    imgs.push({ url: abs.toString(), pos: m.index });
  }
  if (imgs.length === 0) return null;

  // Find the image whose position is closest to any dish-name position
  let best: { url: string; dist: number } | null = null;
  for (const img of imgs) {
    for (const dp of positions) {
      const d = Math.abs(img.pos - dp);
      if (!best || d < best.dist) best = { url: img.url, dist: d };
    }
  }
  // Only accept if reasonably close (within 5KB of the dish name)
  if (!best || best.dist > 5000) return null;

  // Squarespace CDN — request a reasonable resolution
  let serveUrl = best.url;
  if (/squarespace-cdn\.com/i.test(serveUrl)) {
    serveUrl = serveUrl.split('?')[0] + '?format=1500w';
  }
  return serveUrl;
}

/**
 * Tier 2: Web image search via Exa for "<dish> <restaurant>".
 */
async function findWebImage(dishName: string, restaurantName: string): Promise<string | null> {
  try {
    const query = `"${dishName}" ${restaurantName} dish food photo`;
    const results = await exaSearch(query, 6);
    for (const r of results) {
      if (r.image && isLikelyFoodPhoto(r.image)) {
        return r.image;
      }
    }
  } catch (e) {
    console.warn('exa image search failed:', (e as Error).message);
  }
  return null;
}

// POST /api/dish-image
//   Body: { restaurantSlug, restaurantName, dishName, dishNote?, cuisine?, sourceUrl? }
//   Returns: { imageUrl, source, cached }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const restaurantSlug = (body.restaurantSlug ?? '').toString().trim();
    const restaurantName = (body.restaurantName ?? '').toString().trim();
    const dishName = (body.dishName ?? '').toString().trim();
    const dishNote = (body.dishNote ?? '').toString().trim();
    const cuisine = (body.cuisine ?? '').toString().trim();
    const sourceUrl = (body.sourceUrl ?? '').toString().trim();

    if (!restaurantSlug || !dishName) {
      return NextResponse.json(
        { error: 'restaurantSlug and dishName required' },
        { status: 400 }
      );
    }

    const key = dishCacheKey(restaurantSlug, dishName);

    // ---- Cache check (Tier 0) ----
    if (isR2Configured()) {
      const cached = await getCachedImageUrl(key);
      if (cached) {
        return NextResponse.json({
          imageUrl: cached,
          source: 'cache',
          cached: true,
          cacheKey: key,
        });
      }
    }

    // ---- Tier 1: image from the restaurant's own page ----
    let seedImage: string | null = null;
    let seedSource: string | null = null;
    if (sourceUrl) {
      seedImage = await findSiteImage(sourceUrl, dishName);
      if (seedImage) seedSource = 'site';
    }

    // ---- Tier 2: web image search ----
    if (!seedImage) {
      seedImage = await findWebImage(dishName, restaurantName);
      if (seedImage) seedSource = 'search';
    }

    // ---- Tier 3: Gemini Flash generation (with seed if any) ----
    const descriptionPieces = [
      dishName,
      dishNote || null,
      cuisine ? `Cuisine: ${cuisine}` : null,
    ].filter(Boolean) as string[];
    const description = descriptionPieces.join('. ');
    const prompt = STYLE_PROMPT.replace('{DISH_DESCRIPTION}', description);

    const gen = await generateDishImage({
      prompt,
      seedImageUrl: seedImage ?? undefined,
    });

    // ---- Save to R2 ----
    if (!isR2Configured()) {
      // Fallback: return a data: URL so the image still works without R2
      const dataUrl = `data:${gen.mimeType};base64,${gen.buffer.toString('base64')}`;
      return NextResponse.json({
        imageUrl: dataUrl,
        source: gen.usedSeed ? `ai-${seedSource}-seed` : 'ai-text',
        cached: false,
        cacheKey: key,
        warning: 'R2 not configured — image not cached, will regenerate next time',
      });
    }

    const imageUrl = await saveImage(key, gen.buffer, gen.mimeType, {
      'restaurant-slug': restaurantSlug,
      'restaurant-name': restaurantName,
      'dish-name': dishName,
      'source-tier': gen.usedSeed && seedSource ? `3-${seedSource}-seed` : '3-text',
      'seed-url': seedImage ?? '',
      'generated-at': new Date().toISOString(),
    });

    return NextResponse.json({
      imageUrl,
      source: gen.usedSeed ? `ai-${seedSource}-seed` : 'ai-text',
      cached: false,
      cacheKey: key,
    });
  } catch (e) {
    console.error('dish-image error:', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
