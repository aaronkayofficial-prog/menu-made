# MENU MADE — Dish image pipeline setup

Dish images use **Vercel Blob** (auto-configured) for caching and **Google Gemini Flash Image** (Nano Banana 2) for generation. Setup is two env vars total.

## What you'll need

- **Vercel Blob store** — auto-creates `BLOB_READ_WRITE_TOKEN` for you (free tier: 1GB / month)
- **Google AI Studio account** (free) — for Gemini Flash image generation (~$0.03 per image after free tier)

Total ongoing cost at testing scale: ~$5–30 / month. At 250K MAU steady state: ~$90 / month.

---

## Step 1 — Add a Vercel Blob store

1. Go to your Vercel project → **Storage** tab
2. Click **Create Database** → choose **Blob**
3. Pick a name (e.g. `menu-made-images`) and click **Create**
4. Click **Connect Project** and connect to your `menu-made` project
5. The `BLOB_READ_WRITE_TOKEN` env var is added automatically. Nothing to copy by hand.

---

## Step 2 — Google AI Studio API key (for Gemini)

1. Go to **https://aistudio.google.com**
2. Sign in with a Google account
3. Click **"Get API key"** (top right or in the sidebar)
4. Click **"Create API key"** → **"Create API key in new project"** (or use an existing project)
5. Copy the key (looks like `AIzaSy…`, ~40 characters)

The default Gemini Flash Image quota is generous for testing. Pricing kicks in at ~$0.03 per image after the free tier, charged to your Google Cloud account.

---

## Step 3 — Add the Gemini key to Vercel

In your Vercel project (`menu-made`), go to **Settings → Environment Variables** and add:

| Name | Value | Environments |
|---|---|---|
| `GEMINI_API_KEY` | (the API key from Step 2.5) | Production, Preview |

(Free Vercel plans don't allow Development scope — that's fine, only Production matters for the live URL.)

Click **Save**. Vercel will trigger a fresh deployment automatically.

---

## Step 4 — Test it

1. Once Vercel finishes redeploying (~60s), hard-refresh `menu-made.vercel.app`
2. Search a restaurant, click a dish, click "Recreate this dish"
3. On the customise screen, you should see the dish thumbnail in the recap card
   - First time it's requested: 5–20 seconds while Gemini generates
   - Subsequent times: instant (served from Blob cache)
4. Click "Generate recreation" — the recipe screen shows the same image as a hero above the recipe

---

## Troubleshooting

- **"GEMINI_API_KEY is not set" errors** — env var missing on Vercel, or only saved for Development scope. Check Settings → Environment Variables and tick Production.
- **"BLOB_READ_WRITE_TOKEN is not set" errors** — Blob store not connected. Re-do Step 1.
- **First image takes 30+ seconds** — normal for Gemini's first call after cold-start. Subsequent calls in the same minute are faster.
- **Images don't appear** — check the browser network tab. `/api/dish-image` should return `200` with an `imageUrl`. If it returns `500`, check Vercel function logs for the error.
- **Env var changes not taking effect** — Vercel doesn't always auto-redeploy when you save a var. Go to the Deployments tab, click the "…" menu on the latest deployment, and click **Redeploy**.

---

## How the pipeline runs

For every dish ever requested:

1. **Cache check** — hash key `sha256(restaurantSlug + normalised_dish_name)`. If Blob has it, return instantly. (~50ms)
2. **Tier 1 — site image** — fetch the restaurant's page, find the `<img>` tag closest to the dish name in the HTML. Free.
3. **Tier 2 — web image search** — Exa search for `"dish name" restaurant`. Real photos from food blogs, Tripadvisor, etc. Cheap (~$0.005).
4. **Tier 3 — Gemini Flash generation** — strict style template (white plate, top-down, natural daylight). If Tier 1 or 2 returned a real photo, it's used as the *seed* (image-to-image) for visual accuracy + style consistency + legal safety. ~$0.03.
5. **Cache** — generated image saved to Vercel Blob. Served free for every subsequent customer who requests that dish.

The first user for any given dish pays the cost. Everyone after that gets it free.

---

## Cost monitoring

Once live, track these in your Google Cloud and Vercel dashboards:

- **Gemini API** — per-image generation cost; daily cap recommended ~200/day during beta, scale up later
- **Vercel Blob** — 1GB free per month, then $0.15/GB. Typical dish image is ~200KB, so 1GB = ~5,000 dishes cached.

Set up billing alerts on both.
