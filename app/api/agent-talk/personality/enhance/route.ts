import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../lib/auth.js';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function getKeys(): string[] {
  return [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY2,
    process.env.OPENROUTER_API_KEY3,
    process.env.OPENROUTER_API_KEY4,
  ].filter(Boolean) as string[];
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let draft = '';
  try {
    const body = await request.json();
    draft = (body.draft as string)?.trim() || '';
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!draft) {
    return NextResponse.json({ error: 'draft is required' }, { status: 400 });
  }

  const apiKeys = getKeys();
  if (!apiKeys.length) {
    return NextResponse.json({ error: 'LLM not available' }, { status: 503 });
  }

  const systemPrompt = `You are a professional prompt engineer specializing in AI personality and behavior instructions.

The user has written a rough draft describing how they want their AI assistant (called Boult) to behave.

Your task: Expand and enhance this draft into a comprehensive, professional personality instruction set.

Rules:
- Keep the user's original intent and preferences exactly — do not change what they want
- Add concrete behavioral guidelines that logically follow from their draft
- Structure it clearly: communication style, personality traits, response format preferences, any specific context the user gave
- Write in second person ("You are...", "Your tone is...", "When asked...")
- Keep it concise but thorough — 150 to 300 words max
- Plain prose only — no bullet points, no headers, no markdown
- Never add anything the user didn't imply — only expand what's there`;

  let lastError = 'Enhancement failed';

  for (const apiKey of apiKeys) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://maily.cfd',
        },
        body: JSON.stringify({
          model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
          max_tokens: 400,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Here is my draft:\n\n${draft.slice(0, 1000)}` },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`OpenRouter ${res.status}: ${errText}`);
      }

      const json = await res.json();
      const enhanced: string = json.choices?.[0]?.message?.content?.trim() || '';

      if (!enhanced) throw new Error('Empty response');

      return NextResponse.json({ enhanced });
    } catch (err: any) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
      console.error('[Enhance API] Key failed:', err.message);
      lastError = err.message;
      // If it's a 429, continue to the next key. Otherwise, also continue just in case.
      continue;
    }
  }

  return NextResponse.json({ error: lastError }, { status: 500 });
}
