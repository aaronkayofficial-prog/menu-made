// MENU MADE — R2 image cache.
//
// Uses Cloudflare R2 (S3-compatible) for permanent dish-image storage.
// aws4fetch is a 3KB library that signs fetch requests with AWS Sig V4.
// Zero egress fees on R2 means cached images are essentially free to serve.

import { AwsClient } from 'aws4fetch';
import { createHash } from 'crypto';

let _aws: AwsClient | null = null;

function aws(): AwsClient {
  if (_aws) return _aws;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set');
  }
  _aws = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto',
  });
  return _aws;
}

function endpoint(): string {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) throw new Error('R2_ACCOUNT_ID is not set');
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function bucket(): string {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error('R2_BUCKET is not set');
  return b;
}

function publicBase(): string {
  const u = process.env.R2_PUBLIC_URL;
  if (!u) throw new Error('R2_PUBLIC_URL is not set (must be the public-access URL of the R2 bucket)');
  return u.replace(/\/+$/, '');
}

export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
  );
}

/** Stable cache key for a dish: sha256(restaurantSlug + normalized dish name). */
export function dishCacheKey(restaurantSlug: string, dishName: string): string {
  const normalised = dishName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const seed = `${restaurantSlug.toLowerCase()}::${normalised}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

function objectKey(cacheKey: string, ext: string): string {
  return `dishes/${cacheKey}.${ext}`;
}

/**
 * Returns the public URL of a cached image if it exists, or null.
 * Uses a HEAD request — cheap and doesn't transfer the body.
 */
export async function getCachedImageUrl(cacheKey: string): Promise<string | null> {
  if (!isR2Configured()) return null;
  // Try common extensions
  for (const ext of ['jpg', 'png', 'webp']) {
    const key = objectKey(cacheKey, ext);
    const url = `${endpoint()}/${bucket()}/${key}`;
    try {
      const r = await aws().fetch(url, { method: 'HEAD' });
      if (r.ok) {
        return `${publicBase()}/${key}`;
      }
    } catch {
      // try next extension
    }
  }
  return null;
}

/**
 * Save an image to R2 and return its public URL.
 * Metadata is stored as x-amz-meta-* headers for audit/debug.
 */
export async function saveImage(
  cacheKey: string,
  buffer: Buffer,
  mimeType: string,
  metadata: Record<string, string> = {}
): Promise<string> {
  if (!isR2Configured()) {
    throw new Error('R2 not configured — cannot save image');
  }
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const key = objectKey(cacheKey, ext);

  const headers: Record<string, string> = {
    'Content-Type': mimeType,
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
  for (const [k, v] of Object.entries(metadata)) {
    if (v) headers[`x-amz-meta-${k}`] = String(v).slice(0, 256);
  }

  const url = `${endpoint()}/${bucket()}/${key}`;
  // aws4fetch wants a Uint8Array body for binary uploads
  const r = await aws().fetch(url, {
    method: 'PUT',
    body: new Uint8Array(buffer),
    headers,
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`R2 PUT failed (${r.status}): ${errText.slice(0, 500)}`);
  }
  return `${publicBase()}/${key}`;
}
