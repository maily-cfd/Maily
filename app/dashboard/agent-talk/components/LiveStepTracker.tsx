'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  ChevronDown, ChevronRight,
  Globe, LayoutTemplate, Terminal, AlertCircle, CheckCircle2,
} from 'lucide-react';
import type { AgentStep, AgentNarrative } from './AgentExecutionTimeline';
import { GmailIcon, NotionIcon, GoogleCalendarIcon, SlackIcon } from './BrandIcon';

// ─── Tool icon + label map ────────────────────────────────────────────────────
//
// For tools that hit a real third-party app, show the BRAND mark — that's
// what the user recognizes ("Boult is touching my Notion"). For utility
// tools (canvas, web fetch, etc.) we fall back to Lucide icons.

const TOOL_META: Record<string, { icon: React.ReactNode; verb: string }> = {
  // Gmail
  search_gmail:        { icon: <GmailIcon />, verb: 'Search Gmail' },
  search_inbox:        { icon: <GmailIcon />, verb: 'Search inbox' },
  read_email:          { icon: <GmailIcon />, verb: 'Read email' },
  get_sent_emails:     { icon: <GmailIcon />, verb: 'Fetch sent emails' },
  draft_reply:         { icon: <GmailIcon />, verb: 'Draft reply' },
  save_draft:          { icon: <GmailIcon />, verb: 'Save draft' },
  send_email:          { icon: <GmailIcon />, verb: 'Send email' },
  digest_newsletters:  { icon: <GmailIcon />, verb: 'Digest newsletters' },
  check_followups:     { icon: <GmailIcon />, verb: 'Check follow-ups' },
  gmail_unlimited_search: { icon: <GmailIcon />, verb: 'Scan Gmail' },
  gmail_bulk_read_threads: { icon: <GmailIcon />, verb: 'Read threads' },
  gmail_batch_draft_replies: { icon: <GmailIcon />, verb: 'Draft replies' },
  gmail_archive_thread: { icon: <GmailIcon />, verb: 'Archive thread' },
  gmail_auto_label_threads: { icon: <GmailIcon />, verb: 'Label threads' },
  // Google Calendar
  schedule_meeting:    { icon: <GoogleCalendarIcon />, verb: 'Schedule meeting' },
  get_calendar_events: { icon: <GoogleCalendarIcon />, verb: 'Check calendar' },
  calendar_get_availability: { icon: <GoogleCalendarIcon />, verb: 'Check availability' },
  calendar_unlimited_scan: { icon: <GoogleCalendarIcon />, verb: 'Scan calendar' },
  calendar_cancel_event: { icon: <GoogleCalendarIcon />, verb: 'Cancel event' },
  // Notion
  search_notion:       { icon: <NotionIcon />, verb: 'Search Notion' },
  create_notion_page:  { icon: <NotionIcon />, verb: 'Create Notion page' },
  notion_read_page:    { icon: <NotionIcon />, verb: 'Read Notion page' },
  notion_create_task:  { icon: <NotionIcon />, verb: 'Create Notion task' },
  fetch_notion_schema: { icon: <NotionIcon />, verb: 'Read Notion schema' },
  // Slack
  send_slack_message:  { icon: <SlackIcon />, verb: 'Send Slack message' },
  slack_send_dm:       { icon: <SlackIcon />, verb: 'Send Slack DM' },
  slack_find_user:     { icon: <SlackIcon />, verb: 'Find Slack user' },
  slack_get_channels:  { icon: <SlackIcon />, verb: 'List Slack channels' },
  // Utility — Lucide
  open_canvas:         { icon: <LayoutTemplate className="w-3.5 h-3.5" />, verb: 'Open canvas' },
  update_canvas:       { icon: <LayoutTemplate className="w-3.5 h-3.5" />, verb: 'Update canvas' },
  web_search:          { icon: <Globe className="w-3.5 h-3.5" />, verb: 'Web search' },
  web_search_instant:  { icon: <Globe className="w-3.5 h-3.5" />, verb: 'Web search' },
  send_web_request:    { icon: <Globe className="w-3.5 h-3.5" />, verb: 'Fetch web page' },
  read_browser_page:   { icon: <Globe className="w-3.5 h-3.5" />, verb: 'Read page' },
};

function getToolMeta(tool?: string) {
  if (!tool) return { icon: <Terminal className="w-3.5 h-3.5" />, verb: 'Run tool' };
  return TOOL_META[tool] ?? {
    icon: <Terminal className="w-3.5 h-3.5" />,
    verb: tool.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()),
  };
}

// ─── Result-summary extraction (cleaned for the inline result chip) ───────────

function cleanSummaryPreview(summary?: string): string | null {
  if (!summary) return null;
  const first = summary.split('\n').find(l => l.trim()) || '';
  const clean = first.replace(/\[[^\]]{0,80}\]/g, '').replace(/\s{2,}/g, ' ').trim();
  return clean.slice(0, 180) || null;
}

function deriveHeadline(narrative: string | undefined, steps: AgentStep[], fallbackIteration: number): string {
  if (narrative) {
    // First sentence, max 90 chars — keeps the collapsed view tight.
    const first = narrative.split(/(?<=[.!?])\s+/)[0] || narrative;
    const trimmed = first.replace(/\s+/g, ' ').trim();
    return trimmed.length > 90 ? trimmed.slice(0, 87) + '…' : trimmed;
  }
  // No narrative from the model — derive a REAL headline from what actually ran
  // ("Searched Gmail · Read email ×3") instead of the generic "Step N". Purely
  // deterministic from the executed tools, so it can never claim work that
  // didn't happen.
  const counts = new Map<string, number>();
  for (const s of steps) {
    if (s.type === 'thinking') continue;
    const verb = getToolMeta(s.tool).verb;
    counts.set(verb, (counts.get(verb) || 0) + 1);
  }
  const parts = Array.from(counts.entries()).slice(0, 3).map(([v, n]) => (n > 1 ? `${v} ×${n}` : v));
  return parts.length ? parts.join(' · ') : `Step ${fallbackIteration}`;
}

// Provenance chip for web tools — the real hostname the call touched
// (reddit.com, zapier.com…), parsed from the actual params. Deterministic.
function domainOf(params: any): string | null {
  const url = params?.url || params?.link;
  if (typeof url !== 'string' || !url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

// ─── Atomic rows: reasoning, tool, loader ─────────────────────────────────────

// The narration Boult weaves between steps — clean prose (Manus-style), no
// icon, reads as the agent thinking out loud before/after a batch of actions.
function ReasoningRow({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: [0.16, 1, 0.3, 1] }}
      className="py-1.5 text-[14px] leading-[1.7] text-black/70 dark:text-white/72 whitespace-pre-wrap"
    >
      {text}
    </motion.div>
  );
}

// Manus-style step chip: a compact pill with a tool icon + verb. Clicking a
// chip with a result expands the result inline below it. Active step pulses;
// errors flip to rose. This replaces the old full-width row for a tighter,
// scannable execution trace.
function ToolRow({ step, repeatCount = 1 }: { step: AgentStep; repeatCount?: number }) {
  const [open, setOpen] = useState(false);
  const isActive = step.status === 'active';
  const isError = step.status === 'error';
  const meta = getToolMeta(step.tool);
  const summaryPreview = !isActive && !isError ? cleanSummaryPreview(step.summary) : null;
  const hasResult = !!summaryPreview;

  // Narrated Execution Protocol: the primary text of a step is the model's own
  // first-person line when present ("Scanning your inbox for unanswered
  // investor threads"); a short param fragment renders as `Verb — "fragment"`;
  // only a step with no context at all falls back to the bare verb. This is
  // where the specificity the loop already computes finally reaches the pixels.
  const ctx = (step.context || '').trim();
  // A collapsed run shows the VERB and the count, never one call's context —
  // "Read email — 'Re: proposal' ×7" would be a lie about the other six.
  const line = repeatCount > 1
    ? `${meta.verb} ×${repeatCount}`
    : ctx.length >= 28
      ? ctx
      : ctx
        ? `${meta.verb} — “${ctx.length > 60 ? ctx.slice(0, 57) + '…' : ctx}”`
        : meta.verb;
  const domain = domainOf(step.params);

  return (
    <motion.div
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="py-[3px]"
    >
      <button
        type="button"
        onClick={() => hasResult && setOpen(v => !v)}
        className={cn(
          'inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg max-w-full text-left',
          'border transition-colors',
          isActive
            ? 'border-black/[0.08] dark:border-white/[0.10] bg-black/[0.03] dark:bg-white/[0.04]'
            : isError
              ? 'border-black/[0.16] dark:border-white/[0.18] bg-black/[0.04] dark:bg-white/[0.05]'
              : 'border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.025]',
          hasResult && 'hover:border-black/[0.12] dark:hover:border-white/[0.14] cursor-pointer',
        )}
      >
        <span className={cn(
          'flex-shrink-0 flex items-center',
          isActive
            ? 'text-black/60 dark:text-white/60'
            : isError
              ? 'text-black/70 dark:text-white/70'
              : 'text-black/45 dark:text-white/40',
        )}>
          {isError ? <AlertCircle className="w-3.5 h-3.5" /> : meta.icon}
        </span>
        <span className={cn(
          'text-[13px] tracking-tight truncate',
          isActive
            ? 'text-black/80 dark:text-white/80 font-medium'
            : isError
              ? 'text-black/75 dark:text-zinc-200'
              : 'text-black/60 dark:text-white/55',
        )}>
          {isActive ? (
            <motion.span
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
            >
              {line}
            </motion.span>
          ) : line}
        </span>
        {domain && (
          <span className="flex-shrink-0 text-[11px] text-black/35 dark:text-white/30 font-medium">
            {domain}
          </span>
        )}
        {hasResult && (
          open
            ? <ChevronDown className="w-3 h-3 flex-shrink-0 text-black/30 dark:text-white/30" />
            : <ChevronRight className="w-3 h-3 flex-shrink-0 text-black/25 dark:text-white/25" />
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && hasResult && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 ml-1 px-2.5 py-2 rounded-md bg-black/[0.025] dark:bg-white/[0.035] border border-black/[0.05] dark:border-white/[0.05] text-[12px] text-black/55 dark:text-white/50 leading-[1.55] whitespace-pre-wrap">
              {summaryPreview}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Per-iteration block ──────────────────────────────────────────────────────

interface IterationBlock {
  iteration: number;
  steps: AgentStep[];
  narrative?: string;
  isActive: boolean;
}

function IterationGroup({ block }: { block: IterationBlock }) {
  // Active iteration always expanded; completed ones default collapsed
  // (let user expand any of them with a click).
  const [open, setOpen] = useState(block.isActive);
  const headline = useMemo(
    () => deriveHeadline(block.narrative, block.steps, block.iteration),
    [block.narrative, block.steps, block.iteration],
  );

  const showCheckIcon = !block.isActive;

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'w-full flex items-center gap-1.5 text-left py-1.5',
          'text-[13px] tracking-tight',
          open
            ? 'text-black/50 dark:text-white/45'
            : 'text-black/40 dark:text-white/35 hover:text-black/60 dark:hover:text-white/55',
          'transition-colors',
        )}
      >
        {open
          ? <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-70" strokeWidth={2} />
          : <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-70" strokeWidth={2} />}
        {showCheckIcon && (
          <CheckCircle2 className="w-3 h-3 flex-shrink-0 text-black/30 dark:text-white/30" strokeWidth={1.75} />
        )}
        <span className="truncate">{headline}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-[5px] pl-4 border-l border-black/[0.08] dark:border-white/[0.08]">
              {block.narrative && (
                <ReasoningRow text={block.narrative} />
              )}
              {/* Consecutive calls to the SAME tool collapse into one counted
                  row: "Search Gmail ×7" instead of seven identical lines. A
                  run that read 26 emails rendered 26 rows the user had to
                  scroll past, which buried the one thing they wanted — what it
                  concluded. The count is the only part that carries meaning at
                  this altitude; the individual calls are still there when a row
                  is expanded. */}
              <div className="flex flex-col items-start gap-0.5 mt-0.5">
                {collapseRuns(block.steps).map((run, i) => (
                  <ToolRow key={run.head.id || i} step={run.head} repeatCount={run.count} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Fold consecutive steps that call the same tool into a single run.
 *
 * Only ADJACENT calls collapse — search → read → search stays three rows,
 * because that genuinely is three different moves. Collapsing across the whole
 * block would hide the shape of the work and make an agent that alternated
 * between two tools look like it did two things.
 */
function collapseRuns(steps: AgentStep[]): Array<{ head: AgentStep; count: number }> {
  const runs: Array<{ head: AgentStep; count: number }> = [];
  for (const step of steps) {
    const last = runs[runs.length - 1];
    // Never merge into a run whose head is still running or failed — a spinner
    // or an error must stay its own row so its state is unambiguous.
    if (
      last &&
      last.head.tool === step.tool &&
      last.head.status === 'completed' &&
      step.status === 'completed'
    ) {
      last.count += 1;
    } else {
      runs.push({ head: step, count: 1 });
    }
  }
  return runs;
}

// ─── Group steps by iteration, attach narratives ──────────────────────────────

function buildBlocks(steps: AgentStep[], narratives: AgentNarrative[], isActive: boolean): IterationBlock[] {
  // Thinking-type steps never render inside the box — the live thinking
  // indicator (shimmer label + thought line) already lives OUTSIDE the box
  // in AgentThinkingSection. Rendering it here too showed the indicator
  // twice. The box is for real tool work only.
  const visible = steps.filter(s => s.type !== 'thinking');

  const byIteration = new Map<number, AgentStep[]>();
  const iterationOrder: number[] = [];
  for (const step of visible) {
    if (!byIteration.has(step.iteration)) {
      byIteration.set(step.iteration, []);
      iterationOrder.push(step.iteration);
    }
    byIteration.get(step.iteration)!.push(step);
  }

  const lastIteration = iterationOrder[iterationOrder.length - 1];
  return iterationOrder.map(iter => {
    const blockSteps = byIteration.get(iter)!;
    const narrative = narratives.find(n => n.iteration === iter)?.text;
    // An iteration is "active" only if the overall run is active AND it's
    // the latest iteration AND at least one of its steps is still active.
    const blockActive = isActive
      && iter === lastIteration
      && blockSteps.some(s => s.status === 'active');
    return { iteration: iter, steps: blockSteps, narrative, isActive: blockActive };
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function LiveStepTracker({ steps, narratives = [], isActive }: {
  steps: AgentStep[];
  narratives?: AgentNarrative[];
  isActive: boolean;
}) {
  const blocks = useMemo(() => buildBlocks(steps, narratives, isActive), [steps, narratives, isActive]);
  if (blocks.length === 0) return null;

  return (
    <div className="mt-0.5 mb-0">
      <AnimatePresence initial={false}>
        {blocks.map((block) => (
          <IterationGroup key={block.iteration} block={block} />
        ))}
      </AnimatePresence>
    </div>
  );
}

export default LiveStepTracker;
