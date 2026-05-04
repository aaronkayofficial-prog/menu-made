// MENU MADE — Vercel Blob image cache.
//
// Uses @vercel/blob, which is auto-configured when you add a Blob store to
// your Vercel project (Storage → Create → Blob). The BLOB_READ_WRITE_TOKEN
// env var is added automatically; nothing to copy by hand.
// Note: the Blob store must be configured as Public for direct image URLs.
//
// Flow: dishCacheKey() produces a stable hash → getCachedImageUrl() looks for
// an existing blob → if missing, saveImage() uploads. The first request for
// each unique dish pays the generation cost; every request after is free.

import { put, list } from '@vercel/blob';
import { createHash } from 'crypto';

export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Stable cache key for a dish: short sha256 of restaurant + normalised dish name. */
export function dishCacheKey(restaurantSlug: string, dishName: string): string {
  const normalised = dishName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const seed = `${restaurantSlug.toLowerCase()}::${normalised}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

/**
 * Returns the public URL of a cached image if it exists, or null.
 * Uses list() with a prefix so we don't have to know which extension the
 * stored blob uses (.jpg / .png / .webp).
 */
export async function getCachedImageUrl(cacheKey: string): Promise<string | null> {
  if (!isBlobConfigured()) return null;
  try {
    const { blobs } = await list({ prefix: `dishes/${cacheKey}.` });
    if (blobs.length > 0) {
      // Prefer the most recent if multiple
      const sorted = blobs.sort(
        (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
      return sorted[0].url;
    }
  } catch (e) {
    console.warn('blob cache lookup failed:', (e as Error).message);
  }
  return null;
}

/**
 * Save an image to Vercel Blob and return its public URL.
 * Uses a stable path so subsequent calls find the same key.
 */
export async function saveImage(
  cacheKey: string,
  buffer: Buffer,
  mimeType: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _metadata: Record<string, string> = {}
): Promise<string> {
  if (!isBlobConfigured()) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set');
  }
  const ext = mimeType.includes('png')
    ? 'png'
    : mimeType.includes('webp')
      ? 'webp'
      : 'jpg';
  const path = `dishes/${cacheKey}.${ext}`;

  const blob = await put(path, new Uint8Array(buffer), {
    access: 'public',
    contentType: mimeType,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60 * 60 * 24 * 365, // 1 year client cache
  });
  return blob.url;
}
