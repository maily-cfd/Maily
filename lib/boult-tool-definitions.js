/**
 * Boult Tool Definitions — Phase 2: Enhanced Agentic Loop
 *
 * Formal schemas the AI receives so it can "call" tools by name.
 * Each definition is purely declarative — actual execution lives in
 * boult-execution-gateway.js and the adapter files.
 *
 * The agent loop serialises these into the system prompt so the LLM
 * knows exactly what it can do, what params are required, and which
 * actions need user approval before running.
 *
 * Philosophy: Tool First, Talk Later. Aggressive data fetching.
 */

// ─── Risk levels ────────────────────────────────────────────────────────────
// low    → read-only, safe to auto-execute. Use immediately.
// medium → creates something (task, page) but easily reversible
// high   → sends email, schedules meeting with externals — needs approval

export const TOOL_DEFINITIONS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // GMAIL — Read Operations (Use aggressively, no permission needed)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'search_inbox',
    description: 'Search Gmail inbox. USE THIS FIRST for any email-related query. Returns subject, sender, date, snippet. Query syntax: from:, subject:, newer_than:7d, has:attachment, is:unread, label:important',
    parameters: {
      query: { type: 'string', required: true, description: 'Gmail search query. Examples: "from:client@company.com newer_than:7d", "subject:invoice has:attachment", "is:unread from:boss"' },
      maxResults: { type: 'number', required: false, default: 15, description: 'Max results (1-50). Default 15.' }
    },
    riskLevel: 'low',
    requiresApproval: false,
    category: 'email',
    idempotent: true
  },
  {
    name: 'read_email',
    description: 'Read full email content by message ID. Use after search_inbox to get thread context, full body, attachments info.',
    parameters: {
      messageId: { type: 'string', required: true, description: 'Gmail message ID from search_inbox results' }
    },
    riskLevel: 'low',
    requiresApproval: false,
    category: 'email',
    idempotent: true
  },
  {
    name: 'analyze_thread',
    description: 'Deep analysis of email thread for opportunities, action items, sentiment, urgency. Returns structured intelligence.',
    parameters: {
      messageId: { type: 'string', required: true, description: 'Message ID from search results to analyze' },
      analysisType: { type: 'string', required: false, default: 'full', description: 'Type: full, opportunities, action_items, sentiment, urgency' }
    },
    riskLevel: 'low',
    requiresApproval: false,
    category: 'email',
    idempotent: true
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GMAIL — Write
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'archive_email',
    description: 'Archive an email in Gmail. Use this to remove newsletters, noise, or completed items from the inbox.',
    parameters: {
      messageId: { type: 'string', required: true, description: 'Gmail message ID to archive' }
    },
    riskLevel: 'medium',
    requiresApproval: false,
    category: 'email',
    idempotent: true
  },
  {
    name: 'send_email',
    description: 'Send an email via Gmail. Use this when the user explicitly wants to SEND (not draft). High-risk: requires approval.',
    parameters: {
      to: { type: 'string', required: true, description: 'Recipient email address' },
      subject: { type: 'string', required: true, description: 'Email subject line' },
      body: { type: 'string', required: true, description: 'Email body (plain text or markdown)' },
      threadId: { type: 'string', required: false, description: 'Thread ID if this is a reply' }
    },
    riskLevel: 'high',
    requiresApproval: true,
    category: 'email',
    idempotent: false
  },
  {
    name: 'save_draft',
    description: 'Save an email as a draft in Gmail. Safe: the user can review before sending.',
    parameters: {
      to: { type: 'string', required: false, description: 'Recipient email (optional for drafts)' },
      subject: { type: 'string', required: true, description: 'Draft subject' },
      body: { type: 'string', required: true, description: 'Draft body' }
    },
    riskLevel: 'medium',
    requiresApproval: false,
    category: 'email',
    idempotent: false
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CALENDAR
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'schedule_meeting',
    description: 'Create a calendar event in Google Calendar. Requires approval if attendees include external domains.',
    parameters: {
      summary: { type: 'string', required: true, description: 'Meeting title' },
      start: { type: 'string', required: true, description: 'Start time in ISO-8601' },
      end: { type: 'string', required: true, description: 'End time in ISO-8601' },
      attendees: { type: 'array', required: false, description: 'List of attendee email addresses' },
      description: { type: 'string', required: false, description: 'Meeting description/agenda' },
      location: { type: 'string', required: false, description: 'Location or video link' }
    },
    riskLevel: 'high',
    requiresApproval: true,
    category: 'calendar',
    idempotent: false
  },
  {
    name: 'check_availability',
    description: 'Check the user\'s calendar availability for a given date range.',
    parameters: {
      startDate: { type: 'string', required: true, description: 'Start of range (ISO-8601)' },
      endDate: { type: 'string', required: true, description: 'End of range (ISO-8601)' }
    },
    riskLevel: 'low',
    requiresApproval: false,
    category: 'calendar',
    idempotent: true
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GOOGLE TASKS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'create_task',
    description: 'Add a task to Google Tasks.',
    parameters: {
      title: { type: 'string', required: true, description: 'Task title' },
      notes: { type: 'string', required: false, description: 'Additional notes' },
      due: { type: 'string', required: false, description: 'Due date (ISO-8601)' },
      taskListTitle: { type: 'string', required: false, default: 'Boult Tasks', description: 'Task list name' }
    },
    riskLevel: 'low',
    requiresApproval: false,
    category: 'tasks',
    idempotent: false
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'notion_create_page',
    description: 'Create a new page in the user\'s Notion workspace.',
    parameters: {
      title: { type: 'string', required: true, description: 'Page title' },
      content: { type: 'string', required: false, description: 'Page body content (markdown)' },
      tags: { type: 'array', required: false, description: 'Tags for the page' }
    },
    riskLevel: 'medium',
    requiresApproval: false,
    category: 'notion',
    idempotent: false
  },
  {
    name: 'notion_search',
    description: 'Search the user\'s Notion workspace.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search query' },
      limit: { type: 'number', required: false, default: 10, description: 'Max results' }
    },
    riskLevel: 'low',
    requiresApproval: false,
    category: 'notion',
    idempotent: true
  },
  {
    name: 'notion_update_page',
    description: 'Update an existing Notion page (e.g., a CRM record).',
    parameters: {
      pageId: { type: 'string', required: true, description: 'Notion Page ID' },
      properties: { type: 'string', required: true, description: 'JSON string of properties to update (e.g. {"Status": "Follow-up", "Last Contacted": "2026-05-16"})' }
    },
    riskLevel: 'medium',
    requiresApproval: false,
    category: 'notion',
    idempotent: false
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY — No side effects
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'think',
    description: 'Internal reasoning step. Use this when you need to analyse data, make a decision, or plan your next move before calling another tool. No external side effects.',
    parameters: {
      reasoning: { type: 'string', required: true, description: 'Your internal reasoning (visible to the user as a "thinking" step)' }
    },
    riskLevel: 'low',
    requiresApproval: false,
    category: 'internal',
    idempotent: true
  },
  {
    name: 'save_memory',
    description: 'Save important context or preferences about the user to long-term memory (Supermemory). Use this when the user mentions something you should remember for future conversations.',
    parameters: {
      memory: { type: 'string', required: true, description: 'The specific fact or preference to remember.' }
    },
    riskLevel: 'low',
    requiresApproval: false,
    category: 'internal',
    idempotent: true
  },
  {
    name: 'open_canvas',
    description: 'Open the Canvas Panel for bigger tasks like writing long-form content, building reports, creating structured documents, or designing outreach sequences. High-risk: requires approval. If approved, you can work in the canvas. If denied, do the work in chat.',
    parameters: {
      reason: { type: 'string', required: true, description: 'Why you need to open the canvas' }
    },
    riskLevel: 'high',
    requiresApproval: true,
    category: 'internal',
    idempotent: false
  },
  {
    name: 'respond',
    description: 'Send a final conversational response to the user. Use this when you have all the information needed and want to present your answer. CRITICAL: For summaries, de-prioritize or ignore promotional/marketing emails (Spotify, newsletters, etc) unless they contain high-value info. Focus on actual correspondence and action items.',
    parameters: {
      message: { type: 'string', required: true, description: 'The response message to show the user (supports markdown)' },
      wait_for_user: { type: 'boolean', required: false, default: true, description: 'If true, the agent stops and waits for user input. If false, the agent sends the message but continues executing tools (use this for status/roadmap updates).' }
    },
    riskLevel: 'low',
    requiresApproval: false,
    category: 'internal',
    idempotent: true
  }
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Look up a tool by name */
export function getToolDefinition(name) {
  return TOOL_DEFINITIONS.find(t => t.name === name) || null;
}

/** Get all tool names */
export function getToolNames() {
  return TOOL_DEFINITIONS.map(t => t.name);
}

/** Get tools that require approval */
export function getApprovalRequiredTools() {
  return TOOL_DEFINITIONS.filter(t => t.requiresApproval).map(t => t.name);
}

/**
 * Build a condensed tool description block for the AI system prompt.
 * This is what the LLM "sees" so it knows what tools are available.
 */
export function buildToolPromptBlock() {
  const lines = TOOL_DEFINITIONS.map(tool => {
    const params = Object.entries(tool.parameters)
      .map(([key, spec]) => {
        const req = spec.required ? 'REQUIRED' : 'optional';
        return `      ${key} (${spec.type}, ${req}): ${spec.description}`;
      })
      .join('\n');

    const approval = tool.requiresApproval ? ' [REQUIRES USER APPROVAL]' : '';
    return `  - ${tool.name}${approval}: ${tool.description}\n    Parameters:\n${params}`;
  });

  return `## Available Tools\nYou can call these tools by outputting a JSON tool_call block. Call ONE tool at a time.\n\n${lines.join('\n\n')}`;
}
