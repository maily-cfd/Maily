'use client';
/**
 * Boult V3 — Plan Mode Brief View
 * Full-page editorial morning briefing.
 */
import React from 'react';

interface BriefData {
  generatedAt: string;
  criticalPath: Array<{ item: string; reason: string }>;
  risks: Array<{ risk: string; severity: string; suggestion: string }>;
  suggestedFocusBlocks: Array<{ day: string; timeRange: string; reason: string }>;
  oneThingToDropOrDelegate: { item: string; reasoning: string };
}

interface PlanModeBriefProps {
  brief: BriefData | null;
  onGenerate: () => void;
  loading: boolean;
}

export default function PlanModeBrief({ brief, onGenerate, loading }: PlanModeBriefProps) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-8)' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-content)', fontSize: 'var(--text-2xl)', fontWeight: 400, color: 'var(--text-on-light-primary)', marginBottom: 'var(--space-1)' }}>
            {today}
          </h1>
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-sm)', color: 'var(--text-on-light-tertiary)' }}>
            Your Boult brief
          </p>
        </div>
        <button className="boult-btn boult-btn-ghost" onClick={onGenerate} disabled={loading}>
          {loading ? <span className="boult-spinner boult-spinner-small" /> : 'Generate New Brief'}
        </button>
      </div>

      <div style={{ height: 1, background: 'rgba(0,0,0,0.08)', marginBottom: 'var(--space-8)' }} />

      {/* Main Glass Document */}
      <div className="glass-surface" style={{ padding: 'var(--space-10)', position: 'relative', minHeight: 400 }}>
        {loading ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: 'var(--font-content)', fontSize: 'var(--text-md)', color: 'var(--text-on-dark-tertiary)' }} className="boult-pulse">
              Boult is thinking about your week…
            </span>
          </div>
        ) : brief ? (
          <>
            {/* Critical Path */}
            <section style={{ marginBottom: 'var(--space-12)' }}>
              <h4 className="boult-brief-section-label">Critical Path</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
                {brief.criticalPath.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 'var(--space-6)', alignItems: 'baseline' }}>
                    <span style={{ fontFamily: 'var(--font-content)', fontSize: 'var(--text-xl)', color: 'var(--text-on-dark-tertiary)', minWidth: 32 }}>
                      {idx + 1}
                    </span>
                    <div>
                      <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-on-dark-primary)', lineHeight: 1.6 }}>
                        {item.item}
                      </div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-on-dark-secondary)', marginTop: 4 }}>
                        {item.reason}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Risks */}
            <section style={{ marginBottom: 'var(--space-12)' }}>
              <h4 className="boult-brief-section-label">Risks</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {brief.risks.map((risk, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.04)' }}>
                    <span className={`boult-badge boult-badge-${risk.severity}`}>
                      {risk.severity.toUpperCase()}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-on-dark-primary)' }}>{risk.risk}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-on-dark-tertiary)', marginTop: 2 }}>{risk.suggestion}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Focus Blocks & Drop */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-10)' }}>
              <section>
                <h4 className="boult-brief-section-label">Focus Blocks</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {brief.suggestedFocusBlocks.map((block, idx) => (
                    <div key={idx} style={{ borderLeft: '2px solid rgba(255,255,255,0.1)', paddingLeft: 'var(--space-4)' }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-on-dark-primary)' }}>
                        {block.day} · {block.timeRange}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-on-dark-secondary)', marginTop: 2 }}>
                        {block.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="boult-brief-section-label">One Thing to Drop</h4>
                <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'rgba(248,113,113,0.08)', border: '0.5px solid rgba(248,113,113,0.15)' }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-danger)' }}>
                    {brief.oneThingToDropOrDelegate.item}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-on-dark-secondary)', marginTop: 4 }}>
                    {brief.oneThingToDropOrDelegate.reasoning}
                  </div>
                </div>
              </section>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 'var(--space-16)' }}>
             <h2 style={{ fontFamily: 'var(--font-content)', fontSize: 'var(--text-lg)', color: 'var(--text-on-dark-primary)', marginBottom: 'var(--space-2)' }}>No brief yet.</h2>
             <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-on-dark-secondary)', marginBottom: 'var(--space-6)' }}>
               Boult generates your morning brief at 7AM, or you can run it now.
             </p>
             <button className="boult-btn boult-btn-primary" onClick={onGenerate}>Generate brief</button>
          </div>
        )}
      </div>
    </div>
  );
}

