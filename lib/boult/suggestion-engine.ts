import { callLLM, getText } from './engine';

export interface SuggestionChip {
  label: string;
  prompt: string;
}

const MAX_CHIPS = 3;

export async function generateFollowUpSuggestions(params: {
  userMessage: string;
  assistantReply: string;
  toolsCalled: string[];
  connectedIntegrations: string[];
}): Promise<SuggestionChip[]> {
  const { userMessage, assistantReply, toolsCalled, connectedIntegrations } = params;

  if (!assistantReply || assistantReply.trim().length < 20) return [];

  const replyExcerpt = assistantReply.replace(/\s+/g, ' ').trim().slice(0, 1200);
  const userExcerpt = userMessage.replace(/\s+/g, ' ').trim().slice(0, 400);
  const toolsList = toolsCalled.length > 0 ? toolsCalled.slice(0, 10).join(', ') : '(none)';

  try {
    const res = await callLLM(
      [
        {
          role: 'system',
          content:
            'You generate 1-3 short follow-up suggestion chips for an AI chat UI. ' +
            'A real assistant proactively offers what the user would obviously want next — not generic small talk.\n\n' +
            'RULES:\n' +
            '- Each chip is ONE specific action the user can take with one tap. Max 60 chars per label.\n' +
            '- Use imperative verbs ("Draft a reply to Priya", "Add to Notion", "Pull Q3 numbers").\n' +
            '- Only suggest actions doable with the user\'s connected integrations: ' + (connectedIntegrations.join(', ') || 'none connected') + '.\n' +
            '- No "Need anything else?" / "Let me know if…" / "Want to explore X?" generic filler.\n' +
            '- No questions — they\'re actions.\n' +
            '- Suggest 1-3 chips. ZERO is valid (return []) when there is no obvious next step.\n' +
            '- If the AI just finished a task with no obvious follow-on (chitchat, greeting, simple question answered), return [].\n\n' +
            'OUTPUT FORMAT: a JSON array, no prose. Each entry: { "label": "...", "prompt": "..." }.\n' +
            'label = the chip text shown to the user (max 60 chars).\n' +
            'prompt = the full natural-language message that fires if the user taps the chip (can be longer, written as the user would type it).\n\n' +
            'EXAMPLES:\n' +
            'User asked: "Draft a reply to Priya about Q3 proposal"\n' +
            'AI replied: "Drafted — open it in Gmail to send."\n' +
            'Good chips: [{"label":"Send it now","prompt":"Send the draft to Priya"},{"label":"Schedule a follow-up","prompt":"Add a calendar reminder to follow up with Priya in 3 days"},{"label":"Log to Notion","prompt":"Log this thread to the Priya contact in Notion"}]\n\n' +
            'User asked: "What\'s on my calendar tomorrow?"\n' +
            'AI listed 3 meetings.\n' +
            'Good chips: [{"label":"Prep doc for tomorrow","prompt":"Build me a one-page prep for each meeting tomorrow"},{"label":"Block focus time","prompt":"Find me 90 minutes of focus time tomorrow and block it"}]\n\n' +
            'User said: "thanks"\n' +
            'AI replied: "Anytime."\n' +
            'Good chips: [] (no obvious next action — chitchat).',
        },
        {
          role: 'user',
          content:
            `USER MESSAGE: ${userExcerpt}\n\n` +
            `AI REPLY: ${replyExcerpt}\n\n` +
            `TOOLS THE AI CALLED: ${toolsList}\n\n` +
            `Generate the follow-up suggestion chips JSON array now.`,
        },
      ],
      [],
      { maxTokens: 280, temperature: 0.3 },
    );

    const raw = getText(res.content).trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    let parsed: any;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch { return []; }
    if (!Array.isArray(parsed)) return [];

    const chips: SuggestionChip[] = [];
    for (const item of parsed) {
      if (typeof item?.label !== 'string' || typeof item?.prompt !== 'string') continue;
      const label = item.label.trim().slice(0, 60);
      const prompt = item.prompt.trim().slice(0, 500);
      if (!label || !prompt) continue;
      chips.push({ label, prompt });
      if (chips.length >= MAX_CHIPS) break;
    }
    return chips;
  } catch {
    return [];
  }
}
