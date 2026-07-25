/**
 * GET /api/home-feed/world — the cross-app synthesis engine ("Your world").
 *
 * WHY: the founder's verdict on the old feed — "displays tasks completed by
 * Mailient rather than those performed by the user … relies only on Gmail,
 * shallow, not integrating other apps." The one loved section (Key
 * conversations) was Gmail-only, while the five cross-app gatherers' output was
 * wasted on a donut. This route is the fix: it takes the Gmail relationship
 * spine and FUSES every connected app's real signals onto each person, so a
 * relationship renders as a living thing — "Acme: email quiet 8d · meets Thu
 * 2pm · Slack ping waiting · your last email bounced" — and computes which of
 * them are genuinely AT RISK (the "What's slipping" lane), ranked by
 * cost-to-miss.
 *
 * ACCURACY RULES (the codebase's standing doctrine):
 *  - Fusion NEVER guesses. A signal joins a person only by (a) exact email
 *    match, or (b) an exact ≥2-word full-name containment (e.g. Notion page
 *    "Acme — Sarah Chen proposal" ↔ "Sarah Chen"), where the evidence string is
 *    shown verbatim on the card so the user can verify the join at a glance.
 *  - Every number/date/status is computed from real fetched data.
 *  - The AI pass ONLY rephrases the per-person one-liner from facts we hand it;
 *    on failure the response carries `aiError` (surfaced in the UI — founder
 *    directive: direct errors, no masking fallbacks) while the cards keep their
 *    deterministic real-fact lines (data, not filler).
 *
 * CACHE: arcus_today_cache under `${email}::world`, 15-min TTL, ?refresh=1
 * busts. Same table/pattern as the old ::convos cache it supersedes.
 */

import { NextResponse } from 'next/server';
// @ts-ignore — JS module
import { auth as nextAuth } from '@/lib/auth.js';
// @ts-ignore — JS module
import { getSupabaseAdmin } from '@/lib/supabase.js';
import { assertPaidAccess } from '@/lib/subscription-protection.js';
import { getBriefingPrefs } from '@/lib/arcus/briefing-prefs';
import {
  gatherGmailRelationships, gatherServerSignals,
  type GatheredSignal, type RelationshipThread,
} from '@/lib/home-feed/gather';
import { logEvent } from '@/lib/logsso';

const auth: any = nextAuth;
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_ENTITIES = 8;

export type WorldApp = 'gmail' | 'calendar' | 'notion' | 'slack' | 'calcom';

/** What kind of relationship this is — inferred ONLY from a clear keyword signal
 *  in the real thread text, never from a name/guess. Undefined = no badge shown. */
export type RelationshipKind = 'investor' | 'candidate' | 'customer' | 'lead' | 'vendor' | 'press';

export interface WorldAppChip {
  app: WorldApp;
  /** Short real-fact chip text ("quiet 8d", "Thu 2:00 PM", "page stale 12d"). */
  label: string;
  /** The full evidence line (the gatherer's `detail`) — tooltip/verification. */
  evidence: string;
}

export interface WorldEntry {
  key: string;
  name: string;
  email: string;
  status: 'awaiting_you' | 'waiting_on_them' | 'meeting_booked' | 'active';
  /** Latest thread subject — what this relationship is about right now. */
  headline: string;
  /** One-liner: why this deserves attention now. AI-sharpened; deterministic real-fact base. */
  whyNow: string;
  /** Inferred relationship kind (grounded in thread keywords) — a card badge. */
  kind?: RelationshipKind;
  /** Verbatim "receipts" from the latest message — the actual ask, promise, date,
   *  or amount. This is the depth: the card shows what was really said. */
  receipts?: string[];
  /** Per-app fused chips — the cross-app life of this relationship. */
  apps: WorldAppChip[];
  atRisk: boolean;
  /** 0-100 cost-to-miss. Only meaningful when atRisk. */
  riskScore: number;
  /** The concrete reason it's slipping — built from the contributing real facts. */
  riskReason?: string;
  daysSince: number;
  lastActivityIso: string;
  messageCount: number;
  /** Handed to Arcus via the arcus_prefill flow on click. */
  nextAction: string;
}

interface WorldPayload {
  entities: WorldEntry[];
  /** The atRisk subset, sorted by riskScore desc — the "What's slipping" lane. */
  slipping: WorldEntry[];
  /** Which apps contributed at least one fused chip (drives the section sub-line). */
  appsPresent: WorldApp[];
  generatedAt: string;
  aiError?: string;
}

// ── Fusion ────────────────────────────────────────────────────────────────────

const SIGNAL_APP: Record<GatheredSignal['kind'], WorldApp> = {
  bounce: 'gmail', meeting: 'calendar', booking: 'calcom', notion: 'notion', slack: 'slack',
};

function shortWhen(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function chipFor(s: GatheredSignal): WorldAppChip {
  switch (s.kind) {
    case 'bounce':  return { app: 'gmail',    label: 'email bounced', evidence: s.detail };
    case 'meeting': return { app: 'calendar', label: `${shortWhen(s.whenIso)}${s.noAgenda ? ' · no agenda' : ''}`, evidence: s.detail };
    case 'booking': return { app: 'calcom',   label: shortWhen(s.whenIso) || 'booking', evidence: s.detail };
    case 'notion':  return { app: 'notion',   label: `page ${s.metric ?? 0}d old`, evidence: s.detail };
    case 'slack':   return { app: 'slack',    label: 'DM waiting', evidence: s.detail };
  }
}

/** Exact ≥2-word full-name containment — the ONLY non-email join we accept. */
function nameMatches(entityName: string, text: string): boolean {
  const n = entityName.trim().toLowerCase();
  if (n.split(/\s+/).length < 2) return false;
  return text.toLowerCase().includes(n);
}

function findEntityFor(
  s: GatheredSignal,
  byEmail: Map<string, WorldEntry>,
  entities: WorldEntry[],
): WorldEntry | null {
  if (s.email && byEmail.has(s.email)) return byEmail.get(s.email)!;
  if (s.emails?.length) {
    for (const e of s.emails) if (byEmail.has(e)) return byEmail.get(e)!;
  }
  // Name containment: the signal's label/detail carries the entity's full name
  // (Notion page titles, Slack display names without a profile email).
  const hay = `${s.label} ${s.detail}`;
  for (const ent of entities) {
    if (nameMatches(ent.name, hay)) return ent;
  }
  return null;
}

// ── Depth: receipts + relationship kind (verbatim, grounded, conservative) ────

/** Pull up to 3 concrete "receipts" from the latest message body — the real asks,
 *  questions, commitments, dates and amounts, verbatim (lightly trimmed). This is
 *  what turns a generic "quiet 8d" card into "he asked for the revised proposal".
 *  Never paraphrased, never invented — if the body is empty, returns []. */
function extractReceipts(thread: RelationshipThread): string[] {
  const text = (thread.content || '').replace(/[ \t]+/g, ' ').trim();
  if (!text) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim().replace(/^["'>*\-\s]+/, ''))
    .filter(s => s.length >= 12 && s.length <= 170);
  const picked: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => { const k = s.toLowerCase(); if (!seen.has(k) && picked.length < 3) { seen.add(k); picked.push(s); } };

  // 1) Direct asks / questions aimed at the reader — the highest-signal receipts.
  for (const s of sentences)
    if (/\?$/.test(s) || /\b(can you|could you|would you|can we|could we|please|let me know|need(ed)? (you|your)|waiting (for|on)|send (me|over|the|us)|share the|get (me|us) the|looking for)\b/i.test(s)) add(s);
  // 2) Commitments — what someone promised, and by when.
  for (const s of sentences)
    if (/\b(i'?ll|i will|we'?ll|we will|i can have|we can have|by (mon|tue|wed|thu|fri|next week|end of|eod|tomorrow|this week))\b/i.test(s)) add(s);
  // 3) Money and concrete times — the things with a deadline or a dollar attached.
  for (const s of sentences)
    if (/(\$\s?\d|\b\d+k\b|\b\d{1,3}(,\d{3})+\b|\bUSD\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b)/i.test(s)) add(s);
  return picked;
}

const KIND_RULES: Array<{ kind: RelationshipKind; re: RegExp }> = [
  { kind: 'investor',  re: /\b(invest(or|ment|ing)?|term sheet|cap table|SAFE note|valuation|fundrais\w*|seed round|series [a-d]\b|due diligence|allocation|LP\b)\b/i },
  { kind: 'candidate', re: /\b(resume|cv\b|interview|the role|this position|hiring|candidate|offer letter|job (opening|description)|recruit\w*|take-home)\b/i },
  { kind: 'customer',  re: /\b(invoice|renewal|subscription|onboarding|support ticket|billing|our account|cancel my|upgrade our plan)\b/i },
  { kind: 'lead',      re: /\b(demo|pricing|a quote|free trial|interested in|proposal|the deck|our use case|evaluat\w*|book a call)\b/i },
  { kind: 'vendor',    re: /\b(SOW\b|MSA\b|statement of work|scope of work|net 30|purchase order|deliverable|as a vendor|your invoice to)\b/i },
  { kind: 'press',     re: /\b(journalist|reporter|podcast|interview request|editorial|for (our|the) (story|article|piece)|press inquiry|cover(age|ing) of)\b/i },
];

/** Best-effort relationship KIND — only when a clear keyword signal exists in the
 *  real thread text. Otherwise undefined (no badge). Never inferred from a name. */
function classifyKind(thread: RelationshipThread): RelationshipKind | undefined {
  const hay = `${thread.subject} ${thread.content || thread.snippet}`;
  for (const { kind, re } of KIND_RULES) if (re.test(hay)) return kind;
  return undefined;
}

// ── Risk scoring — deterministic, explainable, from real facts only ───────────

const MONEY_RE = /\b(invoice|contract|proposal|renewal|quote|pricing|payment|deal|offer|purchase order|SOW|MSA)\b/i;

function scoreRisk(e: WorldEntry, thread: RelationshipThread): void {
  let score = 0;
  const reasons: string[] = [];

  if (e.status === 'waiting_on_them' && e.daysSince >= 4 && e.messageCount >= 2) {
    score += 40 + Math.min(e.daysSince * 4, 40);
    reasons.push(`quiet ${e.daysSince} days after ${e.messageCount} messages`);
  }
  if (e.status === 'awaiting_you' && e.daysSince >= 3) {
    score += 50 + Math.min(e.daysSince * 5, 30);
    reasons.push(`waiting on your reply for ${e.daysSince} days`);
  }
  if (e.apps.some(c => c.label === 'email bounced')) {
    score += 20;
    reasons.push('your last email bounced');
  }
  if (MONEY_RE.test(`${thread.subject} ${thread.snippet}`)) {
    score += 25;
    reasons.push(`money on the line ("${thread.subject.slice(0, 48)}")`);
  }
  if (e.apps.some(c => c.app === 'slack')) {
    score += 10;
    reasons.push('also pinged you on Slack');
  }

  e.riskScore = Math.min(score, 100);
  e.atRisk = e.riskScore >= 55;
  if (e.atRisk) e.riskReason = `${e.name}: ${reasons.join(' · ')}`;
}

// ── Deterministic whyNow + nextAction (real facts; AI only sharpens wording) ──

function baseWhyNow(e: WorldEntry): string {
  const extra = e.apps.find(c => c.app !== 'gmail');
  const meet = e.apps.find(c => c.app === 'calendar' || c.app === 'calcom');
  // The verbatim ask rides in `receipts` (shown as its own quote block on the
  // card), so whyNow stays the INSIGHT — not a repeat of the quote.
  if (e.status === 'awaiting_you') {
    return `Waiting on your reply about "${e.headline}"${e.daysSince > 0 ? ` for ${e.daysSince}d` : ''}${meet ? ` — you meet ${meet.label}` : ''}.`;
  }
  if (e.status === 'waiting_on_them') {
    return `Quiet ${e.daysSince}d since you wrote about "${e.headline}"${extra ? ` — ${extra.evidence.slice(0, 60)}` : ''}.`;
  }
  if (e.status === 'meeting_booked' && meet) {
    return `You meet ${meet.label} — thread "${e.headline}" is the context.`;
  }
  return `Ongoing about "${e.headline}".`;
}

function nextActionFor(e: WorldEntry): string {
  const meet = e.apps.find(c => c.app === 'calendar' || c.app === 'calcom');
  const ask = e.receipts?.[0];
  const askCtx = ask ? ` They wrote: “${ask.slice(0, 100)}”.` : '';
  if (e.status === 'awaiting_you') {
    return `Draft a reply to ${e.name} about "${e.headline}".${askCtx} Read the thread first, then write it in my voice.`;
  }
  if (e.status === 'waiting_on_them') {
    return `Draft a warm, low-pressure follow-up to ${e.name} about "${e.headline}" — it's been quiet for ${e.daysSince} days.${askCtx}`;
  }
  if (e.status === 'meeting_booked' && meet) {
    return `Prep me for my meeting with ${e.name} (${meet.label}). Pull recent email and calendar context on them.${askCtx}`;
  }
  return `Catch me up on where things stand with ${e.name} about "${e.headline}" and suggest the next move.`;
}

// ── AI pass: sharpen whyNow lines (grounded; direct error on failure) ─────────

async function aiSharpen(entities: WorldEntry[], threadByKey: Map<string, RelationshipThread>, founderModel: string): Promise<string | null> {
  const keys = [process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY2, process.env.OPENROUTER_API_KEY3, process.env.OPENROUTER_API_KEY4, process.env.OPENROUTER_API_KEY5].filter(Boolean) as string[];
  if (!keys.length) return 'No OpenRouter API keys configured on the server.';
  if (!entities.length) return null;

  const catalog = entities.map((e, i) => {
    const excerpt = (threadByKey.get(e.key)?.content || '').replace(/\s+/g, ' ').trim().slice(0, 420);
    const kindLine = e.kind ? ` kind:${e.kind}.` : '';
    const receiptLine = e.receipts?.length ? ` Quotes: ${e.receipts.map(r => `"${r}"`).join(' | ')}.` : '';
    const excerptLine = excerpt ? ` Latest message: "${excerpt}"` : '';
    return `[${i}] ${e.name} <${e.email}> — status:${e.status}, last activity ${e.daysSince}d ago, ${e.messageCount} msgs.${kindLine} Thread: "${e.headline}". Cross-app: ${e.apps.map(c => `${c.app}: ${c.evidence}`).join(' | ') || '(email only)'}.${receiptLine}${excerptLine}`;
  }).join('\n');

  const memoryLine = founderModel.trim()
    ? `WHAT YOU KNOW ABOUT THIS FOUNDER (lean on it — a flagged VIP outranks a stranger; NEVER invent a person/fact not in the numbered items):\n${founderModel.trim().slice(0, 700)}\n\n`
    : '';

  const system =
    "You are a founder's chief of staff. For EACH numbered relationship, write ONE sharp, specific sentence (≤22 words) saying why it needs the founder RIGHT NOW. " +
    'Name the SPECIFIC thing at stake using the quotes / latest message — the actual ask, promise, number, or decision — never a generic "circle back" or "follow up". ' +
    'Fuse the cross-app facts when present ("Quiet 8 days on the $40k proposal, and you meet Thu — walk in with the redline"). ' +
    'Ground every word ONLY in the provided facts. NEVER invent a company, amount, date, or detail not present above.\n' + memoryLine +
    'Return ONLY JSON: {"items":[{"i":<number>,"whyNow":"<one sentence>"}]}';

  const body = {
    max_tokens: 700, temperature: 0.3, response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Relationships:\n${catalog}\n\nWrite each whyNow line now.` },
    ],
  };

  const models = ['google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'nvidia/nemotron-3-nano-30b-a3b:free'];
  const KEYS_PER_MODEL = 2;
  let lastError = '';
  for (const model of models) {
    for (const key of keys.slice(0, KEYS_PER_MODEL)) {
      try {
        // nemotron models are REASONERS — without this they burn the budget
        // thinking and return an empty 200 (same fix as everywhere else).
        const reqBody: Record<string, any> = { ...body, model };
        if (/nemotron/i.test(model)) reqBody.reasoning = { enabled: false };
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://mailient.xyz', 'X-Title': 'Mailient' },
          body: JSON.stringify(reqBody),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) { lastError = `${model.replace(':free', '')} → HTTP ${res.status}${res.status === 429 ? ' (rate-limited)' : ''}`; continue; }
        const j = await res.json();
        const content = j?.choices?.[0]?.message?.content;
        if (!content) { lastError = `${model.replace(':free', '')} → empty response`; continue; }
        const parsed = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
        const items = Array.isArray(parsed?.items) ? parsed.items : [];
        if (!items.length) { lastError = `${model.replace(':free', '')} → no items`; continue; }
        for (const it of items) {
          const idx = Number(it.i);
          const s = String(it.whyNow || '').trim();
          if (entities[idx] && s.length > 8) entities[idx].whyNow = s.slice(0, 180);
        }
        return null; // sharpened in place
      } catch (e: any) {
        lastError = `${model.replace(':free', '')} → ${(e?.name === 'TimeoutError' || e?.name === 'AbortError') ? 'timed out' : (e?.message || 'failed')}`;
        continue;
      }
    }
  }
  return `AI unavailable — ${lastError || 'all models/keys exhausted'}`;
}

// ── Build ─────────────────────────────────────────────────────────────────────

async function buildWorld(email: string): Promise<WorldPayload> {
  const prefs = await getBriefingPrefs(email);
  const [threads, signals, founderModel] = await Promise.all([
    gatherGmailRelationships(email, MAX_ENTITIES),
    gatherServerSignals(email, prefs.apps, { calendarFull: true }).catch(() => [] as GatheredSignal[]),
    (async () => { try { const { getUserModelSummary } = await import('@/lib/arcus/user-model'); return await getUserModelSummary(email); } catch { return ''; } })(),
  ]);

  // Spine: one entity per Gmail counterparty.
  const entities: WorldEntry[] = threads.map((t) => ({
    key: t.key,
    name: t.name,
    email: t.email,
    status: t.status,
    headline: t.subject,
    whyNow: '',
    apps: [{
      app: 'gmail' as const,
      label: t.fromThem ? `they wrote ${t.daysSince}d ago` : (t.status === 'waiting_on_them' ? `quiet ${t.daysSince}d` : `you wrote ${t.daysSince}d ago`),
      evidence: `Latest: "${t.subject}" — ${t.snippet.slice(0, 120)}`,
    }],
    atRisk: false,
    riskScore: 0,
    daysSince: t.daysSince,
    lastActivityIso: t.lastActivityIso,
    messageCount: t.messageCount,
    nextAction: '',
  }));
  const byEmail = new Map(entities.map(e => [e.email, e]));

  // Fuse each cross-app signal onto its person — exact email or exact full-name only.
  for (const s of signals) {
    const ent = findEntityFor(s, byEmail, entities);
    if (!ent) continue; // unattached signals still power "Worth your time"; never guessed onto a card
    ent.apps.push(chipFor(s));
    // An upcoming meeting/booking upgrades an 'active' relationship's status.
    if ((s.kind === 'meeting' || s.kind === 'booking') && ent.status === 'active') {
      ent.status = 'meeting_booked';
    }
  }

  // Depth, risk, whyNow, nextAction — deterministic from the fused real facts.
  // Receipts + kind come first because baseWhyNow quotes the top receipt.
  const threadByKey = new Map(threads.map(t => [t.key, t]));
  for (const e of entities) {
    const t = threadByKey.get(e.key)!;
    e.receipts = extractReceipts(t);
    e.kind = classifyKind(t);
    scoreRisk(e, t);
    e.whyNow = baseWhyNow(e);
    e.nextAction = nextActionFor(e);
  }

  // AI sharpening — on failure keep the deterministic real-fact lines and carry
  // the DIRECT error (founder directive: never mask an AI failure with filler).
  const aiError = await aiSharpen(entities, threadByKey, founderModel);

  const slipping = entities.filter(e => e.atRisk).sort((a, b) => b.riskScore - a.riskScore);
  const appsPresent = Array.from(new Set(entities.flatMap(e => e.apps.map(c => c.app)))) as WorldApp[];

  return {
    entities,
    slipping,
    appsPresent,
    generatedAt: new Date().toISOString(),
    ...(aiError ? { aiError } : {}),
  };
}

// ── Cache + handler ───────────────────────────────────────────────────────────

async function readCache(email: string): Promise<{ payload: WorldPayload; generatedAt: string } | null> {
  try {
    const { data } = await getSupabaseAdmin()
      .from('arcus_today_cache')
      .select('payload, generated_at')
      .eq('user_id', `${email.toLowerCase()}::world`)
      .maybeSingle();
    if (!data?.payload?.entities) return null;
    return { payload: data.payload as WorldPayload, generatedAt: data.generated_at };
  } catch { return null; }
}

async function writeCache(email: string, payload: WorldPayload): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from('arcus_today_cache')
      .upsert({ user_id: `${email.toLowerCase()}::world`, payload, generated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch (e: any) {
    logEvent({ channel: 'failures', event: '❌ API Error', description: String(e?.message || e) });
  }
}

export async function GET(req: Request) {
  // TEMPORARY owner diagnostic (?owner=1) — confirms the quality filter dropped
  // brand/newsletter noise on the founder's real inbox. Names + kinds + counts
  // only (precedent-approved), NEVER receipt/body/whyNow text. Removed after.
  if (new URL(req.url).searchParams.get('owner') === '1') {
    const t0 = Date.now();
    try {
      const w = await buildWorld('mailient.xyz@gmail.com');
      return NextResponse.json({
        build: 'world-v3-qualityfilter',
        ms: Date.now() - t0,
        entities: w.entities.length,
        slipping: w.slipping.length,
        appsPresent: w.appsPresent,
        aiError: w.aiError ?? null,
        names: w.entities.map(e => e.name),
        sample: w.entities.slice(0, 8).map(e => ({
          name: e.name, kind: e.kind ?? null, status: e.status,
          atRisk: e.atRisk, receiptCount: e.receipts?.length ?? 0,
        })),
      });
    } catch (e: any) {
      return NextResponse.json({ build: 'world-v3-qualityfilter', ms: Date.now() - t0, threw: `${e?.name}: ${e?.message}`.slice(0, 300) });
    }
  }

  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gate = await assertPaidAccess(email);
  if (!gate.ok) return NextResponse.json({ error: gate.error, upgradeUrl: gate.upgradeUrl }, { status: gate.status });

  const force = new URL(req.url).searchParams.get('refresh') === '1';
  const cached = force ? null : await readCache(email);
  if (cached && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.payload, cached: true });
  }

  try {
    const payload = await buildWorld(email);
    await writeCache(email, payload);
    return NextResponse.json({ ...payload, cached: false });
  } catch (err: any) {
    logEvent({ channel: 'failures', event: '❌ API Error', description: String(err?.message || err) });
    // Serve stale cache rather than nothing; otherwise the DIRECT error.
    if (cached) return NextResponse.json({ ...cached.payload, cached: true, stale: true });
    return NextResponse.json({ entities: [], slipping: [], appsPresent: [], generatedAt: new Date().toISOString(), error: String(err?.message || 'world synthesis failed').slice(0, 200) }, { status: 200 });
  }
}
