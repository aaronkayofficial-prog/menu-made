import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  _client = new Anthropic({ apiKey: key });
  return _client;
}

/**
 * Call Claude with a system prompt + user message and parse JSON from the response.
 * Robust to surrounding prose (extracts the first {...} block).
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
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((b) => b.text)
    .join('\n');

  // Extract first { ... } block in case the LLM wrapped output in prose
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
