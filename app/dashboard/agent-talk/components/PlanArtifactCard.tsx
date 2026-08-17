'use client';
/**
 * Boult V3 — Plan Artifact Card
 *
 * State machine component with exactly 4 states:
 * detected → plan_built → executing → completed
 *
 * Presentation is built on the app's own theme tokens (boult-* + glass), so
 * the card and every element on it is legible in BOTH themes. The previous
 * version styled itself with the standalone boult-v3 token sheet whose
 * companion classes (.boult-badge, .boult-btn-primary, …) were never loaded
 * in the chat bundle — badges and buttons rendered unstyled and inherited
 * near-invisible colors on the light theme.
 */
import React, { useState, useCallback } from 'react';
import { Loader2, Check, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRelativeTime } from '../hooks/useRelativeTime';
import { usePlanSSE, type SSEEvent } from '../hooks/usePlanSSE';

export type PlanStatus = 'detected' | 'plan_built' | 'executing' | 'completed' | 'failed' | 'dismissed' | 'proposed' | 'approved' | 'draft' | 'cancelled';

export interface PlanOption {
  label: string;
  effort: string;
  tradeoff: string;
  irreversible: boolean;
  steps: Array<{
    app: string;
    action: string;
    params: Record<string, unknown>;
    humanReadable: string;
  }>;
}

export interface Finding {
  id: string;
  headline: string;
  impact: string;
  options: PlanOption[];
  recommended: number;
}

export interface PlanStep {
  id: string;
  position: number;
  app: string;
  action: string;
  params: Record<string, unknown>;
  human_readable: string;
  irreversible: boolean;
  status: string;
  error: string | null;
}

export interface PlanData {
  id: string;
  mode: string;
  status: string;
  severity: string | null;
  headline: string | null;
  impact: string | null;
  findings: Finding[];
  steps: PlanStep[];
  created_at: string;
  completed_at: string | null;
  source: string | null;
}

export interface PlanArtifact {
  planId: string;
  status: PlanStatus;
  severity: string;
  findings: Finding[];
  steps: PlanStep[];
  sources: string[];
  createdAt: string;
  completedAt?: string;
  selectedOption?: number;
  title: string;
  objective: string;
  assumptions: any[];
  questionsAnswered: any[];
  acceptanceCriteria: any[];
  version: number;
  locked: boolean;
  complexity: string;
  intent: string;
  canvasType: string;
  todos: any[];
}

interface PlanArtifactCardProps {
  plan: any; // Using any for compatibility with legacy data structures
  isNew?: boolean;
  onUpdate?: () => void;
}

const SEVERITY_MAP: Record<string, { label: string; chip: string }> = {
  low:    { label: 'Low Priority',    chip: 'bg-black/[0.05] dark:bg-white/[0.07] text-boult-fg-secondary' },
  medium: { label: 'Needs Attention', chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  high:   { label: 'Action Required', chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
};

export default function PlanArtifactCard({ plan, isNew, onUpdate }: PlanArtifactCardProps) {
  // Normalize plan data for internal use
  const normalizedPlan: PlanData = {
    id: plan.planId || plan.id,
    mode: plan.mode || 'agentic',
    status: plan.status,
    severity: plan.severity || 'low',
    headline: plan.headline || plan.title,
    impact: plan.impact || plan.objective,
    findings: plan.findings || [],
    steps: plan.steps || [],
    created_at: plan.createdAt || plan.created_at,
    completed_at: plan.completedAt || plan.completed_at,
    source: plan.source || (plan.sources ? plan.sources.join(', ') : null),
  };

  const [status, setStatus] = useState(normalizedPlan.status);
  const [steps, setSteps] = useState<PlanStep[]>(normalizedPlan.steps);
  const [selectedOption, setSelectedOption] = useState(
    normalizedPlan.findings?.[0]?.recommended ?? 0
  );
  const [loading, setLoading] = useState(false);
  const relativeTime = useRelativeTime(normalizedPlan.created_at);
  // Hooks must be unconditional — the previous version called useRelativeTime
  // inside the completed-state branch, so the hook count changed the moment a
  // plan transitioned to completed.
  const completedRelativeTime = useRelativeTime(normalizedPlan.completed_at);

  // SSE for real-time execution feedback
  usePlanSSE({
    planId: normalizedPlan.id,
    enabled: status === 'executing' || status === 'approved',
    onEvent: useCallback((event: SSEEvent) => {
      if (event.type === 'step:start' && event.stepId) {
        setSteps(prev => prev.map(s => s.id === event.stepId ? { ...s, status: 'executing' } : s));
      }
      if (event.type === 'step:done' && event.stepId) {
        setSteps(prev => prev.map(s => s.id === event.stepId ? { ...s, status: 'completed' } : s));
      }
      if (event.type === 'step:failed' && event.stepId) {
        setSteps(prev => prev.map(s => s.id === event.stepId ? { ...s, status: 'failed', error: event.error || 'Execution failed' } : s));
        setStatus('failed');
      }
      if (event.type === 'plan:completed') {
        setStatus('completed');
      }
    }, [])
  });

  // ─── Actions ──────────────────────────────────────────────────────────────

  async function handleBuildPlan() {
    setLoading(true);
    try {
      const res = await fetch(`/api/boult/v3/plans/${normalizedPlan.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedOption }),
      });
      if (res.ok) {
        const planRes = await fetch(`/api/boult/v3/plans/${normalizedPlan.id}`);
        if (planRes.ok) {
          const updated = await planRes.json();
          setSteps(updated.steps || []);
          setStatus('approved');
        }
      }
    } catch (err) {
      console.error('Build plan failed:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleExecute() {
    setLoading(true);
    try {
      const res = await fetch(`/api/boult/v3/plans/${normalizedPlan.id}/execute`, { method: 'POST' });
      if (res.ok) setStatus('executing');
    } catch (err) {
      console.error('Execution trigger failed:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDismiss() {
    try {
      await fetch(`/api/boult/v3/plans/${normalizedPlan.id}/dismiss`, { method: 'POST' });
      setStatus('dismissed');
      onUpdate?.();
    } catch (err) {
      console.error('Dismiss failed:', err);
    }
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  if (status === 'dismissed') return null;

  // State: Completed (Collapsed)
  if (status === 'completed') {
    return (
      <div className="boult-glass rounded-2xl px-5 py-3.5 mb-4 flex items-center justify-between gap-3 opacity-70">
        <span className="text-[13px] text-boult-fg-secondary truncate">
          {normalizedPlan.findings?.[0]?.headline || normalizedPlan.headline}
        </span>
        <span className="text-[11.5px] text-boult-fg-tertiary shrink-0">
          Completed · {completedRelativeTime}
        </span>
      </div>
    );
  }

  const severity = SEVERITY_MAP[normalizedPlan.severity || 'low'] || SEVERITY_MAP.low;
  const finding = normalizedPlan.findings?.[0];

  return (
    <div className={cn('boult-glass-card rounded-2xl p-6 mb-4', isNew && 'animate-in fade-in slide-in-from-bottom-2 duration-300')}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className={cn('px-2.5 py-1 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.08em]', severity.chip)}>
          {severity.label}
        </span>
        <span className="text-[11.5px] text-boult-fg-tertiary">{relativeTime}</span>
      </div>

      {/* Headline & Impact */}
      <h3 className="text-[15.5px] font-semibold text-boult-fg leading-snug mb-1.5">
        {finding?.headline || normalizedPlan.headline}
      </h3>
      <p className="text-[13.5px] text-boult-fg-secondary leading-relaxed mb-3">
        {finding?.impact || normalizedPlan.impact}
      </p>

      {/* Detected State */}
      {(status === 'proposed' || status === 'detected') && finding && (
        <>
          <div className="text-[11.5px] text-boult-fg-tertiary mb-4">
            Detected from {normalizedPlan.source || 'connected apps'}
          </div>

          <div className="flex flex-col gap-2 mb-4">
            {finding.options.map((option, idx) => {
              const active = selectedOption === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedOption(idx)}
                  className={cn(
                    'flex gap-3 p-3 rounded-xl text-left border transition-all',
                    active
                      ? 'border-black/[0.14] dark:border-white/[0.18] bg-black/[0.03] dark:bg-white/[0.05]'
                      : 'border-transparent hover:bg-black/[0.02] dark:hover:bg-white/[0.03]',
                  )}
                >
                  {/* Radio */}
                  <span className={cn(
                    'mt-0.5 w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-colors',
                    active ? 'border-boult-fg' : 'border-black/25 dark:border-white/30',
                  )}>
                    {active && <span className="w-2 h-2 rounded-full bg-boult-fg" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[13.5px] font-medium text-boult-fg">{option.label}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/[0.05] dark:bg-white/[0.07] text-boult-fg-tertiary shrink-0">
                        {option.effort} effort
                      </span>
                    </span>
                    <span className={cn(
                      'block text-[12px] leading-snug mt-0.5',
                      option.irreversible ? 'text-amber-700 dark:text-amber-400' : 'text-boult-fg-tertiary',
                    )}>
                      {option.irreversible && <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5" />}
                      {option.tradeoff}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleBuildPlan}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-boult-fg text-boult-fg-inverse text-[13px] font-semibold hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Build Plan'}
            </button>
          </div>
        </>
      )}

      {/* Plan Built / Executing States */}
      {(status === 'approved' || status === 'executing' || status === 'failed') && (
        <>
          <div className="flex flex-col gap-1.5 mb-4">
            {steps.map((step, idx) => (
              <div
                key={step.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-xl transition-colors',
                  step.status === 'completed' && 'bg-emerald-500/[0.06]',
                )}
              >
                <span className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[11px] tabular-nums',
                  step.status === 'completed'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'bg-black/[0.05] dark:bg-white/[0.08] text-boult-fg-tertiary',
                )}>
                  {step.status === 'pending' && (idx + 1)}
                  {step.status === 'executing' && <Loader2 className="w-3 h-3 animate-spin" />}
                  {step.status === 'completed' && <Check className="w-3 h-3" strokeWidth={2.5} />}
                  {step.status === 'failed' && <X className="w-3 h-3 text-rose-600 dark:text-rose-400" strokeWidth={2.5} />}
                </span>
                <span className="flex-1 text-[13px] text-boult-fg leading-snug">{step.human_readable}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-boult-fg-tertiary shrink-0">
                  {step.app}
                </span>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2.5">
            {status === 'approved' && (
              <>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="px-4 py-2 rounded-xl text-[13px] font-medium text-boult-fg-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={handleExecute}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-boult-fg text-boult-fg-inverse text-[13px] font-semibold hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Execute'}
                </button>
              </>
            )}
            {status === 'executing' && (
              <span className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-boult-fg-tertiary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…
              </span>
            )}
            {status === 'failed' && (
              <button
                type="button"
                onClick={() => setStatus('approved')}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-500/10 hover:bg-rose-500/15 transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
