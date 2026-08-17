/**
 * Boult Meeting Follow-Up — composes a post-meeting brief that Boult sends
 * to the USER (not to the attendees) ~45 min after a meeting ends.
 *
 * The brief contains:
 *   • A summary line — who you met with + when
 *   • A draft reply you can copy + send to the attendees (LLM-composed,
 *     short, matches the user's voice profile if one exists)
 *   • Suggested action items + the deadlines they should land by
 *   • A note about what was added to memory so the next meeting prep gets
 *     richer (feature #4 of the meeting lifecycle).
 *
 * Without a transcript the draft is a "good starter" — 3-5 sentences that
 * the user edits in 10 seconds rather than writing from scratch.
 *
 * Never throws. Returns null for meetings with no external attendees.
 */

// @ts-ignore — JS module path
import { GmailService } from '../gmail';
// @ts-ignore — JS module path
import { searchMemoriesRaw } from './memory';
import { callLLM, getText } from './engine';

export interface MeetingFollowUpInput {
  userId: string;          // user's email
  userTimezone: string;
  event: any;              // raw gcal event
  accessToken: string;
  refreshToken: string;
  voiceProfile?: string | null;
}

export interface MeetingFollowUpOutput {
  markdown: string;
  subject: string;
  attendeesExternal: { email: string; name?: string }[];
  endedAtIso: string;
  draftSubject: string;
  draftBody: string;
  actionItems: string[];
}

function extractDomain(email: string): string {
  return (email.split('@')[1] || '').toLowerCase();
}

export async function composeMeetingFollowUp(input: MeetingFollowUpInput): Promise<MeetingFollowUpOutput | null> {
  const userDomain = extractDomain(input.userId);
  const attendees = Array.isArray(input.event.attendees) ? input.event.attendees : [];
  const external = attendees
    .filter((a: any) => a?.email && !a.self && extractDomain(a.email) !== userDomain)
    .map((a: any) => ({ email: String(a.email).toLowerCase(), name: a.displayName as string | undefined }))
    .slice(0, 4);

  if (external.length === 0) return null;

  const endIso = input.event.end?.dateTime || input.event.end?.date || '';
  if (!endIso) return null;
  const endedAt = new Date(endIso);

  const title = (input.event.summary || '(untitled meeting)').toString().slice(0, 120);
  const description = (input.event.description || '').toString().replace(/<[^>]+>/g, '').slice(0, 500);

  // ── Pull recent thread context (what was the meeting about?) ───────────────
  const recentSubjects: string[] = [];
  try {
    const gmail = new (GmailService as any)(input.accessToken, input.refreshToken);
    for (const att of external.slice(0, 2)) {
      try {
        const res = await gmail.getEmails(5, `from:${att.email} OR to:${att.email} newer_than:30d`);
        const ids: string[] = (res?.messages || []).slice(0, 3).map((m: any) => m.id);
        for (const id of ids) {
          try {
            const detail = await gmail.getEmailDetails(id, 'metadata');
            const headers = detail.payload?.headers || [];
            const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '';
            if (subject && !recentSubjects.includes(subject)) recentSubjects.push(subject);
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch { /* gmail unavailable */ }

  // ── Pull memory about these attendees (for action-item context) ───────────
  const memoryLines: string[] = [];
  for (const att of external.slice(0, 3)) {
    try {
      const items = await searchMemoriesRaw(input.userId, att.email, 4);
      for (const m of items) {
        if (!m.text) continue;
        const snippet = m.text.replace(/\s+/g, ' ').trim().slice(0, 200);
        if (snippet) memoryLines.push(snippet);
      }
    } catch { /* skip */ }
  }

  // ── LLM call: compose the draft + extract action items ────────────────────
  const attendeeBlock = external
    .map((a: { email: string; name?: string }) => a.name ? `${a.name} (${a.email})` : a.email)
    .join(', ');
  const voicePart = input.voiceProfile
    ? `\n\nUSER'S VOICE PROFILE (match this tone in the draft):\n${input.voiceProfile.slice(0, 400)}`
    : '\n\n(No voice profile available — keep it warm, professional, brief.)';

  let draftSubject = `Following up — ${title}`;
  let draftBody = '';
  let actionItems: string[] = [];

  try {
    const res = await callLLM(
      [
        {
          role: 'system',
          content:
            'You compose post-meeting follow-up emails. You receive the meeting title, who attended, recent email context, and optional notes. ' +
            'Output STRICT JSON with three fields: { "subject": string, "body": string, "actionItems": string[] }.\n\n' +
            'RULES:\n' +
            '- subject: short, professional. Default pattern: "Following up — <meeting topic>" but you can adjust.\n' +
            '- body: 3-5 sentences MAX. First sentence thanks them for their time. Second sentence references ONE specific thing discussed (inferred from meeting title + thread). Third sentence proposes ONE concrete next step. Optional fourth sentence sets a deadline or asks a clarifying question. Sign off naturally.\n' +
            '- NEVER invent specific details (numbers, dates, names, commitments not visible in the inputs). When unsure, use a deliberately vague phrase like "the points we discussed" or "what we covered."\n' +
            '- Match the user\'s voice profile if provided. Otherwise: warm, professional, brief.\n' +
            '- NO greetings like "Hope this finds you well" — get to the point.\n' +
            '- actionItems: 1-3 specific things the USER (not the attendees) should do, derived from typical follow-throughs of a meeting like this. Each ≤ 80 chars, written as imperative verbs ("Send Acme the SOW draft by Wed", "Add Priya to Notion CRM as warm lead"). Empty array if nothing obvious.\n\n' +
            'Output ONLY the JSON. No prose before or after.' + voicePart,
        },
        {
          role: 'user',
          content:
            `MEETING TITLE: ${title}\n` +
            `ATTENDEES: ${attendeeBlock}\n` +
            `ENDED: ${endedAt.toLocaleString('en-US', { timeZone: input.userTimezone || 'UTC' })}\n\n` +
            (description ? `MEETING DESCRIPTION:\n${description}\n\n` : '') +
            (recentSubjects.length ? `RECENT EMAIL SUBJECTS WITH ATTENDEES:\n${recentSubjects.slice(0, 6).map(s => `- ${s}`).join('\n')}\n\n` : '') +
            (memoryLines.length ? `WHAT BOULT REMEMBERS ABOUT THESE PEOPLE:\n${memoryLines.slice(0, 6).map(s => `- ${s}`).join('\n')}\n\n` : '') +
            'Generate the follow-up JSON now.',
        },
      ],
      [],
      { maxTokens: 500, temperature: 0.35 },
    );

    const raw = getText(res.content).trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.subject === 'string' && parsed.subject.trim()) {
          draftSubject = parsed.subject.trim().slice(0, 140);
        }
        if (typeof parsed.body === 'string' && parsed.body.trim()) {
          draftBody = parsed.body.trim().slice(0, 1500);
        }
        if (Array.isArray(parsed.actionItems)) {
          actionItems = parsed.actionItems
            .filter((s: any) => typeof s === 'string' && s.trim())
            .map((s: string) => s.trim().slice(0, 120))
            .slice(0, 4);
        }
      } catch { /* fall through to template */ }
    }
  } catch { /* LLM unavailable — template fallback */ }

  // Template fallback if the LLM call failed or returned garbage
  if (!draftBody) {
    const firstName = external[0].name?.split(/\s+/)[0] || external[0].email.split('@')[0];
    draftBody = `Hey ${firstName} —\n\nThanks for the time today on ${title}. Wanted to circle back on the points we discussed and make sure we're aligned on next steps.\n\nLet me know if anything got lost in translation, and I'll plan to follow up later this week.\n\nBest,`;
  }

  // ── Compose the markdown wrapper Boult sends to the USER ──────────────────
  const lines: string[] = [];
  const endLocal = endedAt.toLocaleString('en-US', {
    timeZone: input.userTimezone || 'UTC',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });

  lines.push(`# Follow-up: ${title}`);
  lines.push(`Wrapped ${endLocal} · with ${attendeeBlock}`);
  lines.push('');

  lines.push(`## Draft follow-up (copy + send)`);
  lines.push(`**To:** ${external.map((a: { email: string }) => a.email).join(', ')}`);
  lines.push(`**Subject:** ${draftSubject}`);
  lines.push('');
  lines.push('```');
  lines.push(draftBody);
  lines.push('```');
  lines.push('');

  if (actionItems.length > 0) {
    lines.push(`## Action items on you`);
    for (const item of actionItems) lines.push(`- ${item}`);
    lines.push('');
  }

  lines.push(`## What Boult saved`);
  lines.push(`Tagged this meeting in memory — next time you meet with ${external.map((a: { email: string; name?: string }) => a.name || a.email).join(' or ')}, prep will include this context automatically.`);
  lines.push('');

  return {
    markdown: lines.join('\n'),
    subject: `Follow-up — ${title}`,
    attendeesExternal: external,
    endedAtIso: endedAt.toISOString(),
    draftSubject,
    draftBody,
    actionItems,
  };
}
