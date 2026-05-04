'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { ExtractedMenu, MenuItem, RestaurantOverview } from '@/lib/schema';

function gradientFor(seed: string): string {
  const palettes = [
    'linear-gradient(140deg, #3a1a14 0%, #7c241c 38%, #c44536 70%, #e89a4d 100%)',
    'linear-gradient(140deg, #1c2a24 0%, #3d5343 40%, #728e72 70%, #c2cfae 100%)',
    'linear-gradient(140deg, #3b1f0e 0%, #7c3b0f 35%, #c97a2b 65%, #f0c878 100%)',
    'linear-gradient(140deg, #1a2638 0%, #2d4458 38%, #618699 70%, #bcc8c8 100%)',
    'linear-gradient(140deg, #2a1635 0%, #4d2a5a 38%, #8a5e9e 70%, #d6c2e3 100%)',
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

function StarRow({ score }: { score: number }) {
  // Simple star rendering (5 stars, half-step)
  const full = Math.floor(score);
  const half = score - full >= 0.25 && score - full < 0.75;
  const empty = 5 - full - (half ? 1 : 0);
  const stars = [];
  for (let i = 0; i < full; i++) stars.push('★');
  if (half) stars.push('½');
  for (let i = 0; i < empty; i++) stars.push('☆');
  return <span style={{ letterSpacing: '0.06em' }}>{stars.join('')}</span>;
}

function RestaurantInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const url = sp.get('url') ?? '';
  const name = sp.get('name') ?? '';

  const [overview, setOverview] = useState<RestaurantOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [menu, setMenu] = useState<ExtractedMenu | null>(null);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState<number>(0);
  const [imgFailed, setImgFailed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!url) {
      setMenuError('No restaurant URL provided.');
      setMenuLoading(false);
      setOverviewLoading(false);
      return;
    }

    // Kick off overview + menu fetches in parallel
    fetch('/api/overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name }),
    })
      .then((r) => r.json())
      .then((data) => {
        setOverview(data.overview ?? null);
      })
      .catch(() => {
        // non-fatal — page still works without overview
      })
      .finally(() => setOverviewLoading(false));

    fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, restaurantName: name }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Extract failed (${r.status})`);
        }
        return r.json();
      })
      .then((data) => {
        setMenu(data.menu);
        setMenuLoading(false);
      })
      .catch((err) => {
        setMenuError((err as Error).message);
        setMenuLoading(false);
      });
  }, [url, name]);

  function pickDish(item: MenuItem) {
    if (!menu) return;
    const params = new URLSearchParams({
      url,
      name: menu.restaurant_name,
      city: menu.restaurant_city ?? overview?.city ?? '',
      cuisine: menu.cuisine ?? overview?.cuisine ?? '',
      dish_id: item.id,
      dish_name: item.name,
      dish_note: item.note,
    });
    router.push(`/recipe?${params.toString()}`);
  }

  function markImgFailed(key: string) {
    setImgFailed((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

  // ---- Overview section ----
  const images = overview?.images?.filter((i) => !imgFailed.has(i)) ?? [];
  const heroImage = images[activeImage] ?? images[0];
  const thumbs = images.slice(0, 6);

  return (
    <div className="wrap">
      <a className="back-link" onClick={() => router.push('/')}>
        ← Back to search
      </a>

      {/* OVERVIEW SECTION */}
      <div className="overview-card">
        <div className="overview-images">
          {heroImage ? (
            <>
              <div className="hero-img">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={heroImage}
                  alt={name}
                  onError={() => markImgFailed(heroImage)}
                />
              </div>
              {thumbs.length > 1 && (
                <div className="thumb-row">
                  {thumbs.map((img, i) => (
                    <button
                      key={i}
                      className={`thumb ${i === activeImage ? 'active' : ''}`}
                      onClick={() => setActiveImage(i)}
                      type="button"
                      aria-label={`Image ${i + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt="" onError={() => markImgFailed(img)} />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : overviewLoading ? (
            <div className="hero-img" style={{ background: '#F4EDE0' }}>
              <div className="loading-shimmer" />
            </div>
          ) : (
            <div
              className="hero-img"
              style={{ background: gradientFor(name + (overview?.city || '')) }}
            >
              <span className="hero-letter">{(name[0] || '?').toUpperCase()}</span>
            </div>
          )}
        </div>

        <div className="overview-body">
          <div className="overview-tags">
            {overview?.cuisine && <span className="ovr-tag">{overview.cuisine}</span>}
            {overview?.price_range && (
              <span className="ovr-tag price">{overview.price_range}</span>
            )}
            {overview?.city && <span className="ovr-tag city">{overview.city}</span>}
          </div>

          <h1 className="overview-name">{overview?.name || name}</h1>

          {overview?.address && (
            <p className="overview-address">{overview.address}</p>
          )}

          {overview?.rating && (
            <div className="overview-rating">
              <span className="stars">
                <StarRow score={overview.rating.score} />
              </span>
              <span className="score-num">{overview.rating.score.toFixed(1)}</span>
              <span className="rating-source">
                on {overview.rating.source}
                {overview.rating.count ? ` · ${overview.rating.count.toLocaleString()} reviews` : ''}
              </span>
            </div>
          )}

          {overviewLoading && !overview && (
            <p className="overview-description loading-text">Building the overview...</p>
          )}

          {overview?.description && (
            <p className="overview-description">{overview.description}</p>
          )}

          {overview?.highlights && overview.highlights.length > 0 && (
            <ul className="overview-highlights">
              {overview.highlights.slice(0, 5).map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}

          <div className="overview-meta">
            {overview?.chef && (
              <span>
                <strong>Chef:</strong> {overview.chef}
              </span>
            )}
            {overview?.phone && (
              <span>
                <strong>Phone:</strong> {overview.phone}
              </span>
            )}
            {(overview?.website || url) && (
              <a
                href={overview?.website || url}
                target="_blank"
                rel="noopener noreferrer"
                className="ovr-link"
              >
                Visit website ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {/* MENU SECTION */}
      <div className="menu-section-wrap">
        <div className="section-divider">
          <span className="eyebrow">The menu</span>
          <span style={{ fontSize: 13, color: '#8E8170' }}>
            Tap any dish to recreate it at home
          </span>
        </div>

        {menuLoading && (
          <div className="loading">
            <div className="spinner" />
            <div className="loading-text">Finding the menu for {name || 'this restaurant'}...</div>
            <div className="loading-sub">Live web fetch + AI extraction — usually 8–25 seconds.</div>
          </div>
        )}

        {menuError && (
          <div className="error-box">
            <h3>Could not extract the menu</h3>
            <p>{menuError}</p>
            <p style={{ marginTop: 14, fontSize: 13 }}>
              The menu may live on a third-party platform we did not try, or the site may be
              JavaScript-only.
            </p>
          </div>
        )}

        {menu && (
          <>
            <div className="menu-banner">
              <span className="pill pill-found">Menu found</span>
              <span className="pill pill-warn">Not affiliated</span>
              <div className="text" style={{ marginTop: 10 }}>
                <strong>Live-extracted menu.</strong> Items below are publicly listed on{' '}
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'underline' }}
                >
                  {(() => {
                    try {
                      return new URL(url).hostname;
                    } catch {
                      return url;
                    }
                  })()}
                </a>{' '}
                and paraphrased into our own words. Tags reflect publicly listed wording — actual
                heat, allergens, and contents may vary. Confirm directly with the restaurant. We are
                not affiliated with, sponsored by, or endorsed by{' '}
                {overview?.name || menu.restaurant_name}.
              </div>
            </div>

            {menu.sections?.map((section, i) => (
              <div className="menu-section" key={i}>
                <div className="menu-section-title">{section.name}</div>
                <div className="dish-list">
                  {section.items?.map((item, j) => (
                    <div className="dish-card" key={`${i}-${j}-${item.id}`}>
                      <div className="dish-name">{item.name}</div>
                      <div className="dish-note">{item.note}</div>
                      {item.spicy && (
                        <div className="dish-tags">
                          <span className="pill pill-spicy">Listed as spicy</span>
                        </div>
                      )}
                      <div className="dish-cta">
                        <span className="menu-tag">Menu item · publicly listed</span>
                        <button className="recreate-btn" onClick={() => pickDish(item)}>
                          Recreate this dish →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <style jsx>{`
        .overview-card {
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
          gap: 32px;
          background: #ffffff;
          border: 1px solid #e8dfd3;
          border-radius: 22px;
          overflow: hidden;
          margin: 24px 0 56px;
        }
        @media (max-width: 880px) {
          .overview-card {
            grid-template-columns: 1fr;
            gap: 0;
          }
        }
        .overview-images {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 14px;
        }
        @media (max-width: 880px) {
          .overview-images {
            padding: 0;
          }
        }
        .hero-img {
          aspect-ratio: 4 / 3;
          background: #f4ede0;
          border-radius: 14px;
          overflow: hidden;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        @media (max-width: 880px) {
          .hero-img {
            border-radius: 0;
            aspect-ratio: 16 / 10;
          }
        }
        .hero-img :global(img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .hero-letter {
          font-family: 'Fraunces', serif;
          font-weight: 300;
          font-style: italic;
          font-size: 140px;
          color: rgba(255, 255, 255, 0.85);
        }
        .loading-shimmer {
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, #f4ede0 0%, #faf5eb 50%, #f4ede0 100%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .thumb-row {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8px;
        }
        .thumb {
          aspect-ratio: 1 / 1;
          padding: 0;
          border: 2px solid transparent;
          border-radius: 8px;
          overflow: hidden;
          background: #f4ede0;
          cursor: pointer;
          transition: border-color 0.15s ease;
        }
        .thumb.active {
          border-color: #8b2a2a;
        }
        .thumb :global(img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .overview-body {
          padding: 36px 38px 36px 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        @media (max-width: 880px) {
          .overview-body {
            padding: 24px 28px 32px;
          }
        }
        .overview-tags {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .ovr-tag {
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #6b5f52;
          background: #f4ede0;
          padding: 5px 11px;
          border-radius: 999px;
          font-weight: 600;
        }
        .ovr-tag.price {
          color: #5c7a5c;
          background: #e5eae0;
        }
        .ovr-tag.city {
          color: #8b2a2a;
          background: #fbe7e2;
        }
        .overview-name {
          font-family: 'Fraunces', serif;
          font-size: clamp(34px, 4vw, 48px);
          font-weight: 500;
          line-height: 1.1;
          letter-spacing: -0.015em;
          margin: 4px 0 2px;
        }
        .overview-address {
          font-size: 14px;
          color: #6b5f52;
          margin: 0;
          line-height: 1.5;
        }
        .overview-rating {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 14px;
          color: #3a332b;
        }
        .overview-rating .stars {
          color: #d4a04d;
          font-size: 18px;
          line-height: 1;
        }
        .overview-rating .score-num {
          font-family: 'Fraunces', serif;
          font-weight: 600;
          font-size: 18px;
          color: #1f1b17;
        }
        .overview-rating .rating-source {
          font-size: 13px;
          color: #6b5f52;
        }
        .overview-description {
          font-size: 15px;
          color: #3a332b;
          line-height: 1.65;
          margin: 6px 0;
        }
        .loading-text {
          color: #8e8170;
          font-style: italic;
        }
        .overview-highlights {
          margin: 6px 0 4px;
          padding-left: 18px;
        }
        .overview-highlights li {
          font-size: 13.5px;
          color: #3a332b;
          line-height: 1.55;
          padding: 2px 0;
        }
        .overview-meta {
          display: flex;
          gap: 18px;
          flex-wrap: wrap;
          font-size: 13px;
          color: #6b5f52;
          margin-top: auto;
          padding-top: 8px;
        }
        .overview-meta strong {
          color: #1f1b17;
          font-weight: 600;
        }
        .ovr-link {
          color: #8b2a2a;
          font-weight: 500;
          text-decoration: none;
        }
        .ovr-link:hover {
          text-decoration: underline;
        }

        .section-divider {
          display: flex;
          align-items: center;
          gap: 14px;
          padding-bottom: 16px;
          border-bottom: 1px solid #e8dfd3;
          margin-bottom: 32px;
          flex-wrap: wrap;
        }
        .menu-section-wrap {
          padding-bottom: 60px;
        }
      `}</style>
    </div>
  );
}

export default function RestaurantPage() {
  return (
    <Suspense
      fallback={
        <div className="loading">
          <div className="spinner" />
          <div className="loading-text">Loading...</div>
        </div>
      }
    >
      <RestaurantInner />
    </Suspense>
  );
}
