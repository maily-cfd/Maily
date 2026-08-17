'use client';
/**
 * PlanModeBrief — Editorial Morning Briefing
 * 
 * Styled as a premium document with Fraunces typography.
 * Summarizes the daily critical path for the user.
 */
import React from 'react';
import '../boult-tokens.css';

interface BriefItem {
  id: string;
  text: string;
  reason: string;
}

export interface BriefData {
  date: string;
  critical_path: BriefItem[];
  high_priority: BriefItem[];
  low_priority: BriefItem[];
}

interface PlanModeBriefProps {
  brief: BriefData | null;
  onGenerate: () => void;
  loading: boolean;
}

export function PlanModeBrief({ brief, onGenerate, loading }: PlanModeBriefProps) {
  if (loading) {
    return (
      <div className="boult-brief-loading">
        <div className="boult-brief-loading-text">Architecting your morning briefing...</div>
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="boult-empty">
        <h2 className="boult-empty-headline">Start your day with a deep-reasoning pass.</h2>
        <p className="boult-empty-subline">
          Boult will analyze your calendar, Slack, and documents to build your critical path.
        </p>
        <button className="boult-btn-primary" onClick={onGenerate}>
          Generate Morning Brief
        </button>
      </div>
    );
  }

  return (
    <div className="boult-brief-container">
      <header className="boult-brief-header">
        <h1 className="boult-brief-date">{brief.date}</h1>
        <div className="boult-brief-subtitle">Daily Critical Path Analysis</div>
      </header>

      <div className="boult-brief-separator" />

      {/* Critical Path */}
      {brief.critical_path?.length > 0 && (
        <section className="boult-brief-section">
          <div className="boult-brief-section-label">Critical Path</div>
          {brief.critical_path.map((item, idx) => (
            <div key={item.id || idx} className="boult-brief-item">
              <div className="boult-brief-item-number">{idx + 1}</div>
              <div className="boult-brief-item-content">
                <div className="boult-brief-item-text">{item.text}</div>
                <div className="boult-brief-item-reason">{item.reason}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* High Priority */}
      {brief.high_priority?.length > 0 && (
        <section className="boult-brief-section">
          <div className="boult-brief-section-label">High Priority</div>
          {brief.high_priority.map((item, idx) => (
            <div key={item.id || idx} className="boult-brief-item">
              <div className="boult-brief-item-number" style={{ color: 'var(--text-on-dark-disabled)' }}>{idx + 1}</div>
              <div className="boult-brief-item-content">
                <div className="boult-brief-item-text" style={{ fontSize: 'var(--text-sm)' }}>{item.text}</div>
                <div className="boult-brief-item-reason" style={{ fontSize: 'var(--text-xs)' }}>{item.reason}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-12)' }}>
        <button className="boult-btn-ghost" onClick={onGenerate}>
          Refresh Analysis
        </button>
      </div>
    </div>
  );
}

export default PlanModeBrief;
