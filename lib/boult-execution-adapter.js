/**
 * Boult Execution Adapter - Phase 1
 * 
 * Consolidates legacy/fallback execution branches in chat-boult/route.js
 * behind the canonical operator-runtime flow.
 * 
 * This adapter:
 * - Wraps legacy direct action handlers in canonical execution contract
 * - Ensures all actions go through operator-runtime (idempotency, retries, approval)
 * - Maintains backward compatibility with existing API
 * - Provides migration path for legacy code
 */

import { BoultOperatorRuntime } from './boult-operator-runtime-v2.js';
import { 
  buildActionInput, 
  buildActionResult,
  categorizeError,
  isRetryableError 
} from './boult-execution-contract.js';
import { TASK_REGISTRY, validateActionInputs } from './boult-task-registry';
import { executionContextManager } from './boult-execution-context.js';
import { executionTelemetry } from './boult-execution-telemetry.js';

// ============================================================================
// LEGACY ACTION HANDLER REGISTRY
// ============================================================================

/**
 * Registry of legacy action handlers that will be wrapped
 * Each handler receives the canonical actionInput and returns raw result
 */
export class LegacyActionRegistry {
  constructor() {
    this.handlers = new Map();
  }

  register(actionType, handlerFn) {
    this.handlers.set(actionType, handlerFn);
  }

  get(actionType) {
    return this.handlers.get(actionType);
  }

  has(actionType) {
    return this.handlers.has(actionType);
  }
}

// Global registry instance
export const legacyRegistry = new LegacyActionRegistry();

// ============================================================================
// CANONICAL EXECUTION ADAPTER
// ============================================================================

export class CanonicalExecutionAdapter {
  constructor({ db, userEmail, boultAI }) {
    this.db = db;
    this.userEmail = userEmail;
    this.boultAI = boultAI;
    
    // Initialize operator runtime
    this.runtime = new BoultOperatorRuntime({
      db,
      boultAI,
      userEmail
    });

    this.contextManager = executionContextManager;
    this.telemetry = executionTelemetry;
  }

  /**
   * Execute an action through the canonical flow
   * This is the main entry point that consolidates all execution branches
   */
  async execute(actionType, payload, options = {}) {
    const context = this.contextManager.getCurrentContext();
    
    // Build canonical action input
    const actionInput = buildActionInput({
      actionType,
      payload,
      context: {
        runId: options.runId || context?.runId,
        userEmail: this.userEmail,
        conversationId: options.conversationId || context?.conversationId,
        ...options.context
      },
      retryPolicy: options.retryPolicy,
      approvalMode: options.approvalMode,
      timeoutMs: options.timeoutMs
    });

    // Validate action inputs
    const validation = validateActionInputs(actionType, payload);
    if (!validation.valid) {
      return buildActionResult({
        success: false,
        message: `Invalid inputs: ${validation.missing.join(', ')}`,
        error: {
          category: 'validation_failed',
          message: `Missing required inputs: ${validation.missing.join(', ')}`,
          retryable: false
        },
        executionId: actionInput.executionId,
        startedAt: actionInput.createdAt
      });
    }

    // Check approval requirements
    const actionSpec = TASK_REGISTRY[actionType];
    if (actionSpec?.approvalMode === 'manual' || options.requiresApproval) {
      // Return pending approval result
      return buildActionResult({
        success: false,
        message: 'Action requires approval before execution',
        status: 'blocked',
        error: {
          category: 'approval_required',
          message: 'User approval required',
          retryable: false
        },
        executionId: actionInput.executionId,
        startedAt: actionInput.createdAt,
        externalRefs: {
          approvalToken: this.runtime.approvalManager.generateApprovalToken(
            options.runId || 'unknown',
            actionType
          )
        }
      });
    }

    // Execute through operator runtime (with idempotency, retries, telemetry)
    return await this.runtime.executeAction(actionInput, async () => {
      return await this.executeLegacyHandler(actionType, payload, actionInput);
    });
  }

  /**
   * Execute legacy handler wrapped in canonical result format
   */
  async executeLegacyHandler(actionType, payload, actionInput) {
    const startedAt = new Date().toISOString();
    
    try {
      // Get legacy handler
      const legacyHandler = legacyRegistry.get(actionType);
      
      if (!legacyHandler) {
        throw new Error(`No handler registered for action type: ${actionType}`);
      }

      // Execute legacy handler
      const rawResult = await legacyHandler(payload, {
        db: this.db,
        userEmail: this.userEmail,
        actionInput
      });

      // Transform to canonical result
      return buildActionResult({
        success: true,
        message: rawResult.message || 'Action completed successfully',
        data: rawResult.data || rawResult,
        externalRefs: rawResult.externalRefs || {},
        nextRecommendedActions: rawResult.nextRecommendedActions || [],
        executionId: actionInput.executionId,
        startedAt
      });

    } catch (error) {
      const errorCategory = categorizeError(error);
      
      return buildActionResult({
        success: false,
        message: error.message || 'Action execution failed',
        error: {
          category: errorCategory,
          code: error.code,
          message: error.message,
          retryable: isRetryableError(errorCategory)
        },
        executionId: actionInput.executionId,
        startedAt
      });
    }
  }

  /**
   * Batch execute multiple actions
   */
  async executeBatch(actions, options = {}) {
    const results = [];
    
    for (const action of actions) {
      const result = await this.execute(
        action.actionType,
        action.payload,
        { ...options, ...action.options }
      );
      
      results.push({
        actionType: action.actionType,
        executionId: result.metadata?.executionId,
        success: result.success,
        result
      });

      // If an action fails and we're not continuing on error, stop
      if (!result.success && !options.continueOnError) {
        break;
      }
    }

    return {
      allSucceeded: results.every(r => r.success),
      results
    };
  }

  /**
   * Execute with explicit approval token
   */
  async executeWithApproval(actionType, payload, approvalToken, options = {}) {
    const runId = options.runId || this.contextManager.get('runId');
    
    // Validate approval token
    const validation = await this.runtime.validateApprovalToken(runId, actionType, approvalToken);
    if (!validation.ok) {
      return buildActionResult({
        success: false,
        message: `Approval validation failed: ${validation.reason}`,
        error: {
          category: 'approval_denied',
          message: validation.reason,
          retryable: false
        }
      });
    }

    // Consume the token
    await this.runtime.consumeApprovalToken(runId, actionType, approvalToken);

    // Execute the action
    return await this.execute(actionType, payload, {
      ...options,
      runId,
      requiresApproval: false // Already approved
    });
  }

  /**
   * Check if action is idempotent
   */
  isIdempotent(actionType) {
    const spec = TASK_REGISTRY[actionType];
    return spec?.idempotent === true;
  }

  /**
   * Get action metadata
   */
  getActionMetadata(actionType) {
    const spec = TASK_REGISTRY[actionType];
    if (!spec) return null;

    return {
      id: spec.id,
      domain: spec.domain,
      label: spec.label,
      description: spec.description,
      mutating: spec.mutating,
      idempotent: spec.idempotent,
      approvalMode: spec.approvalMode,
      riskAssessment: spec.riskAssessment,
      requiredInputs: spec.requiredInputs,
      retryPolicy: spec.retryPolicy,
      resultSchema: spec.resultSchema,
      auditFields: spec.auditFields
    };
  }
}

// ============================================================================
// MIGRATION HELPERS
// ============================================================================

/**
 * Helper to migrate legacy route handler to canonical adapter
 */
export function createCanonicalHandler(actionType, legacyHandlerFn, options = {}) {
  return async function(request, context) {
    const { db, userEmail, runId } = context;
    
    // Create adapter
    const adapter = new CanonicalExecutionAdapter({
      db,
      userEmail,
      boultAI: context.boultAI
    });

    // Register legacy handler
    legacyRegistry.register(actionType, legacyHandlerFn);

    // Extract payload from request
    const payload = options.extractPayload 
      ? options.extractPayload(request)
      : request.body || request;

    // Execute through canonical flow
    const result = await adapter.execute(actionType, payload, {
      runId,
      conversationId: context.conversationId
    });

    // Return formatted response
    return {
      success: result.success,
      message: result.message,
      data: result.data,
      externalRefs: result.externalRefs,
      executionId: result.metadata?.executionId,
      timestamp: new Date().toISOString()
    };
  };
}

/**
 * Middleware to inject canonical execution adapter into request
 */
export function canonicalExecutionMiddleware(options = {}) {
  return async (req, res, next) => {
    const { db, userEmail } = options.getContext(req);
    
    req.canonicalAdapter = new CanonicalExecutionAdapter({
      db,
      userEmail,
      boultAI: options.boultAI
    });

    next();
  };
}

// ============================================================================
// BACKWARD COMPATIBILITY LAYER
// ============================================================================

/**
 * Wraps legacy execution result to match canonical format
 */
export function wrapLegacyResult(rawResult, actionType, executionId) {
  const startedAt = new Date().toISOString();

  // If already canonical format, return as-is
  if (rawResult?.status && rawResult?.metadata) {
    return rawResult;
  }

  // Transform legacy result to canonical format
  return buildActionResult({
    success: rawResult?.success !== false,
    message: rawResult?.message || rawResult?.error || 'Action completed',
    data: rawResult?.data || rawResult,
    externalRefs: rawResult?.externalRefs || {},
    nextRecommendedActions: rawResult?.nextRecommendedActions || [],
    executionId,
    startedAt
  });
}

/**
 * Unwraps canonical result for legacy consumers
 */
export function unwrapLegacyResult(canonicalResult) {
  return {
    success: canonicalResult.success,
    message: canonicalResult.message,
    ...(canonicalResult.data || {}),
    externalRefs: canonicalResult.externalRefs,
    nextRecommendedActions: canonicalResult.nextRecommendedActions,
    _canonical: true, // Mark as wrapped
    _executionId: canonicalResult.metadata?.executionId,
    _status: canonicalResult.status
  };
}

// ============================================================================
// ROUTE CONSOLIDATION HELPERS
// ============================================================================

/**
 * Creates a consolidated route handler that routes all actions through operator-runtime
 */
export function createConsolidatedActionHandler(options = {}) {
  const { db, getUserEmail } = options;

  return async function handleAction(request) {
    const { 
      actionType, 
      payload, 
      approvalToken,
      runId 
    } = request;

    const userEmail = getUserEmail(request);
    
    // Create context
    const context = executionContextManager.createContext({
      userEmail,
      runId,
      actionType
    });

    // Execute within context
    return executionContextManager.runWithContext(context, async () => {
      const adapter = new CanonicalExecutionAdapter({
        db,
        userEmail,
        boultAI: options.boultAI
      });

      // Route based on approval status
      if (approvalToken) {
        return await adapter.executeWithApproval(
          actionType,
          payload,
          approvalToken,
          { runId }
        );
      }

      // Check if action needs approval
      const metadata = adapter.getActionMetadata(actionType);
      if (metadata?.approvalMode === 'manual') {
        // Generate approval token and return pending status
        const token = adapter.runtime.approvalManager.generateApprovalToken(
          runId || 'unknown',
          actionType,
          { riskLevel: metadata.riskAssessment }
        );

        return buildActionResult({
          success: false,
          message: 'Approval required before execution',
          status: 'blocked',
          error: {
            category: 'approval_required',
            message: 'This action requires user approval',
            retryable: false
          },
          externalRefs: {
            approvalToken: token,
            actionType,
            payload
          },
          nextRecommendedActions: ['approve_action', 'cancel_action']
        });
      }

      // Execute directly
      return await adapter.execute(actionType, payload, { runId });
    });
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  LegacyActionRegistry,
  CanonicalExecutionAdapter,
  createCanonicalHandler,
  canonicalExecutionMiddleware,
  wrapLegacyResult,
  unwrapLegacyResult,
  createConsolidatedActionHandler,
  legacyRegistry
};
