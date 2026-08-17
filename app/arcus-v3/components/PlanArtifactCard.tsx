'use client';
/**
 * Boult V3 — Plan Artifact Card
 * 
 * State machine component with exactly 4 states:
 * detected → plan_built → executing → completed
 * 
 * Shared glass shell, editorial typography (Fraunces), 
 * and liquid interaction language.
 */
import React, { useState, useCallback } from 'react';
import { useRelativeTime } from '../hooks/useRelativeTime';
import { usePlanSSE, type SSEEvent } from '../hooks/usePlanSSE';

interface Finding {
  id: string;
  headline: string;
  impact: string;
  options: Array<{
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
  }>;
  recommended: number;
}

interface PlanStep {
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

interface PlanData {
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

interface PlanArtifactCardProps {
  plan: PlanData;
  isNew?: boolean;
  onUpdate?: () => void;
}

const SEVERITY_MAP: Record<string, { label: string; color: string }> = {
  low: { label: 'Low Priority', color: 'blue' },
  medium: { label: 'Needs Attention', color: 'amber' },
  high: { label: 'Action Required', color: 'red' },
};

export default function PlanArtifactCard({ plan, isNew, onUpdate }: PlanArtifactCardProps) {
  const [status, setStatus] = useState(plan.status);
  const [steps, setSteps] = useState<PlanStep[]>(plan.steps || []);
  const [selectedOption, setSelectedOption] = useState(
    plan.findings?.[0]?.recommended ?? 0
  );
  const [loading, setLoading] = useState(false);
  const relativeTime = useRelativeTime(plan.created_at);

  // SSE for real-time execution feedback
  const sseActive = (status === 'executing' || status === 'approved') ? plan.id : null;

  usePlanSSE(sseActive, useCallback((event: SSEEvent) => {
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
  }, []));

  // ─── Actions ──────────────────────────────────────────────────────────────

  async function handleBuildPlan() {
    setLoading(true);
    try {
      const res = await fetch(`/api/boult/v3/plans/${plan.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedOption }),
      });
      if (res.ok) {
        const planRes = await fetch(`/api/boult/v3/plans/${plan.id}`);
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
      const res = await fetch(`/api/boult/v3/plans/${plan.id}/execute`, { method: 'POST' });
      if (res.ok) setStatus('executing');
    } catch (err) {
      console.error('Execution trigger failed:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDismiss() {
    try {
      await fetch(`/api/boult/v3/plans/${plan.id}/dismiss`, { method: 'POST' });
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
      <div className="glass-surface" style={{ padding: 'var(--space-4) var(--space-6)', opacity: 0.6, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-on-dark-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%' }}>
          {plan.findings?.[0]?.headline || plan.headline}
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-on-dark-tertiary)' }}>
          Completed · {useRelativeTime(plan.completed_at)}
        </span>
      </div>
    );
  }

  const severity = SEVERITY_MAP[plan.severity || 'low'];
  const finding = plan.findings?.[0];

  return (
    <div className={`glass-surface ${isNew ? 'boult-card-enter' : ''}`} style={{ padding: 'var(--space-6)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <span className={`boult-badge boult-badge-${plan.severity || 'low'}`}>
          {severity.label}
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-on-dark-tertiary)' }}>
          {relativeTime}
        </span>
      </div>

      {/* Headline & Impact */}
      <h3 style={{ fontFamily: 'var(--font-content)', fontSize: 'var(--text-md)', fontWeight: 500, color: 'var(--text-on-dark-primary)', lineHeight: 1.3, marginBottom: 'var(--space-2)' }}>
        {finding?.headline || plan.headline}
      </h3>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-on-dark-secondary)', lineHeight: 1.6, marginBottom: 'var(--space-3)' }}>
        {finding?.impact || plan.impact}
      </p>

      {/* Detected State */}
      {(status === 'proposed' || status === 'detected') && finding && (
        <>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-on-dark-tertiary)', marginBottom: 'var(--space-4)' }}>
            Detected from {plan.source || 'connected apps'}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            {finding.options.map((option, idx) => (
              <div
                key={idx}
                onClick={() => setSelectedOption(idx)}
                style={{
                  display: 'flex',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  border: selectedOption === idx ? '0.5px solid rgba(255,255,255,0.20)' : '0.5px solid transparent',
                  background: selectedOption === idx ? 'rgba(255,255,255,0.06)' : 'transparent',
                }}
              >
                <div style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${selectedOption === idx ? '#FFF' : 'rgba(255,255,255,0.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  {selectedOption === idx && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFF' }} className="boult-option-pop" />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-on-dark-primary)' }}>{option.label}</span>
                    <span className="boult-effort-badge">{option.effort}</span>
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: option.irreversible ? 'var(--color-warning)' : 'var(--text-on-dark-tertiary)' }}>
                    {option.irreversible && '⚠ '}
                    {option.tradeoff}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="boult-btn boult-btn-primary" onClick={handleBuildPlan} disabled={loading}>
              {loading ? <span className="boult-spinner boult-spinner-small" /> : 'Build Plan'}
            </button>
          </div>
        </>
      )}

      {/* Plan Built / Executing States */}
      {(status === 'approved' || status === 'executing' || status === 'failed') && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            {steps.map((step, idx) => (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', background: step.status === 'completed' ? 'rgba(52,211,153,0.08)' : 'transparent' }} className={step.status === 'completed' ? 'boult-step-flash' : ''}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: step.status === 'completed' ? 'var(--color-success-bg)' : 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--text-on-dark-secondary)' }}>
                  {step.status === 'pending' && (idx + 1)}
                  {step.status === 'executing' && <span className="boult-spinner boult-spinner-small" />}
                  {step.status === 'completed' && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4 7L8 3" stroke="var(--color-success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  {step.status === 'failed' && <span style={{ color: 'var(--color-danger)' }}>×</span>}
                </div>
                <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--text-on-dark-primary)' }}>{step.human_readable}</span>
                <span className="boult-step-app-chip">{step.app}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            {status === 'approved' && (
              <>
                <button className="boult-btn boult-btn-ghost" onClick={handleDismiss}>Dismiss</button>
                <button className="boult-btn boult-btn-primary" onClick={handleExecute} disabled={loading}>
                  {loading ? <span className="boult-spinner boult-spinner-small" /> : 'Execute'}
                </button>
              </>
            )}
            {status === 'executing' && <button className="boult-btn boult-btn-ghost" disabled>Running…</button>}
            {status === 'failed' && <button className="boult-btn boult-btn-destructive" onClick={() => setStatus('approved')}>Retry</button>}
          </div>
        </>
      )}
    </div>
  );
}

