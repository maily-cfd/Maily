/**
 * Boult Error Handling & Retry System
 * 
 * Comprehensive error management:
 * - Error categorization
 * - Automatic retry with exponential backoff
 * - Circuit breaker pattern
 * - Idempotency key management
 * - Dead letter queue
 */

// ============================================================================
// ERROR CATEGORIES
// ============================================================================

export const ErrorCategory = {
  // Client errors (4xx) - don't retry
  BAD_REQUEST: 'BAD_REQUEST',           // 400
  UNAUTHORIZED: 'UNAUTHORIZED',       // 401
  FORBIDDEN: 'FORBIDDEN',             // 403
  NOT_FOUND: 'NOT_FOUND',             // 404
  CONFLICT: 'CONFLICT',               // 409
  RATE_LIMITED: 'RATE_LIMITED',       // 429
  
  // Server errors (5xx) - retry with backoff
  SERVER_ERROR: 'SERVER_ERROR',       // 500
  BAD_GATEWAY: 'BAD_GATEWAY',         // 502
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE', // 503
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT', // 504
  
  // Network errors - retry immediately
  TIMEOUT: 'TIMEOUT',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  DNS_ERROR: 'DNS_ERROR',
  
  // Auth errors - refresh token and retry once
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  
  // Unknown
  UNKNOWN: 'UNKNOWN'
};

// Errors that should be retried
const RETRIABLE_ERRORS = [
  ErrorCategory.SERVER_ERROR,
  ErrorCategory.BAD_GATEWAY,
  ErrorCategory.SERVICE_UNAVAILABLE,
  ErrorCategory.GATEWAY_TIMEOUT,
  ErrorCategory.TIMEOUT,
  ErrorCategory.CONNECTION_ERROR,
  ErrorCategory.DNS_ERROR,
  ErrorCategory.RATE_LIMITED
];

// Errors that can retry after token refresh
const AUTH_RETRY_ERRORS = [
  ErrorCategory.UNAUTHORIZED,
  ErrorCategory.TOKEN_EXPIRED,
  ErrorCategory.TOKEN_INVALID
];

// ============================================================================
// ERROR CLASS
// ============================================================================

export class BoultError extends Error {
  constructor(message, category, status, context = {}) {
    super(message);
    this.name = 'BoultError';
    this.category = category;
    this.status = status;
    this.context = context;
    this.timestamp = new Date().toISOString();
    this.retryable = RETRIABLE_ERRORS.includes(category);
    this.authRetryable = AUTH_RETRY_ERRORS.includes(category);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      status: this.status,
      context: this.context,
      timestamp: this.timestamp,
      retryable: this.retryable,
      authRetryable: this.authRetryable
    };
  }
}

// ============================================================================
// ERROR CLASSIFIER
// ============================================================================

export class ErrorClassifier {
  static classify(error) {
    // HTTP status based
    if (error.status || error.response?.status) {
      const status = error.status || error.response?.status;
      return this.classifyByStatus(status);
    }

    // Error code based
    if (error.code) {
      return this.classifyByCode(error.code);
    }

    // Message based
    if (error.message) {
      return this.classifyByMessage(error.message);
    }

    return { category: ErrorCategory.UNKNOWN, retryable: false };
  }

  static classifyByStatus(status) {
    const categories = {
      400: ErrorCategory.BAD_REQUEST,
      401: ErrorCategory.UNAUTHORIZED,
      403: ErrorCategory.FORBIDDEN,
      404: ErrorCategory.NOT_FOUND,
      409: ErrorCategory.CONFLICT,
      429: ErrorCategory.RATE_LIMITED,
      500: ErrorCategory.SERVER_ERROR,
      502: ErrorCategory.BAD_GATEWAY,
      503: ErrorCategory.SERVICE_UNAVAILABLE,
      504: ErrorCategory.GATEWAY_TIMEOUT
    };

    const category = categories[status] || ErrorCategory.UNKNOWN;
    return {
      category,
      retryable: RETRIABLE_ERRORS.includes(category),
      status
    };
  }

  static classifyByCode(code) {
    const codeMap = {
      'ECONNREFUSED': { category: ErrorCategory.CONNECTION_ERROR, retryable: true },
      'ENOTFOUND': { category: ErrorCategory.DNS_ERROR, retryable: true },
      'ETIMEDOUT': { category: ErrorCategory.TIMEOUT, retryable: true },
      'ECONNRESET': { category: ErrorCategory.CONNECTION_ERROR, retryable: true },
      'EAI_AGAIN': { category: ErrorCategory.DNS_ERROR, retryable: true },
      'token_expired': { category: ErrorCategory.TOKEN_EXPIRED, retryable: false },
      'invalid_token': { category: ErrorCategory.TOKEN_INVALID, retryable: false }
    };

    return codeMap[code] || { category: ErrorCategory.UNKNOWN, retryable: false };
  }

  static classifyByMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('timeout')) {
      return { category: ErrorCategory.TIMEOUT, retryable: true };
    }
    if (lowerMessage.includes('rate limit') || lowerMessage.includes('too many requests')) {
      return { category: ErrorCategory.RATE_LIMITED, retryable: true };
    }
    if (lowerMessage.includes('token expired') || lowerMessage.includes('invalid credentials')) {
      return { category: ErrorCategory.TOKEN_EXPIRED, retryable: false };
    }
    
    return { category: ErrorCategory.UNKNOWN, retryable: false };
  }
}

// ============================================================================
// RETRY MANAGER
// ============================================================================

export class RetryManager {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts || 3;
    this.baseDelay = options.baseDelay || 1000; // 1 second
    this.maxDelay = options.maxDelay || 60000; // 60 seconds
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.jitter = options.jitter !== false; // Add randomness
    
    // Track circuit breaker states
    this.circuitStates = new Map();
    this.circuitThreshold = options.circuitThreshold || 5; // Errors before opening
    this.circuitTimeout = options.circuitTimeout || 60000; // 60 seconds to half-open
  }

  async execute(operation, context = {}) {
    const { operationId = 'unknown', userId, accountId } = context;
    
    // Check circuit breaker
    const circuitState = this.getCircuitState(operationId);
    if (circuitState === 'OPEN') {
      throw new BoultError(
        `Circuit breaker is OPEN for ${operationId}`,
        ErrorCategory.SERVICE_UNAVAILABLE,
        503,
        { operationId }
      );
    }

    let lastError;
    
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const result = await operation();
        
        // Success - record and reset circuit
        this.recordSuccess(operationId);
        return {
          success: true,
          result,
          attempts: attempt,
          operationId
        };
        
      } catch (error) {
        lastError = error;
        const classification = ErrorClassifier.classify(error);
        
        // Don't retry non-retryable errors
        if (!classification.retryable && !classification.authRetryable) {
          throw this.wrapError(error, classification, attempt);
        }

        // Don't retry auth errors after first attempt (unless we can refresh)
        if (classification.authRetryable && attempt > 1) {
          throw this.wrapError(error, classification, attempt);
        }

        // Record failure for circuit breaker
        this.recordFailure(operationId);

        // If this is the last attempt, throw
        if (attempt === this.maxAttempts) {
          throw this.wrapError(error, classification, attempt);
        }

        // Calculate delay with exponential backoff
        const delay = this.calculateDelay(attempt, classification.category);
        
        // Special handling for rate limits
        if (classification.category === ErrorCategory.RATE_LIMITED) {
          const retryAfter = error.retryAfter || delay;
          await this.sleep(retryAfter);
        } else {
          await this.sleep(delay);
        }
      }
    }

    // Should not reach here
    throw this.wrapError(lastError, { category: ErrorCategory.UNKNOWN }, this.maxAttempts);
  }

  calculateDelay(attempt, category) {
    let delay = this.baseDelay * Math.pow(this.backoffMultiplier, attempt - 1);
    
    // Cap at max delay
    delay = Math.min(delay, this.maxDelay);
    
    // Add jitter to avoid thundering herd
    if (this.jitter) {
      const jitterAmount = delay * 0.1 * Math.random();
      delay = delay + jitterAmount;
    }
    
    return delay;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  wrapError(error, classification, attempts) {
    return new BoultError(
      error.message,
      classification.category,
      error.status || 500,
      {
        originalError: error,
        attempts,
        category: classification.category
      }
    );
  }

  // ============================================================================
  // CIRCUIT BREAKER
  // ============================================================================

  getCircuitState(operationId) {
    const state = this.circuitStates.get(operationId);
    
    if (!state) {
      return 'CLOSED'; // Default - allow requests
    }

    if (state.status === 'OPEN') {
      // Check if we should transition to HALF_OPEN
      if (Date.now() - state.lastFailure > this.circuitTimeout) {
        state.status = 'HALF_OPEN';
        state.failures = 0;
        return 'HALF_OPEN';
      }
      return 'OPEN';
    }

    return state.status;
  }

  recordSuccess(operationId) {
    const state = this.circuitStates.get(operationId);
    if (state) {
      if (state.status === 'HALF_OPEN') {
        // Transition back to CLOSED
        this.circuitStates.delete(operationId);
      } else {
        state.failures = 0;
      }
    }
  }

  recordFailure(operationId) {
    let state = this.circuitStates.get(operationId);
    
    if (!state) {
      state = { status: 'CLOSED', failures: 0, lastFailure: 0 };
      this.circuitStates.set(operationId, state);
    }

    state.failures++;
    state.lastFailure = Date.now();

    if (state.failures >= this.circuitThreshold) {
      state.status = 'OPEN';
    }
  }
}

// ============================================================================
// IDEMPOTENCY MANAGER
// ============================================================================

export class IdempotencyManager {
  constructor(supabase, options = {}) {
    this.supabase = supabase;
    this.defaultTTL = options.defaultTTL || 24 * 60 * 60 * 1000; // 24 hours
  }

  generateKey(operation, context) {
    // Create deterministic key from operation and context
    const keyData = JSON.stringify({
      operation,
      userId: context.userId,
      payload: this.sanitizePayload(context.payload)
    });
    
    return this.hashKey(keyData);
  }

  hashKey(data) {
    // Simple hash for demo - use crypto in production
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `idmp_${Math.abs(hash).toString(16)}`;
  }

  async checkOrCreate(key, operation, context) {
    // Check for existing result
    const { data: existing } = await this.supabase
      .from('idempotent_results')
      .select('*')
      .eq('idempotency_key', key)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (existing) {
      // Return cached result
      return {
        isNew: false,
        result: existing.result,
        cached: true
      };
    }

    // Create placeholder for new operation
    const expiresAt = new Date(Date.now() + this.defaultTTL).toISOString();
    
    await this.supabase.from('idempotent_results').insert({
      idempotency_key: key,
      user_id: context.userId,
      action_type: operation,
      run_id: context.runId,
      result: { status: 'pending' },
      expires_at: expiresAt
    });

    return {
      isNew: true,
      key,
      expiresAt
    };
  }

  async complete(key, result) {
    await this.supabase
      .from('idempotent_results')
      .update({ result })
      .eq('idempotency_key', key);
  }

  async execute(operation, context, executor) {
    const key = this.generateKey(operation, context);
    
    const check = await this.checkOrCreate(key, operation, context);
    
    if (!check.isNew) {
      // Return cached result
      return {
        success: true,
        result: check.result,
        idempotent: true,
        cached: true
      };
    }

    try {
      // Execute operation
      const result = await executor();
      
      // Store result
      await this.complete(key, {
        status: 'success',
        data: result
      });
      
      return {
        success: true,
        result,
        idempotent: true,
        cached: false
      };
      
    } catch (error) {
      // Store error
      await this.complete(key, {
        status: 'error',
        error: error.message,
        category: error.category
      });
      
      throw error;
    }
  }

  sanitizePayload(payload) {
    // Create deterministic representation
    if (!payload) return null;
    
    const sorted = {};
    const keys = Object.keys(payload).sort();
    
    for (const key of keys) {
      const value = payload[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sorted[key] = this.sanitizePayload(value);
      } else {
        sorted[key] = value;
      }
    }
    
    return sorted;
  }

  async cleanupExpired() {
    const { data } = await this.supabase
      .from('idempotent_results')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');

    return data?.length || 0;
  }
}

// ============================================================================
// DEAD LETTER QUEUE
// ============================================================================

export class DeadLetterQueue {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async enqueue(operation, context, error, attempts) {
    await this.supabase.from('audit_log').insert({
      user_id: context.userId,
      event_type: 'dead_letter',
      event_category: 'failed_operation',
      payload: {
        operation,
        context: this.sanitizeContext(context),
        error: {
          message: error.message,
          category: error.category,
          status: error.status
        },
        attempts,
        timestamp: new Date().toISOString()
      },
      action_type: operation
    });
  }

  sanitizeContext(context) {
    // Remove sensitive data
    const sanitized = { ...context };
    delete sanitized.accessToken;
    delete sanitized.refreshToken;
    delete sanitized.apiKey;
    delete sanitized.password;
    delete sanitized.token;
    return sanitized;
  }

  async getFailedOperations(userId, options = {}) {
    let query = this.supabase
      .from('audit_log')
      .select('*')
      .eq('user_id', userId)
      .eq('event_type', 'dead_letter')
      .order('created_at', { ascending: false });

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    
    return data || [];
  }
}

// ============================================================================
// EXECUTION WRAPPER
// ============================================================================

export class ResilientExecutor {
  constructor(supabase, options = {}) {
    this.retryManager = new RetryManager(options.retry);
    this.idempotencyManager = new IdempotencyManager(supabase, options.idempotency);
    this.deadLetterQueue = new DeadLetterQueue(supabase);
    this.supabase = supabase;
  }

  async execute(operation, executor, context = {}) {
    const { 
      idempotent = false, 
      operationId = 'unknown',
      userId,
      accountId 
    } = context;

    try {
      let result;

      if (idempotent) {
        // Use idempotency manager
        result = await this.idempotencyManager.execute(operationId, context, async () => {
          return await this.retryWithDeadLetter(operationId, executor, context);
        });
      } else {
        // Just retry
        result = await this.retryWithDeadLetter(operationId, executor, context);
      }

      return result;

    } catch (error) {
      // Log final failure
      await this.logFailure(operationId, context, error);
      throw error;
    }
  }

  async retryWithDeadLetter(operationId, executor, context) {
    try {
      return await this.retryManager.execute(executor, {
        operationId,
        userId: context.userId,
        accountId: context.accountId
      });
    } catch (error) {
      // If all retries failed, add to dead letter queue
      await this.deadLetterQueue.enqueue(
        operationId,
        context,
        error,
        this.retryManager.maxAttempts
      );
      throw error;
    }
  }

  async logFailure(operation, context, error) {
    try {
      await this.supabase.from('audit_log').insert({
        user_id: context.userId,
        event_type: 'execution_failed',
        event_category: error.category || 'UNKNOWN',
        payload: {
          operation,
          error: error.message,
          status: error.status,
          category: error.category
        },
        action_type: operation
      });
    } catch (e) {
      console.error('[ResilientExecutor] Failed to log failure:', e);
    }
  }
}

// ============================================================================
// EXPORT DEFAULT
// ============================================================================

export default {
  BoultError,
  ErrorCategory,
  ErrorClassifier,
  RetryManager,
  IdempotencyManager,
  DeadLetterQueue,
  ResilientExecutor
};
