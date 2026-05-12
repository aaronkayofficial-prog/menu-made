// MENU MADE — generated-recipe cache.
//
// Caches the result of /api/generate per (dish + restaurant + params) for 90 days.
// First user to request "Kung Pao Prawns at Spice Temple, 4 guests, intermediate"
// pays the 60-90 second LLM generation cost; every subsequent user with the same
// inputs gets the recipe in <1 second from Vercel Blob.
//
// Storage: same Vercel Blob store as dish images and menus (path: recipes/{key}.json).
// Cache key: sha256(dish_id + restaurant_name + JSON.stringify(params)).

import { put, list } from '@vercel/blob';
import { createHash } from 'crypto';
import type { GeneratedRecipe, RecipeParams } from './schema';

const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface CachedRecipe {
  recipe: GeneratedRecipe;
  prompt_version: string;
  _cachedAt: number;
}

export function isRecipeCacheConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Stable cache key for a (dish, restaurant, params) tuple.
 * Two users with identical params get the same cached recipe.
 */
export function recipeCacheKey(
  dish: { id?: string; name: string },
  restaurant: { name: string; city?: string },
  params: RecipeParams
): string {
  // Normalise inputs so trivial differences (whitespace, case) don't fragment the cache
  const normalisedDish = (dish.id || dish.name).trim().toLowerCase();
  const normalisedRestaurant = restaurant.name.trim().toLowerCase();
  const normalisedCity = (restaurant.city ?? '').trim().toLowerCase();

  // Sort equipment + dietary so order doesn't break the cache key
  const equipmentSorted = [...(params.equipment ?? [])].map((s) => s.trim().toLowerCase()).sort();
  const dietarySorted = [...(params.dietary ?? [])].map((s) => s.trim().toLowerCase()).sort();

  const seed = JSON.stringify({
    d: normalisedDish,
    r: normalisedRestaurant,
    c: normalisedCity,
    g: params.guests,
    s: (params.skill ?? '').toLowerCase(),
    t: (params.cookingTime ?? '').toLowerCase(),
    eq: equipmentSorted,
    di: dietarySorted,
    st: (params.style ?? '').toLowerCase(),
  });

  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

function pathFor(key: string): string {
  return `recipes/${key}.json`;
}

/**
 * Look up cached recipe. Returns null if missing or expired.
 */
export async function getCachedRecipe(key: string): Promise<CachedRecipe | null> {
  if (!isRecipeCacheConfigured()) return null;
  try {
    const { blobs } = await list({ prefix: pathFor(key) });
    if (blobs.length === 0) return null;

    // Most recent if multiple
    const sorted = blobs.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

    const r = await fetch(sorted[0].url, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as CachedRecipe;

    // Expiry check
    const age = Date.now() - (data._cachedAt ?? 0);
    if (age > TTL_MS) return null;

    return data;
  } catch (e) {
    console.warn('recipe cache lookup failed:', (e as Error).message);
    return null;
  }
}

/**
 * Save generated recipe to cache.
 */
export async function saveRecipe(
  key: string,
  payload: Omit<CachedRecipe, '_cachedAt'>
): Promise<void> {
  if (!isRecipeCacheConfigured()) return;
  try {
    const cached: CachedRecipe = {
      ...payload,
      _cachedAt: Date.now(),
    };
    await put(pathFor(key), JSON.stringify(cached), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60, // 1 min — we manage TTL ourselves
    });
  } catch (e) {
    console.warn('recipe cache write failed:', (e as Error).message);
  }
}