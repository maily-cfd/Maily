import crypto from 'crypto';
import { TASK_REGISTRY, validateActionInputs, CANVAS_ACTIONS_BY_TYPE } from './boult-task-registry';

const uuid = () => crypto.randomUUID();

const STEP_KIND_MAP = {
  think: 'think',
  search: 'search',
  read: 'read',
  analyze: 'analyze',
  draft: 'draft',
  execute: 'execute'
};

// CANVAS_ACTIONS_BY_TYPE is now imported from boult-task-registry.js

const LEGAL_STEP_TRANSITIONS = {
  pending: ['active', 'error'],
  active: ['completed', 'error', 'blocked_approval'],
  blocked_approval: ['active', 'completed', 'error'],
  completed: [],
  error: []
};

const VALID_PHASES = new Set([
  'thinking',
  'searching',
  'synthesizing',
  'approval',
  'executing',
  'post_execution'
]);

export class BoultOperatorRuntime {
  constructor({ db, boultAI, userEmail, userName = 'User', conversationId, missionId = null }) {
    this.db = db;
    this.boultAI = boultAI;
    this.userEmail = userEmail || null;
    this.userName = userName;
    this.conversationId = conversationId || null;
    this.missionId = missionId || null;
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
        status: index === 0 ? 'active' : 'pending',
        label: step.label || step.description || step.action || `Step ${index + 1}`,
        detail: step.detail || ''
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
        detail: 'Intent detection and task classification'
      },
      {
        kind: emailFocused ? 'search' : 'read',
        label: emailFocused ? 'Searching relevant Gmail context' : 'Gathering relevant context',
        detail: emailFocused ? 'Finding relevant threads and messages' : 'Collecting required inputs'
      },
      {
        kind: 'draft',
        label: 'Preparing output for review',
        detail: 'Drafting actionable result in canvas'
      }
    ];
  }

  buildExecutionPolicy(canvasType = 'none', requiresApproval = false, runId = '', canvasData = null) {
    const actionTypes = CANVAS_ACTIONS_BY_TYPE[canvasType] || [];
    const actions = actionTypes.map((actionType) => {
      const spec = TASK_REGISTRY[actionType];
      const validation = canvasData?.actionPayload ? validateActionInputs(actionType, canvasData.actionPayload) : { valid: true, missing: [] };

      return {
        actionType,
        label: spec?.label || actionType,
        requiresApproval: requiresApproval || spec?.mutating || false,
        isValid: validation.valid,
        missingInputs: validation.missing
      };
    });

    const approvalTokens = {};
    actions.forEach((action) => {
      if (action.requiresApproval) {
        approvalTokens[action.actionType] = this.generateApprovalToken(runId, action.actionType);
      }
    });

    return {
      actions,
      requiresApproval: actions.some(a => a.requiresApproval),
      approvalTokens,
      isReady: actions.every(a => a.isValid || a.actionType === 'revise' || a.actionType === 'cancel')
    };
  }

  generateApprovalToken(runId, actionType) {
    return crypto
      .createHash('sha256')
      .update(`${runId}:${actionType}:${Date.now()}:${uuid()}`)
      .digest('hex')
      .slice(0, 32);
  }

  async initializeRun({ message, intentAnalysis = null, canvasType = 'none', runId: providedRunId = null }) {
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
      status: 'running',
      phase: 'thinking',
      intent,
      complexity,
      planSnapshot: plan,
      memory: {
        lastMessage: message,
        evidenceByStep: {},
        approvalTokens: {},
        consumedApprovalTokens: {},
        executedActions: {},
        suggestions: []
      }
    };

    await this.db.createOperatorRun(this.userEmail, run);

    for (const step of plan) {
      await this.db.upsertOperatorRunStep(this.userEmail, runId, step);
    }

    await this.db.appendOperatorRunEvent(this.userEmail, runId, {
      type: 'run_initialized',
      phase: run.phase,
      payload: {
        intent,
        complexity,
        planCount: plan.length
      }
    });

    return { run, plan, requiresApproval };
  }

  async transitionStep({ runId, stepId, status, phase = null, evidence = null, detail = null }) {
    if (!runId || !stepId) return;

    const nextStatus = status || 'pending';
    const nextPhase = VALID_PHASES.has(phase || '') ? phase : (nextStatus === 'active' ? 'executing' : 'thinking');

    const step = await this.db.getOperatorRunStepById(this.userEmail, runId, stepId);
    const currentStatus = step?.status || 'pending';
    const allowed = LEGAL_STEP_TRANSITIONS[currentStatus] || [];
    const isNoop = currentStatus === nextStatus;

    if (!isNoop && !allowed.includes(nextStatus)) {
      await this.db.appendOperatorRunEvent(this.userEmail, runId, {
        type: 'step_transition_rejected',
        phase: nextPhase,
        payload: {
          stepId,
          fromStatus: currentStatus,
          attemptedStatus: nextStatus
        }
      });
      return;
    }

    await this.db.updateOperatorRunStepStatus(this.userEmail, runId, stepId, nextStatus, detail || null, evidence || null);
    await this.db.updateOperatorRun(this.userEmail, runId, { phase: nextPhase });

    await this.db.appendOperatorRunEvent(this.userEmail, runId, {
      type: 'step_transition',
      phase: nextPhase,
      payload: {
        stepId,
        status: nextStatus,
        evidence
      }
    });
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

    await this.db.updateOperatorRun(this.userEmail, runId, { memory });
  }

  async validateApprovalToken(runId, actionType, approvalToken) {
    const run = await this.db.getOperatorRunById(this.userEmail, runId);
    if (!run) return { ok: false, reason: 'run_not_found' };

    const memory = run.memory || {};
    const expected = memory.approvalTokens?.[actionType];
    const consumed = memory.consumedApprovalTokens?.[actionType];

    if (!expected) return { ok: false, reason: 'approval_not_required_or_missing' };
    if (!approvalToken || approvalToken !== expected) return { ok: false, reason: 'invalid_approval_token' };
    if (consumed && consumed === approvalToken) return { ok: false, reason: 'approval_token_already_used' };

    return { ok: true, run };
  }

  async consumeApprovalToken(runId, actionType, approvalToken) {
    const run = await this.db.getOperatorRunById(this.userEmail, runId);
    if (!run) return;
    const memory = run.memory || {};
    memory.consumedApprovalTokens = {
      ...(memory.consumedApprovalTokens || {}),
      [actionType]: approvalToken
    };
    await this.db.updateOperatorRun(this.userEmail, runId, { memory });
  }

  async checkAndStoreIdempotentResult(runId, actionRequestId, executionResult) {
    const run = await this.db.getOperatorRunById(this.userEmail, runId);
    if (!run) return;
    const memory = run.memory || {};
    const executed = memory.executedActions || {};
    executed[actionRequestId] = executionResult;
    memory.executedActions = executed;
    await this.db.updateOperatorRun(this.userEmail, runId, { memory });
  }

  async getIdempotentResult(runId, actionRequestId) {
    const run = await this.db.getOperatorRunById(this.userEmail, runId);
    if (!run) return null;
    return run.memory?.executedActions?.[actionRequestId] || null;
  }

  async enqueueJob(runId, jobType, payload, options = {}) {
    return this.db.createOperatorJob(this.userEmail, {
      runId,
      jobType,
      payload,
      status: 'queued',
      maxAttempts: options.maxAttempts || 3,
      availableAt: options.availableAt || new Date().toISOString(),
      leaseSeconds: options.leaseSeconds || 45
    });
  }
}

