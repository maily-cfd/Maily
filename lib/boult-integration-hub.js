/**
 * Boult Integration Hub - Phases 1 & 2 Connection Layer
 * 
 * Connects all execution contract components to:
 * - ChatInterface (UI layer)
 * - Boult AI Service (AI layer)
 * - chat-boult API route (HTTP layer)
 * 
 * Provides unified interface for:
 * - Plan generation and execution
 * - Action execution with retries/idempotency
 * - Real-time status updates
 * - Error handling and recovery
 */

import { BoultOperatorRuntime } from './boult-operator-runtime-v2.js';
import { CanonicalExecutionAdapter, legacyRegistry } from './boult-execution-adapter.js';
import { executionContextManager } from './boult-execution-context.js';
import { executionTelemetry, EXECUTION_METRICS } from './boult-execution-telemetry.js';
import { 
  EXECUTION_STATUS, 
  buildActionResult,
  categorizeError 
} from './boult-execution-contract.js';
import { BoultPlanEngine } from './boult-plan-engine.js';
import { PlanModeEngine } from './boult-plan-mode-engine.js';

// ============================================================================
// CHAT INTERFACE INTEGRATION
// ============================================================================

export class ChatInterfaceIntegration {
  constructor(options = {}) {
    this.db = options.db;
    this.boultAI = options.boultAI;
    this.userEmail = options.userEmail;
    this.conversationId = options.conversationId;
    
    // Initialize Phase 1 & 2 components
    this.runtime = new BoultOperatorRuntime({
      db: this.db,
      boultAI: this.boultAI,
      userEmail: this.userEmail,
      conversationId: this.conversationId
    });
    
    this.adapter = new CanonicalExecutionAdapter({
      db: this.db,
      userEmail: this.userEmail,
      boultAI: this.boultAI
    });
    
    this.planEngine = new BoultPlanEngine({
      db: this.db,
      userEmail: this.userEmail
    });
    
    this.planModeEngine = new PlanModeEngine({
      boultAI: this.boultAI,
      db: this.db,
      userEmail: this.userEmail
    });
    
    // Event handlers for UI updates
    this.eventHandlers = new Map();
  }

  /**
   * Register event handler for UI updates
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  /**
   * Emit event to UI
   */
  emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach(h => {
      try {
        h(data);
      } catch (err) {
        console.error(`[Integration] Event handler error for ${event}:`, err);
      }
    });
  }

  /**
   * Initialize a new chat session with execution context
   */
  async initializeSession(intent, complexity = 'simple') {
    const context = executionContextManager.createContext({
      userEmail: this.userEmail,
      conversationId: this.conversationId,
      intent,
      complexity
    });

    executionContextManager.runWithContext(context, () => {
      executionTelemetry.onRunStarted({
        runId: context.executionId,
        intent,
        complexity
      });
    });

    return {
      sessionId: context.executionId,
      context,
      status: 'initialized'
    };
  }

  /**
   * Generate AI plan for complex intent (Phase 2)
   */
  async generatePlan(message, context = {}) {
    const runId = context.runId || this.runtime.generateRunId();
    
    // Create execution context
    const execContext = executionContextManager.createContext({
      userEmail: this.userEmail,
      conversationId: this.conversationId,
      runId,
      actionType: 'generate_plan'
    });

    return executionContextManager.runWithContext(execContext, async () => {
      try {
        // Generate AI plan
        const planResult = await this.planModeEngine.generatePlan({
          message,
          runId,
          conversationId: this.conversationId,
          context: context.emailContext || context.notesResult,
          intent: context.intent || 'general',
          complexity: context.complexity || 'complex'
        });

        // Emit plan generated event for UI
        this.emit('plan:generated', {
          planId: planResult.planId,
          title: planResult.plan.title,
          objective: planResult.plan.objective,
          todos: planResult.todos,
          status: 'draft'
        });

        return {
          success: true,
          plan: planResult.plan,
          todos: planResult.todos,
          planId: planResult.planId
        };
      } catch (error) {
        executionTelemetry.onRunFailed(
          { runId, intent: context.intent },
          { category: categorizeError(error), message: error.message },
          0
        );

        return {
          success: false,
          error: error.message
        };
      }
    });
  }

  /**
   * Execute plan with full Phase 1 guarantees
   */
  async executePlan(planId, options = {}) {
    const execContext = executionContextManager.createContext({
      userEmail: this.userEmail,
      conversationId: this.conversationId,
      planId,
      actionType: 'execute_plan'
    });

    return executionContextManager.runWithContext(execContext, async () => {
      try {
        // Approve and convert plan to todos
        await this.planEngine.approvePlan(planId);
        const todos = await this.planEngine.convertPlanToTodoGraph(planId);

        // Execute todos through runtime
        const results = [];
        for (const todo of todos) {
          const result = await this.executeTodo(todo, options);
          results.push(result);

          // Emit progress update
          this.emit('todo:progress', {
            todoId: todo.todoId,
            status: result.success ? 'completed' : 'failed',
            progress: Math.round((results.length / todos.length) * 100)
          });
        }

        return {
          success: results.every(r => r.success),
          results,
          completed: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    });
  }

  /**
   * Execute single todo item
   */
  async executeTodo(todo, options = {}) {
    const actionType = todo.actionType;
    const payload = todo.actionPayload || todo.payload || {};

    // Execute through canonical adapter
    const result = await this.adapter.execute(actionType, payload, {
      runId: options.runId,
      conversationId: this.conversationId,
      todoId: todo.todoId,
      retryPolicy: todo.retryPolicy,
      approvalMode: todo.approvalMode
    });

    return result;
  }

  /**
   * Execute action with full Phase 1 guarantees (idempotency, retries, approval)
   */
  async executeAction(actionType, payload, options = {}) {
    const execContext = executionContextManager.createContext({
      userEmail: this.userEmail,
      conversationId: this.conversationId,
      actionType,
      runId: options.runId
    });

    return executionContextManager.runWithContext(execContext, async () => {
      // Check if approval needed
      const metadata = this.adapter.getActionMetadata(actionType);
      
      if (metadata?.approvalMode === 'manual' && !options.approvalToken) {
        // Return approval required
        return {
          success: false,
          status: 'approval_required',
          message: 'This action requires user approval',
          externalRefs: {
            actionType,
            payload,
            requiresApproval: true
          }
        };
      }

      // Execute with approval token if provided
      if (options.approvalToken) {
        return await this.adapter.executeWithApproval(
          actionType,
          payload,
          options.approvalToken,
          options
        );
      }

      // Execute directly
      return await this.adapter.execute(actionType, payload, options);
    });
  }

  /**
   * Get real-time run status for UI
   */
  async getRunStatus(runId) {
    return await this.runtime.getRunStatus(runId);
  }

  /**
   * Subscribe to run updates
   */
  async subscribeToRun(runId, callback) {
    const interval = setInterval(async () => {
      const status = await this.getRunStatus(runId);
      callback(status);

      if (status.progress?.isComplete) {
        clearInterval(interval);
      }
    }, 2000);

    // Return unsubscribe function
    return () => clearInterval(interval);
  }

  /**
   * Handle user approval from ChatInterface
   */
  async handleUserApproval(actionType, payload, approvalToken, options = {}) {
    return await this.executeAction(actionType, payload, {
      ...options,
      approvalToken,
      requiresApproval: false
    });
  }

  /**
   * Get telemetry metrics for display
   */
  getTelemetryMetrics() {
    return executionTelemetry.collector?.getStats() || {};
  }
}

// ============================================================================
// BOULT AI SERVICE INTEGRATION
// ============================================================================

export class BoultAIIntegration {
  constructor(options = {}) {
    this.boultAI = options.boultAI;
    this.db = options.db;
    this.userEmail = options.userEmail;
    this.contextManager = executionContextManager;
    this.telemetry = executionTelemetry;
  }

  /**
   * Enhanced AI response with execution context
   */
  async generateResponse(message, context = {}) {
    const execContext = this.contextManager.createContext({
      userEmail: this.userEmail,
      ...context
    });

    return this.contextManager.runWithContext(execContext, async () => {
      // Record AI call start
      this.telemetry.collector?.startSpan('ai_generate_response', {
        attributes: { message_length: message.length }
      });

      try {
        const response = await this.boultAI.generateResponse(message, context);
        
        // Record success
        this.telemetry.collector?.endSpan('ai_generate_response', 'ok', {
          response_length: response?.length || 0
        });

        return response;
      } catch (error) {
        // Record failure
        this.telemetry.collector?.endSpan('ai_generate_response', 'error', {
          error: error.message
        });
        throw error;
      }
    });
  }

  /**
   * Analyze intent with execution context
   */
  async analyzeIntent(message, context = {}) {
    const execContext = this.contextManager.createContext({
      userEmail: this.userEmail,
      actionType: 'analyze_intent',
      ...context
    });

    return this.contextManager.runWithContext(execContext, async () => {
      this.telemetry.collector?.startSpan('ai_analyze_intent');

      try {
        const analysis = await this.boultAI.analyzeIntentAndPlan(message, {
          userEmail: this.userEmail,
          userName: context.userName,
          ...context
        });

        this.telemetry.collector?.endSpan('ai_analyze_intent', 'ok', {
          intent: analysis?.intent,
          complexity: analysis?.complexity
        });

        return analysis;
      } catch (error) {
        this.telemetry.collector?.endSpan('ai_analyze_intent', 'error');
        throw error;
      }
    });
  }

  /**
   * Generate canvas content with execution context
   */
  async generateCanvas(message, canvasType, emailContext, options = {}) {
    const execContext = this.contextManager.createContext({
      userEmail: this.userEmail,
      actionType: 'generate_canvas',
      ...options
    });

    return this.contextManager.runWithContext(execContext, async () => {
      this.telemetry.collector?.startSpan('ai_generate_canvas', {
        attributes: { canvas_type: canvasType }
      });

      try {
        const canvas = await this.boultAI.generateCanvasContent(
          message,
          canvasType,
          emailContext,
          options
        );

        this.telemetry.collector?.endSpan('ai_generate_canvas', 'ok');
        return canvas;
      } catch (error) {
        this.telemetry.collector?.endSpan('ai_generate_canvas', 'error');
        throw error;
      }
    });
  }
}

// ============================================================================
// API ROUTE INTEGRATION
// ============================================================================

export class APIRouteIntegration {
  constructor(options = {}) {
    this.db = options.db;
    this.boultAI = options.boultAI;
    this.contextManager = executionContextManager;
  }

  /**
   * Create integration for request
   */
  createForRequest(request) {
    const userEmail = request.user?.email;
    const conversationId = request.body?.conversationId;

    return new ChatInterfaceIntegration({
      db: this.db,
      boultAI: this.boultAI,
      userEmail,
      conversationId
    });
  }

  /**
   * Middleware to inject integration
   */
  middleware() {
    return (req, res, next) => {
      req.boultIntegration = this.createForRequest(req);
      next();
    };
  }

  /**
   * Handle plan generation request
   */
  async handlePlanGeneration(req, res) {
    const { message, context } = req.body;
    const integration = req.boultIntegration;

    try {
      const result = await integration.generatePlan(message, context);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle plan execution request
   */
  async handlePlanExecution(req, res) {
    const { planId, options } = req.body;
    const integration = req.boultIntegration;

    try {
      const result = await integration.executePlan(planId, options);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle action execution request
   */
  async handleActionExecution(req, res) {
    const { actionType, payload, approvalToken } = req.body;
    const integration = req.boultIntegration;

    try {
      const result = await integration.executeAction(actionType, payload, {
        approvalToken
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle approval request
   */
  async handleApproval(req, res) {
    const { actionType, payload, approvalToken } = req.body;
    const integration = req.boultIntegration;

    try {
      const result = await integration.handleUserApproval(
        actionType,
        payload,
        approvalToken
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle run status request
   */
  async handleRunStatus(req, res) {
    const { runId } = req.params;
    const integration = req.boultIntegration;

    try {
      const status = await integration.getRunStatus(runId);
      res.json(status);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

// ============================================================================
// UNIFIED EXPORT
// ============================================================================

export class BoultIntegrationHub {
  constructor(options = {}) {
    this.db = options.db;
    this.boultAI = options.boultAI;
    
    this.chatInterface = new ChatInterfaceIntegration(options);
    this.boultAIIntegration = new BoultAIIntegration(options);
    this.apiRoute = new APIRouteIntegration(options);
  }

  /**
   * Full workflow: Intent → Plan → Execution
   */
  async executeFullWorkflow(message, options = {}) {
    // Step 1: Analyze intent
    const intentAnalysis = await this.boultAIIntegration.analyzeIntent(message, {
      userEmail: options.userEmail,
      userName: options.userName
    });

    // Step 2: Generate plan if complex
    let planResult = null;
    if (intentAnalysis?.complexity === 'complex' || intentAnalysis?.intent === 'multi_step') {
      planResult = await this.chatInterface.generatePlan(message, {
        intent: intentAnalysis.intent,
        complexity: intentAnalysis.complexity,
        emailContext: options.emailContext
      });
    }

    // Step 3: Execute
    let executionResult = null;
    if (planResult?.success) {
      executionResult = await this.chatInterface.executePlan(planResult.planId, {
        runId: options.runId
      });
    }

    return {
      intent: intentAnalysis,
      plan: planResult,
      execution: executionResult,
      status: executionResult?.success ? 'completed' : 'pending'
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  ChatInterfaceIntegration,
  BoultAIIntegration,
  APIRouteIntegration,
  BoultIntegrationHub,
  // Re-export for convenience
  executionContextManager,
  executionTelemetry,
  EXECUTION_STATUS
};
