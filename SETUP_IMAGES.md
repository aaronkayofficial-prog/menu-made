# MENU MADE — Dish image pipeline setup

To turn on dish images, you need to set up two services and add their keys as Vercel environment variables. After that, every dish ever requested generates exactly one image, gets cached in R2, and is served free forever.

## What you'll need

- **Cloudflare account** (free) — for R2 image storage with zero egress fees
- **Google AI Studio account** (free) — for Gemini Flash image generation (~$0.03 per image)

Total ongoing cost at testing scale: ~$5–30 / month. At 250K MAU steady state: ~$90 / month.

---

## Step 1 — Cloudflare R2 bucket

1. Go to **https://dash.cloudflare.com** and sign up / log in
2. In the left sidebar, click **R2 Object Storage** (under Storage & Databases)
3. Click **"Create bucket"**
   - Name: `menu-made-dish-images` (or anything)
   - Location hint: pick the region closest to your users
   - Click **Create bucket**
4. Once the bucket is open, click the **Settings** tab
5. Under **Public access**, click **"Allow Access"** and confirm. This gives the bucket a public `https://pub-<hash>.r2.dev` URL — copy this URL, you'll need it.
6. Click the **R2** entry in the left sidebar to go back, then click **Manage R2 API Tokens** (top right)
7. Click **"Create API Token"**
   - Token name: `menu-made-app`
   - Permissions: **Object Read & Write**
   - Specify bucket: select the bucket you just created
   - Click **Create**
8. Copy the four values it shows you — you need:
   - **Access Key ID**
   - **Secret Access Key**
   - **Account ID** (visible in the URL or in the right-side sidebar of any R2 page)
   - The bucket name and the public URL from step 5

---

## Step 2 — Google AI Studio API key (for Gemini)

1. Go to **https://aistudio.google.com**
2. Sign in with a Google account
3. Click **"Get API key"** (top right or in the sidebar)
4. Click **"Create API key"** → **"Create API key in new project"** (or use an existing project)
5. Copy the key

The default Gemini Flash Image quota is generous for testing. Pricing kicks in at ~$0.03 per image after the free tier, charged to your Google Cloud account.

---

## Step 3 — Add the six env vars to Vercel

In your Vercel project (menu-made), go to **Settings → Environment Variables** and add:

| Name | Value | Where it came from |
|---|---|---|
| `R2_ACCOUNT_ID` | (Cloudflare account ID) | Cloudflare R2 sidebar |
| `R2_ACCESS_KEY_ID` | (R2 token Access Key ID) | Step 1.7 |
| `R2_SECRET_ACCESS_KEY` | (R2 token Secret) | Step 1.7 |
| `R2_BUCKET` | `menu-made-dish-images` | Whatever you named the bucket |
| `R2_PUBLIC_URL` | `https://pub-xxxxxx.r2.dev` | Step 1.5 |
| `GEMINI_API_KEY` | (Gemini API key) | Step 2.5 |

Tick **Production**, **Preview**, and **Development** for each one.

Click **Save**. Vercel will trigger a fresh deployment automatically.

---

## Step 4 — Test it

1. Once Vercel finishes redeploying, hard-refresh `menu-made.vercel.app`
2. Search a restaurant, click a dish, click "Recreate this dish"
3. On the customise screen, you should see the dish thumbnail in the recap card
   - First time it's requested: 5–20 seconds while Gemini generates
   - Subsequent times: instant (served from R2 cache)
4. Click "Generate recreation" — the recipe screen shows the same image as a hero above the recipe

---

## Troubleshooting

- **"R2 not configured" errors** — env var missing or typo. Double-check all five R2 vars are set in Vercel.
- **"GEMINI_API_KEY is not set" errors** — same. Check the var is set in Vercel.
- **First image takes 30+ seconds** — normal for Gemini's first call after cold-start of the API route. Subsequent calls in the same minute are faster.
- **Images don't appear** — check the browser network tab. `/api/dish-image` should return `200` with an `imageUrl`. If it returns `500`, check Vercel function logs for the error.

---

## How the pipeline runs

For every dish ever requested:

1. **Cache check** — hash key `sha256(restaurantSlug + normalised_dish_name)`. If R2 has it, return instantly. (~50ms)
2. **Tier 1 — site image** — fetch the restaurant's page, find the `<img>` tag closest to the dish name in the HTML. Free.
3. **Tier 2 — web image search** — Exa search for `"dish name" restaurant`. Real photos from food blogs, Tripadvisor, etc. Cheap (~$0.005).
4. **Tier 3 — Gemini Flash generation** — strict style template (white plate, top-down, natural daylight). If Tier 1 or 2 returned a real photo, it's used as the *seed* (image-to-image) for visual accuracy + style consistency + legal safety. ~$0.03.
5. **Cache** — generated image saved to R2. Served free for every subsequent customer who requests that dish.

The first user for any given dish pays the cost. Everyone after that gets it free.

---

## Cost monitoring

Once live, track these in your Google Cloud and Cloudflare dashboards:

- **Gemini API** — per-image generation cost; daily cap recommended ~200/day during beta, scale up later
- **R2 storage** — typically <$1/month even at significant scale (zero egress fees is the magic)

Set up billing alerts on both.
