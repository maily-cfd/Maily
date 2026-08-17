/**
 * Google Tasks Adapter
 * 
 * Phase 4: Production-grade adapter for Google Tasks integration
 * Supports: create task, update task, complete task, delete task, list tasks, create list
 */

const { google } = require('googleapis');
const { BaseIntegrationAdapter, buildConnectCTA, formatExternalRefs, INTEGRATION_ERROR_CATEGORIES } = require('./boult-integration-adapter-contract');

class GoogleTasksAdapter extends BaseIntegrationAdapter {
  constructor(db) {
    super(db);
    this.provider = 'google_tasks';
    this.displayName = 'Google Tasks';
    this.icon = 'check-square';
    this.requiredScopes = [
      'https://www.googleapis.com/auth/tasks'
    ];
    this.capabilities = {
      read: true,
      write: true,
      create: true,
      update: true,
      delete: true,
      search: false,
      createTask: true
    };
  }

  /**
   * Create OAuth2 client
   */
  createOAuthClient(baseUrl) {
    const redirectUri = `${this.getBaseUrl(baseUrl)}/api/integrations/google_tasks/callback`;
    console.log(`[GoogleTasksAdapter] Creating OAuth client with redirect URI: ${redirectUri}`);
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
  }

  /**
   * Build OAuth authorization URL
   */
  buildAuthUrl(state, baseUrl) {
    const oauth2Client = this.createOAuthClient(baseUrl);
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: this.requiredScopes,
      prompt: 'consent',
      include_granted_scopes: true,
      state
    });
  }

  /**
   * Exchange code for tokens
   */
  async exchangeCode(code, baseUrl) {
    const oauth2Client = this.createOAuthClient(baseUrl);
    const { tokens } = await oauth2Client.getToken(code);
    
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : undefined,
      scopes: tokens.scope?.split(' ') || this.requiredScopes
    };
  }

  /**
   * Validate connection and token health
   */
  async validateConnection(userEmail) {
    try {
      const credentials = await this.getCredentials(userEmail);
      
      if (!credentials) {
        return {
          connected: false,
          provider: this.provider,
          capabilities: this.capabilities,
          tokenHealth: { valid: false, reauthRequired: true },
          scopes: [],
          missingScopes: this.requiredScopes
        };
      }

      // Check token expiration
      const isExpired = this.isTokenExpired(credentials.expiresAt);
      
      if (isExpired && !credentials.refreshToken) {
        return {
          connected: false,
          provider: this.provider,
          capabilities: this.capabilities,
          tokenHealth: { valid: false, expiresAt: credentials.expiresAt, reauthRequired: true },
          scopes: credentials.scopes,
          missingScopes: this.requiredScopes
        };
      }

      // Validate token by making a test API call
      const oauth2Client = this.createOAuthClient();
      oauth2Client.setCredentials({
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken
      });

      // Refresh if expired
      if (isExpired) {
        const { tokens } = await oauth2Client.refreshAccessToken();
        await this.storeCredentials(userEmail, {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || credentials.refreshToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : undefined,
          scopes: tokens.scope?.split(' ') || credentials.scopes
        });
        oauth2Client.setCredentials(tokens);
      }

      const tasks = google.tasks({ version: 'v1', auth: oauth2Client });
      
      // Test with a simple list fetch
      const { data } = await tasks.tasklists.list({ maxResults: 1 });

      // Check missing scopes
      const grantedScopes = credentials.scopes || [];
      const missingScopes = this.requiredScopes.filter(
        scope => !grantedScopes.some(s => s.includes(scope.replace('https://www.googleapis.com/auth/', '')))
      );

      return {
        connected: true,
        provider: this.provider,
        capabilities: this.capabilities,
        tokenHealth: { 
          valid: true, 
          expiresAt: credentials.expiresAt, 
          reauthRequired: missingScopes.length > 0 
        },
        scopes: grantedScopes,
        missingScopes: missingScopes.length > 0 ? missingScopes : undefined,
        userInfo: {
          email: userEmail
        }
      };
    } catch (error) {
      return {
        connected: false,
        provider: this.provider,
        capabilities: this.capabilities,
        tokenHealth: { valid: false, reauthRequired: true },
        scopes: [],
        error: this.mapError(error, 'validate')
      };
    }
  }

  /**
   * Execute Google Tasks actions
   */
  async executeAction(userEmail, payload) {
    try {
      const credentials = await this.getCredentials(userEmail);
      if (!credentials) {
        return {
          success: false,
          error: {
            code: 'NOT_CONNECTED',
            message: 'Google Tasks not connected',
            category: INTEGRATION_ERROR_CATEGORIES.AUTH_REVOKED,
            retryable: false,
            recoveryHint: buildConnectCTA(this.provider)
          }
        };
      }

      const oauth2Client = this.createOAuthClient();
      oauth2Client.setCredentials({
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken
      });

      // Refresh if needed
      if (this.isTokenExpired(credentials.expiresAt)) {
        const { tokens } = await oauth2Client.refreshAccessToken();
        await this.storeCredentials(userEmail, {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || credentials.refreshToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : undefined,
          scopes: tokens.scope?.split(' ') || credentials.scopes
        });
        oauth2Client.setCredentials(tokens);
      }

      const tasks = google.tasks({ version: 'v1', auth: oauth2Client });

      switch (payload.action) {
        case 'create_task':
          return await this.createTask(tasks, payload.params);
        case 'update_task':
          return await this.updateTask(tasks, payload.params);
        case 'complete_task':
          return await this.completeTask(tasks, payload.params);
        case 'delete_task':
          return await this.deleteTask(tasks, payload.params);
        case 'list_tasks':
          return await this.listTasks(tasks, payload.params);
        case 'create_task_list':
          return await this.createTaskList(tasks, payload.params);
        case 'list_task_lists':
          return await this.listTaskLists(tasks, payload.params);
        default:
          return {
            success: false,
            error: {
              code: 'UNKNOWN_ACTION',
              message: `Unknown action: ${payload.action}`,
              category: INTEGRATION_ERROR_CATEGORIES.INVALID_PAYLOAD,
              retryable: false
            }
          };
      }
    } catch (error) {
      return {
        success: false,
        error: this.mapError(error, payload.action)
      };
    }
  }

  /**
   * Create a task
   */
  async createTask(tasks, params) {
    const { taskListId = '@default', title, notes, due, parent } = params;

    const task = {
      title,
      notes,
      due: due ? new Date(due).toISOString() : undefined,
      parent
    };

    const { data } = await tasks.tasks.insert({
      tasklist: taskListId,
      requestBody: task
    });

    return this.normalizeResult('create_task', data, { taskListId });
  }

  /**
   * Update a task
   */
  async updateTask(tasks, params) {
    const { taskListId = '@default', taskId, title, notes, due } = params;

    const task = {};
    if (title !== undefined) task.title = title;
    if (notes !== undefined) task.notes = notes;
    if (due !== undefined) task.due = due ? new Date(due).toISOString() : null;

    const { data } = await tasks.tasks.patch({
      tasklist: taskListId,
      task: taskId,
      requestBody: task
    });

    return this.normalizeResult('update_task', data, { taskListId });
  }

  /**
   * Complete a task
   */
  async completeTask(tasks, params) {
    const { taskListId = '@default', taskId, completed = true } = params;

    const { data } = await tasks.tasks.patch({
      tasklist: taskListId,
      task: taskId,
      requestBody: {
        status: completed ? 'completed' : 'needsAction',
        completed: completed ? new Date().toISOString() : null
      }
    });

    return this.normalizeResult('complete_task', data, { taskListId });
  }

  /**
   * Delete a task
   */
  async deleteTask(tasks, params) {
    const { taskListId = '@default', taskId } = params;

    await tasks.tasks.delete({
      tasklist: taskListId,
      task: taskId
    });

    return this.buildSuccessResult({ deleted: true }, { taskId, taskListId });
  }

  /**
   * List tasks
   */
  async listTasks(tasks, params) {
    const { taskListId = '@default', showCompleted = true, maxResults = 100, dueMin, dueMax } = params;

    const { data } = await tasks.tasks.list({
      tasklist: taskListId,
      showCompleted: showCompleted ? 'true' : 'false',
      maxResults,
      dueMin: dueMin ? new Date(dueMin).toISOString() : undefined,
      dueMax: dueMax ? new Date(dueMax).toISOString() : undefined
    });

    return this.buildSuccessResult({
      tasks: (data.items || []).map(task => ({
        id: task.id,
        title: task.title,
        notes: task.notes,
        status: task.status,
        due: task.due,
        completed: task.completed,
        updated: task.updated,
        parent: task.parent,
        position: task.position,
        links: task.links
      }))
    });
  }

  /**
   * Create a task list
   */
  async createTaskList(tasks, params) {
    const { title } = params;

    const { data } = await tasks.tasklists.insert({
      requestBody: { title }
    });

    return this.normalizeResult('create_task_list', data);
  }

  /**
   * List task lists
   */
  async listTaskLists(tasks, params) {
    const { maxResults = 10 } = params;

    const { data } = await tasks.tasklists.list({
      maxResults
    });

    return this.buildSuccessResult({
      taskLists: (data.items || []).map(list => ({
        id: list.id,
        title: list.title,
        updated: list.updated
      }))
    });
  }

  /**
   * Normalize result to canonical format
   */
  normalizeResult(action, rawResult, context = {}) {
    const externalRefs = formatExternalRefs({
      taskId: rawResult.id,
      taskListId: context.taskListId,
      selfLink: rawResult.selfLink,
      taskListLink: rawResult.taskList?.id
    });

    return this.buildSuccessResult({
      id: rawResult.id,
      title: rawResult.title,
      notes: rawResult.notes,
      status: rawResult.status,
      due: rawResult.due,
      completed: rawResult.completed,
      updated: rawResult.updated,
      parent: rawResult.parent,
      position: rawResult.position,
      links: rawResult.links,
      taskList: rawResult.taskList
    }, externalRefs);
  }

  /**
   * Map Google Tasks errors to canonical format
   */
  mapError(error, action) {
    const code = error.code || error.status;
    const message = error.message || 'Unknown error';

    if (code === 401 || message.includes('invalid_grant')) {
      return {
        code: 'AUTH_EXPIRED',
        message: 'Your Google Tasks connection has expired. Please reconnect.',
        category: INTEGRATION_ERROR_CATEGORIES.AUTH_EXPIRED,
        retryable: false,
        recoveryHint: buildConnectCTA(this.provider)
      };
    }

    if (code === 403) {
      if (message.includes('insufficient permissions') || message.includes('scope')) {
        return {
          code: 'SCOPE_MISSING',
          message: 'Additional permissions required for Google Tasks',
          category: INTEGRATION_ERROR_CATEGORIES.SCOPE_MISSING,
          retryable: false,
          recoveryHint: buildConnectCTA(this.provider, this.requiredScopes)
        };
      }
      return {
        code: 'PERMISSION_DENIED',
        message: 'Permission denied. Check your Google Tasks access.',
        category: INTEGRATION_ERROR_CATEGORIES.PERMISSION_DENIED,
        retryable: false
      };
    }

    if (code === 404) {
      return {
        code: 'TASK_NOT_FOUND',
        message: 'The requested task was not found',
        category: INTEGRATION_ERROR_CATEGORIES.RESOURCE_NOT_FOUND,
        retryable: false
      };
    }

    if (code === 429) {
      return {
        code: 'RATE_LIMITED',
        message: 'Google Tasks rate limit reached. Please try again.',
        category: INTEGRATION_ERROR_CATEGORIES.RATE_LIMITED,
        retryable: true,
        recoveryHint: {
          userMessage: 'Rate limit reached. Will retry automatically.',
          recoveryAction: 'retry',
          requiresUserAction: false,
          autoRetry: true
        }
      };
    }

    if (code >= 500) {
      return {
        code: 'PROVIDER_ERROR',
        message: 'Google Tasks service error. Please try again.',
        category: INTEGRATION_ERROR_CATEGORIES.PROVIDER_ERROR,
        retryable: true
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: `Google Tasks error: ${message}`,
      category: INTEGRATION_ERROR_CATEGORIES.UNKNOWN,
      retryable: false
    };
  }
}

module.exports = { GoogleTasksAdapter };
