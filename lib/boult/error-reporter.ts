/**
 * Boult lightweight error reporter (FX.3).
 *
 * Sits between every silent catch and console — gives us ONE place to
 * route to Sentry / Datadog / a webhook later. Today it just writes a
 * structured line to console.error with a stable tag prefix so grep on
 * Vercel logs is reliable.
 *
 * Why not @sentry/nextjs? Adds 200KB to the bundle, needs DSN config, and
 * requires per-route opt-in for streaming responses. This wrapper is 50
 * lines, zero deps, and gets us 80% of the value (structured logs we can
 * grep + tag + ship to a hosted error reporter later by changing ONE
 * function body).
 *
 * Usage:
 *   import { reportError } from './error-reporter';
 *   try {
 *     await thing();
 *   } catch (err) {
 *     reportError('memory.save', err, { userId, content: content.slice(0, 100) });
 *     // don't rethrow if you want fail-open behavior
 *   }
 */

export interface ErrorContext {
  userId?: string;
  runId?: string;
  conversationId?: string;
  toolName?: string;
  agentId?: string;
  [key: string]: any;
}

let __reporterHook: ((tag: string, err: any, ctx?: ErrorContext) => void) | null = null;

/**
 * Replace the default console-error sink. Use to wire Sentry/Datadog later
 * without touching every reportError() call site.
 */
export function setErrorReporterHook(hook: (tag: string, err: any, ctx?: ErrorContext) => void) {
  __reporterHook = hook;
}

export function reportError(tag: string, err: any, ctx?: ErrorContext): void {
  try {
    if (__reporterHook) {
      __reporterHook(tag, err, ctx);
      return;
    }
    const ts = new Date().toISOString();
    const msg = err?.message || String(err) || 'unknown error';
    const stack = err?.stack?.toString().slice(0, 600) || undefined;
    // Stable prefix that grep-ing logs can target.
    const line = `[Boult:Err] ${ts} ${tag} — ${msg}`;
    if (ctx) {
      // Stringify safely — circular refs, large blobs, etc.
      let ctxStr: string;
      try { ctxStr = JSON.stringify(ctx).slice(0, 500); }
      catch { ctxStr = '(unserializable)'; }
      console.error(line, ctxStr, stack ? `\nstack: ${stack}` : '');
    } else {
      console.error(line, stack ? `\nstack: ${stack}` : '');
    }
  } catch {
    // If even the reporter throws, swallow. We never want a bug in
    // logging to break the runtime.
  }
}
