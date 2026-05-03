import { NextRequest, NextResponse } from 'next/server';
import { exaContents } from '@/lib/exa';
import { claudeJSON } from '@/lib/anthropic';
import { EXTRACT_SYSTEM_PROMPT, PROMPT_VERSION } from '@/lib/prompts';
import { ExtractedMenu } from '@/lib/schema';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/extract { url: "https://...", restaurantName?: "string" }
// Returns: ExtractedMenu
export async function POST(req: NextRequest) {
  try {
    const { url, restaurantName } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    // Use Exa to fetch + render the menu page (handles SPAs via livecrawl)
    const contents = await exaContents([url], 'always');
    const page = contents[0];
    if (!page || !page.text) {
      return NextResponse.json(
        { error: 'Could not fetch menu page', url },
        { status: 502 }
      );
    }

    // Send to Claude for structured extraction
    const userMsg = [
      restaurantName ? `Restaurant hint: ${restaurantName}` : '',
      `Source URL: ${url}`,
      '',
      'Source content:',
      '---',
      page.text.slice(0, 22000),
      '---',
      '',
      'Produce the structured menu JSON now.',
    ]
      .filter(Boolean)
      .join('\n');

    const extracted = await claudeJSON<ExtractedMenu>({
      system: EXTRACT_SYSTEM_PROMPT,
      user: userMsg,
      maxTokens: 8000,
    });

    // Stamp metadata
    const result: ExtractedMenu = {
      ...extracted,
      source_url: url,
      source_format: /\.pdf$/i.test(url) ? 'pdf' : 'html',
      extracted_at: new Date().toISOString(),
    };

    // Strip any prices that might have slipped through (defence in depth)
    for (const section of result.sections ?? []) {
      for (const item of section.items ?? []) {
        delete (item as Record<string, unknown>).price;
      }
    }

    return NextResponse.json({ menu: result, prompt_version: PROMPT_VERSION });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
