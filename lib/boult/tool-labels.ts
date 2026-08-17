/**
 * Human-readable labels for agent tool names — for the HomeFeed transparency
 * panel ("Tools used"). A raw `gmail_batch_draft_replies` means nothing to a
 * founder; "Drafted replies" does.
 *
 * This is a deterministic map + a graceful pattern fallback, NOT an LLM call:
 * translating a fixed vocabulary of ~80 tool names is a lookup, not a reasoning
 * task. Using a model here would add latency and cost for zero quality gain.
 * The AI in this feature lives where it belongs — the run summary and the plan,
 * both already model-generated.
 */

// Explicit labels for the tools users see most. Keep these verb-led and short.
const EXPLICIT: Record<string, string> = {
  // Gmail
  search_gmail: 'Searched inbox',
  gmail_unlimited_search: 'Searched inbox',
  gmail_read_thread: 'Read a thread',
  gmail_bulk_read_threads: 'Read threads',
  draft_reply: 'Drafted a reply',
  gmail_batch_draft_replies: 'Drafted replies',
  gmail_generate_auto_replies: 'Drafted replies',
  draft_cold_email: 'Drafted a cold email',
  send_email: 'Sent an email',
  gmail_batch_send_emails: 'Sent emails',
  gmail_apply_label: 'Applied a label',
  gmail_auto_label_threads: 'Labeled threads',
  gmail_archive_thread: 'Archived a thread',
  gmail_auto_archive_threads: 'Archived threads',
  gmail_detect_urgency: 'Checked for urgent mail',
  digest_newsletters: 'Digested newsletters',
  get_sent_emails: 'Reviewed sent mail',
  check_followups: 'Checked follow-ups',

  // Calendar
  get_calendar_events: 'Checked the calendar',
  calendar_get_availability: 'Checked availability',
  calendar_unlimited_scan: 'Scanned the calendar',
  schedule_meeting: 'Booked a meeting',
  calendar_batch_create_events: 'Booked meetings',
  calendar_cancel_event: 'Cancelled an event',
  calendar_auto_detect_conflicts: 'Checked for conflicts',
  calendar_meeting_prep_automation: 'Prepped for a meeting',
  calendar_timezone_intelligence: 'Resolved time zones',

  // Notion
  create_notion_page: 'Logged to Notion',
  notion_create_task: 'Created a Notion task',
  notion_auto_log_all_communication: 'Logged to Notion',
  notion_deal_tracking_automation: 'Updated deal tracking',
  notion_auto_generate_meeting_notes: 'Wrote meeting notes',
  notion_batch_create_database_entries: 'Logged to Notion',

  // Slack
  send_slack_message: 'Sent a Slack message',
  slack_post_daily_briefing: 'Posted a Slack briefing',

  // Memory / research
  memory_search: 'Recalled context',
  memory_save: 'Saved a learning',
  memory_get_contact_profile: 'Pulled a contact profile',
  get_contact_context: 'Pulled contact context',
  get_recipient_context: 'Gathered recipient context',
  web_search: 'Searched the web',
  company_intelligence_research: 'Researched a company',
  contact_research_and_verification: 'Researched a contact',

  // Meta
  request_confirmation: 'Asked for approval',
  open_canvas: 'Wrote a document',
  build_worklist: 'Built a worklist',
};

// Verb stems used by the snake_case fallback, longest-match-wins.
const VERB_HINTS: Array<[RegExp, string]> = [
  [/^gmail_|^email_/, ''],
  [/^calendar_|^cal_/, ''],
  [/^notion_/, 'Notion: '],
  [/^slack_/, 'Slack: '],
  [/^memory_/, ''],
];

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

/** Friendly label for a single tool name. Always returns something readable. */
export function humanizeToolName(tool: string): string {
  if (!tool) return 'Did something';
  if (EXPLICIT[tool]) return EXPLICIT[tool];

  // Fallback: strip a known integration prefix, title-case the rest.
  let rest = tool;
  let prefix = '';
  for (const [re, label] of VERB_HINTS) {
    if (re.test(tool)) { rest = tool.replace(re, ''); prefix = label; break; }
  }
  return (prefix + titleCase(rest)) || titleCase(tool);
}

/**
 * Collapse a list of tool-call rows into deduped, counted, human-readable
 * lines: [{ label: "Drafted replies", count: 6, ok: true }]. Order preserved by
 * first appearance. Failures are kept distinct so the panel can flag them.
 */
export interface ToolUseLine { label: string; count: number; ok: boolean }

export function summarizeToolUse(
  calls: Array<{ tool_name: string; success?: boolean | null }>,
): ToolUseLine[] {
  const order: string[] = [];
  const map = new Map<string, ToolUseLine>();
  for (const c of calls) {
    const ok = c.success !== false;
    const label = humanizeToolName(c.tool_name);
    const key = `${label}__${ok}`;
    if (!map.has(key)) { map.set(key, { label, count: 0, ok }); order.push(key); }
    map.get(key)!.count++;
  }
  return order.map(k => map.get(k)!);
}
