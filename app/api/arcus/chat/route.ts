/**
 * Boult Chat — Main agentic chat endpoint.
 * POST /api/boult/chat
 *
 * Rebuilds the chat system from scratch:
 * - Tool_use via OpenRouter free models (see lib/boult/engine.ts TOOL_CAPABLE_MODELS)
 * - Supermemory v3 for cross-session memory
 * - Full conversation history on every call
 * - Real tool execution (Gmail, Calendar, Notion, Canvas, Web, Slack)
 * - SSE streaming matching ChatInterface.tsx event format
 */

import { NextRequest } from 'next/server';
// @ts-ignore
import { auth as nextAuth } from '../../../../lib/auth.js';
// @ts-ignore
const auth: any = nextAuth;
import { runAgentLoop } from '../../../../lib/boult/loop';
import { buildSystemPrompt, getConnectedIntegrations } from '../../../../lib/boult/system-prompt';
import { shouldDispatchParallelVAs } from '../../../../lib/boult/inbox-pipeline';
import { expandSlashCommand } from '../../../../lib/boult/skills';
import { searchMemories, extractAndSaveInsights } from '../../../../lib/boult/memory';
import { verifyGmailScopes } from '../../../../lib/boult/gmail-scope';
import { getCanvasState } from '../../../../lib/boult/canvas-state';
// @ts-ignore
import { subscriptionService, FEATURE_TYPES } from '../../../../lib/subscription-service.js';
import { assertPaidAccess } from '../../../../lib/subscription-protection.js';
import { logEvent } from "@/lib/logsso";

// The function ceiling. 300s is Vercel's max with Fluid Compute (the default
// runtime since 2025 — available on Hobby too). The loop's deadline derives
// from this below, so big tasks get the full window and still self-terminate
// ~12s before the platform pulls the plug to write + deliver their briefing.
// If a deploy ever rejects this with a max-duration error, enable Fluid
// Compute in Vercel → Project Settings → Functions (or drop this to 60 and
// the budget scales back down automatically).
// The client ALSO auto-continues a run that exhausts this window (a fresh
// invocation resumes from the tool trace), so total task time is unbounded.
export const maxDuration = 300;

function buildPlanSystemPrompt(userName: string, connectedIntegrations: string[]): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const INTEGRATION_LABELS: Record<string, string> = {
    gmail: 'Gmail',
    gcal: 'Google Calendar',
    notion: 'Notion',
    notion_calendar: 'Notion Calendar',
    slack: 'Slack',
  };
  const ALL_KNOWN = Object.keys(INTEGRATION_LABELS);

  const connected = connectedIntegrations.filter(k => INTEGRATION_LABELS[k]);
  // notion and notion_calendar share OAuth — if either is connected, don't list the other as missing
  const hasAnyNotion = connected.some(k => k === 'notion' || k === 'notion_calendar');
  const notConnected = ALL_KNOWN.filter(k => {
    if (connected.includes(k)) return false;
    if (hasAnyNotion && (k === 'notion' || k === 'notion_calendar')) return false;
    return true;
  });

  const alwaysAvailable = ['Web Search (built-in)', 'Canvas document viewer (built-in)'];
  const connectedLabels = connected.map(k => INTEGRATION_LABELS[k]);
  const notConnectedLabels = notConnected.map(k => INTEGRATION_LABELS[k]);

  const integrationSection = [
    '## Tools available to execute this plan',
    'Always available: ' + alwaysAvailable.join(', '),
    connected.length ? 'Connected integrations: ' + connectedLabels.join(', ') : 'No third-party integrations connected.',
    notConnected.length
      ? `NOT connected (do NOT plan steps that require these): ${notConnectedLabels.join(', ')}. Also do NOT plan steps using Microsoft 365, Outlook, Excel, Teams, Jira, HubSpot, Salesforce, Asana, Trello, or any other external app not listed above.`
      : '',
  ].filter(Boolean).join('\n');

  return `You are Boult, a strategic planning expert. Today is ${today}. The user's name is ${userName}.

Your only job right now is to produce a plan document the user would be proud to hand to an investor or a consultant — comprehensive, specific, and beautifully structured. The bar is a $500/hr operator's working document, not a chat reply.

${integrationSection}

## CRITICAL — Only plan what can actually be executed
- Every action item in the plan MUST be achievable using only the tools listed above, or be explicitly marked as a step the USER does themselves ("You: record the demo video").
- If an integration is not connected, do NOT include steps that require it.
- Do NOT include steps that say "use Microsoft 365", "log in to Outlook", "open Excel", "use HubSpot", or reference any app not listed as available above.
- Plan around what IS available. If email is needed and Gmail is connected, use Gmail. If no calendar is connected, skip scheduling steps or note the user must do it manually.

## Output rules — STRICT, NON-NEGOTIABLE

- Output ONLY the plan document as markdown. No preamble, no "here is your plan", no explanation before or after.
- Start immediately with "# [Plan Title]" on the first line.
- EVERY heading (#, ##, ###) on its own line. EVERY "---" on its own line with blanks around it.
- Use H1 (#) once for the plan title. H2 (##) for sections. H3 (###) for sub-sections. Bullets (- ) for items.
- Length: aim for 3,500–8,000 characters. A thin half-page plan is a failure; so is padding. Every line must be concrete and earn its place.
- NEVER use emojis. NEVER use bracketed placeholders like [TBD] or [insert X here]. Every item is concrete.
- Ground every claim in what the user actually told you or what is verifiably true. NEVER invent metrics, user counts, or dates.

## Steps section — USE boult-steps JSON BLOCK (mandatory)

The Steps section MUST be a fenced boult-steps JSON block — NEVER inline-numbered prose like "1. Foo 2. Bar 3. Baz" (which renders as a wall of text), and NEVER a JSON blob without the boult-steps tag. The renderer lays each step out as a numbered row. A real plan has 6–12 steps. Each step: a short label (3–6 words) + ONE concrete sentence — the action, the tool or owner, and the deliverable.

The JSON must be COMPLETE and VALID — every string closed, the array closed with ] }. Example of the EXACT format:

\`\`\`boult-steps
{ "steps": [
    { "label": "Search Gmail for newsletters", "description": "Use search_gmail with query 'category:promotions newer_than:7d'." },
    { "label": "Read top 20 candidates", "description": "Use gmail_bulk_read_threads to pull bodies in one call." },
    { "label": "Summarize into digest", "description": "Group by sender, bullet the most important items per source." },
    { "label": "Save digest to Notion", "description": "Use create_notion_page with title 'Newsletter Digest — <date>'." }
] }
\`\`\`

## Timeline & Success Metrics — USE boult-table JSON BLOCKS

Render the Timeline and the Success Metrics as fenced boult-table blocks so they lay out as real tables:

\`\`\`boult-table
{ "title": "Timeline", "columns": [{ "label": "Phase", "type": "text" }, { "label": "Focus", "type": "text" }, { "label": "Duration", "type": "text" }], "rows": [["Phase 1", "Fix the retention blocker", "Days 1-3"], ["Phase 2", "Pilot outreach to 25 founders", "Days 4-10"]] }
\`\`\`

## Anti-patterns — these MUST NOT appear in the output

ANTI-PATTERN 1 — params dump. The plan is for a HUMAN to read. Do NOT output bare key/value lines like:
  name: "Newsletter Digest"
  cron_schedule: "0 2 * * *"
  output_channel: "gmail"
These are tool inputs, not a plan. Translate them into narrative: "The agent runs nightly at 2:00 AM, delivers the digest to your Gmail inbox."

ANTI-PATTERN 2 — inline-numbered steps. Do NOT collapse the Steps section into a single paragraph like "1. Search Gmail 2. Read threads 3. Summarize". Use the boult-steps JSON block above — every step gets its own row.

ANTI-PATTERN 3 — inline headings or separators. Do NOT write "Use Gmail. ## Phase 2: Schedule the run." Headings and \`---\` MUST each be on their own line with blank lines around them.

ANTI-PATTERN 4 — recap of what the user said. Do NOT begin with "You asked me to plan X" or "Based on your request to do Y". Skip directly to the plan.

ANTI-PATTERN 5 — raw JSON as content. The ONLY JSON in the document lives inside \`\`\`boult-steps and \`\`\`boult-table fences. JSON anywhere else (in Steps as a plain code block, in prose, unfenced) is a hard failure.

## Plan structure — use this exact skeleton

\`\`\`markdown
# <Concrete Plan Title>

## Objective
<2-3 sentences — what this plan achieves and why it matters now>

## Where Things Stand
<3-5 bullets grounding the plan in the user's actual situation — only facts from their request or the conversation. No invented numbers.>

## Steps
<boult-steps block, 6-12 steps>

## Timeline
<boult-table block: Phase | Focus | Duration>

## Success Metrics
<3-5 measurable checkpoints as bullets — each one verifiable, e.g. "10 paying users on 30-day pilots", "landing LCP under 2.5s">

## Risks & Mitigations
<2-4 bullets, each "**Risk** — mitigation in one sentence">

## Expected Output
<one paragraph describing what the user will have when the plan completes — concrete artifacts, links, counts>

## Time Estimate
<one line, e.g. "Daily — 2-3 minutes per run" or "One-time sprint — 2 weeks">
\`\`\`

Do not call any tools. Output the plan markdown directly now.`;
}

function ts() { return new Date().toISOString().slice(11, 23); }

/**
 * PART 44c — pull contents of plain-text attachments off Vercel Blob (or
 * wherever they're hosted) and inline them into the user message so the LLM
 * actually reads them. Without this the LLM only sees the filename and
 * routinely hallucinates "I've reviewed your document" when nothing was
 * actually loaded.
 *
 * Strictly text-only MIME types and extensions. Binary files (PDF, docx,
 * xlsx, zip) are left alone — the loop's binaryHint tells the LLM to
 * acknowledge it can't read them. PDFs would need a parser (pdf-parse,
 * deferred to a later PART).
 *
 * Each extracted body is truncated to 50KB to keep prompt size sane. Network
 * fetch is capped at 6s per file. All errors swallowed — extraction failure
 * never breaks the chat flow.
 */
async function embedTextAttachments(
  message: string,
  attachments: Array<{ name: string; url: string; type: string; size?: number; base64?: string }>,
): Promise<string> {
  if (!attachments?.length) return message;

  const TEXT_MIME_RE = /^(text\/|application\/(json|xml|x-yaml|yaml))/i;
  const TEXT_EXT_RE = /\.(txt|md|markdown|csv|tsv|json|jsonl|log|xml|yaml|yml|ini|conf|env\.example)$/i;
  const MAX_BODY_BYTES = 50_000;

  const textAttachments = attachments.filter(a => {
    const type = (a.type || '').toLowerCase();
    const name = (a.name || '').toLowerCase();
    return TEXT_MIME_RE.test(type) || TEXT_EXT_RE.test(name);
  });

  if (textAttachments.length === 0) return message;

  const blocks: string[] = [];
  for (const a of textAttachments) {
    try {
      let raw: string | null = null;

      // Primary path: the composer sends the file's base64 alongside a blob:
      // object URL. blob: URLs are browser-only — fetch()ing them server-side
      // always fails, which meant every CSV/text upload silently never reached
      // the AI. Decode the base64 we already have instead.
      if (a.base64) {
        // Accept both a raw base64 string and a data: URL.
        const b64 = a.base64.includes(',') ? a.base64.slice(a.base64.indexOf(',') + 1) : a.base64;
        raw = Buffer.from(b64, 'base64').toString('utf-8');
      } else if (/^https?:\/\//i.test(a.url || '')) {
        // Fallback: a real hosted URL (e.g. Vercel Blob) — fetch it.
        const res = await fetch(a.url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) continue;
        raw = await res.text();
      }
      if (raw == null) continue;

      const truncated = raw.length > MAX_BODY_BYTES
        ? `${raw.slice(0, MAX_BODY_BYTES)}\n…[truncated — ${raw.length - MAX_BODY_BYTES} more bytes]`
        : raw;
      blocks.push(`[ATTACHMENT — ${a.name}]\n\`\`\`\n${truncated}\n\`\`\``);
    } catch {
      logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
      // swallow — the loop's binaryHint covers unreachable files
    }
  }

  return blocks.length > 0
    ? `${message}\n\n${blocks.join('\n\n')}`
    : message;
}
function log(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) {
  const line = extra
    ? `[Boult:Route] ${ts()} ${msg} ${JSON.stringify(extra)}`
    : `[Boult:Route] ${ts()} ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export async function POST(request: NextRequest) {
  const reqStart = Date.now();

  // Auth
  const session = await auth();
  if (!session?.user?.email) {
    log('warn', 'Unauthorized request — no session');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const userId = session.user.email.toLowerCase();
  const userName = session.user.name?.split(' ')[0] || 'there';

  // STRICT paywall — Boult compute is paid-only. The client redirect is not
  // enough; block the API directly so a free/expired user (or a replayed
  // request) can't drive the agent without a paid/trial plan.
  const gate = await assertPaidAccess(userId);
  if (!gate.ok) {
    log('warn', 'Paywall — no paid/trial plan', { userId, planType: gate.planType });
    return new Response(
      JSON.stringify({ error: gate.error, message: gate.message, upgradeUrl: gate.upgradeUrl }),
      { status: gate.status, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Parse body
  let body: {
    message?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    conversationId?: string;
    isPlanMode?: boolean;
    attachments?: Array<{ name: string; url: string; type: string; size?: number; base64?: string }>;
    /** PART 47 — per-request override of the saved actionMode. 'auto' →
     *  skipConfirmations=true for this run. Falls back to the persisted
     *  user pref when omitted. */
    actionMode?: 'ask' | 'auto';
  } = {};
  try {
    body = await request.json();
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    log('error', 'Failed to parse request body', { error: e.message });
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { message, history = [], conversationId, isPlanMode = false, attachments = [], actionMode: bodyActionMode } = body;
  if (!message?.trim()) {
    log('warn', 'Empty message received', { userId });
    return new Response(JSON.stringify({ error: 'message is required' }), { status: 400 });
  }

  log('info', 'Request received', {
    userId,
    isPlanMode,
    historyTurns: history.length,
    msgPreview: message.slice(0, 80),
    conversationId,
  });

  // Build context (run in parallel for speed)
  let connectedIntegrations: string[] = [];
  let memories = '';
  let personalityData = '';
  let voiceContext = '';
  let preferenceMemories = '';
  let userModel = '';
  let stylePrefs: { communicationStyle?: 'direct' | 'balanced' | 'warm'; verbosity?: 'brief' | 'normal' | 'detailed'; actionMode?: 'ask' | 'auto' } = {};
  try {
    // Phase C — Enrich the memory context with TWO parallel queries:
    //   1. searchMemories(message)  — semantic match to current message
    //   2. searchMemories('[PREFERENCE]') — explicit preference memories
    // Past code only queried (1), so the LLM might miss a saved preference
    // that doesn't semantically overlap with the current message ("never
    // schedule weekends" wouldn't surface on a Monday "schedule X" query).
    [connectedIntegrations, memories, preferenceMemories, personalityData, voiceContext, stylePrefs, userModel] = await Promise.all([
      getConnectedIntegrations(userId),
      searchMemories(userId, message, 5),
      searchMemories(userId, '[PREFERENCE]', 8),
      fetchPersonality(userId),
      getVoiceContext(userId),
      fetchUserStylePrefs(userId),
      (async () => { try { const { getUserModelSummary } = await import('../../../../lib/boult/user-model'); return await getUserModelSummary(userId); } catch {
          logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); return ''; } })(),
    ]);
    // Combine, dedup by line content
    if (preferenceMemories && !memories.includes(preferenceMemories.slice(0, 100))) {
      memories = [memories, preferenceMemories].filter(Boolean).join('\n\n');
    }
    log('info', 'Context ready', { integrations: connectedIntegrations, memoryChars: memories.length, voiceProfileChars: voiceContext.length });
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    log('error', 'Context build failed — continuing with empty context', { error: e.message, stack: e.stack?.slice(0, 300) });
  }

  // PART 23: split the two signals.
  //   - voice (sent-mail derived) → personality: drives email body STYLE.
  //   - free-text user instructions → userInstructions: BINDING RULES.
  // The old code concatenated them under one "voice profile" header which
  // made the LLM treat behavioral rules ("never schedule before 9am") as
  // writing-style hints. They're now two separate prompt blocks with
  // distinct semantics.
  //
  // PART 46 — server-side slash-command expansion. If the user's message
  // starts with /<known-prompt-cmd>, replace it with that command's canonical
  // template BEFORE the VA dispatcher classifies it and BEFORE the system
  // prompt is built. The chat history (stored client-side) still carries the
  // literal "/brief" the user typed, so the conversation log stays clean;
  // only the LLM sees the expansion. Client-kind commands (/agents, /clear,
  // /help) are intercepted in the browser and never reach this route — if
  // one slips through, expandSlashCommand passes it through unchanged.
  const { expanded: slashExpanded, matchedCommand: slashCmd } = expandSlashCommand(message);
  if (slashCmd) {
    log('info', 'slash_command_expanded', { name: slashCmd.name, originalLen: message.length, expandedLen: slashExpanded.length });
  }

  // PART 38b — narrow the prompt's Tool inventory section in lockstep with
  // PART 39b's getAvailableTools VA filter. Same classifier (PART 37) drives
  // both: ≥2 VAs relevant → both prompt and tool surface narrow to those VAs.
  // Plan mode and zero/one-VA turns get the full inventory (no filter).
  const vaDispatch = isPlanMode
    ? { fire: false, vas: [], reason: 'none' as const }
    : shouldDispatchParallelVAs(slashExpanded);
  const promptVAFilter = vaDispatch.fire && vaDispatch.vas.length >= 2 ? vaDispatch.vas : undefined;

  // PART 47 — resolve the effective write-action mode early so it flows into
  // BOTH the system prompt (turns on the "Confirmations are OFF" overlay
  // block) AND runAgentLoop (bypasses the executor's state-machine gate).
  // Precedence: per-request body override → persisted user pref → 'ask' default.
  const effectiveActionMode: 'ask' | 'auto' =
    bodyActionMode === 'ask' || bodyActionMode === 'auto'
      ? bodyActionMode
      : stylePrefs.actionMode ?? 'ask';
  const skipConfirmations = effectiveActionMode === 'auto';

  let ruleFocus: string | null = null;
  if (!isPlanMode) {
    try {
      const { getRecentViolationFocus } = await import('@/lib/boult/rule-violations');
      ruleFocus = await getRecentViolationFocus(userId, 24);
    } catch {
      logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* telemetry table optional */ }
  }

  let systemPrompt = isPlanMode
    ? buildPlanSystemPrompt(userName, connectedIntegrations)
    : buildSystemPrompt({
        userName,
        userId,
        connectedIntegrations,
        memories,
        userModel: userModel || undefined,
        personality: voiceContext || undefined,
        userInstructions: personalityData || undefined,
        relevantVAs: promptVAFilter,
        communicationStyle: stylePrefs.communicationStyle,
        verbosity: stylePrefs.verbosity,
        skipConfirmations,
        ruleFocus,
      });

  // ── Live canvas grounding ────────────────────────────────────────────────────
  // THE root cause of "Boult can't edit the document" — found by tracing what
  // actually reaches the model on a follow-up turn. The `history` array sent
  // with every request (both here and client-side in ChatInterface.tsx) carries
  // ONLY the short chat-bubble text for each assistant turn — never the
  // markdown that was written into the canvas. So the moment a document leaves
  // the turn that created it, the model's knowledge of "what's on screen" is a
  // one-line summary like "Canvas opened: Q3 Report." Ask it to shorten the
  // intro or add a section, and it has no ground truth to edit — it fabricates
  // a replacement from a vague memory of the topic, which is exactly why edits
  // come back short and generic instead of a precise change to the real text.
  //
  // getCanvasState is DB-persisted per conversationId (boult_canvas_state),
  // independent of what the client includes in `history` — so it is reachable
  // here even though the lossy history is not fixable without touching the
  // client's message-storage shape everywhere it's read. Injecting the actual
  // current markdown into the system prompt gives every edit request something
  // real to act on.
  if (conversationId && !isPlanMode) {
    try {
      const canvas = await getCanvasState(conversationId);
      if (canvas?.markdown?.trim()) {
        const MAX = 6000; // ~1500 tokens — generous for a real doc, bounded so one giant report can't eat the whole context budget
        const full = canvas.markdown.trim();
        const truncated = full.length > MAX;
        const body = truncated ? `${full.slice(0, MAX)}\n\n…[truncated — ${full.length - MAX} more characters not shown]` : full;
        systemPrompt += `\n\n## Current Canvas (what the user is actually looking at right now)\n` +
          `Title: ${canvas.title || '(untitled)'} · Type: ${canvas.type || 'notes'}\n` +
          `This is the EXACT live content of the open canvas — not your memory of writing it.\n` +
          `--- BEGIN CANVAS ---\n${body}\n--- END CANVAS ---\n` +
          `If the user asks to edit, shorten, expand, or restructure it, call update_canvas with the FULL revised markdown (mode="replace") that changes ONLY what was asked and leaves the rest of this text intact. Do NOT regenerate the document from scratch — that silently drops sections the user never asked to lose.` +
          (truncated ? `\nThe content above was truncated for length. If the requested edit touches the truncated tail, use update_canvas mode="append" for additions instead of attempting a full replace you cannot see in full.` : '');
      }
    } catch (err: any) {
      // Grounding is a quality improvement, not a requirement — never block
      // the turn because canvas-state lookup had a bad moment.
      logEvent({ channel: "failures", event: "❌ API Error", description: String(err?.message || err) });
    }
  }

  // Auto-extract "remember X" / "save this" / "from now on..." from the
  // user's message and persist it as a memory in-band. Fire-and-forget so
  // memory writes never block the response stream. Patterns are deliberately
  // conservative — false positives create noise in the user's settings card.
  (async () => {
    try {
      // F7.2 — Tightened patterns. The previous "always X" / "never X"
      // matched everyday speech like "Always loved that movie" → saved as
      // a behavioral rule. Now the always/never pattern REQUIRES an
      // assistive-action verb after it (cc, bcc, include, notify, send,
      // schedule, draft, use, sign, reply, archive, mention) so it only
      // triggers on instructions to the AI, not casual prose.
      const ASSISTIVE_VERBS = '(?:cc|bcc|include|add|attach|notify|alert|send|schedule|book|draft|use|sign|reply|respond|archive|label|tag|mention|file|forward|copy|set|prefer|treat|prioritize|skip|ignore|hide)';
      const REMEMBER_PATTERNS: Array<{ re: RegExp; group: number }> = [
        // "remember that <fact>", "remember <fact>"
        { re: /\bremember\s+(?:that\s+|this:\s*)?(.{8,300}?)(?:[.!?]\s*$|[.!?]\s+\w)/i, group: 1 },
        // "please remember <fact>", "can you remember <fact>"
        { re: /\b(?:please|can you|could you)\s+remember\s+(?:that\s+)?(.{8,300}?)(?:[.!?]\s*$|[.!?]\s+\w)/i, group: 1 },
        // "save this to memory: <fact>"
        { re: /\b(?:save\s+(?:this\s+)?(?:to|in|as)\s+memory|note\s+for\s+(?:later|me))[:\s]+(.{8,300}?)(?:[.!?]\s*$|[.!?]\s+\w)/i, group: 1 },
        // "from now on, <rule>"
        { re: /\bfrom\s+now\s+on[,:\s]+(.{8,300}?)(?:[.!?]\s*$|[.!?]\s+\w)/i, group: 1 },
        // "always <assistive verb> ..." / "never <assistive verb> ..." at start of message
        { re: new RegExp(`^\\s*(always|never)\\s+${ASSISTIVE_VERBS}\\s+(.{8,300}?)(?:[.!?]\\s*$|[.!?]\\s+\\w)`, 'i'), group: 0 },
      ];
      for (const { re, group } of REMEMBER_PATTERNS) {
        const m = message.match(re);
        if (m) {
          const fact = (group === 0 ? m[0] : m[group])?.trim();
          if (fact && fact.length >= 8 && fact.length <= 300) {
            const { saveMemory } = await import('../../../../lib/boult/memory');
            await saveMemory(userId, fact, ['user-stated'], 'user');
            log('info', 'Auto-extracted user memory', { fact: fact.slice(0, 120) });
            break; // one extraction per message — avoid double-saves
          }
        }
      }
    } catch (e: any) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      log('warn', 'Auto-extract memory failed', { error: e.message });
    }
  })();

  // Sanitize history (last 20 turns)
  const sanitizedHistory = history
    .slice(-20)
    .filter(h => h.role && h.content?.trim())
    .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }));

  // ── Gmail scope preflight ──────────────────────────────────────────────────
  // Cached 1h. The moment Google says 403 we replace the would-be loop with a
  // tiny SSE stream that emits a connector_required card and a final message
  // telling the user to reconnect. Saves the LLM from calling search_gmail
  // mid-turn and surfacing the bare 403 string.
  if (connectedIntegrations.includes('gmail')) {
    const scopeCheck = await verifyGmailScopes(userId);
    if (!scopeCheck.ok && scopeCheck.reason === 'scope_missing') {
      log('warn', 'Gmail scope preflight failed — short-circuiting with connector_required', { userId });
      const enc = new TextEncoder();
      const preflightStream = new ReadableStream({
        start(controller) {
          const emit = (type: string, data: unknown) =>
            controller.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
          const runId = `preflight-${Date.now()}`;
          emit('run_start', { runId, message });
          emit('connector_required', {
            connectors: [{
              id: 'gmail',
              name: 'Gmail',
              description: 'Your Gmail token is missing the scopes Boult needs. Reconnecting takes 5 seconds and lets me search your inbox, draft, and send mail.',
              connected: false,
            }],
            waitingForUser: true,
            reason: 'gmail_scope_missing',
          });
          emit('message', {
            content:
              "I can't reach your Gmail yet — the connection is missing some permissions. " +
              "Click **Reconnect Gmail** on the card above (or open the connectors button in the prompt box) and complete the Google sign-in. " +
              "Then ask me again and I'll pick up right where you left off.",
          });
          emit('done', { runId, durationMs: Date.now() - reqStart, totalSteps: 0 });
          controller.close();
        },
      });
      return new Response(preflightStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Conversation-Id': conversationId || '',
        },
      });
    }
  }

  // PART 44c — extract contents of plain-text attachments (txt, md, csv,
  // json, log) server-side and prepend them to the user message inside
  // fenced [ATTACHMENT — filename] blocks so the LLM can actually read them.
  // PDFs, docx, etc. are binary — left as-is for the loop to mention as
  // unreadable. Truncated to 50KB each to keep prompt size sane.
  // (slashExpanded was already produced higher up so the VA dispatcher and
  // system-prompt build operate on the expanded text.)
  const messageWithAttachmentContents = await embedTextAttachments(slashExpanded, attachments);

  log('info', 'Starting agent loop', {
    tools: connectedIntegrations,
    historyKept: sanitizedHistory.length,
    setupMs: Date.now() - reqStart,
    systemPromptChars: systemPrompt.length,
    extractedTextBytes: messageWithAttachmentContents.length - message.length,
    // PART 58 — settings snapshot. Every chat request logs exactly which
    // user settings were loaded + threaded into the LLM, so we can verify
    // at runtime whether tone / length / actionMode / instructions are
    // actually being applied. If the user reports "settings don't apply"
    // again, grep server logs for this snapshot first.
    settingsSnapshot: {
      tone: stylePrefs.communicationStyle || 'default(warm)',
      length: stylePrefs.verbosity || 'default(normal)',
      actionMode: effectiveActionMode,
      hasInstructions: !!personalityData,
      instructionsLen: personalityData?.length || 0,
    },
  });

  let stream: ReadableStream;
  try {
    stream = runAgentLoop({
      userId,
      systemPrompt,
      history: sanitizedHistory,
      userMessage: messageWithAttachmentContents,
      connectedIntegrations,
      isPlanMode,
      conversationId,
      userInstructions: personalityData || undefined,
      attachments,
      // PART 47 — interactive 'Auto' mode bypasses the confirmation surface.
      // Background-agent runs continue to set this via run-agent.ts.
      skipConfirmations,
      // PART 53 — surface tone + length to the loop so the per-turn rules
      // hint includes them; previously they were only in the userStyle block
      // at the bottom of the system prompt and got forgotten by free models.
      communicationStyle: stylePrefs.communicationStyle,
      verbosity: stylePrefs.verbosity,
      // Budget derives from the function ceiling: the loop gets everything
      // except a 12s margin for the final message + SSE flush + persistence
      // before the platform kills the function. It still self-terminates at
      // the deadline and delivers its briefing — and if the task NEEDS more,
      // the client auto-continues it in a fresh invocation, so quality is
      // never cut for time. Tool ceiling = the loop's interactive hard cap.
      deadlineMs: maxDuration * 1000 - 12_000,
      maxToolCalls: 40,
    });
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    log('error', 'runAgentLoop threw synchronously', { error: e.message, stack: e.stack?.slice(0, 300) });
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }

  saveMemoryAsync(userId, message, conversationId);

  // Fire-and-forget usage tracking (non-blocking)
  subscriptionService.incrementFeatureUsage(userId, FEATURE_TYPES.BOULT_AI).catch(() => {});

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Conversation-Id': conversationId || '',
    },
  });
}

/** Save memory async after response completes — doesn't block streaming */
async function saveMemoryAsync(userId: string, userMessage: string, _conversationId?: string) {
  try {
    await extractAndSaveInsights(userId, userMessage, '');
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    console.warn(`[Boult:Route] ${ts()} Memory save failed (non-fatal)`, { error: e.message });
  }
}

/** Fetch user's Boult personality setting from user_profiles.preferences.
 *  PART 53 — respects the instructionsEnabled toggle: returns '' when the
 *  user has disabled instructions in settings, so the chat route doesn't
 *  pass a stale personality block into the prompt. */
async function fetchPersonality(userId: string): Promise<string> {
  try {
    const { getSupabaseAdmin } = await import('../../../../lib/supabase.js');
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();
    const prefs = (data?.preferences as Record<string, unknown>) || {};
    if (prefs.boult_instructions_enabled === false) return '';
    return (prefs.boult_personality as string) || '';
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return '';
  }
}

/**
 * PART 45 — fetch the user's tone + length preferences. Defaults match the
 * PART 43 voice rewrite ('warm' + 'normal'). Returned undefined fields tell
 * buildSystemPrompt to skip injecting the style overlay block entirely.
 */
async function fetchUserStylePrefs(userId: string): Promise<{
  communicationStyle?: 'direct' | 'balanced' | 'warm';
  verbosity?: 'brief' | 'normal' | 'detailed';
  actionMode?: 'ask' | 'auto';
}> {
  try {
    const { getSupabaseAdmin } = await import('../../../../lib/supabase.js');
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();
    const prefs = (data?.preferences as Record<string, unknown>) || {};
    const style = prefs.boult_communication_style as string | undefined;
    const verb = prefs.boult_verbosity as string | undefined;
    const action = prefs.boult_action_mode as string | undefined;
    return {
      communicationStyle: style === 'direct' || style === 'balanced' || style === 'warm' ? style : undefined,
      verbosity: verb === 'brief' || verb === 'normal' || verb === 'detailed' ? verb : undefined,
      // PART 47 — persisted Ask / Auto mode.
      actionMode: action === 'ask' || action === 'auto' ? action : undefined,
    };
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return {};
  }
}

/**
 * Resolve the user's learned writing voice into a prompt block.
 *
 * Reads the real `user_voice_profiles` profile. If the user has never had one
 * built, bootstraps it once from their last 50 sent emails so that the very
 * first draft already sounds like them. The whole bootstrap is time-boxed so a
 * cold profile can never blow the request's streaming budget.
 */
async function getVoiceContext(userId: string): Promise<string> {
  try {
    const { voiceProfileService } = await import('../../../../lib/voice-profile-service.js');

    let profile: any = await voiceProfileService.getVoiceProfile(userId);

    // Only bootstrap when the user has genuinely never been profiled. A saved
    // 'default' profile means we already tried — don't hammer Gmail every turn.
    if (!profile) {
      profile = await bootstrapVoiceProfile(userId, voiceProfileService);
    }

    if (!profile || profile.status === 'default') return '';

    const prompt = voiceProfileService.generateVoicePrompt(profile);
    return typeof prompt === 'string' ? prompt.trim() : '';
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    log('warn', 'Voice profile load failed (non-fatal)', { error: e.message });
    return '';
  }
}

/**
 * One-time voice-profile bootstrap from the user's sent mail.
 * Returns the saved profile, or null if it could not be built. Always persists
 * *something* (even a default) so subsequent turns short-circuit instead of
 * re-running this expensive path on every message.
 */
async function bootstrapVoiceProfile(userId: string, voiceProfileService: any): Promise<any | null> {
  try {
    const { getSupabaseAdmin } = await import('../../../../lib/supabase.js');
    const { decrypt } = await import('../../../../lib/crypto.js');
    const supabase = getSupabaseAdmin();

    const { data } = await supabase
      .from('boult_integrations')
      .select('access_token, refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();

    if (!data?.access_token) return null; // Gmail not connected — try again later

    const accessToken = decrypt(data.access_token);
    const refreshToken = data.refresh_token ? decrypt(data.refresh_token) : '';

    const { GmailService } = await import('../../../../lib/gmail');
    const gmail = new GmailService(accessToken, refreshToken);

    // Time-box the whole fetch+analyze+save so a slow mailbox cannot stall chat.
    const TIMEOUT = Symbol('timeout');
    const built = await Promise.race([
      (async () => {
        const sentEmails = await voiceProfileService.fetchSentEmails(gmail, 50);
        if (!Array.isArray(sentEmails) || sentEmails.length < 3) {
          // Persist a default so we don't retry this every single message.
          const def = voiceProfileService.getDefaultVoiceProfile();
          await voiceProfileService.saveVoiceProfile(userId, def);
          return null;
        }
        const profile = await voiceProfileService.analyzeVoiceProfile(sentEmails);
        await voiceProfileService.saveVoiceProfile(userId, profile);
        log('info', 'Voice profile auto-generated from sent mail', { emails: sentEmails.length });
        return profile;
      })(),
      new Promise(resolve => setTimeout(() => resolve(TIMEOUT), 22000)),
    ]);

    if (built === TIMEOUT) {
      log('warn', 'Voice profile bootstrap timed out — using generic voice this turn');
      return null;
    }
    return built;
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    log('warn', 'Voice profile bootstrap failed (non-fatal)', { error: e.message });
    return null;
  }
}
