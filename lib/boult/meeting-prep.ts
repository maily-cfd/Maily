/**
 * Boult Meeting Prep — composes a pre-meeting briefing from Gmail history,
 * past memories, and the calendar event itself.
 *
 * Pure data assembly; no LLM call in this MVP — the markdown is structured
 * enough that the recipient can read it without an LLM gloss. A future
 * PART can swap in a free-model summarizer for the "what they're building"
 * section.
 *
 * Never throws. Returns null when the meeting has no external attendees
 * (internal recurring focus blocks are not worth prepping for).
 */

// @ts-ignore — JS module path
import { GmailService } from '../gmail';
// @ts-ignore — JS module path
import { searchMemoriesRaw } from './memory';

export interface MeetingPrepInput {
  userId: string;          // user's email
  userTimezone: string;
  event: any;              // raw gcal event from CalendarService.listEvents
  accessToken: string;
  refreshToken: string;
}

export interface MeetingPrepOutput {
  markdown: string;
  subject: string;
  attendeesExternal: { email: string; name?: string }[];
  startsAtIso: string;
}

function extractDomain(email: string): string {
  return (email.split('@')[1] || '').toLowerCase();
}

function parseFromHeader(fromHeader: string): { name: string; email: string } {
  const m = fromHeader.match(/^(.+?)\s*<(.+?)>\s*$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim() };
  return { name: fromHeader.split('@')[0] || 'Unknown', email: fromHeader };
}

export async function composeMeetingPrep(input: MeetingPrepInput): Promise<MeetingPrepOutput | null> {
  const userDomain = extractDomain(input.userId);
  const attendees = Array.isArray(input.event.attendees) ? input.event.attendees : [];
  const external = attendees
    .filter((a: any) => a?.email && !a.self && extractDomain(a.email) !== userDomain)
    .map((a: any) => ({ email: String(a.email).toLowerCase(), name: a.displayName as string | undefined }))
    .slice(0, 4);

  if (external.length === 0) return null;

  const startIso = input.event.start?.dateTime || input.event.start?.date || '';
  if (!startIso) return null;
  const start = new Date(startIso);

  const title = (input.event.summary || '(untitled meeting)').toString().slice(0, 120);

  // ── Gmail history: recent threads with each external attendee ──────────────
  let gmail: any;
  try {
    gmail = new (GmailService as any)(input.accessToken, input.refreshToken);
  } catch {
    gmail = null;
  }

  const threadsByAttendee: { attendee: { email: string; name?: string }; lines: string[] }[] = [];
  if (gmail) {
    for (const att of external.slice(0, 3)) {
      try {
        const res = await gmail.getEmails(8, `from:${att.email} OR to:${att.email} newer_than:90d`);
        const ids: string[] = (res?.messages || []).slice(0, 4).map((m: any) => m.id);
        const lines: string[] = [];
        for (const id of ids) {
          try {
            const detail = await gmail.getEmailDetails(id, 'metadata');
            const headers = detail.payload?.headers || [];
            const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '(no subject)';
            const snippet = (detail.snippet || '').replace(/\s+/g, ' ').slice(0, 140);
            lines.push(`- **${subject}** — ${snippet}`);
          } catch { /* skip */ }
        }
        if (lines.length) threadsByAttendee.push({ attendee: att, lines });
      } catch { /* skip */ }
    }
  }

  // ── Memory: what does Boult already know about these people ───────────────
  const memoryLines: string[] = [];
  for (const att of external.slice(0, 3)) {
    try {
      const items = await searchMemoriesRaw(input.userId, att.email, 5);
      for (const m of items) {
        if (!m.text) continue;
        const snippet = m.text.replace(/\s+/g, ' ').trim().slice(0, 240);
        if (snippet) memoryLines.push(`- ${snippet}`);
      }
    } catch { /* skip */ }
    // Also search by attendee name if we have one
    if (att.name && att.name.length > 2) {
      try {
        const items = await searchMemoriesRaw(input.userId, att.name, 3);
        for (const m of items) {
          if (!m.text) continue;
          const snippet = m.text.replace(/\s+/g, ' ').trim().slice(0, 240);
          if (snippet && !memoryLines.some(l => l.includes(snippet.slice(0, 60)))) {
            memoryLines.push(`- ${snippet}`);
          }
        }
      } catch { /* skip */ }
    }
  }

  // ── Compose the markdown brief ─────────────────────────────────────────────
  const lines: string[] = [];
  const startLocal = start.toLocaleString('en-US', {
    timeZone: input.userTimezone || 'UTC',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
  const minutesUntil = Math.max(0, Math.round((start.getTime() - Date.now()) / 60000));

  lines.push(`# ${title}`);
  lines.push(`Starts ${minutesUntil > 0 ? `in ~${minutesUntil} min` : 'now'} · ${startLocal}`);
  lines.push('');

  lines.push(`## Who you're meeting`);
  for (const att of external) {
    const nameLine = att.name ? `**${att.name}** — ${att.email}` : `**${att.email}**`;
    lines.push(`- ${nameLine}`);
  }
  lines.push('');

  if (threadsByAttendee.length > 0) {
    lines.push(`## Recent thread`);
    for (const t of threadsByAttendee) {
      lines.push(`**With ${t.attendee.name || t.attendee.email}:**`);
      for (const line of t.lines) lines.push(line);
      lines.push('');
    }
  } else {
    lines.push(`## Recent thread`);
    lines.push(`_No recent emails with these attendees in the last 90 days._`);
    lines.push('');
  }

  if (memoryLines.length > 0) {
    lines.push(`## What Boult remembers`);
    for (const m of memoryLines.slice(0, 8)) lines.push(m);
    lines.push('');
  }

  if (input.event.description) {
    const desc = String(input.event.description).replace(/<[^>]+>/g, '').slice(0, 600).trim();
    if (desc) {
      lines.push(`## Meeting description`);
      lines.push(desc);
      lines.push('');
    }
  }

  if (input.event.hangoutLink || input.event.conferenceData?.entryPoints?.length) {
    const meet = input.event.hangoutLink
      || input.event.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri;
    if (meet) {
      lines.push(`**Join:** ${meet}`);
      lines.push('');
    }
  }

  return {
    markdown: lines.join('\n'),
    subject: `Meeting prep — ${title}`,
    attendeesExternal: external,
    startsAtIso: start.toISOString(),
  };
}
