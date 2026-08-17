'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Clock, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TaskList {
  tasks: string[];
  completedCount: number;
}

interface TaskProgressCardProps {
  taskList: TaskList;
  isActive: boolean;
}

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TaskProgressCard({ taskList, isActive }: TaskProgressCardProps) {
  // Collapsed by default — user can expand for the full task list. The active
  // task is now surfaced in the header so the user never NEEDS to expand.
  const [collapsed, setCollapsed] = useState(true);
  const { tasks, completedCount } = taskList;
  const total = tasks.length;
  const done = Math.min(completedCount, total);
  const activeIndex = isActive && done < total ? done : -1;
  const activeTask = activeIndex >= 0 ? tasks[activeIndex] : null;

  // Elapsed timer — starts on first render (when card appears), stops on
  // isActive=false. The stopped value sticks so the user can see how long it took.
  const startedAtRef = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [finalElapsedMs, setFinalElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      // Freeze elapsed at the moment the run ended
      if (finalElapsedMs === null) setFinalElapsedMs(Date.now() - startedAtRef.current);
      return;
    }
    // Tick every 500ms while active — keeps the timer visibly moving without
    // burning render cycles. The timer is monotonic from card mount, which
    // matches "user message submitted -> AI output".
    const iv = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 500);
    return () => clearInterval(iv);
  }, [isActive, finalElapsedMs]);

  if (!tasks || tasks.length === 0) return null;

  const elapsedLabel = formatElapsed(finalElapsedMs !== null ? finalElapsedMs : elapsedMs);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="w-full rounded-2xl border border-boult-border bg-boult-surface overflow-hidden mb-2"
    >
      {/* Task rows — rendered ABOVE the header so expansion goes upward */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pt-3 pb-2 flex flex-col gap-0.5 border-b border-boult-border/40">
              {tasks.map((task, idx) => {
                const isCompleted = idx < done;
                const isRunning = !isCompleted && isActive && idx === done;

                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.18, delay: idx * 0.03 }}
                    className="flex items-start gap-2.5 py-1.5"
                  >
                    <div className="flex-shrink-0 mt-[1px]">
                      {isCompleted ? (
                        <motion.div
                          initial={{ scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', damping: 20, stiffness: 350 }}
                        >
                          <Check className="w-3.5 h-3.5 text-boult-fg-secondary" />
                        </motion.div>
                      ) : isRunning ? (
                        <motion.div
                          animate={{ opacity: [0.4, 1, 0.4] }}
                          transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
                        >
                          <Clock className="w-3.5 h-3.5 text-boult-fg-secondary/80" />
                        </motion.div>
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-boult-fg-muted/40" />
                      )}
                    </div>

                    <span
                      className={cn(
                        'text-[13px] leading-snug tracking-tight transition-colors duration-500',
                        isCompleted
                          ? 'text-boult-fg-secondary/80 line-through'
                          : isRunning
                          ? 'text-boult-fg font-medium'
                          : 'text-boult-fg-muted/50',
                      )}
                    >
                      {task}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header — always visible. Surfaces the active task label + elapsed timer
          so the user reads the current state without expanding. */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-boult-surface-hover/30 transition-colors text-left"
      >
        {/* Status dot — pulse while active */}
        <div className="flex-shrink-0">
          {isActive && done < total ? (
            <motion.span
              className="inline-block w-1.5 h-1.5 rounded-full bg-boult-fg-secondary/60"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
            />
          ) : (
            <Check className="w-3 h-3 text-boult-fg-secondary/60" />
          )}
        </div>

        {/* Active task label (current step) — the headline, never clipped */}
        <div className="flex-1 min-w-0">
          {activeTask ? (
            <motion.span
              key={activeTask}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="block text-[12.5px] font-medium text-boult-fg tracking-tight truncate"
            >
              {activeTask}
            </motion.span>
          ) : (
            <span className="block text-[12.5px] font-semibold text-boult-fg-secondary tracking-tight">
              {done === total ? 'Done' : 'Working…'}
            </span>
          )}
        </div>

        {/* Right side: progress count + elapsed + chevron */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <span className="text-[11px] font-mono text-boult-fg-muted tabular-nums">
            {done}/{total}
          </span>
          <span className={cn(
            'text-[11px] font-mono tabular-nums',
            isActive ? 'text-boult-fg-secondary' : 'text-boult-fg-muted',
          )}>
            {elapsedLabel}
          </span>
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 text-boult-fg-muted/60 transition-transform duration-200',
              collapsed ? 'rotate-0' : 'rotate-180',
            )}
          />
        </div>
      </button>
    </motion.div>
  );
}
