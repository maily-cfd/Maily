'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';

export interface PlanPreviewStep {
  label: string;
  tools: string[];
  parallel: boolean;
  isWrite: boolean;
  requiredIntegration: string | null;
}

export interface PlanPreviewData {
  intent: string;
  steps: PlanPreviewStep[];
  missingIntegrations: string[];
  estimatedCalls: { min: number; max: number };
  specificDescription: string;
}

interface PlanPreviewCardProps {
  plan: PlanPreviewData;
  onExecute: (steps: PlanPreviewStep[]) => void;
  onCancel: () => void;
}

function getStepIcon(tools: string[]): string {
  const toolStr = tools.join(' ').toLowerCase();
  if (/gmail|email|mail|draft/.test(toolStr)) return '📧';
  if (/calendar|meeting|schedule|event/.test(toolStr)) return '📅';
  if (/notion|page|note/.test(toolStr)) return '📝';
  if (/slack|channel/.test(toolStr)) return '💬';
  if (/search|find|lookup/.test(toolStr)) return '🔍';
  return '⚙️';
}

export function PlanPreviewCard({ plan, onExecute, onCancel }: PlanPreviewCardProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const isDark = !mounted || resolvedTheme === 'dark';

  const [isEditing, setIsEditing] = useState(false);
  const [editedSteps, setEditedSteps] = useState<PlanPreviewStep[]>(plan.steps.map(s => ({ ...s })));

  const estimatedSeconds = plan.estimatedCalls.min * 3;

  const handleAddStep = () => {
    setEditedSteps(prev => [...prev, { label: '', tools: [], parallel: false, isWrite: false, requiredIntegration: null }]);
  };

  const handleRemoveStep = (idx: number) => {
    setEditedSteps(prev => prev.filter((_, i) => i !== idx));
  };

  const handleLabelChange = (idx: number, value: string) => {
    setEditedSteps(prev => prev.map((s, i) => i === idx ? { ...s, label: value } : s));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className="mt-3 w-full rounded-[20px] overflow-hidden boult-glass-card"
    >
      {/* Header */}
      <div className={cn(
        'flex items-center gap-2.5 px-4 py-3 border-b',
        isDark ? 'border-white/[0.07]' : 'border-black/[0.06]',
      )}>
        <Zap className="w-4 h-4 text-indigo-400 flex-shrink-0" />
        <span className={cn(
          'text-[13px] font-bold',
          isDark ? 'text-white/90' : 'text-neutral-900',
        )}>
          Here&apos;s my plan
        </span>
      </div>

      {/* Description */}
      <div className="px-4 pt-3 pb-1">
        <p className={cn(
          'text-[13px] leading-relaxed italic',
          isDark ? 'text-white/55' : 'text-neutral-500',
        )}>
          {plan.specificDescription}
        </p>
      </div>

      {/* Steps */}
      <div className="px-4 py-3 space-y-2">
        {(isEditing ? editedSteps : plan.steps).map((step, i) => {
          const isUnavailable = step.requiredIntegration &&
            plan.missingIntegrations.includes(step.requiredIntegration);
          const icon = getStepIcon(step.tools);

          return (
            <div key={i} className={cn(
              'flex items-start gap-3 rounded-xl px-3 py-2.5',
              isDark ? 'bg-white/[0.03]' : 'bg-neutral-50',
            )}>
              {/* Step number badge */}
              <div className={cn(
                'flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5',
                isDark
                  ? 'bg-white/10 text-white/60'
                  : 'bg-neutral-200 text-neutral-600',
              )}>
                {i + 1}
              </div>

              {/* Icon */}
              <span className="text-base flex-shrink-0 mt-0.5 leading-none">{icon}</span>

              {/* Label */}
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    type="text"
                    value={step.label}
                    onChange={e => handleLabelChange(i, e.target.value)}
                    className={cn(
                      'w-full text-[13px] font-semibold rounded-lg px-2 py-1 outline-none',
                      isDark
                        ? 'bg-white/[0.06] border border-white/[0.10] text-white/90 placeholder-white/30'
                        : 'bg-white border border-neutral-200 text-neutral-900',
                    )}
                    placeholder="Step description…"
                  />
                ) : (
                  <p className={cn(
                    'text-[13px] font-semibold',
                    isUnavailable
                      ? isDark ? 'text-white/30 line-through' : 'text-neutral-400 line-through'
                      : isDark ? 'text-white/85' : 'text-neutral-800',
                  )}>
                    {step.label}
                  </p>
                )}

                {/* Badges */}
                {!isEditing && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {step.parallel && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                        parallel
                      </span>
                    )}
                    {step.isWrite && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                        write action
                      </span>
                    )}
                    {isUnavailable && (
                      <span className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium border',
                        isDark
                          ? 'bg-white/[0.05] text-white/30 border-white/[0.08]'
                          : 'bg-neutral-100 text-neutral-400 border-neutral-200',
                      )}>
                        not connected
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Remove button (edit mode) */}
              {isEditing && (
                <button
                  onClick={() => handleRemoveStep(i)}
                  className={cn(
                    'flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors mt-0.5',
                    isDark
                      ? 'text-white/30 hover:text-white/60 hover:bg-white/[0.08]'
                      : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100',
                  )}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* Add step (edit mode) */}
        {isEditing && (
          <button
            onClick={handleAddStep}
            className={cn(
              'flex items-center gap-1.5 text-[12px] font-medium transition-colors px-3 py-1.5',
              isDark
                ? 'text-white/40 hover:text-white/70'
                : 'text-neutral-400 hover:text-neutral-600',
            )}
          >
            <Plus className="w-3.5 h-3.5" />
            Add step
          </button>
        )}
      </div>

      {/* Estimate row */}
      <div className={cn(
        'px-4 py-2 border-t text-[11px]',
        isDark
          ? 'border-white/[0.06] text-white/30'
          : 'border-black/[0.05] text-neutral-400',
      )}>
        ~{plan.estimatedCalls.min}–{plan.estimatedCalls.max} tool calls · about {estimatedSeconds}s
      </div>

      {/* Footer buttons */}
      <div className={cn(
        'flex items-center gap-2.5 px-4 py-3 border-t',
        isDark ? 'border-white/[0.06]' : 'border-black/[0.05]',
      )}>
        {isEditing ? (
          <>
            <button
              onClick={() => onExecute(editedSteps.filter(s => s.label.trim()))}
              className="flex-1 py-2 rounded-xl text-[13px] font-bold transition-all bg-indigo-500 hover:bg-indigo-400 text-white shadow-[0_0_12px_rgba(99,102,241,0.2)]"
            >
              Run edited plan
            </button>
            <button
              onClick={() => { setIsEditing(false); setEditedSteps(plan.steps.map(s => ({ ...s }))); }}
              className={cn(
                'px-4 py-2 rounded-xl text-[13px] font-medium transition-all',
                isDark
                  ? 'text-white/45 hover:text-white/70 hover:bg-white/[0.05]'
                  : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100',
              )}
            >
              Discard edits
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onExecute(plan.steps)}
              className="flex-1 py-2 rounded-xl text-[13px] font-bold transition-all bg-indigo-500 hover:bg-indigo-400 text-white shadow-[0_0_12px_rgba(99,102,241,0.2)]"
            >
              Execute plan
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className={cn(
                'px-4 py-2 rounded-xl text-[13px] font-medium border transition-all',
                isDark
                  ? 'border-white/[0.12] text-white/60 hover:bg-white/[0.05]'
                  : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50',
              )}
            >
              Edit plan
            </button>
            <button
              onClick={onCancel}
              className={cn(
                'px-4 py-2 rounded-xl text-[13px] font-medium transition-all',
                isDark
                  ? 'text-white/30 hover:text-white/50'
                  : 'text-neutral-400 hover:text-neutral-500',
              )}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}
