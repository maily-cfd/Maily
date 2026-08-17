/**
 * Shared agent execution — runs a single Boult background agent's task
 * through the agentic loop and returns the final report text.
 *
 * Used by:
 *   - GET  /api/cron/run-agents        (scheduled runs)
 *   - POST /api/boult/agents/run       ("Run now" from the agent card)
 */

import { runAgentLoop } from './loop';
import { buildSystemPrompt, getConnectedIntegrations } from './system-prompt';
import { searchMemories, saveMemory } from './memory';
// Super-agent foundation — load context so a run never starts from zero.
import { listOpen, bucketByDue } from './super/ledger';
import { compileMission, renderMission, type Mission } from './super/mission';
// PART 48 — Multi-VA committee orchestrator. runAgentTask now routes through
// runAgentAsCommittee by default; the legacy single-LLM path stays available
// behind an env-var kill switch so we can disable in prod without redeploying.
import { runAgentAsCommittee } from './multi-va/orchestrator';

/**
 * Fetch the user's stored voice profile as a system-prompt block, so background
 * agents draft email in the user's actual voice. Mirrors getVoiceContext() from
 * app/api/boult/chat/route.ts but trimmed for the background case: we don't
 * bootstrap-from-sent-mail here (the chat path does that on first interactive
 * use; if it has never been built, we fall back to the legacy persona prompt
 * rules instead of stalling a cron run on a 22-second Gmail analysis).
 */
async function getVoiceProfilePromptBlock(userId: string): Promise<string> {
  try {
    // @ts-ignore — JS module, no .d.ts
    const { voiceProfileService } = await import('../voice-profile-service.js');
    const profile: any = await voiceProfileService.getVoiceProfile(userId);
    if (!profile || profile.status === 'default') return '';
    const prompt = voiceProfileService.generateVoicePrompt(profile);
    return typeof prompt === 'string' ? prompt.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Fetch the user's free-text "Boult AI Instructions" from user_profiles.
 * Returns empty string when:
 *   - the user hasn't saved any instructions
 *   - the user has explicitly toggled instructions OFF
 *   - any error occurs (we don't want to fail an agent run on a profile lookup)
 *
 * Background-agent runs use this so saved rules ("always cc legal@",
 * "never schedule weekends", "use bullet points") apply to autonomous work
 * just like they do to interactive chat.
 */
async function fetchUserInstructions(userId: string): Promise<string> {
  try {
    // @ts-ignore — JS module
    const { getSupabaseAdmin } = await import('../supabase.js');
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();
    const prefs = (data?.preferences as Record<string, unknown>) || {};
    if (prefs.boult_instructions_enabled === false) return '';
    const text = (prefs.boult_personality as string) || '';
    return typeof text === 'string' ? text.trim() : '';
  } catch {
    return '';
  }
}

// Prepended to every background run. Turns the agent from a shallow scanner into
// a senior executive assistant that FINISHES coherent jobs and never claims work
// it didn't verify. This is the behavioral core of the super-agent.
export const SUPER_AGENT_DIRECTIVE = `You are Boult operating as the user's senior executive assistant on a background run — the calibre of a top-tier $3,000/mo chief of staff. Hold yourself to that bar.

HOW YOU WORK:
1. PLAN before acting. Read the task, then think through the complete job — every step needed to truly finish it, not just a surface scan.
2. FINISH the whole job, end to end. Do not stop halfway. If a task has multiple steps that depend on each other, do them in order in this one run:
   • Meeting / call request → read the full thread; check the user's REAL availability (calendar_get_availability and/or Cal.com calcom_get_slots); draft a reply in the user's voice proposing 2–3 specific open times; if the user clearly wants it booked, create the event/booking and include the join link; then surface it for approval.
   • Reply needed → actually draft it with draft_reply (which returns a real draft link). Don't say "drafted" unless the tool returned a draft.
   • Follow-up / stalled item → draft the nudge.
3. USE THE RIGHT TOOLS. You have the full arsenal (Gmail, Calendar, Cal.com, Notion, Slack, memory, web). Prefer batch tools for volume. Pull context (get_recipient_context, memory) so replies are personal, not generic.
4. VERIFY EVERY CLAIM. Only state you did something if the tool actually returned success + an artifact (a draft link, an event link, a booking id). If a tool failed or returned no link, say so plainly and put the item under "Needs Your Attention" — never imply completion you can't prove.
5. BE THOROUGH, NOT TERSE. A real EA gives the full picture: who, what, the proposed times, the draft link, what's still open. Never pad with filler ("let me know if you want me to summarize", tool-call counts) — but never leave the user with a thin, incomplete summary either. Substance over brevity.
6. SURFACE WHAT NEEDS THEM. Anything requiring a human decision — a meeting request you couldn't fully book, a draft awaiting send, a judgement call — goes in "Needs Your Attention" with the link. This section is the most important part of the report; it must reflect reality.
7. TRIAGE RUTHLESSLY — the user's attention is the scarcest thing you protect. Out of everything you swept, only a handful genuinely needs a human today. Lead with those — named, specific, each with the concrete ask ("Ramp: $79 Prosp transaction needs a memo and receipt", "Adam requested your review on PR #3398"). Everything else is NOISE: name it, dismiss it in one line with WHY it's noise, and move on. Never make the user wade through 30 items to find the 3 that matter.
8. CROSS-REFERENCE EVERYTHING. Use memory + prior runs so you never resurface what you (or they) already handled or already flagged. When something repeats a known pattern, SAY SO — "5 Sentry alerts, same race-condition you already flagged to Adam" beats listing 5 alerts. Catch what a sharp human would: a bounced email from a domain typo, a deal going quiet, a 100%-failure pipeline. That specificity is the whole product.
9. CLOSE WITH AN OFFER, NOT A FULL STOP. End by offering the obvious next move as a one-tap action — "want me to archive that noise or handle any of the action items?" — so the user can act by simply replying, never by re-explaining context you already have.

MEMORY & FOLLOW-THROUGH — this is what makes you a senior operator, not a junior:
- START by handling anything in "OPEN COMMITMENTS DUE NOW" above. If none were injected, call ledger_list_due to be sure. Overdue items are your first priority, before new work. Close each with ledger_close_commitment the moment it's actually done — never close a ball you didn't finish.
- Whenever you (or the user) promise a future action — "follow up Friday", "send the deck after the call", "check if they replied in 3 days" — call ledger_add_commitment so it is NEVER dropped. A real EA forgets nothing.
- When you learn something durable about the user or a contact ("Sarah replies within 4h", "Acme renewal is annual ~$48k"), call save_fact. When you make a judgment call, log it with save_decision. When you notice a lasting preference (they want more direct drafts, a new VIP), call update_user_model. You get sharper every run — that's the moat.
- NEVER re-ask or re-derive something already in the user model / memory above. If you do, that's a failure.

Now do the job below to that standard, then write the report in the required format.
`;

export const REPORT_FORMAT_SUFFIX = `

---
THE EXECUTIVE BRIEFING — your entire output is this report (no preamble, no reasoning before/after).

This is how a $3,000/mo chief of staff reports: the one-line outcome, then the SHORT list of things that genuinely need the user today (each a one-tap action, not a question), then proof of the work, then — critically — an honest pass over everything that was just NOISE so they can trust you actually looked. First person, confident, specific, warm. The voice of a sharp operator texting a founder they respect, not a corporate status report. Every claim has a proof link to the real artifact. No apologies unless something genuinely failed. Never "I hope this helps."

THE TEST: the user should be able to read the first 4 lines, know exactly what needs them, and trust that everything else was handled or is safely ignorable — without scrolling. If they have to hunt for the signal, you failed.

LENGTH & SUBSTANCE — non-negotiable: a report is NEVER a single line, even on a quiet run. A real EA who found nothing still tells you exactly what they checked so you can relax. Minimum: the one-line outcome PLUS the "What I checked" section, always. When you did real work, be thorough — multiple sections with specifics.

Use this structure and order. Sections 1 (outcome) and 2 (What I checked) are MANDATORY every run. OMIT sections 4–7 only when genuinely empty (no "none" placeholders).

[ONE-LINE OUTCOME — mandatory first line, no heading. The whole run in one sentence; becomes the email subject + Slack header.]
Examples:
- "Inbox at zero. Booked 6 meetings, 4 drafts holding for you, 1 deal decision needs you."
- "Swept 14 emails overnight — all routine, triaged and filed; nothing needs you."

# [Agent Name]

## What I checked
MANDATORY — always present, even when nothing needed action. Prove you actually did the sweep: the scope and coverage. What sources, what window, what volume, what you concluded.
- "Swept your inbox over the last 24h — **14 new messages**: 9 newsletters/receipts, 3 internal FYIs, 2 already-handled threads."
- "Scanned your calendar through Friday — no conflicts, 4 meetings, all with prep done."
- "Cross-checked against your VIP list and open deals — no waiting clients, no stalled threads."
This section is why a quiet run still reads like real work, not "nothing to report." Be specific with real counts from your tool results.

## What I handled
Autonomous actions you completed this run, grouped, EACH with a proof link to the real artifact. Be specific.
- "Booked **Tuesday 3pm with Sarah Chen** (Meet link sent, logged to CRM) — [event](url)"
- "Replied to **3 client threads** in your voice — [Priya](url), [James](url), [Acme](url)"
- "Archived **27 newsletters** (97% — senders you've never opened in 90 days)"
ONLY list an action here if a tool actually returned success + a link/id. If you couldn't prove it, it does NOT go here — it goes in Holding or Needs your decision. No fabricated links, ever.
OMIT this section entirely if you took no autonomous action this run (the "What I checked" section already covers a quiet run).

## Holding for your approval
Draft-and-hold items: prepared but NOT sent/booked (per your autonomy level). Each: what it is, your recommendation, and the link to review + approve. ONE tap to approve.
- "Reply to **Acme** declining the discount, countering at 10% annual-prepay (my recommendation — matches your past deals) — [review & send](url)"
OMIT this section entirely if nothing is holding.

## Needs your decision
Genuine escalations — and EVERY one is a RECOMMENDATION, never an open question.
- "**Acme's CEO** wants a 20% discount. You've never gone above 10%. My recommendation: counter at 10% with annual prepay. — [the thread](url)"
Bad (never do this): "What should I do about Acme's email?"
OMIT this section entirely if nothing needs a decision.

## Following through
Open commitments from the Follow-Through Ledger — what you're chasing, what's due, what's overdue and now urgent. This is how nothing falls through.
- "Chasing **Acme** on the signed contract — promised Friday, now 2 days overdue. Sent a nudge today."
- "Holding: send **Sarah** the deck after Thursday's call."
OMIT this section entirely if the ledger is clear.

## The rest is noise
The trust-builder. Everything you swept that did NOT need them — named and dismissed in one line each, with the WHY. This is what proves you actually read everything and protected their attention. Group repeats and collapse patterns instead of listing every item.
- "5 Sentry alerts — same race-condition pattern you already flagged to Adam (PROD-8SG)."
- "3 Circleback meeting notes, Deel payment confirmation, Adam's merged PR, Dominik's OOO auto-reply — all filed, nothing to do."
- "27 newsletters/promos — archived (senders you've not opened in 90d)."
Be specific with real counts and names from your tool results. If there genuinely was no noise, say "Nothing else hit your inbox worth mentioning." OMIT only on a truly empty run.

## What I learned
1–3 lines on what got sharper this run — facts saved, user-model updates, a correction applied. Shows the user it's compounding.
- "Noted Sarah Chen prefers Tuesday calls and replies within 4h."
OMIT if nothing was learned this run.

## Want me to handle it?
ALWAYS the last line of the body. Offer the obvious next move as one tap, in your own warm voice — "want me to archive that noise or handle any of the action items?", "say the word and I'll send all 3 drafts", "want me to chase Acme on the contract?". Make it answerable with a one-word reply. Never end on a flat status.

---
Sent by Boult for Maily • [maily.dev](https://maily.dev/dashboard?tab=agents)
Status: [success if the mission's relevant success criteria were genuinely advanced; partial if some work remains; blocked if something stopped you — be honest, never fake success] · Run completed: [INSERT_CURRENT_UTC_TIMESTAMP]
Next run: [derive from the schedule — e.g. "Tomorrow at 9:00 AM". Omit if unknown.]

[Edit this agent](https://maily.dev/dashboard?tab=agents&agentId=[INSERT_AGENT_ID]) · [Pause](https://maily.dev/dashboard?tab=agents&agentId=[INSERT_AGENT_ID]&action=pause) · [Run history](https://maily.dev/dashboard?tab=agents&agentId=[INSERT_AGENT_ID]&view=history)

PROOF & HONESTY (non-negotiable):
- Every artifact link is a REAL URL from a tool result (draft URL, event htmlLink, Notion pageMeta.url). NEVER fabricate one. If a tool succeeded but returned no URL, list the action without a link and say so.
- If an action was queued for approval, say "holding for your approval", never "sent".
- Mark the run status truthfully. A run is success ONLY if the mission's relevant success criteria were actually advanced.

VOICE: A sharp chief of staff texting a founder they respect — direct, warm, human, zero corporate filler. First person ("I booked…", "drafted 3, holding for your word"). Contractions and a relaxed, conversational register are good ("here's what actually needs you today", "the rest is noise", "say the word and I'll send"). Be specific, never vague ("Drafted reply to Priya about Q3 pricing", not "drafted an email"). Banned: "successfully", "pleased to", "I hope this helps", emojis, code blocks, and any sentence that reads like a status dashboard. Keep the one-line outcome crisp enough to work as an email subject. Talk to them like a person, because that's the whole point.`;


export interface AgentRunBudget {
  /** Hard cap on tool calls (default: loop default of 20). */
  maxToolCalls?: number;
  /** Wall-clock budget in ms before the loop forces a final report. */
  deadlineMs?: number;
}

/**
 * Build the runAgentLoop arguments for a background agent. Shared by the
 * streaming "Run now" route and the synchronous cron runner so both produce
 * identical agent behaviour.
 */
export async function buildAgentLoopArgs(
  agent: {
    user_id: string; task_description: string; skip_confirmations?: boolean; name?: string; id?: string;
    // Next-gen: cross-run memory + pipeline hand-off input (both optional).
    agent_state?: Record<string, any> | null;
    _chainInput?: { summary?: string; parentAgentId?: string } | null;
    // Super-agent: the compiled Mission (null on first run → compiled + persisted).
    mission?: Mission | null;
    autonomy_level?: 'observe' | 'assist' | 'own' | null;
  },
  budget: AgentRunBudget = {},
) {
  const userId = agent.user_id;
  const taskDescription = agent.task_description;
  const agentName = agent.name || '';

  // FIX 2: Two parallel memory searches —
  //   1. Self-history: what this agent did in previous runs
  //   2. Topic context: relationship/preference context relevant to this task
  // PART 23 also pulls the user's binding instructions from their profile
  // so background runs obey "always cc legal@", "never schedule weekends",
  // etc. exactly like interactive chat does.
  const [connectedIntegrations, [selfHistory, topicContext], voicePrompt, userInstructions, userModel] = await Promise.all([
    getConnectedIntegrations(userId),
    Promise.all([
      searchMemories(userId, `[AGENT_RUN] ${agentName || taskDescription.slice(0, 80)}`, 3),
      searchMemories(userId, taskDescription, 4),
    ]),
    getVoiceProfilePromptBlock(userId),
    fetchUserInstructions(userId),
    (async () => { try { const { getUserModelSummary } = await import('./user-model'); return await getUserModelSummary(userId); } catch { return ''; } })(),
  ]);

  // Merge both memory sets, deduplicating identical lines
  const memoryLines = new Set([
    ...selfHistory.split('\n').filter(Boolean),
    ...topicContext.split('\n').filter(Boolean),
  ]);

  // Next-gen context — fold cross-run state and any pipeline hand-off into the
  // memory block so the loop sees them without changing the engine's interface.
  if (agent._chainInput?.summary) {
    memoryLines.add(
      `[PIPELINE INPUT] You were triggered by an upstream agent. Its result (use it as your starting context, do not redo its work):\n${agent._chainInput.summary.slice(0, 1000)}`,
    );
  }
  const st = agent.agent_state || {};
  const stateBits: string[] = [];
  if (st.last_fired_at) stateBits.push(`last fired ${st.last_fired_at}`);
  if (Array.isArray(st.processed_event_ids) && st.processed_event_ids.length) {
    stateBits.push(`${st.processed_event_ids.length} item(s) already handled in prior runs — do not act on them again`);
  }
  if (typeof st.note === 'string' && st.note.trim()) stateBits.push(st.note.trim().slice(0, 300));
  if (stateBits.length) memoryLines.add(`[AGENT STATE] ${stateBits.join(' · ')}`);

  const memories = [...memoryLines].join('\n');

  // SUPER-AGENT MISSION — compile the plain-English task into a structured,
  // accountable objective ONCE (Part 1.1), persist it, and lead every run with
  // it. Lazy compile covers every creation path with no route changes.
  let superContext = '';
  let mission: Mission | null = agent.mission || null;
  if (!mission && taskDescription.trim()) {
    try {
      mission = await compileMission(taskDescription, { userModel, instructions: userInstructions || '', agentName });
      if (mission && agent.id) {
        const { getSupabaseAdmin } = await import('../supabase.js');
        await getSupabaseAdmin().from('boult_agents').update({ mission }).eq('id', agent.id);
      }
    } catch { mission = null; }
  }
  const missionBlock = renderMission(mission);
  if (missionBlock) superContext += missionBlock + '\n\n';

  // AUTONOMY (Part 4) — how far you may act on your own. 'own' acts
  // autonomously (skip the approval gate); 'assist'/'observe' draft-and-hold.
  const autonomyLevel = agent.autonomy_level || 'assist';
  const AUTONOMY_BLOCKS: Record<string, string> = {
    observe:
      'AUTONOMY: OBSERVE. Draft and prepare everything, but SEND nothing and BOOK nothing — pure recommendations. ' +
      'Every reply is a draft for review; every meeting is a proposed time, not a created event. Put it all in "Holding for your approval".',
    assist:
      'AUTONOMY: ASSIST. Act autonomously on REVERSIBLE/low-risk things (archive, label, draft replies, log to CRM, propose times). ' +
      'DRAFT-AND-HOLD on irreversible/medium-risk (sending external email, booking a meeting) — prepare it fully and put it in "Holding for your approval" with your recommendation. Escalate genuinely high-stakes calls with a recommendation.',
    own:
      'AUTONOMY: OWN. Act autonomously on nearly everything, including sending replies and booking meetings, within the standing constraints. ' +
      'Escalate ONLY genuinely high-stakes or novel situations — and when you do, give a specific recommendation, never an open question.',
  };
  superContext += AUTONOMY_BLOCKS[autonomyLevel] + '\n\n';
  superContext +=
    'CONFIDENCE DRIVES EACH DECISION: ≥85 and within your autonomy → act + log the decision. 70-85 → act if reversible, else draft-and-hold with a recommendation. <85 escalations are RECOMMENDATIONS, never open questions ("My recommendation: counter at 10% with annual prepay. Approve / edit / I\'ll handle differently.").\n\n';

  // 'own' agents act without the approval gate; assist/observe hold for approval.
  const effectiveSkipConfirmations = autonomyLevel === 'own' ? true : (agent.skip_confirmations ?? false);

  // Then the user model (already fetched above) + the Follow-Through Ledger so
  // the run starts informed (Part 2 steps 1-2: never start from zero, check open
  // loops FIRST). Best-effort; never blocks a run.
  if (userModel && userModel.trim()) {
    superContext += `WHAT I KNOW ABOUT YOU (don't re-ask):\n${userModel.trim()}\n\n`;
  }
  try {
    const ledgerOpen = await listOpen(userId).catch(() => [] as any[]);
    const { overdue, dueToday } = bucketByDue(ledgerOpen);
    const due = [...overdue, ...dueToday];
    if (due.length) {
      const fmt = (e: any) => {
        if (!e.due) return 'no date';
        const d = Math.round((new Date(e.due).getTime() - Date.now()) / 86_400_000);
        return d < 0 ? `OVERDUE ${Math.abs(d)}d` : d === 0 ? 'due today' : `due in ${d}d`;
      };
      superContext +=
        'OPEN COMMITMENTS DUE NOW — handle these FIRST, before new work, then close each with ledger_close_commitment when done:\n' +
        due.map((e: any) => `- [${e.id}] ${e.what}${e.who ? ` — ${e.who}` : ''} (${fmt(e)})`).join('\n') + '\n\n';
    }
  } catch { /* non-fatal */ }

  const systemPrompt = buildSystemPrompt({
    userName: 'User',
    userId,
    connectedIntegrations,
    memories,
    personality: voicePrompt || undefined,
    userInstructions: userInstructions || undefined,
    isBackgroundAgent: true,
    skipConfirmations: effectiveSkipConfirmations,
    agentTaskDescription: taskDescription,
  });

  // Stamp the current UTC time AND the agent id into the report footer at
  // call time (not module-load time). F9.4 — every report now has deep-links
  // to the agent's settings page for edit / pause / history.
  const agentIdForFooter = agent.id || '';
  const reportSuffix = REPORT_FORMAT_SUFFIX
    .replace('[INSERT_CURRENT_UTC_TIMESTAMP]', new Date().toUTCString())
    .replace(/\[INSERT_AGENT_ID\]/g, agentIdForFooter);

  return {
    userId,
    systemPrompt,
    history: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: SUPER_AGENT_DIRECTIVE + '\n\n' + superContext + taskDescription + reportSuffix,
    connectedIntegrations,
    maxToolCalls: budget.maxToolCalls,
    deadlineMs: budget.deadlineMs,
    isBackgroundAgent: true,
    skipConfirmations: effectiveSkipConfirmations,
    agentId: agent.id,
  };
}

export interface AgentRunResult {
  /** Final report markdown (canvas if present, else final message). */
  report: string;
  /** Count of tool_call SSE events observed during the run. */
  toolCalls: number;
  /**
   * Structured artifact links the committee already collected. The cron route
   * persists these directly instead of re-parsing them out of the report
   * markdown (which broke whenever the report's link format changed).
   */
  artifactLinks?: { gmail?: Array<{ label: string; url: string }>; calendar?: Array<{ label: string; url: string }>; notion?: Array<{ label: string; url: string }>; slack?: Array<{ label: string; url: string }> } | null;
}

/**
 * Layer 1 — generate a short plain-English plan for a background run BEFORE it
 * executes. Pulls the agent's own past-run history so the plan reflects what
 * the agent learned last time ("last run found 12 meeting requests; this run
 * I'll check for new ones since then"). Cheap: one small LLM call, capped
 * tokens, never throws — a planning failure must not block the run.
 *
 * Returns '' on any failure; callers store whatever comes back (empty = the UI
 * simply omits the plan block).
 */
export async function generateRunPlan(
  agent: { user_id: string; task_description: string; name?: string },
  opts: { deadlineMs?: number } = {},
): Promise<string> {
  // This is a "nice to have" preview shown before the real work — it must never
  // be the thing that eats the function's time budget. Previously it had NO
  // deadline at all, so on a slow/rate-limited OpenRouter day it could walk
  // through every fallback model+key combination and burn the entire 60s
  // function lifetime before runAgentTask (the part that actually does the work
  // and writes the report) ever started — surfacing as "cut short by the
  // serverless time limit" with only the Plan step ever having run.
  const deadlineAt = Date.now() + (opts.deadlineMs ?? 8_000);
  try {
    const { callLLM, getText } = await import('./engine');
    const selfHistory = await searchMemories(
      agent.user_id,
      `[AGENT_RUN] ${agent.name || agent.task_description.slice(0, 80)}`,
      2,
    ).catch(() => '');

    const res = await callLLM(
      [
        {
          role: 'system',
          content:
            'You write a SHORT execution plan for an autonomous email/calendar agent that is about to run with no user present. ' +
            'Output 2-4 plain-English steps, each one line, starting with a verb (Scan, Read, Draft, Check, Book, Log, Flag). ' +
            'No preamble, no numbering styles beyond "- ", no markdown headings, no closing remarks. ' +
            'If past-run context is given, reflect it (e.g. "Check for requests newer than last run"). ' +
            'Keep the whole thing under 80 words.',
        },
        {
          role: 'user',
          content:
            `Agent: ${agent.name || 'Background agent'}\n` +
            `Task: ${agent.task_description}\n` +
            (selfHistory ? `\nPast-run context:\n${selfHistory.slice(0, 600)}\n` : '') +
            '\nWrite the plan.',
        },
      ],
      [],
      { maxTokens: 200, temperature: 0.2, deadlineAt },
    );
    return getText(res.content).trim().slice(0, 1000);
  } catch {
    return '';
  }
}

export async function runAgentTask(
  agent: { user_id: string; task_description: string; skip_confirmations?: boolean; name?: string; id?: string },
  budget: AgentRunBudget = {},
  agentRunId?: string,
): Promise<AgentRunResult> {
  // SUPER-AGENT — background runs now execute as ONE coherent agent with the
  // full toolset, not the parallel multi-VA committee. The committee fragmented
  // coherent jobs (a meeting request needs inbox + calendar TOGETHER), so the
  // halves never finished and the report papered over the gap with unverified
  // claims. A single agent sees its own work end-to-end: read → check
  // availability → draft proposing times → book with a link → surface for
  // approval. The committee stays available as an opt-in fallback
  // (BOULT_USE_COMMITTEE=true) — nothing deleted, fully reversible.
  const useCommittee = process.env.BOULT_USE_COMMITTEE === 'true';
  // Defaults sized for Vercel Hobby's 60s function cap (used when no caller
  // budget is supplied, e.g. the "Run now" path). The cron route passes its own
  // tighter per-agent budget. (On Pro: 80 / 50_000.)
  const maxToolCalls = budget.maxToolCalls ?? 26;
  const deadlineMs = budget.deadlineMs ?? 50_000;
  // Anchor an ABSOLUTE deadline the moment this function is entered — this is
  // the true "clock start" for the agent's real work, called right after the
  // cron route's own setup (reaper, agent fetch, plan step) already ran.
  // buildAgentLoopArgs below does its OWN setup (mission compile — an LLM call
  // on an agent's first run — plus memory/ledger reads) before runAgentLoop
  // stamps its internal startedAt. That setup time used to be free: the loop's
  // deadline was computed from ITS OWN start, so every stage's delay silently
  // stacked on top of the 60s Vercel cap instead of being subtracted from it —
  // which is how a run could still blow the limit even though each stage
  // individually respected the duration it was handed. Recomputing the
  // duration against this fixed anchor right before the loop starts closes
  // that gap.
  const taskDeadlineAt = Date.now() + deadlineMs;

  let report: string;
  let toolCalls: number;
  let artifactLinks: AgentRunResult['artifactLinks'] = null;

  if (useCommittee) {
    const committee = await runAgentAsCommittee(agent, { maxToolCalls, deadlineMs: Math.max(0, taskDeadlineAt - Date.now()), agentRunId });
    report = committee.report;
    toolCalls = committee.toolCalls;
    artifactLinks = committee.artifactLinks ?? null;
  } else {
    // Legacy single-LLM path — kept verbatim so flipping the kill switch
    // returns exactly the prior behaviour. Will be deleted in a future
    // PART once the committee mode has soak time in prod.
    const args = await buildAgentLoopArgs(agent, {
      ...budget,
      // Re-shrunk to what's ACTUALLY left after buildAgentLoopArgs's own setup
      // (mission compile, memory/ledger reads) just ran — not the original
      // duration replayed from a fresh clock.
      deadlineMs: Math.max(0, taskDeadlineAt - Date.now()),
    });
    const stream = runAgentLoop({ ...args, agentRunId });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalText = '';
    let currentEventType = '';
    let canvasMarkdown = '';
    let legacyToolCalls = 0;
    // Fix 4+10 — track tool names and result summaries so we can build a
    // meaningful emergency report when the LLM fails to produce one.
    const toolNames: string[] = [];
    const toolSummaries: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) { currentEventType = line.slice(7).trim(); continue; }

        if (line.startsWith('data: ') && currentEventType === 'message') {
          try {
            const data = JSON.parse(line.slice(6).trim());
            if (data.content) finalText = data.content;
          } catch { /* ok */ }
          currentEventType = '';
        }

        if (line.startsWith('data: ') && currentEventType === 'canvas') {
          try {
            const data = JSON.parse(line.slice(6).trim());
            if (data.markdown && data.type !== 'scheduled_agent') canvasMarkdown = data.markdown;
          } catch { /* ok */ }
          currentEventType = '';
        }

        if (line.startsWith('data: ') && currentEventType === 'tool_call') {
          legacyToolCalls += 1;
          try {
            const data = JSON.parse(line.slice(6).trim());
            if (data.tool) toolNames.push(data.tool);
          } catch { /* ok */ }
          currentEventType = '';
        }

        if (line.startsWith('data: ') && currentEventType === 'tool_result') {
          try {
            const data = JSON.parse(line.slice(6).trim());
            if (data.summary && data.success !== false) {
              toolSummaries.push(`${data.tool || 'tool'}: ${data.summary.slice(0, 150)}`);
            }
          } catch { /* ok */ }
          currentEventType = '';
        }
      }
    }

    // Fix 10 — build a meaningful emergency report from tool data instead of
    // the useless generic fallback that got delivered via email/Slack.
    if (canvasMarkdown || finalText) {
      report = canvasMarkdown || finalText;
    } else if (legacyToolCalls > 0) {
      const agentLabel = agent.name || 'Background Agent';
      const toolSet = [...new Set(toolNames)];
      const TOOL_LABELS: Record<string, string> = {
        search_gmail: 'searched your inbox', read_email: 'read email threads',
        draft_reply: 'drafted replies', send_email: 'sent emails',
        get_calendar_events: 'checked your calendar', schedule_meeting: 'scheduled meetings',
        search_notion: 'searched Notion', create_notion_page: 'created Notion pages',
        slack_get_channels: 'checked Slack channels', send_slack_message: 'sent Slack messages',
        memory_search: 'searched memory', save_fact: 'saved facts',
      };
      const workDone = toolSet
        .map(t => TOOL_LABELS[t] || t.replace(/_/g, ' '))
        .join(', ');
      const summaryLines = toolSummaries.slice(0, 6).map(s => `- ${s}`).join('\n');

      report = [
        `The agent ran ${legacyToolCalls} tool calls but couldn't compose a full report before the deadline.`,
        '',
        `# ${agentLabel}`,
        '',
        '## What I checked',
        `I ${workDone} (${legacyToolCalls} operations total).`,
        summaryLines ? `\nKey results:\n${summaryLines}` : '',
        '',
        '## Note',
        'The run hit its time limit before the final report could be written. The work above was completed — a full summary will be included in the next scheduled run.',
        '',
        '---',
        `Sent by Boult for Maily • [maily.dev](https://maily.dev/dashboard?tab=agents)`,
        `Status: partial · Run completed: ${new Date().toUTCString()}`,
      ].filter(Boolean).join('\n');
    } else {
      // Zero tool calls + no text almost always means the AI was temporarily
      // unavailable (every tool-capable model rate-limited, so the engine fell
      // back to a tool-less text round that produced nothing) — NOT a misconfigured
      // agent. Don't blame the user's setup; say what's true and that it retries.
      report = 'EMPTY_RUN';
    }
    toolCalls = legacyToolCalls;
  }

  // FIX 2: Save structured end-of-run memory so future runs can query history
  const agentName = agent.name || agent.task_description.slice(0, 60);
  const runRecord = [
    `[AGENT_RUN] Agent: "${agentName}"`,
    `Ran: ${new Date().toISOString()}`,
    `Task: ${agent.task_description.slice(0, 200)}`,
    `Report summary: ${report.replace(/\s+/g, ' ').slice(0, 350)}`,
  ].join(' | ');

  // Fire-and-forget — never block the cron run on memory write
  saveMemory(agent.user_id, runRecord, ['agent_run', 'background']).catch(() => {});

  return { report, toolCalls, artifactLinks };
}
