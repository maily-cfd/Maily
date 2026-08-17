/**
 * Boult Execution Context - Phase 1
 * 
 * Provides context propagation across:
 * - HTTP requests (incoming execution requests)
 * - Database operations (run/step state persistence)
 * - Action executions (cross-service calls)
 * - Async jobs (background processing)
 * 
 * Context includes:
 * - Execution identifiers (runId, todoId, executionId)
 * - User context (userEmail, conversationId, missionId)
 * - Tracing info (traceId, spanId, parentSpanId)
 * - Environment (deployment, version, region)
 * - Metadata (timestamps, attempt counts, retry info)
 */

import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

// ============================================================================
// CONTEXT STORAGE (AsyncLocalStorage for automatic propagation)
// ============================================================================

const asyncLocalStorage = new AsyncLocalStorage();

// ============================================================================
// CONTEXT STRUCTURE
// ============================================================================

export const EXECUTION_CONTEXT_FIELDS = {
  // Identifiers
  executionId: 'string',      // Unique execution identifier
  runId: 'string',            // Parent run identifier
  planId: 'string',           // Associated plan identifier
  todoId: 'string',           // Current todo item identifier
  actionType: 'string',       // Action being executed
  
  // User context
  userEmail: 'string',        // User executing the action
  conversationId: 'string',   // Conversation context
  missionId: 'string',        // Mission context
  
  // Tracing
  traceId: 'string',          // Distributed trace identifier
  spanId: 'string',           // Current span identifier
  parentSpanId: 'string',     // Parent span identifier
  
  // Environment
  deployment: 'string',       // Deployment environment
  version: 'string',          // Code version
  region: 'string',           // Geographic region
  
  // Execution metadata
  startedAt: 'string',        // ISO timestamp
  attemptCount: 'number',     // Current retry attempt
  maxAttempts: 'number',      // Maximum allowed attempts
  
  // Request context
  requestId: 'string',        // HTTP request identifier
  clientIp: 'string',         // Client IP address
  userAgent: 'string',        // Client user agent
  
  // Feature flags
  features: 'object',         // Enabled features
  
  // Custom data
  custom: 'object'          // Extension point for custom data
};

// ============================================================================
// CONTEXT MANAGER
// ============================================================================

export class ExecutionContextManager {
  constructor() {
    this.asyncLocalStorage = asyncLocalStorage;
  }

  /**
   * Create a new execution context
   */
  createContext(options = {}) {
    const now = new Date();
    const traceId = options.traceId || this.generateTraceId();
    
    return {
      // Identifiers
      executionId: options.executionId || this.generateExecutionId(),
      runId: options.runId || null,
      planId: options.planId || null,
      todoId: options.todoId || null,
      actionType: options.actionType || null,
      
      // User context
      userEmail: options.userEmail || null,
      conversationId: options.conversationId || null,
      missionId: options.missionId || null,
      
      // Tracing
      traceId,
      spanId: this.generateSpanId(),
      parentSpanId: options.parentSpanId || null,
      
      // Environment
      deployment: process.env.DEPLOYMENT_ENV || 'development',
      version: process.env.CODE_VERSION || 'unknown',
      region: process.env.REGION || 'unknown',
      
      // Execution metadata
      startedAt: now.toISOString(),
      attemptCount: options.attemptCount || 1,
      maxAttempts: options.maxAttempts || 3,
      
      // Request context
      requestId: options.requestId || null,
      clientIp: options.clientIp || null,
      userAgent: options.userAgent || null,
      
      // Feature flags
      features: options.features || {},
      
      // Custom data
      custom: options.custom || {}
    };
  }

  /**
   * Run a function within a context
   */
  runWithContext(context, fn) {
    return this.asyncLocalStorage.run(context, fn);
  }

  /**
   * Get current context (from AsyncLocalStorage)
   */
  getCurrentContext() {
    return this.asyncLocalStorage.getStore();
  }

  /**
   * Get a specific field from current context
   */
  get(field) {
    const context = this.getCurrentContext();
    return context ? context[field] : undefined;
  }

  /**
   * Set a field in current context
   */
  set(field, value) {
    const context = this.getCurrentContext();
    if (context) {
      context[field] = value;
    }
  }

  /**
   * Create a child context (for nested operations)
   */
  createChildContext(overrides = {}) {
    const parentContext = this.getCurrentContext();
    if (!parentContext) {
      return this.createContext(overrides);
    }

    return {
      ...parentContext,
      executionId: overrides.executionId || this.generateExecutionId(),
      spanId: this.generateSpanId(),
      parentSpanId: parentContext.spanId,
      startedAt: new Date().toISOString(),
      attemptCount: overrides.attemptCount || 1,
      custom: { ...parentContext.custom, ...(overrides.custom || {}) },
      ...overrides
    };
  }

  /**
   * Generate trace ID (for distributed tracing)
   */
  generateTraceId() {
    return crypto.randomUUID().replace(/-/g, '');
  }

  /**
   * Generate span ID
   */
  generateSpanId() {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Generate execution ID
   */
  generateExecutionId() {
    return `exec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Serialize context for HTTP headers or logging
   */
  serialize(context) {
    return JSON.stringify(context);
  }

  /**
   * Deserialize context from string
   */
  deserialize(str) {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  /**
   * Extract context from HTTP headers
   */
  extractFromHeaders(headers) {
    const context = {};
    
    if (headers['x-trace-id']) {
      context.traceId = headers['x-trace-id'];
    }
    if (headers['x-span-id']) {
      context.parentSpanId = headers['x-span-id'];
    }
    if (headers['x-execution-id']) {
      context.executionId = headers['x-execution-id'];
    }
    if (headers['x-run-id']) {
      context.runId = headers['x-run-id'];
    }
    if (headers['x-request-id']) {
      context.requestId = headers['x-request-id'];
    }
    if (headers['x-user-email']) {
      context.userEmail = headers['x-user-email'];
    }
    
    return context;
  }

  /**
   * Inject context into HTTP headers
   */
  injectIntoHeaders(context) {
    const headers = {};
    
    if (context.traceId) {
      headers['x-trace-id'] = context.traceId;
    }
    if (context.spanId) {
      headers['x-span-id'] = context.spanId;
    }
    if (context.executionId) {
      headers['x-execution-id'] = context.executionId;
    }
    if (context.runId) {
      headers['x-run-id'] = context.runId;
    }
    if (context.requestId) {
      headers['x-request-id'] = context.requestId;
    }
    
    return headers;
  }

  /**
   * Get context for logging
     */
  getLogContext() {
    const context = this.getCurrentContext();
    if (!context) return {};

    return {
      executionId: context.executionId,
      runId: context.runId,
      traceId: context.traceId,
      spanId: context.spanId,
      actionType: context.actionType,
      userEmail: context.userEmail,
      attemptCount: context.attemptCount
    };
  }

  /**
   * Add timing information to context
   */
  markTiming(eventName) {
    const context = this.getCurrentContext();
    if (!context) return;

    if (!context.timings) {
      context.timings = {};
    }
    
    context.timings[eventName] = {
      timestamp: new Date().toISOString(),
      elapsed: context.startedAt 
        ? Date.now() - new Date(context.startedAt).getTime()
        : 0
    };
  }

  /**
   * Complete context and calculate duration
   */
  complete() {
    const context = this.getCurrentContext();
    if (!context) return null;

    const completedAt = new Date().toISOString();
    const durationMs = context.startedAt
      ? new Date(completedAt).getTime() - new Date(context.startedAt).getTime()
      : 0;

    return {
      ...context,
      completedAt,
      durationMs
    };
  }
}

// ============================================================================
// CONTEXT MIDDLEWARE (for Express/Next.js)
// ============================================================================

export function executionContextMiddleware(contextManager) {
  return (req, res, next) => {
    // Extract context from incoming headers
    const extractedContext = contextManager.extractFromHeaders(req.headers);
    
    // Create new context
    const context = contextManager.createContext({
      ...extractedContext,
      requestId: req.headers['x-request-id'] || contextManager.generateExecutionId(),
      clientIp: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      userEmail: req.user?.email || extractedContext.userEmail
    });

    // Inject response headers for downstream propagation
    const responseHeaders = contextManager.injectIntoHeaders(context);
    Object.entries(responseHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    // Run request handler within context
    contextManager.runWithContext(context, () => {
      // Attach context to request for easy access
      req.executionContext = context;
      next();
    });
  };
}

// ============================================================================
// DATABASE CONTEXT PROPAGATION
// ============================================================================

export class DatabaseContextWrapper {
  constructor(db, contextManager) {
    this.db = db;
    this.contextManager = contextManager;
  }

  async query(sql, params) {
    const context = this.contextManager.getCurrentContext();
    
    // Add context to query metadata
    const queryWithContext = {
      sql,
      params,
      metadata: context ? {
        executionId: context.executionId,
        traceId: context.traceId,
        spanId: context.spanId
      } : null
    };

    return this.db.query(queryWithContext.sql, queryWithContext.params);
  }

  async saveRun(runData) {
    const context = this.contextManager.getCurrentContext();
    
    return this.db.createOperatorRun(context?.userEmail, {
      ...runData,
      _context: context ? {
        executionId: context.executionId,
        traceId: context.traceId,
        requestId: context.requestId
      } : null
    });
  }

  async saveStep(stepData) {
    const context = this.contextManager.getCurrentContext();
    
    return this.db.upsertOperatorRunStep(
      context?.userEmail,
      context?.runId,
      {
        ...stepData,
        _context: context ? {
          executionId: context.executionId,
          traceId: context.traceId
        } : null
      }
    );
  }
}

// ============================================================================
// ASYNC JOB CONTEXT
// ============================================================================

export class AsyncJobContextManager {
  constructor(contextManager) {
    this.contextManager = contextManager;
  }

  /**
   * Serialize context for job storage
   */
  serializeForJob(context) {
    return {
      executionId: context.executionId,
      runId: context.runId,
      planId: context.planId,
      todoId: context.todoId,
      actionType: context.actionType,
      userEmail: context.userEmail,
      conversationId: context.conversationId,
      traceId: context.traceId,
      parentSpanId: context.spanId,
      attemptCount: context.attemptCount,
      maxAttempts: context.maxAttempts,
      startedAt: context.startedAt,
      features: context.features
    };
  }

  /**
   * Deserialize context from job data
   */
  deserializeFromJob(jobData) {
    return this.contextManager.createContext({
      executionId: jobData.executionId,
      runId: jobData.runId,
      planId: jobData.planId,
      todoId: jobData.todoId,
      actionType: jobData.actionType,
      userEmail: jobData.userEmail,
      conversationId: jobData.conversationId,
      traceId: jobData.traceId,
      parentSpanId: jobData.parentSpanId,
      attemptCount: jobData.attemptCount,
      maxAttempts: jobData.maxAttempts,
      startedAt: jobData.startedAt,
      features: jobData.features
    });
  }

  /**
   * Run job with restored context
   */
  async runJob(jobData, jobFn) {
    const context = this.deserializeFromJob(jobData);
    
    return this.contextManager.runWithContext(context, async () => {
      try {
        const result = await jobFn(context);
        return { success: true, result };
      } catch (error) {
        return { success: false, error };
      }
    });
  }
}

// ============================================================================
// CONTEXT-AWARE LOGGER
// ============================================================================

export class ContextAwareLogger {
  constructor(contextManager, baseLogger = console) {
    this.contextManager = contextManager;
    this.baseLogger = baseLogger;
  }

  log(level, message, meta = {}) {
    const context = this.contextManager.getLogContext();
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
      ...meta
    };

    this.baseLogger[level](message, logEntry);
  }

  debug(message, meta) {
    this.log('debug', message, meta);
  }

  info(message, meta) {
    this.log('info', message, meta);
  }

  warn(message, meta) {
    this.log('warn', message, meta);
  }

  error(message, meta) {
    this.log('error', message, meta);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a context-aware function wrapper
 */
export function withContext(contextManager, fn) {
  return async (...args) => {
    const currentContext = contextManager.getCurrentContext();
    
    if (!currentContext) {
      throw new Error('No execution context available');
    }

    return contextManager.runWithContext(currentContext, () => fn(...args));
  };
}

/**
 * Propagate context to external service call
 */
export async function propagateContext(contextManager, serviceCall, options = {}) {
  const context = contextManager.getCurrentContext();
  
  if (!context) {
    return serviceCall();
  }

  const childContext = contextManager.createChildContext({
    actionType: options.actionType || context.actionType,
    custom: options.custom
  });

  const headers = contextManager.injectIntoHeaders(childContext);
  
  return contextManager.runWithContext(childContext, () => 
    serviceCall(headers)
  );
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const executionContextManager = new ExecutionContextManager();

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  ExecutionContextManager,
  DatabaseContextWrapper,
  AsyncJobContextManager,
  ContextAwareLogger,
  executionContextMiddleware,
  withContext,
  propagateContext,
  executionContextManager
};
