import { NextRequest, NextResponse } from 'next/server';
import { claudeJSON } from '@/lib/anthropic';
import { RECIPE_SYSTEM_PROMPT, PROMPT_VERSION } from '@/lib/prompts';
import { GeneratedRecipe, DISCLAIMER, RecipeParams } from '@/lib/schema';
import { getCachedRecipe, recipeCacheKey, saveRecipe } from '@/lib/recipe-cache';

export const runtime = 'nodejs';
export const maxDuration = 90;

// POST /api/generate { dish, restaurant, params }
// Returns: GeneratedRecipe (with disclaimer reinjected)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dish, restaurant, params } = body as {
      dish: { id: string; name: string; note: string };
      restaurant: { name: string; city?: string };
      params: RecipeParams;
    };

    if (!dish?.name || !restaurant?.name || !params) {
      return NextResponse.json(
        { error: 'dish, restaurant, and params are required' },
        { status: 400 }
      );
    }

    // ============ CACHE CHECK ============
    // Same (dish, restaurant, params) = same recipe. Cache hits skip Claude entirely.
    const cacheKey = recipeCacheKey(dish, restaurant, params);
    const cached = await getCachedRecipe(cacheKey);
    if (cached) {
      // Defence in depth: re-inject the canonical disclaimer even on cache reads,
      // in case the cached version was generated under an older disclaimer string.
      return NextResponse.json({
        recipe: { ...cached.recipe, disclaimer: DISCLAIMER },
        prompt_version: cached.prompt_version,
        cached: true,
        cache_key: cacheKey,
      });
    }

    const userMsg = [
      `Restaurant: ${restaurant.name}${restaurant.city ? `, ${restaurant.city}` : ''}`,
      `Dish (publicly listed menu reference): ${dish.name}`,
      `Description: ${dish.note}`,
      '',
      `Recreation parameters:`,
      `- Guests: ${params.guests}`,
      `- Skill level: ${params.skill}`,
      `- Cooking time available: ${params.cookingTime}`,
      `- Equipment: ${params.equipment.join(', ') || 'standard home kitchen'}`,
      `- Dietary preferences: ${params.dietary.join(', ') || 'none'}`,
      `- Recreation style: ${params.style}`,
      '',
      'Write the original MENU MADE recreation recipe now. JSON only, no surrounding prose.',
    ].join('\n');

    const llm = await claudeJSON<Omit<GeneratedRecipe, 'disclaimer' | 'dish_id' | 'dish_name' | 'restaurant_name' | 'servings' | 'skill' | 'style' | 'total_time'>>({
      system: RECIPE_SYSTEM_PROMPT,
      user: userMsg,
      maxTokens: 12000,
    });

    // Defence in depth: ALWAYS attach the canonical disclaimer regardless of
    // what the LLM produced. This is the IP-safe architecture from the brief.
    const recipe: GeneratedRecipe = {
      dish_id: dish.id,
      dish_name: dish.name,
      restaurant_name: restaurant.name,
      servings: params.guests,
      skill: params.skill,
      style: params.style,
      total_time: '',
      hero_line: (llm as { hero_line?: string }).hero_line ?? `Here is our recreated version of this ${restaurant.name}-inspired dish for ${params.guests} guests.`,
      intro: (llm as { intro?: string }).intro ?? '',
      disclaimer: DISCLAIMER,
      glance: (llm as { glance?: GeneratedRecipe['glance'] }).glance ?? [],
      ingredients: (llm as { ingredients?: GeneratedRecipe['ingredients'] }).ingredients ?? [],
      shopping: (llm as { shopping?: GeneratedRecipe['shopping'] }).shopping ?? [],
      timeline: (llm as { timeline?: GeneratedRecipe['timeline'] }).timeline ?? [],
      method: (llm as { method?: GeneratedRecipe['method'] }).method ?? [],
      plating: (llm as { plating?: GeneratedRecipe['plating'] }).plating ?? { visual: [], table: [] },
      pairings: (llm as { pairings?: GeneratedRecipe['pairings'] }).pairings ?? [],
    };

    // Save to cache for the next 90 days
    await saveRecipe(cacheKey, {
      recipe,
      prompt_version: PROMPT_VERSION,
    });

    return NextResponse.json({
      recipe,
      prompt_version: PROMPT_VERSION,
      cached: false,
      cache_key: cacheKey,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
