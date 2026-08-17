import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { DEFAULT_AI_MODELS, getModelChain } from '@/lib/ai-constants.js';
import { logEvent } from "@/lib/logsso";

const STEPFUN_MODEL = DEFAULT_AI_MODELS[0];
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/**
 * StepFun Step-3.5-Flash Endpoint
 * Direct interface to StepFun's fast flash model via OpenRouter.
 * Used by all Sift AI features: summary, draft reply, notes, intelligence.
 */
export async function POST(request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = (
            process.env.OPENROUTER_API_KEY ||
            process.env.OPENROUTER_API_KEY2 ||
            process.env.OPENROUTER_API_KEY3 ||
            ''
        ).trim();

        if (!apiKey) {
            return NextResponse.json(
                { error: 'OpenRouter API key not configured' },
                { status: 500 }
            );
        }

        const body = await request.json();
        const { messages, maxTokens = 800, temperature = 0.3, privacyMode = false } = body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
        }

        console.log(`🔮 StepFun request: ${messages.length} messages, maxTokens=${maxTokens}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        // Use centralized model chain
        const models = getModelChain();

        let lastError = null;
        let finalResponse = null;
        let usedModel = '';

        for (const model of models) {
            try {
                console.log(`🔮 StepFun attempting via ${model}`);
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout for fast failover

                const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        'HTTP-Referer': process.env.HOST || 'https://maily.cfd',
                        'X-Title': 'Maily',
                        ...(privacyMode ? { 'X-OpenRouter-Data-Collection': 'opt-out' } : {})
                    },
                    body: JSON.stringify({
                        model,
                        messages,
                        temperature,
                        max_tokens: maxTokens,
                        provider: {
                            data_collection: privacyMode ? 'deny' : 'allow'
                        }
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    const data = await response.json();
                    if (data?.choices?.[0]?.message?.content) {
                        finalResponse = data;
                        usedModel = model;
                        console.log(`✅ StepFun success with ${model}`);
                        break;
                    }
                } else {
                    const errorText = await response.text();
                    console.warn(`⚠️ StepFun model ${model} failed (${response.status}):`, errorText.substring(0, 100));
                    lastError = new Error(`API error: ${response.status}`);
                }
            } catch (err) {
            logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
                console.error(`❌ StepFun error with ${model}:`, err.message);
                lastError = err;
            }
        }

        if (!finalResponse) {
            throw lastError || new Error('All models in StepFun chain failed');
        }

        const content = finalResponse.choices[0].message.content;

        return NextResponse.json({
            success: true,
            content,
            model: usedModel,
            usage: finalResponse.usage || null
        });

    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        if (error.name === 'AbortError') {
            console.error('⏱️ StepFun request timed out after 25s');
            return NextResponse.json({ error: 'Request timed out. Please try again.' }, { status: 504 });
        }
        console.error('❌ StepFun endpoint error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * GET /api/ai/stepfun — Health check & model info
 */
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = (
            process.env.OPENROUTER_API_KEY ||
            process.env.OPENROUTER_API_KEY2 ||
            process.env.OPENROUTER_API_KEY3 ||
            ''
        ).trim();

        return NextResponse.json({
            model: STEPFUN_MODEL,
            status: apiKey ? 'configured' : 'missing_api_key',
            endpoint: `${OPENROUTER_BASE}/chat/completions`,
            timeout_ms: 25000,
            features: [
                'email_summary',
                'draft_reply',
                'ai_notes',
                'inbox_intelligence',
                'voice_cloning'
            ]
        });
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
