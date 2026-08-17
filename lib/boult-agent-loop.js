/**
 * Boult Agent Loop — v1
 *
 * The brain of the agentic system. Instead of one round-trip per user message,
 * this class runs a Plan-Execute-Observe loop:
 *
 *   User message
 *     → AI plans (which tool to call)
 *       → Tool executes
 *         → AI observes result
 *           → AI decides: call another tool OR respond to user
 *             → Loop continues until "respond" tool is called or max iterations hit
 *
 * Design decisions:
 *  - JSON-based tool calling (works with all models including Liquid LFM)
 *  - SSE streaming so the frontend sees each step in real-time
 *  - Approval gate on high-risk actions only (send_email, schedule_meeting)
 *  - Self-healing: on tool failure, AI is asked "what next?" instead of hard-failing
 */

import { TOOL_DEFINITIONS, buildToolPromptBlock, getToolDefinition } from './boult-tool-definitions.js';
import { DatabaseService } from './supabase.js';
import { decrypt } from './crypto.js';
import crypto from 'crypto';
import { supermemory } from './supermemory-client.js';

const uuid = () => crypto.randomUUID();

// Maximum iterations before force-stopping (Increased for Ultra-Deep Thinking)
const MAX_ITERATIONS = 25;

// ─── SSE helpers ────────────────────────────────────────────────────────────

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ─── Agent Loop ─────────────────────────────────────────────────────────────

export class BoultAgentLoop {
  /**
   * @param {object} opts
   * @param {import('./boult-ai.js').BoultAIService} opts.boultAI
   * @param {DatabaseService} opts.db
   * @param {string} opts.userEmail
   * @param {string} opts.userName
   * @param {object} opts.integrations  - which services are connected
   * @param {string|null} opts.conversationId
   * @param {Array}  opts.conversationHistory
   * @param {string|null} opts.gmailAccessToken
   * @param {boolean} opts.privacyMode
   * @param {string|null} [opts.memoryContext]
   * @param {string|null} [opts.selectedEmailId]
   * @param {string} [opts.mode]
   */
  constructor(opts) {
    this.boultAI = opts.boultAI;
    this.db = opts.db;
    this.userEmail = opts.userEmail;
    this.userName = opts.userName || 'User';
    this.integrations = opts.integrations || {};
    this.conversationId = opts.conversationId || null;
    this.conversationHistory = opts.conversationHistory || [];
    this.gmailAccessToken = opts.gmailAccessToken || null;
    this.privacyMode = opts.privacyMode || false;
    this.memoryContext = opts.memoryContext || null;
    this.selectedEmailId = opts.selectedEmailId || null;
    this.mode = opts.mode || 'agent';

    // Internal state for the current run
    this.runId = `aloop_${Date.now()}_${uuid().slice(0, 8)}`;
    this.steps = [];          // audit trail of every tool call + result
    this.iteration = 0;
    this.startedAt = Date.now();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC — Run the loop, returns a ReadableStream of SSE events
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Entry point. Returns a ReadableStream that emits SSE events as the
   * agent thinks, calls tools, and eventually responds.
   *
   * @param {string} userMessage - The user's message
   * @returns {ReadableStream}
   */
  createStream(userMessage, options = {}) {
    const self = this;

    return new ReadableStream({
      async start(controller) {
        // Keep-alive heartbeat
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode('event: ping\ndata: {"time":' + Date.now() + '}\n\n'));
          } catch (e) {
            clearInterval(heartbeat);
          }
        }, 5000);

        try {
          await self._runLoop(userMessage, controller, options);
        } catch (err) {
          console.error('[AgentLoop] Fatal error:', err);
          controller.enqueue(
            new TextEncoder().encode(
              sseEvent('error', { message: err.message || 'Agent loop failed' })
            )
          );
        } finally {
          clearInterval(heartbeat);
          controller.enqueue(
            new TextEncoder().encode(
              sseEvent('done', {
                runId: self.runId,
                totalSteps: self.steps.length,
                durationMs: Date.now() - self.startedAt
              })
            )
          );
          controller.close();
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — Core loop
  // ═══════════════════════════════════════════════════════════════════════════

  async _runLoop(userMessage, controller, options = {}) {
    const emit = (event, data) => {
      controller.enqueue(new TextEncoder().encode(sseEvent(event, data)));
    };

    // Emit thoughts immediately to establish the connection before long-running setup
    emit('thinking', {
      iteration: 0,
      status: 'active',
      step: 'Initializing Boult Intelligence and fetching context...'
    });

    // ── PRE-FETCH SELECTED EMAIL CONTEXT (Performance Optimization) ──
    let preFetchedEmailContent = null;
    if (this.selectedEmailId) {
      try {
        const { gmailService } = await this._getGmailService();
        const email = await gmailService.getEmail(this.selectedEmailId);
        if (email) {
          preFetchedEmailContent = `
## CURRENT EMAIL CONTEXT (PRE-FETCHED)
Subject: ${email.subject}
From: ${email.from}
To: ${email.to}
Date: ${email.date}
Body: ${email.body?.substring(0, 5000)}
          `;
          emit('thinking', { iteration: 0, status: 'active', step: 'Context loaded. Analyzing thread...' });
        }
      } catch (err) {
        console.warn('[AgentLoop] Failed to pre-fetch email:', err.message);
      }
    }

    // ── Pre-run Setup (Parallelized to prevent 504) ─────────────────────────
    const [supermemoryContext, initialThoughts] = await Promise.all([
      // Fetch context from Supermemory
      (async () => {
        if (!supermemory.apiKey) return '';
        try {
          const memories = await supermemory.getMemories(this.userEmail, userMessage, 5);
          if (memories && memories.length > 0) {
            return `\n\n## Episodic Memory (Supermemory)\nHere is relevant context from past interactions:\n` +
              memories.map(m => `- ${m.content || m.text}`).join('\n');
          }
        } catch (err) {
          console.warn('[AgentLoop] Supermemory fetch failed:', err);
        }
        return '';
      })(),
      // Generate initial tactical thoughts
      (async () => {
        try {
          return await this.boultAI.generateThoughts(userMessage, {
            conversationHistory: this.conversationHistory,
            integrations: this.integrations
          });
        } catch (err) {
          console.warn('[AgentLoop] Initial thought generation failed:', err.message);
          return 'Analyzing request and preparing execution plan...';
        }
      })()
    ]);

    // Emit thoughts immediately
    emit('thinking', {
      iteration: 0,
      status: 'active',
      step: initialThoughts
    });

    // Build the conversation for the AI
    let systemPrompt = this._buildAgentSystemPrompt(preFetchedEmailContent);
    if (supermemoryContext) {
      systemPrompt += supermemoryContext;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory.slice(-8),
      { role: 'user', content: userMessage }
    ];

    emit('run_start', { runId: this.runId, message: userMessage });

    // ── Loop ──────────────────────────────────────────────────────────────
    while (this.iteration < MAX_ITERATIONS) {
      this.iteration++;

      // ── Streaming AI Call ───────────────────────────────────────────────
      let rawContent = '';
      
      try {
        const stream = this.boultAI.streamResponse(messages, {
          temperature: 0.2,
          isDeepThinking: true,
          model: options?.modelId
        });

        let lastEmittedCleanText = '';
        for await (const chunk of stream) {
          rawContent += chunk;
          
          // Extract the portion of the message that is NOT inside <thinking> or <tool_call>
          const { cleanText } = this._extractThinkingAndMessage(rawContent);
          
          if (cleanText && cleanText !== lastEmittedCleanText) {
            emit('message', {
              content: cleanText,
              iteration: this.iteration,
              // Omitting isStreaming: true tells the frontend to replace instead of append.
              // This is critical to prevent partial tags like "<tool_c" from getting stuck on screen.
            });
            lastEmittedCleanText = cleanText;
          }
          
          // Optionally: Handle real-time thinking emission if we want users to see it in a dedicated UI
          // But for now, we follow the user's request to hide the "raw message".
        }
      } catch (err) {
        console.error(`[AgentLoop] AI call failed on iteration ${this.iteration}:`, err.message);
        emit('error', { message: `AI reasoning failed: ${err.message}`, iteration: this.iteration });
        emit('message', {
          content: `I ran into an issue while processing your request. (Error: ${err.message})`,
          iteration: this.iteration
        });
        return;
      }

      // Mark thinking as complete for this iteration if thinking block exists
      const { thinking: finalThinking } = this._extractThinkingAndMessage(rawContent);
      if (finalThinking) {
        emit('thinking', {
          iteration: this.iteration,
          status: 'complete',
          step: finalThinking
        });
      }

      // Try to parse a tool_call from the response
      const toolCall = this._extractToolCall(rawContent);

      // ── Case 1: AI wants to call a tool ───────────────────────────────
      if (toolCall) {
        const { name, params } = toolCall;
        const toolDef = getToolDefinition(name);

        // Terminal tool: "respond" — send message and end
        if (name === 'respond') {
          // Robustly extract the human-facing message
          let cleanMessage = params.message || '';
          
          // If message is missing but there is raw text outside the tags, use that
          if (!cleanMessage && rawContent) {
            cleanMessage = rawContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
          }

          // REPETITION FILTER: AI sometimes echoes the user's prompt at the start.
          // If the message starts with the exact user prompt (or a very similar one), strip it.
          const userPrompt = userMessage.trim();
          if (cleanMessage.toLowerCase().startsWith(userPrompt.toLowerCase())) {
            cleanMessage = cleanMessage.substring(userPrompt.length).trim();
            // Also strip common transition phrases that often follow an echo
            cleanMessage = cleanMessage.replace(/^(here is|drafting|searching|I will|Sure,|Certainly,|Ok,)\s*/i, '').trim();
          }

          // Final cleanup: remove any stray JSON blocks or tags that might have leaked into the message
          cleanMessage = cleanMessage.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();
          cleanMessage = cleanMessage.replace(/```json[\s\S]*?```/gi, '').trim();

          // Detect if this is an email draft to show the special Draft UI
          // 1. Check if the message content looks like an email
          const isDraftUserRequest = /draft|reply|compose|write.*email|respond/i.test(userMessage);
          let isDraft = (isDraftUserRequest && cleanMessage.length > 50) ||
                        (/subject:|to:|dear|hello|hi |best regards|sincerely|thanks|regards|---\n/i.test(cleanMessage) && 
                          (cleanMessage.length > 50));
          
          let draftData = null;

          // Helper: extract sender email from pre-fetched email context for recipient
          const extractRecipientFromContext = () => {
            if (preFetchedEmailContent) {
              const fromMatch = preFetchedEmailContent.match(/From:\s*(?:.*<)?([^\s<>]+@[^\s<>]+)/i);
              if (fromMatch) return fromMatch[1].trim();
            }
            // Also try to extract from read_email tool results
            const readEmailStep = this.steps.find(s => s.tool === 'read_email' && s.result);
            if (readEmailStep?.result?.from) {
              const emailMatch = readEmailStep.result.from.match(/<?([^\s<>]+@[^\s<>]+)>?/);
              if (emailMatch) return emailMatch[1].trim();
            }
            return '';
          };

          const extractSubjectFromContext = () => {
            if (preFetchedEmailContent) {
              const subjectMatch = preFetchedEmailContent.match(/Subject:\s*(.*)/i);
              if (subjectMatch) return 'Re: ' + subjectMatch[1].trim();
            }
            const readEmailStep = this.steps.find(s => s.tool === 'read_email' && s.result);
            if (readEmailStep?.result?.subject) {
              return 'Re: ' + readEmailStep.result.subject;
            }
            return 'Draft Reply';
          };

          // 2. Check if a save_draft tool was actually called in this loop
          const saveDraftStep = this.steps.find(s => s.tool === 'save_draft');
          
          if (saveDraftStep && saveDraftStep.params) {
            isDraft = true;
            draftData = {
              content: saveDraftStep.params.body || '',
              subject: saveDraftStep.params.subject || extractSubjectFromContext(),
              recipientEmail: saveDraftStep.params.to || extractRecipientFromContext(),
              gmailDraftId: saveDraftStep.result?.externalRefs?.gmailDraftId || saveDraftStep.result?.id
            };
          } else if (isDraft) {
            // Extract from text as fallback
            const subjectMatch = cleanMessage.match(/Subject:\s*(.*)/i);
            const toMatch = cleanMessage.match(/To:\s*(.*)/i);
            draftData = {
              content: cleanMessage,
              subject: subjectMatch ? subjectMatch[1] : extractSubjectFromContext(),
              recipientEmail: toMatch ? toMatch[1] : extractRecipientFromContext()
            };
          }

          emit('message', {
            content: cleanMessage || (rawContent.length < 500 ? rawContent : 'Mission complete.'),
            iteration: this.iteration,
            meta: isDraft ? { isDraft: true, draftData } : undefined
          });
          // Add assistant message to history for saving
          this.steps.push({ tool: 'respond', params, iteration: this.iteration });

          if (params.wait_for_user === false) {
            // AI wants to update the user but CONTINUE the loop
            messages.push({ role: 'assistant', content: rawContent });
            messages.push({
              role: 'system',
              content: `[Status update sent to user. Now, CONTINUE with the next steps of your plan. DO NOT STOP.]`
            });
            continue;
          }
          return;
        }

        // "think" tool — show reasoning, continue loop
        if (name === 'think') {
          emit('thinking', {
            iteration: this.iteration,
            status: 'active',
            step: params.reasoning || 'Reasoning...'
          });
          // Inject the reasoning into the conversation so AI remembers it
          messages.push({ role: 'assistant', content: rawContent });
          messages.push({
            role: 'system',
            content: `[Thought noted. Continue to the next action or respond.]`
          });
          this.steps.push({ tool: 'think', params, iteration: this.iteration });
          continue;
        }

        // Unknown tool
        if (!toolDef) {
          emit('tool_error', { tool: name, error: `Unknown tool: ${name}`, iteration: this.iteration });
          messages.push({ role: 'assistant', content: rawContent });
          messages.push({
            role: 'system',
            content: `[Error: Tool "${name}" does not exist. Available tools: ${TOOL_DEFINITIONS.map(t => t.name).join(', ')}. Try a different tool or respond directly.]`
          });
          this.steps.push({ tool: name, error: 'unknown_tool', iteration: this.iteration });
          continue;
        }

        // ── Approval gate ─────────────────────────────────────────────
        if (toolDef.requiresApproval) {
          emit('approval_required', {
            tool: name,
            params,
            description: toolDef.description,
            iteration: this.iteration
          });
          // For now, we pause the loop and include the draft in the response.
          // The frontend will show an approval card; executing happens via
          // the existing canvas action flow.
          emit('message', {
            content: this._buildApprovalMessage(name, params),
            iteration: this.iteration,
            meta: {
              canvasApproval: {
                status: 'pending',
                title: `Approve ${name}?`,
                description: toolDef.description,
                canvasData: params,
                canvasType: name
              }
            }
          });
          this.steps.push({ tool: name, params, status: 'pending_approval', iteration: this.iteration });
          return;
        }

        // ── Execute the tool ──────────────────────────────────────────
        emit('tool_call', { tool: name, params, iteration: this.iteration });

        let toolResult;
        
        // KEEP-ALIVE: Also ping during tool execution (important for slow API calls like Gmail)
        const toolPing = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(sseEvent('ping', { tool: name, status: 'executing' })));
          } catch (e) {
            clearInterval(toolPing);
          }
        }, 3000);

        try {
          toolResult = await this._executeTool(name, params);
          emit('tool_result', {
            tool: name,
            success: true,
            summary: this._summariseResult(name, toolResult),
            iteration: this.iteration
          });
        } catch (err) {
          toolResult = { success: false, error: err.message };
          emit('tool_error', {
            tool: name,
            error: err.message,
            iteration: this.iteration
          });
        } finally {
          clearInterval(toolPing);
        }

        // Inject the result into the conversation so AI can reason about it
        messages.push({ role: 'assistant', content: rawContent });
        messages.push({
          role: 'system',
          content: `[Tool Result for "${name}"]\n${JSON.stringify(toolResult, null, 2)}\n\n[Based on this result, decide what to do next. Call another tool or use "respond" to give the user your final answer.]`
        });

        this.steps.push({ tool: name, params, result: toolResult, iteration: this.iteration });
        continue;
      }

      // ── Case 2: AI responded with plain text (no tool call) ─────────
      // If there's thinking but no response, and we haven't hit a loop limit, try to prod the AI
      const { thinking: lastThinking } = this._extractThinkingAndMessage(rawContent);
      if (lastThinking && !rawContent.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim()) {
        console.log(`[AgentLoop] Model provided thinking but no tool call. Self-healing iteration...`);
        messages.push({ role: 'assistant', content: rawContent });
        messages.push({
          role: 'system',
          content: `[You provided your internal reasoning inside <thinking> tags, but you did not call any tool (like "respond") to provide a final answer to the user. If you are ready to answer, call the "respond" tool NOW with your final message. Do NOT repeat your internal reasoning.]`
        });
        continue;
      }

      // Treat this as the final response, but clean it of any tags just in case
      let cleanOutput = rawContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();
      cleanOutput = cleanOutput.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();

      if (cleanOutput) {
        emit('message', { content: cleanOutput, iteration: this.iteration });
        this.steps.push({ tool: 'direct_response', content: cleanOutput, iteration: this.iteration });
      } else if (lastThinking) {
        // Last resort: if we only have thoughts and can't prod further, use them as response
        emit('message', { content: lastThinking, iteration: this.iteration });
        this.steps.push({ tool: 'thought_as_response', content: lastThinking, iteration: this.iteration });
      }
      return;
    }

    // ── Safety: max iterations reached ─────────────────────────────────
    emit('message', {
      content: 'I completed the maximum number of reasoning steps. Here is what I found so far based on the steps above.',
      iteration: this.iteration
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tool Execution — Routes to actual service implementations
  // ═══════════════════════════════════════════════════════════════════════════

  async _executeTool(name, params) {
    switch (name) {

      // ── Email: Read ─────────────────────────────────────────────────
      case 'search_inbox': {
        const { gmailService } = await this._getGmailService();
        const query = params.query || 'newer_than:7d';
        const maxResults = Math.min(params.maxResults || 15, 50);
        const results = await gmailService.getEmails(maxResults, query, null);
        const messages = results?.messages || [];
        const emails = await Promise.all(
          messages.slice(0, maxResults).map(async (msg) => {
            try {
              const detail = await gmailService.getEmailDetails(msg.id);
              const parsed = gmailService.parseEmailData(detail);
              return {
                id: msg.id,
                threadId: msg.threadId,
                from: parsed.from,
                subject: parsed.subject,
                date: parsed.date,
                snippet: parsed.snippet || parsed.body?.substring(0, 200)
              };
            } catch { return null; }
          })
        );
        const filtered = emails.filter(Boolean);
        return { success: true, count: filtered.length, emails: filtered, query };
      }

      case 'read_email': {
        const { gmailService } = await this._getGmailService();
        const detail = await gmailService.getEmailDetails(params.messageId);
        const parsed = gmailService.parseEmailData(detail);
        return {
          success: true,
          email: {
            id: params.messageId,
            from: parsed.from,
            to: parsed.to,
            subject: parsed.subject,
            date: parsed.date,
            body: parsed.body?.substring(0, 4000)
          }
        };
      }

      case 'analyze_thread': {
        const { gmailService } = await this._getGmailService();
        const detail = await gmailService.getEmailDetails(params.messageId);
        const parsed = gmailService.parseEmailData(detail);
        const analysisType = params.analysisType || 'full';
        
        // Perform AI-powered analysis on the thread content
        const emailContent = parsed.body || '';
        const subject = parsed.subject || '';
        const from = parsed.from || '';
        
        // Pattern matching for different analysis types
        const analysis = {
          opportunities: [],
          actionItems: [],
          sentiment: 'neutral',
          urgency: 'normal',
          summary: ''
        };
        
        // Detect opportunities (revenue, partnership, etc.)
        const opportunityPatterns = [
          /\$[\d,]+/g, /\br?evenue\b/gi, /\bde?al\b/gi, /\bpartnership\b/gi,
          /\bcontract\b/gi, /\bproposal\b/gi, /\binvoice\b/gi, /\bpayment\b/gi
        ];
        opportunityPatterns.forEach(pattern => {
          if (pattern.test(emailContent)) {
            analysis.opportunities.push('Potential revenue/business opportunity detected');
          }
        });
        
        // Detect action items
        const actionPatterns = [
          /\bfollow\s*up\b/gi, /\bdeadline\b/gi, /\baction\s*item\b/gi,
          /\bneed\s*(your\s*)?input\b/gi, /\bplease\s*review\b/gi,
          /\bget\s*back\s*to\s*me\b/gi, /\blet['']?s\s*schedule\b/gi
        ];
        actionPatterns.forEach(pattern => {
          if (pattern.test(emailContent)) {
            analysis.actionItems.push('Action required from recipient');
          }
        });
        
        // Sentiment detection
        if (/\b(great|excellent|love|amazing|perfect|thank you|appreciate)\b/gi.test(emailContent)) {
          analysis.sentiment = 'positive';
        } else if (/\b(problem|issue|concern|disappointed|frustrated|urgent|asap)\b/gi.test(emailContent)) {
          analysis.sentiment = 'negative';
        }
        
        // Urgency detection
        if (/\b(urgent|asap|immediately|today|deadline|emergency)\b/gi.test(emailContent) ||
            /\b(EOD|COB|end of day|by (tomorrow|today))\b/gi.test(emailContent)) {
          analysis.urgency = 'high';
        } else if (/\b(this week|next week|soon)\b/gi.test(emailContent)) {
          analysis.urgency = 'medium';
        }
        
        return {
          success: true,
          analysis,
          email: {
            id: params.messageId,
            from,
            subject,
            date: parsed.date
          }
        };
      }

      // ── Email: Write ────────────────────────────────────────────────
      case 'send_email': {
        const { gmailService } = await this._getGmailService();
        const result = await gmailService.sendEmail({
          to: params.to,
          subject: params.subject,
          body: params.body,
          threadId: params.threadId || undefined,
          isHtml: false
        });
        return {
          success: true,
          message: `Email sent to ${params.to}`,
          externalRefs: { gmailMessageId: result?.id, threadId: result?.threadId }
        };
      }

      case 'save_draft': {
        const { gmailService } = await this._getGmailService();
        const result = await gmailService.createDraft({
          to: params.to || '',
          subject: params.subject,
          body: params.body,
          isHtml: false
        });
        return {
          success: true,
          message: 'Draft saved to Gmail',
          externalRefs: { gmailDraftId: result?.id }
        };
      }

      case 'archive_email': {
        const { gmailService } = await this._getGmailService();
        await gmailService.archiveEmail(params.messageId);
        return {
          success: true,
          message: 'Email archived'
        };
      }

      // ── Calendar ────────────────────────────────────────────────────
      case 'schedule_meeting': {
        const { CalendarService } = await import('./calendar.js');
        const tokens = await this._getUserTokens();
        const cal = new CalendarService(decrypt(tokens.encrypted_access_token));
        const event = await cal.createEvent({
          summary: params.summary,
          start: params.start,
          end: params.end,
          attendees: (params.attendees || []).map(e => ({ email: e })),
          description: params.description || '',
          location: params.location || ''
        });
        return {
          success: true,
          message: `Meeting "${params.summary}" scheduled`,
          externalRefs: { calendarEventId: event?.id, htmlLink: event?.htmlLink }
        };
      }

      case 'check_availability': {
        const { CalendarService } = await import('./calendar.js');
        const tokens = await this._getUserTokens();
        const cal = new CalendarService(decrypt(tokens.encrypted_access_token));
        const events = await cal.listEvents({
          timeMin: params.startDate,
          timeMax: params.endDate,
          maxResults: 20
        });
        const busy = (events || []).map(e => ({
          summary: e.summary,
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date
        }));
        return { success: true, busySlots: busy, count: busy.length };
      }

      // ── Tasks ───────────────────────────────────────────────────────
      case 'create_task': {
        const { GoogleTasksAdapter } = await import('./google-tasks-adapter.js');
        const tokens = await this._getUserTokens();
        const adapter = new GoogleTasksAdapter(
          decrypt(tokens.encrypted_access_token),
          tokens.encrypted_refresh_token ? decrypt(tokens.encrypted_refresh_token) : ''
        );
        const listTitle = params.taskListTitle || 'Boult Tasks';
        const list = await adapter.getOrCreateTaskList(listTitle);
        const task = await adapter.createTask(list.id, {
          title: params.title,
          notes: params.notes || '',
          due: params.due || null
        });
        return {
          success: true,
          message: `Task "${params.title}" added to "${listTitle}"`,
          externalRefs: { taskId: task.id, taskListId: list.id }
        };
      }

      // ── Notion ──────────────────────────────────────────────────────
      case 'notion_create_page': {
        const { NotionAdapter } = await import('./notion-adapter.js');
        const token = process.env.NOTION_INTEGRATION_TOKEN;
        if (!token) throw new Error('Notion integration not configured');
        const notion = new NotionAdapter({ token, defaultDatabaseId: process.env.NOTION_DEFAULT_DATABASE_ID || null });
        const page = await notion.createPage({
          title: params.title,
          content: params.content || '',
          tags: params.tags || []
        });
        return {
          success: true,
          message: `Notion page "${params.title}" created`,
          externalRefs: { notionPageId: page.pageId, notionUrl: page.url }
        };
      }

      case 'notion_update_page': {
        const { NotionAdapter } = await import('./notion-adapter.js');
        const token = process.env.NOTION_INTEGRATION_TOKEN;
        if (!token) throw new Error('Notion integration not configured');
        const notion = new NotionAdapter({ token });
        
        let properties = {};
        try {
          properties = typeof params.properties === 'string' ? JSON.parse(params.properties) : params.properties;
        } catch (e) {
          throw new Error('Invalid JSON in properties parameter');
        }

        const page = await notion.updatePage(params.pageId, properties);
        return {
          success: true,
          message: `Notion page updated`,
          externalRefs: { notionPageId: params.pageId }
        };
      }

      case 'open_canvas': {
        return {
          success: true,
          message: 'Canvas Panel has been opened for the task.',
          externalRefs: { canvasOpened: true, reason: params.reason }
        };
      }

      case 'notion_search': {
        const { NotionAdapter } = await import('./notion-adapter.js');
        const token = process.env.NOTION_INTEGRATION_TOKEN;
        if (!token) throw new Error('Notion integration not configured');
        const notion = new NotionAdapter({ token });
        const results = await notion.search(params.query, { limit: params.limit || 10 });
        return { success: true, count: results.length, results };
      }

      // ── Supermemory ──────────────────────────────────────────────────
      case 'save_memory': {
        if (!supermemory.apiKey) {
          throw new Error('Supermemory is not configured in this environment.');
        }
        await supermemory.addMemory(this.userEmail, params.memory);
        return { success: true, message: 'Memory saved successfully.' };
      }

      // ── Fallback ────────────────────────────────────────────────────
      default:
        throw new Error(`No executor for tool: ${name}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get an authenticated GmailService instance */
  async _getGmailService() {
    const tokens = await this._getUserTokens();
    const accessToken = decrypt(tokens.encrypted_access_token);
    const refreshToken = tokens.encrypted_refresh_token ? decrypt(tokens.encrypted_refresh_token) : '';
    const { GmailService } = await import('@/lib/gmail');
    return { gmailService: new GmailService(accessToken, refreshToken) };
  }

  /** Fetch user's stored OAuth tokens */
  async _getUserTokens() {
    const tokens = await this.db.getUserTokens(this.userEmail);
    if (!tokens?.encrypted_access_token) {
      throw new Error('Gmail is not connected. Please connect via Settings > Integrations.');
    }
    return tokens;
  }

  /**
   * Parse a tool_call from the AI's response.
   * The AI is instructed to output:
   *
   *   <tool_call>{"name":"search_inbox","params":{"query":"from:stripe"}}</tool_call>
   *
   * We also handle JSON code blocks as a fallback.
   */
  _extractToolCall(text) {
    if (!text || typeof text !== 'string') return null;

    // Primary: <tool_call>...</tool_call>
    const tagMatch = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
    if (tagMatch) {
      try {
        const parsed = JSON.parse(tagMatch[1].trim());
        if (parsed.name) return { name: parsed.name, params: parsed.params || parsed.parameters || {} };
      } catch { /* fall through */ }
    }
    // Fallback: \`\`\`json { "tool_call": ... } \`\`\`
    const jsonBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonBlockMatch) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1]);
        if (parsed.tool_call) return { name: parsed.tool_call.name, params: parsed.tool_call.params || {} };
        if (parsed.name && (parsed.params || parsed.parameters)) return { name: parsed.name, params: parsed.params || parsed.parameters || {} };
      } catch { /* fall through */ }
    }

    // Fallback: Raw JSON in text
    const rawJsonMatch = text.match(/\{"(?:name|tool_call)"[\s\S]*?\}/);
    if (rawJsonMatch) {
      try {
        const parsed = JSON.parse(rawJsonMatch[0]);
        if (parsed.name) return { name: parsed.name, params: parsed.params || parsed.parameters || {} };
        if (parsed.tool_call?.name) return { name: parsed.tool_call.name, params: parsed.tool_call.params || {} };
      } catch { /* fall through */ }
    }

    return null;
  }

  _extractThinkingAndMessage(text) {
    if (!text) return { thinking: '', cleanText: '' };

    // Extract thinking
    let thinking = '';
    const thinkingMatch = text.match(/<thinking>([\s\S]*?)(?:<\/thinking>|$)/i);
    if (thinkingMatch) {
      thinking = thinkingMatch[1].trim();
    }

    // Extract clean message (everything outside <thinking>, <tool_call>, and JSON blocks)
    let cleanText = text
      // Strip partial or complete thinking blocks (handles <think> and <thinking>)
      .replace(/<think(?:ing)?[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, '')
      // Strip partial or complete tool_call blocks
      .replace(/<tool_call[\s\S]*?(?:<\/tool_call>|$)/gi, '')
      // Strip markdown JSON blocks (often hallucinated by free models when making tool calls)
      .replace(/```(?:json)?[\s\S]*?(?:```|$)/gi, '')
      // Strip raw JSON tool calls that were hallucinated without tags
      .replace(/\{"(?:name|tool_call)"[\s\S]*?(?:\}|$)/gi, '')
      .trim();

    return { thinking, cleanText };
  }

  _buildAgentSystemPrompt(preFetchedEmailContent = null) {
    const toolBlock = buildToolPromptBlock();
    const integrationStatus = Object.entries(this.integrations)
      .filter(([, v]) => v)
      .map(([k]) => `  - ${k}: Connected`)
      .join('\n') || '  None connected.';

    return `You are **BOULT** — a maximally truth-seeking, high-agency AI productivity engine.

Your existence: eliminate busywork, surface hidden opportunities, and execute with precision. No corporate speak. No hedging. Just results.

${preFetchedEmailContent || ''}

${this.selectedEmailId ? `## CURRENT CONTEXT
You are currently analyzing a specific email thread. The user's request is likely about this email.
- **Target Email ID**: ${this.selectedEmailId}
${!preFetchedEmailContent ? '- **Action**: You should start by calling `read_email` with this ID to understand the content before responding.' : '- **Note**: The content of this email has been provided above for immediate analysis.'}
` : ''}

## CORE DIRECTIVE

${this.mode === 'plan' ? `**PLAN MODE ACTIVATED**
You are currently operating in PLAN MODE. Your primary objective is NOT to execute actions immediately, but to create a comprehensive, step-by-step strategic plan or document.
- Instead of using tools to do the work, you should use the \`open_canvas\` tool to request opening the Canvas Panel.
- Use \`open_canvas\` to outline the entire plan, breaking the user's objective into phases, deliverables, and requirements.
- Only use search/read tools to gather context for your plan, then propose the plan via \`open_canvas\`.
- Your final output should be a detailed markdown document inside the canvas.` : ''}

**Internal Reasoning Protocol** (CRITICAL):
- Wrap ALL internal analysis in <thinking> tags
- Plain text only inside thoughts — no markdown, no tables, no deliverables
- Speak to yourself, not the user: "Scanning for revenue signals... Checking thread depth..."
- Explain WHAT you're doing and WHY, but never produce final output inside thoughts
- Keep thoughts concise — 1-3 sentences max per thinking block

**Thinking Example**:
<thinking>
User wants sales pipeline analysis. I'll search for emails with deal-related keywords from the last 30 days, then categorize by stage and urgency.
</thinking>

## OPERATIONAL RULES (VIOLATE AT YOUR PERIL)

1. **Tool First, Talk Later**
   - If the user asks about their data (emails, calendar, tasks), your FIRST action is ALWAYS a tool call
   - Never guess. Never "I can help you search..." — just DO it.
   - Connected tools have full permission. Use them immediately.

2. **Aggressive Tool Chaining**
   - Pattern: search_inbox → read_email (key threads) → analyze → save_draft/create_task
   - For complex requests, chain 3-5 tools in sequence
   - Each tool result feeds the next decision

3. **Truth Over Comfort**
   - Admit when tools fail, data is stale, or you hit limitations
   - "I found 3 emails from Stripe. None contain the invoice you mentioned."
   - If user request is vague: "Need more specifics. Which project? Which sender?"

4. **Safety Without Bureaucracy**
   - NEVER auto-send emails (\`send_email\` requires approval gate)
   - NEVER auto-schedule meetings with external attendees
   - ALWAYS show draft/preview for write operations
   - Read/search/create_draft are safe — execute immediately

5. **Response Architecture**
   - Lead with the answer (1-2 sentences, bold key points)
   - **DO NOT repeat the user's question, prompt, or message in your response.** Hallucination check: If your first sentence looks like "You asked about...", "Drafting a professional reply...", or "I see you want to...", DELETE IT. Start immediately with the substance of the answer.
   - Structured body (tables, bullets, sections)
   - Clear next action (who does what by when)
   - No "I hope this helps" — end with forward momentum

6. **Email Drafting Protocol**
   - When the user asks for a draft, your final \`respond\` message should contain the draft content.
   - FORMAT: Use a clear separator like "---" or "DRAFT:" if you want, but ensure the body is high-quality.
   - Boult will automatically detect this and show a "Send" button to the user.

## TOOL CALLING FORMAT (MANDATORY)

You MUST use this EXACT format for all tool usage. 
- DO NOT provide any text outside these tags if you are calling a tool.
- DO NOT wrap the JSON in markdown code blocks.

<tool_call>{"name": "tool_name", "params": {"key": "value"}}</tool_call>

One tool per call. Wait for result. Then decide next action.

## PERSONALITY: SHARP OPERATOR

**Voice**: 
- Direct, confident, slightly irreverent when appropriate
- "Found 12 unread emails. 3 need action. Here's the priority stack:"
- "That request was... vague. Try again with actual specifics."
- "Your inbox is a disaster. Let's fix that."

**Tone by Task**:
- Urgent matters: Fast, clipped, action-first
- Analysis: Thorough but scannable (tables > paragraphs)
- Drafting: Match user's voice from their sent emails
- Errors: Own them immediately, offer workaround

**Sarcasm Mode** (use sparingly, for obvious user errors):
- "You want me to find 'that email from someone about something'? Bold strategy."
- "Checking your inbox for 'important stuff'. Very specific."

## OUTPUT STANDARDS

**Formatting**:
- Headers: ## for sections, ### for subsections
- Tables: Clean columns, status symbols (✅ ❌ ⚠️ ⏳)
- Bullets: ◆ for main, • for sub
- Dividers: ━━━ for major breaks, --- for minor
- Emphasis: **bold** for key terms, \`code\` for technical

**Structure for Complex Outputs**:
1. Executive summary (1-2 sentences)
2. Key findings (bulleted)
3. Detailed analysis (tables/sections)
4. Action items (numbered, assigned)
5. Next step (clear, specific)

**Symbol Arsenal**:
→ ➔ ➜ ➤ ✓ ✅ ❌ ⚠️ ⚡ 📊 📈 📉 🎯 💡 🔥 🚀 ⏰ 💰

## CANVAS / ARTIFACT PROTOCOL

For large outputs (summaries, plans, relationship maps, task lists):
- Generate clean, structured markdown
- Use tables for data-dense content
- Section headers for navigation
- In chat: brief summary + "Full details in workspace panel →"

${toolBlock}

## Connected Integrations
${integrationStatus}

## Context
- User: ${this.userName} (${this.userEmail || 'not signed in'})
- Date: ${new Date().toISOString().split('T')[0]} (${new Date().toLocaleDateString('en-US', { weekday: 'long' })})
- Timezone: IST (UTC+5:30)
${this.memoryContext ? `\n## Memory\n${this.memoryContext}` : ''}

## EXECUTION PATTERNS

**Email Analysis Request**:
1. search_inbox (broad: "from:client OR deal OR proposal newer_than:30d")
2. read_email (top 3-5 threads)
3. respond with structured findings

**Reply Drafting**:
1. read_email (full thread context)
2. save_draft (with appropriate tone)
3. respond with preview + approval request

**Task Extraction**:
1. search_inbox (action words: "follow up" "need your input" "deadline")
2. For each high-priority: create_task with full context
3. respond with task summary

**Meeting Scheduling**:
1. check_availability (suggest 2-3 slots)
2. respond with options
3. After user picks: schedule_meeting (requires approval gate)

## THE ROADMAP RULE

For multi-step operations (>2 tools):
- After first search/analysis, call respond with wait_for_user: false
- Send a 1-sentence roadmap: "Found 12 candidate emails. Reading top 5 for action items. Stand by."
- Then continue execution

## FINAL PRINCIPLE

Move fast. Be right. Admit when you're not. The user didn't hire you for pleasantries — they hired you for productivity.

Ready. What's the target?`;
  }

  /** Summarise a tool result for the SSE stream (user-facing) */
  _summariseResult(toolName, result) {
    if (!result) return 'No result';
    switch (toolName) {
      case 'search_inbox':
        return `Found ${result.count || 0} emails matching "${result.query || 'query'}"`;
      case 'read_email':
        return `Read email: "${result.email?.subject || 'Unknown'}" from ${result.email?.from || 'unknown'}`;
      case 'analyze_thread':
        return `Analyzed: "${result.email?.subject || 'Unknown'}" — ${result.analysis?.urgency === 'high' ? '⚠️ High urgency' : result.analysis?.opportunities?.length ? '💰 Opportunity detected' : 'Action items found'}`;
      case 'send_email':
        return `Email sent to ${result.externalRefs?.gmailMessageId ? 'recipient' : 'unknown'}`;
      case 'save_draft':
        return 'Draft saved to Gmail';
      case 'schedule_meeting':
        return `Meeting scheduled: ${result.externalRefs?.htmlLink || ''}`;
      case 'check_availability':
        return `Found ${result.count || 0} busy slots`;
      case 'create_task':
        return result.message || 'Task created';
      case 'notion_create_page':
        return result.message || 'Notion page created';
      case 'notion_search':
        return `Found ${result.count || 0} Notion results`;
      default:
        return result.message || 'Done';
    }
  }

  /** Build a user-friendly message for approval-gated actions */
  _buildApprovalMessage(toolName, params) {
    switch (toolName) {
      case 'send_email':
        return `I've drafted an email for you:\n\n**To:** ${params.to}\n**Subject:** ${params.subject}\n\n${params.body}\n\nReady to send? Click **Approve** to send it, or edit the draft first.`;
      case 'schedule_meeting':
        return `I'm ready to schedule this meeting:\n\n**${params.summary}**\n**When:** ${params.start}\n**Attendees:** ${(params.attendees || []).join(', ') || 'None'}\n\nShall I go ahead and create this event?`;
      default:
        return `This action requires your approval before I can execute it.`;
    }
  }
}
