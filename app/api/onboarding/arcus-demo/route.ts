/**
 * POST /api/onboarding/arcus-demo
 *
 * Onboarding-only Arcus run: draft up to 3 replies without a paid subscription.
 * The main /api/arcus/chat path is paywalled — this is why "Watch Arcus work"
 * failed for every user still in signup.
 */

import { NextRequest } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth';
// @ts-ignore
import { DatabaseService } from '@/lib/supabase';
import { runAgentLoop } from '@/lib/arcus/loop';
import { buildSystemPrompt, getConnectedIntegrations } from '@/lib/arcus/system-prompt';
import { verifyGmailScopes } from '@/lib/arcus/gmail-scope';
import { logEvent } from '@/lib/logsso';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ONBOARDING_APPEND = `
## Onboarding demo (strict)
The user is in signup and has not paid yet. Show a fast, trustworthy demo.
- Find exactly the requested number of oldest unread inbox emails that need a human reply (skip newsletters, promos, automated mail).
- Draft a reply in the user's voice for each. Save each as a Gmail draft. NEVER send.
- Prefer bulk/batch Gmail tools to stay within time limits.
- When finished, reply with one short sentence summarizing what you drafted.
`;

function sseConnectorShortCircuit(userMessage: string, reqStart: number) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const emit = (type: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      const runId = `onboarding-preflight-${Date.now()}`;
      emit('run_start', { runId, message: userMessage });
      emit('connector_required', {
        connectors: [{
          id: 'gmail',
          name: 'Gmail',
          description: 'Reconnect Gmail so Arcus can read your inbox and save drafts.',
          connected: false,
        }],
        waitingForUser: true,
        reason: 'gmail_not_connected',
      });
      emit('message', {
        content: 'Gmail needs to be connected before Arcus can draft replies. Reconnect Gmail from onboarding, then try again.',
      });
      emit('done', { runId, durationMs: Date.now() - reqStart, totalSteps: 0 });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

async function getVoiceBlock(userId: string): Promise<string> {
  try {
    const { voiceProfileService } = await import('@/lib/voice-profile-service.js');
    const profile: any = await voiceProfileService.getVoiceProfile(userId);
    if (!profile || profile.status === 'default') return '';
    const prompt = voiceProfileService.generateVoicePrompt(profile);
    return typeof prompt === 'string' ? prompt.trim() : '';
  } catch {
    return '';
  }
}

export async function POST(request: NextRequest) {
  const reqStart = Date.now();

  const session = await auth();
  if (!session?.user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const userId = session.user.email.toLowerCase();
  const userName = session.user.name?.split(' ')[0] || 'there';

  const db = new DatabaseService(true);
  const profile = await db.getUserProfile(userId);
  if (profile?.onboarding_completed) {
    return new Response(
      JSON.stringify({ error: 'onboarding_complete', message: 'Onboarding demo is only available during signup.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let count = 3;
  try {
    const body = await request.json();
    const n = Number(body?.count);
    if (Number.isFinite(n)) count = Math.max(1, Math.min(3, Math.floor(n)));
  } catch {
    logEvent({ channel: 'failures', event: '❌ API Error', description: 'onboarding arcus-demo invalid JSON body' });
  }

  const userMessage =
    `Find my ${count} oldest unread emails in the inbox that look like they need a reply, ` +
    `and draft a reply to each one in my voice. Save each as a Gmail draft — do NOT send anything.`;

  const connectedIntegrations = await getConnectedIntegrations(userId);
  if (!connectedIntegrations.includes('gmail')) {
    return sseConnectorShortCircuit(userMessage, reqStart);
  }

  if (connectedIntegrations.includes('gmail')) {
    const scopeCheck = await verifyGmailScopes(userId);
    if (!scopeCheck.ok && scopeCheck.reason === 'scope_missing') {
      return sseConnectorShortCircuit(userMessage, reqStart);
    }
  }

  const voiceContext = await getVoiceBlock(userId);

  const systemPrompt =
    buildSystemPrompt({
      userName,
      userId,
      connectedIntegrations,
      memories: '',
      personality: voiceContext || undefined,
      skipConfirmations: true,
      communicationStyle: 'warm',
      verbosity: 'brief',
    }) + ONBOARDING_APPEND;

  let stream: ReadableStream;
  try {
    stream = runAgentLoop({
      userId,
      systemPrompt,
      history: [],
      userMessage,
      connectedIntegrations,
      skipConfirmations: true,
      conversationId: `onboarding-demo-${Date.now()}`,
      deadlineMs: 105_000,
      maxToolCalls: 18,
    });
  } catch (e: any) {
    logEvent({ channel: 'failures', event: '❌ API Error', description: String(e?.message || e) });
    return new Response(JSON.stringify({ error: 'loop_failed', message: 'Arcus could not start. Try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
