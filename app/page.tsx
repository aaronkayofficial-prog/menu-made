'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface SearchResult {
  name: string;
  url: string;
  hostname?: string;
  location?: string | null;
  address?: string | null;
  snippet?: string;
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const r = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          city: city.trim() || undefined,
        }),
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

  function tryExample(n: string, c: string) {
    setName(n);
    setCity(c);
  }

  return (
    <>
      <section className="hero wrap">
        <div className="eyebrow" style={{ marginBottom: 18, display: 'inline-block' }}>
          Search any restaurant in the world
        </div>
        <h1>
          Cook the world's restaurants <em>at home.</em>
        </h1>
        <p className="lede">
          Type a restaurant name and city. We'll find their menu, then generate an{' '}
          <strong>original home-cookable recreation</strong> of any dish — sized to your guests,
          tailored to your kitchen.
        </p>

        <form className="search-pair" onSubmit={handleSearch}>
          <div className="search-fields">
            <div className="field">
              <label htmlFor="name-input">Restaurant name</label>
              <input
                id="name-input"
                type="text"
                placeholder="e.g. China Doll"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="city-input">City</label>
              <input
                id="city-input"
                type="text"
                placeholder="e.g. Sydney"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
          <button
            type="submit"
            className="search-btn-large"
            disabled={loading || !name.trim()}
          >
            {loading ? 'Searching…' : 'Find the menu'}
          </button>
        </form>

        <div className="search-suggest">
          <span style={{ marginRight: 4 }}>Try:</span>
          {[
            { name: 'Spice Temple', city: 'Sydney' },
            { name: 'Catch', city: 'New York' },
            { name: 'Pujol', city: 'Mexico City' },
            { name: 'Cho Dang Gol', city: 'Katy TX' },
          ].map((q) => (
            <span
              key={`${q.name}-${q.city}`}
              className="suggest-chip"
              onClick={() => tryExample(q.name, q.city)}
            >
              {q.name} · {q.city}
            </span>
          ))}
        </div>

        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: '#8E8170',
            maxWidth: 620,
            marginLeft: 'auto',
            marginRight: 'auto',
            lineHeight: 1.5,
          }}
        >
          The city helps us pick the right restaurant when several share the name (e.g. there are six
          "China Doll"s worldwide).
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
              {results.length} match{results.length === 1 ? '' : 'es'} — pick the right one
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
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <h4 style={{ margin: 0 }}>{r.name}</h4>
                  {r.location && (
                    <span
                      style={{
                        fontSize: 11,
                        letterSpacing: '.08em',
                        textTransform: 'uppercase',
                        color: '#8B2A2A',
                        background: '#FBE7E2',
                        padding: '3px 9px',
                        borderRadius: 999,
                        fontWeight: 600,
                      }}
                    >
                      {r.location}
                    </span>
                  )}
                </div>
                {r.address && (
                  <p style={{ marginTop: 4, fontSize: 13, color: '#3A332B', fontStyle: 'italic' }}>
                    {r.address}
                  </p>
                )}
                {r.snippet && <p style={{ marginTop: 6 }}>{r.snippet}</p>}
                <div className="url" style={{ marginTop: 8 }}>
                  {r.hostname || r.url}
                </div>
              </a>
            ))}
          </div>
        )}

        {results && results.length === 0 && (
          <div className="error-box" style={{ marginTop: 32 }}>
            <h3>No results found</h3>
            <p>
              Try a more specific city, or check the spelling. If the restaurant is small or new,
              its menu may not be indexed by web search yet.
            </p>
          </div>
        )}
      </section>

      <style jsx>{`
        .search-pair {
          max-width: 720px;
          margin: 0 auto 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .search-fields {
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 14px;
        }
        @media (max-width: 540px) {
          .search-fields {
            grid-template-columns: 1fr;
          }
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 7px;
          text-align: left;
        }
        .field label {
          font-size: 12px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #6b5f52;
          font-weight: 500;
          padding-left: 6px;
        }
        .field input {
          width: 100%;
          padding: 18px 22px;
          border-radius: 14px;
          border: 1px solid #d5c8b3;
          background: #ffffff;
          font-size: 17px;
          color: #1f1b17;
          transition: border-color 0.18s ease, box-shadow 0.18s ease;
        }
        .field input:focus {
          outline: none;
          border-color: #1f1b17;
          box-shadow: 0 0 0 4px rgba(31, 27, 23, 0.08);
        }
        .field input::placeholder {
          color: #a89b89;
        }
        .search-btn-large {
          background: #1f1b17;
          color: #fbf8f3;
          padding: 18px 28px;
          border-radius: 14px;
          border: none;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .search-btn-large:hover {
          background: #8b2a2a;
        }
        .search-btn-large:disabled {
          background: #c9b89f;
          cursor: not-allowed;
        }
      `}</style>
    </>
  );
}
