/**
 * Boult V3 — Gmail Action Handler
 *
 * Executes whitelisted Gmail actions. Each function validates params,
 * calls the Gmail REST API, and returns a normalized result.
 *
 * Allowed actions: draft_reply, send_email, archive_email, label_email, get_thread
 */

import { googleFetch } from '../../boult/tools/http-tokens';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildRFC822(params: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
  ];
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) lines.push(`References: ${params.references}`);
  lines.push('', params.body);
  return lines.join('\r\n');
}

function toBase64Url(text: string): string {
  return Buffer.from(text)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ── Action: draft_reply ────────────────────────────────────────────────────────

export async function draftReply(
  userId: string,
  accessToken: string,
  params: { threadId: string; to: string; subject: string; body: string; messageId?: string }
): Promise<Record<string, unknown>> {
  const { threadId, to, subject, body, messageId } = params;
  if (!threadId || !to || !body) throw new Error('draft_reply: threadId, to, and body are required');

  const rawMessage = buildRFC822({
    to,
    subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
    body,
    inReplyTo: messageId,
    references: messageId,
  });

  const response = await googleFetch(userId, 'gmail', `${GMAIL_API}/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        raw: toBase64Url(rawMessage),
        threadId,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`draft_reply failed (${response.status}): ${err}`);
  }

  const draft = await response.json();
  return { draftId: draft.id, threadId, to, subject };
}

// ── Action: send_email ─────────────────────────────────────────────────────────

export async function sendEmail(
  userId: string,
  accessToken: string,
  params: { to: string; subject: string; body: string; threadId?: string; messageId?: string }
): Promise<Record<string, unknown>> {
  const { to, subject, body, threadId, messageId } = params;
  if (!to || !subject || !body) throw new Error('send_email: to, subject, and body are required');

  const rawMessage = buildRFC822({ to, subject, body, inReplyTo: messageId, references: messageId });

  const payload: Record<string, unknown> = { raw: toBase64Url(rawMessage) };
  if (threadId) payload.threadId = threadId;

  const response = await googleFetch(userId, 'gmail', `${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`send_email failed (${response.status}): ${err}`);
  }

  const sent = await response.json();
  return { messageId: sent.id, threadId: sent.threadId, to, subject };
}

// ── Action: archive_email ──────────────────────────────────────────────────────

export async function archiveEmail(
  userId: string,
  accessToken: string,
  params: { messageId: string }
): Promise<Record<string, unknown>> {
  const { messageId } = params;
  if (!messageId) throw new Error('archive_email: messageId is required');

  const response = await googleFetch(userId, 'gmail', `${GMAIL_API}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`archive_email failed (${response.status}): ${err}`);
  }

  return { archived: true, messageId };
}

// ── Action: label_email ────────────────────────────────────────────────────────

export async function labelEmail(
  userId: string,
  accessToken: string,
  params: { messageId: string; addLabels?: string[]; removeLabels?: string[] }
): Promise<Record<string, unknown>> {
  const { messageId, addLabels = [], removeLabels = [] } = params;
  if (!messageId) throw new Error('label_email: messageId is required');

  const response = await googleFetch(userId, 'gmail', `${GMAIL_API}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      addLabelIds: addLabels,
      removeLabelIds: removeLabels,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`label_email failed (${response.status}): ${err}`);
  }

  return { messageId, addLabels, removeLabels };
}

// ── Action: get_thread ─────────────────────────────────────────────────────────

export async function getThread(
  userId: string,
  accessToken: string,
  params: { threadId: string }
): Promise<Record<string, unknown>> {
  const { threadId } = params;
  if (!threadId) throw new Error('get_thread: threadId is required');

  const response = await googleFetch(userId, 'gmail', `${GMAIL_API}/threads/${threadId}?format=metadata`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`get_thread failed (${response.status}): ${err}`);
  }

  const thread = await response.json();
  return {
    threadId: thread.id,
    messageCount: thread.messages?.length || 0,
    snippet: thread.snippet,
  };
}

// ── Main dispatch ──────────────────────────────────────────────────────────────

export async function executeGmailAction(
  userId: string,
  accessToken: string,
  action: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  switch (action) {
    case 'draft_reply':    return draftReply(userId, accessToken, params as any);
    case 'send_email':     return sendEmail(userId, accessToken, params as any);
    case 'archive_email':  return archiveEmail(userId, accessToken, params as any);
    case 'label_email':    return labelEmail(userId, accessToken, params as any);
    case 'get_thread':     return getThread(userId, accessToken, params as any);
    default:
      throw new Error(`gmail: unknown action "${action}"`);
  }
}
