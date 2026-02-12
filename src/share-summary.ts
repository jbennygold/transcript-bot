import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MAX_CHARS = 900;
const MAX_ANSWER_CHARS = 12_000;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripMetaPhrases(text: string): string {
  return text
    .replace(/^here is (a|an|the)\s+[^.]*summary[:\s-]*/i, '')
    .replace(/^the key takeaway is that\s+/i, '')
    .replace(/^summary[:\s-]*/i, '')
    .trim();
}

export async function summarizeShareAnswer({
  query,
  answer,
  maxChars = DEFAULT_MAX_CHARS,
}: {
  query: string;
  answer: string;
  maxChars?: number;
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }

  const truncatedAnswer =
    answer.length > MAX_ANSWER_CHARS
      ? `${answer.slice(0, MAX_ANSWER_CHARS)}…`
      : answer;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `Summarize the answer below for a Discord link preview.

Requirements:
- Focus on the key takeaway in 1-4 sentences.
- It's okay to be brief if the answer is clear.
- Do not repeat the question.
- Do not mention character limits, summaries, or instructions.
- Avoid markdown formatting.
- Plain text only.

Question: "${query}"
Answer:
${truncatedAnswer}
`;

  try {
    const message = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return null;
    }

    const summary = stripMetaPhrases(normalizeWhitespace(textBlock.text));
    if (!summary) {
      return null;
    }

    return summary.length > maxChars ? `${summary.slice(0, maxChars - 3).trim()}...` : summary;
  } catch (error) {
    console.error('Summary generation failed, falling back to raw answer:',
      error instanceof Error ? error.message : error);
    return null;
  }
}
