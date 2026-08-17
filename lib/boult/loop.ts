/**
 * Boult Agentic Loop
 *
 * SSE streaming agentic loop with three infrastructure layers added
 * on top of the core LLM → tool → loop cycle:
 *
 * Layer 1 — Vague instruction detection
 *   Before the main loop starts, the user message is checked against
 *   known vague-instruction patterns. If vague, a short planning-mode
 *   LLM call generates a 2-sentence plan + "Should I proceed?" and the
 *   stream ends. On the next user message (any form of yes), full
 *   execution runs with the plan already in history.
 *
 * Layer 2 — Inbox pipeline
 *   search_gmail results on inbox-related tasks are passed through the
 *   inbox pipeline before the LLM sees them: classified by priority tier,
 *   sorted (client threads → revenue → scheduling → general), and
 *   newsletters/promotions silently removed. Archive count accumulates
 *   and is reported at the end.
 *
 * Layer 3 — Failure tracking and partial failure reporting
 *   Every tool call records either a success (tool name) or a failure
 *   (tool name + error). If the task partially fails, the final message
 *   always includes a Done / Needs attention section regardless of what
 *   the LLM wrote. One targeted recovery question is appended.
 *
 * SSE events:
 *   run_start     → { runId, message }
 *   thinking      → { status }
 *   narrative     → { text, iteration }
 *   tool_call     → { tool, params, iteration }
 *   tool_result   → { tool, success, summary, iteration }
 *   canvas        → { title, type, markdown, draftMeta? }
 *   task_list     → { tasks }
 *   task_progress → { completedCount }
 *   message       → { content, canvasContent? }
 *   plan          → { title, markdown }
 *   error         → { message }
 *   done          → { runId, durationMs, totalSteps }
 */

import crypto from 'crypto';
import { callLLM, getText, getRawText, getToolCalls, sanitizeModelText } from './engine';
import { executeTool, getAvailableTools, TOOL_SCHEMAS } from './tools';
import { processGmailResults, isVagueInstruction, shouldDispatchParallelVAs, type BoultVA } from './inbox-pipeline';
import { generateFollowUpSuggestions } from './suggestion-engine';
import { invalidateGmailScope } from './gmail-scope';
import { normalizeDocumentMarkdown } from './markdown-normalize';
import { getSupabaseAdmin } from '../supabase.js';
import { buildExecutionPlan, planToHint, checkPrerequisites } from './orchestrator';
import { classifyUserIntent, shouldSuppressTools, intentSystemHint } from './intent-classifier';
import { withNarrationField, extractNarrations } from './narration';
import type { LLMMessage } from './engine';

// ── Audit logging — fire-and-forget, never blocks the loop ────────────────────
function logAudit(params: {
  userId: string; runId: string; toolName: string;
  inputSummary?: string; outputSummary?: string;
  durationMs?: number; success: boolean; errorMessage?: string; iteration?: number;
}) {
  try {
    const supabase = getSupabaseAdmin();
    supabase.from('boult_audit_log').insert({
      user_id:        params.userId,
      run_id:         params.runId,
      tool_name:      params.toolName,
      input_summary:  params.inputSummary?.slice(0, 500),
      output_summary: params.outputSummary?.slice(0, 500),
      duration_ms:    params.durationMs,
      success:        params.success,
      error_message:  params.errorMessage?.slice(0, 500),
      iteration:      params.iteration,
    });
  } catch { /* non-fatal */ }
}

const ASK_USER_SCHEMA = TOOL_SCHEMAS.find(s => s.name === 'ask_user')!;

function ts() { return new Date().toISOString().slice(11, 23); }

// ── Plan-mode output normalisation (PART 42) ──────────────────────────────────
//
// MOVED to ./markdown-normalize so canvas documents get the same treatment —
// this ran on plan mode ONLY, which is why the raw-JSON Steps bug kept shipping
// in canvas docs long after it was "fixed" for plans. Kept as a thin alias so
// the plan-mode call site below reads unchanged.
const normalizePlanMarkdown = normalizeDocumentMarkdown;

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) {
  const prefix = `[Boult:Loop] ${ts()}`;
  const line = extra ? `${prefix} ${msg} ${JSON.stringify(extra)}` : `${prefix} ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * Hard cap on tool calls per run.
 * Background agents (isBackgroundAgent=true) bypass this via the
 * maxToolCalls loop option — see toolCallLimit calculation below.
 * Interactive chat ceiling. The REAL governor is the wall-clock deadline the
 * chat route passes (52s on Vercel Hobby's 60s function cap) — the loop self-
 * terminates and writes its final briefing before Vercel kills it, so a big run
 * finishes gracefully rather than erroring partway. This cap is just a safety
 * ceiling above what fits in that window; the route requests ~26. Big jobs use
 * the BATCH tools (one call for many drafts/sends) to do a lot inside the time
 * budget. Normal turns finish in 1-3 calls regardless. (Raise toward 80 only
 * when on Vercel Pro with a 280s deadline.)
 */
export const MAX_TOOL_CALLS = 40;
/**
 * Raised cap for background / cron agents. 100 lets a scheduling agent
 * process a full inbox (50 threads × 2 calls each) without hitting the
 * wall mid-run. The Vercel deadlineMs budget is the real constraint.
 */
export const MAX_TOOL_CALLS_BACKGROUND = 100;
const MAX_NUDGES = 3;

// ── Pattern guards ─────────────────────────────────────────────────────────────

const INTENT_PATTERN = /^(searching|looking|checking|reading|finding|fetching|let me|i['']ll|i will|i am going to|going to|will (search|check|look|read|find|fetch)|now (searching|checking|reading)|got it|sure|okay|alright)/i;

// Catches future-intent phrases ANYWHERE in the text — handles planning paragraphs
// that don't start with intent words but end with "I'll set that up now." etc.
const INTENT_ANYWHERE_PATTERN =
  /\b(i['']ll\s+(?:set\s+(?:that|this|it)\s+up|proceed(?:\s+now)?|create\s+(?:the|an?\s+|this\s+)?\w|start(?:\s+(?:now|this|that))?|do\s+(?:this|that)\s+now|handle\s+this|call\s+the\s+tools?|use\s+the\s+tools?|draft\s+\w|define\s+\w|write\s+\w|open\s+\w|search\s+\w|send\s+\w|check\s+\w|read\s+\w|schedule\s+\w|look\s+\w)|i\s+will\s+(?:now|proceed|create|set\s+up|schedule|run|execute|build|make|draft|define|write|open|search|send|check|read)\b|setting\s+(?:this|that|it)\s+up\s+now|proceeding\s+now|will\s+proceed\s+now|and\s+then\s+create\s+it|then\s+I'?ll\s+\w)\b/i;

const PLACEHOLDER_PATTERN = /\[\s*(I will|will be|to be|once generated|actual.*link|link here|pending|tbd|insert|placeholder|meet link|google meet link|conference link|calendar link|meeting link)\s*[^\]]*?\]/i;

// Bracketed directives where the model *describes* a tool action instead of
// performing it — e.g. "[open canvas with the proof report]",
// "[draft the reply here]", "[schedule the meeting]". These must trigger a
// nudge so the model actually calls the tool rather than narrating it.
const ACTION_PLACEHOLDER_PATTERN = /\[\s*(open(s|ing)?\s+(the\s+)?canvas|canvas\s*:|(create|generate|render|build|produce|put)\s+(a\s+|the\s+|this\s+)?(canvas|notion|page|document|report|summary|draft|plan|table)|draft\s+(a\s+|the\s+)?(reply|email|response|message)|schedule\s+(a\s+|the\s+)?(meeting|call|event)|send\s+(a\s+|an?\s+|the\s+)?(email|message|slack|reply))\b[^\]]*\]/i;

function isIntentText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Increased from 500 to 800 — some narration paragraphs are longer
  if (t.length < 800 && INTENT_PATTERN.test(t)) return true;
  return INTENT_ANYWHERE_PATTERN.test(t);
}

function hasPlaceholders(text: string): boolean {
  return PLACEHOLDER_PATTERN.test(text) || ACTION_PLACEHOLDER_PATTERN.test(text);
}

// Detects step-listing responses: LLM lists what tools it ran instead of answering the question.
// Three shapes we catch:
//   (a) "Done — completed Searched inbox for..." — verb-then-tool
//   (b) "Done — completed Completed gmail get profile" — double-completion + tool name
//   (c) "Done — completed gmail get profile, Running create scheduled agent" — tool-name salad
//   (d) "I searched the inbox and..." — first-person narration of what was searched
const STEP_LIST_PATTERN = /^(done\s*[—–-]\s*(completed|i handled|i ran|executed|performed|opened|running|finished)\s+((completed|opened|running|finished)\s+)?(?:searched|search|read|fetch|check|look|scan|get|gmail|calendar|notion|slack|create|update|draft|send|schedule|run)|done\s*[—–-]\s*(?:searched\s+inbox|read\s+email|fetch|checked\s+calendar)|i\s+(?:searched|read|fetched|checked|scanned)\s+(?:the\s+)?(?:inbox|gmail|calendar|notion|slack)\s+(?:for|and)\b)/i;

// "Tool-name salad" detector — sentences whose nouns/verbs are dominated by underscored
// tool names ("gmail_get_profile", "create_scheduled_agent", "open_canvas").
// If a short response is mostly tool-name salad with no substantive English, it's a step list.
function isToolNameSalad(text: string): boolean {
  const t = text.trim();
  if (t.length > 500) return false;
  // Look for two or more bare tool-shaped phrases: lowercase verb + space + lowercase noun
  // ("gmail get profile", "create scheduled agent", "open canvas", "search gmail")
  const toolPhraseCount = (t.match(/\b(gmail|calendar|notion|slack|canvas|scheduled|drafted?|sent?|read)\s+(get|create|open|update|send|run|read|search|apply|archive|find)(?:\s+\w+)?/gi) || []).length;
  if (toolPhraseCount < 2) return false;
  // ...AND no substantive content words
  const hasSubstance = /\b(because|since|so that|found|says|reads|wrote|subject|from|to|body|threadId removed|meeting|event|time|date|reason|error|missing|no \w+ found|drafted (?:a|the) reply (?:to|about))\b/i.test(t);
  return !hasSubstance;
}

// A step-listing response has short length with no real info, or starts with a step recap
// and the whole body is just a comma-separated list of tool actions.
function isStepListingResponse(text: string, toolsWereCalled: boolean): boolean {
  if (!toolsWereCalled) return false;
  const t = text.trim();
  if (!t || t.length > 1200) return false; // Long responses likely have real content
  if (STEP_LIST_PATTERN.test(t)) return true;
  if (isToolNameSalad(t)) return true;
  // Catch the pattern: "Done — I handled X, Y and Z for you." with only tool names
  if (/^done\s*[—–-]/i.test(t) && /\bfor you\b/i.test(t) && t.length < 300) {
    // Check if the text is primarily a list of actions/tool names
    const hasRealContent = /\b(found|says|email|subject|from|body|content|result|message|reply|thread|schedule|event|meeting|note|page|slack|notion)\b/i.test(t);
    if (!hasRealContent) return true;
  }
  // "Waiting for your approval" / "waiting on approval" without any substance
  if (/^done\s*[—–-]/i.test(t) && /\bwaiting\s+(for|on)\s+(your\s+)?approval/i.test(t) && t.length < 250) {
    return true;
  }
  return false;
}

// Extracts the last N tool results from the message history and returns them
// as a readable string so we can inject actual data into step-listing retries.
function extractLastToolResults(messages: any[], maxResults = 3): string {
  const snippets: string[] = [];
  for (let i = messages.length - 1; i >= 0 && snippets.length < maxResults; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type === 'tool_result' && typeof block.content === 'string' && block.content.length > 30) {
        // Skip bridge/auto-bridge injections
        if (block.content.startsWith('[AUTO-BRIDGE') || block.content.startsWith('[WRITING STYLE') || block.content.startsWith('[UNIFIED')) continue;
        snippets.push(block.content.slice(0, 1200));
        if (snippets.length >= maxResults) break;
      }
    }
  }
  return snippets.length > 0
    ? snippets.map((s, i) => `--- Result ${i + 1} ---\n${s}`).join('\n\n')
    : '(no tool results available)';
}

// ── Error humanizer ────────────────────────────────────────────────────────────
//
// Raw tool errors (stack traces, "403", "fetch failed", AbortError) must never
// reach the user or even the LLM verbatim — they make Boult feel broken and
// mechanical. This converts them into a plain-English explanation plus a
// concrete alternative the model can act on or relay.

/**
 * Tools whose batched execution is worth showing the user as a live progress
 * block. STRICTLY user-meaningful WRITES — things the user asked to have done
 * to their accounts. Reads (search, recipient-context, voice-profile) are
 * orchestration internals and must NOT surface progress lines (that's the
 * "Creating 5 searches now / Got 4 of 5 created" leak). If it's not here, the
 * batch runs silently and only the step trace reflects it.
 */
const BULK_PROGRESS_TOOLS = new Set<string>([
  'draft_reply',
  'draft_cold_email',
  'send_email',
  'schedule_email_send',
  'schedule_meeting',
  'create_notion_page',
  'notion_create_task',
  'send_slack_message',
  'slack_send_dm',
  'gmail_apply_label',
  'gmail_archive_thread',
]);

/**
 * Convert a tool name to a plain-English bulk noun for progress lines
 * ("Creating 17 <label> now"). Defaults to tool-name with underscores
 * replaced by spaces when the tool isn't in the known list.
 */
function humanizeBulkLabel(tool: string): string {
  switch (tool) {
    case 'draft_reply':
    case 'draft_cold_email':
      return 'personalized drafts';
    case 'send_email':
      return 'emails';
    case 'create_notion_page':
    case 'notion_create_task':
      return 'Notion pages';
    case 'schedule_meeting':
      return 'meetings';
    case 'send_slack_message':
    case 'slack_send_dm':
      return 'Slack messages';
    case 'gmail_apply_label':
      return 'labels';
    case 'gmail_archive_thread':
      return 'archives';
    case 'read_email':
    case 'gmail_read_thread':
      return 'threads';
    case 'search_gmail':
      return 'searches';
    case 'remember_about_contact':
    case 'memory_save':
      return 'memory entries';
    default:
      return `${tool.replace(/_/g, ' ')} calls`;
  }
}

function humanizeError(tool: string, raw: string): string {
  const e = (raw || '').toLowerCase();
  const friendlyTool = tool.replace(/_/g, ' ');

  if (/abort|timeout|timed out|etimedout/.test(e)) {
    return `The ${friendlyTool} step took too long to respond. This is usually a temporary network hiccup — I can retry it, or continue with the other steps and come back to this one.`;
  }
  if (/\b401\b|unauthorized|invalid[_\s-]?grant|token (expired|invalid)/.test(e)) {
    return `The connection for ${friendlyTool} has expired and needs to be re-authorized. Ask the user to reconnect it via the connectors button in the prompt box, then try again.`;
  }
  if (/\b403\b|insufficient|forbidden|scope/.test(e)) {
    return `Boult doesn't have permission for ${friendlyTool} yet — the connected account is missing that specific access. Ask the user to reconnect that integration with full permissions via the connectors button.`;
  }
  if (/not connected|connect .* in settings|connect .* in integrations/.test(e)) {
    return raw; // these are already user-friendly, written by the tools
  }
  if (/\b429\b|rate limit|quota|exhausted/.test(e)) {
    return `The ${friendlyTool} service is rate-limiting requests right now. I can wait a moment and retry, or proceed with the rest of the task first.`;
  }
  if (/\b5\d\d\b|server error|bad gateway|unavailable/.test(e)) {
    return `${friendlyTool[0].toUpperCase()}${friendlyTool.slice(1)} is temporarily unavailable on the provider's side. This isn't something on our end — retrying shortly usually works.`;
  }
  // Unknown — keep it short and non-technical, drop any stack noise.
  const firstLine = (raw || 'unknown error').split('\n')[0].slice(0, 160);
  return `The ${friendlyTool} step didn't complete (${firstLine}). I'll continue with everything else and flag this so you can decide how to handle it.`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Parse the structured Stage-2 message the ChatInterface Confirm button sends:
 *
 *   Spec approved for "<name>". Create the agent now.
 *   Call create_scheduled_agent with these exact parameters AND _planApproved: true:
 *   - name: "Morning Inbox Sweep"
 *   - task_description: "..."
 *   - cron_schedule: "0 7 * * *"
 *   - output_channel: "gmail"
 *   - slack_channel: "#general"     (optional)
 *   - skip_confirmations: false
 *   - _planApproved: true
 *
 * Returns the input object create_scheduled_agent expects, or null if parsing
 * failed (caller falls through to the normal loop).
 */
function parseStructuredAgentParams(msg: string): Record<string, any> | null {
  try {
    const params: Record<string, any> = {};
    // Match lines like:  - key: "value"   or   - key: value   or   - key: true
    const lineRe = /^\s*-\s*([a-zA-Z_]+)\s*:\s*(.+?)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = lineRe.exec(msg)) !== null) {
      const key = m[1];
      let raw = m[2];
      // Strip surrounding quotes
      if ((raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'"))) {
        raw = raw.slice(1, -1);
      }
      // Coerce literals
      if (raw === 'true') params[key] = true;
      else if (raw === 'false') params[key] = false;
      else if (raw === 'null') params[key] = null;
      else if (/^-?\d+$/.test(raw)) params[key] = parseInt(raw, 10);
      else params[key] = raw;
    }
    return Object.keys(params).length > 0 ? params : null;
  } catch {
    return null;
  }
}

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ── Tool outcome tracking ──────────────────────────────────────────────────────

interface ToolOutcome {
  tool: string;
  ok: boolean;
  error?: string;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LoopOptions {
  userId: string;
  systemPrompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  connectedIntegrations?: string[];
  isPlanMode?: boolean;
  /**
   * Hard cap on tool calls for this run. Defaults to MAX_TOOL_CALLS.
   * Background/cron runs pass a smaller value so the whole loop finishes
   * within Vercel's 60s function limit (otherwise the platform kills it
   * mid-run and no report is ever produced or delivered).
   */
  maxToolCalls?: number;
  /**
   * Wall-clock budget in ms. Once exceeded, the loop stops calling tools
   * and forces a final summary from whatever it has so far. Lets scheduled
   * runs always emit a report instead of being 504'd into oblivion.
   */
  deadlineMs?: number;
  /**
   * Stable conversation id — threaded into executeTool so the session-state
   * approval gate (send_email / schedule_meeting / send_slack_message /
   * create_notion_page) can match a request_confirmation row against the
   * subsequent write. Omit for background-agent runs; the gate fails open.
   */
  conversationId?: string;
  isBackgroundAgent?: boolean;
  skipConfirmations?: boolean;
  agentId?: string;
  /**
   * The boult_agent_runs.id this loop belongs to. When provided, it is used as
   * the audit-log run_id so every tool call written to boult_audit_log joins
   * back to the exact run the user sees in "Recent runs". Without it the loop
   * mints its own random UUID and the per-tool detail is orphaned from the run
   * record (the bug behind "1 tool call" with no drill-down). In committee
   * mode every VA shares the SAME agentRunId so all VAs' tool calls roll up to
   * one run.
   */
  agentRunId?: string;
  /**
   * F6 — Free-text user instructions from the settings card. The loop uses
   * the FIRST 220 chars as a per-turn reminder appended to the user message
   * so the LLM re-reads the rules every step instead of having to recall
   * them from the bottom of a 1000-line system prompt.
   */
  userInstructions?: string;
  /** PART 53 — surface tone + length in the per-turn rules hint too, so the
   *  LLM reads them on every step instead of forgetting the userStyle block
   *  buried at the bottom of the system prompt. */
  communicationStyle?: 'direct' | 'balanced' | 'warm';
  verbosity?: 'brief' | 'normal' | 'detailed';
  /**
   * F12 — Attachments uploaded with the user's message. Only image types are
   * forwarded to the LLM as vision content blocks; non-image attachments are
   * surfaced as text mentions ("file: <name>") so the model knows they exist.
   */
  attachments?: Array<{ name: string; url: string; type: string; size?: number }>;
  /**
   * PART 48 — Committee mode. When set, this loop instance is one VA of a
   * background-agent committee running in parallel with other VAs. Effects:
   *   - getAvailableTools is filtered to ONLY this VA's tools (+ utilities)
   *   - The 5-VA parallel context sweep is SKIPPED (would be redundant —
   *     the orchestrator already decided this VA does its own slice)
   *   - The per-turn dispatch nudge is SKIPPED (the focus is implicit)
   *   - The VA's name lands in the per-turn user message so the LLM knows
   *     who it is and what siblings exist
   * Omit entirely for interactive chat + legacy single-LLM background runs.
   */
  committeeMode?: { va: BoultVA; siblingVAs: BoultVA[] };
}

// ── Main loop ──────────────────────────────────────────────────────────────────

export function runAgentLoop(opts: LoopOptions): ReadableStream {
  const {
    userId,
    systemPrompt,
    history,
    userMessage,
    connectedIntegrations = [],
    isPlanMode = false,
    maxToolCalls,
    deadlineMs,
    conversationId,
    isBackgroundAgent,
    skipConfirmations,
    agentId,
    agentRunId,
    userInstructions,
    attachments,
  } = opts;

  // F12 — Split attachments into image (sent as vision blocks) and other
  // (surfaced as text). image_url accepts data: URLs and https: URLs equally.
  const imageAttachments = (attachments || []).filter(a =>
    a.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(a.name || ''),
  );
  const nonImageAttachments = (attachments || []).filter(a => !imageAttachments.includes(a));

  // F6 + PART 53 — Per-turn reminder appended to every user message so the
  // LLM re-reads tone + length + binding rules every step instead of having
  // to recall them from the bottom of a long system prompt. Tone/length
  // override the prompt's voice defaults; binding rules override everything.
  const activeRulesHint = (() => {
    // Fixed voice — warm + detailed, not user-switchable.
    const parts: string[] = ['tone:warm', 'length:detailed'];
    if (userInstructions && userInstructions.trim()) {
      const compact = userInstructions.replace(/\s+/g, ' ').trim().slice(0, 200);
      parts.push(`rules:${compact}${userInstructions.length > 200 ? '…' : ''}`);
    }
    return `\n\n[ACTIVE — apply strictly: ${parts.join(' · ')}]`;
  })();
  // Tracks every successful tool call this run so PART 4 Rule 1 (draft_reply
  // requires a preceding read_email/gmail_read_thread) and Rule 3
  // (schedule_meeting requires a preceding calendar fetch) can verify the
  // LLM actually fetched ground truth before acting.
  const toolHistory: Array<{ name: string; input: any; success: boolean }> = [];

  // ── Working memory ──────────────────────────────────────────────────────────
  // The dedup cache only catches an EXACT repeat of the same params. It does
  // nothing about the failure users actually see: the model searching the same
  // INTENT over and over with slightly different wording — "kunal", then
  // "from:kunal", then "kunal follow up" — because nothing in its context
  // states plainly what it has already looked for and what came back. Each new
  // phrasing is a cache miss, so a two-step task burned 26 steps.
  //
  // This is that missing statement: a compact ledger of every lookup and its
  // OUTCOME, replayed to the model each iteration. "You already searched X and
  // found nothing" is the one fact that stops a re-search; the raw tool results
  // further up the transcript do not say it, and get skimmed once they are long.
  const gathered: Array<{ name: string; hint: string; outcome: string }> = [];
  const toolCallCounts = new Map<string, number>();

  /** One readable line per lookup: what was asked, what came back. */
  function recordGathered(name: string, input: any, output: string, success: boolean) {
    const hintRaw =
      input?.query ?? input?.threadId ?? input?.messageId ?? input?.email ??
      input?.name ?? input?.pageId ?? '';
    const hint = String(hintRaw).slice(0, 60);
    let outcome: string;
    if (!success) {
      outcome = 'failed';
    } else {
      const text = String(output || '');
      // Empty results are the ones worth remembering MOST — an empty result is
      // exactly what tempts the model to rephrase and retry.
      //
      // Matched against real tool strings, not guessed: the noun between "no"
      // and "found" varies wildly ("No labels found", "No memories found",
      // "No sent emails found", "No past meetings found"), so anchoring on a
      // fixed noun list missed most of them. Only the first 200 chars are
      // examined, and populated results start with "Found N", so an email body
      // containing similar words cannot flip a real result to empty.
      const head = text.slice(0, 200);
      const empty =
        /\bno\b[^.!?\n]{0,48}\b(found|yet|match(?:es|ing)?)\b/i.test(head) ||
        /^\s*none\b/i.test(head) ||
        /\bnot found\b/i.test(head) ||
        // "No upcoming events in the next 7 days." — no verb to anchor on.
        // Safe only at position 0: populated results open with "Found N…" or
        // "Message-ID:…", so a mail body that merely contains "no thanks"
        // cannot reach here.
        /^\s*no\s+\w/i.test(head);
      if (empty) outcome = 'NOTHING FOUND';
      else {
        const m = text.match(/found\s+(\d+)/i) || text.match(/^(\d+)\s+(?:recent|email|result)/i);
        outcome = m ? `${m[1]} result(s)` : `${Math.min(text.length, 99999)} chars returned`;
      }
    }
    gathered.push({ name, hint, outcome });
  }

  // PART 31 — Per-run dedup cache. When the LLM tries to call a READ tool
  // with the same params it already used this turn, we return the cached
  // result instead of re-running the API call. This kills the "drafting one
  // reply does the same search 4 times" loop the user reported.
  //
  // ONLY read/search tools are cacheable — writes (send_email, etc.)
  // always re-execute because their semantics differ (a second send is a
  // second email, not a cached no-op).
  //
  // Key shape: `${toolName}|${stableJsonStringify(input)}`
  const READ_TOOLS_FOR_DEDUP = new Set([
    'search_gmail', 'read_email', 'gmail_read_thread', 'get_sent_emails',
    'gmail_get_labels', 'gmail_get_profile',
    'get_calendar_events', 'calendar_get_availability', 'calendar_unlimited_scan',
    'search_notion', 'notion_read_page', 'fetch_notion_schema',
    'web_search', 'web_search_instant',
    'memory_search', 'memory_get_contact_profile', 'memory_unlimited_scan',
    'gmail_unlimited_search', 'gmail_bulk_read_threads',
    'get_voice_profile', 'get_contact_context', 'get_recipient_context',
    'slack_get_channels', 'slack_find_user',
  ]);
  const toolResultCache = new Map<string, { output: string; success?: boolean; canvasData?: any }>();

  // F4 — Normalize input values so the LLM hitting the same search with a
  // slightly different phrasing (e.g. "Q3 proposal" vs "Q3 proposal Priya")
  // still cache-hits. Without this the cache rarely caught anything.
  const STOP_WORDS = new Set([
    'a', 'an', 'and', 'or', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
    'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as',
    'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'me', 'my',
    'about', 'please', 'find', 'show', 'me', 'get', 'list', 'all', 'any',
  ]);
  function normalizeValue(v: any): any {
    if (v == null) return v;
    if (typeof v === 'string') {
      const tokens = v
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s@\-_.]/gu, ' ')
        .split(/\s+/)
        .filter(t => t && !STOP_WORDS.has(t));
      tokens.sort();
      return tokens.join(' ');
    }
    if (Array.isArray(v)) {
      const norm = v.map(normalizeValue);
      // Stable order for ID arrays / lists — sort lex.
      try { return [...norm].sort((a, b) => String(a).localeCompare(String(b))); }
      catch { return norm; }
    }
    if (typeof v === 'object') {
      const out: any = {};
      for (const k of Object.keys(v).sort()) out[k] = normalizeValue(v[k]);
      return out;
    }
    return v;
  }
  function makeCacheKey(name: string, input: any): string {
    try {
      return `${name}|${JSON.stringify(normalizeValue(input || {}))}`;
    } catch {
      return `${name}|<unserializable>`;
    }
  }

  // F1 — Intent classifier. Computed early so the LLM gets [INTENT: …] in
  // its system prompt AND so we can suppress the tool schema entirely for
  // identity / smalltalk / capability messages (kills "Who are you?" →
  // calendar tool dispatch).
  const lastTurn = history.length > 0 ? history[history.length - 1] : null;
  const hasOpenConfirmation = !!(lastTurn && lastTurn.role === 'assistant' &&
    /(should I|shall I|do you want me to|need approval|please confirm|confirmation card)/i.test(lastTurn.content));
  const detectedIntent = classifyUserIntent(userMessage, hasOpenConfirmation);
  const suppressToolsForIntent = shouldSuppressTools(detectedIntent) && !isBackgroundAgent;

  // PART 39b — VA-scoped tool filtering. Compute the dispatcher decision
  // ONCE here so it's reused for (1) trimming the tool surface the LLM sees
  // and (2) deciding whether to run the parallel context sweep further down.
  // Filter applies only on interactive turns where the dispatcher fires
  // (≥2 VAs relevant); background agents and pivot-prone follow-up turns
  // keep the full surface.
  //
  // PART 48 — committeeMode overrides everything: this loop is ONE VA of a
  // parallel committee; lock the tool surface to just that VA's tools and
  // skip the standard 5-VA sweep + dispatch nudge (the orchestrator already
  // handed out the work).
  const committeeVA = opts.committeeMode?.va;
  const vaDispatch = committeeVA
    ? { fire: false, vas: [] as BoultVA[], reason: 'none' as const }
    : !isPlanMode && !isBackgroundAgent
      ? shouldDispatchParallelVAs(userMessage)
      : { fire: false, vas: [] as BoultVA[], reason: 'none' as const };
  const vaFilter: BoultVA[] | undefined = committeeVA
    ? [committeeVA]
    : vaDispatch.fire && vaDispatch.vas.length >= 2
      ? vaDispatch.vas
      : undefined;

  const availableTools = (isPlanMode || suppressToolsForIntent)
    ? []
    : getAvailableTools(connectedIntegrations, isBackgroundAgent, vaFilter);

  // ── NARRATED EXECUTION PROTOCOL ─────────────────────────────────────────────
  // Every tool schema gains a leading `_narration` field the model fills as
  // part of the call itself — see lib/boult/narration.ts for the full doctrine.
  // Stripped before execution (extractNarrations), emitted with tool_call.
  const narratedTools = withNarrationField(availableTools as any[]);

  if (vaFilter) {
    log('info', 'tool surface VA-filtered', {
      relevantVAs: vaFilter,
      total: TOOL_SCHEMAS.length,
      exposed: availableTools.length,
    });
  }

  // Append intent hint to the system prompt so the LLM reads it every turn.
  const effectiveSystemPrompt = `${systemPrompt}\n\n${intentSystemHint(detectedIntent)}`;
  // Background agents get the raised limit so they can handle large inboxes
  // without hitting the wall mid-run. Interactive sessions stay at 20 so
  // the LLM doesn't burn budget on exploratory calls.
  const hardCap = isBackgroundAgent ? MAX_TOOL_CALLS_BACKGROUND : MAX_TOOL_CALLS;
  const toolCallLimit =
    typeof maxToolCalls === 'number' && maxToolCalls > 0
      ? Math.min(maxToolCalls, hardCap)
      : hardCap;
  // Use the agent-run id when provided so audit logs join back to the run the
  // user sees; otherwise mint a throwaway id (interactive chat has no run row).
  const runId = agentRunId || crypto.randomUUID();
  const startedAt = Date.now();
  // deadlineMs === 0 means the caller's budget is ALREADY exhausted — treat it
  // as expired-now (finalize immediately with whatever exists), never as
  // "no deadline". The old `> 0 ? … : Infinity` turned an out-of-budget cron
  // agent into an UNBOUNDED run inside a nearly-dead function.
  const deadlineAt =
    typeof deadlineMs === 'number'
      ? (deadlineMs > 0 ? startedAt + deadlineMs : startedAt)
      : Infinity;
  // The report-writing call runs AFTER the tool deadline, so it gets a bit more
  // rope (the cron's delivery reserve) — still bounded so it can never overshoot
  // the function limit and get the run killed mid-finalize.
  const reportDeadlineAt = Number.isFinite(deadlineAt) ? deadlineAt + 12_000 : Infinity;
  // Newsletter/promo filtering should apply to ANY email-listing task, not only
  // ones that match inbox keywords — otherwise promos leak into summaries and
  // "reply to X" results. The only time we keep them is when the user is
  // explicitly hunting for a newsletter/promotional/receipt email.
  const wantsPromos = /\b(newsletter|promotion(al)?|promo|unsubscribe|marketing|receipt|digest|sale|coupon)\b/i.test(userMessage);
  const filterNewsletters = !wantsPromos;

  return new ReadableStream({
    async start(controller) {
      let sentUserFacing = false;
      let anyToolRan = false;
      // The "on it" opener: the model's first pre-tool text is emitted ONCE as
      // an `ack` event — the client renders it as a permanent chat line above
      // the execution steps (it never gets replaced by the final report).
      let ackEmitted = false;
      // True when the run wrapped up because TIME or TOOL BUDGET ran out with
      // work potentially unfinished. Sent on the done event as `deadlineHit`
      // so the client can auto-continue the task in a fresh invocation.
      let ranOutOfBudget = false;
      let sentTextMessage = false;   // a real prose message (not just a canvas/card) reached the user
      let draftCanvasCount = 0;      // # of email_draft canvases emitted — drives the draft-aware close message
      const emit = (type: string, data: unknown) => {
        if (type === 'tool_call') {
          anyToolRan = true;
        } else if (type === 'question' || type === 'plan' || type === 'approval_required' || type === 'canvas' || type === 'mode_switch') {
          sentUserFacing = true;
          if (type === 'canvas' && (data as any)?.type === 'email_draft') draftCanvasCount++;
        } else if (type === 'message') {
          const c = (data as any)?.content;
          if ((typeof c === 'string' && c.trim()) || (data as any)?.canvasContent) { sentUserFacing = true; sentTextMessage = true; }
        }
        try { controller.enqueue(encode(sseEvent(type, data))); } catch { /* closed */ }
      };

      // Heartbeat — one tiny `ping` every 10s so the CLIENT's stall guard
      // (90s of SSE silence = dead connection) never fires on a healthy long
      // run. A single LLM attempt can be silent for 32s, and a stalling-
      // provider day chains several of those; the ping proves liveness
      // without adding any UI. Cleared in closeStream.
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encode(sseEvent('ping', { t: Date.now() }))); } catch { /* closed */ }
      }, 10_000);

      /**
       * F1.2 — Single canonical close path. Every controller.close() in this
       * loop MUST go through this helper so we always emit `done` first.
       * Previously, error branches called close() without done, leaving the
       * ChatInterface in its "stream finished unexpectedly" fallback path
       * (where it fabricated "Done — completed [tool salad]" strings).
       *
       * If a 'done' was already emitted before the caller hit this helper,
       * the alreadyDone flag suppresses the second emission so we don't
       * double-emit `done`. Idempotent on multiple calls (controller throws
       * when closing twice).
       */
      let alreadyDone = false;
      const closeStream = (totalSteps = 0) => {
        if (!alreadyDone) {
          // Backstop: never close a run that did real work without giving the
          // user something readable. Covers EVERY terminal path (mustStop,
          // error branches, deadline) regardless of client behaviour.
          // If draft cards streamed but no prose summary landed (deadline hit
          // right after batch drafting), confirm the drafts and point at the
          // cards — NOT the misleading "saved to Gmail Drafts, ask again" line.
          if (!sentTextMessage && draftCanvasCount > 0) {
            try {
              controller.enqueue(encode(sseEvent('message', {
                content: `I drafted ${draftCanvasCount} repl${draftCanvasCount === 1 ? 'y' : 'ies'} — review and send each from the cards below.`,
              })));
            } catch { /* closed */ }
            sentUserFacing = true;
          } else if (!sentUserFacing && anyToolRan) {
            try {
              controller.enqueue(encode(sseEvent('message', {
                content: "I worked through that, but couldn't pull it into a clean summary this time. If I was drafting a reply, it's saved in your Gmail Drafts — open Drafts to review and send. Ask me again and I'll lay out exactly what I found.",
              })));
            } catch { /* closed */ }
            sentUserFacing = true;
          }
          alreadyDone = true;
          // deadlineHit → the client auto-continues this task in a fresh
          // invocation (question/plan turns never set it — they end on purpose).
          try { controller.enqueue(encode(sseEvent('done', { runId, durationMs: Date.now() - startedAt, totalSteps, deadlineHit: ranOutOfBudget }))); } catch { /* closed */ }
        }
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      };

      try {
        log('info', 'run_start', { runId, isPlanMode, tools: availableTools.map(t => t.name), msgLen: userMessage.length });
        emit('run_start', { runId, message: userMessage });

        // ── FAST CONVERSATIONAL PATH ────────────────────────────────────────
        // Smalltalk / identity / capability need no tools and no "processing".
        // Skip the ENTIRE agent loop: one quick, warm reply on a FAST model,
        // zero thinking cards, zero multi-pass. This is the <2s continuing-
        // conversation UX — an employee chatting back, not software grinding
        // on "hi" for 20 seconds. Any failure/empty falls through to the loop.
        if (suppressToolsForIntent && !isPlanMode && !isBackgroundAgent) {
          try {
            // Tell the client to drop the "Understanding…" step — this is chat,
            // not a task, so it should render with zero processing UI.
            emit('conversational', {});
            const convSystem =
              `You are Boult — the user's AI chief of staff. You run their inbox across Gmail, Calendar, Notion and Slack so email stops being their job. ` +
              `Right now this is casual conversation, NOT a task. Talk like a brilliant, warm colleague texting back — real energy, genuinely glad to be working with them, and keep it moving. Keep it to 1-3 sentences. ` +
              `Never call tools. Never describe "processing" or steps. Never open with "I'd be happy to" / "Certainly" / "How can I assist you today". Just be a person.\n\n` +
              intentSystemHint(detectedIntent);
            const convo = await callLLM(
              [
                { role: 'system', content: convSystem },
                ...history.slice(-6),
                { role: 'user', content: userMessage },
              ] as LLMMessage[],
              [],
              { maxTokens: 300, temperature: 0.7, fastFirst: true, deadlineAt: startedAt + 15_000 },
            );
            const text = sanitizeModelText(getRawText(convo.content)).trim();
            if (text) {
              emit('message', { content: text });
              closeStream(0);
              return;
            }
            // Empty (rare) → fall through to the normal loop below.
          } catch {
            // Never break chat — fall through to the normal loop.
          }
        }

        // ── Pre-plan clarification pass ─────────────────────────────────────
        // Ask clarifying questions ONLY when truly needed. Skip entirely if:
        // - The user already provided answers (Q:/A: pattern in history), OR
        // - The request already contains enough context to write a complete plan.
        // Never ask about things derivable from connected integrations.
        if (isPlanMode) {
          // Detect if the user has already answered questions (any user message with Q:/A: pairs)
          const alreadyAnswered = history.some(h =>
            h.role === 'user' && /Q:[\s\S]*\nA:/.test(h.content)
          ) || /Q:[\s\S]*\nA:/.test(userMessage);

          if (!alreadyAnswered) {
            emit('thinking', { status: 'Analysing your request…' });

            const connectedInfo = connectedIntegrations.length > 0
              ? `Connected integrations (already available — NEVER ask about these): ${connectedIntegrations.join(', ')}.`
              : 'No integrations connected.';

            const clarifyRes = await callLLM(
              [
                {
                  role: 'system',
                  content:
                    `You are about to create a detailed execution plan for the user.\n\n` +
                    `${connectedInfo}\n\n` +
                    `Rule: Only ask a clarifying question if (a) the answer is genuinely unknown from the request and context, AND (b) the answer would significantly change the structure of the plan. ` +
                    `Do NOT ask about: which apps to use (you can see what is connected), the user's name, timezone, or anything inferable from the request. ` +
                    `Do NOT ask more than 2 questions. ` +
                    `If the request is specific enough to plan immediately, respond with ONLY the word "proceed" — nothing else.\n\n` +
                    `IF you call ask_user: give every question 2-4 short answer options ordered MOST-PROBABLE FIRST — the first option is your best guess and renders preselected, so the user can accept it with one tap. ALSO output ONE short sentence of text BEFORE the tool call. The sentence sets up the questions ("Before I draft this plan, I need to nail down a couple of things:" / "Quick — to make this plan useful, two things to confirm:"). Do NOT explain WHY you need the answers — the questions speak for themselves. Do NOT list the questions in the text; they render as a separate card.`,
                },
                ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
                { role: 'user', content: userMessage },
              ],
              [ASK_USER_SCHEMA],
              { maxTokens: 350, temperature: 0.1, deadlineAt },
            );

            const clarifyToolCalls = getToolCalls(clarifyRes.content);
            const askCall = clarifyToolCalls.find(tc => tc.name === 'ask_user');
            if (askCall) {
              const questions = (askCall.input?.questions ?? []).filter((q: any) => q?.text?.trim());
              if (questions.length > 0) {
                // Plan-mode UX fix — emit the preamble text the LLM produced
                // alongside its ask_user tool call BEFORE the question event,
                // so the user sees a normal chat bubble setting up the
                // questions instead of an empty reply followed by a card.
                // Falls back to a static preamble if the model produced none
                // (older models sometimes emit the tool_use with no text).
                const preambleRaw = sanitizeModelText(getRawText(clarifyRes.content) || '').trim();
                const preamble = preambleRaw && preambleRaw.length >= 10 && preambleRaw.length <= 400
                  ? preambleRaw
                  : 'Before I draft this plan, I need to nail down a couple of things:';
                emit('message', { content: preamble });
                emit('question', { questions, runId });
                closeStream(0);
                return;
              }
            }
          }
        }

        // ── Layer 1: Vague instruction detection ────────────────────────────
        if (!isPlanMode && availableTools.length > 0 && isVagueInstruction(userMessage)) {
          emit('thinking', { status: 'Interpreting your request…' });

          const vagueRes = await callLLM(
            [
              { role: 'system', content: systemPrompt },
              {
                role: 'system',
                content:
                  'The user has given a broad instruction. Do NOT call any tools. ' +
                  'Interpret their request using your knowledge of what tools are available and what you can do. ' +
                  'Respond in exactly two sentences: ' +
                  '(1) What specific actions you will take (tools in order, who you will contact, what you will produce). ' +
                  '(2) What the outcome will be for the user. ' +
                  'Then on a new line, write exactly: "Should I proceed?" ' +
                  'Be specific and confident. No hedging.',
              },
              ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
              { role: 'user', content: userMessage },
            ],
            [], // no tools — this is a planning pass only
            { maxTokens: 300, temperature: 0.2, deadlineAt },
          );

          const planText = sanitizeModelText(getText(vagueRes.content));
          emit('message', { content: planText });
          closeStream(0);
          return;
        }

        // ── PART 11 — Hard intercept: agent-creation requests ──────────────
        // When the user asks to CREATE / SET UP / SCHEDULE a recurring agent,
        // the LLM has historically emitted a plan paragraph + "Should I
        // proceed?" instead of calling create_scheduled_agent. System-prompt
        // rules alone weren't enough. So we bypass the entire normal flow and
        // force a tool call to create_scheduled_agent Stage 1 with only that
        // schema available + forceToolCall: true.
        //
        // The detector is conservative — it ignores follow-up messages in an
        // already-in-progress creation flow (spec approved, plan approved).
        const AGENT_CREATION_INTENT = /\b(create|set ?up|schedule|build|make|register)\b.{0,60}\b(scheduled|recurring|background|cron|daily|weekly|hourly|monthly|automated?)?\s*(agent|bot|automation|workflow|cron\s*job)\b/i;
        const isAgentCreationFollowup =
          userMessage.trim().startsWith('Spec approved for ') ||
          userMessage.trim().startsWith('Create the scheduled agent now.') ||
          userMessage.trim().startsWith('Create agent ') ||
          userMessage.trim().startsWith('Execute these steps in order:');

        // F10 — Intent classifier feeds this intercept. The regex stays as a
        // fallback but the classifier catches paraphrases the regex misses
        // ("set up a daily inbox check" without the word "agent"). The
        // classifier ALSO acts as a negative filter — if the user asked
        // "what's my agent's status?" the classifier returns `query`, not
        // `agent_creation`, so the intercept is suppressed even though the
        // word "agent" appears.
        const looksLikeAgentCreation =
          !isPlanMode &&
          !isBackgroundAgent &&
          !isAgentCreationFollowup &&
          (detectedIntent === 'agent_creation' || AGENT_CREATION_INTENT.test(userMessage)) &&
          detectedIntent !== 'query' &&
          detectedIntent !== 'capability';

        if (looksLikeAgentCreation) {
          emit('thinking', { status: 'Drafting the agent spec…' });

          // The LLM gets ONLY the create_scheduled_agent schema and is forced
          // to emit a tool call. This makes it physically impossible to emit
          // a plan paragraph instead.
          const createAgentSchema = TOOL_SCHEMAS.find(s => s.name === 'create_scheduled_agent');
          if (!createAgentSchema) {
            log('error', 'create_scheduled_agent schema missing — falling through to default loop');
          } else {
            const intercept = await callLLM(
              [
                { role: 'system', content: systemPrompt },
                {
                  role: 'system',
                  content:
                    'AGENT CREATION INTERCEPT: The user has asked to create a scheduled background agent. ' +
                    'Your ONLY allowed action this turn is to call create_scheduled_agent ONCE. ' +
                    'You MUST include ALL of these fields in the SAME call — never omit any: ' +
                    '`name` (a short human name for the agent), `task_description` (the full self-contained instruction it runs each time), ' +
                    '`cron_schedule` (5-field cron), and `spec_markdown` (the full spec document). ' +
                    'Omitting name or task_description WILL fail. Fill name from the spec\'s title and task_description from its objective if the user did not state them explicitly. ' +
                    'Do NOT write any text. Do NOT call open_canvas. Do NOT call any read tool (search_gmail, gmail_get_profile, get_calendar_events, etc.). ' +
                    'spec_markdown must contain a full specification document: a "# <Agent Name>" H1, then "## 1. Agent Objective", "## 2. Operational Logic", "## 3. Schedule & Delivery", "## 4. Expected Output". ' +
                    'No bracketed placeholders. Be specific about what the agent will read, write, and deliver. ' +
                    'If the user gave you the name, schedule, and delivery channel — use them verbatim. ' +
                    'If something is genuinely missing, set the field to a reasonable default rather than asking — the spec stage shows the user everything and they can edit before confirming.',
                },
                ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
                { role: 'user', content: userMessage },
              ],
              [createAgentSchema],
              { forceToolCall: true, maxTokens: 4000, temperature: 0.2, deadlineAt },
            );

            const interceptToolCalls = getToolCalls(intercept.content);
            const createCall = interceptToolCalls.find(tc => tc.name === 'create_scheduled_agent');
            if (createCall) {
              log('info', 'agent_creation_intercept_success', { name: createCall.input?.name });
              emit('tool_call', { tool: 'create_scheduled_agent', params: createCall.input, iteration: 0 });
              try {
                const result = await executeTool(
                  'create_scheduled_agent',
                  createCall.input,
                  userId,
                  {
                    conversationId,
                    toolHistory: [],
                    isBackgroundAgent,
                    skipConfirmations,
                    runId,
                    agentId,
                    runState: 'PLANNING' as const,
                  },
                );
                emit('tool_result', { tool: 'create_scheduled_agent', success: result.success !== false, summary: result.output.slice(0, 300), iteration: 0 });
                if (result.canvasData) emit('canvas', result.canvasData);
                // F8 — Internal-only validation errors (e.g. missing spec_markdown)
                // must NEVER reach chat verbatim. Swap with a clean clarifying ask.
                const isInternalOnly = (result as any)._internal_only === true;
                const userFacing = isInternalOnly
                  ? 'What should this agent do, and how often? (e.g. "summarise my inbox every morning at 7am")'
                  : sanitizeModelText(result.output);
                emit('message', { content: userFacing });
                closeStream(1);
                return;
              } catch (err: any) {
                log('error', 'agent_creation_intercept_execution_failed', { error: err.message });
                emit('error', { message: `Couldn't create the agent: ${err.message}` });
                closeStream(0);
                return;
              }
            }
            log('warn', 'agent_creation_intercept_no_tool_call — falling through to default loop');
          }
        }

        // ── Stage 2 intercept: spec-approved message from UI Confirm button ─
        // After the user clicks Confirm on the spec card, ChatInterface sends:
        //   Spec approved for "<name>". Create the agent now.
        //   Call create_scheduled_agent with these exact parameters AND _planApproved: true:
        //   - name: "..."
        //   - task_description: "..."
        //   - cron_schedule: "..."
        //   - output_channel: "..."
        //   - skip_confirmations: false|true
        //   - _planApproved: true
        // We don't need an LLM round-trip — parse the params directly from the
        // message and call the tool. This guarantees the LLM cannot "ask for
        // confirmation again" because the LLM never sees this message.
        const isStage2SpecApproved =
          !isPlanMode &&
          !isBackgroundAgent &&
          /^Spec approved for ['"]/.test(userMessage.trim()) &&
          userMessage.includes('_planApproved: true');

        if (isStage2SpecApproved) {
          emit('thinking', { status: 'Registering your agent…' });
          const params = parseStructuredAgentParams(userMessage);
          if (params && params.name && params.task_description && params.cron_schedule) {
            try {
              emit('tool_call', { tool: 'create_scheduled_agent', params, iteration: 0 });
              const result = await executeTool(
                'create_scheduled_agent',
                params,
                userId,
                {
                  conversationId,
                  toolHistory: [],
                  isBackgroundAgent,
                  skipConfirmations,
                  runId,
                  agentId,
                  runState: 'EXECUTING' as const,
                },
              );
              emit('tool_result', { tool: 'create_scheduled_agent', success: result.success !== false, summary: result.output.slice(0, 300), iteration: 0 });

              // F1.1 — Branch on result.success. Previously we ALWAYS emitted
              // a "**X** is live — first run …" message even on validation
              // errors / integration gates / agent_create_failed, because the
              // happy-path code ran unconditionally. The user would see a
              // confident "live" message but no agent was created.
              if (result.success === false) {
                log('warn', 'stage2_intercept_tool_returned_failure', { code: result.errorCode, output: result.output.slice(0, 200) });
                // Surface the canvasData regardless (integration_required
                // card is useful) but use the tool's actual output text in
                // the chat message — sanitized by the sanitizer downstream
                // so self-instructions don't leak.
                if (result.canvasData) emit('canvas', result.canvasData);
                // Strip the LLM-facing "Now write..." / "Do NOT call any
                // more tools" tails before showing to the user.
                const userFacing = result.output
                  .replace(/\s*Do\s+NOT\s+call\s+(?:any\s+more|more)\s+tools?\.?/gi, '')
                  .replace(/\s*Now\s+(?:write|call|tell|reply|compose|confirm)\s+[^.\n]*?(?:to\s+the\s+user|the\s+user)[^.\n]*?\.\s*$/gi, '')
                  .trim();
                emit('message', { content: userFacing || `Couldn't create the agent — ${result.errorCode || 'unknown error'}.` });
                closeStream(1);
                return;
              }

              // Happy path — agent created. Emit canvas + the tool's own rich,
              // randomized, timezone-correct description. We emit richDescription
              // VERBATIM rather than letting the model compose a sentence — that
              // is what produced the wrong run time in chat.
              if (result.canvasData) emit('canvas', result.canvasData);
              const cd: any = result.canvasData;
              const rich = cd?.pageMeta?.richDescription;
              if (rich) {
                emit('message', { content: rich });
              } else {
                // Fallback only if the tool didn't supply one.
                const attrs: any[] = cd?.pageMeta?.attendees || [];
                const scheduleLabel = attrs[0] || 'as scheduled';
                emit('message', { content: `**${params.name}** is live — running ${scheduleLabel}.` });
              }
              closeStream(1);
              return;
            } catch (err: any) {
              log('error', 'stage2_intercept_execution_failed', { error: err.message });
              emit('error', { message: `Couldn't create the agent: ${err.message}` });
              closeStream(0);
              return;
            }
          }
          log('warn', 'stage2_intercept_param_parse_failed — falling through to default loop', { sample: userMessage.slice(0, 200) });
        }

        // ── PART 9: Build execution plan ────────────────────────────────────
        // Build the dependency-ordered execution plan BEFORE the first LLM call.
        // The plan is injected as a hint at the end of the messages array so the
        // LLM always sees the intended tool sequence and doesn't re-order it.
        // Null plan = no orchestration needed (conversational message, plan mode).
        const executionPlan = buildExecutionPlan(
          userMessage,
          connectedIntegrations,
          isPlanMode,
        );

        if (executionPlan) {
          log('info', 'orchestration_plan', {
            intent: executionPlan.intent,
            steps: executionPlan.steps.length,
            missingIntegrations: executionPlan.missingIntegrations,
            estimatedCalls: executionPlan.estimatedCalls,
          });
          emit('orchestration_plan', {
            intent: executionPlan.intent,
            steps: executionPlan.steps.map(s => ({
              label: s.label,
              tools: s.tools,
              parallel: s.parallel,
              isWrite: s.isWrite,
              requiredIntegration: s.requiredIntegration,
            })),
            missingIntegrations: executionPlan.missingIntegrations,
            estimatedCalls: executionPlan.estimatedCalls,
          });
        }

        // ── Pre-loop: generate task list ────────────────────────────────────
        const planModeInstruction = isPlanMode
          ? `\n\n[PLAN MODE — STRICT]\nYou are in plan creation mode. Your only output must be a well-structured markdown plan document.\nRules:\n- Do NOT execute any actions or call any tools\n- Do NOT use agent-style language ("I'll now...", "Let me...", "I've completed...")\n- Write the plan entirely in future tense ("Step 1: Search...", "Step 2: Analyse...")\n- Structure the plan with: ## Objective, ## Steps (numbered), ## Expected Output, ## Time estimate\n- Be specific: name the exact tools/APIs/searches that would be used\n- The user should be able to hand this plan to someone else and have it executed exactly`
          : '';

        // F12 — Build the user message. If images attached, use the multi-block
        // vision shape ({type:'text'},{type:'image_url'}). Non-image attachments
        // (PDF, txt, etc.) are surfaced as a text mention so the LLM knows they
        // exist even though it can't see their contents.
        //
        // PART 44 — strengthen the attachment hints so the LLM never claims to
        // have "analyzed" something it cannot read. The chat route already
        // extracts plain-text file contents server-side (PART 44c) and prepends
        // them to the message inside [ATTACHMENT — filename] fences; whatever
        // remains in nonImageAttachments here is binary (PDF, docx, xlsx, zip)
        // whose contents are genuinely unavailable.
        const userMessageWithRules = userMessage + activeRulesHint;
        const imageHint = imageAttachments.length > 0
          ? `\n\n[IMAGE${imageAttachments.length > 1 ? 'S' : ''} ATTACHED: ${imageAttachments.map(a => a.name || 'image').join(', ')}]\nIf the active model supports vision you may see the image content. If you cannot describe specific visible elements (colors, shapes, text shown), do NOT claim to have "analyzed" or "reviewed" the image — say honestly: "I see you attached <name> but I can't make out its contents from here. Describe what's in it or paste the key text and I'll take it from there."`
          : '';
        const binaryAttachmentNames = nonImageAttachments
          .filter(a => !/^text\/|\.(txt|md|csv|json|log)$/i.test(a.type || a.name || ''))
          .map(a => a.name || 'file');
        const binaryHint = binaryAttachmentNames.length > 0
          ? `\n\n[BINARY FILE${binaryAttachmentNames.length > 1 ? 'S' : ''} ATTACHED: ${binaryAttachmentNames.join(', ')}]\nContents NOT loaded — these are binary files (PDF, docx, xlsx, zip, etc.) whose contents the current setup cannot read. Do NOT claim to have analyzed them. Ask the user to paste the relevant passages as text, or extract a screenshot if it's visual.`
          : '';
        const finalUserText = userMessageWithRules + imageHint + binaryHint;

        const userMessageContent: string | any[] = imageAttachments.length > 0
          ? [
              { type: 'text' as const, text: finalUserText },
              ...imageAttachments.map(a => ({ type: 'image_url' as const, image_url: { url: a.url } })),
            ]
          : finalUserText;

        const messages: LLMMessage[] = [
          { role: 'system', content: effectiveSystemPrompt + planModeInstruction },
          ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
          { role: 'user', content: userMessageContent as any },
        ];

        // Inject orchestration hint as the final user message so it's the last
        // thing the LLM reads before generating tool calls.
        if (executionPlan && !isPlanMode) {
          const hint = planToHint(executionPlan, toolCallLimit);
          // Append to the last user message (the userMessage we just pushed) rather
          // than a new message — keeps the role alternation clean.
          const lastMsg = messages[messages.length - 1] as any;
          if (typeof lastMsg.content === 'string') {
            lastMsg.content = `${lastMsg.content}\n\n${hint}`;
          }
        }

        // ── PART 10 Fix 7: Agent plan approved — inject _planApproved ────────
        // When the user sends "Create agent X - plan approved", the LLM must
        // call create_scheduled_agent with _planApproved: true in the input.
        const isAgentPlanApproval = /^Create agent .+ - plan approved$/i.test(userMessage.trim());
        if (isAgentPlanApproval) {
          const lastMsg = messages[messages.length - 1] as any;
          if (typeof lastMsg.content === 'string') {
            lastMsg.content = `${lastMsg.content}\n\n[AGENT PLAN APPROVED] The user has approved the agent plan. Call create_scheduled_agent NOW with the parameters from context AND include "_planApproved: true" in the input parameters. Do not show another plan preview.`;
          }
        }

        // PART 48 — committee-mode framing. Identifies this VA + its siblings,
        // names the lane, and REQUIRES the LLM to compose its section per the
        // REQUIRED OUTPUT FORMAT block at the bottom of the focus brief.
        if (committeeVA) {
          const lastMsg = messages[messages.length - 1] as any;
          const VA_LABELS: Record<BoultVA, string> = {
            inbox: '📧 Inbox VA', calendar: '📅 Calendar VA', crm: '📝 CRM VA',
            comms: '💬 Comms VA', research: '🔍 Research VA',
          };
          const siblings = (opts.committeeMode?.siblingVAs || [])
            .filter(v => v !== committeeVA)
            .map(v => VA_LABELS[v])
            .join(', ') || 'none — you are the only VA on this run';
          const hint = `\n\n[COMMITTEE MODE — you are the ${VA_LABELS[committeeVA]}]\nSiblings running in parallel: ${siblings}. Focus only on ${committeeVA}-domain work — your tools are already narrowed to your lane.\n\nTWO-PHASE EXECUTION (mandatory):\n  Phase A — Tool calls: execute the work the task implies, using your lane's tools.\n  Phase B — Compose your section: after Phase A, you MUST write the markdown section per the REQUIRED OUTPUT FORMAT in the focus brief above. The chief of staff inserts your section verbatim into the user's briefing — if you skip Phase B, the user sees "no work needed" even when you ran tools, and that is a failure.`;
          if (typeof lastMsg.content === 'string') {
            lastMsg.content = `${lastMsg.content}${hint}`;
          } else if (Array.isArray(lastMsg.content)) {
            const textBlock = lastMsg.content.find((b: any) => b?.type === 'text');
            if (textBlock) textBlock.text = `${textBlock.text}${hint}`;
          }
        }

        // Plan-mode UX fix — when the user message is a Q&A reply to the
        // clarify pass's ask_user, tell the LLM explicitly that the answers
        // are in and it should draft the full plan now. Without this nudge
        // the LLM sometimes treats the Q:/A: lines as conversational and
        // produces a short reply instead of the structured markdown plan.
        if (isPlanMode && /Q:[\s\S]*\nA:/.test(userMessage)) {
          const lastMsg = messages[messages.length - 1] as any;
          const hint = `\n\n[CLARIFYING ANSWERS RECEIVED] The user has answered your clarifying questions above. Draft the full structured markdown plan NOW per the plan-mode rules in the system prompt (## Objective / ## Steps (numbered) / ## Expected Output / ## Time estimate). Start the response immediately with "# <Plan Title>" — no preamble, no conversational text before the H1.`;
          if (typeof lastMsg.content === 'string') {
            lastMsg.content = `${lastMsg.content}${hint}`;
          } else if (Array.isArray(lastMsg.content)) {
            // Multi-block content (text + images) — find/append the text block
            const textBlock = lastMsg.content.find((b: any) => b?.type === 'text');
            if (textBlock) textBlock.text = `${textBlock.text}${hint}`;
          }
        }

        let totalToolCalls = 0;
        let nudgeCount = 0;
        let stepListingRetryCount = 0; // counter: allows up to 2 forced retries before giving up
        // Bug A — background agents on weak models tend to do the MINIMUM: one
        // search_gmail, then write a report and quit, producing a near-empty
        // run ("1 tool call · 21s"). This counter lets us nudge such a run to
        // keep working ONCE before accepting its early finish. Capped at 2 so a
        // genuinely-done run (or a stubborn model) still terminates.
        let keepWorkingNudges = 0;
        const MAX_KEEP_WORKING_NUDGES = 2;
        let finalText = '';
        let canvasContent: any = null;
        let iteration = 0;
        let taskCount = 0;
        let archivedCount = 0;
        const outcomes: ToolOutcome[] = [];
        let forceNextToolCall = false;

        // ── Agent state machine (RC3) ──────────────────────────────────────
        // Four phases the run can be in:
        //   PLANNING   — fetching context, no writes yet
        //   CONFIRMING — request_confirmation emitted, waiting on user (loop ends turn)
        //   EXECUTING  — user approved, write tools running
        //   REPORTING  — all tool calls done, composing final message
        //
        // The hard write-time gate already lives in tools.ts/session-state.ts
        // (Phase 2). This tracker is for observability: the UI shows the
        // current phase and the LLM sees a [STATE: ...] tag so it knows
        // what's expected of it next. State transitions also feed audit log.
        type RunState = 'PLANNING' | 'CONFIRMING' | 'EXECUTING' | 'REPORTING';
        let runState: RunState = 'PLANNING';
        const transitionState = (next: RunState, reason: string) => {
          if (runState === next) return;
          log('info', 'state_change', { from: runState, to: next, reason });
          runState = next;
          emit('state_change', { state: next, reason, iteration });
        };
        emit('state_change', { state: runState, reason: 'run_start', iteration: 0 });

        // If the user message looks like an approval response ("yes", "go
        // ahead", "confirmed"), the LLM is being woken up from a previous
        // CONFIRMING turn — start this turn in EXECUTING so the LLM knows
        // the gate is open. Cheap heuristic; the real gate is consumeApproval.
        const looksLikeApproval = /^(yes|y|yep|yeah|go ahead|confirmed|confirm|please proceed|do it|send it|proceed)\b/i.test(userMessage.trim());
        if (looksLikeApproval) transitionState('EXECUTING', 'user_message_looks_like_approval');

        // FIX 1 — buildToolContext is defined here (inside start()) so it can
        // close over `runState`, which is a let-mutable declared above. The
        // arrow function re-reads runState on every call, so write tools always
        // see the current phase — not a stale snapshot from construction time.
        const buildToolContext = () => ({
          conversationId,
          toolHistory: [...toolHistory],
          isBackgroundAgent,
          skipConfirmations,
          runId,
          agentId,
          runState: runState as 'PLANNING' | 'CONFIRMING' | 'EXECUTING' | 'REPORTING',
        });

        // ── Five-VA dispatcher: parallel context sweep ──────────────────────
        // PART 37 — small/free LLMs rarely emit multiple tool_use blocks per
        // turn. That makes the AI feel one-tool-at-a-time even though the
        // system prompt and infra both support 5-VA parallelism. To force
        // the parallel-VA experience: detect which VAs the request touches,
        // fire each VA's read tool concurrently here, then inject the
        // combined context + a per-turn dispatch nudge so the LLM's first
        // response synthesizes across VAs instead of discovering them one
        // by one.
        // vaDispatch was computed at the top of runAgentLoop (PART 39b) so it
        // could feed the VA-scoped tool filter. Reuse it here for the parallel
        // sweep — same decision, no double-classification.
        if (vaDispatch.fire && connectedIntegrations.length > 0) {
          // Map each VA → the read tool it owns + the section header for its
          // sweep result. Only VAs whose underlying integration is connected
          // actually fan out; the others are silently skipped so we don't
          // claim coverage we can't deliver.
          type VAFanout = {
            va: BoultVA;
            requires: (integrations: string[]) => boolean;
            tool: string;
            input: Record<string, any>;
            header: string;
            fallback: string;
          };
          const FANOUT: VAFanout[] = [
            {
              va: 'inbox',
              requires: (i) => i.includes('gmail'),
              tool: 'search_gmail',
              input: { query: 'is:unread newer_than:2d', maxResults: 10 },
              header: '## 📧 Inbox VA — Recent Unread (last 2 days)',
              fallback: '## 📧 Inbox VA\n(Could not fetch — Gmail may need reconnection)',
            },
            {
              va: 'calendar',
              requires: (i) => i.includes('gcal'),
              tool: 'get_calendar_events',
              input: { daysAhead: 3, maxResults: 15 },
              header: '## 📅 Calendar VA — Next 3 Days',
              fallback: '## 📅 Calendar VA\n(Could not fetch — Calendar may need reconnection)',
            },
            {
              va: 'crm',
              requires: (i) => i.includes('notion') || i.includes('notion_calendar'),
              tool: 'search_notion',
              input: { query: '', maxResults: 5 },
              header: '## 📝 CRM VA — Recent Notion Pages',
              fallback: '## 📝 CRM VA\n(Could not fetch)',
            },
            {
              va: 'comms',
              requires: (i) => i.includes('slack'),
              tool: 'slack_get_channels',
              input: { limit: 10 },
              header: '## 💬 Comms VA — Slack Channels',
              fallback: '## 💬 Comms VA\n(Could not fetch — Slack may need reconnection)',
            },
            {
              va: 'research',
              // Memory works without an external integration — always eligible.
              requires: () => true,
              tool: 'memory_search',
              // Use the user message as the relevance query so the Research
              // VA surfaces history specific to this turn, not a generic dump.
              input: { query: userMessage.slice(0, 200), limit: 5 },
              header: '## 🔍 Research VA — Relevant Memory',
              fallback: '## 🔍 Research VA\n(No relevant memory found)',
            },
          ];

          const active = FANOUT.filter(f => vaDispatch.vas.includes(f.va) && f.requires(connectedIntegrations));
          if (active.length >= 2) {
            const vaNames = active.map(a => a.va);
            emit('thinking', { status: `Dispatching ${active.length} VAs in parallel — ${vaNames.join(', ')}…` });
            log('info', 'Five-VA dispatch triggered', { reason: vaDispatch.reason, vas: vaNames });

            const sweepResults: string[] = [];
            const sweepPromises: Promise<void>[] = active.map(f =>
              executeTool(f.tool, f.input, userId)
                .then(r => { sweepResults.push(`${f.header}\n${r.output}`); })
                .catch(() => { sweepResults.push(f.fallback); })
            );

            await Promise.allSettled(sweepPromises);

            if (sweepResults.length > 0) {
              const contextBlock = sweepResults.join('\n\n---\n\n');
              // The user-message payload now has TWO parts:
              //   1. the sweep results (cross-VA context, pre-loaded)
              //   2. a tight dispatch nudge that survives the 1100-line system
              //      prompt by virtue of being the most recent context the
              //      model sees before deciding what to do.
              messages.push({
                role: 'user',
                content: [
                  `[FIVE-VA PARALLEL DISPATCH — ${active.length} VAs already ran for you]`,
                  `The following data was gathered IN PARALLEL from ${vaNames.join(', ')}.`,
                  'Synthesize across these VAs — do NOT re-call the same read tools unless you need detail beyond what is shown.',
                  '',
                  contextBlock,
                  '',
                  '---',
                  '[DISPATCH REFLEX — act on this turn]',
                  'You are a chief of staff routing five specialist VAs (Inbox / Calendar / CRM / Comms / Research).',
                  'If multiple VAs would do useful work in your next move, emit ALL their tool calls in THIS SINGLE response.',
                  'The loop executes parallel tool_use blocks concurrently. One tool per turn is leaving four VAs idle while the user waits.',
                ].join('\n'),
              } as any);
              log('info', 'Five-VA sweep + dispatch nudge injected', {
                vas: vaNames,
                sections: sweepResults.length,
                totalChars: contextBlock.length,
              });
              totalToolCalls += sweepPromises.length; // count pre-fetches toward the limit
            }
          }
        }

        // Task list: fire async — does NOT block the main loop from starting.
        // Both the task list LLM call and the first main-loop LLM call run in
        // parallel. The task_list SSE event arrives whenever the call resolves,
        // which is typically before or alongside the first tool_call event.
        if (!isPlanMode && availableTools.length > 0) {
          callLLM(
            [
              {
                role: 'system',
                content:
                  'You are a task planner. Decide if the user\'s request is a MULTI-STEP task that requires 2 or more distinct tool calls.\n' +
                  'Multi-step tasks involve real work: searching emails, reading threads, drafting messages, scheduling meetings, managing calendar, writing documents, logging to Notion. When in doubt about a real work request, treat it as multi-step and produce the list.\n' +
                  'Only truly trivial requests (casual replies, single factual questions, greetings) are simple.\n\n' +
                  'For MULTI-STEP tasks: output a JSON object with two fields:\n' +
                  '  "plan": a single sentence (max 220 chars) describing concretely what will be done — which tools, what will be found, what will be produced.\n' +
                  '  "tasks": array of 2-5 short action items (max 10 words each).\n' +
                  'For SIMPLE tasks: output exactly {}  (empty object).\n' +
                  'Output ONLY raw JSON. No markdown fences, no extra text.\n' +
                  'Example complex: {"plan":"I\'ll search your Gmail for the past 7 days, read each thread, and compile a full activity report in Canvas.","tasks":["Search Gmail last 7 days","Read top email threads","Compile key metrics","Open activity report in Canvas"]}\n' +
                  'Example simple: {}',
              },
              { role: 'user', content: userMessage },
            ],
            [],
            // Tiny JSON classification — lead with the small fast models, not
            // the 550B reasoner. It runs fire-and-forget but still burns quota
            // and cooldown budget for the models the MAIN call needs.
            { maxTokens: 250, fastFirst: true },
          ).then(tlRes => {
            const raw = getText(tlRes.content).trim();
            const objMatch = raw.match(/\{[\s\S]*\}/);
            let parsed: any = null;
            if (objMatch) {
              try { parsed = JSON.parse(objMatch[0]); } catch { parsed = null; }
            }
            // Weak models often return malformed JSON or claim "simple" for real
            // multi-step work. If JSON parse failed but the model clearly listed
            // steps, recover them from bullet/numbered lines so the task list
            // still shows.
            let tasks: string[] = Array.isArray(parsed?.tasks) ? parsed.tasks.map((t: any) => String(t).trim()).filter(Boolean) : [];
            if (tasks.length < 2) {
              const lineItems = raw
                .split('\n')
                .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
                .filter(l => l.length >= 4 && l.length <= 90 && !l.startsWith('{') && !l.includes('"tasks"'));
              if (lineItems.length >= 3) tasks = lineItems;
            }
            // Threshold lowered 3 -> 2: a genuine two-step task (search + draft)
            // deserves a visible checklist too.
            if (tasks.length >= 2) {
              const clean = tasks.slice(0, 6);
              taskCount = clean.length;
              emit('task_list', { tasks: clean });
            }
            if (parsed?.plan && typeof parsed.plan === 'string' && parsed.plan.trim().length > 10) {
              emit('plan_text', { content: parsed.plan.trim() });
            }
          }).catch(() => { /* task list is optional */ });
        }

        emit('thinking', { status: 'Thinking…' });

        // ── Main agentic loop ───────────────────────────────────────────────
        while (true) {
          // Inject budget counter + current state so the model always knows
          // its remaining allowance AND which phase of the run it is in.
          const budgetUsed = totalToolCalls;
          const budgetLeft = toolCallLimit - budgetUsed;
          // Cast widens TS's view past the let-initializer narrowing —
          // runState is mutated via transitionState() but TS can't follow
          // the closure mutation.
          const currentState: RunState = runState as RunState;
          const stateNote = (() => {
            switch (currentState) {
              case 'PLANNING':
                return '[STATE: PLANNING] — gather context with read-only tools (search_gmail, read_email, get_calendar_events, etc.). Do NOT call write tools (send_email, schedule_meeting, send_slack_message, create_notion_page) yet — call request_confirmation first.';
              case 'CONFIRMING':
                return '[STATE: CONFIRMING] — waiting for user approval. Do not call any more tools this turn.';
              case 'EXECUTING':
                return '[STATE: EXECUTING] — user has approved. Call the write tool that matches the approval now.';
              case 'REPORTING':
                return '[STATE: REPORTING] — all tool calls done. Write the final user-facing message and stop.';
            }
          })();
          // ── Working memory + repetition breaker ───────────────────────────
          // Replays what has already been looked up, and escalates when the
          // model keeps reaching for the same tool. Without this the transcript
          // technically contains every result, but nothing SAYS "you already
          // did this" — so the model rephrases and retries instead of deciding.
          const memoryNote = (() => {
            if (!gathered.length) return '';
            // Newest last: the tail is what it just did, which is what it is
            // most likely to repeat.
            const lines = gathered.slice(-12).map(g =>
              `- ${g.name}${g.hint ? ` "${g.hint}"` : ''} → ${g.outcome}`
            );
            return `\n[ALREADY GATHERED THIS RUN — do NOT look these up again:\n${lines.join('\n')}\n]`;
          })();

          const repeatNote = (() => {
            const worst = [...toolCallCounts.entries()]
              .filter(([n]) => READ_TOOLS_FOR_DEDUP.has(n))
              .sort((a, b) => b[1] - a[1])[0];
            if (!worst) return '';
            const [name, count] = worst;
            if (count >= 6) {
              return `\n[STOP SEARCHING. You have called ${name} ${count} times this run. More lookups will not produce new information — you already have what exists. Use it and write your answer NOW. If what the user asked for genuinely is not there, SAY SO plainly instead of searching again.]`;
            }
            if (count >= 3) {
              return `\n[You have called ${name} ${count} times. Before calling it again, re-read ALREADY GATHERED above and ask whether the answer is already in hand. Prefer acting on what you have over one more search.]`;
            }
            return '';
          })();

          const budgetMsg = budgetLeft <= 3
            ? `${stateNote}\n[TOOL BUDGET: ${budgetUsed}/${toolCallLimit} used — ${budgetLeft} calls remaining. RESERVE these for report delivery. Stop executing new tasks and write your final report NOW.]${memoryNote}${repeatNote}`
            : `${stateNote}\n[TOOL BUDGET: ${budgetUsed}/${toolCallLimit} used — ${budgetLeft} calls remaining.]${memoryNote}${repeatNote}`;
          if (messages.at(-1)?.role !== 'user') {
            messages.push({ role: 'user', content: budgetMsg } as any);
          } else {
            // Append to the last user message so we don't break the alternating pattern.
            const last = messages[messages.length - 1] as any;
            if (typeof last.content === 'string') {
              if (!last.content.includes('[STATE:')) {
                last.content = `${last.content}\n\n${budgetMsg}`;
              }
            } else if (Array.isArray(last.content)) {
              // THE MAIN LOOP PATH, and it used to fall through here doing
              // NOTHING. After tool calls we push {role:'user', content:[…
              // tool_result blocks]} — an ARRAY — so the string branch above
              // never matched and the budget/state steer was silently dropped
              // on every single iteration that followed a tool call. The model
              // therefore never saw its remaining budget, its run state, or
              // (now) what it had already gathered, which is exactly the
              // condition under which it keeps searching. A text block appended
              // after the tool_results is valid content and reaches the model.
              const hasState = last.content.some(
                (b: any) => b?.type === 'text' && typeof b.text === 'string' && b.text.includes('[STATE:')
              );
              if (!hasState) {
                last.content.push({ type: 'text', text: budgetMsg } as any);
              }
            }
          }

          const response = await callLLM(messages, narratedTools, { forceToolCall: forceNextToolCall, deadlineAt });
          forceNextToolCall = false;
          messages.push({ role: 'assistant', content: response.content });

          const toolCalls = getToolCalls(response.content);
          // Narrated Execution Protocol: pull the model-written per-call
          // narration off each input before anything downstream reads it.
          extractNarrations(toolCalls);
          const rawText = getRawText(response.content);
          const textContent = sanitizeModelText(rawText);

          // Extract chain-of-thought from <thinking> tags emitted by reasoning models.
          // sanitizeModelText strips these before getText returns, so we must read raw.
          const thinkMatch = rawText.match(/<thinking>([\s\S]*?)<\/thinking>/i);
          const thinkingText = thinkMatch ? thinkMatch[1].trim() : '';

          // ── Case 1: Tool calls ────────────────────────────────────────────
          if (toolCalls.length > 0) {
            // Surface the model's first-person thinking live: the "what I'll do"
            // opener on turn 0, and the between-step reflections after. Tool calls
            // are present, so it IS acting — show the reasoning the user asked to
            // see (no isIntentText gate here; that only matters when NO tool ran).
            const reflection = (textContent?.trim() || thinkingText?.trim() || '');
            if (reflection.length >= 12 && !isStepListingResponse(reflection, true)) {
              if (!ackEmitted && !isBackgroundAgent) {
                // First pre-tool text of the run = the opener ("On it — here's
                // how I'll handle this: …"). Rendered as a permanent chat
                // message above the executor box, so it goes out as its own
                // event, not as a boxed narrative. Cap is generous — the
                // doctrine asks for a full 2-5 sentence opener.
                ackEmitted = true;
                emit('ack', { text: reflection.slice(0, 1500) });
              } else {
                emit('narrative', { text: reflection.slice(0, 6000), iteration });
              }
            }
            // Fallback: some models go straight to tools with zero text. The
            // first call's model-written narration is still its own first-person
            // line ("scanning your inbox for unanswered threads") — use it so
            // the run never starts silent.
            if (!ackEmitted && !isBackgroundAgent) {
              const firstNarration = (toolCalls[0] as any)?.narration;
              if (typeof firstNarration === 'string' && firstNarration.trim().length >= 8) {
                ackEmitted = true;
                emit('ack', { text: firstNarration.trim() });
              }
            }

            const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

            // ── switch_to_plan_mode: hand the run to the plan pipeline ────
            // The model decided this request deserves a reviewed plan before
            // execution. Emit the switch and end the turn — the client
            // re-runs the same message with isPlanMode: true.
            const planSwitchCall = toolCalls.find(tc => tc.name === 'switch_to_plan_mode');
            if (planSwitchCall && !isPlanMode && !isBackgroundAgent) {
              emit('mode_switch', {
                mode: 'plan',
                reason: typeof planSwitchCall.input?.reason === 'string' ? planSwitchCall.input.reason : '',
                runId,
              });
              closeStream(totalToolCalls);
              return;
            }

            // ── ask_user: emit question event and stop the loop ───────────
            const askUserCall = toolCalls.find(tc => tc.name === 'ask_user');
            if (askUserCall) {
              const questions = askUserCall.input?.questions ?? [];
              if (questions.length > 0) {
                emit('question', { questions, runId });
                closeStream(totalToolCalls);
                return;
              }
            }

            const overDeadline = Date.now() >= deadlineAt;

            // ── Parallel tool execution ───────────────────────────────────────
            // All tools in a single model turn run concurrently — P50 latency
            // drops 50-70% when the model requests 2+ tools simultaneously.
            // ask_user is already handled above. We respect the tool-call cap
            // by eagerly incrementing totalToolCalls before dispatching.
            const executableTools = toolCalls.filter(tc => tc.name !== 'ask_user' && tc.name !== 'switch_to_plan_mode');
            const slotsLeft = toolCallLimit - totalToolCalls;

            // ── PART 9: Budget-aware task queue ──────────────────────────────
            // When the orchestration plan knows how many more calls remain AND
            // the budget is too tight to complete even one more plan step, stop
            // scheduling new tool calls and fall through to the final-response
            // path. This prevents the loop from starting a step it can't finish
            // (e.g. kicking off search_gmail with only 1 slot left when the
            // next step also needs read_email + draft_reply).
            // The threshold: if slotsLeft < the plan's minimum estimated remaining
            // calls (total_plan_calls − already_run), emit a partial_completion
            // event so the UI can show the user what was skipped and why.
            const planMinRemaining = (() => {
              if (!executionPlan) return 0;
              // Count plan tools already dispatched
              const dispatchedNames = new Set(toolHistory.map(t => t.name));
              const remaining = executionPlan.steps
                .filter(s => !s.tools.every(t => dispatchedNames.has(t)))
                .reduce((n, s) => n + (s.parallel ? 1 : s.tools.length), 0);
              return remaining;
            })();

            const budgetTooTight =
              executionPlan !== null &&
              planMinRemaining > 0 &&
              slotsLeft > 0 &&
              slotsLeft < planMinRemaining &&
              slotsLeft < 3; // only cut early when truly tight

            if (overDeadline || slotsLeft <= 0 || budgetTooTight) {
              // Work remains but time/tool budget is gone — flag it so the
              // client can auto-continue in a fresh invocation. Only for
              // interactive runs; background agents retry on their schedule.
              if (!isBackgroundAgent) ranOutOfBudget = true;
              const reason = overDeadline
                ? 'Time budget reached — finalising the report…'
                : budgetTooTight
                  ? `Budget tight (${slotsLeft} slots, ~${planMinRemaining} needed) — wrapping up…`
                  : 'Reached tool call limit. Summarising…';
              emit('thinking', { status: reason });

              // Emit partial completion if the plan had steps we couldn't reach
              if ((budgetTooTight || slotsLeft <= 0) && executionPlan && planMinRemaining > 0) {
                const dispatchedNames = new Set(toolHistory.map(t => t.name));
                const skippedSteps = executionPlan.steps
                  .filter(s => !s.tools.every(t => dispatchedNames.has(t)))
                  .map(s => s.label);
                if (skippedSteps.length > 0) {
                  emit('partial_completion', {
                    completed: toolHistory.filter(t => t.success).map(t => t.name),
                    skipped: skippedSteps,
                    reason: `Tool call budget (${toolCallLimit}) reached before all plan steps could run.`,
                  });
                }
              }
            } else {
              const batch = executableTools.slice(0, slotsLeft);
              totalToolCalls += batch.length;

              // ── PART 8 #1 — bulk progress streaming ──────────────────────────
              // When the LLM batches ≥3 calls of the same USER-MEANINGFUL WRITE
              // tool (drafts, sends, pages, meetings) in one assistant turn,
              // stream incremental progress the UI renders as a live block.
              // Parallel execution stays — progress is just a side-channel
              // counter that increments as each Promise resolves.
              //
              // CRITICAL: only WRITE tools qualify. Batched READS (search_gmail,
              // get_recipient_context, get_voice_profile) are internal plumbing —
              // streaming "Creating 5 searches now / Got 4 of 5 created" for them
              // dumps orchestration internals into the chat and reads like the
              // model leaking its own machinery. Reads show only in the step
              // trace, never as progress lines.
              const toolCounts = new Map<string, number>();
              for (const tc of batch) toolCounts.set(tc.name, (toolCounts.get(tc.name) || 0) + 1);
              const progressTrackers = new Map<string, { current: number; total: number; nextMilestone: number; label: string }>();
              for (const [name, total] of toolCounts) {
                if (total >= 3 && BULK_PROGRESS_TOOLS.has(name)) {
                  const label = humanizeBulkLabel(name);
                  emit('progress', { phase: 'start', current: 0, total, label, tool: name, iteration });
                  // Update at quarter-completion checkpoints — for 17 items that's
                  // 4 updates total (at items 4, 8, 12, 16). Avoids 17-update spam.
                  progressTrackers.set(name, {
                    current: 0,
                    total,
                    nextMilestone: Math.max(1, Math.floor(total / 4)),
                    label,
                  });
                }
              }

              // Each parallel execution returns a typed result so we can process
              // sequentially after without losing tc context on rejection.
              type ParallelOutcome =
                | { ok: true; tc: any; result: any; extraArchiveCount: number }
                | { ok: false; tc: any; error: string };

              const parallelOutcomes = await Promise.all(
                batch.map(async (tc): Promise<ParallelOutcome> => {
                  log('info', `tool_call`, { tool: tc.name, iteration, input: JSON.stringify(tc.input).slice(0, 200) });
                  emit('tool_call', { tool: tc.name, params: tc.input, iteration, narration: (tc as any).narration || undefined });
                  const toolStart = Date.now();
                  try {
                    // ── PART 9: Prerequisite gate ─────────────────────────────
                    // Check dependency graph before dispatching. If a write tool
                    // is called without its required read, surface an advisory
                    // failure that the LLM sees as a tool_result — it then calls
                    // the missing prereq before retrying the write. This is
                    // non-blocking (returns a soft-failure, not a thrown error)
                    // so it doesn't stall parallel siblings.
                    const completedToolNames = toolHistory
                      .filter(t => t.success)
                      .map(t => t.name);
                    // Also count tools already run in this batch (earlier in the
                    // parallelOutcomes array that haven't been committed to
                    // toolHistory yet). We use batch-local tracking for this:
                    // — currently only toolHistory is available here because
                    // parallelOutcomes resolves after all Promises; the code-level
                    // gate in tools.ts catches same-turn ordering violations.
                    const prereqViolation = checkPrerequisites(tc.name, completedToolNames);
                    if (prereqViolation) {
                      log('warn', 'orchestration_prereq_violation', { tool: tc.name, completedTools: completedToolNames });
                      // Return as a soft-failure so the LLM gets a clear nudge
                      // to run the missing prereq first. Not thrown — parallel
                      // siblings continue unaffected.
                      return { ok: false, tc, error: prereqViolation } satisfies ParallelOutcome;
                    }

                    // Newsletter layer 1: filter at query source
                    let inputToUse = tc.input;
                    if (
                      tc.name === 'search_gmail' &&
                      filterNewsletters &&
                      typeof inputToUse?.query === 'string' &&
                      !/category:|label:|in:(sent|drafts|spam|trash)/i.test(inputToUse.query)
                    ) {
                      inputToUse = {
                        ...inputToUse,
                        query: `${inputToUse.query} -category:promotions -category:social -category:forums`.trim(),
                      };
                    }

                    // PART 31 — Dedup: if this is a read-only tool and we've
                    // already called it with the same input this run, return
                    // the cached result. Saves the API call + tells the LLM
                    // it already has this data so it stops looping.
                    toolCallCounts.set(tc.name, (toolCallCounts.get(tc.name) || 0) + 1);

                    let result;
                    if (READ_TOOLS_FOR_DEDUP.has(tc.name)) {
                      const cacheKey = makeCacheKey(tc.name, inputToUse);
                      const cached = toolResultCache.get(cacheKey);
                      if (cached) {
                        log('info', 'dedup_cache_hit', { tool: tc.name, key: cacheKey.slice(0, 80) });
                        result = {
                          ...cached,
                          output:
                            `[Cached — you already called ${tc.name} with these params earlier this turn.]\n` +
                            `Stop re-fetching. Use this data and move on.\n\n` +
                            cached.output,
                        };
                      } else {
                        result = await executeTool(tc.name, inputToUse, userId, buildToolContext());
                        if (result.success !== false) {
                          toolResultCache.set(cacheKey, {
                            output: result.output,
                            success: result.success,
                            canvasData: result.canvasData,
                          });
                        }
                      }
                    } else {
                      result = await executeTool(tc.name, inputToUse, userId, buildToolContext());
                    }

                    // Log every READ into working memory. Writes are excluded on
                    // purpose — "you already sent this" belongs to the approval
                    // path, not to a hint that could talk the model out of a
                    // legitimate second send.
                    if (READ_TOOLS_FOR_DEDUP.has(tc.name)) {
                      recordGathered(tc.name, inputToUse, result.output, result.success !== false);
                    }

                    // Newsletter layer 2: classify what slipped through
                    let extraArchiveCount = 0;
                    if (tc.name === 'search_gmail' && filterNewsletters) {
                      const { annotated, archiveCount } = processGmailResults(result.output);
                      extraArchiveCount = archiveCount;
                      result = { ...result, output: annotated };
                    }

                    logAudit({ userId, runId, toolName: tc.name, inputSummary: JSON.stringify(tc.input).slice(0, 500), outputSummary: result.output.slice(0, 500), durationMs: Date.now() - toolStart, success: true, iteration });
                    // Bulk progress increment — emit at quarter milestones plus
                    // a final 'complete' when the last item lands. Soft-failures
                    // (success:false) still count toward progress since they
                    // represent a completed attempt, not a hung Promise.
                    const tracker = progressTrackers.get(tc.name);
                    if (tracker) {
                      tracker.current++;
                      if (tracker.current === tracker.total) {
                        emit('progress', { phase: 'complete', current: tracker.total, total: tracker.total, label: tracker.label, tool: tc.name, iteration });
                      } else if (tracker.current >= tracker.nextMilestone) {
                        emit('progress', { phase: 'update', current: tracker.current, total: tracker.total, label: tracker.label, tool: tc.name, iteration });
                        tracker.nextMilestone = Math.min(tracker.total - 1, tracker.current + Math.max(1, Math.floor(tracker.total / 4)));
                      }
                    }
                    return { ok: true, tc, result, extraArchiveCount };
                  } catch (err: any) {
                    const errorMsg = err?.message ?? 'Unknown error';
                    logAudit({ userId, runId, toolName: tc.name, inputSummary: JSON.stringify(tc.input).slice(0, 500), durationMs: Date.now() - toolStart, success: false, errorMessage: errorMsg, iteration });
                    // Thrown failures still count toward bulk completion so the
                    // progress bar doesn't stall on errors.
                    const tracker = progressTrackers.get(tc.name);
                    if (tracker) {
                      tracker.current++;
                      if (tracker.current === tracker.total) {
                        emit('progress', { phase: 'complete', current: tracker.total, total: tracker.total, label: tracker.label, tool: tc.name, iteration });
                      }
                    }
                    return { ok: false, tc, error: humanizeError(tc.name, errorMsg) };
                  }
                })
              );

              // Process results in order — preserves deterministic message history
              let mustStop = false;
              for (const outcome of parallelOutcomes) {
                if (!outcome.ok) {
                  const { tc, error: friendly } = outcome;
                  log('error', `tool_result fail`, { tool: tc.name, error: friendly });
                  emit('tool_result', { tool: tc.name, success: false, summary: friendly, iteration });
                  outcomes.push({ tool: tc.name, ok: false, error: friendly });
                  toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: friendly });

                  continue;
                }

                const { tc, result, extraArchiveCount } = outcome;

                // ── Soft-failure gate ──────────────────────────────────────
                // Tool ran without throwing but explicitly flagged success:false
                // (e.g. integration not connected, upstream 4xx, validation
                // error). Without this, the LLM treats the failure-message
                // string as a normal result and confabulates next steps.
                // Forcing the failure into the tool_result content with a hard
                // acknowledgement instruction breaks that loop.
                if (result.success === false) {
                  const code = result.errorCode || 'tool_failed';
                  // F8 — Internal-only validation errors get a sanitized
                  // instruction so the LLM never echoes the internal field
                  // name into chat.
                  const isInternalOnly = (result as any)._internal_only === true;
                  const failureMsg = isInternalOnly
                    ? `Tool ${tc.name} returned an internal validation error. ` +
                      `Ask the user ONE short clarifying question in plain English to get the missing detail. ` +
                      `NEVER mention error codes, field names, or internal validation in your reply. ` +
                      `Just ask the question and stop.`
                    : `Tool ${tc.name} returned soft-fail (code "${code}"): ${result.output}\n\n` +
                      `PIVOT-ON-FAILURE PROTOCOL:\n` +
                      `1. Pick the BEST alternative tool from the "Pivot ladder" in your system prompt for ${tc.name}.\n` +
                      `2. Call that alternative tool RIGHT NOW in this same turn. Do NOT write text first.\n` +
                      `3. If the alternative succeeds, complete the task with the new data and report the result.\n` +
                      `4. ONLY if the alternative also fails do you write to the user — and then it is "I hit a snag with X — want me to <one concrete next move>?" NEVER "I can't" / "I'm unable to" / "I don't have access to".\n` +
                      `5. NEVER apologize, never refuse, never stop. Try the pivot first.\n\n` +
                      `Banned reply patterns: "I couldn't ...", "I'm unable to ...", "Unfortunately ...", "That's not possible ...", "I don't have permission to ...". Use "I hit a snag" + pivot instead.`;
                  log('warn', `tool_result soft_fail`, { tool: tc.name, code, output: result.output.slice(0, 200) });
                  emit('tool_result', { tool: tc.name, success: false, summary: result.output.slice(0, 300), iteration });
                  outcomes.push({ tool: tc.name, ok: false, error: result.output });
                  toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: failureMsg });

                  // Scope-missing / not-connected recovery: emit a
                  // connector_required card so the user can reconnect inline.
                  // PART 24 broadens this from gmail-only to every connector
                  // so calendar / notion / slack failures also show the card
                  // instead of the LLM writing a confused paragraph.
                  // Also: inject a hard "STOP" instruction into the failure
                  // result the LLM sees so it doesn't narrate the problem
                  // — the card already tells the user everything.
                  const CONNECTOR_FAILURE_MAP: Record<string, { id: string; name: string; description: string }> = {
                    gmail_scope_missing:    { id: 'gmail',  name: 'Gmail',            description: 'Reconnect Gmail — the current token is missing some scopes.' },
                    gmail_not_connected:    { id: 'gmail',  name: 'Gmail',            description: 'Connect Gmail so I can read and draft email.' },
                    gcal_scope_missing:     { id: 'gcal',   name: 'Google Calendar',  description: 'Reconnect Google Calendar — the current token has Gmail scopes but not Calendar scopes.' },
                    gcal_not_connected:     { id: 'gcal',   name: 'Google Calendar',  description: 'Connect Google Calendar so I can read your schedule and book meetings.' },
                    notion_not_connected:   { id: 'notion', name: 'Notion',           description: 'Connect Notion so I can read and write pages.' },
                    notion_scope_missing:   { id: 'notion', name: 'Notion',           description: 'Reconnect Notion — the workspace authorization needs to be refreshed.' },
                    slack_not_connected:    { id: 'slack',  name: 'Slack',            description: 'Connect Slack so I can post messages and read channels.' },
                  };
                  const connectorMeta = CONNECTOR_FAILURE_MAP[code];
                  if (connectorMeta) {
                    if (code === 'gmail_scope_missing') {
                      invalidateGmailScope(userId).catch(() => { /* non-fatal */ });
                    }
                    // PART 68: mark stale Google integration rows as
                    // needs_reauth so the prompt-box icon and integrations
                    // modal stop showing "Connected" when the token is broken.
                    if (code === 'gmail_scope_missing' || code === 'gcal_scope_missing') {
                      const provider = code === 'gmail_scope_missing' ? 'gmail' : 'gcal';
                      import('./tools/http-tokens')
                        .then(m => m.markIntegrationNeedsReauth(userId, provider))
                        .catch(() => { /* non-fatal */ });
                    }
                    // Has any other tool already succeeded this run? If so, the
                    // user's core request is (at least partly) handled, and a
                    // missing connector for a SPECULATIVE extra tool must not
                    // halt everything. Only block-and-wait when nothing else
                    // worked — i.e. the connector really is essential.
                    const somethingElseSucceeded = outcomes.some(o => o.ok);
                    emit('connector_required', {
                      connectors: [{
                        ...connectorMeta,
                        connected: false,
                      }],
                      // Only make the UI halt-and-wait when the run produced
                      // nothing else. Otherwise show the card as a soft hint
                      // and let the loop finish the work it CAN do.
                      waitingForUser: !somethingElseSucceeded,
                      reason: code,
                    });
                    // F1.4 — Replace the LLM-facing failure by tool_use_id.
                    const newContent = somethingElseSucceeded
                      ? `Tool ${tc.name} failed: ${connectorMeta.name} isn't connected, but you DON'T need it for the rest of this task. ` +
                        `A small reconnect card is already shown. CONTINUE with the other tools and finish the user's request using what you CAN access. ` +
                        `At the very end, add ONE short line noting ${connectorMeta.name} was unavailable. Do NOT stop. Do NOT make the whole reply about the missing connection.`
                      : `Tool ${tc.name} failed: ${connectorMeta.name} is not connected (or scope is missing). ` +
                        `A connector card has ALREADY been shown to the user. ` +
                        `Reply with ONE short sentence acknowledging the missing connection — example: ` +
                        `"I need ${connectorMeta.name} access to do that — reconnect it from the card and I'll continue." ` +
                        `Do NOT write a long paragraph. Do NOT call any more tools.`;
                    const matchIdx = toolResults.findIndex(r => r.tool_use_id === tc.id);
                    if (matchIdx >= 0) {
                      toolResults[matchIdx] = { type: 'tool_result', tool_use_id: tc.id, content: newContent };
                    } else {
                      // Defensive — push if not found (shouldn't happen but
                      // beats silently dropping the failure context).
                      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: newContent });
                    }
                  }
                  continue;
                }

                archivedCount += extraArchiveCount;

                if (result.canvasData) {
                  if (
                    result.canvasData.type !== 'scheduled_agent' &&
                    result.canvasData.type !== 'integration_required' &&
                    result.canvasData.type !== 'confirmation_required'
                  ) {
                    canvasContent = result.canvasData;
                  }
                  emit('canvas', result.canvasData);
                }

                // Batch tools (gmail_batch_draft_replies) return N canvases in
                // one call — emit each so the client accumulates them into the
                // draft gallery. One card per draft, one fast tool call.
                if (Array.isArray(result.canvasList) && result.canvasList.length) {
                  for (const cv of result.canvasList) emit('canvas', cv);
                }

                if (result.requiresConfirmation) {
                  transitionState('CONFIRMING', `request_confirmation:${tc.name}`);
                  toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result.output });
                  mustStop = true;
                  continue; // collect remaining results into toolResults before stopping
                }

                log('info', `tool_result ok`, { tool: tc.name, outputLen: result.output.length, hasCanvas: !!result.canvasData });
                emit('tool_result', { tool: tc.name, success: true, summary: result.output.slice(0, 300), iteration });
                outcomes.push({ tool: tc.name, ok: true });
                toolHistory.push({ name: tc.name, input: tc.input, success: true });
                toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result.output });

                // State transition: a write tool just succeeded. Move from
                // EXECUTING (or PLANNING, if the LLM somehow bypassed the
                // gate — shouldn't happen since the executor refuses, but
                // belt-and-braces) into EXECUTING so subsequent writes in
                // the same turn don't get mislabelled.
                if (
                  tc.name === 'send_email' ||
                  tc.name === 'schedule_meeting' ||
                  tc.name === 'send_slack_message' ||
                  tc.name === 'create_notion_page'
                ) {
                  transitionState('EXECUTING', `write_completed:${tc.name}`);
                }

                // ── Deep Integration Auto-Bridge ──────────────────────────
                if (tc.name === 'schedule_meeting' && connectedIntegrations.includes('notion')) {
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: `bridge_${tc.id}`,
                    content: '[AUTO-BRIDGE] Meeting created. Notion is connected — automatically log this meeting to Notion now using create_notion_page (database hint: "meetings"). Include: attendees, time, agenda, Meet link. Report "Logged to Notion ✓" after.',
                  } as any);
                }
                // get_sent_emails auto-bridge removed: voice profile is now
                // injected once at the top of the system prompt, so calling
                // get_sent_emails is no longer a "drafting precursor" — it's
                // an analysis call the user explicitly asked for. Forcing
                // draft_reply afterward turned every voice-profile audit into
                // an unsolicited email draft.
                if (tc.name === 'draft_reply' && connectedIntegrations.includes('notion')) {
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: `bridge_${tc.id}`,
                    content: '[AUTO-BRIDGE] Email draft saved. Notion is connected — after the user sends this email, automatically log the conversation to Notion (database hint: "contacts" or "meetings"). Include: contact name, date, key discussion points.',
                  } as any);
                }
                if ((tc.name === 'search_gmail' || tc.name === 'read_email') && connectedIntegrations.includes('gcal') && result.output.match(/\b(meeting|schedule|book|calendar|invite|call|sync)\b/i)) {
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: `bridge_${tc.id}`,
                    content: '[AUTO-BRIDGE] Email mentions scheduling. Google Calendar is connected — check calendar availability with get_calendar_events before suggesting times or confirming meetings.',
                  } as any);
                }
                if (tc.name === 'get_calendar_events' && connectedIntegrations.includes('notion')) {
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: `bridge_cal_${tc.id}`,
                    content: '[AUTO-BRIDGE: CALENDAR MERGE] Google Calendar fetched. Notion is connected — you MUST also call search_notion with query "calendar schedule meetings" to get Notion calendar blocks. Merge both sources into one chronological timeline before making any scheduling decision or reporting availability. Never book based on GCal data alone.',
                  } as any);
                }
              }

              if (mustStop) {
                messages.push({ role: 'user', content: toolResults as any });
                closeStream(totalToolCalls);
                return;
              }
            }

            if (toolResults.length) {
              messages.push({ role: 'user', content: toolResults as any });
            }

            iteration++;

            if (totalToolCalls >= toolCallLimit || Date.now() >= deadlineAt) {
              emit('thinking', { status: 'Preparing final response…' });
              const canvasSchema = TOOL_SCHEMAS.find(s => s.name === 'open_canvas');
              const finalTools = canvasSchema ? [canvasSchema] : [];
              const finalResponse = await callLLM(
                [
                  ...messages,
                  {
                    role: 'user',
                    content:
                      'All data has been gathered. Now write your final response in your own voice, first person "I". ' +
                      'Make it THOROUGH and high-quality: walk me through what you found, EACH judgment call and why you made it, the specifics (names, dates, amounts, what each email said), what you drafted and the thinking behind it, and what needs my attention next. When you did a lot, say a lot — several substantive paragraphs, not a one-liner. ' +
                      'Do NOT list the steps you took or the tools you ran. Do NOT say "Done — completed Searched inbox for..." or list tool names. The only thing to cut is empty filler ("successfully", "I hope this helps") — never cut reasoning or detail. ' +
                      'If this is a report, summary, or document, call open_canvas with the full content NOW before writing your chat response. ' +
                      'Do NOT say "the report is in the Canvas panel" unless you actually call open_canvas in this response.',
                  },
                ],
                finalTools,
                { deadlineAt: reportDeadlineAt },
              );
              // Handle canvas call in the final forced response
              const finalToolCalls = getToolCalls(finalResponse.content);
              const canvasCall = finalToolCalls.find(tc => tc.name === 'open_canvas');
              if (canvasCall) {
                try {
                  const canvasResult = await executeTool('open_canvas', canvasCall.input, userId, buildToolContext());
                  if (canvasResult.canvasData) {
                    canvasContent = canvasResult.canvasData;
                    emit('canvas', canvasResult.canvasData);
                  }
                } catch { /* non-fatal */ }
              }
              let forcedText = sanitizeModelText(getText(finalResponse.content));
              // Allow up to 2 forced retries when the model keeps listing steps instead of answering
              while (isStepListingResponse(forcedText, true) && stepListingRetryCount < 2) {
                stepListingRetryCount++;
                const toolDataSnippet = extractLastToolResults(messages);
                const retryRes = await callLLM(
                  [
                    ...messages,
                    {
                      role: 'user',
                      content: stepListingRetryCount === 1
                        ? 'STOP. You listed what steps you ran, not what you FOUND. Read the tool results above and answer the user\'s question now. What specific information did the emails contain? Write the actual analysis, not a summary of your actions.'
                        : `FINAL ATTEMPT. You must answer using this data:\n\n${toolDataSnippet}\n\nAnswer the user\'s original question using these results. Call open_canvas if this is a report/analysis. Do NOT say "Done" or list steps.`,
                    },
                  ],
                  finalTools,
                  { deadlineAt: reportDeadlineAt },
                );
                const retryText = sanitizeModelText(getText(retryRes.content));
                if (retryText) forcedText = retryText;
              }
              finalText = forcedText;
              break;
            }

            if (taskCount > 0) {
              emit('task_progress', { completedCount: Math.min(iteration, taskCount - 1) });
            }

            emit('thinking', { status: 'Processing results…' });
            continue;
          }

          // ── Case 2a: Plan/intent text as the answer — nudge to EXECUTE ─────
          // Fires whether or not tools already ran. The failure mode: the model
          // does a couple of searches, then writes a forward-looking PLAN ("Here's
          // the plan: I'll pull… What I'll do: fetch the bodies…") and stops,
          // instead of actually doing the rest and reporting what it did. A plan
          // is never a valid final answer — push it to finish the work.
          if (nudgeCount < MAX_NUDGES && isIntentText(textContent)) {
            nudgeCount++;
            forceNextToolCall = true;
            emit('thinking', { status: 'Working on it…' });
            const nudgeMessages = [
              'You wrote a PLAN of what you will do — that is not the answer. Do NOT describe future steps. Call the actual tools RIGHT NOW to finish the work you just described (fetch the bodies, run the analysis, draft, etc.), then report what you actually found.',
              'STOP describing. Execute the plan you wrote: call the tools immediately (gmail_bulk_read_threads, read_email, draft_reply, etc.) to complete every step, then write your final report in PAST tense — what you found, not what you will do.',
              `FINAL WARNING: you keep narrating a plan instead of doing it. You MUST call at least one tool now to finish the task. Available tools: ${availableTools.map(t => t.name).join(', ')}. After the tools run, report what you DID — never "I'll" or "here's the plan".`,
            ];
            messages.push({
              role: 'user',
              content: nudgeMessages[nudgeCount - 1] || nudgeMessages[nudgeMessages.length - 1],
            });
            continue;
          }

          // ── Case 2b: Unfilled placeholders — nudge ────────────────────────
          if (nudgeCount < MAX_NUDGES && hasPlaceholders(textContent)) {
            nudgeCount++;
            forceNextToolCall = true;
            emit('thinking', { status: 'Completing task…' });
            messages.push({
              role: 'user',
              content:
                'Your response contains a bracketed directive instead of a real action — e.g. "[open canvas with the report]", "[draft the reply here]", or "[link here]". ' +
                'Brackets describing an action are never acceptable. Actually call the tool now: ' +
                'if it says open/show canvas, call open_canvas with the full markdown content; ' +
                'if it says draft a reply, call draft_reply with the real body; ' +
                'if it says schedule, call schedule_meeting. ' +
                'Produce the actual result via the tool — do not write the action in brackets.',
            });
            continue;
          }

          // ── Case 2c: Empty response after tool calls — demand a real summary ──
          // The LLM produced only <thinking> with no visible text. Force one retry.
          if (!textContent && totalToolCalls > 0 && nudgeCount < MAX_NUDGES) {
            nudgeCount++;
            emit('thinking', { status: 'Writing summary…' });
            messages.push({
              role: 'user',
              content:
                'You produced no visible text in your response. Write your final reply now. ' +
                'Answer the user\'s question directly using the content from the tool results — what did the emails/data say? ' +
                'Do NOT list the steps you took or the tools you ran. Do NOT say "Done — completed Searched inbox...". ' +
                'Write the actual answer: (1) the key information found, (2) specific details from the content, (3) what the user should do next if relevant. ' +
                'Do NOT use <thinking> tags — write the reply directly.',
            });
            continue;
          }

          // ── Case 2d: Real final answer ────────────────────────────────────
          // If the model reasoned via <thinking> tags, surface that in the card.
          if (thinkingText && thinkingText.length >= 20) {
            emit('narrative', { text: thinkingText, iteration });
          }

          // ── Last resort: if text is still intent and no tools called, force one final attempt ──
          // This catches the case where all nudges were exhausted but the LLM still narrates.
          if (totalToolCalls === 0 && availableTools.length > 0 && isIntentText(textContent)) {
            log('warn', 'All nudges exhausted — attempting forced tool execution as last resort');
            emit('thinking', { status: 'Executing now…' });
            messages.push({
              role: 'user',
              content:
                'You have described what you will do but have not called any tools. ' +
                'The user is waiting for actual results, not descriptions. ' +
                'Call the first tool needed to start the task NOW. ' +
                `Available tools: ${availableTools.map(t => t.name).join(', ')}. ` +
                'You MUST respond with a tool_call, not text.',
            });
            const lastResort = await callLLM(messages, narratedTools, { forceToolCall: true, deadlineAt: reportDeadlineAt });
            messages.push({ role: 'assistant', content: lastResort.content });
            const lastToolCalls = getToolCalls(lastResort.content);
            extractNarrations(lastToolCalls);

            if (lastToolCalls.length > 0) {
              // Success! Process the tool calls and continue the loop
              const narrativeText = sanitizeModelText(getRawText(lastResort.content));
              if (narrativeText && narrativeText.length >= 20 && narrativeText.length <= 6000 && !isIntentText(narrativeText)) {
                emit('narrative', { text: narrativeText, iteration });
              }

              const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
              for (const tc of lastToolCalls) {
                if (totalToolCalls >= toolCallLimit) break;
                totalToolCalls++;
                log('info', `tool_call #${totalToolCalls} (last-resort)`, { tool: tc.name, iteration });
                emit('tool_call', { tool: tc.name, params: tc.input, iteration, narration: (tc as any).narration || undefined });
                try {
                  let result = await executeTool(tc.name, tc.input, userId, buildToolContext());
                  if (result.success === false) {
                    const code = result.errorCode || 'tool_failed';
                    const failureMsg =
                      `Tool ${tc.name} failed with code "${code}". Reason: ${result.output}\n\n` +
                      `You MUST handle this failure explicitly. Do not pretend it succeeded.`;
                    emit('tool_result', { tool: tc.name, success: false, summary: result.output.slice(0, 300), iteration });
                    outcomes.push({ tool: tc.name, ok: false, error: result.output });
                    toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: failureMsg });
                    continue;
                  }
                  if (result.canvasData) {
                    if (result.canvasData.type !== 'scheduled_agent' && result.canvasData.type !== 'integration_required') {
                      canvasContent = result.canvasData;
                    }
                    emit('canvas', result.canvasData);
                  }
                  emit('tool_result', { tool: tc.name, success: true, summary: result.output.slice(0, 300), iteration });
                  outcomes.push({ tool: tc.name, ok: true });
                  toolHistory.push({ name: tc.name, input: tc.input, success: true });
                  toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result.output });
                } catch (err: any) {
                  const friendly = humanizeError(tc.name, err?.message ?? 'Unknown error');
                  emit('tool_result', { tool: tc.name, success: false, summary: friendly, iteration });
                  outcomes.push({ tool: tc.name, ok: false, error: friendly });
                  toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: friendly });
                }
              }
              if (toolResults.length) {
                messages.push({ role: 'user', content: toolResults as any });
              }
              iteration++;

              // Now get the final summary from the LLM
              emit('thinking', { status: 'Preparing final response…' });
              const canvasSchema = availableTools.find(t => t.name === 'open_canvas');
              const finalTools = canvasSchema ? [canvasSchema] : [];
              const summaryRes = await callLLM(
                [
                  ...messages,
                  {
                    role: 'user',
                    content:
                      'Write your final response now. Answer the user\'s question using the specific content from the tool results — what did you find? What did the emails say? ' +
                      'Do NOT list steps or tool names ("Done — completed Searched..."). Give the actual information. ' +
                      'If you need to create a document or report, call open_canvas. Be specific about results.',
                  },
                ],
                finalTools,
                // Bounded by the report deadline — an unbounded summary call on a
                // stalling-provider day was another way past the function limit.
                { deadlineAt: reportDeadlineAt },
              );
              const summaryToolCalls = getToolCalls(summaryRes.content);
              const summaryCanvasCall = summaryToolCalls.find(tc => tc.name === 'open_canvas');
              if (summaryCanvasCall) {
                try {
                  const canvasResult = await executeTool('open_canvas', summaryCanvasCall.input, userId, buildToolContext());
                  if (canvasResult.canvasData) {
                    canvasContent = canvasResult.canvasData;
                    emit('canvas', canvasResult.canvasData);
                  }
                } catch { /* non-fatal */ }
              }
              finalText = sanitizeModelText(getText(summaryRes.content));
              break;
            }
          }

          // ── Case 2e: Step-listing response — demand actual answer ─────────
          // LLM listed what tools it ran ("Done — completed Searched inbox for...")
          // instead of answering the user's question with the content it found.
          // Uses its own flag so intent-text nudges don't exhaust this retry.
          if (isStepListingResponse(textContent, totalToolCalls > 0) && stepListingRetryCount < 2) {
            stepListingRetryCount++;
            emit('thinking', { status: 'Preparing answer…' });
            const toolDataSnippet = extractLastToolResults(messages);
            messages.push({
              role: 'user',
              content: stepListingRetryCount === 1
                ? 'STOP. You listed what steps you ran, not what you FOUND. That is not acceptable. ' +
                  'The tool results are already in this conversation — read them and answer the user\'s question now. ' +
                  'What do the emails say? What specific information did you find? ' +
                  'Write a substantive answer using the actual content from the tool results. ' +
                  'If this is a report or analysis, call open_canvas NOW with the full content. ' +
                  'Do NOT mention steps, tool names, searches, or what you did.'
                : `FINAL ATTEMPT. Here is the actual data from your tool results:\n\n${toolDataSnippet}\n\n` +
                  'Use this data to answer the user\'s original question RIGHT NOW. ' +
                  'If the task requires a report, summary, or analysis, call open_canvas with the full content. ' +
                  'Do NOT say "Done", do NOT list steps. Write the actual answer.',
            });
            continue;
          }

          // ── Response quality validator ────────────────────────────────────
          // Reject trivially short or hollow responses when tools ran — forces
          // the model to actually use the data it fetched. Max 2 auto-retries.
          const minQualityLen = totalToolCalls >= 4 ? 200 : totalToolCalls >= 2 ? 100 : 40;
          const isTrivialResponse =
            totalToolCalls > 0 &&
            textContent.trim().length < minQualityLen &&
            !isStepListingResponse(textContent, true) &&
            nudgeCount < MAX_NUDGES;

          if (isTrivialResponse) {
            nudgeCount++;
            emit('thinking', { status: 'Generating detailed response…' });
            messages.push({
              role: 'user',
              content:
                'That response is too thin for the work you just did. Write the FULL answer now, first person: ' +
                'the key findings with specifics (names, dates, amounts, what each email/result said), every judgment call you made and why, what you produced, and what needs my attention. ' +
                'Several substantive paragraphs when there is real substance — do not compress it into one or two lines.',
            });
            continue;
          }

          // ── Bug A: background "keep working" nudge ────────────────────────
          // A background agent that's about to finish having made very few tool
          // calls almost certainly stopped short — weak models do one search
          // then write a report. If we still have time + budget, push it to
          // actually do the work its task implies (read threads, draft, log)
          // before accepting the finish. Only fires for background agents, only
          // when real budget/time remain, and is capped so it can't loop.
          const nearlyEmptyRun = totalToolCalls <= 2;
          const hasHeadroom =
            totalToolCalls < toolCallLimit - 3 &&
            Date.now() < deadlineAt - 8000;
          if (
            isBackgroundAgent &&
            nearlyEmptyRun &&
            hasHeadroom &&
            keepWorkingNudges < MAX_KEEP_WORKING_NUDGES
          ) {
            keepWorkingNudges++;
            emit('thinking', { status: 'Going deeper on the task…' });
            messages.push({
              role: 'user',
              content:
                `You have only made ${totalToolCalls} tool ${totalToolCalls === 1 ? 'call' : 'calls'} — that is not enough to actually complete this task. ` +
                'A single search is the START of the work, not the end. Do the real job now: ' +
                'read the relevant threads, draft the replies, check the calendar, log to Notion, apply labels — whatever this task requires. ' +
                'Use as many tools as you need (you have budget remaining). ' +
                'Do NOT write a final report yet. Call the next tool now.',
            });
            forceNextToolCall = true;
            continue;
          }

          // Final safety net: if retries exhausted and the text is STILL
          // step-listing or tool-salad, drop it. A clean empty close beats
          // showing the user "Done — completed Running create scheduled agent".
          if (isStepListingResponse(textContent, totalToolCalls > 0)) {
            log('warn', 'step_listing_text_dropped_after_retries', { preview: textContent.slice(0, 120) });
            finalText = '';
          } else {
            finalText = textContent;
          }
          break;
        }

        if (!finalText) {
          if (isPlanMode) {
            finalText = 'I was unable to generate a plan. Please try again with a more specific request.';
          } else {
            // When the LLM produced no usable text but tools ran successfully,
            // we used to emit "Done — I handled X, Y and Z for you" — a tool-
            // name salad that looked like hallucination to users. Now: if the
            // tools rendered their own canvas/card (which is the usual case
            // for write tools), emit an EMPTY message so the chat stream
            // shows just the card with no filler text above it. The card is
            // self-explanatory.
            const failedCount = outcomes.filter(o => !o.ok).length;
            const succeededCount = outcomes.filter(o => o.ok).length;
            if (canvasContent || succeededCount > 0) {
              // Card already rendered — no chat text needed.
              finalText = '';
            } else if (failedCount > 0 && succeededCount === 0) {
              finalText = 'I hit an error and couldn\'t complete that. Tell me a bit more about what you need and I\'ll try again.';
            } else {
              finalText = '';
            }
          }
        }

        // ── Layer 3 end: emit partial failure as structured SSE event ──────
        const failed = outcomes.filter(o => !o.ok);
        const succeeded = outcomes.filter(o => o.ok);
        // Only surface a failure prompt when the failure ACTUALLY blocked the
        // user's request. If we produced a real answer (finalText) OR any tool
        // succeeded, an incidental failure — e.g. the model speculatively
        // tried get_calendar_events on an inbox-only request and it lacked
        // calendar scope — must NOT halt the turn or dominate the response
        // with "How would you like to handle the failure?". The user asked
        // about their inbox; we answered; the calendar miss is noise.
        const producedRealAnswer = !!(finalText && finalText.trim().length > 0);
        const onlyFailures = succeeded.length === 0 && failed.length > 0;
        if (onlyFailures && !producedRealAnswer && totalToolCalls > 0) {
          const question = failed.length === 1
            ? `How would you like to handle the ${failed[0].tool} failure?`
            : 'How would you like to handle these failures?';
          emit('partial_failure', {
            done: succeeded.map(o => o.tool),
            failed: failed.map(o => ({ tool: o.tool, error: o.error ?? 'unknown error' })),
            question,
          });
        }

        if (taskCount > 0) {
          emit('task_progress', { completedCount: taskCount });
        }

        // Final state transition before delivering the user-facing message.
        transitionState('REPORTING', 'final_message');

        // F7 — defensive sanitizer pass before emit. Catches raw JSON,
        // `[Cached —]` envelopes, tool-error codes the LLM may have pasted.
        // sanitizeModelText is idempotent so it's safe even after earlier strips.
        finalText = sanitizeModelText(finalText);

        // ── FINAL HALLUCINATION GUARD ────────────────────────────────────
        // The most damaging hallucination is the LLM claiming it did an
        // action ("I've sent the email", "I scheduled the meeting") when
        // no successful tool call backs the claim. We scan finalText for
        // past-tense action verbs and require a matching success. If the
        // claim is unbacked, we replace it with a neutral phrasing so the
        // user is never told "done" for work that didn't happen.
        if (!isPlanMode && finalText.trim()) {
          const succeededTools = new Set(
            outcomes.filter(o => o.ok).map(o => o.tool),
          );
          const succeeded = (names: string[]) => names.some(n => succeededTools.has(n));

          const CLAIM_RULES: Array<{
            re: RegExp;
            requires: string[];
            replacement: string;
            label: string;
          }> = [
            {
              re: /\bI(?:'ve| have)?\s+sent\b[^.\n]*\./gi,
              requires: ['send_email', 'gmail_batch_send_emails', 'send_slack_message', 'slack_send_dm', 'report_send_gmail', 'report_send_slack'],
              replacement: 'I prepared the message but did not actually send it — let me know if you want me to send.',
              label: 'sent',
            },
            {
              re: /\bI(?:'ve| have)?\s+(?:drafted|written|composed)\b[^.\n]*\./gi,
              requires: ['draft_reply', 'draft_cold_email', 'gmail_batch_draft_replies', 'gmail_generate_auto_replies'],
              replacement: 'I have not drafted the message yet — share the recipient and intent and I will draft it.',
              label: 'drafted',
            },
            {
              re: /\bI(?:'ve| have)?\s+(?:scheduled|booked)\b[^.\n]*\./gi,
              requires: ['schedule_meeting', 'calendar_batch_create_events'],
              replacement: 'I have not actually scheduled anything yet — confirm the time and attendees and I will book it.',
              label: 'scheduled',
            },
            {
              re: /\bI(?:'ve| have)?\s+(?:created|logged|saved|added)\b[^.\n]*?\b(?:notion|page|task|database|entry)\b[^.\n]*\./gi,
              requires: ['create_notion_page', 'notion_create_task', 'notion_batch_create_database_entries'],
              replacement: 'I have not created the Notion entry yet — confirm and I will log it.',
              label: 'notion_created',
            },
            {
              re: /\bI(?:'ve| have)?\s+(?:archived|deleted)\b[^.\n]*\./gi,
              requires: ['gmail_archive_thread', 'gmail_auto_archive_threads'],
              replacement: 'I have not archived anything yet — say the word and I will.',
              label: 'archived',
            },
            {
              re: /\bI(?:'ve| have)?\s+(?:cancelled|canceled)\b[^.\n]*\b(?:meeting|event|call)\b[^.\n]*\./gi,
              requires: ['calendar_cancel_event'],
              replacement: 'I have not cancelled that event yet — confirm and I will.',
              label: 'cancelled',
            },
          ];

          for (const rule of CLAIM_RULES) {
            if (!rule.re.test(finalText)) {
              rule.re.lastIndex = 0;
              continue;
            }
            rule.re.lastIndex = 0;
            if (!succeeded(rule.requires)) {
              log('warn', 'hallucination_guard_stripped_claim', { label: rule.label });
              finalText = finalText.replace(rule.re, rule.replacement);
            }
          }
        }

        // PART 44d — attachment-hallucination guard. When the user attached
        // any file AND the LLM's response contains a claim like "I analyzed /
        // reviewed / looked at the image / document" without the response
        // actually quoting or describing specific content from it, strip the
        // claim. Binary attachments (PDF, docx) are unreadable; image-only
        // attachments require a vision-capable model that free-tier rarely
        // provides. The heuristic: if a claim verb appears but the response
        // doesn't reference at least one concrete word from the attachment
        // name OR contain quoted text (markers of actual content awareness),
        // it's almost certainly fabricated.
        if ((attachments?.length ?? 0) > 0 && finalText.trim()) {
          const claimVerbRe = /\b(?:I(?:'ve| have)?\s+(?:analy[sz]ed|reviewed|looked\s+at|read\s+through|examined|gone\s+through|seen|checked\s+out))\b[^.\n]*\b(?:image|images|photo|attachment|document|file|pdf|screenshot|reference)\b[^.\n]*\./gi;
          if (claimVerbRe.test(finalText)) {
            claimVerbRe.lastIndex = 0;
            // Markers that the LLM is actually grounded in attachment content:
            // (1) a quoted substring (presumed pulled from the file),
            // (2) the attachment filename mentioned directly,
            // (3) a [ATTACHMENT — …] block reference (the LLM read the embed).
            const fnameTokens = (attachments ?? [])
              .map(a => (a.name || '').replace(/\.[^.]+$/, '').toLowerCase())
              .filter(Boolean);
            const lower = finalText.toLowerCase();
            const hasQuotedExcerpt = /"[^"\n]{8,}"|'[^'\n]{8,}'/.test(finalText);
            const mentionsFilename = fnameTokens.some(t => t.length >= 3 && lower.includes(t));
            const referencesAttachmentBlock = /\[ATTACHMENT/i.test(finalText);
            if (!hasQuotedExcerpt && !mentionsFilename && !referencesAttachmentBlock) {
              log('warn', 'attachment_hallucination_stripped', {
                attachmentCount: attachments?.length ?? 0,
                claimSample: finalText.match(claimVerbRe)?.[0]?.slice(0, 100),
              });
              finalText = finalText.replace(
                claimVerbRe,
                "I see you attached a file, but my current setup can't read its contents from here — paste the key part as text or describe what's in it and I'll take it from there.",
              );
            }
          }
        }

        if (isPlanMode) {
          // PART 42 — post-process the LLM's plan output to recover from the
          // two most common formatting failures on free models:
          //   1. Steps collapsed into one paragraph ("1. Foo 2. Bar 3. Baz")
          //      → split each numbered item onto its own line.
          //   2. ## headings or --- separators run together with surrounding
          //      content → insert the missing newlines.
          //   3. Params-dump pattern (multiple `key: "value"` lines as the
          //      whole body) → wrap with a header so it's at least readable
          //      and log it for later prompt tuning.
          finalText = normalizePlanMarkdown(finalText);
          const titleMatch = finalText.match(/^#\s+(.+)$/m);
          const planTitle = titleMatch ? titleMatch[1].trim() : 'Plan';
          emit('plan', { title: planTitle, markdown: finalText });
        } else if (finalText.trim() || canvasContent) {
          emit('message', { content: finalText, canvasContent: canvasContent || undefined });
        } else {
          const userTrim = userMessage.trim().toLowerCase();
          const chitchatRe = /^(hi+|hey+|yo|hello|sup|ok|okay|k|kk|got it|gotcha|right|noted|alright|cool|nice|perfect|thanks?|ty|thx|thank you|lol|haha|lmao|🙏|👍|✅|done|that's all|nevermind|never mind|nothing)\s*[!.\s]*$/i;
          const isChitchat = chitchatRe.test(userTrim);
          let rescue = '';

          if (!isChitchat && totalToolCalls > 0) {
            try {
              emit('thinking', { status: 'Writing summary…' });
              messages.push({
                role: 'user',
                content:
                  'Write your final reply to me NOW in plain prose, first person. Answer my request directly using the information you already gathered above. ' +
                  'Do NOT list steps or tool names. Do NOT use <thinking> tags. ' +
                  'If you saved a draft, say it is saved in my Gmail Drafts and give the subject and link you already have. ' +
                  'If you proposed a time, restate it. Be specific and concrete — never blank, never "let me know if you want a summary".',
              });
              const forced = await callLLM(messages, [], { temperature: 0.4, maxTokens: 4000, deadlineAt: reportDeadlineAt });
              rescue = sanitizeModelText(getRawText(forced.content)).trim();
              if (isStepListingResponse(rescue, true) || isIntentText(rescue)) rescue = '';
            } catch { rescue = ''; }
          }

          if (!rescue) {
            if (isChitchat) {
              rescue = /^(thanks?|ty|thx|thank you|🙏)/i.test(userTrim)
                ? 'Anytime.'
                : /^(ok|okay|k|kk|got it|gotcha|right|noted|alright|cool|nice|perfect|done)/i.test(userTrim)
                  ? 'Got it.'
                  : "Hey — what's up?";
            } else if (totalToolCalls > 0) {
              rescue = "I went through that, but couldn't pull it into a clean summary just now. If I drafted a reply it's saved in your Gmail Drafts — open your Drafts folder to review and send. Ask me again and I'll lay out exactly what I found.";
            } else {
              rescue = "I didn't catch a clear next step from that — say more about what you want me to do?";
            }
          }
          log('warn', 'empty_reply_rescued', { runId, isChitchat, toolCalls: totalToolCalls, userPreview: userMessage.slice(0, 80) });
          finalText = rescue;
          emit('message', { content: rescue });
        }

        // PART 57 — follow-up suggestion chips. Generated by a small LLM call
        // AFTER the main message is on the wire but BEFORE the stream closes,
        // so the client receives them as the last event. ~1-2s extra wall
        // clock; the main message has already rendered so perceived latency
        // is zero. Skip for plan-mode (the plan IS the response) and
        // background runs (no UI to render chips).
        if (!isPlanMode && !isBackgroundAgent && finalText.trim()) {
          try {
            const chips = await generateFollowUpSuggestions({
              userMessage,
              assistantReply: finalText,
              toolsCalled: outcomes.filter(o => o.ok).map(o => o.tool),
              connectedIntegrations,
            });
            if (chips.length > 0) emit('suggestions', { suggestions: chips });
          } catch { /* chips are optional UX, never break the stream */ }
        }

        if (!isBackgroundAgent && finalText.trim()) {
          try {
            const { detectViolations, logViolations, looksLikeDirectOrder } = await import('./rule-violations');
            const violations = detectViolations({
              assistantText: finalText,
              toolsCalled: outcomes.filter(o => o.ok).map(o => o.tool),
              userMessage,
              isDirectOrder: looksLikeDirectOrder(userMessage),
            });
            if (violations.length > 0) {
              log('warn', 'Rule violations detected', {
                runId,
                count: violations.length,
                rules: violations.map(v => v.rule),
              });
              logViolations({
                userId,
                runId,
                conversationId,
                violations,
                userMessage,
              }).catch(() => {});
            }
          } catch { /* never block on telemetry */ }
        }

        closeStream(totalToolCalls);

      } catch (err: any) {
        log('error', 'Unhandled loop error', {
          message: err.message,
          name: err.name,
          stack: err.stack?.slice(0, 500),
          runId,
        });
        emit('error', { message: err.message || 'Something went wrong. Please try again.' });
        // F1.2 — always emit done after error so the client doesn't fall
        // back to its "stream finished unexpectedly" salad path.
        closeStream(0);
      } finally {
        // Idempotent — closeStream() above already closed. This catches
        // any edge case where the try block returned without closing.
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
}
