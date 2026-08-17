/**
 * Google Tasks Adapter for Boult
 * Creates task lists, adds tasks, and manages completion state.
 *
 * Uses Google Tasks API v1 via googleapis.
 * Docs: https://developers.google.com/tasks/reference/rest
 */

import { google } from 'googleapis';

export class GoogleTasksAdapter {
  /**
   * @param {string} accessToken - Google OAuth2 access token
   * @param {string} [refreshToken] - OAuth2 refresh token
   */
  constructor(accessToken, refreshToken = '') {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  _getAuth() {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({
      access_token: this.accessToken,
      refresh_token: this.refreshToken
    });
    return auth;
  }

  _getService() {
    return google.tasks({ version: 'v1', auth: this._getAuth() });
  }

  // ── Task Lists ─────────────────────────────────────────────

  /**
   * List all task lists for the user.
   * @returns {Array<{ id: string, title: string, updated: string }>}
   */
  async listTaskLists() {
    const service = this._getService();
    const response = await service.tasklists.list({ maxResults: 100 });
    return (response.data.items || []).map(tl => ({
      id: tl.id,
      title: tl.title,
      updated: tl.updated
    }));
  }

  /**
   * Create a new task list.
   * @param {string} title
   * @returns {{ id: string, title: string }}
   */
  async createTaskList(title) {
    const service = this._getService();
    const response = await service.tasklists.insert({
      requestBody: { title }
    });
    return {
      id: response.data.id,
      title: response.data.title
    };
  }

  /**
   * Get or create a task list by title.
   * Useful for ensuring "Boult Tasks" list exists.
   */
  async getOrCreateTaskList(title = 'Boult Tasks') {
    const lists = await this.listTaskLists();
    const existing = lists.find(l => l.title.toLowerCase() === title.toLowerCase());
    if (existing) return existing;
    return this.createTaskList(title);
  }

  // ── Tasks ──────────────────────────────────────────────────

  /**
   * List tasks in a task list.
   * @param {string} taskListId
   * @param {object} [opts]
   * @param {boolean} [opts.showCompleted] - include completed tasks (default false)
   * @param {number} [opts.maxResults] - max tasks to return (default 50)
   */
  async listTasks(taskListId, { showCompleted = false, maxResults = 50 } = {}) {
    const service = this._getService();
    const response = await service.tasks.list({
      tasklist: taskListId,
      showCompleted,
      showHidden: false,
      maxResults
    });
    return (response.data.items || []).map(task => ({
      id: task.id,
      title: task.title,
      notes: task.notes || '',
      status: task.status, // 'needsAction' | 'completed'
      due: task.due || null,
      completed: task.completed || null,
      position: task.position,
      parent: task.parent || null
    }));
  }

  /**
   * Create a new task.
   * @param {string} taskListId
   * @param {object} opts
   * @param {string} opts.title - task title
   * @param {string} [opts.notes] - task notes/description
   * @param {string} [opts.due] - ISO date string for due date (date only, e.g. '2026-04-01T00:00:00.000Z')
   * @param {string} [opts.parent] - parent task ID for sub-tasks
   * @returns {{ id: string, title: string, status: string }}
   */
  async createTask(taskListId, { title, notes = '', due = null, parent = null }) {
    const service = this._getService();

    const requestBody = {
      title,
      notes: notes || undefined,
      status: 'needsAction'
    };

    if (due) {
      // Google Tasks API wants RFC 3339 date, but only the date portion matters
      requestBody.due = new Date(due).toISOString();
    }

    const params = { tasklist: taskListId, requestBody };
    if (parent) params.parent = parent;

    const response = await service.tasks.insert(params);

    return {
      id: response.data.id,
      title: response.data.title,
      notes: response.data.notes || '',
      status: response.data.status,
      due: response.data.due || null
    };
  }

  /**
   * Create multiple tasks in batch (sequential — Google Tasks API has no batch endpoint).
   * @param {string} taskListId
   * @param {Array<{ title: string, notes?: string, due?: string }>} tasks
   */
  async createTasks(taskListId, tasks) {
    const results = [];
    for (const taskDef of tasks) {
      try {
        const result = await this.createTask(taskListId, taskDef);
        results.push({ ...result, success: true });
      } catch (err) {
        results.push({ title: taskDef.title, success: false, error: err.message });
      }
    }
    return results;
  }

  /**
   * Mark a task as completed.
   * @param {string} taskListId
   * @param {string} taskId
   */
  async completeTask(taskListId, taskId) {
    const service = this._getService();
    const response = await service.tasks.patch({
      tasklist: taskListId,
      task: taskId,
      requestBody: {
        status: 'completed'
      }
    });
    return {
      id: response.data.id,
      title: response.data.title,
      status: response.data.status,
      completed: response.data.completed
    };
  }

  /**
   * Update a task's title, notes, or due date.
   * @param {string} taskListId
   * @param {string} taskId
   * @param {object} updates
   */
  async updateTask(taskListId, taskId, updates = {}) {
    const service = this._getService();
    const requestBody = {};
    if (updates.title) requestBody.title = updates.title;
    if (updates.notes !== undefined) requestBody.notes = updates.notes;
    if (updates.due) requestBody.due = new Date(updates.due).toISOString();
    if (updates.status) requestBody.status = updates.status;

    const response = await service.tasks.patch({
      tasklist: taskListId,
      task: taskId,
      requestBody
    });

    return {
      id: response.data.id,
      title: response.data.title,
      status: response.data.status,
      due: response.data.due || null
    };
  }

  /**
   * Delete a task.
   */
  async deleteTask(taskListId, taskId) {
    const service = this._getService();
    await service.tasks.delete({ tasklist: taskListId, task: taskId });
    return { deleted: true, taskId };
  }

  /**
   * Check if Google Tasks API is accessible.
   */
  async checkConnection() {
    try {
      const lists = await this.listTaskLists();
      return {
        connected: true,
        taskListCount: lists.length,
        defaultList: lists[0] || null
      };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }
}

// Export singleton
export const googleTasksAdapter = new GoogleTasksAdapter();

// Add shims for backward compatibility with CanvasActionHandlers calls
GoogleTasksAdapter.prototype.createTaskListWithUser = GoogleTasksAdapter.prototype.createTaskList;
GoogleTasksAdapter.prototype.createTaskList = function (arg) {
  if (typeof arg === 'object' && arg.title) return this.createTaskListWithUser(arg.title);
  return this.createTaskListWithUser(arg);
};

GoogleTasksAdapter.prototype.addTask = function ({ taskListId, title, notes, due }) {
  return this.createTask(taskListId, { title, notes, due });
};

GoogleTasksAdapter.prototype.completeTaskWithOriginal = GoogleTasksAdapter.prototype.completeTask;
GoogleTasksAdapter.prototype.completeTask = function (idOrObj, taskId) {
  if (typeof idOrObj === 'object' && idOrObj.taskListId && idOrObj.taskId) {
    return this.completeTaskWithOriginal(idOrObj.taskListId, idOrObj.taskId);
  }
  return this.completeTaskWithOriginal(idOrObj, taskId);
};

GoogleTasksAdapter.prototype.listTasksWithOriginal = GoogleTasksAdapter.prototype.listTasks;
GoogleTasksAdapter.prototype.listTasks = function (idOrObj, opts) {
  if (typeof idOrObj === 'object' && idOrObj.taskListId) {
    return this.listTasksWithOriginal(idOrObj.taskListId, {
      showCompleted: idOrObj.showCompleted,
      maxResults: idOrObj.maxResults
    });
  }
  return this.listTasksWithOriginal(idOrObj, opts);
};

export default GoogleTasksAdapter;
