/**
 * Boult Execution Handlers
 * 
 * Actual action implementations that:
 * - Call real APIs (Google Calendar, Cal.com, Notion, Tasks)
 * - Handle errors with retry logic
 * - Return structured results
 * - Log to audit system
 */

import { CredentialManager } from './boult-credential-manager.js';

export class ExecutionHandlers {
  constructor(options = {}) {
    this.supabase = options.supabase;
    this.credentialManager = new CredentialManager({ supabase: options.supabase });
  }

  /**
   * Get handler for action type
   */
  getHandler(actionType) {
    const handlers = {
      // Google Calendar
      'create_event': this.handleCreateCalendarEvent.bind(this),
      'update_event': this.handleUpdateCalendarEvent.bind(this),
      'delete_event': this.handleDeleteCalendarEvent.bind(this),
      'get_events': this.handleGetCalendarEvents.bind(this),
      'get_availability': this.handleGetAvailability.bind(this),
      'create_meeting_space': this.handleCreateMeetingSpace.bind(this),
      
      // Cal.com
      'get_bookings': this.handleGetCalComBookings.bind(this),
      'create_booking': this.handleCreateCalComBooking.bind(this),
      'cancel_booking': this.handleCancelCalComBooking.bind(this),
      'get_event_types': this.handleGetCalComEventTypes.bind(this),
      
      // Notion
      'search_pages': this.handleSearchNotionPages.bind(this),
      'get_page': this.handleGetNotionPage.bind(this),
      'create_page': this.handleCreateNotionPage.bind(this),
      'update_page': this.handleUpdateNotionPage.bind(this),
      'query_database': this.handleQueryNotionDatabase.bind(this),
      'append_blocks': this.handleAppendNotionBlocks.bind(this),
      
      // Google Tasks
      'get_task_lists': this.handleGetTaskLists.bind(this),
      'create_task_list': this.handleCreateTaskList.bind(this),
      'get_tasks': this.handleGetTasks.bind(this),
      'create_task': this.handleCreateTask.bind(this),
      'update_task': this.handleUpdateTask.bind(this),
      'complete_task': this.handleCompleteTask.bind(this),
      'delete_task': this.handleDeleteTask.bind(this),
      
      // Generic
      'generic_task': this.handleGenericTask.bind(this)
    };
    
    return handlers[actionType] || this.handleGenericTask.bind(this);
  }

  /**
   * Execute an action
   */
  async execute(actionType, payload, context) {
    const handler = this.getHandler(actionType);
    const startTime = Date.now();
    
    try {
      // Log start
      await this.logActionStart(context, actionType, payload);
      
      // Execute
      const result = await handler(payload, context);
      
      // Log success
      const duration = Date.now() - startTime;
      await this.logActionComplete(context, actionType, result, duration);
      
      return {
        success: true,
        result,
        duration
      };
    } catch (error) {
      // Log failure
      const duration = Date.now() - startTime;
      await this.logActionError(context, actionType, error, duration);
      
      return {
        success: false,
        error: error.message,
        errorCode: error.code || 'UNKNOWN_ERROR',
        duration
      };
    }
  }

  /**
   * Undo an action (Compensating Action)
   */
  async undo(actionType, params, result, context) {
    console.log(`🧪 [Boult Telemetry] Executing compensation for ${actionType}`);
    
    try {
      if (actionType === 'create_event' && result.eventId) {
        return this.handleDeleteCalendarEvent({ eventId: result.eventId }, context);
      }
      
      if (actionType === 'create_task' && result.taskId) {
        return this.handleDeleteTask({ taskListId: params.taskListId || '@default', taskId: result.taskId }, context);
      }

      return { success: true, message: 'No explicit rollback required or implemented.' };
    } catch (err) {
      console.error(`❌ [Boult Telemetry] Undo failed for ${actionType}:`, err);
      return { success: false, error: err.message };
    }
  }

  // ============================================================================
  // GOOGLE CALENDAR HANDLERS
  // ============================================================================

  async handleDeleteCalendarEvent(payload, context) {
    const { accountId, userId } = context;
    const { eventId } = payload;
    
    const credentials = await this.credentialManager.retrieveCredentials(accountId, userId);
    
    const { googleFetch } = await import('./boult/tools/http-tokens');
    const response = await googleFetch(userId, 'gcal', `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`
      }
    });

    return { success: response.ok };
  }

  async handleCreateCalendarEvent(payload, context) {
    const { accountId, userId } = context;
    const { summary, description, start, end, attendees = [], location } = payload;
    
    // Get credentials
    const credentials = await this.credentialManager.retrieveCredentials(accountId, userId);
    
    // Call Google Calendar API (via the Composio-aware seam)
    const { googleFetch } = await import('./boult/tools/http-tokens');
    const response = await googleFetch(userId, 'gcal', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary,
        description,
        location,
        start: { dateTime: start, timeZone: 'UTC' },
        end: { dateTime: end, timeZone: 'UTC' },
        attendees: attendees.map(email => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: `boult-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        }
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Google Calendar API error: ${error.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      eventId: data.id,
      eventUrl: data.htmlLink,
      meetLink: data.conferenceData?.entryPoints?.[0]?.uri,
      summary: data.summary,
      start: data.start,
      end: data.end
    };
  }

  async handleGetAvailability(payload, context) {
    const { accountId, userId } = context;
    const { timeMin, timeMax, items = [] } = payload;
    
    const credentials = await this.credentialManager.retrieveCredentials(accountId, userId);
    
    const { googleFetch } = await import('./boult/tools/http-tokens');
    const response = await googleFetch(userId, 'gcal', 'https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: items.length > 0 ? items : [{ id: 'primary' }]
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Google Calendar API error: ${error.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    return data.calendars;
  }

  async handleCreateMeetingSpace(payload, context) {
    const { accountId, userId } = context;
    const { name } = payload;
    
    const credentials = await this.credentialManager.retrieveCredentials(accountId, userId);
    
    // Create a meeting space via Google Meet API
    const response = await fetch('https://meet.googleapis.com/v2/spaces', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        config: {
          accessType: 'OPEN'
        }
      })
    });
    
    if (!response.ok) {
      // Meet API might not be available, fallback to creating calendar event with Meet
      const eventResult = await this.handleCreateCalendarEvent({
        summary: name || 'Meeting',
        start: new Date(Date.now() + 3600000).toISOString(),
        end: new Date(Date.now() + 7200000).toISOString()
      }, context);
      
      return {
        spaceId: eventResult.eventId,
        meetingUrl: eventResult.meetLink,
        name
      };
    }
    
    const data = await response.json();
    return {
      spaceId: data.name,
      meetingUrl: data.meetingUri,
      name
    };
  }

  // ============================================================================
  // CAL.COM HANDLERS
  // ============================================================================

  async handleCreateCalComBooking(payload, context) {
    const { accountId, userId } = context;
    const { eventTypeId, start, end, attendeeEmail, attendeeName, timezone = 'UTC' } = payload;
    
    const credentials = await this.credentialManager.retrieveCredentials(accountId, userId);
    
    const response = await fetch('https://api.cal.com/v2/bookings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
        'cal-api-version': '2024-08-13'
      },
      body: JSON.stringify({
        eventTypeId: parseInt(eventTypeId),
        start,
        end,
        attendee: {
          email: attendeeEmail,
          name: attendeeName,
          timeZone: timezone
        }
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Cal.com API error: ${error.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      bookingId: data.data.id,
      uid: data.data.uid,
      status: data.data.status,
      startTime: data.data.startTime,
      endTime: data.data.endTime,
      attendee: data.data.attendees?.[0],
      meetingUrl: data.data.meetingUrl,
      cancelUrl: data.data.cancelUrl,
      reschedulingUrl: data.data.reschedulingUrl
    };
  }

  async handleGetCalComBookings(payload, context) {
    const { accountId, userId } = context;
    const { status = 'upcoming', limit = 10 } = payload;
    
    const credentials = await this.credentialManager.retrieveCredentials(accountId, userId);
    
    const response = await fetch(`https://api.cal.com/v2/bookings?status=${status}&take=${limit}`, {
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'cal-api-version': '2024-08-13'
      }
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Cal.com API error: ${error.message || response.statusText}`);
    }
    
    const data = await response.json();
    return data.data || [];
  }

  // ============================================================================
  // NOTION HANDLERS
  // ============================================================================

  async handleCreateNotionPage(payload, context) {
    const { accountId, userId } = context;
    const { parent, title, properties = {}, content = [] } = payload;
    
    const credentials = await this.credentialManager.retrieveCredentials(accountId, userId);
    
    const body = {
      parent: parent || { database_id: properties.databaseId },
      properties: {
        title: {
          title: [{ text: { content: title } }]
        },
        ...properties
      }
    };
    
    if (content.length > 0) {
      body.children = content.map(block => ({
        object: 'block',
        type: block.type,
        [block.type]: block[block.type]
      }));
    }
    
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Notion API error: ${error.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      pageId: data.id,
      pageUrl: data.url,
      title: title,
      createdTime: data.created_time
    };
  }

  async handleSearchNotionPages(payload, context) {
    const { accountId, userId } = context;
    const { query, filter } = payload;
    
    const credentials = await this.credentialManager.retrieveCredentials(accountId, userId);
    
    const response = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ query, filter })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Notion API error: ${error.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      results: data.results.map(r => ({
        id: r.id,
        title: r.properties?.title?.title?.[0]?.text?.content || 'Untitled',
        url: r.url,
        type: r.object,
        lastEdited: r.last_edited_time
      })),
      hasMore: data.has_more,
      nextCursor: data.next_cursor
    };
  }

  // ============================================================================
  // GOOGLE TASKS HANDLERS
  // ============================================================================

  async handleGetTaskLists(payload, context) {
    const { accountId, userId } = context;
    
    const credentials = await this.credentialManager.retrieveCredentials(accountId, userId);
    
    const response = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`
      }
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Google Tasks API error: ${error.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      taskLists: (data.items || []).map(list => ({
        id: list.id,
        title: list.title,
        updated: list.updated
      }))
    };
  }

  async handleCreateTask(payload, context) {
    const { accountId, userId } = context;
    const { taskListId = '@default', title, notes, due, links = [] } = payload;
    
    const credentials = await this.credentialManager.retrieveCredentials(accountId, userId);
    
    const body = {
      title,
      notes,
      due,
      links: links.map(link => ({
        type: 'regular',
        description: link.description,
        link: link.url
      }))
    };
    
    const response = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Google Tasks API error: ${error.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      taskId: data.id,
      title: data.title,
      status: data.status,
      updated: data.updated,
      selfLink: data.selfLink
    };
  }

  async handleCompleteTask(payload, context) {
    const { accountId, userId } = context;
    const { taskListId, taskId } = payload;
    
    const credentials = await this.credentialManager.retrieveCredentials(accountId, userId);
    
    const response = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'completed' })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Google Tasks API error: ${error.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      taskId: data.id,
      title: data.title,
      status: data.status,
      completed: data.completed
    };
  }

  // ============================================================================
  // GENERIC HANDLER
  // ============================================================================

  async handleGenericTask(payload, context) {
    return {
      message: 'Generic task executed',
      payload,
      context: {
        userId: context.userId,
        actionType: context.actionType
      }
    };
  }

  // ============================================================================
  // LOGGING
  // ============================================================================

  async logActionStart(context, actionType, payload) {
    try {
      await this.supabase.rpc('log_audit_event', {
        p_user_id: context.userId,
        p_event_type: 'action_start',
        p_event_category: actionType,
        p_payload: { payload: this.sanitizePayload(payload) },
        p_run_id: context.runId,
        p_action_type: actionType
      });
    } catch (error) {
      console.error('[ExecutionHandlers] Failed to log action start:', error);
    }
  }

  async logActionComplete(context, actionType, result, duration) {
    try {
      await this.supabase.rpc('log_audit_event', {
        p_user_id: context.userId,
        p_event_type: 'action_complete',
        p_event_category: actionType,
        p_payload: { 
          duration_ms: duration,
          result_keys: Object.keys(result)
        },
        p_run_id: context.runId,
        p_action_type: actionType
      });
    } catch (error) {
      console.error('[ExecutionHandlers] Failed to log action complete:', error);
    }
  }

  async logActionError(context, actionType, error, duration) {
    try {
      await this.supabase.rpc('log_audit_event', {
        p_user_id: context.userId,
        p_event_type: 'action_error',
        p_event_category: actionType,
        p_payload: { 
          error: error.message,
          code: error.code,
          duration_ms: duration
        },
        p_run_id: context.runId,
        p_action_type: actionType
      });
    } catch (err) {
      console.error('[ExecutionHandlers] Failed to log action error:', err);
    }
  }

  sanitizePayload(payload) {
    // Remove sensitive data from logs
    const sanitized = { ...payload };
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.apiKey;
    delete sanitized.accessToken;
    delete sanitized.refreshToken;
    return sanitized;
  }
}

export default ExecutionHandlers;
