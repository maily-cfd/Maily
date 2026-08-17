'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ChevronDown, ChevronRight,
  Terminal, FileText, Search, BrainCircuit, Pencil, Code2, Sparkles,
  CheckCircle2, Loader2, AlertTriangle, Clock, Globe, Database,
  ListTodo, Mail, Calendar, Zap, X, Link2, ExternalLink, Download,
  MoreHorizontal,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES (unchanged — kept for backward compat)
// ─────────────────────────────────────────────────────────────────────────────

export type ThinkingStep = {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'error' | 'blocked_approval';
  type: 'think' | 'search' | 'read' | 'analyze' | 'draft' | 'execute' | 'code';
  detail?: string;
};

export type ThinkingBlock = {
  id: string;
  title: string;
  status: 'pending' | 'active' | 'completed';
  initialContext?: string;
  steps: ThinkingStep[];
  interimConclusion?: string;
  nextActionContext?: string;
  isPreviewable?: boolean;
  previewData?: any;
};

export type SearchSession = {
  sessionId: string;
  query: string;
  sourceType: 'email' | 'notes' | 'web' | 'calendar' | 'notion' | 'tasks';
  status: 'queued' | 'searching' | 'source_processing' | 'complete';
  resultCount?: number;
  selectedSnippets?: { subject?: string; from?: string; date?: string; title?: string }[];
};

export type TodoGraphStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked_approval';

export type TodoGraphItem = {
  todoId: string;
  title: string;
  description?: string;
  status: TodoGraphStatus;
  actionType: string;
  sortOrder: number;
  dependsOn: string[];
  approvalMode: 'auto' | 'manual';
  attemptCount: number;
  resultPayload?: any;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
};

export type TodoGraph = {
  planId: string;
  title: string;
  objective: string;
  status: 'draft' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
  todos: TodoGraphItem[];
  progress: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    ready: number;
  };
};

interface ThinkingLayerProps {
  blocks: ThinkingBlock[];
  isVisible: boolean;
  currentThought?: string;
  isGenerating?: boolean;
  onStop?: () => void;
  searchSessions?: SearchSession[];
  todoGraph?: TodoGraph | null;
  showTodoGraph?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// ConnectorRequiredItem — one row inside the panel
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectorRequiredEntry {
  id: string;
  name: string;
  description: string;
  icon?: string;         // URL to icon image
  color?: string;        // brand color hex
  connected?: boolean;
}

export interface ConnectorRequiredPanelProps {
  connectors: ConnectorRequiredEntry[];
  onConnect: (id: string) => void;
  onSkip: () => void;
  onApply: () => void;
  onViewAll?: () => void;
  waitingForUser?: boolean;
}

/**
 * ConnectorRequiredPanel
 * Shown inline when Boult needs one or more integrations to continue.
 * Modeled after the Manus "Recommended for this task" UI.
 */
export function ConnectorRequiredPanel({
  connectors,
  onConnect,
  onSkip,
  onApply,
  onViewAll,
  waitingForUser = true,
}: ConnectorRequiredPanelProps) {
  return (
    <div className="w-full my-4">
      {/* Card */}
      <div className="boult-glass-card rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-boult-border">
          <p className="text-[13px] font-bold text-boult-fg uppercase tracking-widest">
            Recommended for this task
          </p>
        </div>

        {/* Connector rows */}
        <div className="divide-y divide-boult-border">
          {connectors.map((c) => (
            <div key={c.id} className="flex items-center gap-4 px-5 py-4">
              {/* Icon */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-boult-raised border border-boult-divider"
                style={c.color ? { backgroundColor: c.color + '18', borderColor: c.color + '40' } : {}}
              >
                {c.icon ? (
                  <img src={c.icon} alt={c.name} className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <Link2 className="w-4 h-4 text-boult-fg-tertiary" />
                )}
              </div>

              {/* Name + status + description */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[14px] font-bold text-boult-fg">{c.name}</span>
                  {!c.connected && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-boult-raised border border-boult-divider text-boult-fg-tertiary">
                      Not connected
                    </span>
                  )}
                  {c.connected && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-boult-raised border border-boult-divider text-boult-fg">
                      Connected
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-boult-fg-tertiary leading-snug line-clamp-1">{c.description}</p>
              </div>

              {/* Connect button */}
              {!c.connected && (
                <button
                  onClick={() => onConnect(c.id)}
                  className="flex-shrink-0 px-4 py-2 bg-boult-fg text-boult-fg-inverse rounded-xl text-[13px] font-bold hover:opacity-90 active:scale-95 transition-all"
                >
                  Connect
                </button>
              )}
              {c.connected && (
                <CheckCircle2 className="w-5 h-5 text-boult-fg-secondary flex-shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-boult-border flex items-center justify-between gap-4">
          {onViewAll ? (
            <button
              onClick={onViewAll}
              className="text-[13px] text-boult-fg-tertiary hover:text-boult-fg transition-colors flex items-center gap-1.5"
            >
              Looking for something else?{' '}
              <span className="text-boult-fg font-semibold underline underline-offset-2">View all connectors</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          ) : <span />}

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onSkip}
              className="px-4 py-2 rounded-xl text-[13px] font-semibold text-boult-fg-secondary bg-boult-raised hover:bg-boult-divider border border-boult-divider transition-all"
            >
              Skip
            </button>
            <button
              onClick={onApply}
              className="px-4 py-2 rounded-xl text-[13px] font-bold text-boult-fg-inverse bg-boult-fg hover:opacity-90 active:scale-95 transition-all"
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* "Waiting for reply" indicator */}
      {waitingForUser && (
        <div className="flex items-center gap-2.5 mt-3 px-1">
          <div className="relative w-4 h-4 flex-shrink-0">
            <div className="w-4 h-4 rounded-full border-2 border-boult-fg-tertiary border-t-boult-fg animate-spin" />
          </div>
          <p className="text-[13px] font-semibold text-boult-fg-secondary">
            Boult will continue working after your reply
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getStepIcon(type: string, size = 'w-3.5 h-3.5') {
  switch (type) {
    case 'search':  return <Search className={size} />;
    case 'read':    return <FileText className={size} />;
    case 'analyze': return <BrainCircuit className={size} />;
    case 'think':   return <BrainCircuit className={size} />;
    case 'draft':   return <Pencil className={size} />;
    case 'execute': return <Terminal className={size} />;
    case 'code':    return <Code2 className={size} />;
    default:        return <Terminal className={size} />;
  }
}

/** Elapsed-time ticker shown on active steps */
function ElapsedTimer({ startedAt }: { startedAt?: string }) {
  const [elapsed, setElapsed] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    const start = startedAt ? new Date(startedAt).getTime() : Date.now();
    ref.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(ref.current);
  }, [startedAt]);

  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span className="text-[11px] font-mono text-boult-fg-muted">
      {m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StepRow — one ThinkingBlock rendered as a Manus-style accordion step
// ─────────────────────────────────────────────────────────────────────────────

function StepRow({
  block,
  index,
  total,
}: {
  block: ThinkingBlock;
  index: number;
  total: number;
}) {
  const [open, setOpen] = useState(block.status !== 'completed');
  const isActive = block.status === 'active';
  const isDone = block.status === 'completed';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={cn(
        'rounded-xl border overflow-hidden transition-colors',
        isActive
          ? 'bg-boult-surface border-boult-divider'
          : isDone
          ? 'bg-boult-surface/50 border-boult-border'
          : 'bg-boult-elevated border-boult-border',
      )}
    >
      {/* Step header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        {/* Status icon */}
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          {isDone ? (
            <CheckCircle2 className="w-4.5 h-4.5 text-boult-fg-secondary" />
          ) : isActive ? (
            <Loader2 className="w-4 h-4 text-boult-fg animate-spin" />
          ) : (
            <div className="w-4 h-4 rounded-full border-2 border-boult-divider flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-boult-divider" />
            </div>
          )}
        </div>

        {/* Label */}
        <span
          className={cn(
            'flex-1 text-[14px] font-semibold leading-snug',
            isDone ? 'text-boult-fg-tertiary' : 'text-boult-fg',
          )}
        >
          {block.title}
        </span>

        {/* Right side: counter + elapsed + chevron */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {isActive && <ElapsedTimer />}
          <span className="text-[12px] font-medium text-boult-fg-muted">
            {index + 1}/{total}
          </span>
          {open ? (
            <ChevronDown className="w-4 h-4 text-boult-fg-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-boult-fg-muted" />
          )}
        </div>
      </button>

      {/* Sub-steps */}
      <AnimatePresence>
        {open && (block.steps.length > 0 || block.initialContext || block.interimConclusion) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-boult-border"
          >
            <div className="px-4 py-3 space-y-0.5">
              {block.initialContext && (
                <p className="text-[13px] text-boult-fg-tertiary leading-relaxed mb-3 pl-1">
                  {block.initialContext}
                </p>
              )}

              {block.steps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    'flex items-center gap-3 py-1.5 px-2 rounded-lg',
                    step.status === 'active' ? 'bg-boult-raised/50' : '',
                  )}
                >
                  {/* Sub-step status dot */}
                  <div className="flex-shrink-0">
                    {step.status === 'completed' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-boult-fg-muted" />
                    ) : step.status === 'active' ? (
                      <Loader2 className="w-3.5 h-3.5 text-boult-fg-secondary animate-spin" />
                    ) : step.status === 'error' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-sm border border-boult-divider flex items-center justify-center bg-boult-raised/50">
                        <div className="text-boult-fg-muted flex items-center justify-center">
                          {getStepIcon(step.type, 'w-2.5 h-2.5')}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Tool-type icon pill */}
                  {(step.status === 'completed' || step.status === 'active') && (
                    <div
                      className={cn(
                        'w-5 h-5 rounded flex items-center justify-center flex-shrink-0',
                        step.status === 'completed'
                          ? 'bg-boult-raised text-boult-fg-muted'
                          : 'bg-boult-divider text-boult-fg',
                      )}
                    >
                      {getStepIcon(step.type, 'w-3 h-3')}
                    </div>
                  )}

                  <span
                    className={cn(
                      'text-[13px] font-medium leading-snug flex-1',
                      step.status === 'completed'
                        ? 'text-boult-fg-muted'
                        : step.status === 'active'
                        ? 'text-boult-fg'
                        : 'text-boult-fg-muted',
                    )}
                  >
                    {step.label}
                  </span>

                  {step.status === 'active' && (
                    <span className="text-[11px] text-boult-fg-muted italic flex-shrink-0">Running…</span>
                  )}
                </div>
              ))}

              {(block.interimConclusion || block.nextActionContext) && (
                <p className="text-[13px] text-boult-fg-tertiary leading-relaxed mt-3 pl-1">
                  {block.interimConclusion}{block.nextActionContext ? ' ' + block.nextActionContext : ''}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TodoItemRow — one TodoGraphItem in Manus-accordion style
// ─────────────────────────────────────────────────────────────────────────────

function TodoItemRow({
  todo,
  index,
  total,
}: {
  todo: TodoGraphItem;
  index: number;
  total: number;
}) {
  const [open, setOpen] = useState(todo.status === 'running');
  const isRunning = todo.status === 'running';
  const isDone = todo.status === 'completed';
  const isFailed = todo.status === 'failed';
  const isBlocked = todo.status === 'blocked_approval';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={cn(
        'rounded-xl border overflow-hidden transition-colors',
        isRunning
          ? 'bg-boult-surface border-boult-divider'
          : isDone
          ? 'bg-boult-surface/50 border-boult-border'
          : isFailed
          ? 'bg-red-500/5 border-red-500/20'
          : isBlocked
          ? 'bg-boult-surface/60 border-boult-divider'
          : 'bg-boult-elevated border-boult-border',
      )}
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        {/* Status */}
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          {isDone ? (
            <CheckCircle2 className="w-4 h-4 text-boult-fg-secondary" />
          ) : isRunning ? (
            <Loader2 className="w-4 h-4 text-boult-fg animate-spin" />
          ) : isFailed ? (
            <AlertTriangle className="w-4 h-4 text-red-400" />
          ) : isBlocked ? (
            <div className="w-4 h-4 rounded-full border-2 border-boult-fg-tertiary" />
          ) : (
            <div className="w-4 h-4 rounded-full border-2 border-boult-divider flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-boult-divider" />
            </div>
          )}
        </div>

        {/* Title */}
        <span
          className={cn(
            'flex-1 text-[14px] font-semibold leading-snug',
            isDone ? 'text-boult-fg-tertiary' : isFailed ? 'text-red-400' : 'text-boult-fg',
          )}
        >
          {todo.title}
        </span>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          {isRunning && <ElapsedTimer startedAt={todo.startedAt} />}
          <span className="text-[12px] font-medium text-boult-fg-muted">{index + 1}/{total}</span>
          {open ? (
            <ChevronDown className="w-4 h-4 text-boult-fg-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-boult-fg-muted" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {open && (todo.description || todo.errorMessage || todo.resultPayload) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-boult-border"
          >
            <div className="px-4 py-3 space-y-2">
              {todo.description && (
                <p className="text-[13px] text-boult-fg-tertiary leading-relaxed">{todo.description}</p>
              )}
              {todo.errorMessage && (
                <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[12px] text-red-400">{todo.errorMessage}</p>
                </div>
              )}
              {todo.resultPayload && isDone && (
                <p className="text-[12px] text-boult-fg-tertiary">
                  {todo.resultPayload.message || 'Completed successfully.'}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TodoGraphPanel — wraps the full todo list with header & progress bar
// ─────────────────────────────────────────────────────────────────────────────

function TodoGraphPanel({ graph }: { graph: TodoGraph }) {
  const progress =
    graph.progress.total > 0
      ? (graph.progress.completed / graph.progress.total) * 100
      : 0;
  const isExecuting = graph.status === 'executing' || graph.status === 'approved';

  return (
    <div className="w-full space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between px-1 mb-1">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-boult-fg-muted" />
          <span className="text-[13px] font-bold text-boult-fg tracking-tight">{graph.title}</span>
        </div>
        <span className="text-[12px] text-boult-fg-muted">
          {graph.progress.completed}/{graph.progress.total}
        </span>
      </div>

      {/* Progress bar */}
      {isExecuting && graph.progress.total > 0 && (
        <div className="h-1 bg-boult-raised rounded-full overflow-hidden mb-3">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
            className="h-full bg-boult-fg-secondary rounded-full"
          />
        </div>
      )}

      {/* Todo items */}
      <div className="space-y-2">
        {graph.todos.map((todo, i) => (
          <TodoItemRow key={todo.todoId} todo={todo} index={i} total={graph.progress.total} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SearchTransparencyPanel — Perplexity-style search steps (restyled)
// ─────────────────────────────────────────────────────────────────────────────

const sourceTypeConfig: Record<string, { icon: React.ReactNode; label: string }> = {
  email:    { icon: <Mail className="w-3.5 h-3.5" />,     label: 'Gmail' },
  notes:    { icon: <FileText className="w-3.5 h-3.5" />, label: 'Notes' },
  web:      { icon: <Globe className="w-3.5 h-3.5" />,    label: 'Web' },
  calendar: { icon: <Calendar className="w-3.5 h-3.5" />, label: 'Calendar' },
  notion:   { icon: <Database className="w-3.5 h-3.5" />, label: 'Notion' },
  tasks:    { icon: <ListTodo className="w-3.5 h-3.5" />, label: 'Tasks' },
};

function SearchTransparencyPanel({ sessions }: { sessions: SearchSession[] }) {
  const [open, setOpen] = useState(true);
  if (!sessions.length) return null;

  const done = sessions.filter(s => s.status === 'complete').length;
  const allDone = done === sessions.length;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-[13px] font-semibold text-boult-fg-secondary hover:text-boult-fg transition-colors mb-2"
      >
        {allDone ? `Completed ${done} search${done !== 1 ? 'es' : ''}` : `Searching… (${done}/${sessions.length})`}
        {open ? <ChevronDown className="w-3.5 h-3.5 text-boult-fg-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-boult-fg-muted" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pl-1 border-l border-boult-border ml-1">
              {sessions.map((session) => {
                const cfg = sourceTypeConfig[session.sourceType] || sourceTypeConfig.web;
                const searching = session.status === 'searching' || session.status === 'source_processing';
                return (
                  <div key={session.sessionId} className="pl-3 py-1">
                    <div className="flex items-center gap-2.5 mb-1">
                      <div className="text-boult-fg-muted">{cfg.icon}</div>
                      <span className={cn('text-[13px] font-semibold', searching ? 'text-boult-fg' : 'text-boult-fg-tertiary')}>
                        {searching ? `Scanning ${cfg.label}…` : `${cfg.label} — ${session.resultCount ?? 0} results`}
                      </span>
                      {searching && <Loader2 className="w-3 h-3 text-boult-fg-tertiary animate-spin" />}
                    </div>
                    {session.selectedSnippets?.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 pl-5 py-0.5">
                        <div className="w-1 h-1 rounded-full bg-boult-fg-muted flex-shrink-0" />
                        <span className="text-[12px] text-boult-fg-tertiary truncate">{s.subject || s.title || 'Result'}</span>
                        {s.from && <span className="text-[11px] text-boult-fg-muted flex-shrink-0">{s.from.split('<')[0].trim()}</span>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ThinkingLayer — main export (Manus-style vertical accordion)
// ─────────────────────────────────────────────────────────────────────────────

export function ThinkingLayer({
  blocks,
  isVisible,
  currentThought,
  isGenerating,
  onStop,
  searchSessions,
  todoGraph,
  showTodoGraph = true,
}: ThinkingLayerProps) {
  if (
    !isVisible ||
    (blocks.length === 0 &&
      !isGenerating &&
      (!searchSessions || !searchSessions.length) &&
      !todoGraph)
  ) return null;

  return (
    <div className="space-y-3 py-2">
      {/* Search sessions */}
      {!!searchSessions?.length && (
        <SearchTransparencyPanel sessions={searchSessions} />
      )}

      {/* Todo graph */}
      {showTodoGraph && todoGraph && (
        <TodoGraphPanel graph={todoGraph} />
      )}

      {/* Thinking blocks as step accordion */}
      {blocks.length > 0 && (
        <div className="space-y-2">
          {blocks.map((block, i) => (
            <StepRow key={block.id} block={block} index={i} total={blocks.length} />
          ))}
        </div>
      )}

      {/* Live thought stream */}
      {currentThought && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2.5 px-1 py-2"
        >
          <Loader2 className="w-3.5 h-3.5 text-boult-fg-muted animate-spin flex-shrink-0" />
          <p className="text-[13px] font-medium text-boult-fg-tertiary italic leading-snug">
            {currentThought}
          </p>
        </motion.div>
      )}

      {/* Generating spinner with stop */}
      {isGenerating && !currentThought && blocks.length === 0 && (
        <div className="flex items-center gap-3 px-1 py-2">
          <div className="flex gap-1">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-boult-fg-muted"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, delay: i * 0.2, repeat: Infinity }}
              />
            ))}
          </div>
          <span className="text-[13px] font-medium text-boult-fg-tertiary">Thinking…</span>
          {onStop && (
            <button
              onClick={onStop}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-boult-fg-tertiary hover:text-boult-fg bg-boult-raised/50 hover:bg-boult-divider/80 border border-boult-divider transition-all"
            >
              <X className="w-3 h-3" /> Stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ResultCard — artifact card matching the Maily file-card design
// ─────────────────────────────────────────────────────────────────────────────

interface ResultCardProps {
  type: string;
  title: string;
  onView: () => void;
  rawContent?: string;
}

// Label shown as the file subtitle e.g. "Markdown · 3.97 KB"
const resultSubtypes: Record<string, string> = {
  email_draft:      'Email',
  summary:          'Markdown',
  research:         'Markdown',
  action_plan:      'Markdown',
  reply:            'Email',
  notes:            'Markdown',
  meeting_schedule: 'Markdown',
  report:           'Markdown',
  analysis:         'Markdown',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Blue Google Docs-style document icon
function DocIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="48" rx="4" fill="#4A90D9" />
      <rect x="6" y="14" width="28" height="3" rx="1.5" fill="white" fillOpacity="0.9" />
      <rect x="6" y="21" width="28" height="3" rx="1.5" fill="white" fillOpacity="0.9" />
      <rect x="6" y="28" width="20" height="3" rx="1.5" fill="white" fillOpacity="0.7" />
      <rect x="6" y="35" width="14" height="3" rx="1.5" fill="white" fillOpacity="0.5" />
      <rect x="26" y="0" width="14" height="14" rx="0" fill="#2563EB" fillOpacity="0.6" />
      <path d="M26 0 L40 14 L26 14 Z" fill="#1D4ED8" fillOpacity="0.5" />
    </svg>
  );
}

export function ResultCard({ type, title, onView, rawContent }: ResultCardProps) {
  const [downloading, setDownloading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isEmail = type === 'email_draft' || type === 'reply';
  const safeName = (title || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '_');

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleDownload = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!rawContent || downloading) return;
    setMenuOpen(false);

    if (isEmail) {
      const blob = new Blob([rawContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${safeName}.txt`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return;
    }

    setDownloading(true);
    try {
      const { markdownToDocxBlob, triggerDocxDownload } = await import('@/lib/boult/docx-export');
      const blob = await markdownToDocxBlob(rawContent, title || 'document');
      triggerDocxDownload(blob, safeName);
    } catch {
      const blob = new Blob([rawContent], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${safeName}.md`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } finally {
      setDownloading(false);
    }
  };

  // Truncate preview to avoid rendering enormous documents
  const previewContent = rawContent ? rawContent.slice(0, 1200) : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onClick={onView}
      className="group relative mt-2 mb-1 w-full rounded-2xl bg-[#191919] border border-white/[0.07] overflow-hidden cursor-pointer hover:border-white/[0.13] transition-all"
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06]">
        <div className="flex-shrink-0 w-[22px] h-[26px]">
          <DocIcon className="w-full h-full drop-shadow-sm" />
        </div>
        <p className="flex-1 min-w-0 text-[14px] font-semibold text-white/90 leading-snug line-clamp-2">
          {title || 'Untitled Document'}
        </p>
        {/* Three-dot menu */}
        <div ref={menuRef} className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full mt-1 z-50 min-w-[140px] bg-[#242424] border border-white/10 rounded-xl shadow-2xl shadow-black/60 overflow-hidden"
              >
                <button
                  onClick={onView}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-white/70 hover:text-white hover:bg-white/[0.05] transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" /> Open
                </button>
                {rawContent && (
                  <button
                    onClick={() => handleDownload()}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-white/70 hover:text-white hover:bg-white/[0.05] transition-colors"
                  >
                    {downloading
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Download className="w-3.5 h-3.5" />
                    }
                    {isEmail ? 'Download .txt' : 'Download .docx'}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Markdown preview ── */}
      {previewContent && (
        <div className="relative px-4 pt-3.5 pb-0 max-h-[280px] overflow-hidden">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="text-[18px] font-bold text-white/85 mb-2 mt-1 leading-snug">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-[16px] font-bold text-white/80 mb-1.5 mt-3 leading-snug">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-[13px] font-semibold text-white/55 mb-1 mt-2 leading-snug">{children}</h3>
              ),
              p: ({ children }) => (
                <p className="text-[13px] text-white/55 leading-relaxed mb-2">{children}</p>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>
              ),
              li: ({ children }) => (
                <li className="text-[13px] text-white/50 leading-relaxed">{children}</li>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-white/70">{children}</strong>
              ),
              hr: () => <hr className="border-white/[0.07] my-2" />,
              code: ({ children }) => (
                <code className="text-[12px] bg-white/[0.06] px-1 py-0.5 rounded text-white/60">{children}</code>
              ),
            }}
          >
            {previewContent}
          </ReactMarkdown>
          {/* Gradient fade at bottom */}
          <div className="absolute bottom-0 inset-x-0 h-14 bg-gradient-to-t from-[#191919] to-transparent pointer-events-none" />
        </div>
      )}

      {/* ── Footer — click hint ── */}
      <div className="px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] text-white/20 group-hover:text-white/35 transition-colors">
          Click to open in canvas
        </span>
        {rawContent && (
          <span className="text-[11px] text-white/20 font-mono">
            {formatBytes(new Blob([rawContent]).size)}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: planToTodoGraph (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export function planToTodoGraph(plan: any): TodoGraph {
  const todos = plan.todos || [];
  return {
    planId: plan.planId,
    title: plan.title,
    objective: plan.objective,
    status: plan.status,
    todos: todos.map((t: any) => ({
      todoId: t.todoId || t.todo_id,
      title: t.title,
      description: t.description,
      status: t.status,
      actionType: t.actionType || t.action_type,
      sortOrder: t.sortOrder || t.sort_order || 0,
      dependsOn: t.dependsOn || t.depends_on || [],
      approvalMode: t.approvalMode || t.approval_mode || 'auto',
      attemptCount: t.attemptCount || t.attempt_count || 0,
      resultPayload: t.resultPayload || t.result_payload,
      errorMessage: t.errorMessage || t.error_message,
      startedAt: t.startedAt || t.started_at,
      completedAt: t.completedAt || t.completed_at,
    })),
    progress: {
      total: todos.length,
      completed: todos.filter((t: any) => (t.status || t.todo_status) === 'completed').length,
      failed: todos.filter((t: any) => (t.status || t.todo_status) === 'failed').length,
      running: todos.filter((t: any) => (t.status || t.todo_status) === 'running').length,
      ready: todos.filter((t: any) => (t.status || t.todo_status) === 'ready').length,
    },
  };
}
