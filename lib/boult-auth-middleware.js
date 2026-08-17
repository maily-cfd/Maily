/**
 * Boult Authentication Middleware
 * 
 * Comprehensive auth protection for API routes:
 * - JWT token validation
 * - Session management
 * - Permission checking
 * - Rate limiting per user
 * - Audit logging
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================

export class AuthMiddleware {
  constructor(supabase) {
    this.supabase = supabase;
  }

  /**
   * Main middleware handler for Next.js API routes
   */
  async handler(req, options = {}) {
    const {
      requireAuth = true,
      requireConnector = null, // 'google_calendar', 'calcom', etc.
      permissions = [], // ['read', 'write', 'admin']
      rateLimit = true
    } = options;

    try {
      // 1. Extract and validate token
      const token = this.extractToken(req);
      
      if (!token && requireAuth) {
        return this.unauthorized('No authentication token provided');
      }

      // 2. Verify token with Supabase
      const user = await this.verifyToken(token);
      
      if (!user && requireAuth) {
        return this.unauthorized('Invalid or expired token');
      }

      // 3. Check rate limiting
      if (rateLimit && user) {
        const rateCheck = await this.checkRateLimit(user.id, req);
        if (!rateCheck.allowed) {
          return this.rateLimited(rateCheck.retryAfter);
        }
      }

      // 4. Check connector access if required
      if (requireConnector && user) {
        const connectorAccess = await this.checkConnectorAccess(
          user.id, 
          requireConnector
        );
        if (!connectorAccess.hasAccess) {
          return this.forbidden(`No ${requireConnector} account connected`);
        }
        req.connectorAccount = connectorAccess.account;
      }

      // 5. Check permissions
      if (permissions.length > 0 && user) {
        const hasPermission = await this.checkPermissions(user.id, permissions);
        if (!hasPermission) {
          return this.forbidden('Insufficient permissions');
        }
      }

      // 6. Attach user to request
      req.user = user;

      // 7. Log access
      await this.logAccess(req, user);

      // Continue to handler
      return null; // No error, continue

    } catch (error) {
      console.error('[AuthMiddleware] Authentication error:', error);
      return this.internalError('Authentication system error');
    }
  }

  /**
   * Extract Bearer token from request
   */
  extractToken(req) {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    
    if (!authHeader) return null;
    
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }
    
    return parts[1];
  }

  /**
   * Verify JWT token with Supabase
   */
  async verifyToken(token) {
    try {
      const { data: { user }, error } = await this.supabase.auth.getUser(token);
      
      if (error || !user) {
        return null;
      }

      // Get additional user data from our database
      const { data: userData } = await this.supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      return {
        id: user.id,
        email: user.email,
        ...userData
      };
    } catch (error) {
      console.error('[AuthMiddleware] Token verification failed:', error);
      return null;
    }
  }

  /**
   * Check rate limiting for user
   */
  async checkRateLimit(userId, req) {
    const key = `rate_limit:${userId}`;
    const windowSeconds = 60; // 1 minute window
    const maxRequests = 100; // 100 requests per minute

    // Get current count from Supabase (or Redis if available)
    const { data: usage } = await this.supabase
      .from('connector_usage_log')
      .select('id')
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - windowSeconds * 1000).toISOString())
      .limit(maxRequests + 1);

    const requestCount = usage?.length || 0;

    if (requestCount >= maxRequests) {
      return {
        allowed: false,
        retryAfter: windowSeconds
      };
    }

    return { allowed: true };
  }

  /**
   * Check if user has connected specific connector
   */
  async checkConnectorAccess(userId, connectorId) {
    const { data: account } = await this.supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('connector_id', connectorId)
      .eq('status', 'connected')
      .single();

    return {
      hasAccess: !!account,
      account
    };
  }

  /**
   * Check user permissions
   */
  async checkPermissions(userId, requiredPermissions) {
    // Get user from database
    const { data: user } = await this.supabase
      .from('users')
      .select('preferences')
      .eq('id', userId)
      .single();

    const userPermissions = user?.preferences?.permissions || ['read'];

    // Check if user has all required permissions
    return requiredPermissions.every(perm => userPermissions.includes(perm));
  }

  /**
   * Log access for audit
   */
  async logAccess(req, user) {
    try {
      await this.supabase.from('audit_log').insert({
        user_id: user.id,
        event_type: 'api_access',
        event_category: req.method,
        payload: {
          path: req.url,
          method: req.method,
          user_agent: req.headers.get('user-agent')
        },
        ip_address: req.headers.get('x-forwarded-for') || 'unknown',
        user_agent: req.headers.get('user-agent')
      });
    } catch (error) {
      console.error('[AuthMiddleware] Failed to log access:', error);
    }
  }

  // ============================================================================
  // RESPONSE HELPERS
  // ============================================================================

  unauthorized(message) {
    return new Response(
      JSON.stringify({ error: message, code: 'UNAUTHORIZED' }),
      { 
        status: 401, 
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  forbidden(message) {
    return new Response(
      JSON.stringify({ error: message, code: 'FORBIDDEN' }),
      { 
        status: 403, 
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  rateLimited(retryAfter) {
    return new Response(
      JSON.stringify({ 
        error: 'Rate limit exceeded', 
        code: 'RATE_LIMITED',
        retryAfter 
      }),
      { 
        status: 429, 
        headers: { 
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter)
        }
      }
    );
  }

  internalError(message) {
    return new Response(
      JSON.stringify({ error: message, code: 'INTERNAL_ERROR' }),
      { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// ============================================================================
// CONVENIENCE MIDDLEWARE FACTORY
// ============================================================================

export function createAuthMiddleware(supabase) {
  const middleware = new AuthMiddleware(supabase);

  return {
    // Require authentication
    requireAuth: async (req) => {
      return await middleware.handler(req, { requireAuth: true });
    },

    // Optional authentication
    optionalAuth: async (req) => {
      return await middleware.handler(req, { requireAuth: false });
    },

    // Require specific connector
    requireConnector: async (req, connectorId) => {
      return await middleware.handler(req, { 
        requireAuth: true, 
        requireConnector: connectorId 
      });
    },

    // Custom options
    withOptions: async (req, options) => {
      return await middleware.handler(req, options);
    }
  };
}

// ============================================================================
// NEXT.JS API ROUTE WRAPPER
// ============================================================================

export function withAuth(handler, options = {}) {
  return async (req) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const middleware = new AuthMiddleware(supabase);
    const error = await middleware.handler(req, options);

    if (error) {
      return error;
    }

    // Authentication passed, call handler
    return handler(req, { supabase, user: req.user });
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  AuthMiddleware,
  createAuthMiddleware,
  withAuth
};
