import { NextRequest, NextResponse } from 'next/server';
import { exaSearch } from '@/lib/exa';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/search { query: "Spice Temple Sydney" }
// Returns: { results: [{ name, url, snippet }] }
export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }
    // Bias the search toward menu pages
    const enrichedQuery = `${query} restaurant menu`;
    const results = await exaSearch(enrichedQuery, 5);

    // Score and pick the best candidate
    const ranked = results
      .map((r) => {
        const url = r.url.toLowerCase();
        let score = 0;
        // Strong: official menu pages
        if (/\/menu\b/i.test(url)) score += 0.5;
        if (/\/menus?\b/i.test(url)) score += 0.4;
        if (/\.pdf$/i.test(url)) score += 0.45;
        // Penalise delivery platforms (we'll fall back to them only if needed)
        if (/ubereats|doordash|deliveroo|grubhub|seamless/i.test(url)) score -= 0.3;
        // Penalise reservation platforms (lower-confidence)
        if (/opentable|resy|sevenrooms|tock/i.test(url)) score -= 0.1;
        // Penalise listicles
        if (/timeout|eater|infatuation|tripadvisor|yelp/i.test(url)) score -= 0.2;
        return { ...r, _score: score };
      })
      .sort((a, b) => b._score - a._score);

    const top = ranked.slice(0, 3).map((r) => ({
      name: r.title?.replace(/\s*[-|·]\s*Menu.*$/i, '').trim() ?? query,
      url: r.url,
      snippet: r.summary?.slice(0, 240),
      score: r._score,
    }));

    return NextResponse.json({ query, results: top });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
