/**
 * Boult Strategic Planner
 * 
 * Uses LLM to translate user intent into a structured sequence of tool calls.
 * The "Planner" in the Planner-Validator-Executor pattern.
 */

import { BOULT_TOOLS } from './boult-tool-registry.js';

export class BoultPlanner {
    constructor(options = {}) {
        this.apiKey = process.env.OPENROUTER_API_KEY;
    }

    /**
     * Translates natural language into a multi-step action plan.
     */
    async plan(intent, context = {}) {
        console.log(`🤖 [Boult Planner] Formulating plan for: "${intent}"`);

        const prompt = `You are the Boult Strategic Planner for Maily.
Your job is to translate a user's intent into a structured JSON execution plan using the provided tools.

** AVAILABLE TOOLS **
${JSON.stringify(BOULT_TOOLS, null, 2)}

** USER CONTEXT **
${JSON.stringify(context, null, 2)}

** SCHEMA **
The output MUST be a JSON object with this exact structure:
{
    "human_readable_summary": "Short explanation of what will happen",
    "risk_analysis": "low" | "medium" | "high",
    "steps": [
        {
            "id": "step_id",
            "tool_id": "tool_id",
            "params": { ... },
            "explanation": "Why this step is necessary"
        }
    ],
    "estimated_duration_ms": 5000
}

** INTENT **
"${intent}"

Return ONLY the raw JSON.`;

        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://maily.cfd",
                    "X-Title": "Maily Boult AI"
                },
                body: JSON.stringify({
                    // nemotron-3-super-120b:free REMOVED 2026-07-19 (user report: not working).
                    // gemma-4-26b confirmed to support response_format json_object.
                    model: "google/gemma-4-26b-a4b-it:free",
                    messages: [{ role: "system", content: prompt }],
                    response_format: { type: "json_object" }
                })
            });

            const data = await response.json();
            const plan = JSON.parse(data.choices[0].message.content);
            
            console.log(`✅ [Boult Planner] Plan created with ${plan.steps.length} steps.`);
            return plan;

        } catch (error) {
            console.error('💥 [Boult Planner] Planning failed:', error);
            throw new Error(`Strategic planning failed: ${error.message}`);
        }
    }
}
