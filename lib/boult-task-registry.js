import {
    APPROVAL_MODE,
    DEFAULT_RETRY_POLICY,
    RISK_ASSESSMENT
} from './boult-execution-contract.js';

/**
 * Boult Task Registry - Phase 1 Canonical
 * Central schema-driven definition of all agentic domains and actions.
 * 
 * Every action now includes:
 * - deterministic input schema (inputSchema, requiredInputs)
 * - approval mode (auto/manual/conditional)
 * - retry policy (maxAttempts, strategy, backoff)
 * - risk assessment (low/medium/high/critical)
 * - idempotency support
 * - auditable result structure
 */

export const BOULT_DOMAINS = {
    EMAIL: 'email',
    MEETING: 'meeting',
    ANALYTICS: 'analytics',
    PLAN: 'plan',
    NOTE: 'note',
    NOTION: 'notion',
    TASKS: 'tasks',
    GENERIC: 'generic'
};

export const BOULT_ACTIONS = {
    // Email Domain
    SEND_EMAIL: 'send_email',
    SEND_INTRO: 'boult_outreach',
    SAVE_DRAFT: 'save_draft',
    READ_THREAD: 'read_thread',
    SEARCH_EMAIL: 'search_email',
    READ_INBOX: 'boult_inbox_review',
    AUTO_REPLY: 'boult_auto_pilot',

    // Meeting Domain
    SCHEDULE_MEETING: 'schedule_meeting',
    GET_AVAILABILITY: 'get_availability',

    // Analytics Domain
    GENERATE_ANALYTICS: 'generate_analytics',
    REFRESH_ANALYTICS: 'refresh_analytics',

    // Note Domain
    CREATE_NOTE: 'create_note',
    FIND_NOTE: 'find_note',

    // Plan Domain
    EXECUTE_PLAN: 'execute_plan',
    APPROVE_PLAN: 'approve_plan',

    // Notion Domain (NEW)
    NOTION_CREATE_PAGE: 'notion_create_page',
    NOTION_SEARCH: 'notion_search',
    NOTION_APPEND: 'notion_append',

    // Google Tasks Domain (NEW)
    TASKS_CREATE_LIST: 'tasks_create_list',
    TASKS_ADD_TASK: 'tasks_add_task',
    TASKS_ADD_TASKS: 'tasks_add_tasks',
    TASKS_COMPLETE: 'tasks_complete_task',
    TASKS_LIST: 'tasks_list',

    // Integration Actions - Google Calendar (Phase 4)
    GOOGLE_CALENDAR_CREATE_MEETING: 'google_calendar_create_meeting',
    GOOGLE_CALENDAR_UPDATE_MEETING: 'google_calendar_update_meeting',
    GOOGLE_CALENDAR_DELETE_MEETING: 'google_calendar_delete_meeting',
    GOOGLE_CALENDAR_LIST_EVENTS: 'google_calendar_list_events',
    GOOGLE_CALENDAR_GET_AVAILABILITY: 'google_calendar_get_availability',

    // Integration Actions - Cal.com (Phase 4)
    CAL_COM_CREATE_BOOKING: 'cal_com_create_booking',
    CAL_COM_GET_BOOKING_LINK: 'cal_com_get_booking_link',
    CAL_COM_LIST_EVENT_TYPES: 'cal_com_list_event_types',
    CAL_COM_RESCHEDULE: 'cal_com_reschedule',
    CAL_COM_CANCEL: 'cal_com_cancel',

    // Integration Actions - Google Tasks (Phase 4)
    GOOGLE_TASKS_CREATE_TASK: 'google_tasks_create_task',
    GOOGLE_TASKS_UPDATE_TASK: 'google_tasks_update_task',
    GOOGLE_TASKS_COMPLETE_TASK: 'google_tasks_complete_task',
    GOOGLE_TASKS_DELETE_TASK: 'google_tasks_delete_task',
    GOOGLE_TASKS_LIST: 'google_tasks_list',

    // Integration Actions - Notion (Phase 4)
    NOTION_QUERY_DATABASE: 'notion_query_database',
    NOTION_CREATE_DATABASE_ITEM: 'notion_create_database_item',
    NOTION_GET_PAGE: 'notion_get_page',
    NOTION_UPDATE_PAGE: 'notion_update_page',
    NOTION_APPEND_BLOCKS: 'notion_append_blocks',
    
    // Generic
    GENERIC_TASK: 'generic_task'
};

export const TASK_REGISTRY = {
    [BOULT_ACTIONS.SEND_EMAIL]: {
        id: BOULT_ACTIONS.SEND_EMAIL,
        domain: BOULT_DOMAINS.EMAIL,
        label: 'Protocol_Send',
        description: 'Send an email to external recipients',
        mutating: true,
        idempotent: true, // Same payload = same result (message sent)
        requiredInputs: ['to', 'subject', 'body'],
        inputSchema: {
            to: { type: 'string', label: 'Recipient', format: 'email' },
            subject: { type: 'string', label: 'Subject' },
            body: { type: 'string', label: 'Body', multiline: true },
            cc: { type: 'array', label: 'CC', optional: true, itemType: 'email' },
            bcc: { type: 'array', label: 'BCC', optional: true, itemType: 'email' },
            threadId: { type: 'string', label: 'Thread ID', optional: true },
            isHtml: { type: 'boolean', label: 'HTML Format', defaultValue: false, optional: true }
        },
        // Phase 1: Execution Contract Fields
        approvalMode: APPROVAL_MODE.CONDITIONAL, // Manual for external, auto for internal
        riskAssessment: RISK_ASSESSMENT.HIGH, // External communication
        retryPolicy: {
            ...DEFAULT_RETRY_POLICY,
            maxAttempts: 3,
            strategy: 'exponential',
            retryableErrors: ['network', 'timeout', 'rate_limit', 'service_unavailable']
        },
        resultSchema: {
            messageId: { type: 'string', description: 'Gmail message ID' },
            threadId: { type: 'string', description: 'Gmail thread ID' },
            sentAt: { type: 'string', format: 'datetime' }
        },
        auditFields: ['to', 'subject', 'sentAt', 'messageId']
    },
    [BOULT_ACTIONS.SAVE_DRAFT]: {
        id: BOULT_ACTIONS.SAVE_DRAFT,
        domain: BOULT_DOMAINS.EMAIL,
        label: 'Draft_Protocol',
        description: 'Save email as draft without sending',
        mutating: true,
        idempotent: false, // Each save creates a new draft
        requiredInputs: ['body'],
        inputSchema: {
            to: { type: 'string', label: 'Recipient', optional: true, format: 'email' },
            subject: { type: 'string', label: 'Subject', optional: true },
            body: { type: 'string', label: 'Body', multiline: true },
            threadId: { type: 'string', label: 'Thread ID', optional: true },
            isHtml: { type: 'boolean', label: 'HTML Format', defaultValue: false, optional: true }
        },
        // Phase 1: Execution Contract Fields
        approvalMode: APPROVAL_MODE.AUTO, // No approval needed for drafts
        riskAssessment: RISK_ASSESSMENT.LOW,
        retryPolicy: {
            ...DEFAULT_RETRY_POLICY,
            maxAttempts: 2
        },
        resultSchema: {
            draftId: { type: 'string', description: 'Gmail draft ID' },
            threadId: { type: 'string', description: 'Gmail thread ID' }
        },
        auditFields: ['draftId', 'threadId']
    },
    [BOULT_ACTIONS.SEND_INTRO]: {
        id: BOULT_ACTIONS.SEND_INTRO,
        domain: BOULT_DOMAINS.EMAIL,
        label: 'Outreach_Protocol',
        description: 'Send introduction email to new contacts',
        mutating: true,
        idempotent: true,
        requiredInputs: ['to', 'subject', 'body'],
        inputSchema: {
            to: { type: 'string', label: 'Recipient', format: 'email' },
            subject: { type: 'string', label: 'Subject' },
            body: { type: 'string', label: 'Body', multiline: true },
            cc: { type: 'array', label: 'CC', optional: true, itemType: 'email' },
            template: { type: 'string', label: 'Template Name', optional: true }
        },
        // Phase 1: Execution Contract Fields
        approvalMode: APPROVAL_MODE.MANUAL, // Always manual for outreach
        riskAssessment: RISK_ASSESSMENT.HIGH, // External communication
        retryPolicy: {
            ...DEFAULT_RETRY_POLICY,
            maxAttempts: 3,
            strategy: 'exponential'
        },
        resultSchema: {
            messageId: { type: 'string', description: 'Gmail message ID' },
            threadId: { type: 'string', description: 'Gmail thread ID' }
        },
        auditFields: ['to', 'subject', 'template', 'messageId']
    },
    [BOULT_ACTIONS.READ_INBOX]: {
        id: BOULT_ACTIONS.READ_INBOX,
        domain: BOULT_DOMAINS.EMAIL,
        label: 'Inbox_Review',
        description: 'Read and summarize recent inbox messages',
        mutating: false,
        idempotent: true, // Read operations are idempotent
        requiredInputs: [],
        inputSchema: {
            limit: { type: 'number', label: 'Limit', defaultValue: 10, min: 1, max: 50 },
            filter: { type: 'enum', label: 'Filter', options: ['all', 'unread', 'important', 'starred'], defaultValue: 'all', optional: true },
            searchQuery: { type: 'string', label: 'Search Query', optional: true }
        },
        // Phase 1: Execution Contract Fields
        approvalMode: APPROVAL_MODE.AUTO, // Read-only
        riskAssessment: RISK_ASSESSMENT.LOW,
        retryPolicy: {
            ...DEFAULT_RETRY_POLICY,
            maxAttempts: 2,
            strategy: 'fixed'
        },
        resultSchema: {
            emails: { type: 'array', description: 'Array of email objects' },
            count: { type: 'number', description: 'Total emails fetched' }
        },
        auditFields: ['count', 'filter']
    },
    [BOULT_ACTIONS.AUTO_REPLY]: {
        id: BOULT_ACTIONS.AUTO_REPLY,
        domain: BOULT_DOMAINS.EMAIL,
        label: 'Response_Auto_Pilot',
        description: 'Send automated reply to a thread',
        mutating: true,
        idempotent: true,
        requiredInputs: ['body'],
        inputSchema: {
            messageId: { type: 'string', label: 'Message ID', optional: true },
            threadId: { type: 'string', label: 'Thread ID', optional: true },
            body: { type: 'string', label: 'Reply Body', multiline: true },
            replyAll: { type: 'boolean', label: 'Reply All', defaultValue: false },
            isHtml: { type: 'boolean', label: 'HTML Format', defaultValue: false, optional: true }
        },
        // Phase 1: Execution Contract Fields
        approvalMode: APPROVAL_MODE.MANUAL, // Always manual for replies
        riskAssessment: RISK_ASSESSMENT.HIGH, // External communication
        retryPolicy: {
            ...DEFAULT_RETRY_POLICY,
            maxAttempts: 3
        },
        resultSchema: {
            messageId: { type: 'string', description: 'Gmail message ID' },
            threadId: { type: 'string', description: 'Gmail thread ID' }
        },
        auditFields: ['messageId', 'threadId', 'replyAll']
    },
    [BOULT_ACTIONS.SCHEDULE_MEETING]: {
        id: BOULT_ACTIONS.SCHEDULE_MEETING,
        domain: BOULT_DOMAINS.MEETING,
        label: 'Coordinate_Event',
        description: 'Schedule a calendar meeting with attendees',
        mutating: true,
        idempotent: false, // Each call creates a new event
        requiredInputs: ['provider', 'attendees', 'date', 'time'],
        inputSchema: {
            provider: { type: 'enum', options: ['google', 'cal'], label: 'Provider' },
            attendees: { type: 'array', label: 'Attendees', itemType: 'email' },
            date: { type: 'string', label: 'Date', format: 'date' },
            time: { type: 'string', label: 'Time', format: 'time' },
            duration: { type: 'number', label: 'Duration (min)', defaultValue: 30, min: 15, max: 480 },
            agenda: { type: 'string', label: 'Agenda', multiline: true, optional: true },
            title: { type: 'string', label: 'Meeting Title' },
            timezone: { type: 'string', label: 'Timezone', defaultValue: 'UTC', optional: true }
        },
        // Phase 1: Execution Contract Fields
        approvalMode: APPROVAL_MODE.MANUAL, // Always manual for meetings
        riskAssessment: RISK_ASSESSMENT.HIGH, // External coordination
        retryPolicy: {
            ...DEFAULT_RETRY_POLICY,
            maxAttempts: 3
        },
        resultSchema: {
            eventId: { type: 'string', description: 'Calendar event ID' },
            meetingLink: { type: 'string', description: 'Meeting link (Google Meet/Zoom)' },
            attendees: { type: 'array', description: 'Confirmed attendees' }
        },
        auditFields: ['eventId', 'title', 'attendees', 'scheduledAt']
    },
    [BOULT_ACTIONS.GENERATE_ANALYTICS]: {
        id: BOULT_ACTIONS.GENERATE_ANALYTICS,
        domain: BOULT_DOMAINS.ANALYTICS,
        label: 'Insight_Generation',
        mutating: false,
        requiredInputs: ['metricType'],
        inputSchema: {
            metricType: { type: 'string', label: 'Metric Category' },
            dateRange: { type: 'string', label: 'Time Horizon' },
            grouping: { type: 'string', label: 'Data Grouping', optional: true }
        }
    },
    [BOULT_ACTIONS.CREATE_NOTE]: {
        id: BOULT_ACTIONS.CREATE_NOTE,
        domain: BOULT_DOMAINS.NOTE,
        label: 'Thought_Commit',
        mutating: true,
        requiredInputs: ['content'],
        inputSchema: {
            title: { type: 'string', label: 'Note Title', optional: true },
            content: { type: 'string', label: 'Body', multiline: true },
            tags: { type: 'array', label: 'Tags', optional: true }
        }
    },
    [BOULT_ACTIONS.EXECUTE_PLAN]: {
        id: BOULT_ACTIONS.EXECUTE_PLAN,
        domain: BOULT_DOMAINS.PLAN,
        label: 'Strategic_Execution',
        mutating: true,
        requiredInputs: ['steps'],
        inputSchema: {
            objective: { type: 'string', label: 'Mission Objective' },
            steps: { type: 'array', label: 'Action Sequence' }
        }
    },
    [BOULT_ACTIONS.APPROVE_PLAN]: {
        id: BOULT_ACTIONS.APPROVE_PLAN,
        domain: BOULT_DOMAINS.PLAN,
        label: 'Plan_Approval',
        mutating: true,
        requiredInputs: ['planId'],
        inputSchema: {
            planId: { type: 'string', label: 'Plan ID' }
        }
    },

    // ── Notion Actions ───────────────────────────────────────
    [BOULT_ACTIONS.NOTION_CREATE_PAGE]: {
        id: BOULT_ACTIONS.NOTION_CREATE_PAGE,
        domain: BOULT_DOMAINS.NOTION,
        label: 'Notion_Create_Page',
        mutating: true,
        requiredInputs: ['title'],
        inputSchema: {
            title: { type: 'string', label: 'Page Title' },
            content: { type: 'string', label: 'Page Content', multiline: true, optional: true },
            databaseId: { type: 'string', label: 'Database ID', optional: true },
            parentPageId: { type: 'string', label: 'Parent Page ID', optional: true },
            tags: { type: 'array', label: 'Tags', optional: true }
        }
    },
    [BOULT_ACTIONS.NOTION_SEARCH]: {
        id: BOULT_ACTIONS.NOTION_SEARCH,
        domain: BOULT_DOMAINS.NOTION,
        label: 'Notion_Search',
        mutating: false,
        requiredInputs: ['query'],
        inputSchema: {
            query: { type: 'string', label: 'Search Query' },
            filter: { type: 'enum', options: ['page', 'database'], label: 'Filter', optional: true },
            limit: { type: 'number', label: 'Max Results', defaultValue: 10, optional: true }
        }
    },
    [BOULT_ACTIONS.NOTION_APPEND]: {
        id: BOULT_ACTIONS.NOTION_APPEND,
        domain: BOULT_DOMAINS.NOTION,
        label: 'Notion_Append_Content',
        mutating: true,
        requiredInputs: ['pageId', 'content'],
        inputSchema: {
            pageId: { type: 'string', label: 'Page ID' },
            content: { type: 'string', label: 'Content to Append', multiline: true }
        }
    },

    // ── Google Tasks Actions ─────────────────────────────────
    [BOULT_ACTIONS.TASKS_CREATE_LIST]: {
        id: BOULT_ACTIONS.TASKS_CREATE_LIST,
        domain: BOULT_DOMAINS.TASKS,
        label: 'Create_Task_List',
        mutating: true,
        requiredInputs: ['title'],
        inputSchema: {
            title: { type: 'string', label: 'List Title' }
        }
    },
    [BOULT_ACTIONS.TASKS_ADD_TASK]: {
        id: BOULT_ACTIONS.TASKS_ADD_TASK,
        domain: BOULT_DOMAINS.TASKS,
        label: 'Add_Task',
        mutating: true,
        requiredInputs: ['title'],
        inputSchema: {
            title: { type: 'string', label: 'Task Title' },
            notes: { type: 'string', label: 'Notes', optional: true },
            due: { type: 'string', label: 'Due Date (ISO)', optional: true },
            taskListId: { type: 'string', label: 'Task List ID', optional: true }
        }
    },
    [BOULT_ACTIONS.TASKS_ADD_TASKS]: {
        id: BOULT_ACTIONS.TASKS_ADD_TASKS,
        domain: BOULT_DOMAINS.TASKS,
        label: 'Add_Multiple_Tasks',
        mutating: true,
        requiredInputs: ['tasks'],
        inputSchema: {
            tasks: { type: 'array', label: 'Tasks Array (each: { title, notes?, due? })' },
            taskListId: { type: 'string', label: 'Task List ID', optional: true },
            taskListTitle: { type: 'string', label: 'Task List Title (auto-creates)', optional: true }
        }
    },
    [BOULT_ACTIONS.TASKS_COMPLETE]: {
        id: BOULT_ACTIONS.TASKS_COMPLETE,
        domain: BOULT_DOMAINS.TASKS,
        label: 'Complete_Task',
        mutating: true,
        requiredInputs: ['taskListId', 'taskId'],
        inputSchema: {
            taskListId: { type: 'string', label: 'Task List ID' },
            taskId: { type: 'string', label: 'Task ID' }
        }
    },
    [BOULT_ACTIONS.TASKS_LIST]: {
        id: BOULT_ACTIONS.TASKS_LIST,
        domain: BOULT_DOMAINS.TASKS,
        label: 'List_Tasks',
        mutating: false,
        requiredInputs: [],
        inputSchema: {
            taskListId: { type: 'string', label: 'Task List ID', optional: true },
            showCompleted: { type: 'boolean', label: 'Show Completed', defaultValue: false, optional: true }
        }
    },

    // ── Integration Actions - Google Calendar (Phase 4) ───────
    [BOULT_ACTIONS.GOOGLE_CALENDAR_CREATE_MEETING]: {
        id: BOULT_ACTIONS.GOOGLE_CALENDAR_CREATE_MEETING,
        domain: BOULT_DOMAINS.MEETING,
        label: 'Google_Calendar_Create_Meeting',
        description: 'Create a calendar event with optional Google Meet',
        mutating: true,
        idempotent: false,
        requiredInputs: ['title', 'startTime', 'endTime'],
        inputSchema: {
            title: { type: 'string', label: 'Event Title' },
            description: { type: 'string', label: 'Description', multiline: true, optional: true },
            startTime: { type: 'string', label: 'Start Time (ISO)', format: 'datetime' },
            endTime: { type: 'string', label: 'End Time (ISO)', format: 'datetime' },
            attendees: { type: 'array', label: 'Attendee Emails', optional: true, itemType: 'email' },
            location: { type: 'string', label: 'Location', optional: true },
            includeMeetLink: { type: 'boolean', label: 'Include Google Meet', defaultValue: true, optional: true }
        },
        approvalMode: APPROVAL_MODE.MANUAL,
        riskAssessment: RISK_ASSESSMENT.HIGH,
        retryPolicy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 },
        resultSchema: {
            eventId: { type: 'string', description: 'Calendar event ID' },
            meetLink: { type: 'string', description: 'Google Meet link' },
            calendarLink: { type: 'string', description: 'Calendar event URL' }
        },
        auditFields: ['eventId', 'title', 'startTime', 'attendees'],
        integration: 'google_calendar'
    },
    [BOULT_ACTIONS.GOOGLE_CALENDAR_UPDATE_MEETING]: {
        id: BOULT_ACTIONS.GOOGLE_CALENDAR_UPDATE_MEETING,
        domain: BOULT_DOMAINS.MEETING,
        label: 'Google_Calendar_Update_Meeting',
        description: 'Update an existing calendar event',
        mutating: true,
        idempotent: true,
        requiredInputs: ['eventId'],
        inputSchema: {
            eventId: { type: 'string', label: 'Event ID' },
            title: { type: 'string', label: 'Event Title', optional: true },
            description: { type: 'string', label: 'Description', multiline: true, optional: true },
            startTime: { type: 'string', label: 'Start Time (ISO)', format: 'datetime', optional: true },
            endTime: { type: 'string', label: 'End Time (ISO)', format: 'datetime', optional: true },
            attendees: { type: 'array', label: 'Attendee Emails', optional: true, itemType: 'email' }
        },
        approvalMode: APPROVAL_MODE.MANUAL,
        riskAssessment: RISK_ASSESSMENT.MEDIUM,
        retryPolicy: DEFAULT_RETRY_POLICY,
        integration: 'google_calendar'
    },
    [BOULT_ACTIONS.GOOGLE_CALENDAR_LIST_EVENTS]: {
        id: BOULT_ACTIONS.GOOGLE_CALENDAR_LIST_EVENTS,
        domain: BOULT_DOMAINS.MEETING,
        label: 'Google_Calendar_List_Events',
        description: 'List calendar events for a time range',
        mutating: false,
        idempotent: true,
        requiredInputs: [],
        inputSchema: {
            startTime: { type: 'string', label: 'Start Time (ISO)', format: 'datetime', optional: true },
            endTime: { type: 'string', label: 'End Time (ISO)', format: 'datetime', optional: true },
            maxResults: { type: 'number', label: 'Max Results', defaultValue: 10, optional: true },
            query: { type: 'string', label: 'Search Query', optional: true }
        },
        approvalMode: APPROVAL_MODE.AUTO,
        riskAssessment: RISK_ASSESSMENT.LOW,
        retryPolicy: DEFAULT_RETRY_POLICY,
        integration: 'google_calendar'
    },

    // ── Integration Actions - Cal.com (Phase 4) ──────────────
    [BOULT_ACTIONS.CAL_COM_CREATE_BOOKING]: {
        id: BOULT_ACTIONS.CAL_COM_CREATE_BOOKING,
        domain: BOULT_DOMAINS.MEETING,
        label: 'Cal_com_Create_Booking',
        description: 'Create a booking through Cal.com',
        mutating: true,
        idempotent: false,
        requiredInputs: ['eventTypeId', 'startTime', 'attendeeEmail'],
        inputSchema: {
            eventTypeId: { type: 'string', label: 'Event Type ID' },
            startTime: { type: 'string', label: 'Start Time (ISO)', format: 'datetime' },
            endTime: { type: 'string', label: 'End Time (ISO)', format: 'datetime', optional: true },
            attendeeEmail: { type: 'string', label: 'Attendee Email', format: 'email' },
            attendeeName: { type: 'string', label: 'Attendee Name' },
            notes: { type: 'string', label: 'Booking Notes', multiline: true, optional: true }
        },
        approvalMode: APPROVAL_MODE.MANUAL,
        riskAssessment: RISK_ASSESSMENT.HIGH,
        retryPolicy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 },
        resultSchema: {
            bookingId: { type: 'string', description: 'Cal.com booking ID' },
            bookingUid: { type: 'string', description: 'Booking UID' },
            meetingUrl: { type: 'string', description: 'Meeting/video call URL' }
        },
        auditFields: ['bookingId', 'eventTypeId', 'attendeeEmail', 'startTime'],
        integration: 'cal_com'
    },
    [BOULT_ACTIONS.CAL_COM_GET_BOOKING_LINK]: {
        id: BOULT_ACTIONS.CAL_COM_GET_BOOKING_LINK,
        domain: BOULT_DOMAINS.MEETING,
        label: 'Cal_com_Get_Booking_Link',
        description: 'Get shareable booking link for an event type',
        mutating: false,
        idempotent: true,
        requiredInputs: ['eventTypeSlug'],
        inputSchema: {
            eventTypeSlug: { type: 'string', label: 'Event Type Slug' },
            username: { type: 'string', label: 'Username', optional: true }
        },
        approvalMode: APPROVAL_MODE.AUTO,
        riskAssessment: RISK_ASSESSMENT.LOW,
        retryPolicy: DEFAULT_RETRY_POLICY,
        integration: 'cal_com'
    },

    // ── Integration Actions - Google Tasks (Phase 4) ─────────
    [BOULT_ACTIONS.GOOGLE_TASKS_CREATE_TASK]: {
        id: BOULT_ACTIONS.GOOGLE_TASKS_CREATE_TASK,
        domain: BOULT_DOMAINS.TASKS,
        label: 'Google_Tasks_Create_Task',
        description: 'Create a task in Google Tasks',
        mutating: true,
        idempotent: false,
        requiredInputs: ['title'],
        inputSchema: {
            title: { type: 'string', label: 'Task Title' },
            notes: { type: 'string', label: 'Notes', multiline: true, optional: true },
            due: { type: 'string', label: 'Due Date (ISO)', format: 'datetime', optional: true },
            taskListId: { type: 'string', label: 'Task List ID', optional: true }
        },
        approvalMode: APPROVAL_MODE.AUTO,
        riskAssessment: RISK_ASSESSMENT.LOW,
        retryPolicy: DEFAULT_RETRY_POLICY,
        resultSchema: {
            taskId: { type: 'string', description: 'Google Tasks task ID' },
            taskListId: { type: 'string', description: 'Task list ID' }
        },
        integration: 'google_tasks'
    },
    [BOULT_ACTIONS.GOOGLE_TASKS_COMPLETE_TASK]: {
        id: BOULT_ACTIONS.GOOGLE_TASKS_COMPLETE_TASK,
        domain: BOULT_DOMAINS.TASKS,
        label: 'Google_Tasks_Complete_Task',
        description: 'Mark a Google Task as complete',
        mutating: true,
        idempotent: true,
        requiredInputs: ['taskId'],
        inputSchema: {
            taskId: { type: 'string', label: 'Task ID' },
            taskListId: { type: 'string', label: 'Task List ID', optional: true },
            completed: { type: 'boolean', label: 'Completed', defaultValue: true, optional: true }
        },
        approvalMode: APPROVAL_MODE.AUTO,
        riskAssessment: RISK_ASSESSMENT.LOW,
        retryPolicy: DEFAULT_RETRY_POLICY,
        integration: 'google_tasks'
    },

    // ── Integration Actions - Notion (Phase 4) ───────────────
    [BOULT_ACTIONS.NOTION_QUERY_DATABASE]: {
        id: BOULT_ACTIONS.NOTION_QUERY_DATABASE,
        domain: BOULT_DOMAINS.NOTION,
        label: 'Notion_Query_Database',
        description: 'Query and filter a Notion database',
        mutating: false,
        idempotent: true,
        requiredInputs: ['databaseId'],
        inputSchema: {
            databaseId: { type: 'string', label: 'Database ID' },
            filter: { type: 'object', label: 'Filter Object', optional: true },
            sorts: { type: 'array', label: 'Sorts', optional: true },
            maxResults: { type: 'number', label: 'Max Results', defaultValue: 10, optional: true }
        },
        approvalMode: APPROVAL_MODE.AUTO,
        riskAssessment: RISK_ASSESSMENT.LOW,
        retryPolicy: DEFAULT_RETRY_POLICY,
        integration: 'notion'
    },
    [BOULT_ACTIONS.NOTION_CREATE_DATABASE_ITEM]: {
        id: BOULT_ACTIONS.NOTION_CREATE_DATABASE_ITEM,
        domain: BOULT_DOMAINS.NOTION,
        label: 'Notion_Create_Database_Item',
        description: 'Create a new entry in a Notion database',
        mutating: true,
        idempotent: false,
        requiredInputs: ['databaseId', 'properties'],
        inputSchema: {
            databaseId: { type: 'string', label: 'Database ID' },
            properties: { type: 'object', label: 'Properties Object' }
        },
        approvalMode: APPROVAL_MODE.MANUAL,
        riskAssessment: RISK_ASSESSMENT.MEDIUM,
        retryPolicy: DEFAULT_RETRY_POLICY,
        resultSchema: {
            pageId: { type: 'string', description: 'Created page ID' },
            url: { type: 'string', description: 'Notion page URL' }
        },
        integration: 'notion'
    },

    // ── Generic ──────────────────────────────────────────────
    [BOULT_ACTIONS.GENERIC_TASK]: {
        id: BOULT_ACTIONS.GENERIC_TASK,
        domain: BOULT_DOMAINS.GENERIC,
        label: 'Workflow_Trigger',
        mutating: true,
        requiredInputs: ['taskName', 'params'],
        inputSchema: {
            taskName: { type: 'string', label: 'Task Name' },
            params: { type: 'object', label: 'Parameters' },
            reasoning: { type: 'string', label: 'Logic' }
        }
    }
};

export const getActionSpec = (actionType) => TASK_REGISTRY[actionType] || null;

export const validateActionInputs = (actionType, inputs) => {
    const spec = getActionSpec(actionType);
    if (!spec) return { valid: false, missing: [] };
    
    const missing = spec.requiredInputs.filter(key => {
        const val = inputs[key];
        if (val === undefined || val === null || val === '') return true;
        if (Array.isArray(val) && val.length === 0) return true;
        return false;
    });
    
    return {
        valid: missing.length === 0,
        missing
    };
};

/**
 * Map canvas types to available actions (including new integrations).
 */
export const CANVAS_ACTIONS_BY_TYPE = {
    email_draft: ['save_draft', 'send_email', 'boult_outreach', 'boult_auto_pilot'],
    action_plan: ['execute_plan', 'approve_plan', 'notion_create_page', 'tasks_add_tasks', 'google_tasks_create_task', 'notion_create_database_item'],
    summary: ['boult_inbox_review', 'apply_changes', 'notion_create_page'],
    research: ['boult_inbox_review', 'apply_changes', 'notion_create_page'],
    meeting_schedule: ['schedule_meeting', 'google_calendar_create_meeting', 'cal_com_create_booking', 'cal_com_get_booking_link'],
    analytics: ['refresh_analytics', 'generate_analytics'],
    notes: ['create_note', 'notion_create_page', 'notion_append_blocks'],
    none: []
};
