/**
 * Cal.com Adapter
 * 
 * Phase 4: Production-grade adapter for Cal.com integration
 * Supports: create meeting, get booking link, list event types, reschedule
 */

const { BaseIntegrationAdapter, buildConnectCTA, formatExternalRefs, INTEGRATION_ERROR_CATEGORIES } = require('./boult-integration-adapter-contract');

class CalComAdapter extends BaseIntegrationAdapter {
  constructor(db) {
    super(db);
    this.provider = 'cal_com';
    this.displayName = 'Cal.com';
    this.icon = 'video';
    this.requiredScopes = ['booking_write', 'booking_read', 'event_type_read'];
    this.capabilities = {
      read: true,
      write: true,
      create: true,
      update: true,
      delete: true,
      search: true,
      createMeeting: true
    };
    this.baseUrl = 'https://api.cal.com/v1';
  }

  /**
   * Build OAuth authorization URL
   */
  buildAuthUrl(state, baseUrl) {
    const redirectUri = `${this.getBaseUrl(baseUrl)}/api/integrations/cal_com/callback`;
    console.log(`[CalComAdapter] Building auth URL with redirect URI: ${redirectUri}`);
    const params = new URLSearchParams({
      client_id: process.env.CAL_COM_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.requiredScopes.join(' '),
      state: state || ''
    });
    return `https://app.cal.com/auth/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange code for tokens
   */
  async exchangeCode(code, baseUrl) {
    const redirectUri = `${this.getBaseUrl(baseUrl)}/api/integrations/cal_com/callback`;
    console.log(`[CalComAdapter] Exchanging code with redirect URI: ${redirectUri}`);
    const response = await fetch(`${this.baseUrl}/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.CAL_COM_CLIENT_ID,
        client_secret: process.env.CAL_COM_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
      scopes: data.scope?.split(' ') || this.requiredScopes
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
      
      if (isExpired) {
        // Try to refresh
        const refreshed = await this.refreshToken(credentials.refreshToken);
        if (!refreshed) {
          return {
            connected: false,
            provider: this.provider,
            capabilities: this.capabilities,
            tokenHealth: { valid: false, expiresAt: credentials.expiresAt, reauthRequired: true },
            scopes: credentials.scopes,
            missingScopes: this.requiredScopes
          };
        }
        
        await this.storeCredentials(userEmail, {
          ...credentials,
          accessToken: refreshed.accessToken,
          expiresAt: refreshed.expiresAt
        });
        credentials.accessToken = refreshed.accessToken;
      }

      // Validate token by making a test API call
      const response = await fetch(`${this.baseUrl}/me`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            connected: false,
            provider: this.provider,
            capabilities: this.capabilities,
            tokenHealth: { valid: false, reauthRequired: true },
            scopes: credentials.scopes,
            missingScopes: this.requiredScopes
          };
        }
        throw new Error(`API validation failed: ${response.status}`);
      }

      const userData = await response.json();

      // Check missing scopes
      const grantedScopes = credentials.scopes || [];
      const missingScopes = this.requiredScopes.filter(
        scope => !grantedScopes.includes(scope)
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
          email: userData.email,
          name: userData.name,
          id: userData.id?.toString()
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
   * Refresh access token
   */
  async refreshToken(refreshToken) {
    if (!refreshToken) return null;

    try {
      const response = await fetch(`${this.baseUrl}/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.CAL_COM_CLIENT_ID,
          client_secret: process.env.CAL_COM_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      });

      if (!response.ok) return null;

      const data = await response.json();
      return {
        accessToken: data.access_token,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined
      };
    } catch {
      return null;
    }
  }

  /**
   * Execute Cal.com actions
   */
  async executeAction(userEmail, payload) {
    try {
      const credentials = await this.getCredentials(userEmail);
      if (!credentials) {
        return {
          success: false,
          error: {
            code: 'NOT_CONNECTED',
            message: 'Cal.com not connected',
            category: INTEGRATION_ERROR_CATEGORIES.AUTH_REVOKED,
            retryable: false,
            recoveryHint: buildConnectCTA(this.provider)
          }
        };
      }

      // Refresh if needed
      if (this.isTokenExpired(credentials.expiresAt)) {
        const refreshed = await this.refreshToken(credentials.refreshToken);
        if (!refreshed) {
          return {
            success: false,
            error: {
              code: 'AUTH_EXPIRED',
              message: 'Cal.com connection expired. Please reconnect.',
              category: INTEGRATION_ERROR_CATEGORIES.AUTH_EXPIRED,
              retryable: false,
              recoveryHint: buildConnectCTA(this.provider)
            }
          };
        }
        credentials.accessToken = refreshed.accessToken;
        await this.storeCredentials(userEmail, {
          ...credentials,
          accessToken: refreshed.accessToken,
          expiresAt: refreshed.expiresAt
        });
      }

      switch (payload.action) {
        case 'create_meeting':
          return await this.createBooking(credentials.accessToken, payload.params);
        case 'get_booking_link':
          return await this.getBookingLink(credentials.accessToken, payload.params);
        case 'list_event_types':
          return await this.listEventTypes(credentials.accessToken, payload.params);
        case 'reschedule_booking':
          return await this.rescheduleBooking(credentials.accessToken, payload.params);
        case 'cancel_booking':
          return await this.cancelBooking(credentials.accessToken, payload.params);
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
   * Create a booking
   */
  async createBooking(accessToken, params) {
    const { eventTypeId, startTime, endTime, attendeeEmail, attendeeName, notes } = params;

    const response = await fetch(`${this.baseUrl}/bookings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        eventTypeId: parseInt(eventTypeId),
        start: startTime,
        end: endTime,
        responses: {
          name: attendeeName,
          email: attendeeEmail,
          notes
        },
        timeZone: 'UTC'
      })
    });

    if (!response.ok) {
      throw new Error(`Booking creation failed: ${response.status}`);
    }

    const data = await response.json();
    return this.normalizeResult('create_meeting', data);
  }

  /**
   * Get booking link for an event type
   */
  async getBookingLink(accessToken, params) {
    const { eventTypeSlug, username } = params;

    // Get event type details
    const response = await fetch(`${this.baseUrl}/event-types`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      throw new Error(`Event types fetch failed: ${response.status}`);
    }

    const { event_types } = await response.json();
    const eventType = event_types.find(et => 
      et.slug === eventTypeSlug || et.id.toString() === eventTypeSlug
    );

    if (!eventType) {
      return {
        success: false,
        error: {
          code: 'EVENT_TYPE_NOT_FOUND',
          message: 'Event type not found',
          category: INTEGRATION_ERROR_CATEGORIES.RESOURCE_NOT_FOUND,
          retryable: false
        }
      };
    }

    const bookingUrl = `https://cal.com/${username || eventType.users[0]?.username}/${eventType.slug}`;

    return this.buildSuccessResult({
      eventTypeId: eventType.id,
      slug: eventType.slug,
      title: eventType.title,
      description: eventType.description,
      duration: eventType.length,
      bookingUrl
    }, {
      bookingUrl,
      eventTypeId: eventType.id.toString()
    });
  }

  /**
   * List event types
   */
  async listEventTypes(accessToken, params) {
    const { maxResults = 10 } = params;

    const response = await fetch(`${this.baseUrl}/event-types?limit=${maxResults}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      throw new Error(`Event types fetch failed: ${response.status}`);
    }

    const { event_types } = await response.json();

    return this.buildSuccessResult({
      eventTypes: event_types.map(et => ({
        id: et.id,
        slug: et.slug,
        title: et.title,
        description: et.description,
        duration: et.length,
        status: et.status,
        hidden: et.hidden,
        currency: et.currency,
        price: et.price
      }))
    });
  }

  /**
   * Reschedule a booking
   */
  async rescheduleBooking(accessToken, params) {
    const { bookingId, newStartTime, newEndTime, reason } = params;

    const response = await fetch(`${this.baseUrl}/bookings/${bookingId}/reschedule`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        start: newStartTime,
        end: newEndTime,
        reschedulingReason: reason
      })
    });

    if (!response.ok) {
      throw new Error(`Reschedule failed: ${response.status}`);
    }

    const data = await response.json();
    return this.normalizeResult('reschedule_booking', data);
  }

  /**
   * Cancel a booking
   */
  async cancelBooking(accessToken, params) {
    const { bookingId, reason } = params;

    const response = await fetch(`${this.baseUrl}/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cancellationReason: reason
      })
    });

    if (!response.ok) {
      throw new Error(`Cancel failed: ${response.status}`);
    }

    return this.buildSuccessResult({ cancelled: true }, { bookingId });
  }

  /**
   * Normalize result to canonical format
   */
  normalizeResult(action, rawResult) {
    const externalRefs = formatExternalRefs({
      bookingId: rawResult.id?.toString(),
      bookingUid: rawResult.uid,
      bookingLink: rawResult.bookingUrl,
      meetingUrl: rawResult.metadata?.videoCallUrl,
      rescheduleLink: rawResult.rescheduleUrl,
      cancelLink: rawResult.cancelUrl
    });

    return this.buildSuccessResult({
      id: rawResult.id,
      uid: rawResult.uid,
      title: rawResult.title,
      description: rawResult.description,
      start: rawResult.start,
      end: rawResult.end,
      status: rawResult.status,
      attendees: rawResult.attendees,
      user: rawResult.user,
      eventType: rawResult.eventType,
      metadata: rawResult.metadata
    }, externalRefs);
  }

  /**
   * Map Cal.com errors to canonical format
   */
  mapError(error, action) {
    const code = error.status || error.statusCode;
    const message = error.message || 'Unknown error';

    if (code === 401 || message.includes('unauthorized')) {
      return {
        code: 'AUTH_EXPIRED',
        message: 'Your Cal.com connection has expired. Please reconnect.',
        category: INTEGRATION_ERROR_CATEGORIES.AUTH_EXPIRED,
        retryable: false,
        recoveryHint: buildConnectCTA(this.provider)
      };
    }

    if (code === 403) {
      return {
        code: 'PERMISSION_DENIED',
        message: 'Permission denied. Check your Cal.com account access.',
        category: INTEGRATION_ERROR_CATEGORIES.PERMISSION_DENIED,
        retryable: false
      };
    }

    if (code === 404) {
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested resource was not found',
        category: INTEGRATION_ERROR_CATEGORIES.RESOURCE_NOT_FOUND,
        retryable: false
      };
    }

    if (code === 409) {
      return {
        code: 'BOOKING_CONFLICT',
        message: 'Time slot is already booked or not available',
        category: INTEGRATION_ERROR_CATEGORIES.INVALID_PAYLOAD,
        retryable: false,
        recoveryHint: {
          userMessage: 'This time slot is not available. Please choose another time.',
          recoveryAction: 'revise_input',
          requiresUserAction: true,
          autoRetry: false
        }
      };
    }

    if (code === 429) {
      return {
        code: 'RATE_LIMITED',
        message: 'Cal.com rate limit reached. Please try again.',
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
        message: 'Cal.com service error. Please try again.',
        category: INTEGRATION_ERROR_CATEGORIES.PROVIDER_ERROR,
        retryable: true
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: `Cal.com error: ${message}`,
      category: INTEGRATION_ERROR_CATEGORIES.UNKNOWN,
      retryable: false
    };
  }
}

module.exports = { CalComAdapter };
