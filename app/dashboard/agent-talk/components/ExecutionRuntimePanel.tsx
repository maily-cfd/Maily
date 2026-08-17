'use client';

/**
 * ExecutionRuntimePanel - Manus AI Style
 * Real-time execution visualization for Boult AI
 * Premium dark interface with smooth animations
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Terminal,
  ChevronRight,
  ChevronDown,
  Zap,
  Shield,
  RefreshCw,
  AlertTriangle,
  MoreHorizontal
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface ExecutionStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'skipped';
  type: 'think' | 'search' | 'read' | 'execute' | 'verify' | 'approve';
  detail?: string;
  duration?: number;
  error?: {
    category: string;
    message: string;
    recoveryHint?: {
      userMessage: string;
      recoveryAction: string;
      requiresUserAction: boolean;
    };
  };
  progress?: number;
}

interface ExecutionRuntime {
  runId: string;
  status: 'initializing' | 'thinking' | 'searching' | 'synthesizing' | 'approval' | 'executing' | 'post_execution' | 'completed' | 'failed' | 'cancelled';
  phase: string;
  progress: number;
  steps: ExecutionStep[];
  startedAt?: string;
  completedAt?: string;
  estimatedDuration?: number;
  canPause: boolean;
  canResume: boolean;
  pauseReason?: {
    type: string;
    message: string;
    action?: string;
  };
}

interface ExecutionRuntimePanelProps {
  runtime: ExecutionRuntime;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onStepClick?: (step: ExecutionStep) => void;
  className?: string;
  compact?: boolean;
}

// ============================================================================
// STATUS CONFIGURATION
// ============================================================================

const statusConfig = {
  initializing: {
    label: 'Initializing',
    icon: Loader2,
    color: 'text-black/60 dark:text-white/60',
    bgColor: 'bg-black/[0.05] dark:bg-black/[0.05] dark:bg-white/10',
    borderColor: 'border-neutral-300 dark:border-white/20',
    glowColor: 'shadow-white/10',
    animate: true
  },
  thinking: {
    label: 'Thinking',
    icon: Terminal,
    color: 'text-black/80 dark:text-white/80',
    bgColor: 'bg-black/[0.05] dark:bg-black/[0.05] dark:bg-white/10',
    borderColor: 'border-neutral-300 dark:border-white/20',
    glowColor: 'shadow-white/10',
    animate: true
  },
  searching: {
    label: 'Searching',
    icon: RefreshCw,
    color: 'text-black/80 dark:text-white/80',
    bgColor: 'bg-black/[0.05] dark:bg-black/[0.05] dark:bg-white/10',
    borderColor: 'border-neutral-300 dark:border-white/20',
    glowColor: 'shadow-white/10',
    animate: true
  },
  synthesizing: {
    label: 'Synthesizing',
    icon: Zap,
    color: 'text-black/80 dark:text-white/80',
    bgColor: 'bg-black/[0.05] dark:bg-black/[0.05] dark:bg-white/10',
    borderColor: 'border-neutral-300 dark:border-white/20',
    glowColor: 'shadow-white/10',
    animate: true
  },
  approval: {
    label: 'Awaiting Approval',
    icon: Shield,
    color: 'text-black/70 dark:text-white/70',
    bgColor: 'bg-black/[0.05] dark:bg-black/[0.05] dark:bg-white/10',
    borderColor: 'border-neutral-300 dark:border-white/20',
    glowColor: 'shadow-white/10',
    animate: false
  },
  executing: {
    label: 'Executing',
    icon: Play,
    color: 'text-black/90 dark:text-white/90',
    bgColor: 'bg-white/15',
    borderColor: 'border-white/25',
    glowColor: 'shadow-white/10',
    animate: true
  },
  post_execution: {
    label: 'Finalizing',
    icon: CheckCircle2,
    color: 'text-black/70 dark:text-white/70',
    bgColor: 'bg-black/[0.05] dark:bg-black/[0.05] dark:bg-white/10',
    borderColor: 'border-neutral-300 dark:border-white/20',
    glowColor: 'shadow-white/10',
    animate: true
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    color: 'text-black/90 dark:text-white/90',
    bgColor: 'bg-white/15',
    borderColor: 'border-white/25',
    glowColor: 'shadow-white/10',
    animate: false
  },
  failed: {
    label: 'Failed',
    icon: AlertCircle,
    color: 'text-black/60 dark:text-white/60',
    bgColor: 'bg-black/[0.05] dark:bg-black/[0.05] dark:bg-white/10',
    borderColor: 'border-neutral-300 dark:border-white/20',
    glowColor: 'shadow-white/10',
    animate: false
  },
  cancelled: {
    label: 'Cancelled',
    icon: AlertTriangle,
    color: 'text-black/5 dark:text-black/50 dark:text-white/50',
    bgColor: 'bg-black/[0.03] dark:bg-black/[0.03] dark:bg-white/5',
    borderColor: 'border-neutral-200 dark:border-white/10',
    glowColor: 'shadow-white/5',
    animate: false
  }
};

const stepTypeConfig = {
  think: { label: 'Analyze', icon: Terminal, color: 'text-black/70 dark:text-white/70' },
  search: { label: 'Search', icon: RefreshCw, color: 'text-black/70 dark:text-white/70' },
  read: { label: 'Read', icon: Clock, color: 'text-black/70 dark:text-white/70' },
  execute: { label: 'Execute', icon: Zap, color: 'text-black/80 dark:text-white/80' },
  verify: { label: 'Verify', icon: CheckCircle2, color: 'text-black/70 dark:text-white/70' },
  approve: { label: 'Approve', icon: Shield, color: 'text-black/70 dark:text-white/70' }
};

const stepStatusConfig = {
  pending: { color: 'text-black/40 dark:text-white/40', bgColor: 'bg-black/[0.03] dark:bg-black/[0.03] dark:bg-white/5', borderColor: 'border-neutral-200 dark:border-white/10' },
  running: { color: 'text-black/80 dark:text-white/80', bgColor: 'bg-black/[0.05] dark:bg-black/[0.05] dark:bg-white/10', borderColor: 'border-neutral-300 dark:border-white/20', pulse: true },
  completed: { color: 'text-black/90 dark:text-white/90', bgColor: 'bg-white/15', borderColor: 'border-white/25' },
  failed: { color: 'text-black/5 dark:text-black/50 dark:text-white/50', bgColor: 'bg-black/[0.05] dark:bg-black/[0.05] dark:bg-white/10', borderColor: 'border-neutral-300 dark:border-white/20' },
  blocked: { color: 'text-black/60 dark:text-white/60', bgColor: 'bg-black/[0.05] dark:bg-black/[0.05] dark:bg-white/10', borderColor: 'border-neutral-300 dark:border-white/20' },
  skipped: { color: 'text-black/40 dark:text-white/40', bgColor: 'bg-black/[0.03] dark:bg-black/[0.03] dark:bg-white/5', borderColor: 'border-neutral-200 dark:border-white/10' }
};

// ============================================================================
// COMPONENT
// ============================================================================

export function ExecutionRuntimePanel({
  runtime,
  onPause,
  onResume,
  onCancel,
  onStepClick,
  className,
  compact = false
}: ExecutionRuntimePanelProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update elapsed time
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const status = statusConfig[runtime.status];
  const StatusIcon = status.icon;
  const elapsedTime = runtime.startedAt
    ? Math.floor((currentTime - new Date(runtime.startedAt).getTime()) / 1000)
    : 0;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stepId)) newSet.delete(stepId);
      else newSet.add(stepId);
      return newSet;
    });
  };

  return (
    <div className={cn(
      "bg-white dark:bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden",
      "shadow-2xl shadow-black/50",
      className
    )}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Status Indicator */}
            <motion.div
              animate={status.animate ? { scale: [1, 1.05, 1] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                "border",
                status.bgColor,
                status.borderColor,
                status.glowColor,
                "shadow-lg"
              )}
            >
              <StatusIcon className={cn("w-5 h-5", status.color, status.animate && "animate-spin")} />
            </motion.div>

            <div>
              <h3 className="text-[15px] font-semibold text-black/90 dark:text-white/90 tracking-tight">
                {status.label}
              </h3>
              <p className="text-[12px] text-black/40 dark:text-white/40 mt-0.5 font-mono">
                Run {runtime.runId.slice(-8)} • {formatDuration(elapsedTime)} elapsed
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {runtime.canPause && (
              <button
                onClick={onPause}
                className="p-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition-all group"
              >
                <Pause className="w-4 h-4 text-black/5 dark:text-black/50 dark:text-white/50 group-hover:text-black/80 dark:text-white/80" />
              </button>
            )}
            {runtime.canResume && (
              <button
                onClick={onResume}
                className={cn(
                  "px-4 py-2.5 rounded-lg font-medium text-[13px] transition-all",
                  "bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30",
                  "text-emerald-400 flex items-center gap-2"
                )}
              >
                <Play className="w-4 h-4" />
                Resume
              </button>
            )}
            {runtime.status !== 'completed' && runtime.status !== 'failed' && runtime.status !== 'cancelled' && (
              <button
                onClick={onCancel}
                className="p-2.5 rounded-lg bg-white/[0.03] hover:bg-red-500/10 border border-white/[0.06] hover:border-red-500/20 transition-all group"
              >
                <AlertTriangle className="w-4 h-4 text-black/5 dark:text-black/50 dark:text-white/50 group-hover:text-red-400" />
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] mb-2">
            <span className="text-black/40 dark:text-white/40">Execution Progress</span>
            <span className={cn("font-mono", status.color)}>{runtime.progress}%</span>
          </div>
          <div className="h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${runtime.progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className={cn(
                "h-full rounded-full",
                runtime.status === 'failed' ? 'bg-red-500' :
                runtime.status === 'completed' ? 'bg-emerald-500' :
                'bg-gradient-to-r from-amber-500 via-violet-500 to-emerald-500'
              )}
            />
          </div>
        </div>
      </div>

      {/* Pause Reason Banner */}
      {runtime.pauseReason && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="px-6 py-3 bg-orange-500/5 border-b border-orange-500/20"
        >
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-orange-400 mt-0.5" />
            <div>
              <p className="text-[13px] text-orange-400 font-medium">{runtime.pauseReason.type}</p>
              <p className="text-[12px] text-black/5 dark:text-black/50 dark:text-white/50 mt-0.5">{runtime.pauseReason.message}</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Steps List */}
      <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
        <AnimatePresence>
          {runtime.steps.map((step, index) => {
            const stepType = stepTypeConfig[step.type];
            const stepStatus = stepStatusConfig[step.status];
            const StepIcon = stepType.icon;
            const isExpanded = expandedSteps.has(step.id);
            const isRunning = step.status === 'running';

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ delay: index * 0.05 }}
                className={cn(
                  "border-b border-white/[0.04] last:border-b-0",
                  step.status === 'running' && "bg-white/[0.02]"
                )}
              >
                <button
                  onClick={() => toggleStep(step.id)}
                  className="w-full px-6 py-3.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors"
                >
                  {/* Status Dot */}
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full shrink-0",
                    step.status === 'completed' ? 'bg-emerald-500' :
                    step.status === 'failed' ? 'bg-red-500' :
                    step.status === 'running' ? 'bg-amber-500 animate-pulse' :
                    step.status === 'blocked' ? 'bg-orange-500' :
                    'bg-slate-600'
                  )} />

                  {/* Step Icon */}
                  <div className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                    stepStatus.bgColor,
                    stepStatus.borderColor,
                    "border"
                  )}>
                    <StepIcon className={cn("w-4 h-4", stepType.color, isRunning && "animate-pulse")} />
                  </div>

                  {/* Step Info */}
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-black/80 dark:text-white/80 font-medium">{step.label}</span>
                      {step.duration && (
                        <span className="text-[11px] text-black/30 dark:text-white/30 font-mono">
                          {formatDuration(step.duration)}
                        </span>
                      )}
                    </div>
                    {step.detail && !isExpanded && (
                      <p className="text-[12px] text-black/40 dark:text-white/40 mt-0.5 truncate">{step.detail}</p>
                    )}
                  </div>

                  {/* Status Badge */}
                  <div className={cn(
                    "px-2.5 py-1 rounded-md text-[10px] font-medium uppercase tracking-wider border",
                    stepStatus.bgColor,
                    stepStatus.borderColor,
                    stepStatus.color
                  )}>
                    {step.status}
                  </div>

                  {/* Expand Icon */}
                  {step.detail && (
                    <ChevronDown className={cn(
                      "w-4 h-4 text-black/30 dark:text-white/30 transition-transform",
                      isExpanded && "rotate-180"
                    )} />
                  )}
                </button>

                {/* Expanded Content */}
                <AnimatePresence>
                  {isExpanded && step.detail && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="px-6 pb-4"
                    >
                      <div className="pl-[3.25rem] pr-12">
                        <div className="p-3 bg-black/30 rounded-lg border border-white/[0.04]">
                          <p className="text-[12px] text-black/60 dark:text-white/60 leading-relaxed font-mono">
                            {step.detail}
                          </p>
                        </div>

                        {/* Error Recovery Hint */}
                        {step.error && step.error.recoveryHint && (
                          <div className="mt-3 p-3 bg-red-500/5 rounded-lg border border-red-500/20">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-[12px] text-red-400">{step.error.recoveryHint.userMessage}</p>
                                {step.error.recoveryHint.requiresUserAction && (
                                  <p className="text-[11px] text-black/40 dark:text-white/40 mt-1">
                                    Action required: {step.error.recoveryHint.recoveryAction}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Progress Bar for Running Steps */}
                        {isRunning && step.progress !== undefined && (
                          <div className="mt-3">
                            <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
                              <motion.div
                                animate={{ width: `${step.progress}%` }}
                                className="h-full bg-amber-500 rounded-full"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Footer Stats */}
      <div className="px-6 py-3 bg-white/[0.02] border-t border-white/[0.06]">
        <div className="flex items-center justify-between text-[11px] text-black/40 dark:text-white/40">
          <div className="flex items-center gap-4">
            <span>
              {runtime.steps.filter(s => s.status === 'completed').length} completed
            </span>
            <span>
              {runtime.steps.filter(s => s.status === 'running').length} running
            </span>
            {runtime.steps.some(s => s.status === 'failed') && (
              <span className="text-red-400">
                {runtime.steps.filter(s => s.status === 'failed').length} failed
              </span>
            )}
          </div>
          {runtime.estimatedDuration && (
            <span className="font-mono">
              ETA: {formatDuration(runtime.estimatedDuration - elapsedTime)}
            </span>
          )}
        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
      `}</style>
    </div>
  );
}

// ============================================================================
// COMPACT VERSION
// ============================================================================

export function ExecutionRuntimeCompact({ runtime, className }: { runtime: ExecutionRuntime; className?: string }) {
  const status = statusConfig[runtime.status];
  const StatusIcon = status.icon;

  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-2.5 rounded-xl",
      "bg-white/[0.03] border border-white/[0.06]",
      className
    )}>
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", status.bgColor)}>
        <StatusIcon className={cn("w-4 h-4", status.color, status.animate && "animate-spin")} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-black/80 dark:text-white/80 font-medium truncate">{status.label}</p>
        <div className="flex items-center gap-2">
          <div className="h-1 w-24 bg-white/[0.1] rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                runtime.status === 'failed' ? 'bg-red-500' : 'bg-emerald-500'
              )}
              style={{ width: `${runtime.progress}%` }}
            />
          </div>
          <span className="text-[11px] text-black/40 dark:text-white/40 font-mono">{runtime.progress}%</span>
        </div>
      </div>
    </div>
  );
}

export default ExecutionRuntimePanel;
