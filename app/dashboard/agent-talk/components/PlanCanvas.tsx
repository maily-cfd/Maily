'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Loader2, X, Sparkles, Maximize2, CheckCircle2
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import type { PlanArtifact, PlanStatus } from './PlanArtifactCard';

export type { PlanArtifact, PlanStatus };

// ─── Markdown styling for plan cards ──────────────────────────
const PlanMarkdown = {
  h1: ({node, ...props}: any) => <h1 className="text-xl font-bold text-black dark:text-white mt-5 mb-3 tracking-tight" {...props} />,
  h2: ({node, ...props}: any) => <h2 className="text-lg font-bold text-black dark:text-white mt-5 mb-2 tracking-tight" {...props} />,
  h3: ({node, ...props}: any) => <h3 className="text-[15px] font-bold text-black dark:text-white mt-4 mb-2 tracking-tight" {...props} />,
  p: ({node, ...props}: any) => <p className="mb-3 last:mb-0 leading-[1.7] text-[14px] text-black/70 dark:text-white/70" {...props} />,
  ul: ({node, ...props}: any) => <ul className="space-y-1.5 my-3 list-none pl-1" {...props} />,
  ol: ({node, ...props}: any) => <ol className="space-y-1.5 my-3 list-decimal pl-5 text-black/70 dark:text-white/70 text-[14px]" {...props} />,
  li: ({node, ...props}: any) => (
    <li className="relative pl-4 text-[14px] text-black/70 dark:text-white/70">
      <span className="absolute left-0 top-2 w-1 h-1 bg-black/40 dark:bg-white/40 rounded-full" />
      {props.children}
    </li>
  ),
  strong: ({node, ...props}: any) => <strong className="font-bold text-black dark:text-white" {...props} />,
  hr: ({node, ...props}: any) => <hr className="my-5 border-t border-black/[0.07] dark:border-white/[0.06]" {...props} />,
  a: ({node, ...props}: any) => <a className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-4 decoration-blue-400/30" target="_blank" rel="noopener noreferrer" {...props} />,
  code: ({node, inline, ...props}: any) =>
    inline
      ? <code className="px-1.5 py-0.5 bg-black/[0.05] dark:bg-white/[0.06] rounded-md text-[12px] font-mono text-black/75 dark:text-white/80" {...props} />
      : <code className="block p-4 bg-black/[0.03] dark:bg-white/[0.03] text-black/75 dark:text-white/80 rounded-xl my-4 text-[13px] font-mono overflow-x-auto border border-black/[0.07] dark:border-white/[0.06]" {...props} />,
};

// ─── Typewriter Hook ──────────────────────────────────────────
function useTypewriter(text: string, speed: number = 8) {
  const [displayed, setDisplayed] = useState('');
  const [isDone, setIsDone] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed('');
    setIsDone(false);
    indexRef.current = 0;

    if (!text) { setIsDone(true); return; }

    const interval = setInterval(() => {
      indexRef.current += 1;
      // Speed up: write 2-4 chars at a time for natural feel
      const charsPerTick = Math.min(3, text.length - indexRef.current + 1);
      indexRef.current = Math.min(indexRef.current + charsPerTick - 1, text.length);
      setDisplayed(text.slice(0, indexRef.current));

      if (indexRef.current >= text.length) {
        clearInterval(interval);
        setIsDone(true);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return { displayed, isDone };
}

// ─── Inline Plan Card ─────────────────────────────────────────
interface PlanCanvasProps {
  plan: PlanArtifact;
  onExecute: (planId: string) => Promise<void>;
  onDecline?: (planId: string) => void;
  isProcessing?: boolean;
}

export function PlanCanvas({ plan, onExecute, onDecline, isProcessing }: PlanCanvasProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const isDraft = plan.status === 'draft' && !plan.locked;
  const isRunning = plan.status === 'executing';
  const isCompleted = plan.status === 'completed';

  const planText = plan.objective || '';
  const { displayed, isDone } = useTypewriter(planText, 6);

  const handleExecute = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExecuting(true);
    try {
      await onExecute(plan.planId);
    } catch (err) {
      console.error('[PlanCanvas] Execute failed:', err);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="w-full max-w-2xl my-3"
      >
        <div className={cn(
          "relative overflow-hidden rounded-2xl border transition-all duration-300",
          "boult-glass-card",
          isDraft ? "border-black/[0.08] dark:border-white/[0.08]" :
          isRunning ? "border-blue-500/20" :
          isCompleted ? "border-emerald-500/15" :
          "border-black/[0.07] dark:border-white/[0.06]"
        )}>

          {/* ── Header ── */}
          <div className="px-5 pt-4 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                isRunning ? "bg-blue-500/10" :
                isCompleted ? "bg-emerald-500/10" :
                "bg-black/[0.04] dark:bg-white/[0.04]"
              )}>
                {isRunning ? (
                  <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
                ) : isCompleted ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Sparkles className="w-4 h-4 text-black/30 dark:text-white/30" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold text-black dark:text-white tracking-tight truncate">{plan.title}</h3>
                <StatusLabel status={plan.status} />
              </div>
            </div>

            <button
              onClick={() => setIsModalOpen(true)}
              className="w-7 h-7 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] hover:bg-black/[0.08] dark:hover:bg-white/[0.08] flex items-center justify-center text-black/25 dark:text-white/25 hover:text-black/50 dark:hover:text-white/50 transition-all shrink-0 ml-3"
              title="Expand plan"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* ── Plan Content with Typewriter ── */}
          <div className="px-5 pb-4 max-h-[280px] overflow-y-auto boult-scrollbar">
            <div className="text-[14px] text-black/60 dark:text-white/60 leading-[1.75]">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={PlanMarkdown}>
                {displayed}
              </ReactMarkdown>
              {!isDone && (
                <span className="inline-block w-[2px] h-[14px] bg-black/50 dark:bg-white/50 ml-0.5 animate-pulse align-text-bottom" />
              )}
            </div>
          </div>

          {/* ── Action Bar ── */}
          {isDraft && isDone && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-5 py-3 border-t border-black/[0.05] dark:border-white/[0.04] flex items-center gap-2"
            >
              <button
                onClick={handleExecute}
                disabled={isExecuting || isProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 text-[12px] font-bold rounded-xl transition-all disabled:opacity-40 active:scale-[0.98]"
              >
                {isExecuting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                {isExecuting ? 'Starting...' : 'Execute'}
              </button>
              {onDecline && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDecline(plan.planId); }}
                  className="px-3 py-2 text-black/25 dark:text-white/25 hover:text-black/50 dark:hover:text-white/50 text-[12px] font-bold rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                >
                  Dismiss
                </button>
              )}
            </motion.div>
          )}

          {isRunning && (
            <div className="px-5 py-2.5 border-t border-blue-500/10 bg-blue-500/[0.03]">
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[12px] font-bold">Executing...</span>
              </div>
            </div>
          )}

          {isCompleted && (
            <div className="px-5 py-2.5 border-t border-emerald-500/10 bg-emerald-500/[0.03]">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="text-[12px] font-bold">Plan executed</span>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Expanded Modal ── */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md p-6"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 30, stiffness: 280 }}
              className="w-full max-w-2xl max-h-[85vh] bg-white dark:bg-[#0a0a0a] border border-black/[0.08] dark:border-white/[0.08] rounded-3xl overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.8)] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="shrink-0 px-6 py-5 border-b border-black/[0.05] dark:border-white/[0.05] flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-black/[0.04] dark:bg-white/[0.04] flex items-center justify-center shrink-0">
                    <Sparkles className="w-4.5 h-4.5 text-black/30 dark:text-white/30" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[17px] font-bold text-black dark:text-white tracking-tight truncate">{plan.title}</h2>
                    <StatusLabel status={plan.status} />
                  </div>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-black/[0.05] dark:bg-white/[0.05] hover:bg-black/[0.10] dark:hover:bg-white/[0.10] flex items-center justify-center text-white/30 hover:text-black dark:hover:text-white transition-all shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body (Scrollable) */}
              <div className="flex-1 overflow-y-auto px-6 py-6 boult-scrollbar">
                <div className="text-[15px] text-black/65 dark:text-white/65 leading-[1.8]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={PlanMarkdown}>
                    {planText}
                  </ReactMarkdown>
                </div>
              </div>

              {/* Modal Footer */}
              {isDraft && (
                <div className="shrink-0 px-6 py-4 border-t border-black/[0.05] dark:border-white/[0.05] bg-black/[0.02] dark:bg-[#070707] flex items-center gap-3">
                  <button
                    onClick={handleExecute}
                    disabled={isExecuting || isProcessing}
                    className="flex items-center gap-2 px-5 py-2.5 bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 text-[13px] font-bold rounded-xl transition-all disabled:opacity-40 active:scale-[0.98]"
                  >
                    {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {isExecuting ? 'Starting...' : 'Execute'}
                  </button>
                  {onDecline && (
                    <button
                      onClick={() => onDecline(plan.planId)}
                      className="px-4 py-2.5 text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60 text-[13px] font-bold rounded-xl bg-black/[0.03] dark:bg-white/[0.03] hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-all"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Status Label ─────────────────────────────────────────────
function StatusLabel({ status }: { status: PlanStatus }) {
  const config: Partial<Record<PlanStatus, { label: string; cls: string }>> = {
    draft:     { label: 'Draft',     cls: 'text-amber-600/80 dark:text-amber-400/60' },
    approved:  { label: 'Approved',  cls: 'text-emerald-600/80 dark:text-emerald-400/60' },
    executing: { label: 'Running',   cls: 'text-blue-600/80 dark:text-blue-400/60' },
    completed: { label: 'Done',      cls: 'text-emerald-600/80 dark:text-emerald-400/60' },
    failed:    { label: 'Failed',    cls: 'text-red-600/80 dark:text-red-400/60' },
    cancelled: { label: 'Cancelled', cls: 'text-black/20 dark:text-white/20' },
  };
  const c = config[status] || { label: status, cls: 'text-black/40 dark:text-white/40' };
  return (
    <span className={cn("text-[10px] font-bold uppercase tracking-wider", c.cls)}>
      {c.label}
    </span>
  );
}

export default PlanCanvas;
