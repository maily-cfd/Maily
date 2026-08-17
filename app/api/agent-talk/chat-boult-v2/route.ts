import { NextResponse } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth.js';
import { DatabaseService } from '@/lib/supabase.js';
import { decrypt } from '@/lib/crypto.js';
import { BoultAIService } from '@/lib/boult-ai.js';
import { BoultAgentLoop } from '@/lib/boult-agent-loop.js';
import { subscriptionService, FEATURE_TYPES } from '@/lib/subscription-service';
import { logEvent } from "@/lib/logsso";

export const maxDuration = 60; // 60s for agentic loop

/**
 * Boult Quick Chat & Agent Talk API (v2)
 * Handles autonomous agent loops with SSE streaming
 */
export async function POST(request: Request) {
  try {
    // 1. Auth & Session
    // @ts-ignore
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = session.user.email;

    // 2. Body Parsing
    let body;
    try {
      body = await request.json();
    } catch (e) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { 
      message, 
      conversationId, 
      history = [], 
      selectedEmailId = null,
      modelId = null,
      mode = 'agent'
    } = body;

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // 3. Subscription & Credit Check
    const canUse = await subscriptionService.canUseFeature(userEmail, FEATURE_TYPES.BOULT_AI);
    if (!canUse) {
      const usage = await subscriptionService.getFeatureUsage(userEmail, FEATURE_TYPES.BOULT_AI);
      return NextResponse.json({
        error: 'limit_reached',
        message: `Your Boult AI daily limit (${usage.limit}) has been reached. Upgrade for unlimited access.`,
        usage: usage.usage,
        limit: usage.limit,
        upgradeUrl: '/pricing'
      }, { status: 403 });
    }

    // 4. Context Gathering (Database)
    const db = new DatabaseService();
    
    // Get tokens for Gmail integration
    const tokens = await db.getUserTokens(userEmail);
    if (!tokens?.encrypted_access_token) {
      // We still allow chat even if Gmail isn't connected, but agent won't have email access
      console.warn(`[Boult] Gmail not connected for ${userEmail}`);
    }

    // Get user profile for personalization
    const profile = await db.getUserProfile(userEmail);
    const userName = profile?.full_name || profile?.display_name || session.user.name || 'User';
    const privacyMode = profile?.preferences?.ai_privacy_mode === 'enabled';

    // 5. Initialize Boult AI & Agent Loop
    const boultAI = new BoultAIService({ modelId });
    
    const loop = new BoultAgentLoop({
      boultAI,
      db,
      userEmail,
      userName,
      conversationId,
      conversationHistory: history,
      gmailAccessToken: tokens?.encrypted_access_token ? decrypt(tokens.encrypted_access_token) : null,
      privacyMode,
      selectedEmailId,
      memoryContext: null,
      integrations: {
        gmail: !!tokens?.encrypted_access_token,
        google_calendar: !!tokens?.encrypted_access_token, // Usually same token
        google_tasks: !!tokens?.encrypted_access_token,
        notion: !!process.env.NOTION_INTEGRATION_TOKEN,
        supermemory: !!process.env.SUPERMEMORY_API_KEY
      },
      mode
    });

    // 6. Create SSE Stream
    console.log(`🚀 [Boult] Starting agent loop for ${userEmail}: "${message.substring(0, 50)}..."`);
    const stream = loop.createStream(message, { modelId });

    // Increment usage (non-blocking)
    subscriptionService.incrementFeatureUsage(userEmail, FEATURE_TYPES.BOULT_AI).catch(err => {
      console.warn('[Boult] Failed to increment usage:', err.message);
    });

    // 7. Return SSE Response
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('💥 Boult Chat API Error:', error.message);
    return NextResponse.json({ 
      error: 'Failed to process agent request', 
      details: error.message 
    }, { status: 500 });
  }
}
