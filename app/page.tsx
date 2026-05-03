'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface SearchResult {
  name: string;
  url: string;
  snippet?: string;
}

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const r = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? `Search failed (${r.status})`);
      }
      const data = await r.json();
      setResults(data.results ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function selectRestaurant(r: SearchResult) {
    const params = new URLSearchParams({ url: r.url, name: r.name });
    router.push(`/restaurant?${params.toString()}`);
  }

  return (
    <>
      <section className="hero wrap">
        <div className="eyebrow" style={{ marginBottom: 18, display: 'inline-block' }}>
          Search any restaurant in the world
        </div>
        <h1>
          Cook the world&apos;s restaurants <em>at home.</em>
        </h1>
        <p className="lede">
          Type a restaurant name and city. We&apos;ll find their menu, then generate an{' '}
          <strong>original home-cookable recreation</strong> of any dish — sized to your guests,
          tailored to your kitchen.
        </p>

        <form className="search" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="e.g. Spice Temple Sydney, or Catch NYC"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading}
            autoFocus
          />
          <button type="submit" className="search-btn" disabled={loading || !query.trim()}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        <div className="search-suggest">
          <span style={{ marginRight: 4 }}>Try:</span>
          {['Spice Temple Sydney', 'Catch NYC', 'Pujol Mexico City', 'Le Bernardin New York'].map((q) => (
            <span
              key={q}
              className="suggest-chip"
              onClick={() => {
                setQuery(q);
              }}
            >
              {q}
            </span>
          ))}
        </div>

        {error && (
          <div className="error-box" style={{ marginTop: 32 }}>
            <h3>Search failed</h3>
            <p>{error}</p>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="search-results">
            <div
              style={{
                padding: '12px 20px',
                fontSize: 12,
                color: '#8E8170',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                fontWeight: 500,
                background: '#F4EDE0',
                borderBottom: '1px solid #E8DFD3',
              }}
            >
              {results.length} match{results.length === 1 ? '' : 'es'} — click to load the menu
            </div>
            {results.map((r, i) => (
              <a
                key={i}
                className="search-result"
                onClick={(e) => {
                  e.preventDefault();
                  selectRestaurant(r);
                }}
                href="#"
              >
                <h4>{r.name}</h4>
                {r.snippet && <p>{r.snippet}</p>}
                <div className="url">{r.url}</div>
              </a>
            ))}
          </div>
        )}

        {results && results.length === 0 && (
          <div className="error-box" style={{ marginTop: 32 }}>
            <h3>No results found</h3>
            <p>Try refining the search — include the city, like &ldquo;Spice Temple Sydney&rdquo;.</p>
          </div>
        )}
      </section>
    </>
  );
}
