/**
 * Boult Connector API Clients
 * 
 * Real HTTP clients for all 4 connectors:
 * - Google Calendar & Meet
 * - Cal.com
 * - Notion
 * - Google Tasks
 * 
 * Features:
 * - Token refresh handling
 * - Rate limiting
 * - Error categorization
 * - Request/response logging
 */

import { CredentialManager } from './boult-credential-manager.js';

// ============================================================================
// BASE CLIENT
// ============================================================================

class BaseApiClient {
  constructor(options) {
    this.credentialManager = options.credentialManager;
    this.supabase = options.supabase;
    this.baseUrl = options.baseUrl;
    this.provider = options.provider;
    this.rateLimiter = new RateLimiter(options.rateLimit || 100);
  }

  async getCredentials(accountId, userId) {
    return await this.credentialManager.retrieveCredentials(accountId, userId);
  }

  async makeRequest(accountId, userId, method, endpoint, body = null, headers = {}) {
    // Check rate limit
    await this.rateLimiter.wait();

    // Get credentials
    const credentials = await this.getCredentials(accountId, userId);
    
    // Check token expiration and refresh if needed
    const validCreds = await this.ensureValidToken(credentials);
    
    // Build request
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const requestHeaders = {
      'Authorization': `Bearer ${validCreds.accessToken}`,
      'Content-Type': 'application/json',
      ...headers
    };

    const startTime = Date.now();
    
    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : null
      });

      const duration = Date.now() - startTime;

      // Handle errors
      if (!response.ok) {
        const error = await this.parseError(response);
        await this.logRequest(accountId, userId, method, endpoint, body, null, false, error.message, duration);
        throw error;
      }

      const data = await response.json();
      
      // Log success
      await this.logRequest(accountId, userId, method, endpoint, body, data, true, null, duration);
      
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ApiError('Request timeout', 'TIMEOUT', 408);
      }
      throw error;
    }
  }

  async ensureValidToken(credentials) {
    // Check if token is expired or about to expire (within 5 minutes)
    const expiresAt = credentials.expiresAt ? new Date(credentials.expiresAt) : null;
    const now = new Date();
    const fiveMinutes = 5 * 60 * 1000;

    if (!expiresAt || expiresAt - now > fiveMinutes) {
      return credentials; // Token is still valid
    }

    // Token needs refresh
    if (!credentials.refreshToken) {
      throw new ApiError('Token expired and no refresh token available', 'TOKEN_EXPIRED', 401);
    }

    // Refresh token (provider-specific)
    const newTokens = await this.refreshAccessToken(credentials);
    
    // Update stored credentials
    await this.credentialManager.storeCredentials(credentials.accountId, {
      accessToken: newTokens.access_token,
      refreshToken: newTokens.refresh_token || credentials.refreshToken,
      expiresAt: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
      scopes: credentials.scopes
    });

    return {
      ...credentials,
      accessToken: newTokens.access_token
    };
  }

  async refreshAccessToken(credentials) {
    // Override in subclass
    throw new Error('refreshAccessToken must be implemented by subclass');
  }

  async parseError(response) {
    const status = response.status;
    let message = `HTTP ${status}`;
    let code = 'UNKNOWN';

    try {
      const body = await response.json();
      message = body.error?.message || body.message || message;
      code = body.error?.code || body.code || this.categorizeError(status);
    } catch {
      code = this.categorizeError(status);
    }

    return new ApiError(message, code, status);
  }

  categorizeError(status) {
    const codes = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      429: 'RATE_LIMITED',
      500: 'SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE'
    };
    return codes[status] || 'UNKNOWN';
  }

  async logRequest(accountId, userId, method, endpoint, request, response, success, errorMessage, duration) {
    try {
      await this.supabase.from('connector_usage_log').insert({
        account_id: accountId,
        connector_id: this.provider,
        user_id: userId,
        action: `${method} ${endpoint}`,
        action_type: 'api_call',
        request_payload: this.sanitizeForLog(request),
        response_payload: success ? this.sanitizeForLog(response) : null,
        started_at: new Date(Date.now() - duration).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        success,
        error_message: errorMessage,
        error_code: success ? null : this.categorizeError(500)
      });
    } catch (e) {
      console.error('[ApiClient] Failed to log request:', e);
    }
  }

  sanitizeForLog(data) {
    if (!data) return null;
    const sanitized = JSON.parse(JSON.stringify(data));
    // Remove sensitive fields
    delete sanitized.access_token;
    delete sanitized.refresh_token;
    delete sanitized.token;
    delete sanitized.api_key;
    delete sanitized.password;
    return sanitized;
  }
}

// ============================================================================
// RATE LIMITER
// ============================================================================

class RateLimiter {
  constructor(requestsPerSecond) {
    this.minInterval = 1000 / requestsPerSecond;
    this.lastRequestTime = 0;
  }

  async wait() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }
}

// ============================================================================
// API ERROR CLASS
// ============================================================================

class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

// ============================================================================
// GOOGLE CALENDAR CLIENT
// ============================================================================

export class GoogleCalendarClient extends BaseApiClient {
  constructor(options) {
    super({
      ...options,
      baseUrl: 'https://www.googleapis.com/calendar/v3',
      provider: 'google_calendar'
    });
    this.tokenUrl = 'https://oauth2.googleapis.com/token';
  }

  async refreshAccessToken(credentials) {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET
      })
    });

    if (!response.ok) {
      throw new ApiError('Failed to refresh Google token', 'REFRESH_FAILED', response.status);
    }

    return await response.json();
  }

  // Calendar Events
  async listEvents(accountId, userId, options = {}) {
    const params = new URLSearchParams();
    if (options.timeMin) params.append('timeMin', options.timeMin);
    if (options.timeMax) params.append('timeMax', options.timeMax);
    if (options.maxResults) params.append('maxResults', String(options.maxResults));
    
    return await this.makeRequest(accountId, userId, 'GET', `/calendars/primary/events?${params}`);
  }

  async createEvent(accountId, userId, event) {
    return await this.makeRequest(accountId, userId, 'POST', '/calendars/primary/events', event);
  }

  async updateEvent(accountId, userId, eventId, event) {
    return await this.makeRequest(accountId, userId, 'PUT', `/calendars/primary/events/${eventId}`, event);
  }

  async deleteEvent(accountId, userId, eventId) {
    return await this.makeRequest(accountId, userId, 'DELETE', `/calendars/primary/events/${eventId}`);
  }

  // Free/Busy
  async getFreeBusy(accountId, userId, timeMin, timeMax, items = []) {
    return await this.makeRequest(accountId, userId, 'POST', '/freeBusy', {
      timeMin,
      timeMax,
      items: items.length > 0 ? items : [{ id: 'primary' }]
    });
  }

  // Calendars
  async listCalendars(accountId, userId) {
    return await this.makeRequest(accountId, userId, 'GET', '/users/me/calendarList');
  }

  // Google Meet
  async createMeetingSpace(accountId, userId, name) {
    return await this.makeRequest(accountId, userId, 'POST', 'https://meet.googleapis.com/v2/spaces', {
      name,
      config: { accessType: 'OPEN' }
    }, {
      'Authorization': null // Will be set by makeRequest
    });
  }
}

// ============================================================================
// CAL.COM CLIENT
// ============================================================================

export class CalComClient extends BaseApiClient {
  constructor(options) {
    super({
      ...options,
      baseUrl: 'https://api.cal.com/v2',
      provider: 'calcom',
      rateLimit: 10
    });
  }

  // Cal.com uses API keys that don't expire, but we still implement the interface
  async refreshAccessToken(credentials) {
    // API keys don't need refresh
    return {
      access_token: credentials.accessToken,
      expires_in: 3600
    };
  }

  async getMe(accountId, userId) {
    return await this.makeRequest(accountId, userId, 'GET', '/me', null, {
      'cal-api-version': '2024-08-13'
    });
  }

  async listBookings(accountId, userId, options = {}) {
    const params = new URLSearchParams();
    if (options.status) params.append('status', options.status);
    if (options.take) params.append('take', String(options.take));
    if (options.skip) params.append('skip', String(options.skip));
    
    return await this.makeRequest(accountId, userId, 'GET', `/bookings?${params}`, null, {
      'cal-api-version': '2024-08-13'
    });
  }

  async createBooking(accountId, userId, booking) {
    return await this.makeRequest(accountId, userId, 'POST', '/bookings', booking, {
      'cal-api-version': '2024-08-13'
    });
  }

  async cancelBooking(accountId, userId, bookingId, reason) {
    return await this.makeRequest(accountId, userId, 'POST', `/bookings/${bookingId}/cancel`, {
      reason
    }, {
      'cal-api-version': '2024-08-13'
    });
  }

  async listEventTypes(accountId, userId) {
    return await this.makeRequest(accountId, userId, 'GET', '/event-types', null, {
      'cal-api-version': '2024-08-13'
    });
  }

  async getAvailability(accountId, userId, eventTypeId, dateFrom, dateTo) {
    return await this.makeRequest(accountId, userId, 'GET', 
      `/slots?eventTypeId=${eventTypeId}&start=${dateFrom}&end=${dateTo}`, null, {
      'cal-api-version': '2024-08-13'
    });
  }
}

// ============================================================================
// NOTION CLIENT
// ============================================================================

export class NotionClient extends BaseApiClient {
  constructor(options) {
    super({
      ...options,
      baseUrl: 'https://api.notion.com/v1',
      provider: 'notion',
      rateLimit: 3 // Notion has strict rate limits
    });
  }

  async refreshAccessToken(credentials) {
    // Notion tokens don't expire
    return {
      access_token: credentials.accessToken,
      expires_in: 3600
    };
  }

  // Users
  async getMe(accountId, userId) {
    return await this.makeRequest(accountId, userId, 'GET', '/users/me', null, {
      'Notion-Version': '2022-06-28'
    });
  }

  // Pages
  async createPage(accountId, userId, page) {
    return await this.makeRequest(accountId, userId, 'POST', '/pages', page, {
      'Notion-Version': '2022-06-28'
    });
  }

  async getPage(accountId, userId, pageId) {
    return await this.makeRequest(accountId, userId, 'GET', `/pages/${pageId}`, null, {
      'Notion-Version': '2022-06-28'
    });
  }

  async updatePage(accountId, userId, pageId, properties) {
    return await this.makeRequest(accountId, userId, 'PATCH', `/pages/${pageId}`, { properties }, {
      'Notion-Version': '2022-06-28'
    });
  }

  // Blocks
  async appendBlocks(accountId, userId, blockId, children) {
    return await this.makeRequest(accountId, userId, 'PATCH', `/blocks/${blockId}/children`, { children }, {
      'Notion-Version': '2022-06-28'
    });
  }

  // Databases
  async queryDatabase(accountId, userId, databaseId, query = {}) {
    return await this.makeRequest(accountId, userId, 'POST', `/databases/${databaseId}/query`, query, {
      'Notion-Version': '2022-06-28'
    });
  }

  async getDatabase(accountId, userId, databaseId) {
    return await this.makeRequest(accountId, userId, 'GET', `/databases/${databaseId}`, null, {
      'Notion-Version': '2022-06-28'
    });
  }

  // Search
  async search(accountId, userId, query, filter = null) {
    const body = { query };
    if (filter) body.filter = filter;
    
    return await this.makeRequest(accountId, userId, 'POST', '/search', body, {
      'Notion-Version': '2022-06-28'
    });
  }
}

// ============================================================================
// GOOGLE TASKS CLIENT
// ============================================================================

export class GoogleTasksClient extends BaseApiClient {
  constructor(options) {
    super({
      ...options,
      baseUrl: 'https://tasks.googleapis.com/tasks/v1',
      provider: 'google_tasks'
    });
    this.tokenUrl = 'https://oauth2.googleapis.com/token';
  }

  async refreshAccessToken(credentials) {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET
      })
    });

    if (!response.ok) {
      throw new ApiError('Failed to refresh Google token', 'REFRESH_FAILED', response.status);
    }

    return await response.json();
  }

  // Task Lists
  async listTaskLists(accountId, userId) {
    return await this.makeRequest(accountId, userId, 'GET', '/users/@me/lists');
  }

  async getTaskList(accountId, userId, taskListId) {
    return await this.makeRequest(accountId, userId, 'GET', `/users/@me/lists/${taskListId}`);
  }

  async createTaskList(accountId, userId, title) {
    return await this.makeRequest(accountId, userId, 'POST', '/users/@me/lists', { title });
  }

  async deleteTaskList(accountId, userId, taskListId) {
    return await this.makeRequest(accountId, userId, 'DELETE', `/users/@me/lists/${taskListId}`);
  }

  // Tasks
  async listTasks(accountId, userId, taskListId = '@default', options = {}) {
    const params = new URLSearchParams();
    if (options.showCompleted !== undefined) params.append('showCompleted', String(options.showCompleted));
    if (options.dueMin) params.append('dueMin', options.dueMin);
    if (options.dueMax) params.append('dueMax', options.dueMax);
    
    return await this.makeRequest(accountId, userId, 'GET', 
      `/lists/${taskListId}/tasks?${params.toString()}`);
  }

  async getTask(accountId, userId, taskListId, taskId) {
    return await this.makeRequest(accountId, userId, 'GET', `/lists/${taskListId}/tasks/${taskId}`);
  }

  async createTask(accountId, userId, taskListId = '@default', task) {
    return await this.makeRequest(accountId, userId, 'POST', `/lists/${taskListId}/tasks`, task);
  }

  async updateTask(accountId, userId, taskListId, taskId, task) {
    return await this.makeRequest(accountId, userId, 'PUT', `/lists/${taskListId}/tasks/${taskId}`, task);
  }

  async completeTask(accountId, userId, taskListId, taskId) {
    return await this.makeRequest(accountId, userId, 'PUT', `/lists/${taskListId}/tasks/${taskId}`, {
      status: 'completed',
      completed: new Date().toISOString()
    });
  }

  async deleteTask(accountId, userId, taskListId, taskId) {
    return await this.makeRequest(accountId, userId, 'DELETE', `/lists/${taskListId}/tasks/${taskId}`);
  }

  async moveTask(accountId, userId, taskListId, taskId, parent = null, previous = null) {
    const params = new URLSearchParams();
    if (parent) params.append('parent', parent);
    if (previous) params.append('previous', previous);
    
    return await this.makeRequest(accountId, userId, 'POST', 
      `/lists/${taskListId}/tasks/${taskId}/move?${params.toString()}`);
  }
}

// ============================================================================
// CLIENT FACTORY
// ============================================================================

export class ConnectorClientFactory {
  constructor(supabase) {
    this.supabase = supabase;
    this.credentialManager = new CredentialManager({ supabase });
    this.clients = new Map();
  }

  getClient(connectorId) {
    if (this.clients.has(connectorId)) {
      return this.clients.get(connectorId);
    }

    const options = {
      credentialManager: this.credentialManager,
      supabase: this.supabase
    };

    let client;
    switch (connectorId) {
      case 'google_calendar':
        client = new GoogleCalendarClient(options);
        break;
      case 'calcom':
        client = new CalComClient(options);
        break;
      case 'notion':
        client = new NotionClient(options);
        break;
      case 'google_tasks':
        client = new GoogleTasksClient(options);
        break;
      default:
        throw new Error(`Unknown connector: ${connectorId}`);
    }

    this.clients.set(connectorId, client);
    return client;
  }
}

export default {
  GoogleCalendarClient,
  CalComClient,
  NotionClient,
  GoogleTasksClient,
  ConnectorClientFactory,
  ApiError
};
