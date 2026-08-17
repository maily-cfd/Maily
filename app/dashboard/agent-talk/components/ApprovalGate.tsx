'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle2, XCircle, Clock, ArrowRight, AlertTriangle,
  FileText, ListTodo, Target, HelpCircle, Sparkles, Loader2,
  ChevronDown, ChevronUp, ExternalLink, Shield, Zap, Play
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type PlanStatus = 'draft' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';

export type TodoItem = {
  todoId: string;
  title: string;
  description?: string;
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked_approval';
  actionType: string;
  sortOrder: number;
  dependsOn: string[];
  approvalMode: 'auto' | 'manual';
  attemptCount: number;
  resultPayload?: any;
  errorMessage?: string;
};

export type PlanArtifact = {
  planId: string;
  title: string;
  objective: string;
  assumptions: string[];
  questionsAnswered: string[];
  acceptanceCriteria: string[];
  status: PlanStatus;
  version: number;
  locked: boolean;
  approvedAt?: string;
  complexity: 'simple' | 'complex';
  intent: string;
  canvasType: string;
  todos: TodoItem[];
  createdAt: string;
};

interface ApprovalGateProps {
  plan: PlanArtifact;
  onApprove: (planId: string) => void;
  onReject: (planId: string) => void;
  onModify: (planId: string, modifications: Partial<PlanArtifact>) => void;
  isProcessing?: boolean;
}

const statusConfig: Record<PlanStatus, { label: string; color: string; icon: any }> = {
  draft: { label: 'Draft', color: 'text-amber-400', icon: FileText },
  approved: { label: 'Approved', color: 'text-emerald-400', icon: CheckCircle2 },
  executing: { label: 'Executing', color: 'text-blue-400', icon: Loader2 },
  completed: { label: 'Completed', color: 'text-emerald-400', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'text-red-400', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'text-neutral-600 dark:text-neutral-400', icon: XCircle }
};

const todoStatusConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  pending: { label: 'Pending', color: 'text-black/30 dark:text-white/30', bgColor: 'bg-black/[0.03] dark:bg-white/5' },
  ready: { label: 'Ready', color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  running: { label: 'Running', color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
  completed: { label: 'Done', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' },
  failed: { label: 'Failed', color: 'text-red-400', bgColor: 'bg-red-500/10' },
  skipped: { label: 'Skipped', color: 'text-neutral-600 dark:text-neutral-400', bgColor: 'bg-neutral-500/10' },
  blocked_approval: { label: 'Needs Approval', color: 'text-orange-400', bgColor: 'bg-orange-500/10' }
};

export function ApprovalGate({ plan, onApprove, onReject, onModify, isProcessing }: ApprovalGateProps) {
  const [expanded, setExpanded] = useState(true);
  const [showTodos, setShowTodos] = useState(true);
  const [isApproving, setIsApproving] = useState(false);

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await onApprove(plan.planId);
    } finally {
      setIsApproving(false);
    }
  };

  const statusInfo = statusConfig[plan.status];
  const StatusIcon = statusInfo.icon;

  const completedTodos = plan.todos.filter(t => t.status === 'completed').length;
  const totalTodos = plan.todos.length;
  const progress = totalTodos > 0 ? (completedTodos / totalTodos) * 100 : 0;

  // Determine if we show the approval buttons
  const showApprovalButtons = plan.status === 'draft' && !plan.locked;
  const isExecuting = plan.status === 'executing' || plan.status === 'approved';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full bg-boult-surface-hover border border-neutral-200 dark:border-boult-border rounded-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-neutral-200 dark:border-white/5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
              plan.status === 'draft' ? 'bg-amber-500/10 border border-amber-500/20' :
              plan.status === 'approved' ? 'bg-emerald-500/10 border border-emerald-500/20' :
              plan.status === 'executing' ? 'bg-blue-500/10 border border-blue-500/20' :
              'bg-neutral-500/10 border border-neutral-200 dark:border-white/10'
            )}>
              {plan.status === 'executing' ? (
                <Loader2 className={cn("w-5 h-5 animate-spin", statusInfo.color)} />
              ) : (
                <StatusIcon className={cn("w-5 h-5", statusInfo.color)} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-bold text-black/95 dark:text-white/95 tracking-tight">
                  {plan.title}
                </h3>
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border",
                  plan.status === 'draft' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' :
                  plan.status === 'approved' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' :
                  plan.status === 'executing' ? 'text-blue-400 border-blue-500/30 bg-blue-500/10' :
                  'text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-white/10 bg-black/[0.03] dark:bg-white/5'
                )}>
                  {statusInfo.label}
                </span>
              </div>
              <p className="text-[13px] text-black/50 dark:text-white/50 mt-1 leading-relaxed">
                {plan.objective}
              </p>
            </div>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-2 hover:bg-black/[0.03] dark:bg-white/5 rounded-lg transition-colors text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            {/* Plan Details */}
            <div className="px-5 py-4 space-y-4">
              {/* Assumptions & Questions */}
              {plan.assumptions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-black/40 dark:text-white/40">
                    <Target className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-bold uppercase tracking-wider">Assumptions</span>
                  </div>
                  <ul className="space-y-1.5 pl-5">
                    {plan.assumptions.map((assumption, i) => (
                      <li key={i} className="text-[13px] text-black/60 dark:text-white/60 flex items-start gap-2">
                        <span className="text-black/30 dark:text-white/30 mt-1">•</span>
                        {assumption}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.questionsAnswered.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-black/40 dark:text-white/40">
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-bold uppercase tracking-wider">Questions Answered</span>
                  </div>
                  <ul className="space-y-1.5 pl-5">
                    {plan.questionsAnswered.map((q, i) => (
                      <li key={i} className="text-[13px] text-black/60 dark:text-white/60 flex items-start gap-2">
                        <span className="text-emerald-400/60 mt-1">✓</span>
                        {q}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.acceptanceCriteria.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-black/40 dark:text-white/40">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-bold uppercase tracking-wider">Acceptance Criteria</span>
                  </div>
                  <ul className="space-y-1.5 pl-5">
                    {plan.acceptanceCriteria.map((criteria, i) => (
                      <li key={i} className="text-[13px] text-black/60 dark:text-white/60 flex items-start gap-2">
                        <span className="text-black/30 dark:text-white/30 mt-1">{i + 1}.</span>
                        {criteria}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Todo List */}
              {plan.todos.length > 0 && (
                <div className="space-y-3 pt-2">
                  <button
                    onClick={() => setShowTodos(!showTodos)}
                    className="flex items-center justify-between w-full text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <ListTodo className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-bold uppercase tracking-wider">
                        Execution Steps ({completedTodos}/{totalTodos})
                      </span>
                    </div>
                    {showTodos ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  <AnimatePresence>
                    {showTodos && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        {/* Progress Bar */}
                        {isExecuting && (
                          <div className="mb-4">
                            <div className="h-1.5 bg-black/[0.03] dark:bg-white/5 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${progress}%` }}
                                className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full"
                                transition={{ duration: 0.5 }}
                              />
                            </div>
                            <p className="text-[11px] text-black/40 dark:text-white/40 mt-1.5">
                              {completedTodos} of {totalTodos} completed
                            </p>
                          </div>
                        )}

                        {/* Todo Items */}
                        <div className="space-y-2">
                          {plan.todos.map((todo, index) => (
                            <TodoCard key={todo.todoId} todo={todo} index={index} />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {showApprovalButtons && (
              <div className="px-5 py-4 border-t border-neutral-200 dark:border-white/5 bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleApprove}
                    disabled={isApproving || isProcessing}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white text-black text-[13px] font-bold rounded-xl hover:bg-neutral-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isApproving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Approving...
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        Approve & Execute
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => onReject(plan.planId)}
                    disabled={isApproving || isProcessing}
                    className="px-4 py-3 bg-black/[0.03] dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-black/60 dark:text-white/60 text-[13px] font-bold rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/10 hover:text-black dark:hover:text-white transition-all disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[11px] text-black/30 dark:text-white/30 mt-3 text-center">
                  Once approved, Boult will execute all {plan.todos.length} steps automatically
                </p>
              </div>
            )}

            {plan.status === 'approved' && (
              <div className="px-5 py-4 border-t border-neutral-200 dark:border-white/5 bg-emerald-500/5">
                <div className="flex items-center justify-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-[13px] font-bold">Plan Approved — Ready for Execution</span>
                </div>
              </div>
            )}

            {plan.status === 'executing' && (
              <div className="px-5 py-4 border-t border-neutral-200 dark:border-white/5 bg-blue-500/5">
                <div className="flex items-center justify-center gap-2 text-blue-400">
                  <Zap className="w-4 h-4 animate-pulse" />
                  <span className="text-[13px] font-bold">Executing Plan...</span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function TodoCard({ todo, index }: { todo: TodoItem; index: number }) {
  const statusInfo = todoStatusConfig[todo.status];
  const isRunning = todo.status === 'running';
  const isCompleted = todo.status === 'completed';
  const isFailed = todo.status === 'failed';
  const needsApproval = todo.status === 'blocked_approval';

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn(
        "flex items-start gap-3 p-3 rounded-xl border transition-all",
        isRunning ? "bg-blue-500/5 border-blue-500/20" :
        isCompleted ? "bg-emerald-500/5 border-emerald-500/10" :
        isFailed ? "bg-red-500/5 border-red-500/20" :
        needsApproval ? "bg-orange-500/5 border-orange-500/20" :
        "bg-white/[0.02] border-neutral-200 dark:border-white/5"
      )}
    >
      {/* Status Indicator */}
      <div className={cn(
        "w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
        statusInfo.bgColor
      )}>
        {isRunning ? (
          <Loader2 className={cn("w-3.5 h-3.5 animate-spin", statusInfo.color)} />
        ) : isCompleted ? (
          <CheckCircle2 className={cn("w-3.5 h-3.5", statusInfo.color)} />
        ) : isFailed ? (
          <XCircle className={cn("w-3.5 h-3.5", statusInfo.color)} />
        ) : needsApproval ? (
          <Shield className={cn("w-3.5 h-3.5", statusInfo.color)} />
        ) : (
          <span className={cn("text-[10px] font-bold", statusInfo.color)}>{index + 1}</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className={cn(
            "text-[13px] font-semibold leading-tight",
            isCompleted ? 'text-black/50 dark:text-white/50 line-through' : 'text-black/80 dark:text-white/80'
          )}>
            {todo.title}
          </h4>
          <span className={cn(
            "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0",
            statusInfo.bgColor, statusInfo.color
          )}>
            {statusInfo.label}
          </span>
        </div>
        
        {todo.description && (
          <p className={cn(
            "text-[12px] mt-1 leading-relaxed",
            isCompleted ? 'text-black/30 dark:text-white/30' : 'text-black/50 dark:text-white/50'
          )}>
            {todo.description}
          </p>
        )}

        {/* Error Message */}
        {todo.errorMessage && (
          <div className="flex items-start gap-2 mt-2 text-red-400/80">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <p className="text-[11px]">{todo.errorMessage}</p>
          </div>
        )}

        {/* Attempt Count */}
        {todo.attemptCount > 1 && (
          <p className="text-[10px] text-black/30 dark:text-white/30 mt-2">
            Attempt {todo.attemptCount}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Compact version for inline display in chat
 */
export function ApprovalGateCompact({ plan, onApprove, isProcessing }: { 
  plan: PlanArtifact; 
  onApprove: (planId: string) => void;
  isProcessing?: boolean;
}) {
  const [isApproving, setIsApproving] = useState(false);

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await onApprove(plan.planId);
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-boult-surface-hover border border-amber-500/20 rounded-xl p-4 my-3"
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-[14px] font-bold text-black/90 dark:text-white/90">{plan.title}</h4>
          <p className="text-[12px] text-black/50 dark:text-white/50 mt-1 line-clamp-2">{plan.objective}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[11px] text-black/40 dark:text-white/40">
              {plan.todos.length} steps
            </span>
            <span className="text-black/20 dark:text-white/20">•</span>
            <span className="text-[11px] text-black/40 dark:text-white/40">
              {plan.complexity === 'complex' ? 'Complex' : 'Simple'}
            </span>
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={handleApprove}
          disabled={isApproving || isProcessing}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white text-black text-[12px] font-bold rounded-lg hover:bg-neutral-200 transition-all disabled:opacity-50"
        >
          {isApproving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              Run Plan
            </>
          )}
        </button>
        <button className="px-3 py-2 bg-black/[0.03] dark:bg-white/5 text-black/50 dark:text-white/50 text-[12px] font-bold rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all">
          Review
        </button>
      </div>
    </motion.div>
  );
}
