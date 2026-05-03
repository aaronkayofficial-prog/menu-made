'use client';

import { useState, Suspense, FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { GeneratedRecipe } from '@/lib/schema';

function RecipeInner() {
  const sp = useSearchParams();
  const router = useRouter();

  const dish = {
    id: sp.get('dish_id') ?? '',
    name: sp.get('dish_name') ?? '',
    note: sp.get('dish_note') ?? '',
  };
  const restaurant = {
    name: sp.get('name') ?? '',
    city: sp.get('city') ?? undefined,
    cuisine: sp.get('cuisine') ?? undefined,
  };
  const restaurantUrl = sp.get('url') ?? '';

  const [guests, setGuests] = useState(8);
  const [skill, setSkill] = useState<'Beginner' | 'Intermediate' | 'Advanced'>('Intermediate');
  const [cookingTime, setCookingTime] = useState('30–60 min');
  const [style, setStyle] = useState('Faithful to the spirit');
  const [equipment, setEquipment] = useState<string[]>(['Wok & high-output burner', 'Cast iron / heavy skillet', 'Bamboo or metal steamer']);
  const [dietary, setDietary] = useState<string[]>([]);

  const [recipe, setRecipe] = useState<GeneratedRecipe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eqOptions = [
    'Wok & high-output burner',
    'Cast iron / heavy skillet',
    'Convection oven',
    'Bamboo or metal steamer',
    'High-speed blender',
    'Sous vide / immersion circulator',
  ];
  const dietOptions = ['Gluten-free', 'Dairy-free', 'Vegetarian', 'Pescatarian', 'Nut-free', 'Low-spice / low-heat'];

  function toggle(arr: string[], v: string, set: (a: string[]) => void) {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setRecipe(null);
    try {
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dish,
          restaurant,
          params: { guests, skill, cookingTime, equipment, dietary, style },
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? `Generation failed (${r.status})`);
      }
      const data = await r.json();
      setRecipe(data.recipe);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <div className="loading-text">Generating your recreated version…</div>
        <div className="loading-sub">
          Reading the menu reference, sizing for {guests} {guests === 1 ? 'guest' : 'guests'},
          structuring the recipe.
        </div>
      </div>
    );
  }

  if (recipe) {
    return (
      <div className="wrap-narrow recipe-wrap">
        <a
          className="back-link"
          onClick={() => {
            setRecipe(null);
            window.scrollTo({ top: 0 });
          }}
        >
          ← Adjust settings
        </a>

        <div className="recipe-hero">
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className="pill pill-warn">Original recreation</span>
            <span className="pill" style={{ color: '#6B5F52' }}>Recreated by MENU MADE</span>
          </div>
          <h1>{recipe.hero_line}</h1>
          <p className="lede">{recipe.intro}</p>
        </div>

        <div className="recipe-disclaimer">
          <h4>This is not the restaurant's recipe.</h4>
          <p>{recipe.disclaimer}</p>
        </div>

        {recipe.glance?.length > 0 && (
          <div className="glance">
            {recipe.glance.map((g, i) => (
              <div className="glance-cell" key={i}>
                <div className="glance-label">{g.label}</div>
                <div className="glance-value">
                  {g.value}
                  {g.sub && <small>{g.sub}</small>}
                </div>
              </div>
            ))}
          </div>
        )}

        {recipe.ingredients?.length > 0 && (
          <div className="recipe-section">
            <div className="recipe-section-head">
              <h2>Ingredients</h2>
            </div>
            <div className="ingredients-grid">
              {recipe.ingredients.map((ing, i) => (
                <div className="ing-item" key={i}>
                  <span className="ing-label">{ing.label}</span>
                  <span className="ing-qty">{ing.qty}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {recipe.shopping?.length > 0 && (
          <div className="recipe-section">
            <div className="recipe-section-head">
              <h2>Shopping list</h2>
            </div>
            <div className="shopping-groups">
              {recipe.shopping.map((g, i) => (
                <div className="shop-group" key={i}>
                  <h4>{g.group}</h4>
                  <ul>{g.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {recipe.timeline?.length > 0 && (
          <div className="recipe-section">
            <div className="recipe-section-head">
              <h2>Prep timeline</h2>
            </div>
            <div className="timeline">
              {recipe.timeline.map((s, i) => (
                <div className="tl-step" key={i}>
                  <div className="tl-time">{s.time}</div>
                  {s.actual && <div className="tl-actual">{s.actual}</div>}
                  <div className="tl-text">{s.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {recipe.method?.length > 0 && (
          <div className="recipe-section">
            <div className="recipe-section-head">
              <h2>Method</h2>
            </div>
            {recipe.method.map((m, i) => (
              <div className="method-step" key={i}>
                <div className="method-num">{String(i + 1).padStart(2, '0')}</div>
                <div className="method-body">
                  <h4>{m.title}</h4>
                  <p>{m.text}</p>
                  {m.tip && (
                    <div className="method-tip" dangerouslySetInnerHTML={{ __html: m.tip }} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {recipe.plating && (recipe.plating.visual?.length > 0 || recipe.plating.table?.length > 0) && (
          <div className="recipe-section">
            <div className="recipe-section-head">
              <h2>Plating &amp; service</h2>
            </div>
            <div className="plating-grid">
              <div className="plating-card">
                <h4>The plate itself</h4>
                <ul>{recipe.plating.visual?.map((v, i) => <li key={i}>{v}</li>)}</ul>
              </div>
              <div className="plating-card">
                <h4>The table around it</h4>
                <ul>{recipe.plating.table?.map((v, i) => <li key={i}>{v}</li>)}</ul>
              </div>
            </div>
          </div>
        )}

        {recipe.pairings?.length > 0 && (
          <div className="recipe-section">
            <div className="recipe-section-head">
              <h2>Pairings</h2>
            </div>
            <div className="pair-grid">
              {recipe.pairings.map((p, i) => (
                <div className="pair-card" key={i}>
                  <div className="pair-icon">{p.type[0]}</div>
                  <div className="pair-style">{p.style}</div>
                  <h4>{p.title}</h4>
                  <p>{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 48, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost"
            onClick={() => router.push(`/restaurant?url=${encodeURIComponent(restaurantUrl)}&name=${encodeURIComponent(restaurant.name)}`)}
          >
            Back to {restaurant.name}'s menu
          </button>
          <button className="btn btn-primary" onClick={() => router.push('/')}>
            Recreate another dish
          </button>
        </div>
      </div>
    );
  }

  // Customise form
  return (
    <div className="wrap-narrow customise-wrap">
      <a
        className="back-link"
        onClick={() => router.push(`/restaurant?url=${encodeURIComponent(restaurantUrl)}&name=${encodeURIComponent(restaurant.name)}`)}
      >
        ← Back to menu
      </a>

      <div className="dish-recap">
        <div style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="pill pill-found">Menu item found</span>
          <span style={{ fontSize: 13, color: '#6B5F52' }}>
            at {restaurant.name}
            {restaurant.city ? `, ${restaurant.city}` : ''}
          </span>
        </div>
        <h1>{dish.name}</h1>
        {dish.note && <p style={{ fontSize: 15, color: '#3A332B', lineHeight: 1.6 }}>{dish.note}</p>}
      </div>

      {error && (
        <div className="error-box" style={{ marginBottom: 32 }}>
          <h3>Generation failed</h3>
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={handleGenerate}>
        <div className="form-section">
          <h3>Who's at your table?</h3>
          <div className="guests-control">
            <button type="button" className="guests-btn" onClick={() => setGuests(Math.max(1, guests - 1))}>−</button>
            <div className="guests-display">{guests}</div>
            <span style={{ fontSize: 13, color: '#6B5F52', flex: 1 }}>guests at the table</span>
            <button type="button" className="guests-btn" onClick={() => setGuests(Math.min(50, guests + 1))}>+</button>
          </div>
        </div>

        <div className="form-section">
          <h3>How comfortable are you in the kitchen?</h3>
          <div className="pill-group">
            {(['Beginner', 'Intermediate', 'Advanced'] as const).map((s) => (
              <div className="pill-input" key={s}>
                <input type="radio" id={`s-${s}`} name="skill" checked={skill === s} onChange={() => setSkill(s)} />
                <label htmlFor={`s-${s}`}>{s}</label>
              </div>
            ))}
          </div>
        </div>

        <div className="form-row">
          <div className="form-section">
            <h3>How much time do you have?</h3>
            <div className="pill-group">
              {['Under 30 min', '30–60 min', '1–2 hours', 'A whole afternoon'].map((t) => (
                <div className="pill-input" key={t}>
                  <input type="radio" id={`t-${t}`} name="time" checked={cookingTime === t} onChange={() => setCookingTime(t)} />
                  <label htmlFor={`t-${t}`}>{t.replace('A whole afternoon', '2 hrs+')}</label>
                </div>
              ))}
            </div>
          </div>
          <div className="form-section">
            <h3>What kind of recreation?</h3>
            <div className="pill-group">
              {['Faithful to the spirit', 'Quick weeknight', 'Showstopper', 'Family-style'].map((s) => (
                <div className="pill-input" key={s}>
                  <input type="radio" id={`r-${s}`} name="style" checked={style === s} onChange={() => setStyle(s)} />
                  <label htmlFor={`r-${s}`}>{s.replace('Faithful to the spirit', 'Faithful to spirit')}</label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>What's in your kitchen?</h3>
          <div className="check-group">
            {eqOptions.map((opt) => (
              <div className="check-input" key={opt}>
                <input type="checkbox" id={`eq-${opt}`} checked={equipment.includes(opt)} onChange={() => toggle(equipment, opt, setEquipment)} />
                <label htmlFor={`eq-${opt}`}><span className="check-box" />{opt}</label>
              </div>
            ))}
          </div>
        </div>

        <div className="form-section">
          <h3>Anything we should leave out?</h3>
          <div className="check-group">
            {dietOptions.map((opt) => (
              <div className="check-input" key={opt}>
                <input type="checkbox" id={`d-${opt}`} checked={dietary.includes(opt)} onChange={() => toggle(dietary, opt, setDietary)} />
                <label htmlFor={`d-${opt}`}><span className="check-box" />{opt}</label>
              </div>
            ))}
          </div>
        </div>

        <div className="generate-bar">
          <div className="text">
            <strong>Before you cook.</strong> What we generate is an original recreation by MENU MADE,
            inspired by a publicly listed menu reference. Not the restaurant's recipe.
          </div>
          <button type="submit" className="btn btn-accent" style={{ padding: '16px 30px', fontSize: 15 }}>
            Generate recreation →
          </button>
        </div>
      </form>
    </div>
  );
}

export default function RecipePage() {
  return (
    <Suspense fallback={<div className="loading"><div className="spinner" /><div className="loading-text">Loading…</div></div>}>
      <RecipeInner />
    </Suspense>
  );
}
