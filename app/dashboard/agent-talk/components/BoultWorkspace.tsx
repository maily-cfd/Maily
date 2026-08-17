'use client';

/**
 * BoultWorkspace - Main Container Component (Manus AI Style)
 * Premium dark workspace for Phase 1 + Phase 2 execution visualization
 * Unified interface for execution runtime, plan mode, and recovery
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal,
  LayoutGrid,
  ListTodo,
  Activity,
  Shield,
  ChevronRight,
  ChevronDown,
  Maximize2,
  Minimize2,
  X,
  MoreHorizontal,
  Zap,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  GitBranch
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Import our components
import { ExecutionRuntimePanel, ExecutionRuntimeCompact } from './ExecutionRuntimePanel';
import { PlanVisualization } from './PlanVisualization';
import { RecoveryHintPanel, RecoveryHintBadge } from './RecoveryHintPanel';

// ============================================================================
// TYPES
// ============================================================================

interface BoultWorkspaceProps {
  // Execution State (Phase 1)
  runtime?: {
    runId: string;
    status: string;
    phase: string;
    progress: number;
    steps: any[];
    canPause: boolean;
    canResume: boolean;
    pauseReason?: any;
    startedAt?: string;
  };

  // Plan State (Phase 2)
  plan?: {
    planId: string;
    title: string;
    objective: string;
    status: 'draft' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
    version: number;
    locked: boolean;
    todos: any[];
    assumptions: string[];
    questionsAnswered: string[];
    acceptanceCriteria: string[];
    approvedAt?: string;
    completedAt?: string;
    cancelledAt?: string;
    runId?: string;
    createdBy: string;
  };

  // Error/Recovery State
  error?: {
    category: string;
    message: string;
    retryable: boolean;
    recoveryHint?: any;
  };

  // Event Handlers
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onApprovePlan?: () => void;
  onDeclinePlan?: () => void;
  onExecutePlan?: () => void;
  onRevisePlan?: () => void;

  // Configuration
  className?: string;
  defaultView?: 'runtime' | 'plan' | 'split';
  compact?: boolean;
  showHeader?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function BoultWorkspace({
  runtime,
  plan,
  error,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onApprovePlan,
  onDeclinePlan,
  onExecutePlan,
  onRevisePlan,
  className,
  defaultView = 'split',
  compact = false,
  showHeader = true
}: BoultWorkspaceProps) {
  const [activeView, setActiveView] = useState<'runtime' | 'plan' | 'logs'>(
    plan ? 'plan' : 'runtime'
  );
  const [isExpanded, setIsExpanded] = useState(!compact);
  const [isMinimized, setIsMinimized] = useState(false);

  // Auto-switch view based on state changes
  useEffect(() => {
    if (plan?.status === 'executing' && activeView === 'plan') {
      setActiveView('runtime');
    }
  }, [plan?.status, activeView]);

  // Determine overall status
  const hasError = !!error;
  const isRunning = runtime?.status === 'executing' || runtime?.status === 'thinking' || runtime?.status === 'searching';
  const isPaused = runtime?.canResume;
  const needsApproval = plan?.status === 'draft' || isPaused;

  // Status indicator config
  const getStatusConfig = () => {
    if (hasError) return {
      icon: AlertCircle,
      color: 'text-black/50 dark:text-white/50',
      bgColor: 'bg-black/[0.05] dark:bg-white/10',
      borderColor: 'border-neutral-300 dark:border-white/20',
      label: 'Error'
    };
    if (needsApproval) return {
      icon: Shield,
      color: 'text-black/70 dark:text-white/70',
      bgColor: 'bg-black/[0.05] dark:bg-white/10',
      borderColor: 'border-neutral-300 dark:border-white/20',
      label: 'Approval Required'
    };
    if (isRunning) return {
      icon: Zap,
      color: 'text-black/80 dark:text-white/80',
      bgColor: 'bg-white/15',
      borderColor: 'border-white/25',
      label: 'Running'
    };
    if (plan?.status === 'completed' || runtime?.status === 'completed') return {
      icon: CheckCircle2,
      color: 'text-black/90 dark:text-white/90',
      bgColor: 'bg-white/15',
      borderColor: 'border-white/25',
      label: 'Completed'
    };
    return {
      icon: Terminal,
      color: 'text-black/60 dark:text-white/60',
      bgColor: 'bg-black/[0.05] dark:bg-white/10',
      borderColor: 'border-neutral-300 dark:border-white/20',
      label: 'Ready'
    };
  };

  const statusConfig = getStatusConfig();
  const StatusIcon = statusConfig.icon;

  if (isMinimized) {
    return (
      <motion.button
        onClick={() => setIsMinimized(false)}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl",
          "bg-boult-bg-elevated border border-boult-border shadow-2xl shadow-black/50",
          "hover:border-white/[0.12] transition-all group",
          className
        )}
      >
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", statusConfig.bgColor)}>
          <StatusIcon className={cn("w-4 h-4", statusConfig.color, isRunning && "animate-pulse")} />
        </div>
        <div className="text-left">
          <p className="text-[12px] font-medium text-black/80 dark:text-white/80">{statusConfig.label}</p>
          {runtime && (
            <p className="text-[11px] text-black/40 dark:text-white/40 font-mono">
              {runtime.progress}% • {runtime.steps.filter(s => s.status === 'completed').length}/{runtime.steps.length}
            </p>
          )}
        </div>
        <Maximize2 className="w-4 h-4 text-black/30 dark:text-white/30 group-hover:text-black/50 dark:group-hover:text-white/50 ml-2" />
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "bg-boult-bg-elevated border border-boult-border rounded-2xl overflow-hidden",
        "shadow-2xl shadow-black/50",
        compact ? "max-w-md" : "w-full max-w-4xl",
        className
      )}
    >
      {/* Header */}
      {showHeader && (
        <div className="px-5 py-4 border-b border-boult-border/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Status */}
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center border",
                statusConfig.bgColor,
                statusConfig.borderColor
              )}>
                <StatusIcon className={cn("w-5 h-5", statusConfig.color, isRunning && "animate-pulse")} />
              </div>

              <div>
                <h2 className="text-[15px] font-semibold text-boult-fg">
                  Boult Workspace
                </h2>
                <p className="text-[12px] text-boult-fg-secondary">
                  {plan?.title || runtime?.runId.slice(-8) || 'Ready'}
                </p>
              </div>
            </div>

            {/* View Switcher */}
            <div className="flex items-center gap-2">
              {plan && (
                <div className="flex items-center gap-1 p-1 bg-boult-surface rounded-lg">
                  <button
                    onClick={() => setActiveView('plan')}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5",
                      activeView === 'plan'
                        ? "bg-boult-raised text-boult-fg"
                        : "text-boult-fg-secondary hover:text-boult-fg"
                    )}
                  >
                    <ListTodo className="w-3.5 h-3.5" />
                    Plan
                  </button>
                  {runtime && (
                    <button
                      onClick={() => setActiveView('runtime')}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5",
                        activeView === 'runtime'
                          ? "bg-boult-raised text-boult-fg"
                          : "text-boult-fg-secondary hover:text-boult-fg"
                      )}
                    >
                      <Activity className="w-3.5 h-3.5" />
                      Runtime
                    </button>
                  )}
                </div>
              )}

              {/* Window Controls */}
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="p-2 rounded-lg hover:bg-white/[0.06] transition-all"
                >
                  {isExpanded ? (
                    <Minimize2 className="w-4 h-4 text-black/40 dark:text-white/40" />
                  ) : (
                    <Maximize2 className="w-4 h-4 text-black/40 dark:text-white/40" />
                  )}
                </button>
                <button
                  onClick={() => setIsMinimized(true)}
                  className="p-2 rounded-lg hover:bg-white/[0.06] transition-all"
                >
                  <ChevronDown className="w-4 h-4 text-black/40 dark:text-white/40" />
                </button>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          {runtime && (
            <div className="flex items-center gap-6 mt-3 text-[11px] text-black/40 dark:text-white/40">
              <span className="flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5" />
                {runtime.steps.length} steps
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {runtime.steps.filter(s => s.status === 'completed').length} completed
              </span>
              {runtime.startedAt && (
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {Math.floor((Date.now() - new Date(runtime.startedAt).getTime()) / 60000)}m elapsed
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="border-b border-white/[0.06]">
          <RecoveryHintPanel
            error={error}
            onRetry={onRetry}
            compact={!isExpanded}
          />
        </div>
      )}

      {/* Content */}
      <AnimatePresence mode="wait">
        {activeView === 'plan' && plan && (
          <motion.div
            key="plan"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <PlanVisualization
              plan={plan}
              onApprove={onApprovePlan}
              onDecline={onDeclinePlan}
              onExecute={onExecutePlan}
              onRevise={onRevisePlan}
              showTabs={isExpanded}
            />
          </motion.div>
        )}

        {activeView === 'runtime' && runtime && (
          <motion.div
            key="runtime"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ExecutionRuntimePanel
              runtime={{
                ...runtime,
                status: runtime.status as any,
                phase: runtime.phase,
                steps: runtime.steps.map(s => ({
                  ...s,
                  status: s.status,
                  type: s.type || 'think'
                }))
              }}
              onPause={onPause}
              onResume={onResume}
              onCancel={onCancel}
              compact={!isExpanded}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Actions */}
      {isExpanded && (
        <div className="px-5 py-3 border-t border-boult-border/60 bg-boult-surface/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {runtime?.status && (
                <span className="text-[12px] text-boult-fg-secondary font-mono">
                  Run: {runtime.runId.slice(-12)}
                </span>
              )}
              {plan?.planId && (
                <span className="text-[12px] text-boult-fg-secondary font-mono">
                  Plan: {plan.planId.slice(-12)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {needsApproval && onApprovePlan && (
                <button
                  onClick={onApprovePlan}
                  className="px-4 py-2 rounded-lg bg-boult-surface hover:bg-boult-surface-hover border border-boult-border text-boult-fg text-[13px] font-medium transition-all flex items-center gap-2"
                >
                  <Shield className="w-4 h-4" />
                  Approve
                </button>
              )}

              {isPaused && onResume && (
                <button
                  onClick={onResume}
                  className="px-4 py-2 rounded-lg bg-boult-surface hover:bg-boult-surface-hover border border-boult-border text-boult-fg text-[13px] font-medium transition-all flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Resume
                </button>
              )}

              {isRunning && onCancel && (
                <button
                  onClick={onCancel}
                  className="px-4 py-2 rounded-lg bg-boult-surface hover:bg-boult-surface-hover border border-boult-border text-boult-fg-secondary hover:text-boult-fg text-[13px] font-medium transition-all"
                >
                  Cancel
                </button>
              )}

              {hasError && onRetry && (
                <button
                  onClick={onRetry}
                  className="px-4 py-2 rounded-lg bg-boult-surface hover:bg-boult-surface-hover border border-boult-border text-boult-fg text-[13px] font-medium transition-all flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ============================================================================
// WORKSPACE BADGE (for compact embedding in chat)
// ============================================================================

export function BoultWorkspaceBadge({
  runtime,
  plan,
  error,
  onClick
}: {
  runtime?: any;
  plan?: any;
  error?: any;
  onClick?: () => void;
}) {
  const getConfig = () => {
    if (error) return { color: 'text-black/50 dark:text-white/50', bgColor: 'bg-black/[0.05] dark:bg-white/10', icon: AlertCircle };
    if (plan?.status === 'draft') return { color: 'text-black/70 dark:text-white/70', bgColor: 'bg-black/[0.05] dark:bg-white/10', icon: Shield };
    if (runtime?.status === 'executing') return { color: 'text-black/80 dark:text-white/80', bgColor: 'bg-white/15', icon: Zap };
    if (plan?.status === 'completed' || runtime?.status === 'completed') return { color: 'text-black/90 dark:text-white/90', bgColor: 'bg-white/15', icon: CheckCircle2 };
    return { color: 'text-black/50 dark:text-white/50', bgColor: 'bg-black/[0.05] dark:bg-white/10', icon: Terminal };
  };

  const config = getConfig();
  const Icon = config.icon;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-xl border transition-all hover:opacity-80",
        config.bgColor,
        "border-white/[0.08]"
      )}
    >
      <Icon className={cn("w-4 h-4", config.color)} />
      <span className={cn("text-[12px] font-medium", config.color)}>
        {plan?.title || 'Boult Workspace'}
      </span>
      {runtime && (
        <span className="text-[11px] text-black/40 dark:text-white/40 font-mono">
          {runtime.progress}%
        </span>
      )}
      <ChevronRight className="w-3.5 h-3.5 text-black/30 dark:text-white/30" />
    </button>
  );
}

export default BoultWorkspace;
