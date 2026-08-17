/**
 * Draft feedback learning — PART 40.
 *
 * Every draft review is a signal:
 *   - user sent as-is               → the draft's style worked, mirror it
 *   - user edited before sending    → the diff is the lesson
 *   - user cancelled without sending → the approach didn't work
 *
 * The DraftApprovalModal POSTs here on send / cancel. We persist the signal
 * as a tagged memory entry so the next draft for the same recipient — or
 * any draft where the LLM does memory_search and the recipient comes up —
 * inherits the lesson without anything else changing.
 *
 * The existing CORE DOCTRINE rule "treat saved memory as truth" + the chat
 * route's per-turn memory injection means we don't have to wire anything
 * else: the next turn's prompt already carries the relevant feedback as
 * context the LLM reads before drafting.
 *
 * POST /api/boult/learn/draft-feedback
 *   body: {
 *     recipientEmail: string,
 *     recipientName?: string,
 *     subject?: string,
 *     originalBody: string,     // draft text Boult produced
 *     finalBody?: string,       // body the user actually sent (omit on cancel)
 *     action: 'sent' | 'edited_and_sent' | 'cancelled',
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore — JS module
import { auth as nextAuth } from '../../../../../lib/auth.js';
import { saveMemory } from '../../../../../lib/boult/memory';
import { logEvent } from "@/lib/logsso";

const auth: any = nextAuth;

export const dynamic = 'force-dynamic';

const MAX_BODY_SNIPPET = 600;

function snippet(s: string, n = MAX_BODY_SNIPPET): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function buildMemoryContent(params: {
  recipientName: string;
  recipientEmail: string;
  subject: string;
  originalBody: string;
  finalBody?: string;
  action: 'sent' | 'edited_and_sent' | 'cancelled';
}): string {
  const { recipientName, recipientEmail, subject, originalBody, finalBody, action } = params;
  const who = recipientName
    ? `${recipientName} <${recipientEmail}>`
    : recipientEmail;
  const re = subject ? ` re "${subject}"` : '';

  if (action === 'sent') {
    return [
      `[DRAFT_FEEDBACK] To ${who}${re} — user APPROVED the draft as-is.`,
      `SENT: ${snippet(originalBody, 500)}`,
      `Mirror this style and structure for future drafts to this recipient.`,
    ].join('\n');
  }

  if (action === 'edited_and_sent') {
    return [
      `[DRAFT_FEEDBACK] To ${who}${re} — user EDITED the draft before sending.`,
      `ORIGINAL: ${snippet(originalBody)}`,
      `FINAL:    ${snippet(finalBody || '')}`,
      `Use the FINAL phrasing/structure when drafting for this recipient again — they edited away from the original on purpose.`,
    ].join('\n');
  }

  // cancelled
  return [
    `[DRAFT_FEEDBACK] To ${who}${re} — user CANCELLED the draft without sending.`,
    `ORIGINAL: ${snippet(originalBody)}`,
    `Avoid this draft's approach for this recipient. Re-read the thread context and try a different angle next time.`,
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = (session.user.email as string).toLowerCase();

  let body: any = {};
  try { body = await req.json(); }
  catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const recipientEmail = String(body.recipientEmail || '').trim().toLowerCase();
  const recipientName = String(body.recipientName || '').trim();
  const subject = String(body.subject || '').trim();
  const originalBody = String(body.originalBody || '').trim();
  const finalBody = body.finalBody != null ? String(body.finalBody).trim() : undefined;
  const action = body.action as 'sent' | 'edited_and_sent' | 'cancelled';

  if (!recipientEmail || !originalBody || !['sent', 'edited_and_sent', 'cancelled'].includes(action)) {
    return NextResponse.json(
      { error: 'recipientEmail, originalBody, and action (sent|edited_and_sent|cancelled) are required.' },
      { status: 400 },
    );
  }

  // Cheap dedup: if the user "edited_and_sent" but the diff is trivial
  // (whitespace, ≤3-char difference), treat it as a clean send. Keeps memory
  // from accumulating noise like "removed a trailing space".
  let effectiveAction = action;
  if (action === 'edited_and_sent' && finalBody) {
    const normOrig = originalBody.replace(/\s+/g, ' ').trim();
    const normFinal = finalBody.replace(/\s+/g, ' ').trim();
    if (normOrig === normFinal || Math.abs(normOrig.length - normFinal.length) <= 3) {
      effectiveAction = 'sent';
    }
  }

  const content = buildMemoryContent({
    recipientName,
    recipientEmail,
    subject,
    originalBody,
    finalBody,
    action: effectiveAction,
  });

  // Tags: 'draft_feedback' lets the chat route do a targeted memory_search by
  // tag; the recipient email + action provide further filtering. Memory_search
  // is full-text + semantic anyway so the LLM finds these without needing the
  // tags — they're for debugging + UI display in the settings card.
  const tags = ['draft_feedback', `recipient:${recipientEmail}`, `action:${effectiveAction}`];

  // Source 'ai' so isMemoryEnabled gate applies — if the user opted out of
  // memory, this respects that. Manual draft feedback is implicit, not an
  // explicit "remember this" action.
  try {
    await saveMemory(userId, content, tags, 'ai');
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    // Memory failures must never break the send flow on the client side.
    console.warn('[learn/draft-feedback] saveMemory failed:', err?.message);
    return NextResponse.json({ ok: false, error: 'memory_save_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, action: effectiveAction });
}
