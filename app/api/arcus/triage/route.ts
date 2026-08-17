/**
 * Boult Proactive Triage — Feature 5
 * POST /api/boult/triage
 *
 * Runs a focused inbox scan and surfaces what matters:
 *  - Urgent emails requiring immediate action
 *  - Follow-ups the user is waiting on
 *  - Delegation rule matches
 *  - High-value threads to watch
 *
 * Called by: cron job, manual "morning briefing" trigger, or
 * automatically when the user opens the app after >4h absence.
 */

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { auth as nextAuth } from '../../../../lib/auth.js';
import { assertPaidAccess } from '../../../../lib/subscription-protection.js';
const auth: any = nextAuth;
import { getSupabaseAdmin } from '../../../../lib/supabase.js';
import { decrypt } from '../../../../lib/crypto.js';
import { googleFetch } from '../../../../lib/boult/tools/http-tokens';
import { logEvent } from "@/lib/logsso";

export const maxDuration = 55;

// ── Token helper ──────────────────────────────────────────────────────────────
async function getGmailToken(userId: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const uid = userId.toLowerCase();

  const { data: tokens } = await supabase
    .from('user_tokens')
    .select('encrypted_access_token')
    .or(`user_id.ilike."${uid}",google_email.ilike."${uid}"`)
    .maybeSingle();

  if (tokens?.encrypted_access_token) return decrypt(tokens.encrypted_access_token);

  const { data: integ } = await supabase
    .from('boult_integrations')
    .select('access_token')
    .eq('user_id', uid)
    .eq('provider', 'gmail')
    .maybeSingle();

  return integ?.access_token ? decrypt(integ.access_token) : null;
}

// ── Urgency classifier ────────────────────────────────────────────────────────
const URGENT_SIGNALS = [
  /\b(urgent|asap|immediately|critical|deadline|overdue|action required|time.?sensitive)\b/i,
  /\b(RSVP|confirm|respond by|reply by|by (today|tonight|tomorrow|monday|eod|cob))\b/i,
  /\b(invoice|payment|due|overdue|past due|invoice #)\b/i,
];

function scoreUrgency(subject: string, snippet: string): number {
  const text = `${subject} ${snippet}`;
  return URGENT_SIGNALS.filter(re => re.test(text)).length;
}

// ── Delegation rule matcher ───────────────────────────────────────────────────
async function matchDelegationRules(
  userId: string,
  subject: string,
  snippet: string,
  from: string
): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data: rules } = await supabase
      .from('boult_delegation_rules')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!rules?.length) return null;
    const text = `${subject} ${snippet} ${from}`.toLowerCase();

    for (const rule of rules) {
      const keywords: string[] = rule.trigger_keywords || [];
      const fromFilter: string = rule.trigger_from || '';

      const keywordMatch = keywords.length === 0 || keywords.some((k: string) => text.includes(k.toLowerCase()));
      const fromMatch = !fromFilter || from.toLowerCase().includes(fromFilter.toLowerCase());

      if (keywordMatch && fromMatch) return rule.name;
    }
    return null;
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); return null; }
}

// ── Main triage handler ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userEmail = session?.user?.email?.toLowerCase();
    if (!userEmail) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // STRICT paywall — Boult triage is paid-only.
    const gate = await assertPaidAccess(userEmail);
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.error, message: gate.message, upgradeUrl: gate.upgradeUrl },
        { status: gate.status }
      );
    }

    const body = await req.json().catch(() => ({}));
    const since = body.since || '6h';   // look at emails from last N hours

    const token = await getGmailToken(userEmail);
    if (!token) return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });

    // ── 1. Fetch recent unread inbox ──────────────────────────────────────────
    const query = `in:inbox is:unread newer_than:${since}`;
    const listRes = await googleFetch(userEmail, 'gmail',
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listRes.ok) return NextResponse.json({ error: 'Gmail fetch failed' }, { status: 500 });

    const listData = await listRes.json();
    const messages: any[] = listData.messages || [];

    if (!messages.length) {
      return NextResponse.json({
        urgent: [],
        followups: [],
        delegationMatches: [],
        summary: 'Inbox clear — no new emails in the last period.',
      });
    }

    // ── 2. Fetch metadata for each message ────────────────────────────────────
    const details = await Promise.all(messages.slice(0, 20).map(async ({ id }: any) => {
      try {
        const r = await googleFetch(userEmail, 'gmail',
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!r.ok) return null;
        const m = await r.json();
        const h = m.payload?.headers || [];
        const getH = (n: string) => (h.find((x: any) => x.name === n)?.value || '');
        return { id: m.id, threadId: m.threadId, from: getH('From'), subject: getH('Subject'), date: getH('Date'), snippet: (m.snippet || '').slice(0, 200) };
      } catch {
        logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); return null; }
    }));

    const valid = details.filter(Boolean) as any[];

    // ── 3. Classify ───────────────────────────────────────────────────────────
    const urgent: any[] = [];
    const delegationMatches: any[] = [];

    for (const m of valid) {
      const urgency = scoreUrgency(m.subject, m.snippet);
      if (urgency > 0) urgent.push({ ...m, urgencyScore: urgency });

      const matchedRule = await matchDelegationRules(userEmail, m.subject, m.snippet, m.from);
      if (matchedRule) delegationMatches.push({ ...m, ruleName: matchedRule });
    }

    // Sort urgent by score descending
    urgent.sort((a, b) => b.urgencyScore - a.urgencyScore);

    // ── 4. Follow-ups (sent emails awaiting reply) ────────────────────────────
    const sentRes = await googleFetch(userEmail, 'gmail',
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent('in:sent newer_than:7d')}&maxResults=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const followups: any[] = [];

    if (sentRes.ok) {
      const sentData = await sentRes.json();
      const sentMsgs: any[] = (sentData.messages || []).slice(0, 10);
      const seenThreads = new Set<string>();

      for (const { id } of sentMsgs) {
        try {
          const sentMsgRes = await googleFetch(userEmail, 'gmail',
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!sentMsgRes.ok) continue;
          const msg = await sentMsgRes.json();
          const { threadId } = msg;
          if (seenThreads.has(threadId)) continue;
          seenThreads.add(threadId);

          const h = msg.payload?.headers || [];
          const getH = (n: string) => (h.find((x: any) => x.name === n)?.value || '');
          const dateStr = getH('Date');
          const sentMs = new Date(dateStr).getTime() || 0;
          const daysWaiting = Math.round((Date.now() - sentMs) / 86400000);
          if (daysWaiting < 1) continue;

          const threadRes = await googleFetch(userEmail, 'gmail',
            `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=From`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!threadRes.ok) continue;
          const thread = await threadRes.json();
          const hasReply = (thread.messages || []).some((m: any) => {
            if (m.id === id) return false;
            const from = (m.payload?.headers?.find((x: any) => x.name === 'From')?.value || '').toLowerCase();
            return parseInt(m.internalDate || '0') > sentMs && !from.includes(userEmail.toLowerCase());
          });

          if (!hasReply) {
            followups.push({ subject: getH('Subject'), to: getH('To'), daysWaiting, threadId });
          }
        } catch {
          logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); continue; }
      }
    }

    // ── 5. Compose summary ────────────────────────────────────────────────────
    const parts: string[] = [];
    if (urgent.length)           parts.push(`${urgent.length} urgent email${urgent.length !== 1 ? 's' : ''} need your attention`);
    if (followups.length)        parts.push(`${followups.length} follow-up${followups.length !== 1 ? 's' : ''} awaiting reply`);
    if (delegationMatches.length) parts.push(`${delegationMatches.length} delegation rule${delegationMatches.length !== 1 ? 's' : ''} triggered`);

    const summary = parts.length
      ? parts.join(' · ')
      : `${valid.length} new email${valid.length !== 1 ? 's' : ''} — none flagged urgent`;

    return NextResponse.json({ urgent, followups, delegationMatches, newEmails: valid, summary });

  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[Triage] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
