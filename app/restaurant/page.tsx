'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { ExtractedMenu, MenuItem } from '@/lib/schema';

function RestaurantInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const url = sp.get('url') ?? '';
  const name = sp.get('name') ?? '';

  const [menu, setMenu] = useState<ExtractedMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setError('No restaurant URL provided.');
      setLoading(false);
      return;
    }
    setLoading(true);
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
        setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, [url, name]);

  function pickDish(item: MenuItem) {
    if (!menu) return;
    const params = new URLSearchParams({
      url,
      name: menu.restaurant_name,
      city: menu.restaurant_city ?? '',
      cuisine: menu.cuisine ?? '',
      dish_id: item.id,
      dish_name: item.name,
      dish_note: item.note,
    });
    router.push(`/recipe?${params.toString()}`);
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <div className="loading-text">Finding the menu for {name || 'this restaurant'}…</div>
        <div className="loading-sub">
          Live web fetch + AI extraction — usually 8–25 seconds.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wrap">
        <a className="back-link" onClick={() => router.push('/')}>
          ← Back to search
        </a>
        <div className="error-box">
          <h3>Could not extract the menu</h3>
          <p>{error}</p>
          <p style={{ marginTop: 14, fontSize: 13 }}>
            Source: <code>{url}</code>
          </p>
          <p style={{ marginTop: 14, fontSize: 13 }}>
            Some restaurant sites are heavy SPAs or block automated fetches. Try a different
            search result, or a restaurant whose menu lives on a more standard site.
          </p>
        </div>
      </div>
    );
  }

  if (!menu) return null;

  return (
    <div className="wrap">
      <a className="back-link" onClick={() => router.push('/')}>
        ← Back to search
      </a>
      <div className="rest-header">
        <div className="rest-header-top">
          <span className="pill pill-found">Menu found</span>
          <span className="pill pill-warn">Not affiliated</span>
        </div>
        <h1>{menu.restaurant_name}</h1>
        <div className="rest-meta">
          {menu.restaurant_city && <span>{menu.restaurant_city}</span>}
          {menu.cuisine && (
            <>
              <span>·</span>
              <span>{menu.cuisine}</span>
            </>
          )}
        </div>
        <div className="menu-banner">
          <div className="text">
            <strong>Live-extracted menu.</strong> Items below are publicly listed on{' '}
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
              {new URL(url).hostname}
            </a>{' '}
            and paraphrased into our own words. Tags reflect publicly listed wording — actual heat,
            allergens, and contents may vary. Confirm directly with the restaurant. We are not
            affiliated with, sponsored by, or endorsed by {menu.restaurant_name}.
          </div>
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
    </div>
  );
}

export default function RestaurantPage() {
  return (
    <Suspense fallback={<div className="loading"><div className="spinner" /><div className="loading-text">Loading…</div></div>}>
      <RestaurantInner />
    </Suspense>
  );
}
