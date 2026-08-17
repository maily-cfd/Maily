/**
 * Home-feed Today surface — the daily decision queue.
 *
 * Returns at most 3 items per bucket:
 *   • decide   — unread mail that may need a reply/decision
 *   • showUp   — calendar events for the rest of today
 *   • chase    — threads the user sent 3-14 days ago with no reply received
 *
 * SELECTION IS THE AI'S JOB. The fetchers below gather only a WIDE, mostly-
 * unfiltered candidate net — regex is used to ORDER the fallback, NOT to gate
 * what the AI sees. The real select/rank/reason + briefing is done by the
 * tool-driven triage agent (lib/boult/today-agent.ts), which investigates the
 * candidates with read-only tools before deciding. Heuristics run only when the
 * AI is unavailable, so Today never loads worse than the regex baseline.
 */
import { NextResponse } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth.js';
// @ts-ignore
import { getSupabaseAdmin } from '@/lib/supabase.js';
import { GmailService } from '@/lib/gmail';
import { cleanRunSummary } from '@/lib/boult/report-summary';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';
// Raised from 30 → 60 (the same 60s function cap the background agents use): the
// AI triage runs a bounded tool loop inside the cached snapshot build. The build
// is cache-backed + cron-prewarmed, so this only applies to a cold recompute.
export const maxDuration = 60;

// Cap for the HEURISTIC FALLBACK ONLY (the no-AI regex path). This path has no
// judgment — it can't tell a $12k invoice from a newsletter — so it stays
// deliberately conservative rather than dumping a wide unranked pool on the user.
// The AI triage path does NOT use this: it decides how many items actually matter
// (0, 2, or 7) and is bounded only by BUCKET_CEILING in lib/boult/today-agent.ts.
const HEURISTIC_MAX_PER_BUCKET = 5;
// Separate buckets that were previously (and accidentally) sharing the top-3 cap.
// They aren't AI-triaged — they're straight DB reads — so they keep an explicit
// bound of their own rather than inheriting one that no longer means the same thing.
const MAX_ACTION_ITEMS = 8;
const MAX_AGENT_RUNS = 5;
const ACTION_ITEM_HORIZON_HOURS = 48;

interface DecideItem {
  id: string;
  threadId: string;
  sender: { name: string; email: string };
  subject: string;
  reason: string;
  receivedAt: string;
  gmailUrl: string;
  // AI-observed grounding for the pick ("4th email from her", "deadline is
  // Friday") — the confidence receipts rendered as chips under the reason.
  signals?: string[];
  // Preview text, kept only server-side so the AI triage can read what the email
  // says. Stripped from the payload the agent path returns.
  snippet?: string;
}

interface ShowUpItem {
  id: string;
  start: string;
  end: string | null;
  title: string;
  attendeeCount: number;
  meetLink: string | null;
  hangoutLink: string | null;
  isExternal: boolean;
  // AI-written reason (agent path); the client falls back to a default string.
  reason?: string;
  signals?: string[];
}

interface ChaseItem {
  id: string;
  threadId: string;
  recipient: { name: string; email: string };
  subject: string;
  daysSilent: number;
  sentAt: string;
  gmailUrl: string;
  // AI-written reason (agent path); the client falls back to a default string.
  reason?: string;
  signals?: string[];
}

interface ActionItem {
  id: string;              // <meeting_row_id>:<index> — addressable for future "mark done"
  text: string;
  dueAt: string | null;
  isOverdue: boolean;
  meetingTitle: string | null;
  attendees: string[];
}

// "While you were away" — what the user's scheduled agents did recently. This
// is what makes HomeFeed a command center: every agent's work flows through it,
// not just inbox-derived items. Sourced from boult_agent_runs.
interface AgentRunItem {
  id: string;
  agentName: string;
  status: 'success' | 'error' | 'transient_error' | 'running';
  summary: string | null;     // clean one-line preview of the run report
  toolCalls: number;
  ranAt: string;              // completed_at, or started_at if still running
  artifactCounts: { gmail: number; calendar: number; notion: number; slack: number };
}

interface TodayResponse {
  decide: DecideItem[];
  showUp: ShowUpItem[];
  chase: ChaseItem[];
  actionItems: ActionItem[];
  agentRuns: AgentRunItem[];
  emptyAll: boolean;
  generatedAt: string;
  gmailConnected: boolean;
  calendarConnected: boolean;
  needsReconnect?: { gmail?: boolean; calendar?: boolean };
  // One-line AI briefing of what needs the user today (agent path only).
  briefing?: string;
  // DIRECT AI-triage error — set only when BOTH the agent and the enrich pass
  // failed, so the reasons fell to deterministic labels. Surfaced on the feed
  // (never masked) so an AI failure is visible instead of hidden behind filler.
  aiError?: string;
  // Transparent Reasoning (P6): HOW the day was prioritized — the tradeoff logic
  // behind the order ("ranked by who's waiting + what costs money to miss; left
  // the Stripe digest out — automated"). Surfaced on demand as "Why this order?"
  // so the founder understands the triage instead of just accepting it.
  reasoning?: string;
  // Confidence scale: how many emails were actually examined vs how few were
  // surfaced. "Read 47, 3 need you" is the strongest it's-not-guessing signal.
  triage?: { scanned: number; surfaced: number };
  // Approval Mode: write actions background agents queued for the user's OK
  // (boult_agent_pending_actions, status='pending'). Surfaced so the founder
  // learns work is waiting on their signature without opening Boult.
  pendingApprovals?: number;
}

function isTokenExpiredErr(err: any): boolean {
  const m = String(err?.message || '').toLowerCase();
  // 'invalid authentication credentials' added 2026-07-23 — LIVE-VERIFIED
  // against a real expired-token account: Google Calendar's actual 401 body
  // reads "Request had invalid authentication credentials. Expected OAuth 2
  // access token…", which matched none of the other patterns, so an expired
  // Calendar token was silently read as calendarConnected:true / an honestly
  // empty calendar instead of needsReconnect.
  return m.includes('expired')
    || m.includes('invalid_grant')
    || m.includes('401')
    || m.includes('refresh failed')
    || m.includes('invalid authentication credentials')
    // Composio Proxy Execute raises this when the connected account for the
    // toolkit is missing/EXPIRED/REVOKED — i.e. the connection is dead and the
    // user must reconnect. LIVE-SEEN 2026-07-23: an expired Gmail Composio
    // connection returns "No active connection found for toolkit(s) 'gmail'…".
    || m.includes('no active connection')
    || m.includes('no_active_connection');
}

const URGENCY_SIGNALS = [
  /\burgent\b/i,
  /\basap\b/i,
  /\btime[- ]?sensitive\b/i,
  /\bdeadline\b/i,
  /\boverdue\b/i,
  /\baction (required|needed)\b/i,
  /\bplease (respond|reply|review|approve|confirm)\b/i,
  /\bquick (question|ask)\b/i,
  /\bneed your (input|review|approval|sign[- ]?off|decision)\b/i,
];

const REVENUE_SIGNALS = [
  /\binvoice\b/i,
  /\bcontract\b/i,
  /\bproposal\b/i,
  /\bquote\b/i,
  /\bpricing\b/i,
  /\brenewal\b/i,
  /\bSOW\b/,
  /\bMSA\b/,
  /\bNDA\b/,
  /\bpayment\b/i,
  /\bsigned?\b/i,
  /\boffer letter\b/i,
  /\bpurchase order\b/i,
  /\bP\.O\.\b/,
];

const MEETING_REQUEST_SIGNALS = [
  /\bare you (free|available)\b/i,
  /\bdo you have (time|availability)\b/i,
  /\bcan we (chat|talk|meet|jump on|hop on)\b/i,
  /\b(let'?s|let us) (schedule|set up|find time|meet)\b/i,
  /\bsend (over )?(your|some) availability\b/i,
  /\b(book|grab) a (time|call|meeting)\b/i,
];

// Senders / patterns that should NEVER reach the Decide bucket even if the
// subject says "URGENT" — newsletters, automated digests, marketing.
const NOISE_FROM_PATTERNS = [
  /^no[- ]?reply@/i,
  /^donotreply@/i,
  /^notifications?@/i,
  /^newsletter@/i,
  /^digest@/i,
  /^updates?@/i,
  /^team@.*\.(io|app|com)$/i, // generic team@ from product newsletters
  /^marketing@/i,
  /^hello@.*\.(substack|beehiiv|convertkit)\.com$/i,
];
const NOISE_SUBJECT_PATTERNS = [
  /\b(weekly|daily|monthly) (digest|newsletter|roundup|update|summary|brief)\b/i,
  /\bunsubscribe\b/i,
  /^\[.+\]\s/, // "[Newsletter Name] ..."
  /^Re:\s*\[/, // "Re: [Newsletter]"
  /\bissue #\d+\b/i,
];

function parseFromHeader(fromHeader: string): { name: string; email: string } {
  const match = fromHeader.match(/^(.+?)\s*<(.+?)>\s*$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
  return { name: fromHeader.split('@')[0] || 'Unknown', email: fromHeader };
}

function isNoiseSender(fromHeader: string, subject: string): boolean {
  for (const re of NOISE_FROM_PATTERNS) if (re.test(fromHeader)) return true;
  for (const re of NOISE_SUBJECT_PATTERNS) if (re.test(subject)) return true;
  return false;
}

// Only pure machine noise is dropped BEFORE the AI sees it — bounces and
// calendar/system auto-mail — because they're never a human decision and would
// just waste tokens. Everything else (incl. borderline newsletters/marketing)
// is fed to the triage agent, which is now the thing that judges importance and
// drops noise. This is the "give the AI more control of selection" policy.
const HARD_NOISE_FROM = [
  /mailer-daemon@/i,
  /postmaster@/i,
  /no[-_.]?reply@(?:.*\.)?(?:google|accounts\.google)\.com/i,
  /calendar-notification@google\.com/i,
];
function isHardNoise(fromHeader: string): boolean {
  return HARD_NOISE_FROM.some((re) => re.test(fromHeader));
}

// Heuristic signal → { reason, rank }. Used ONLY for (a) the fallback ordering
// when the AI is unavailable and (b) trimming an overflowing pool sensibly. It no
// longer EXCLUDES anything (hard noise is dropped by the caller); soft noise just
// sorts last so the fallback top-3 stays clean while the item still reaches the AI.
// Lower rank = higher priority.
function decideSignal(subject: string, snippet: string, from: string): { reason: string; rank: number } {
  const text = `${subject} ${snippet}`;
  if (isNoiseSender(from, subject)) return { reason: 'Likely newsletter/automated', rank: 9 };
  for (const re of REVENUE_SIGNALS) if (re.test(text)) return { reason: 'Money on the line', rank: 0 };
  for (const re of URGENCY_SIGNALS) if (re.test(text)) return { reason: 'Flagged urgent', rank: 1 };
  // Direct question in the subject — but not a marketing teaser ("Did you know?").
  if (/\?/.test(subject) && subject.length < 90 && !/^(did you|tired of|want to|ready to|why )/i.test(subject.trim())) {
    return { reason: 'Direct question', rank: 2 };
  }
  for (const re of MEETING_REQUEST_SIGNALS) if (re.test(text)) return { reason: 'Wants time on your calendar', rank: 3 };
  // Re: threads continue an active conversation the user is expected to weigh in on.
  if (/^Re:/i.test(subject) && !/\b(unsubscribe|newsletter|digest)\b/i.test(text)) {
    return { reason: 'Active thread waiting on you', rank: 4 };
  }
  return { reason: 'Needs your attention', rank: 5 };
}

// Replace generic regex reasons with real per-email reasoning via one batched
// LLM call, routed through the robust OpenRouterAIService (key rotation +
// free→paid model fallback) so a single rate-limited key/model can't silently
// drop the surface back to generic labels — the reason the Today feed used to
// feel "random, not AI". Fed the email PREVIEW (not just From+Subject) so the
// reason is grounded in what the email actually says. Mutates items in place;
// the heuristic label stays for any email the model skips or on total failure.
// Returns null on success, or a DIRECT error string when the AI reason
// enrichment couldn't run — so the caller can surface it instead of masking the
// failure behind the generic heuristic labels (founder directive: no fallbacks).
async function enrichDecideReasons(items: DecideItem[], snippetById: Map<string, string>): Promise<string | null> {
  if (!items.length) return null;
  try {
    // @ts-ignore — JS module
    const { OpenRouterAIService } = await import('@/lib/openrouter-ai.js');
    const svc = new OpenRouterAIService();
    if (!svc.isAvailable()) return 'AI unavailable — no OpenRouter keys configured';

    const input = items.map((it) => ({
      from: it.sender.name || it.sender.email,
      subject: it.subject,
      snippet: snippetById.get(it.id) || '',
    }));
    const reasons: string[] | null = await svc.enrichTodayReasons(input);
    if (!reasons) return 'AI unavailable — reason enrichment returned nothing (rate-limited / all models exhausted)';
    reasons.forEach((r, i) => { if (r && items[i]) items[i].reason = r; });
    return null;
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.warn('[home-feed/today] reason enrichment failed:', (err as any)?.message);
    return `AI error — ${(err as any)?.message || 'reason enrichment failed'}`;
  }
}

// Gather Decide CANDIDATES (regex pre-filter + snippet), ranked by the heuristic
// signal order. This is only a candidate net now — the AI triage does the real
// selection/prioritization. Returns up to `limit` items WITH their preview
// snippet attached (used by the agent to read what each email says).
async function fetchDecide(gmail: GmailService, limit = HEURISTIC_MAX_PER_BUCKET): Promise<{ items: DecideItem[]; scanned: number }> {
  try {
    // WIDER raw net (was 30) — the AI decides importance now, so give it more to
    // choose from. Gmail's own promotions/social categories are still excluded
    // (cheap, genuinely marketing); our regex no longer gates the rest.
    const res = await (gmail as any).getEmails(50, 'is:unread newer_than:3d -category:promotions -category:social');
    const ids: string[] = (res?.messages || []).map((m: any) => m.id).slice(0, 50);
    if (!ids.length) return { items: [], scanned: 0 };
    const details = await Promise.all(
      ids.map(async (id) => {
        try {
          const d = await (gmail as any).getEmailDetails(id, 'metadata');
          return (gmail as any).parseEmailData(d);
        } catch {
          logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
          return null;
        }
      }),
    );
    const ranked: Array<{ item: DecideItem; rank: number }> = [];
    for (const d of details) {
      if (!d) continue;
      if (isHardNoise(d.from || '')) continue; // only pure machine noise is dropped pre-AI
      const { reason, rank } = decideSignal(d.subject || '', d.snippet || '', d.from || '');
      const sender = parseFromHeader(d.from || '');
      ranked.push({
        rank,
        item: {
          id: d.id,
          threadId: d.threadId,
          sender,
          subject: d.subject || '(no subject)',
          reason,
          receivedAt: d.date || new Date(Number(d.internalDate) || Date.now()).toISOString(),
          gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${d.threadId}`,
          snippet: d.snippet || '',
        },
      });
    }
    // Order for the FALLBACK / overflow-trim only. The AI re-ranks from scratch,
    // so this just keeps the pool sensible (and the fallback top-3 clean).
    ranked.sort((a, b) => a.rank - b.rank);
    // scanned = emails actually examined (the confidence-scale numerator).
    const scanned = details.filter(Boolean).length;
    return { items: ranked.slice(0, limit).map((r) => r.item), scanned };
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.warn('[home-feed/today] decide fetch failed:', (err as any)?.message);
    // A token-expiry error must reach the wrap() wrapper around this call so it
    // can set needsReconnect — swallowing it here (as every other error is
    // swallowed) made an expired Gmail token indistinguishable from a genuinely
    // empty inbox: the feed silently showed "nothing needs you, you're all
    // handled" instead of telling the user their connection was dead. LIVE-
    // VERIFIED 2026-07-23 against a real expired-token account.
    if (isTokenExpiredErr(err)) throw err;
    return { items: [], scanned: 0 };
  }
}

async function fetchShowUp(userEmail: string, limit = HEURISTIC_MAX_PER_BUCKET): Promise<ShowUpItem[]> {
  try {
    const now = new Date();
    const endOfWindow = new Date(now);
    endOfWindow.setDate(endOfWindow.getDate() + 1);
    endOfWindow.setHours(23, 59, 59, 999);
    // Read Calendar through googleFetch (Composio Proxy-aware), NOT CalendarService.
    // CalendarService uses the googleapis client with the raw token, but for a
    // Composio user the token on file is a `composio:<accountId>` MARKER, not a
    // real Google access token — so every googleapis call 401s and the whole
    // Calendar surface read as "expired" even with an ACTIVE Composio connection
    // (proxy verified live: 200). googleFetch routes Composio users via Proxy
    // Execute and legacy users via a direct fetch with the bearer we pass here.
    const { getGcalToken, googleFetch } = await import('@/lib/boult/tools/http-tokens');
    const token = await getGcalToken(userEmail).catch(() => null);
    const qs = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: endOfWindow.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '20',
    });
    const res = await googleFetch(
      userEmail,
      'gcal',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs.toString()}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // A 401 (dead token/connection) flows to isTokenExpiredErr → needsReconnect;
      // other statuses (rate/transient) are swallowed to an empty section below.
      throw new Error(`Calendar API ${res.status}: ${body.slice(0, 160)}`);
    }
    const data: any = await res.json().catch(() => ({}));
    const events: any[] = Array.isArray(data?.items) ? data.items : [];
    const items: ShowUpItem[] = [];
    for (const ev of events) {
      if (!ev.start?.dateTime && !ev.start?.date) continue; // skip malformed
      const start = ev.start.dateTime || ev.start.date || '';
      const end = ev.end?.dateTime || ev.end?.date || null;
      const attendees = ev.attendees || [];
      const externalAttendees = attendees.filter((a: any) => a.email && !a.email.endsWith(`@${userEmail.split('@')[1]}`));
      // Skip all-day events and recurring focus blocks (no attendees)
      if (!ev.start?.dateTime) continue;
      if (attendees.length === 0) continue;
      items.push({
        id: ev.id || '',
        start,
        end,
        title: ev.summary || '(no title)',
        attendeeCount: attendees.length,
        meetLink: ev.hangoutLink || ev.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri || null,
        hangoutLink: ev.hangoutLink || null,
        isExternal: externalAttendees.length > 0,
      });
    }
    return items.slice(0, limit);
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.warn('[home-feed/today] showUp fetch failed:', (err as any)?.message);
    // See fetchDecide's comment — must re-throw token expiry so wrap() can set
    // needsReconnect instead of this reading as an honest empty calendar.
    if (isTokenExpiredErr(err)) throw err;
    return [];
  }
}

async function fetchChase(gmail: GmailService, userEmail: string, limit = HEURISTIC_MAX_PER_BUCKET): Promise<ChaseItem[]> {
  try {
    const res = await (gmail as any).getEmails(40, 'in:sent newer_than:14d older_than:3d');
    const messages: any[] = res?.messages || [];
    if (!messages.length) return [];
    // Group by threadId — we'll fetch one thread per group to detect a reply.
    const byThread = new Map<string, string>();
    for (const m of messages) {
      if (!byThread.has(m.threadId)) byThread.set(m.threadId, m.id);
    }
    const threadIds = Array.from(byThread.keys()).slice(0, 25);
    const candidates = await Promise.all(
      threadIds.map(async (tid) => {
        try {
          const thread: any = await (gmail as any).getThreadDetails(tid);
          const msgs: any[] = thread.messages || [];
          if (!msgs.length) return null;
          const last = msgs[msgs.length - 1];
          const lastFromHeader = (last.payload?.headers || []).find((h: any) => h.name?.toLowerCase() === 'from')?.value || '';
          const lastFromEmail = parseFromHeader(lastFromHeader).email.toLowerCase();
          // If the latest message is FROM the user, nobody has replied yet — this is a chase candidate.
          if (lastFromEmail !== userEmail.toLowerCase()) return null;
          const firstSubject = (msgs[0].payload?.headers || []).find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '';
          const toHeader = (last.payload?.headers || []).find((h: any) => h.name?.toLowerCase() === 'to')?.value || '';
          const recipient = parseFromHeader(toHeader);
          const internal = Number(last.internalDate) || Date.now();
          const days = Math.floor((Date.now() - internal) / (24 * 60 * 60 * 1000));
          return {
            id: last.id,
            threadId: tid,
            recipient,
            subject: firstSubject || '(no subject)',
            daysSilent: days,
            sentAt: new Date(internal).toISOString(),
            gmailUrl: `https://mail.google.com/mail/u/0/#sent/${tid}`,
          } as ChaseItem;
        } catch {
          logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
          return null;
        }
      }),
    );
    const items = candidates.filter((c): c is ChaseItem => c !== null);
    items.sort((a, b) => b.daysSilent - a.daysSilent);
    return items.slice(0, limit);
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.warn('[home-feed/today] chase fetch failed:', (err as any)?.message);
    // See fetchDecide's comment — must re-throw token expiry so wrap() can set
    // needsReconnect instead of this reading as an honest empty sent folder.
    if (isTokenExpiredErr(err)) throw err;
    return [];
  }
}

async function fetchActionItems(userEmail: string): Promise<ActionItem[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('boult_meeting_events')
      .select('id, title, attendees, event_start, action_items')
      .ilike('user_id', userEmail)
      .not('action_items', 'is', null)
      .order('event_start', { ascending: false })
      .limit(25);
    if (error) {
      if (error.code === '42P01') return []; // table missing — silent
      console.warn('[home-feed/today] action items fetch error:', error.message);
      return [];
    }
    if (!data?.length) return [];

    const now = Date.now();
    const horizonMs = now + ACTION_ITEM_HORIZON_HOURS * 60 * 60 * 1000;
    const items: ActionItem[] = [];

    for (const row of data) {
      const ai = Array.isArray(row.action_items) ? row.action_items : [];
      for (let i = 0; i < ai.length; i++) {
        const a = ai[i];
        if (!a || typeof a.text !== 'string' || !a.text.trim()) continue;
        if (a.done === true) continue;
        const dueMs = a.due_at ? new Date(a.due_at).getTime() : null;
        // Dated items only show when ≤48h away (or overdue). Undated items
        // are surfaced as backlog so the user doesn't forget them.
        if (dueMs !== null && dueMs > horizonMs) continue;
        const isOverdue = dueMs !== null && dueMs < now;
        items.push({
          id: `${row.id}:${i}`,
          text: a.text.slice(0, 200),
          dueAt: a.due_at || null,
          isOverdue,
          meetingTitle: row.title || null,
          attendees: Array.isArray(row.attendees)
            ? row.attendees.map((x: any) => x?.email).filter((e: any) => typeof e === 'string')
            : [],
        });
      }
    }

    items.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (a.dueAt && !b.dueAt) return -1;
      if (!a.dueAt && b.dueAt) return 1;
      return 0;
    });

    return items.slice(0, MAX_ACTION_ITEMS);
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.warn('[home-feed/today] action items fetch failed:', err?.message);
    return [];
  }
}

// "While you were away" — the user's scheduled-agent runs from the last ~14h,
// joined to agent names. This is the spec's core HomeFeed promise: every agent's
// work is visible the moment the founder opens the app. Pure DB read, no LLM.
async function fetchAgentRuns(userEmail: string): Promise<AgentRunItem[]> {
  try {
    const supabase = getSupabaseAdmin();
    const sinceIso = new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString();

    const { data: runs, error } = await supabase
      .from('boult_agent_runs')
      .select('id, agent_id, status, report_summary, tool_calls, completed_at, started_at, artifact_links')
      .eq('user_id', userEmail)
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: false })
      .limit(MAX_AGENT_RUNS);

    // Table not migrated yet, or any error — degrade silently, never break the feed.
    if (error || !runs?.length) return [];

    // Resolve agent names in one query.
    const agentIds = Array.from(new Set(runs.map((r: any) => r.agent_id).filter(Boolean)));
    const nameById = new Map<string, string>();
    if (agentIds.length) {
      const { data: agents } = await supabase
        .from('boult_agents')
        .select('id, name')
        .in('id', agentIds);
      for (const a of (agents || []) as any[]) nameById.set(a.id, a.name);
    }

    const countBucket = (links: any, key: string): number =>
      Array.isArray(links?.[key]) ? links[key].length : 0;

    return (runs as any[]).map((r) => ({
      id: r.id,
      agentName: nameById.get(r.agent_id) || 'Agent',
      status: (r.status as AgentRunItem['status']) || 'success',
      summary: cleanRunSummary(r.report_summary, 160) || null,
      toolCalls: r.tool_calls ?? 0,
      ranAt: r.completed_at || r.started_at,
      artifactCounts: {
        gmail: countBucket(r.artifact_links, 'gmail'),
        calendar: countBucket(r.artifact_links, 'calendar'),
        notion: countBucket(r.artifact_links, 'notion'),
        slack: countBucket(r.artifact_links, 'slack'),
      },
    }));
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.warn('[home-feed/today] agent runs fetch failed:', err?.message);
    return [];
  }
}

// Approval Mode — count the write actions background agents queued for the
// user's sign-off. Pure DB read, fail-soft (0 on any error / missing table).
async function fetchPendingApprovalsCount(userEmail: string): Promise<number> {
  try {
    const supabase = getSupabaseAdmin();
    const { count, error } = await supabase
      .from('boult_agent_pending_actions')
      .select('id', { count: 'exact', head: true })
      .ilike('user_id', userEmail)
      .eq('status', 'pending');
    if (error) return 0;
    return count || 0;
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return 0;
  }
}

// How long a cached snapshot is served before we recompute. The expensive
// Gmail/Calendar build happens on a miss (or via the cron prewarm); within the TTL
// every load is a fast DB read.
const TODAY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Build the full Today snapshot (the expensive Gmail/Calendar fetch). Exported so
 * the cron can prewarm the cache. Does NOT apply dismissals — those are filtered at
 * serve time so a fresh dismiss takes effect even against a cached snapshot.
 */
export async function computeTodaySnapshot(userEmail: string): Promise<TodayResponse> {
  const snapshotStart = Date.now();
  let accessToken: string | null = null;
  try {
    const { getGmailToken, getGcalToken } = await import('@/lib/boult/tools/http-tokens');
    accessToken = (await getGmailToken(userEmail).catch(() => null))
               || (await getGcalToken(userEmail).catch(() => null));
  } catch (e) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    console.error('[home-feed/today] token fetch failed:', e);
  }

  if (!accessToken) {
    const [actionItems, agentRuns, pendingApprovals] = await Promise.all([
      fetchActionItems(userEmail),
      fetchAgentRuns(userEmail),
      fetchPendingApprovalsCount(userEmail),
    ]);
    return {
      decide: [], showUp: [], chase: [], actionItems, agentRuns,
      pendingApprovals: pendingApprovals > 0 ? pendingApprovals : undefined,
      emptyAll: actionItems.length === 0 && agentRuns.length === 0,
      generatedAt: new Date().toISOString(),
      gmailConnected: false, calendarConnected: false,
    };
  }

  const gmail = new GmailService(accessToken, '');
  (gmail as any).setUserEmail?.(userEmail);

  const wrap = async <T,>(fn: () => Promise<T>, tag: 'gmail' | 'calendar'): Promise<{ value: T | null; expired: boolean }> => {
    try {
      return { value: await fn(), expired: false };
    } catch (e: any) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      if (isTokenExpiredErr(e)) {
        try {
          const { markIntegrationNeedsReauth } = await import('@/lib/boult/tools/http-tokens');
          await markIntegrationNeedsReauth(userEmail.toLowerCase(), tag === 'gmail' ? 'gmail' : 'gcal');
        } catch {
          logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });}
        return { value: null, expired: true };
      }
      console.warn(`[home-feed/today] ${tag} fetch failed:`, e?.message);
      return { value: null, expired: false };
    }
  };

  // Gather WIDE candidate pools — the raw material the AI triage selects + ranks
  // from. Decide gets the widest net (judging email importance is the hardest,
  // most valuable call); chase a bit wider too. The fetchers are just the net +
  // the heuristic backstop; the agent does the real selection.
  const DECIDE_CANDIDATES = 18;
  const CHASE_CANDIDATES = 14;
  const SHOWUP_CANDIDATES = 10;
  const [decideR, showUpR, chaseR, actionItems, agentRuns, pendingApprovals] = await Promise.all([
    wrap(() => fetchDecide(gmail, DECIDE_CANDIDATES), 'gmail'),
    wrap(() => fetchShowUp(userEmail, SHOWUP_CANDIDATES), 'calendar'),
    wrap(() => fetchChase(gmail, userEmail, CHASE_CANDIDATES), 'gmail'),
    fetchActionItems(userEmail),
    fetchAgentRuns(userEmail),
    fetchPendingApprovalsCount(userEmail),
  ]);

  const gmailExpired = decideR.expired || chaseR.expired;
  const calendarExpired = showUpR.expired;
  const decidePool = decideR.value?.items || [];
  const decideScanned = decideR.value?.scanned || 0;
  const showUpPool = showUpR.value || [];
  const chasePool = chaseR.value || [];

  // Drop the server-only preview text before an item goes into the response.
  const stripSnippet = (d: DecideItem): DecideItem => { const { snippet, ...rest } = d; return rest; };

  let decide: DecideItem[] = [];
  let showUp: ShowUpItem[] = [];
  let chase: ChaseItem[] = [];
  let briefing: string | undefined;
  let reasoning: string | undefined;
  // DIRECT AI-triage error, surfaced (never masked) when the reasons had to fall
  // to deterministic labels because BOTH the agent AND the enrich pass failed.
  let agentError: string | undefined;
  let aiError: string | undefined;

  // ── AI TRIAGE (primary) — a real, tool-driven agent selects + ranks + reasons
  // over the candidate pools. On ANY failure we fall through to the heuristic
  // top-3 below, so Today never loads worse than the regex baseline.
  let agentOk = false;
  if (decidePool.length || showUpPool.length || chasePool.length) {
    try {
      const { buildTodayViaAgent } = await import('@/lib/boult/today-agent');
      // BUDGET-AWARE DEADLINE — the agent must NEVER consume the whole 60s
      // function budget (maxDuration). LIVE-MEASURED 2026-07-23 on a real inbox:
      // at a flat deadlineMs 45s the agent burned the full 45s, STILL failed to
      // emit JSON (no briefing/reasoning), and the whole compute hit ~48s — right
      // at the cliff where Vercel kills the function BEFORE storeTodaySnapshot
      // runs, so the browser is left on a stale/generic cached snapshot (the
      // reported "AI is generic" bug — the fresh, specific compute never lands).
      // The heuristic + enrichDecideReasons FALLBACK below produces specific
      // reasons reliably in ~1-2s, so we give the agent only a bounded slice of
      // the REMAINING budget and keep a hard reserve for that fallback + the
      // store. When the agent doesn't land in this window we lose the
      // briefing/ranking — never the reason specificity — and the function
      // always finishes in time to cache a fresh, specific snapshot.
      const FN_BUDGET_MS = 52_000;         // stay safely under maxDuration (60s)
      const FALLBACK_RESERVE_MS = 13_000;  // gemma-led enrich (~2s, 10s cap) + store + DB
      const elapsedMs = Date.now() - snapshotStart;
      // TOOL-LESS TRIAGE (maxToolCalls: 0). LIVE-MEASURED 2026-07-23 on a real
      // inbox: with tools the agent NEVER landed (hasBriefing/hasReasoning false)
      // — it hangs on tool-investigation turns through the flaky 550B model and
      // times out, so the whole rich path (briefing, ranking, evidence) was lost
      // and the compute ran ~24-48s. Run it as a single seeded pass instead: it
      // reasons from the 300-char previews already attached to each candidate
      // (enough for triage-grade reasons — the enrich fallback proves that same
      // input yields "Priya needs Q3 budget sign-off before Friday"), lands in one
      // ~3-8s call, and restores the briefing + ranking. Deeper thread reads were
      // never actually happening, so nothing real is lost; the enrich fallback
      // still covers the rare pass that returns nothing.
      const agentDeadlineMs = Math.max(10_000, Math.min(16_000, FN_BUDGET_MS - elapsedMs - FALLBACK_RESERVE_MS));
      const agent = await buildTodayViaAgent(
        userEmail,
        {
          decide: decidePool.map((d) => ({ ...d, snippet: d.snippet || '' })),
          chase: chasePool,
          showUp: showUpPool,
        },
        { deadlineMs: agentDeadlineMs, maxToolCalls: 0 },
      );
      if (agent) {
        decide = agent.decide.map((d) => ({ ...d, snippet: undefined })) as DecideItem[];
        showUp = agent.showUp;
        chase = agent.chase;
        briefing = agent.briefing || undefined;
        reasoning = agent.reasoning || undefined;
        agentOk = true;
      } else {
        agentError = 'Triage agent returned no result (rate-limited / deadline / unparseable)';
      }
    } catch (e: any) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      agentError = `Triage agent — ${e?.message || 'failed'}`;
      console.warn('[home-feed/today] AI triage failed, using heuristics:', e?.message);
    }
  }

  // ── HEURISTIC SAFETY NET — the pre-AI behavior: top-3 by signal order, with the
  // robust OpenRouterAIService reason enrichment on the Decide bucket.
  if (!agentOk) {
    // Hard-drop anything flagged as newsletter/automated BEFORE slicing to the
    // top N. Without this, a quiet inbox with fewer than HEURISTIC_MAX_PER_BUCKET
    // genuine candidates let noise (rank 9, sorted last but still in the pool)
    // fill the remaining "Needs a reply" slots whenever the AI triage path was
    // unavailable — exactly the "why is this newsletter under Needs a reply"
    // failure mode. An empty/shorter bucket is correct; a padded one is not.
    const genuinePool = decidePool.filter((d) => d.reason !== 'Likely newsletter/automated');
    decide = genuinePool.slice(0, HEURISTIC_MAX_PER_BUCKET);
    const snippetById = new Map<string, string>(decide.map((d) => [d.id, d.snippet || '']));
    const enrichErr = await enrichDecideReasons(decide, snippetById);
    // Both AI paths (agent + enrich) failed → reasons are now deterministic
    // labels. Surface the DIRECT error so the founder sees WHY, instead of the
    // heuristic filler silently standing in for real AI reasoning.
    if (enrichErr) aiError = [agentError, enrichErr].filter(Boolean).join(' · ');
    decide = decide.map(stripSnippet);
    showUp = showUpPool.slice(0, HEURISTIC_MAX_PER_BUCKET);
    chase = chasePool.slice(0, HEURISTIC_MAX_PER_BUCKET);
  }

  const needsReconnect = (gmailExpired || calendarExpired)
    ? { gmail: gmailExpired, calendar: calendarExpired }
    : undefined;

  return {
    decide,
    showUp,
    chase,
    actionItems,
    agentRuns,
    emptyAll: decide.length === 0 && showUp.length === 0 && chase.length === 0 && actionItems.length === 0 && agentRuns.length === 0 && !needsReconnect,
    generatedAt: new Date().toISOString(),
    gmailConnected: !gmailExpired,
    calendarConnected: !calendarExpired,
    needsReconnect,
    briefing,
    reasoning,
    aiError,
    // Confidence scale — only meaningful when we actually examined mail.
    triage: decideScanned > 0 ? { scanned: decideScanned, surfaced: decide.length } : undefined,
    pendingApprovals: pendingApprovals > 0 ? pendingApprovals : undefined,
  };
}

/** Persist a freshly-computed snapshot. Exported for the cron prewarm. */
export async function storeTodaySnapshot(userEmail: string, payload: TodayResponse): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    await supabase
      .from('boult_today_cache')
      .upsert({ user_id: userEmail.toLowerCase(), payload, generated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    console.warn('[home-feed/today] cache write failed:', e?.message);
  }
}

async function readTodaySnapshot(supabase: any, userEmail: string): Promise<{ payload: TodayResponse; generatedAt: string } | null> {
  try {
    const { data } = await supabase
      .from('boult_today_cache')
      .select('payload, generated_at')
      .eq('user_id', userEmail.toLowerCase())
      .maybeSingle();
    if (!data?.payload) return null;
    return { payload: data.payload as TodayResponse, generatedAt: data.generated_at };
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return null;
  }
}

async function getDismissedIds(supabase: any, userEmail: string): Promise<Set<string>> {
  try {
    const { data } = await supabase
      .from('boult_today_dismissals')
      .select('item_id')
      .eq('user_id', userEmail.toLowerCase());
    return new Set((data || []).map((r: any) => r.item_id));
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return new Set();
  }
}

function applyDismissals(payload: TodayResponse, dismissed: Set<string>): TodayResponse {
  if (!dismissed.size) return payload;
  const decide = payload.decide.filter((i) => !dismissed.has(i.id));
  const showUp = payload.showUp.filter((i) => !dismissed.has(i.id));
  const chase = payload.chase.filter((i) => !dismissed.has(i.id));
  const actionItems = payload.actionItems.filter((i) => !dismissed.has(i.id));
  return {
    ...payload,
    decide, showUp, chase, actionItems,
    emptyAll: decide.length === 0 && showUp.length === 0 && chase.length === 0 && actionItems.length === 0 && payload.agentRuns.length === 0 && !payload.needsReconnect,
  };
}

export async function GET(req: Request) {
  try {
    // @ts-ignore
    const session = await (auth as any)();
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userEmail = session.user.email as string;

    // STRICT paywall backstop: the dashboard page is fail-closed, but this data
    // endpoint must reject non-payers directly too — otherwise a free/expired user
    // could pull their inbox/calendar by calling the API straight. (Owners + trial
    // pass via assertPaidAccess.)
    const { assertPaidAccess } = await import('@/lib/subscription-protection.js');
    const gate = await assertPaidAccess(userEmail);
    if (!gate.ok) {
      return NextResponse.json({ success: false, error: gate.error, upgradeUrl: gate.upgradeUrl }, { status: gate.status });
    }

    // Make the "handled before you open it" promise real: a paid, Gmail-connected
    // user gets their first overnight agent automatically (idempotent, one-time).
    try {
      const { ensureMorningSweepAgent } = await import('@/lib/boult/ensure-default-agent');
      await ensureMorningSweepAgent(userEmail);
    } catch {
      logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* never block the feed */ }

    const supabase = getSupabaseAdmin();
    const force = new URL(req.url).searchParams.get('refresh') === '1';

    // Read the cached snapshot + current dismissals in parallel.
    const [cached, dismissed] = await Promise.all([
      force ? Promise.resolve(null) : readTodaySnapshot(supabase, userEmail),
      getDismissedIds(supabase, userEmail),
    ]);

    const isFresh = !!cached && (Date.now() - new Date(cached.generatedAt).getTime() < TODAY_CACHE_TTL_MS);

    let payload: TodayResponse;
    if (isFresh) {
      payload = cached!.payload;
    } else {
      payload = await computeTodaySnapshot(userEmail);
      await storeTodaySnapshot(userEmail, payload); // persist for the next reader / device
    }

    // Dismissals are applied at serve time (not baked into the cache) so a swipe
    // takes effect immediately even against a still-fresh cached snapshot.
    const served = applyDismissals(payload, dismissed);
    return NextResponse.json({ success: true, ...served, cached: isFresh });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[home-feed/today] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message || 'Failed to build today surface' }, { status: 500 });
  }
}
