/**
 * Home-feed cross-app signal gathering — the SHARED data layer for the feed.
 *
 * Why this module exists: the five per-app gatherers (Gmail bounces, Calendar,
 * Cal.com, Notion, Slack) were born inside /api/home-feed/recommendations and
 * their output was only ever fed to the "Worth your time" cards + donut — while
 * the feed's best section (the Gmail relationship scan in /conversations) could
 * see nothing but Gmail. The founder's verdict: "relies only on Gmail, shallow,
 * not integrating other apps." This module makes every gatherer shared so the
 * /world synthesis route can FUSE them per person/company.
 *
 * Contracts every gatherer honors (unchanged from their original homes):
 *  - Connection-gated: no token → [] — a disconnected app simply never appears.
 *  - Fail-soft + bounded: errors/timeouts → [], never blocks the others.
 *  - REAL data only: every signal is an actual item from the user's account.
 *
 * New in the move: signals now carry FUSION KEYS — the real email address(es)
 * they concern (`email` / `emails`) — so the world route can join a signal to a
 * person by EXACT email match. Fusion never guesses: no email → the only other
 * accepted join is an exact ≥2-word full-name match, with the evidence shown
 * verbatim on the card.
 */

// @ts-ignore — JS module
import { getSupabaseAdmin } from '@/lib/supabase.js';
// @ts-ignore — JS module
import { CalComService } from '@/lib/calcom.js';
import { getGmailToken, getGcalToken, getNotionToken, getSlackToken, googleFetch } from '@/lib/arcus/tools/http-tokens';
import { logEvent } from '@/lib/logsso';
import type { BriefingPrefs } from '@/lib/arcus/briefing-prefs';

// ── Shared shapes ─────────────────────────────────────────────────────────────

export type GatheredKind = 'bounce' | 'meeting' | 'booking' | 'notion' | 'slack';

export interface GatheredSignal {
  kind: GatheredKind;
  /** Display label (a person's name, a page/meeting title). */
  label: string;
  /** One-line real-data description, safe to show or feed to the LLM. */
  detail: string;
  /** Kind-specific magnitude (days silent / days stale / overdue flag). */
  metric?: number;
  /** FUSION KEY — the exact email this signal concerns, when the source has one. */
  email?: string;
  /** FUSION KEYS — attendee emails (calendar events have several). */
  emails?: string[];
  /** When the underlying thing happens/happened (ISO), when the source has one. */
  whenIso?: string;
  /** Calendar-only: the event has no agenda/description set. */
  noAgenda?: boolean;
}

/** A per-counterparty Gmail relationship — the spine the world route fuses onto. */
export interface RelationshipThread {
  key: string;              // counterparty email, lowercased
  name: string;
  email: string;
  subject: string;          // latest subject, Re:/Fwd: stripped
  snippet: string;          // latest message preview (≤200 chars)
  status: 'awaiting_you' | 'waiting_on_them' | 'active';
  lastActivityIso: string;
  daysSince: number;
  fromThem: boolean;        // was the latest message inbound?
  messageCount: number;
}

// ── Small shared helpers ──────────────────────────────────────────────────────

export function clampStr(v: any, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Display-clean a person name (strip emails to local part, Title-Case). */
export function cleanName(raw: any): string {
  let s = clampStr(raw, 80).replace(/^["'<]+|["'>]+$/g, '').trim();
  if (!s) return '';
  if (s.includes('@')) s = s.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return s
    .split(/\s+/)
    .map(w => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

export function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

function firstEmail(text: string): string {
  const m = (text || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : '';
}

const FETCH_TIMEOUT_MS = 3500;

// ── Gmail: bounced sends (last 5 days) ────────────────────────────────────────

export async function gatherGmailBounces(userEmail: string): Promise<GatheredSignal[]> {
  const token = await getGmailToken(userEmail);
  if (!token) return [];
  const auth = { Authorization: `Bearer ${token}` };
  const q = encodeURIComponent('(from:mailer-daemon OR subject:"Delivery Status Notification" OR subject:"Undelivered") newer_than:5d');
  const listRes = await googleFetch(userEmail, 'gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=4`, { headers: auth });
  if (!listRes.ok) return [];
  const list = await listRes.json();
  const ids: string[] = (list.messages || []).map((m: any) => m.id).slice(0, 3);
  const msgs = await Promise.all(ids.map(async (id) => {
    try {
      const r = await googleFetch(userEmail, 'gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject`, { headers: auth });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      logEvent({ channel: 'failures', event: '❌ API Error', description: 'Unknown error' }); return null; }
  }));
  const out: GatheredSignal[] = [];
  const seen = new Set<string>();
  for (const m of msgs) {
    const failed = firstEmail(m?.snippet || '');
    if (!failed || failed.includes('mailer-daemon') || seen.has(failed)) continue;
    seen.add(failed);
    out.push({
      kind: 'bounce',
      label: failed,
      detail: `Your email to ${failed} bounced (delivery failed) — likely a bad or mistyped address`,
      email: failed.toLowerCase(),
    });
  }
  return out;
}

// ── Google Calendar: upcoming meetings (next 2 days) with attendee emails ─────
// Returns ALL real meetings-with-people in the window (fusion needs every one),
// each flagged with noAgenda. The recommendations-compatible subset (agenda-less
// Meet calls only) is derived by gatherCalendarPrep below.

export async function gatherCalendarMeetings(userEmail: string): Promise<GatheredSignal[]> {
  const token = await getGcalToken(userEmail);
  if (!token) return [];
  const now = new Date();
  const end = new Date(now.getTime() + 2 * 86_400_000);
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=12`;
  const res = await googleFetch(userEmail, 'gcal', url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  const me = userEmail.toLowerCase();
  const out: GatheredSignal[] = [];
  for (const ev of (data.items || [])) {
    if (out.length >= 8) break;
    if (!ev.start?.dateTime) continue;          // skip all-day
    const attendees: any[] = ev.attendees || [];
    if (attendees.length === 0) continue;       // skip solo blocks
    const emails = attendees
      .map((a: any) => String(a?.email || '').toLowerCase())
      .filter((e: string) => e && e !== me);
    const hasMeet = !!(ev.hangoutLink || ev.conferenceData?.entryPoints?.some((e: any) => e.entryPointType === 'video'));
    const hasAgenda = !!(ev.description && String(ev.description).trim().length > 20);
    const when = new Date(ev.start.dateTime).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    const title = clampStr(ev.summary, 80) || 'A meeting';
    out.push({
      kind: 'meeting',
      label: title,
      detail: `${hasMeet ? 'Google Meet ' : ''}"${title}" at ${when}, ${attendees.length} attendees${hasAgenda ? '' : ' — no agenda set'}`,
      emails,
      whenIso: ev.start.dateTime,
      noAgenda: hasMeet && !hasAgenda,
    });
  }
  return out;
}

/** The original recommendations-facing subset: Meet calls with NO agenda (≤3). */
export async function gatherCalendarPrep(userEmail: string): Promise<GatheredSignal[]> {
  const all = await gatherCalendarMeetings(userEmail);
  return all.filter(s => s.noAgenda).slice(0, 3);
}

// ── Cal.com: upcoming bookings (next 7 days) ──────────────────────────────────

async function getCalClientLocal(userEmail: string): Promise<any | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase.from('integration_credentials').select('access_token').eq('user_email', userEmail.toLowerCase()).eq('provider', 'cal_com').maybeSingle();
    const k = (data?.access_token || '').trim();
    if (k) return new CalComService(k);
  } catch {
    logEvent({ channel: 'failures', event: '❌ API Error', description: 'Unknown error' }); /* fall through */ }
  const shared = (process.env.CAL_API_KEY || '').trim();
  return (shared && process.env.CAL_ALLOW_SHARED_KEY === 'true') ? new CalComService(shared) : null;
}

export async function gatherCalcom(userEmail: string): Promise<GatheredSignal[]> {
  const cal = await getCalClientLocal(userEmail);
  if (!cal) return [];
  let bookings: any[] = [];
  try { bookings = await raceTimeout(cal.getBookings(), FETCH_TIMEOUT_MS); } catch {
    logEvent({ channel: 'failures', event: '❌ API Error', description: 'Unknown error' }); return []; }
  if (!Array.isArray(bookings)) return [];
  const now = Date.now();
  const horizon = now + 7 * 86_400_000;
  const upcoming = bookings
    .filter((b) => { const t = new Date(b.startTime || b.start).getTime(); return Number.isFinite(t) && t > now && t < horizon && (b.status || 'accepted') !== 'cancelled'; })
    .sort((a, b) => new Date(a.startTime || a.start).getTime() - new Date(b.startTime || b.start).getTime())
    .slice(0, 3);
  return upcoming.map((b) => {
    const attendeeEmail = String(b.attendees?.[0]?.email || '').toLowerCase();
    const who = cleanName(b.attendees?.[0]?.name || b.attendees?.[0]?.email) || 'someone';
    const startIso = b.startTime || b.start;
    const when = new Date(startIso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return {
      kind: 'booking' as const,
      label: who,
      detail: `Cal.com booking "${clampStr(b.title, 80) || 'Meeting'}" with ${who} on ${when} (${b.status || 'accepted'})`,
      email: attendeeEmail || undefined,
      whenIso: typeof startIso === 'string' ? startIso : undefined,
    };
  });
}

// ── Notion: most recently edited pages ────────────────────────────────────────

function notionTitle(page: any): string {
  const props = page?.properties || {};
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p?.type === 'title' && Array.isArray(p.title)) {
      const t = p.title.map((x: any) => x?.plain_text || '').join('').trim();
      if (t) return t;
    }
  }
  return '';
}

export async function gatherNotion(userEmail: string): Promise<GatheredSignal[]> {
  const token = await getNotionToken(userEmail);
  if (!token) return [];
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify({ filter: { property: 'object', value: 'page' }, sort: { direction: 'descending', timestamp: 'last_edited_time' }, page_size: 6 }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const out: GatheredSignal[] = [];
  for (const p of (data.results || [])) {
    if (out.length >= 3) break;
    const title = notionTitle(p);
    if (!title) continue;
    const days = daysSince(p.last_edited_time);
    out.push({
      kind: 'notion',
      label: clampStr(title, 80),
      detail: `Notion page "${clampStr(title, 80)}" — last edited ${days}d ago`,
      metric: days,
    });
  }
  return out;
}

// ── Slack: DMs awaiting the user's reply ──────────────────────────────────────
// Now also resolves the sender's PROFILE EMAIL (users.info returns it when the
// scope allows) — the fusion key that lets a Slack ping join the same person's
// email thread on a world card.

export async function gatherSlack(userEmail: string): Promise<GatheredSignal[]> {
  const token = await getSlackToken(userEmail);
  if (!token) return [];
  const auth = { Authorization: `Bearer ${token}` };
  let myId = '';
  try {
    const a = await (await fetch('https://slack.com/api/auth.test', { method: 'POST', headers: auth, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })).json();
    if (!a.ok) return [];
    myId = a.user_id;
  } catch {
    logEvent({ channel: 'failures', event: '❌ API Error', description: 'Unknown error' }); return []; }
  let ims: any;
  try {
    ims = await (await fetch('https://slack.com/api/conversations.list?types=im&limit=20', { headers: auth, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })).json();
  } catch {
    logEvent({ channel: 'failures', event: '❌ API Error', description: 'Unknown error' }); return []; }
  if (!ims?.ok) return [];
  const channels = (ims.channels || []).slice(0, 6);
  const checked = await Promise.all(channels.map(async (ch: any) => {
    try {
      const h = await (await fetch(`https://slack.com/api/conversations.history?channel=${ch.id}&limit=1`, { headers: auth, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })).json();
      const last = h?.messages?.[0];
      if (last && last.user && last.user !== myId && !last.bot_id) {
        return { user: ch.user || last.user, text: String(last.text || '').replace(/<[^>]+>/g, '').trim() };
      }
    } catch {
      logEvent({ channel: 'failures', event: '❌ API Error', description: 'Unknown error' }); /* ignore */ }
    return null;
  }));
  const waiting = checked.filter(Boolean).slice(0, 3) as Array<{ user: string; text: string }>;
  if (!waiting.length) return [];
  const named = await Promise.all(waiting.map(async (w) => {
    try {
      const u = await (await fetch(`https://slack.com/api/users.info?user=${w.user}`, { headers: auth, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })).json();
      const name = u?.user?.real_name || u?.user?.profile?.display_name || '';
      const email = String(u?.user?.profile?.email || '').toLowerCase();
      return { name: cleanName(name) || 'A teammate', email: email || undefined, text: w.text };
    } catch {
      logEvent({ channel: 'failures', event: '❌ API Error', description: 'Unknown error' }); return { name: 'A teammate', email: undefined as string | undefined, text: w.text }; }
  }));
  return named.map((n) => ({
    kind: 'slack' as const,
    label: n.name,
    detail: `Slack DM from ${n.name} is waiting on your reply: "${n.text.slice(0, 90)}"`,
    email: n.email,
  }));
}

// ── Gather everything the user has enabled, in parallel ───────────────────────
// `calendarFull: true` (the /world route) gets ALL upcoming meetings for fusion;
// default keeps the original recommendations behavior (agenda-less prep subset).

export async function gatherServerSignals(
  userEmail: string,
  apps: BriefingPrefs['apps'],
  opts: { calendarFull?: boolean } = {},
): Promise<GatheredSignal[]> {
  const tasks: Promise<GatheredSignal[]>[] = [];
  if (apps.gmail) tasks.push(gatherGmailBounces(userEmail));
  if (apps.calendar) tasks.push(opts.calendarFull ? gatherCalendarMeetings(userEmail) : gatherCalendarPrep(userEmail));
  if (apps.calcom) tasks.push(gatherCalcom(userEmail));
  if (apps.notion) tasks.push(gatherNotion(userEmail));
  if (apps.slack) tasks.push(gatherSlack(userEmail));
  const results = await Promise.allSettled(tasks);
  const out: GatheredSignal[] = [];
  for (const r of results) if (r.status === 'fulfilled' && Array.isArray(r.value)) out.push(...r.value);
  return out;
}

// ── Gmail relationship scan (moved from /api/home-feed/conversations) ─────────
// The spine of the world view: per-counterparty threads with real humans over
// the last 30 days, statused by who spoke last and how long ago.

const NOISE_RE = /(no[-_.]?reply|do[-_.]?not[-_.]?reply|notification|mailer-daemon|postmaster|updates?@|newsletter|digest|team@|hello@|support@|billing@|receipts?@|via\b|automated|@.*\.(mailchimp|substack|beehiiv|sendgrid|mailgun|intercom|zendesk)\b)/i;

function parseFrom(header: string): { name: string; email: string } {
  const m = header.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/) || header.match(/^\s*([^<>@\s]+@[^<>@\s]+)\s*$/);
  if (!m) return { name: header.trim(), email: '' };
  if (m.length === 3) return { name: (m[1] || '').trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: m[1].trim().toLowerCase() };
}

function displayName(name: string, email: string): string {
  const n = (name || '').trim().replace(/^["']|["']$/g, '');
  if (n && !/@/.test(n)) return n.split(/\s+/).slice(0, 2).join(' ');
  const local = (email || '').split('@')[0] || 'Someone';
  return local.split(/[._-]/).map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ').trim() || 'Someone';
}

export async function gatherGmailRelationships(email: string, maxThreads = 8): Promise<RelationshipThread[]> {
  const token = await getGmailToken(email);
  if (!token) return [];
  const headers = { Authorization: `Bearer ${token}` };
  const me = email.toLowerCase();

  const q = encodeURIComponent('in:inbox OR in:sent newer_than:30d -category:promotions -category:social -category:forums -category:updates');
  const listRes = await googleFetch(email, 'gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=40`, { headers });
  if (!listRes.ok) return [];
  const list = await listRes.json();
  const ids: string[] = (list.messages || []).map((m: any) => m.id).slice(0, 40);
  if (!ids.length) return [];

  const msgs = await Promise.all(ids.map(async (id) => {
    try {
      const r = await googleFetch(email, 'gmail',
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }));

  // Group by the OTHER party. For inbound: the From. For outbound (from me): the To.
  const byParty = new Map<string, RelationshipThread & { _ts: number }>();
  for (const m of msgs) {
    if (!m?.payload?.headers) continue;
    const h: any[] = m.payload.headers;
    const get = (n: string) => (h.find(x => x.name?.toLowerCase() === n.toLowerCase())?.value || '');
    const from = parseFrom(get('From'));
    const toRaw = get('To');
    const subject = get('Subject').replace(/^(re|fwd?):\s*/i, '').trim() || '(no subject)';
    const ts = Number(m.internalDate) || new Date(get('Date')).getTime() || 0;
    const snippet = (m.snippet || '').trim();

    const outbound = from.email === me || (!from.email && !toRaw.includes(me));
    const party = outbound ? parseFrom(toRaw.split(',')[0] || '') : from;
    if (!party.email || party.email === me) continue;
    if (NOISE_RE.test(party.email) || NOISE_RE.test(party.name)) continue;

    const key = party.email;
    const prev = byParty.get(key);
    const entry: RelationshipThread & { _ts: number } = {
      key,
      name: displayName(party.name, party.email),
      email: party.email,
      subject,
      snippet: snippet.slice(0, 200),
      status: 'active',
      lastActivityIso: new Date(ts).toISOString(),
      daysSince: Math.max(0, Math.round((Date.now() - ts) / 86400000)),
      fromThem: !outbound,
      messageCount: 1,
      _ts: ts,
    };
    if (!prev) {
      byParty.set(key, entry);
    } else {
      prev.messageCount += 1;
      if (ts > prev._ts) {
        prev._ts = ts;
        prev.subject = subject;
        prev.snippet = snippet.slice(0, 200);
        prev.lastActivityIso = entry.lastActivityIso;
        prev.daysSince = entry.daysSince;
        prev.fromThem = entry.fromThem;
      }
    }
  }

  const threads = [...byParty.values()].map(c => {
    const status: RelationshipThread['status'] = c.fromThem
      ? (c.daysSince <= 10 ? 'awaiting_you' : 'active')   // they wrote last, still warm → on you
      : (c.daysSince >= 2 ? 'waiting_on_them' : 'active'); // you wrote last, no reply yet
    const { _ts, ...rest } = c;
    return { ...rest, status };
  });

  threads.sort((a, b) => {
    const rank = (s: RelationshipThread['status']) => (s === 'awaiting_you' ? 2 : s === 'waiting_on_them' ? 1 : 0);
    if (rank(b.status) !== rank(a.status)) return rank(b.status) - rank(a.status);
    if (b.messageCount !== a.messageCount) return b.messageCount - a.messageCount;
    return new Date(b.lastActivityIso).getTime() - new Date(a.lastActivityIso).getTime();
  });

  return threads.slice(0, maxThreads);
}
