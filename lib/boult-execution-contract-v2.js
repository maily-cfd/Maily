/**
 * Boult Execution Contract - Phase 1 Complete
 * Canonical execution contract for plan → todo items → executable actions → completion
 * 
 * This defines the deterministic schema for all agentic executions:
 * - PlanArtifact: Top-level container for executable plans
 * - TodoExecutionItem: Single executable unit within a plan
 * - ExecutionAction: Individual action with deterministic input schema
 * - ExecutionResult: Action result with audit payload
 * 
 * Every action carries:
 * - deterministic input schema
 * - idempotencyKey
 * - retry policy (maxAttempts, backoff)
 * - approval policy (required, token, expiresAt)
 * - audit payload (who, when, what changed, externalRefs)
 */

// ============================================================================
// EXECUTION STATUS MACHINE - STRICT FSM
// ============================================================================

export const EXECUTION_STATUS = {
  // Run-level lifecycle phases
  RUN_INITIALIZING: 'initializing',
  RUN_THINKING: 'thinking',
  RUN_SEARCHING: 'searching',
  RUN_SYNTHESIZING: 'synthesizing',
  RUN_APPROVAL: 'approval',
  RUN_EXECUTING: 'executing',
  RUN_POST_EXECUTION: 'post_execution',
  RUN_COMPLETED: 'completed',
  RUN_FAILED: 'failed',
  RUN_CANCELLED: 'cancelled',

  // Todo-level statuses
  TODO_PENDING: 'pending',
  TODO_READY: 'ready',
  TODO_RUNNING: 'running',
  TODO_COMPLETED: 'completed',
  TODO_FAILED: 'failed',
  TODO_BLOCKED: 'blocked_approval',
  TODO_SKIPPED: 'skipped',
  TODO_RETRYING: 'retrying',

  // Plan-level statuses
  PLAN_DRAFT: 'plan_draft',
  PLAN_APPROVED: 'plan_approved',
  PLAN_EXECUTING: 'plan_executing',
  PLAN_COMPLETED: 'plan_completed',
  PLAN_FAILED: 'plan_failed',
  PLAN_CANCELLED: 'plan_cancelled'
};

// ============================================================================
// STRICT STATUS TRANSITIONS (FSM-enforced)
// ============================================================================

export const LEGAL_RUN_TRANSITIONS = {
  [EXECUTION_STATUS.RUN_INITIALIZING]: [
    EXECUTION_STATUS.RUN_THINKING,
    EXECUTION_STATUS.RUN_FAILED
  ],
  [EXECUTION_STATUS.RUN_THINKING]: [
    EXECUTION_STATUS.RUN_SEARCHING,
    EXECUTION_STATUS.RUN_SYNTHESIZING,
    EXECUTION_STATUS.RUN_FAILED
  ],
  [EXECUTION_STATUS.RUN_SEARCHING]: [
    EXECUTION_STATUS.RUN_SYNTHESIZING,
    EXECUTION_STATUS.RUN_FAILED
  ],
  [EXECUTION_STATUS.RUN_SYNTHESIZING]: [
    EXECUTION_STATUS.RUN_APPROVAL,
    EXECUTION_STATUS.RUN_EXECUTING,
    EXECUTION_STATUS.RUN_COMPLETED,
    EXECUTION_STATUS.RUN_FAILED
  ],
  [EXECUTION_STATUS.RUN_APPROVAL]: [
    EXECUTION_STATUS.RUN_EXECUTING,
    EXECUTION_STATUS.RUN_CANCELLED,
    EXECUTION_STATUS.RUN_FAILED
  ],
  [EXECUTION_STATUS.RUN_EXECUTING]: [
    EXECUTION_STATUS.RUN_POST_EXECUTION,
    EXECUTION_STATUS.RUN_COMPLETED,
    EXECUTION_STATUS.RUN_FAILED,
    EXECUTION_STATUS.RUN_CANCELLED
  ],
  [EXECUTION_STATUS.RUN_POST_EXECUTION]: [
    EXECUTION_STATUS.RUN_COMPLETED,
    EXECUTION_STATUS.RUN_FAILED
  ],
  [EXECUTION_STATUS.RUN_COMPLETED]: [],
  [EXECUTION_STATUS.RUN_FAILED]: [],
  [EXECUTION_STATUS.RUN_CANCELLED]: []
};

export const LEGAL_TODO_TRANSITIONS = {
  [EXECUTION_STATUS.TODO_PENDING]: [
    EXECUTION_STATUS.TODO_READY,
    EXECUTION_STATUS.TODO_BLOCKED,
    EXECUTION_STATUS.TODO_SKIPPED
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

export const LEGAL_PLAN_TRANSITIONS = {
  [EXECUTION_STATUS.PLAN_DRAFT]: [
    EXECUTION_STATUS.PLAN_APPROVED,
    EXECUTION_STATUS.PLAN_CANCELLED
  ],
  [EXECUTION_STATUS.PLAN_APPROVED]: [
    EXECUTION_STATUS.PLAN_EXECUTING,
    EXECUTION_STATUS.PLAN_CANCELLED
  ],
  [EXECUTION_STATUS.PLAN_EXECUTING]: [
    EXECUTION_STATUS.PLAN_COMPLETED,
    EXECUTION_STATUS.PLAN_FAILED,
    EXECUTION_STATUS.PLAN_CANCELLED
  ],
  [EXECUTION_STATUS.PLAN_COMPLETED]: [],
  [EXECUTION_STATUS.PLAN_FAILED]: [],
  [EXECUTION_STATUS.PLAN_CANCELLED]: []
};

export const VALID_STATUS_TRANSITIONS = {
  ...LEGAL_TODO_TRANSITIONS,
  ...LEGAL_RUN_TRANSITIONS,
  ...LEGAL_PLAN_TRANSITIONS
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
// ERROR CATEGORIES WITH RECOVERY HINTS
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
  ALREADY_COMPLETED: 'already_completed',
  
  // System errors
  INTERNAL_ERROR: 'internal_error',
  UNKNOWN: 'unknown'
};

/**
 * Error recovery hints for each error category
 */
export const ERROR_RECOVERY_HINTS = {
  [ERROR_CATEGORY.NETWORK]: {
    userMessage: 'Connection issue detected. Retrying automatically...',
    recoveryAction: 'retry',
    autoRetry: true,
    maxRetries: 3,
    escalationThreshold: 3
  },
  [ERROR_CATEGORY.TIMEOUT]: {
    userMessage: 'Request timed out. Retrying with extended timeout...',
    recoveryAction: 'retry_with_backoff',
    autoRetry: true,
    maxRetries: 3,
    escalationThreshold: 2
  },
  [ERROR_CATEGORY.RATE_LIMIT]: {
    userMessage: 'Rate limit hit. Waiting before retry...',
    recoveryAction: 'retry_with_delay',
    autoRetry: true,
    maxRetries: 5,
    escalationThreshold: 3,
    suggestedDelay: 60000 // 1 minute
  },
  [ERROR_CATEGORY.SERVICE_UNAVAILABLE]: {
    userMessage: 'Service temporarily unavailable. Retrying...',
    recoveryAction: 'retry_with_backoff',
    autoRetry: true,
    maxRetries: 3,
    escalationThreshold: 2
  },
  [ERROR_CATEGORY.AUTH_FAILED]: {
    userMessage: 'Authentication failed. Please reconnect your account.',
    recoveryAction: 'reauth_required',
    autoRetry: false,
    requiresUserAction: true,
    suggestedAction: 'reconnect_integration'
  },
  [ERROR_CATEGORY.PERMISSION_DENIED]: {
    userMessage: 'Permission denied. Check your account settings.',
    recoveryAction: 'manual_intervention',
    autoRetry: false,
    requiresUserAction: true,
    suggestedAction: 'check_permissions'
  },
  [ERROR_CATEGORY.INVALID_INPUT]: {
    userMessage: 'Invalid input provided. Please check and retry.',
    recoveryAction: 'input_correction',
    autoRetry: false,
    requiresUserAction: true,
    suggestedAction: 'revise_input'
  },
  [ERROR_CATEGORY.NOT_FOUND]: {
    userMessage: 'Resource not found. It may have been deleted.',
    recoveryAction: 'skip_or_alternative',
    autoRetry: false,
    requiresUserAction: false,
    suggestedAction: 'use_alternative'
  },
  [ERROR_CATEGORY.VALIDATION_FAILED]: {
    userMessage: 'Validation failed. Please check your input.',
    recoveryAction: 'input_correction',
    autoRetry: false,
    requiresUserAction: true,
    suggestedAction: 'fix_validation_errors'
  },
  [ERROR_CATEGORY.ALREADY_EXISTS]: {
    userMessage: 'Resource already exists. Skipping duplicate.',
    recoveryAction: 'skip_and_continue',
    autoRetry: false,
    requiresUserAction: false,
    isSuccessEquivalent: true
  },
  [ERROR_CATEGORY.ALREADY_COMPLETED]: {
    userMessage: 'This action has already been completed. No duplicate mutation.',
    recoveryAction: 'return_cached_result',
    autoRetry: false,
    requiresUserAction: false,
    isSuccessEquivalent: true
  },
  [ERROR_CATEGORY.CONFLICT]: {
    userMessage: 'Conflict detected. Please review and resolve.',
    recoveryAction: 'manual_resolution',
    autoRetry: false,
    requiresUserAction: true,
    suggestedAction: 'resolve_conflict'
  },
  [ERROR_CATEGORY.PRECONDITION_FAILED]: {
    userMessage: 'Required conditions not met. Please check prerequisites.',
    recoveryAction: 'precondition_check',
    autoRetry: false,
    requiresUserAction: true,
    suggestedAction: 'check_prerequisites'
  },
  [ERROR_CATEGORY.INTERNAL_ERROR]: {
    userMessage: 'Internal error occurred. Our team has been notified.',
    recoveryAction: 'escalate',
    autoRetry: false,
    requiresUserAction: false,
    isSystemError: true
  },
  [ERROR_CATEGORY.UNKNOWN]: {
    userMessage: 'An unexpected error occurred. Please try again.',
    recoveryAction: 'retry_once',
    autoRetry: true,
    maxRetries: 1,
    escalationThreshold: 1
  }
};

// ============================================================================
// AUDIT PAYLOAD SCHEMA
// ============================================================================

/**
 * Canonical Audit Payload
 * Tracks who, when, what changed, and external references for every action
 */
export const AuditPayloadSchema = {
  // Who performed the action
  actor: {
    userEmail: { type: 'string', required: true },
    userId: { type: 'string', optional: true },
    sessionId: { type: 'string', optional: true },
    ipAddress: { type: 'string', optional: true },
    userAgent: { type: 'string', optional: true }
  },
  
  // When it happened
  timestamps: {
    requestedAt: { type: 'string', format: 'datetime', required: true },
    startedAt: { type: 'string', format: 'datetime', optional: true },
    completedAt: { type: 'string', format: 'datetime', optional: true },
    durationMs: { type: 'number', optional: true }
  },
  
  // What changed (mutation tracking)
  changes: {
    actionType: { type: 'string', required: true },
    actionDescription: { type: 'string', optional: true },
    inputSummary: { type: 'object', required: true },
    outputSummary: { type: 'object', optional: true },
    previousState: { type: 'object', optional: true },
    newState: { type: 'object', optional: true },
    mutationType: { 
      type: 'string', 
      enum: ['create', 'update', 'delete', 'read', 'execute'],
      required: true 
    }
  },
  
  // External references
  externalRefs: {
    // Gmail references
    gmailMessageId: { type: 'string', optional: true },
    gmailThreadId: { type: 'string', optional: true },
    gmailDraftId: { type: 'string', optional: true },
    
    // Calendar references
    calendarEventId: { type: 'string', optional: true },
    
    // Notion references
    notionPageId: { type: 'string', optional: true },
    notionDatabaseId: { type: 'string', optional: true },
    
    // Task references
    taskId: { type: 'string', optional: true },
    taskListId: { type: 'string', optional: true },
    
    // Generic external IDs
    externalId: { type: 'string', optional: true },
    externalUrl: { type: 'string', optional: true }
  },
  
  // Execution context
  context: {
    runId: { type: 'string', optional: true },
    planId: { type: 'string', optional: true },
    todoId: { type: 'string', optional: true },
    conversationId: { type: 'string', optional: true },
    missionId: { type: 'string', optional: true }
  },
  
  // Compliance & risk
  compliance: {
    riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], required: true },
    approvalMode: { type: 'string', enum: ['auto', 'manual', 'conditional'], required: true },
    approvalToken: { type: 'string', optional: true },
    requiresPiiHandling: { type: 'boolean', default: false },
    dataRetentionDays: { type: 'number', default: 90 }
  }
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
  // Deterministic hash for idempotency keys
  const str = JSON.stringify(payload, Object.keys(payload || {}).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36).slice(0, 12);
}

// ============================================================================
// CANONICAL SCHEMAS
// ============================================================================

/**
 * PlanArtifact - Top-level container for executable plans
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
  
  // Required: Todo items (TodoExecutionItem array)
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
 * TodoExecutionItem - Single executable unit within a plan
 */
export const TodoExecutionItemSchema = {
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
    enum: Object.values(EXECUTION_STATUS).filter(s => s.startsWith('todo_') || 
      ['pending', 'ready', 'running', 'completed', 'failed', 'blocked_approval', 'skipped', 'retrying'].includes(s))
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
  
  // Optional: Error recovery hint
  recoveryHint: { type: 'object', optional: true },
  
  // Timestamps
  createdAt: { type: 'string', required: true },
  readyAt: { type: 'string', optional: true },
  startedAt: { type: 'string', optional: true },
  completedAt: { type: 'string', optional: true },
  failedAt: { type: 'string', optional: true }
};

/**
 * ExecutionAction - Individual action with deterministic input schema
 */
export const ExecutionActionSchema = {
  // Required: Action identifier from TASK_REGISTRY
  actionType: { type: 'string', required: true },
  
  // Required: Unique execution identifier
  executionId: { type: 'string', required: true },
  
  // Required: Idempotency key for safe retries
  idempotencyKey: { type: 'string', required: true },
  
  // Required: Action-specific payload with deterministic schema
  payload: { type: 'object', required: true },
  
  // Required: Retry policy
  retryPolicy: {
    maxAttempts: { type: 'number', default: 3 },
    strategy: { type: 'string', default: 'exponential' },
    baseDelayMs: { type: 'number', default: 1000 },
    maxDelayMs: { type: 'number', default: 30000 },
    backoffMultiplier: { type: 'number', default: 2 },
    jitter: { type: 'boolean', default: true }
  },
  
  // Required: Approval policy
  approvalPolicy: {
    required: { type: 'boolean', default: false },
    token: { type: 'string', optional: true },
    expiresAt: { type: 'string', format: 'datetime', optional: true },
    mode: { type: 'string', enum: ['auto', 'manual', 'conditional'], default: 'conditional' }
  },
  
  // Required: Audit payload (who, when, what changed, externalRefs)
  auditPayload: { type: 'object', required: true },
  
  // Optional: Execution context
  context: {
    runId: { type: 'string', optional: true },
    planId: { type: 'string', optional: true },
    todoId: { type: 'string', optional: true },
    userEmail: { type: 'string', optional: true },
    conversationId: { type: 'string', optional: true },
    missionId: { type: 'string', optional: true }
  },
  
  // Optional: Timeout configuration
  timeoutMs: { type: 'number', default: 30000 },
  
  // Required: Creation timestamp
  createdAt: { type: 'string', required: true }
};

/**
 * ExecutionResult - Action result with audit payload
 */
export const ExecutionResultSchema = {
  // Required: Execution status
  success: { type: 'boolean', required: true },
  
  // Required: Human-readable status message
  message: { type: 'string', required: true },
  
  // Required: Result category
  status: { 
    type: 'string', 
    required: true,
    enum: ['completed', 'failed', 'blocked', 'skipped', 'pending', 'already_completed']
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
    retryable: { type: 'boolean', default: false },
    recoveryHint: { type: 'object', optional: true }
  },
  
  // Required: Execution metadata with audit trail
  metadata: {
    executionId: { type: 'string', required: true },
    idempotencyKey: { type: 'string', required: true },
    actionType: { type: 'string', required: true },
    startedAt: { type: 'string', required: true },
    completedAt: { type: 'string', required: true },
    durationMs: { type: 'number', required: true },
    attemptCount: { type: 'number', default: 1 },
    fromCache: { type: 'boolean', default: false }
  },
  
  // Required: Audit payload (who, when, what changed)
  auditPayload: { type: 'object', required: true },
  
  // Optional: Next recommended actions
  nextRecommendedActions: { type: 'array', default: [] }
};

/**
 * RunState - Represents a single execution run
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
      EXECUTION_STATUS.RUN_POST_EXECUTION,
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
 * Get allowed transitions for a status
 * @param {string} status - Current status
 * @returns {string[]} - Array of allowed next statuses
 */
export function getAllowedTransitions(status) {
  return VALID_STATUS_TRANSITIONS[status] || [];
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
  
  // Already completed / duplicate
  if (message.includes('already completed') || message.includes('already done') ||
      code === 'already_completed') {
    return ERROR_CATEGORY.ALREADY_COMPLETED;
  }
  
  // Already exists / duplicate resource
  if (message.includes('already exists') || code === 'already_exists') {
    return ERROR_CATEGORY.ALREADY_EXISTS;
  }
  
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
  
  // Validation failed
  if (message.includes('validation') || message.includes('invalid') ||
      code === 'validation_failed') {
    return ERROR_CATEGORY.VALIDATION_FAILED;
  }
  
  // Service unavailable
  if (message.includes('unavailable') || message.includes('503') ||
      code === 'service_unavailable') {
    return ERROR_CATEGORY.SERVICE_UNAVAILABLE;
  }
  
  // Conflict
  if (message.includes('conflict') || code === 'conflict') {
    return ERROR_CATEGORY.CONFLICT;
  }
  
  // Precondition failed
  if (message.includes('precondition') || code === 'precondition_failed') {
    return ERROR_CATEGORY.PRECONDITION_FAILED;
  }
  
  // Internal error
  if (message.includes('internal') || code === 'internal_error') {
    return ERROR_CATEGORY.INTERNAL_ERROR;
  }
  
  return ERROR_CATEGORY.UNKNOWN;
}

/**
 * Get recovery hint for error category
 * @param {string} errorCategory - Error category
 * @returns {object} - Recovery hint object
 */
export function getRecoveryHint(errorCategory) {
  return ERROR_RECOVERY_HINTS[errorCategory] || ERROR_RECOVERY_HINTS[ERROR_CATEGORY.UNKNOWN];
}

/**
 * Check if error is retryable
 * @param {string} errorCategory - Error category
 * @returns {boolean} - Whether the error is retryable
 */
export function isRetryableError(errorCategory) {
  const hint = getRecoveryHint(errorCategory);
  return hint.autoRetry;
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
  
  if (criticalRiskActions.some(a => actionType?.includes(a))) {
    return RISK_ASSESSMENT.CRITICAL;
  }
  
  if (highRiskActions.some(a => actionType?.includes(a))) {
    return RISK_ASSESSMENT.HIGH;
  }
  
  // Check for bulk operations in payload
  if (payload?.bulk === true || payload?.batch === true || 
      (payload?.items && payload.items.length > 5)) {
    return RISK_ASSESSMENT.HIGH;
  }
  
  // Check for external recipients
  if (payload?.to && typeof payload.to === 'string') {
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
  
  // Medium risk: manual by default
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
 * Build audit payload
 * @param {object} params - Audit parameters
 * @returns {object} - Canonical audit payload
 */
export function buildAuditPayload({
  userEmail,
  userId = null,
  sessionId = null,
  actionType,
  actionDescription = '',
  inputSummary = {},
  outputSummary = null,
  previousState = null,
  newState = null,
  mutationType = 'execute',
  externalRefs = {},
  context = {},
  riskLevel = 'medium',
  approvalMode = 'conditional',
  approvalToken = null,
  timestamps = {}
}) {
  const now = new Date().toISOString();
  
  return {
    actor: {
      userEmail,
      userId,
      sessionId
    },
    timestamps: {
      requestedAt: timestamps.requestedAt || now,
      startedAt: timestamps.startedAt || null,
      completedAt: timestamps.completedAt || null,
      durationMs: timestamps.durationMs || null
    },
    changes: {
      actionType,
      actionDescription,
      inputSummary,
      outputSummary,
      previousState,
      newState,
      mutationType
    },
    externalRefs: {
      ...externalRefs
    },
    context: {
      ...context
    },
    compliance: {
      riskLevel,
      approvalMode,
      approvalToken,
      requiresPiiHandling: false,
      dataRetentionDays: 90
    }
  };
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
  timeoutMs = 30000,
  userEmail,
  actionDescription = ''
}) {
  const executionId = `${context.runId || 'exec'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = generateIdempotencyKey(context.runId || executionId, actionType, payload);
  
  // Build audit payload
  const auditPayload = buildAuditPayload({
    userEmail,
    actionType,
    actionDescription,
    inputSummary: payload,
    context,
    riskLevel: assessRiskLevel(actionType, payload),
    approvalMode: determineApprovalMode(actionType, payload, approvalMode)
  });
  
  // Build approval policy
  const effectiveApprovalMode = determineApprovalMode(actionType, payload, approvalMode);
  const approvalPolicy = {
    required: effectiveApprovalMode === APPROVAL_MODE.MANUAL,
    token: effectiveApprovalMode === APPROVAL_MODE.MANUAL ? null : undefined,
    expiresAt: effectiveApprovalMode === APPROVAL_MODE.MANUAL 
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() 
      : undefined,
    mode: effectiveApprovalMode
  };
  
  return {
    actionType,
    executionId,
    idempotencyKey,
    payload,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, ...retryPolicy },
    approvalPolicy,
    auditPayload,
    context,
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
  idempotencyKey,
  actionType,
  startedAt,
  auditPayload = null,
  nextRecommendedActions = [],
  fromCache = false
}) {
  const completedAt = new Date().toISOString();
  const durationMs = startedAt 
    ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
    : 0;
  
  const errorCategory = error ? categorizeError(error) : null;
  const recoveryHint = errorCategory ? getRecoveryHint(errorCategory) : null;
  
  // Update audit payload timestamps
  if (auditPayload) {
    auditPayload.timestamps.startedAt = startedAt;
    auditPayload.timestamps.completedAt = completedAt;
    auditPayload.timestamps.durationMs = durationMs;
    if (data) {
      auditPayload.changes.outputSummary = data;
    }
  }
  
  return {
    success,
    message,
    status: success ? 'completed' : (errorCategory === ERROR_CATEGORY.ALREADY_COMPLETED ? 'already_completed' : 'failed'),
    data,
    externalRefs,
    error: error ? {
      category: errorCategory,
      code: error.code,
      message: error.message,
      stack: error.stack,
      retryable: isRetryableError(errorCategory),
      recoveryHint
    } : null,
    metadata: {
      executionId,
      idempotencyKey,
      actionType,
      startedAt,
      completedAt,
      durationMs,
      attemptCount: error?.attemptCount || 1,
      fromCache
    },
    auditPayload,
    nextRecommendedActions
  };
}

/**
 * Build TodoExecutionItem
 * @param {object} params - Todo parameters
 * @returns {object} - Canonical TodoExecutionItem
 */
export function buildTodoExecutionItem({
  title,
  description = '',
  actionType,
  sortOrder,
  dependsOn = [],
  approvalMode = APPROVAL_MODE.CONDITIONAL,
  retryPolicy = DEFAULT_RETRY_POLICY,
  maxAttempts = 3,
  actionInput = null
}) {
  const todoId = `todo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  return {
    todoId,
    title,
    description,
    status: EXECUTION_STATUS.TODO_PENDING,
    actionType,
    sortOrder,
    dependsOn,
    approvalMode,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, ...retryPolicy },
    attemptCount: 0,
    maxAttempts,
    actionInput,
    actionResult: null,
    errorMessage: null,
    errorCategory: null,
    recoveryHint: null,
    createdAt: new Date().toISOString(),
    readyAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null
  };
}

/**
 * Build PlanArtifact
 * @param {object} params - Plan parameters
 * @returns {object} - Canonical PlanArtifact
 */
export function buildPlanArtifact({
  title,
  objective,
  complexity = 'simple',
  intent = null,
  canvasType = 'none',
  todos = [],
  assumptions = [],
  questionsAnswered = [],
  acceptanceCriteria = [],
  approvalMode = APPROVAL_MODE.CONDITIONAL,
  retryPolicy = DEFAULT_RETRY_POLICY,
  runId = null,
  createdBy = null
}) {
  const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  return {
    planId,
    title,
    objective,
    assumptions,
    questionsAnswered,
    acceptanceCriteria,
    status: EXECUTION_STATUS.PLAN_DRAFT,
    version: 1,
    locked: false,
    approvedAt: null,
    completedAt: null,
    complexity,
    intent,
    canvasType,
    todos,
    approvalMode,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, ...retryPolicy },
    createdAt: new Date().toISOString(),
    runId,
    createdBy
  };
}

/**
 * Build RunState
 * @param {object} params - Run parameters
 * @returns {object} - Canonical RunState
 */
export function buildRunState({
  userEmail,
  conversationId = null,
  missionId = null,
  planId = null,
  intent = null,
  complexity = 'simple',
  planSnapshot = []
}) {
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  
  return {
    runId,
    userEmail,
    conversationId,
    missionId,
    planId,
    status: EXECUTION_STATUS.RUN_INITIALIZING,
    phase: EXECUTION_STATUS.RUN_THINKING,
    intent,
    complexity,
    planSnapshot,
    memory: {
      lastMessage: null,
      evidenceByStep: {},
      approvalTokens: {},
      consumedApprovalTokens: {},
      executedActions: {},
      suggestions: [],
      idempotencyKeys: {},
      retryAttempts: {}
    },
    createdAt: now,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    error: null
  };
}

// ============================================================================
// ERROR HANDLING STRATEGIES
// ============================================================================

export const ERROR_HANDLING_STRATEGIES = {
  // Transient errors - can retry
  [ERROR_CATEGORY.NETWORK]: { retry: true, maxRetries: 3, backoff: 'exponential' },
  [ERROR_CATEGORY.TIMEOUT]: { retry: true, maxRetries: 3, backoff: 'exponential' },
  [ERROR_CATEGORY.RATE_LIMIT]: { retry: true, maxRetries: 5, backoff: 'exponential' },
  [ERROR_CATEGORY.SERVICE_UNAVAILABLE]: { retry: true, maxRetries: 3, backoff: 'fixed' },
  
  // Permanent errors - don't retry
  [ERROR_CATEGORY.AUTH_FAILED]: { retry: false, escalate: true },
  [ERROR_CATEGORY.PERMISSION_DENIED]: { retry: false, escalate: true },
  [ERROR_CATEGORY.INVALID_INPUT]: { retry: false, fail: true },
  [ERROR_CATEGORY.NOT_FOUND]: { retry: false, fail: true },
  [ERROR_CATEGORY.VALIDATION_FAILED]: { retry: false, fail: true },
  
  // Business logic errors
  [ERROR_CATEGORY.ALREADY_EXISTS]: { retry: false, skip: true, isSuccessEquivalent: true },
  [ERROR_CATEGORY.ALREADY_COMPLETED]: { retry: false, returnCached: true, isSuccessEquivalent: true },
  [ERROR_CATEGORY.CONFLICT]: { retry: false, fail: true },
  [ERROR_CATEGORY.PRECONDITION_FAILED]: { retry: false, fail: true },
  
  // System errors
  [ERROR_CATEGORY.INTERNAL_ERROR]: { retry: true, maxRetries: 2, backoff: 'fixed' },
  [ERROR_CATEGORY.UNKNOWN]: { retry: true, maxRetries: 2, backoff: 'exponential' }
};

// ============================================================================
// EXPORT DEFAULT
// ============================================================================

export default {
  EXECUTION_STATUS,
  LEGAL_RUN_TRANSITIONS,
  LEGAL_TODO_TRANSITIONS,
  LEGAL_PLAN_TRANSITIONS,
  VALID_STATUS_TRANSITIONS,
  APPROVAL_MODE,
  RISK_ASSESSMENT,
  RETRY_STRATEGY,
  DEFAULT_RETRY_POLICY,
  ERROR_CATEGORY,
  ERROR_RECOVERY_HINTS,
  ERROR_HANDLING_STRATEGIES,
  AuditPayloadSchema,
  PlanArtifactSchema,
  TodoExecutionItemSchema,
  ExecutionActionSchema,
  ExecutionResultSchema,
  RunStateSchema,
  isValidStatusTransition,
  getAllowedTransitions,
  categorizeError,
  getRecoveryHint,
  isRetryableError,
  calculateRetryDelay,
  assessRiskLevel,
  determineApprovalMode,
  generateIdempotencyKey,
  buildAuditPayload,
  buildActionInput,
  buildActionResult,
  buildTodoExecutionItem,
  buildPlanArtifact,
  buildRunState
};
