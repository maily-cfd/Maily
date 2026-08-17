/**
 * Boult Plan Mode Engine
 * Generates AI-driven plans with objectives, assumptions, todos with dependencies
 * Integrates with BoultPlanEngine for persistence
 */

import { BoultPlanEngine } from './boult-plan-engine.js';

export class PlanModeEngine {
  constructor({ boultAI, db, userEmail }) {
    this.boultAI = boultAI;
    this.db = db;
    this.userEmail = userEmail;
    this.planEngine = new BoultPlanEngine({ db, userEmail });
  }

  /**
   * Generate a comprehensive Plan Artifact using AI
   * This creates objectives, assumptions, todos with dependencies, acceptance criteria
   */
  async generatePlan({
    message,
    runId,
    conversationId,
    context = {},
    intent = 'general',
    complexity = 'simple'
  }) {
    // Build the system prompt for plan generation
    const systemPrompt = this._buildPlanGenerationPrompt(context);

    try {
      // Call AI to generate structured plan
      const response = await this.boultAI.callOpenRouter([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Create an execution plan for: ${message}` }
      ], {
        maxTokens: 2000,
        temperature: 0.3,
        taskType: 'planning'
      });

      const content = this._extractResponse(response);
      const planData = this._parsePlanJSON(content);

      // Enrich plan with execution metadata
      const enrichedPlan = this._enrichPlanWithMetadata(planData, message, intent, complexity);

      // Build in-memory plan artifact first (always works)
      const inMemoryPlanId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const inMemoryPlan = {
        plan_id: inMemoryPlanId,
        title: enrichedPlan.title,
        objective: enrichedPlan.objective,
        status: 'draft',
        version: 1,
        locked: false,
        intent,
        complexity,
        canvas_type: this._inferCanvasType(intent, enrichedPlan.todos),
        assumptions: JSON.stringify(enrichedPlan.assumptions || []),
        questions_answered: JSON.stringify(enrichedPlan.questionsAnswered || []),
        acceptance_criteria: JSON.stringify(enrichedPlan.acceptanceCriteria || []),
        created_at: new Date().toISOString()
      };

      const inMemoryTodos = enrichedPlan.todos.map((todo, index) => ({
        todo_id: `todo_${inMemoryPlanId}_${index}`,
        title: todo.title,
        description: todo.description || '',
        action_type: todo.actionType || 'generic_task',
        status: 'pending',
        sort_order: todo.order || index,
        depends_on: todo.dependsOn || [],
        approval_mode: todo.approvalMode || 'auto',
        attempt_count: 0,
        result_payload: null
      }));

      // Attempt DB persistence (best-effort, do not block the plan card)
      let persistedPlanId = inMemoryPlanId;
      try {
        const { planId } = await this.planEngine.createPlan({
          runId,
          conversationId,
          title: enrichedPlan.title,
          objective: enrichedPlan.objective,
          assumptions: enrichedPlan.assumptions,
          questionsAnswered: enrichedPlan.questionsAnswered,
          acceptanceCriteria: enrichedPlan.acceptanceCriteria,
          todos: enrichedPlan.todos,
          sourceMessage: message,
          intent,
          complexity,
          canvasType: this._inferCanvasType(intent, enrichedPlan.todos)
        });
        persistedPlanId = planId;
        console.log(`Plan persisted to DB: ${planId}`);
      } catch (dbError) {
        console.warn(`Plan DB persistence failed (plan will still render): ${dbError.message}`);
      }

      return {
        planId: persistedPlanId,
        plan: inMemoryPlan,
        todos: inMemoryTodos,
        thinkingBlocks: this._generateThinkingBlocks(enrichedPlan)
      };
    } catch (error) {
      console.error('Plan generation failed:', error.message);
      // Fallback to simple in-memory plan (no DB dependency)
      return this._generateInMemoryFallbackPlan({ message, intent, complexity });
    }
  }

  /**
   * Build the AI prompt for plan generation
   */
  _buildPlanGenerationPrompt(context) {
    return `You are BOULT — the world's most capable AI Email & Productivity Operating System.
You are proactive, extremely competent, and ruthlessly efficient. You are the executive-level intelligence layer between the user and their work life.

Generate ULTRA-DETAILED, structured execution plans for an email workspace.

CONTEXT AWARENESS:
Use the provided email/notes context to make plans specific.
- Mention specific names, dates, and subjects from the user's data.
- If the user asks to "prepare for a meeting with X", reference actual emails from X.

OUTPUT FORMAT - Strict JSON:
{
  "title": "Clear, actionable plan title (5-10 words)",
  "objective": "RICH MARKDOWN content. This is the PRIMARY plan display shown to the user with a typewriter animation. Write it as a complete plan document using markdown formatting:\\n\\n## Strategic Overview\\nA 2-3 sentence overview of what this plan will accomplish.\\n\\n### Approach\\n1. **Step name** — detailed description of what will be done and why\\n2. **Step name** — continue numbering\\n\\n### Considerations\\n- Bullet point considerations specific to this request\\n\\n### Expected Outcome\\nWhat the user will have when complete.",
  "assumptions": [],
  "questionsAnswered": [],
  "acceptanceCriteria": [],
  "todos": [
    {
      "title": "Very descriptive step name",
      "description": "Deeply detailed context: what to look for, specific parameters.",
      "actionType": "one of: search_email, read_thread, draft_reply, send_email, schedule_meeting, notion_create_page, tasks_add_tasks, analyze_data, generic_task",
      "dependsOn": [],
      "approvalMode": "manual (for send_email, notion_create_page) or auto",
      "estimatedDuration": "detailed estimate"
    }
  ],
  "riskLevel": "low|medium|high",
  "requiresApproval": true
}

CRITICAL — OBJECTIVE FIELD RULES:
1. The "objective" field must be RICH MARKDOWN — headings, numbered lists, bold text, bullet points.
2. Write it as if it's a plan document the user reads. Be specific, reference actual request details.
3. Include: Strategic Overview, Approach (numbered steps with bold names), Considerations, Expected Outcome.
4. Use \\n for newlines inside the JSON string.
5. Every plan must be UNIQUE. Never reuse generic phrases like "Analyze request" or "Gather context."
6. No emojis. No unicode symbols.

PLANNING PRINCIPLES:
1. GRANULARITY: Break complex tasks into 6-12 tiny, verifiable steps.
2. DEPENDENCIES: Use "dependsOn" array to reference todo indices (0-based).
3. MUTATING ACTIONS: Set approvalMode to "manual" for send_email, notion_create_page.
4. CONTEXTUAL: Reference specific emails, names, dates from the user's data.
5. EXECUTIVE INTELLIGENCE: Plans should be high-signal, actionable, and designed to drive real outcomes.

Return ONLY valid JSON. No markdown wrapping, no explanation outside the JSON.`;
  }

  /**
   * Extract response content from API
   */
  _extractResponse(data) {
    return data?.choices?.[0]?.message?.content || '';
  }

  /**
   * Parse and validate plan JSON
   */
  _parsePlanJSON(content) {
    try {
      // Clean markdown indicators
      let cleanContent = content.trim();
      if (cleanContent.includes('```json')) {
        cleanContent = cleanContent.split('```json')[1].split('```')[0];
      } else if (cleanContent.includes('```')) {
        cleanContent = cleanContent.split('```')[1].split('```')[0];
      }

      const parsed = JSON.parse(cleanContent.trim());

      // Validate required fields
      if (!parsed.title || !parsed.objective || !Array.isArray(parsed.todos)) {
        throw new Error('Invalid plan structure: missing required fields');
      }

      return parsed;
    } catch (error) {
      console.error('Failed to parse plan JSON:', error);
      throw error;
    }
  }

  /**
   * Enrich plan with execution metadata
   */
  _enrichPlanWithMetadata(planData, sourceMessage, intent, complexity) {
    const todos = planData.todos.map((todo, index) => ({
      ...todo,
      order: index,
      // Convert dependsOn indices to todo IDs (will be set after creation)
      dependsOn: (todo.dependsOn || []).map(depIndex => `todo_step_${depIndex}`),
      // Infer mutating status for approval mode
      approvalMode: todo.approvalMode || this._inferApprovalMode(todo.actionType),
      // Add retry policy
      retryPolicy: {
        max_attempts: todo.approvalMode === 'manual' ? 1 : 3,
        backoff_ms: 1000
      },
      // Add input schema based on action type
      inputSchema: this._getInputSchemaForAction(todo.actionType)
    }));

    return {
      title: planData.title,
      objective: planData.objective,
      assumptions: planData.assumptions || [],
      questionsAnswered: planData.questionsAnswered || [],
      acceptanceCriteria: planData.acceptanceCriteria || [],
      todos,
      riskLevel: planData.riskLevel || 'medium',
      requiresApproval: planData.requiresApproval !== false // default true
    };
  }

  /**
   * Infer approval mode based on action type
   */
  _inferApprovalMode(actionType) {
    const manualActions = [
      'send_email',
      'boult_outreach',
      'boult_auto_pilot',
      'schedule_meeting',
      'notion_create_page',
      'notion_append',
      'tasks_complete',
      'execute_plan'
    ];
    return manualActions.includes(actionType) ? 'manual' : 'auto';
  }

  /**
   * Get input schema for action type
   */
  _getInputSchemaForAction(actionType) {
    const schemas = {
      search_email: {
        query: { type: 'string', required: true },
        limit: { type: 'number', default: 10 },
        dateRange: { type: 'string', optional: true }
      },
      read_thread: {
        threadId: { type: 'string', required: true }
      },
      draft_reply: {
        threadId: { type: 'string', required: true },
        tone: { type: 'string', default: 'professional' },
        keyPoints: { type: 'array', optional: true }
      },
      send_email: {
        to: { type: 'string', required: true },
        subject: { type: 'string', required: true },
        body: { type: 'string', required: true },
        cc: { type: 'array', optional: true }
      },
      schedule_meeting: {
        attendees: { type: 'array', required: true },
        date: { type: 'string', required: true },
        time: { type: 'string', required: true },
        duration: { type: 'number', default: 30 },
        agenda: { type: 'string', optional: true }
      },
      notion_create_page: {
        title: { type: 'string', required: true },
        content: { type: 'string', optional: true },
        databaseId: { type: 'string', optional: true },
        parentPageId: { type: 'string', optional: true },
        tags: { type: 'array', optional: true }
      },
      tasks_add_tasks: {
        tasks: { type: 'array', required: true },
        taskListId: { type: 'string', optional: true },
        taskListTitle: { type: 'string', optional: true }
      },
      analyze_data: {
        metricType: { type: 'string', required: true },
        dateRange: { type: 'string', required: true }
      },
      generic_task: {
        taskName: { type: 'string', required: true },
        params: { type: 'object', default: {} }
      }
    };

    return schemas[actionType] || schemas.generic_task;
  }

  /**
   * Infer canvas type from intent and todos
   */
  _inferCanvasType(intent, todos) {
    const actionTypes = todos.map(t => t.actionType);

    if (actionTypes.includes('send_email') || actionTypes.includes('draft_reply')) {
      return 'email_draft';
    }
    if (actionTypes.includes('schedule_meeting')) {
      return 'meeting_schedule';
    }
    if (actionTypes.includes('analyze_data')) {
      return 'analytics';
    }
    if (intent === 'multi_step' || intent === 'execute_plan') {
      return 'action_plan';
    }

    return 'summary';
  }

  /**
   * Generate thinking blocks for UI display
   */
  _generateThinkingBlocks(plan) {
    return [{
      id: `plan-${Date.now()}`,
      title: plan.title,
      status: 'active',
      initialContext: `Planning execution for: ${plan.objective}`,
      steps: plan.todos.map((todo, i) => ({
        id: `step-${i}`,
        label: todo.title,
        status: 'pending',
        type: this._mapActionTypeToStepType(todo.actionType)
      })),
      interimConclusion: `Created ${plan.todos.length} step execution plan with ${plan.todos.filter(t => t.approvalMode === 'manual').length} requiring approval`,
      nextActionContext: 'Waiting for user approval to begin execution'
    }];
  }

  /**
   * Map action type to step type for UI
   */
  _mapActionTypeToStepType(actionType) {
    const mapping = {
      search_email: 'search',
      read_thread: 'read',
      draft_reply: 'draft',
      send_email: 'execute',
      schedule_meeting: 'execute',
      notion_create_page: 'execute',
      notion_append: 'execute',
      tasks_add_tasks: 'execute',
      analyze_data: 'analyze',
      generic_task: 'think'
    };
    return mapping[actionType] || 'think';
  }

  /**
   * Fallback plan generation when AI fails (attempts DB persistence)
   */
  async _generateFallbackPlan({ message, runId, conversationId, intent, complexity }) {
    const fallbackPlanId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const plan = {
      plan_id: fallbackPlanId,
      title: `Plan: ${message.substring(0, 50)}`,
      objective: `BOULT is architecting an execution plan for your request: "${message}"\n\nThe executive intelligence layer is analyzing your objective to determine the most effective approach. This includes deep search of your communications, drafting high-signal responses, and coordinating across your integrated tools to drive this mission to completion.`,
      status: 'draft',
      version: 1,
      locked: false,
      intent,
      complexity,
      canvas_type: 'action_plan',
      assumptions: JSON.stringify([]),
      questions_answered: JSON.stringify([]),
      acceptance_criteria: JSON.stringify([]),
      created_at: new Date().toISOString()
    };

    // Attempt DB persistence (best-effort)
    try {
      await this.planEngine.createPlan({
        runId,
        conversationId,
        title: plan.title,
        objective: plan.objective,
        assumptions: [],
        questionsAnswered: [],
        acceptanceCriteria: [],
        todos: [],
        sourceMessage: message,
        intent,
        complexity,
        canvasType: 'action_plan'
      });
    } catch (dbErr) {
      console.warn(`Fallback plan DB persistence failed: ${dbErr.message}`);
    }

    return {
      planId: fallbackPlanId,
      plan,
      todos: [],
      thinkingBlocks: []
    };
  }

  /**
   * Generate a fallback plan purely in-memory (no DB calls).
   * Used when both AI generation AND DB persistence fail.
   */
  _generateInMemoryFallbackPlan({ message, intent = 'general', complexity = 'simple' }) {
    const fallbackPlanId = `plan_fallback_${Date.now()}`;

    const fallbackPlan = {
      plan_id: fallbackPlanId,
      title: `Plan: ${message.substring(0, 50)}`,
      objective: `BOULT is architecting an execution plan for your request: "${message}"\n\nThe executive intelligence layer is analyzing your objective to determine the most effective approach. This includes deep search of your communications, drafting high-signal responses, and coordinating across your integrated tools to drive this mission to completion.`,
      status: 'draft',
      version: 1,
      locked: false,
      intent,
      complexity,
      canvas_type: 'action_plan',
      assumptions: JSON.stringify([]),
      questions_answered: JSON.stringify([]),
      acceptance_criteria: JSON.stringify([]),
      created_at: new Date().toISOString()
    };

    return {
      planId: fallbackPlanId,
      plan: fallbackPlan,
      todos: [],
      thinkingBlocks: []
    };
  }

  /**
   * Convert an approved plan to executable todo graph and begin execution
   */
  async beginExecution(planId, operatorSteps = []) {
    return this.planEngine.convertPlanToTodoGraph(planId, operatorSteps);
  }

  /**
   * Get next ready todo for execution
   */
  async getNextExecutableTodo(planId) {
    return this.planEngine.getNextReadyTodo(planId);
  }

  /**
   * Transition a todo to a new status
   */
  async transitionTodo(todoId, targetStatus, resultPayload = null, errorMessage = null) {
    return this.planEngine.transitionTodo(todoId, targetStatus, resultPayload, errorMessage);
  }

  /**
   * Get full plan with all todos
   */
  async getFullPlan(planId) {
    const [plan, todos] = await Promise.all([
      this.planEngine.getPlan(planId),
      this.planEngine.getTodos(planId)
    ]);

    if (!plan) return null;

    return {
      ...plan,
      todos
    };
  }
}

export default PlanModeEngine;
