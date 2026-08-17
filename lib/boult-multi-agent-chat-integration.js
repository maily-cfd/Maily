/**
 * Boult Multi-Agent Integration for ChatInterface - Phase 3
 * 
 * Connects the multi-agent system to the ChatInterface UI:
 * - Real-time agent status display in chat
 * - Agent activity visualization
 * - Multi-agent task orchestration from chat
 * - Agent collaboration display
 * - Agent health monitoring UI
 */

import { AgentCoordinator, AGENT_TYPES } from './boult-agent-coordinator.js';
import { ChatInterfaceIntegration } from './boult-integration-hub.js';
import { executionContextManager } from './boult-execution-context.js';
import { executionTelemetry } from './boult-execution-telemetry.js';

// ============================================================================
// MULTI-AGENT CHAT INTEGRATION
// ============================================================================

export class MultiAgentChatIntegration {
  constructor(options = {}) {
    this.db = options.db;
    this.boultAI = options.boultAI;
    this.userEmail = options.userEmail;
    this.conversationId = options.conversationId;
    
    // Initialize coordinator
    this.coordinator = new AgentCoordinator({
      db: this.db,
      userEmail: this.userEmail
    });
    
    // Base chat integration
    this.baseIntegration = new ChatInterfaceIntegration({
      db: this.db,
      boultAI: this.boultAI,
      userEmail: this.userEmail,
      conversationId: this.conversationId
    });
    
    // UI update callbacks
    this.uiCallbacks = {
      onAgentStatus: null,
      onAgentActivity: null,
      onTaskProgress: null,
      onAgentMessage: null
    };
    
    // Active sessions
    this.sessions = new Map();
  }

  /**
   * Initialize multi-agent system
   */
  async initialize() {
    await this.coordinator.initialize();
    this.setupEventHandlers();
    
    console.log('[MultiAgent] Initialized with', 
      this.coordinator.registry.getStats().total, 'agents');
  }

  /**
   * Set up event handlers for UI updates
   */
  setupEventHandlers() {
    // Agent events
    this.coordinator.on('agent:spawned', ({ agentId, type }) => {
      this.notifyUI('agent:spawned', { agentId, type, name: this.getAgentName(agentId) });
    });

    this.coordinator.on('agent:terminated', ({ agentId }) => {
      this.notifyUI('agent:terminated', { agentId });
    });

    // Task events
    this.coordinator.on('task:submitted', (task) => {
      this.notifyUI('task:submitted', {
        taskId: task.id,
        actionType: task.actionType,
        description: this.getTaskDescription(task)
      });
    });

    this.coordinator.on('task:assigned', ({ taskId, agentId }) => {
      this.notifyUI('task:assigned', {
        taskId,
        agentId,
        agentName: this.getAgentName(agentId)
      });
    });

    this.coordinator.on('task:completed', (task) => {
      this.notifyUI('task:completed', {
        taskId: task.id,
        agentId: task.assignedTo,
        agentName: this.getAgentName(task.assignedTo),
        duration: task.duration,
        result: task.result
      });
    });

    this.coordinator.on('task:failed', (task) => {
      this.notifyUI('task:failed', {
        taskId: task.id,
        agentId: task.assignedTo,
        error: task.error?.message || 'Unknown error'
      });
    });

    // Health events
    this.coordinator.healthMonitor.on('health:timeout', ({ agentId }) => {
      this.notifyUI('agent:unhealthy', { agentId, reason: 'timeout' });
    });

    this.coordinator.healthMonitor.on('health:degraded', ({ agentId, consecutiveFailures }) => {
      this.notifyUI('agent:degraded', { agentId, consecutiveFailures });
    });
  }

  /**
   * Register UI callback
   */
  on(event, callback) {
    this.uiCallbacks[event] = callback;
  }

  /**
   * Notify UI of event
   */
  notifyUI(event, data) {
    const callback = this.uiCallbacks[event];
    if (callback) {
      try {
        callback(data);
      } catch (err) {
        console.error('[MultiAgent] UI callback error:', err);
      }
    }
    
    // Also emit on base integration for backward compatibility
    this.baseIntegration.emit(event, data);
  }

  /**
   * Get agent name
   */
  getAgentName(agentId) {
    const agent = this.coordinator.registry.get(agentId);
    return agent?.name || agentId.slice(-6);
  }

  /**
   * Get task description for UI
   */
  getTaskDescription(task) {
    const descriptions = {
      'send_email': `Send email to ${task.payload?.to}`,
      'save_draft': 'Save email draft',
      'read_inbox': 'Read inbox messages',
      'schedule_meeting': `Schedule meeting with ${task.payload?.attendees?.join(', ')}`,
      'generate_plan': 'Generate execution plan',
      'execute_plan': 'Execute plan',
      'search_email': `Search: ${task.payload?.query}`,
      'tasks_add_task': `Add task: ${task.payload?.title}`,
      'notion_create_page': `Create page: ${task.payload?.title}`
    };
    
    return descriptions[task.actionType] || `${task.actionType}`;
  }

  /**
   * Submit message to multi-agent system
   */
  async submitMessage(message, context = {}) {
    const execContext = executionContextManager.createContext({
      userEmail: this.userEmail,
      conversationId: this.conversationId,
      intent: context.intent
    });

    return executionContextManager.runWithContext(execContext, async () => {
      // Analyze intent
      const intentAnalysis = await this.baseIntegration.boultAIIntegration.analyzeIntent(message, {
        userEmail: this.userEmail,
        userName: context.userName
      });

      // For complex tasks, use multi-agent orchestration
      if (intentAnalysis?.complexity === 'complex' || intentAnalysis?.multiDomain) {
        return await this.orchestrateMultiAgentTask(message, intentAnalysis, context);
      }

      // Simple task - use base integration
      return await this.baseIntegration.executeAction(
        this.mapIntentToAction(intentAnalysis.intent),
        { message, ...context.payload },
        { runId: context.runId }
      );
    });
  }

  /**
   * Orchestrate multi-agent task
   */
  async orchestrateMultiAgentTask(message, intentAnalysis, context) {
    const sessionId = `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // Create session
    const session = {
      id: sessionId,
      message,
      intent: intentAnalysis,
      agents: new Set(),
      tasks: new Map(),
      status: 'orchestrating',
      startedAt: Date.now()
    };
    
    this.sessions.set(sessionId, session);

    try {
      // Step 1: Planner agent generates plan
      const plannerTask = await this.coordinator.submitTask({
        actionType: 'generate_plan',
        payload: {
          message,
          intent: intentAnalysis.intent,
          complexity: intentAnalysis.complexity,
          domains: intentAnalysis.domains
        },
        priority: 'high',
        runId: context.runId
      });

      session.tasks.set(plannerTask.id, plannerTask);

      // Wait for plan generation
      const planResult = await this.waitForTask(plannerTask.id, 30000);
      
      if (!planResult.success) {
        throw new Error('Plan generation failed: ' + planResult.error);
      }

      // Step 2: Executor agent coordinates plan execution
      const executionTasks = [];
      
      for (const step of planResult.plan.steps || []) {
        const agentType = this.selectAgentTypeForStep(step);
        const task = await this.coordinator.submitTask({
          actionType: step.actionType,
          payload: step.payload,
          priority: step.priority || 'normal',
          dependsOn: step.dependsOn,
          runId: context.runId
        });
        
        session.tasks.set(task.id, task);
        executionTasks.push(task);
      }

      // Step 3: Monitor execution
      const results = await this.monitorExecution(session, executionTasks);

      // Step 4: Quality agent reviews results
      const qualityTask = await this.coordinator.submitTask({
        actionType: 'validate_output',
        payload: {
          results,
          originalMessage: message,
          intent: intentAnalysis.intent
        }
      });

      const qualityResult = await this.waitForTask(qualityTask.id, 15000);

      session.status = 'completed';
      session.completedAt = Date.now();

      return {
        success: results.every(r => r.success),
        sessionId,
        plan: planResult.plan,
        results,
        quality: qualityResult,
        agents: Array.from(session.agents),
        duration: session.completedAt - session.startedAt
      };

    } catch (error) {
      session.status = 'failed';
      session.error = error.message;
      
      return {
        success: false,
        sessionId,
        error: error.message,
        agents: Array.from(session.agents)
      };
    }
  }

  /**
   * Select appropriate agent type for step
   */
  selectAgentTypeForStep(step) {
    const mapping = {
      'email': AGENT_TYPES.EMAIL_AGENT,
      'calendar': AGENT_TYPES.CALENDAR_AGENT,
      'research': AGENT_TYPES.RESEARCH_AGENT,
      'analytics': AGENT_TYPES.ANALYTICS_AGENT,
      'tasks': AGENT_TYPES.TASKS_AGENT,
      'notion': AGENT_TYPES.NOTION_AGENT
    };

    return mapping[step.domain] || AGENT_TYPES.FALLBACK_AGENT;
  }

  /**
   * Wait for task completion
   */
  async waitForTask(taskId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const task = this.coordinator.completedTasks.get(taskId) ||
                    this.coordinator.failedTasks.get(taskId);
        
        if (task) {
          clearInterval(checkInterval);
          clearTimeout(timeoutTimer);
          resolve(task);
        }
      }, 100);

      const timeoutTimer = setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error(`Task ${taskId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Monitor execution of multiple tasks
   */
  async monitorExecution(session, tasks) {
    const results = [];
    const pending = new Set(tasks.map(t => t.id));
    const completed = new Set();
    const failed = new Set();

    // Track which agents are working on this session
    tasks.forEach(task => {
      const agentId = task.assignedTo;
      if (agentId) {
        session.agents.add(agentId);
      }
    });

    // Update UI with active agents
    this.notifyUI('agents:active', {
      sessionId: session.id,
      agents: Array.from(session.agents).map(id => ({
        id,
        name: this.getAgentName(id),
        type: this.coordinator.registry.get(id)?.type
      }))
    });

    // Wait for all tasks
    while (pending.size > 0) {
      // Check for completed tasks
      for (const taskId of pending) {
        const completedTask = this.coordinator.completedTasks.get(taskId);
        const failedTask = this.coordinator.failedTasks.get(taskId);

        if (completedTask) {
          pending.delete(taskId);
          completed.add(taskId);
          results.push(completedTask.result);

          this.notifyUI('task:progress', {
            sessionId: session.id,
            completed: completed.size,
            total: tasks.length,
            percentage: Math.round((completed.size / tasks.length) * 100)
          });
        } else if (failedTask) {
          pending.delete(taskId);
          failed.add(taskId);
          results.push({ success: false, error: failedTask.error });

          // Check if we should retry
          if (failedTask.retries < (failedTask.maxRetries || 3)) {
            // Retry will be handled by coordinator
          }
        }
      }

      if (pending.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Map intent to action type
   */
  mapIntentToAction(intent) {
    const mapping = {
      'reply': 'send_email',
      'draft': 'save_draft',
      'search': 'search_email',
      'read': 'read_inbox',
      'schedule': 'schedule_meeting',
      'plan': 'generate_plan',
      'execute': 'execute_plan'
    };
    
    return mapping[intent] || 'generic_task';
  }

  /**
   * Get real-time agent status for UI
   */
  getAgentStatus() {
    const agents = this.coordinator.registry.getAll();
    
    return agents.map(agent => {
      const status = agent.getStatus();
      return {
        id: status.id,
        name: status.name,
        type: status.type,
        status: status.status,
        currentTask: status.currentTask,
        queueLength: status.queueLength,
        metrics: {
          tasksCompleted: status.metrics.tasksCompleted,
          tasksFailed: status.metrics.tasksFailed,
          averageExecutionTime: Math.round(status.metrics.averageExecutionTime)
        },
        health: status.health
      };
    });
  }

  /**
   * Get active sessions
   */
  getSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      status: session.status,
      agents: Array.from(session.agents).map(id => this.getAgentName(id)),
      tasks: session.tasks.size,
      duration: session.completedAt 
        ? session.completedAt - session.startedAt 
        : Date.now() - session.startedAt
    }));
  }

  /**
   * Get coordinator statistics
   */
  getStats() {
    return {
      agents: this.coordinator.getStatus(),
      sessions: {
        active: Array.from(this.sessions.values()).filter(s => s.status === 'orchestrating').length,
        completed: Array.from(this.sessions.values()).filter(s => s.status === 'completed').length,
        failed: Array.from(this.sessions.values()).filter(s => s.status === 'failed').length
      },
      telemetry: executionTelemetry.collector?.getStats() || {}
    };
  }

  /**
   * Shutdown multi-agent system
   */
  async shutdown() {
    await this.coordinator.shutdown();
    this.sessions.clear();
  }
}

// ============================================================================
// REACT HOOK FOR CHAT INTERFACE
// ============================================================================

export function useMultiAgent(options) {
  const [integration, setIntegration] = React.useState(null);
  const [agents, setAgents] = React.useState([]);
  const [sessions, setSessions] = React.useState([]);
  const [stats, setStats] = React.useState(null);

  React.useEffect(() => {
    let interval;

    async function init() {
      const multiAgent = new MultiAgentChatIntegration(options);
      await multiAgent.initialize();

      // Set up UI callbacks
      multiAgent.on('agent:spawned', () => refreshAgents(multiAgent));
      multiAgent.on('agent:terminated', () => refreshAgents(multiAgent));
      multiAgent.on('task:completed', () => refreshStats(multiAgent));

      setIntegration(multiAgent);

      // Start polling for updates
      interval = setInterval(() => {
        refreshAgents(multiAgent);
        refreshSessions(multiAgent);
        refreshStats(multiAgent);
      }, 2000);
    }

    init();

    return () => {
      clearInterval(interval);
      integration?.shutdown();
    };
  }, []);

  async function refreshAgents(multiAgent) {
    setAgents(multiAgent.getAgentStatus());
  }

  async function refreshSessions(multiAgent) {
    setSessions(multiAgent.getSessions());
  }

  async function refreshStats(multiAgent) {
    setStats(multiAgent.getStats());
  }

  const submitMessage = async (message, context) => {
    return await integration?.submitMessage(message, context);
  };

  return {
    agents,
    sessions,
    stats,
    submitMessage,
    isReady: !!integration
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  MultiAgentChatIntegration,
  useMultiAgent
};
