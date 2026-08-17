'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Search, Mail, Send, FileText, Calendar, Database,
  Globe, MessageSquare, Inbox, PenLine, Clock,
  LayoutTemplate, Terminal, CheckCircle2, AlertCircle,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentStep {
  id: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'tool_error' | 'approval' | 'respond' | 'message';
  tool?: string;
  label: string;
  context?: string;
  status: 'active' | 'completed' | 'error';
  summary?: string;
  startedAt: number;
  completedAt?: number;
  iteration: number;
  params?: any;
}

export interface AgentNarrative {
  iteration: number;
  text: string;
}

interface AgentExecutionTimelineProps {
  steps: AgentStep[];
  narratives?: AgentNarrative[];
  isActive: boolean;
  runId?: string;
  totalDurationMs?: number;
}

// ─── Tool icon map ───────────────────────────────────────────────────────────

const TOOL_ICON: Record<string, React.ReactNode> = {
  search_gmail:       <Search className="w-3.5 h-3.5" />,
  search_inbox:       <Search className="w-3.5 h-3.5" />,
  read_email:         <Mail className="w-3.5 h-3.5" />,
  get_sent_emails:    <Inbox className="w-3.5 h-3.5" />,
  draft_reply:        <PenLine className="w-3.5 h-3.5" />,
  save_draft:         <PenLine className="w-3.5 h-3.5" />,
  send_email:         <Send className="w-3.5 h-3.5" />,
  schedule_meeting:   <Calendar className="w-3.5 h-3.5" />,
  get_calendar_events:<Clock className="w-3.5 h-3.5" />,
  search_notion:      <Database className="w-3.5 h-3.5" />,
  open_canvas:        <LayoutTemplate className="w-3.5 h-3.5" />,
  web_search:         <Globe className="w-3.5 h-3.5" />,
  send_web_request:   <Globe className="w-3.5 h-3.5" />,
  send_slack_message: <MessageSquare className="w-3.5 h-3.5" />,
};

function getIcon(tool?: string): React.ReactNode {
  if (!tool) return <Terminal className="w-3.5 h-3.5" />;
  return TOOL_ICON[tool] ?? <Terminal className="w-3.5 h-3.5" />;
}

// ─── Single step pill ────────────────────────────────────────────────────────

function StepPill({ step }: { step: AgentStep }) {
  const isActive = step.status === 'active';
  const isError = step.status === 'error';

  const contextHint =
    step.context ||
    step.params?.query ||
    step.params?.subject ||
    step.params?.title ||
    step.params?.channel ||
    '';

  const durationSec =
    step.completedAt && step.startedAt
      ? ((step.completedAt - step.startedAt) / 1000).toFixed(1)
      : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        'flex items-center gap-2.5 px-3 py-1.5 rounded-xl border w-fit max-w-full transition-all',
        isActive
          ? 'bg-boult-elevated border-boult-divider shadow-[0_0_12px_rgba(255,255,255,0.04)]'
          : isError
          ? 'bg-red-500/[0.04] border-red-500/[0.12]'
          : 'bg-boult-elevated border-boult-border',
      )}
    >
      {/* Icon box */}
      <div
        className={cn(
          'flex-shrink-0 w-[22px] h-[22px] rounded-lg flex items-center justify-center border transition-all',
          isActive
            ? 'bg-boult-surface border-boult-divider text-boult-fg-secondary'
            : isError
            ? 'bg-red-500/10 border-red-500/20 text-red-400/70'
            : 'bg-boult-elevated border-boult-border text-boult-fg-muted',
        )}
      >
        {isActive ? (
          <motion.div
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
          >
            {getIcon(step.tool)}
          </motion.div>
        ) : isError ? (
          <AlertCircle className="w-3.5 h-3.5" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5" />
        )}
      </div>

      {/* Label + optional context hint */}
      <div className="flex-1 min-w-0">
        {isActive ? (
          <motion.span
            className="text-[13px] font-medium text-boult-fg-secondary tracking-tight block truncate"
            animate={{ opacity: [0.75, 1, 0.75] }}
            transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
          >
            {step.label}
          </motion.span>
        ) : (
          <span
            className={cn(
              'text-[13px] font-medium tracking-tight block truncate',
              isError ? 'text-red-400/60' : 'text-boult-fg-muted',
            )}
          >
            {step.label}
          </span>
        )}
        {contextHint && (
          <span
            className={cn(
              'block text-[11px] truncate mt-0.5',
              isActive ? 'text-boult-fg-muted italic' : 'text-boult-fg-muted italic',
            )}
          >
            {contextHint}
          </span>
        )}
      </div>

      {/* Duration */}
      {durationSec && !isActive && (
        <span className="flex-shrink-0 text-[10px] text-boult-fg-muted font-mono tabular-nums">
          {durationSec}s
        </span>
      )}

      {/* Active pulse dots */}
      {isActive && (
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
          {[0, 0.25, 0.5].map((delay, i) => (
            <motion.span
              key={i}
              className="w-1 h-1 rounded-full bg-boult-fg-tertiary"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.2, delay, ease: 'easeInOut' }}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Narrative paragraph between step groups ──────────────────────────────────

function NarrativeParagraph({ text }: { text: string }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="text-[13px] text-boult-fg-tertiary leading-[1.7] py-1"
    >
      {text}
    </motion.p>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AgentExecutionTimeline({
  steps,
  narratives = [],
  isActive,
}: AgentExecutionTimelineProps) {
  // Filter out bare thinking/status steps
  const visible = steps.filter(s => {
    if (s.type === 'thinking') {
      const l = s.label?.toLowerCase() || '';
      return !['reasoning...', 'processing...', 'thinking...', 'analysing your request...'].includes(l);
    }
    return true;
  });

  if (visible.length === 0) return null;

  // Group by iteration
  const iterMap = new Map<number, AgentStep[]>();
  for (const s of visible) {
    const arr = iterMap.get(s.iteration) ?? [];
    arr.push(s);
    iterMap.set(s.iteration, arr);
  }
  const iterations = [...iterMap.keys()].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-2.5 mt-2 mb-4">
      <AnimatePresence initial={false}>
        {iterations.map(iter => {
          const narrative = narratives.find(n => n.iteration === iter);
          const iterSteps = iterMap.get(iter) ?? [];

          return (
            <div key={iter} className="flex flex-col gap-1.5">
              {/* Narrative text before this iteration's pills */}
              {narrative?.text && (
                <NarrativeParagraph text={narrative.text} />
              )}

              {/* Pills for this iteration */}
              <div className="flex flex-col gap-1">
                {iterSteps.map((step, idx) => (
                  <StepPill key={step.id || `${iter}-${idx}`} step={step} />
                ))}
              </div>
            </div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default AgentExecutionTimeline;
