/**
 * Boult V3 — Tool definitions for Claude's tool_use format.
 *
 * Sent to the LLM on every request so it can decide which tools to call.
 * Executor maps these names to real API calls.
 *
 * Design notes:
 * - schedule_meeting auto-mirrors to Notion Calendar inside the executor.
 *   The LLM does not need to remember to do it.
 * - create_notion_page resolves the target database by name search each
 *   call (e.g. databaseHint: "meetings"). It then introspects the DB schema
 *   and maps the supplied fields to real property names — no hard-coded
 *   field names, no invented schemas.
 * - send_slack_message accepts either a #channel, channel ID, or a person's
 *   email (which is resolved to a DM via users.lookupByEmail).
 * - request_approval is the gate before any send/create/post. The LLM must
 *   call it FIRST when the user gave a write instruction, and only proceed
 *   to the actual write tools after the user replies affirmatively on the
 *   following turn.
 */

export const BOULT_TOOLS = [
  // ─── Gmail ────────────────────────────────────────────────────────────────
  {
    name: 'search_gmail',
    description:
      'Search the user\'s Gmail inbox. Accepts any Gmail search operator: from:, to:, subject:, is:unread, is:starred, has:attachment, after:YYYY/MM/DD, before:YYYY/MM/DD. Returns email summaries with IDs you pass to read_email.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query string' },
        maxResults: { type: 'number', description: 'Max emails to return (default 10, max 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_email',
    description:
      'Read the full content of a specific email including body, sender, recipients, and date. Pass the messageId from search_gmail results.',
    input_schema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Gmail message ID' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'read_thread',
    description:
      'Read every message in a Gmail thread in order. Use this when the user says things like "wrap up my conversation with X" or "summarize my thread with Y" — you need the whole thread, not just one message.',
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Gmail thread ID' },
      },
      required: ['threadId'],
    },
  },
  {
    name: 'draft_reply',
    description:
      'Create a Gmail draft reply to an email. The draft is saved and shown in the canvas panel for the user to review before sending. Use this when the user asks you to write, compose, or draft an email response.',
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Gmail thread ID' },
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject (typically "Re: <original subject>")' },
        body: { type: 'string', description: 'Email body in plain text' },
        inReplyToMessageId: {
          type: 'string',
          description: 'The Message-ID header of the email being replied to (for proper threading)',
        },
      },
      required: ['threadId', 'to', 'body'],
    },
  },
  {
    name: 'send_email',
    description:
      'Actually send an email (not a draft). NEVER call this without first calling request_approval and getting an affirmative reply from the user on a subsequent turn. The only exception is when the user has explicitly enabled Skip Confirmations for the current background-agent run.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body in plain text' },
        threadId: { type: 'string', description: 'Optional: Gmail thread ID if this is a reply' },
        inReplyToMessageId: { type: 'string', description: 'Optional: Message-ID header for threading' },
      },
      required: ['to', 'subject', 'body'],
    },
  },

  // ─── Notion ───────────────────────────────────────────────────────────────
  {
    name: 'read_notion',
    description:
      "Search and read the user's Notion workspace. Returns page titles, IDs, URLs, and content summaries.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max pages to return (default 5, max 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_notion_page',
    description:
      'Create a new page in a Notion database. Use this to log meetings, conversations, contact notes, action items, or anything else the user wants persisted. Boult searches the workspace for a database matching databaseHint and introspects its schema, so you do NOT need to know the exact property names — pass the semantic fields (title, date, notes, status, url, people) and Boult maps them. NEVER call this without first calling request_approval and getting an affirmative reply.',
    input_schema: {
      type: 'object',
      properties: {
        databaseHint: {
          type: 'string',
          description:
            "Plain-language hint for which database to target, e.g. 'meetings', 'tasks', 'contacts', 'CRM', 'projects'. Boult searches Notion for a database whose title contains this hint.",
        },
        title: { type: 'string', description: 'Page title (mapped to the database\'s title property)' },
        date: { type: 'string', description: 'Optional ISO 8601 date (mapped to first date-type property)' },
        notes: { type: 'string', description: 'Optional notes / description / what was discussed (mapped to first rich-text property)' },
        status: { type: 'string', description: 'Optional status value (mapped to first status/select property; must match an existing option)' },
        url: { type: 'string', description: 'Optional URL (mapped to first url property)' },
        actionItems: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of action items, rendered as a to-do block on the page',
        },
      },
      required: ['databaseHint', 'title'],
    },
  },
  {
    name: 'create_notion_task',
    description:
      'Convenience wrapper around create_notion_page targeting a tasks database. NEVER call without prior approval from the user.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        dueDate: { type: 'string', description: 'Optional ISO 8601 due date' },
        notes: { type: 'string', description: 'Optional context / description' },
        status: { type: 'string', description: 'Optional initial status (e.g. "Not started", "To do")' },
      },
      required: ['title'],
    },
  },

  // ─── Calendars ────────────────────────────────────────────────────────────
  {
    name: 'read_combined_calendar',
    description:
      "Read events from BOTH Google Calendar and Notion Calendar (Notion databases that contain a date property) for a date range, merged into a single timeline. Use this for 'what does my week look like', 'what's on my schedule tomorrow', etc.",
    input_schema: {
      type: 'object',
      properties: {
        rangeStart: { type: 'string', description: 'ISO 8601 start (inclusive)' },
        rangeEnd: { type: 'string', description: 'ISO 8601 end (exclusive)' },
      },
      required: ['rangeStart', 'rangeEnd'],
    },
  },
  {
    name: 'schedule_meeting',
    description:
      "Create a meeting on Google Calendar with an optional Google Meet link, AND automatically mirror it to the user's Notion Calendar database. Both calendars stay in sync — you do not need to call any other tool to mirror. NEVER call without first calling request_approval.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Meeting title' },
        startTime: { type: 'string', description: 'ISO 8601 start with timezone' },
        endTime: { type: 'string', description: 'ISO 8601 end with timezone' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Attendee email addresses',
        },
        description: { type: 'string', description: 'Meeting description or agenda' },
        createMeetLink: { type: 'boolean', description: 'Create a Google Meet link (default true)' },
      },
      required: ['title', 'startTime', 'endTime'],
    },
  },

  // ─── Slack ────────────────────────────────────────────────────────────────
  {
    name: 'find_slack_user',
    description:
      'Look up a Slack user by email or display name. Returns the Slack user ID you can use as the channel for a direct message. Use this BEFORE send_slack_message when the user names a person rather than a channel.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email address of the person' },
        name: { type: 'string', description: 'Display name (used as fallback if email lookup fails)' },
      },
    },
  },
  {
    name: 'send_slack_message',
    description:
      "Send a Slack message to a channel (#name or channel ID) or directly to a user (user ID from find_slack_user). NEVER call without first calling request_approval. The only exception is background-agent runs with Skip Confirmations enabled.",
    input_schema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: "Channel name (e.g. '#standup'), channel ID, or user ID for a DM",
        },
        text: { type: 'string', description: 'Message text — match the user\'s natural conversational tone' },
        thread_ts: { type: 'string', description: 'Optional: parent message timestamp to reply in-thread' },
      },
      required: ['channel', 'text'],
    },
  },

  // ─── Memory (Supermemory) ─────────────────────────────────────────────────
  {
    name: 'search_memory',
    description:
      "Search the user's long-term memory (Supermemory) for relevant context about people, projects, preferences, past conversations, or stated facts. Call this EARLY in any substantive task — relationship weight, tone preferences, and history live here. Returns the top matches with their text.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to recall (e.g. "Priya client relationship", "Friday afternoon email preferences")' },
        limit: { type: 'number', description: 'Max memories to return (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_memory',
    description:
      "Save a fact to long-term memory so Boult remembers it across future conversations. Use this when the user states a preference, a relationship weight ('Priya is my biggest client'), a recurring constraint, or any context that should outlive this conversation. Do NOT save ephemeral state.",
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact to remember, written as a complete sentence' },
        category: {
          type: 'string',
          enum: ['preference', 'relationship', 'context', 'constraint'],
          description: 'Type of memory',
        },
      },
      required: ['content'],
    },
  },

  // ─── Scheduled background agents ──────────────────────────────────────────
  {
    name: 'create_scheduled_agent',
    description:
      'Create a real, persistent background agent that runs on a recurring cron schedule. This is NOT a draft — calling this tool inserts an agent row in the database and the cron runner picks it up automatically. After creation, render a confirmation card by including the returned card data; do not call open_canvas. Use this when the user describes a recurring task ("every morning at 7am search my inbox for X", "every Friday afternoon summarize Y", "twice a week ping me about Z"). NEVER call without first calling request_approval and getting an affirmative reply, except when the user gave a clearly self-describing schedule instruction (then a one-line confirmation in your chat is enough; you still call request_approval first if any ambiguity remains about timezone, channel, or skip-confirmations).',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Short, human-readable agent name (e.g. "Morning Client Reply Sweep", "Friday Pipeline Recap")',
        },
        task_description: {
          type: 'string',
          description: "The full instruction the agent executes every time it fires. Write it as a self-contained, direct command — include WHAT to search/read, HOW to filter, what to draft or send, and what to deliver in the report. The runner will only see this string; it will not see this chat. So include all context: 'Search Gmail for unanswered emails from existing clients in the last 7 days, study my last 30 sent emails to match my tone, draft a personalized reply for each thread, then email me a summary with a link to each draft.'",
        },
        cron_schedule: {
          type: 'string',
          description: '5-field cron expression "m h dom mon dow" in the user\'s LOCAL time (the cron runner handles TZ conversion). Examples: "0 7 * * *" daily at 07:00, "0 17 * * 5" Friday at 17:00, "30 9 * * 1-5" weekdays at 09:30, "*/30 * * * *" every 30 minutes.',
        },
        output_channel: {
          type: 'string',
          enum: ['gmail', 'slack', 'both'],
          description: 'Where the agent\'s report is delivered each run. Default "gmail".',
        },
        slack_channel: {
          type: 'string',
          description: 'Slack channel name (e.g. "#daily-recap") or user ID — required only when output_channel is "slack" or "both".',
        },
        skip_confirmations: {
          type: 'boolean',
          description: 'If true, the agent EXECUTES write actions (send, post, create) without asking for approval — there is no user present to confirm at run time. If false (default), the agent only drafts/reads and reports what it would have done.',
        },
        expires_at: {
          type: 'string',
          description: 'Optional ISO date (YYYY-MM-DD). Past this date the agent auto-pauses. Omit for no expiry.',
        },
      },
      required: ['name', 'task_description', 'cron_schedule'],
    },
  },

  // ─── Web Search ───────────────────────────────────────────────────────────
  {
    name: 'web_search',
    description:
      'Search the internet for current information, news, company details, people, or any topic not in the user\'s connected apps. Use this when the user asks about something external (e.g. "what\'s the latest on X", "who is Y", "find info about Z"). Returns summarized results.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results to return (default 5)' },
      },
      required: ['query'],
    },
  },

  // ─── Canvas / Approval ────────────────────────────────────────────────────
  {
    name: 'open_canvas',
    description:
      'Open the canvas panel on the right side of the screen with formatted markdown. Use for long-form output: reports, summaries, meeting prep docs, combined schedules, draft reviews. Anything that produces a substantial output goes to Canvas. Short confirmations and status updates stay in chat — do not open canvas for those.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Canvas panel title' },
        type: {
          type: 'string',
          enum: ['document', 'report', 'sequence', 'summary'],
          description: 'Content type',
        },
        markdown: { type: 'string', description: 'Full markdown content' },
      },
      required: ['title', 'markdown'],
    },
  },
  {
    name: 'request_approval',
    description:
      "Ask the user to approve a plan before executing any write/send/create/modify action. Call this FIRST whenever the next step would send an email, post to Slack, create a calendar event, or create/modify a Notion page. The tool returns a marker — after calling it you MUST stop and end your turn with a one-sentence summary of what you'll do, ending with a question like 'OK to proceed?'. The user will reply on the next turn; only then execute the action tools.",
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: "One sentence describing exactly what you're about to do, in second person (e.g. 'Send the draft to priya@acme.com and log the meeting to your Meetings database')",
        },
        actions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Bullet list of the concrete steps you will take if approved',
        },
      },
      required: ['summary'],
    },
  },
];
