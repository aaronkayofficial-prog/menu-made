// MENU MADE — Gemini Flash Image client.
//
// Uses the Google AI Studio REST API directly to keep dependencies slim.
// Default model is gemini-2.5-flash-image ("Nano Banana 2") — Pro-level
// quality at Flash pricing (~$0.03 per image as of early 2026).
//
// Supports text-to-image and image-to-image (when seedImageUrl is provided).

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY is not set');
  return k;
}

interface GeminiImagePart {
  inlineData?: { mimeType: string; data: string };
  text?: string;
}

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 MENU-MADE-image-fetcher/1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Seed image fetch failed: ${r.status}`);
  const buf = await r.arrayBuffer();
  // Cap input size to avoid huge requests
  if (buf.byteLength > 5_000_000) {
    throw new Error('Seed image too large');
  }
  const data = Buffer.from(buf).toString('base64');
  let mimeType = r.headers.get('content-type') || 'image/jpeg';
  // Some servers send wrong content-type; normalise common cases
  if (!/^image\//.test(mimeType)) mimeType = 'image/jpeg';
  // Strip parameters (charset etc.)
  mimeType = mimeType.split(';')[0].trim();
  return { data, mimeType };
}

/**
 * Generate a dish image. Returns the image as a Buffer (raw bytes).
 * If seedImageUrl is provided, uses image-to-image for visual accuracy.
 */
export async function generateDishImage(opts: {
  prompt: string;
  seedImageUrl?: string;
  model?: string;
}): Promise<{ buffer: Buffer; mimeType: string; usedSeed: boolean }> {
  const model = opts.model ?? 'gemini-2.5-flash-image';

  const parts: GeminiImagePart[] = [];
  let usedSeed = false;
  if (opts.seedImageUrl) {
    try {
      const seed = await fetchAsBase64(opts.seedImageUrl);
      parts.push({ inlineData: { mimeType: seed.mimeType, data: seed.data } });
      usedSeed = true;
    } catch (e) {
      // Non-fatal — fall back to text-only
      console.warn('seed image fetch failed, going text-only:', (e as Error).message);
    }
  }
  parts.push({ text: opts.prompt });

  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey()}`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      temperature: 0.4,
    },
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Gemini image gen failed (${r.status}): ${errText.slice(0, 500)}`);
  }

  const data = await r.json();
  const candidates = data.candidates ?? [];
  for (const candidate of candidates) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        const buffer = Buffer.from(part.inlineData.data, 'base64');
        const mimeType = part.inlineData.mimeType || 'image/png';
        return { buffer, mimeType, usedSeed };
      }
    }
  }

  throw new Error('Gemini returned no image data');
}
