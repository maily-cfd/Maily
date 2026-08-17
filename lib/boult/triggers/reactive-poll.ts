/**
 * Reactive trigger source (Phase 1 — no Pub/Sub).
 *
 * For an agent whose trigger_type is 'event' or 'condition', this reads the
 * agent's source (Gmail or Google Calendar) over a window derived from its
 * conditions, normalizes each item, and evaluates the agent's conditions. It
 * returns whether the agent should fire this tick plus the NEW matching items
 * (ids not already in agent_state.processed_event_ids) so the cron can fire the
 * run and persist state.
 *
 * The calendar source fires on NEWLY-BOOKED meetings — an event whose `created`
 * timestamp is inside the booking window and whose id we haven't processed yet —
 * which is the "add that / a meeting got booked" trigger.
 *
 * Design rules:
 *  - FAILS OPEN: any error → { shouldFire:false } (never crash the cron tick).
 *  - DEBOUNCED: respects trigger_config.debounce_min and agent_state.last_fired_at.
 *  - CHEAP: capped fetch, metadata-only; the cron only calls this for event
 *    agents that are actually due (last_run_at older than debounce).
 */
// @ts-ignore - JS module
import { DatabaseService } from '../../supabase.js';
// @ts-ignore - TS module without type exports we rely on
import { GmailService } from '../../gmail';
import { CalendarService } from '../../calendar';
// @ts-ignore - JS module
import { decrypt } from '../../crypto.js';
import { evaluateConditions, parseAmount, type Condition, type NormalizedItem } from '../conditions';

export interface ReactiveAgent {
  id: string;
  user_id: string;
  trigger_type: string;
  trigger_config?: Record<string, any> | null;
  conditions?: Condition[] | null;
  agent_state?: Record<string, any> | null;
}

export interface MatchedEvent {
  id: string;
  signal: string;
  summary: string; // one-line for the run record / report
}

export interface ReactiveResult {
  shouldFire: boolean;
  matchedEvents: MatchedEvent[];
  /** New processed ids to merge into agent_state (capped by the caller). */
  newProcessedIds: string[];
}

const NO_FIRE: ReactiveResult = { shouldFire: false, matchedEvents: [], newProcessedIds: [] };
const MAX_LIST = 25;       // ids fetched from Gmail list
const MAX_DETAILS = 15;    // metadata reads (cost cap per agent per tick)
const PROCESSED_CAP = 200; // bound agent_state growth (enforced by caller)

function debounceMin(agent: ReactiveAgent): number {
  const n = Number(agent.trigger_config?.debounce_min);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

/** Window (days) to scan. Conditions with age_days gte widen it; else ~2 days. */
function lookbackDays(conditions: Condition[]): number {
  let days = 2;
  for (const c of conditions) {
    if (c.field === 'age_days' && (c.op === 'gte' || c.op === 'eq')) {
      const v = Number(c.value);
      if (Number.isFinite(v)) days = Math.max(days, v + 2);
    }
  }
  return Math.min(days, 30);
}

/** Build a cheap Gmail query from conditions to shrink the result set. */
function gmailQuery(conditions: Condition[], days: number): string {
  const parts = [`in:inbox`, `newer_than:${days}d`];
  for (const c of conditions) {
    if (c.field === 'domain' && (c.op === 'contains' || c.op === 'eq')) {
      parts.push(`from:${String(c.value).replace(/^@/, '')}`);
    } else if (c.field === 'sender' && c.op === 'eq') {
      parts.push(`from:${c.value}`);
    } else if (c.field === 'subject' && c.op === 'contains') {
      parts.push(`subject:(${c.value})`);
    }
  }
  return parts.join(' ');
}

function ageDaysFromHeader(dateHeader: string): number | undefined {
  const t = Date.parse(dateHeader);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

async function resolveGmail(userId: string): Promise<InstanceType<typeof GmailService> | null> {
  try {
    const db = new DatabaseService();
    const t = await db.getUserTokens(userId);
    if (!t?.encrypted_access_token) return null;
    const accessToken = decrypt(t.encrypted_access_token);
    const refreshToken = t.encrypted_refresh_token ? decrypt(t.encrypted_refresh_token) : '';
    const gmail = new GmailService(accessToken, refreshToken);
    gmail.setUserEmail?.(userId);
    return gmail;
  } catch {
    return null;
  }
}

export async function checkEventAgents(agent: ReactiveAgent): Promise<ReactiveResult> {
  if (agent.trigger_type !== 'event' && agent.trigger_type !== 'condition') return NO_FIRE;

  // Debounce against last fire.
  const lastFired = agent.agent_state?.last_fired_at ? Date.parse(agent.agent_state.last_fired_at) : 0;
  if (lastFired && Date.now() - lastFired < debounceMin(agent) * 60_000) return NO_FIRE;

  const source = (agent.trigger_config?.event_source || 'gmail').toString();
  if (source === 'calendar') return checkCalendarAgent(agent);
  // Other sources (notion/slack) fall through to no-fire (Phase 2).
  if (source !== 'gmail') return NO_FIRE;
  return checkGmailAgent(agent);
}

async function checkGmailAgent(agent: ReactiveAgent): Promise<ReactiveResult> {
  const gmail = await resolveGmail(agent.user_id);
  if (!gmail) return NO_FIRE; // fail open — no Gmail token

  const conditions = Array.isArray(agent.conditions) ? agent.conditions : [];
  const days = lookbackDays(conditions);
  const processed = new Set<string>(Array.isArray(agent.agent_state?.processed_event_ids) ? agent.agent_state!.processed_event_ids : []);

  try {
    const list = await gmail.getEmails(MAX_LIST, gmailQuery(conditions, days), null);
    const messages: any[] = Array.isArray(list?.messages) ? list.messages : [];
    if (!messages.length) return NO_FIRE;

    const matched: MatchedEvent[] = [];
    const newIds: string[] = [];

    for (const msg of messages.slice(0, MAX_DETAILS)) {
      const key = msg.threadId || msg.id;
      if (!key || processed.has(key)) continue;
      let parsed: any;
      try {
        const details = await gmail.getEmailDetails(msg.id, 'metadata');
        parsed = gmail.parseEmailData(details);
      } catch { continue; }

      const from = (parsed.from || '').toLowerCase();
      const senderMatch = from.match(/<([^<>]+@[^<>]+)>/) || from.match(/([\w.+-]+@[\w-]+\.[\w.-]+)/);
      const sender = senderMatch?.[1] || '';
      const text = `${parsed.subject || ''} ${parsed.snippet || ''}`;
      const item: NormalizedItem = {
        id: key,
        source: 'gmail',
        sender,
        domain: sender.split('@')[1] || '',
        subject: (parsed.subject || '').toLowerCase(),
        snippet: (parsed.snippet || '').toLowerCase(),
        amount: parseAmount(text),
        ageDays: ageDaysFromHeader(parsed.date || ''),
        raw: text,
      };

      const { match, matchedSignal } = evaluateConditions(conditions, item);
      if (!match) continue;
      newIds.push(key);
      matched.push({
        id: key,
        signal: matchedSignal,
        summary: `${parsed.from || sender || 'someone'} — ${parsed.subject || '(no subject)'}`,
      });
    }

    if (!matched.length) return NO_FIRE;
    return { shouldFire: true, matchedEvents: matched, newProcessedIds: newIds };
  } catch {
    return NO_FIRE; // fail open
  }
}

async function resolveCalendar(userId: string): Promise<CalendarService | null> {
  try {
    const db = new DatabaseService();
    const t = await db.getUserTokens(userId);
    if (!t?.encrypted_access_token) return null;
    const accessToken = decrypt(t.encrypted_access_token);
    const refreshToken = t.encrypted_refresh_token ? decrypt(t.encrypted_refresh_token) : '';
    return new CalendarService(accessToken, refreshToken);
  } catch {
    return null;
  }
}

/** How recently (days) an event must have been BOOKED to count as a new trigger. */
function bookingWindowDays(agent: ReactiveAgent): number {
  const n = Number(agent.trigger_config?.booked_within_days);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 14) : 2;
}

/**
 * Calendar reactive source — fires on newly-booked meetings. Scans events from
 * yesterday through the next ~60 days (so it catches a meeting booked for any
 * near-future date), and treats one as NEW when its `created` time is inside the
 * booking window and its id isn't already processed. Conditions evaluate against
 * subject/organizer/attendees just like Gmail items.
 */
async function checkCalendarAgent(agent: ReactiveAgent): Promise<ReactiveResult> {
  const cal = await resolveCalendar(agent.user_id);
  if (!cal) return NO_FIRE; // fail open — no Google token / calendar scope

  const conditions = Array.isArray(agent.conditions) ? agent.conditions : [];
  const processed = new Set<string>(Array.isArray(agent.agent_state?.processed_event_ids) ? agent.agent_state!.processed_event_ids : []);
  const bookedSinceMs = Date.now() - bookingWindowDays(agent) * 86_400_000;

  try {
    const timeMin = new Date(Date.now() - 86_400_000).toISOString();      // yesterday
    const timeMax = new Date(Date.now() + 60 * 86_400_000).toISOString(); // +60 days
    const events = await cal.listEvents({ timeMin, timeMax, maxResults: MAX_LIST });
    if (!Array.isArray(events) || !events.length) return NO_FIRE;

    const matched: MatchedEvent[] = [];
    const newIds: string[] = [];

    for (const ev of events.slice(0, MAX_DETAILS)) {
      const id = ev.id;
      if (!id || processed.has(id) || ev.status === 'cancelled') continue;
      // Only fire on meetings booked recently — not the backlog of existing events.
      const createdMs = ev.created ? Date.parse(ev.created) : NaN;
      if (!Number.isFinite(createdMs) || createdMs < bookedSinceMs) continue;

      const organizer = (ev.organizer?.email || '').toLowerCase();
      const attendees = Array.isArray(ev.attendees)
        ? ev.attendees.map((a: any) => String(a?.email || '').toLowerCase()).filter(Boolean)
        : [];
      const startStr = ev.start?.dateTime || ev.start?.date || '';
      const text = `${ev.summary || ''} ${ev.description || ''}`;
      const item: NormalizedItem = {
        id,
        source: 'calendar',
        sender: organizer,
        domain: organizer.split('@')[1] || '',
        subject: (ev.summary || '').toLowerCase(),
        snippet: (ev.description || '').toLowerCase(),
        amount: parseAmount(text),
        ageDays: Number.isFinite(createdMs) ? Math.max(0, Math.floor((Date.now() - createdMs) / 86_400_000)) : undefined,
        attendees,
        raw: text,
      };

      const { match, matchedSignal } = evaluateConditions(conditions, item);
      if (!match) continue;
      newIds.push(id);
      const when = startStr ? new Date(startStr).toLocaleString() : 'unscheduled';
      matched.push({
        id,
        signal: matchedSignal,
        summary: `Meeting booked: ${ev.summary || '(no title)'} — ${when}`,
      });
    }

    if (!matched.length) return NO_FIRE;
    return { shouldFire: true, matchedEvents: matched, newProcessedIds: newIds };
  } catch {
    return NO_FIRE; // fail open
  }
}

/** Merge new processed ids into the prior list, newest-first, capped. */
export function mergeProcessedIds(prior: unknown, addIds: string[]): string[] {
  const old = Array.isArray(prior) ? prior.map(String) : [];
  const merged = [...addIds, ...old.filter(id => !addIds.includes(id))];
  return merged.slice(0, PROCESSED_CAP);
}
