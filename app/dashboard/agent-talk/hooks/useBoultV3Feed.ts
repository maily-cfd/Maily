/**
 * useBoultV3Feed — Reactive feed hook for Boult V3 event-driven plans
 *
 * Polls /api/boult/v3/plans for new plans created by the webhook→queue→reasoning
 * pipeline. Converts V3 API responses into the 4-state PlanArtifact format
 * (detected → plan_built → executing → completed) used by PlanArtifactCard.
 *
 * Also provides approve/execute/dismiss actions and SSE-driven step updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PlanArtifact, PlanStep, Finding, PlanOption } from '../components/PlanArtifactCard';
import { usePlanSSE, type SSEEvent } from './usePlanSSE';

// ─── Raw API Types ──────────────────────────────────────────────────────────

interface BoultV3Plan {
  id: string;
  mode: string;
  status: string;
  severity: string | null;
  headline: string | null;
  impact: string | null;
  findings: any[];
  steps: any[];
  created_at: string;
  completed_at: string | null;
  source: string | null;
  selected_option: number | null;
  raw_llm_output?: any;
}

interface UseBoultV3FeedOptions {
  enabled?: boolean;
  pollInterval?: number;
  onNewPlan?: (plan: PlanArtifact) => void;
}

// ─── Status Mapping ─────────────────────────────────────────────────────────

function mapStatus(apiStatus: string): PlanArtifact['status'] {
  switch (apiStatus) {
    case 'proposed':  return 'detected';
    case 'approved':  return 'plan_built';
    case 'executing': return 'executing';
    case 'completed': return 'completed';
    case 'failed':    return 'failed';
    case 'dismissed': return 'dismissed';
    default:          return 'detected';
  }
}

// ─── V3 Plan → PlanArtifact Converter ───────────────────────────────────────

function v3PlanToArtifact(plan: BoultV3Plan): PlanArtifact {
  const rawFindings: any[] = plan.findings || plan.raw_llm_output?.findings || [];
  const severity = (plan.severity as 'low' | 'medium' | 'high') || 'low';

  // Convert raw findings to typed findings
  const findings: Finding[] = rawFindings.map((f: any) => ({
    id: f.id || crypto.randomUUID?.() || Math.random().toString(36),
    headline: f.headline || plan.headline || 'Insight detected',
    impact: f.impact || plan.impact || '',
    options: (f.options || []).map((opt: any): PlanOption => ({
      label: opt.label || 'Option',
      effort: opt.effort || 'low',
      tradeoff: opt.tradeoff || '',
      irreversible: opt.irreversible || false,
      steps: (opt.steps || []).map((s: any) => ({
        app: s.app,
        action: s.action,
        params: s.params || {},
        humanReadable: s.humanReadable || s.human_readable || `${s.app}.${s.action}`,
      })),
    })),
    recommended: f.recommended ?? 0,
  }));

  // If no findings from raw data, create a synthetic one
  if (findings.length === 0) {
    findings.push({
      id: plan.id,
      headline: plan.headline || 'Boult Insight',
      impact: plan.impact || '',
      options: [],
      recommended: 0,
    });
  }

  // Convert V3 steps to PlanStep format
  const steps: PlanStep[] = (plan.steps || []).map((step: any, idx: number) => ({
    id: step.id || `step_${idx}`,
    app: step.app || 'gcal',
    action: step.action || 'unknown',
    params: step.params || {},
    human_readable: step.human_readable || step.humanReadable || `${step.app}.${step.action}`,
    irreversible: step.irreversible || false,
    status: step.status === 'completed' ? 'completed' as const :
            step.status === 'executing' ? 'executing' as const :
            step.status === 'failed' ? 'failed' as const :
            'pending' as const,
    error: step.error || undefined,
    position: step.position ?? idx,
  }));

  // Detect sources from steps or explicit source field
  const sources: string[] = [];
  if (plan.source) sources.push(plan.source);
  steps.forEach(s => { if (!sources.includes(s.app)) sources.push(s.app); });
  if (sources.length === 0) sources.push('gcal');

  return {
    planId: plan.id,
    status: mapStatus(plan.status),
    severity,
    findings,
    steps,
    sources,
    createdAt: plan.created_at,
    completedAt: plan.completed_at || undefined,
    selectedOption: plan.selected_option ?? undefined,
    // Legacy compat fields
    title: findings[0]?.headline || plan.headline || 'Boult Insight',
    objective: findings[0]?.impact || plan.impact || '',
    assumptions: [],
    questionsAnswered: [],
    acceptanceCriteria: [],
    version: 1,
    locked: plan.status !== 'proposed',
    complexity: steps.length > 3 ? 'complex' : 'simple',
    intent: findings[0]?.headline || '',
    canvasType: 'boult_v3',
    todos: [],
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useBoultV3Feed({
  enabled = true,
  pollInterval = 30000,
  onNewPlan,
}: UseBoultV3FeedOptions = {}) {
  const [plans, setPlans] = useState<PlanArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executingPlanId, setExecutingPlanId] = useState<string | null>(null);
  const seenPlanIds = useRef(new Set<string>());
  const onNewPlanRef = useRef(onNewPlan);
  onNewPlanRef.current = onNewPlan;

  // ─── Fetch Plans ──────────────────────────────────────────────────────

  const fetchPlans = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/boult/v3/plans?limit=20');
      if (!res.ok) {
        if (res.status === 401) { setError(null); return; }
        throw new Error(`Failed: ${res.status}`);
      }
      const data = await res.json();
      const rawPlans: BoultV3Plan[] = data.plans || [];
      const converted = rawPlans.map(v3PlanToArtifact);
      setPlans(converted);
      setError(null);

      // Detect new plans (skip first load)
      for (const plan of converted) {
        if (!seenPlanIds.current.has(plan.planId)) {
          seenPlanIds.current.add(plan.planId);
          if (seenPlanIds.current.size > rawPlans.length) {
            onNewPlanRef.current?.(plan);
          }
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchPlans();
    const interval = setInterval(fetchPlans, pollInterval);
    return () => clearInterval(interval);
  }, [enabled, pollInterval, fetchPlans]);

  // ─── SSE for executing plans ──────────────────────────────────────────

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    setPlans(prev => prev.map(plan => {
      if (plan.planId !== executingPlanId) return plan;

      const updatedSteps = plan.steps.map(step => {
        if (event.type === 'step:start' && step.id === (event as any).stepId) {
          return { ...step, status: 'executing' as const };
        }
        if (event.type === 'step:done' && step.id === (event as any).stepId) {
          return { ...step, status: 'completed' as const };
        }
        if (event.type === 'step:failed' && step.id === (event as any).stepId) {
          return { ...step, status: 'failed' as const, error: (event as any).error };
        }
        return step;
      });

      let newStatus = plan.status;
      if (event.type === 'plan:completed') {
        newStatus = 'completed';
        setExecutingPlanId(null);
      }
      if (event.type === 'step:failed') {
        newStatus = 'failed';
        setExecutingPlanId(null);
      }

      return { ...plan, steps: updatedSteps, status: newStatus };
    }));
  }, [executingPlanId]);

  usePlanSSE({
    planId: executingPlanId,
    enabled: !!executingPlanId,
    onEvent: handleSSEEvent,
  });

  // ─── Actions ──────────────────────────────────────────────────────────

  const buildPlan = useCallback(async (planId: string, optionIndex: number) => {
    const res = await fetch(`/api/boult/v3/plans/${planId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedOption: optionIndex }),
    });
    if (!res.ok) throw new Error('Failed to build plan');
    await fetchPlans();
  }, [fetchPlans]);

  const executePlan = useCallback(async (planId: string) => {
    const res = await fetch(`/api/boult/v3/plans/${planId}/execute`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to execute plan');
    setExecutingPlanId(planId);
    await fetchPlans();
  }, [fetchPlans]);

  const dismissPlan = useCallback(async (planId: string) => {
    await fetch(`/api/boult/v3/plans/${planId}/dismiss`, { method: 'POST' });
    await fetchPlans();
  }, [fetchPlans]);

  // ─── Return ───────────────────────────────────────────────────────────

  return {
    plans,
    loading,
    error,
    refresh: fetchPlans,
    buildPlan,
    executePlan,
    dismissPlan,
    activePlans: plans.filter(p => ['detected', 'plan_built', 'executing'].includes(p.status)),
    completedPlans: plans.filter(p => p.status === 'completed'),
    executingPlanId,
  };
}
