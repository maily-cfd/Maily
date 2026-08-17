'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Clock, Mail, Zap, Loader2, X, ChevronLeft, ChevronRight,
  MoreHorizontal, List, Slack, Trash2, Edit2, AlertCircle, CalendarDays, Compass,
  Sunrise, DollarSign, Target, BarChart3, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { DropdownMenu as DropdownMenuRoot } from 'radix-ui';

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
}

// ── Cron Utilities ─────────────────────────────────────────────────────────────

function cronToLabel(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [minStr, hourStr, , , dowStr] = parts;
  if (hourStr.startsWith('*/')) {
    const n = hourStr.split('/')[1];
    return n === '1' ? 'Every hour' : `Every ${n} hours`;
  }
  const h = hourStr.padStart(2, '0');
  const m = minStr.padStart(2, '0');
  const time = `${h}:${m}`;
  if (dowStr === '*') return `Daily at ${time}`;
  if (dowStr === '0') return `Sundays at ${time}`;
  if (dowStr === '1-5') return `Weekdays at ${time}`;
  if (!isNaN(parseInt(dowStr))) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${days[parseInt(dowStr)]}s at ${time}`;
  }
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
    let next = new Date(candidate > now ? candidate : new Date(candidate.getTime() + 86400000));
    for (let i = 0; i < 7; i++) {
      const d = next.getDay();
      if (d >= 1 && d <= 5) return next;
      next = new Date(next.getTime() + 86400000);
    }
    return next;
  }
  const targetDow = parseInt(dowStr) || 0;
  const curDow = now.getDay();
  let daysUntil = (targetDow - curDow + 7) % 7;
  if (daysUntil === 0 && candidate <= now) daysUntil = 7;
  const next = new Date(candidate);
  next.setDate(next.getDate() + daysUntil);
  return next;
}

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
    let dayMatches = false;
    if (dowStr === '*') dayMatches = true;
    else if (dowStr === '0' && dow === 0) dayMatches = true;
    else if (dowStr === '1-5' && dow >= 1 && dow <= 5) dayMatches = true;
    else if (!isNaN(parseInt(dowStr)) && parseInt(dowStr) === dow) dayMatches = true;
    if (!dayMatches) continue;
    if (interval > 0) {
      for (let h = 0; h < 24; h += interval) dates.push(new Date(year, month, day, h, tM, 0));
    } else {
      dates.push(new Date(year, month, day, tH, tM, 0));
    }
  }
  return dates;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatNextRun(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' · ' + formatTime(date);
}

function formatRunDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' · ' + formatTime(d);
}

// ── Toggle Switch ──────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(); }}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-900',
        checked ? 'bg-zinc-300' : 'bg-zinc-700',
      )}
    >
      <span className={cn(
        'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out',
        checked ? 'translate-x-5' : 'translate-x-0',
      )} />
    </button>
  );
}

// ── Schedule constants ─────────────────────────────────────────────────────────

const TEMPLATES = [
  { name: 'Morning Inbox Sweep', description: 'Every morning at 7am, scans inbox for unanswered client emails, drafts replies in your tone, emails you a summary.', cron_schedule: '0 7 * * *', output_channel: 'gmail' as const, task_description: 'Every morning at 7am, search my inbox for any unanswered client emails, study my recent sent emails to learn my writing tone and voice, draft a personalized reply for each unanswered email matching my style exactly, and email me a clear summary with the subject line, sender, and a link to each draft in Gmail.' },
  { name: 'Meeting Autopilot', description: 'Every morning at 9am, finds meeting requests, checks calendar availability, books them with Meet links.', cron_schedule: '0 9 * * *', output_channel: 'both' as const, task_description: 'Every morning at 9am, search my Gmail inbox for any meeting requests or scheduling emails, check my Google Calendar for availability in the proposed time slots, book confirmed meetings with Google Meet links, and send me a Slack message listing everything that was scheduled today.' },
  { name: 'Weekly Opportunity Digest', description: 'Every Sunday at 6pm, scans all emails from the week, identifies revenue opportunities and leads.', cron_schedule: '0 18 * * 0', output_channel: 'gmail' as const, task_description: 'Every Sunday at 6pm, search through all emails I received this week, identify any revenue opportunities, potential partnerships, warm leads, or high-priority follow-ups, and write a comprehensive weekly digest email.' },
  { name: 'Client Pulse', description: 'Every hour, checks if email arrived from your top contacts. Sends an immediate Slack ping.', cron_schedule: '0 */1 * * *', output_channel: 'slack' as const, task_description: 'Every hour, check if any new email arrived from my most important contacts. If so, immediately send me a Slack message with the sender name, subject line, and first two sentences.' },
  { name: 'Notion + Inbox Sync', description: 'Every morning at 8am, cross-references your Notion tasks with Gmail, sends a project briefing.', cron_schedule: '0 8 * * *', output_channel: 'gmail' as const, task_description: 'Every morning at 8am, read my current Notion task list, search my Gmail inbox for emails related to each active project, find which projects have unread messages, and email me a concise project briefing.' },
  { name: 'Lead Harvest', description: 'Every morning at 5am, runs the full lead qualification flow across inbox and web, pushes to Notion.', cron_schedule: '0 5 * * *', output_channel: 'gmail' as const, task_description: 'Every morning at 5am, search my inbox for any new inbound leads, partnership inquiries, or business development emails, use web search to research and qualify each lead, save qualified leads to my Notion database, and email me a harvest report.' },
];

function getTemplateIcon(name: string) {
  const iconProps = { className: "w-4.5 h-4.5 text-zinc-400" };
  switch (name) {
    case 'Morning Inbox Sweep':
      return <Sunrise {...iconProps} />;
    case 'Meeting Autopilot':
      return <CalendarDays {...iconProps} />;
    case 'Weekly Opportunity Digest':
      return <BarChart3 {...iconProps} />;
    case 'Client Pulse':
      return <Zap {...iconProps} />;
    case 'Notion + Inbox Sync':
      return <Layers {...iconProps} />;
    case 'Lead Harvest':
      return <Target {...iconProps} />;
    default:
      return <Clock {...iconProps} />;
  }
}

const SCHEDULE_PATTERNS = [
  { label: 'Every day',     key: 'daily',   needsTime: true,  needsDay: false },
  { label: 'Every hour',   key: 'hourly',  needsTime: false, needsDay: false },
  { label: 'Weekdays',     key: 'weekday', needsTime: true,  needsDay: false },
  { label: 'Weekly',       key: 'weekly',  needsTime: true,  needsDay: true  },
  { label: 'Custom cron',  key: 'custom',  needsTime: false, needsDay: false },
];

const WEEK_DAYS = [
  { label: 'Sunday', value: '0' }, { label: 'Monday', value: '1' },
  { label: 'Tuesday', value: '2' }, { label: 'Wednesday', value: '3' },
  { label: 'Thursday', value: '4' }, { label: 'Friday', value: '5' },
  { label: 'Saturday', value: '6' },
];

function buildCron(patternKey: string, time: string, weekday: string): string {
  const [h, m] = time.split(':').map(s => parseInt(s, 10));
  const hh = isNaN(h) ? 7 : h;
  const mm = isNaN(m) ? 0 : m;
  switch (patternKey) {
    case 'daily':   return `${mm} ${hh} * * *`;
    case 'hourly':  return `0 */1 * * *`;
    case 'weekday': return `${mm} ${hh} * * 1-5`;
    case 'weekly':  return `${mm} ${hh} * * ${weekday}`;
    default:        return '';
  }
}

function parseCronToSchedule(cron: string): { key: string; time: string; weekday: string } {
  if (!cron || cron === '0 */1 * * *') return { key: 'hourly', time: '07:00', weekday: '0' };
  const parts = cron.split(' ');
  if (parts.length !== 5) return { key: 'custom', time: '07:00', weekday: '0' };
  const [mm, hh, , , dow] = parts;
  const time = `${String(parseInt(hh) || 0).padStart(2, '0')}:${String(parseInt(mm) || 0).padStart(2, '0')}`;
  if (dow === '1-5') return { key: 'weekday', time, weekday: '1' };
  if (dow !== '*' && !dow.includes('/')) return { key: 'weekly', time, weekday: dow };
  return { key: 'daily', time, weekday: '0' };
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── Premium Date Picker (Custom Linear Theme) ──────────────────────────────────

function PremiumDatePicker({ value, onChange, minDate }: {
  value: string;
  onChange: (val: string) => void;
  minDate?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const today = new Date();
  
  // Parse initial selected date or default to today
  const selectedDate = value ? (() => {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  })() : null;

  const [viewYear, setViewYear] = useState(selectedDate ? selectedDate.getFullYear() : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate ? selectedDate.getMonth() : today.getMonth());

  // Generate calendar grid
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
  
  const cells: Array<{ day: number | null; dateStr: string; isCurrentMonth: boolean; isDisabled: boolean }> = [];
  
  // Front pad from previous month
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
  
  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      day: d,
      dateStr,
      isCurrentMonth: true,
      isDisabled: minDate ? dateStr < minDate : false
    });
  }
  
  // End pad to fill 42 cells (6 weeks grid)
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
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-white border border-zinc-200 rounded-2xl shadow-2xl p-4.5 z-[100] select-none animate-in fade-in slide-in-from-bottom-2 duration-150 dark:bg-[#0A0A0C]/90 dark:backdrop-blur-xl dark:border-white/10">
          {/* Header navigation */}
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex gap-1">
              <button onClick={handlePrevYear} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-900 dark:text-zinc-600 dark:hover:text-zinc-300 rounded-lg transition-colors text-[10px] font-extrabold font-mono">
                &lt;&lt;
              </button>
              <button onClick={handlePrevMonth} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-900 dark:text-zinc-600 dark:hover:text-zinc-300 rounded-lg transition-colors text-[10px] font-extrabold font-mono">
                &lt;
              </button>
            </div>
            
            <span className="text-[13px] font-extrabold text-zinc-800 dark:text-zinc-200 tracking-tight font-sans">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>

            <div className="flex gap-1">
              <button onClick={handleNextMonth} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-900 dark:text-zinc-600 dark:hover:text-zinc-300 rounded-lg transition-colors text-[10px] font-extrabold font-mono">
                &gt;
              </button>
              <button onClick={handleNextYear} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-900 dark:text-zinc-600 dark:hover:text-zinc-300 rounded-lg transition-colors text-[10px] font-extrabold font-mono">
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
                    cell.isCurrentMonth ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400 dark:text-zinc-700',
                    cell.isDisabled && 'text-zinc-300 dark:text-zinc-800/30 cursor-not-allowed hover:bg-transparent',
                    !cell.isDisabled && !isSelected && 'hover:bg-zinc-100 dark:hover:bg-zinc-900/50',
                    isTodayCell && !isSelected && 'border border-zinc-300 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100',
                    isSelected && 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 font-bold shadow-md shadow-black/10 dark:shadow-white/5'
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
                      : "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-450 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-200"
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
                      : "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-450 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-200"
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
                      : "text-zinc-805 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-200"
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

// ── New Schedule Modal (Dialog) ────────────────────────────────────────────────

function NewScheduleModal({ open, onClose, onSave, initial }: {
  open: boolean; onClose: () => void;
  onSave: (data: Partial<Agent>) => Promise<void>;
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

  const activePat = SCHEDULE_PATTERNS.find(p => p.key === patternKey) || SCHEDULE_PATTERNS[0];
  const cron = patternKey === 'custom' ? customCron : buildCron(patternKey, scheduleTime, scheduleWeekday);
  const todayStr = new Date().toISOString().split('T')[0];

  const handleSave = async () => {
    if (!task.trim()) { toast.error('Describe what you want Boult to do.'); return; }
    if (patternKey === 'custom' && !customCron.trim()) { toast.error('Enter a cron expression.'); return; }
    if (hasExpiry && !expiresAt) { toast.error('Pick an expiration date or disable expiration.'); return; }
    setSaving(true);
    try {
      const agentName = name.trim() || task.trim().slice(0, 40).replace(/\.$/, '') + (task.trim().length > 40 ? '…' : '');
      await onSave({
        name: agentName, task_description: task.trim(),
        cron_schedule: cron || '0 7 * * *', output_channel: channel,
        slack_channel: channel !== 'gmail' ? slackCh || null : null,
        skip_confirmations: skipConf,
        expires_at: hasExpiry && expiresAt ? expiresAt : null,
        // @ts-ignore
        _timezone: browserTz,
      });
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'w-full max-w-4xl bg-white dark:bg-[#0A0A0C] border border-zinc-200 dark:border-white/10 rounded-[2.5rem] p-0 overflow-hidden shadow-2xl dark:shadow-black/60',
          'max-h-[95vh] flex flex-col',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-7 pb-5 border-b border-zinc-200 dark:border-zinc-900/60 flex-shrink-0">
          <div>
            <DialogTitle className="text-[20px] font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight">
              {initial?.id ? 'Edit schedule' : 'New schedule'}
            </DialogTitle>
            <p className="text-[14px] text-zinc-550 mt-1">Describe the job and when to run it</p>
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
            {/* Left Column: Task Description & Optional Name */}
            <div className="lg:col-span-7 space-y-6">
              {/* Task description */}
              <div>
                <label className="block text-[13px] font-bold text-zinc-600 dark:text-zinc-400 mb-2">What should Boult do?</label>
                <textarea
                  value={task}
                  onChange={e => setTask(e.target.value)}
                  placeholder="Describe what you want this agent to do in plain English…"
                  rows={8}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] text-zinc-900 leading-relaxed placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 transition-all resize-none dark:bg-[#121214] dark:border-[#242427] dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-700"
                />
              </div>

              {/* Optional name */}
              <div>
                <label className="block text-[13px] font-bold text-zinc-600 dark:text-zinc-400 mb-2">Agent name <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span></label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Morning Client Check"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 transition-all dark:bg-[#121214] dark:border-[#242427] dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-700"
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
              className="flex-1 py-3.5 rounded-xl text-[15px] font-extrabold text-white bg-black hover:bg-zinc-100 dark:hover:bg-zinc-900 dark:text-zinc-950 dark:bg-zinc-100 dark:hover:bg-white active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create schedule'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Agent Detail Dialog ────────────────────────────────────────────────────────

function AgentDetailModal({ agent, onClose, onToggle, onEdit, onDelete, onToggleConfirmations }: {
  agent: Agent; onClose: () => void; onToggle: () => void;
  onEdit: () => void; onDelete: () => void; onToggleConfirmations: () => void;
}) {
  const nextRun = getNextRunDate(agent.cron_schedule);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent showCloseButton={false} className="w-full max-w-md bg-white/90 dark:bg-[#0A0A0B]/85 backdrop-blur-2xl border border-black/10 dark:border-white/10 rounded-[2.5rem] p-0 overflow-hidden shadow-2xl shadow-black/20 dark:shadow-black/60">
        <div className="px-6 pt-6 pb-4 border-b border-zinc-200 dark:border-zinc-800/60 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="px-2.5 py-1 rounded-md text-[11px] font-semibold border border-zinc-300 dark:border-zinc-700/60 bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300">
              {cronToLabel(agent.cron_schedule)}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Toggle checked={agent.status !== 'paused'} onChange={onToggle} />
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          <h3 className="text-[18px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug mb-2">{agent.name}</h3>
          <p className="text-[14px] text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-4 mb-5">{agent.task_description}</p>

          <div className="space-y-2 mb-5">
            {[
              { label: 'Repeat', value: cronToLabel(agent.cron_schedule) },
              { label: 'Next run', value: formatNextRun(nextRun) },
              { label: 'Confirmations', value: agent.skip_confirmations ? 'Always skip' : 'Ask first' },
              { label: 'Output', value: agent.output_channel === 'both' ? 'Gmail + Slack' : agent.output_channel.charAt(0).toUpperCase() + agent.output_channel.slice(1) },
              ...(agent.expires_at ? [{ label: 'Expires', value: new Date(agent.expires_at + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }] : []),
            ].map((row, i) => (
              <div key={i} className="flex items-center justify-between py-2.5 px-4 bg-zinc-100/80 dark:bg-zinc-900/60 rounded-lg border border-zinc-200 dark:border-zinc-800/50">
                <span className="text-[13px] text-zinc-500">{row.label}</span>
                <span className="text-[13px] text-zinc-800 dark:text-zinc-200 font-medium">{row.value}</span>
              </div>
            ))}
          </div>

          {agent.last_run_at && (
            <div className="mb-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600 mb-2">Last run</p>
              <div className="bg-zinc-100/80 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/50 rounded-lg p-4">
                <p className="text-[13px] text-zinc-700 dark:text-zinc-400 font-medium mb-1">{formatRunDate(agent.last_run_at)}</p>
                <p className="text-[13px] text-zinc-500 leading-relaxed line-clamp-3">{agent.last_report_summary || 'Run completed successfully.'}</p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { onClose(); onEdit(); }}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700/60 text-[14px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all"
            >
              <Edit2 className="w-4 h-4" /> Edit
            </button>
            <button
              onClick={() => { onClose(); onDelete(); }}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[14px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-all"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Full-Page Calendar View ────────────────────────────────────────────────────

function CalendarView({ agents, onAgentClick, onCreateNew }: {
  agents: Agent[];
  onAgentClick: (a: Agent) => void;
  onCreateNew: () => void;
}) {
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
    cells.push({ day: d, runs });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, runs: [] });
  const weeks = cells.length / 7;

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-zinc-50 dark:bg-zinc-950">
      {/* Calendar nav bar */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-zinc-200 dark:border-zinc-900 flex-shrink-0 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-zinc-200 dark:border-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-800 transition-all duration-150">
            <ChevronLeft className="w-4.5 h-4.5" />
          </button>
          <h3 className="text-[18px] font-extrabold text-zinc-900 dark:text-zinc-100 min-w-[170px] text-center tracking-tight font-sans">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </h3>
          <button onClick={nextMonth} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-zinc-200 dark:border-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-800 transition-all duration-150">
            <ChevronRight className="w-4.5 h-4.5" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }}
            className="px-4 py-2 rounded-xl text-[13px] font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-800 hover:text-black dark:hover:text-white transition-all duration-150 animate-none"
          >
            Today
          </button>
          <div className="flex border border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950 rounded-xl overflow-hidden p-0.5">
            <button className="w-8 h-8 flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 rounded-lg transition-all duration-150">
              <CalendarDays className="w-4 h-4" />
            </button>
            <button className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-700 dark:hover:text-zinc-300 rounded-lg transition-all duration-150">
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-zinc-200/80 dark:border-zinc-900/60 flex-shrink-0 bg-zinc-50 dark:bg-zinc-950">
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-[11px] font-bold uppercase tracking-widest text-zinc-500 py-3.5 border-r border-zinc-200/60 dark:border-zinc-900/40 last:border-r-0">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid — fills all remaining space */}
      <div
        className="flex-1 grid grid-cols-7 min-h-0 bg-zinc-50 dark:bg-zinc-950"
        style={{ gridTemplateRows: `repeat(${weeks}, 1fr)` }}
      >
        {cells.map((cell, idx) => {
          const isToday = cell.day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
          const isPast = cell.day !== null && new Date(viewYear, viewMonth, cell.day) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
          return (
            <div
              key={idx}
              className={cn(
                'flex flex-col border-r border-b border-zinc-200/80 dark:border-zinc-900/60 p-2.5 overflow-hidden transition-all duration-200 group/cell',
                idx % 7 === 6 && 'border-r-0',
                cell.day === null 
                  ? 'bg-zinc-100/60 dark:bg-[#050505]' 
                  : isToday 
                    ? 'bg-zinc-100 dark:bg-zinc-900/45' 
                    : 'bg-white/40 dark:bg-zinc-950/20 hover:bg-zinc-100/60 dark:hover:bg-zinc-900/20',
              )}
            >
              {cell.day !== null && (
                <>
                  {/* Date number row */}
                  <div className="flex items-center justify-between mb-2 flex-shrink-0">
                    <button
                      onClick={onCreateNew}
                      className={cn(
                        'w-6 h-6 flex items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all',
                        isToday ? 'opacity-100' : 'opacity-0 group-hover/cell:opacity-100'
                      )}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <div className={cn(
                      'w-7 h-7 flex items-center justify-center text-[13px] font-bold rounded-full transition-colors',
                      isToday
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 shadow-sm shadow-black/10 dark:shadow-white/10'
                        : isPast
                          ? 'text-zinc-400 dark:text-zinc-700'
                          : 'text-zinc-500 dark:text-zinc-400 group-hover/cell:text-zinc-800 dark:group-hover/cell:text-zinc-200',
                    )}>
                      {cell.day}
                    </div>
                  </div>

                  {/* Event pills */}
                  <div className="flex-1 space-y-1.5 overflow-y-auto custom-scroll pr-0.5">
                    {cell.runs.map(({ agent, date }, ri) => (
                      <button
                        key={ri}
                        onClick={() => onAgentClick(agent)}
                        className="w-full text-left bg-white border border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 dark:bg-zinc-900/90 dark:border-zinc-800/80 dark:hover:bg-zinc-800 dark:hover:border-zinc-700 rounded-lg px-2.5 py-2 transition-all duration-150 active:scale-[0.98] group flex flex-col justify-between min-h-[50px] shadow-sm shadow-black/5 dark:shadow-black/20"
                      >
                        <p className="text-[12px] font-bold text-zinc-800 dark:text-zinc-200 group-hover:text-black dark:group-hover:text-white transition-colors truncate leading-tight">{agent.name}</p>
                        <p className="text-[10px] text-zinc-500 font-mono mt-1 flex items-center gap-1.5">
                          <span className="w-1 h-1 rounded-full bg-zinc-500 group-hover:bg-zinc-700 dark:group-hover:bg-zinc-300 transition-colors" />
                          {formatTime(date)}
                        </p>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Template Cards ─────────────────────────────────────────────────────────────

function TemplateCards({ onActivate }: { onActivate: (t: typeof TEMPLATES[0]) => void }) {
  return (
    <div>
      <p className="text-[15px] text-zinc-500 dark:text-zinc-400 mb-8 text-center">
        Get started with a pre-built agent — activate in one click, customize anytime.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TEMPLATES.map((t, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="bg-white/70 dark:bg-[#141414]/60 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.08] rounded-2xl p-5 flex flex-col hover:border-black/20 dark:hover:border-white/20 hover:bg-white dark:hover:bg-[#141414]/85 transition-all group shadow-sm"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-zinc-200 dark:bg-zinc-800/80 flex items-center justify-center flex-shrink-0 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700/80 transition-colors">
                {getTemplateIcon(t.name)}
              </div>
              <h4 className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100 leading-tight">{t.name}</h4>
            </div>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed flex-1 mb-4">{t.description}</p>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-zinc-600 font-medium">{cronToLabel(t.cron_schedule)}</span>
              <button
                onClick={() => onActivate(t)}
                className="px-4 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 text-[13px] font-bold hover:bg-zinc-800 dark:hover:bg-white active:scale-95 transition-all"
              >
                Activate
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Agent Task Card — loading skeleton ─────────────────────────────────────────
// Mirrors the real AgentTaskCard layout (badge row → title → summary → meta)
// so the loading state previews the shape of the content instead of a bare
// spinner. Premium apps skeleton-load; spinners read as "generic web app".

function AgentTaskCardSkeleton() {
  return (
    <div className="bg-white dark:bg-[#0A0A0B]/60 border border-zinc-200 dark:border-zinc-900 rounded-2xl overflow-hidden animate-pulse">
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-6 w-20 rounded-lg bg-zinc-200 dark:bg-zinc-800/70" />
            </div>
            <div className="h-5 w-2/5 rounded bg-zinc-200 dark:bg-zinc-800/70 mb-3" />
            <div className="h-3.5 w-4/5 rounded bg-zinc-100 dark:bg-zinc-900 mb-2" />
            <div className="h-3.5 w-3/5 rounded bg-zinc-100 dark:bg-zinc-900 mb-4" />
            <div className="flex items-center gap-4">
              <div className="h-3 w-24 rounded bg-zinc-100 dark:bg-zinc-900" />
              <div className="h-3 w-16 rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
          </div>
          <div className="w-10 h-6 rounded-full bg-zinc-200 dark:bg-zinc-800/70 flex-shrink-0" />
        </div>
      </div>
    </div>
  );
}

function AgentListSkeleton() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {[0, 1, 2].map(i => <AgentTaskCardSkeleton key={i} />)}
    </div>
  );
}

// ── Agent Task Card ────────────────────────────────────────────────────────────

function AgentTaskCard({ agent, onClick, onToggle, onEdit, onDelete, onToggleConfirmations }: {
  agent: Agent; onClick: () => void; onToggle: () => void;
  onEdit: () => void; onDelete: () => void; onToggleConfirmations: () => void;
}) {
  const nextRun = getNextRunDate(agent.cron_schedule);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="bg-white dark:bg-[#0A0A0B]/60 backdrop-blur-xl border border-zinc-200 dark:border-zinc-900 rounded-2xl overflow-hidden hover:border-zinc-300 dark:hover:border-zinc-800 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20 transition-all duration-200 group"
    >
      <div className="p-6">
        <div className="flex items-start gap-4">
          {/* Left Column: Icon Badge & Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2.5 flex-wrap">
              <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-zinc-300 dark:border-zinc-800 bg-zinc-100 dark:bg-[#121214] text-zinc-500 dark:text-zinc-400">
                {cronToLabel(agent.cron_schedule).split(' ')[0]}
              </span>
              {agent.expires_at && (
                <span className="px-2.5 py-1 rounded-lg text-[10px] font-semibold border border-amber-500/10 bg-amber-500/5 text-amber-500/80 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
                  Expires {new Date(agent.expires_at + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
            
            <button
              onClick={onClick}
              className="text-[17px] font-extrabold text-zinc-900 dark:text-zinc-100 text-left hover:text-black dark:hover:text-white transition-colors leading-tight line-clamp-1 block w-full tracking-tight"
            >
              {agent.name}
            </button>
            <p className="text-[13px] text-zinc-500 mt-2 leading-relaxed line-clamp-2 pr-4">{agent.task_description}</p>
          </div>

          {/* Right Column: Toggle & More options */}
          <div className="flex items-center gap-3.5 flex-shrink-0 pt-0.5">
            <Toggle checked={agent.status !== 'paused'} onChange={onToggle} />
            <DropdownMenuRoot.Root>
              <DropdownMenuTrigger asChild>
                <button className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#121214] border border-transparent hover:border-zinc-200 dark:hover:border-zinc-900 transition-all">
                  <MoreHorizontal className="w-4.5 h-4.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[140px] bg-white/90 dark:bg-[#141414]/90 backdrop-blur-xl border border-black/10 dark:border-white/10 rounded-xl p-1 shadow-2xl">
                <DropdownMenuItem onClick={onEdit} className="flex items-center gap-2 px-3 py-2 text-[13px] text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer rounded-lg transition-colors">
                  <Edit2 className="w-3.5 h-3.5" /> Edit schedule
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} variant="destructive" className="flex items-center gap-2 px-3 py-2 text-[13px] cursor-pointer rounded-lg transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuRoot.Root>
          </div>
        </div>

        {/* Separator & Metadata dashboard */}
        <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-zinc-200/80 dark:border-zinc-900/60">
          <div className="flex items-start gap-2.5">
            <CalendarDays className="w-4.5 h-4.5 text-zinc-600 mt-0.5" />
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-0.5">Schedule</span>
              <span className="text-[13px] text-zinc-600 dark:text-zinc-300 font-semibold leading-none">{cronToLabel(agent.cron_schedule)}</span>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Clock className="w-4.5 h-4.5 text-zinc-600 mt-0.5" />
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-0.5">Next run</span>
              <span className="text-[13px] text-zinc-600 dark:text-zinc-300 font-semibold leading-none">{formatNextRun(nextRun)}</span>
            </div>
          </div>
          <div className="flex flex-col items-end justify-center">
            <span className={cn(
              'inline-flex px-3 py-1 rounded-xl text-[11px] font-bold border transition-colors shadow-sm',
              agent.status === 'running'
                ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-950 dark:border-zinc-100'
                : agent.status === 'active'
                  ? 'bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300'
                  : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 border-zinc-200 dark:border-zinc-900',
            )}>
              {agent.status === 'running' ? 'Running' : agent.status === 'active' ? 'Active' : 'Paused'}
            </span>
          </div>
        </div>
      </div>

      {/* Skip confirmations inside box */}
      <div className="mx-6 mb-6 bg-zinc-100 dark:bg-[#121214] border border-zinc-200 dark:border-zinc-900 rounded-2xl px-5 py-4 flex items-center justify-between transition-colors hover:bg-zinc-50 dark:hover:bg-[#151517]">
        <div>
          <p className="text-[13px] font-bold text-zinc-800 dark:text-zinc-200">Skip confirmations</p>
          <p className="text-[12px] text-zinc-500 mt-0.5">No approval needed before execution</p>
        </div>
        <Toggle checked={agent.skip_confirmations} onChange={onToggleConfirmations} />
      </div>
    </motion.div>
  );
}

// ── Inner Page (needs useSearchParams) ────────────────────────────────────────

function ScheduledPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = (searchParams.get('tab') as 'calendar' | 'tasks' | 'marketplace') || 'tasks';

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [tableError, setTableError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [activatingTemplate, setActivatingTemplate] = useState<typeof TEMPLATES[0] | null>(null);
  const [gateOk, setGateOk] = useState(false);

  // PAYWALL: agents is a paid surface. Unpaid users go to the single paywall —
  // All authenticated users have access — no subscription check.
  useEffect(() => {
    setGateOk(true);
  }, []);

  const setTab = (t: 'calendar' | 'tasks' | 'marketplace') => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', t);
    router.replace(`?${params.toString()}`);
  };

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/boult/agents');
      const data = await res.json();
      if (data.error?.includes('not set up')) { setTableError(true); return; }
      setAgents(data.agents || []);
      setLoadError(false);
    } catch {
      // Surface the failure instead of silently showing an empty state —
      // a network/parse error must not look identical to "you have no agents".
      setLoadError(true);
    } finally { setLoading(false); }
  };

  useEffect(() => { if (gateOk) fetchAgents(); }, [gateOk]);

  const saveTimezone = async (tz: string) => {
    if (!tz) return;
    try {
      await fetch('/api/boult/agents/timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tz }),
      });
    } catch { /* silent */ }
  };

  const handleCreate = async (data: Partial<Agent> & { _timezone?: string }) => {
    const { _timezone, ...agentData } = data;
    const res = await fetch('/api/boult/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: agentData.name, taskDescription: agentData.task_description, cronSchedule: agentData.cron_schedule, outputChannel: agentData.output_channel, slackChannel: agentData.slack_channel, skipConfirmations: agentData.skip_confirmations, expiresAt: agentData.expires_at ?? null }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    if (_timezone) saveTimezone(_timezone);
    toast.success(`"${agentData.name}" is now live`);
    await fetchAgents();
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
    await fetch('/api/boult/agents', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: agent.id, status: newStatus }) });
    setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, status: newStatus } : a));
    if (selectedAgent?.id === agent.id) setSelectedAgent(a => a ? { ...a, status: newStatus } : a);
  };

  const handleToggleConfirmations = async (agent: Agent) => {
    const newVal = !agent.skip_confirmations;
    await fetch('/api/boult/agents', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: agent.id, skip_confirmations: newVal }) });
    setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, skip_confirmations: newVal } : a));
    if (selectedAgent?.id === agent.id) setSelectedAgent(a => a ? { ...a, skip_confirmations: newVal } : a);
  };

  const deleteAgent = async (agent: Agent) => {
    // Optimistic remove so the list updates instantly; restore on failure.
    const prevAgents = agents;
    setAgents(prev => prev.filter(a => a.id !== agent.id));
    if (selectedAgent?.id === agent.id) setSelectedAgent(null);
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
    // Styled confirmation toast instead of the browser's native confirm()
    // dialog, which breaks the dark premium aesthetic.
    toast(`Delete "${agent.name}"?`, {
      description: 'This stops the agent and removes its schedule. This cannot be undone.',
      action: { label: 'Delete', onClick: () => deleteAgent(agent) },
      cancel: { label: 'Cancel', onClick: () => {} },
    });
  };

  // Hold the UI behind a plain backdrop until the paywall gate resolves, so the
  // paid agents surface never flashes for an unpaid user before the redirect.
  if (!gateOk) {
    return <div className="bg-zinc-50 dark:bg-zinc-950" style={{ height: '100dvh' }} />;
  }

  return (
    <div className="bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-8 pb-0 flex-shrink-0">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Scheduled</h1>
          <p className="text-zinc-500 text-[14px] mt-1">Autonomous agents working for you around the clock</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-5 py-3 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-xl font-bold text-[14px] hover:bg-zinc-800 dark:hover:bg-white active:scale-95 transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New schedule
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center px-8 mt-6 border-b border-zinc-200 dark:border-zinc-800/70 flex-shrink-0">
        {([
          { key: 'tasks', label: 'Tasks', icon: List },
          { key: 'calendar', label: 'Calendar', icon: CalendarDays },
          { key: 'marketplace', label: 'Marketplace', icon: Compass },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 px-1 py-3.5 mr-8 text-[15px] font-semibold transition-all border-b-2 -mb-px',
              tab === key
                ? 'text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100'
                : 'text-zinc-500 border-transparent hover:text-zinc-700 dark:hover:text-zinc-300',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        // Tasks is the default tab — preview its card shapes with a skeleton.
        // Calendar/marketplace have non-card layouts, so a subtle spinner fits.
        tab === 'calendar' || tab === 'marketplace' ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-zinc-600 animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-8 py-7">
            <AgentListSkeleton />
          </div>
        )
      ) : tab === 'calendar' ? (
        /* Calendar: no padding, fills remaining viewport height */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {tableError && (
            <div className="mx-8 mt-4 p-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700/60 rounded-xl flex items-start gap-3 flex-shrink-0">
              <AlertCircle className="w-4 h-4 text-zinc-400 flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-zinc-400">Scheduled agents aren't ready yet — your workspace is still finishing setup.</p>
            </div>
          )}
          <CalendarView
            agents={agents.filter(a => a.status !== 'paused')}
            onAgentClick={a => setSelectedAgent(a)}
            onCreateNew={() => setCreateOpen(true)}
          />
        </div>
      ) : tab === 'marketplace' ? (
        <div className="flex-1 overflow-y-auto px-8 py-7 flex flex-col items-center justify-center">
          {tableError && (
            <div className="w-full max-w-md mb-6 p-4 bg-zinc-100 dark:bg-[#121214] border border-zinc-200 dark:border-zinc-900 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-zinc-400 flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-zinc-400">Scheduled agents aren't ready yet — your workspace is still finishing setup.</p>
            </div>
          )}
          <div className="max-w-md w-full py-16 px-6 bg-white dark:bg-[#0a0a0b] border border-zinc-200 dark:border-zinc-900 rounded-3xl text-center flex flex-col items-center shadow-lg shadow-black/10 dark:shadow-black/40">
            <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-[#121214] border border-zinc-200 dark:border-zinc-800/80 flex items-center justify-center mb-5">
              <Compass className="w-7 h-7 text-zinc-400 animate-pulse" />
            </div>
            <h3 className="text-[20px] font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight mb-2.5 font-sans">Marketplace Coming Soon</h3>
            <p className="text-[13.5px] text-zinc-500 leading-relaxed mb-6">
              Pre-built agents, custom automation workflows, and community-shared templates will be available here soon.
            </p>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold bg-zinc-100 dark:bg-[#121214] text-zinc-500 border border-zinc-300 dark:border-zinc-800 uppercase tracking-widest">
              Under Development
            </span>
          </div>
        </div>
      ) : (
        /* Tasks: padded scroll area */
        <div className="flex-1 overflow-y-auto px-8 py-7">
          {tableError && (
            <div className="mb-6 p-4 bg-zinc-100/80 dark:bg-zinc-900/60 border border-zinc-300 dark:border-zinc-700/40 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-zinc-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-zinc-600 dark:text-zinc-300 font-bold text-[14px]">Scheduled agents aren't ready yet</p>
                <p className="text-zinc-500 text-[13px] mt-0.5">Your workspace is still finishing setup. This usually resolves on its own shortly — if it persists, reach out to support.</p>
              </div>
            </div>
          )}
          {loadError ? (
            <div className="max-w-md mx-auto mt-16 text-center flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-[#121214] border border-zinc-200 dark:border-zinc-800/80 flex items-center justify-center mb-5">
                <AlertCircle className="w-7 h-7 text-zinc-400" />
              </div>
              <h3 className="text-[18px] font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight mb-2">Couldn't load your schedules</h3>
              <p className="text-[13.5px] text-zinc-500 leading-relaxed mb-6">
                Something went wrong reaching the server. Your agents are safe — this is just the list failing to load.
              </p>
              <button
                onClick={() => { setLoading(true); setLoadError(false); fetchAgents(); }}
                className="px-5 py-2.5 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 text-[13.5px] font-bold hover:bg-zinc-800 dark:hover:bg-white active:scale-95 transition-all"
              >
                Try again
              </button>
            </div>
          ) : agents.length === 0 ? (
            <TemplateCards onActivate={t => setActivatingTemplate(t)} />
          ) : (
            <div className="max-w-2xl mx-auto space-y-4">
              <AnimatePresence mode="popLayout">
                {agents.map(agent => (
                  <AgentTaskCard
                    key={agent.id}
                    agent={agent}
                    onClick={() => setSelectedAgent(agent)}
                    onToggle={() => handleToggle(agent)}
                    onEdit={() => setEditAgent(agent)}
                    onDelete={() => handleDelete(agent)}
                    onToggleConfirmations={() => handleToggleConfirmations(agent)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {(createOpen || activatingTemplate) && (
          <NewScheduleModal
            key="create"
            open
            onClose={() => { setCreateOpen(false); setActivatingTemplate(null); }}
            onSave={handleCreate}
            initial={activatingTemplate ? {
              name: activatingTemplate.name,
              task_description: activatingTemplate.task_description,
              cron_schedule: activatingTemplate.cron_schedule,
              output_channel: activatingTemplate.output_channel,
            } : undefined}
          />
        )}
        {editAgent && (
          <NewScheduleModal key="edit" open onClose={() => setEditAgent(null)} onSave={handleEdit} initial={editAgent} />
        )}
        {selectedAgent && (
          <AgentDetailModal
            agent={selectedAgent}
            onClose={() => setSelectedAgent(null)}
            onToggle={() => handleToggle(selectedAgent)}
            onEdit={() => { setEditAgent(selectedAgent); setSelectedAgent(null); }}
            onDelete={() => { handleDelete(selectedAgent); setSelectedAgent(null); }}
            onToggleConfirmations={() => handleToggleConfirmations(selectedAgent)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Page export (Suspense required for useSearchParams) ────────────────────────

export default function ScheduledPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-7 h-7 text-zinc-600 animate-spin" />
      </div>
    }>
      <ScheduledPageInner />
    </Suspense>
  );
}
