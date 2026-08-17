import { callLLM, getText } from '../engine';
import type { BoultVA } from '../tool-integration-map';
import type {
  ArtifactBuckets,
  CommitteeReport,
  VARunResult,
} from './types';

const VA_LABELS: Record<BoultVA, string> = {
  inbox: 'Inbox',
  calendar: 'Calendar',
  crm: 'CRM',
  comms: 'Comms',
  research: 'Research',
};

const VA_ORDER: BoultVA[] = ['inbox', 'calendar', 'crm', 'comms', 'research'];

interface ParsedSections {
  revenue: string[];
  client: string[];
  operations: string[];
  needsAttention: string[];
  crossVA: string[];
  links: string;
  raw: string;
}

const SECTION_RE = /^##\s+(Revenue|Client|Operations|Needs Attention|Cross-VA|Links)\s*$/im;

function parseVASections(body: string): ParsedSections {
  const empty: ParsedSections = { revenue: [], client: [], operations: [], needsAttention: [], crossVA: [], links: '', raw: body };
  if (!body || !body.trim()) return empty;

  if (/^\s*No work in your lane this run\.\s*$/im.test(body)) return empty;

  const out: ParsedSections = { ...empty };
  const lines = body.split('\n');
  let currentKey: keyof Omit<ParsedSections, 'raw' | 'links'> | 'links' | null = null;
  let linksBuf: string[] = [];

  for (const rawLine of lines) {
    const m = rawLine.match(SECTION_RE);
    if (m) {
      const label = m[1].toLowerCase();
      if (label === 'revenue') currentKey = 'revenue';
      else if (label === 'client') currentKey = 'client';
      else if (label === 'operations') currentKey = 'operations';
      else if (label === 'needs attention') currentKey = 'needsAttention';
      else if (label === 'cross-va') currentKey = 'crossVA';
      else if (label === 'links') currentKey = 'links';
      continue;
    }
    if (!currentKey) continue;
    if (currentKey === 'links') {
      linksBuf.push(rawLine);
      continue;
    }
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) {
      const stripped = trimmed.replace(/^[-*•]\s*/, '').trim();
      if (looksLikeRealContent(stripped)) out[currentKey].push(stripped);
    } else if (out[currentKey].length > 0) {
      out[currentKey][out[currentKey].length - 1] += ' ' + trimmed;
    } else if (looksLikeRealContent(trimmed)) {
      out[currentKey].push(trimmed);
    }
  }
  out.links = linksBuf.join('\n').trim();
  return out;
}

function looksLikeRealContent(s: string): boolean {
  const t = s.trim();
  if (t.length < 6) return false;
  if (/^(none|nothing|n\/a|tbd|no (items|content|updates|activity|signal|results))\.?$/i.test(t)) return false;
  if (/^(no|nothing) .{0,40} (to report|found|noted|flagged|today|this run)\.?$/i.test(t)) return false;
  if (/^_?\(?(empty|placeholder|tbd)\)?_?$/i.test(t)) return false;
  return true;
}

function mergeArtifacts(results: VARunResult[]): ArtifactBuckets {
  const merged: ArtifactBuckets = {};
  for (const r of results) {
    for (const [k, arr] of Object.entries(r.artifacts) as Array<[keyof ArtifactBuckets, ArtifactBuckets[keyof ArtifactBuckets]]>) {
      if (!arr?.length) continue;
      const list = merged[k] ?? (merged[k] = []);
      list.push(...arr);
    }
  }
  return merged;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function mergedSection(
  title: string,
  perVAItems: Array<{ va: BoultVA; items: string[] }>,
): string {
  const lines: string[] = [];
  for (const { items } of perVAItems) {
    for (const item of items) {
      const cleaned = item.trim();
      if (!looksLikeRealContent(cleaned)) continue;
      lines.push(`- ${cleaned}`);
    }
  }
  if (lines.length === 0) return '';
  return [`## ${title}`, '', ...lines, ''].join('\n');
}

// "Next Actions" — what the user should do now, in priority order, each a
// clickable artifact link: "→ Review the draft to Priya: <link>". Replaces the
// old grouped "All Links" dump so the user gets directed actions, not a
// reference list. Priority: drafts to review/send first, then meetings to
// confirm, then logged records, then Slack.
function nextActionsSection(
  artifacts: ArtifactBuckets,
  perVALinks: Array<{ va: BoultVA; links: string }>,
  needsAttention: string[],
): string {
  const actions: string[] = [];

  for (const item of artifacts.gmail ?? []) actions.push(`→ Review & send: [${item.label}](${item.url})`);
  for (const item of artifacts.calendar ?? []) actions.push(`→ Confirm meeting: [${item.label}](${item.url})`);
  for (const item of artifacts.notion ?? []) actions.push(`→ Check the log: [${item.label}](${item.url})`);
  for (const item of artifacts.slack ?? []) actions.push(`→ View message: [${item.label}](${item.url})`);

  // Decisions/requests the agent surfaced but couldn't finish — these MUST show
  // even when there's no artifact link (a meeting request with no draft is still
  // something the user needs to see). Dedup against items already covered above.
  const haveLinks = actions.length > 0;
  for (const item of needsAttention) {
    const t = item.trim();
    if (!looksLikeRealContent(t)) continue;
    actions.push(t.startsWith('→') || t.startsWith('-') ? t.replace(/^-\s*/, '→ ') : `→ ${t}`);
  }

  // Per-VA freeform link blocks (raw markdown the VA emitted) — append as-is so
  // we never drop a link the structured buckets missed.
  const perVABlocks = perVALinks.filter(p => p.links.trim()).map(p => p.links.trim());

  if (!actions.length && !perVABlocks.length) {
    return ['## What needs you', '', 'Nothing right now — you’re all caught up.', ''].join('\n');
  }

  const lines: string[] = ['## What needs you', ''];
  lines.push(...actions);
  if (perVABlocks.length) {
    if (haveLinks || actions.length) lines.push('');
    lines.push(...perVABlocks);
  }
  lines.push('');
  return lines.join('\n');
}

async function synthesizeHeadline(
  results: VARunResult[],
  agentName: string,
  parsed: Map<BoultVA, ParsedSections>,
): Promise<string> {
  const concreteBullets: string[] = [];
  for (const [, sections] of parsed) {
    for (const key of ['needsAttention', 'revenue', 'client', 'operations', 'crossVA'] as const) {
      for (const item of sections[key]) {
        const t = item.trim();
        if (t.length < 12) continue;
        if (/^(none|nothing|n\/a|tbd|empty)/i.test(t)) continue;
        concreteBullets.push(t.slice(0, 200));
      }
    }
  }

  if (concreteBullets.length === 0) return '';

  const topBullets = concreteBullets.slice(0, 6);
  try {
    const res = await callLLM(
      [
        {
          role: 'system',
          content:
            'You write ONE opening sentence for an executive briefing. The reader is the founder; they only have 5 seconds before scrolling. ' +
            'Input: the actual items the agent surfaced this run, as bullet text. ' +
            'Output: a single past-tense first-person sentence (≤220 chars) that NAMES the 1-2 most specific real items — recipients, companies, topics, dollar amounts. ' +
            'RULES:\n' +
            '- Never read out raw counts ("logged 1 revenue, 1 client") — those sound like mock data. Always name the actual thing.\n' +
            '- Never invent specifics not in the input.\n' +
            '- No filler ("successfully", "pleased to", "I have processed"). No emojis. No closing question.\n' +
            '- Start with a past-tense verb ("Surfaced", "Drafted", "Flagged", "Logged", "Caught").\n' +
            '- End with a period.\n\n' +
            'GOOD: "Surfaced Priya\'s SOW redlines for sign-off and flagged the stalled Acme thread."\n' +
            'BAD: "I logged revenue 1, secured 1 client, completed 1 ops task, flagged 1 need-attention item."',
        },
        {
          role: 'user',
          content: `Agent: ${agentName}\n\nReal items this run:\n${topBullets.map(b => `- ${b}`).join('\n')}\n\nWrite the opening sentence.`,
        },
      ],
      [],
      { maxTokens: 120, temperature: 0.2 },
    );
    const raw = getText(res.content).trim();
    const oneLine = raw.split(/\n+/)[0].replace(/^[-*•]\s*/, '').trim();
    if (
      oneLine.length >= 20
      && oneLine.length <= 280
      && !/\b(revenue|client|ops|operations|needs[- ]attention)\s+\d+/i.test(oneLine)
      && !/\bexecuted\s+\d+\s+\w+\s+tool\s+calls?/i.test(oneLine)
    ) {
      return oneLine;
    }
  } catch { /* fall through */ }

  const top = topBullets[0]?.split(/[.!?]/)[0]?.trim().slice(0, 180);
  return top ? `Surfaced: ${top}.` : '';
}

export async function buildCommitteeReport(
  results: VARunResult[],
  agent: { name?: string },
): Promise<CommitteeReport> {
  const ordered = VA_ORDER
    .map(va => results.find(r => r.va === va))
    .filter((r): r is VARunResult => r !== undefined);

  const parsed = new Map<BoultVA, ParsedSections>();
  for (const r of ordered) parsed.set(r.va, parseVASections(r.body));

  const collect = (key: 'revenue' | 'client' | 'operations' | 'needsAttention' | 'crossVA') =>
    ordered.map(r => ({ va: r.va, items: parsed.get(r.va)?.[key] ?? [] }));

  const totalToolCalls = ordered.reduce((sum, r) => sum + r.toolCalls, 0);
  const artifactLinks = mergeArtifacts(ordered);
  const agentName = agent.name || 'Boult';

  const headline = await synthesizeHeadline(ordered, agentName, parsed);

  // needsAttention is surfaced in "What needs you" (below), not as a body
  // section — so the most important items are never buried.
  const needsAttentionItems = collect('needsAttention').flatMap(g => g.items);
  const contentSections = [
    mergedSection('Revenue & opportunities', collect('revenue')),
    mergedSection('Client updates', collect('client')),
    mergedSection('Operations', collect('operations')),
    mergedSection('Worth noting', collect('crossVA')),
  ].filter(Boolean);

  // Honest per-lane "what happened" — NEVER claims success for failed work.
  // (The old version said "completed N actions" even when those tools failed,
  // and trusted "inbox clear" summaries written despite a failed search.)
  const whatHappenedSection = (): string => {
    const lines: string[] = [];
    for (const r of ordered) {
      if (r.status === 'empty') continue; // nothing in this lane — keep quiet
      const failed = new Set(r.failedTools ?? []);
      const successfulActions = (r.toolNames ?? []).filter(n => !failed.has(n)).length;
      const hadFailure = (r.failedTools?.length ?? 0) > 0 || r.status === 'error' || r.status === 'timeout';
      const summary = (r.summary || '').trim();
      const claimsNothing = /\b(clear|nothing|no\b.*(found|triage|repl|action))/i.test(summary);
      // Reject leaky filler that should never reach the user: tool-call counts,
      // "let me know if…", "to summarize", "done —", etc.
      const isFiller =
        /\b(let me know|if you('?| wa)nt|to summari[sz]e|tool calls?|\d+\s+calls? ran|^done\b|i can (also )?summari)/i.test(summary);
      const usefulSummary =
        summary &&
        !isFiller &&
        !/^no work in your lane/i.test(summary) &&
        !new RegExp(`^${r.va} VA`, 'i').test(summary) &&
        summary.length >= 12 &&
        !(hadFailure && claimsNothing); // don't trust "all clear" if a step failed

      if (usefulSummary) {
        lines.push(`- **${VA_LABELS[r.va]}** — ${summary}`);
      } else if (hadFailure && successfulActions === 0) {
        lines.push(`- **${VA_LABELS[r.va]}** — hit a snag this run; it’ll retry next time.`);
      } else if (successfulActions > 0) {
        lines.push(`- **${VA_LABELS[r.va]}** — handled ${successfulActions} ${successfulActions === 1 ? 'item' : 'items'}.`);
      }
    }
    if (!lines.length) lines.push('- Nothing needed doing — you were already caught up.');
    return ['## What happened', '', ...lines, ''].join('\n');
  };

  // Close with an offer, not a full stop — the vision's "want me to handle it?"
  // move. Context-aware so it's specific: holding drafts → offer to send;
  // open escalations → offer to take them on; otherwise offer to keep watching.
  // Answerable with a one-word reply. Mirrors REPORT_FORMAT_SUFFIX's
  // "Want me to handle it?" so both runtimes close the same warm way.
  const offerToAct = (): string => {
    const draftCount = artifactLinks.gmail?.length ?? 0;
    const openItems = needsAttentionItems.filter(looksLikeRealContent).length;
    let line: string;
    if (draftCount > 0) {
      line = draftCount === 1
        ? 'Say the word and I’ll send that draft for you.'
        : `Say the word and I’ll send all ${draftCount} drafts.`;
    } else if (openItems > 0) {
      line = 'Want me to take any of these off your plate? Just reply.';
    } else {
      line = 'Nothing needs you right now — want me to keep watching and ping you the moment something does?';
    }
    return ['## Want me to handle it?', '', line, ''].join('\n');
  };

  // One calm, human footer line instead of per-lane tool-call jargon.
  const humanFooter = (): string => {
    const totalMs = Math.max(0, ...ordered.map(r => r.durationMs));
    const failedSteps = ordered.reduce((n, r) => n + (r.failedTools?.length ?? 0), 0);
    const actions = ordered.reduce((n, r) => {
      const failed = new Set(r.failedTools ?? []);
      return n + (r.toolNames ?? []).filter(t => !failed.has(t)).length;
    }, 0);
    const when = new Date().toUTCString().replace(/ GMT$/, ' UTC');
    const bits = [when, formatDuration(totalMs)];
    if (actions > 0) bits.push(`${actions} ${actions === 1 ? 'action' : 'actions'} taken`);
    if (failedSteps > 0) bits.push(`${failedSteps} step${failedSteps === 1 ? '' : 's'} will retry next run`);
    return `_${bits.join(' · ')}_`;
  };

  // Apple-style: a calm headline, the agent name, what happened, the highlights
  // that exist, what needs the user, and a single quiet footer. No tool jargon,
  // no per-VA "ran · N tool calls" noise in the body.
  const sections: string[] = [
    headline,
    '',
    `# ${agentName}`,
    '',
    whatHappenedSection(),
    ...contentSections,
    nextActionsSection(artifactLinks, ordered.map(r => ({ va: r.va, links: parsed.get(r.va)?.links ?? '' })), needsAttentionItems),
    offerToAct(),
    '---',
    '',
    humanFooter(),
  ].filter(Boolean);

  return {
    report: sections.join('\n'),
    toolCalls: totalToolCalls,
    artifactLinks,
    vaResults: ordered,
    modeUsed: 'committee',
  };
}
