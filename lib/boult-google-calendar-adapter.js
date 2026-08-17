/**
 * Google Calendar Adapter
 * 
 * Phase 4: Production-grade adapter for Google Calendar integration
 * Supports: create meeting, update meeting, delete meeting, list events, get availability
 */

const { google } = require('googleapis');
const { BaseIntegrationAdapter, buildConnectCTA, formatExternalRefs, INTEGRATION_ERROR_CATEGORIES } = require('./boult-integration-adapter-contract');

class GoogleCalendarAdapter extends BaseIntegrationAdapter {
  constructor(db) {
    super(db);
    this.provider = 'google_calendar';
    this.displayName = 'Google Calendar';
    this.icon = 'calendar';
    this.requiredScopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ];
    this.capabilities = {
      read: true,
      write: true,
      create: true,
      update: true,
      delete: true,
      search: true,
      createMeeting: true
    };
  }

  /**
   * Create OAuth2 client
   */
  createOAuthClient(baseUrl) {
    const redirectUri = `${this.getBaseUrl(baseUrl)}/api/integrations/google_calendar/callback`;
    console.log(`[GoogleCalendarAdapter] Creating OAuth client with redirect URI: ${redirectUri}`);
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

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const { data: calendarList } = await calendar.calendarList.list({ maxResults: 1 });

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
          email: calendarList.items?.[0]?.id
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
   * Execute calendar actions
   */
  async executeAction(userEmail, payload) {
    try {
      const credentials = await this.getCredentials(userEmail);
      if (!credentials) {
        return {
          success: false,
          error: {
            code: 'NOT_CONNECTED',
            message: 'Google Calendar not connected',
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

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      switch (payload.action) {
        case 'create_meeting':
          return await this.createMeeting(calendar, payload.params);
        case 'update_meeting':
          return await this.updateMeeting(calendar, payload.params);
        case 'delete_meeting':
          return await this.deleteMeeting(calendar, payload.params);
        case 'list_events':
          return await this.listEvents(calendar, payload.params);
        case 'get_availability':
          return await this.getAvailability(calendar, payload.params);
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
   * Create a meeting with Google Meet
   */
  async createMeeting(calendar, params) {
    const { summary, description, startTime, endTime, attendees = [], location, includeMeetLink = true } = params;

    const event = {
      summary,
      description,
      start: {
        dateTime: new Date(startTime).toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: new Date(endTime).toISOString(),
        timeZone: 'UTC'
      },
      attendees: attendees.map(email => ({ email })),
      location
    };

    // Add Google Meet if requested
    if (includeMeetLink) {
      event.conferenceData = {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet'
          }
        }
      };
    }

    const { data } = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: includeMeetLink ? 1 : 0,
      sendUpdates: 'all'
    });

    return this.normalizeResult('create_meeting', data);
  }

  /**
   * Update an existing meeting
   */
  async updateMeeting(calendar, params) {
    const { eventId, summary, description, startTime, endTime, attendees } = params;

    const event = {};
    if (summary) event.summary = summary;
    if (description) event.description = description;
    if (startTime) {
      event.start = {
        dateTime: new Date(startTime).toISOString(),
        timeZone: 'UTC'
      };
    }
    if (endTime) {
      event.end = {
        dateTime: new Date(endTime).toISOString(),
        timeZone: 'UTC'
      };
    }
    if (attendees) {
      event.attendees = attendees.map(email => ({ email }));
    }

    const { data } = await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      resource: event,
      sendUpdates: 'all'
    });

    return this.normalizeResult('update_meeting', data);
  }

  /**
   * Delete a meeting
   */
  async deleteMeeting(calendar, params) {
    const { eventId } = params;

    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all'
    });

    return this.buildSuccessResult({ deleted: true }, { eventId });
  }

  /**
   * List calendar events
   */
  async listEvents(calendar, params) {
    const { startTime, endTime, maxResults = 10, query } = params;

    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
      timeMax: endTime ? new Date(endTime).toISOString() : undefined,
      maxResults,
      q: query,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return this.buildSuccessResult({
      events: data.items.map(event => ({
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start,
        end: event.end,
        location: event.location,
        meetLink: event.hangoutLink,
        attendees: event.attendees?.map(a => ({ email: a.email, responseStatus: a.responseStatus }))
      }))
    });
  }

  /**
   * Get availability (free/busy)
   */
  async getAvailability(calendar, params) {
    const { startTime, endTime, timeZone = 'UTC' } = params;

    const { data } = await calendar.freebusy.query({
      requestBody: {
        timeMin: new Date(startTime).toISOString(),
        timeMax: new Date(endTime).toISOString(),
        timeZone,
        items: [{ id: 'primary' }]
      }
    });

    const busy = data.calendars?.primary?.busy || [];

    return this.buildSuccessResult({
      busy,
      available: busy.length === 0
    });
  }

  /**
   * Normalize result to canonical format
   */
  normalizeResult(action, rawResult) {
    const externalRefs = formatExternalRefs({
      eventId: rawResult.id,
      meetLink: rawResult.hangoutLink,
      calendarLink: rawResult.htmlLink,
      eventEtag: rawResult.etag
    });

    return this.buildSuccessResult({
      id: rawResult.id,
      summary: rawResult.summary,
      description: rawResult.description,
      start: rawResult.start,
      end: rawResult.end,
      location: rawResult.location,
      meetLink: rawResult.hangoutLink,
      calendarLink: rawResult.htmlLink,
      attendees: rawResult.attendees,
      created: rawResult.created,
      updated: rawResult.updated,
      status: rawResult.status
    }, externalRefs);
  }

  /**
   * Map Google errors to canonical format
   */
  mapError(error, action) {
    const code = error.code || error.status;
    const message = error.message || 'Unknown error';

    // Map HTTP status codes to categories
    if (code === 401 || message.includes('invalid_grant')) {
      return {
        code: 'AUTH_EXPIRED',
        message: 'Your Google Calendar connection has expired. Please reconnect.',
        category: INTEGRATION_ERROR_CATEGORIES.AUTH_EXPIRED,
        retryable: false,
        recoveryHint: buildConnectCTA(this.provider)
      };
    }

    if (code === 403) {
      if (message.includes('insufficient permissions') || message.includes('scope')) {
        return {
          code: 'SCOPE_MISSING',
          message: 'Additional permissions required for Google Calendar',
          category: INTEGRATION_ERROR_CATEGORIES.SCOPE_MISSING,
          retryable: false,
          recoveryHint: buildConnectCTA(this.provider, this.requiredScopes)
        };
      }
      return {
        code: 'PERMISSION_DENIED',
        message: 'Permission denied. Check your Google Calendar access.',
        category: INTEGRATION_ERROR_CATEGORIES.PERMISSION_DENIED,
        retryable: false
      };
    }

    if (code === 404) {
      return {
        code: 'EVENT_NOT_FOUND',
        message: 'The requested event was not found',
        category: INTEGRATION_ERROR_CATEGORIES.RESOURCE_NOT_FOUND,
        retryable: false
      };
    }

    if (code === 429) {
      return {
        code: 'RATE_LIMITED',
        message: 'Google Calendar rate limit reached. Please try again in a moment.',
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
        message: 'Google Calendar service error. Please try again.',
        category: INTEGRATION_ERROR_CATEGORIES.PROVIDER_ERROR,
        retryable: true
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: `Google Calendar error: ${message}`,
      category: INTEGRATION_ERROR_CATEGORIES.UNKNOWN,
      retryable: false
    };
  }
}

module.exports = { GoogleCalendarAdapter };
