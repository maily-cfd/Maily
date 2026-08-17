/**
 * Boult Integration Adapter Contract
 * 
 * Phase 4: Production-grade integration adapters with consistent interface
 * All integrations must implement this interface for unified execution
 */

// ============================================================================
// ERROR CATEGORIES
// ============================================================================

const INTEGRATION_ERROR_CATEGORIES = {
  AUTH_EXPIRED: 'auth_expired',
  AUTH_REVOKED: 'auth_revoked',
  SCOPE_MISSING: 'scope_missing',
  RATE_LIMITED: 'rate_limited',
  INVALID_PAYLOAD: 'invalid_payload',
  RESOURCE_NOT_FOUND: 'resource_not_found',
  PERMISSION_DENIED: 'permission_denied',
  NETWORK_ERROR: 'network_error',
  PROVIDER_ERROR: 'provider_error',
  UNKNOWN: 'unknown'
};

// ============================================================================
// BASE ADAPTER CLASS
// ============================================================================

class BaseIntegrationAdapter {
  constructor(db) {
    this.db = db;
  }

  getBaseUrl(overrideUrl) {
    const isValid = (url) => url && url !== 'undefined' && url !== '' && typeof url === 'string';
    
    if (isValid(overrideUrl)) return overrideUrl;
    if (isValid(process.env.NEXTAUTH_URL)) return process.env.NEXTAUTH_URL;
    if (isValid(process.env.NEXT_PUBLIC_APP_URL)) return process.env.NEXT_PUBLIC_APP_URL;
    if (isValid(process.env.HOST)) return process.env.HOST;
    if (isValid(process.env.VERCEL_URL)) return `https://${process.env.VERCEL_URL}`;
    
    return 'http://localhost:3000';
  }

  /**
   * Store credentials in database
   */
  async storeCredentials(userEmail, credentials) {
    await this.db.storeIntegrationCredentials(
      userEmail,
      this.provider,
      credentials
    );
  }

  /**
   * Retrieve credentials from database
   */
  async getCredentials(userEmail) {
    return await this.db.getIntegrationCredentials(userEmail, this.provider);
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(expiresAt) {
    if (!expiresAt) return false;
    return new Date(expiresAt) <= new Date();
  }

  /**
   * Build standard success result
   */
  buildSuccessResult(data, externalRefs) {
    return {
      success: true,
      data,
      externalRefs
    };
  }

  /**
   * Build standard error result
   */
  buildErrorResult(code, message, category, retryable, recoveryHint) {
    return {
      success: false,
      error: {
        code,
        message,
        category,
        retryable,
        recoveryHint
      }
    };
  }
}

// ============================================================================
// INTEGRATION REGISTRY
// ============================================================================

class IntegrationRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(adapter) {
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider) {
    return this.adapters.get(provider);
  }

  getAll() {
    return Array.from(this.adapters.values());
  }

  async getAllStatuses(userEmail) {
    return Promise.all(
      this.getAll().map(adapter => adapter.validateConnection(userEmail))
    );
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let globalRegistry = null;

function getIntegrationRegistry() {
  if (!globalRegistry) {
    globalRegistry = new IntegrationRegistry();
  }
  return globalRegistry;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function buildConnectCTA(provider, missingScopes) {
  const providerNames = {
    google_calendar: 'Google Calendar',
    cal_com: 'Cal.com',
    notion: 'Notion',
    google_tasks: 'Google Tasks',
    gmail: 'Gmail'
  };

  const displayName = providerNames[provider] || provider;

  if (missingScopes && missingScopes.length > 0) {
    return {
      userMessage: `${displayName} needs additional permissions: ${missingScopes.join(', ')}`,
      recoveryAction: 'reconnect_integration',
      requiresUserAction: true,
      autoRetry: false
    };
  }

  return {
    userMessage: `Please connect ${displayName} to use this feature`,
    recoveryAction: 'connect_integration',
    requiresUserAction: true,
    autoRetry: false
  };
}

function formatExternalRefs(refs) {
  return Object.entries(refs)
    .filter(([_, value]) => value !== undefined && value !== null)
    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  BaseIntegrationAdapter,
  IntegrationRegistry,
  getIntegrationRegistry,
  buildConnectCTA,
  formatExternalRefs,
  INTEGRATION_ERROR_CATEGORIES
};
