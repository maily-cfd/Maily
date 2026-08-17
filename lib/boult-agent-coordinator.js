/**
 * Boult Agent Coordinator - Phase 3
 * 
 * Central orchestration system:
 * - Agent Registry: Discovery and lifecycle management
 * - Workload Distribution: Load balancing and task assignment
 * - Communication Bus: Inter-agent message routing
 * - Shared State: Distributed state management
 * - Dynamic Scaling: Auto-scale agents based on demand
 * - Conflict Resolution: Detect and resolve agent conflicts
 * - Health Monitoring: Track agent health and recover failures
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import {
  Agent,
  AGENT_TYPES,
  AGENT_CAPABILITIES,
  EmailAgent,
  CalendarAgent,
  ResearchAgent,
  PlannerAgent,
  ExecutorAgent,
  MemoryAgent
} from './boult-multi-agent-core.js';
import { executionTelemetry } from './boult-execution-telemetry.js';

// ============================================================================
// MESSAGE BUS - Inter-Agent Communication
// ============================================================================

export class MessageBus extends EventEmitter {
  constructor(options = {}) {
    super();
    this.channels = new Map(); // channel -> Set of handlers
    this.messageQueue = [];
    this.maxQueueSize = options.maxQueueSize || 10000;
    this.stats = {
      messagesPublished: 0,
      messagesDelivered: 0,
      messagesDropped: 0
    };
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channel, handler) {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel).add(handler);
    
    this.emit('subscribe', { channel, handler });
    
    // Return unsubscribe function
    return () => this.unsubscribe(channel, handler);
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel, handler) {
    const handlers = this.channels.get(channel);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.channels.delete(channel);
      }
    }
  }

  /**
   * Publish message to channel
   */
  publish(channel, message) {
    // Add metadata
    const enrichedMessage = {
      ...message,
      id: message.id || `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      channel,
      publishedAt: Date.now()
    };

    // Check queue size
    if (this.messageQueue.length >= this.maxQueueSize) {
      this.stats.messagesDropped++;
      this.emit('drop', enrichedMessage);
      return;
    }

    this.messageQueue.push(enrichedMessage);
    this.stats.messagesPublished++;

    // Process immediately
    this.processQueue();
    
    this.emit('publish', enrichedMessage);
  }

  /**
   * Process message queue
   */
  processQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.deliver(message);
    }
  }

  /**
   * Deliver message to subscribers
   */
  deliver(message) {
    const handlers = this.channels.get(message.channel);
    if (!handlers || handlers.size === 0) {
      // No subscribers - message dropped
      this.stats.messagesDropped++;
      return;
    }

    handlers.forEach(handler => {
      try {
        handler(message);
        this.stats.messagesDelivered++;
      } catch (err) {
        console.error(`[MessageBus] Handler error:`, err);
      }
    });

    this.emit('deliver', message);
  }

  /**
   * Broadcast to all agents
   */
  broadcast(message) {
    this.publish('broadcast', message);
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }
}

// ============================================================================
// AGENT REGISTRY
// ============================================================================

export class AgentRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    this.agents = new Map(); // id -> Agent
    this.agentsByType = new Map(); // type -> Set of Agent IDs
    this.agentsByCapability = new Map(); // capability -> Set of Agent IDs
    this.db = options.db;
    this.persistent = options.persistent !== false;
  }

  /**
   * Register an agent
   */
  async register(agent) {
    // Check if ID already exists
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent with ID ${agent.id} already registered`);
    }

    // Add to registry
    this.agents.set(agent.id, agent);
    
    // Index by type
    if (!this.agentsByType.has(agent.type)) {
      this.agentsByType.set(agent.type, new Set());
    }
    this.agentsByType.get(agent.type).add(agent.id);

    // Index by capabilities
    const capabilities = AGENT_CAPABILITIES[agent.type]?.actions || [];
    capabilities.forEach(cap => {
      if (!this.agentsByCapability.has(cap)) {
        this.agentsByCapability.set(cap, new Set());
      }
      this.agentsByCapability.get(cap).add(agent.id);
    });

    // Persist to database
    if (this.persistent && this.db) {
      await this.db.createAgent({
        id: agent.id,
        type: agent.type,
        name: agent.name,
        status: agent.status,
        config: agent.config,
        createdAt: new Date().toISOString()
      });
    }

    this.emit('registered', { agentId: agent.id, type: agent.type });
    
    return agent;
  }

  /**
   * Unregister an agent
   */
  async unregister(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    // Remove from main registry
    this.agents.delete(agentId);

    // Remove from type index
    const typeSet = this.agentsByType.get(agent.type);
    if (typeSet) {
      typeSet.delete(agentId);
      if (typeSet.size === 0) {
        this.agentsByType.delete(agent.type);
      }
    }

    // Remove from capability index
    const capabilities = AGENT_CAPABILITIES[agent.type]?.actions || [];
    capabilities.forEach(cap => {
      const capSet = this.agentsByCapability.get(cap);
      if (capSet) {
        capSet.delete(agentId);
        if (capSet.size === 0) {
          this.agentsByCapability.delete(cap);
        }
      }
    });

    // Update database
    if (this.persistent && this.db) {
      await this.db.updateAgent(agentId, {
        status: 'terminated',
        terminatedAt: new Date().toISOString()
      });
    }

    this.emit('unregistered', { agentId, type: agent.type });
    
    return true;
  }

  /**
   * Get agent by ID
   */
  get(agentId) {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAll() {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by type
   */
  getByType(type) {
    const ids = this.agentsByType.get(type) || new Set();
    return Array.from(ids).map(id => this.agents.get(id)).filter(Boolean);
  }

  /**
   * Get agents by capability
   */
  getByCapability(capability) {
    const ids = this.agentsByCapability.get(capability) || new Set();
    return Array.from(ids).map(id => this.agents.get(id)).filter(Boolean);
  }

  /**
   * Find best agent for task
   */
  findBestAgentForTask(task) {
    const { actionType, priority = 'normal' } = task;
    
    // Get agents that can handle this action
    const candidates = this.getByCapability(actionType);
    if (candidates.length === 0) return null;

    // Score candidates
    const scored = candidates.map(agent => {
      let score = 0;
      const status = agent.getStatus();

      // Prefer idle agents
      if (status.status === 'idle') score += 100;
      else if (status.status === 'busy') score += 50;
      else score -= 100; // paused, terminating

      // Prefer agents with shorter queues
      score -= status.queueLength * 10;

      // Prefer higher priority agents for high-priority tasks
      if (priority === 'high' && status.config.priority === 'high') score += 30;

      // Prefer agents with better health
      if (status.health.status === 'healthy') score += 20;
      else if (status.health.status === 'unhealthy') score -= 50;

      // Prefer agents with better performance history
      if (status.metrics.tasksCompleted > 0) {
        const successRate = status.metrics.tasksCompleted / 
          (status.metrics.tasksCompleted + status.metrics.tasksFailed);
        score += successRate * 20;
      }

      return { agent, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    return scored[0]?.agent || null;
  }

  /**
   * Get registry statistics
   */
  getStats() {
    const stats = {
      total: this.agents.size,
      byType: {},
      byStatus: {
        idle: 0,
        busy: 0,
        paused: 0,
        terminating: 0,
        terminated: 0
      }
    };

    for (const agent of this.agents.values()) {
      const status = agent.getStatus();
      
      // By type
      stats.byType[status.type] = (stats.byType[status.type] || 0) + 1;
      
      // By status
      stats.byStatus[status.status] = (stats.byStatus[status.status] || 0) + 1;
    }

    return stats;
  }
}

// ============================================================================
// AGENT COORDINATOR
// ============================================================================

export class AgentCoordinator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.registry = new AgentRegistry(options);
    this.messageBus = new MessageBus(options);
    this.sharedState = new SharedState();
    this.scaler = new DynamicScaler(this.registry, options);
    this.conflictResolver = new ConflictResolver();
    this.healthMonitor = new HealthMonitor(this.registry, options);
    
    this.db = options.db;
    this.userEmail = options.userEmail;
    this.config = {
      defaultAgentCounts: {
        [AGENT_TYPES.EMAIL_AGENT]: 2,
        [AGENT_TYPES.CALENDAR_AGENT]: 1,
        [AGENT_TYPES.RESEARCH_AGENT]: 3,
        [AGENT_TYPES.PLANNER_AGENT]: 2,
        [AGENT_TYPES.EXECUTOR_AGENT]: 2,
        [AGENT_TYPES.MEMORY_AGENT]: 1,
        [AGENT_TYPES.COORDINATOR_AGENT]: 1
      },
      maxTotalAgents: 20,
      ...options.config
    };

    // Task tracking
    this.pendingTasks = new Map();
    this.completedTasks = new Map();
    this.failedTasks = new Map();
  }

  /**
   * Initialize coordinator
   */
  async initialize() {
    // Start health monitoring
    this.healthMonitor.start();

    // Spawn default agents
    await this.spawnDefaultAgents();

    // Start dynamic scaler
    this.scaler.start();

    // Listen for agent events
    this.setupAgentEventHandlers();

    this.emit('initialized');
  }

  /**
   * Spawn default agents
   */
  async spawnDefaultAgents() {
    for (const [agentType, count] of Object.entries(this.config.defaultAgentCounts)) {
      for (let i = 0; i < count; i++) {
        await this.spawnAgent(agentType, {
          name: `${agentType}_${i + 1}`
        });
      }
    }
  }

  /**
   * Spawn a new agent
   */
  async spawnAgent(agentType, options = {}) {
    // Check if we've reached max agents
    const stats = this.registry.getStats();
    if (stats.total >= this.config.maxTotalAgents) {
      throw new Error(`Max agent limit (${this.config.maxTotalAgents}) reached`);
    }

    // Create agent based on type
    let agent;
    const config = {
      type: agentType,
      userEmail: this.userEmail,
      db: this.db,
      ...options
    };

    switch (agentType) {
      case AGENT_TYPES.EMAIL_AGENT:
        agent = new EmailAgent(config);
        break;
      case AGENT_TYPES.CALENDAR_AGENT:
        agent = new CalendarAgent(config);
        break;
      case AGENT_TYPES.RESEARCH_AGENT:
        agent = new ResearchAgent(config);
        break;
      case AGENT_TYPES.PLANNER_AGENT:
        agent = new PlannerAgent(config);
        break;
      case AGENT_TYPES.EXECUTOR_AGENT:
        agent = new ExecutorAgent(config);
        break;
      case AGENT_TYPES.MEMORY_AGENT:
        agent = new MemoryAgent(config);
        break;
      default:
        agent = new Agent(config);
    }

    // Initialize with message bus and shared state
    await agent.initialize(this.messageBus, this.sharedState);

    // Register
    await this.registry.register(agent);

    // Set up agent-specific event handlers
    this.setupIndividualAgentHandlers(agent);

    this.emit('agent:spawned', { agentId: agent.id, type: agentType });

    return agent;
  }

  /**
   * Terminate an agent
   */
  async terminateAgent(agentId) {
    const agent = this.registry.get(agentId);
    if (!agent) return false;

    await agent.terminate();
    await this.registry.unregister(agentId);

    this.emit('agent:terminated', { agentId });
    return true;
  }

  /**
   * Submit task to coordinator
   */
  async submitTask(task) {
    const taskId = task.id || `task_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const enrichedTask = {
      ...task,
      id: taskId,
      submittedAt: Date.now(),
      status: 'pending'
    };

    this.pendingTasks.set(taskId, enrichedTask);

    // Find best agent
    const agent = this.registry.findBestAgentForTask(enrichedTask);
    
    if (!agent) {
      // No agent available - try to spawn one
      const actionType = enrichedTask.actionType;
      const capabilityAgents = this.getAgentsForCapability(actionType);
      
      if (capabilityAgents.length > 0) {
        // Spawn appropriate agent type
        const agentType = capabilityAgents[0];
        try {
          const newAgent = await this.spawnAgent(agentType);
          await this.assignTaskToAgent(enrichedTask, newAgent);
        } catch (err) {
          enrichedTask.status = 'failed';
          enrichedTask.error = err.message;
          this.failedTasks.set(taskId, enrichedTask);
          this.pendingTasks.delete(taskId);
          
          this.emit('task:failed', enrichedTask);
          return enrichedTask;
        }
      } else {
        // No agent can handle this task
        enrichedTask.status = 'failed';
        enrichedTask.error = 'No agent available for this task type';
        this.failedTasks.set(taskId, enrichedTask);
        this.pendingTasks.delete(taskId);
        
        this.emit('task:failed', enrichedTask);
        return enrichedTask;
      }
    } else {
      await this.assignTaskToAgent(enrichedTask, agent);
    }

    this.emit('task:submitted', enrichedTask);
    return enrichedTask;
  }

  /**
   * Assign task to specific agent
   */
  async assignTaskToAgent(task, agent) {
    task.assignedTo = agent.id;
    task.assignedAt = Date.now();
    task.status = 'assigned';

    // Send task to agent
    this.messageBus.publish(`agent:${agent.id}`, {
      type: 'TASK_ASSIGNMENT',
      senderId: 'coordinator',
      payload: task
    });

    this.emit('task:assigned', { taskId: task.id, agentId: agent.id });
  }

  /**
   * Get agents that can handle a capability
   */
  getAgentsForCapability(actionType) {
    const mapping = {
      'send_email': [AGENT_TYPES.EMAIL_AGENT],
      'save_draft': [AGENT_TYPES.EMAIL_AGENT],
      'read_inbox': [AGENT_TYPES.EMAIL_AGENT, AGENT_TYPES.RESEARCH_AGENT],
      'schedule_meeting': [AGENT_TYPES.CALENDAR_AGENT],
      'generate_plan': [AGENT_TYPES.PLANNER_AGENT],
      'execute_plan': [AGENT_TYPES.EXECUTOR_AGENT],
      'search_email': [AGENT_TYPES.RESEARCH_AGENT, AGENT_TYPES.EMAIL_AGENT],
      'tasks_add_task': [AGENT_TYPES.TASKS_AGENT],
      'notion_create_page': [AGENT_TYPES.NOTION_AGENT],
      'generic_task': Object.values(AGENT_TYPES)
    };

    return mapping[actionType] || [AGENT_TYPES.FALLBACK_AGENT];
  }

  /**
   * Set up global agent event handlers
   */
  setupAgentEventHandlers() {
    this.registry.on('registered', ({ agentId, type }) => {
      executionTelemetry.incrementCounter('agents_spawned_total', { agent_type: type });
    });

    this.registry.on('unregistered', ({ agentId, type }) => {
      executionTelemetry.incrementCounter('agents_terminated_total', { agent_type: type });
    });
  }

  /**
   * Set up individual agent handlers
   */
  setupIndividualAgentHandlers(agent) {
    // Task completion
    agent.on('task:completed', ({ taskId, result, duration }) => {
      const task = this.pendingTasks.get(taskId);
      if (task) {
        task.status = 'completed';
        task.completedAt = Date.now();
        task.duration = duration;
        task.result = result;
        
        this.completedTasks.set(taskId, task);
        this.pendingTasks.delete(taskId);
        
        this.emit('task:completed', task);
      }
    });

    // Task failure
    agent.on('task:failed', ({ taskId, error, duration }) => {
      const task = this.pendingTasks.get(taskId);
      if (task) {
        task.status = 'failed';
        task.failedAt = Date.now();
        task.duration = duration;
        task.error = error;
        
        this.failedTasks.set(taskId, task);
        this.pendingTasks.delete(taskId);
        
        // Attempt retry if configured
        if (task.retries < (task.maxRetries || 3)) {
          this.retryTask(task);
        } else {
          this.emit('task:failed', task);
        }
      }
    });

    // Agent stuck
    agent.on('health:stuck', ({ agentId, taskId, duration }) => {
      this.emit('agent:stuck', { agentId, taskId, duration });
      
      // Consider terminating and respawning
      if (duration > 60000) { // Stuck for over 1 minute
        this.terminateAgent(agentId).then(() => {
          const agent = this.registry.get(agentId);
          if (agent) {
            this.spawnAgent(agent.type);
          }
        });
      }
    });
  }

  /**
   * Retry a failed task
   */
  async retryTask(task) {
    task.retries = (task.retries || 0) + 1;
    task.status = 'pending';
    task.lastError = task.error;
    delete task.error;
    delete task.failedAt;

    this.pendingTasks.set(task.id, task);
    
    // Wait before retrying (exponential backoff)
    const delay = Math.min(1000 * Math.pow(2, task.retries), 30000);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Re-submit
    await this.submitTask(task);
    
    this.emit('task:retrying', task);
  }

  /**
   * Get coordinator status
   */
  getStatus() {
    return {
      agents: this.registry.getStats(),
      tasks: {
        pending: this.pendingTasks.size,
        completed: this.completedTasks.size,
        failed: this.failedTasks.size
      },
      messages: this.messageBus.getStats(),
      health: this.healthMonitor.getStatus()
    };
  }

  /**
   * Shutdown coordinator
   */
  async shutdown() {
    // Stop scaler
    this.scaler.stop();

    // Stop health monitor
    this.healthMonitor.stop();

    // Terminate all agents
    const agents = this.registry.getAll();
    await Promise.all(agents.map(agent => this.terminateAgent(agent.id)));

    this.emit('shutdown');
  }
}

// ============================================================================
// SHARED STATE
// ============================================================================

export class SharedState extends EventEmitter {
  constructor() {
    super();
    this.state = new Map();
    this.subscribers = new Map();
    this.conflicts = [];
  }

  /**
   * Set value in shared state
   */
  set(key, value, options = {}) {
    const previous = this.state.get(key);
    
    // Check for conflicts
    if (previous && options.checkConflict) {
      const conflict = this.detectConflict(key, previous, value);
      if (conflict) {
        this.conflicts.push(conflict);
        this.emit('conflict', conflict);
        
        if (!options.resolveConflict) {
          throw new Error(`Conflict detected for key ${key}`);
        }
        
        // Auto-resolve
        value = this.resolveConflict(key, previous, value);
      }
    }

    this.state.set(key, {
      value,
      updatedAt: Date.now(),
      updatedBy: options.agentId || 'unknown',
      version: (previous?.version || 0) + 1
    });

    this.emit('change', { key, value, previous: previous?.value });
    this.notifySubscribers(key, value);
  }

  /**
   * Get value from shared state
   */
  get(key) {
    return this.state.get(key)?.value;
  }

  /**
   * Get full entry with metadata
   */
  getEntry(key) {
    return this.state.get(key);
  }

  /**
   * Subscribe to changes
   */
  subscribe(key, handler) {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key).add(handler);
    
    return () => this.unsubscribe(key, handler);
  }

  /**
   * Unsubscribe from changes
   */
  unsubscribe(key, handler) {
    const handlers = this.subscribers.get(key);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Notify subscribers
   */
  notifySubscribers(key, value) {
    const handlers = this.subscribers.get(key);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(key, value);
        } catch (err) {
          console.error('[SharedState] Subscriber error:', err);
        }
      });
    }
  }

  /**
   * Detect conflict between values
   */
  detectConflict(key, previous, current) {
    // Simple conflict detection - values are different and recent
    const timeSinceUpdate = Date.now() - previous.updatedAt;
    
    if (timeSinceUpdate < 1000 && JSON.stringify(previous.value) !== JSON.stringify(current)) {
      return {
        key,
        previous: previous.value,
        current,
        previousAgent: previous.updatedBy,
        timestamp: Date.now()
      };
    }
    
    return null;
  }

  /**
   * Resolve conflict (last-write-wins)
   */
  resolveConflict(key, previous, current) {
    // Default: prefer current (last-write-wins)
    // Could be customized for different strategies
    return current;
  }

  /**
   * Get all keys
   */
  keys() {
    return Array.from(this.state.keys());
  }

  /**
   * Get snapshot
   */
  snapshot() {
    const snap = {};
    for (const [key, entry] of this.state) {
      snap[key] = entry.value;
    }
    return snap;
  }
}

// ============================================================================
// DYNAMIC SCALER
// ============================================================================

export class DynamicScaler {
  constructor(registry, options = {}) {
    this.registry = registry;
    this.options = {
      checkInterval: 30000, // 30 seconds
      scaleUpThreshold: 0.8, // 80% utilization
      scaleDownThreshold: 0.2, // 20% utilization
      minAgentsPerType: 1,
      maxAgentsPerType: 10,
      ...options
    };
    
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    
    this.timer = setInterval(() => {
      this.checkScaling();
    }, this.options.checkInterval);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  checkScaling() {
    const stats = this.registry.getStats();
    
    for (const [agentType, count] of Object.entries(stats.byType)) {
      const agents = this.registry.getByType(agentType);
      const utilization = this.calculateUtilization(agents);

      // Scale up if utilization is high
      if (utilization > this.options.scaleUpThreshold && 
          count < this.options.maxAgentsPerType) {
        this.scaleUp(agentType);
      }

      // Scale down if utilization is low
      if (utilization < this.options.scaleDownThreshold && 
          count > this.options.minAgentsPerType) {
        this.scaleDown(agentType);
      }
    }
  }

  calculateUtilization(agents) {
    if (agents.length === 0) return 0;
    
    const busy = agents.filter(a => a.getStatus().status === 'busy').length;
    return busy / agents.length;
  }

  scaleUp(agentType) {
    // Emit event for coordinator to handle
    executionTelemetry.incrementCounter('scale_up_requests_total', { agent_type: agentType });
  }

  scaleDown(agentType) {
    // Find idle agent to terminate
    const agents = this.registry.getByType(agentType);
    const idleAgent = agents.find(a => a.getStatus().status === 'idle');
    
    if (idleAgent) {
      executionTelemetry.incrementCounter('scale_down_requests_total', { agent_type: agentType });
      // Emit event for coordinator to handle
    }
  }
}

// ============================================================================
// CONFLICT RESOLVER
// ============================================================================

export class ConflictResolver {
  constructor() {
    this.strategies = new Map();
    this.defaultStrategy = 'last_write_wins';
    
    // Register default strategies
    this.registerStrategy('last_write_wins', (conflicts) => {
      // Prefer the most recent write
      return conflicts[conflicts.length - 1];
    });
    
    this.registerStrategy('first_write_wins', (conflicts) => {
      // Prefer the first write
      return conflicts[0];
    });
    
    this.registerStrategy('merge', (conflicts) => {
      // Merge conflicts (for objects)
      const merged = {};
      conflicts.forEach(c => {
        Object.assign(merged, c.value);
      });
      return { value: merged };
    });
  }

  registerStrategy(name, strategyFn) {
    this.strategies.set(name, strategyFn);
  }

  resolve(conflicts, strategy = null) {
    const useStrategy = strategy || this.defaultStrategy;
    const strategyFn = this.strategies.get(useStrategy);
    
    if (!strategyFn) {
      throw new Error(`Unknown conflict resolution strategy: ${useStrategy}`);
    }
    
    return strategyFn(conflicts);
  }
}

// ============================================================================
// HEALTH MONITOR
// ============================================================================

export class HealthMonitor {
  constructor(registry, options = {}) {
    this.registry = registry;
    this.options = {
      checkInterval: 10000, // 10 seconds
      heartbeatTimeout: 30000, // 30 seconds
      maxConsecutiveFailures: 5,
      ...options
    };
    
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    
    this.timer = setInterval(() => {
      this.checkHealth();
    }, this.options.checkInterval);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  checkHealth() {
    const agents = this.registry.getAll();
    const now = Date.now();
    
    agents.forEach(agent => {
      const status = agent.getStatus();
      
      // Check heartbeat
      const timeSinceHeartbeat = now - status.health.lastHeartbeat;
      if (timeSinceHeartbeat > this.options.heartbeatTimeout) {
        status.health.status = 'unhealthy';
        agent.emit('health:timeout', { agentId: agent.id, timeSinceHeartbeat });
      }
      
      // Check consecutive failures
      if (status.health.consecutiveFailures >= this.options.maxConsecutiveFailures) {
        status.health.status = 'unhealthy';
        agent.emit('health:degraded', { 
          agentId: agent.id, 
          consecutiveFailures: status.health.consecutiveFailures 
        });
      }
      
      // Send heartbeat request
      agent.heartbeat();
    });
  }

  getStatus() {
    const agents = this.registry.getAll();
    const healthy = agents.filter(a => a.getStatus().health.status === 'healthy').length;
    const unhealthy = agents.filter(a => a.getStatus().health.status === 'unhealthy').length;
    
    return {
      total: agents.length,
      healthy,
      unhealthy,
      degraded: agents.length - healthy - unhealthy
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  AgentCoordinator,
  AgentRegistry,
  MessageBus,
  SharedState,
  DynamicScaler,
  ConflictResolver,
  HealthMonitor
};
