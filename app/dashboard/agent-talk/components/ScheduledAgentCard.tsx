'use client';

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, X, Repeat, CalendarClock, ShieldCheck, History, Pause, Play, ArrowUpRight } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { cleanRunSummary } from '@/lib/boult/report-summary';

// ── Channel icons ──────────────────────────────────────────────────────────────

function GmailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636C.732 21.002 0 20.27 0 19.366V5.457c0-.904.732-1.636 1.636-1.636h.273L12 10.728 21.091 3.821h.273c.904 0 1.636.732 1.636 1.636z" fill="#EA4335"/>
    </svg>
  );
}

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.521A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" fill="#E01E5A"/>
    </svg>
  );
}

// ── Browser-local TZ cron helpers ─────────────────────────────────────────────
// Running in the browser: setHours uses the user's local timezone automatically.

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function nextRunDateFromCron(cron: string): Date | null {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [minS, hourS, , , dowS] = p;
  if (hourS.startsWith('*/') || minS.startsWith('*/')) return null;
  const h = parseInt(hourS), m = parseInt(minS);
  if (isNaN(h) || isNaN(m)) return null;
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (/^\d$/.test(dowS)) {
    const target = Number(dowS);
    while (next <= now || next.getDay() !== target) next.setDate(next.getDate() + 1);
  } else if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function scheduleFromCron(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return cron;
  const [minS, hourS, , , dowS] = p;
  if (hourS.startsWith('*/')) return `Every ${hourS.slice(2)} hour(s)`;
  if (minS.startsWith('*/')) return `Every ${minS.slice(2)} minute(s)`;
  const h = parseInt(hourS), m = parseInt(minS);
  if (isNaN(h) || isNaN(m)) return cron;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (dowS === '*') return `Daily at ${timeStr}`;
  if (/^\d$/.test(dowS)) return `Weekly — ${DOW_FULL[Number(dowS)]} at ${timeStr}`;
  return `${timeStr} (${cron})`;
}

// ── Next-run countdown ─────────────────────────────────────────────────────────

function useCountdown(cron: string, fallbackIso?: string) {
  const compute = useCallback(() => {
    const next = nextRunDateFromCron(cron) ?? (fallbackIso ? new Date(fallbackIso) : null);
    if (!next) return '—';
    const diff = next.getTime() - Date.now();
    if (diff <= 0) return 'Any moment now';
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h >= 48) return `in ${Math.floor(h / 24)} days`;
    if (h >= 24) return 'tomorrow';
    if (h > 0) return `in ${h}h ${m}m`;
    return `in ${m} minute${m !== 1 ? 's' : ''}`;
  }, [cron, fallbackIso]);

  const [label, setLabel] = useState(compute);
  useEffect(() => {
    setLabel(compute());
    const id = setInterval(() => setLabel(compute()), 60_000);
    return () => clearInterval(id);
  }, [compute]);
  return label;
}

export interface ScheduledAgentData {
  id: string;
  name: string;
  task: string;
  scheduleLabel: string;
  cron: string;
  channel: string;
  skipConfirmations: boolean;
  status: string;
  nextRun?: string;
  // Next-gen scheduling (optional — absent = classic schedule agent).
  triggerType?: 'schedule' | 'event' | 'condition' | 'chained';
  conditions?: Array<{ field: string; op: string; value: string | number | string[] }>;
  pipelineCount?: number;
}

/** Human "how this fires" line — schedule cadence, event condition, or chain. */
function triggerSummary(data: ScheduledAgentData): string {
  const t = data.triggerType || 'schedule';
  if (t === 'event' || t === 'condition') {
    const conds = data.conditions || [];
    if (!conds.length) return 'On every new email';
    const c = conds[0];
    const head = `${c.field} ${c.op} "${c.value}"`;
    return conds.length > 1 ? `When ${head} +${conds.length - 1}` : `When ${head}`;
  }
  if (t === 'chained') return 'Triggered by a pipeline';
  return scheduleFromCron(data.cron);
}

function isScheduleTrigger(data: ScheduledAgentData): boolean {
  return (data.triggerType || 'schedule') === 'schedule';
}

function fmt(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// ── Detail sidebar ─────────────────────────────────────────────────────────────

function ScheduledAgentSidebar({
  data,
  onClose,
}: {
  data: ScheduledAgentData;
  onClose: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isDark = !mounted || resolvedTheme === 'dark';

  const [skip, setSkip] = useState(data.skipConfirmations);
  const [savingSkip, setSavingSkip] = useState(false);
  const [pastRun, setPastRun] = useState<
    { at: string | null; summary: string | null; status: string } | null
  >(null);
  const [loadingRuns, setLoadingRuns] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    (async () => {
      try {
        const res = await fetch('/api/boult/agents', { signal: controller.signal });
        if (cancelled) return;
        const json = await res.json();
        const agent = (json.agents || []).find((a: any) => a.id === data.id);
        if (!cancelled && agent) {
          setSkip(!!agent.skip_confirmations);
          setPastRun({
            at: agent.last_run_at || null,
            summary: agent.last_report_summary || null,
            status: agent.status || data.status,
          });
        }
      } catch {
        /* keep card-provided values on error */
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setLoadingRuns(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); clearTimeout(timeoutId); };
  }, [data.id]);

  const toggleSkip = async () => {
    const next = !skip;
    setSkip(next);
    setSavingSkip(true);
    try {
      await fetch('/api/boult/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: data.id, skip_confirmations: next }),
      });
    } catch {
      setSkip(!next); // revert on failure
    } finally {
      setSavingSkip(false);
    }
  };

  const statusVal = pastRun?.status || data.status;

  return createPortal(
    <div className="fixed inset-0 z-[99998]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className={cn(
          "absolute right-0 top-0 h-full w-full max-w-[420px] border-l flex flex-col transition-all",
          isDark 
            ? "bg-[#1A1A1A] border-white/10 text-white" 
            : "bg-[#FCFCFC] border-black/[0.08] text-neutral-900 shadow-2xl"
        )}
      >
        <div className={cn("flex items-start justify-between p-6 border-b", isDark ? "border-white/8" : "border-black/[0.06]")}>
          <div className="min-w-0">
            <p className={cn("text-[11px] font-semibold uppercase tracking-widest mb-1", isDark ? "text-white/30" : "text-neutral-400")}>
              Scheduled Background Agent
            </p>
            <h2 className={cn("text-[20px] font-bold leading-snug break-words", isDark ? "text-white/90" : "text-neutral-900")}>
              {data.name}
            </h2>
            <span
              className={cn(
                "inline-block mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide border",
                statusVal === 'paused'
                  ? (isDark ? 'bg-amber-500/15 text-amber-300 border-transparent' : 'bg-amber-50 text-amber-800 border-amber-200/60')
                  : (isDark ? 'bg-emerald-500/15 text-emerald-300 border-transparent' : 'bg-emerald-50 text-emerald-800 border-emerald-200/60')
              )}
            >
              {statusVal}
            </span>
          </div>
          <button
            onClick={onClose}
            className={cn(
              "p-2 -mr-2 rounded-lg transition-all",
              isDark ? "text-white/40 hover:text-white/80 hover:bg-white/6" : "text-neutral-400 hover:text-neutral-800 hover:bg-black/[0.04]"
            )}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div>
            <p className={cn("text-[11px] font-semibold uppercase tracking-widest mb-2", isDark ? "text-white/30" : "text-neutral-400")}>
              What it does
            </p>
            <p className={cn("text-[13px] leading-relaxed whitespace-pre-wrap", isDark ? "text-white/70" : "text-neutral-600")}>
              {data.task}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className={cn("flex items-center gap-2 text-[13px]", isDark ? "text-white/50" : "text-neutral-500")}>
                <Repeat className="w-4 h-4" /> {isScheduleTrigger(data) ? 'Repeat' : 'Trigger'}
              </span>
              <span className={cn("text-[13px] font-semibold text-right max-w-[60%] truncate", isDark ? "text-white/85" : "text-neutral-800")}>
                {triggerSummary(data)}
              </span>
            </div>
            {isScheduleTrigger(data) && (
              <div className="flex items-center justify-between">
                <span className={cn("flex items-center gap-2 text-[13px]", isDark ? "text-white/50" : "text-neutral-500")}>
                  <CalendarClock className="w-4 h-4" /> Next run
                </span>
                <span className={cn("text-[13px] font-semibold", isDark ? "text-white/85" : "text-neutral-800")}>
                  {fmt((nextRunDateFromCron(data.cron) ?? (data.nextRun ? new Date(data.nextRun) : null))?.toISOString())}
                </span>
              </div>
            )}
            {!!data.pipelineCount && (
              <div className="flex items-center justify-between">
                <span className={cn("flex items-center gap-2 text-[13px]", isDark ? "text-white/50" : "text-neutral-500")}>
                  <ArrowUpRight className="w-4 h-4" /> Chains to
                </span>
                <span className={cn("text-[13px] font-semibold", isDark ? "text-white/85" : "text-neutral-800")}>
                  {data.pipelineCount} agent{data.pipelineCount === 1 ? '' : 's'}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className={cn("flex items-center gap-2 text-[13px]", isDark ? "text-white/50" : "text-neutral-500")}>
                <ShieldCheck className="w-4 h-4" /> Skip confirmations
              </span>
              <button
                onClick={toggleSkip}
                disabled={savingSkip}
                className={cn(
                  "relative w-11 h-6 rounded-full transition-colors disabled:opacity-60",
                  skip ? 'bg-emerald-500' : (isDark ? 'bg-white/15' : 'bg-black/10')
                )}
                aria-pressed={skip}
              >
                <span
                  className={cn(
                    "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm",
                    skip ? 'translate-x-5' : ''
                  )}
                />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className={cn("text-[13px]", isDark ? "text-white/50" : "text-neutral-500")}>Delivery</span>
              <span className={cn("text-[13px] font-semibold capitalize", isDark ? "text-white/85" : "text-neutral-800")}>
                {data.channel}
              </span>
            </div>
          </div>

          <div>
            <p className={cn("flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest mb-3", isDark ? "text-white/30" : "text-neutral-400")}>
              <History className="w-3.5 h-3.5" /> Past runs
            </p>
            {loadingRuns ? (
              <div className={cn("h-16 rounded-xl animate-pulse", isDark ? "bg-white/5" : "bg-black/[0.03]")} />
            ) : pastRun?.at ? (
              <div className={cn("rounded-xl border p-4 transition-all", isDark ? "bg-white/5 border-white/8" : "bg-black/[0.02] border-black/[0.06]")}>
                <p className={cn("text-[12px] font-semibold", isDark ? "text-white/70" : "text-neutral-700")}>
                  {fmt(pastRun.at)}
                </p>
                {pastRun.summary && (
                  <p className={cn("text-[12px] mt-1.5 leading-relaxed line-clamp-4", isDark ? "text-white/45" : "text-neutral-500")}>
                    {cleanRunSummary(pastRun.summary)}
                  </p>
                )}
              </div>
            ) : (
              <p className={cn("text-[12px]", isDark ? "text-white/35" : "text-neutral-400")}>
                No runs yet — it will run at the next scheduled time.
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

// ── Inline chat card ───────────────────────────────────────────────────────────

export function ScheduledAgentCard({ data: initialData }: { data: ScheduledAgentData }) {
  const [data, setData] = useState(initialData);
  const [open, setOpen] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const countdown = useCountdown(data.cron, data.nextRun);
  const nextRunAbsolute = (() => {
    const next = nextRunDateFromCron(data.cron) ?? (data.nextRun ? new Date(data.nextRun) : null);
    if (!next || isNaN(next.getTime())) return null;
    return next.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  })();

  useEffect(() => { setMounted(true); }, []);
  const isDark = !mounted || resolvedTheme === 'dark';

  const isActive = data.status !== 'paused';

  const togglePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPausing(true);
    const nextStatus = isActive ? 'paused' : 'active';
    try {
      const res = await fetch('/api/boult/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: data.id, status: nextStatus }),
      });
      if (res.ok) setData(d => ({ ...d, status: nextStatus }));
    } catch { /* keep current state */ } finally {
      setIsPausing(false);
    }
  };

  const channel = data.channel?.toLowerCase() || 'gmail';

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
        className={cn(
          "mt-3 mb-1 w-full rounded-[20px] border overflow-hidden",
          isDark
            ? "bg-white/[0.04] border-white/[0.08]"
            : "bg-black/[0.02] border-black/[0.07] shadow-sm"
        )}
      >
        {/* Header */}
        <div className={cn(
          "flex items-center justify-between px-4 py-3 border-b",
          isDark ? "border-white/[0.07]" : "border-black/[0.05]"
        )}>
          <div className="flex items-center gap-2">
            {/* Pulse dot */}
            <span className="relative flex h-2 w-2">
              {isActive && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                isActive ? "bg-emerald-400" : "bg-amber-400"
              )} />
            </span>
            <span className={cn(
              "text-[11px] font-bold uppercase tracking-widest",
              isActive
                ? (isDark ? "text-emerald-400" : "text-emerald-700")
                : (isDark ? "text-amber-400" : "text-amber-700")
            )}>
              {isActive ? "Active Agent" : "Paused"}
            </span>
          </div>
          {/* Channel icons */}
          <div className="flex items-center gap-1.5">
            {(channel === 'gmail' || channel === 'both') && (
              <div className={cn("w-6 h-6 rounded-md flex items-center justify-center", isDark ? "bg-white/[0.06]" : "bg-black/[0.04]")}>
                <GmailIcon className="w-3.5 h-3.5" />
              </div>
            )}
            {(channel === 'slack' || channel === 'both') && (
              <div className={cn("w-6 h-6 rounded-md flex items-center justify-center", isDark ? "bg-white/[0.06]" : "bg-black/[0.04]")}>
                <SlackIcon className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left px-4 pt-3 pb-4"
        >
          <h3 className={cn("text-[16px] font-bold leading-snug mb-1", isDark ? "text-white/95" : "text-neutral-900")}>
            {data.name}
          </h3>
          <p className={cn("text-[12px] leading-relaxed line-clamp-2 mb-4", isDark ? "text-white/45" : "text-neutral-500")}>
            {data.task}
          </p>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div className="flex items-center gap-1.5">
              <Repeat className={cn("w-3.5 h-3.5 flex-shrink-0", isDark ? "text-white/30" : "text-neutral-400")} />
              <span className={cn("text-[12px] font-medium", isDark ? "text-white/70" : "text-neutral-700")}>
                {triggerSummary(data)}
              </span>
            </div>
            {isScheduleTrigger(data) ? (
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <Clock className={cn("w-3.5 h-3.5 flex-shrink-0", isDark ? "text-white/30" : "text-neutral-400")} />
                  <span className={cn("text-[12px] font-medium", isDark ? "text-white/70" : "text-neutral-700")}>
                    {countdown}
                  </span>
                </div>
                {nextRunAbsolute && (
                  <span className={cn("text-[10.5px] leading-tight mt-0.5 pl-5", isDark ? "text-white/35" : "text-neutral-400")}>
                    {nextRunAbsolute}
                  </span>
                )}
              </div>
            ) : (data.pipelineCount ? (
              <div className="flex items-center gap-1.5">
                <ArrowUpRight className={cn("w-3.5 h-3.5 flex-shrink-0", isDark ? "text-white/30" : "text-neutral-400")} />
                <span className={cn("text-[12px] font-medium", isDark ? "text-white/70" : "text-neutral-700")}>
                  → chains to {data.pipelineCount}
                </span>
              </div>
            ) : null)}
          </div>
        </button>

        {/* Footer actions */}
        <div className={cn(
          "flex items-center justify-between px-4 py-2.5 border-t",
          isDark ? "border-white/[0.06]" : "border-black/[0.05]"
        )}>
          <button
            onClick={togglePause}
            disabled={isPausing}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all",
              isActive
                ? (isDark ? "text-white/50 hover:text-white/80 hover:bg-white/[0.06]" : "text-neutral-500 hover:text-neutral-800 hover:bg-black/[0.05]")
                : "text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10",
              isPausing && "opacity-50 cursor-not-allowed"
            )}
          >
            {isActive
              ? <><Pause className="w-3.5 h-3.5" /> Pause</>
              : <><Play className="w-3.5 h-3.5" /> Resume</>
            }
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); router.push('/dashboard/agents'); }}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all",
              isDark
                ? "text-white/65 hover:text-white hover:bg-white/[0.08]"
                : "text-neutral-600 hover:text-neutral-900 hover:bg-black/[0.05]"
            )}
          >
            View Agents <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {open && <ScheduledAgentSidebar data={data} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}
