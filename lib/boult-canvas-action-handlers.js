/**
 * Boult Canvas Action Handlers
 * 
 * Concrete implementations for all canvas actions.
 * Each handler receives a canonical ActionInput and returns raw result data.
 * The ExecutionGateway wraps these in canonical ExecutionResult.
 */

import { TASK_REGISTRY, BOULT_ACTIONS, BOULT_DOMAINS } from './boult-task-registry.js';
import { gmailClient } from './gmail.ts';
import { calendarService } from './calendar.js';
import { notionAdapter } from './notion-adapter.js';
import { googleTasksAdapter } from './google-tasks-adapter.js';

export class CanvasActionHandlers {
  constructor({ db, boultAI, userEmail }) {
    this.db = db;
    this.boultAI = boultAI;
    this.userEmail = userEmail;
  }

  /**
   * Get handler for a specific action type
   * @param {string} actionType - Action type from TASK_REGISTRY
   * @returns {Function} - Handler function
   */
  getHandler(actionType) {
    const handlers = {
      // Email actions
      [BOULT_ACTIONS.SEND_EMAIL]: this.handleSendEmail.bind(this),
      [BOULT_ACTIONS.SAVE_DRAFT]: this.handleSaveDraft.bind(this),
      [BOULT_ACTIONS.SEND_INTRO]: this.handleSendIntro.bind(this),
      [BOULT_ACTIONS.READ_INBOX]: this.handleReadInbox.bind(this),
      [BOULT_ACTIONS.AUTO_REPLY]: this.handleAutoReply.bind(this),
      
      // Meeting actions
      [BOULT_ACTIONS.SCHEDULE_MEETING]: this.handleScheduleMeeting.bind(this),
      [BOULT_ACTIONS.GET_AVAILABILITY]: this.handleGetAvailability.bind(this),
      
      // Notion actions
      [BOULT_ACTIONS.NOTION_CREATE_PAGE]: this.handleNotionCreatePage.bind(this),
      [BOULT_ACTIONS.NOTION_SEARCH]: this.handleNotionSearch.bind(this),
      [BOULT_ACTIONS.NOTION_APPEND]: this.handleNotionAppend.bind(this),
      
      // Task actions
      [BOULT_ACTIONS.TASKS_CREATE_LIST]: this.handleTasksCreateList.bind(this),
      [BOULT_ACTIONS.TASKS_ADD_TASK]: this.handleTasksAddTask.bind(this),
      [BOULT_ACTIONS.TASKS_ADD_TASKS]: this.handleTasksAddTasks.bind(this),
      [BOULT_ACTIONS.TASKS_COMPLETE]: this.handleTasksComplete.bind(this),
      [BOULT_ACTIONS.TASKS_LIST]: this.handleTasksList.bind(this),
      
      // Plan actions
      [BOULT_ACTIONS.EXECUTE_PLAN]: this.handleExecutePlan.bind(this),
      [BOULT_ACTIONS.APPROVE_PLAN]: this.handleApprovePlan.bind(this),
      
      // Generic
      [BOULT_ACTIONS.GENERIC_TASK]: this.handleGenericTask.bind(this)
    };

    const handler = handlers[actionType];
    if (!handler) {
      throw new Error(`No handler found for action type: ${actionType}`);
    }

    return handler;
  }

  // ============================================================================
  // EMAIL ACTIONS
  // ============================================================================

  async handleSendEmail(actionInput) {
    const { payload, context } = actionInput;
    const { to, subject, body, cc, bcc, threadId, isHtml } = payload;

    console.log(`[CanvasAction] Sending email to ${to}`);

    try {
      // Get Gmail access token
      const tokenData = await this.db.getGmailToken(this.userEmail);
      if (!tokenData?.access_token) {
        throw new Error('Gmail not connected. Please connect your Gmail account first.');
      }

      // Send email via Gmail API
      const result = await gmailClient.sendEmail({
        accessToken: tokenData.access_token,
        to,
        subject,
        body,
        cc,
        bcc,
        threadId,
        isHtml: isHtml || false
      });

      return {
        success: true,
        message: `Email sent to ${to}`,
        data: {
          messageId: result.messageId,
          threadId: result.threadId,
          to,
          subject,
          sentAt: new Date().toISOString()
        },
        externalRefs: {
          gmailMessageId: result.messageId,
          gmailThreadId: result.threadId
        },
        nextRecommendedActions: ['track_response', 'prepare_follow_up']
      };

    } catch (error) {
      console.error('[CanvasAction] Send email failed:', error);
      throw error;
    }
  }

  async handleSaveDraft(actionInput) {
    const { payload } = actionInput;
    const { to, subject, body, threadId, isHtml } = payload;

    console.log(`[CanvasAction] Saving draft`);

    try {
      const tokenData = await this.db.getGmailToken(this.userEmail);
      if (!tokenData?.access_token) {
        throw new Error('Gmail not connected. Please connect your Gmail account first.');
      }

      const result = await gmailClient.saveDraft({
        accessToken: tokenData.access_token,
        to,
        subject,
        body,
        threadId,
        isHtml: isHtml || false
      });

      return {
        success: true,
        message: 'Draft saved successfully',
        data: {
          draftId: result.draftId,
          threadId: result.threadId,
          savedAt: new Date().toISOString()
        },
        externalRefs: {
          gmailDraftId: result.draftId,
          gmailThreadId: result.threadId
        },
        nextRecommendedActions: ['send_draft', 'edit_draft']
      };

    } catch (error) {
      console.error('[CanvasAction] Save draft failed:', error);
      throw error;
    }
  }

  async handleSendIntro(actionInput) {
    const { payload } = actionInput;
    
    // Outreach uses the same handler as send_email but with different context
    return this.handleSendEmail(actionInput);
  }

  async handleReadInbox(actionInput) {
    const { payload } = actionInput;
    const { limit = 10, filter = 'all', searchQuery } = payload;

    console.log(`[CanvasAction] Reading inbox`);

    try {
      const tokenData = await this.db.getGmailToken(this.userEmail);
      if (!tokenData?.access_token) {
        throw new Error('Gmail not connected. Please connect your Gmail account first.');
      }

      const result = await gmailClient.getInboxMessages({
        accessToken: tokenData.access_token,
        maxResults: limit,
        query: searchQuery,
        filter
      });

      return {
        success: true,
        message: `Retrieved ${result.messages?.length || 0} emails`,
        data: {
          emails: result.messages || [],
          count: result.messages?.length || 0,
          filter,
          query: searchQuery
        },
        nextRecommendedActions: ['summarize', 'reply_to_specific', 'archive_batch']
      };

    } catch (error) {
      console.error('[CanvasAction] Read inbox failed:', error);
      throw error;
    }
  }

  async handleAutoReply(actionInput) {
    const { payload } = actionInput;
    const { messageId, threadId, body, replyAll, isHtml } = payload;

    console.log(`[CanvasAction] Sending auto reply`);

    try {
      const tokenData = await this.db.getGmailToken(this.userEmail);
      if (!tokenData?.access_token) {
        throw new Error('Gmail not connected. Please connect your Gmail account first.');
      }

      // Get the original message to extract recipients
      const originalMessage = await gmailClient.getMessage({
        accessToken: tokenData.access_token,
        messageId
      });

      // Determine recipients
      let to = originalMessage.from;
      let cc = replyAll ? originalMessage.cc : undefined;

      // Send reply
      const result = await gmailClient.sendEmail({
        accessToken: tokenData.access_token,
        to,
        cc,
        subject: `Re: ${originalMessage.subject}`,
        body,
        threadId,
        isHtml: isHtml || false
      });

      return {
        success: true,
        message: 'Reply sent successfully',
        data: {
          messageId: result.messageId,
          threadId: result.threadId,
          to,
          sentAt: new Date().toISOString()
        },
        externalRefs: {
          gmailMessageId: result.messageId,
          gmailThreadId: result.threadId
        },
        nextRecommendedActions: ['track_response', 'add_follow_up_reminder']
      };

    } catch (error) {
      console.error('[CanvasAction] Auto reply failed:', error);
      throw error;
    }
  }

  // ============================================================================
  // MEETING ACTIONS
  // ============================================================================

  async handleScheduleMeeting(actionInput) {
    const { payload } = actionInput;
    const { provider, attendees, date, time, duration, agenda, title, timezone } = payload;

    console.log(`[CanvasAction] Scheduling meeting: ${title}`);

    try {
      let result;

      if (provider === 'google') {
        result = await calendarService.createEvent({
          userEmail: this.userEmail,
          title,
          attendees,
          date,
          time,
          duration: duration || 30,
          description: agenda,
          timezone: timezone || 'UTC'
        });
      } else if (provider === 'cal') {
        // Cal.com integration
        result = await this._scheduleCalComMeeting(payload);
      }

      return {
        success: true,
        message: `Meeting scheduled: ${title}`,
        data: {
          eventId: result.eventId,
          meetingLink: result.meetingLink,
          attendees,
          date,
          time,
          duration: duration || 30
        },
        externalRefs: {
          calendarEventId: result.eventId,
          externalUrl: result.meetingLink
        },
        nextRecommendedActions: ['send_invite_reminder', 'prepare_agenda']
      };

    } catch (error) {
      console.error('[CanvasAction] Schedule meeting failed:', error);
      throw error;
    }
  }

  async handleGetAvailability(actionInput) {
    const { payload } = actionInput;
    const { date, duration } = payload;

    console.log(`[CanvasAction] Getting availability`);

    try {
      const slots = await calendarService.getAvailability({
        userEmail: this.userEmail,
        date,
        duration: duration || 30
      });

      return {
        success: true,
        message: `Found ${slots.length} available slots`,
        data: {
          availableSlots: slots,
          date,
          duration: duration || 30
        },
        nextRecommendedActions: ['schedule_meeting', 'share_availability']
      };

    } catch (error) {
      console.error('[CanvasAction] Get availability failed:', error);
      throw error;
    }
  }

  // ============================================================================
  // NOTION ACTIONS
  // ============================================================================

  async handleNotionCreatePage(actionInput) {
    const { payload } = actionInput;
    const { title, content, databaseId, parentPageId, tags } = payload;

    console.log(`[CanvasAction] Creating Notion page: ${title}`);

    try {
      const notionToken = await this._getNotionToken();
      
      const result = await notionAdapter.createPage({
        token: notionToken,
        title,
        content,
        databaseId,
        parentPageId,
        tags
      });

      return {
        success: true,
        message: `Notion page created: ${title}`,
        data: {
          pageId: result.id,
          title,
          url: result.url,
          createdAt: new Date().toISOString()
        },
        externalRefs: {
          notionPageId: result.id,
          externalUrl: result.url
        },
        nextRecommendedActions: ['add_content', 'share_page', 'create_subpage']
      };

    } catch (error) {
      console.error('[CanvasAction] Notion create page failed:', error);
      throw error;
    }
  }

  async handleNotionSearch(actionInput) {
    const { payload } = actionInput;
    const { query, filter, limit } = payload;

    console.log(`[CanvasAction] Searching Notion: ${query}`);

    try {
      const notionToken = await this._getNotionToken();
      
      const results = await notionAdapter.search({
        token: notionToken,
        query,
        filter,
        limit: limit || 10
      });

      return {
        success: true,
        message: `Found ${results.length} results`,
        data: {
          results,
          query,
          count: results.length
        },
        nextRecommendedActions: ['open_page', 'append_to_page', 'create_related']
      };

    } catch (error) {
      console.error('[CanvasAction] Notion search failed:', error);
      throw error;
    }
  }

  async handleNotionAppend(actionInput) {
    const { payload } = actionInput;
    const { pageId, content } = payload;

    console.log(`[CanvasAction] Appending to Notion page: ${pageId}`);

    try {
      const notionToken = await this._getNotionToken();
      
      const result = await notionAdapter.appendContent({
        token: notionToken,
        pageId,
        content
      });

      return {
        success: true,
        message: 'Content appended successfully',
        data: {
          pageId,
          appendedAt: new Date().toISOString()
        },
        externalRefs: {
          notionPageId: pageId
        },
        nextRecommendedActions: ['add_more_content', 'share_page']
      };

    } catch (error) {
      console.error('[CanvasAction] Notion append failed:', error);
      throw error;
    }
  }

  // ============================================================================
  // TASK ACTIONS
  // ============================================================================

  async handleTasksCreateList(actionInput) {
    const { payload } = actionInput;
    const { title } = payload;

    console.log(`[CanvasAction] Creating task list: ${title}`);

    try {
      const result = await googleTasksAdapter.createTaskList({
        userEmail: this.userEmail,
        title
      });

      return {
        success: true,
        message: `Task list created: ${title}`,
        data: {
          taskListId: result.id,
          title,
          createdAt: new Date().toISOString()
        },
        externalRefs: {
          taskListId: result.id
        },
        nextRecommendedActions: ['add_tasks', 'share_list']
      };

    } catch (error) {
      console.error('[CanvasAction] Create task list failed:', error);
      throw error;
    }
  }

  async handleTasksAddTask(actionInput) {
    const { payload } = actionInput;
    const { title, notes, due, taskListId } = payload;

    console.log(`[CanvasAction] Adding task: ${title}`);

    try {
      const result = await googleTasksAdapter.addTask({
        userEmail: this.userEmail,
        taskListId,
        title,
        notes,
        due
      });

      return {
        success: true,
        message: `Task added: ${title}`,
        data: {
          taskId: result.id,
          title,
          taskListId,
          createdAt: new Date().toISOString()
        },
        externalRefs: {
          taskId: result.id,
          taskListId
        },
        nextRecommendedActions: ['add_more_tasks', 'complete_task', 'set_reminder']
      };

    } catch (error) {
      console.error('[CanvasAction] Add task failed:', error);
      throw error;
    }
  }

  async handleTasksAddTasks(actionInput) {
    const { payload } = actionInput;
    const { tasks, taskListId, taskListTitle } = payload;

    console.log(`[CanvasAction] Adding ${tasks.length} tasks`);

    try {
      // Create list if title provided
      let targetTaskListId = taskListId;
      if (!targetTaskListId && taskListTitle) {
        const listResult = await googleTasksAdapter.createTaskList({
          userEmail: this.userEmail,
          title: taskListTitle
        });
        targetTaskListId = listResult.id;
      }

      // Add all tasks
      const addedTasks = [];
      for (const task of tasks) {
        const result = await googleTasksAdapter.addTask({
          userEmail: this.userEmail,
          taskListId: targetTaskListId,
          title: task.title,
          notes: task.notes,
          due: task.due
        });
        addedTasks.push({
          taskId: result.id,
          title: task.title
        });
      }

      return {
        success: true,
        message: `Added ${addedTasks.length} tasks`,
        data: {
          taskListId: targetTaskListId,
          tasks: addedTasks,
          count: addedTasks.length
        },
        externalRefs: {
          taskListId: targetTaskListId
        },
        nextRecommendedActions: ['view_list', 'complete_tasks', 'add_more']
      };

    } catch (error) {
      console.error('[CanvasAction] Add tasks failed:', error);
      throw error;
    }
  }

  async handleTasksComplete(actionInput) {
    const { payload } = actionInput;
    const { taskListId, taskId } = payload;

    console.log(`[CanvasAction] Completing task: ${taskId}`);

    try {
      await googleTasksAdapter.completeTask({
        userEmail: this.userEmail,
        taskListId,
        taskId
      });

      return {
        success: true,
        message: 'Task completed',
        data: {
          taskId,
          taskListId,
          completedAt: new Date().toISOString()
        },
        externalRefs: {
          taskId,
          taskListId
        },
        nextRecommendedActions: ['complete_more', 'review_completed']
      };

    } catch (error) {
      console.error('[CanvasAction] Complete task failed:', error);
      throw error;
    }
  }

  async handleTasksList(actionInput) {
    const { payload } = actionInput;
    const { taskListId, showCompleted } = payload;

    console.log(`[CanvasAction] Listing tasks`);

    try {
      const tasks = await googleTasksAdapter.listTasks({
        userEmail: this.userEmail,
        taskListId,
        showCompleted: showCompleted || false
      });

      return {
        success: true,
        message: `Found ${tasks.length} tasks`,
        data: {
          tasks,
          taskListId,
          count: tasks.length
        },
        nextRecommendedActions: ['complete_tasks', 'add_tasks', 'create_new_list']
      };

    } catch (error) {
      console.error('[CanvasAction] List tasks failed:', error);
      throw error;
    }
  }

  // ============================================================================
  // PLAN ACTIONS
  // ============================================================================

  async handleExecutePlan(actionInput) {
    const { payload, context } = actionInput;
    const { steps, objective } = payload;

    console.log(`[CanvasAction] Executing plan: ${objective}`);

    // This is handled by the ExecutionGateway's executePlan method
    // This handler just returns the plan info for the gateway to execute
    return {
      success: true,
      message: `Plan execution started: ${objective}`,
      data: {
        planId: context.planId,
        objective,
        stepCount: steps?.length || 0
      },
      nextRecommendedActions: ['monitor_execution', 'approve_next_step']
    };
  }

  async handleApprovePlan(actionInput) {
    const { payload } = actionInput;
    const { planId } = payload;

    console.log(`[CanvasAction] Approving plan: ${planId}`);

    // Update plan status to approved
    await this.db.updatePlanArtifact(this.userEmail, planId, {
      status: 'plan_approved',
      approvedAt: new Date().toISOString()
    });

    return {
      success: true,
      message: 'Plan approved for execution',
      data: {
        planId,
        approvedAt: new Date().toISOString()
      },
      nextRecommendedActions: ['start_execution', 'modify_plan']
    };
  }

  // ============================================================================
  // GENERIC TASK
  // ============================================================================

  async handleGenericTask(actionInput) {
    const { payload } = actionInput;
    const { taskName, params, reasoning } = payload;

    console.log(`[CanvasAction] Generic task: ${taskName}`);

    // Generic task handler - can be extended for custom workflows
    return {
      success: true,
      message: `Generic task completed: ${taskName}`,
      data: {
        taskName,
        params,
        reasoning,
        completedAt: new Date().toISOString()
      },
      nextRecommendedActions: ['create_template', 'run_again']
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  async _getNotionToken() {
    const integration = await this.db.getIntegration(this.userEmail, 'notion');
    if (!integration?.access_token) {
      throw new Error('Notion not connected. Please connect your Notion workspace first.');
    }
    return integration.access_token;
  }

  async _scheduleCalComMeeting(payload) {
    // Always prefer the user's OWN connected Cal.com key so the booking lands on
    // their calendar. The shared CAL_API_KEY fallback is multi-tenant-unsafe (a
    // keyless user would book on the operator's calendar), so it's only used when
    // the operator opts into single-tenant mode via CAL_ALLOW_SHARED_KEY=true.
    let apiKey = '';
    try {
      const integration = await this.db.getIntegration(this.userEmail, 'cal_com');
      apiKey = (integration?.access_token || '').trim();
    } catch { /* fall through */ }
    if (!apiKey && process.env.CAL_ALLOW_SHARED_KEY === 'true') {
      apiKey = (process.env.CAL_API_KEY || '').trim();
    }
    if (!apiKey) throw new Error('Cal.com is not connected. Add your Cal.com API key in Settings → Integrations.');
    const { CalComService } = await import('./calcom.js');
    const cal = new CalComService(apiKey);

    const { eventTypeId, start, end, name, email, notes, timezone } = payload || {};
    if (!eventTypeId || !start || !name || !email) {
      throw new Error('Cal.com booking needs eventTypeId, start, name and email.');
    }
    const booking = await cal.createBooking({ eventTypeId: Number(eventTypeId), start, end, name, email, notes, timezone });
    return {
      success: true,
      message: `Booked Cal.com meeting with ${name} at ${start}.`,
      data: { bookingId: booking?.id, ...booking },
    };
  }
}

export default CanvasActionHandlers;
