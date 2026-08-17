/**
 * Boult Database Query Layer
 * 
 * Complete CRUD operations for all tables:
 * - Users, Runs, Steps, Plans, Todos
 * - Connected Accounts, Usage Logs
 * - Audit Log, Webhooks
 * 
 * All operations with proper typing, error handling, and joins.
 */

export class DatabaseQueryLayer {
  constructor(supabase) {
    this.supabase = supabase;
  }

  // ============================================================================
  // USER OPERATIONS
  // ============================================================================

  async getUserById(userId) {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    return data;
  }

  async createUser(userData) {
    const { data, error } = await this.supabase
      .from('users')
      .insert(userData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async updateUser(userId, updates) {
    const { data, error } = await this.supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // ============================================================================
  // OPERATOR RUNS
  // ============================================================================

  async createRun(runData) {
    const { data, error } = await this.supabase
      .from('boult_operator_runs')
      .insert({
        run_id: runData.runId,
        user_id: runData.userId,
        conversation_id: runData.conversationId,
        mission_id: runData.missionId,
        status: runData.status || 'initializing',
        phase: runData.phase || 'thinking',
        intent: runData.intent,
        complexity: runData.complexity,
        plan_snapshot: runData.planSnapshot || [],
        plan_id: runData.planId,
        memory: runData.memory || {},
        started_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async getRunById(runId, userId) {
    const { data, error } = await this.supabase
      .from('boult_operator_runs')
      .select(`
        *,
        boult_operator_run_steps (
          id,
          step_id,
          order,
          kind,
          status,
          label,
          started_at,
          completed_at,
          duration_ms
        )
      `)
      .eq('run_id', runId)
      .eq('user_id', userId)
      .single();
    
    if (error) throw error;
    return data;
  }

  async updateRunStatus(runId, userId, updates) {
    const updateData = {};
    
    if (updates.status) updateData.status = updates.status;
    if (updates.phase) updateData.phase = updates.phase;
    if (updates.completedAt) updateData.completed_at = updates.completedAt;
    if (updates.failedAt) updateData.failed_at = updates.failedAt;
    if (updates.cancelledAt) updateData.cancelled_at = updates.cancelledAt;
    if (updates.errorMessage) updateData.error_message = updates.errorMessage;
    if (updates.errorCategory) updateData.error_category = updates.errorCategory;
    if (updates.totalDurationMs) updateData.total_duration_ms = updates.totalDurationMs;
    if (updates.memory) updateData.memory = updates.memory;
    if (updates.planSnapshot) updateData.plan_snapshot = updates.planSnapshot;
    
    const { data, error } = await this.supabase
      .from('boult_operator_runs')
      .update(updateData)
      .eq('run_id', runId)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async listUserRuns(userId, options = {}) {
    let query = this.supabase
      .from('boult_operator_runs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (options.status) {
      query = query.eq('status', options.status);
    }
    
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data || [];
  }

  // ============================================================================
  // OPERATOR RUN STEPS
  // ============================================================================

  async createSteps(runId, userId, steps) {
    const stepRecords = steps.map((step, index) => ({
      run_id: runId,
      user_id: userId,
      step_id: step.id || `step-${index}`,
      order: step.order || index,
      kind: step.kind || 'action',
      status: step.status || 'pending',
      label: step.label,
      detail: step.detail,
      depends_on: step.dependsOn || [],
      max_attempts: step.maxAttempts || 3
    }));
    
    const { data, error } = await this.supabase
      .from('boult_operator_run_steps')
      .insert(stepRecords)
      .select();
    
    if (error) throw error;
    return data;
  }

  async updateStepStatus(stepId, runId, updates) {
    const updateData = {};
    
    if (updates.status) updateData.status = updates.status;
    if (updates.startedAt) updateData.started_at = updates.startedAt;
    if (updates.completedAt) updateData.completed_at = updates.completedAt;
    if (updates.failedAt) updateData.failed_at = updates.failedAt;
    if (updates.durationMs) updateData.duration_ms = updates.durationMs;
    if (updates.attemptCount) updateData.attempt_count = updates.attemptCount;
    if (updates.errorMessage) updateData.error_message = updates.errorMessage;
    if (updates.errorCategory) updateData.error_category = updates.errorCategory;
    if (updates.evidence) updateData.evidence = updates.evidence;
    
    // Get run UUID from run_id string
    const { data: run } = await this.supabase
      .from('boult_operator_runs')
      .select('id')
      .eq('run_id', runId)
      .single();
    
    if (!run) throw new Error('Run not found');
    
    const { data, error } = await this.supabase
      .from('boult_operator_run_steps')
      .update(updateData)
      .eq('run_id', run.id)
      .eq('step_id', stepId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // ============================================================================
  // CONNECTED ACCOUNTS
  // ============================================================================

  async createConnectedAccount(accountData) {
    const { data, error } = await this.supabase
      .from('connected_accounts')
      .insert({
        user_id: accountData.userId,
        connector_id: accountData.connectorId,
        provider: accountData.provider,
        access_token_encrypted: accountData.accessTokenEncrypted,
        refresh_token_encrypted: accountData.refreshTokenEncrypted,
        token_expires_at: accountData.tokenExpiresAt,
        scopes: accountData.scopes || [],
        email: accountData.email,
        name: accountData.name,
        external_user_id: accountData.externalUserId,
        status: accountData.status || 'connecting',
        settings: accountData.settings || {}
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async getConnectedAccount(accountId, userId) {
    const { data, error } = await this.supabase
      .from('connected_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();
    
    if (error) throw error;
    return data;
  }

  async getConnectedAccountByConnector(userId, connectorId) {
    const { data, error } = await this.supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('connector_id', connectorId)
      .eq('status', 'connected')
      .maybeSingle();
    
    if (error) throw error;
    return data;
  }

  async listUserConnectedAccounts(userId) {
    const { data, error } = await this.supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .order('connected_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  async updateConnectedAccount(accountId, userId, updates) {
    const updateData = {};
    
    if (updates.accessTokenEncrypted !== undefined) {
      updateData.access_token_encrypted = updates.accessTokenEncrypted;
    }
    if (updates.refreshTokenEncrypted !== undefined) {
      updateData.refresh_token_encrypted = updates.refreshTokenEncrypted;
    }
    if (updates.tokenExpiresAt !== undefined) {
      updateData.token_expires_at = updates.tokenExpiresAt;
    }
    if (updates.status) updateData.status = updates.status;
    if (updates.lastUsedAt) updateData.last_used_at = updates.lastUsedAt;
    if (updates.lastError) updateData.last_error = updates.lastError;
    if (updates.errorCount !== undefined) updateData.error_count = updates.errorCount;
    if (updates.settings) updateData.settings = updates.settings;
    
    const { data, error } = await this.supabase
      .from('connected_accounts')
      .update(updateData)
      .eq('id', accountId)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async deleteConnectedAccount(accountId, userId) {
    const { error } = await this.supabase
      .from('connected_accounts')
      .delete()
      .eq('id', accountId)
      .eq('user_id', userId);
    
    if (error) throw error;
    return { success: true };
  }

  // ============================================================================
  // CONNECTOR USAGE LOG
  // ============================================================================

  async logConnectorUsage(usageData) {
    const { data, error } = await this.supabase
      .from('connector_usage_log')
      .insert({
        account_id: usageData.accountId,
        connector_id: usageData.connectorId,
        user_id: usageData.userId,
        action: usageData.action,
        action_type: usageData.actionType,
        request_payload: usageData.requestPayload,
        response_payload: usageData.responsePayload,
        started_at: usageData.startedAt,
        completed_at: usageData.completedAt,
        duration_ms: usageData.durationMs,
        success: usageData.success,
        error_message: usageData.errorMessage,
        error_code: usageData.errorCode,
        ip_address: usageData.ipAddress,
        user_agent: usageData.userAgent
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async getConnectorUsageStats(userId, connectorId, options = {}) {
    let query = this.supabase
      .from('connector_usage_log')
      .select('*')
      .eq('user_id', userId)
      .eq('connector_id', connectorId);
    
    if (options.since) {
      query = query.gte('created_at', options.since);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Calculate stats
    const total = data?.length || 0;
    const successful = data?.filter(d => d.success).length || 0;
    const failed = total - successful;
    const avgDuration = total > 0 
      ? (data?.reduce((sum, d) => sum + (d.duration_ms || 0), 0) || 0) / total 
      : 0;
    
    return {
      total,
      successful,
      failed,
      avgDuration: Math.round(avgDuration),
      recentCalls: data?.slice(0, 10) || []
    };
  }

  // ============================================================================
  // AUDIT LOG
  // ============================================================================

  async logAuditEvent(eventData) {
    const { data, error } = await this.supabase
      .from('audit_log')
      .insert({
        user_id: eventData.userId,
        event_type: eventData.eventType,
        event_category: eventData.eventCategory,
        payload: eventData.payload,
        run_id: eventData.runId,
        step_id: eventData.stepId,
        plan_id: eventData.planId,
        todo_id: eventData.todoId,
        action_type: eventData.actionType,
        ip_address: eventData.ipAddress,
        user_agent: eventData.userAgent,
        session_id: eventData.sessionId
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async getAuditLog(userId, options = {}) {
    let query = this.supabase
      .from('audit_log')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (options.eventType) {
      query = query.eq('event_type', options.eventType);
    }
    
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data || [];
  }

  // ============================================================================
  // PLAN ARTIFACTS
  // ============================================================================

  async createPlanArtifact(planData) {
    const { data, error } = await this.supabase
      .from('boult_plan_artifacts')
      .insert({
        plan_id: planData.planId,
        user_id: planData.userId,
        run_id: planData.runId,
        conversation_id: planData.conversationId,
        title: planData.title,
        objective: planData.objective,
        assumptions: planData.assumptions || [],
        questions_answered: planData.questionsAnswered || [],
        acceptance_criteria: planData.acceptanceCriteria || [],
        status: planData.status || 'draft'
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async getPlanArtifact(planId, userId) {
    const { data, error } = await this.supabase
      .from('boult_plan_artifacts')
      .select(`
        *,
        boult_todo_items (
          id,
          todo_id,
          title,
          description,
          status,
          action_type,
          started_at,
          completed_at
        )
      `)
      .eq('plan_id', planId)
      .eq('user_id', userId)
      .single();
    
    if (error) throw error;
    return data;
  }

  // ============================================================================
  // TODO ITEMS
  // ============================================================================

  async createTodoItems(planId, userId, todos) {
    const todoRecords = todos.map((todo, index) => ({
      todo_id: todo.id || `todo-${index}`,
      plan_id: planId,
      user_id: userId,
      title: todo.title,
      description: todo.description,
      status: todo.status || 'pending',
      action_type: todo.actionType,
      action_payload: todo.actionPayload,
      depends_on: todo.dependsOn || [],
      approval_mode: todo.approvalMode || 'conditional',
      max_attempts: todo.maxAttempts || 3,
      retry_policy: todo.retryPolicy || {}
    }));
    
    const { data, error } = await this.supabase
      .from('boult_todo_items')
      .insert(todoRecords)
      .select();
    
    if (error) throw error;
    return data;
  }

  async updateTodoStatus(todoId, userId, updates) {
    const updateData = {};
    
    if (updates.status) updateData.status = updates.status;
    if (updates.startedAt) updateData.started_at = updates.startedAt;
    if (updates.completedAt) updateData.completed_at = updates.completedAt;
    if (updates.failedAt) updateData.failed_at = updates.failedAt;
    if (updates.durationMs) updateData.duration_ms = updates.durationMs;
    if (updates.attemptCount) updateData.attempt_count = updates.attemptCount;
    if (updates.resultPayload) updateData.result_payload = updates.resultPayload;
    if (updates.errorMessage) updateData.error_message = updates.errorMessage;
    if (updates.errorCategory) updateData.error_category = updates.errorCategory;
    if (updates.approvedAt) updateData.approved_at = updates.approvedAt;
    
    const { data, error } = await this.supabase
      .from('boult_todo_items')
      .update(updateData)
      .eq('todo_id', todoId)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  async transaction(callback) {
    // Note: Supabase doesn't support true transactions in the REST API
    // For atomic operations, use RPC calls to database functions
    return await callback(this);
  }

  async bulkInsert(table, records) {
    const { data, error } = await this.supabase
      .from(table)
      .insert(records)
      .select();
    
    if (error) throw error;
    return data;
  }
}

export default DatabaseQueryLayer;
