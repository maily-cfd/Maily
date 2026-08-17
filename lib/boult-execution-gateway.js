/**
 * Boult Unified Execution Gateway - Phase 1
 * 
 * Single entry point for ALL action execution.
 * Routes every action through the operator runtime with:
 * - Strict lifecycle validation
 * - Idempotency enforcement
 * - Retry handling with recovery hints
 * - Audit trail generation
 * - Error categorization
 * 
 * No direct side-effect actions can bypass this runtime.
 */

import {
  EXECUTION_STATUS,
  ERROR_CATEGORY,
  ERROR_HANDLING_STRATEGIES,
  ERROR_RECOVERY_HINTS,
  isValidStatusTransition,
  buildTodoExecutionItem,
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
  buildPlanArtifact,
  buildRunState
} from './boult-execution-contract-v2.js';

import {
  TASK_REGISTRY,
  validateActionInputs,
  CANVAS_ACTIONS_BY_TYPE,
  BOULT_DOMAINS,
  BOULT_ACTIONS
} from './boult-task-registry.js';

import crypto from 'crypto';

const uuid = () => crypto.randomUUID();

// ============================================================================
// EXECUTION GATEWAY CLASS
// ============================================================================

export class BoultExecutionGateway {
  constructor({ db, boultAI, userEmail, userName = 'User', conversationId = null, missionId = null }) {
    this.db = db;
    this.boultAI = boultAI;
    this.userEmail = userEmail;
    this.userName = userName;
    this.conversationId = conversationId;
    this.missionId = missionId;
    
    // In-memory caches for performance
    this.idempotencyCache = new Map();
    this.approvalTokens = new Map();
    
    // Active runs tracking
    this.activeRuns = new Map();
  }

  // ============================================================================
  // CORE EXECUTION METHOD - ALL ACTIONS GO THROUGH HERE
  // ============================================================================

  /**
   * Execute an action through the canonical runtime contract
   * This is THE ONLY way to execute actions - no bypass allowed
   * 
   * @param {object} actionRequest - The action request
   * @param {Function} actionFn - The actual action implementation
   * @returns {ExecutionResult} - Canonical execution result
   */
  async execute(actionRequest, actionFn) {
    const {
      actionType,
      payload,
      runId,
      approvalToken,
      context = {},
      retryPolicy,
      approvalMode,
      skipIdempotency = false
    } = actionRequest;

    const executionContext = {
      ...context,
      runId,
      userEmail: this.userEmail,
      conversationId: this.conversationId,
      missionId: this.missionId
    };

    // Step 1: Validate action exists in registry
    const actionSpec = TASK_REGISTRY[actionType];
    if (!actionSpec) {
      return this._buildErrorResult(
        actionType,
        payload,
        runId,
        new Error(`Unknown action type: ${actionType}`),
        ERROR_CATEGORY.VALIDATION_FAILED
      );
    }

    // Step 2: Validate action inputs
    const inputValidation = validateActionInputs(actionType, payload);
    if (!inputValidation.valid) {
      return this._buildErrorResult(
        actionType,
        payload,
        runId,
        new Error(`Missing required inputs: ${inputValidation.missing.join(', ')}`),
        ERROR_CATEGORY.VALIDATION_FAILED
      );
    }

    // Step 3: Build canonical action input
    const actionInput = buildActionInput({
      actionType,
      payload,
      context: executionContext,
      retryPolicy: retryPolicy || actionSpec.retryPolicy,
      approvalMode: approvalMode || actionSpec.approvalMode,
      userEmail: this.userEmail,
      actionDescription: actionSpec.description || actionType
    });

    // Step 4: Check idempotency (unless explicitly skipped)
    if (!skipIdempotency) {
      const idempotentCheck = await this._checkIdempotency(actionInput.idempotencyKey);
      if (idempotentCheck) {
        console.log(`[ExecutionGateway] Idempotency hit for ${actionInput.executionId}`);
        
        // Return cached result with already_completed status
        const cachedResult = {
          ...idempotentCheck,
          status: 'already_completed',
          message: 'Already completed (no duplicate mutation)',
          metadata: {
            ...idempotentCheck.metadata,
            fromCache: true,
            executionId: actionInput.executionId
          }
        };
        
        // Audit log the idempotent return
        await this._auditLog('idempotent_return', {
          actionType,
          executionId: actionInput.executionId,
          originalExecutionId: idempotentCheck.metadata?.executionId,
          idempotencyKey: actionInput.idempotencyKey
        });
        
        return cachedResult;
      }
    }

    // Step 5: Check approval requirements
    if (actionInput.approvalPolicy.required) {
      const approvalCheck = await this._validateApproval(actionInput, approvalToken);
      if (!approvalCheck.ok) {
        return this._buildBlockedResult(actionInput, approvalCheck.reason);
      }
    }

    // Step 6: Execute with retry logic
    const executionResult = await this._executeWithRetry(
      actionInput,
      actionFn,
      actionSpec
    );

    // Step 7: Store idempotency result
    if (!skipIdempotency && executionResult.success) {
      await this._storeIdempotencyResult(actionInput.idempotencyKey, executionResult);
    }

    // Step 8: Update run state if runId provided
    if (runId) {
      await this._updateRunState(runId, executionResult, actionInput);
    }

    // Step 9: Audit log the execution
    await this._auditLog('action_executed', {
      actionType,
      executionId: actionInput.executionId,
      success: executionResult.success,
      durationMs: executionResult.metadata?.durationMs,
      errorCategory: executionResult.error?.category
    });

    return executionResult;
  }

  /**
   * Execute a plan artifact - routes all todos through the runtime
   * @param {PlanArtifact} planArtifact - The plan to execute
   * @param {object} executionContext - Execution context
   * @returns {object} - Plan execution result
   */
  async executePlan(planArtifact, executionContext = {}) {
    const { planId, todos } = planArtifact;
    const runId = executionContext.runId || `run_${Date.now()}_${uuid().slice(0, 8)}`;
    
    console.log(`[ExecutionGateway] Executing plan ${planId} with ${todos.length} todos`);

    // Create or get run state
    let runState = this.activeRuns.get(runId);
    if (!runState) {
      runState = buildRunState({
        userEmail: this.userEmail,
        conversationId: this.conversationId,
        missionId: this.missionId,
        planId,
        intent: planArtifact.intent,
        complexity: planArtifact.complexity,
        planSnapshot: todos
      });
      this.activeRuns.set(runId, runState);
      
      // Persist to database
      await this.db.createOperatorRun(this.userEmail, runState);
    }

    // Transition to executing phase
    await this._transitionRunPhase(runId, EXECUTION_STATUS.RUN_EXECUTING);

    const results = [];
    const completedTodos = [];
    const failedTodos = [];

    // Execute todos in order, respecting dependencies
    for (const todo of todos) {
      // Check if dependencies are satisfied
      const depsSatisfied = todo.dependsOn.every(depId => 
        completedTodos.some(ct => ct.todoId === depId)
      );

      if (!depsSatisfied) {
        console.log(`[ExecutionGateway] Skipping todo ${todo.todoId} - dependencies not satisfied`);
        todo.status = EXECUTION_STATUS.TODO_SKIPPED;
        todo.errorMessage = 'Dependencies not satisfied';
        continue;
      }

      // Skip if already completed
      if (todo.status === EXECUTION_STATUS.TODO_COMPLETED) {
        completedTodos.push(todo);
        continue;
      }

      // Transition to running
      todo.status = EXECUTION_STATUS.TODO_RUNNING;
      todo.startedAt = new Date().toISOString();
      todo.attemptCount++;

      await this._auditLog('todo_started', {
        planId,
        todoId: todo.todoId,
        actionType: todo.actionType,
        attemptCount: todo.attemptCount
      });

      // Build action function from task registry
      const actionFn = await this._resolveActionFunction(todo.actionType);

      // Execute through gateway
      const actionRequest = {
        actionType: todo.actionType,
        payload: todo.actionInput?.payload || {},
        runId,
        context: {
          planId,
          todoId: todo.todoId,
          ...executionContext
        },
        retryPolicy: todo.retryPolicy
      };

      const result = await this.execute(actionRequest, actionFn);

      // Update todo state
      if (result.success || result.status === 'already_completed') {
        todo.status = EXECUTION_STATUS.TODO_COMPLETED;
        todo.completedAt = new Date().toISOString();
        todo.actionResult = result;
        completedTodos.push(todo);
      } else {
        todo.status = EXECUTION_STATUS.TODO_FAILED;
        todo.failedAt = new Date().toISOString();
        todo.errorMessage = result.error?.message || 'Execution failed';
        todo.errorCategory = result.error?.category || ERROR_CATEGORY.UNKNOWN;
        todo.recoveryHint = result.error?.recoveryHint;
        failedTodos.push(todo);
      }

      results.push({
        todoId: todo.todoId,
        actionType: todo.actionType,
        success: result.success || result.status === 'already_completed',
        result
      });

      // Persist todo state
      await this.db.upsertOperatorRunStep(this.userEmail, runId, todo);
    }

    // Determine plan completion status
    const allCompleted = todos.every(t => 
      t.status === EXECUTION_STATUS.TODO_COMPLETED || 
      t.status === EXECUTION_STATUS.TODO_SKIPPED
    );
    const hasFailures = failedTodos.length > 0;

    let finalStatus;
    let finalPhase;
    if (allCompleted && !hasFailures) {
      finalStatus = EXECUTION_STATUS.PLAN_COMPLETED;
      finalPhase = EXECUTION_STATUS.RUN_COMPLETED;
    } else if (hasFailures) {
      finalStatus = EXECUTION_STATUS.PLAN_FAILED;
      finalPhase = EXECUTION_STATUS.RUN_FAILED;
    } else {
      finalStatus = EXECUTION_STATUS.PLAN_EXECUTING;
      finalPhase = EXECUTION_STATUS.RUN_EXECUTING;
    }

    // Update plan artifact status
    planArtifact.status = finalStatus;
    if (finalStatus === EXECUTION_STATUS.PLAN_COMPLETED) {
      planArtifact.completedAt = new Date().toISOString();
    }

    // Transition run to final phase
    await this._transitionRunPhase(runId, finalPhase);

    // Persist final state
    await this.db.updateOperatorRun(this.userEmail, runId, {
      status: finalPhase,
      phase: finalPhase,
      'memory.completedTodos': completedTodos.map(t => t.todoId),
      'memory.failedTodos': failedTodos.map(t => t.todoId)
    });

    await this._auditLog('plan_execution_completed', {
      planId,
      runId,
      finalStatus,
      completedCount: completedTodos.length,
      failedCount: failedTodos.length
    });

    return {
      planId,
      runId,
      status: finalStatus,
      phase: finalPhase,
      results,
      completedTodos: completedTodos.length,
      failedTodos: failedTodos.length,
      todos
    };
  }

  // ============================================================================
  // CANVAS ACTION EXECUTION
  // ============================================================================

  /**
   * Execute a canvas action - routes through operator runtime
   * @param {string} actionType - Canvas action type
   * @param {object} payload - Action payload
   * @param {string} runId - Run ID
   * @param {string} approvalToken - Approval token (if required)
   * @returns {ExecutionResult} - Canonical execution result
   */
  async executeCanvasAction(actionType, payload, runId, approvalToken = null) {
    console.log(`[ExecutionGateway] Executing canvas action: ${actionType}`);

    // Validate it's a valid canvas action
    const validActions = Object.values(CANVAS_ACTIONS_BY_TYPE).flat();
    if (!validActions.includes(actionType)) {
      return this._buildErrorResult(
        actionType,
        payload,
        runId,
        new Error(`Invalid canvas action: ${actionType}`),
        ERROR_CATEGORY.VALIDATION_FAILED
      );
    }

    // Special case: Plan Execution (Multi-step)
    if (actionType === 'execute_plan') {
      console.log(`[ExecutionGateway] Directing ${actionType} to Plan Execution Engine`);
      return await this.executePlan(payload, { runId });
    }

    // Get action implementation
    const actionFn = await this._resolveCanvasActionFunction(actionType);

    // Execute through canonical gateway
    return await this.execute({
      actionType,
      payload,
      runId,
      approvalToken,
      context: {
        source: 'canvas',
        canvasType: this._inferCanvasType(actionType)
      }
    }, actionFn);
  }

  // ============================================================================
  // RUN LIFECYCLE MANAGEMENT
  // ============================================================================

  /**
   * Initialize a new run with strict lifecycle
   * @param {object} params - Initialization parameters
   * @returns {RunState} - Initialized run state
   */
  async initializeRun({ message, intent, complexity = 'simple', planArtifact = null }) {
    const runState = buildRunState({
      userEmail: this.userEmail,
      conversationId: this.conversationId,
      missionId: this.missionId,
      planId: planArtifact?.planId,
      intent,
      complexity,
      planSnapshot: planArtifact?.todos || []
    });

    // Store in memory
    this.activeRuns.set(runState.runId, runState);

    // Persist to database
    await this.db.createOperatorRun(this.userEmail, runState);

    // Transition to thinking phase
    await this._transitionRunPhase(runState.runId, EXECUTION_STATUS.RUN_THINKING, {
      reason: 'run_initialized',
      message: message?.substring(0, 100)
    });

    await this._auditLog('run_initialized', {
      runId: runState.runId,
      intent,
      complexity,
      hasPlanArtifact: !!planArtifact
    });

    return runState;
  }

  /**
   * Transition run to next phase with strict FSM validation
   * @param {string} runId - Run ID
   * @param {string} toPhase - Target phase
   * @param {object} context - Transition context
   */
  async _transitionRunPhase(runId, toPhase, context = {}) {
    const runState = this.activeRuns.get(runId);
    if (!runState) {
      throw new Error(`Run not found: ${runId}`);
    }

    const fromPhase = runState.phase;

    // Validate transition
    if (!isValidStatusTransition(fromPhase, toPhase)) {
      const error = new Error(
        `Invalid run transition: ${fromPhase} -> ${toPhase}. ` +
        `Allowed: ${Object.keys(EXECUTION_STATUS).filter(k => 
          isValidStatusTransition(fromPhase, EXECUTION_STATUS[k])
        ).join(', ')}`
      );
      
      await this._auditLog('invalid_run_transition', {
        runId,
        fromPhase,
        toPhase,
        context
      });
      
      throw error;
    }

    // Apply transition
    runState.phase = toPhase;
    runState.status = toPhase;
    
    if (toPhase === EXECUTION_STATUS.RUN_EXECUTING && !runState.startedAt) {
      runState.startedAt = new Date().toISOString();
    }

    if (toPhase === EXECUTION_STATUS.RUN_COMPLETED) {
      runState.completedAt = new Date().toISOString();
    }

    if (toPhase === EXECUTION_STATUS.RUN_FAILED) {
      runState.failedAt = new Date().toISOString();
    }

    // Persist to database
    await this.db.updateOperatorRun(this.userEmail, runId, {
      phase: toPhase,
      status: toPhase,
      startedAt: runState.startedAt,
      completedAt: runState.completedAt,
      failedAt: runState.failedAt
    });

    await this._auditLog('run_transition', {
      runId,
      fromPhase,
      toPhase,
      context
    });

    return runState;
  }

  /**
   * Get run status with full details
   * @param {string} runId - Run ID
   * @returns {object} - Run status
   */
  async getRunStatus(runId) {
    const run = await this.db.getOperatorRunById(this.userEmail, runId);
    if (!run) return null;

    const steps = await this.db.getOperatorRunSteps(this.userEmail, runId);
    const events = await this.db.getOperatorRunEvents(this.userEmail, runId, 100);

    return {
      runId,
      status: run.status,
      phase: run.phase,
      intent: run.intent,
      complexity: run.complexity,
      progress: this._calculateProgress(steps),
      steps: steps || [],
      events: events || [],
      memory: run.memory || {}
    };
  }

  // ============================================================================
  // IDEMPOTENCY MANAGEMENT
  // ============================================================================

  async _checkIdempotency(idempotencyKey) {
    // Check memory cache first
    if (this.idempotencyCache.has(idempotencyKey)) {
      return this.idempotencyCache.get(idempotencyKey);
    }

    // Check database
    const dbResult = await this.db.getIdempotentResult(this.userEmail, idempotencyKey);
    if (dbResult) {
      // Cache for future
      this.idempotencyCache.set(idempotencyKey, dbResult);
      return dbResult;
    }

    return null;
  }

  async _storeIdempotencyResult(idempotencyKey, result) {
    // Store in memory cache
    this.idempotencyCache.set(idempotencyKey, result);

    // Persist to database
    await this.db.storeIdempotentResult(this.userEmail, idempotencyKey, {
      ...result,
      storedAt: new Date().toISOString()
    });
  }

  // ============================================================================
  // RETRY EXECUTION
  // ============================================================================

  async _executeWithRetry(actionInput, actionFn, actionSpec) {
    const { retryPolicy, actionType, executionId } = actionInput;
    const maxAttempts = retryPolicy.maxAttempts;
    
    let lastError = null;
    let attempt = 0;
    let startedAt = new Date().toISOString();

    while (attempt < maxAttempts) {
      attempt++;

      try {
        console.log(`[ExecutionGateway] Executing ${actionType} (attempt ${attempt}/${maxAttempts})`);
        
        // Execute the action
        const result = await actionFn(actionInput);
        
        // Build success result
        return buildActionResult({
          success: true,
          message: result.message || `${actionType} completed successfully`,
          data: result.data || result,
          externalRefs: result.externalRefs || {},
          executionId,
          idempotencyKey: actionInput.idempotencyKey,
          actionType,
          startedAt,
          auditPayload: actionInput.auditPayload,
          nextRecommendedActions: result.nextRecommendedActions || []
        });

      } catch (error) {
        lastError = error;
        const errorCategory = categorizeError(error);
        const handlingStrategy = ERROR_HANDLING_STRATEGIES[errorCategory];
        const recoveryHint = ERROR_RECOVERY_HINTS[errorCategory];

        console.log(`[ExecutionGateway] Attempt ${attempt} failed with ${errorCategory}: ${error.message}`);

        // Check if we should retry
        if (!handlingStrategy?.retry || attempt >= maxAttempts) {
          // Don't retry - build failure result
          return buildActionResult({
            success: false,
            message: recoveryHint?.userMessage || error.message || 'Execution failed',
            error: {
              category: errorCategory,
              code: error.code,
              message: error.message,
              stack: error.stack,
              retryable: false,
              attemptCount: attempt,
              recoveryHint
            },
            executionId,
            idempotencyKey: actionInput.idempotencyKey,
            actionType,
            startedAt,
            auditPayload: actionInput.auditPayload
          });
        }

        // Calculate delay before retry
        const delay = calculateRetryDelay(attempt - 1, retryPolicy);
        console.log(`[ExecutionGateway] Retrying in ${delay}ms...`);
        
        await this._sleep(delay);
      }
    }

    // All retries exhausted
    const errorCategory = categorizeError(lastError);
    const recoveryHint = ERROR_RECOVERY_HINTS[errorCategory];

    return buildActionResult({
      success: false,
      message: recoveryHint?.userMessage || lastError?.message || 'All retry attempts exhausted',
      error: {
        category: errorCategory,
        code: lastError?.code,
        message: lastError?.message,
        stack: lastError?.stack,
        retryable: false,
        attemptCount: attempt,
        recoveryHint
      },
      executionId,
      idempotencyKey: actionInput.idempotencyKey,
      actionType,
      startedAt,
      auditPayload: actionInput.auditPayload
    });
  }

  // ============================================================================
  // APPROVAL MANAGEMENT
  // ============================================================================

  async _validateApproval(actionInput, providedToken) {
    const { approvalPolicy, actionType, context } = actionInput;

    // Generate approval token if needed
    if (approvalPolicy.required && !approvalPolicy.token) {
      const token = this._generateApprovalToken(context.runId, actionType);
      approvalPolicy.token = token;
      approvalPolicy.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // Store token
      this.approvalTokens.set(`${context.runId}:${actionType}`, {
        token,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: approvalPolicy.expiresAt
      });

      return { 
        ok: false, 
        reason: 'approval_required',
        approvalToken: token,
        expiresAt: approvalPolicy.expiresAt
      };
    }

    // Validate provided token
    if (approvalPolicy.required && providedToken) {
      const tokenKey = `${context.runId}:${actionType}`;
      const tokenRecord = this.approvalTokens.get(tokenKey);

      if (!tokenRecord) {
        return { ok: false, reason: 'approval_not_found' };
      }

      if (tokenRecord.status === 'consumed') {
        return { ok: false, reason: 'approval_token_already_used' };
      }

      if (tokenRecord.status === 'expired' || new Date() > new Date(tokenRecord.expiresAt)) {
        return { ok: false, reason: 'approval_token_expired' };
      }

      if (providedToken !== tokenRecord.token) {
        return { ok: false, reason: 'invalid_approval_token' };
      }

      // Consume the token
      tokenRecord.status = 'consumed';
      tokenRecord.consumedAt = new Date().toISOString();

      return { ok: true };
    }

    return { ok: false, reason: 'approval_required' };
  }

  _generateApprovalToken(runId, actionType) {
    return crypto
      .createHash('sha256')
      .update(`${runId}:${actionType}:${Date.now()}:${uuid()}`)
      .digest('hex')
      .slice(0, 32);
  }

  _buildBlockedResult(actionInput, reason) {
    return buildActionResult({
      success: false,
      message: `Action blocked: ${reason}`,
      status: 'blocked',
      error: {
        category: ERROR_CATEGORY.PRECONDITION_FAILED,
        message: `Approval required: ${reason}`,
        retryable: false,
        recoveryHint: {
          userMessage: 'This action requires your approval before execution.',
          recoveryAction: 'request_approval',
          requiresUserAction: true
        }
      },
      executionId: actionInput.executionId,
      idempotencyKey: actionInput.idempotencyKey,
      actionType: actionInput.actionType,
      startedAt: new Date().toISOString(),
      auditPayload: actionInput.auditPayload
    });
  }

  // ============================================================================
  // ACTION RESOLUTION
  // ============================================================================

  async _resolveActionFunction(actionType) {
    // This would resolve to actual action implementations
    // For now, return a placeholder that should be overridden
    return async (actionInput) => {
      throw new Error(`Action implementation not found for: ${actionType}`);
    };
  }

  async _resolveCanvasActionFunction(actionType) {
    // Import canvas action handlers
    const { CanvasActionHandlers } = await import('./boult-canvas-action-handlers.js');
    const handlers = new CanvasActionHandlers({
      db: this.db,
      boultAI: this.boultAI,
      userEmail: this.userEmail
    });

    return handlers.getHandler(actionType);
  }

  _inferCanvasType(actionType) {
    for (const [canvasType, actions] of Object.entries(CANVAS_ACTIONS_BY_TYPE)) {
      if (actions.includes(actionType)) {
        return canvasType;
      }
    }
    return 'none';
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  _buildErrorResult(actionType, payload, runId, error, errorCategory) {
    const executionId = `${runId || 'exec'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const idempotencyKey = generateIdempotencyKey(runId || executionId, actionType, payload);
    const startedAt = new Date().toISOString();
    const recoveryHint = ERROR_RECOVERY_HINTS[errorCategory] || ERROR_RECOVERY_HINTS[ERROR_CATEGORY.UNKNOWN];

    return buildActionResult({
      success: false,
      message: recoveryHint.userMessage || error.message,
      error: {
        category: errorCategory,
        code: error.code,
        message: error.message,
        stack: error.stack,
        retryable: isRetryableError(errorCategory),
        recoveryHint
      },
      executionId,
      idempotencyKey,
      actionType,
      startedAt,
      auditPayload: buildAuditPayload({
        userEmail: this.userEmail,
        actionType,
        inputSummary: payload,
        context: { runId },
        riskLevel: 'medium',
        mutationType: 'execute'
      })
    });
  }

  async _updateRunState(runId, executionResult, actionInput) {
    const runState = this.activeRuns.get(runId);
    if (!runState) return;

    // Track executed actions in memory
    runState.memory.executedActions[actionInput.executionId] = {
      actionType: actionInput.actionType,
      success: executionResult.success,
      completedAt: new Date().toISOString()
    };

    // Persist to database
    await this.db.updateOperatorRun(this.userEmail, runId, {
      memory: runState.memory,
      lastActionAt: new Date().toISOString()
    });
  }

  async _auditLog(type, payload) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      userEmail: this.userEmail,
      type,
      payload
    };

    try {
      await this.db.appendAuditLog(this.userEmail, auditEntry);
    } catch (err) {
      console.error('[ExecutionGateway] Audit log failed:', err);
    }

    console.log(`[AUDIT] ${type}:`, payload);
  }

  _calculateProgress(steps) {
    if (!steps || steps.length === 0) {
      return { completed: 0, total: 0, percentage: 0 };
    }

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

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// EXPORT
// ============================================================================

export default BoultExecutionGateway;
