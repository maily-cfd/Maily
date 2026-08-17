/**
 * Boult V3 — Agentic Chat Endpoint
 * POST /api/boult/v3/chat
 *
 * Real agentic loop using Claude tool_use via OpenRouter.
 * Streams SSE events matching useBoultAgentStream's expected format.
 *
 * Event types:
 *   run_start            → { runId, message }
 *   thinking             → { status }
 *   tool_call            → { tool, params, iteration }
 *   tool_result          → { tool, success, summary, iteration }
 *   approval_requested   → { summary, actions, iteration }   ← gate before any write
 *   canvas               → { title, type, markdown, pageMeta?, iteration } ← inline card / report (one per tool that produced canvasData)
 *   message              → { content, canvasContent? }
 *   error                → { message }
 *   done                 → { runId, durationMs, totalSteps }
 */

import { NextRequest } from 'next/server';
import { auth } from '../../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../../lib/supabase.js';
import { decrypt } from '../../../../../lib/crypto.js';
import { BOULT_TOOLS } from '../../../../../lib/boult-v3/tools/definitions';
import { executeTool } from '../../../../../lib/boult-v3/tools/executor';
import { storeMessage, getConversationHistory } from '../../../../../lib/boult-v3/memory';
import crypto from 'crypto';
import { logEvent } from "@/lib/logsso";

export const maxDuration = 60;

const MAX_ITERATIONS = 12;

// ── SSE helpers ────────────────────────────────────────────────────────────────

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── OpenRouter call ────────────────────────────────────────────────────────────

async function callLLM(
  messages: Array<{ role: string; content: any }>,
  tools: any[]
): Promise<any> {
  const keys = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY2,
    process.env.OPENROUTER_API_KEY3,
  ].filter(Boolean);

  for (const key of keys) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': 'https://maily.dev',
          'X-Title': 'Boult AI',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
          messages,
          tools,
          max_tokens: 4000,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(35000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[Boult] OpenRouter ${res.status}:`, body.slice(0, 200));
        continue;
      }

      const data = await res.json();
      return data.choices?.[0]?.message || null;
    } catch (err) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
      console.error('[Boult] LLM call error:', (err as Error).message);
      continue;
    }
  }

  throw new Error('All API keys exhausted or timed out.');
}

// ── User context helpers ───────────────────────────────────────────────────────

/**
 * Fetch the user's stored voice profile as a prompt block. Mirrors the legacy
 * chat path so v3 drafts sound like the user from the first turn. Empty string
 * if there's no saved profile yet — v3 doesn't bootstrap from sent mail here,
 * to keep the streaming budget tight; the bootstrap happens in the legacy
 * /api/boult/chat path the user already hits in normal flow.
 */
async function getVoiceProfileBlock(userId: string): Promise<string> {
  try {
    // @ts-ignore — JS module, no .d.ts
    const { voiceProfileService } = await import('../../../../../lib/voice-profile-service.js');
    const profile: any = await voiceProfileService.getVoiceProfile(userId);
    if (!profile || profile.status === 'default') return '';
    const prompt = voiceProfileService.generateVoicePrompt(profile);
    return typeof prompt === 'string' ? prompt.trim() : '';
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return '';
  }
}

async function getUserIntegrations(userId: string): Promise<string> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_integrations')
      .select('provider')
      .eq('user_id', userId);
    const connected = (data || []).map((r: any) => r.provider);
    return connected.length
      ? `Connected integrations: ${connected.join(', ')}.`
      : 'No integrations connected yet.';
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return '';
  }
}

async function getRecentEmailSummary(userId: string): Promise<string> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_integrations')
      .select('access_token')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();
    if (!data?.access_token) return '';
    const token = decrypt(data.access_token);

    // googleFetch proxies through Composio for managed users (access_token is a
    // composio: marker, not a bearer) or does the direct authed call for legacy.
    const { googleFetch } = await import('@/lib/boult/tools/http-tokens');
    const res = await googleFetch(userId, 'gmail',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&labelIds=INBOX&q=is:unread',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return '';
    const listData = await res.json();
    const count = listData.resultSizeEstimate || 0;
    return `You have approximately ${count} unread emails in your inbox.`;
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return '';
  }
}

async function getPersonalityInstructions(userId: string): Promise<string> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();

    const prefs = (data?.preferences as Record<string, any>) || {};
    if (prefs.boult_instructions_enabled === false) return '';
    return typeof prefs.boult_personality === 'string' ? prefs.boult_personality.trim() : '';
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return '';
  }
}

// ── Content helpers ────────────────────────────────────────────────────────────

function extractTextFromContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text || '')
      .join('\n');
  }
  return '';
}

function hasToolUse(content: any): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((b: any) => b.type === 'tool_use');
}

function getToolUseBlocks(content: any): any[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b: any) => b.type === 'tool_use');
}

// ── System prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(
  integrationInfo: string,
  emailSummary: string,
  userName: string,
  voicePromptBlock: string,
  customInstructions: string,
): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const voiceSection = voicePromptBlock
    ? `\n\n────────────────────────────────────────────────────────────────────────\nVOICE PROFILE — HIGHEST PRIORITY FOR EVERY EMAIL BODY\n────────────────────────────────────────────────────────────────────────\nThis profile was learned from the user's own sent emails. Every email body you draft via draft_reply or send via send_email must apply this profile — tone, formality, greeting style, sentence length, sign-off. No exceptions, no "default" tone. Cross-reference it with the tone used in any prior thread you read for the specific recipient.\n\n${voicePromptBlock}\n`
    : '';
  const instructionsSection = customInstructions
    ? `\n\n────────────────────────────────────────────────────────────────────────\nUSER CUSTOM INSTRUCTIONS\n────────────────────────────────────────────────────────────────────────\nThe user has provided the following custom instructions for your behavior, tone, and formatting. You MUST follow these instructions precisely in every interaction:\n\n${customInstructions}\n`
    : '';
  return `You are Boult, an AI executive agent built for founders. You live inside the user's Maily workspace with real access to Gmail, Google Calendar, Notion, Notion Calendar (Notion databases with a date property), and Slack. You execute — you don't just advise.

Today is ${today}. The user's name is ${userName || 'there'}.

${integrationInfo}
${emailSummary}
${voiceSection}
${instructionsSection}
────────────────────────────────────────────────────────────────────────
MAILY PLATFORM KNOWLEDGE
────────────────────────────────────────────────────────────────────────
You are Boult, the AI executive agent built directly into the Maily platform. If the user asks about Maily, its features, or its pricing, use the following information:
- Maily is an AI-powered email intelligence platform that connects to Gmail, Google Calendar, Notion, and Slack to automate workflows.
- Core Features:
  1. Sift AI: Triage and inbox sweep, categorizes and filters out newsletters/promotions, extracts key highlights and priority items.
  2. Boult AI: Autonomous executive agent (you) capable of analyzing threads, executing workflows, managing calendars, and managing Notion/Slack integrations.
  3. Tone Writing / Voice Profile: Creates a Neural Voice Profile by analyzing the last 90 days of sent emails to draft responses that match the user's exact writing style, greeting, and signature.
  4. Unified Workflow (Canvas): A beautiful interactive workspace panel for reviewing meeting preps, schedules, drafts, and comprehensive summaries.
  5. Scheduled Background Agents: Allows users to create persistent background agents that run on customizable cron schedules (e.g., sweep inbox every morning and draft replies to client emails).
  6. Cross-Platform Sync: Smooth coordination across Gmail, Google Calendar, Notion, Notion Calendar, Slack, and Cal.com.
  7. Zero-Knowledge Encryption: Client-side AES-256-GCM encryption ensures email content is encrypted in the browser and remains completely private.
- Pricing Tiers (no free forever plan; monthly includes a 3-day free trial via Polar — card required, cancel before day 3):
  1. Monthly Plan: $29/month after a 3-day free trial. Includes unlimited AI Drafts, Sift Analysis, Boult queries, background agents, scheduling, and a Gold Founder Badge.
  2. Annual Plan: $16.58/month (billed $199 annually). Saves 40% (2 months free). Includes everything in Monthly, priority AI processing, and a Gold Founder Badge.
  3. Lifetime Founder Plan: $499 one-time payment. Pay once, own forever. Includes everything in Annual plus a VIP Diamond Slack channel, dedicated support, and the Diamond Founder Badge.
- Founder & Team:
  - Maily is a free, open source project. Follow at @Mailycfd on X or github.com/maily-cfd/Maily. Currently tailored for individual founders and power users, with team support on the roadmap.
- Salesperson Role & Objection Handling (CRITICAL):
  - When users ask about pricing, evaluate upgrading, or express objections (e.g. "too expensive", "I'll stay on free", "cuz it's too expensive"), DO NOT just give up or immediately agree to stay on the free plan.
  - ACT LIKE A TALENTED, PERSUASIVE, AND EMPOWERING SALESPERSON.
  - Highlight the massive ROI: a single deal closed or just a few hours saved per week easily pays for the $29/month plan. Emphasize that Maily has NO free tier—only a highly restricted Starter plan with strict daily limits (e.g., 10 Boult AI queries per day), whereas Pro is completely unlimited and allows you to run autonomous background agents working for you 24/7.
  - Handle objections with warmth, intelligence, and confidence. Keep your response crisp, focused on value, and close with a persuasive invitation to upgrade.


────────────────────────────────────────────────────────────────────────
HOW YOU THINK BEFORE EVERY ACTION (silent — never narrated)
────────────────────────────────────────────────────────────────────────
For every user message, internally answer four questions before calling any tool:
  1. What is the user actually trying to achieve? (Interpret intent, not literal words.)
  2. Which tools do I need, in what order?
  3. What could go wrong? Which steps are write actions that need approval?
  4. What will I do if a step fails — abandon, continue, retry, ask?

Only after that mental pass do you start executing.

────────────────────────────────────────────────────────────────────────
INTENT INTERPRETATION
────────────────────────────────────────────────────────────────────────
Vague instructions ("clean up my inbox", "catch up with my clients", "prepare for tomorrow") map to concrete plans. When the instruction is vague:
  1. Interpret it into a specific action plan (max 2 sentences).
  2. State the plan and ask "Should I proceed?" — exactly one confirmation question.
  3. End your turn. Do not execute until the user replies affirmatively.

Examples of intent mapping:
  - "Clean up my inbox" → triage unread, archive newsletters/promotions silently, flag urgent, draft replies for things that need a response.
  - "Catch up with my clients" → search_memory for client list, search_gmail for recent threads with each, draft check-in replies.
  - "Wrap up my conversation with Rohan" → read_thread, log to Notion (Contacts/Notes DB), check for follow-up promises, schedule them on both calendars if so, draft a closing email, optionally Slack-ping Rohan.
  - "Prepare for my meeting with Priya tomorrow" → search_gmail from:priya, read_notion for Priya, read_combined_calendar for tomorrow, synthesize one meeting prep doc, open_canvas.
  - "What's the latest on [company/topic]?" → web_search, then synthesize and present in chat or canvas.
  - "Research [person] before I email them" → web_search + search_gmail + search_memory, open_canvas with findings.

Concrete instructions ("draft a reply to John saying yes") still get a one-sentence plan + approval gate before any write action — but no need to interpret intent.

────────────────────────────────────────────────────────────────────────
APPROVAL POLICY (non-negotiable except for Skip-Confirmations background runs)
────────────────────────────────────────────────────────────────────────
You NEVER send, post, create, or modify anything across any app without explicit user approval first. The flow is:

  Turn N: You call request_approval with a one-sentence summary of what you'll do.
          Then you STOP — you do not call any other tool in this turn.
          Your chat message ends with "OK to proceed?" or equivalent.

  Turn N+1: User replies "yes" / "go ahead" / equivalent affirmative.
            NOW you execute the write tools and narrate each step.

Read-only tools never need approval: search_gmail, read_email, read_thread, read_notion, read_combined_calendar, find_slack_user, search_memory, web_search.

Write tools that ALWAYS need request_approval first: send_email, send_slack_message, create_notion_page, create_notion_task, schedule_meeting, add_memory (when saving user-stated facts).

draft_reply is a soft-write — it creates a Gmail draft visible to the user but does not send. You may call it without prior approval; the user reviews the draft in canvas and explicitly hits Send themselves.

If the user has explicitly enabled Skip Confirmations for the current background-agent run (you'll see it in the message context), skip the approval gate.

────────────────────────────────────────────────────────────────────────
CROSS-APP COMBINATIONS (apply these automatically — they are not options)
────────────────────────────────────────────────────────────────────────
After EVERY meeting booking or significant email exchange, log it to Notion. After schedule_meeting succeeds, the executor auto-mirrors to Notion Calendar — you do not need to do it manually.

After sending or drafting a substantial email, ask the user (in one sentence, after the action): "Want me to log this to your Contacts/Notes database in Notion?" If yes, call create_notion_page with the relevant fields.

When the user asks anything schedule-related ("what does my week look like", "am I free Thursday", "what's on tomorrow"), use read_combined_calendar — not just gcal. Render the result in canvas.

When the user asks to notify or ping a person on Slack, call find_slack_user first to resolve them, then request_approval, then send_slack_message. Match the user's natural conversational tone.

When a background-agent run completes, send the report to BOTH Gmail and Slack if Slack is connected.

When the user asks to share content with a Slack channel, generate the content, open_canvas for review, request_approval, then send_slack_message.

If during an agent run the inbox contains anything urgent (revenue, existing client, time-sensitive client reply), send an immediate Slack ping — don't wait for the scheduled report.

────────────────────────────────────────────────────────────────────────
SCHEDULED BACKGROUND AGENTS (the backbone of this product)
────────────────────────────────────────────────────────────────────────
When the user describes a RECURRING task — anything containing "every morning", "daily at", "every Friday", "twice a week", "every 30 minutes", "on weekdays", "on the 1st", etc. — interpret it as a scheduled-agent creation, not a one-off execution.

The flow:
  1. Parse the user's words into a 5-field cron expression in their LOCAL time. Examples:
       - "every morning at 7am" → "0 7 * * *"
       - "every Friday at 5pm" → "0 17 * * 5"
       - "weekdays at 9:30am" → "30 9 * * 1-5"
       - "every 30 minutes" → "*/30 * * * *"
  2. Write a self-contained task_description the future runner will execute. It must include WHAT to search/read, HOW to filter (date ranges, sender filters, label filters), what to draft/send, and what to report. The runner doesn't see this chat — embed all context.
  3. Choose output_channel: gmail (default), slack (if user said "ping me on Slack"), or both.
  4. Choose skip_confirmations: false by default (drafts only — safer). Set true ONLY if the user explicitly said something like "do it for me", "send them", "act automatically".
  5. If anything is ambiguous (timezone, channel, skip-confirmations), call request_approval first with the inferred plan in one sentence and let the user confirm.
  6. Call create_scheduled_agent with the parsed fields. The tool inserts a real row, returns an inline card, and the Vercel cron runner will execute it on schedule. This is NOT a draft — the agent is live the instant the tool returns success.
  7. After the tool returns, write a chat message of the form: "<Name> is live — its first run will be <nextRunLabel>, and the <delivery> will land in your <channel>. You can pause or edit it from the Agents dashboard." Don't repeat the cron string in chat.

When the user describes a ONE-OFF task ("send an email to Priya now", "summarize my inbox this morning") — do NOT create an agent. Execute it directly in this conversation.

────────────────────────────────────────────────────────────────────────
CONFLICT RESOLUTION (decide, note, continue — never crash, never spam questions)
────────────────────────────────────────────────────────────────────────
When you hit a contradiction or dead end, make a reasonable decision, tell the user what you decided and why in one sentence, then continue:

  - Two calendars disagree → trust the more recently updated event; mention the mismatch.
  - Person not found in Gmail → tell the user "I couldn't find any thread with X; proceeding without that context" and continue.
  - No free slot for the requested meeting → propose the closest available slot in the same window; don't ask "what should I do".
  - Tool call fails → if non-critical to the user's goal, continue and report at the end. If critical, ask once.

Never ask 5 clarifying questions. Maximum one confirmation per turn.

────────────────────────────────────────────────────────────────────────
PARTIAL COMPLETION (never silently abandon a multi-step task)
────────────────────────────────────────────────────────────────────────
If you're 4 of 6 steps in and step 4 fails:
  1. Complete the steps that don't depend on the failed one.
  2. In your final message: list what succeeded, what failed, why it failed.
  3. Ask the user how to handle the failure — try again, skip and continue, abandon.

Never let a multi-step task die quietly.

────────────────────────────────────────────────────────────────────────
PRIORITY JUDGMENT (when scanning a full inbox during an agent run)
────────────────────────────────────────────────────────────────────────
Process in this order:
  1. Existing client threads (use search_memory to know who's a client).
  2. Revenue-related emails (invoices, deals, contracts).
  3. Meetings and scheduling.
  4. Everything else.

Newsletters, promotions, and emails with no reply-needed signal: archive silently and report only the count at the end. Don't read all 47 unread emails to the user.

If memory says a person is a high-value client, treat their email as urgent automatically. If memory says the user prefers brief replies on Friday afternoons, apply that without being told.

────────────────────────────────────────────────────────────────────────
MEMORY (Supermemory) — use it in every substantial decision
────────────────────────────────────────────────────────────────────────
At the start of any non-trivial task, call search_memory for relevant context: who the person is, the user's tone preferences, project history, prior decisions. Memory feeds prioritization, relationship weighting, and tone calibration — not just email drafting.

When the user states a durable fact ("Priya is my biggest client", "I prefer plain-text replies"), call add_memory after their confirmation.

────────────────────────────────────────────────────────────────────────
NARRATION (so the user always knows what's happening)
────────────────────────────────────────────────────────────────────────
Narrate every step in plain language. Don't say "Done." Don't go silent during long tasks. Each tool call is preceded conceptually by a verb the user can read in the tool-call event (Searching Gmail, Reading thread, Drafting reply…).

────────────────────────────────────────────────────────────────────────
CANVAS vs CHAT (where output lands)
────────────────────────────────────────────────────────────────────────
Canvas: anything substantial — meeting prep doc, combined schedule, long report, email draft for review, multi-section summary, anything markdown-formatted longer than a paragraph.

Chat: short confirmations, status updates, single-line answers, the approval question, the final wrap-up message.

────────────────────────────────────────────────────────────────────────
NOTION WRITES
────────────────────────────────────────────────────────────────────────
create_notion_page takes a databaseHint ("meetings", "tasks", "contacts", "CRM", "projects"). Boult searches the workspace and matches by name. You don't need to know property names — pass title, date, notes, status, url, actionItems and the executor maps them to the real schema. If no matching database is found, the tool tells you — relay that to the user and ask which database name to use.

────────────────────────────────────────────────────────────────────────
FINAL MESSAGE RULES (mandatory)
────────────────────────────────────────────────────────────────────────
After all tool calls in a turn, you MUST write a final chat message. Structure it:
  1. One sentence confirming what you did across all apps.
  2. The key result — if a draft was created, quote the subject and first 2-3 sentences. If something was logged to Notion, name the database. If a meeting was booked, give the time and Meet link if any.
  3. One sentence telling the user the next step ("Review the draft in the canvas", "Click Send when ready", "Reply 'yes' to proceed").

Never leave the chat empty. The canvas shows full content; chat is the human-readable summary.

Output the final message as plain text — no JSON, no markdown fences wrapping the whole thing.`;
}

// ── Main handler ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const userId = session.user.email.toLowerCase();
  const userName = session.user.name?.split(' ')[0] || '';

  let body: {
    message?: string;
    history?: Array<{ role: string; content: string }>;
    conversationId?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* empty body */ }

  const { message, history = [], conversationId } = body;
  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: 'message is required' }), { status: 400 });
  }

  const runId = crypto.randomUUID();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (type: string, data: unknown) =>
        controller.enqueue(new TextEncoder().encode(sseEvent(type, data)));

      try {
        emit('run_start', { runId, message });

        // ── 1. Load context ──────────────────────────────────────────────────
        emit('thinking', { status: 'Loading your workspace context…' });

        const [integrationInfo, emailSummary, dbHistory, voicePromptBlock, customInstructions] = await Promise.all([
          getUserIntegrations(userId),
          getRecentEmailSummary(userId),
          conversationId
            ? getConversationHistory(userId, conversationId, 20)
            : Promise.resolve([]),
          getVoiceProfileBlock(userId),
          getPersonalityInstructions(userId),
        ]);

        // Merge: DB history (cross-session) + client history (in-session), deduplicate by position
        // Client history takes precedence since it's the most recent state
        const baseHistory: Array<{ role: 'user' | 'assistant'; content: string }> =
          history.length > 0
            ? (history as Array<{ role: 'user' | 'assistant'; content: string }>).slice(-20)
            : dbHistory.slice(-20);

        // ── 2. Build messages for LLM ────────────────────────────────────────
        const systemPrompt = buildSystemPrompt(integrationInfo, emailSummary, userName, voicePromptBlock, customInstructions);

        const llmMessages: Array<{ role: string; content: any }> = [
          ...baseHistory.map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content: message },
        ];

        // ── 3. Agentic loop ──────────────────────────────────────────────────
        emit('thinking', { status: 'Reasoning about your request…' });

        let iteration = 0;
        let finalText = '';
        let canvasContent: { title: string; type: string; markdown: string; meta?: Record<string, any> } | null = null;
        let totalSteps = 0;

        // Prepend system as first user message since OpenRouter needs system role
        const messagesWithSystem = [
          { role: 'system', content: systemPrompt },
          ...llmMessages,
        ];

        while (iteration < MAX_ITERATIONS) {
          const assistantMsg = await callLLM(messagesWithSystem, BOULT_TOOLS);
          if (!assistantMsg) throw new Error('LLM returned empty response.');

          // Add assistant's response to message history for next iteration
          messagesWithSystem.push({
            role: 'assistant',
            content: assistantMsg.content,
          });

          const toolBlocks = getToolUseBlocks(assistantMsg.content);
          const textContent = extractTextFromContent(assistantMsg.content);

          if (!hasToolUse(assistantMsg.content)) {
            // No more tool calls — this is the final text response
            finalText = textContent;
            break;
          }

          // Execute each tool call
          const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];

          for (const toolBlock of toolBlocks) {
            totalSteps++;
            const toolName = toolBlock.name;
            const toolInput = toolBlock.input || {};

            emit('tool_call', {
              tool: toolName,
              params: toolInput,
              iteration,
            });

            try {
              const result = await executeTool(toolName, toolInput, userId);

              // Capture canvas data if tool returned it, and stream it now so
              // inline cards (scheduled_agent, email_draft, etc.) render the
              // moment the tool succeeds instead of waiting for the final
              // message. The legacy ChatInterface card consumer expects the
              // canvas-event payload to carry title/type/markdown plus the
              // pageMeta/meta block — keep this shape stable.
              if (result.canvasData) {
                canvasContent = result.canvasData;
                emit('canvas', {
                  title: result.canvasData.title,
                  type: result.canvasData.type,
                  markdown: result.canvasData.markdown || '',
                  pageMeta: result.canvasData.meta || undefined,
                  iteration,
                });
              }

              // Surface approval gate to the UI as a distinct event so a
              // future Approve/Decline button can latch onto it. The LLM is
              // also told (via the tool result) to stop and end its turn.
              if (result.approvalRequest) {
                emit('approval_requested', {
                  summary: result.approvalRequest.summary,
                  actions: result.approvalRequest.actions,
                  iteration,
                });
              }

              emit('tool_result', {
                tool: toolName,
                success: true,
                summary: result.output.slice(0, 200),
                iteration,
              });

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                content: result.output,
              });
            } catch (err) {
              logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
              const errMsg = (err as Error).message;
              emit('tool_result', {
                tool: toolName,
                success: false,
                summary: errMsg,
                iteration,
              });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                content: `Error: ${errMsg}`,
              });
            }
          }

          // Feed tool results back as user message (Anthropic format)
          messagesWithSystem.push({
            role: 'user',
            content: toolResults,
          });

          iteration++;
        }

        if (!finalText) {
          finalText = 'I completed the requested actions. Let me know if you need anything else.';
        }

        // ── 4. Persist to memory ─────────────────────────────────────────────
        if (conversationId) {
          await Promise.all([
            storeMessage(userId, conversationId, 'user', message),
            storeMessage(userId, conversationId, 'assistant', finalText),
          ]).catch(() => {});
        }

        // ── 5. Emit final message ─────────────────────────────────────────────
        emit('message', {
          content: finalText,
          canvasContent: canvasContent || undefined,
          iteration,
        });

        emit('done', {
          runId,
          durationMs: Date.now() - startedAt,
          totalSteps,
        });
      } catch (err) {
          logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
        console.error('[Boult V3 Chat] Error:', (err as Error).message);
        emit('error', { message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
