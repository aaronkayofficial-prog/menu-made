// Lightweight Exa client — we only need search + contents.
// Avoids the full SDK for slimmer cold-starts on Vercel.

const BASE = 'https://api.exa.ai';

function key() {
  const k = process.env.EXA_API_KEY;
  if (!k) throw new Error('EXA_API_KEY is not set');
  return k;
}

export interface ExaSearchResult {
  id: string;
  url: string;
  title?: string;
  text?: string;
  summary?: string;
  highlights?: string[];
}

export async function exaSearch(query: string, numResults = 5): Promise<ExaSearchResult[]> {
  const r = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key() },
    body: JSON.stringify({
      query,
      numResults,
      type: 'auto',
      contents: { summary: true, highlights: { numSentences: 3 } },
    }),
  });
  if (!r.ok) throw new Error(`Exa search failed (${r.status}): ${await r.text()}`);
  const data = await r.json();
  return (data.results ?? []) as ExaSearchResult[];
}

export async function exaContents(urls: string[], livecrawl: 'always' | 'fallback' | 'never' = 'fallback'): Promise<ExaSearchResult[]> {
  const r = await fetch(`${BASE}/contents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key() },
    body: JSON.stringify({
      urls,
      text: { maxCharacters: 25000 },
      livecrawl,
    }),
  });
  if (!r.ok) throw new Error(`Exa contents failed (${r.status}): ${await r.text()}`);
  const data = await r.json();
  return (data.results ?? []) as ExaSearchResult[];
}
