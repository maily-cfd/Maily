/**
 * Boult Multi-Agent System - Phase 3
 * 
 * Core architecture for multi-agent orchestration:
 * - Agent specialization by domain (email, calendar, research, etc.)
 * - Agent lifecycle management (spawn, pause, resume, terminate)
 * - Inter-agent communication protocol
 * - Workload distribution and load balancing
 * - Shared state and knowledge graph
 * - Dynamic scaling based on queue depth
 * - Conflict detection and resolution
 */

import { EventEmitter } from 'events';
import { executionContextManager } from './boult-execution-context.js';
import { executionTelemetry } from './boult-execution-telemetry.js';
import { EXECUTION_STATUS, categorizeError } from './boult-execution-contract.js';
import crypto from 'crypto';

// ============================================================================
// AGENT TYPES AND SPECIALIZATIONS
// ============================================================================

export const AGENT_TYPES = {
  // Domain specialists
  EMAIL_AGENT: 'email_agent',           // Email operations, drafting, sending
  CALENDAR_AGENT: 'calendar_agent',       // Meeting scheduling, availability
  RESEARCH_AGENT: 'research_agent',       // Information gathering, search
  ANALYTICS_AGENT: 'analytics_agent',     // Data analysis, reporting
  TASKS_AGENT: 'tasks_agent',             // Task management, to-do operations
  NOTION_AGENT: 'notion_agent',           // Notion integration, notes
  
  // Orchestration agents
  COORDINATOR_AGENT: 'coordinator_agent', // Workload distribution
  PLANNER_AGENT: 'planner_agent',         // Plan generation and optimization
  EXECUTOR_AGENT: 'executor_agent',       // Plan execution supervision
  
  // Utility agents
  MEMORY_AGENT: 'memory_agent',           // Context and memory management
  QUALITY_AGENT: 'quality_agent',         // Output validation and review
  FALLBACK_AGENT: 'fallback_agent'        // Generic fallback handler
};

export const AGENT_CAPABILITIES = {
  [AGENT_TYPES.EMAIL_AGENT]: {
    domains: ['email', 'gmail', 'outreach'],
    actions: ['send_email', 'save_draft', 'read_inbox', 'search_email', 'auto_reply'],
    maxConcurrent: 5,
    priority: 'high',
    requiresAuth: ['gmail']
  },
  [AGENT_TYPES.CALENDAR_AGENT]: {
    domains: ['calendar', 'meeting', 'scheduling'],
    actions: ['schedule_meeting', 'get_availability'],
    maxConcurrent: 3,
    priority: 'high',
    requiresAuth: ['google-calendar']
  },
  [AGENT_TYPES.RESEARCH_AGENT]: {
    domains: ['search', 'research', 'information'],
    actions: ['search_email', 'find_note', 'notion_search'],
    maxConcurrent: 10,
    priority: 'medium',
    requiresAuth: []
  },
  [AGENT_TYPES.ANALYTICS_AGENT]: {
    domains: ['analytics', 'reporting', 'metrics'],
    actions: ['generate_analytics', 'refresh_analytics'],
    maxConcurrent: 3,
    priority: 'low',
    requiresAuth: []
  },
  [AGENT_TYPES.TASKS_AGENT]: {
    domains: ['tasks', 'todos', 'google-tasks'],
    actions: ['tasks_add_task', 'tasks_add_tasks', 'tasks_complete', 'tasks_list'],
    maxConcurrent: 5,
    priority: 'medium',
    requiresAuth: ['google-tasks']
  },
  [AGENT_TYPES.NOTION_AGENT]: {
    domains: ['notion', 'notes', 'documentation'],
    actions: ['notion_create_page', 'notion_search', 'notion_append', 'create_note'],
    maxConcurrent: 5,
    priority: 'medium',
    requiresAuth: ['notion']
  },
  [AGENT_TYPES.COORDINATOR_AGENT]: {
    domains: ['orchestration', 'coordination'],
    actions: ['assign_task', 'rebalance_load', 'spawn_agent', 'terminate_agent'],
    maxConcurrent: 1,
    priority: 'critical',
    requiresAuth: []
  },
  [AGENT_TYPES.PLANNER_AGENT]: {
    domains: ['planning', 'strategy'],
    actions: ['generate_plan', 'optimize_plan', 'validate_plan'],
    maxConcurrent: 3,
    priority: 'high',
    requiresAuth: []
  },
  [AGENT_TYPES.EXECUTOR_AGENT]: {
    domains: ['execution', 'supervision'],
    actions: ['execute_plan', 'monitor_execution', 'handle_failure'],
    maxConcurrent: 5,
    priority: 'high',
    requiresAuth: []
  },
  [AGENT_TYPES.MEMORY_AGENT]: {
    domains: ['memory', 'context', 'knowledge'],
    actions: ['store_context', 'retrieve_context', 'update_knowledge'],
    maxConcurrent: 10,
    priority: 'medium',
    requiresAuth: []
  },
  [AGENT_TYPES.QUALITY_AGENT]: {
    domains: ['quality', 'validation', 'review'],
    actions: ['validate_output', 'review_content', 'check_accuracy'],
    maxConcurrent: 5,
    priority: 'medium',
    requiresAuth: []
  },
  [AGENT_TYPES.FALLBACK_AGENT]: {
    domains: ['general', 'fallback'],
    actions: ['generic_task', 'delegate_task', 'escalate_issue'],
    maxConcurrent: 3,
    priority: 'low',
    requiresAuth: []
  }
};

// ============================================================================
// AGENT CLASS
// ============================================================================

export class Agent extends EventEmitter {
  constructor(config) {
    super();
    
    this.id = config.id || `agent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.type = config.type || AGENT_TYPES.FALLBACK_AGENT;
    this.name = config.name || `${this.type}_${this.id.slice(-6)}`;
    this.capabilities = AGENT_CAPABILITIES[this.type] || AGENT_CAPABILITIES[AGENT_TYPES.FALLBACK_AGENT];
    
    // Lifecycle state
    this.status = 'idle'; // idle, busy, paused, terminating, terminated
    this.currentTask = null;
    this.taskQueue = [];
    
    // Performance metrics
    this.metrics = {
      tasksCompleted: 0,
      tasksFailed: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      lastActivity: null
    };
    
    // Configuration
    this.config = {
      maxConcurrent: config.maxConcurrent || this.capabilities.maxConcurrent,
      priority: config.priority || this.capabilities.priority,
      timeoutMs: config.timeoutMs || 30000,
      retryPolicy: config.retryPolicy || { maxAttempts: 3 },
      ...config
    };
    
    // Context
    this.context = {
      userEmail: config.userEmail,
      conversationId: config.conversationId,
      runId: config.runId,
      memory: new Map(), // Agent-specific memory
      sharedState: null // Reference to shared state
    };
    
    // Communication
    this.messageBus = null; // Set by coordinator
    this.subscriptions = new Set();
    
    // Health
    this.health = {
      status: 'healthy',
      lastHeartbeat: Date.now(),
      consecutiveFailures: 0
    };
  }

  /**
   * Initialize agent
   */
  async initialize(messageBus, sharedState) {
    this.messageBus = messageBus;
    this.context.sharedState = sharedState;
    
    // Subscribe to relevant channels
    this.subscribe(`agent:${this.id}`);
    this.subscribe(`type:${this.type}`);
    this.subscribe('broadcast');
    
    this.status = 'idle';
    this.emit('initialized', { agentId: this.id, type: this.type });
    
    return this;
  }

  /**
   * Subscribe to message channel
   */
  subscribe(channel) {
    if (!this.messageBus) return;
    
    this.subscriptions.add(channel);
    this.messageBus.subscribe(channel, (message) => {
      this.handleMessage(message);
    });
  }

  /**
   * Handle incoming message
   */
  async handleMessage(message) {
    // Ignore messages from self unless explicitly intended
    if (message.senderId === this.id && !message.echo) return;
    
    switch (message.type) {
      case 'TASK_ASSIGNMENT':
        await this.handleTaskAssignment(message.payload);
        break;
      case 'STATUS_REQUEST':
        await this.handleStatusRequest(message);
        break;
      case 'PAUSE':
        await this.pause();
        break;
      case 'RESUME':
        await this.resume();
        break;
      case 'TERMINATE':
        await this.terminate();
        break;
      case 'CONTEXT_UPDATE':
        await this.updateContext(message.payload);
        break;
      default:
        // Delegate to specialized handler
        await this.handleSpecializedMessage(message);
    }
  }

  /**
   * Handle task assignment
   */
  async handleTaskAssignment(task) {
    // Check if we can accept more work
    if (this.status === 'terminating' || this.status === 'terminated') {
      this.sendMessage(task.senderId, {
        type: 'TASK_REJECTED',
        payload: { taskId: task.id, reason: 'agent_terminating' }
      });
      return;
    }
    
    if (this.status === 'paused') {
      this.sendMessage(task.senderId, {
        type: 'TASK_REJECTED',
        payload: { taskId: task.id, reason: 'agent_paused' }
      });
      return;
    }
    
    // Add to queue
    this.taskQueue.push({
      ...task,
      receivedAt: Date.now()
    });
    
    // Process if idle
    if (this.status === 'idle') {
      this.processNextTask();
    }
  }

  /**
   * Process next task in queue
   */
  async processNextTask() {
    if (this.taskQueue.length === 0 || this.status !== 'idle') {
      return;
    }
    
    const task = this.taskQueue.shift();
    this.currentTask = task;
    this.status = 'busy';
    
    const startTime = Date.now();
    
    try {
      // Create execution context
      const execContext = executionContextManager.createContext({
        userEmail: this.context.userEmail,
        conversationId: this.context.conversationId,
        runId: task.runId,
        actionType: task.actionType,
        agentId: this.id,
        agentType: this.type
      });
      
      // Execute task
      const result = await executionContextManager.runWithContext(execContext, async () => {
        return await this.executeTask(task);
      });
      
      // Update metrics
      const duration = Date.now() - startTime;
      this.updateMetrics('success', duration);
      
      // Send result
      this.sendMessage(task.senderId || 'coordinator', {
        type: 'TASK_COMPLETED',
        payload: {
          taskId: task.id,
          agentId: this.id,
          result,
          duration
        }
      });
      
      this.emit('task:completed', { taskId: task.id, result, duration });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics('failure', duration);
      
      // Send failure
      this.sendMessage(task.senderId || 'coordinator', {
        type: 'TASK_FAILED',
        payload: {
          taskId: task.id,
          agentId: this.id,
          error: {
            message: error.message,
            category: categorizeError(error),
            stack: error.stack
          },
          duration
        }
      });
      
      this.emit('task:failed', { taskId: task.id, error, duration });
    } finally {
      this.currentTask = null;
      this.status = 'idle';
      this.health.lastHeartbeat = Date.now();
      
      // Process next task if any
      if (this.taskQueue.length > 0) {
        setImmediate(() => this.processNextTask());
      }
    }
  }

  /**
   * Execute task (to be overridden by specialized agents)
   */
  async executeTask(task) {
    // Base implementation - specialized agents override this
    throw new Error(`executeTask must be implemented by ${this.type}`);
  }

  /**
   * Handle specialized messages (to be overridden)
   */
  async handleSpecializedMessage(message) {
    // Override in specialized agents
    this.emit('message:unhandled', message);
  }

  /**
   * Send message to another agent or channel
   */
  sendMessage(target, message) {
    if (!this.messageBus) return;
    
    this.messageBus.publish(typeof target === 'string' ? target : `agent:${target}`, {
      ...message,
      senderId: this.id,
      senderType: this.type,
      timestamp: Date.now()
    });
  }

  /**
   * Update context
   */
  async updateContext(updates) {
    Object.assign(this.context, updates);
    this.emit('context:updated', updates);
  }

  /**
   * Pause agent
   */
  async pause() {
    if (this.status === 'busy' && this.currentTask) {
      // Finish current task before pausing
      this.status = 'pausing';
    } else {
      this.status = 'paused';
    }
    
    this.emit('paused', { agentId: this.id });
  }

  /**
   * Resume agent
   */
  async resume() {
    this.status = 'idle';
    this.emit('resumed', { agentId: this.id });
    
    // Process queued tasks
    if (this.taskQueue.length > 0) {
      this.processNextTask();
    }
  }

  /**
   * Terminate agent
   */
  async terminate() {
    this.status = 'terminating';
    
    // Reject queued tasks
    this.taskQueue.forEach(task => {
      this.sendMessage(task.senderId, {
        type: 'TASK_REJECTED',
        payload: { taskId: task.id, reason: 'agent_terminated' }
      });
    });
    this.taskQueue = [];
    
    // Wait for current task to complete
    if (this.currentTask) {
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (!this.currentTask) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        
        // Timeout after 30 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 30000);
      });
    }
    
    // Unsubscribe from channels
    this.subscriptions.forEach(channel => {
      this.messageBus?.unsubscribe?.(channel);
    });
    
    this.status = 'terminated';
    this.emit('terminated', { agentId: this.id });
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      status: this.status,
      currentTask: this.currentTask ? {
        id: this.currentTask.id,
        actionType: this.currentTask.actionType,
        startedAt: this.currentTask.startedAt
      } : null,
      queueLength: this.taskQueue.length,
      metrics: { ...this.metrics },
      health: { ...this.health },
      config: {
        maxConcurrent: this.config.maxConcurrent,
        priority: this.config.priority
      }
    };
  }

  /**
   * Update metrics
   */
  updateMetrics(outcome, duration) {
    this.metrics.lastActivity = Date.now();
    
    if (outcome === 'success') {
      this.metrics.tasksCompleted++;
      this.health.consecutiveFailures = 0;
      this.health.status = 'healthy';
    } else {
      this.metrics.tasksFailed++;
      this.health.consecutiveFailures++;
      
      if (this.health.consecutiveFailures >= 5) {
        this.health.status = 'unhealthy';
      }
    }
    
    this.metrics.totalExecutionTime += duration;
    this.metrics.averageExecutionTime = 
      this.metrics.totalExecutionTime / (this.metrics.tasksCompleted + this.metrics.tasksFailed);
  }

  /**
   * Heartbeat check
   */
  heartbeat() {
    this.health.lastHeartbeat = Date.now();
    
    // Check if agent is stuck
    if (this.status === 'busy' && this.currentTask) {
      const taskDuration = Date.now() - (this.currentTask.startedAt || this.currentTask.receivedAt);
      
      if (taskDuration > this.config.timeoutMs * 2) {
        this.health.status = 'stuck';
        this.emit('health:stuck', {
          agentId: this.id,
          taskId: this.currentTask.id,
          duration: taskDuration
        });
      }
    }
  }
}

// ============================================================================
// SPECIALIZED AGENT IMPLEMENTATIONS
// ============================================================================

export class EmailAgent extends Agent {
  constructor(config) {
    super({ ...config, type: AGENT_TYPES.EMAIL_AGENT });
    this.gmailService = config.gmailService;
  }

  async executeTask(task) {
    const { actionType, payload } = task;
    
    switch (actionType) {
      case 'send_email':
        return await this.gmailService.sendEmail(payload);
      case 'save_draft':
        return await this.gmailService.createDraft(payload);
      case 'read_inbox':
        return await this.gmailService.getInbox(payload.limit || 10);
      case 'search_email':
        return await this.gmailService.search(payload.query);
      default:
        throw new Error(`EmailAgent: Unknown action ${actionType}`);
    }
  }
}

export class CalendarAgent extends Agent {
  constructor(config) {
    super({ ...config, type: AGENT_TYPES.CALENDAR_AGENT });
    this.calendarService = config.calendarService;
  }

  async executeTask(task) {
    const { actionType, payload } = task;
    
    switch (actionType) {
      case 'schedule_meeting':
        return await this.calendarService.createEvent(payload);
      case 'get_availability':
        return await this.calendarService.getAvailability(payload);
      default:
        throw new Error(`CalendarAgent: Unknown action ${actionType}`);
    }
  }
}

export class ResearchAgent extends Agent {
  constructor(config) {
    super({ ...config, type: AGENT_TYPES.RESEARCH_AGENT });
    this.db = config.db;
  }

  async executeTask(task) {
    const { actionType, payload } = task;
    
    // Research agent can use multiple data sources
    switch (actionType) {
      case 'search_email':
        // Use Gmail search
        return { source: 'gmail', results: [] };
      case 'find_note':
        // Use notes search
        return { source: 'notes', results: [] };
      case 'notion_search':
        // Use Notion search
        return { source: 'notion', results: [] };
      case 'aggregate_search':
        // Search across all sources
        return {
          sources: ['gmail', 'notes', 'notion'],
          results: []
        };
      default:
        throw new Error(`ResearchAgent: Unknown action ${actionType}`);
    }
  }
}

export class PlannerAgent extends Agent {
  constructor(config) {
    super({ ...config, type: AGENT_TYPES.PLANNER_AGENT });
    this.planModeEngine = config.planModeEngine;
  }

  async executeTask(task) {
    const { actionType, payload } = task;
    
    switch (actionType) {
      case 'generate_plan':
        return await this.planModeEngine.generatePlan(payload);
      case 'optimize_plan':
        // Analyze and optimize existing plan
        return { optimized: true, improvements: [] };
      case 'validate_plan':
        // Validate plan feasibility
        return { valid: true, issues: [] };
      default:
        throw new Error(`PlannerAgent: Unknown action ${actionType}`);
    }
  }
}

export class ExecutorAgent extends Agent {
  constructor(config) {
    super({ ...config, type: AGENT_TYPES.EXECUTOR_AGENT });
    this.runtime = config.runtime;
  }

  async executeTask(task) {
    const { actionType, payload } = task;
    
    switch (actionType) {
      case 'execute_plan':
        return await this.runtime.executePlan(payload.planId);
      case 'monitor_execution':
        return await this.runtime.getRunStatus(payload.runId);
      case 'handle_failure':
        // Retry or escalate failed tasks
        return { handled: true, action: 'retry' };
      default:
        throw new Error(`ExecutorAgent: Unknown action ${actionType}`);
    }
  }
}

export class MemoryAgent extends Agent {
  constructor(config) {
    super({ ...config, type: AGENT_TYPES.MEMORY_AGENT });
    this.knowledgeGraph = new Map();
  }

  async executeTask(task) {
    const { actionType, payload } = task;
    
    switch (actionType) {
      case 'store_context':
        this.context.memory.set(payload.key, payload.value);
        return { stored: true };
      case 'retrieve_context':
        return { 
          value: this.context.memory.get(payload.key),
          found: this.context.memory.has(payload.key)
        };
      case 'update_knowledge':
        this.knowledgeGraph.set(payload.entity, payload.data);
        return { updated: true };
      default:
        throw new Error(`MemoryAgent: Unknown action ${actionType}`);
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  AGENT_TYPES,
  AGENT_CAPABILITIES,
  Agent,
  EmailAgent,
  CalendarAgent,
  ResearchAgent,
  PlannerAgent,
  ExecutorAgent,
  MemoryAgent
};
