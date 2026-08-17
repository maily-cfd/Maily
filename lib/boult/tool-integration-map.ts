/**
 * Tool → required-integration map.
 *
 * Extracted from tools.ts so system-prompt.ts can auto-derive its capability
 * listing without creating a circular import. Single source of truth — when
 * you add a new tool to tools.ts, add ONE line here and the system prompt
 * picks it up automatically.
 *
 *   value === 'gmail' | 'gcal' | 'notion' | 'slack'  → integration required
 *   value === null                                   → always available
 *
 * If you add a NEW integration, also extend INTEGRATION_LABELS below.
 */

export const TOOL_INTEGRATION_MAP: Record<string, string | null> = {
  // Gmail
  search_gmail: 'gmail',
  read_email: 'gmail',
  gmail_read_thread: 'gmail',
  gmail_get_labels: 'gmail',
  gmail_apply_label: 'gmail',
  gmail_archive_thread: 'gmail',
  gmail_get_profile: 'gmail',
  get_sent_emails: 'gmail',
  voice_profile_generate: 'gmail',
  draft_reply: 'gmail',
  draft_cold_email: 'gmail',
  send_email: 'gmail',
  check_followups: 'gmail',
  digest_newsletters: 'gmail',
  build_worklist: 'gmail',
  gmail_unlimited_search: 'gmail',
  gmail_bulk_read_threads: 'gmail',
  gmail_batch_draft_replies: 'gmail',
  gmail_batch_send_emails: 'gmail',
  schedule_email_send: 'gmail',
  list_scheduled_emails: 'gmail',
  cancel_scheduled_email: 'gmail',
  gmail_auto_label_threads: 'gmail',
  gmail_auto_archive_threads: 'gmail',
  gmail_extract_data_from_threads: 'gmail',
  gmail_detect_conversation_type: 'gmail',
  gmail_generate_auto_replies: 'gmail',
  gmail_detect_urgency: 'gmail',
  report_send_gmail: 'gmail',
  memory_relationship_intelligence: 'gmail',

  // Calendar
  schedule_meeting: 'gcal',
  get_calendar_events: 'gcal',
  calendar_get_availability: 'gcal',
  calendar_cancel_event: 'gcal',
  calendar_unlimited_scan: 'gcal',
  calendar_batch_create_events: 'gcal',
  calendar_auto_detect_conflicts: 'gcal',
  calendar_auto_decline_low_priority: 'gcal',
  calendar_generate_free_time_blocks: 'gcal',
  calendar_meeting_prep_automation: 'gcal',
  calendar_auto_generate_meet_links: 'gcal',
  calendar_buffer_time_insertion: 'gcal',

  // Cal.com — surfaced for everyone but each tool checks for the user's own API
  // key at call time (getCalClient) and returns calcom_not_configured with a
  // connect prompt if absent. The shared CAL_API_KEY is single-tenant-only
  // (CAL_ALLOW_SHARED_KEY=true). Cal.com OAuth is read-only (no booking scope), so
  // API keys remain the path — see docs/boult-calcom-auth.md.
  calcom_list_event_types: null,
  calcom_get_slots: null,
  calcom_create_booking: null,
  calcom_list_bookings: null,
  calcom_cancel_booking: null,

  // Super-agent foundation — always available (no integration gating).
  // (User model read/write reuses the existing get/update_user_model tools.)
  ledger_add_commitment: null,
  ledger_list_due: null,
  ledger_list_open: null,
  ledger_close_commitment: null,
  save_fact: null,
  save_decision: null,

  // Notion
  search_notion: 'notion',
  fetch_notion_schema: 'notion',
  create_notion_page: 'notion',
  notion_read_page: 'notion',
  notion_read_database: 'notion',
  notion_create_task: 'notion',
  notion_get_calendar_events: 'notion',
  notion_auto_create_contact_profiles: 'notion',
  notion_auto_log_all_communication: 'notion',
  notion_batch_create_database_entries: 'notion',
  notion_auto_update_project_status: 'notion',
  notion_auto_generate_meeting_notes: 'notion',
  notion_deal_tracking_automation: 'notion',
  notion_create_smart_dashboards: 'notion',
  notion_link_related_items: 'notion',
  notion_auto_archive_completed_work: 'notion',
  notion_generate_weekly_summaries: 'notion',

  // Slack
  send_slack_message: 'slack',
  slack_find_user: 'slack',
  slack_send_dm: 'slack',
  slack_get_channels: 'slack',
  slack_post_daily_briefing: 'slack',
  slack_real_time_urgent_alerts: 'slack',
  slack_team_digest_weekly: 'slack',
  slack_deal_update_notifications: 'slack',
  slack_task_assignment_notifications: 'slack',
  slack_approval_request_routing: 'slack',
  report_send_slack: 'slack',

  // Always available
  get_voice_profile: null,
  voice_profile_update: null,
  draft_review: null,
  open_canvas: null,
  update_canvas: null,
  web_search: null,
  web_search_instant: null,
  create_scheduled_agent: null,
  list_scheduled_agents: null,
  pause_scheduled_agent: null,
  resume_scheduled_agent: null,
  delete_scheduled_agent: null,
  forget_memory: null,
  remember: null,
  log_meeting_notes: null,
  report_generate: null,
  ask_user: null,
  switch_to_plan_mode: null,
  get_recipient_context: null,
  get_contact_context: null,
  remember_about_contact: null,
  memory_search: null,
  memory_save: null,
  update_user_model: null,
  memory_get_contact_profile: null,
  claim_worklist_items: null,
  check_draft_quality: null,
  record_processed_items: null,
  calendar_timezone_intelligence: null,
  memory_unlimited_scan: null,
  memory_bulk_save_learning: null,
  generate_email_sequence: null,
  generate_proposal_documents: null,
  generate_client_reports: null,
  generate_sow_documents: null,
  generate_internal_documentation: 'notion',
  web_search_unlimited: null,
  company_intelligence_research: null,
  contact_research_and_verification: null,
  agent_task_queue_management: null,
  error_recovery_and_retries: null,
  performance_monitoring_and_optimization: null,
  output_formatting_and_presentation: null,
  get_delegation_rules: null,
  create_delegation_rule: null,
  surface_proactive_signals: null,
};

export const INTEGRATION_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  gcal: 'Google Calendar',
  notion: 'Notion',
  notion_calendar: 'Notion Calendar',
  slack: 'Slack',
  cal_com: 'Cal.com',
};

/**
 * Inverse: integration → tools[]. Built once at module load.
 */
export function toolsForIntegration(integration: string): string[] {
  const out: string[] = [];
  for (const [tool, req] of Object.entries(TOOL_INTEGRATION_MAP)) {
    if (req === integration) out.push(tool);
  }
  // Notion + notion_calendar share the same tool set
  if (integration === 'notion_calendar') {
    for (const [tool, req] of Object.entries(TOOL_INTEGRATION_MAP)) {
      if (req === 'notion') out.push(tool);
    }
  }
  return [...new Set(out)];
}

// ── PART 39b — VA ownership map ───────────────────────────────────────────────
//
// Maps each tool to the five-VA personas the system prompt teaches the LLM
// to think with: inbox, calendar, crm, comms, research. Used by
// getAvailableTools to narrow the surface to only the VAs a turn actually
// touches — the LLM picks better tools first try when the set is smaller.
//
// Tools NOT in this map (open_canvas, ask_user, request_confirmation,
// create_scheduled_agent, the orchestration utilities, etc.) are treated as
// "utility" and are ALWAYS included regardless of which VAs were dispatched
// — these are the tools the LLM needs every turn regardless of intent.

export type BoultVA = 'inbox' | 'calendar' | 'crm' | 'comms' | 'research';

export const TOOL_VA_OWNERSHIP: Record<string, BoultVA[]> = {
  // 📧 Inbox VA
  search_gmail: ['inbox'],
  gmail_unlimited_search: ['inbox'],
  read_email: ['inbox'],
  gmail_read_thread: ['inbox'],
  gmail_bulk_read_threads: ['inbox'],
  get_sent_emails: ['inbox'],
  gmail_extract_data_from_threads: ['inbox'],
  gmail_detect_urgency: ['inbox'],
  gmail_detect_conversation_type: ['inbox'],
  gmail_get_labels: ['inbox'],
  gmail_apply_label: ['inbox'],
  gmail_auto_label_threads: ['inbox'],
  gmail_archive_thread: ['inbox'],
  gmail_auto_archive_threads: ['inbox'],
  digest_newsletters: ['inbox'],
  check_followups: ['inbox'],
  draft_reply: ['inbox'],
  draft_cold_email: ['inbox'],
  draft_review: ['inbox'],
  gmail_batch_draft_replies: ['inbox'],
  gmail_generate_auto_replies: ['inbox'],
  send_email: ['inbox'],
  gmail_batch_send_emails: ['inbox'],
  schedule_email_send: ['inbox'],
  list_scheduled_emails: ['inbox'],
  cancel_scheduled_email: ['inbox'],
  build_worklist: ['inbox'],
  check_draft_quality: ['inbox'],
  get_voice_profile: ['inbox'],
  voice_profile_generate: ['inbox'],
  voice_profile_update: ['inbox'],
  gmail_get_profile: ['inbox'],

  // 📅 Calendar VA
  get_calendar_events: ['calendar'],
  calendar_get_availability: ['calendar'],
  calendar_unlimited_scan: ['calendar'],
  calendar_auto_detect_conflicts: ['calendar'],
  calendar_timezone_intelligence: ['calendar'],
  calendar_generate_free_time_blocks: ['calendar'],
  calendar_buffer_time_insertion: ['calendar'],
  calendar_meeting_prep_automation: ['calendar'],
  calendar_auto_generate_meet_links: ['calendar'],
  calendar_auto_decline_low_priority: ['calendar'],
  schedule_meeting: ['calendar'],
  calendar_batch_create_events: ['calendar'],
  calendar_cancel_event: ['calendar'],
  calcom_list_event_types: ['calendar'],
  calcom_get_slots: ['calendar'],
  calcom_create_booking: ['calendar'],
  calcom_list_bookings: ['calendar'],
  calcom_cancel_booking: ['calendar'],

  // 📝 CRM VA (Notion)
  search_notion: ['crm'],
  notion_read_page: ['crm'],
  notion_read_database: ['crm', 'research'], // leads/CRM rows reader — used by outreach intake
  fetch_notion_schema: ['crm'],
  notion_get_calendar_events: ['crm', 'calendar'], // Notion calendar straddles two VAs
  create_notion_page: ['crm'],
  notion_create_task: ['crm'],
  notion_batch_create_database_entries: ['crm'],
  notion_auto_create_contact_profiles: ['crm', 'research'],
  notion_auto_log_all_communication: ['crm', 'inbox'],
  notion_auto_update_project_status: ['crm'],
  notion_auto_generate_meeting_notes: ['crm', 'calendar'],
  notion_deal_tracking_automation: ['crm'],
  notion_create_smart_dashboards: ['crm'],
  notion_link_related_items: ['crm'],
  notion_auto_archive_completed_work: ['crm'],
  notion_generate_weekly_summaries: ['crm'],
  generate_internal_documentation: ['crm'],

  // 💬 Comms VA (Slack + cross-channel delivery)
  send_slack_message: ['comms'],
  slack_send_dm: ['comms'],
  slack_find_user: ['comms'],
  slack_get_channels: ['comms'],
  slack_post_daily_briefing: ['comms'],
  slack_real_time_urgent_alerts: ['comms'],
  slack_team_digest_weekly: ['comms'],
  slack_deal_update_notifications: ['comms'],
  slack_task_assignment_notifications: ['comms'],
  slack_approval_request_routing: ['comms'],
  report_send_gmail: ['comms'],
  report_send_slack: ['comms'],
  report_generate: ['comms'],

  // 🔍 Research VA
  web_search: ['research'],
  web_search_instant: ['research'],
  web_search_unlimited: ['research'],
  company_intelligence_research: ['research'],
  contact_research_and_verification: ['research'],
  generate_proposal_documents: ['research'],
  generate_email_sequence: ['research', 'inbox'],
  generate_client_reports: ['research'],
  generate_sow_documents: ['research'],
  get_recipient_context: ['research', 'inbox'],
  get_contact_context: ['research'],
  remember_about_contact: ['research'],
  memory_search: ['research'],
  memory_save: ['research'],
  update_user_model: ['research'],
  memory_get_contact_profile: ['research'],
  memory_unlimited_scan: ['research'],
  memory_bulk_save_learning: ['research'],
  memory_relationship_intelligence: ['research'],
  surface_proactive_signals: ['research'],

  // Tools NOT mapped above (open_canvas, update_canvas, ask_user,
  // request_confirmation, create_scheduled_agent, agent_task_queue_management,
  // error_recovery_and_retries, performance_monitoring_and_optimization,
  // output_formatting_and_presentation, claim_worklist_items,
  // record_processed_items, get_delegation_rules, create_delegation_rule)
  // are utility tools — getAvailableTools treats them as always-included
  // regardless of VA filter.
};

/**
 * Returns true when the tool should be exposed to the LLM given the set of
 * VAs the dispatcher routed to. Always returns true when:
 *   - relevantVAs is empty/undefined (no filtering active — backwards compat)
 *   - the tool isn't in TOOL_VA_OWNERSHIP (utility tools)
 *   - the tool's VA list intersects relevantVAs
 */
export function toolMatchesAnyVA(toolName: string, relevantVAs: BoultVA[] | undefined): boolean {
  if (!relevantVAs?.length) return true;
  const owners = TOOL_VA_OWNERSHIP[toolName];
  if (!owners?.length) return true; // utility tool — always available
  return owners.some(va => relevantVAs.includes(va));
}
