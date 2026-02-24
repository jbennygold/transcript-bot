import Anthropic from '@anthropic-ai/sdk';

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripMetaPhrases(text: string): string {
  return text
    .replace(/^follow-?up[:\s-]*/i, '')
    .replace(/^question[:\s-]*/i, '')
    .replace(/^here is .*?[:\s-]*/i, '')
    .trim();
}

export async function generateFollowUpQuery({
  query,
  answer,
}: {
  query: string;
  answer: string;
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `Write one short follow-up question to deepen the discussion.

Requirements:
- 6 to 12 words.
- Ask about a specific detail or angle in the answer.
- Plain text only, no quotes or bullets.
- Do not reference that this is a follow-up.

Original question: "${query}"
Answer:
${answer}
`;

  const message = await client.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 64,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return null;
  }

  const cleaned = stripMetaPhrases(normalizeWhitespace(textBlock.text)).replace(/^["']|["']$/g, '');
  if (!cleaned) {
    return null;
  }

  const trimmed = cleaned.length > 120 ? cleaned.slice(0, 120).trim() : cleaned;
  if (!trimmed || trimmed.toLowerCase() === query.trim().toLowerCase()) {
    return null;
  }

  return trimmed;
}
