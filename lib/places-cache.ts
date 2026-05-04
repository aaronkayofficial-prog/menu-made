// MENU MADE — Two-tier cache for Google Places data.
//
// Tier A (90 days): full place details — rating, address, website, etc.
// Tier B (7 days):  business_status only — refreshed lazily on access.
//
// Why two tiers? Restaurants close. A 90-day cache for status would risk
// showing closed venues. By doing a tiny status-refresh call every 7 days,
// we keep "is this restaurant still open?" fresh without re-fetching
// rating/address/etc that barely changes.
//
// At 5,000 DAU this saves ~3× over a 30-day flat cache, and the closure
// detection is automatic.
//
// Storage: Vercel Blob (same store as dish images). Cache JSONs are
// world-readable (predictable URL with sha256 key) but contain only
// publicly-listed restaurant metadata, no PII.

import { put, list } from '@vercel/blob';
import { createHash } from 'crypto';
import type { PlaceDetails } from './google-places';

const TIER_A_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const TIER_B_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

export interface CachedPlace extends PlaceDetails {
  _cachedAt: number;        // ms timestamp of full Place Details fetch
  _statusCheckedAt: number; // ms timestamp of last business_status refresh
}

export function isPlacesCacheConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Stable cache key for a place. SHA-256 of normalised name + city. */
export function placeCacheKey(name: string, city?: string): string {
  const seed = `${name.trim().toLowerCase()}::${(city ?? '').trim().toLowerCase()}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

function pathFor(key: string): string {
  return `places/${key}.json`;
}

/**
 * Look up cached Place Details. Returns null if missing or Tier-A expired.
 * Caller is responsible for calling refreshStatus() if isStatusStale() is true.
 */
export async function getCachedPlace(key: string): Promise<CachedPlace | null> {
  if (!isPlacesCacheConfigured()) return null;
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
    const data = (await r.json()) as CachedPlace;

    // Tier-A expiry check
    const age = Date.now() - (data._cachedAt ?? 0);
    if (age > TIER_A_TTL_MS) return null;

    return data;
  } catch (e) {
    console.warn('places cache lookup failed:', (e as Error).message);
    return null;
  }
}

/** True if the business_status hasn't been refreshed in the last 7 days. */
export function isStatusStale(cached: CachedPlace): boolean {
  const age = Date.now() - (cached._statusCheckedAt ?? 0);
  return age > TIER_B_TTL_MS;
}

/** Save a fresh Place Details fetch to cache. */
export async function savePlace(
  key: string,
  place: PlaceDetails
): Promise<CachedPlace> {
  const cached: CachedPlace = {
    ...place,
    _cachedAt: Date.now(),
    _statusCheckedAt: Date.now(),
  };
  await writeCache(key, cached);
  return cached;
}

/**
 * Update only the business_status + statusCheckedAt fields, leaving the
 * rest of the cache (rating, address, etc.) untouched.
 */
export async function refreshStatus(
  key: string,
  cached: CachedPlace,
  newStatus: string | null
): Promise<CachedPlace> {
  const updated: CachedPlace = {
    ...cached,
    businessStatus: newStatus,
    _statusCheckedAt: Date.now(),
  };
  await writeCache(key, updated);
  return updated;
}

async function writeCache(key: string, value: CachedPlace): Promise<void> {
  if (!isPlacesCacheConfigured()) return;
  try {
    await put(pathFor(key), JSON.stringify(value), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60, // 1 min — we manage TTL ourselves
    });
  } catch (e) {
    console.warn('places cache write failed:', (e as Error).message);
  }
}
