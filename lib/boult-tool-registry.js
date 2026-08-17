/**
 * Boult Tool Registry
 * 
 * Defines all available actions the agent can perform.
 * Each tool has metadata for risk, idempotency, and security.
 */

export const BOULT_TOOLS = [
  {
    id: 'create_event',
    name: 'Create Calendar Event',
    description: 'Schedules a new meeting or event in Google Calendar',
    risk_level: 'medium',
    requires_auth: true,
    idempotent: false,
    params: {
      summary: { type: 'string', description: 'Title of the event' },
      start: { type: 'string', description: 'ISO start time' },
      end: { type: 'string', description: 'ISO end time' },
      attendees: { type: 'array', items: { type: 'string' }, description: 'List of guest emails' },
      location: { type: 'string' }
    }
  },
  {
    id: 'create_task',
    name: 'Create Task',
    description: 'Adds a task to Google Tasks',
    risk_level: 'low',
    requires_auth: true,
    idempotent: false,
    params: {
      title: { type: 'string' },
      notes: { type: 'string' },
      due: { type: 'string', description: 'ISO date string' }
    }
  },
  {
    id: 'create_page',
    name: 'Create Notion Page',
    description: 'Creates a new page in a Notion database or workspace',
    risk_level: 'medium',
    requires_auth: true,
    idempotent: false,
    params: {
      title: { type: 'string' },
      parent: { type: 'object' },
      content: { type: 'array' }
    }
  },
  {
    id: 'search_notion',
    name: 'Search Notion',
    description: 'Searches for pages or databases in Notion',
    risk_level: 'low',
    requires_auth: true,
    idempotent: true,
    params: {
      query: { type: 'string' }
    }
  },
  {
    id: 'send_email',
    name: 'Send Email',
    description: 'Sends a direct email via Gmail API',
    risk_level: 'high',
    requires_auth: true,
    idempotent: false,
    params: {
      to: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' }
    }
  }
];
