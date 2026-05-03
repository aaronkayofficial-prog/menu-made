# MENU MADE

Search any restaurant in the world. Browse its real menu. Generate an original home-cookable recreation of any dish.

This is a Next.js app deployed on Vercel. It uses Anthropic's Claude for menu extraction and recipe generation, and Exa for live web search of restaurant menu pages.

## What it does

1. **Search** — type a restaurant name and city (e.g. "Spice Temple Sydney"). The app live-searches the web for their menu.
2. **Browse the menu** — every dish on the restaurant's publicly listed menu, paraphrased into our own words. Names, descriptions, no prices.
3. **Pick a dish + tell us about your kitchen** — guest count, skill level, equipment, dietary preferences, recreation style.
4. **Get an original recreation** — full ingredients list, shopping list grouped by aisle, T-minus prep timeline, step-by-step method with chef notes, plating guide, four pairings.

The recipe is always framed as MENU MADE's original interpretation. Not the restaurant's recipe. Disclaimer reinjected at the API serialisation layer regardless of LLM output.

## Setup (Vercel deploy)

1. **Fork or clone this repo** to your GitHub account.
2. **Import the project to Vercel** at https://vercel.com/new — connect the GitHub repo, accept the defaults (Next.js auto-detected).
3. **Add two environment variables** in Vercel → Project Settings → Environment Variables:
   - `ANTHROPIC_API_KEY` — get from https://console.anthropic.com (~$5 in starter credits)
   - `EXA_API_KEY` — get from https://exa.ai (free tier covers initial testing)
4. **Deploy.** Vercel does the rest.

Subsequent pushes to your GitHub `main` branch will auto-deploy.

## Local development

```bash
npm install
cp .env.example .env.local
# Add your two API keys to .env.local
npm run dev
# Open http://localhost:3000
```

## API endpoints

- `POST /api/search` — `{ query: "Spice Temple Sydney" }` → `{ results: [...] }`
- `POST /api/extract` — `{ url, restaurantName? }` → `{ menu: ExtractedMenu }`
- `POST /api/generate` — `{ dish, restaurant, params }` → `{ recipe: GeneratedRecipe }`

## Architecture

- **Search**: Exa neural search, biased toward menu URLs, penalising delivery and listicle domains.
- **Extract**: Exa contents (livecrawl: always) renders SPA pages → Claude Sonnet structures the result into JSON. Substring verification + paraphrase enforcement live in the system prompt (`lib/prompts.ts`).
- **Generate**: Claude Sonnet writes the recipe against a strict structured-output schema. Disclaimer is reinjected server-side at `/api/generate` regardless of LLM output (defence in depth).

## IP-safe positioning

This product references real restaurants by name (factual) and paraphrases publicly listed menu items into our own words (we never reproduce restaurant prose verbatim). All recipes are clearly labelled as MENU MADE recreations, not the restaurant's recipes. We are not affiliated with any restaurant.

If a restaurant operator wants their listing removed, that's a takedown request flow — currently handled manually; productise via a dedicated endpoint in a later phase.

## Status

This is the v1 deployable Stage 3 build. Scope:

- ✓ Real live search any restaurant in the world
- ✓ Real menu extraction with paraphrased descriptions, no prices
- ✓ Recipe generation with disclaimer reinjection
- ✓ Editorial design language

Known limitations:

- Some heavily JavaScript-rendered restaurant sites still block extraction even via Exa livecrawl. Workaround in v1: try a different search result, or pick a restaurant whose menu lives on a more standard CMS. v2 plan: dedicated browser-rendering worker.
- Allergen tagging is advisory only and not surfaced from menu data in v1 (deferred to a later phase with curation backstop, per the architecture brief).

## Licence

Private prototype. Don't distribute.
