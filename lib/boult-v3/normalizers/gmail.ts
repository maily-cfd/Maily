/**
 * Boult V3 — Gmail Normalizer
 *
 * Converts raw Gmail API message objects into typed BoultEvent objects
 * that the LLM can reason about without seeing raw API payloads.
 */

import type { BoultEvent } from '../types';

interface GmailHeader { name: string; value: string }

interface RawGmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    body?: { data?: string };
    parts?: Array<{ mimeType: string; body?: { data?: string } }>;
  };
  internalDate?: string;
}

function getHeader(headers: GmailHeader[], name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBase64(encoded: string): string {
  try {
    return Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function extractBody(msg: RawGmailMessage): string {
  const payload = msg.payload;
  if (!payload) return msg.snippet || '';

  // Single-part message
  if (payload.body?.data) {
    return decodeBase64(payload.body.data).slice(0, 1000);
  }

  // Multi-part — prefer text/plain
  if (payload.parts) {
    const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return decodeBase64(textPart.body.data).slice(0, 1000);
    }
  }

  return msg.snippet || '';
}

export function normalizeGmailMessages(messages: RawGmailMessage[]): BoultEvent[] {
  return messages.map(msg => {
    const headers = msg.payload?.headers || [];
    const subject = getHeader(headers, 'Subject') || '(no subject)';
    const from = getHeader(headers, 'From');
    const to = getHeader(headers, 'To');
    const date = getHeader(headers, 'Date');
    const body = extractBody(msg);

    const sentAt = msg.internalDate
      ? new Date(parseInt(msg.internalDate, 10))
      : date ? new Date(date) : new Date();

    // Parse "Name <email>" format into plain email list
    const attendees: string[] = [];
    if (from) attendees.push(from.replace(/^.*<(.+)>$/, '$1').trim());
    if (to) {
      to.split(',').forEach(addr => {
        attendees.push(addr.replace(/^.*<(.+)>$/, '$1').trim());
      });
    }

    return {
      id: msg.id,
      source: 'gmail' as const,
      type: 'email' as const,
      title: `${from.split('<')[0].trim() || from}: ${subject}`,
      description: body,
      startAt: sentAt,
      endAt: null,
      attendees: attendees.filter(Boolean),
      url: `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}`,
      rawPayload: { id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds },
      detectedAt: new Date(),
    };
  });
}
