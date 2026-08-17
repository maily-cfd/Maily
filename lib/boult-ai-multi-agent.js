/**
 * Boult AI Service - Multi-Agent Orchestration Edition (Phase 3)
 * 
 * Enhanced AI service with:
 * - Multi-agent intent detection (determines if multiple agents needed)
 * - Agent-aware planning (assigns tasks to specific agent types)
 * - Distributed reasoning (coordinated thinking across agents)
 * - Agent collaboration protocols
 * - Context sharing between AI and agents
 */

import { 
  AGENT_TYPES, 
  AGENT_CAPABILITIES 
} from './boult-multi-agent-core.js';
import { 
  executionContextManager 
} from './boult-execution-context.js';
import { 
  executionTelemetry 
} from './boult-execution-telemetry.js';
import { getModelChain } from './ai-constants.js';

export class BoultAIService {
  constructor(options = {}) {
    // Strictly follow the requested model chain: User Preference -> Nano -> Super -> Qwen
    this.models = getModelChain(options.modelPreference);
    this.model = options.model || this.models[0];
    this.apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    this.db = options.db;
    
    // Multi-agent configuration
    this.multiAgentConfig = {
      enabled: options.multiAgent !== false,
      minAgentsForMulti: 2, // Minimum domains required for multi-agent
      confidenceThreshold: 0.7
    };
    
    // Agent capability mapping for AI planning
    this.agentCapabilityMap = this.buildCapabilityMap();
  }

  /**
   * Build capability map for AI planning
   */
  buildCapabilityMap() {
    const map = {};
    
    for (const [agentType, capabilities] of Object.entries(AGENT_CAPABILITIES)) {
      for (const action of capabilities.actions) {
        if (!map[action]) {
          map[action] = [];
        }
        map[action].push(agentType);
      }
    }
    
    return map;
  }

  /**
   * Analyze intent with multi-agent awareness
   */
  async analyzeIntentAndPlan(message, context = {}) {
    const execContext = executionContextManager.createContext({
      userEmail: context.userEmail,
      actionType: 'analyze_intent'
    });

    return executionContextManager.runWithContext(execContext, async () => {
      executionTelemetry.collector?.startSpan('ai_analyze_intent_multi_agent');

      try {
        // Standard intent analysis
        const baseAnalysis = await this.performBaseIntentAnalysis(message, context);
        
        // Multi-agent detection
        const multiAgentAnalysis = await this.detectMultiAgentNeeds(
          message, 
          baseAnalysis,
          context
        );

        const result = {
          ...baseAnalysis,
          multiAgent: multiAgentAnalysis.needsMultiAgent,
          agentAssignments: multiAgentAnalysis.assignments,
          coordinationPlan: multiAgentAnalysis.coordinationPlan,
          estimatedAgents: multiAgentAnalysis.estimatedAgents,
          parallelizable: multiAgentAnalysis.parallelizable
        };

        executionTelemetry.collector?.endSpan('ai_analyze_intent_multi_agent', 'ok', {
          multi_agent: result.multiAgent,
          estimated_agents: result.estimatedAgents
        });

        return result;

      } catch (error) {
        executionTelemetry.collector?.endSpan('ai_analyze_intent_multi_agent', 'error');
        throw error;
      }
    });
  }

  /**
   * Detect if multi-agent orchestration is needed
   */
  async detectMultiAgentNeeds(message, baseAnalysis, context) {
    // Quick check: multiple domains involved?
    const domains = this.extractDomains(message, baseAnalysis);
    
    // Check if we have agents for these domains
    const requiredAgents = this.mapDomainsToAgents(domains);
    
    const needsMultiAgent = 
      this.multiAgentConfig.enabled &&
      requiredAgents.size >= this.multiAgentConfig.minAgentsForMulti;

    if (!needsMultiAgent) {
      return {
        needsMultiAgent: false,
        assignments: [],
        coordinationPlan: null,
        estimatedAgents: 1,
        parallelizable: false
      };
    }

    // Generate agent assignments
    const assignments = this.generateAgentAssignments(
      message,
      baseAnalysis,
      Array.from(requiredAgents)
    );

    // Determine if tasks can be parallelized
    const parallelizable = this.analyzeParallelization(assignments);

    // Generate coordination plan
    const coordinationPlan = this.generateCoordinationPlan(assignments, parallelizable);

    return {
      needsMultiAgent: true,
      assignments,
      coordinationPlan,
      estimatedAgents: requiredAgents.size,
      parallelizable
    };
  }

  /**
   * Extract domains from message and intent
   */
  extractDomains(message, analysis) {
    const domains = new Set();
    const lowerMessage = message.toLowerCase();

    // Email domain indicators
    if (/email|gmail|inbox|send|draft|reply/i.test(lowerMessage)) {
      domains.add('email');
    }

    // Calendar domain indicators
    if (/meeting|schedule|calendar|availability|book/i.test(lowerMessage)) {
      domains.add('calendar');
    }

    // Research domain indicators
    if (/search|find|lookup|research|information/i.test(lowerMessage)) {
      domains.add('research');
    }

    // Tasks domain indicators
    if (/task|todo|reminder|deadline/i.test(lowerMessage)) {
      domains.add('tasks');
    }

    // Notion domain indicators
    if (/note|document|page|notion|wiki/i.test(lowerMessage)) {
      domains.add('notion');
    }

    // Analytics domain indicators
    if (/analytics|report|metrics|statistics|data/i.test(lowerMessage)) {
      domains.add('analytics');
    }

    return domains;
  }

  /**
   * Map domains to agent types
   */
  mapDomainsToAgents(domains) {
    const agentTypes = new Set();

    const domainToAgent = {
      'email': AGENT_TYPES.EMAIL_AGENT,
      'calendar': AGENT_TYPES.CALENDAR_AGENT,
      'research': AGENT_TYPES.RESEARCH_AGENT,
      'tasks': AGENT_TYPES.TASKS_AGENT,
      'notion': AGENT_TYPES.NOTION_AGENT,
      'analytics': AGENT_TYPES.ANALYTICS_AGENT
    };

    for (const domain of domains) {
      const agentType = domainToAgent[domain];
      if (agentType) {
        agentTypes.add(agentType);
      }
    }

    // Always include planner and executor for multi-agent tasks
    if (agentTypes.size > 1) {
      agentTypes.add(AGENT_TYPES.PLANNER_AGENT);
      agentTypes.add(AGENT_TYPES.EXECUTOR_AGENT);
      agentTypes.add(AGENT_TYPES.MEMORY_AGENT);
    }

    return agentTypes;
  }

  /**
   * Generate agent task assignments
   */
  generateAgentAssignments(message, analysis, agentTypes) {
    const assignments = [];

    // Planner agent always goes first
    if (agentTypes.includes(AGENT_TYPES.PLANNER_AGENT)) {
      assignments.push({
        agentType: AGENT_TYPES.PLANNER_AGENT,
        task: 'generate_plan',
        priority: 'critical',
        description: 'Analyze request and generate execution plan',
        input: {
          message,
          intent: analysis.intent,
          complexity: analysis.complexity,
          requiredAgents: agentTypes.filter(t => 
            t !== AGENT_TYPES.PLANNER_AGENT && 
            t !== AGENT_TYPES.EXECUTOR_AGENT
          )
        },
        outputFormat: 'plan',
        dependsOn: []
      });
    }

    // Domain-specific agents
    for (const agentType of agentTypes) {
      if (agentType === AGENT_TYPES.PLANNER_AGENT || 
          agentType === AGENT_TYPES.EXECUTOR_AGENT ||
          agentType === AGENT_TYPES.MEMORY_AGENT) {
        continue;
      }

      const task = this.generateTaskForAgent(agentType, message, analysis);
      if (task) {
        assignments.push({
          agentType,
          ...task,
          dependsOn: [AGENT_TYPES.PLANNER_AGENT] // Domain agents depend on plan
        });
      }
    }

    // Memory agent for context management
    if (agentTypes.includes(AGENT_TYPES.MEMORY_AGENT)) {
      assignments.push({
        agentType: AGENT_TYPES.MEMORY_AGENT,
        task: 'manage_context',
        priority: 'high',
        description: 'Maintain shared context across agents',
        input: { message, analysis },
        dependsOn: [] // Memory agent works throughout
      });
    }

    // Executor agent coordinates execution
    if (agentTypes.includes(AGENT_TYPES.EXECUTOR_AGENT)) {
      assignments.push({
        agentType: AGENT_TYPES.EXECUTOR_AGENT,
        task: 'execute_plan',
        priority: 'critical',
        description: 'Coordinate plan execution across agents',
        input: {}, // Will receive plan from planner
        dependsOn: [AGENT_TYPES.PLANNER_AGENT]
      });
    }

    return assignments;
  }

  /**
   * Generate specific task for agent type
   */
  generateTaskForAgent(agentType, message, analysis) {
    const taskGenerators = {
      [AGENT_TYPES.EMAIL_AGENT]: () => ({
        task: 'process_email_request',
        priority: 'high',
        description: 'Handle email-related operations',
        input: { message, intent: analysis.intent },
        actions: ['search_email', 'read_inbox', 'send_email', 'save_draft']
      }),

      [AGENT_TYPES.CALENDAR_AGENT]: () => ({
        task: 'process_calendar_request',
        priority: 'high',
        description: 'Handle calendar and meeting operations',
        input: { message, intent: analysis.intent },
        actions: ['get_availability', 'schedule_meeting']
      }),

      [AGENT_TYPES.RESEARCH_AGENT]: () => ({
        task: 'conduct_research',
        priority: 'medium',
        description: 'Gather information from multiple sources',
        input: { message, query: analysis.searchQuery },
        actions: ['search_email', 'find_note', 'aggregate_search']
      }),

      [AGENT_TYPES.TASKS_AGENT]: () => ({
        task: 'manage_tasks',
        priority: 'medium',
        description: 'Handle task management operations',
        input: { message },
        actions: ['tasks_add_task', 'tasks_add_tasks', 'tasks_list']
      }),

      [AGENT_TYPES.NOTION_AGENT]: () => ({
        task: 'manage_notes',
        priority: 'medium',
        description: 'Handle Notion and note operations',
        input: { message },
        actions: ['notion_search', 'notion_create_page', 'notion_append']
      }),

      [AGENT_TYPES.ANALYTICS_AGENT]: () => ({
        task: 'generate_analytics',
        priority: 'low',
        description: 'Generate reports and analytics',
        input: { message, metricType: analysis.metricType },
        actions: ['generate_analytics']
      })
    };

    const generator = taskGenerators[agentType];
    return generator ? generator() : null;
  }

  /**
   * Analyze if tasks can be parallelized
   */
  analyzeParallelization(assignments) {
    // Check if any tasks have dependencies
    const hasDependencies = assignments.some(a => 
      a.dependsOn && a.dependsOn.length > 0
    );

    // Check if there are independent domain tasks
    const domainTasks = assignments.filter(a => 
      !a.agentType.includes('PLANNER') && 
      !a.agentType.includes('EXECUTOR') &&
      !a.agentType.includes('MEMORY')
    );

    // Can parallelize if we have multiple independent domain tasks
    return domainTasks.length > 1 && !hasDependencies;
  }

  /**
   * Generate coordination plan
   */
  generateCoordinationPlan(assignments, parallelizable) {
    const phases = [];

    if (parallelizable) {
      // Phase 1: Planning
      const planningTasks = assignments.filter(a => 
        a.agentType.includes('PLANNER')
      );
      if (planningTasks.length > 0) {
        phases.push({
          name: 'planning',
          tasks: planningTasks,
          parallel: false,
          description: 'Generate execution plan'
        });
      }

      // Phase 2: Parallel execution
      const domainTasks = assignments.filter(a => 
        !a.agentType.includes('PLANNER') && 
        !a.agentType.includes('EXECUTOR') &&
        !a.agentType.includes('MEMORY')
      );
      if (domainTasks.length > 0) {
        phases.push({
          name: 'execution',
          tasks: domainTasks,
          parallel: true,
          description: 'Execute domain tasks in parallel'
        });
      }

      // Phase 3: Coordination & completion
      const coordinationTasks = assignments.filter(a => 
        a.agentType.includes('EXECUTOR') || 
        a.agentType.includes('MEMORY')
      );
      if (coordinationTasks.length > 0) {
        phases.push({
          name: 'coordination',
          tasks: coordinationTasks,
          parallel: false,
          description: 'Coordinate results and finalize'
        });
      }
    } else {
      // Sequential execution
      phases.push({
        name: 'sequential',
        tasks: assignments,
        parallel: false,
        description: 'Execute tasks sequentially'
      });
    }

    return {
      strategy: parallelizable ? 'parallel' : 'sequential',
      phases,
      estimatedDuration: this.estimateDuration(phases),
      checkpoints: this.generateCheckpoints(phases)
    };
  }

  /**
   * Estimate execution duration
   */
  estimateDuration(phases) {
    let totalMs = 0;

    for (const phase of phases) {
      if (phase.parallel) {
        // Parallel phase takes as long as longest task
        const maxTaskTime = phase.tasks.reduce((max, t) => {
          const taskTime = this.estimateTaskTime(t);
          return Math.max(max, taskTime);
        }, 0);
        totalMs += maxTaskTime;
      } else {
        // Sequential phase sums all tasks
        totalMs += phase.tasks.reduce((sum, t) => 
          sum + this.estimateTaskTime(t), 0
        );
      }
    }

    return totalMs;
  }

  /**
   * Estimate single task time
   */
  estimateTaskTime(task) {
    const timeEstimates = {
      'generate_plan': 5000,
      'process_email_request': 3000,
      'process_calendar_request': 4000,
      'conduct_research': 8000,
      'manage_tasks': 2000,
      'manage_notes': 3000,
      'generate_analytics': 6000,
      'execute_plan': 2000,
      'manage_context': 1000
    };

    return timeEstimates[task.task] || 3000;
  }

  /**
   * Generate checkpoints for progress tracking
   */
  generateCheckpoints(phases) {
    const checkpoints = [];
    let cumulativeTime = 0;

    for (const phase of phases) {
      cumulativeTime += this.estimatePhaseTime(phase);
      checkpoints.push({
        name: `${phase.name}_complete`,
        estimatedTime: cumulativeTime,
        description: `${phase.name} phase completed`
      });
    }

    return checkpoints;
  }

  /**
   * Estimate phase time
   */
  estimatePhaseTime(phase) {
    if (phase.parallel) {
      return Math.max(...phase.tasks.map(t => this.estimateTaskTime(t)));
    }
    return phase.tasks.reduce((sum, t) => sum + this.estimateTaskTime(t), 0);
  }

  /**
   * Base intent analysis (existing functionality)
   */
  async performBaseIntentAnalysis(message, context) {
    // This would call the existing AI model
    // Placeholder for the actual implementation
    const lowerMessage = message.toLowerCase();
    
    return {
      intent: this.detectIntent(lowerMessage),
      complexity: this.assessComplexity(lowerMessage),
      needsCanvas: this.needsCanvas(lowerMessage),
      canvasType: this.determineCanvasType(lowerMessage),
      searchQuery: this.extractSearchQuery(lowerMessage),
      metricType: this.extractMetricType(lowerMessage),
      thinkingBlocks: this.generateThinkingBlocks(lowerMessage)
    };
  }

  /**
   * Detect basic intent
   */
  detectIntent(message) {
    if (/reply|respond|answer/i.test(message)) return 'reply';
    if (/draft|write|compose/i.test(message)) return 'draft';
    if (/search|find|look for/i.test(message)) return 'search';
    if (/schedule|book|set up.*meeting/i.test(message)) return 'schedule';
    if (/summarize|summary|digest/i.test(message)) return 'summarize';
    if (/plan|organize|coordinate/i.test(message)) return 'plan';
    if (/analyze|report|metrics/i.test(message)) return 'analyze';
    return 'general';
  }

  /**
   * Assess complexity
   */
  assessComplexity(message) {
    const indicators = [
      /and.*(then|also|additionally)/i, // Multiple actions
      /(multiple|several|various|different)/i, // Multiple items
      /(workflow|process|sequence|steps)/i, // Workflow language
      /(complex|complicated|sophisticated)/i // Explicit complexity
    ];

    const score = indicators.reduce((sum, regex) => 
      sum + (regex.test(message) ? 1 : 0), 0
    );

    return score >= 2 ? 'complex' : 'simple';
  }

  /**
   * Check if canvas needed
   */
  needsCanvas(message) {
    return /(draft|plan|analyze|workflow|multiple|several)/i.test(message);
  }

  /**
   * Determine canvas type
   */
  determineCanvasType(message) {
    if (/email|draft|reply/i.test(message)) return 'email_draft';
    if (/plan|workflow|steps/i.test(message)) return 'action_plan';
    if (/meeting|schedule/i.test(message)) return 'meeting_schedule';
    if (/analyze|report|metrics/i.test(message)) return 'analytics';
    return 'general';
  }

  /**
   * Extract search query
   */
  extractSearchQuery(message) {
    const match = message.match(/(?:search|find|look for)\s+(?:for\s+)?(.+)/i);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract metric type
   */
  extractMetricType(message) {
    if (/email|inbox|messages/i.test(message)) return 'email';
    if (/calendar|meetings/i.test(message)) return 'meetings';
    if (/task|todo/i.test(message)) return 'tasks';
    return 'general';
  }

  /**
   * Generate thinking blocks
   */
  generateThinkingBlocks(message) {
    return [{
      id: 'intent-analysis',
      title: 'Analyzing Intent',
      status: 'active',
      steps: [
        { id: '1', label: 'Detecting primary intent', status: 'active', type: 'think' },
        { id: '2', label: 'Assessing complexity', status: 'pending', type: 'analyze' },
        { id: '3', label: 'Planning execution approach', status: 'pending', type: 'plan' }
      ]
    }];
  }

  /**
   * Generate response with multi-agent context
   */
  async generateResponse(message, context = {}) {
    const execContext = executionContextManager.createContext({
      userEmail: context.userEmail,
      actionType: 'generate_response'
    });

    return executionContextManager.runWithContext(execContext, async () => {
      executionTelemetry.collector?.startSpan('ai_generate_response');

      try {
        // Include multi-agent context if available
        const enrichedContext = {
          ...context,
          activeAgents: context.activeAgents || [],
          coordinationPlan: context.coordinationPlan || null
        };

        // Call existing response generation
        const response = await this.performBaseResponseGeneration(
          message, 
          enrichedContext
        );

        executionTelemetry.collector?.endSpan('ai_generate_response', 'ok', {
          response_length: response?.length || 0
        });

        return response;

      } catch (error) {
        executionTelemetry.collector?.endSpan('ai_generate_response', 'error');
        throw error;
      }
    });
  }

  /**
   * Base response generation
   */
  async performBaseResponseGeneration(message, context) {
    // Placeholder - actual implementation would call AI model
    return `I've analyzed your request: "${message}". 
    
${context.coordinationPlan ? `
I'm coordinating ${context.coordinationPlan.phases.length} phases with multiple specialized agents:
${context.coordinationPlan.phases.map(p => `- ${p.name}: ${p.description}`).join('\n')}
` : ''}

I'll get started on this right away.`;
  }

  /**
   * Generate canvas content with agent coordination
   */
  async generateCanvasContent(message, canvasType, emailContext, options = {}) {
    const execContext = executionContextManager.createContext({
      userEmail: options.userEmail,
      actionType: 'generate_canvas'
    });

    return executionContextManager.runWithContext(execContext, async () => {
      executionTelemetry.collector?.startSpan('ai_generate_canvas');

      try {
        // Include agent context
        const enrichedOptions = {
          ...options,
          canvasType,
          emailContext,
          multiAgent: options.multiAgent || false
        };

        const canvas = await this.performBaseCanvasGeneration(
          message,
          enrichedOptions
        );

        executionTelemetry.collector?.endSpan('ai_generate_canvas', 'ok');

        return canvas;

      } catch (error) {
        executionTelemetry.collector?.endSpan('ai_generate_canvas', 'error');
        throw error;
      }
    });
  }

  /**
   * Base canvas generation
   */
  async performBaseCanvasGeneration(message, options) {
    // Placeholder - actual implementation would call AI model
    return {
      type: options.canvasType,
      title: this.generateCanvasTitle(message, options.canvasType),
      content: {
        text: `Generated content for: ${message}`,
        actions: []
      },
      multiAgentContext: options.multiAgent ? {
        phases: ['planning', 'execution', 'coordination'],
        agents: ['planner', 'executor']
      } : null
    };
  }

  /**
   * Generate canvas title
   */
  generateCanvasTitle(message, canvasType) {
    const titles = {
      'email_draft': 'Email Draft',
      'action_plan': 'Execution Plan',
      'meeting_schedule': 'Meeting Schedule',
      'analytics': 'Analytics Report'
    };

    return titles[canvasType] || 'Canvas';
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default BoultAIService;
