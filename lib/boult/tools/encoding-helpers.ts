/**
 * Boult tool layer — Gmail / MIME encoding helpers.
 *
 * Pulled out of tools.ts in PART 39a. Used by every Gmail-touching executor
 * (read, search, draft, send, archive). Nothing in here talks to Supabase
 * or the network — pure encoding/decoding.
 */

export function b64decode(s: string): string {
  try {
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  } catch { return ''; }
}

export function getHeader(headers: any[], name: string): string {
  return headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

/**
 * Recursively walk a Gmail message payload and return the first text/plain
 * body found, truncated to maxLen. Multipart messages prefer plain text but
 * fall back to whatever the recursion finds first.
 */
export function extractBody(payload: any, maxLen = 3000): string {
  if (!payload) return '';
  if (payload.body?.data) return b64decode(payload.body.data).slice(0, maxLen);
  if (payload.parts) {
    for (const p of payload.parts) {
      if (p.mimeType === 'text/plain' && p.body?.data) return b64decode(p.body.data).slice(0, maxLen);
    }
    for (const p of payload.parts) { const r = extractBody(p, maxLen); if (r) return r; }
  }
  return '';
}

/**
 * Build a Gmail-API-friendly base64url-encoded RFC822 message body.
 * threadId is set on the outer JSON envelope, not here — this only handles
 * headers + body. Pass inReplyTo to include In-Reply-To / References headers
 * so the message threads in Gmail UI.
 */
export function buildRaw(to: string, subject: string, body: string, threadId?: string, inReplyTo?: string): string {
  const lines = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=UTF-8'];
  if (inReplyTo) { lines.push(`In-Reply-To: ${inReplyTo}`); lines.push(`References: ${inReplyTo}`); }
  lines.push('', body);
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}
