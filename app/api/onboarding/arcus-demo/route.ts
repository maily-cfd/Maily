/**
 * POST /api/onboarding/arcus-demo
 *
 * Deterministic onboarding demo — no full agent loop (that times out on unpaid
 * signup and destroys trust). Finds real unread threads, drafts in the user's
 * voice, saves Gmail drafts, and streams the same SSE shapes S9 already parses.
 */

import { NextRequest } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth';
// @ts-ignore
import { DatabaseService } from '@/lib/supabase';
// @ts-ignore
import { GmailService } from '@/lib/gmail';
// @ts-ignore
import { AIConfig } from '@/lib/ai-config';
import { getGmailToken } from '@/lib/arcus/tools/http-tokens';
import { logEvent } from '@/lib/logsso';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function sse(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function extractEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  if (m?.[1]) return m[1].trim();
  const bare = from.trim();
  return bare.includes('@') ? bare : '';
}

function extractName(from: string): string {
  const m = from.match(/^"?([^"<]+)"?\s*</);
  if (m?.[1]?.trim()) return m[1].trim();
  const email = extractEmail(from);
  if (email) return email.split('@')[0] || 'there';
  return 'there';
}

function replySubject(subject: string): string {
  const s = (subject || '').trim() || '(no subject)';
  return /^re:\s/i.test(s) ? s : `Re: ${s}`;
}

function clipBody(text: string, max = 3500): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export async function POST(request: NextRequest) {
  const reqStart = Date.now();
  const enc = new TextEncoder();

  const session = await auth();
  if (!session?.user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const userId = session.user.email.toLowerCase();
  const userName = session.user.name?.split(' ')[0] || userId.split('@')[0] || 'there';

  const db = new DatabaseService(true);
  const profile = await db.getUserProfile(userId);
  if (profile?.onboarding_completed) {
    return new Response(
      JSON.stringify({ error: 'onboarding_complete', message: 'This demo is only available during setup.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let count = 2;
  try {
    const body = await request.json();
    const n = Number(body?.count);
    if (Number.isFinite(n)) count = Math.max(1, Math.min(2, Math.floor(n)));
  } catch {
    /* default count */
  }

  const accessToken = await getGmailToken(userId);
  if (!accessToken) {
    const stream = new ReadableStream({
      start(controller) {
        const runId = `onboarding-demo-${Date.now()}`;
        controller.enqueue(enc.encode(sse('run_start', { runId })));
        controller.enqueue(enc.encode(sse('connector_required', {
          connectors: [{ id: 'gmail', name: 'Gmail', connected: false }],
          reason: 'gmail_not_connected',
        })));
        controller.enqueue(enc.encode(sse('error', {
          message: 'Gmail isn’t connected yet. Go back and connect it, then try again.',
        })));
        controller.enqueue(enc.encode(sse('done', { runId, durationMs: Date.now() - reqStart, totalSteps: 0 })));
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

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (type: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(sse(type, data)));
        } catch { /* closed */ }
      };

      const runId = `onboarding-demo-${Date.now()}`;
      let steps = 0;

      try {
        emit('run_start', { runId });
        emit('thinking', { status: 'Looking for emails that need a reply…' });

        const gmail: any = new GmailService(accessToken, '');
        gmail.setUserEmail?.(userId);

        // Oldest unread, human-looking inbox mail — same spirit as the scan step.
        const query =
          'in:inbox is:unread -category:promotions -category:social -category:updates -category:forums -in:chats';
        emit('tool_call', { tool: 'search_gmail', params: { query }, iteration: 1 });
        steps++;

        const list: any = await gmail.getEmails(Math.min(12, count * 4), query);
        const messageIds: string[] = (Array.isArray(list?.messages) ? list.messages : [])
          .map((m: any) => m?.id)
          .filter(Boolean);

        emit('tool_result', {
          tool: 'search_gmail',
          success: true,
          summary: messageIds.length
            ? `Found ${messageIds.length} unread ${messageIds.length === 1 ? 'thread' : 'threads'}`
            : 'No unread threads that need a reply',
          iteration: 1,
        });

        if (messageIds.length === 0) {
          emit('message', {
            content: 'Your inbox is clear — nothing unread that needs a reply right now. You’re in good shape.',
          });
          emit('done', { runId, durationMs: Date.now() - reqStart, totalSteps: steps });
          controller.close();
          return;
        }

        // Load details, keep oldest first (Gmail list is newest-first).
        const details: any[] = [];
        for (const id of messageIds.slice(0, Math.min(8, count * 3))) {
          try {
            const raw = await gmail.getEmailDetails(id);
            details.push(gmail.parseEmailData(raw));
          } catch (e: any) {
            logEvent({ channel: 'failures', event: 'onboarding_arcus_demo_read', description: String(e?.message || e) });
          }
        }
        details.sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0));
        const targets = details.slice(0, count);

        if (targets.length === 0) {
          emit('error', { message: 'Couldn’t open those emails. Try again in a moment.' });
          emit('done', { runId, durationMs: Date.now() - reqStart, totalSteps: steps });
          controller.close();
          return;
        }

        emit('thinking', { status: targets.length === 1 ? 'Drafting one reply in your voice…' : `Drafting ${targets.length} replies in your voice…` });

        let voiceProfile: any = null;
        try {
          const { voiceProfileService } = await import('@/lib/voice-profile-service.js');
          voiceProfile = await voiceProfileService.getVoiceProfile(userId);
        } catch { /* optional */ }

        const ai = new AIConfig();
        let draftsSaved = 0;
        const savedLabels: string[] = [];

        for (let i = 0; i < targets.length; i++) {
          const email = targets[i];
          const to = extractEmail(email.from || '');
          const fromName = extractName(email.from || '');
          const subject = replySubject(email.subject || '');

          emit('tool_call', { tool: 'read_email', params: { subject: email.subject }, iteration: i + 2 });
          steps++;
          emit('tool_result', {
            tool: 'read_email',
            success: true,
            summary: `Read: ${clipBody(email.subject || '(no subject)', 80)}`,
            iteration: i + 2,
          });

          if (!to) {
            emit('narrative', { text: `Skipped one — no reply address on that thread.`, iteration: i + 2 });
            continue;
          }

          emit('tool_call', { tool: 'gmail_draft_reply', params: { to, subject }, iteration: i + 2 });
          steps++;

          const emailContent = [
            `Subject: ${email.subject || ''}`,
            `From: ${email.from || ''}`,
            `Snippet: ${email.snippet || ''}`,
            `Body: ${clipBody(String(email.body || email.snippet || ''), 4000)}`,
          ].join('\n');

          let draftBody = '';
          try {
            draftBody = await ai.generateDraftReply(
              emailContent,
              'Opportunity',
              {
                name: userName,
                email: userId,
                voiceProfile,
                tone: voiceProfile?.status === 'complete' ? 'mimic' : 'professional',
              },
              false,
              { timeout: 18000, model: 'liquid/lfm-2.5-1.2b-thinking:free' },
            );
          } catch (e: any) {
            logEvent({ channel: 'failures', event: 'onboarding_arcus_demo_ai', description: String(e?.message || e) });
            draftBody = `Hi ${fromName},\n\nThanks for your note — I’ll get back to you shortly.\n\nBest,\n${userName}`;
          }

          draftBody = String(draftBody || '').trim();
          if (!draftBody) {
            emit('tool_result', {
              tool: 'gmail_draft_reply',
              success: false,
              summary: 'Draft generation failed',
              iteration: i + 2,
            });
            continue;
          }

          try {
            await gmail.createDraft({
              to,
              subject,
              body: draftBody,
              threadId: email.threadId || null,
              isHtml: false,
            });
            draftsSaved++;
            savedLabels.push(fromName);
            emit('tool_result', {
              tool: 'gmail_draft_reply',
              success: true,
              summary: `Draft saved for ${fromName}`,
              iteration: i + 2,
            });
            emit('narrative', { text: `Drafted a reply to ${fromName} — nothing sent.`, iteration: i + 2 });
          } catch (e: any) {
            logEvent({ channel: 'failures', event: 'onboarding_arcus_demo_draft', description: String(e?.message || e) });
            emit('tool_result', {
              tool: 'gmail_draft_reply',
              success: false,
              summary: 'Couldn’t save the draft to Gmail',
              iteration: i + 2,
            });
          }
        }

        if (draftsSaved === 0) {
          emit('error', {
            message: 'Couldn’t save drafts to Gmail. Check the connection and try again.',
          });
        } else if (draftsSaved === 1) {
          emit('message', {
            content: `Drafted a reply to ${savedLabels[0]} and saved it in Gmail. Nothing was sent.`,
          });
        } else {
          emit('message', {
            content: `Drafted ${draftsSaved} replies (${savedLabels.slice(0, 2).join(' and ')}) and saved them in Gmail. Nothing was sent.`,
          });
        }

        emit('done', { runId, durationMs: Date.now() - reqStart, totalSteps: steps });
        controller.close();
      } catch (e: any) {
        logEvent({ channel: 'failures', event: 'onboarding_arcus_demo', description: String(e?.message || e) });
        emit('error', { message: 'Something broke mid-run. Try again — your inbox is unchanged.' });
        emit('done', { runId, durationMs: Date.now() - reqStart, totalSteps: steps });
        try { controller.close(); } catch { /* */ }
      }
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
