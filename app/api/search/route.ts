import { NextRequest, NextResponse } from 'next/server';
import { exaSearch } from '@/lib/exa';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Country / city tokens we extract from snippets so the UI can show them
const KNOWN_LOCATIONS = [
  'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'auckland', 'hobart', 'darwin', 'canberra', 'gold coast',
  'london', 'manchester', 'edinburgh', 'glasgow', 'bristol', 'liverpool',
  'paris', 'lyon', 'marseille',
  'rome', 'milan', 'florence', 'venice', 'bologna',
  'barcelona', 'madrid', 'seville',
  'berlin', 'munich', 'hamburg',
  'amsterdam', 'rotterdam',
  'tokyo', 'osaka', 'kyoto', 'fukuoka',
  'hong kong', 'singapore', 'bangkok', 'kuala lumpur', 'jakarta', 'manila',
  'mumbai', 'delhi', 'bengaluru', 'kolkata',
  'new york', 'nyc', 'manhattan', 'brooklyn', 'queens', 'bronx',
  'los angeles', 'la', 'beverly hills', 'santa monica',
  'chicago', 'san francisco', 'sf', 'oakland', 'berkeley',
  'miami', 'boston', 'seattle', 'portland', 'austin', 'dallas', 'houston', 'denver',
  'philadelphia', 'washington dc', 'atlanta', 'las vegas',
  'mexico city', 'cdmx', 'guadalajara', 'monterrey',
  'toronto', 'vancouver', 'montreal',
  'dubai', 'abu dhabi', 'doha',
  'cape town', 'johannesburg',
  'sao paulo', 'rio de janeiro', 'buenos aires', 'lima', 'santiago',
  'harvey, la', 'marietta, ga', 'bend, or',
];

function detectLocation(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const loc of KNOWN_LOCATIONS) {
    // word boundary match so "la" doesn't match in "lamb"
    const re = new RegExp(`\\b${loc.replace('.', '\\.')}\\b`, 'i');
    if (re.test(lower)) {
      // Title case the matched location
      return loc
        .split(' ')
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ');
    }
  }
  return null;
}

function extractAddressHint(text: string): string | null {
  if (!text) return null;
  // Look for street address patterns like "123 Main St" or "Bligh St, Sydney"
  const streetRe = /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Pkwy|Parkway|Wharf|Place|Pl|Lane|Ln|Drive|Dr)\.?\b/;
  const m = text.match(streetRe);
  return m ? m[0] : null;
}

function cleanTitle(title: string | undefined, query: string): string {
  if (!title) return query;
  return title
    .replace(/\s*[-|·]\s*Menu\b.*$/i, '')
    .replace(/^Menu\s*[-|·]\s*/i, '')
    .replace(/\s*\|\s*Order Online.*$/i, '')
    .replace(/\bRestaurant\b\s*$/i, '')
    .trim();
}

// POST /api/search { query: "Spice Temple Sydney" }
// Returns: { results: [{ name, url, snippet, location, hostname }] }
export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const enrichedQuery = `${query} restaurant menu`;
    const results = await exaSearch(enrichedQuery, 10);

    // Score and pick the best candidates
    const ranked = results
      .map((r) => {
        const url = r.url.toLowerCase();
        const host = (() => {
          try {
            return new URL(r.url).hostname.replace(/^www\./, '');
          } catch {
            return '';
          }
        })();
        let score = 0;

        // Strong: official menu pages
        if (/\/menus?\b/i.test(url)) score += 0.5;
        if (/\.pdf$/i.test(url)) score += 0.45;
        if (/\/(dinner|lunch|breakfast|brunch)-?menu/i.test(url)) score += 0.4;

        // Restaurant has its own domain (not a third-party platform)
        if (
          !/ubereats|doordash|deliveroo|grubhub|seamless|opentable|resy|sevenrooms|tock|tripadvisor|yelp|zomato|thefork|google\.com/i.test(
            url
          )
        ) {
          score += 0.2;
        }

        // Penalise delivery + reservation + listicle
        if (/ubereats|doordash|deliveroo|grubhub|seamless/i.test(url)) score -= 0.2;
        if (/opentable|resy|sevenrooms|tock/i.test(url)) score -= 0.05;
        if (/timeout|eater|infatuation|tripadvisor|yelp/i.test(url)) score -= 0.15;

        // Boost when query tokens appear in URL/title (helps location disambiguation)
        const queryTokens = query
          .toLowerCase()
          .split(/[\s,]+/)
          .filter((t) => t.length >= 3);
        for (const token of queryTokens) {
          if (host.includes(token)) score += 0.1;
          if ((r.title || '').toLowerCase().includes(token)) score += 0.05;
          if ((r.summary || '').toLowerCase().includes(token)) score += 0.03;
        }

        // Detect location for the UI
        const text = `${r.title || ''} ${r.summary || ''} ${r.text || ''}`;
        const location = detectLocation(text);
        const address = extractAddressHint(text);

        return {
          ...r,
          _score: score,
          _hostname: host,
          _location: location,
          _address: address,
        };
      })
      .sort((a, b) => b._score - a._score);

    const top = ranked.slice(0, 8).map((r) => ({
      name: cleanTitle(r.title, query),
      url: r.url,
      hostname: r._hostname,
      location: r._location,
      address: r._address,
      snippet: r.summary?.slice(0, 200),
      score: r._score,
    }));

    return NextResponse.json({ query, results: top });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
