/**
 * Boult Plan Mode Engine - Phase 2
 * 
 * Creates persisted PlanArtifacts with:
 * - objectives, assumptions, clarified questions
 * - ordered todos + dependencies
 * - acceptance criteria
 * 
 * Features:
 * - Approval gate with plan versioning (draft -> approved)
 * - Auto-transform approved plan into executable todo graph
 * - Todo state machine: pending -> active -> completed | error | blocked_approval
 * - Run pause/resume for approval steps
 * - Plan-run 1:1 audit trail linking
 */

import {
  EXECUTION_STATUS,
  PlanArtifactSchema,
  TodoExecutionItemSchema,
  buildPlanArtifact,
  buildTodoExecutionItem,
  buildRunState,
  APPROVAL_MODE,
  DEFAULT_RETRY_POLICY
} from './boult-execution-contract-v2.js';

import { TASK_REGISTRY, BOULT_ACTIONS } from './boult-task-registry.js';
import crypto from 'crypto';

const uuid = () => crypto.randomUUID();

// ============================================================================
// PLAN MODE ENGINE
// ============================================================================

export class BoultPlanModeEngine {
  constructor({ db, boultAI, userEmail, userName = 'User' }) {
    this.db = db;
    this.boultAI = boultAI;
    this.userEmail = userEmail;
    this.userName = userName;
    
    // Active plan tracking
    this.activePlans = new Map();
    this.activeRuns = new Map();
  }

  /**
   * Generate a plan from user intent
   * Creates a PlanArtifact with todos, dependencies, and acceptance criteria
   */
  async generatePlan({ message, intent, complexity = 'complex', context = {} }) {
    const planId = `plan_${Date.now()}_${uuid().slice(0, 8)}`;
    
    console.log(`[PlanModeEngine] Generating plan ${planId} for intent: ${intent}`);

    // Step 1: Use AI to analyze and structure the plan
    const planAnalysis = await this.boultAI.analyzePlanIntent({
      message,
      intent,
      complexity,
      context
    });

    // Step 2: Build todos with dependencies
    const todos = await this.buildTodoGraph(planAnalysis.steps, planId);

    // Step 3: Create PlanArtifact
    const planArtifact = buildPlanArtifact({
      title: planAnalysis.title || 'Execution Plan',
      objective: planAnalysis.objective || message,
      complexity,
      intent,
      canvasType: 'action_plan',
      todos,
      assumptions: planAnalysis.assumptions || [],
      questionsAnswered: planAnalysis.questionsAnswered || [],
      acceptanceCriteria: planAnalysis.acceptanceCriteria || [],
      approvalMode: APPROVAL_MODE.MANUAL, // Plans require approval by default
      createdBy: this.userEmail
    });

    // Step 4: Persist plan to database
    await this.db.createPlanArtifact(this.userEmail, planArtifact);

    // Store in memory
    this.activePlans.set(planId, planArtifact);

    console.log(`[PlanModeEngine] Plan ${planId} created with ${todos.length} todos`);

    return {
      planId,
      planArtifact,
      todos,
      requiresApproval: true
    };
  }

  /**
   * Build todo graph with dependencies
   */
  async buildTodoGraph(steps, planId) {
    const todos = [];
    const stepToTodoMap = new Map();

    // First pass: Create todos
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const todo = buildTodoExecutionItem({
        title: step.title || `Step ${i + 1}`,
        description: step.description || '',
        actionType: step.actionType || this.inferActionType(step),
        sortOrder: i,
        dependsOn: [], // Will populate in second pass
        approvalMode: step.requiresApproval ? APPROVAL_MODE.MANUAL : APPROVAL_MODE.CONDITIONAL,
        retryPolicy: step.retryPolicy || DEFAULT_RETRY_POLICY,
        maxAttempts: step.maxAttempts || 3
      });

      // Link step to todo for dependency resolution
      if (step.id) {
        stepToTodoMap.set(step.id, todo.todoId);
      }

      todos.push(todo);
    }

    // Second pass: Resolve dependencies
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.dependsOn && step.dependsOn.length > 0) {
        const todo = todos[i];
        todo.dependsOn = step.dependsOn.map(depId => stepToTodoMap.get(depId)).filter(Boolean);
      }
    }

    return todos;
  }

  /**
   * Infer action type from step description
   */
  inferActionType(step) {
    const title = (step.title || '').toLowerCase();
    const desc = (step.description || '').toLowerCase();
    const combined = `${title} ${desc}`;

    if (combined.includes('email') || combined.includes('send') || combined.includes('mail')) {
      return BOULT_ACTIONS.SEND_EMAIL;
    }
    if (combined.includes('meeting') || combined.includes('schedule') || combined.includes('calendar')) {
      return BOULT_ACTIONS.SCHEDULE_MEETING;
    }
    if (combined.includes('notion') || combined.includes('page') || combined.includes('note')) {
      return BOULT_ACTIONS.NOTION_CREATE_PAGE;
    }
    if (combined.includes('task') || combined.includes('todo') || combined.includes('list')) {
      return BOULT_ACTIONS.TASKS_ADD_TASK;
    }
    if (combined.includes('search') || combined.includes('find') || combined.includes('look')) {
      return BOULT_ACTIONS.READ_INBOX;
    }

    return BOULT_ACTIONS.GENERIC_TASK;
  }

  // ============================================================================
  // APPROVAL GATE
  // ============================================================================

  /**
   * Approve a plan - locks version and enables execution
   * Transition: draft -> approved
   */
  async approvePlan(planId, { approvedBy = null, approvalContext = {} } = {}) {
    const plan = await this.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    // Validate current status
    if (plan.status !== EXECUTION_STATUS.PLAN_DRAFT) {
      throw new Error(`Cannot approve plan in status: ${plan.status}. Must be in draft.`);
    }

    // Lock the plan
    const approvedAt = new Date().toISOString();
    const approvalToken = this.generateApprovalToken(planId, approvedBy);

    const updatedPlan = {
      ...plan,
      status: EXECUTION_STATUS.PLAN_APPROVED,
      approvedAt,
      locked: true,
      version: plan.version + 1, // Bump version on approval
      approval: {
        approvedBy: approvedBy || this.userEmail,
        approvedAt,
        token: approvalToken,
        context: approvalContext
      }
    };

    // Persist approval
    await this.db.updatePlanArtifact(this.userEmail, planId, updatedPlan);

    // Update in-memory
    this.activePlans.set(planId, updatedPlan);

    console.log(`[PlanModeEngine] Plan ${planId} approved by ${approvedBy || this.userEmail}`);

    return {
      planId,
      planArtifact: updatedPlan,
      approvalToken,
      approvedAt,
      todos: updatedPlan.todos
    };
  }

  /**
   * Decline/cancel a plan
   * Transition: draft -> cancelled
   */
  async declinePlan(planId, { reason = '', declinedBy = null } = {}) {
    const plan = await this.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    if (plan.status !== EXECUTION_STATUS.PLAN_DRAFT) {
      throw new Error(`Cannot decline plan in status: ${plan.status}`);
    }

    const updatedPlan = {
      ...plan,
      status: EXECUTION_STATUS.PLAN_CANCELLED,
      cancelledAt: new Date().toISOString(),
      cancellation: {
        declinedBy: declinedBy || this.userEmail,
        reason,
        declinedAt: new Date().toISOString()
      }
    };

    await this.db.updatePlanArtifact(this.userEmail, planId, updatedPlan);
    this.activePlans.set(planId, updatedPlan);

    console.log(`[PlanModeEngine] Plan ${planId} declined: ${reason}`);

    return { planId, planArtifact: updatedPlan };
  }

  /**
   * Revise a plan (create new version from existing)
   */
  async revisePlan(planId, { revisions = {}, revisedBy = null } = {}) {
    const plan = await this.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    // Only approved or completed plans can be revised
    if (![EXECUTION_STATUS.PLAN_APPROVED, EXECUTION_STATUS.PLAN_COMPLETED, EXECUTION_STATUS.PLAN_FAILED].includes(plan.status)) {
      throw new Error(`Cannot revise plan in status: ${plan.status}`);
    }

    // Create new plan as draft
    const newPlanId = `plan_${Date.now()}_${uuid().slice(0, 8)}`;
    const revisedPlan = buildPlanArtifact({
      title: revisions.title || plan.title,
      objective: revisions.objective || plan.objective,
      complexity: plan.complexity,
      intent: plan.intent,
      canvasType: plan.canvasType,
      todos: revisions.todos || plan.todos.map(t => ({
        ...t,
        todoId: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, // New IDs
        status: EXECUTION_STATUS.TODO_PENDING,
        attemptCount: 0,
        actionResult: null,
        errorMessage: null
      })),
      assumptions: revisions.assumptions || plan.assumptions,
      questionsAnswered: revisions.questionsAnswered || plan.questionsAnswered,
      acceptanceCriteria: revisions.acceptanceCriteria || plan.acceptanceCriteria,
      approvalMode: APPROVAL_MODE.MANUAL,
      createdBy: revisedBy || this.userEmail,
      parentPlanId: planId, // Link to parent
      revisionOf: planId
    });

    await this.db.createPlanArtifact(this.userEmail, revisedPlan);
    this.activePlans.set(newPlanId, revisedPlan);

    console.log(`[PlanModeEngine] Plan ${planId} revised as ${newPlanId}`);

    return {
      planId: newPlanId,
      planArtifact: revisedPlan,
      parentPlanId: planId
    };
  }

  // ============================================================================
  // TODO EXECUTION
  // ============================================================================

  /**
   * Execute an approved plan
   * Creates a run linked 1:1 with the plan
   */
  async executePlan(planId, { runId = null, executionContext = {} } = {}) {
    const plan = await this.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    // Validate plan is approved
    if (plan.status !== EXECUTION_STATUS.PLAN_APPROVED) {
      throw new Error(`Cannot execute plan in status: ${plan.status}. Must be approved.`);
    }

    // Create run linked to plan
    const runState = buildRunState({
      userEmail: this.userEmail,
      planId,
      intent: plan.intent,
      complexity: plan.complexity,
      planSnapshot: plan.todos
    });

    const effectiveRunId = runId || runState.runId;
    runState.runId = effectiveRunId;
    runState.status = EXECUTION_STATUS.PLAN_EXECUTING;

    // Persist run
    await this.db.createOperatorRun(this.userEmail, runState);
    this.activeRuns.set(effectiveRunId, runState);

    // Update plan status to executing
    const executingPlan = {
      ...plan,
      status: EXECUTION_STATUS.PLAN_EXECUTING,
      runId: effectiveRunId,
      startedAt: new Date().toISOString()
    };
    await this.db.updatePlanArtifact(this.userEmail, planId, executingPlan);
    this.activePlans.set(planId, executingPlan);

    console.log(`[PlanModeEngine] Executing plan ${planId} with run ${effectiveRunId}`);

    // Start execution
    const executionResult = await this.executeTodoGraph(
      executingPlan.todos,
      effectiveRunId,
      planId,
      executionContext
    );

    return {
      runId: effectiveRunId,
      planId,
      planArtifact: executingPlan,
      executionResult
    };
  }

  /**
   * Execute todo graph with dependency resolution
   */
  async executeTodoGraph(todos, runId, planId, context = {}) {
    const results = [];
    const completedTodos = new Set();
    const failedTodos = new Set();
    const blockedTodos = new Map(); // todoId -> { reason, requiredAction }

    // Sort todos by order and dependencies
    const sortedTodos = [...todos].sort((a, b) => a.sortOrder - b.sortOrder);

    for (const todo of sortedTodos) {
      // Check if already completed/failed
      if (completedTodos.has(todo.todoId) || failedTodos.has(todo.todoId)) {
        continue;
      }

      // Check dependencies
      const depsSatisfied = todo.dependsOn.every(depId => 
        completedTodos.has(depId)
      );

      if (!depsSatisfied) {
        const failedDeps = todo.dependsOn.filter(depId => failedTodos.has(depId));
        if (failedDeps.length > 0) {
          todo.status = EXECUTION_STATUS.TODO_SKIPPED;
          todo.errorMessage = `Dependencies failed: ${failedDeps.join(', ')}`;
          failedTodos.add(todo.todoId);
          
          await this.persistTodoState(runId, todo);
          continue;
        }
        
        // Wait for dependencies - will be handled by retry
        todo.status = EXECUTION_STATUS.TODO_PENDING;
        await this.persistTodoState(runId, todo);
        continue;
      }

      // Execute the todo
      const executionResult = await this.executeTodo(todo, runId, planId, context);
      
      if (executionResult.status === 'completed' || executionResult.status === 'already_completed') {
        todo.status = EXECUTION_STATUS.TODO_COMPLETED;
        todo.completedAt = new Date().toISOString();
        todo.actionResult = executionResult;
        completedTodos.add(todo.todoId);
      } else if (executionResult.status === 'blocked') {
        todo.status = EXECUTION_STATUS.TODO_BLOCKED;
        todo.errorMessage = executionResult.message;
        blockedTodos.set(todo.todoId, {
          reason: executionResult.blockedReason,
          requiredAction: executionResult.requiredAction,
          approvalToken: executionResult.approvalToken
        });
        
        // Pause run for approval
        await this.pauseRunForApproval(runId, todo, executionResult);
        
        // Persist state and exit
        await this.persistTodoState(runId, todo);
        
        return {
          status: 'paused',
          reason: 'approval_required',
          blockedTodo: todo,
          blockedTodos: Array.from(blockedTodos.entries()),
          completedCount: completedTodos.size,
          totalCount: todos.length
        };
      } else {
        todo.status = EXECUTION_STATUS.TODO_FAILED;
        todo.failedAt = new Date().toISOString();
        todo.errorMessage = executionResult.message;
        todo.errorCategory = executionResult.error?.category;
        todo.recoveryHint = executionResult.error?.recoveryHint;
        failedTodos.add(todo.todoId);
      }

      await this.persistTodoState(runId, todo);
      results.push({
        todoId: todo.todoId,
        status: todo.status,
        result: executionResult
      });
    }

    // Determine final status
    const allCompleted = todos.every(t => 
      t.status === EXECUTION_STATUS.TODO_COMPLETED || 
      t.status === EXECUTION_STATUS.TODO_SKIPPED
    );
    const hasFailures = failedTodos.size > 0;
    const hasBlocked = blockedTodos.size > 0;

    let finalStatus;
    if (allCompleted && !hasFailures) {
      finalStatus = EXECUTION_STATUS.PLAN_COMPLETED;
    } else if (hasFailures) {
      finalStatus = EXECUTION_STATUS.PLAN_FAILED;
    } else if (hasBlocked) {
      finalStatus = EXECUTION_STATUS.PLAN_EXECUTING; // Still executing, paused
    } else {
      finalStatus = EXECUTION_STATUS.PLAN_EXECUTING;
    }

    // Update plan status
    const plan = await this.getPlan(planId);
    if (plan) {
      const updatedPlan = {
        ...plan,
        status: finalStatus,
        completedAt: finalStatus === EXECUTION_STATUS.PLAN_COMPLETED ? new Date().toISOString() : null
      };
      await this.db.updatePlanArtifact(this.userEmail, planId, updatedPlan);
      this.activePlans.set(planId, updatedPlan);
    }

    return {
      status: finalStatus,
      results,
      completedCount: completedTodos.size,
      failedCount: failedTodos.size,
      blockedCount: blockedTodos.size,
      totalCount: todos.length
    };
  }

  /**
   * Execute a single todo
   */
  async executeTodo(todo, runId, planId, context) {
    console.log(`[PlanModeEngine] Executing todo ${todo.todoId}: ${todo.title}`);

    // Update todo to running
    todo.status = EXECUTION_STATUS.TODO_RUNNING;
    todo.startedAt = new Date().toISOString();
    todo.attemptCount++;
    await this.persistTodoState(runId, todo);

    try {
      // Check if action requires approval
      if (todo.approvalMode === APPROVAL_MODE.MANUAL && !context.approvalToken) {
        return {
          status: 'blocked',
          message: 'This action requires approval before execution',
          blockedReason: 'approval_required',
          requiredAction: todo.actionType,
          approvalToken: this.generateApprovalToken(runId, todo.actionType)
        };
      }

      // Execute via the execution gateway (Phase 1 integration)
      const actionResult = await this.executeActionViaGateway(todo, runId, planId, context);

      return {
        status: actionResult.success ? 'completed' : 'failed',
        message: actionResult.message,
        data: actionResult.data,
        externalRefs: actionResult.externalRefs,
        error: actionResult.error
      };

    } catch (error) {
      return {
        status: 'failed',
        message: error.message,
        error: {
          category: 'runtime_error',
          message: error.message,
          stack: error.stack
        }
      };
    }
  }

  /**
   * Execute action via Phase 1 gateway
   */
  async executeActionViaGateway(todo, runId, planId, context) {
    // Import the execution gateway
    const { BoultExecutionGateway } = await import('./boult-execution-gateway.js');
    
    const gateway = new BoultExecutionGateway({
      db: this.db,
      boultAI: this.boultAI,
      userEmail: this.userEmail,
      userName: this.userName
    });

    // Build action payload from todo
    const payload = todo.actionInput?.payload || this.inferPayloadFromTodo(todo);

    // Execute through gateway
    return await gateway.executeCanvasAction(
      todo.actionType,
      payload,
      runId,
      context.approvalToken
    );
  }

  /**
   * Infer payload from todo description
   */
  inferPayloadFromTodo(todo) {
    // Basic payload inference based on action type
    const payload = {};
    
    if (todo.title) {
      if (todo.actionType === BOULT_ACTIONS.SEND_EMAIL) {
        payload.subject = todo.title;
        payload.body = todo.description || '';
      } else if (todo.actionType === BOULT_ACTIONS.NOTION_CREATE_PAGE) {
        payload.title = todo.title;
        payload.content = todo.description || '';
      } else if (todo.actionType === BOULT_ACTIONS.TASKS_ADD_TASK) {
        payload.title = todo.title;
        payload.notes = todo.description || '';
      }
    }

    return payload;
  }

  // ============================================================================
  // RUN PAUSE / RESUME
  // ============================================================================

  /**
   * Pause run for approval
   */
  async pauseRunForApproval(runId, todo, executionResult) {
    const run = this.activeRuns.get(runId) || await this.db.getOperatorRunById(this.userEmail, runId);
    if (!run) return;

    const pausedRun = {
      ...run,
      status: EXECUTION_STATUS.RUN_APPROVAL,
      phase: EXECUTION_STATUS.RUN_APPROVAL,
      pausedAt: new Date().toISOString(),
      pauseReason: {
        type: 'approval_required',
        todoId: todo.todoId,
        actionType: todo.actionType,
        message: executionResult.message,
        approvalToken: executionResult.approvalToken
      },
      memory: {
        ...run.memory,
        pendingApproval: {
          todoId: todo.todoId,
          actionType: todo.actionType,
          requestedAt: new Date().toISOString()
        }
      }
    };

    await this.db.updateOperatorRun(this.userEmail, runId, pausedRun);
    this.activeRuns.set(runId, pausedRun);

    console.log(`[PlanModeEngine] Run ${runId} paused for approval on todo ${todo.todoId}`);
  }

  /**
   * Resume a paused run with approval token
   */
  async resumeRun(runId, { approvalToken, approvedBy = null } = {}) {
    const run = this.activeRuns.get(runId) || await this.db.getOperatorRunById(this.userEmail, runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.status !== EXECUTION_STATUS.RUN_APPROVAL) {
      throw new Error(`Run ${runId} is not paused for approval (status: ${run.status})`);
    }

    // Validate approval token
    if (run.pauseReason?.approvalToken && run.pauseReason.approvalToken !== approvalToken) {
      throw new Error('Invalid approval token');
    }

    const planId = run.planId;
    const plan = await this.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    // Resume execution
    const resumedRun = {
      ...run,
      status: EXECUTION_STATUS.RUN_EXECUTING,
      phase: EXECUTION_STATUS.RUN_EXECUTING,
      resumedAt: new Date().toISOString(),
      resumedBy: approvedBy || this.userEmail,
      memory: {
        ...run.memory,
        pendingApproval: null,
        approvalsGranted: [
          ...(run.memory?.approvalsGranted || []),
          {
            todoId: run.pauseReason?.todoId,
            actionType: run.pauseReason?.actionType,
            approvedAt: new Date().toISOString(),
            approvedBy: approvedBy || this.userEmail,
            approvalToken
          }
        ]
      }
    };

    await this.db.updateOperatorRun(this.userEmail, runId, resumedRun);
    this.activeRuns.set(runId, resumedRun);

    console.log(`[PlanModeEngine] Run ${runId} resumed, continuing execution`);

    // Continue execution from where it left off
    const remainingTodos = plan.todos.filter(t => 
      t.status !== EXECUTION_STATUS.TODO_COMPLETED &&
      t.status !== EXECUTION_STATUS.TODO_SKIPPED
    );

    const executionResult = await this.executeTodoGraph(
      remainingTodos,
      runId,
      planId,
      { approvalToken } // Pass approval token for the resumed action
    );

    return {
      runId,
      planId,
      executionResult
    };
  }

  // ============================================================================
  // PERSISTENCE
  // ============================================================================

  /**
   * Persist todo state
   */
  async persistTodoState(runId, todo) {
    await this.db.upsertOperatorRunStep(this.userEmail, runId, todo);
  }

  /**
   * Get plan by ID
   */
  async getPlan(planId) {
    // Check memory first
    if (this.activePlans.has(planId)) {
      return this.activePlans.get(planId);
    }

    // Fetch from database
    const plan = await this.db.getPlanArtifact(this.userEmail, planId);
    if (plan) {
      this.activePlans.set(planId, plan);
    }
    return plan;
  }

  /**
   * Get run status with full plan context
   */
  async getRunStatus(runId) {
    const run = this.activeRuns.get(runId) || await this.db.getOperatorRunById(this.userEmail, runId);
    if (!run) return null;

    const plan = run.planId ? await this.getPlan(run.planId) : null;
    const steps = await this.db.getOperatorRunSteps(this.userEmail, runId);

    return {
      runId,
      status: run.status,
      phase: run.phase,
      planId: run.planId,
      planArtifact: plan,
      progress: this.calculateProgress(steps),
      steps: steps || [],
      paused: run.status === EXECUTION_STATUS.RUN_APPROVAL,
      pauseReason: run.pauseReason || null,
      canResume: run.status === EXECUTION_STATUS.RUN_APPROVAL
    };
  }

  /**
   * Calculate execution progress
   */
  calculateProgress(steps) {
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

  // ============================================================================
  // HELPERS
  // ============================================================================

  generateApprovalToken(planId, approvedBy) {
    return crypto
      .createHash('sha256')
      .update(`${planId}:${approvedBy || this.userEmail}:${Date.now()}:${uuid()}`)
      .digest('hex')
      .slice(0, 32);
  }
}

// ============================================================================
// AI ANALYSIS INTERFACE
// ============================================================================

/**
 * Extension for BoultAIService to support plan analysis
 */
export async function analyzePlanIntent(aiService, { message, intent, complexity, context }) {
  // This would be implemented in the AI service
  // For now, returning a structured response
  return {
    title: `Plan: ${intent || 'Multi-step Execution'}`,
    objective: message,
    steps: [
      {
        id: 'step-1',
        title: 'Gather context',
        description: 'Search and analyze relevant information',
        actionType: BOULT_ACTIONS.READ_INBOX,
        requiresApproval: false
      },
      {
        id: 'step-2',
        title: 'Draft response',
        description: 'Create draft based on context',
        actionType: BOULT_ACTIONS.SEND_EMAIL,
        requiresApproval: true
      }
    ],
    assumptions: [
      'User has connected email account',
      'Required permissions are granted'
    ],
    questionsAnswered: [
      'What is the primary objective?',
      'What actions are needed?'
    ],
    acceptanceCriteria: [
      'All steps complete successfully',
      'User receives confirmation'
    ]
  };
}

export default BoultPlanModeEngine;
