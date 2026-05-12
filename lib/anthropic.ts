import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  _client = new Anthropic({ apiKey: key });
  return _client;
}

function extractJSON<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Claude returned no JSON: ' + text.slice(0, 200));
  }
  try {
    return JSON.parse(match[0]) as T;
  } catch (e) {
    throw new Error(
      'Failed to parse Claude JSON: ' + (e as Error).message + ' — raw: ' + match[0].slice(0, 200)
    );
  }
}

/**
 * Build a cacheable system block. Anthropic prompt caching cuts latency
 * ~80% on the cached portion AND ~90% cost on cache hits, when the same
 * system prompt is reused within the cache TTL (5 min ephemeral by default).
 *
 * Our system prompts (RECIPE_SYSTEM_PROMPT, EXTRACT_SYSTEM_PROMPT,
 * OVERVIEW_SYSTEM_PROMPT) are all >1024 tokens — easily above the minimum
 * cacheable size for claude-sonnet-4-5.
 */
function cachedSystemBlock(text: string): Anthropic.TextBlockParam[] {
  return [
    {
      type: 'text',
      text,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

/**
 * Call Claude with a system prompt + text user message and parse JSON.
 * Uses Anthropic prompt caching on the system block for 80% latency / 90% cost
 * reduction on repeat calls within the 5-minute ephemeral window.
 */
export async function claudeJSON<T = unknown>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  model?: string;
}): Promise<T> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: opts.model ?? 'claude-sonnet-4-5-20250929',
    max_tokens: opts.maxTokens ?? 8000,
    system: cachedSystemBlock(opts.system),
    messages: [{ role: 'user', content: opts.user }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return extractJSON<T>(text);
}

/**
 * Call Claude with one or more images alongside a text prompt and parse JSON.
 * Used for image-based menus (printed menus uploaded as JPGs/PNGs).
 * System prompt is cached the same way as claudeJSON.
 */
export async function claudeJSONWithImages<T = unknown>(opts: {
  system: string;
  user: string;
  imageUrls: string[];
  maxTokens?: number;
  model?: string;
}): Promise<T> {
  const client = getAnthropic();
  const cappedUrls = opts.imageUrls.slice(0, 8);

  // Build the message content: images first, then the text instruction.
  const content: Anthropic.ContentBlockParam[] = cappedUrls.map((url) => ({
    type: 'image' as const,
    source: { type: 'url' as const, url },
  }));
  content.push({ type: 'text' as const, text: opts.user });

  const response = await client.messages.create({
    model: opts.model ?? 'claude-sonnet-4-5-20250929',
    max_tokens: opts.maxTokens ?? 8000,
    system: cachedSystemBlock(opts.system),
    messages: [{ role: 'user', content }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return extractJSON<T>(text);
}
