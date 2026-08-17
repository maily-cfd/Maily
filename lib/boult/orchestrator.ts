/**
 * Boult Orchestration Layer — PART 9
 *
 * Sits between the user message and the LLM. Parses intent, builds a typed
 * dependency graph of required tool calls, detects parallel-safe branches,
 * validates that the user has the required integrations, and returns a
 * structured ExecutionPlan that the loop injects as a pre-turn hint.
 *
 * The loop uses the plan for:
 *   1. Budget management — stops issuing new tasks when cap is near
 *   2. Parallel scheduling — executes independent branches concurrently
 *   3. Prerequisite enforcement — refuses a write without its required reads
 *   4. Graceful degradation — skips a step when its prereq failed, surfaces why
 *
 * The LLM is still the one that calls tools; the orchestrator constrains the
 * order and shapes the hint so the LLM naturally follows the right sequence
 * without needing to reason about dependencies from scratch every turn.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/** A single node in the execution plan. */
export interface PlanStep {
  /** Human-readable label shown in the plan card. */
  label: string;
  /**
   * Tool name(s) to run at this step.
   * An array means all tools in the array run in parallel.
   */
  tools: string[];
  /** Whether tools in this step run concurrently (no ordering among them). */
  parallel: boolean;
  /**
   * Step indices that must complete before this step starts.
   * An empty array means this step can run immediately.
   */
  dependsOn: number[];
  /** Integration required for this step. null = always available. */
  requiredIntegration: string | null;
  /**
   * Whether this step is a write action that needs request_confirmation
   * (unless skip_confirmations is true).
   */
  isWrite: boolean;
  /**
   * Why this step is included — injected into the LLM hint so it understands
   * the causal chain and doesn't call tools in the wrong order.
   */
  reason: string;
}

/** The full ordered plan produced by buildExecutionPlan(). */
export interface ExecutionPlan {
  /** Short intent summary (one sentence). */
  intent: string;
  /** Ordered list of steps. Parallel steps may overlap. */
  steps: PlanStep[];
  /** Integrations required but not connected. */
  missingIntegrations: string[];
  /**
   * Whether the plan contains any write actions that require confirmation
   * (or queuing in background agent mode).
   */
  requiresConfirmation: boolean;
  /**
   * Estimated tool call count (min..max range accounting for parallelism).
   * Used to decide up-front whether the plan fits the budget.
   */
  estimatedCalls: { min: number; max: number };
}

// ── Intent matchers ─────────────────────────────────────────────────────────────

/**
 * A pattern group: if ANY pattern matches the user message, the associated
 * tool chain is required. Evaluated in order — first match wins per group.
 */
interface IntentPattern {
  /** Human description of the intent class. */
  name: string;
  patterns: RegExp[];
  /** Required integration (null = always available). */
  integration: string | null;
  /** Ordered tool chain to add to the plan for this intent. */
  chain: ChainStep[];
}

interface ChainStep {
  tools: string[];
  label: string;
  parallel?: boolean;
  isWrite?: boolean;
  reason: string;
  requiredIntegration?: string | null;
}

// ── Dependency graph: prerequisite map ────────────────────────────────────────
//
// Maps a tool name → tools that MUST have run successfully before it.
// The orchestrator uses this to build the dependsOn array automatically.

const PREREQUISITES: Record<string, string[]> = {
  // Email write actions need thread content
  draft_reply:        ['gmail_read_thread', 'read_email'],
  send_email:         ['draft_reply', 'request_confirmation'],

  // Calendar writes need availability
  schedule_meeting:   ['calendar_get_availability', 'get_calendar_events', 'request_confirmation'],

  // Notion writes need schema
  create_notion_page: ['fetch_notion_schema'],
  notion_create_task: ['fetch_notion_schema'],

  // Slack DM needs user lookup
  slack_send_dm:      ['slack_find_user'],
};

/** Tools that are always safe to run without any prerequisite. */
const READ_ONLY_TOOLS = new Set([
  'search_gmail', 'read_email', 'gmail_read_thread', 'get_sent_emails',
  'get_calendar_events', 'calendar_get_availability',
  'search_notion', 'notion_read_page', 'fetch_notion_schema',
  'slack_find_user', 'slack_get_channels',
  'web_search', 'web_search_instant',
  'get_contact_context', 'get_recipient_context', 'memory_get_contact_profile',
  'memory_search', 'get_voice_profile',
  'gmail_get_labels', 'gmail_get_profile',
  'notion_get_calendar_events',
  'check_followups',
]);

/** Tools that constitute write actions — require confirmation gate. */
const WRITE_TOOLS = new Set([
  'send_email', 'schedule_meeting', 'send_slack_message', 'create_notion_page',
  'notion_create_task', 'slack_send_dm', 'gmail_archive_thread',
  'gmail_apply_label', 'calendar_cancel_event',
]);

// ── Parallel-safe tool groups ──────────────────────────────────────────────────
//
// Within a single step, these tools produce independent outputs and can
// all fire at once. The orchestrator groups them into parallel steps.

const PARALLEL_SAFE_READS = [
  ['calendar_get_availability', 'get_voice_profile'],
  ['memory_get_contact_profile', 'get_voice_profile'],
  ['memory_get_contact_profile', 'calendar_get_availability'],
  ['search_gmail', 'get_calendar_events'],
  ['search_gmail', 'search_notion'],
  ['get_calendar_events', 'search_notion'],
  ['slack_find_user', 'get_contact_context'],
];

// ── Intent pattern registry ────────────────────────────────────────────────────
//
// Ordered from most-specific to least-specific. The orchestrator checks every
// pattern and collects ALL matching chains (a message can trigger multiple
// intent chains — e.g. "reply to Priya AND book a call" triggers both the
// reply chain and the meeting chain).

const INTENT_PATTERNS: IntentPattern[] = [
  // ── Reply to an email ───────────────────────────────────────────────────────
  {
    name: 'reply_email',
    patterns: [
      /\b(reply|respond|write back|get back)\b.{0,40}\b(email|message|thread|mail)\b/i,
      /\b(draft|compose)\b.{0,30}\b(reply|response)\b/i,
      /\b(reply|respond)\b.{0,20}\b(to|with)\b/i,
    ],
    integration: 'gmail',
    chain: [
      { tools: ['search_gmail'],        label: 'Find the email thread',   reason: 'Locate the specific thread to reply to.' },
      { tools: ['gmail_read_thread'],   label: 'Read full thread',        reason: 'Content is required before drafting; executor refuses draft_reply without a prior read.' },
      { tools: ['memory_get_contact_profile', 'get_voice_profile'], label: 'Load contact context + voice', parallel: true, reason: 'Both can run concurrently — contact history and voice profile are independent.' },
      { tools: ['draft_reply'],         label: 'Draft the reply',         reason: 'Generate draft with thread content + voice profile.' },
    ],
  },

  // ── Send (hard-send) an email ───────────────────────────────────────────────
  {
    name: 'send_email',
    patterns: [
      /\b(send|shoot|fire off)\b.{0,30}\b(email|mail|message)\b/i,
    ],
    integration: 'gmail',
    chain: [
      { tools: ['memory_get_contact_profile', 'get_voice_profile'], label: 'Load context + voice', parallel: true, reason: 'Independent reads before composing.' },
      { tools: ['draft_reply'],         label: 'Compose email',           reason: 'Compose with voice profile.' },
      { tools: ['request_confirmation'],label: 'Confirm before sending',  isWrite: true, reason: 'Send is irreversible — gate required.' },
      { tools: ['send_email'],          label: 'Send email',              isWrite: true, reason: 'Execute after user confirmation.' },
    ],
  },

  // ── Book a meeting / schedule a call ───────────────────────────────────────
  {
    name: 'book_meeting',
    patterns: [
      /\b(book|schedule|set up|arrange|block)\b.{0,30}\b(meeting|call|sync|catch-?up|chat|session)\b/i,
      /\b(find|check|look for)\b.{0,20}\b(time|slot|availability)\b/i,
    ],
    integration: 'gcal',
    chain: [
      { tools: ['get_calendar_events', 'calendar_get_availability'], label: 'Check calendar availability', parallel: true, reason: 'Both provide availability data; executor refuses schedule_meeting without a prior calendar fetch.' },
      { tools: ['request_confirmation'],label: 'Confirm meeting details',  isWrite: true, reason: 'Meeting creation is irreversible — gate required.' },
      { tools: ['schedule_meeting'],    label: 'Book the meeting',         isWrite: true, reason: 'Execute after approval.' },
    ],
  },

  // ── Reply AND book (combined) ──────────────────────────────────────────────
  {
    name: 'reply_and_book',
    patterns: [
      /\b(reply|respond|draft).{0,60}\b(book|schedule|meeting|call)\b/i,
      /\b(book|schedule).{0,60}\b(reply|respond|draft)\b/i,
      /\b(reply|respond)\b.{0,40}\band\b.{0,40}\b(book|schedule|meeting)\b/i,
    ],
    integration: 'gmail',
    chain: [
      { tools: ['search_gmail'],                label: 'Find the email thread',               reason: 'Locate thread context for both the reply and the meeting details.' },
      { tools: ['gmail_read_thread'],           label: 'Read full thread',                    reason: 'Required by draft_reply prerequisite gate.' },
      { tools: ['memory_get_contact_profile', 'get_voice_profile', 'calendar_get_availability'], label: 'Load contact, voice + availability', parallel: true, reason: 'Three independent reads that can all run at the same time.' },
      { tools: ['request_confirmation'],        label: 'Confirm meeting + draft',             isWrite: true, reason: 'Two write actions pending — single confirmation covers both.' },
      { tools: ['schedule_meeting', 'draft_reply'], label: 'Book meeting + draft reply with link', parallel: false, reason: 'schedule_meeting first to get the Meet link; draft_reply embeds it.' },
    ],
  },

  // ── Inbox triage / summarise inbox ─────────────────────────────────────────
  {
    name: 'inbox_triage',
    patterns: [
      /\b(check|look at|process|triage|go through|sort|handle|fetch|scan|review|read|investigate|analyze|analyse|summari[sz]e|catch me up on|pull up)\b.{0,40}\b(inbox|emails?|mail|messages|threads?|unread)\b/i,
      /\b(inbox|emails?|mail|messages|threads?|unread)\b.{0,40}\b(needs?|requires?|that need|which need)\b.{0,20}\b(action|reply|response|attention|follow.?up)\b/i,
      /\b(what('?s| is|'?s| did i miss)\b.{0,30}\b(inbox|email|unread)\b)/i,
      /\b(morning brief|daily brief|catch up|what did i miss)\b/i,
    ],
    integration: 'gmail',
    chain: [
      { tools: ['search_gmail'],        label: 'Search inbox',            reason: 'Fetch unread / recent emails.' },
      { tools: ['gmail_read_thread'],   label: 'Read priority threads',   reason: 'Read top-tier threads before summarising.' },
    ],
  },

  // ── Compose / send an email to a specific recipient ────────────────────────
  // "send an email to X", "email my customers", "write to maulik@…", "reach out
  // to …". Pure Gmail — NEVER calendar. This plan exists specifically to stop
  // the model speculatively calling get_calendar_events on a send request.
  {
    name: 'compose_send',
    patterns: [
      /\b(send|write|compose|draft|shoot|fire off|reach out to|email|e-mail|message|reply to)\b.{0,40}\b(email|e-mail|note|message)?\b.{0,20}\b(to|my)\b.{0,30}\b(customer|client|contact|investor|team|recipient|[a-z0-9._%+-]+@[a-z0-9.-]+)\b/i,
      /\bemail\b.{0,30}\b(my\s+(customers?|clients?|team|investors?)|[a-z0-9._%+-]+@[a-z0-9.-]+)/i,
      /\b(send|write|draft)\b.{0,20}\b(them|him|her|first one is)\b/i,
    ],
    integration: 'gmail',
    chain: [
      { tools: ['get_recipient_context'], label: 'Gather recipient context', reason: 'Relationship history + prior threads inform the message — no calendar needed.' },
      { tools: ['request_confirmation'],  label: 'Confirm before sending',   isWrite: true, reason: 'Sending is a write action; gated unless skip_confirmations.' },
      { tools: ['send_email'],            label: 'Send the email',           isWrite: true, reason: 'Execute after approval.' },
    ],
  },

  // ── Multi-email: draft replies for all unanswered threads ──────────────────
  {
    name: 'bulk_reply',
    patterns: [
      /\b(all|every|each)\b.{0,30}\b(unanswered|unread|pending)\b.{0,30}\b(email|thread|message)\b/i,
      /\b(draft|reply).{0,40}\b(all|every|each|multiple)\b.{0,20}\b(email|thread)\b/i,
    ],
    integration: 'gmail',
    chain: [
      { tools: ['search_gmail'],        label: 'Search unanswered threads', reason: 'Find all candidate threads.' },
      { tools: ['memory_get_contact_profile', 'get_voice_profile'], label: 'Load context + voice (shared)', parallel: true, reason: 'Voice profile is loaded once and reused across all drafts.' },
      // Subsequent per-thread reads + drafts handled by loop iteration
    ],
  },

  // ── Create Notion page / log something ─────────────────────────────────────
  {
    name: 'notion_create',
    patterns: [
      /\b(create|add|log|save|record|write)\b.{0,40}\b(notion|page|database|entry|task)\b/i,
    ],
    integration: 'notion',
    chain: [
      { tools: ['fetch_notion_schema'], label: 'Read Notion schema',       reason: 'Field names must be exact; executor refuses create_notion_page without a prior schema fetch.' },
      { tools: ['request_confirmation'],label: 'Confirm Notion entry',     isWrite: true, reason: 'Notion creation is gated.' },
      { tools: ['create_notion_page'], label: 'Create the page',           isWrite: true, reason: 'Execute after approval.' },
    ],
  },

  // ── Search Notion ───────────────────────────────────────────────────────────
  {
    name: 'notion_search',
    patterns: [
      /\b(find|search|look.?(up|for)|check)\b.{0,30}\b(notion|note|page)\b/i,
    ],
    integration: 'notion',
    chain: [
      { tools: ['search_notion'],       label: 'Search Notion',           reason: 'Fetch pages matching the query.' },
    ],
  },

  // ── Slack message ───────────────────────────────────────────────────────────
  {
    name: 'slack_message',
    patterns: [
      /\b(send|post|message|ping|dm)\b.{0,30}\b(slack|channel|dm)\b/i,
      /\bslack\b.{0,20}\b(send|post|message|ping)\b/i,
    ],
    integration: 'slack',
    chain: [
      { tools: ['slack_find_user'],     label: 'Resolve Slack user',      reason: 'Real user/channel ID required before sending.' },
      { tools: ['request_confirmation'],label: 'Confirm Slack message',   isWrite: true, reason: 'Channel post is gated.' },
      { tools: ['send_slack_message'],  label: 'Send Slack message',      isWrite: true, reason: 'Execute after approval.' },
    ],
  },

  // ── Web search ──────────────────────────────────────────────────────────────
  {
    name: 'web_search',
    patterns: [
      /\b(search|look up|find|research|check)\b.{0,30}\b(web|internet|online|news|google)\b/i,
      /\b(what is|who is|how (do|does|to)|when (did|was|is))\b/i,
    ],
    integration: null,
    chain: [
      { tools: ['web_search'],          label: 'Web search',              reason: 'Fetch live results.' },
    ],
  },
];

// ── Core builder ──────────────────────────────────────────────────────────────

/**
 * Build a typed execution plan from the user's message and the list of
 * connected integrations.
 *
 * Returns null when the message is a simple conversational exchange that
 * doesn't require tool orchestration (greetings, meta questions, plan mode).
 */
export function buildExecutionPlan(
  userMessage: string,
  connectedIntegrations: string[],
  isPlanMode: boolean = false,
): ExecutionPlan | null {
  if (isPlanMode) return null;

  // Skip short conversational messages
  const msg = userMessage.trim();
  if (msg.length < 8) return null;

  // Detect if this is clearly a question/conversational message with no action
  const conversationalPattern = /^(hi|hello|hey|what|how|who|when|where|why|can you|do you|is|are|tell me|explain|describe|what('?s| is| are)|how (do|does|can|should)|did you)[^.!?]*\??\s*$/i;
  if (conversationalPattern.test(msg) && msg.length < 80) return null;

  const connected = new Set(connectedIntegrations);
  // Normalise notion variants — either is treated as 'notion'
  if (connected.has('notion_calendar')) connected.add('notion');

  const matchedChains: Array<{ name: string; integration: string | null; chain: ChainStep[] }> = [];

  // Collect all matching intent patterns (a message can match multiple)
  for (const intent of INTENT_PATTERNS) {
    const matches = intent.patterns.some(p => p.test(msg));
    if (!matches) continue;

    // If this chain requires an integration the user doesn't have, record it
    // but still add the chain so it shows up as unavailable in the plan.
    matchedChains.push({ name: intent.name, integration: intent.integration, chain: intent.chain });
  }

  if (matchedChains.length === 0) return null;

  // Deduplicate: "reply_and_book" supersedes "reply_email" + "book_meeting" separately
  const hasReplyAndBook = matchedChains.some(m => m.name === 'reply_and_book');
  const filtered = hasReplyAndBook
    ? matchedChains.filter(m => m.name !== 'reply_email' && m.name !== 'book_meeting')
    : matchedChains;

  // Build flat step list from all matched chains, deduplicating by tool name
  const allSteps: PlanStep[] = [];
  const seenTools = new Set<string>();

  for (const { name: _name, integration, chain } of filtered) {
    for (const cs of chain) {
      // Deduplicate: don't add the same tool twice (e.g. voice_profile from two chains)
      const newTools = cs.tools.filter(t => !seenTools.has(t));
      if (newTools.length === 0) continue;
      for (const t of newTools) seenTools.add(t);

      allSteps.push({
        label: cs.label,
        tools: newTools,
        parallel: cs.parallel ?? (newTools.length > 1),
        dependsOn: [],           // filled in below
        requiredIntegration: cs.requiredIntegration !== undefined ? cs.requiredIntegration : integration,
        isWrite: cs.isWrite ?? newTools.some(t => WRITE_TOOLS.has(t)),
        reason: cs.reason,
      });
    }
  }

  if (allSteps.length === 0) return null;

  // Build dependsOn index: for each step, find the last step that ran a prerequisite tool
  for (let i = 0; i < allSteps.length; i++) {
    const deps = new Set<number>();
    for (const tool of allSteps[i].tools) {
      const prereqs = PREREQUISITES[tool] ?? [];
      for (const prereq of prereqs) {
        // Find the most-recent step that includes this prerequisite
        for (let j = i - 1; j >= 0; j--) {
          if (allSteps[j].tools.includes(prereq)) {
            deps.add(j);
            break;
          }
        }
      }
    }
    // Also: every step depends on the immediately preceding step by default
    // (unless that step is purely parallel reads that don't affect us)
    if (i > 0 && deps.size === 0) {
      deps.add(i - 1);
    }
    allSteps[i].dependsOn = [...deps];
  }

  // Validate: collect missing integrations
  const missingIntegrations = [...new Set(
    allSteps
      .filter(s => s.requiredIntegration && !connected.has(s.requiredIntegration))
      .map(s => s.requiredIntegration as string)
  )];

  // Estimate tool call count
  const totalTools = allSteps.reduce((n, s) => n + s.tools.length, 0);
  const parallelSteps = allSteps.filter(s => s.parallel && s.tools.length > 1);
  const savedByParallel = parallelSteps.reduce((n, s) => n + s.tools.length - 1, 0);

  const intent = inferIntentSummary(msg, filtered.map(f => f.name));

  return {
    intent,
    steps: allSteps,
    missingIntegrations,
    requiresConfirmation: allSteps.some(s => s.isWrite),
    estimatedCalls: {
      min: Math.max(1, totalTools - savedByParallel),
      max: totalTools,
    },
  };
}

// ── Intent summary ─────────────────────────────────────────────────────────────

function inferIntentSummary(msg: string, intentNames: string[]): string {
  if (intentNames.includes('reply_and_book')) return 'Draft a reply and book a meeting';
  if (intentNames.includes('bulk_reply')) return 'Draft replies for multiple email threads';
  if (intentNames.includes('reply_email') && intentNames.includes('book_meeting')) return 'Reply to email and schedule a meeting';
  if (intentNames.includes('reply_email')) return 'Reply to an email';
  if (intentNames.includes('book_meeting')) return 'Schedule a meeting';
  if (intentNames.includes('inbox_triage')) return 'Triage inbox';
  if (intentNames.includes('notion_create')) return 'Create a Notion entry';
  if (intentNames.includes('slack_message')) return 'Send a Slack message';
  if (intentNames.includes('web_search')) return 'Search the web';
  // Fallback: use the first 60 chars of the message
  return msg.slice(0, 60) + (msg.length > 60 ? '…' : '');
}

// ── Plan → LLM hint ───────────────────────────────────────────────────────────

/**
 * Serialize the ExecutionPlan into a concise system-message hint block.
 * Injected as the last user message before the first LLM call so the model
 * always sees the intended sequence and can't re-order it arbitrarily.
 */
export function planToHint(plan: ExecutionPlan, budgetLeft: number): string {
  const lines: string[] = [
    '[ORCHESTRATION PLAN — follow this sequence exactly]',
    `Intent: ${plan.intent}`,
    `Estimated tool calls: ${plan.estimatedCalls.min}–${plan.estimatedCalls.max} | Budget remaining: ${budgetLeft}`,
    '',
    'Steps (execute in this order):',
  ];

  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    const depStr = s.dependsOn.length > 0 ? ` (after step ${s.dependsOn.map(d => d + 1).join(',')})` : '';
    const parallelStr = s.parallel && s.tools.length > 1 ? ' [PARALLEL]' : '';
    const writeStr = s.isWrite ? ' [WRITE — gate required]' : '';
    const unavailableStr = s.requiredIntegration && plan.missingIntegrations.includes(s.requiredIntegration)
      ? ` [UNAVAILABLE — ${s.requiredIntegration} not connected]`
      : '';
    lines.push(`  ${i + 1}. ${s.label}${depStr}${parallelStr}${writeStr}${unavailableStr}`);
    lines.push(`     Tools: ${s.tools.join(', ')}`);
    lines.push(`     Why: ${s.reason}`);
  }

  if (plan.missingIntegrations.length > 0) {
    lines.push('');
    lines.push(`Missing integrations: ${plan.missingIntegrations.join(', ')} — skip those steps and tell the user.`);
  }

  if (plan.requiresConfirmation) {
    lines.push('');
    lines.push('This plan contains write actions. Call request_confirmation before any write step.');
  }

  lines.push('');
  lines.push('CRITICAL: Do not call tools outside this plan. Do not re-order steps. Start with step 1 immediately — no plan paragraph, no narration.');

  return lines.join('\n');
}

// ── Prerequisite checker (used by executeTool) ────────────────────────────────

/**
 * Check whether the required prerequisites for a tool have already run
 * successfully in this loop turn.
 *
 * Returns null if the tool can proceed, or a human-readable error string
 * the executor should surface as a soft-failure if the gate fires.
 *
 * NOTE: This is advisory in non-strict mode — the loop already has hard
 * prerequisites in tools.ts (draft_reply refusing without read_email).
 * This function provides an earlier, more descriptive failure.
 */
export function checkPrerequisites(
  toolName: string,
  completedTools: string[],
): string | null {
  const prereqs = PREREQUISITES[toolName];
  if (!prereqs || prereqs.length === 0) return null;

  const hasPrereq = prereqs.some(p => completedTools.includes(p));
  if (hasPrereq) return null;

  const prereqList = prereqs.join(' or ');
  return (
    `[ORCHESTRATION] ${toolName} requires ${prereqList} to have run first. ` +
    `Run ${prereqList} and use its output before calling ${toolName}.`
  );
}

// ── Parallel branch detector ───────────────────────────────────────────────────

/**
 * Given the set of tools the LLM wants to call in one turn, returns
 * the subset that can safely run in parallel (their outputs are independent
 * and their side effects don't conflict).
 *
 * This is advisory — the loop already runs all same-turn tool calls in
 * parallel. This function is exported for the orchestration hint and for
 * future loop optimizations.
 */
export function detectParallelBranches(tools: string[]): string[][] {
  const readTools = tools.filter(t => READ_ONLY_TOOLS.has(t));
  const writeTools = tools.filter(t => WRITE_TOOLS.has(t));

  const branches: string[][] = [];

  // Read-only tools with no shared input dependency can always run in parallel
  if (readTools.length > 1) branches.push(readTools);

  // Write tools should never run in parallel (ordering matters for confirmation)
  for (const w of writeTools) branches.push([w]);

  return branches;
}
