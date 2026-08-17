import { BoultAIService } from './boult-ai';
import { DatabaseService } from './supabase';
import { MissionTools } from './mission-tools';
import crypto from 'crypto';

const uuidv4 = () => crypto.randomUUID();

/**
 * Boult Mission Control
 * Chat-to-Mission state machine using sandboxed tools.
 */
export class BoultMissionService {
  constructor(userEmail) {
    this.userEmail = userEmail;
    this.db = new DatabaseService();
    this.boultAI = new BoultAIService();
    this.tools = new MissionTools(userEmail);
  }

  /**
   * Create a new mission from a chat goal.
   */
  async createMission(goal, conversationId, threadId = null) {
    const missionId = `mission_${uuidv4()}`;
    const createdAt = new Date().toISOString();

    const isScheduling = /schedule|meeting|call|demo|calendar|slot/i.test(goal);
    const isCatchUp = /catch up|summarize|what did i miss|unread/i.test(goal);

    // --- AI-POWERED STEP GENERATION ('The To-Do List') ---
    let steps = [];
    const aiSteps = await this.boultAI.generateMissionSteps(goal, { threadId });

    if (aiSteps && aiSteps.length > 0) {
      steps = aiSteps.map((s, idx) => ({
        id: `step_${uuidv4()}`,
        order: idx + 1,
        actionType: s.actionType,
        label: s.label,
        description: s.description || goal,
        status: 'pending'
      }));
    } else {
      // Fallback Template (Real, not hardcoded placeholders)
      let currentOrder = 1;
      if (!threadId || isCatchUp) {
        steps.push({
          id: `step_${uuidv4()}`,
          order: currentOrder++,
          actionType: 'search_email',
          label: isCatchUp ? 'Finding recent unread threads' : `Locating context for: ${goal}`,
          description: isCatchUp ? 'is:unread' : goal,
          status: 'pending'
        });
      }

      steps.push({
        id: `step_${uuidv4()}`,
        order: currentOrder++,
        actionType: 'read_thread',
        label: 'Analyzing thread details and participants',
        description: threadId || '',
        status: 'pending'
      });

      steps.push({
        id: `step_${uuidv4()}`,
        order: currentOrder++,
        actionType: 'draft_reply',
        label: 'Drafting the outcome-focused response',
        description: goal,
        status: 'pending'
      });
    }

    const mission = {
      id: missionId,
      goal,
      status: 'draft', // Draft -> Thinking -> Executing -> Waiting on them / Done
      linkedThreadIds: [],
      steps,
      planCards: [],
      auditTrail: [],
      createdAt,
      updatedAt: createdAt,
      conversationId,
      maxNudges: 2,
      nudgeCount: 0,
      lastNudgeAt: null,
      thoughts: []
    };

    await this.db.createMission(this.userEmail, mission);

    mission.auditTrail.push(this._auditEntry(mission.id, 'mission_created', {
      goal
    }));

    return mission;
  }

  /**
   * Execute the mission until it requires user intervention or is finished.
   */
  async executeMission(mission, context = {}) {
    let currentStep = mission.steps.find(s => s.status === 'pending');
    let lastResult = null;
    let lastError = null;
    let missionProcess = null;

    // Initial Thinking Phase - Internalized verbs
    let currentThoughts = mission.thoughts || [];
    if (mission.status === 'draft' || mission.status === 'thinking') {
      const thoughtText = await this.boultAI.generateThoughts(mission.goal, context);
      currentThoughts = [thoughtText];
      mission.thoughts = currentThoughts; // Persist it
      missionProcess = this._buildProcess(mission, 'thinking', thoughtText || 'Thinking...', currentThoughts);
      mission.status = 'thinking';
    }
    mission.status = 'executing';

    // Execute steps as long as they are automated and the mission status allows
    while (currentStep && mission.status === 'executing') {
      currentStep.status = 'running';
      currentStep.startedAt = new Date().toISOString();

      const missionContext = {
        ...context,
        missionId: mission.id,
        previousResults: mission.steps
          .filter(s => s.status === 'done')
          .reduce((acc, s) => ({ ...acc, [s.actionType]: s.result || {} }), {})
      };

      // Generate a granular thought for the current step to keep it 'alive'
      try {
        const stepThought = await this.boultAI.generateThoughts(`${mission.goal} -> ${currentStep.label}`, missionContext);
        if (stepThought && !currentThoughts.includes(stepThought)) {
          currentThoughts.push(stepThought);
          mission.thoughts = currentThoughts;
        }
      } catch (e) {
        console.warn('Thought generation failed:', e.message);
      }

      // Set process label for UI based on action type
      const phase = currentStep.actionType === 'search_email' || currentStep.actionType === 'get_availability' ? 'searching' : 'executing';
      const label = currentStep.label || (phase === 'searching' ? 'Searching...' : 'Executing...');

      // CRITICAL: Preserve thoughts when updating the process status
      missionProcess = this._buildProcess(mission, phase, label, currentThoughts);

      try {
        let stepResult = null;
        switch (currentStep.actionType) {
          case 'search_email': {
            stepResult = await this.tools.searchEmail(currentStep.description || mission.goal, {});
            currentStep.result = stepResult;

            // Check for tool-level errors
            if (stepResult.error) {
              currentStep.label = `Search failed: ${stepResult.error}`;
              currentStep.status = 'failed';
              currentStep.error = stepResult.error;
              mission.status = 'waiting_on_user';
              lastError = new Error(stepResult.error);
              break;
            }

            if (stepResult.count > 0 && stepResult.threads?.[0]?.thread_id) {
              const topThreadId = stepResult.threads[0].thread_id;
              if (!mission.linkedThreadIds.includes(topThreadId)) {
                mission.linkedThreadIds.push(topThreadId);
              }
            }

            currentStep.label = stepResult.count > 0
              ? `Found ${stepResult.count} relevant thread${stepResult.count > 1 ? 's' : ''}`
              : 'No matching threads found in your inbox';
            break;
          }

          case 'read_thread': {
            const searchResult = missionContext.previousResults?.search_email;
            const threadId = missionContext.threadId || mission.linkedThreadIds[0] || searchResult?.threads?.[0]?.thread_id;

            if (!threadId) {
              currentStep.label = 'No thread found to analyze';
              stepResult = { thread_id: null, messages: [], error: 'No thread context available. Try being more specific.' };
              currentStep.result = stepResult;
              currentStep.status = 'failed'; // STOP the loop if we can't find context
              mission.status = 'waiting_on_user';
              break;
            }

            if (!mission.linkedThreadIds.includes(threadId)) mission.linkedThreadIds.push(threadId);
            stepResult = await this.tools.getThread(threadId);
            currentStep.result = stepResult;

            if (stepResult.error) {
              currentStep.label = `Failed to read thread: ${stepResult.error}`;
              currentStep.status = 'failed';
              currentStep.error = stepResult.error;
              mission.status = 'waiting_on_user';
              lastError = new Error(stepResult.error);
              break;
            }

            const subject = searchResult?.threads?.find((t) => t.thread_id === threadId)?.subject || 'thread';
            currentStep.label = `Analyzed context from ${subject.substring(0, 30)}${subject.length > 30 ? '...' : ''}`;
            break;
          }



          case 'draft_reply': {
            // Check if this is an approval from the 'Send' modal
            if (context.approvalPayload) {
              const payload = context.approvalPayload;
              console.log('📬 Processing approved reply for mission:', mission.id);

              const sendResult = await this.tools.sendEmail({
                threadId: payload.threadId || mission.linkedThreadIds[0],
                to: [payload.recipientEmail],
                subject: payload.subject,
                body: payload.content
              });

              if (!sendResult.message_id) {
                throw new Error('Send succeeded but no message_id returned.');
              }

              stepResult = sendResult;
              mission.status = 'waiting_on_other';
              currentStep.label = `Sent reply to ${payload.recipientEmail}`;
              currentStep.status = 'done';
              currentStep.result = stepResult;
              break;
            }

            const threadResult = missionContext.previousResults?.read_thread;
            const messages = threadResult?.messages || [];
            const searchResult = missionContext.previousResults?.search_email;

            // Build extractedFacts from completed steps
            const extractedFacts = {};
            // ... (rest of facts)
            if (searchResult) {
              extractedFacts.searchQuery = searchResult.query;
              extractedFacts.threadsFound = searchResult.count;
              extractedFacts.topThreadSubject = searchResult.threads?.[0]?.subject;
              extractedFacts.topThreadParticipants = searchResult.threads?.[0]?.participants;
            }
            if (threadResult) {
              extractedFacts.lastMessageFrom = messages[messages.length - 1]?.from;
              extractedFacts.lastMessageDate = messages[messages.length - 1]?.date;
              extractedFacts.threadSubject = messages[0]?.subject;
            }

            // Plan the action using Grounded Generation with FULL context
            const aiPlan = await this.boultAI.planNextAction(mission.goal, {
              threadSummary: searchResult?.threads?.[0]?.snippet || '',
              lastMessages: messages,
              extractedFacts,
              userPreferences: context.userPreferences || {},
              conversationHistory: context.conversationHistory || []
            });

            // 1. Safety & Confidence Check
            const risky = aiPlan.safety_flags?.length > 0;
            const uncertain = aiPlan.confidence < 0.6 || aiPlan.questions_for_user?.length > 0;

            if (risky || uncertain) {
              mission.status = 'waiting_on_user';
              stepResult = {
                type: 'clarification_required',
                questions: aiPlan.questions_for_user,
                flags: aiPlan.safety_flags,
                plan: aiPlan
              };
              currentStep.result = stepResult;
              currentStep.label = aiPlan.questions_for_user?.[0]
                ? `Need clarification: ${aiPlan.questions_for_user[0].substring(0, 50)}...`
                : 'Needs your approval before proceeding';
              currentStep.status = 'done';
              break;
            }

            // 2. Autonomous Execution with validation

            if (aiPlan.next_action === 'send_email' || aiPlan.next_action === 'draft_reply' || aiPlan.next_action === 'create_draft') {
              // ALWAYS stop for user approval for replies in chat
              mission.status = 'waiting_on_user';
              stepResult = {
                type: 'reply_proposal',
                content: aiPlan.draft_body,
                recipientEmail: aiPlan.send_to?.[0] || 'recipient@example.com',
                recipientName: aiPlan.send_to?.[0]?.split('@')[0] || 'Recipient',
                subject: aiPlan.draft_subject,
                threadId: mission.linkedThreadIds[0],
                plan: aiPlan
              };
              currentStep.result = stepResult;
              currentStep.label = `Proposed reply to ${stepResult.recipientEmail}`;
              currentStep.status = 'done';
              break;


            } else if (aiPlan.next_action === 'summarize') {
              mission.status = 'done';
              stepResult = {
                type: 'summary',
                content: aiPlan.draft_body
              };
              currentStep.label = 'Summarized threads';

              stepResult = { error: "Direct calendar scheduling is disabled. Please provide your Cal.com link or manual slots." };
              mission.status = 'waiting_on_user';
              currentStep.label = `Scheduling failed: Google Calendar disabled`;

            } else {
              // clarify or unknown action
              mission.status = 'waiting_on_user';
              stepResult = aiPlan;
              currentStep.label = 'Waiting for your input';
            }

            currentStep.result = stepResult;
            break;
          }

          default:
            break;
        }

        // Only mark as done if not already marked as failed inside the handler
        if (currentStep.status !== 'failed' && currentStep.status !== 'done') {
          currentStep.status = 'done';
        }
        currentStep.completedAt = new Date().toISOString();
        lastResult = stepResult;

        mission.auditTrail.push(
          this._auditEntry(mission.id, currentStep.actionType, {
            stepId: currentStep.id,
            result: stepResult
          })
        );

        // If the step failed or mission needs user input, stop the loop
        if (currentStep.status === 'failed' || mission.status !== 'executing') {
          break;
        }
      } catch (e) {
        console.error('Step execution failed:', e);
        currentStep.status = 'failed';
        currentStep.error = e.message;
        lastError = e;
        mission.status = 'waiting_on_user';

        // Log the failure in audit trail
        mission.auditTrail.push(
          this._auditEntry(mission.id, `${currentStep.actionType}_failed`, {
            stepId: currentStep.id,
            error: e.message
          })
        );
        break;
      }

      // Check for next step
      currentStep = mission.steps.find(s => s.status === 'pending');
    }

    if (!currentStep && mission.status === 'executing') {
      mission.status = 'done';
    }

    mission.updatedAt = new Date().toISOString();
    await this.db.updateMission(this.userEmail, mission);

    return { mission, result: lastResult, error: lastError, process: missionProcess };
  }

  /**
   * Monitor missions and trigger nudges if needed.
   */
  async checkAndTriggerNudge(missionId) {
    const mission = await this.db.getMissionById?.(this.userEmail, missionId);
    if (!mission || mission.status !== 'waiting_on_other') return null;

    if (mission.nudgeCount >= (mission.maxNudges || 2)) {
      mission.status = 'waiting_on_user';
      mission.updatedAt = new Date().toISOString();
      await this.db.updateMission(this.userEmail, mission);
      return {
        mission,
        message: "I've followed up a few times now with no response. How would you like to proceed?"
      };
    }

    mission.nudgeCount++;
    mission.lastNudgeAt = new Date().toISOString();

    const nudgeStep = {
      id: `step_nudge_${uuidv4()}`,
      order: mission.steps.length + 1,
      actionType: 'draft_reply',
      label: `Follow-up #${mission.nudgeCount}`,
      description: `Following up on: ${mission.goal}`,
      status: 'pending'
    };
    mission.steps.push(nudgeStep);

    return await this.executeMission(mission);
  }

  _buildProcess(mission, phase, label, thoughtTexts = []) {
    const now = new Date().toISOString();
    return {
      id: `proc_${Date.now()}`,
      phase,
      label,
      steps: mission.steps,
      isExpanded: true,
      thoughts: thoughtTexts.map((text, idx) => ({
        id: `t_${idx}_${uuidv4()}`,
        text,
        timestamp: now,
        phase
      }))
    };
  }

  _auditEntry(missionId, actionType, extra = {}) {
    return {
      id: `audit_${uuidv4()}`,
      missionId,
      timestamp: new Date().toISOString(),
      actionType,
      approvedBy: 'system',
      ...extra
    };
  }
}
