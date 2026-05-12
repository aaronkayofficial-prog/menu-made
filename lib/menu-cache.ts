// MENU MADE — extracted-menu cache.
//
// Caches the result of /api/extract per restaurant URL for 30 days.
// First user to view a restaurant pays the 8-25 second extraction cost;
// every visitor after gets the menu in <1 second from Vercel Blob.
//
// Storage: same Vercel Blob store as dish images (path: menus/{key}.json).
// Cache key: sha256(restaurant URL).

import { put, list } from '@vercel/blob';
import { createHash } from 'crypto';
import type { ExtractedMenu } from './schema';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CachedMenu {
  menu: ExtractedMenu;
  total_dishes: number;
  extraction_method: 'text' | 'vision' | 'mixed' | 'none';
  sources_used: number;
  own_sources: number;
  third_party_sources: number;
  original_blocked: boolean;
  prompt_version: string;
  _cachedAt: number;
}

export function isMenuCacheConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export function menuCacheKey(restaurantUrl: string): string {
  // Normalise URL: drop hash, lowercase host, strip trailing slash, drop common tracking
  let normalised = restaurantUrl.trim().toLowerCase();
  try {
    const u = new URL(normalised);
    normalised = `${u.protocol}//${u.hostname}${u.pathname}`.replace(/\/$/, '');
  } catch {
    // fallback to raw
  }
  return createHash('sha256').update(normalised).digest('hex').slice(0, 32);
}

function pathFor(key: string): string {
  return `menus/${key}.json`;
}

/**
 * Look up cached menu. Returns null if missing or expired.
 */
export async function getCachedMenu(key: string): Promise<CachedMenu | null> {
  if (!isMenuCacheConfigured()) return null;
  try {
    const { blobs } = await list({ prefix: pathFor(key) });
    if (blobs.length === 0) return null;

    // Most-recent if multiple
    const sorted = blobs.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

    const r = await fetch(sorted[0].url, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as CachedMenu;

    // Expiry check
    const age = Date.now() - (data._cachedAt ?? 0);
    if (age > TTL_MS) return null;

    return data;
  } catch (e) {
    console.warn('menu cache lookup failed:', (e as Error).message);
    return null;
  }
}

/**
 * Save extracted menu (with metadata) to cache.
 */
export async function saveMenu(
  key: string,
  payload: Omit<CachedMenu, '_cachedAt'>
): Promise<void> {
  if (!isMenuCacheConfigured()) return;
  try {
    const cached: CachedMenu = {
      ...payload,
      _cachedAt: Date.now(),
    };
    await put(pathFor(key), JSON.stringify(cached), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60, // we manage TTL ourselves
    });
  } catch (e) {
    console.warn('menu cache write failed:', (e as Error).message);
  }
}
