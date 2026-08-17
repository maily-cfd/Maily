/**
 * Boult Operator Runtime - Phase 1 Stabilized
 * 
 * Canonical execution runtime with:
 * - Strict run/step status transitions (FSM-enforced)
 * - Idempotency key management
 * - Retry policies with backoff
 * - Approval mode enforcement
 * - Auditable result payloads
 * - Comprehensive error categorization
 */

import crypto from 'crypto';
import {
  EXECUTION_STATUS,
  VALID_STATUS_TRANSITIONS,
  APPROVAL_MODE,
  RISK_ASSESSMENT,
  RETRY_STRATEGY,
  DEFAULT_RETRY_POLICY,
  ERROR_CATEGORY,
  isValidStatusTransition,
  categorizeError,
  isRetryableError,
  calculateRetryDelay,
  assessRiskLevel,
  determineApprovalMode,
  generateIdempotencyKey,
  buildActionInput,
  buildActionResult
} from './boult-execution-contract.js';

import {
  TASK_REGISTRY,
  validateActionInputs,
  CANVAS_ACTIONS_BY_TYPE,
  BOULT_DOMAINS,
  BOULT_ACTIONS
} from './boult-task-registry';

const uuid = () => crypto.randomUUID();

// ============================================================================
// STEP KIND MAPPING
// ============================================================================

const STEP_KIND_MAP = {
  think: 'think',
  search: 'search',
  read: 'read',
  analyze: 'analyze',
  draft: 'draft',
  execute: 'execute'
};

// ============================================================================
// STRICT STATUS TRANSITIONS (FSM)
// ============================================================================

const LEGAL_STEP_TRANSITIONS = {
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

const LEGAL_RUN_TRANSITIONS = {
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
    EXECUTION_STATUS.RUN_COMPLETED,
    EXECUTION_STATUS.RUN_FAILED,
    EXECUTION_STATUS.RUN_CANCELLED
  ],
  [EXECUTION_STATUS.RUN_COMPLETED]: [],
  [EXECUTION_STATUS.RUN_FAILED]: [],
  [EXECUTION_STATUS.RUN_CANCELLED]: []
};

const VALID_PHASES = new Set([
  EXECUTION_STATUS.RUN_THINKING,
  EXECUTION_STATUS.RUN_SEARCHING,
  EXECUTION_STATUS.RUN_SYNTHESIZING,
  EXECUTION_STATUS.RUN_APPROVAL,
  EXECUTION_STATUS.RUN_EXECUTING,
  EXECUTION_STATUS.RUN_COMPLETED,
  EXECUTION_STATUS.RUN_FAILED,
  EXECUTION_STATUS.RUN_CANCELLED
]);

// ============================================================================
// ERROR HANDLING
// ============================================================================

const ERROR_HANDLING_STRATEGIES = {
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
  [ERROR_CATEGORY.ALREADY_EXISTS]: { retry: false, skip: true },
  [ERROR_CATEGORY.CONFLICT]: { retry: false, fail: true },
  [ERROR_CATEGORY.PRECONDITION_FAILED]: { retry: false, fail: true },
  
  // System errors
  [ERROR_CATEGORY.INTERNAL_ERROR]: { retry: true, maxRetries: 2, backoff: 'fixed' },
  [ERROR_CATEGORY.UNKNOWN]: { retry: true, maxRetries: 2, backoff: 'exponential' }
};

// ============================================================================
// AUDIT LOGGING
// ============================================================================

class AuditLogger {
  constructor(db, userEmail) {
    this.db = db;
    this.userEmail = userEmail;
  }

  async log(event) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      userEmail: this.userEmail,
      ...event
    };
    
    // Store in database
    try {
      await this.db.appendAuditLog(this.userEmail, auditEntry);
    } catch (err) {
      console.error('Audit log failed:', err);
    }
    
    // Also console log for debugging
    console.log(`[AUDIT] ${event.type}:`, event.payload || {});
  }

  async logRunTransition(runId, fromStatus, toStatus, context = {}) {
    await this.log({
      type: 'run_transition',
      runId,
      payload: { fromStatus, toStatus, ...context }
    });
  }

  async logStepTransition(runId, stepId, fromStatus, toStatus, context = {}) {
    await this.log({
      type: 'step_transition',
      runId,
      stepId,
      payload: { fromStatus, toStatus, ...context }
    });
  }

  async logActionExecution(runId, actionType, executionId, result) {
    await this.log({
      type: 'action_execution',
      runId,
      actionType,
      executionId,
      payload: {
        success: result.success,
        status: result.status,
        durationMs: result.metadata?.durationMs,
        attemptCount: result.metadata?.attemptCount
      }
    });
  }

  async logError(runId, error, context = {}) {
    await this.log({
      type: 'error',
      runId,
      payload: {
        category: error.category || ERROR_CATEGORY.UNKNOWN,
        message: error.message,
        retryable: error.retryable,
        ...context
      }
    });
  }

  async logApproval(runId, actionType, approved, context = {}) {
    await this.log({
      type: 'approval',
      runId,
      actionType,
      payload: { approved, ...context }
    });
  }
}

// ============================================================================
// RETRY MANAGER
// ============================================================================

class RetryManager {
  constructor(db, userEmail) {
    this.db = db;
    this.userEmail = userEmail;
  }

  async executeWithRetry(actionFn, actionInput, options = {}) {
    const retryPolicy = { ...DEFAULT_RETRY_POLICY, ...actionInput.retryPolicy };
    const maxAttempts = options.maxAttempts || retryPolicy.maxAttempts;
    
    let lastError = null;
    let attempt = 0;
    
    while (attempt < maxAttempts) {
      attempt++;
      
      try {
        const startedAt = new Date().toISOString();
        const result = await actionFn();
        
        // Enhance result with attempt count
        if (result.metadata) {
          result.metadata.attemptCount = attempt;
        }
        
        return result;
      } catch (error) {
        lastError = error;
        const errorCategory = categorizeError(error);
        const handlingStrategy = ERROR_HANDLING_STRATEGIES[errorCategory];
        
        // Check if we should retry
        if (!handlingStrategy?.retry || attempt >= maxAttempts) {
          // Don't retry - build failure result
          return buildActionResult({
            success: false,
            message: error.message || 'Execution failed',
            error: {
              category: errorCategory,
              message: error.message,
              retryable: false,
              attemptCount: attempt
            },
            executionId: actionInput.executionId,
            startedAt: actionInput.createdAt
          });
        }
        
        // Calculate delay before retry
        const delay = calculateRetryDelay(attempt - 1, retryPolicy);
        
        console.log(`[Retry] Attempt ${attempt}/${maxAttempts} failed with ${errorCategory}. Retrying in ${delay}ms...`);
        
        await this.sleep(delay);
      }
    }
    
    // All retries exhausted
    return buildActionResult({
      success: false,
      message: lastError?.message || 'All retry attempts exhausted',
      error: {
        category: categorizeError(lastError),
        message: lastError?.message,
        retryable: false,
        attemptCount: attempt
      },
      executionId: actionInput.executionId,
      startedAt: actionInput.createdAt
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// IDEMPOTENCY MANAGER
// ============================================================================

class IdempotencyManager {
  constructor(db, userEmail) {
    this.db = db;
    this.userEmail = userEmail;
    this.localCache = new Map(); // In-memory cache for quick lookups
  }

  async checkAndExecute(actionInput, actionFn) {
    const { idempotencyKey, executionId } = actionInput;
    
    // Check local cache first
    if (this.localCache.has(idempotencyKey)) {
      const cached = this.localCache.get(idempotencyKey);
      console.log(`[Idempotency] Cache hit for ${executionId}`);
      return { result: cached, fromCache: true };
    }
    
    // Check database
    const existing = await this.db.getIdempotentResult(this.userEmail, idempotencyKey);
    if (existing) {
      console.log(`[Idempotency] Database hit for ${executionId}`);
      this.localCache.set(idempotencyKey, existing);
      return { result: existing, fromCache: true };
    }
    
    // Execute the action
    const startedAt = new Date().toISOString();
    const result = await actionFn();
    
    // Store result with idempotency key
    const resultWithKey = {
      ...result,
      metadata: {
        ...result.metadata,
        idempotencyKey,
        executionId,
        startedAt,
        completedAt: new Date().toISOString()
      }
    };
    
    // Save to database
    await this.db.storeIdempotentResult(this.userEmail, idempotencyKey, resultWithKey);
    
    // Update local cache
    this.localCache.set(idempotencyKey, resultWithKey);
    
    return { result: resultWithKey, fromCache: false };
  }

  async getResult(idempotencyKey) {
    // Check cache first
    if (this.localCache.has(idempotencyKey)) {
      return this.localCache.get(idempotencyKey);
    }
    
    // Check database
    return await this.db.getIdempotentResult(this.userEmail, idempotencyKey);
  }

  async invalidate(idempotencyKey) {
    this.localCache.delete(idempotencyKey);
    await this.db.deleteIdempotentResult(this.userEmail, idempotencyKey);
  }
}

// ============================================================================
// APPROVAL MANAGER
// ============================================================================

class ApprovalManager {
  constructor(db, userEmail) {
    this.db = db;
    this.userEmail = userEmail;
    this.tokens = new Map(); // In-memory token storage
  }

  generateApprovalToken(runId, actionType, context = {}) {
    const token = crypto
      .createHash('sha256')
      .update(`${runId}:${actionType}:${Date.now()}:${uuid()}`)
      .digest('hex')
      .slice(0, 32);
    
    const approvalRecord = {
      token,
      runId,
      actionType,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      context
    };
    
    this.tokens.set(`${runId}:${actionType}`, approvalRecord);
    
    return token;
  }

  async validateApprovalToken(runId, actionType, approvalToken) {
    const key = `${runId}:${actionType}`;
    const record = this.tokens.get(key);
    
    if (!record) {
      return { ok: false, reason: 'approval_not_required_or_missing' };
    }
    
    if (record.status === 'consumed') {
      return { ok: false, reason: 'approval_token_already_used' };
    }
    
    if (record.status === 'expired') {
      return { ok: false, reason: 'approval_token_expired' };
    }
    
    if (!approvalToken || approvalToken !== record.token) {
      return { ok: false, reason: 'invalid_approval_token' };
    }
    
    // Check expiration
    if (new Date() > new Date(record.expiresAt)) {
      record.status = 'expired';
      return { ok: false, reason: 'approval_token_expired' };
    }
    
    return { ok: true, record };
  }

  async consumeApprovalToken(runId, actionType, approvalToken) {
    const key = `${runId}:${actionType}`;
    const record = this.tokens.get(key);
    
    if (record && record.token === approvalToken) {
      record.status = 'consumed';
      record.consumedAt = new Date().toISOString();
    }
  }

  async revokeApprovalToken(runId, actionType) {
    const key = `${runId}:${actionType}`;
    const record = this.tokens.get(key);
    
    if (record) {
      record.status = 'revoked';
      record.revokedAt = new Date().toISOString();
    }
  }

  requiresApproval(actionType, payload = {}, configuredMode = APPROVAL_MODE.CONDITIONAL) {
    return determineApprovalMode(actionType, payload, configuredMode) === APPROVAL_MODE.MANUAL;
  }
}

// ============================================================================
// MAIN OPERATOR RUNTIME CLASS
// ============================================================================

export class BoultOperatorRuntime {
  constructor({ db, boultAI, userEmail, userName = 'User', conversationId, missionId = null }) {
    this.db = db;
    this.boultAI = boultAI;
    this.userEmail = userEmail || null;
    this.userName = userName;
    this.conversationId = conversationId || null;
    this.missionId = missionId || null;
    
    // Initialize managers
    this.auditLogger = new AuditLogger(db, userEmail);
    this.retryManager = new RetryManager(db, userEmail);
    this.idempotencyManager = new IdempotencyManager(db, userEmail);
    this.approvalManager = new ApprovalManager(db, userEmail);
  }

  generateRunId() {
    return `run_${Date.now()}_${uuid().slice(0, 8)}`;
  }

  inferIntentFromMessage(message = '') {
    const lower = String(message).toLowerCase();
    if (/(reply|draft|respond|send email)/.test(lower)) return 'reply';
    if (/(summarize|summary|catch up|digest)/.test(lower)) return 'summarize';
    if (/(organize|label|archive|cleanup)/.test(lower)) return 'organize';
    if (/(search|find|lookup|look up)/.test(lower)) return 'search';
    if (/(workflow|multi step|steps|plan)/.test(lower)) return 'multi_step';
    if (/(email|gmail|inbox|thread)/.test(lower)) return 'read';
    return 'general';
  }

  inferComplexity(message = '', plan = []) {
    if ((plan || []).length >= 4) return 'complex';
    const lower = String(message).toLowerCase();
    if (/(workflow|multi|several|analyze|research|summarize all|every)/.test(lower)) return 'complex';
    return 'simple';
  }

  needsApproval(intent, canvasType, actionType = null) {
    if (actionType && TASK_REGISTRY[actionType]) {
      return TASK_REGISTRY[actionType].mutating;
    }
    if (intent === 'reply' || intent === 'multi_step') return true;
    if (canvasType === 'email_draft' || canvasType === 'action_plan' || canvasType === 'meeting_schedule') return true;
    return false;
  }

  normalizePlan(plan, message = '') {
    const source = Array.isArray(plan) && plan.length > 0 ? plan : this.buildFallbackPlan(message);
    return source.map((step, index) => {
      const kind = STEP_KIND_MAP[(step.type || step.kind || 'think')] || 'think';
      return {
        id: `step_${uuid().slice(0, 8)}`,
        order: index + 1,
        kind,
        status: index === 0 ? EXECUTION_STATUS.TODO_RUNNING : EXECUTION_STATUS.TODO_PENDING,
        label: step.label || step.description || step.action || `Step ${index + 1}`,
        detail: step.detail || '',
        // Add Phase 1 fields
        retryPolicy: { ...DEFAULT_RETRY_POLICY, ...(step.retryPolicy || {}) },
        approvalMode: step.approvalMode || APPROVAL_MODE.CONDITIONAL,
        attemptCount: 0,
        maxAttempts: step.maxAttempts || 3,
        dependsOn: step.dependsOn || [],
        createdAt: new Date().toISOString()
      };
    });
  }

  buildFallbackPlan(message = '') {
    const lower = String(message).toLowerCase();
    const emailFocused = /(email|gmail|inbox|reply|draft|thread)/.test(lower);
    return [
      {
        kind: 'analyze',
        label: 'Understanding your request',
        detail: 'Intent detection and task classification',
        approvalMode: APPROVAL_MODE.AUTO,
        retryPolicy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 }
      },
      {
        kind: emailFocused ? 'search' : 'read',
        label: emailFocused ? 'Searching relevant Gmail context' : 'Gathering relevant context',
        detail: emailFocused ? 'Finding relevant threads and messages' : 'Collecting required inputs',
        approvalMode: APPROVAL_MODE.AUTO,
        retryPolicy: DEFAULT_RETRY_POLICY
      },
      {
        kind: 'draft',
        label: 'Preparing output for review',
        detail: 'Drafting actionable result in canvas',
        approvalMode: APPROVAL_MODE.CONDITIONAL,
        retryPolicy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 }
      }
    ];
  }

  buildExecutionPolicy(canvasType = 'none', requiresApproval = false, runId = '', canvasData = null) {
    const actionTypes = CANVAS_ACTIONS_BY_TYPE[canvasType] || [];
    const actions = actionTypes.map((actionType) => {
      const spec = TASK_REGISTRY[actionType];
      const validation = canvasData?.actionPayload 
        ? validateActionInputs(actionType, canvasData.actionPayload) 
        : { valid: true, missing: [] };

      // Determine approval mode based on risk
      const payload = canvasData?.actionPayload || {};
      const approvalMode = determineApprovalMode(actionType, payload, spec?.approvalMode);
      const riskLevel = assessRiskLevel(actionType, payload);

      return {
        actionType,
        label: spec?.label || actionType,
        requiresApproval: approvalMode === APPROVAL_MODE.MANUAL || requiresApproval || spec?.mutating || false,
        approvalMode,
        riskLevel,
        isValid: validation.valid,
        missingInputs: validation.missing,
        retryPolicy: { ...DEFAULT_RETRY_POLICY, ...(spec?.retryPolicy || {}) }
      };
    });

    const approvalTokens = {};
    actions.forEach((action) => {
      if (action.requiresApproval) {
        approvalTokens[action.actionType] = this.approvalManager.generateApprovalToken(
          runId, 
          action.actionType,
          { riskLevel: action.riskLevel }
        );
      }
    });

    return {
      actions,
      requiresApproval: actions.some(a => a.requiresApproval),
      approvalTokens,
      isReady: actions.every(a => a.isValid || a.actionType === 'revise' || a.actionType === 'cancel'),
      globalRetryPolicy: DEFAULT_RETRY_POLICY
    };
  }

  async initializeRun({ message, intentAnalysis = null, canvasType = 'none', runId: providedRunId = null, planArtifact = null }) {
    const runId = providedRunId || this.generateRunId();
    const intent = intentAnalysis?.intent || this.inferIntentFromMessage(message);
    const complexity = intentAnalysis?.complexity || this.inferComplexity(message, intentAnalysis?.plan || []);
    const plan = this.normalizePlan(intentAnalysis?.plan || [], message);
    const requiresApproval = this.needsApproval(intent, canvasType || intentAnalysis?.canvasType || 'none');

    const run = {
      runId,
      userEmail: this.userEmail,
      conversationId: this.conversationId,
      missionId: this.missionId,
      status: EXECUTION_STATUS.RUN_INITIALIZING,
      phase: EXECUTION_STATUS.RUN_THINKING,
      intent,
      complexity,
      planSnapshot: plan,
      planId: planArtifact?.planId || null,
      memory: {
        lastMessage: message,
        evidenceByStep: {},
        approvalTokens: {},
        consumedApprovalTokens: {},
        executedActions: {},
        suggestions: [],
        idempotencyKeys: {},
        retryAttempts: {}
      }
    };

    await this.db.createOperatorRun(this.userEmail, run);

    for (const step of plan) {
      await this.db.upsertOperatorRunStep(this.userEmail, runId, step);
    }

    await this.auditLogger.logRunTransition(runId, null, EXECUTION_STATUS.RUN_INITIALIZING, {
      intent,
      complexity,
      planCount: plan.length,
      hasPlanArtifact: !!planArtifact
    });

    // Transition to thinking phase
    await this.transitionRun(runId, EXECUTION_STATUS.RUN_THINKING, {
      reason: 'run_initialized'
    });

    return { run, plan, requiresApproval, planArtifact };
  }

  async transitionRun(runId, toStatus, context = {}) {
    if (!runId) return { ok: false, reason: 'missing_run_id' };

    const run = await this.db.getOperatorRunById(this.userEmail, runId);
    if (!run) return { ok: false, reason: 'run_not_found' };

    const fromStatus = run.status;
    
    // Validate transition
    if (!isValidStatusTransition(fromStatus, toStatus)) {
      const allowed = LEGAL_RUN_TRANSITIONS[fromStatus] || [];
      await this.auditLogger.logRunTransition(runId, fromStatus, toStatus, {
        ...context,
        rejected: true,
        reason: 'invalid_transition',
        allowedTransitions: allowed
      });
      return { ok: false, reason: 'invalid_transition', allowedTransitions: allowed };
    }

    // Update run status
    const update = { status: toStatus };
    if (VALID_PHASES.has(toStatus)) {
      update.phase = toStatus;
    }

    await this.db.updateOperatorRun(this.userEmail, runId, update);

    await this.auditLogger.logRunTransition(runId, fromStatus, toStatus, context);

    return { ok: true, run: { ...run, ...update } };
  }

  async transitionStep({ runId, stepId, status, phase = null, evidence = null, detail = null, error = null }) {
    if (!runId || !stepId) return { ok: false, reason: 'missing_parameters' };

    const step = await this.db.getOperatorRunStepById(this.userEmail, runId, stepId);
    if (!step) return { ok: false, reason: 'step_not_found' };

    const currentStatus = step.status || EXECUTION_STATUS.TODO_PENDING;
    const nextStatus = status || EXECUTION_STATUS.TODO_PENDING;

    // Validate transition
    if (!isValidStatusTransition(currentStatus, nextStatus)) {
      const allowed = LEGAL_STEP_TRANSITIONS[currentStatus] || [];
      await this.auditLogger.logStepTransition(runId, stepId, currentStatus, nextStatus, {
        rejected: true,
        reason: 'invalid_transition',
        allowedTransitions: allowed
      });
      return { ok: false, reason: 'invalid_transition', allowedTransitions: allowed };
    }

    // Build update
    const update = { 
      status: nextStatus,
      detail: detail || step.detail
    };

    // Update timestamps based on status
    const now = new Date().toISOString();
    if (nextStatus === EXECUTION_STATUS.TODO_RUNNING && !step.startedAt) {
      update.startedAt = now;
      update.attemptCount = (step.attemptCount || 0) + 1;
    }
    if (nextStatus === EXECUTION_STATUS.TODO_COMPLETED) {
      update.completedAt = now;
    }
    if (nextStatus === EXECUTION_STATUS.TODO_FAILED) {
      update.failedAt = now;
      if (error) {
        update.errorMessage = error.message;
        update.errorCategory = error.category || categorizeError(error);
      }
    }
    if (evidence) {
      update.evidence = evidence;
    }

    await this.db.updateOperatorRunStep(this.userEmail, runId, stepId, update);

    const nextPhase = VALID_PHASES.has(phase || '') 
      ? phase 
      : (nextStatus === EXECUTION_STATUS.TODO_RUNNING ? EXECUTION_STATUS.RUN_EXECUTING : run.phase);
    
    await this.db.updateOperatorRun(this.userEmail, runId, { phase: nextPhase });

    await this.auditLogger.logStepTransition(runId, stepId, currentStatus, nextStatus, {
      detail,
      hasEvidence: !!evidence,
      error: error ? { category: error.category, message: error.message } : null
    });

    return { ok: true, step: { ...step, ...update } };
  }

  async executeAction(actionInput, actionFn) {
    const { actionType, executionId, idempotencyKey, context } = actionInput;
    const runId = context?.runId;

    // Check idempotency
    const idempotentCheck = await this.idempotencyManager.getResult(idempotencyKey);
    if (idempotentCheck) {
      console.log(`[Idempotency] Returning cached result for ${executionId}`);
      return idempotentCheck;
    }

    // Execute with idempotency tracking
    const { result, fromCache } = await this.idempotencyManager.checkAndExecute(
      actionInput,
      async () => {
        // Execute with retry logic
        return await this.retryManager.executeWithRetry(
          actionFn,
          actionInput
        );
      }
    );

    // Audit log
    await this.auditLogger.logActionExecution(runId, actionType, executionId, result);

    return result;
  }

  async updateRunState(runId, patch = {}) {
    if (!runId) return;
    await this.db.updateOperatorRun(this.userEmail, runId, patch);
  }

  async saveExecutionPolicy(runId, executionPolicy = {}) {
    const run = await this.db.getOperatorRunById(this.userEmail, runId);
    if (!run) return;

    const memory = run.memory || {};
    memory.approvalTokens = {
      ...(memory.approvalTokens || {}),
      ...(executionPolicy.approvalTokens || {})
    };
    memory.executionPolicy = executionPolicy;

    await this.db.updateOperatorRun(this.userEmail, runId, { memory });
  }

  async validateApprovalToken(runId, actionType, approvalToken) {
    return await this.approvalManager.validateApprovalToken(runId, actionType, approvalToken);
  }

  async consumeApprovalToken(runId, actionType, approvalToken) {
    await this.approvalManager.consumeApprovalToken(runId, actionType, approvalToken);
    
    // Update run memory
    const run = await this.db.getOperatorRunById(this.userEmail, runId);
    if (run) {
      const memory = run.memory || {};
      memory.consumedApprovalTokens = {
        ...(memory.consumedApprovalTokens || {}),
        [actionType]: approvalToken
      };
      await this.db.updateOperatorRun(this.userEmail, runId, { memory });
    }

    await this.auditLogger.logApproval(runId, actionType, true, { tokenConsumed: true });
  }

  async checkAndStoreIdempotentResult(runId, actionRequestId, executionResult) {
    await this.idempotencyManager.db.storeIdempotentResult(
      this.userEmail, 
      actionRequestId, 
      executionResult
    );
    
    // Update run memory
    const run = await this.db.getOperatorRunById(this.userEmail, runId);
    if (run) {
      const memory = run.memory || {};
      const executed = memory.executedActions || {};
      executed[actionRequestId] = executionResult;
      memory.executedActions = executed;
      await this.db.updateOperatorRun(this.userEmail, runId, { memory });
    }
  }

  async getIdempotentResult(runId, actionRequestId) {
    return await this.idempotencyManager.getResult(actionRequestId);
  }

  async enqueueJob(runId, jobType, payload, options = {}) {
    const job = {
      runId,
      jobType,
      payload,
      status: 'queued',
      maxAttempts: options.maxAttempts || 3,
      availableAt: options.availableAt || new Date().toISOString(),
      leaseSeconds: options.leaseSeconds || 45,
      retryPolicy: { ...DEFAULT_RETRY_POLICY, ...(options.retryPolicy || {}) },
      createdAt: new Date().toISOString()
    };
    
    return this.db.createOperatorJob(this.userEmail, job);
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  async failRun(runId, error, context = {}) {
    const errorCategory = categorizeError(error);
    
    await this.transitionRun(runId, EXECUTION_STATUS.RUN_FAILED, {
      ...context,
      error: {
        category: errorCategory,
        message: error.message,
        stack: error.stack
      }
    });

    await this.auditLogger.logError(runId, {
      category: errorCategory,
      message: error.message,
      stack: error.stack
    }, context);

    return { ok: false, runId, error: { category: errorCategory, message: error.message } };
  }

  async completeRun(runId, result = {}, context = {}) {
    await this.transitionRun(runId, EXECUTION_STATUS.RUN_COMPLETED, {
      ...context,
      result
    });

    return { ok: true, runId, result };
  }

  async getRunStatus(runId) {
    const run = await this.db.getOperatorRunById(this.userEmail, runId);
    if (!run) return null;

    const steps = await this.db.getOperatorRunSteps(this.userEmail, runId);
    
    return {
      runId,
      status: run.status,
      phase: run.phase,
      intent: run.intent,
      complexity: run.complexity,
      steps: steps.map(s => ({
        stepId: s.id,
        status: s.status,
        kind: s.kind,
        label: s.label,
        attemptCount: s.attemptCount || 0,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        failedAt: s.failedAt
      })),
      progress: this.calculateProgress(steps),
      memory: run.memory
    };
  }

  calculateProgress(steps) {
    if (!steps || steps.length === 0) return { completed: 0, total: 0, percentage: 0 };
    
    const completed = steps.filter(s => 
      s.status === EXECUTION_STATUS.TODO_COMPLETED || 
      s.status === EXECUTION_STATUS.TODO_SKIPPED
    ).length;
    
    const failed = steps.filter(s => 
      s.status === EXECUTION_STATUS.TODO_FAILED
    ).length;
    
    return {
      completed,
      failed,
      total: steps.length,
      percentage: Math.round((completed / steps.length) * 100),
      isComplete: completed + failed === steps.length
    };
  }
}

// ============================================================================
// EXPORT ADDITIONAL CLASSES
// ============================================================================

export { AuditLogger, RetryManager, IdempotencyManager, ApprovalManager };
export default BoultOperatorRuntime;
