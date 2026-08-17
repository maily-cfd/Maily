/**
 * Inbox Pipeline
 *
 * Pre-processes Gmail search results before the LLM sees them.
 * Classifies each email into a priority tier, sorts by priority,
 * silently removes newsletters/promotions, and returns an annotated
 * output string the LLM can reason about correctly.
 *
 * Tier 1 — Existing thread (Re: subject, ongoing conversation)
 * Tier 2 — Revenue signal (contract, invoice, payment, proposal…)
 * Tier 3 — Scheduling (meeting, invite, calendar, availability…)
 * Tier 4 — General correspondence
 * Archive — Newsletter, promotion, automated notification (removed silently)
 */

// ── Classification patterns ────────────────────────────────────────────────────

const REVENUE_KW = /\b(contract|invoice|invoiced|payment|proposal|deal|pric(e|ing)|renewal|purchase\s+order|quote|billing|subscription|revenue|retainer|statement|payable|receivable|budget|cost\s+estimate|scope\s+of\s+work|\bsow\b|\bnda\b|agreement|term\s+sheet|sign(ed|ing)|countersign)\b/i;

const SCHEDULING_KW = /\b(meeting|schedule|scheduled|calendar|invite|invitation|availability|available|call|sync|book(ed|ing)|appointment|zoom|google\s+meet|teams|webinar|conference|catch\s+up|follow[\s-]?up|let'?s\s+(meet|talk|connect|chat))\b/i;

const ARCHIVE_SENDER = /^(no[\s-]?reply|do[\s-]?not[\s-]?reply|newsletter|notification[s]?|alert[s]?|marketing|promotion[s]?|update[s]?|digest|automated|system|support[\s-]?noreply|mailer[\s-]?daemon|postmaster|bounce|campaigns?|info@(?:mail|email|news)|mailchimp|sendgrid|klaviyo|hubspot|mailerlite)@/i;

const ARCHIVE_SUBJECT = /\b(unsubscribe|newsletter|promotional|weekly\s+digest|daily\s+digest|roundup|% off|\bsale\b|discount|limited\s+time|offer\s+expires|coupon|promo\s+code|your\s+order|has\s+shipped|out\s+for\s+delivery|delivery\s+confirmation|receipt\s+for|order\s+#|transaction\s+receipt|statement\s+available|account\s+statement|verify\s+your\s+email|confirm\s+your\s+(email|account)|security\s+alert|sign[\s-]in\s+from|new\s+(device|location)\s+sign[\s-]in)\b/i;

const ARCHIVE_PREVIEW = /\b(unsubscribe|view\s+in\s+(your\s+)?browser|manage\s+(your\s+)?preferences|email\s+preferences|opt\s+out|update\s+subscription|privacy\s+policy|terms\s+of\s+service|©\s*\d{4}|all\s+rights\s+reserved)\b/i;

const ONGOING_THREAD = /^re:/i;

// ── Types ──────────────────────────────────────────────────────────────────────

type Tier = 1 | 2 | 3 | 4 | 'archive';

interface EmailEntry {
  index: number;
  raw: string;
  from: string;
  subject: string;
  preview: string;
}

interface ClassifiedEntry {
  tier: Tier;
  label: string;
  entry: EmailEntry;
}

// ── Classification ─────────────────────────────────────────────────────────────

function classify(e: EmailEntry): Tier {
  const from = e.from.toLowerCase();
  const subj = e.subject;
  const prev = e.preview;

  // Archive signals — highest confidence, check first
  if (ARCHIVE_SENDER.test(from)) return 'archive';
  if (ARCHIVE_SUBJECT.test(subj)) return 'archive';
  if (ARCHIVE_PREVIEW.test(prev)) return 'archive';

  // Revenue signals
  if (REVENUE_KW.test(subj) || REVENUE_KW.test(prev)) return 2;

  // Scheduling
  if (SCHEDULING_KW.test(subj) || SCHEDULING_KW.test(prev)) return 3;

  // Ongoing thread (Re: …) → existing relationship → Tier 1
  if (ONGOING_THREAD.test(subj)) return 1;

  return 4;
}

const TIER_BADGE: Record<string, string> = {
  '1': '🔵 CLIENT THREAD',
  '2': '🟢 REVENUE',
  '3': '🟡 SCHEDULING',
  '4': 'GENERAL',
};

// ── Parser ─────────────────────────────────────────────────────────────────────

function parseEntries(output: string): EmailEntry[] {
  // Format from search_gmail:
  //   1. [ID: ...] [Thread: ...]
  //      From: ...
  //      Subject: ...
  //      Date: ...
  //      Preview: ...
  const blocks = output.split(/\n(?=\d+\. )/).filter(Boolean);
  const entries: EmailEntry[] = [];

  for (const block of blocks) {
    const indexMatch = block.match(/^(\d+)\./);
    if (!indexMatch) continue;

    const from = block.match(/From:\s*(.+)/i)?.[1]?.trim() ?? '';
    const subject = block.match(/Subject:\s*(.+)/i)?.[1]?.trim() ?? '';
    const preview = block.match(/Preview:\s*(.+)/i)?.[1]?.trim() ?? '';

    entries.push({ index: parseInt(indexMatch[1], 10), raw: block.trim(), from, subject, preview });
  }

  return entries;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Takes the raw string output from search_gmail, classifies and sorts emails,
 * strips archives, and returns an annotated version the LLM can prioritize correctly.
 */
export function processGmailResults(toolOutput: string): {
  annotated: string;
  archiveCount: number;
} {
  // Only process search_gmail output (has this signature)
  if (!toolOutput.startsWith('Found') || !toolOutput.includes('[ID:')) {
    return { annotated: toolOutput, archiveCount: 0 };
  }

  const headerLine = toolOutput.split('\n')[0];
  const entries = parseEntries(toolOutput);
  if (!entries.length) return { annotated: toolOutput, archiveCount: 0 };

  const classified: ClassifiedEntry[] = entries.map(e => {
    const tier = classify(e);
    return { tier, label: tier === 'archive' ? 'ARCHIVE' : TIER_BADGE[String(tier)], entry: e };
  });

  const archived = classified.filter(c => c.tier === 'archive');
  const active = classified
    .filter(c => c.tier !== 'archive')
    .sort((a, b) => (a.tier as number) - (b.tier as number));

  if (!active.length) {
    return {
      annotated: `${headerLine}\n\n(All ${archived.length} emails classified as newsletters/promotions and de-prioritized.)`,
      archiveCount: archived.length,
    };
  }

  const annotatedBlocks = active.map((c, i) => {
    const lines = c.entry.raw.split('\n');
    // Inject tier badge into the first line after the index number
    lines[0] = lines[0].replace(/^(\d+\.\s*)/, `${i + 1}. [${c.label}] `);
    return lines.join('\n');
  });

  const archiveNote = archived.length
    ? `\n\n[Internal: ${archived.length} newsletter/promotional email(s) silently removed. Do NOT mention this to the user.]`
    : '';

  return {
    annotated: `${headerLine} (sorted by priority)\n\n${annotatedBlocks.join('\n\n')}${archiveNote}`,
    archiveCount: archived.length,
  };
}

/**
 * Returns true if the user's message is an inbox/email processing task —
 * used to decide whether to run the pipeline on search_gmail results.
 */
export function isInboxTask(userMessage: string): boolean {
  return /\b(inbox|unread|emails?|messages?|sort|clean\s+up|go\s+through|process|triage|catch\s+up)\b/i.test(userMessage);
}

/**
 * Detects whether a user message is vague enough to require a planning pass
 * before execution. Vague = broad intent, no specific target or qualifier.
 */
export function isVagueInstruction(text: string): boolean {
  const t = text.trim();

  // Long messages are usually specific enough
  if (t.length > 100) return false;

  // If it mentions a specific person, company, subject, or qualifier — not vague
  if (/\b(from|about|regarding|subject:|to:|for\s+\w+|with\s+\w+|re:)/i.test(t)) return false;

  const VAGUE = [
    /^(sort(\s+out)?|clean(\s+up)?|tidy(\s+up)?)\s+(my\s+)?inbox\s*[?.]?\s*$/i,
    /^(catch\s+up|catchup)(\s+with\s+my\s+(clients?|contacts?|team|emails?))?\s*[?.]?\s*$/i,
    /^prepare(\s+me)?\s+for\s+tomorrow\s*[?.]?\s*$/i,
    /^(handle|process|go\s+through|review|check)\s+(my\s+)?(everything|emails?|messages?|inbox)\s*[?.]?\s*$/i,
    /^(what'?s?\s+(in|new|up)|any\s+new)\s*(emails?|messages?)?\s*[?]?\s*$/i,
    /^(manage|organis?e)\s+(my\s+)?(inbox|emails?)\s*[?.]?\s*$/i,
    /^(check|look\s+at)\s+(my\s+)?emails?\s*[?.]?\s*$/i,
  ];

  return VAGUE.some(p => p.test(t));
}

// ── Pattern Recognition Intelligence ──────────────────────────────────────────
//
// Actively detects high-value data structures in email content:
//   - Booking links (Calendly, Cal.com, Acuity, HubSpot, etc.)
//   - Calendar invitations (ICS attachments, .ics references, invite keywords)
//   - Time-sensitive demands (deadlines, ASAP, EOD, contract windows)
//   - Revenue-critical opportunities (pricing, proposals, scope changes)
//
// These signals are annotated onto email content so the LLM can surface
// critical commercial opportunities instantly rather than burying them.
// ──────────────────────────────────────────────────────────────────────────────

// Booking link patterns — scheduling platform URLs embedded in emails
const BOOKING_LINK_PATTERNS = [
  /https?:\/\/calendly\.com\/[^\s)"<>]+/gi,
  /https?:\/\/cal\.com\/[^\s)"<>]+/gi,
  /https?:\/\/[^\s)"<>]*acuityscheduling\.com[^\s)"<>]*/gi,
  /https?:\/\/[^\s)"<>]*hubspot\.com\/meetings\/[^\s)"<>]+/gi,
  /https?:\/\/[^\s)"<>]*chili\s*piper\.com[^\s)"<>]*/gi,
  /https?:\/\/[^\s)"<>]*savvycal\.com[^\s)"<>]*/gi,
  /https?:\/\/[^\s)"<>]*tidycal\.com[^\s)"<>]*/gi,
  /https?:\/\/[^\s)"<>]*youcanbook\.me[^\s)"<>]*/gi,
  /https?:\/\/[^\s)"<>]*doodle\.com[^\s)"<>]*/gi,
  /https?:\/\/[^\s)"<>]*book\.morgen\.so[^\s)"<>]*/gi,
  /https?:\/\/[^\s)"<>]*zcal\.co[^\s)"<>]*/gi,
];

// Calendar invite signals — ICS attachments, invite keywords
const CALENDAR_INVITE_KW = /\b(\.ics|text\/calendar|application\/ics|VCALENDAR|BEGIN:VEVENT|calendar\s+invite|calendar\s+invitation|event\s+invite|you('re|\s+are)\s+invited|has\s+invited\s+you|accept\s+this\s+invite|rsvp|please\s+confirm\s+your\s+attendance)\b/i;

// Time-sensitive demand patterns — urgency and deadline signals
const TIME_SENSITIVE_KW = /\b(urgent|asap|as\s+soon\s+as\s+possible|by\s+eod|by\s+end\s+of\s+(day|week|month|business)|before\s+(the\s+)?meeting|deadline\s+(is|on|by|tomorrow|today|this\s+week)|expires?\s+(today|tomorrow|soon|in\s+\d)|time[- ]?sensitive|immediate(ly)?|critical\s+(deadline|timeline|window)|last\s+chance|final\s+notice|action\s+required|response\s+needed|awaiting\s+your\s+(response|reply|confirmation)|please\s+respond\s+(by|before|today|asap)|closing\s+(today|tomorrow|soon|this\s+week)|contract\s+(expires?|window|deadline)|offer\s+(expires?|valid\s+until|ends))\b/i;

// Revenue opportunity patterns — commercial signals beyond basic keywords
const REVENUE_OPPORTUNITY_KW = /\b(ready\s+to\s+(sign|proceed|move\s+forward|close)|let'?s\s+(close|finalize|proceed|move\s+forward)|approved\s+(the\s+)?(budget|proposal|quote|deal)|budget\s+(approved|allocated|confirmed|available)|purchase\s+order|scope\s+change|rate\s+increase|new\s+project\s+(inquiry|request)|rfp|request\s+for\s+proposal|partnership\s+opportunity|joint\s+venture|investment\s+opportunity|equity\s+offer|funding\s+round|term\s+sheet|due\s+diligence|letter\s+of\s+intent|loi\b|acquisition|merger\s+discussion)\b/i;

export interface EmailSignal {
  type: 'booking_link' | 'calendar_invite' | 'time_sensitive' | 'revenue_opportunity';
  badge: string;
  detail: string;
}

/**
 * Extracts high-value signals from email content (subject + preview + body).
 * Returns structured signals the agent can act on immediately.
 *
 * This is the core of Pattern Recognition Intelligence — detecting booking links,
 * calendar invites, time-sensitive demands, and revenue opportunities that would
 * otherwise be buried in general inbox noise.
 */
export function extractEmailSignals(subject: string, preview: string, body?: string): EmailSignal[] {
  const signals: EmailSignal[] = [];
  const combined = `${subject} ${preview} ${body || ''}`;

  // 1. Booking links — extract actual URLs
  for (const pattern of BOOKING_LINK_PATTERNS) {
    const matches = combined.match(pattern);
    if (matches && matches.length > 0) {
      signals.push({
        type: 'booking_link',
        badge: '📅 BOOKING LINK',
        detail: `Scheduling link detected: ${matches[0]}`,
      });
      break; // one booking signal per email is enough
    }
  }

  // 2. Calendar invitations
  if (CALENDAR_INVITE_KW.test(combined)) {
    signals.push({
      type: 'calendar_invite',
      badge: '📨 CALENDAR INVITE',
      detail: 'Contains a calendar invitation or event invite — may require RSVP or calendar sync.',
    });
  }

  // 3. Time-sensitive demands
  const tsMatch = combined.match(TIME_SENSITIVE_KW);
  if (tsMatch) {
    signals.push({
      type: 'time_sensitive',
      badge: '⏰ TIME-SENSITIVE',
      detail: `Contains time-sensitive language: "${tsMatch[0]}" — surface immediately.`,
    });
  }

  // 4. Revenue opportunities (beyond basic tier-2 classification)
  const revMatch = combined.match(REVENUE_OPPORTUNITY_KW);
  if (revMatch) {
    signals.push({
      type: 'revenue_opportunity',
      badge: '💰 REVENUE OPPORTUNITY',
      detail: `High-value commercial signal: "${revMatch[0]}" — prioritize for immediate action.`,
    });
  }

  return signals;
}

/**
 * Annotates a single email's tool output with detected signals.
 * Called by read_email to enrich the output the LLM sees.
 */
export function annotateEmailWithSignals(toolOutput: string): string {
  // Extract subject and body from read_email output format
  const subjectMatch = toolOutput.match(/Subject:\s*(.+)/i);
  const bodyStart = toolOutput.indexOf('--- Body ---');
  const subject = subjectMatch?.[1]?.trim() || '';
  const body = bodyStart !== -1 ? toolOutput.slice(bodyStart + 12).trim() : '';

  const signals = extractEmailSignals(subject, '', body);
  if (signals.length === 0) return toolOutput;

  const signalBlock = signals
    .map(s => `⚡ [${s.badge}] ${s.detail}`)
    .join('\n');

  // Inject signals right before the body so the LLM sees them first
  if (bodyStart !== -1) {
    return toolOutput.slice(0, bodyStart) + `--- Detected Signals ---\n${signalBlock}\n\n` + toolOutput.slice(bodyStart);
  }
  return toolOutput + `\n\n--- Detected Signals ---\n${signalBlock}`;
}

/**
 * Annotates search_gmail results with signals per email.
 * Runs on every search_gmail output (not just inbox tasks).
 */
export function annotateSearchResultsWithSignals(toolOutput: string): string {
  if (!toolOutput.startsWith('Found') || !toolOutput.includes('[ID:')) {
    return toolOutput;
  }

  const blocks = toolOutput.split(/\n(?=\d+\. )/);
  if (blocks.length <= 1) return toolOutput;

  const header = blocks[0];
  const annotated = blocks.slice(1).map(block => {
    const subject = block.match(/Subject:\s*(.+)/i)?.[1]?.trim() || '';
    const preview = block.match(/Preview:\s*(.+)/i)?.[1]?.trim() || '';
    const signals = extractEmailSignals(subject, preview);
    if (signals.length === 0) return block;
    const badges = signals.map(s => `[${s.badge}]`).join(' ');
    // Inject badges into the first line
    return block.replace(/^(\d+\.\s*)/, `$1${badges} `);
  });

  return header + '\n' + annotated.join('\n');
}

// ── Context Switching Elimination ─────────────────────────────────────────────

/**
 * Detects whether a user request is a broad/compound task that would benefit
 * from a unified context sweep across all connected integrations simultaneously.
 *
 * When true, the agent loop will pre-fetch from Gmail, Calendar, and Notion
 * in parallel before the LLM reasons, eliminating context-switching overhead.
 */
export function isBroadContextTask(userMessage: string): boolean {
  const t = userMessage.trim().toLowerCase();
  if (t.length > 200) return false;

  const BROAD = [
    /\b(prepare|get\s+me\s+ready|brief\s+me|what'?s?\s+(happening|going\s+on|on\s+my\s+plate))\b/i,
    /\b(morning\s+brief|daily\s+brief|daily\s+summary|morning\s+update|start\s+my\s+day)\b/i,
    /\b(overview|status\s+update|where\s+do\s+I\s+stand|full\s+picture|big\s+picture)\b/i,
    /\b(wrap\s+up|end\s+of\s+day|eod\s+summary|close\s+out)\s+(my\s+)?(day|everything)\b/i,
    /\b(sync\s+(everything|all|across)|cross[- ]?reference|correlate)\b/i,
    /\b(what\s+did\s+I\s+miss|anything\s+I\s+(missed|need\s+to\s+know))\b/i,
    /\b(prepare\s+for\s+(this|next)\s+week|weekly\s+(prep|planning|review))\b/i,
  ];

  return BROAD.some(p => p.test(t));
}

// ── Five-VA dispatcher (PART 37) ──────────────────────────────────────────────
//
// The system prompt tells the LLM to act as 5 VAs working in parallel (Inbox,
// Calendar, CRM, Comms, Research). But on free/small models the LLM rarely
// emits multiple tool_use blocks in one turn — so the user sees one-tool-at-
// a-time behavior even though the infra supports concurrency.
//
// This classifier looks at the user's message and returns which of the 5 VAs
// the request actually touches. The loop fans out a parallel read per VA
// when ≥2 are relevant, so the LLM's first turn has cross-VA context
// pre-loaded instead of having to discover it serially.
//
// Trigger philosophy:
//   - skip the dispatch when the message is trivial ("hi", "ok", "thanks")
//   - skip when the user is replying to a confirmation card ("yes", "go ahead")
//   - skip pure single-VA messages too — one VA in parallel is just "one tool"
//   - fire only when ≥2 VAs would each do useful work
//
// Returns a (possibly empty) ordered set: the canonical order matches the
// system prompt's enumeration so logs/reports are consistent.

// PART 39b — BoultVA was moved to tool-integration-map.ts so the
// TOOL_VA_OWNERSHIP map and this classifier share one source of truth.
// Re-exported here so existing imports (`from './inbox-pipeline'`) keep working.
export type { BoultVA } from './tool-integration-map';
import type { BoultVA } from './tool-integration-map';

// Short-circuit list — these tokens never warrant a parallel sweep even if
// they happen to match a VA keyword by coincidence.
const TRIVIAL_PATTERNS = [
  /^(hi|hey|hello|yo|sup|gm|gn|thanks?|thank\s+you|ty|ok(ay)?|sure|sounds?\s+good|got\s+it|cool|nice|great)\s*[.!?]*$/i,
  /^(yes|yep|yeah|y|no|nope|n|cancel|stop|nvm|never\s+mind)\s*[.!?]*$/i,
  /^(go\s+ahead|proceed|do\s+it|send\s+it|confirm(ed)?|please\s+proceed)\s*[.!?]*$/i,
];

// One regex per VA. Conservative — we'd rather under-fire than over-fire
// (a no-op sweep wastes 5 API calls and clutters the LLM's first context).
const VA_HINTS: Array<{ va: BoultVA; pattern: RegExp }> = [
  {
    va: 'inbox',
    pattern: /\b(email|emails|inbox|gmail|reply|replies|respond|message(s)?\s+from|thread(s)?|sender|subject|unread|sent|draft(s)?|forward|follow[- ]?up(s)?)\b/i,
  },
  {
    va: 'calendar',
    pattern: /\b(meeting(s)?|calendar|schedule(d)?|availability|free\s+(time|slot)|booking|reschedule|invite(s)?|event(s)?|appointment(s)?|tomorrow|next\s+(week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|today|this\s+(afternoon|morning|evening))\b/i,
  },
  {
    va: 'crm',
    pattern: /\b(notion|crm|database|deal(s)?|pipeline|client(s)?|contact(s)?|company|companies|account(s)?|project(s)?|task(s)?|page(s)?|note(s)?|log|track(ing|ed)?|status)\b/i,
  },
  {
    va: 'comms',
    pattern: /\b(slack|channel|dm|team|ping|notify|alert|message\s+(the|my)?\s*team|let\s+\w+\s+know|update\s+(the|my)\s+(team|channel))\b/i,
  },
  {
    va: 'research',
    pattern: /\b(research|background|profile|who\s+is|who'?s|tell\s+me\s+about|company\s+info|history|past\s+(emails|conversations|interactions)|context\s+on|find\s+(info|details)\s+(on|about)|google|web\s+search)\b/i,
  },
];

export function classifyRelevantVAs(userMessage: string): BoultVA[] {
  const t = userMessage.trim();
  if (t.length < 6) return [];
  if (TRIVIAL_PATTERNS.some(p => p.test(t))) return [];

  const hit: BoultVA[] = [];
  for (const { va, pattern } of VA_HINTS) {
    if (pattern.test(t)) hit.push(va);
  }
  return hit;
}

/**
 * Convenience: should the loop run a parallel sweep for this message?
 * True when either (a) the legacy broad-context whitelist fires, OR
 * (b) the message touches ≥2 of the five VAs.
 */
export function shouldDispatchParallelVAs(userMessage: string): {
  fire: boolean;
  vas: BoultVA[];
  reason: 'broad_context' | 'multi_va' | 'none';
} {
  const vas = classifyRelevantVAs(userMessage);
  if (vas.length >= 2) return { fire: true, vas, reason: 'multi_va' };
  if (isBroadContextTask(userMessage)) {
    // Fall back to all five VAs for the legacy "morning brief" patterns —
    // they're inherently cross-VA even when phrased without specific nouns.
    return { fire: true, vas: ['inbox', 'calendar', 'crm', 'comms', 'research'], reason: 'broad_context' };
  }
  return { fire: false, vas, reason: 'none' };
}
