'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface SearchResult {
  name: string;
  url: string;
  hostname?: string;
  location?: string | null;
  address?: string | null;
  image?: string | null;
  favicon?: string | null;
}

function gradientFor(seed: string): string {
  const palettes = [
    'linear-gradient(140deg, #3a1a14 0%, #7c241c 38%, #c44536 70%, #e89a4d 100%)',
    'linear-gradient(140deg, #1c2a24 0%, #3d5343 40%, #728e72 70%, #c2cfae 100%)',
    'linear-gradient(140deg, #3b1f0e 0%, #7c3b0f 35%, #c97a2b 65%, #f0c878 100%)',
    'linear-gradient(140deg, #1a2638 0%, #2d4458 38%, #618699 70%, #bcc8c8 100%)',
    'linear-gradient(140deg, #2a1635 0%, #4d2a5a 38%, #8a5e9e 70%, #d6c2e3 100%)',
    'linear-gradient(140deg, #3a2818 0%, #6b4830 38%, #a87a55 70%, #e8c896 100%)',
    'linear-gradient(140deg, #1f2a1c 0%, #3d5232 38%, #6b8a52 70%, #b8c89c 100%)',
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [searchedName, setSearchedName] = useState('');
  const [searchedCity, setSearchedCity] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState<Set<string>>(new Set());

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setImgFailed(new Set());
    setSearchedName(name.trim());
    setSearchedCity(city.trim());
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

  function markImgFailed(key: string) {
    setImgFailed((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

  const primary = results && results.length > 0 ? results[0] : null;
  const alternates = results && results.length > 1 ? results.slice(1) : [];

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

        {error && (
          <div className="error-box" style={{ marginTop: 32 }}>
            <h3>Search failed</h3>
            <p>{error}</p>
          </div>
        )}
      </section>

      {primary && (
        <section className="wrap" style={{ paddingBottom: alternates.length > 0 ? 24 : 80 }}>
          <div className="primary-header">
            <span className="eyebrow">Top match for your search</span>
            <h2>
              {searchedName}
              {searchedCity && (
                <>
                  {' '}<span className="primary-city">in {searchedCity}</span>
                </>
              )}
            </h2>
          </div>

          {(() => {
            const key = `primary-${primary.url}`;
            const showImage = primary.image && !imgFailed.has(key);
            return (
              <button
                className="primary-card"
                onClick={() => selectRestaurant(primary)}
                type="button"
              >
                <div className="primary-card-img">
                  {showImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={primary.image as string}
                      alt={primary.name}
                      loading="lazy"
                      onError={() => markImgFailed(key)}
                    />
                  ) : (
                    <div
                      className="primary-card-fallback"
                      style={{
                        background: gradientFor(primary.name + (primary.location || '')),
                      }}
                    >
                      <span className="primary-card-letter">
                        {(primary.name[0] || '?').toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
                <div className="primary-card-body">
                  {primary.location && (
                    <span className="primary-locale-pill">{primary.location}</span>
                  )}
                  <h3 className="primary-card-name">{primary.name}</h3>
                  <p className="primary-card-address">
                    {primary.address || primary.location || primary.hostname || ''}
                  </p>
                  <div className="primary-cta">
                    <span>Tap to load the menu</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                  </div>
                </div>
              </button>
            );
          })()}
        </section>
      )}

      {alternates.length > 0 && (
        <section className="wrap" style={{ paddingBottom: 80 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 22,
              marginTop: 24,
              flexWrap: 'wrap',
            }}
          >
            <span className="eyebrow">Other matches</span>
            <span style={{ fontSize: 13, color: '#8E8170' }}>
              In case the top match isn&apos;t the one you meant
            </span>
          </div>

          <div className="rest-grid">
            {alternates.map((r, i) => {
              const key = `alt-${r.url}-${i}`;
              const showImage = r.image && !imgFailed.has(key);
              return (
                <button
                  key={key}
                  className="rest-card"
                  onClick={() => selectRestaurant(r)}
                  type="button"
                >
                  <div className="rest-card-img">
                    {showImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.image as string}
                        alt={r.name}
                        loading="lazy"
                        onError={() => markImgFailed(key)}
                      />
                    ) : (
                      <div
                        className="rest-card-fallback"
                        style={{ background: gradientFor(r.name + (r.location || '')) }}
                      >
                        <span className="rest-card-letter">
                          {(r.name[0] || '?').toUpperCase()}
                        </span>
                      </div>
                    )}
                    {r.location && <span className="rest-card-locale">{r.location}</span>}
                  </div>
                  <div className="rest-card-body">
                    <h3 className="rest-card-name">{r.name}</h3>
                    <p className="rest-card-address">
                      {r.address || r.location || r.hostname || 'Tap to open menu'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {results && results.length === 0 && (
        <section className="wrap">
          <div className="error-box" style={{ marginTop: 32 }}>
            <h3>No results found</h3>
            <p>
              Try a different city, or check the spelling. If the restaurant is small or new, its
              menu may not be indexed yet.
            </p>
          </div>
        </section>
      )}

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

        /* Primary (hero) card */
        .primary-header {
          margin-bottom: 24px;
        }
        .primary-header h2 {
          font-family: 'Fraunces', serif;
          font-size: clamp(34px, 5vw, 56px);
          font-weight: 400;
          letter-spacing: -0.02em;
          line-height: 1.05;
          color: #1f1b17;
          margin: 8px 0 0;
        }
        .primary-city {
          font-style: italic;
          color: #8b2a2a;
          font-weight: 300;
        }
        .primary-card {
          background: #ffffff;
          border: 1px solid #e8dfd3;
          border-radius: 22px;
          overflow: hidden;
          cursor: pointer;
          padding: 0;
          text-align: left;
          font-family: inherit;
          color: inherit;
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
          width: 100%;
          transition: all 0.25s ease;
        }
        @media (max-width: 780px) {
          .primary-card {
            grid-template-columns: 1fr;
          }
        }
        .primary-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 22px 60px -22px rgba(31, 27, 23, 0.22);
          border-color: #c9b89f;
        }
        .primary-card-img {
          aspect-ratio: 16 / 11;
          position: relative;
          overflow: hidden;
          background: #f4ede0;
        }
        @media (max-width: 780px) {
          .primary-card-img {
            aspect-ratio: 16 / 9;
          }
        }
        .primary-card-img :global(img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .primary-card-fallback {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .primary-card-letter {
          font-family: 'Fraunces', serif;
          font-weight: 300;
          font-size: 140px;
          color: rgba(255, 255, 255, 0.85);
          font-style: italic;
        }
        .primary-card-body {
          padding: 36px 38px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 14px;
        }
        @media (max-width: 780px) {
          .primary-card-body {
            padding: 28px 28px 32px;
          }
        }
        .primary-locale-pill {
          align-self: flex-start;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #8b2a2a;
          background: #fbe7e2;
          padding: 6px 13px;
          border-radius: 999px;
          font-weight: 600;
        }
        .primary-card-name {
          font-family: 'Fraunces', serif;
          font-size: clamp(28px, 3vw, 38px);
          font-weight: 500;
          color: #1f1b17;
          margin: 0;
          line-height: 1.15;
          letter-spacing: -0.01em;
        }
        .primary-card-address {
          font-size: 15px;
          color: #6b5f52;
          line-height: 1.5;
          margin: 0;
        }
        .primary-cta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 6px;
          font-size: 13px;
          font-weight: 500;
          color: #1f1b17;
          letter-spacing: 0.02em;
        }
        .primary-card:hover .primary-cta {
          color: #8b2a2a;
        }

        /* Alternate grid */
        .rest-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 22px;
        }
        @media (max-width: 980px) {
          .rest-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 600px) {
          .rest-grid {
            grid-template-columns: 1fr;
          }
        }
        .rest-card {
          background: #ffffff;
          border: 1px solid #e8dfd3;
          border-radius: 18px;
          overflow: hidden;
          cursor: pointer;
          padding: 0;
          text-align: left;
          font-family: inherit;
          color: inherit;
          transition: all 0.25s ease;
          display: flex;
          flex-direction: column;
        }
        .rest-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 14px 40px -20px rgba(31, 27, 23, 0.18);
          border-color: #c9b89f;
        }
        .rest-card-img {
          aspect-ratio: 4 / 3;
          position: relative;
          overflow: hidden;
          background: #f4ede0;
        }
        .rest-card-img :global(img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .rest-card-fallback {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .rest-card-letter {
          font-family: 'Fraunces', serif;
          font-weight: 300;
          font-size: 84px;
          color: rgba(255, 255, 255, 0.85);
          font-style: italic;
        }
        .rest-card-locale {
          position: absolute;
          left: 14px;
          bottom: 12px;
          color: #fbf8f3;
          z-index: 2;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          font-weight: 600;
          background: rgba(31, 27, 23, 0.65);
          backdrop-filter: blur(6px);
          padding: 5px 11px;
          border-radius: 999px;
        }
        .rest-card-img::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, transparent 50%, rgba(31, 27, 23, 0.35));
          pointer-events: none;
        }
        .rest-card-body {
          padding: 18px 20px 22px;
        }
        .rest-card-name {
          font-family: 'Fraunces', serif;
          font-size: 20px;
          font-weight: 500;
          color: #1f1b17;
          margin: 0 0 6px;
          line-height: 1.2;
          letter-spacing: -0.005em;
        }
        .rest-card-address {
          font-size: 13px;
          color: #6b5f52;
          line-height: 1.45;
          margin: 0;
        }
      `}</style>
    </>
  );
}
