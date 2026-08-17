/**
 * Signal-density scorer for background-agent reports.
 *
 * Purpose: gate report delivery so users only get notified when there's
 * something worth their attention. A daily inbox-sweep agent that finds
 * nothing actionable on a quiet day should NOT email "no work in your lane"
 * — that trains the user to ignore agent mail.
 *
 * Score range 0-10:
 *   ≥ 3   — has signal, deliver
 *   < 3   — quiet day, suppress delivery (unless policy=always_send OR pending actions)
 *
 * Never throws. Always returns a numeric score + a short reasons array for
 * observability (logged into boult_agent_runs.delivery_decision).
 */

export interface SignalScore {
  score: number;
  reasons: string[];
  wordCount: number;
}

const ACTIONABLE_SECTION_HEADERS = [
  'needs attention',
  'needs your attention',
  'needs your decision',
  'decide',
  'urgent',
  'revenue',
  'client',
  'follow.?ups?',
  'stalled',
  'deals?',
  'top of mind',
  'pending approval',
];

const URGENCY_KEYWORDS = [
  'urgent',
  'overdue',
  'deadline',
  'blocker',
  'blocking',
  'stalled',
  'awaiting your approval',
  'needs your decision',
  'needs your approval',
  'vip waiting',
  'time-sensitive',
  'asap',
];

const EMPTY_DAY_PATTERNS: RegExp[] = [
  /no work in your lane/i,
  /inbox is clear/i,
  /inbox clear/i,
  /calendar['']?s free/i,
  /calendar['']?s clear/i,
  /nothing to triage/i,
  /nothing['']?s waiting/i,
  /nothing waiting/i,
  /all clear/i,
  /quiet day/i,
  /\bno urgent\b/i,
  /nothing urgent/i,
  /no scheduled (agents|meetings|items)/i,
  /no (new |unread )?(emails?|meetings?|items?|threads?) (today|this run|in your)/i,
  /no follow.?ups required/i,
  /no items? need(s|ed)?/i,
  /no decisions needed/i,
  /no action (needed|required)/i,
];

const ACTION_VERB_RE =
  /\b(drafted|sent|archived|scheduled|booked|created|updated|tagged|flagged|logged|delivered|extracted|surfaced|saved|reminded)\s+(\d+)\b/gi;

export function scoreReportSignal(report: string): SignalScore {
  const reasons: string[] = [];
  let score = 0;

  if (!report || !report.trim()) {
    return { score: 0, reasons: ['empty report'], wordCount: 0 };
  }

  const wordCount = report.split(/\s+/).filter(Boolean).length;

  for (const header of ACTIONABLE_SECTION_HEADERS) {
    const re = new RegExp(`^##+\\s+(?:[^\\w\\s]+\\s+)?${header}\\b`, 'im');
    const m = re.exec(report);
    if (!m) continue;
    const after = report.slice(m.index + m[0].length);
    const nextHeader = after.search(/\n##\s+/);
    const section = nextHeader === -1 ? after : after.slice(0, nextHeader);
    const bulletLines = (section.match(/^\s*[-*+]\s+.+$/gm) || [])
      .map(l => l.replace(/^[\s\-*+]+/, '').trim())
      .filter(l => {
        const stripped = l
          .replace(/_<small>via[^<]+<\/small>_/gi, '')
          .replace(/via\s+[\w📝📅📧💬🔍\s]+VA/gi, '')
          .trim();
        if (stripped.length < 6) return false;
        if (/^(none|nothing|n\/a|tbd)\.?$/i.test(stripped)) return false;
        return true;
      });
    const tableRows = (section.match(/^\|[^|]+\|[^|]+\|/gm) || []).length;
    const items = bulletLines.length + tableRows;
    if (items > 0) {
      const add = Math.min(2.5, 1 + items * 0.4);
      score += add;
      reasons.push(`section "${header}": ${items} items (+${add.toFixed(1)})`);
    }
  }

  const viaOnlyMatches = (report.match(/^\s*[-*+]\s*_?<?small>?via\s+[\w\s📝📅📧💬🔍]+VA<?\/?small>?_?\s*$/gim) || []).length;
  if (viaOnlyMatches >= 2) {
    const penalty = Math.min(4, viaOnlyMatches * 1);
    score -= penalty;
    reasons.push(`${viaOnlyMatches} empty 'via X VA' lines (-${penalty})`);
  }

  // 2. Action verbs with non-zero counts ("drafted 5", "sent 3").
  let actionContribution = 0;
  let actionMatches = 0;
  ACTION_VERB_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ACTION_VERB_RE.exec(report)) !== null) {
    const count = parseInt(m[2], 10);
    if (isNaN(count) || count <= 0) continue;
    actionMatches++;
    actionContribution += Math.min(1.5, count * 0.3);
    if (actionMatches >= 6) break;
  }
  if (actionContribution > 0) {
    actionContribution = Math.min(3, actionContribution);
    score += actionContribution;
    reasons.push(`${actionMatches} action verbs (+${actionContribution.toFixed(1)})`);
  }

  // 3. Urgency keywords (cap at +3).
  const normalized = report.toLowerCase();
  let urgentHits = 0;
  for (const k of URGENCY_KEYWORDS) {
    if (normalized.includes(k)) urgentHits++;
  }
  if (urgentHits > 0) {
    const add = Math.min(3, urgentHits);
    score += add;
    reasons.push(`${urgentHits} urgency markers (+${add})`);
  }

  // 4. Markdown links — actual artifact references mean something happened.
  const linkCount = (report.match(/\]\(https?:\/\//g) || []).length;
  if (linkCount > 0) {
    const add = Math.min(1.5, linkCount * 0.3);
    score += add;
    reasons.push(`${linkCount} artifact links (+${add.toFixed(1)})`);
  }

  // 5. Empty-day phrases penalize hard — these signal the run found nothing.
  let emptyHits = 0;
  for (const pattern of EMPTY_DAY_PATTERNS) {
    if (pattern.test(report)) emptyHits++;
  }
  if (emptyHits > 0) {
    const penalty = emptyHits * 1.5;
    score -= penalty;
    reasons.push(`${emptyHits} empty-day phrases (-${penalty})`);
  }

  // 6. Very short reports → likely nothing happened.
  if (wordCount < 40) {
    score -= 2;
    reasons.push(`only ${wordCount} words (-2)`);
  } else if (wordCount > 300) {
    score += 1;
    reasons.push(`${wordCount} words long-form (+1)`);
  }

  // 7. "## All Links" section with at least one link bucket — a strong signal
  // that real artifacts were produced.
  const linksSection = /##\s+(?:[^\w\s]+\s+)?All Links/im.test(report);
  if (linksSection && linkCount >= 2) {
    score += 1;
    reasons.push(`artifact links section present (+1)`);
  }

  return {
    score: Math.max(0, Math.min(10, Number(score.toFixed(2)))),
    reasons,
    wordCount,
  };
}

export const DEFAULT_SIGNAL_THRESHOLD = 3;

export type QuietDayPolicy = 'suppress' | 'always_send';

export interface DeliveryDecision {
  deliver: boolean;
  reason: string;
  score: number;
}

/**
 * Decide whether to deliver a report given the score, the user's per-agent
 * policy, and whether the run queued pending actions awaiting approval.
 *
 * Hard rule: pending actions ALWAYS deliver — the user can't approve what
 * they don't see.
 */
export function decideDelivery(opts: {
  score: number;
  policy: QuietDayPolicy | null | undefined;
  hasPending: boolean;
  threshold?: number;
}): DeliveryDecision {
  const threshold = opts.threshold ?? DEFAULT_SIGNAL_THRESHOLD;
  if (opts.hasPending) {
    return { deliver: true, reason: 'pending_actions_override', score: opts.score };
  }
  if (opts.policy === 'always_send') {
    return { deliver: true, reason: 'policy_always_send', score: opts.score };
  }
  if (opts.score >= threshold) {
    return { deliver: true, reason: `score_${opts.score}_above_${threshold}`, score: opts.score };
  }
  return { deliver: false, reason: `score_${opts.score}_below_${threshold}_quiet_day`, score: opts.score };
}
