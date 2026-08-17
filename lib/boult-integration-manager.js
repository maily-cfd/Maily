/**
 * Boult Integration Manager
 * 
 * Phase 4: Central manager for all integrations
 */

// Ensure environment variables are loaded for adapters
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });
require('dotenv').config(); // Also load .env if it exists

const { GoogleCalendarAdapter } = require('./boult-google-calendar-adapter');
const { CalComAdapter } = require('./boult-cal-com-adapter');
const { NotionAdapter } = require('./boult-notion-adapter');
const { GoogleTasksAdapter } = require('./boult-google-tasks-adapter');
const { GoogleMeetAdapter } = require('./boult-google-meet-adapter');
const { NotionCalendarAdapter } = require('./boult-notion-calendar-adapter');
const { SlackAdapter } = require('./boult-slack-adapter');
const { getIntegrationRegistry, buildConnectCTA, formatExternalRefs } = require('./boult-integration-adapter-contract');

class BoultIntegrationManager {
  constructor(db) {
    this.db = db;
    this.registry = getIntegrationRegistry();
    this.initializeAdapters();
  }

  /**
   * Initialize and register all integration adapters
   */
  initializeAdapters() {
    // Register Google Calendar
    this.registry.register(new GoogleCalendarAdapter(this.db));
    
    // Register Cal.com
    this.registry.register(new CalComAdapter(this.db));
    
    // Register Notion
    this.registry.register(new NotionAdapter(this.db));
    
    // Register Google Tasks
    this.registry.register(new GoogleTasksAdapter(this.db));

    // Register Google Meet
    this.registry.register(new GoogleMeetAdapter(this.db));

    // Register Notion Calendar
    this.registry.register(new NotionCalendarAdapter(this.db));

    // Register Slack
    this.registry.register(new SlackAdapter(this.db));

    console.log('[IntegrationManager] Registered adapters:', 
      this.registry.getAll().map(a => a.provider).join(', '));
  }

  /**
   * Get status of all integrations for a user
   */
  async getAllIntegrationStatuses(userEmail) {
    const statuses = await this.registry.getAllStatuses(userEmail);
    
    return {
      userEmail,
      integrations: statuses.reduce((acc, status) => {
        acc[status.provider] = status;
        return acc;
      }, {}),
      summary: {
        total: statuses.length,
        connected: statuses.filter(s => s.connected).length,
        disconnected: statuses.filter(s => !s.connected).length,
        reauthRequired: statuses.filter(s => s.tokenHealth?.reauthRequired).length
      }
    };
  }

  /**
   * Get status of a specific integration
   */
  async getIntegrationStatus(userEmail, provider) {
    const adapter = this.registry.get(provider);
    if (!adapter) {
      throw new Error(`Unknown integration provider: ${provider}`);
    }
    
    return await adapter.validateConnection(userEmail);
  }

  /**
   * Execute an action on a specific integration
   */
  async executeAction(userEmail, provider, action, params, metadata = {}) {
    const adapter = this.registry.get(provider);
    if (!adapter) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_PROVIDER',
          message: `Unknown integration provider: ${provider}`,
          category: 'invalid_payload',
          retryable: false
        }
      };
    }

    // First validate connection
    const status = await adapter.validateConnection(userEmail);
    if (!status.connected) {
      return {
        success: false,
        error: {
          code: 'NOT_CONNECTED',
          message: `${adapter.displayName} is not connected`,
          category: 'auth_revoked',
          retryable: false,
          recoveryHint: buildConnectCTA(provider, status.missingScopes)
        }
      };
    }

    if (status.tokenHealth?.reauthRequired) {
      return {
        success: false,
        error: {
          code: 'REAUTH_REQUIRED',
          message: `${adapter.displayName} needs reauthorization`,
          category: 'auth_expired',
          retryable: false,
          recoveryHint: buildConnectCTA(provider, status.missingScopes)
        }
      };
    }

    // Execute the action
    return await adapter.executeAction(userEmail, {
      action,
      params,
      metadata
    });
  }

  /**
   * Store integration credentials
   */
  async storeCredentials(userEmail, provider, credentials) {
    const adapter = this.registry.get(provider);
    if (!adapter) {
      throw new Error(`Unknown integration provider: ${provider}`);
    }

    await adapter.storeCredentials(userEmail, credentials);
    
    // Log the connection
    await this.db.logIntegrationEvent(userEmail, provider, 'connected', {
      scopes: credentials.scopes
    });
  }

  /**
   * Disconnect an integration
   */
  async disconnectIntegration(userEmail, provider) {
    // Revoke token if possible
    const adapter = this.registry.get(provider);
    if (adapter && adapter.revokeToken) {
      try {
        await adapter.revokeToken(userEmail);
      } catch (error) {
        console.warn(`[IntegrationManager] Failed to revoke ${provider} token:`, error);
      }
    }

    // Remove credentials from database
    await this.db.deleteIntegrationCredentials(userEmail, provider);
    
    // Log the disconnection
    await this.db.logIntegrationEvent(userEmail, provider, 'disconnected');

    return { disconnected: true };
  }

  /**
   * Get available actions for a provider
   */
  getProviderActions(provider) {
    const adapter = this.registry.get(provider);
    if (!adapter) return null;

    const actionMap = {
      google_calendar: [
        { action: 'create_meeting', label: 'Create Meeting', description: 'Create a calendar event with optional Google Meet' },
        { action: 'update_meeting', label: 'Update Meeting', description: 'Modify an existing calendar event' },
        { action: 'delete_meeting', label: 'Delete Meeting', description: 'Remove a calendar event' },
        { action: 'list_events', label: 'List Events', description: 'Get calendar events for a time range' },
        { action: 'get_availability', label: 'Check Availability', description: 'Get free/busy information' }
      ],
      cal_com: [
        { action: 'create_meeting', label: 'Book Meeting', description: 'Create a booking through Cal.com' },
        { action: 'get_booking_link', label: 'Get Booking Link', description: 'Get shareable booking URL' },
        { action: 'list_event_types', label: 'List Event Types', description: 'Get available meeting types' },
        { action: 'reschedule_booking', label: 'Reschedule', description: 'Move a booking to a new time' },
        { action: 'cancel_booking', label: 'Cancel Booking', description: 'Cancel an existing booking' }
      ],
      notion: [
        { action: 'create_page', label: 'Create Page', description: 'Create a new Notion page' },
        { action: 'update_page', label: 'Update Page', description: 'Modify an existing page' },
        { action: 'query_database', label: 'Query Database', description: 'Search and filter database entries' },
        { action: 'create_database_item', label: 'Add Database Item', description: 'Create entry in a database' },
        { action: 'search', label: 'Search', description: 'Search across Notion workspace' },
        { action: 'get_page', label: 'Get Page', description: 'Retrieve page details' },
        { action: 'append_blocks', label: 'Add Content', description: 'Append blocks to a page' }
      ],
      google_tasks: [
        { action: 'create_task', label: 'Create Task', description: 'Add a new task to a list' },
        { action: 'update_task', label: 'Update Task', description: 'Modify task details' },
        { action: 'complete_task', label: 'Complete Task', description: 'Mark task as done' },
        { action: 'delete_task', label: 'Delete Task', description: 'Remove a task' },
        { action: 'list_tasks', label: 'List Tasks', description: 'Get tasks from a list' },
        { action: 'create_task_list', label: 'Create List', description: 'Create a new task list' },
        { action: 'list_task_lists', label: 'Lists', description: 'Get all task lists' }
      ]
    };

    return {
      provider: adapter.provider,
      displayName: adapter.displayName,
      icon: adapter.icon,
      capabilities: adapter.capabilities,
      actions: actionMap[provider] || []
    };
  }

  /**
   * Get all available actions across all integrations
   */
  getAllAvailableActions(userEmail) {
    const adapters = this.registry.getAll();
    
    return adapters.map(adapter => {
      const actions = this.getProviderActions(adapter.provider);
      return {
        ...actions,
        connected: false // Will be populated by caller with actual status
      };
    });
  }

  /**
   * Check if action is available (integration connected)
   */
  async isActionAvailable(userEmail, provider) {
    const status = await this.getIntegrationStatus(userEmail, provider);
    return status.connected && !status.tokenHealth?.reauthRequired;
  }

  /**
   * Get integration auth URL
   */
  getAuthUrl(provider, state, baseUrl) {
    const adapter = this.registry.get(provider);
    if (!adapter) {
      throw new Error(`Unknown integration provider: ${provider}`);
    }
    
    return adapter.buildAuthUrl(state, baseUrl);
  }

  /**
   * Exchange OAuth code for tokens
   */
  async exchangeCode(provider, code, baseUrl) {
    const adapter = this.registry.get(provider);
    if (!adapter) {
      throw new Error(`Unknown integration provider: ${provider}`);
    }
    
    return await adapter.exchangeCode(code, baseUrl);
  }
}

module.exports = { BoultIntegrationManager };
