/**
 * Boult Execution Contract - Phase 1
 * Canonical execution contract for plan → todo items → executable actions → completion
 * 
 * This defines the deterministic schema for all agentic executions:
 * - Every action has deterministic input schema
 * - Idempotency keys ensure safe retries
 * - Retry policies handle transient failures
 * - Approval modes control execution flow
 * - Auditable payloads track all execution results
 */

// ============================================================================
// EXECUTION STATUS MACHINE
// ============================================================================

export const EXECUTION_STATUS = {
  // Plan-level statuses
  PLAN_DRAFT: 'plan_draft',
  PLAN_APPROVED: 'plan_approved',
  PLAN_EXECUTING: 'plan_executing',
  PLAN_COMPLETED: 'plan_completed',
  PLAN_FAILED: 'plan_failed',
  PLAN_CANCELLED: 'plan_cancelled',

  // Todo-level statuses
  TODO_PENDING: 'pending',
  TODO_READY: 'ready',
  TODO_RUNNING: 'running',
  TODO_COMPLETED: 'completed',
  TODO_FAILED: 'failed',
  TODO_BLOCKED: 'blocked_approval',
  TODO_SKIPPED: 'skipped',
  TODO_RETRYING: 'retrying',

  // Run-level statuses
  RUN_INITIALIZING: 'initializing',
  RUN_THINKING: 'thinking',
  RUN_SEARCHING: 'searching',
  RUN_SYNTHESIZING: 'synthesizing',
  RUN_APPROVAL: 'approval',
  RUN_EXECUTING: 'executing',
  RUN_COMPLETED: 'completed',
  RUN_FAILED: 'failed',
  RUN_CANCELLED: 'cancelled'
};

// Valid status transitions for strict FSM enforcement
export const VALID_STATUS_TRANSITIONS = {
  [EXECUTION_STATUS.TODO_PENDING]: [
    EXECUTION_STATUS.TODO_READY,
    EXECUTION_STATUS.TODO_SKIPPED,
    EXECUTION_STATUS.TODO_BLOCKED
  ],
  [EXECUTION_STATUS.TODO_READY]: [
    EXECUTION_STATUS.TODO_RUNNING,
    EXECUTION_STATUS.TODO_BLOCKED,
    EXECUTION_STATUS.TODO_SKIPPED
  ],
  [EXECUTION_STATUS.TODO_RUNNING]: [
    EXECUTION_STATUS.TODO_COMPLETED,
    EXECUTION_STATUS.TODO_FAILED,
    EXECUTION_STATUS.TODO_BLOCKED,
    EXECUTION_STATUS.TODO_RETRYING
  ],
  [EXECUTION_STATUS.TODO_RETRYING]: [
    EXECUTION_STATUS.TODO_RUNNING,
    EXECUTION_STATUS.TODO_FAILED,
    EXECUTION_STATUS.TODO_COMPLETED
  ],
  [EXECUTION_STATUS.TODO_BLOCKED]: [
    EXECUTION_STATUS.TODO_RUNNING,
    EXECUTION_STATUS.TODO_SKIPPED,
    EXECUTION_STATUS.TODO_FAILED
  ],
  [EXECUTION_STATUS.TODO_COMPLETED]: [],
  [EXECUTION_STATUS.TODO_FAILED]: [],
  [EXECUTION_STATUS.TODO_SKIPPED]: []
};

// ============================================================================
// APPROVAL MODES
// ============================================================================

export const APPROVAL_MODE = {
  AUTO: 'auto',           // Execute immediately without user approval
  MANUAL: 'manual',       // Require explicit user approval before execution
  CONDITIONAL: 'conditional'  // Auto for low-risk, manual for high-risk
};

// Risk assessment for conditional approval
export const RISK_ASSESSMENT = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

// ============================================================================
// RETRY POLICIES
// ============================================================================

export const RETRY_STRATEGY = {
  FIXED: 'fixed',           // Fixed delay between retries
  LINEAR: 'linear',         // Linear backoff
  EXPONENTIAL: 'exponential', // Exponential backoff (default)
  IMMEDIATE: 'immediate'    // Retry immediately (for idempotent ops)
};

export const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  strategy: RETRY_STRATEGY.EXPONENTIAL,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,  // Add random jitter to prevent thundering herd
  retryableErrors: ['network', 'timeout', 'rate_limit', 'service_unavailable'],
  nonRetryableErrors: ['auth_failed', 'permission_denied', 'invalid_input', 'not_found']
};

// ============================================================================
// ERROR CATEGORIES
// ============================================================================

export const ERROR_CATEGORY = {
  // Transient errors (can retry)
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  RATE_LIMIT: 'rate_limit',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  
  // Permanent errors (don't retry)
  AUTH_FAILED: 'auth_failed',
  PERMISSION_DENIED: 'permission_denied',
  INVALID_INPUT: 'invalid_input',
  NOT_FOUND: 'not_found',
  VALIDATION_FAILED: 'validation_failed',
  
  // Business logic errors
  ALREADY_EXISTS: 'already_exists',
  CONFLICT: 'conflict',
  PRECONDITION_FAILED: 'precondition_failed',
  
  // System errors
  INTERNAL_ERROR: 'internal_error',
  UNKNOWN: 'unknown'
};

// ============================================================================
// IDEMPOTENCY
// ============================================================================

export const IDEMPOTENCY_KEY_FORMAT = {
  // Format: {runId}:{actionType}:{inputHash}:{timestamp}
  generate: (runId, actionType, payload) => {
    const inputHash = hashPayload(payload);
    return `${runId}:${actionType}:${inputHash}`;
  }
};

function hashPayload(payload) {
  // Simple hash for deterministic idempotency keys
  const str = JSON.stringify(payload, Object.keys(payload).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36).slice(0, 12);
}

// ============================================================================
// CANONICAL EXECUTION CONTRACT SCHEMA
// ============================================================================

/**
 * Canonical Action Input Schema
 * Every action must conform to this structure for deterministic execution
 */
export const ActionInputSchema = {
  // Required: Action identifier from TASK_REGISTRY
  actionType: { type: 'string', required: true },
  
  // Required: Unique execution identifier
  executionId: { type: 'string', required: true },
  
  // Required: Idempotency key for safe retries
  idempotencyKey: { type: 'string', required: true },
  
  // Required: Action-specific payload
  payload: { type: 'object', required: true },
  
  // Optional: Execution context
  context: {
    runId: { type: 'string', optional: true },
    planId: { type: 'string', optional: true },
    todoId: { type: 'string', optional: true },
    userEmail: { type: 'string', optional: true },
    conversationId: { type: 'string', optional: true }
  },
  
  // Optional: Retry configuration
  retryPolicy: {
    maxAttempts: { type: 'number', default: 3 },
    strategy: { type: 'string', default: 'exponential' },
    baseDelayMs: { type: 'number', default: 1000 }
  },
  
  // Optional: Approval configuration
  approvalConfig: {
    mode: { type: 'string', default: 'conditional' },
    riskLevel: { type: 'string', default: 'medium' },
    approvalToken: { type: 'string', optional: true }
  },
  
  // Optional: Timeout configuration
  timeoutMs: { type: 'number', default: 30000 }
};

/**
 * Canonical Action Result Schema
 * Every action must return results in this structure for auditability
 */
export const ActionResultSchema = {
  // Required: Execution status
  success: { type: 'boolean', required: true },
  
  // Required: Human-readable status message
  message: { type: 'string', required: true },
  
  // Required: Result category
  status: { 
    type: 'string', 
    required: true,
    enum: ['completed', 'failed', 'blocked', 'skipped', 'pending']
  },
  
  // Optional: Action output data
  data: { type: 'object', optional: true },
  
  // Optional: External references (e.g., Gmail message ID)
  externalRefs: { type: 'object', optional: true },
  
  // Optional: Error details (when success=false)
  error: {
    category: { type: 'string', required: false },
    code: { type: 'string', required: false },
    message: { type: 'string', required: false },
    stack: { type: 'string', optional: true },
    retryable: { type: 'boolean', default: false }
  },
  
  // Optional: Execution metadata
  metadata: {
    executionId: { type: 'string', optional: true },
    startedAt: { type: 'string', optional: true },
    completedAt: { type: 'string', optional: true },
    durationMs: { type: 'number', optional: true },
    attemptCount: { type: 'number', default: 1 },
    idempotencyKey: { type: 'string', optional: true }
  },
  
  // Optional: Next recommended actions
  nextRecommendedActions: { type: 'array', default: [] }
};

/**
 * Canonical Todo Item Schema
 * Represents a single executable unit within a plan
 */
export const TodoItemSchema = {
  // Required: Unique identifier
  todoId: { type: 'string', required: true },
  
  // Required: Human-readable title
  title: { type: 'string', required: true },
  
  // Optional: Detailed description
  description: { type: 'string', optional: true },
  
  // Required: Current status
  status: { 
    type: 'string', 
    required: true,
    enum: Object.values(EXECUTION_STATUS).filter(s => s.startsWith('todo_'))
  },
  
  // Required: Action type from TASK_REGISTRY
  actionType: { type: 'string', required: true },
  
  // Required: Sort order for execution
  sortOrder: { type: 'number', required: true },
  
  // Required: Dependencies (todoIds that must complete first)
  dependsOn: { type: 'array', default: [] },
  
  // Required: Approval mode
  approvalMode: { 
    type: 'string', 
    default: APPROVAL_MODE.CONDITIONAL 
  },
  
  // Required: Retry policy for this todo
  retryPolicy: { type: 'object', default: DEFAULT_RETRY_POLICY },
  
  // Required: Execution attempt counter
  attemptCount: { type: 'number', default: 0 },
  
  // Optional: Maximum allowed attempts
  maxAttempts: { type: 'number', default: 3 },
  
  // Optional: Action input payload (populated when ready to execute)
  actionInput: { type: 'object', optional: true },
  
  // Optional: Action result (populated after execution)
  actionResult: { type: 'object', optional: true },
  
  // Optional: Error message (when failed)
  errorMessage: { type: 'string', optional: true },
  
  // Optional: Error category
  errorCategory: { type: 'string', optional: true },
  
  // Timestamps
  createdAt: { type: 'string', required: true },
  readyAt: { type: 'string', optional: true },
  startedAt: { type: 'string', optional: true },
  completedAt: { type: 'string', optional: true },
  failedAt: { type: 'string', optional: true }
};

/**
 * Canonical Plan Artifact Schema
 * Top-level container for executable plans
 */
export const PlanArtifactSchema = {
  // Required: Unique identifier
  planId: { type: 'string', required: true },
  
  // Required: Human-readable title
  title: { type: 'string', required: true },
  
  // Required: Plan objective
  objective: { type: 'string', required: true },
  
  // Optional: Assumptions made during planning
  assumptions: { type: 'array', default: [] },
  
  // Optional: Questions answered during planning
  questionsAnswered: { type: 'array', default: [] },
  
  // Optional: Acceptance criteria for plan completion
  acceptanceCriteria: { type: 'array', default: [] },
  
  // Required: Current plan status
  status: { 
    type: 'string', 
    required: true,
    enum: [
      EXECUTION_STATUS.PLAN_DRAFT,
      EXECUTION_STATUS.PLAN_APPROVED,
      EXECUTION_STATUS.PLAN_EXECUTING,
      EXECUTION_STATUS.PLAN_COMPLETED,
      EXECUTION_STATUS.PLAN_FAILED,
      EXECUTION_STATUS.PLAN_CANCELLED
    ]
  },
  
  // Required: Plan version
  version: { type: 'number', default: 1 },
  
  // Required: Lock status (prevents modification when true)
  locked: { type: 'boolean', default: false },
  
  // Optional: Approval timestamp
  approvedAt: { type: 'string', optional: true },
  
  // Optional: Completion timestamp
  completedAt: { type: 'string', optional: true },
  
  // Required: Complexity assessment
  complexity: { type: 'string', enum: ['simple', 'complex'], required: true },
  
  // Optional: Detected intent
  intent: { type: 'string', optional: true },
  
  // Optional: Canvas type for UI rendering
  canvasType: { type: 'string', default: 'none' },
  
  // Required: Todo items
  todos: { type: 'array', required: true },
  
  // Optional: Overall approval mode
  approvalMode: { type: 'string', default: APPROVAL_MODE.CONDITIONAL },
  
  // Optional: Global retry policy (can be overridden per-todo)
  retryPolicy: { type: 'object', default: DEFAULT_RETRY_POLICY },
  
  // Required: Creation timestamp
  createdAt: { type: 'string', required: true },
  
  // Optional: Associated run ID
  runId: { type: 'string', optional: true },
  
  // Optional: User who created the plan
  createdBy: { type: 'string', optional: true }
};

/**
 * Canonical Run State Schema
 * Represents a single execution run
 */
export const RunStateSchema = {
  // Required: Unique identifier
  runId: { type: 'string', required: true },
  
  // Required: User identifier
  userEmail: { type: 'string', required: true },
  
  // Optional: Conversation context
  conversationId: { type: 'string', optional: true },
  
  // Optional: Mission context
  missionId: { type: 'string', optional: true },
  
  // Optional: Associated plan
  planId: { type: 'string', optional: true },
  
  // Required: Current run status
  status: { 
    type: 'string', 
    required: true,
    enum: [
      EXECUTION_STATUS.RUN_INITIALIZING,
      EXECUTION_STATUS.RUN_THINKING,
      EXECUTION_STATUS.RUN_SEARCHING,
      EXECUTION_STATUS.RUN_SYNTHESIZING,
      EXECUTION_STATUS.RUN_APPROVAL,
      EXECUTION_STATUS.RUN_EXECUTING,
      EXECUTION_STATUS.RUN_COMPLETED,
      EXECUTION_STATUS.RUN_FAILED,
      EXECUTION_STATUS.RUN_CANCELLED
    ]
  },
  
  // Required: Current execution phase
  phase: { type: 'string', required: true },
  
  // Optional: Detected intent
  intent: { type: 'string', optional: true },
  
  // Optional: Complexity assessment
  complexity: { type: 'string', optional: true },
  
  // Optional: Plan snapshot
  planSnapshot: { type: 'array', optional: true },
  
  // Required: Run memory/context
  memory: { type: 'object', default: {} },
  
  // Timestamps
  createdAt: { type: 'string', required: true },
  startedAt: { type: 'string', optional: true },
  completedAt: { type: 'string', optional: true },
  failedAt: { type: 'string', optional: true },
  
  // Optional: Error details
  error: { type: 'object', optional: true }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Validate status transition
 * @param {string} fromStatus - Current status
 * @param {string} toStatus - Desired new status
 * @returns {boolean} - Whether the transition is valid
 */
export function isValidStatusTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true; // No-op is always valid
  const validTransitions = VALID_STATUS_TRANSITIONS[fromStatus] || [];
  return validTransitions.includes(toStatus);
}

/**
 * Get error category from error
 * @param {Error} error - Error object
 * @returns {string} - Error category
 */
export function categorizeError(error) {
  if (!error) return ERROR_CATEGORY.UNKNOWN;
  
  const message = error.message?.toLowerCase() || '';
  const code = error.code?.toLowerCase() || '';
  
  // Network errors
  if (message.includes('network') || message.includes('econnrefused') || 
      message.includes('enotfound') || code === 'network_error') {
    return ERROR_CATEGORY.NETWORK;
  }
  
  // Timeout errors
  if (message.includes('timeout') || code === 'timeout') {
    return ERROR_CATEGORY.TIMEOUT;
  }
  
  // Rate limit
  if (message.includes('rate limit') || message.includes('too many requests') ||
      code === 'rate_limit') {
    return ERROR_CATEGORY.RATE_LIMIT;
  }
  
  // Auth errors
  if (message.includes('auth') || message.includes('unauthorized') ||
      code === 'auth_failed') {
    return ERROR_CATEGORY.AUTH_FAILED;
  }
  
  // Permission errors
  if (message.includes('permission') || message.includes('forbidden') ||
      code === 'permission_denied') {
    return ERROR_CATEGORY.PERMISSION_DENIED;
  }
  
  // Not found
  if (message.includes('not found') || code === 'not_found') {
    return ERROR_CATEGORY.NOT_FOUND;
  }
  
  // Service unavailable
  if (message.includes('unavailable') || message.includes('503') ||
      code === 'service_unavailable') {
    return ERROR_CATEGORY.SERVICE_UNAVAILABLE;
  }
  
  return ERROR_CATEGORY.UNKNOWN;
}

/**
 * Check if error is retryable
 * @param {string} errorCategory - Error category
 * @returns {boolean} - Whether the error is retryable
 */
export function isRetryableError(errorCategory) {
  const retryableCategories = [
    ERROR_CATEGORY.NETWORK,
    ERROR_CATEGORY.TIMEOUT,
    ERROR_CATEGORY.RATE_LIMIT,
    ERROR_CATEGORY.SERVICE_UNAVAILABLE
  ];
  return retryableCategories.includes(errorCategory);
}

/**
 * Calculate retry delay
 * @param {number} attempt - Current attempt (0-indexed)
 * @param {object} retryPolicy - Retry policy configuration
 * @returns {number} - Delay in milliseconds
 */
export function calculateRetryDelay(attempt, retryPolicy = DEFAULT_RETRY_POLICY) {
  const { strategy, baseDelayMs, maxDelayMs, backoffMultiplier, jitter } = retryPolicy;
  
  let delay = baseDelayMs;
  
  switch (strategy) {
    case RETRY_STRATEGY.FIXED:
      delay = baseDelayMs;
      break;
    case RETRY_STRATEGY.LINEAR:
      delay = baseDelayMs * (attempt + 1);
      break;
    case RETRY_STRATEGY.EXPONENTIAL:
    default:
      delay = baseDelayMs * Math.pow(backoffMultiplier, attempt);
      break;
  }
  
  // Cap at max delay
  delay = Math.min(delay, maxDelayMs);
  
  // Add jitter (±25%) to prevent thundering herd
  if (jitter) {
    const jitterFactor = 0.75 + (Math.random() * 0.5);
    delay = Math.floor(delay * jitterFactor);
  }
  
  return delay;
}

/**
 * Assess risk level for conditional approval
 * @param {string} actionType - Action type
 * @param {object} payload - Action payload
 * @returns {string} - Risk level
 */
export function assessRiskLevel(actionType, payload = {}) {
  // High-risk actions (mutating, external-facing)
  const highRiskActions = [
    'send_email', 'boult_outreach', 'boult_auto_pilot',
    'schedule_meeting', 'delete_email', 'archive_email'
  ];
  
  // Critical-risk actions (irreversible, bulk operations)
  const criticalRiskActions = [
    'bulk_delete', 'bulk_archive', 'bulk_send', 'auto_pilot_bulk'
  ];
  
  if (criticalRiskActions.some(a => actionType.includes(a))) {
    return RISK_ASSESSMENT.CRITICAL;
  }
  
  if (highRiskActions.some(a => actionType.includes(a))) {
    return RISK_ASSESSMENT.HIGH;
  }
  
  // Check for bulk operations in payload
  if (payload.bulk === true || payload.batch === true || 
      (payload.items && payload.items.length > 5)) {
    return RISK_ASSESSMENT.HIGH;
  }
  
  // Check for external recipients
  if (payload.to && typeof payload.to === 'string') {
    // External domain detection
    const externalDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];
    const isExternal = externalDomains.some(domain => payload.to.includes(domain));
    if (isExternal) {
      return RISK_ASSESSMENT.MEDIUM;
    }
  }
  
  return RISK_ASSESSMENT.LOW;
}

/**
 * Determine approval mode based on risk and configuration
 * @param {string} actionType - Action type
 * @param {object} payload - Action payload
 * @param {string} configuredMode - Configured approval mode
 * @returns {string} - Effective approval mode
 */
export function determineApprovalMode(actionType, payload = {}, configuredMode = APPROVAL_MODE.CONDITIONAL) {
  // If explicitly set to auto or manual, respect that
  if (configuredMode === APPROVAL_MODE.AUTO) {
    return APPROVAL_MODE.AUTO;
  }
  
  if (configuredMode === APPROVAL_MODE.MANUAL) {
    return APPROVAL_MODE.MANUAL;
  }
  
  // For conditional, assess risk
  const riskLevel = assessRiskLevel(actionType, payload);
  
  // Auto for low risk
  if (riskLevel === RISK_ASSESSMENT.LOW) {
    return APPROVAL_MODE.AUTO;
  }
  
  // Manual for high/critical risk
  if (riskLevel === RISK_ASSESSMENT.HIGH || riskLevel === RISK_ASSESSMENT.CRITICAL) {
    return APPROVAL_MODE.MANUAL;
  }
  
  // Medium risk: use context to decide
  return APPROVAL_MODE.MANUAL;
}

/**
 * Generate idempotency key
 * @param {string} runId - Run ID
 * @param {string} actionType - Action type
 * @param {object} payload - Action payload
 * @returns {string} - Idempotency key
 */
export function generateIdempotencyKey(runId, actionType, payload = {}) {
  return IDEMPOTENCY_KEY_FORMAT.generate(runId, actionType, payload);
}

/**
 * Build canonical action input
 * @param {object} params - Input parameters
 * @returns {object} - Canonical action input
 */
export function buildActionInput({
  actionType,
  payload,
  context = {},
  retryPolicy = DEFAULT_RETRY_POLICY,
  approvalMode = APPROVAL_MODE.CONDITIONAL,
  timeoutMs = 30000
}) {
  const executionId = `${context.runId || 'exec'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = generateIdempotencyKey(context.runId || executionId, actionType, payload);
  
  return {
    actionType,
    executionId,
    idempotencyKey,
    payload,
    context,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, ...retryPolicy },
    approvalConfig: {
      mode: approvalMode,
      riskLevel: assessRiskLevel(actionType, payload)
    },
    timeoutMs,
    createdAt: new Date().toISOString()
  };
}

/**
 * Build canonical action result
 * @param {object} params - Result parameters
 * @returns {object} - Canonical action result
 */
export function buildActionResult({
  success,
  message,
  data = null,
  externalRefs = {},
  error = null,
  executionId,
  startedAt,
  nextRecommendedActions = []
}) {
  const completedAt = new Date().toISOString();
  const durationMs = startedAt 
    ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
    : 0;
  
  return {
    success,
    message,
    status: success ? 'completed' : (error?.retryable ? 'failed' : 'failed'),
    data,
    externalRefs,
    error: error ? {
      category: error.category || ERROR_CATEGORY.UNKNOWN,
      code: error.code,
      message: error.message,
      retryable: error.retryable || false
    } : null,
    metadata: {
      executionId,
      startedAt,
      completedAt,
      durationMs,
      attemptCount: error?.attemptCount || 1
    },
    nextRecommendedActions
  };
}

// ============================================================================
// EXPORT DEFAULT
// ============================================================================

export default {
  EXECUTION_STATUS,
  VALID_STATUS_TRANSITIONS,
  APPROVAL_MODE,
  RISK_ASSESSMENT,
  RETRY_STRATEGY,
  DEFAULT_RETRY_POLICY,
  ERROR_CATEGORY,
  IDEMPOTENCY_KEY_FORMAT,
  ActionInputSchema,
  ActionResultSchema,
  TodoItemSchema,
  PlanArtifactSchema,
  RunStateSchema,
  isValidStatusTransition,
  categorizeError,
  isRetryableError,
  calculateRetryDelay,
  assessRiskLevel,
  determineApprovalMode,
  generateIdempotencyKey,
  buildActionInput,
  buildActionResult
};
