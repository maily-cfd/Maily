/**
 * Boult Plan Engine
 * Manages PlanArtifact lifecycle: draft → approved → executing → completed
 * Manages TodoExecutionItem graph: pending → ready → running → completed
 * Manages SearchSession transparency: queued → searching → complete
 */

import crypto from 'crypto';

const uuid = () => crypto.randomUUID();

// ── Plan Status FSM ──────────────────────────────────────────
const PLAN_TRANSITIONS = {
  draft:      ['approved', 'cancelled'],
  approved:   ['executing', 'cancelled'],
  executing:  ['completed', 'failed', 'cancelled'],
  completed:  [],
  failed:     ['draft'],       // allow retry from failed
  cancelled:  ['draft']        // allow re-draft
};

// ── Todo Status FSM ──────────────────────────────────────────
const TODO_TRANSITIONS = {
  pending:           ['ready', 'skipped'],
  ready:             ['running', 'blocked_approval', 'skipped'],
  running:           ['completed', 'failed'],
  blocked_approval:  ['running', 'skipped'],
  completed:         [],
  failed:            ['ready'],   // allow retry
  skipped:           []
};

// ── Search Session Status FSM ────────────────────────────────
const SEARCH_TRANSITIONS = {
  queued:             ['searching'],
  searching:          ['source_processing', 'complete'],
  source_processing:  ['complete'],
  complete:           []
};

export class BoultPlanEngine {
  constructor({ db, userEmail }) {
    this.db = db;
    this.userEmail = userEmail;
  }

  // ═══════════════════════════════════════════════════════════
  //  PLAN ARTIFACT CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a new PlanArtifact from an AI-generated plan.
   */
  async createPlan({
    runId = null,
    conversationId = null,
    title,
    objective,
    assumptions = [],
    questionsAnswered = [],
    acceptanceCriteria = [],
    todos = [],
    sourceMessage = '',
    intent = 'general',
    complexity = 'simple',
    canvasType = 'action_plan'
  }) {
    const planId = `plan_${Date.now()}_${uuid().slice(0, 8)}`;

    const plan = {
      plan_id: planId,
      user_id: this.userEmail,
      run_id: runId,
      conversation_id: conversationId,
      title,
      objective,
      assumptions: JSON.stringify(assumptions),
      questions_answered: JSON.stringify(questionsAnswered),
      acceptance_criteria: JSON.stringify(acceptanceCriteria),
      status: 'draft',
      version: 1,
      locked: false,
      source_message: sourceMessage,
      intent,
      complexity,
      canvas_type: canvasType
    };

    const { error } = await this.db.supabase
      .from('boult_plan_artifacts')
      .insert(plan);

    if (error) throw new Error(`Failed to create plan: ${error.message}`);

    // Create todo items if provided
    let createdTodos = [];
    if (todos.length > 0) {
      createdTodos = await this._createTodoItems(planId, runId, todos);
    }

    return { planId, plan, todos: createdTodos };
  }

  /**
   * Approve and lock a plan version for execution.
   */
  async approvePlan(planId) {
    const plan = await this.getPlan(planId);
    if (!plan) throw new Error('Plan not found');
    if (plan.locked) throw new Error('Plan already locked');

    const allowed = PLAN_TRANSITIONS[plan.status] || [];
    if (!allowed.includes('approved')) {
      throw new Error(`Cannot approve plan in status '${plan.status}'`);
    }

    const now = new Date().toISOString();
    const { error } = await this.db.supabase
      .from('boult_plan_artifacts')
      .update({
        status: 'approved',
        approved_at: now,
        approved_version: plan.version,
        locked: true,
        updated_at: now
      })
      .eq('plan_id', planId)
      .eq('user_id', this.userEmail);

    if (error) throw new Error(`Failed to approve plan: ${error.message}`);

    // Mark all pending todos as 'ready' if they have no unmet dependencies
    await this._readyEligibleTodos(planId);

    return { planId, status: 'approved', approvedAt: now };
  }

  /**
   * Transition plan status.
   */
  async transitionPlan(planId, targetStatus) {
    const plan = await this.getPlan(planId);
    if (!plan) throw new Error('Plan not found');

    const allowed = PLAN_TRANSITIONS[plan.status] || [];
    if (!allowed.includes(targetStatus)) {
      throw new Error(`Cannot transition plan from '${plan.status}' to '${targetStatus}'`);
    }

    const { error } = await this.db.supabase
      .from('boult_plan_artifacts')
      .update({ status: targetStatus, updated_at: new Date().toISOString() })
      .eq('plan_id', planId)
      .eq('user_id', this.userEmail);

    if (error) throw new Error(`Plan transition failed: ${error.message}`);
    return { planId, status: targetStatus };
  }

  /**
   * Get a plan by ID.
   */
  async getPlan(planId) {
    const { data, error } = await this.db.supabase
      .from('boult_plan_artifacts')
      .select('*')
      .eq('plan_id', planId)
      .eq('user_id', this.userEmail)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  /**
   * Get the latest plan for a run.
   */
  async getPlanByRunId(runId) {
    const { data, error } = await this.db.supabase
      .from('boult_plan_artifacts')
      .select('*')
      .eq('run_id', runId)
      .eq('user_id', this.userEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') return null;
    return data || null;
  }

  // ═══════════════════════════════════════════════════════════
  //  TODO EXECUTION ITEMS
  // ═══════════════════════════════════════════════════════════

  /**
   * Create todo items for a plan. Called internally on plan creation.
   */
  async _createTodoItems(planId, runId, todos) {
    const rows = todos.map((todo, index) => ({
      todo_id: `todo_${uuid().slice(0, 12)}`,
      plan_id: planId,
      user_id: this.userEmail,
      run_id: runId,
      title: todo.title || todo.label || `Task ${index + 1}`,
      description: todo.description || todo.detail || '',
      action_type: todo.actionType || todo.action_type || 'generic_task',
      action_payload: JSON.stringify(todo.actionPayload || todo.payload || {}),
      input_schema: JSON.stringify(todo.inputSchema || {}),
      sort_order: todo.order || index,
      depends_on: todo.dependsOn || [],
      status: 'pending',
      approval_mode: todo.approvalMode || (todo.mutating ? 'manual' : 'auto'),
      idempotency_key: crypto
        .createHash('sha256')
        .update(`${planId}:${index}:${todo.actionType || 'task'}:${JSON.stringify(todo.actionPayload || {})}`)
        .digest('hex')
        .slice(0, 32),
      retry_policy: JSON.stringify(todo.retryPolicy || { max_attempts: 3, backoff_ms: 1000 })
    }));

    const { error } = await this.db.supabase
      .from('boult_todo_items')
      .insert(rows);

    if (error) throw new Error(`Failed to create todo items: ${error.message}`);
    return rows;
  }

  /**
   * Mark eligible todos as 'ready' (no unmet dependencies).
   */
  async _readyEligibleTodos(planId) {
    const todos = await this.getTodos(planId);
    const completedIds = new Set(
      todos.filter(t => t.status === 'completed').map(t => t.todo_id)
    );

    for (const todo of todos) {
      if (todo.status !== 'pending') continue;

      const deps = todo.depends_on || [];
      const allDepsCompleted = deps.every(depId => completedIds.has(depId));

      if (allDepsCompleted) {
        await this.transitionTodo(todo.todo_id, 'ready');
      }
    }
  }

  /**
   * Transition a todo item status.
   */
  async transitionTodo(todoId, targetStatus, resultPayload = null, errorMessage = null) {
    const todo = await this.getTodo(todoId);
    if (!todo) throw new Error('Todo not found');

    const allowed = TODO_TRANSITIONS[todo.status] || [];
    if (!allowed.includes(targetStatus)) {
      return { ok: false, reason: `Cannot transition from '${todo.status}' to '${targetStatus}'` };
    }

    const updates = {
      status: targetStatus,
      updated_at: new Date().toISOString()
    };

    if (targetStatus === 'running') {
      updates.started_at = new Date().toISOString();
      updates.attempt_count = (todo.attempt_count || 0) + 1;
    }

    if (targetStatus === 'completed') {
      updates.completed_at = new Date().toISOString();
      if (resultPayload) updates.result_payload = JSON.stringify(resultPayload);
    }

    if (targetStatus === 'failed' && errorMessage) {
      updates.error_message = errorMessage;
    }

    if (targetStatus === 'blocked_approval') {
      updates.approval_token = crypto
        .createHash('sha256')
        .update(`${todoId}:${Date.now()}:${uuid()}`)
        .digest('hex')
        .slice(0, 32);
    }

    const { error } = await this.db.supabase
      .from('boult_todo_items')
      .update(updates)
      .eq('todo_id', todoId)
      .eq('user_id', this.userEmail);

    if (error) throw new Error(`Todo transition failed: ${error.message}`);

    // After completing a todo, check if dependent todos can now be readied
    if (targetStatus === 'completed') {
      const plan = await this.getPlan(todo.plan_id);
      if (plan) await this._readyEligibleTodos(todo.plan_id);

      // Check if ALL todos are completed → transition plan to completed
      const allTodos = await this.getTodos(todo.plan_id);
      const allDone = allTodos.every(t => t.status === 'completed' || t.status === 'skipped');
      if (allDone && plan.status === 'executing') {
        await this.transitionPlan(todo.plan_id, 'completed');
      }
    }

    return { ok: true, todoId, status: targetStatus, approvalToken: updates.approval_token || null };
  }

  /**
   * Get a single todo.
   */
  async getTodo(todoId) {
    const { data, error } = await this.db.supabase
      .from('boult_todo_items')
      .select('*')
      .eq('todo_id', todoId)
      .eq('user_id', this.userEmail)
      .single();

    if (error && error.code !== 'PGRST116') return null;
    return data || null;
  }

  /**
   * Get all todos for a plan, ordered.
   */
  async getTodos(planId) {
    const { data, error } = await this.db.supabase
      .from('boult_todo_items')
      .select('*')
      .eq('plan_id', planId)
      .eq('user_id', this.userEmail)
      .order('sort_order', { ascending: true });

    if (error) return [];
    return data || [];
  }

  /**
   * Get the next ready todo for execution.
   */
  async getNextReadyTodo(planId) {
    const { data, error } = await this.db.supabase
      .from('boult_todo_items')
      .select('*')
      .eq('plan_id', planId)
      .eq('user_id', this.userEmail)
      .eq('status', 'ready')
      .order('sort_order', { ascending: true })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') return null;
    return data || null;
  }

  // ═══════════════════════════════════════════════════════════
  //  PLAN → TODO GRAPH CONVERSION
  // ═══════════════════════════════════════════════════════════

  /**
   * Convert an approved plan into an executable todo graph.
   * Called when the user approves a plan.
   */
  async convertPlanToTodoGraph(planId, operatorSteps = []) {
    const plan = await this.getPlan(planId);
    if (!plan) throw new Error('Plan not found');
    if (plan.status !== 'approved') throw new Error('Plan must be approved before conversion');

    // Transition plan to executing
    await this.transitionPlan(planId, 'executing');

    // Check if todos already exist
    const existing = await this.getTodos(planId);
    if (existing.length > 0) {
      // Todos already created during plan creation — just ready them
      await this._readyEligibleTodos(planId);
      return existing;
    }

    // If no todos were provided at creation time, derive from operator steps
    const todos = operatorSteps.map((step, index) => ({
      title: step.label || step.description || `Step ${index + 1}`,
      description: step.detail || '',
      actionType: step.kind || step.type || 'generic_task',
      order: index,
      dependsOn: index > 0 ? [`todo_step_${index - 1}`] : [],
      approvalMode: step.kind === 'execute' ? 'manual' : 'auto'
    }));

    const todoIds = await this._createTodoItems(planId, plan.run_id, todos);
    await this._readyEligibleTodos(planId);

    return this.getTodos(planId);
  }

  // ═══════════════════════════════════════════════════════════
  //  SEARCH SESSIONS (Perplexity-style transparency)
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a search session.
   */
  async createSearchSession({ runId = null, planId = null, query, sourceType = 'email' }) {
    const sessionId = `search_${Date.now()}_${uuid().slice(0, 8)}`;

    const session = {
      session_id: sessionId,
      user_id: this.userEmail,
      run_id: runId,
      plan_id: planId,
      status: 'queued',
      query,
      source_type: sourceType,
      result_count: 0,
      selected_snippets: JSON.stringify([]),
      events: JSON.stringify([{
        type: 'session_created',
        query,
        sourceType,
        at: new Date().toISOString()
      }])
    };

    const { error } = await this.db.supabase
      .from('boult_search_sessions')
      .insert(session);

    if (error) throw new Error(`Failed to create search session: ${error.message}`);
    return { sessionId, session };
  }

  /**
   * Transition a search session and append an event.
   */
  async transitionSearchSession(sessionId, targetStatus, eventData = {}) {
    const session = await this.getSearchSession(sessionId);
    if (!session) return null;

    const allowed = SEARCH_TRANSITIONS[session.status] || [];
    if (!allowed.includes(targetStatus)) return null;

    const events = Array.isArray(session.events) ? session.events : [];
    events.push({
      type: `status_${targetStatus}`,
      ...eventData,
      at: new Date().toISOString()
    });

    const updates = {
      status: targetStatus,
      events: JSON.stringify(events)
    };

    if (targetStatus === 'searching') {
      updates.started_at = new Date().toISOString();
    }

    if (targetStatus === 'complete') {
      updates.completed_at = new Date().toISOString();
      if (eventData.resultCount !== undefined) updates.result_count = eventData.resultCount;
      if (eventData.selectedSnippets) updates.selected_snippets = JSON.stringify(eventData.selectedSnippets);
    }

    const { error } = await this.db.supabase
      .from('boult_search_sessions')
      .update(updates)
      .eq('session_id', sessionId)
      .eq('user_id', this.userEmail);

    if (error) return null;
    return { sessionId, status: targetStatus };
  }

  /**
   * Append a search event without status transition.
   */
  async appendSearchEvent(sessionId, event) {
    const session = await this.getSearchSession(sessionId);
    if (!session) return;

    const events = Array.isArray(session.events) ? session.events : [];
    events.push({ ...event, at: new Date().toISOString() });

    await this.db.supabase
      .from('boult_search_sessions')
      .update({ events: JSON.stringify(events) })
      .eq('session_id', sessionId)
      .eq('user_id', this.userEmail);
  }

  /**
   * Get a search session.
   */
  async getSearchSession(sessionId) {
    const { data, error } = await this.db.supabase
      .from('boult_search_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .eq('user_id', this.userEmail)
      .single();

    if (error && error.code !== 'PGRST116') return null;
    return data || null;
  }

  /**
   * Get all search sessions for a run.
   */
  async getSearchSessionsByRun(runId) {
    const { data, error } = await this.db.supabase
      .from('boult_search_sessions')
      .select('*')
      .eq('run_id', runId)
      .eq('user_id', this.userEmail)
      .order('created_at', { ascending: true });

    if (error) return [];
    return data || [];
  }
}
