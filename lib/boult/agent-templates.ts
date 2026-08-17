/**
 * Boult Agent Templates
 *
 * Curated pre-built scheduled-agent configurations. Spawned via
 * POST /api/boult/agents/templates → which calls createScheduledAgent
 * directly with _planApproved: true (skipping the spec-confirmation card
 * since the template IS the spec).
 *
 * Design rules:
 *  - Each template name is 2-4 words, recognizable, action-oriented.
 *  - cron_schedule uses the user's local timezone (handled at run time
 *    by shouldAgentRunNow).
 *  - skip_confirmations defaults to FALSE — new users hit the approval
 *    dashboard, build trust, then flip autonomy on themselves.
 *  - task_description references the actual tool names from the 60-tool
 *    arsenal so the LLM has a clear playbook for each run.
 *  - requiredIntegrations is informational — the agent-creation flow
 *    will surface integration-required cards if anything is missing.
 */

export interface AgentTemplate {
  /** Stable id used for spawn lookups. */
  id: string;
  /** Display name shown to the user; also becomes the agent's name. */
  name: string;
  /** One-line description shown on the gallery card. */
  tagline: string;
  /** Longer marketing description shown when the card is expanded. */
  description: string;
  /** Emoji icon for the card. */
  emoji: string;
  /** Cron schedule (5-field). */
  cronSchedule: string;
  /** Human-readable schedule label for the card ("Daily 7:00 AM"). */
  scheduleLabel: string;
  /** Output channel for reports. */
  outputChannel: 'gmail' | 'slack' | 'both';
  /** Default skip_confirmations. ALL templates ship with this OFF for safety. */
  skipConfirmations: boolean;
  /** Required integrations for the template to actually do work. */
  requiredIntegrations: Array<'gmail' | 'gcal' | 'notion' | 'slack'>;
  /** The standing instruction the agent runs every fire. References the tool arsenal. */
  taskDescription: string;
  /** What the user can expect in the report. */
  expectedOutput: string;

  // ── Next-gen scheduling (all optional; omit = classic time-based agent) ──
  /** How the agent fires. Defaults to 'schedule'. */
  triggerType?: 'schedule' | 'event' | 'condition' | 'chained';
  /** Config for non-schedule triggers, e.g. { event_source:'gmail', debounce_min:15 }. */
  triggerConfig?: Record<string, any>;
  /** AND-list of trigger conditions for event/condition agents. */
  conditions?: Array<{ field: string; op: string; value: string | number | string[] }>;
  /** Budget priority (1 highest). */
  priority?: number;
  /**
   * Pipeline children — when present, spawning this template creates each child
   * agent first, then the parent with pipeline = [child ids]. The parent runs on
   * its own trigger and hands its result down the chain (children are 'chained').
   */
  pipelineChildren?: Array<Pick<AgentTemplate,
    'name' | 'tagline' | 'description' | 'emoji' | 'outputChannel' | 'skipConfirmations' | 'requiredIntegrations' | 'taskDescription' | 'expectedOutput'>>;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  // ───────────────────────────────────────────────────────────────────────
  // 1. Morning Inbox Sweep
  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'morning_inbox_sweep',
    name: 'Morning Inbox Sweep',
    tagline: 'Wake up to a triaged inbox with drafts ready to send',
    description:
      'Every morning at 7am, this agent reads every unread email from the last 24 hours, ' +
      'drafts replies in your voice for anything that needs one, archives newsletters and promos, ' +
      'and logs every conversation to your Notion contacts database.',
    emoji: '🌅',
    cronSchedule: '0 7 * * *',
    scheduleLabel: 'Daily 7:00 AM',
    outputChannel: 'gmail',
    skipConfirmations: false,
    requiredIntegrations: ['gmail'],
    taskDescription: [
      'Process my inbox from the last 24 hours autonomously, every morning. Follow this exact workflow:',
      '',
      '1. build_worklist with gmailQuery "is:unread newer_than:1d -category:promotions" — get the filtered tiered worklist.',
      '2. claim_worklist_items with the thread ids — prevents parallel agents from duplicating.',
      '3. gmail_bulk_read_threads with all the thread ids — read all of them in parallel.',
      '4. gmail_extract_data_from_threads — extract structured info (sender, decisions, urgency, deal signals) for every thread.',
      '5. gmail_detect_urgency — identify any thread scoring 7+ for the urgent-attention section.',
      '6. gmail_batch_draft_replies — for every Tier 1 (client) and Tier 2 (revenue) thread, draft a reply in my voice. Use per-thread instructions based on what the thread is asking.',
      '7. For every draft, call check_draft_quality. If shouldRedraft is true, regenerate without the flagged generic phrases.',
      '8. gmail_auto_label_threads with labelName "Boult-Reviewed" — label everything you handled.',
      '9. gmail_auto_archive_threads — bulk archive newsletters, promos, and Tier 4 items.',
      '10. notion_auto_log_all_communication — log every Tier 1+2 thread to my Notion communications database.',
      '11. record_processed_items so tomorrow does not re-process the same threads.',
      '12. Write the report following the executive briefing format.',
    ].join('\n'),
    expectedOutput:
      'A morning email + one-line subject line that summarizes: emails processed, drafts queued for your review, ' +
      'urgent items flagged, newsletters archived, deals tracked. Every action links directly to the Gmail draft, ' +
      'Notion page, or Calendar event.',
  },

  // ───────────────────────────────────────────────────────────────────────
  // 2. Deal Pipeline Tracker
  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'deal_pipeline_tracker',
    name: 'Deal Pipeline Tracker',
    tagline: 'Sales activity logged to Notion every afternoon',
    description:
      'Every afternoon at 12:30pm, this agent scans your sent and inbound emails for deal-related signals ' +
      '(contracts, pricing, proposals, signatures, payments), extracts company / contact / stage / value, ' +
      'and updates your Notion deals pipeline automatically.',
    emoji: '💰',
    cronSchedule: '30 12 * * 1-5',
    scheduleLabel: 'Weekdays 12:30 PM',
    outputChannel: 'both',
    skipConfirmations: false,
    requiredIntegrations: ['gmail', 'notion'],
    taskDescription: [
      'Track my sales pipeline by scanning recent deal-related emails and logging them to Notion. Workflow:',
      '',
      '1. gmail_unlimited_search with gmailQuery "(contract OR proposal OR pricing OR invoice OR signed OR renewal OR negotiation) newer_than:1d" maxResults 50.',
      '2. claim_worklist_items for all matching thread ids.',
      '3. gmail_bulk_read_threads on all of them.',
      '4. notion_deal_tracking_automation — extract deal info (company, contact, stage, value, probability, timeline, signals) and log each to my Notion deals database.',
      '5. For any deal that moved between stages (compared to memory), prepare a slack_deal_update_notifications batch and call it.',
      '6. notion_create_smart_dashboards with kind "sales" — refresh the sales overview dashboard.',
      '7. memory_bulk_save_learning — save deal-stage observations so tomorrow you can detect movement.',
      '8. record_processed_items.',
      '9. Write the report with 💰 Revenue & Opportunities as the lead section.',
    ].join('\n'),
    expectedOutput:
      'A midday report — to your inbox AND posted in your Slack #sales-pipeline channel — listing every deal ' +
      'detected today, stage changes since yesterday, and a refreshed Notion sales dashboard. Every entry links ' +
      'to the Notion deal page and the originating Gmail thread.',
  },

  // ───────────────────────────────────────────────────────────────────────
  // 3. Meeting Prep Concierge
  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'meeting_prep_concierge',
    name: 'Meeting Prep Concierge',
    tagline: 'One-page prep doc for every external meeting tomorrow',
    description:
      'Every evening at 6pm, this agent looks at tomorrow\'s calendar, identifies every meeting with external ' +
      'attendees, and generates a one-page prep document for each (context · recent emails · talking points · ' +
      'watch-fors). Prep docs save to Notion and link from the calendar event.',
    emoji: '📅',
    cronSchedule: '0 18 * * *',
    scheduleLabel: 'Daily 6:00 PM',
    outputChannel: 'gmail',
    skipConfirmations: false,
    requiredIntegrations: ['gcal', 'gmail', 'notion'],
    taskDescription: [
      'Generate meeting prep docs for tomorrow\'s external meetings. Workflow:',
      '',
      '1. calendar_unlimited_scan with daysAhead 1 — find all events tomorrow.',
      '2. Filter to events with at least one external (non-self) attendee.',
      '3. calendar_meeting_prep_automation with scanWindow true and saveToNotion true — for each external meeting, pull recent emails with attendees, query memory for context, compose a markdown prep doc, save to Notion meetings database.',
      '4. calendar_auto_generate_meet_links — for any external meeting tomorrow that\'s missing a Meet link, add one (PATCH conferenceData with sendUpdates=all so attendees get the updated invite).',
      '5. calendar_buffer_time_insertion with dryRun false — insert 15-min buffer blocks between back-to-back meetings.',
      '6. record_processed_items.',
      '7. Write the report listing every meeting prepped, with direct links to each Notion prep doc and Calendar event.',
    ].join('\n'),
    expectedOutput:
      'An evening email summarizing tomorrow\'s prep — one line per external meeting with the time, attendees, ' +
      'and a direct link to the Notion prep doc. Meet links and buffer blocks added silently. You wake up ' +
      'ready for every conversation.',
  },

  // ───────────────────────────────────────────────────────────────────────
  // 4. Weekly Executive Brief
  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'weekly_executive_brief',
    name: 'Weekly Executive Brief',
    tagline: 'Friday 4pm: a real executive briefing for the week',
    description:
      'Every Friday at 4pm, this agent aggregates the week — emails handled, deals moved, meetings held, ' +
      'projects updated, urgent items — and composes a structured executive briefing with revenue / operations / ' +
      'client relationships / next-actions sections. Emailed and posted to your team Slack.',
    emoji: '📊',
    cronSchedule: '0 16 * * 5',
    scheduleLabel: 'Friday 4:00 PM',
    outputChannel: 'both',
    skipConfirmations: false,
    requiredIntegrations: ['gmail', 'notion'],
    taskDescription: [
      'Generate a weekly executive briefing covering everything that happened this week. Workflow:',
      '',
      '1. notion_generate_weekly_summaries — aggregate emails sent count, meetings held list, agent run activity. Save the structured summary to Notion weekly_summaries database.',
      '2. gmail_unlimited_search "(contract OR signed OR closed OR shipped) newer_than:7d" — find revenue wins.',
      '3. memory_unlimited_scan with queries ["[AGENT_RUN]", "[LEARNING:approved]", "client", "deal"] — pull context about agent activity and client interactions this week.',
      '4. notion_create_smart_dashboards with kind "executive" — refresh the executive overview.',
      '5. output_formatting_and_presentation with format "briefing" and content set to the aggregated context — get a polished markdown briefing.',
      '6. slack_team_digest_weekly with channel "#team-digest" — post the digest to Slack.',
      '7. Write the final report following the executive briefing format with all 5 sections (Revenue / Client Updates / Operations / Needs Attention / Links).',
    ].join('\n'),
    expectedOutput:
      'A Friday afternoon executive briefing — in your inbox and in your team Slack channel — that reads like a ' +
      'real chief-of-staff weekly report. Sections for revenue, client relationships, operations, and what needs ' +
      'your attention next week. Every claim links to the underlying Notion page or Gmail thread.',
  },

  // ───────────────────────────────────────────────────────────────────────
  // 5. VIP Auto-Responder  (EVENT trigger — reacts to client email, no clock)
  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'vip_auto_responder',
    name: 'VIP Auto-Responder',
    tagline: 'Reacts the moment an important client emails you',
    description:
      'Watches for new email from your key client domains and, within minutes, reads the thread and drafts a ' +
      'reply in your voice — so VIPs never wait. Fires on the event, not on a schedule.',
    emoji: '⚡',
    cronSchedule: '0 9 * * *', // unused for event agents; kept for schema compatibility
    scheduleLabel: 'On every client email',
    outputChannel: 'gmail',
    skipConfirmations: false,
    requiredIntegrations: ['gmail'],
    triggerType: 'event',
    triggerConfig: { event_source: 'gmail', debounce_min: 10 },
    conditions: [{ field: 'domain', op: 'contains', value: '@client.com' }], // user edits to their client domain
    priority: 2,
    taskDescription: [
      'A new email arrived from a VIP client (it matched my trigger). Respond fast:',
      '',
      '1. gmail_read_thread on the triggering thread — understand the full context.',
      '2. get_recipient_context / memory_get_contact_profile — pull what I know about this person.',
      '3. draft_reply in my voice addressing exactly what they asked. Leave it as a draft for my approval.',
      '4. check_draft_quality; redraft if it flags generic filler.',
      '5. Report the one thread you handled and the draft link. Keep it to a single item — this is a reactive run, not a digest.',
    ].join('\n'),
    expectedOutput:
      'A near-real-time note that a VIP emailed, with a ready-to-send draft linked. One thread per fire.',
  },

  // ───────────────────────────────────────────────────────────────────────
  // 6. Stalled-Deal Chaser  (CONDITION trigger — revenue thread idle 3+ days)
  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'stalled_deal_chaser',
    name: 'Stalled-Deal Chaser',
    tagline: 'Nudges deals that have gone quiet for 3+ days',
    description:
      'Watches your revenue threads and, when a proposal/contract conversation goes silent for 3+ days, ' +
      'drafts a timely, polite follow-up so deals never die from neglect.',
    emoji: '🎯',
    cronSchedule: '0 10 * * 1-5',
    scheduleLabel: 'When a deal stalls 3+ days',
    outputChannel: 'gmail',
    skipConfirmations: false,
    requiredIntegrations: ['gmail'],
    triggerType: 'condition',
    triggerConfig: { event_source: 'gmail', debounce_min: 720 }, // at most ~twice a day
    conditions: [
      { field: 'keyword', op: 'eq', value: 'revenue' },
      { field: 'age_days', op: 'gte', value: 3 },
    ],
    priority: 3,
    taskDescription: [
      'A revenue thread has gone quiet for 3+ days (it matched my trigger). Re-warm it:',
      '',
      '1. gmail_read_thread on the matched thread — confirm it is genuinely awaiting a reply from the other side.',
      '2. If a follow-up is warranted, draft_reply in my voice: short, specific, one clear next step. Leave as a draft.',
      '3. check_draft_quality; redraft if needed.',
      '4. Report which deal stalled, how long it has been silent, and link the draft. Skip threads where I already replied.',
    ].join('\n'),
    expectedOutput:
      'A short alert naming the stalled deal(s) and a ready follow-up draft for each. Nothing when no deal is stalling.',
  },

  // ───────────────────────────────────────────────────────────────────────
  // 7. Triage → Draft → Digest  (PIPELINE — three chained agents)
  // ───────────────────────────────────────────────────────────────────────
  {
    id: 'triage_draft_digest',
    name: 'Triage → Draft → Digest',
    tagline: 'A 3-stage morning pipeline: sort, draft, then summarize',
    description:
      'A pipeline of three agents that hand work down the line: Triage sorts the inbox, then Draft writes replies ' +
      'for what matters, then Digest sends you one clean summary of everything that happened.',
    emoji: '🔗',
    cronSchedule: '0 7 * * *',
    scheduleLabel: 'Daily 7:00 AM (pipeline)',
    outputChannel: 'gmail',
    skipConfirmations: false,
    requiredIntegrations: ['gmail'],
    priority: 4,
    taskDescription: [
      'STAGE 1 — TRIAGE. Sort my last-24h inbox and hand the priority items downstream:',
      '',
      '1. build_worklist with gmailQuery "is:unread newer_than:1d -category:promotions".',
      '2. gmail_bulk_read_threads + gmail_extract_data_from_threads on the worklist.',
      '3. gmail_detect_urgency to flag the urgent ones.',
      '4. Report the triaged list (sender, subject, why it matters, urgency) — this becomes the next stage\'s input.',
    ].join('\n'),
    expectedOutput:
      'A triaged priority list that flows into the Draft stage. You only get pinged by the final Digest stage.',
    pipelineChildren: [
      {
        name: 'Draft (pipeline)',
        tagline: 'Drafts replies for the triaged items',
        description: 'Second stage: drafts replies in your voice for the items Triage surfaced.',
        emoji: '✍️',
        outputChannel: 'gmail',
        skipConfirmations: false,
        requiredIntegrations: ['gmail'],
        taskDescription: [
          'You were handed a triaged priority list by the upstream Triage agent (see PIPELINE INPUT). Draft replies:',
          '',
          '1. For each Tier-1/Tier-2 item in the handoff, draft_reply in my voice. Leave each as a Gmail draft.',
          '2. check_draft_quality on each; redraft if it flags generic filler.',
          '3. Report each draft with its link — this flows to the Digest stage.',
        ].join('\n'),
        expectedOutput: 'Ready-to-send drafts for the priority threads, handed to the Digest stage.',
      },
      {
        name: 'Digest (pipeline)',
        tagline: 'Sends one clean summary of the run',
        description: 'Final stage: turns the triage + drafts into one calm summary email.',
        emoji: '📬',
        outputChannel: 'gmail',
        skipConfirmations: false,
        requiredIntegrations: ['gmail'],
        taskDescription: [
          'You received the Draft stage\'s output (see PIPELINE INPUT). Produce the single user-facing summary:',
          '',
          '1. Summarize what Triage surfaced and what Draft prepared — what needs my review, in priority order.',
          '2. Include every draft link so I can review and send in one pass.',
          '3. Write it as one calm executive briefing. This is the only message I should receive from the pipeline.',
        ].join('\n'),
        expectedOutput: 'One summary email with every draft linked for one-pass review.',
      },
    ],
  },
];

export function getTemplateById(id: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find(t => t.id === id);
}
