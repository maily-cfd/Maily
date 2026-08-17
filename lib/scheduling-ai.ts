/**
 * Uses a secondary OpenRouter key and cheaper models for scheduling tasks
 */
import { getModelChain } from './ai-constants.js';
export class SchedulingAIService {
    private apiKey: string;
    private models: string[];
    private baseURL: string;

    constructor() {
        // Use the secondary key if provided, fallback to primary if not (safety first)
        // Use all available keys for robustness
        this.apiKey = (process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY2 || process.env.OPENROUTER_API_KEY3 || '').trim();
        // Fallback chain of free/cheap models to handle rate limits
        this.models = getModelChain() as string[];
        this.baseURL = 'https://openrouter.ai/api/v1';
    }

    async callOpenRouter(
        messages: Array<{ role: string; content: string }>,
        options: { temperature?: number; maxTokens?: number; modelPreference?: string } = {}
    ) {
        let lastError: Error | null = null;
        
        // Dynamically get models based on preference if provided
        const modelsToTry = options.modelPreference ? (getModelChain(options.modelPreference as any) as string[]) : this.models;

        for (const model of modelsToTry) {
            try {
                console.log(`🤖 Scheduling AI: Trying model ${model}...`);
                const response = await fetch(`${this.baseURL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`,
                        'HTTP-Referer': process.env.HOST || 'https://maily.cfd',
                        'X-Title': 'Maily Scheduling'
                    },
                    body: JSON.stringify({
                        model,
                        messages,
                        temperature: options.temperature || 0.3,
                        max_tokens: options.maxTokens || 1000
                    })
                });

                if (response.status === 429) {
                    const retryDelay = 1000 + Math.random() * 1000;
                    console.warn(`⚠️ Model ${model} rate limited, backing off ${retryDelay.toFixed(0)}ms before trying next...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                }

                if (!response.ok) {
                    const error = await response.text();
                    console.warn(`⚠️ Model ${model} failed: ${error}`);
                    lastError = new Error(`AI error: ${error}`);
                    continue;
                }

                const data = await response.json();
                console.log(`✅ Scheduling AI: Success with ${model}`);
                return data?.choices?.[0]?.message?.content || '';
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                console.warn(`⚠️ Model ${model} threw exception:`, msg);
                lastError = error instanceof Error ? error : new Error(msg);
            }
        }

        // If all models failed, throw the last error
        throw lastError || new Error('All AI models failed');
    }

    /**
     * Recommends meeting details based on the conversation
     */
    async recommendMeetingDetails(emailContent: string) {
        const prompt = `
        Analyze this email and recommend meeting details for a follow-up call.
        
        EMAIL CONTENT:
        ${emailContent}
        
        RULES:
        1. Be specific to the context (e.g., "Discuss [Topic]" instead of "Follow-up")
        2. Description should summarize the goal from the sender's perspective.
        3. suggested_duration should be numbers (15, 30, or 60).
        
        RETURN JSON ONLY in this format:
        {
          "suggested_title": "Short title",
          "suggested_description": "Objective summary",
          "suggested_duration": 30
        }
        `;

        try {
            const response = await this.callOpenRouter([{ role: 'user', content: prompt }]);
            // Extract JSON even if AI wraps it in code blocks or adds text
            const firstBrace = response.indexOf('{');
            const lastBrace = response.lastIndexOf('}');
            if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON found');
            const cleanJson = response.substring(firstBrace, lastBrace + 1);
            return JSON.parse(cleanJson);
        } catch {
            console.warn('⚠️ AI recommendation failed, using defaults');
            return {
                suggested_title: 'Follow-up Call',
                suggested_description: 'Discussing the recent email exchange.',
                suggested_duration: 30
            };
        }
    }

    /**
     * Generate a personalized notification email for meeting attendees
     */
    async generatePersonalizedNotification({
        senderName,
        recipientEmail,
        meetingTitle,
        meetingTime,
        meetingLink,
        emailContext
    }: {
        senderName: string;
        recipientEmail: string;
        meetingTitle: string;
        meetingTime: string;
        meetingLink: string;
        emailContext?: string;
    }): Promise<string> {
        const prompt = `
        Write a short, friendly, and professional meeting invitation email.
        
        SENDER: ${senderName}
        RECIPIENT: ${recipientEmail}
        MEETING: ${meetingTitle}
        TIME: ${meetingTime}
        LINK: ${meetingLink}
        ${emailContext ? `CONTEXT FROM PREVIOUS EMAIL: ${emailContext.substring(0, 500)}` : ''}
        
        RULES:
        - Be warm but professional
        - Keep it under 100 words
        - Reference the context naturally if provided
        - Include the meeting link
        - End with a friendly sign-off using ${senderName}
        
        RETURN ONLY THE EMAIL BODY TEXT, NO SUBJECT LINE.
        `;

        try {
            const response = await this.callOpenRouter([{ role: 'user', content: prompt }]);
            return response.trim();
        } catch {
            // Fallback to a basic template if AI fails
            return `Hi there,

I've scheduled a call for us: "${meetingTitle}"

📅 When: ${meetingTime}
🔗 Join here: ${meetingLink}

Looking forward to connecting!

Best,
${senderName}`;
        }
    }
}
