/**
 * Boult Rule Violation Detector
 *
 * Inspects what the assistant produced this turn and flags violations of
 * the five operating rules (see system-prompt.ts top bookend).
 *
 * Each violation maps to one of:
 *   • fetch_before_claim    — claims specifics with no tool backing
 *   • act_dont_ask          — asked back in prose when ask_user wasn't called
 *   • recover_dont_surrender — ended with "I can't" instead of pivoting
 *   • coordinate_clean      — (best-effort) sequenced what could've been parallel
 *   • one_voice             — present-tense narration / tone mismatch
 *   • output_boundary       — raw tool syntax, internal scratchpad, meta-commentary
 *
 * Detections are heuristic and conservative — false positives waste signal,
 * so we only flag patterns with a clear failure mode. The loop logs each
 * detection to boult_rule_violations (best-effort, never throws).
 *
 * SQL required:
 *
 *   CREATE TABLE IF NOT EXISTS boult_rule_violations (
 *     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id text NOT NULL,
 *     run_id text,
 *     conversation_id text,
 *     rule text NOT NULL,
 *     severity text NOT NULL,
 *     pattern text NOT NULL,
 *     excerpt text,
 *     model text,
 *     user_message_preview text,
 *     detected_at timestamptz DEFAULT now()
 *   );
 *   CREATE INDEX IF NOT EXISTS idx_boult_rule_violations_user_time
 *     ON boult_rule_violations(user_id, detected_at DESC);
 *   CREATE INDEX IF NOT EXISTS idx_boult_rule_violations_rule_time
 *     ON boult_rule_violations(rule, detected_at DESC);
 */

// @ts-ignore — JS module
import { getSupabaseAdmin } from '../supabase.js';
import { normalizeUserId } from './user-id';

export type RuleId =
  | 'fetch_before_claim'
  | 'act_dont_ask'
  | 'recover_dont_surrender'
  | 'one_voice'
  | 'output_boundary';

export interface RuleViolation {
  rule: RuleId;
  severity: 'hard' | 'soft';
  pattern: string;
  excerpt?: string;
}

export interface DetectInputs {
  assistantText: string;
  toolsCalled: string[];
  userMessage: string;
  isDirectOrder: boolean;
  tonePreference?: 'direct' | 'balanced' | 'warm';
}

const ACT_DONT_ASK_PROSE_PATTERNS: Array<{ re: RegExp; pattern: string }> = [
  { re: /\b(should|shall) I (proceed|go ahead|continue|do that|send it|reply|draft|create|book|schedule)\??/i, pattern: 'should I X?' },
  { re: /\bwould you like me to\b[^.?\n]{0,80}\?/i, pattern: 'would you like me to X?' },
  { re: /\bwant me to\b[^.?\n]{0,80}\?/i, pattern: 'want me to X?' },
  { re: /\blet me know if (you'?d like|you want)\b[^.\n]{0,80}/i, pattern: 'let me know if you want X' },
  { re: /\bdo you want me to\b[^.?\n]{0,80}\?/i, pattern: 'do you want me to X?' },
  { re: /\bI'?ll (proceed|go ahead) (if|once) you\b/i, pattern: 'I\'ll proceed once you...' },
];

const RECOVER_PATTERNS: Array<{ re: RegExp; pattern: string }> = [
  { re: /\bI (can(?:no|')t|am unable to|cannot|don'?t have the ability to)\b/i, pattern: 'I can\'t / I cannot' },
  { re: /\bUnfortunately,?\b/i, pattern: 'Unfortunately,' },
  { re: /\b(this is|that is) (?:not|currently not) possible\b/i, pattern: 'this is not possible' },
  { re: /\bbeyond my capabilities\b/i, pattern: 'beyond my capabilities' },
  { re: /\bI'?m sorry,?\s+but I (can(?:no|')t|am unable)\b/i, pattern: 'sorry, but I can\'t' },
];

const ONE_VOICE_NARRATION_PATTERNS: Array<{ re: RegExp; pattern: string }> = [
  { re: /^\s*Let me (search|check|look|fetch|read|pull|find)\b/im, pattern: 'Let me search/check…' },
  { re: /^\s*I'?ll (now|just) (search|check|look|fetch|read|pull|find)\b/im, pattern: 'I\'ll now search…' },
  { re: /^\s*Searching (Gmail|inbox|calendar|Notion|Slack)/im, pattern: 'Searching X…' },
  { re: /^\s*Looking (at|for|into)\b/im, pattern: 'Looking at/for/into…' },
];

const OUTPUT_BOUNDARY_PATTERNS: Array<{ re: RegExp; pattern: string }> = [
  { re: /^\s*(?:request_confirmation|ask_user|send_email|schedule_meeting|search_gmail|search_notion|create_notion_page|send_slack_message|draft_reply)\s*\(\s*\{/m, pattern: 'raw tool-call syntax in text' },
  { re: /\b(?:Tell|Inform|Notify) (?:the )?user\s*[:\-—]\s*["']/i, pattern: 'Tell the user: "..."' },
  { re: /(?:^|\n)\s*(?:IMPORTANT|NOTE TO (?:THE )?ASSISTANT|INTERNAL|REMINDER TO (?:YOU|SELF)|TO THE (?:AGENT|MODEL|LLM))\s*[:\-—]/i, pattern: 'internal scratchpad marker' },
  { re: /\b(?:the (?:message|response|output|reply) (?:appears to be|seems|looks) (?:garbled|corrupted|cut[- ]off|broken))/i, pattern: 'meta-commentary about own output' },
  { re: /^\s*##\s+(?:[^\n]{1,60})\s*\n\s*(?:-\s*$|-\s*_<small>via|-\s*nothing|-\s*none|-\s*n\/a|$)/im, pattern: 'empty section header' },
];

const FETCH_BEFORE_CLAIM_HINTS: Array<{ re: RegExp; pattern: string }> = [
  { re: /\b(\$[0-9][\d,]*(?:\.\d{1,2})?(?:k|K|m|M|MM|B)?)/, pattern: 'specific dollar amount' },
  { re: /\b(?:Q[1-4]|FY\d{2,4}|H[12])\b/, pattern: 'fiscal period (Q3, FY26)' },
  { re: /\b(?:tuesday|wednesday|thursday|friday|saturday|sunday|monday)\s+(?:at\s+)?(?:\d{1,2})(?::\d{2})?\s*(?:am|pm|AM|PM)\b/i, pattern: 'specific day + time' },
];

function trimLine(s: string, max = 140): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function detectViolations(input: DetectInputs): RuleViolation[] {
  const out: RuleViolation[] = [];
  const text = input.assistantText || '';
  if (!text.trim()) return out;

  for (const { re, pattern } of OUTPUT_BOUNDARY_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      out.push({ rule: 'output_boundary', severity: 'hard', pattern, excerpt: trimLine(m[0]) });
    }
  }

  for (const { re, pattern } of RECOVER_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      out.push({ rule: 'recover_dont_surrender', severity: 'hard', pattern, excerpt: trimLine(m[0]) });
      break;
    }
  }

  if (input.isDirectOrder && input.toolsCalled.length === 0) {
    for (const { re, pattern } of ACT_DONT_ASK_PROSE_PATTERNS) {
      const m = re.exec(text);
      if (m) {
        out.push({ rule: 'act_dont_ask', severity: 'hard', pattern, excerpt: trimLine(m[0]) });
        break;
      }
    }
  }

  for (const { re, pattern } of ONE_VOICE_NARRATION_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      out.push({ rule: 'one_voice', severity: 'soft', pattern, excerpt: trimLine(m[0]) });
      break;
    }
  }

  if (input.toolsCalled.length === 0 && text.length > 80) {
    for (const { re, pattern } of FETCH_BEFORE_CLAIM_HINTS) {
      const m = re.exec(text);
      if (m) {
        out.push({ rule: 'fetch_before_claim', severity: 'soft', pattern, excerpt: trimLine(m[0]) });
        break;
      }
    }
  }

  return out;
}

export const DIRECT_ORDER_VERBS = /^\s*(?:draft|send|schedule|book|cancel|reply|read|search|fetch|find|pull|check|log|save|remember|forget|pause|resume|delete|create|move|archive|label|digest|summarize|prep|brief)\b/i;

export function looksLikeDirectOrder(userMessage: string): boolean {
  const t = (userMessage || '').trim();
  if (!t) return false;
  if (t.endsWith('?')) return false;
  if (/^(can you|could you|would you|will you|do you|are you)\b/i.test(t)) return false;
  return DIRECT_ORDER_VERBS.test(t);
}

export async function logViolations(opts: {
  userId: string;
  runId?: string;
  conversationId?: string;
  violations: RuleViolation[];
  model?: string;
  userMessage?: string;
}): Promise<void> {
  if (!opts.violations.length) return;
  try {
    const supabase = getSupabaseAdmin();
    const rows = opts.violations.map(v => ({
      user_id: normalizeUserId(opts.userId),
      run_id: opts.runId || null,
      conversation_id: opts.conversationId || null,
      rule: v.rule,
      severity: v.severity,
      pattern: v.pattern,
      excerpt: v.excerpt || null,
      model: opts.model || null,
      user_message_preview: opts.userMessage ? opts.userMessage.slice(0, 200) : null,
    }));
    await supabase.from('boult_rule_violations').insert(rows);
  } catch {
    // Table missing or DB down — never block the response.
  }
}

export interface ViolationStat {
  rule: RuleId;
  count: number;
}

const RULE_FOCUS_COPY: Record<RuleId, string> = {
  fetch_before_claim:
    'Recent runs claimed specifics without a tool call (the "fetch before claim" rule). For ANY name, number, date, dollar amount, or link in your reply, you MUST have fetched it via a tool this turn or cited a memory. If you haven\'t, fetch first — never guess.',
  act_dont_ask:
    'Recent runs typed prose questions ("should I proceed?", "want me to send?") instead of acting (the "act, don\'t ask" rule). For direct orders, EXECUTE — no checkpointing. If you genuinely need clarification, call ask_user; never type the question.',
  recover_dont_surrender:
    'Recent runs ended with "I can\'t" / "Unfortunately" / "beyond my capabilities" instead of recovering (the "recover, don\'t surrender" rule). When a tool fails, try the next path in the pivot ladder. When an integration is missing, do what\'s possible and report cleanly.',
  one_voice:
    'Recent runs opened with present-tense narration ("Let me search…", "I\'ll now check…") instead of past-tense headlines (the "one voice" rule). Start with what was DONE, not what you\'re about to do. The step cards already show the action.',
  output_boundary:
    'Recent runs leaked raw tool-call syntax, internal scratchpad markers ("Tell the user:"), empty section headers, or meta-commentary about your own output. Run the output-boundary check before composing — none of these should ever ship.',
};

export async function getRecentViolationFocus(userId: string, lookbackHours = 24): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('boult_rule_violations')
      .select('rule')
      .eq('user_id', normalizeUserId(userId))
      .gte('detected_at', since);
    if (!data || data.length === 0) return null;
    const counts = new Map<RuleId, number>();
    for (const row of data as Array<{ rule: RuleId }>) {
      counts.set(row.rule, (counts.get(row.rule) || 0) + 1);
    }
    if (counts.size === 0) return null;
    let top: { rule: RuleId; count: number } | null = null;
    for (const [rule, count] of counts.entries()) {
      if (!top || count > top.count) top = { rule, count };
    }
    if (!top || top.count < 2) return null;
    const copy = RULE_FOCUS_COPY[top.rule];
    return `\n\n# 🎯 RULE FOCUS THIS TURN — based on the last ${lookbackHours}h\n\nYou violated **${top.rule}** ${top.count} time${top.count === 1 ? '' : 's'} in recent runs. ${copy}\n\nThis is the highest-leverage rule to nail this turn. Run the five-rule check at the SIGN-OFF block before composing.`;
  } catch {
    return null;
  }
}
