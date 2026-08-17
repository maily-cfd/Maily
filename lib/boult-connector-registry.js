/**
 * Boult Connector Registry - Phase 4 (V1 Selected)
 * 
 * Only 4 production connectors:
 * 1. Google Calendar/Meet
 * 2. Cal.com
 * 3. Notion
 * 4. Google Tasks/Lists
 * 
 * No Custom API or Custom MCP - only real integrations.
 */

export const CONNECTOR_CATEGORIES = {
  CALENDAR: 'calendar',
  PRODUCTIVITY: 'productivity',
  TASKS: 'tasks'
};

export const CONNECTOR_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
  EXPIRED: 'expired'
};

export const CONNECTOR_REGISTRY = {
  google_calendar: {
    id: 'google_calendar',
    name: 'Google Calendar & Meet',
    description: 'Schedule meetings, manage events, and launch Google Meet video calls',
    category: CONNECTOR_CATEGORIES.CALENDAR,
    provider: 'google',
    icon: '/connectors/google-calendar.svg',
    color: '#4285F4',
    oauth: {
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly'
      ],
      additionalScopes: ['https://www.googleapis.com/auth/userinfo.email']
    },
    capabilities: { read: true, write: true, search: true, realtime: true, webhooks: true, meet: true },
    actions: ['create_event', 'update_event', 'delete_event', 'get_events', 'get_availability', 'search_events', 'create_meeting_space', 'get_meeting_link'],
    ui: { showInPromptBox: true, showInBanner: true, priority: 1 }
  },

  calcom: {
    id: 'calcom',
    name: 'Cal.com',
    description: 'Schedule appointments and manage bookings with Cal.com integration',
    category: CONNECTOR_CATEGORIES.CALENDAR,
    provider: 'calcom',
    icon: '/connectors/calcom.svg',
    color: '#292929',
    oauth: {
      authorizationEndpoint: 'https://app.cal.com/auth/oauth2/authorize',
      tokenEndpoint: 'https://api.cal.com/v2/oauth2/token',
      scopes: ['bookings:read', 'bookings:write', 'event-types:read', 'event-types:write', 'user:read'],
      additionalScopes: []
    },
    capabilities: { read: true, write: true, search: true, realtime: true, webhooks: true },
    actions: ['get_bookings', 'create_booking', 'cancel_booking', 'get_event_types', 'get_availability_slots', 'reschedule_booking'],
    ui: { showInPromptBox: true, showInBanner: true, priority: 2 }
  },

  notion: {
    id: 'notion',
    name: 'Notion',
    description: 'Create pages, update databases, and manage your Notion workspace',
    category: CONNECTOR_CATEGORIES.PRODUCTIVITY,
    provider: 'notion',
    icon: '/connectors/notion.svg',
    color: '#000000',
    oauth: {
      authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
      tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
      scopes: [],
      additionalScopes: []
    },
    capabilities: { read: true, write: true, search: true, realtime: false, webhooks: true },
    actions: ['search_pages', 'get_page', 'create_page', 'update_page', 'query_database', 'append_blocks', 'get_database_schema'],
    ui: { showInPromptBox: true, showInBanner: true, priority: 3 }
  },

  google_tasks: {
    id: 'google_tasks',
    name: 'Google Tasks',
    description: 'Manage task lists, create todos, and track completion',
    category: CONNECTOR_CATEGORIES.TASKS,
    provider: 'google',
    icon: '/connectors/google-tasks.svg',
    color: '#0F9D58',
    oauth: {
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
      scopes: ['https://www.googleapis.com/auth/tasks', 'https://www.googleapis.com/auth/tasks.readonly'],
      additionalScopes: ['https://www.googleapis.com/auth/userinfo.email']
    },
    capabilities: { read: true, write: true, search: true, realtime: false, webhooks: false },
    actions: ['get_task_lists', 'create_task_list', 'get_tasks', 'create_task', 'update_task', 'complete_task', 'delete_task', 'move_task'],
    ui: { showInPromptBox: true, showInBanner: true, priority: 4 }
  }
};

// ============================================================================
// CONNECTOR UTILITIES
// ============================================================================

/**
 * Get connector by ID
 */
export function getConnector(id) {
  return CONNECTOR_REGISTRY[id] || null;
}

/**
 * Get all connectors
 */
export function getAllConnectors() {
  return Object.values(CONNECTOR_REGISTRY);
}

/**
 * Get connectors by category
 */
export function getConnectorsByCategory(category) {
  return Object.values(CONNECTOR_REGISTRY).filter(
    c => c.category === category
  );
}

/**
 * Get connectors for prompt box display
 */
export function getPromptBoxConnectors() {
  return Object.values(CONNECTOR_REGISTRY)
    .filter(c => c.ui.showInPromptBox)
    .sort((a, b) => a.ui.priority - b.ui.priority);
}

/**
 * Get connectors for banner display
 */
export function getBannerConnectors() {
  return Object.values(CONNECTOR_REGISTRY)
    .filter(c => c.ui.showInBanner)
    .sort((a, b) => a.ui.priority - b.ui.priority);
}

/**
 * Get OAuth URL for connector
 */
export function getOAuthUrl(connectorId, redirectUri, state) {
  const connector = getConnector(connectorId);
  if (!connector) return null;

  const params = new URLSearchParams({
    client_id: process.env[`${connector.provider.toUpperCase()}_CLIENT_ID`],
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [...connector.oauth.scopes, ...connector.oauth.additionalScopes].join(' '),
    state: state,
    access_type: 'offline',
    prompt: 'consent'
  });

  return `${connector.oauth.authorizationEndpoint}?${params.toString()}`;
}

/**
 * Check if user has connected any accounts
 */
export function hasConnectedAccounts(connectedAccounts) {
  if (!connectedAccounts || !Array.isArray(connectedAccounts)) {
    return false;
  }
  return connectedAccounts.some(
    account => account.status === CONNECTOR_STATUS.CONNECTED
  );
}

/**
 * Get connected connectors
 */
export function getConnectedConnectors(connectedAccounts) {
  if (!connectedAccounts) return [];
  
  return connectedAccounts
    .filter(account => account.status === CONNECTOR_STATUS.CONNECTED)
    .map(account => ({
      ...getConnector(account.connectorId),
      accountId: account.id,
      connectedAt: account.connectedAt,
      email: account.email
    }))
    .filter(Boolean);
}

export default {
  CONNECTOR_REGISTRY,
  CONNECTOR_CATEGORIES,
  CONNECTOR_STATUS,
  getConnector,
  getAllConnectors,
  getConnectorsByCategory,
  getPromptBoxConnectors,
  getBannerConnectors,
  getOAuthUrl,
  hasConnectedAccounts,
  getConnectedConnectors
};
