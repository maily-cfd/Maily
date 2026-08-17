/**
 * Boult AI Service
 * Dedicated AI service for Boult agent-talk using Liquid Thinking model
 * with memory, context awareness, and integration support
 */

import { subscriptionService } from './subscription-service.js';

// Fast free models: NVIDIA Nemotron for low latency
import { DEFAULT_AI_MODELS, getModelChain } from './ai-constants.js';
// 'meta-llama/llama-3.3-70b-instruct:free' REMOVED 2026-07-22 — OpenRouter
// retired it from the free tier entirely (404 "unavailable for free" on every
// key, live-probe confirmed). This was the ONLY model in the list, so this
// service was 100% dead. Replaced with the live-verified nemotron pair.
const BOULT_MODELS = ['nvidia/nemotron-3-super-120b-a12b:free', 'nvidia/nemotron-3-nano-30b-a3b:free'];
const BOULT_MODEL = BOULT_MODELS[0];
// Vision model
const BOULT_VISION_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Tiered models: All use fast Liquid/NVIDIA/Qwen models
const TASK_MODEL_MAP = {
    intent: BOULT_MODELS[0],
    planning: BOULT_MODELS[0],
    synthesis: BOULT_MODELS[0],
    canvas: BOULT_MODELS[0]
};

import { extractTextFromPdf } from './pdf-service.js';

export class BoultAIService {
    constructor(options = {}) {
        // Key Pool for rotation to prevent 429 errors
        this.apiKeys = [
            process.env.OPENROUTER_API_KEY4,
            process.env.OPENROUTER_API_KEY3,
            process.env.OPENROUTER_API_KEY,
            process.env.OPENROUTER_API_KEY2
        ].filter(Boolean).map(k => k.trim());

        this.currentKeyIndex = 0;
        this.modelOverride = options.modelId || null;
        this.model = this.modelOverride || BOULT_MODEL;
        this.baseURL = OPENROUTER_BASE_URL;

        // Supermemory Configuration
        this.supermemoryApiKey = process.env.SUPERMEMORY_API_KEY;

        if (this.apiKeys.length === 0) {
            console.error('❌ No OPENROUTER_API_KEYs configured for Boult');
        } else {
            console.log(`✅ Boult AI Service initialized with ${this.apiKeys.length} keys and ${this.supermemoryApiKey ? 'Supermemory' : 'No Memory'} integration`);
        }
    }

    getNextKey() {
        if (this.apiKeys.length === 0) return '';
        const key = this.apiKeys[this.currentKeyIndex];
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        return key;
    }

    /**
     * Call OpenRouter API with key rotation and fallback models
     */
    async callOpenRouter(messages, options = {}) {
        const primaryModel = options.model || this.modelOverride || (options.taskType ? TASK_MODEL_MAP[options.taskType] : null) || this.model || BOULT_MODEL;
        const models = getModelChain(options.modelPreference || primaryModel);

        let lastError = null;

        // Try rotation across keys
        for (let keyAttempt = 0; keyAttempt < this.apiKeys.length; keyAttempt++) {
            const apiKey = this.getNextKey();

            for (const modelId of models) {
                if (!modelId) continue;
                console.log(`🚀 Boult attempting via ${modelId}`);

                const timeoutMs = options.isDeepThinking ? 90000 : 60000;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                try {
                    const response = await fetch(`${this.baseURL}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                            'HTTP-Referer': process.env.HOST || 'https://maily.dev',
                            'X-Title': 'Maily Boult',
                            ...(options.privacyMode ? { 'X-OpenRouter-Data-Collection': 'opt-out' } : {})
                        },
                        body: JSON.stringify({
                            model: modelId,
                            messages,
                            temperature: options.temperature || 0.4,
                            max_tokens: options.maxTokens || 2000
                        }),
                        signal: controller.signal
                    });

                    clearTimeout(timeoutId);

                    if (response.ok) {
                        const data = await response.json();
                        if (data?.choices?.[0]?.message?.content) {
                            console.log(`✅ Boult AI Success with ${modelId} using key ${apiKey.substring(0, 10)}...`);
                            return data;
                        }
                        console.warn(`⚠️ Boult AI returned success but no content for ${modelId}`);
                        lastError = new Error('AI returned empty response');
                        continue;
                    }

                    const errorText = await response.text();
                    lastError = new Error(`Boult API failed: ${response.status}`);
                    console.warn(`⚠️ Boult model ${modelId} failed (${response.status}) with key ${apiKey.substring(0, 10)}...: ${errorText.substring(0, 80)}`);

                    if (response.status === 429) {
                        const retryDelay = 1000 + Math.random() * 1000;
                        console.log(`⏳ Boult rate limited (429) on ${modelId}. Backing off for ${retryDelay.toFixed(0)}ms before fallback model...`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        continue;
                    }

                    if (response.status === 401 || response.status === 402 || response.status === 403) {
                        console.log(`⚠️ Boult key issue (${response.status}). Switching to next key...`);
                        break;
                    }

                } catch (error) {
                    lastError = error;
                    console.error(`❌ Boult error with ${modelId} (${apiKey.substring(0, 8)}...): ${error.message}`);
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }
        }

        throw lastError || new Error('Boult AI mission failed across all keys and models');
    }

    /**
     * Stream response from OpenRouter using SSE (Direct mapping, no loops)
     */
    async *streamResponse(messages, options = {}) {
        const primaryModel = options.model || (options.taskType ? TASK_MODEL_MAP[options.taskType] : null) || this.model || BOULT_MODEL;
        const models = getModelChain(options.modelPreference || primaryModel);

        let lastError = null;

        for (let keyAttempt = 0; keyAttempt < this.apiKeys.length; keyAttempt++) {
            const apiKey = this.getNextKey();

            for (const modelId of models) {
                if (!modelId) continue;
                console.log(`📡 Boult attempting streaming mission with: ${modelId} using key ${apiKey.substring(0, 10)}...`);
                try {
                    const response = await fetch(`${this.baseURL}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                            'HTTP-Referer': process.env.HOST || 'https://maily.dev',
                            'X-Title': 'Maily Boult',
                            ...(options.privacyMode ? { 'X-OpenRouter-Data-Collection': 'opt-out' } : {})
                        },
                        body: JSON.stringify({
                            model: modelId,
                            messages,
                            temperature: options.temperature || 0.4,
                            max_tokens: options.maxTokens || 2000,
                            stream: true
                        })
                    });
                    if (!response.ok) {
                        if (response.status === 429) {
                            const errorText = await response.text();
                            console.error(`⚠️ Boult streaming model ${modelId} rate limited (429): ${errorText.substring(0, 50)}...`);
                            const retryDelay = 1000 + Math.random() * 1000;
                            console.log(`⏳ Boult stream rate limited (429) on ${modelId}. Backing off for ${retryDelay.toFixed(0)}ms before fallback model...`);
                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                            continue; // Try next model
                        }

                        const errorText = await response.text();
                        console.error(`⚠️ Boult streaming model ${modelId} failed (${response.status}): ${errorText.substring(0, 50)}...`);
                        lastError = new Error(`Stream failed: ${response.status}`);

                        if (response.status === 401 || response.status === 402 || response.status === 403) {
                            break; // Key issue, break inner loop to try next key
                        }
                        continue;
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') return;
                                try {
                                    const parsed = JSON.parse(data);
                                    const content = parsed.choices?.[0]?.delta?.content;
                                    if (content) {
                                        yield content;
                                    }
                                } catch (e) {
                                    // skip malformed chunks
                                }
                            }
                        }
                    }

                    // If we successfully finished streaming, return
                    return;

                } catch (error) {
                    console.error(`💥 Boult stream error (${modelId}): ${error.message}`);
                    lastError = error;
                    continue;
                }
            }
        }

        throw lastError || new Error('All Boult AI streaming models failed across all keys');
    }

    /**
     * Analyze intent and generate structured plan
     */
    async analyzeIntentAndPlan(userMessage, context = {}) {
        const systemPrompt = `You are BOULT — the world's most capable AI Email & Productivity Operating System.
You are proactive, extremely competent, and ruthlessly efficient. You are the executive-level intelligence layer between the user and their work life.

Analyze the request and return a JSON schema-driven plan.

WORK_DOMAINS:
- email: draft_email, reply_email, summarize, search, boult_outreach, boult_inbox_review, boult_auto_pilot
- meeting: schedule, check_availability
- analytics: data_generation, report_insights
- notes: create_thought, find_memory
- plan: complex_workflow, objective_mapping
- general: greeting, clarification
- plan: detailed_strategy, artifact_generation

VISUAL AESTHETIC (Executive Intelligence):
- Status: Use ✅, ⚠, or ⚡ for updates and critical alerts.
- Lists: Use •, ◆, or ❖ for high-fidelity bullet points.
- Tech: Use [brackets] or symbols like ≡ and ∑ for structured logic.

MODE_SETTING: ${context.isPlanMode ? 'PLAN MODE ENABLED (Focus on creating a detailed artifact, needsCanvas=false, canvasType=action_plan)' : 'AGENT MODE (Focus on direct action or chat)'}

CRITICAL RULES:
1. NO SEARCH BY DEFAULT: Do NOT include a 'search' step if the request is a greeting, a general question that can be answered with common knowledge, or a direct instruction that doesn't need inbox data.
2. VERIFIABLE STEPS: Every step must have a specific 'action' and 'detail'. Explain WHAT you are searching for and WHY.
3. SEARCH QUERIES: If searching, provide the exact query you will use in 'searchQuery'.

Return STRICT JSON:
{
  "initialResponse": "immediate human acknowledgment using their specific goal/numbers (I hear you loud and clear... summarize objective... state plan)",
  "intent": "one of: draft_email, reply_email, summarize, search, schedule, organize, analyze, general_chat, boult_outreach, boult_inbox_review, boult_auto_pilot",
  "complexity": "simple or complex",
  "needsCanvas": boolean (CRITICAL: Set to TRUE ONLY if the task strictly requires a visual dashboard or interactive workspace. If it can be answered in chat, set to FALSE.),
  "searchQuery": "refined search query (e.g. 'recent invoices' or 'John follow up')",
  "canvasType": "one of: email_draft, summary, research, action_plan, meeting_schedule, analytics, none",
  "thinkingBlocks": [
    { 
       "id": "block-1",
       "title": "A descriptive title",
       "initialContext": "Brief intro of the plan",
       "steps": [
         { 
           "action": "What you are doing (e.g. 'Searching Gmail for Stripe invoices')", 
           "detail": "Why and How (e.g. 'Scanning for invoices from the last 30 days to confirm payment status')",
           "type": "one of: search, read, think, draft, execute, code" 
         }
       ]
    }
  ],
  "confidence": number between 0 and 1
}
`;
        try {
            let userContent = userMessage;
            const attachments = context.attachments || [];

            // OPTIMIZATION: For intent analysis, we only need to know IF there are attachments, 
            // not the full base64 content. This saves massive token overhead and image processing time.
            if (attachments.length > 0) {
                const types = [...new Set(attachments.map(a => a.type))];
                userContent = `${userMessage}\n\n[Context: User has attached ${attachments.length} files of types: ${types.join(', ')}]`;
            }

            const response = await this.callOpenRouter([
                { role: 'system', content: systemPrompt + '\n\nCRITICAL: You MUST respond with ONLY raw, valid JSON. Do not include markdown formatting (like ```json), and do not include any explanatory text before or after the JSON.' },
                { role: 'user', content: userContent }
            ], { maxTokens: 800, temperature: 0.1 });

            let content = this.extractResponse(response);
            content = content.trim();
            if (content.startsWith('```json')) content = content.replace(/^```json/, '');
            if (content.startsWith('```')) content = content.replace(/^```/, '');
            if (content.endsWith('```')) content = content.replace(/```$/, '');

            return JSON.parse(content.trim());
        } catch (e) {
            console.error('Intent analysis failed:', e.message);
            return {
                intent: 'general_chat',
                complexity: 'simple',
                needsCanvas: false,
                canvasType: 'none',
                plan: [{ step: 1, action: 'respond', description: 'Generate response', type: 'think' }],
                gmailActions: [],
                confidence: 0.5,
                reasoning: 'Fallback to general chat'
            };
        }
    }

    /**
     * Generate canvas content (structured output for the workspace panel)
     */
    async generateCanvasContent(userMessage, canvasType, emailContext = '', options = {}) {
        const canvasPrompts = {
            email_draft: `Draft a refined email. JSON: { "subject": "string", "to": "email", "body": "string" }`,
            summary: `Summarize each email individually as a slide deck. Return JSON: { "title": "string", "items": [{ "subject": "string", "sender": "string", "summary": "A 2-3 sentence summary of this specific email", "priority": "high|medium|low" }] }. Each item is one email. Be specific and concise. Do NOT combine emails.`,
            research: `Compile findings. JSON: { "title": "string", "findings": [{ "topic": "string", "detail": "string" }] }`,
            action_plan: `Build strategic workflow. JSON: { "title": "string", "steps": [{ "order": number, "task": "string", "status": "pending" }] }`,
            meeting_schedule: `Coordinate meeting. JSON: { "title": "string", "provider": "google|cal", "attendees": ["email"], "date": "ISO", "time": "HH:MM", "duration": 30, "agenda": "string" }`,
            analytics: `Generate email analytics with real chart data. Return JSON: { "title": "string", "stats": [{ "label": "string", "value": "string", "change": "string", "changeDirection": "up|down|neutral" }], "areaChart": { "label": "string", "data": [{ "name": "string", "value": number }] }, "pieChart": { "label": "string", "data": [{ "name": "string", "value": number }] } }. Use realistic numbers based on the email context provided. Stats should have 2-4 items. Area chart 5-7 data points. Pie chart 3-4 segments.`,
            notes: `Commit to memory. JSON: { "title": "string", "content": "string", "tags": ["string"] }`
        };

        const systemPrompt = canvasPrompts[canvasType] || canvasPrompts.summary;

        try {
            let userContent = userMessage;
            const attachments = options.attachments || [];

            if (attachments.length > 0) {
                userContent = [
                    { type: 'text', text: userMessage },
                    ...attachments.map(att => {
                        if (att.type.startsWith('image/')) {
                            return {
                                type: 'image_url',
                                image_url: { url: att.base64 }
                            };
                        }
                        return {
                            type: 'text',
                            text: this._decodeBase64ToText(att)
                        };
                    })
                ];
            }

            const messages = [
                { role: 'system', content: systemPrompt + '\n\nCRITICAL: You MUST respond with ONLY raw, valid JSON. Do not include markdown formatting (like ```json), and do not include any explanatory text before or after the JSON. User: ' + (options.userName || 'User') },
                ...(emailContext ? [{ role: 'system', content: `Email Context:\n${emailContext}` }] : []),
                { role: 'user', content: userContent }
            ];

            const response = await this.callOpenRouter(messages, {
                maxTokens: 1500,
                temperature: 0.3,
                privacyMode: options.privacyMode
            });

            let content = this.extractResponse(response);
            content = content.trim();

            // Clean markdown indicators
            let cleanJson = content;
            if (cleanJson.includes('```json')) cleanJson = cleanJson.split('```json')[1].split('```')[0];
            else if (cleanJson.includes('```')) cleanJson = cleanJson.split('```')[1].split('```')[0];

            try {
                const parsedContent = JSON.parse(cleanJson.trim());
                return {
                    type: canvasType,
                    content: parsedContent,
                    raw: content
                };
            } catch (err) {
                console.warn('⚠️ Boult returned non-JSON content for Canvas. Falling back to text mode.');
                // Fallback: If it's not JSON, treat it as a summary/raw text
                return {
                    type: 'summary',
                    content: {
                        title: 'Analysis Result',
                        items: [
                            {
                                subject: 'Extracted Insights',
                                sender: 'Boult System',
                                summary: content.substring(0, 800) + (content.length > 800 ? '...' : ''),
                                priority: 'medium'
                            }
                        ]
                    },
                    raw: content
                };
            }
        } catch (e) {
            console.error('💥 Canvas generation failed:', e.message);
            return {
                type: canvasType,
                content: null,
                raw: '',
                error: e.message
            };
        }
    }

    /**
     * Extract response content from API response
     */
    extractResponse(data) {
        let content = data?.choices?.[0]?.message?.content || '';
        // Open-weight models sometimes hallucinate literal tool calls instead of using native tool bindings
        content = content.replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/gi, '');
        content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
        return content.trim();
    }

    /**
     * Build Boult system prompt with context awareness and agentic mission focus
     */
    buildSystemPrompt(options = {}) {
        const {
            userEmail = null,
            userName = 'User',
            conversationHistory = [],
            emailContext = null,
            integrations = {},
            privacyMode = false,
            subscriptionInfo = null,
            isDeepThinking = false,
            isCanvas = false,
            memoryContext = null
        } = options;

        // Build subscription context
        let subscriptionContext = '';
        if (subscriptionInfo) {
            if (subscriptionInfo.isUnlimited) {
                subscriptionContext = `User is on PRO plan. They have UNLIMITED Boult AI agentic capabilities.`;
            } else {
                const features = subscriptionInfo.features || {};
                subscriptionContext = `User is on STARTER plan. Boult AI remaining: ${features.boult_ai?.usage || 0}/${features.boult_ai?.limit || 10} used today (resets daily).`;
            }
        }

        let integrationsContext = '';
        if (integrations.gmail) integrationsContext += '- Gmail (Connected: Full Search, Read, Send, Auto-Reply, and Intro capabilities enabled)\n';
        if (integrations.google_calendar) integrationsContext += '- Google Calendar (Connected: Create, Edit, Search, and Organize events enabled)\n';
        if (integrations.google_meet) integrationsContext += '- Google Meet (Connected: Auto-generate meeting rooms and manage video conferences enabled)\n';
        if (integrations.google_tasks) integrationsContext += '- Google Tasks (Connected: Create, List, and Complete tasks enabled)\n';
        if (integrations.notion) integrationsContext += '- Notion (Connected: Create pages, Search workspace, and Append to databases enabled)\n';
        if (integrations.notion_calendar) integrationsContext += '- Notion Calendar (Connected: Bridge project timelines with personal schedule enabled)\n';
        if (integrations.slack) integrationsContext += '- Slack (Connected: Read and Write conversations for team coordination enabled)\n';
        if (integrations.cal_com || integrations['cal.com']) {
            const link = integrations.cal_com_link || integrations['cal.com_link'] || 'Generic Link';
            integrationsContext += `- Cal.com (Connected: Real-time booking enabled via ${link})\n`;
        }
        integrationsContext += '- Inbox Review (Enabled: Can perform bulk reviews and summaries)\n';
        integrationsContext += '- Boult Engine (Connected: Real-time execution of all tasks)\n';

        let memorySection = '';
        if (memoryContext) {
            memorySection = `\n## USER LONG-TERM MEMORY (Powered by Supermemory)\n${memoryContext}\n`;
        }

        let prompt = `You are **BOULT** — an advanced, autonomous AI Email & Productivity Operating System designed to be the user's most trusted and capable work partner.

Built by the Maily open source community for people who value time, clarity, and outcomes. You are a maximally truth-seeking executive assistant engineered for high-agency productivity. Your purpose is to radically reduce email overload, uncover hidden opportunities, automate repetitive tasks, provide deep insights, and execute workflows with precision while always keeping the user firmly in control.

## MAILY PLATFORM KNOWLEDGE
- Maily is an AI-powered email intelligence platform that connects to Gmail, Google Calendar, Notion, and Slack to automate workflows.
- Core Features:
  1. Sift AI: Triage and inbox sweep, categorizes and filters out newsletters/promotions, extracts key highlights and priority items.
  2. Boult AI: Autonomous executive agent (you) capable of analyzing threads, executing workflows, managing calendars, and managing Notion/Slack integrations.
  3. Tone Writing / Voice Profile: Creates a Neural Voice Profile by analyzing the last 90 days of sent emails to draft responses that match the user's exact writing style, greeting, and signature.
  4. Unified Workflow (Canvas): A beautiful interactive workspace panel for reviewing meeting preps, schedules, drafts, and comprehensive summaries.
  5. Scheduled Background Agents: Allows users to create persistent background agents that run on customizable cron schedules (e.g., sweep inbox every morning and draft replies to client emails).
  6. Cross-Platform Sync: Smooth coordination across Gmail, Google Calendar, Notion, Notion Calendar, Slack, and Cal.com.
  7. Zero-Knowledge Encryption: Client-side AES-256-GCM encryption ensures email content is encrypted in the browser and remains completely private.
- Pricing Tiers (no free forever plan; monthly includes a 3-day free trial via Polar — card required, cancel before day 3):
  1. Monthly Plan: $29/month after a 3-day free trial. Includes unlimited AI Drafts, Sift Analysis, Boult queries, background agents, scheduling, and a Gold Founder Badge.
  2. Annual Plan: $16.58/month (billed $199 annually). Saves 40% (2 months free). Includes everything in Monthly, priority AI processing, and a Gold Founder Badge.
  3. Lifetime Founder Plan: $499 one-time payment. Pay once, own forever. Includes everything in Annual plus a VIP Diamond Slack channel, dedicated support, and the Diamond Founder Badge.
- Founder & Team:
  - Maily is a free, open source project. Follow at @Mailycfd on X or github.com/maily-cfd/Maily. Currently tailored for individual founders and power users, with team support on the roadmap.
- Salesperson Role & Objection Handling (CRITICAL):
  - When users ask about pricing, evaluate upgrading, or express objections (e.g. "too expensive", "I'll stay on free", "cuz it's too expensive"), DO NOT just give up or immediately agree to stay on the free plan.
  - ACT LIKE A TALENTED, PERSUASIVE, AND EMPOWERING SALESPERSON.
  - Highlight the massive ROI: a single deal closed or just a few hours saved per week easily pays for the $29/month plan. Emphasize that Maily has NO free tier—only a highly restricted Starter plan with strict daily limits (e.g., 10 Boult AI queries per day), whereas Pro is completely unlimited and allows you to run autonomous background agents working for you 24/7.
  - Handle objections with warmth, intelligence, and confidence. Keep your response crisp, focused on value, and close with a persuasive invitation to upgrade.

## CORE OPERATING SYSTEM

**Identity & Personality**:
- Sharp, direct, confident, and high-signal. Eliminate fluff and unnecessary words.
- You are proactive, outcome-obsessed, and think several steps ahead.
- Communicate like a world-class executive assistant who deeply understands the user's goals and style.
- You are honest, transparent, and slightly sharp when it improves clarity or highlights problems.
- Respect the user's time above all else. You don't do small talk. You solve problems.

## THINKING & AGENTIC PROCESS (Always Follow)
1. **Clarify** — Fully understand the user's intent. Ask targeted questions if anything is ambiguous.
2. **Reason Step-by-Step** — Internally analyze the request, context, risks, and best approach (wrapped in <thinking> tags internally).
3. **Plan** — For complex or multi-step tasks, create a clear, numbered plan and show it briefly when useful. Chain tools intelligently: search → read → analyze → draft → confirm.
4. **Tool Usage** — Aggressively use available tools to fetch real data. NEVER hallucinate facts about the inbox or calendar.
5. **Execute Safely** — Preview all actions (especially drafts, events, or changes). Confirm before irreversible steps.
6. **Deliver Value** — Provide structured, actionable, high-quality output.
7. **Reflect & Iterate** — If results are suboptimal, acknowledge it and improve in the next step.

## CAPABILITY MATRIX

**Email & Communication Mastery**
- Master-level Gmail understanding: thread analysis, action item extraction, urgency detection.
- Revenue/opportunity spotting, relationship mapping, and stalled follow-up identification.
- Generate replies, cold emails, or updates that perfectly match the user's tone, brevity, and voice.

**Productivity & Orchestration**
- Convert emails into tasks, calendar events, Notion pages, or project updates.
- Cross-platform sync (Gmail, Calendar, Tasks, Notion, Slack, Cal.com).
- Real-time execution of workflows with high agency.

**Insight Generation**
- Deliver prioritized summaries, tables, opportunity pipelines, and risk alerts.
- Inbox audits: what's working, what's broken, what's hidden.

## SAFETY & ETHICS (Non-Negotiable)
- NEVER auto-send emails, delete messages, or modify data without explicit user approval and a clear preview.
- Always err on the side of caution and transparency.
- Protect user privacy and data. Be honest about tool execution status (success/failure).

## OUTPUT STANDARDS (NON-NEGOTIABLE)

**Every substantial response must include**:
1. **Executive Summary** (1-2 sentences, bold key points)
2. **Structured Body** (use sections with clear headings, tables, bullets)
3. **Clear Next Action** or Direct Question to maintain momentum.

**Formatting Standards**:
- Headers: \`##\` for sections, \`###\` for subsections
- Tables: clean columns, status symbols (✅ ❌ ⚠️), right-aligned numbers
- Bullets: ◆ for main points, • for sub-points
- Dividers: \`━━━\` to separate logical blocks
- Symbols: → ➔ ➜ ➤ ✓ ✅ ❌ ⚠️ ⚡ 📊 📈 🎯 💡 🔥 🚀
- **Canvas / Artifact Protocol**: For large outputs (summaries, plans, charts, lists), generate clean, well-structured content optimized for beautiful rendering in the workspace panel.

## MEMORY & PERSONALIZATION
- Maintain rich, long-term memory of the user's writing style, key projects, important contacts, recurring workflows, and past decisions.
- Continuously adapt and improve based on interaction history.

${memorySection}

## CURRENT CONTEXT
- User: ${userName} (${userEmail || 'not signed in'})
- Date: ${new Date().toISOString().split('T')[0]} (${new Date().toLocaleDateString('en-US', { weekday: 'long' })})
- Timezone: IST (UTC+5:30)

**Integrations**:
${integrationsContext || 'None connected. Most functionality disabled.'}

**Subscription**: ${subscriptionContext}

${emailContext
                ? `## EMAIL CONTEXT\n${emailContext}`
                : integrations.gmail
                    ? `## GMAIL STATUS\nConnected and active. Ready to search, read, analyze, and draft.`
                    : `## GMAIL STATUS\nNot connected. Email features unavailable. Connect via Settings → Integrations.`
            }

${conversationHistory.length > 0 ? `## CONVERSATION HISTORY\n${conversationHistory.slice(-5).map(m => `**${m.role}**: ${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}`).join('\n')}` : ''}

## STATUS FLAGS
- Deep Analysis: ${isDeepThinking ? 'ACTIVE 🧠' : 'STANDARD'}
- Canvas Mode: ${isCanvas ? 'READY 📋' : 'INACTIVE'}
- Privacy Mode: ${privacyMode ? 'ON 🔒' : 'OFF'}

## OPENING PROTOCOL
When user sends first message:
1. Acknowledge briefly (no fluff).
2. If Gmail connected, offer immediate value.
3. Get to work immediately.

You are BOULT. Be sharp, reliable, proactive, and exceptionally useful. What needs to be handled?`;

        return prompt;
    }

    /**
     * Generate conversational response with full context
     */
    async generateResponse(userMessage, options = {}) {
        const {
            conversationHistory = [],
            emailContext = null,
            integrations = {},
            userEmail = null,
            userName = 'User',
            privacyMode = false,
            subscriptionInfo = null,
            attachments = [],
            isDeepThinking = false,
            isCanvas = false
        } = options;

        try {
            const systemPrompt = this.buildSystemPrompt({
                userEmail,
                userName,
                conversationHistory,
                emailContext,
                integrations,
                privacyMode,
                subscriptionInfo,
                isDeepThinking,
                isCanvas: options.isCanvas || false,
                memoryContext: options.memoryContext
            });

            let userContent = userMessage;

            if (attachments && attachments.length > 0) {
                userContent = [
                    { type: 'text', text: userMessage },
                    ...attachments.map(att => {
                        // Vision support for images
                        if (att.type?.startsWith('image/')) {
                            return {
                                type: 'image_url',
                                image_url: { url: att.base64 }
                            };
                        }

                        // Handle PDFs and other documents via description and text extraction
                        const isPDF = att.type?.includes('pdf');
                        let attachmentDesc = `[Attached File: ${att.name} (${att.type})]`;

                        if (isPDF) {
                            const pdfText = extractTextFromPdf(att.base64);
                            if (pdfText && pdfText.length > 50) {
                                return { type: 'text', text: `${attachmentDesc}\nExtracted PDF Content:\n${pdfText}` };
                            }
                            attachmentDesc += `\n(Note: This is a PDF document. If it was an image-based PDF, I may need OCR or the user to describe it if my vision cannot see it directly. Otherwise, I will analyze the metadata and provide the best help I can.)`;
                        }

                        const extractedText = this._decodeBase64ToText(att);
                        if (extractedText && !extractedText.includes('[Binary Data]')) {
                            return { type: 'text', text: `${attachmentDesc}\nExtracted Content:\n${extractedText}` };
                        }

                        // Final attempt: Pass PDF as a "file_url" or similar if the model supports it 
                        // by spoofing it in image_url (some OpenRouter models handle this)
                        if (isPDF) {
                            return {
                                type: 'image_url',
                                image_url: { url: att.base64 }
                            };
                        }

                        return { type: 'text', text: attachmentDesc + "\n(Content type is binary/unsupported for direct text extraction. I am aware this file exists and can refer to it by name.)" };
                    })
                ];
            }

            const messages = [
                { role: 'system', content: systemPrompt },
                ...conversationHistory.slice(-10), // Include last 10 messages for context
                { role: 'user', content: userContent }
            ];

            const response = await this.callOpenRouter(messages, {
                maxTokens: isDeepThinking ? 6000 : 3000,
                temperature: isDeepThinking ? 0.5 : 0.4,
                privacyMode,
                isDeepThinking,
                hasImages: attachments.some(a => a.type?.startsWith('image/'))
            });

            let content = this.extractResponse(response);

            // Strip out tool calling tags or thinking blocks that sometimes leak from OpenRouter models
            if (content && typeof content === 'string') {
                content = content.replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '');
                content = content.replace(/<\/?[a-z_]+_call>/gi, '');
                content = content.replace(/<\/?[a-z_]+_value>/gi, '');
                content = content.replace(/<\/?[a-z_]+_args>/gi, '');
                content = content.replace(/<\/?[a-z_]+_thought>/gi, '');
                
                // Post-process to remove any em dashes
                content = content.replace(/\u2014/g, ', ').replace(/\u2013/g, '-').trim();
            }

            return content;
        } catch (error) {
            console.error('❌ Boult generateResponse error:', error);
            throw error;
        }
    }

    /**
     * Generate a draft reply for an email
     */
    async generateDraftReply(emailContent, options = {}) {
        const {
            userName = 'User',
            userEmail = null,
            replyInstructions = '',
            conversationHistory = [],
            privacyMode = false
        } = options;

        try {
            // Extract sender information
            let fromName = 'there';
            let fromEmail = '';
            const fromMatch = emailContent.match(/From:\s*([^<\n]+)(?:<([^>]+)>)?/);
            if (fromMatch) {
                fromName = fromMatch[1].trim().replace(/[\"']/g, '').split(' ')[0];
                fromEmail = fromMatch[2] || '';
            }

            const systemPrompt = `You are BOULT — the world's most capable AI Email & Productivity Operating System.
You are drafting a high-signal email reply for ${userName}.

CRITICAL RULES:
1. NEVER use em dashes (—) anywhere in your response
2. Write in a crisp, professional, yet warm executive tone
3. Reference specific details from the original email to demonstrate perfect context retention
4. Focus on outcomes: revenue, risk reduction, or clear next actions
5. Keep it concise but complete

You are replying to: ${fromName}${fromEmail ? ` <${fromEmail}>` : ''}
Reply instructions from user: ${replyInstructions || 'None provided'}

Write a complete, ready-to-send email reply. Start with an appropriate greeting and end with a sign-off using "${userName}" as the name.`;

            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Draft a reply to this email:\n\n${emailContent.substring(0, 4000)}` }
            ];

            const response = await this.callOpenRouter(messages, {
                maxTokens: 600,
                temperature: 0.5,
                privacyMode
            });

            let draft = this.extractResponse(response);
            draft = this.removeEmDashes(draft);

            return {
                draftContent: draft,
                recipientName: fromName,
                recipientEmail: fromEmail,
                senderName: userName
            };
        } catch (error) {
            console.error('❌ Boult generateDraftReply error:', error);
            throw error;
        }
    }

    /**
     * Remove all em dashes from text
     */
    removeEmDashes(text) {
        if (!text) return text;
        // Replace em dash with a comma and space, or just space depending on context
        return text
            .replace(/\s*—\s*/g, ', ')  // Em dash with optional spaces -> comma
            .replace(/–/g, '-')          // En dash -> hyphen
            .replace(/\s+,/g, ',')       // Clean up double spaces before comma
            .replace(/,\s*,/g, ',');     // Clean up double commas
    }

    /**
     * Generate internal thoughts for the Thinking indicator
     */
    async generateThoughts(missionGoal, context = {}) {
        const systemPrompt = `You are BOULT. Generate a brief, internal tactical thought about your current execution state.
        
CRITICAL RULES FOR THOUGHTS:
1. **INTERNAL MONOLOGUE**: Speak to yourself, not the user. (e.g., "I'm analyzing..." not "I'm analyzing for you...")
2. **NO OUTPUT LEAKAGE**: Never include the actual deliverables (tables, drafts, code, reports) in this thought block. Thoughts are about the PROCESS, not the RESULT.
3. **PUNCHY & TACTICAL**: Keep it under 15 words. Focus on immediate internal actions.
4. **NO FORMATTING**: Do not use markdown, tables, or lists. Just plain text reasoning.

Example: "Accessing Gmail API to retrieve recent partnership threads."`;

        // Create a safe, minimal context to avoid huge payloads
        const safeContext = {
            goal: missionGoal,
            currentStep: context.currentStep?.label,
            actionType: context.currentStep?.actionType,
            hasEmailContext: !!context.emailContext,
            historyLength: context.conversationHistory?.length || 0
        };

        try {
            const response = await this.callOpenRouter([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Current state: ${JSON.stringify(safeContext)}` }
            ], { maxTokens: 100, temperature: 0.1 });

            return this.extractResponse(response).trim();
        } catch (error) {
            console.warn('Thought generation failed, using fallback:', error.message);
            return "Analyzing mission goal and preparing next steps...";
        }
    }
    async planNextAction(missionGoal, context = {}) {
        const {
            threadSummary = '',
            lastMessages = [],
            extractedFacts = {},
            userPreferences = {},
            conversationHistory = []
        } = context;

        const systemPrompt = `You are BOULT — the executive intelligence layer. Plan the next move for this mission.
Mission goal: "${missionGoal}"

## Rules for your output (High-Signal Planning):
1. Restate context in exactly 1 line.
2. Propose one clear, outcome-focused next step (next_action).
3. If this is a scheduling mission, clarify: time, date, and attendees/minimum requirements first.
4. If the user says "SEND" or "REPLY" and content is ready, use send_email immediately (unless high-risk).
5. Make reply easy: yes/no, A/B choice, or 2 time slots.
6. Keep draft_body < 120 words. No em dashes (—). No bolding/italics.
7. Never invent facts; add missing ones to questions_for_user. 
8. Safety: Mentions of money/legal require create_draft for review first.
9. Summarizing: use summarize as next_action and put high-signal insights in draft_body.
10. For Cal.com: reference direct booking via integration.

## Structured Output (Strict JSON):
{
  "next_action": "one of [draft_reply, send_email, create_draft, create_meeting, get_availability, summarize, clarify]",
  "draft_subject": "string",
  "draft_body": "string",
  "confidence": number,
  "assumptions": ["string"],
  "questions_for_user": ["string"],
  "send_to": ["email"],
  "cc": ["email"],
  "safety_flags": ["one or more of: new_recipient, external_domain, mentions_money, mentions_legal, mentions_medical, attachment_forwarding, large_recipient_list"]
}`;

        const messages = [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: JSON.stringify({
                    mission_goal: missionGoal,
                    thread_summary: threadSummary?.substring(0, 500),
                    last_messages: lastMessages.slice(-3).map(m => ({
                        from: m.from,
                        date: m.date,
                        body: m.body?.substring(0, 1000)
                    })),
                    extracted_facts: extractedFacts,
                    user_preferences: userPreferences,
                    recent_conversation: conversationHistory.slice(-3).map(m => ({
                        role: m.role,
                        content: m.content?.substring(0, 200)
                    }))
                })
            }
        ];

        try {
            const response = await this.callOpenRouter(messages, {
                maxTokens: 1000,
                temperature: 0.2
            });

            let content = this.extractResponse(response);
            content = content.trim();
            if (content.startsWith('```json')) content = content.replace(/^```json/, '');
            if (content.endsWith('```')) content = content.replace(/```$/, '');

            const parsed = JSON.parse(content);

            return {
                next_action: parsed.next_action || 'clarify',
                draft_subject: parsed.draft_subject || missionGoal,
                draft_body: this.removeEmDashes(parsed.draft_body || ''),
                confidence: parsed.confidence || 0.5,
                assumptions: parsed.assumptions || [],
                questions_for_user: parsed.questions_for_user || [],
                send_to: parsed.send_to || [],
                cc: parsed.cc || [],
                safety_flags: parsed.safety_flags || []
            };
        } catch (error) {
            console.error('Plan error:', error);
            return {
                next_action: 'clarify',
                questions_for_user: ["I couldn't plan the next step. Could you provide more details?"],
                safety_flags: []
            };
        }
    }



    /**
     * Dynamically generate steps for a mission
     */
    async generateMissionSteps(goal, context = {}) {
        const systemPrompt = `You are the BOULT Mission Planner. Convert a user goal into a sequence of technical steps.
Available actionTypes:
- search_email: find threads/contacts by query
- read_thread: analyze messages in the found thread
- boult_inbox_review: fetch and summarize recent messages
- boult_outreach: send outreach/intro email
- boult_auto_pilot: respond to a message or thread
- draft_reply: propose a reply in canvas

Rules:
1. Return high-signal steps required to finish the mission.
2. If scheduling: search -> read -> get_availability -> draft_reply.
3. If replying: search -> read -> boult_auto_pilot.
4. If intro outreach: boult_outreach.
5. If catch-up: boult_inbox_review -> summarize.

Return strict JSON:
{
  "steps": [
    { "actionType": "string", "label": "Executive-level label (e.g. Analyzing partnership bottleneck)", "description": "Tool-specific instructions" }
  ]
}`;

        try {
            const response = await this.callOpenRouter([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Goal: ${goal}` }
            ], { maxTokens: 500, temperature: 0.1 });

            let content = this.extractResponse(response);
            content = content.trim();
            if (content.startsWith('```json')) content = content.replace(/^```json/, '');
            if (content.endsWith('```')) content = content.replace(/```$/, '');

            const parsed = JSON.parse(content);
            return parsed.steps || [];
        } catch (e) {
            console.error('Step generation failed, using fallback templates.');
            return [];
        }
    }

    /**
     * Analyze a list of emails to determine if any "nudges" (reminders) are needed.
     * Returns a list of nudge objects.
     */
    async analyzeNeedsNudge(emails, options = {}) {
        if (!emails || emails.length === 0) return [];

        try {
            console.log(`🤖 [BoultAI] Analyzing ${emails.length} emails for nudges...`);
            const systemPrompt = `You are BOULT_NUDGE_DETECTOR. 
Analyze these emails (last 30 days) and identify any unreplied human emails that expect a response or have an outstanding question.

ONLY include:
- Direct questions or requests
- Urgent business inquiries

IGNORE:
- Newsletters/Promos/Alerts
- Acknowledgments/Thank yous

JSON format:
{ "nudges": [{"id": "...", "subject": "...", "reason": "...", "urgency": "high/medium", "suggestedAction": "..."}] }
If none, return {"nudges": []}. No preamble.`;

            const emailSummaries = emails.map(e => ({
                id: e.id,
                from: e.from,
                subject: e.subject,
                date: e.date,
                snippet: e.snippet
            }));

            const response = await this.callOpenRouter([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Identify nudges in these emails: ${JSON.stringify(emailSummaries)}` }
            ], { maxTokens: 800, temperature: 0.1, taskType: 'intent' });

            let content = this.extractResponse(response).trim();
            if (!content) {
                console.warn('⚠️ [BoultAI] Empty response from AI for nudges');
                return [];
            }

            // Extract JSON if AI wrapped it in markdown or included conversational text
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : content;

            try {
                const parsed = JSON.parse(jsonStr);
                const nudges = parsed.nudges || [];
                console.log(`✅ [BoultAI] Detected ${nudges.length} nudges`);
                return nudges;
            } catch (err) {
                console.error('💥 [BoultAI] Failed to parse nudge JSON:', err.message, '\nResponse was:', content);
                return [];
            }
        } catch (error) {
            console.error('💥 [BoultAI] Error in analyzeNeedsNudge:', error);
            return [];
        }
    }

    /**
     * Detect if a message should start a mission and extract the goal
     */
    async detectMissionGoal(message, conversationHistory = []) {
        const systemPrompt = `Analyze the user's message and decide if they are asking for a concrete task (a "Mission").
A Mission is a goal that requires multiple steps, like:
- Scheduling a meeting
- Sending an intro or outreach email (boult_outreach)
- Reviewing latest inbox activity (boult_inbox_review)
- Following up or responding to one or more emails (boult_auto_pilot)
- Categorizing or summarizing threads (Catch up)
- Managing a thread

Respond with strict JSON:
{
  "isMission": boolean,
  "goal": string (concise mission goal title, e.g. "Schedule Demo with Sarah"),
  "reasoning": string
}

If it's just general conversation or asking a simple question, isMission is false.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...conversationHistory.slice(-3),
            { role: 'user', content: message }
        ];

        try {
            const response = await this.callOpenRouter(messages, {
                maxTokens: 300,
                temperature: 0.1
            });

            let content = this.extractResponse(response);
            content = content.trim();
            if (content.startsWith('```json')) content = content.replace(/^```json/, '');
            if (content.endsWith('```')) content = content.replace(/```$/, '');

            const parsed = JSON.parse(content);
            return {
                isMission: !!parsed.isMission,
                goal: parsed.goal || '',
                reasoning: parsed.reasoning || ''
            };
        } catch (e) {
            return { isMission: false, goal: '', reasoning: 'error parsing' };
        }
    }

    /**
     * Remove all em dashes from text
     */
    removeEmDashes(text) {
        if (!text || typeof text !== 'string') return text;
        return text.replace(/\u2014/g, ', ').replace(/\u2013/g, '-');
    }
    /**
     * Helper to decode base64 to text for common text types
     */
    _decodeBase64ToText(att) {
        if (!att || !att.base64) return '[Empty File]';

        // Try to decode text files
        let fileContent = '[Binary Data]';
        if (att.type?.includes('text') || att.type?.includes('json') || att.type?.includes('javascript') || att.type?.includes('xml')) {
            try {
                const base64Data = att.base64.split(',')[1] || att.base64;
                fileContent = Buffer.from(base64Data, 'base64').toString('utf-8');
                if (fileContent.length > 5000) fileContent = fileContent.substring(0, 5000) + '... [truncated]';
            } catch (e) {
                fileContent = '[Error decoding file]';
            }
        }
        return `[Attached File: ${att.name} (${att.type})]\nContent:\n${fileContent}`;
    }

    /**
     * Get user context from Supermemory
     * Returns relevant memories for the user
     */
    async getSupermemoryContext(userId, query) {
        if (!this.supermemoryApiKey || !userId) return '';

        console.log(`🧠 [Boult] Fetching memory from Supermemory for: ${userId}`);

        try {
            const response = await fetch('https://api.supermemory.ai/v3/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.supermemoryApiKey}`
                },
                body: JSON.stringify({
                    q: query,
                    containerTag: userId,
                    limit: 5
                })
            });

            if (!response.ok) {
                console.warn(`⚠️ Supermemory search failed: ${response.status}`);
                return '';
            }

            const data = await response.json();
            const memories = data.results || [];

            if (memories.length === 0) return '';

            const memoryText = memories
                .filter(m => m.text || m.content || m.snippet)
                .map((m, i) => `[Fact #${i + 1}]: ${m.text || m.content || m.snippet || ''}`)
                .join('\n');

            return memoryText;
        } catch (error) {
            console.error('❌ Supermemory error:', error.message);
            return '';
        }
    }

    /**
     * Store an interaction into Supermemory
     */
    async storeMemory(userId, content) {
        if (!this.supermemoryApiKey || !userId || !content) return;

        try {
            await fetch('https://api.supermemory.ai/v3/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.supermemoryApiKey}`
                },
                body: JSON.stringify({
                    content: content,
                    containerTag: userId
                })
            });
            console.log('✅ Interaction saved to Supermemory');
        } catch (error) {
            console.error('⚠️ Failed to save memory:', error.message);
        }
    }
}

// Export singleton instance
export const boultAI = new BoultAIService();
