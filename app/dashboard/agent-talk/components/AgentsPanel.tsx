'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  Plus, Clock, Mail, Zap, Loader2, X, Slack,
  MoreHorizontal, AlertCircle, ChevronDown, Edit2, Trash2, Play,
  List, CalendarDays, ChevronLeft, ChevronRight, Compass, ShieldCheck,
  Check, ExternalLink, Calendar as CalendarIcon, Database,
  Sunrise, DollarSign, Target, BarChart3, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import AutonomyPanel from '@/components/ui/autonomy-panel';
import { cleanRunSummary } from '@/lib/boult/report-summary';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  task_description: string;
  cron_schedule: string;
  output_channel: 'gmail' | 'slack' | 'both';
  slack_channel: string | null;
  status: 'active' | 'paused' | 'running';
  skip_confirmations: boolean;
  expires_at: string | null;
  last_run_at: string | null;
  last_report_summary: string | null;
  created_at: string;
  // Next-gen scheduling (optional — absent = classic schedule agent).
  trigger_type?: 'schedule' | 'event' | 'condition' | 'chained';
  conditions?: Array<{ field: string; op: string; value: string | number | string[] }>;
  pipeline?: string[];
  // Super-agent (optional).
  mission?: { objective?: string; successCriteria?: string[] } | null;
  autonomy_level?: 'observe' | 'assist' | 'own' | null;
}

/** Human "how this fires" label for an agent row — schedule cadence, event
 *  condition, or pipeline. Falls back to the cron label for classic agents. */
function triggerLabel(agent: Pick<Agent, 'trigger_type' | 'conditions' | 'cron_schedule'>): string {
  const t = agent.trigger_type || 'schedule';
  if (t === 'event' || t === 'condition') {
    const conds = agent.conditions || [];
    if (!conds.length) return 'On every new email';
    const c = conds[0];
    const head = `${c.field} ${c.op} "${c.value}"`;
    return conds.length > 1 ? `When ${head} +${conds.length - 1}` : `When ${head}`;
  }
  if (t === 'chained') return 'Triggered by a pipeline';
  return cronToLabel(agent.cron_schedule);
}

// One row from boult_agent_runs — populated by the cron runner on every
// scheduled attempt. The RecentRuns subcomponent below lazy-loads up to 7 of
// these per agent the first time the card is expanded.
interface ArtifactLink { label: string; url: string }
interface AgentRun {
  id: string;
  agent_id: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status: 'running' | 'success' | 'partial' | 'blocked' | 'error' | 'transient_error';
  tool_calls: number | null;
  report_summary: string | null;
  outcome_summary?: string | null;
  error_message: string | null;
  email_delivery: 'sent' | 'failed' | 'skipped' | null;
  slack_delivery: 'sent' | 'failed' | 'skipped' | null;
  artifact_links: {
    gmail?: ArtifactLink[];
    calendar?: ArtifactLink[];
    notion?: ArtifactLink[];
    slack?: ArtifactLink[];
  } | null;
  plan: string | null;
  report_full?: string | null;
}

// ── Cron helpers ───────────────────────────────────────────────────────────────

function cronToLabel(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [minStr, hourStr, , , dowStr] = parts;
  if (hourStr.startsWith('*/')) return hourStr === '*/1' ? 'Every hour' : `Every ${hourStr.split('/')[1]}h`;
  const h = hourStr.padStart(2, '0');
  const m = minStr.padStart(2, '0');
  const time = `${h}:${m}`;
  if (dowStr === '*') return `Daily at ${time}`;
  if (dowStr === '0') return `Sundays at ${time}`;
  if (dowStr === '1-5') return `Weekdays at ${time}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (!isNaN(parseInt(dowStr))) return `${days[parseInt(dowStr)]}s at ${time}`;
  return cron;
}

function getNextRunDate(cron: string): Date {
  const now = new Date();
  const parts = cron.split(' ');
  if (parts.length !== 5) return new Date(now.getTime() + 86400000);
  const [minStr, hourStr, , , dowStr] = parts;
  if (hourStr.startsWith('*/')) {
    const interval = parseInt(hourStr.split('/')[1]) || 1;
    const next = new Date(now);
    next.setMinutes(parseInt(minStr) || 0, 0, 0);
    if (next <= now) next.setHours(next.getHours() + interval);
    return next;
  }
  const tH = parseInt(hourStr) || 0;
  const tM = parseInt(minStr) || 0;
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), tH, tM, 0);
  if (dowStr === '*') return candidate > now ? candidate : new Date(candidate.getTime() + 86400000);
  if (dowStr === '1-5') {
    let next = candidate > now ? candidate : new Date(candidate.getTime() + 86400000);
    for (let i = 0; i < 7; i++) { if (next.getDay() >= 1 && next.getDay() <= 5) return next; next = new Date(next.getTime() + 86400000); }
    return next;
  }
  const targetDow = parseInt(dowStr) || 0;
  const daysUntil = (targetDow - now.getDay() + 7) % 7 || (candidate <= now ? 7 : 0);
  const next = new Date(candidate);
  next.setDate(next.getDate() + daysUntil);
  return next;
}

function formatNextRun(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatRunDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ── Calendar helpers ───────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function getAgentRunsInMonth(agent: Agent, year: number, month: number): Date[] {
  const dates: Date[] = [];
  const parts = agent.cron_schedule.split(' ');
  if (parts.length !== 5) return dates;
  const [minStr, hourStr, , , dowStr] = parts;
  const tH = hourStr.startsWith('*/') ? 0 : (parseInt(hourStr) || 0);
  const tM = parseInt(minStr) || 0;
  const interval = hourStr.startsWith('*/') ? parseInt(hourStr.split('/')[1]) || 1 : 0;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(year, month, day).getDay();
    let match = false;
    if (dowStr === '*') match = true;
    else if (dowStr === '0' && dow === 0) match = true;
    else if (dowStr === '1-5' && dow >= 1 && dow <= 5) match = true;
    else if (!isNaN(parseInt(dowStr)) && parseInt(dowStr) === dow) match = true;
    if (!match) continue;
    if (interval > 0) {
      dates.push(new Date(year, month, day, 0, tM, 0));
    } else {
      dates.push(new Date(year, month, day, tH, tM, 0));
    }
  }
  return dates;
}

function MiniCalendar({ agents, onAgentClick }: { agents: Agent[]; onAgentClick: (a: Agent) => void }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const cells: Array<{ day: number | null; runs: Array<{ agent: Agent; date: Date }> }> = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: null, runs: [] });
  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(viewYear, viewMonth, d);
    const runs: Array<{ agent: Agent; date: Date }> = [];
    if (cellDate >= todayStart) {
      for (const agent of agents) {
        const expiry = agent.expires_at
          ? (() => { const [y, mo, dy] = agent.expires_at!.split('T')[0].split('-').map(Number); return new Date(y, mo - 1, dy); })()
          : null;
        if (expiry && cellDate > expiry) continue;
        for (const runDate of getAgentRunsInMonth(agent, viewYear, viewMonth)) {
          if (runDate.getDate() === d) runs.push({ agent, date: runDate });
        }
      }
    }
    cells.push({ day: d, runs: runs.slice(0, 2) });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, runs: [] });

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  return (
    <div className="flex flex-col gap-3">
      {/* Nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button onClick={prevMonth} className="w-8 h-8 flex items-center justify-center rounded-lg text-boult-fg-muted hover:text-boult-fg hover:bg-boult-surface border border-boult-surface hover:border-boult-raised transition-all duration-150">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[14px] font-extrabold text-boult-fg min-w-[130px] text-center tracking-tight">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <button onClick={nextMonth} className="w-8 h-8 flex items-center justify-center rounded-lg text-boult-fg-muted hover:text-boult-fg hover:bg-boult-surface border border-boult-surface hover:border-boult-raised transition-all duration-150">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }}
          className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-boult-fg-secondary border border-boult-surface bg-boult-surface hover:border-boult-raised hover:text-boult-fg transition-all duration-150"
        >
          Today
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-boult-border/60 pb-1.5">
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-boult-fg-muted py-1">{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div
        className="grid grid-cols-7 border border-boult-border rounded-xl overflow-hidden bg-boult-elevated"
        style={{ gridTemplateRows: `repeat(${cells.length / 7}, minmax(72px, 1fr))` }}
      >
        {cells.map((cell, idx) => {
          const isToday = cell.day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
          const isPast = cell.day !== null && new Date(viewYear, viewMonth, cell.day) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
          return (
            <div
              key={idx}
              className={cn(
                'flex flex-col p-1.5 border-r border-b border-boult-border/60 overflow-hidden transition-colors duration-150 group/cell',
                cell.day === null
                  ? 'bg-boult-bg'
                  : isToday
                    ? 'bg-boult-surface/40'
                    : 'bg-boult-elevated/20 hover:bg-boult-surface/25',
                idx % 7 === 6 && 'border-r-0',
              )}
            >
              {cell.day !== null && (
                <>
                  <div className={cn(
                    'w-6 h-6 flex items-center justify-center text-[11px] font-bold rounded-full self-end mb-1 flex-shrink-0 transition-colors',
                    isToday
                      ? 'bg-zinc-100 text-zinc-950 shadow-sm shadow-white/10'
                      : isPast
                        ? 'text-boult-fg-muted'
                        : 'text-boult-fg-muted group-hover/cell:text-boult-fg-secondary',
                  )}>
                    {cell.day}
                  </div>
                  {cell.runs.map(({ agent }, ri) => (
                    <button
                      key={ri}
                      onClick={() => onAgentClick(agent)}
                      className="w-full text-left rounded px-1.5 py-0.5 border border-boult-divider/80 bg-boult-surface/90 hover:bg-boult-raised hover:border-boult-divider transition-all duration-150 mb-0.5"
                    >
                      <p className="text-[9px] font-medium text-boult-fg-secondary truncate leading-normal">{agent.name}</p>
                    </button>
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Schedule helpers ───────────────────────────────────────────────────────────

const SCHEDULE_PATTERNS = [
  { label: 'Every day',  key: 'daily',   needsTime: true,  needsDay: false },
  { label: 'Every hour', key: 'hourly',  needsTime: false, needsDay: false },
  { label: 'Weekdays',   key: 'weekday', needsTime: true,  needsDay: false },
  { label: 'Weekly',     key: 'weekly',  needsTime: true,  needsDay: true  },
  { label: 'Custom',     key: 'custom',  needsTime: false, needsDay: false },
];

const WEEK_DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((l, i) => ({ label: l, value: String(i) }));

function buildCron(key: string, time: string, weekday: string): string {
  const [h, m] = time.split(':').map(s => parseInt(s, 10));
  const hh = isNaN(h) ? 7 : h;
  const mm = isNaN(m) ? 0 : m;
  if (key === 'daily')   return `${mm} ${hh} * * *`;
  if (key === 'hourly')  return `0 */1 * * *`;
  if (key === 'weekday') return `${mm} ${hh} * * 1-5`;
  if (key === 'weekly')  return `${mm} ${hh} * * ${weekday}`;
  return '';
}

function parseCronToSchedule(cron: string) {
  if (!cron || cron === '0 */1 * * *') return { key: 'hourly', time: '07:00', weekday: '0' };
  const parts = cron.split(' ');
  if (parts.length !== 5) return { key: 'custom', time: '07:00', weekday: '0' };
  const [mm, hh, , , dow] = parts;
  const time = `${String(parseInt(hh) || 0).padStart(2, '0')}:${String(parseInt(mm) || 0).padStart(2, '0')}`;
  if (dow === '1-5') return { key: 'weekday', time, weekday: '1' };
  if (dow !== '*' && !dow.includes('/')) return { key: 'weekly', time, weekday: dow };
  return { key: 'daily', time, weekday: '0' };
}


// ── Toggle ─────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(); }}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none cursor-pointer',
        checked ? 'bg-zinc-900 dark:bg-zinc-600' : 'bg-zinc-200 dark:bg-zinc-800',
      )}
    >
      <span className={cn(
        'inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out',
        checked ? 'translate-x-5' : 'translate-x-0',
      )} />
    </button>
  );
}

// ── Templates ──────────────────────────────────────────────────────────────────

// Curated agent templates — fetched from /api/boult/agents/templates so
// the catalog stays a single source of truth. We keep a thin offline
// fallback list so the dashboard still renders if the API is unreachable.
import { AGENT_TEMPLATES as CURATED_AGENT_TEMPLATES, type AgentTemplate as CuratedAgentTemplate } from '@/lib/boult/agent-templates';

interface UITemplate {
  id?: string;
  emoji?: string;
  name: string;
  description: string;
  tagline?: string;
  cron_schedule: string;
  output_channel: 'gmail' | 'slack' | 'both';
  task_description: string;
  skip_confirmations?: boolean;
}

function curatedToUITemplate(t: CuratedAgentTemplate): UITemplate {
  return {
    id: t.id,
    emoji: t.emoji,
    name: t.name,
    description: t.description,
    tagline: t.tagline,
    cron_schedule: t.cronSchedule,
    output_channel: t.outputChannel,
    task_description: t.taskDescription,
    skip_confirmations: t.skipConfirmations,
  };
}

const TEMPLATES: UITemplate[] = CURATED_AGENT_TEMPLATES.map(curatedToUITemplate);

function getTemplateIcon(id?: string) {
  const iconProps = { className: "w-4 h-4 text-boult-fg-secondary" };
  switch (id) {
    case 'morning_inbox_sweep':
      return <Sunrise {...iconProps} />;
    case 'deal_pipeline_tracker':
      return <DollarSign {...iconProps} />;
    case 'meeting_prep_concierge':
      return <CalendarIcon {...iconProps} />;
    case 'weekly_executive_brief':
      return <BarChart3 {...iconProps} />;
    case 'vip_auto_responder':
      return <Zap {...iconProps} />;
    case 'stalled_deal_chaser':
      return <Target {...iconProps} />;
    case 'triage_draft_digest':
      return <Layers {...iconProps} />;
    default:
      return <Clock {...iconProps} />;
  }
}

function PremiumDatePicker({ value, onChange, minDate }: {
  value: string;
  onChange: (val: string) => void;
  minDate?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const today = new Date();
  
  const selectedDate = value ? (() => {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  })() : null;

  const [viewYear, setViewYear] = useState(selectedDate ? selectedDate.getFullYear() : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate ? selectedDate.getMonth() : today.getMonth());

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
  
  const cells: Array<{ day: number | null; dateStr: string; isCurrentMonth: boolean; isDisabled: boolean }> = [];
  
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const m = viewMonth === 0 ? 11 : viewMonth - 1;
    const y = viewMonth === 0 ? viewYear - 1 : viewYear;
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      day: d,
      dateStr,
      isCurrentMonth: false,
      isDisabled: minDate ? dateStr < minDate : false
    });
  }
  
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      day: d,
      dateStr,
      isCurrentMonth: true,
      isDisabled: minDate ? dateStr < minDate : false
    });
  }
  
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const m = viewMonth === 11 ? 0 : viewMonth + 1;
    const y = viewMonth === 11 ? viewYear + 1 : viewYear;
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      day: d,
      dateStr,
      isCurrentMonth: false,
      isDisabled: minDate ? dateStr < minDate : false
    });
  }

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(v => v - 1);
    } else {
      setViewMonth(v => v - 1);
    }
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(v => v + 1);
    } else {
      setViewMonth(v => v + 1);
    }
  };

  const handlePrevYear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewYear(v => v - 1);
  };

  const handleNextYear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewYear(v => v + 1);
  };

  const handleSelectDay = (cell: typeof cells[0], e: React.MouseEvent) => {
    e.stopPropagation();
    if (cell.isDisabled) return;
    onChange(cell.dateStr);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setIsOpen(false);
  };

  const handleToday = (e: React.MouseEvent) => {
    e.stopPropagation();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (minDate && todayStr < minDate) return;
    onChange(todayStr);
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = () => setIsOpen(false);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [isOpen]);

  const formattedValue = selectedDate ? selectedDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }) : 'Select expiration date...';

  return (
    <div className="relative w-full" onClick={e => e.stopPropagation()}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-[14px] text-zinc-900 flex items-center justify-between cursor-pointer hover:border-zinc-400 transition-all select-none shadow-inner dark:bg-[#121214] dark:border-[#242427] dark:text-zinc-100 dark:hover:border-zinc-700"
      >
        <span className={cn(selectedDate ? 'text-zinc-900 dark:text-zinc-200 font-medium' : 'text-zinc-400 dark:text-zinc-500')}>
          {formattedValue}
        </span>
        <div className="flex items-center gap-2">
          {value && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <CalendarDays className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
        </div>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-white border border-zinc-200 rounded-2xl shadow-2xl p-4.5 z-[100] select-none animate-in fade-in slide-in-from-top-2 duration-150 dark:bg-[#0A0A0C]/90 dark:backdrop-blur-xl dark:border-white/10">
          {/* Header navigation */}
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex gap-1">
              <button onClick={handlePrevYear} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-300 rounded-lg transition-colors text-[10px] font-extrabold font-mono">
                &lt;&lt;
              </button>
              <button onClick={handlePrevMonth} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-300 rounded-lg transition-colors text-[10px] font-extrabold font-mono">
                &lt;
              </button>
            </div>
            
            <span className="text-[13px] font-extrabold text-zinc-800 dark:text-zinc-200 tracking-tight font-sans">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>

            <div className="flex gap-1">
              <button onClick={handleNextMonth} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-300 rounded-lg transition-colors text-[10px] font-extrabold font-mono">
                &gt;
              </button>
              <button onClick={handleNextYear} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-300 rounded-lg transition-colors text-[10px] font-extrabold font-mono">
                &gt;&gt;
              </button>
            </div>
          </div>

          {/* Week headers */}
          <div className="grid grid-cols-7 text-center text-[10px] font-extrabold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-2">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div key={d}>{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, idx) => {
              const isSelected = value === cell.dateStr;
              const isTodayCell = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}` === cell.dateStr;
              return (
                <button
                  key={idx}
                  onClick={(e) => handleSelectDay(cell, e)}
                  disabled={cell.isDisabled}
                  className={cn(
                    'text-[12px] py-1.5 rounded-lg text-center font-bold transition-all',
                    cell.isCurrentMonth ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-300 dark:text-zinc-700',
                    cell.isDisabled && 'text-zinc-100 dark:text-zinc-800/30 cursor-not-allowed hover:bg-transparent',
                    !cell.isDisabled && !isSelected && 'hover:bg-zinc-100 dark:hover:bg-zinc-900/50',
                    isTodayCell && !isSelected && 'border border-zinc-300 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100',
                    isSelected && 'bg-black text-white dark:bg-zinc-100 dark:text-zinc-950 font-bold shadow-md shadow-black/5 dark:shadow-white/5'
                  )}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {/* Footer action links */}
          <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-900 mt-3 pt-2.5">
            <button onClick={handleClear} className="text-[11px] font-extrabold text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors">
              Clear
            </button>
            <button onClick={handleToday} className="text-[11px] font-extrabold text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors">
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PremiumTimePicker({ value, onChange }: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  
  const [hour24, minuteStr] = value.split(':');
  const initialHour = parseInt(hour24) || 0;
  const initialMinute = parseInt(minuteStr) || 0;
  
  const initialPeriod = initialHour >= 12 ? 'PM' : 'AM';
  const initialHour12 = initialHour % 12 === 0 ? 12 : initialHour % 12;

  const [selectedHour, setSelectedHour] = useState(initialHour12);
  const [selectedMinute, setSelectedMinute] = useState(initialMinute);
  const [selectedPeriod, setSelectedPeriod] = useState<'AM'|'PM'>(initialPeriod);

  useEffect(() => {
    const [h24, mStr] = value.split(':');
    const h = parseInt(h24) || 0;
    const m = parseInt(mStr) || 0;
    setSelectedHour(h % 12 === 0 ? 12 : h % 12);
    setSelectedMinute(m);
    setSelectedPeriod(h >= 12 ? 'PM' : 'AM');
  }, [value]);

  const updateTime = (h12: number, m: number, p: 'AM'|'PM') => {
    let h24 = h12 % 12;
    if (p === 'PM') h24 += 12;
    const timeStr = `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    onChange(timeStr);
  };

  const handleHourSelect = (h: number) => {
    setSelectedHour(h);
    updateTime(h, selectedMinute, selectedPeriod);
  };

  const handleMinuteSelect = (m: number) => {
    setSelectedMinute(m);
    updateTime(selectedHour, m, selectedPeriod);
  };

  const handlePeriodSelect = (p: 'AM'|'PM') => {
    setSelectedPeriod(p);
    updateTime(selectedHour, selectedMinute, p);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClose = () => setIsOpen(false);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, [isOpen]);

  const displayString = `${String(selectedHour).padStart(2, '0')}:${String(selectedMinute).padStart(2, '0')} ${selectedPeriod}`;

  return (
    <div className="relative w-full" onClick={e => e.stopPropagation()}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-[14px] text-zinc-900 flex items-center justify-between cursor-pointer hover:border-zinc-400 transition-all select-none shadow-inner dark:bg-[#121214] dark:border-[#242427] dark:text-zinc-100 dark:hover:border-zinc-700"
      >
        <span className="text-zinc-900 dark:text-zinc-200 font-bold font-mono">
          {displayString}
        </span>
        <Clock className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
      </div>

      {isOpen && (
        <div className="absolute top-full right-0 lg:left-0 mt-2 w-64 bg-white border border-zinc-200 rounded-2xl shadow-2xl p-4 z-[100] select-none animate-in fade-in slide-in-from-top-2 duration-150 flex gap-3 dark:bg-[#0A0A0C]/90 dark:backdrop-blur-xl dark:border-white/10">
          {/* Hours Column */}
          <div className="flex-1 flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-extrabold mb-2">Hour</span>
            <div className="h-40 overflow-y-auto w-full custom-scroll space-y-1">
              {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => (
                <button
                  key={h}
                  onClick={() => handleHourSelect(h)}
                  className={cn(
                    "w-full text-center py-1 rounded-lg text-[13px] font-bold transition-all",
                    selectedHour === h
                      ? "bg-black text-white dark:bg-zinc-100 dark:text-zinc-950 font-bold"
                      : "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-200"
                  )}
                >
                  {String(h).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>

          {/* Minutes Column */}
          <div className="flex-1 flex flex-col items-center border-l border-zinc-100 dark:border-zinc-900/80 pl-2">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-extrabold mb-2">Min</span>
            <div className="h-40 overflow-y-auto w-full custom-scroll space-y-1">
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                <button
                  key={m}
                  onClick={() => handleMinuteSelect(m)}
                  className={cn(
                    "w-full text-center py-1 rounded-lg text-[13px] font-bold transition-all",
                    selectedMinute === m
                      ? "bg-black text-white dark:bg-zinc-100 dark:text-zinc-950 font-bold"
                      : "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-200"
                  )}
                >
                  {String(m).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>

          {/* AM/PM Column */}
          <div className="w-14 flex flex-col items-center border-l border-zinc-100 dark:border-zinc-900/80 pl-2">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-extrabold mb-2">Period</span>
            <div className="flex flex-col gap-1.5 w-full">
              {(['AM', 'PM'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => handlePeriodSelect(p)}
                  className={cn(
                    "w-full text-center py-2.5 rounded-lg text-[12px] font-extrabold transition-all",
                    selectedPeriod === p
                      ? "bg-black text-white dark:bg-zinc-100 dark:text-zinc-950 font-bold"
                      : "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-200"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create / Edit Modal ────────────────────────────────────────────────────────

function CreateModal({ onClose, onSave, initial }: {
  onClose: () => void;
  onSave: (data: Partial<Agent> & { _timezone?: string }) => Promise<void>;
  initial?: Partial<Agent>;
}) {
  const parsed = initial?.cron_schedule ? parseCronToSchedule(initial.cron_schedule) : { key: 'daily', time: '07:00', weekday: '0' };
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [name, setName] = useState(initial?.name || '');
  const [task, setTask] = useState(initial?.task_description || '');
  const [patternKey, setPatternKey] = useState(parsed.key);
  const [scheduleTime, setScheduleTime] = useState(parsed.time);
  const [scheduleWeekday, setScheduleWeekday] = useState(parsed.weekday);
  const [customCron, setCustomCron] = useState(patternKey === 'custom' ? (initial?.cron_schedule || '') : '');
  const [channel, setChannel] = useState<'gmail'|'slack'|'both'>(initial?.output_channel || 'gmail');
  const [slackCh, setSlackCh] = useState(initial?.slack_channel || '');
  const [skipConf, setSkipConf] = useState(initial?.skip_confirmations ?? false);
  const [hasExpiry, setHasExpiry] = useState(!!initial?.expires_at);
  const [expiresAt, setExpiresAt] = useState(initial?.expires_at ? initial.expires_at.split('T')[0] : '');
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const activePat = SCHEDULE_PATTERNS.find(p => p.key === patternKey) || SCHEDULE_PATTERNS[0];
  const cron = patternKey === 'custom' ? customCron : buildCron(patternKey, scheduleTime, scheduleWeekday);
  const todayStr = new Date().toISOString().split('T')[0];

  const handleSave = async () => {
    if (!task.trim()) { toast.error('Describe what you want Boult to do.'); return; }
    if (hasExpiry && !expiresAt) { toast.error('Pick an expiration date or disable expiration.'); return; }
    setSaving(true);
    try {
      const agentName = name.trim() || task.trim().slice(0, 40) + (task.trim().length > 40 ? '…' : '');
      await onSave({ name: agentName, task_description: task.trim(), cron_schedule: cron || '0 7 * * *', output_channel: channel, slack_channel: channel !== 'gmail' ? slackCh || null : null, skip_confirmations: skipConf, expires_at: hasExpiry && expiresAt ? expiresAt : null, _timezone: browserTz });
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-4xl bg-white dark:bg-[#0A0A0C] border border-zinc-200 dark:border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden max-h-[95vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-7 pb-5 border-b border-zinc-200 dark:border-zinc-900/60 flex-shrink-0">
          <div>
            <h2 className="text-[20px] font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight">{initial?.id ? 'Edit schedule' : 'New schedule'}</h2>
            <p className="text-[14px] text-zinc-555 mt-1">Describe the job and when to run it</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#121214] border border-transparent hover:border-zinc-200 dark:hover:border-zinc-900 transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-8 py-6 overflow-y-auto custom-scroll flex-1 bg-transparent">
          <style dangerouslySetInnerHTML={{ __html: `
            .custom-scroll {
              scrollbar-width: thin;
              scrollbar-color: rgba(161,161,170,0.35) transparent;
            }
            .dark .custom-scroll {
              scrollbar-color: rgba(63,63,70,0.4) transparent;
            }
            .custom-scroll::-webkit-scrollbar {
              width: 5px;
              height: 5px;
            }
            .custom-scroll::-webkit-scrollbar-track {
              background: transparent;
            }
            .custom-scroll::-webkit-scrollbar-thumb {
              background: rgba(161,161,170,0.35);
              border-radius: 9999px;
            }
            .custom-scroll::-webkit-scrollbar-thumb:hover {
              background: rgba(113,113,122,0.5);
            }
            .dark .custom-scroll::-webkit-scrollbar-thumb {
              background: rgba(63,63,70,0.4);
            }
            .dark .custom-scroll::-webkit-scrollbar-thumb:hover {
              background: rgba(82,82,91,0.6);
            }
          `}} />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Task & Name */}
            <div className="lg:col-span-7 space-y-6">
              {/* Task description */}
              <div>
                <label className="block text-[13px] font-bold text-zinc-600 dark:text-zinc-400 mb-2">What should Boult do?</label>
                <textarea
                  value={task}
                  onChange={e => setTask(e.target.value)}
                  placeholder="Describe what you want this agent to do in plain English…"
                  rows={8}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] text-zinc-900 leading-relaxed placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 transition-all resize-none animate-none dark:bg-[#121214] dark:border-[#242427] dark:text-zinc-100 dark:placeholder:text-zinc-650 dark:focus:border-zinc-700"
                />
              </div>

              {/* Optional name */}
              <div>
                <label className="block text-[13px] font-bold text-zinc-600 dark:text-zinc-400 mb-2">Agent name <span className="font-normal text-zinc-400 dark:text-zinc-555">(optional)</span></label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Morning Client Check"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 transition-all dark:bg-[#121214] dark:border-[#242427] dark:text-zinc-100 dark:placeholder:text-zinc-655 dark:focus:border-zinc-700"
                />
              </div>
            </div>

            {/* Right Column: Schedule & Deliver & Confirmations */}
            <div className="lg:col-span-5 space-y-6">
              {/* Schedule */}
              <div>
                <label className="block text-[13px] font-bold text-zinc-600 dark:text-zinc-400 mb-2">Schedule</label>
                <div className="flex flex-wrap gap-2 mb-4">
                  {SCHEDULE_PATTERNS.map(p => (
                    <button
                      key={p.key}
                      onClick={() => setPatternKey(p.key)}
                      className={cn(
                        'px-3.5 py-1.5 rounded-lg text-[13px] font-bold transition-all border',
                        patternKey === p.key
                          ? 'bg-black text-white border-black dark:bg-zinc-100 dark:text-zinc-950 dark:border-zinc-100 shadow-sm'
                          : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:bg-[#121214] dark:border-[#242427] dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {activePat.needsTime && (
                  <div className="flex gap-4 mb-4">
                    {activePat.needsDay && (
                      <div className="flex-1">
                        <label className="block text-[11px] font-bold text-zinc-400 dark:text-zinc-555 mb-1.5">Day</label>
                        <select
                          value={scheduleWeekday}
                          onChange={e => setScheduleWeekday(e.target.value)}
                          className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-[14px] text-zinc-900 focus:outline-none focus:border-zinc-400 transition-all appearance-none cursor-pointer font-bold dark:bg-[#121214] dark:border-[#242427] dark:text-zinc-100 dark:focus:border-zinc-700"
                        >
                          {WEEK_DAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                      </div>
                    )}
                    <div className={activePat.needsDay ? 'flex-1' : 'w-full'}>
                      <label className="block text-[11px] font-bold text-zinc-400 dark:text-zinc-500 mb-1.5">Time <span className="font-normal text-zinc-500 dark:text-zinc-600">({browserTz})</span></label>
                      <PremiumTimePicker
                        value={scheduleTime}
                        onChange={setScheduleTime}
                      />
                    </div>
                  </div>
                )}

                {patternKey === 'custom' && (
                  <div className="mb-4">
                    <label className="block text-[11px] font-bold text-zinc-400 dark:text-zinc-555 mb-1.5">Cron expression (UTC)</label>
                    <input
                      value={customCron}
                      onChange={e => setCustomCron(e.target.value)}
                      placeholder="e.g. 0 9 * * 1-5"
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-[14px] text-zinc-900 font-mono placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 transition-all dark:bg-[#121214] dark:border-[#242427] dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-700"
                    />
                  </div>
                )}

                {cron && patternKey !== 'custom' && (
                  <div className="px-4 py-3 bg-zinc-50 rounded-xl border border-zinc-200 dark:bg-[#121214]/60 dark:border-zinc-900">
                    <p className="text-[13px] text-zinc-600 dark:text-zinc-400">
                      Runs: <span className="text-zinc-900 dark:text-zinc-200 font-bold">{cronToLabel(cron)}</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Output channel */}
              <div>
                <label className="block text-[13px] font-bold text-zinc-600 dark:text-zinc-400 mb-2">Deliver report to</label>
                <div className="flex gap-2">
                  {(['gmail', 'slack', 'both'] as const).map(ch => (
                    <button
                      key={ch}
                      onClick={() => setChannel(ch)}
                      className={cn(
                        'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[14px] font-bold border transition-all',
                        channel === ch
                          ? 'bg-black text-white border-black dark:bg-zinc-100 dark:text-zinc-950 dark:border-zinc-100 shadow-sm'
                          : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:bg-[#121214] dark:border-[#242427] dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200',
                      )}
                    >
                      {ch === 'gmail' && <Mail className="w-3.5 h-3.5" />}
                      {ch === 'slack' && <Slack className="w-3.5 h-3.5" />}
                      {ch === 'both' && <Zap className="w-3.5 h-3.5" />}
                      {ch === 'both' ? 'Both' : ch.charAt(0).toUpperCase() + ch.slice(1)}
                    </button>
                  ))}
                </div>
                {channel !== 'gmail' && (
                  <input
                    value={slackCh}
                    onChange={e => setSlackCh(e.target.value)}
                    placeholder="Slack channel (e.g. #reports)"
                    className="mt-3 w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 transition-all dark:bg-[#121214] dark:border-[#242427] dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-700"
                  />
                )}
              </div>

              {/* Skip confirmations */}
              <div className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 dark:bg-[#121214] dark:border-zinc-900">
                <div>
                  <p className="text-[14px] font-bold text-zinc-900 dark:text-zinc-100">Skip confirmations</p>
                  <p className="text-[12px] text-zinc-500 dark:text-zinc-550 mt-0.5">No approval needed before execution</p>
                </div>
                <Toggle checked={skipConf} onChange={() => setSkipConf(v => !v)} />
              </div>

              {/* Expiration date */}
              <div>
                <div className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 mb-2 dark:bg-[#121214] dark:border-zinc-900">
                  <div>
                    <p className="text-[14px] font-bold text-zinc-900 dark:text-zinc-100">Expiration date</p>
                    <p className="text-[12px] text-zinc-500 dark:text-zinc-550 mt-0.5">Agent stops running after this date</p>
                  </div>
                  <Toggle checked={hasExpiry} onChange={() => { setHasExpiry(v => !v); if (hasExpiry) setExpiresAt(''); }} />
                </div>
                {hasExpiry && (
                  <PremiumDatePicker
                    value={expiresAt}
                    onChange={setExpiresAt}
                    minDate={todayStr}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-6 mt-6 border-t border-zinc-200 dark:border-zinc-900/60">
            <button onClick={onClose} className="flex-1 py-3.5 rounded-xl text-[15px] font-bold text-zinc-600 bg-zinc-50 hover:bg-zinc-100 transition-all border border-zinc-200 dark:text-zinc-400 dark:bg-[#121214] dark:hover:bg-zinc-900 dark:border-[#242427]">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !task.trim()}
              className="flex-1 py-3.5 rounded-xl text-[15px] font-extrabold text-white bg-black hover:bg-zinc-900 dark:text-zinc-950 dark:bg-zinc-100 dark:hover:bg-white active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create schedule'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

// ── Agent Card ─────────────────────────────────────────────────────────────────

// ── Recent runs (PART 35) ──────────────────────────────────────────────────────
// Lazy-loads up to 7 rows from /api/boult/agents/runs?agentId=... on first
// expand. Renders status pill, when it ran, duration, tool-call count,
// delivery icons, and per-bucket artifact link counts. Each artifact group
// links out to the actual page/event/draft via the URLs the cron runner
// extracted from the report's "All Links" section.

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(ms: number | null): string | null {
  if (ms == null || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${Math.round(sec % 60)}s`;
}

function statusPill(status: AgentRun['status']) {
  const map: Record<AgentRun['status'], { label: string; cls: string; icon: React.ReactNode }> = {
    success:         { label: 'Success',  cls: 'bg-boult-raised text-boult-fg border-boult-divider',           icon: <Check className="w-3 h-3" /> },
    partial:         { label: 'Partial',  cls: 'bg-amber-500/10 text-amber-600 border-amber-500/20',           icon: <AlertCircle className="w-3 h-3" /> },
    blocked:         { label: 'Blocked',  cls: 'bg-rose-500/10 text-rose-600 border-rose-500/20',              icon: <AlertCircle className="w-3 h-3" /> },
    error:           { label: 'Error',    cls: 'bg-boult-raised text-boult-fg-secondary border-boult-divider', icon: <AlertCircle className="w-3 h-3" /> },
    transient_error: { label: 'Retrying', cls: 'bg-boult-raised text-boult-fg-secondary border-boult-divider', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    running:         { label: 'Running',  cls: 'bg-boult-raised text-boult-fg-secondary border-boult-divider', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  };
  const meta = map[status] ?? map.running;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border', meta.cls)}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

function autonomyBadge(level: Agent['autonomy_level']) {
  if (!level || level === 'assist') return null; // assist is the default — don't clutter
  const map = {
    observe: { label: 'Observe', cls: 'bg-boult-raised text-boult-fg-muted border-boult-divider', title: 'Watches and reports — never acts without you' },
    own:     { label: 'Owns it', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', title: 'Acts autonomously and tells you after' },
  } as const;
  const meta = map[level as 'observe' | 'own'];
  if (!meta) return null;
  return (
    <span title={meta.title} className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border uppercase tracking-wide flex-shrink-0', meta.cls)}>
      {meta.label}
    </span>
  );
}

function deliveryIcon(channel: 'email' | 'slack', state: AgentRun['email_delivery']) {
  if (state == null || state === 'skipped') return null;
  const Icon = channel === 'email' ? Mail : Slack;
  const ok = state === 'sent';
  return (
    <span
      title={`${channel} delivery: ${state}`}
      className={cn(
        'inline-flex items-center justify-center w-5 h-5 rounded',
        ok ? 'text-boult-fg' : 'text-boult-fg-muted',
      )}
    >
      <Icon className="w-3 h-3" />
    </span>
  );
}

function ArtifactBucket({
  icon, count, links, label,
}: { icon: React.ReactNode; count: number; links: ArtifactLink[]; label: string }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-boult-fg-secondary bg-boult-raised/60 hover:bg-boult-raised border border-boult-divider/50 hover:border-boult-divider transition-colors"
        title={`${count} ${label}`}
      >
        {icon}
        <span className="font-semibold">{count}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute z-30 left-0 top-7 min-w-[260px] max-w-[360px] bg-white dark:bg-neutral-900 border border-boult-border rounded-xl overflow-hidden shadow-2xl"
          >
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-boult-fg-muted border-b border-boult-divider/60">
              {label} ({count})
            </div>
            <div className="max-h-[220px] overflow-y-auto py-1">
              {links.map((l, i) => (
                <a
                  key={i}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-[12px] text-boult-fg-secondary hover:bg-boult-raised hover:text-boult-fg transition-colors"
                >
                  <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-60" />
                  <span className="truncate">{l.label}</span>
                </a>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const dur = formatDuration(run.duration_ms);
  const links = run.artifact_links ?? {};
  return (
    <div className="px-3 py-3 border-b border-boult-divider/40 last:border-b-0">
      <div className="flex items-center gap-2 flex-wrap">
        {statusPill(run.status)}
        <span className="text-[12px] text-boult-fg-muted">{relativeTime(run.started_at)}</span>
        {dur && <span className="text-[11px] text-boult-fg-muted">· {dur}</span>}
        {typeof run.tool_calls === 'number' && run.tool_calls > 0 && (
          <span className="text-[11px] text-boult-fg-muted">· {run.tool_calls} tool {run.tool_calls === 1 ? 'call' : 'calls'}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {deliveryIcon('email', run.email_delivery)}
          {deliveryIcon('slack', run.slack_delivery)}
        </div>
      </div>

      {run.outcome_summary ? (
        <p className="mt-2 text-[12.5px] text-boult-fg leading-relaxed">{run.outcome_summary}</p>
      ) : null}

      {run.plan ? (
        <details className="mt-2 group/plan">
          <summary className="text-[11px] font-semibold text-boult-fg-muted/80 cursor-pointer select-none hover:text-boult-fg-secondary list-none flex items-center gap-1">
            <ChevronDown className="w-3 h-3 transition-transform group-open/plan:rotate-180" />
            Plan
          </summary>
          <p className="mt-1.5 pl-4 text-[11.5px] text-boult-fg-muted/90 leading-relaxed whitespace-pre-line border-l border-boult-divider/50">{run.plan}</p>
        </details>
      ) : null}

      {run.status === 'error' && run.error_message ? (
        <p className="mt-2 text-[12px] text-red-400 leading-relaxed line-clamp-2">{run.error_message}</p>
      ) : run.report_summary ? (
        <p className="mt-2 text-[12px] text-boult-fg-muted leading-relaxed line-clamp-2">{cleanRunSummary(run.report_summary)}</p>
      ) : null}

      {(links.gmail?.length || links.calendar?.length || links.notion?.length || links.slack?.length) ? (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <ArtifactBucket icon={<Mail className="w-3 h-3" />}        count={links.gmail?.length ?? 0}    links={links.gmail ?? []}    label="Gmail" />
          <ArtifactBucket icon={<CalendarIcon className="w-3 h-3" />} count={links.calendar?.length ?? 0} links={links.calendar ?? []} label="Calendar" />
          <ArtifactBucket icon={<Database className="w-3 h-3" />}     count={links.notion?.length ?? 0}   links={links.notion ?? []}   label="Notion" />
          <ArtifactBucket icon={<Slack className="w-3 h-3" />}        count={links.slack?.length ?? 0}    links={links.slack ?? []}    label="Slack" />
        </div>
      ) : null}

      {run.report_full ? (
        <details className="mt-2 group/report">
          <summary className="text-[11px] font-semibold text-boult-fg-muted/80 cursor-pointer select-none hover:text-boult-fg-secondary list-none flex items-center gap-1">
            <ChevronDown className="w-3 h-3 transition-transform group-open/report:rotate-180" />
            Full report
          </summary>
          <div className="mt-1.5 pl-4 border-l border-boult-divider/50 text-[12px] text-boult-fg-secondary leading-relaxed boult-run-report space-y-2">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-boult-fg underline underline-offset-2 hover:opacity-70" />,
                h2: ({ node, ...props }) => <p {...props} className="font-bold text-boult-fg mt-3 first:mt-0" />,
                h3: ({ node, ...props }) => <p {...props} className="font-semibold text-boult-fg mt-2" />,
                ul: ({ node, ...props }) => <ul {...props} className="list-disc pl-4 space-y-0.5" />,
                p: ({ node, ...props }) => <p {...props} className="leading-relaxed" />,
                code: ({ node, ...props }) => <code {...props} className="px-1 py-0.5 rounded bg-boult-raised text-[11px]" />,
              }}
            >
              {run.report_full}
            </ReactMarkdown>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function RecentRuns({ agentId, expanded }: { agentId: string; expanded: boolean }) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!expanded || fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    fetch(`/api/boult/agents/runs?agentId=${encodeURIComponent(agentId)}&limit=7`, {
      signal: controller.signal,
    })
      .then(async r => {
        clearTimeout(timeoutId);
        if (cancelled) return;
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setErr(j.error || `HTTP ${r.status}`); setRuns([]); return; }
        setRuns(Array.isArray(j.runs) ? j.runs : []);
      })
      .catch(e => {
        clearTimeout(timeoutId);
        if (!cancelled) {
          const msg = e.name === 'AbortError' ? 'Request timed out' : String(e?.message || e);
          setErr(msg);
          setRuns([]);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timeoutId); controller.abort(); };
  }, [expanded, agentId]);

  useEffect(() => {
    if (!expanded) fetchedRef.current = false;
  }, [expanded]);

  if (!expanded) return null;

  return (
    <div className="mt-2 border border-boult-divider/50 rounded-xl bg-boult-elevated/40 overflow-hidden">
      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-boult-fg-muted border-b border-boult-divider/40 flex items-center justify-between">
        <span>Recent runs</span>
        {runs && runs.length > 0 && <span className="font-medium normal-case tracking-normal text-boult-fg-muted">last {runs.length}</span>}
      </div>
      {loading && (
        <div className="px-3 py-4 flex items-center gap-2 text-[12px] text-boult-fg-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading run history…
        </div>
      )}
      {err && !loading && (
        <div className="px-3 py-3 text-[12px] text-red-400">Could not load runs: {err}</div>
      )}
      {!loading && !err && runs && runs.length === 0 && (
        <div className="px-3 py-4 text-[12px] text-boult-fg-muted">No runs yet. The first scheduled run will appear here.</div>
      )}
      {!loading && runs && runs.map(r => <RunRow key={r.id} run={r} />)}
    </div>
  );
}

function AgentCard({ agent, onToggle, onEdit, onDelete, onToggleConf, onRunNow }: {
  agent: Agent; onToggle: () => void; onEdit: () => void; onDelete: () => void; onToggleConf: () => void; onRunNow: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const nextRun = getNextRunDate(agent.cron_schedule);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="bg-boult-surface/65 backdrop-blur-xl border border-boult-border rounded-2xl overflow-hidden hover:border-boult-divider transition-all shadow-sm"
    >
      <div className="p-5 pb-4">
        <div className="flex items-start gap-3.5">
          <div className="px-2.5 py-1 rounded-lg text-[11px] font-bold border flex-shrink-0 mt-0.5 bg-boult-raised/60 border-boult-divider/60 text-boult-fg-secondary">
            {(agent.trigger_type === 'event' || agent.trigger_type === 'condition')
              ? 'Event'
              : agent.trigger_type === 'chained'
                ? 'Chain'
                : cronToLabel(agent.cron_schedule).split(' ')[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[15px] font-bold text-boult-fg leading-tight line-clamp-1">{agent.name}</p>
              {autonomyBadge(agent.autonomy_level)}
            </div>
            <p className="text-[13px] text-boult-fg-muted mt-1 leading-relaxed line-clamp-2">{agent.mission?.objective || agent.task_description}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
            <Toggle checked={agent.status !== 'paused'} onChange={onToggle} />
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-boult-fg-muted hover:text-boult-fg hover:bg-boult-raised transition-all"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92, y: -4 }}
                    className="absolute right-0 top-10 w-36 bg-white dark:bg-neutral-900 border border-boult-border rounded-xl overflow-hidden shadow-2xl z-20"
                  >
                    <button
                      onClick={() => { setMenuOpen(false); onRunNow(); }}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[13px] text-boult-fg-secondary hover:bg-boult-raised hover:text-boult-fg transition-all"
                    >
                      <Play className="w-3.5 h-3.5" /> Run now
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); onEdit(); }}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[13px] text-boult-fg-secondary hover:bg-boult-raised hover:text-boult-fg transition-all"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); onDelete(); }}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[13px] text-red-400 hover:bg-red-500/10 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Info rows */}
        <div className="flex items-center gap-6 mt-4 pt-3.5 border-t border-boult-divider/50">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-boult-fg-muted block mb-0.5">
              {(agent.trigger_type && agent.trigger_type !== 'schedule') ? 'Trigger' : 'Schedule'}
            </span>
            <span className="text-[13px] text-boult-fg-secondary font-medium">{triggerLabel(agent)}</span>
          </div>
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-boult-fg-muted block mb-0.5">Next run</span>
            <span className="text-[13px] text-boult-fg-secondary font-medium">{formatNextRun(nextRun)}</span>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1.5">
            <span className={cn(
              'inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold',
              agent.status === 'active'  ? 'bg-boult-raised text-boult-fg-secondary border border-boult-divider/60' :
              agent.status === 'running' ? 'bg-boult-raised text-boult-fg border border-boult-divider' :
              'bg-transparent text-boult-fg-muted border border-boult-divider',
            )}>
              {agent.status === 'running' ? 'Running…' : agent.status === 'active' ? 'Active' : 'Paused'}
            </span>
            {agent.expires_at && (
              <span className="text-[11px] text-boult-fg-muted">
                Expires {new Date(agent.expires_at + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
          </div>
        </div>

        {/* Recent runs expandable — lazy-loads up to 7 rows on first expand. */}
        <div className="mt-3">
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1.5 text-[12px] text-boult-fg-muted hover:text-boult-fg-secondary transition-colors"
          >
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-180')} />
            {agent.last_run_at
              ? <>Recent runs <span className="text-boult-fg-muted/70">· last {formatRunDate(agent.last_run_at)}</span></>
              : <>Recent runs <span className="text-boult-fg-muted/70">· none yet</span></>}
          </button>
          <RecentRuns agentId={agent.id} expanded={expanded} />
        </div>
      </div>

      {/* Skip confirmations */}
      <div className="mx-5 mb-4 bg-boult-elevated/60 border border-boult-divider/50 rounded-xl px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-boult-fg-secondary">Skip confirmations</p>
          <p className="text-[12px] text-boult-fg-muted mt-0.5">No approval needed before sending or posting</p>
        </div>
        <Toggle checked={agent.skip_confirmations} onChange={onToggleConf} />
      </div>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export interface AgentsPanelProps {
  className?: string;
  onSendMessage?: (msg: string) => void;
}

export function AgentsPanel({ className, onSendMessage }: AgentsPanelProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'tasks' | 'calendar' | 'marketplace' | 'autonomy'>('tasks');
  const [createOpen, setCreateOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [templateInit, setTemplateInit] = useState<Partial<Agent> | null>(null);
  const [tableError, setTableError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const router = useRouter();

  const fetchAgents = async () => {
    setLoadError(false);
    try {
      const res = await fetch('/api/boult/agents');
      const data = await res.json();
      if (data.error?.includes('not set up')) {
        console.warn('[AgentsPanel] boult_agents table not provisioned:', data.error);
        setTableError(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAgents(data.agents || []);
    } catch (e) {
      // Don't silently show an empty state — a failed load is not "no agents".
      console.error('[AgentsPanel] Failed to load agents:', e);
      setLoadError(true);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAgents(); }, []);

  const saveTimezone = async (tz: string) => {
    if (!tz) return;
    try { await fetch('/api/boult/agents/timezone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timezone: tz }) }); } catch { /* silent */ }
  };

  const handleCreate = async (data: Partial<Agent> & { _timezone?: string }) => {
    const { _timezone, ...agentData } = data;
    if (_timezone) saveTimezone(_timezone);

    const cron = agentData.cron_schedule || '0 7 * * *';
    const scheduleLabel = cronToLabel(cron);
    const channel = agentData.output_channel || 'gmail';
    const channelText =
      channel === 'both'
        ? `both Gmail (email) and Slack${agentData.slack_channel ? ` (channel ${agentData.slack_channel})` : ''}`
        : channel === 'slack'
          ? `Slack${agentData.slack_channel ? ` (channel ${agentData.slack_channel})` : ''}`
          : 'Gmail (email)';

    // Plain-English standing instruction handed to the agent loop. The system
    // prompt's "Creating a scheduled background agent" section turns this into:
    // spec doc → open_canvas → create_scheduled_agent → confirmation.
    const prompt = [
      `Create a new scheduled background agent for me with these exact settings:`,
      ``,
      `- Name: ${agentData.name}`,
      `- What it should do every run: ${agentData.task_description}`,
      `- Schedule: ${scheduleLabel} — use the cron expression "${cron}" exactly.`,
      `- Deliver the report via: ${channelText}.`,
      `- Skip confirmations (act without asking): ${agentData.skip_confirmations ? 'yes' : 'no'}.`,
      agentData.expires_at ? `- Auto-pause after: ${agentData.expires_at}.` : `- No expiry.`,
      ``,
      `Write the full specification document, open it in the canvas, then actually create the scheduled agent with create_scheduled_agent using exactly these settings, and confirm when it is live.`,
    ].join('\n');

    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const time = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    });
    const userMessage = {
      id: Date.now(),
      type: 'user',
      role: 'user',
      notes: [],
      content: prompt,
      attachments: [],
      time,
    };

    try {
      localStorage.setItem(`conv_${conversationId}_title`, `Create: ${agentData.name}`);
      localStorage.setItem(
        `conversation_${conversationId}`,
        JSON.stringify({
          id: conversationId,
          messages: [userMessage],
          title: `Create: ${agentData.name}`,
          lastUpdated: new Date().toISOString(),
          messageCount: 1,
        }),
      );
      localStorage.setItem('pending_boult_id', conversationId);
      localStorage.setItem('pending_boult_message', prompt);
      localStorage.setItem('pending_boult_options', JSON.stringify({}));
    } catch { /* localStorage unavailable — navigation still works, loader will fetch */ }

    toast.success(`Setting up "${agentData.name}"…`);
    router.push(`/dashboard/agent-talk/${conversationId}`);
  };

  const handleEdit = async (data: Partial<Agent> & { _timezone?: string }) => {
    if (!editAgent) return;
    const { _timezone, ...agentData } = data;
    const res = await fetch('/api/boult/agents', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editAgent.id, ...agentData }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    if (_timezone) saveTimezone(_timezone);
    toast.success('Schedule updated');
    setEditAgent(null);
    await fetchAgents();
  };

  const handleToggle = async (agent: Agent) => {
    const newStatus = agent.status === 'paused' ? 'active' : 'paused';
    // Optimistic — flip immediately, roll back if the server rejects so the
    // toggle never lies about the agent's real state.
    setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, status: newStatus } : a));
    try {
      const res = await fetch('/api/boult/agents', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: agent.id, status: newStatus }) });
      if (!res.ok) throw new Error();
      toast.success(newStatus === 'paused' ? `Paused "${agent.name}"` : `Resumed "${agent.name}"`);
    } catch {
      setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, status: agent.status } : a));
      toast.error(newStatus === 'paused' ? 'Could not pause the agent' : 'Could not resume the agent', { description: 'Please try again.' });
    }
  };

  const handleToggleConf = async (agent: Agent) => {
    const newVal = !agent.skip_confirmations;
    setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, skip_confirmations: newVal } : a));
    try {
      const res = await fetch('/api/boult/agents', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: agent.id, skip_confirmations: newVal }) });
      if (!res.ok) throw new Error();
      toast.success(newVal ? 'Auto-approve on — actions run without asking' : 'Auto-approve off — actions wait for your OK');
    } catch {
      setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, skip_confirmations: agent.skip_confirmations } : a));
      toast.error('Could not update that setting', { description: 'Please try again.' });
    }
  };

  const deleteAgent = async (agent: Agent) => {
    const prevAgents = agents;
    setAgents(prev => prev.filter(a => a.id !== agent.id));
    try {
      const res = await fetch(`/api/boult/agents?id=${agent.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success(`"${agent.name}" deleted`);
    } catch {
      setAgents(prevAgents);
      toast.error('Could not delete the schedule', { description: 'Please try again.' });
    }
  };

  const handleDelete = (agent: Agent) => {
    // Styled confirmation toast instead of the browser's native confirm().
    toast(`Delete "${agent.name}"?`, {
      description: 'This stops the agent and removes its schedule. This cannot be undone.',
      action: { label: 'Delete', onClick: () => deleteAgent(agent) },
      cancel: { label: 'Cancel', onClick: () => {} },
    });
  };

  const handleRunNow = async (agent: Agent) => {
    if (runningId) return;
    setRunningId(agent.id);
    const toastId = toast.loading(`Starting "${agent.name}"…`);
    try {
      const res = await fetch('/api/boult/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id }),
      });

      if (!res.ok || !res.body) {
        let msg = 'Run failed';
        try { msg = (await res.json()).error || msg; } catch { /* non-JSON */ }
        throw new Error(msg);
      }

      const conversationId =
        res.headers.get('X-Conversation-Id') ||
        (globalThis.crypto?.randomUUID?.() as string);
      const agentName =
        decodeURIComponent(res.headers.get('X-Agent-Name') || '') || agent.name;
      const agentTask =
        decodeURIComponent(res.headers.get('X-Agent-Task') || '') ||
        agent.task_description;

      // Consume the SSE stream (same event format as /api/boult/chat).
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';
      let report = '';
      let streamError = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith('data: ') || !currentEventType) continue;
          let data: any;
          try { data = JSON.parse(line.slice(6).trim()); } catch { continue; }

          if (currentEventType === 'thinking' && data.status) {
            toast.loading(`"${agentName}": ${data.status}`, { id: toastId });
          } else if (currentEventType === 'tool_call' && data.tool) {
            toast.loading(`"${agentName}": ${String(data.tool).replace(/_/g, ' ')}…`, { id: toastId });
          } else if (currentEventType === 'message' && data.content) {
            report = data.content;
          } else if (currentEventType === 'error') {
            streamError = data.message || 'Agent run failed';
          }
          currentEventType = '';
        }
      }

      if (!report) {
        throw new Error(streamError || 'Agent finished but produced no report.');
      }

      // Persist as a conversation so it appears in chat history — same shape
      // the old synchronous route saved.
      const time = new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const messages = [
        { id: Date.now(), type: 'user', role: 'user', content: agentTask, time },
        {
          id: Date.now() + 1,
          type: 'agent',
          role: 'assistant',
          content: { text: report, list: [], footer: '' },
          time,
          meta: { agentSteps: [], agentNarratives: [], ranBy: 'run_now', agentName },
        },
      ];

      const saveRes = await fetch('/api/boult/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, messages, title: agentName }),
      });
      if (!saveRes.ok) {
        console.error('[Boult:RunNow] conversation save failed', await saveRes.text());
      }

      toast.success(`"${agentName}" finished — opening conversation`, { id: toastId });
      await fetchAgents();
      router.push(`/dashboard/agent-talk/${conversationId}`);
    } catch (err: any) {
      toast.error(err.message || 'Run failed', { id: toastId });
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className={cn('w-full max-w-2xl mx-auto py-6 px-1', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[24px] font-bold text-boult-fg tracking-tight">Scheduled</h2>
          <p className="text-[14px] text-boult-fg-muted mt-0.5">Agents working for you around the clock</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-boult-fg text-boult-fg-inverse rounded-xl font-bold text-[14px] hover:opacity-90 active:scale-95 transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New schedule
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-boult-divider/70 mb-5">
        {([
          { key: 'tasks',    label: 'Tasks',    Icon: List },
          { key: 'calendar', label: 'Calendar', Icon: CalendarDays },
          { key: 'autonomy', label: 'Autonomy', Icon: ShieldCheck },
          { key: 'marketplace', label: 'Marketplace', Icon: Compass },
        ] as const).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-1 py-3 mr-6 text-[14px] font-semibold transition-all border-b-2 -mb-px',
              tab === key ? 'text-boult-fg border-boult-fg' : 'text-boult-fg-muted border-transparent hover:text-boult-fg-secondary',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tableError && (
        <div className="mb-5 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[13px] text-boult-fg-secondary">Agents aren’t available on your account just yet. Our team has been notified — please check back shortly.</p>
        </div>
      )}

      {loadError && !loading && (
        <div className="mb-5 p-4 bg-boult-raised/60 border border-boult-divider rounded-xl flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-boult-fg-muted flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-boult-fg-secondary">We couldn’t load your agents. Check your connection and try again.</p>
          </div>
          <button
            onClick={() => { setLoading(true); fetchAgents(); }}
            className="px-3 py-1.5 rounded-lg bg-boult-fg text-boult-fg-inverse text-[12px] font-bold hover:opacity-90 active:scale-95 transition-all flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 text-boult-fg-muted animate-spin" />
        </div>
      ) : tab === 'calendar' ? (
        <MiniCalendar
          agents={agents.filter(a => a.status !== 'paused')}
          onAgentClick={() => {}}
        />
      ) : tab === 'autonomy' ? (
        <AutonomyPanel />
      ) : tab === 'marketplace' ? (
        <div>
          <p className="text-[13px] text-boult-fg-muted mb-5 leading-relaxed">
            One-click starter agents. Each opens the create modal pre-filled with a tested schedule, task, and output channel — tweak anything before activating.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TEMPLATES.map((t, i) => (
              <motion.div
                key={t.id || i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="bg-boult-surface/60 backdrop-blur-xl border border-boult-border rounded-2xl p-4 flex flex-col hover:border-boult-divider hover:bg-boult-surface transition-all group"
              >
                <div className="flex items-center gap-2.5 mb-2.5">
                  <div className="w-9 h-9 rounded-xl bg-boult-raised/80 flex items-center justify-center flex-shrink-0">
                    {getTemplateIcon(t.id)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-boult-fg leading-tight truncate">{t.name}</p>
                    {t.tagline && (
                      <p className="text-[11px] text-boult-fg-muted truncate">{t.tagline}</p>
                    )}
                  </div>
                </div>
                <p className="text-[12.5px] text-boult-fg-muted leading-relaxed flex-1 mb-3 line-clamp-3">{t.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-boult-fg-muted font-medium">{cronToLabel(t.cron_schedule)}</span>
                  <button
                    onClick={() => setTemplateInit(t as any)}
                    className="px-3.5 py-1.5 rounded-lg bg-boult-fg text-boult-fg-inverse text-[12px] font-bold hover:opacity-90 active:scale-95 transition-all"
                  >
                    Add agent
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ) : agents.length === 0 ? (
        <div>
          <p className="text-[14px] text-boult-fg-muted mb-6 text-center">
            Get started with a pre-built agent — activate in one click, customize anytime.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TEMPLATES.map((t, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-boult-surface/60 backdrop-blur-xl border border-boult-border rounded-2xl p-4 flex flex-col hover:border-boult-divider hover:bg-boult-surface transition-all group"
              >
                <div className="flex items-center gap-2.5 mb-2.5">
                  <div className="w-8 h-8 rounded-xl bg-boult-raised/80 flex items-center justify-center flex-shrink-0">
                    {getTemplateIcon(t.id)}
                  </div>
                  <p className="text-[14px] font-bold text-boult-fg leading-tight">{t.name}</p>
                </div>
                <p className="text-[13px] text-boult-fg-muted leading-relaxed flex-1 mb-3">{t.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-boult-fg-muted font-medium">{cronToLabel(t.cron_schedule)}</span>
                  <button
                    onClick={() => setTemplateInit(t)}
                    className="px-3.5 py-1.5 rounded-lg bg-boult-fg text-boult-fg-inverse text-[12px] font-bold hover:opacity-90 active:scale-95 transition-all"
                  >
                    Activate
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {agents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onToggle={() => handleToggle(agent)}
                onEdit={() => setEditAgent(agent)}
                onDelete={() => handleDelete(agent)}
                onToggleConf={() => handleToggleConf(agent)}
                onRunNow={() => handleRunNow(agent)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {(createOpen || templateInit) && (
          <CreateModal
            key="create"
            onClose={() => { setCreateOpen(false); setTemplateInit(null); }}
            onSave={handleCreate}
            initial={templateInit ? {
              name: templateInit.name,
              task_description: templateInit.task_description,
              cron_schedule: templateInit.cron_schedule,
              output_channel: templateInit.output_channel,
            } : undefined}
          />
        )}
        {editAgent && (
          <CreateModal key="edit" onClose={() => setEditAgent(null)} onSave={handleEdit} initial={editAgent} />
        )}
      </AnimatePresence>
    </div>
  );
}

export default AgentsPanel;
