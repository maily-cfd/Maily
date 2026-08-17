'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signIn } from 'next-auth/react';
import { motion, AnimatePresence, useMotionValue, useTransform, useReducedMotion } from 'framer-motion';
import { Reply, CalendarClock, Clock, ArrowUpRight, RefreshCw, Loader2, Mail, ExternalLink, CheckCircle2, Check, SlidersHorizontal, Sun, Sunrise, Sunset, Moon, AlertTriangle, Sparkles, FileText, MessageSquare, ChevronDown, X, Archive } from 'lucide-react';
import { SiftDraftModal } from '@/components/ui/sift-draft-modal';
import { CustomizeBriefingModal } from '@/components/ui/customize-briefing-modal';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface DecideItem {
  id: string;
  threadId: string;
  sender: { name: string; email: string };
  subject: string;
  reason: string;
  receivedAt: string;
  gmailUrl: string;
  // AI-observed grounding ("4th email from her", "deadline is Friday") —
  // rendered as quiet chips under the reason. The confidence receipts.
  signals?: string[];
}
interface ShowUpItem {
  id: string;
  start: string;
  end: string | null;
  title: string;
  attendeeCount: number;
  meetLink: string | null;
  hangoutLink: string | null;
  isExternal: boolean;
  reason?: string;
  signals?: string[];
}
interface ChaseItem {
  id: string;
  threadId: string;
  recipient: { name: string; email: string };
  subject: string;
  daysSilent: number;
  sentAt: string;
  gmailUrl: string;
  reason?: string;
  signals?: string[];
}
interface ActionItem {
  id: string;
  text: string;
  dueAt: string | null;
  isOverdue: boolean;
  meetingTitle: string | null;
  attendees: string[];
}
interface AgentRunItem {
  id: string;
  agentName: string;
  status: 'success' | 'error' | 'transient_error' | 'running';
  summary: string | null;
  toolCalls: number;
  ranAt: string;
  artifactCounts: { gmail: number; calendar: number; notion: number; slack: number };
}

interface TodayPayload {
  decide: DecideItem[];
  showUp: ShowUpItem[];
  chase: ChaseItem[];
  actionItems: ActionItem[];
  agentRuns?: AgentRunItem[];
  emptyAll: boolean;
  generatedAt: string;
  gmailConnected: boolean;
  calendarConnected: boolean;
  needsReconnect?: { gmail?: boolean; calendar?: boolean };
  briefing?: string;
  // Transparent Reasoning (P6): how the day was prioritized — revealed on demand
  // under "Why this order?" so the founder understands the triage, not just accepts it.
  reasoning?: string;
  triage?: { scanned: number; surfaced: number };
  pendingApprovals?: number;
}

function formatDueLabel(dueAt: string | null, isOverdue: boolean): string {
  if (!dueAt) return 'no deadline';
  if (isOverdue) {
    try {
      const days = Math.floor((Date.now() - new Date(dueAt).getTime()) / (24 * 60 * 60 * 1000));
      return days >= 1 ? `${days}d overdue` : 'overdue';
    } catch {
      return 'overdue';
    }
  }
  try {
    const d = new Date(dueAt);
    const ms = d.getTime() - Date.now();
    const hours = Math.round(ms / (60 * 60 * 1000));
    if (hours < 24) return hours <= 1 ? 'due now' : `due in ${hours}h`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'due tomorrow' : `due in ${days}d`;
  } catch {
    return 'due soon';
  }
}

function formatStartTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  } catch {
    return '';
  }
}

function senderInitial(name: string): string {
  return (name || '?').trim()[0]?.toUpperCase() || '?';
}


function linkify(text: string) {
    if (!text) return '';
    const urlRegex = /(https?:\/\/[^\s<]+[^.,;?!)\]\s<])/g;
    return text.replace(urlRegex, (url) => {
        const displayUrl = url.length > 55 ? url.substring(0, 52) + '...' : url;
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline underline-offset-4 decoration-blue-500/30 transition-all font-medium">${displayUrl}</a>`;
    });
}

const renderMarkdown = (text: string): string => {
    if (!text) return text;
    text = text.replace(/<br\s*\/?>/gi, '\n');

    const paragraphs = text.split(/\n\n+/);
    const renderedParagraphs = paragraphs.map(para => {
        let processedPara = para.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-black dark:text-white brightness-125">$1</strong>');

        if (processedPara.includes('\n- ') || processedPara.startsWith('- ') || processedPara.includes('\n* ') || processedPara.startsWith('* ')) {
            const lines = processedPara.split('\n');
            const listItems = lines.map(line => {
                const match = line.match(/^[\s]*[-*]\s*(.*)$/);
                if (match) {
                    return `<li>${match[1]}</li>`;
                }
                return line;
            });

            let joinedList = listItems.join('\n');
            joinedList = joinedList.replace(/(<li>[\s\S]*?<\/li>(?:\n<li>[\s\S]*?<\/li>)*)/g, '<ul class="list-disc list-inside my-4 space-y-2">$1</ul>');
            return joinedList;
        }

        processedPara = linkify(processedPara);
        processedPara = processedPara.replace(/\n/g, '<br/>');

        return `<p class="mb-4 last:mb-0">${processedPara}</p>`;
    });

    return renderedParagraphs.join('');
};

interface BucketHeaderProps {
  label: string;
  count: number;
  icon: React.ReactNode;
}

function BucketHeader({ label, count, icon }: BucketHeaderProps) {
  return (
    <div className="flex items-center gap-2.5 mb-3.5">
      <div className="w-7 h-7 rounded-lg bg-black/[0.04] dark:bg-white/[0.05] flex items-center justify-center text-black/65 dark:text-white/65 ring-1 ring-black/[0.03] dark:ring-white/[0.04]">
        {icon}
      </div>
      <h2 className="text-[11.5px] font-semibold tracking-[0.14em] uppercase text-black/55 dark:text-white/55">
        {label}
      </h2>
      {count > 0 && (
        <>
          <span className="text-[11px] text-black/25 dark:text-white/25">·</span>
          <span className="text-[11px] tabular-nums text-black/40 dark:text-white/40 font-medium">
            {count}
          </span>
        </>
      )}
    </div>
  );
}

function EmptyBucket({ message }: { message: string }) {
  return (
    <div className="py-5 px-4 rounded-2xl border border-dashed border-black/[0.06] dark:border-white/[0.06] text-[13px] text-black/35 dark:text-white/35 leading-relaxed">
      {message}
    </div>
  );
}

interface ItemCardProps {
  topLeft: string;
  topRight?: string;
  title: string;
  reason: string;
  // AI-observed grounding chips ("4th email from her") — quiet receipts that
  // show the pick isn't random. Rendered only when the AI supplied them.
  signals?: string[];
  primaryAction: { label: string; onClick: () => void };
  secondaryAction?: { label: string; href: string };
  onDismiss?: () => void;
}

// Inner card content (kept separate so the dismiss variant can wrap it with a
// reveal-behind affordance while AnimatePresence still animates the row in/out).
function ItemCardBody({ topLeft, topRight, title, reason, signals, primaryAction, secondaryAction, onDismiss, dragProps }: ItemCardProps & { dragProps?: any }) {
  return (
    <motion.div
      {...(dragProps || {})}
      whileHover={{ y: -1 }}
      tabIndex={onDismiss ? 0 : undefined}
      role={onDismiss ? 'article' : undefined}
      aria-label={onDismiss ? `${topLeft}: ${title}. Press E or Backspace to remove.` : undefined}
      onKeyDown={onDismiss ? (e: any) => {
        if (e.key === 'e' || e.key === 'E' || e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onDismiss(); }
      } : undefined}
      className="group relative liquid-glass-card rounded-2xl px-4 py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/20"
    >
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          title="Remove (swipe left, or press E)"
          aria-label="Remove from list"
          className="absolute top-2.5 right-2.5 z-10 w-6 h-6 rounded-full flex items-center justify-center text-black/30 dark:text-white/30 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/[0.06] dark:hover:bg-white/[0.08] hover:text-black/70 dark:hover:text-white/70 transition-all"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2.25} />
        </button>
      )}
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full bg-black/[0.05] dark:bg-white/[0.07] flex items-center justify-center text-[11px] font-semibold text-black/70 dark:text-white/70 flex-shrink-0 tracking-tight">
            {senderInitial(topLeft)}
          </div>
          <span className="text-[13px] font-medium text-black/80 dark:text-white/80 truncate tracking-tight">{topLeft}</span>
        </div>
        {topRight && (
          <span className="text-[11px] tabular-nums text-black/35 dark:text-white/35 flex-shrink-0">{topRight}</span>
        )}
      </div>
      <h3 className="text-[14.5px] font-medium text-black dark:text-white truncate mb-1 tracking-tight leading-snug">{title}</h3>
      <p className="text-[12.5px] text-black/50 dark:text-white/45 mb-3 line-clamp-1 leading-relaxed">{reason}</p>
      {signals && signals.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 -mt-1.5 mb-3">
          {signals.map((s, i) => (
            <span
              key={i}
              className="inline-flex items-center px-2 py-[3px] rounded-full border border-black/[0.07] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.03] text-[10.5px] text-black/45 dark:text-white/40 leading-snug"
            >
              {s}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={primaryAction.onClick}
          className="inline-flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full text-[12px] font-medium !bg-black !text-white dark:!bg-white dark:!text-black hover:opacity-85 active:scale-[0.97] transition-all duration-150"
        >
          {primaryAction.label}
          <ArrowUpRight className="w-3 h-3 group-hover:translate-x-[1px] group-hover:-translate-y-[1px] transition-transform duration-200" strokeWidth={2.25} />
        </button>
        {secondaryAction && (
          <a
            href={secondaryAction.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
          >
            {secondaryAction.label}
            <ExternalLink className="w-3 h-3" strokeWidth={2} />
          </a>
        )}
      </div>
    </motion.div>
  );
}

// Swipeable row: direct-manipulation drag with a reveal-behind "Remove" affordance,
// keyboard + hover-button equivalents, and prefers-reduced-motion support. The OUTER
// motion.div owns enter/exit (so AnimatePresence animates the row); the INNER one
// drags. Threshold = ~40% of a typical card width (~120px) before release commits.
function ItemCard(props: ItemCardProps) {
  const { onDismiss } = props;
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  // The Remove affordance fades/scales in as the card is dragged left.
  const revealOpacity = useTransform(x, [-120, -50, 0], [1, 0.25, 0]);
  const revealScale = useTransform(x, [-120, -40, 0], [1, 0.9, 0.9]);

  if (!onDismiss) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
        <ItemCardBody {...props} />
      </motion.div>
    );
  }

  const dragProps = reduceMotion ? {} : {
    style: { x },
    drag: 'x' as const,
    dragConstraints: { left: 0, right: 0 },
    dragElastic: { left: 0.9, right: 0.03 },
    onDragEnd: (_e: any, info: { offset: { x: number } }) => { if (info.offset.x < -90) onDismiss(); },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, x: -80, transition: { duration: 0.18 } }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="relative"
    >
      {/* Reveal-behind: slides in as you drag left so the gesture is discoverable */}
      <motion.div
        aria-hidden
        style={reduceMotion ? undefined : { opacity: revealOpacity, scale: revealScale }}
        className="absolute inset-0 rounded-2xl bg-red-500/[0.10] dark:bg-red-500/[0.14] flex items-center justify-end pr-6 pointer-events-none"
      >
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-red-500 dark:text-red-400">
          <Archive className="w-4 h-4" strokeWidth={2} /> Remove
        </span>
      </motion.div>
      <ItemCardBody {...props} dragProps={dragProps} />
    </motion.div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.04] rounded-2xl px-4 py-3.5 animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-full bg-black/[0.06] dark:bg-white/[0.06]" />
        <div className="h-3 w-28 rounded bg-black/[0.06] dark:bg-white/[0.06]" />
      </div>
      <div className="h-3.5 w-3/4 rounded bg-black/[0.06] dark:bg-white/[0.06] mb-2" />
      <div className="h-3 w-1/2 rounded bg-black/[0.04] dark:bg-white/[0.04] mb-3" />
      <div className="h-7 w-24 rounded-full bg-black/[0.05] dark:bg-white/[0.05]" />
    </div>
  );
}

// "While you were away" — the command-center section. Surfaces what the user's
// scheduled agents did recently, so the FIRST thing a founder sees on HomeFeed
// is their agents' work, not just their inbox. This is the spec's core promise.

interface RunDetail {
  plan: string | null;
  tools: Array<{ label: string; count: number; ok: boolean }>;
  links: {
    gmail: Array<{ label: string; url: string }>;
    calendar: Array<{ label: string; url: string }>;
    notion: Array<{ label: string; url: string }>;
    slack: Array<{ label: string; url: string }>;
  };
}

function artifactChips(c: AgentRunItem['artifactCounts']) {
  return [
    { icon: Mail, n: c.gmail, label: c.gmail === 1 ? 'draft' : 'drafts' },
    { icon: CalendarClock, n: c.calendar, label: c.calendar === 1 ? 'event' : 'events' },
    { icon: FileText, n: c.notion, label: c.notion === 1 ? 'note' : 'notes' },
    { icon: MessageSquare, n: c.slack, label: 'Slack' },
  ].filter(x => x.n > 0);
}

// One run = one collapsible card. Collapsed: status + name + summary + chips
// (the 10-second glance). Expanded: plan -> tools -> direct links (the full
// transparency stack), fetched lazily on first open so the feed stays fast.
function AgentRunCard({ run }: { run: AgentRunItem }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState(false);

  const failed = run.status === 'error' || run.status === 'transient_error';
  const running = run.status === 'running';
  const chips = artifactChips(run.artifactCounts);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !loadingDetail) {
      setLoadingDetail(true);
      setDetailError(false);
      try {
        const res = await fetch(`/api/home-feed/run-detail?runId=${encodeURIComponent(run.id)}`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        setDetail({ plan: json.plan ?? null, tools: json.tools ?? [], links: json.links ?? { gmail: [], calendar: [], notion: [], slack: [] } });
      } catch {
        setDetailError(true);
      } finally {
        setLoadingDetail(false);
      }
    }
  };

  const linkGroups: Array<{ key: keyof RunDetail['links']; label: string; icon: any }> = [
    { key: 'gmail', label: 'Gmail drafts', icon: Mail },
    { key: 'calendar', label: 'Calendar events', icon: CalendarClock },
    { key: 'notion', label: 'Notion pages', icon: FileText },
    { key: 'slack', label: 'Slack messages', icon: MessageSquare },
  ];
  const hasAnyLink = detail && linkGroups.some(g => detail.links[g.key]?.length);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="liquid-glass-card rounded-2xl overflow-hidden"
    >
      {/* Collapsed header — always visible, the 10-second glance */}
      <button type="button" onClick={toggle} className="w-full text-left px-4 py-3.5 group">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={cn(
            'inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0',
            failed ? 'text-amber-600 dark:text-amber-400'
              : running ? 'text-black/40 dark:text-white/40'
              : 'text-emerald-600 dark:text-emerald-400',
          )}>
            {failed ? <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />
              : running ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />}
          </span>
          <span className="text-[13px] font-semibold text-black dark:text-white truncate">{run.agentName}</span>
          <span className="text-[11px] text-black/35 dark:text-white/35 flex-shrink-0">{formatRelative(run.ranAt)} ago</span>
          <ChevronDown className={cn('w-4 h-4 text-black/30 dark:text-white/30 transition-transform ml-auto flex-shrink-0', open && 'rotate-180')} strokeWidth={2} />
        </div>
        {run.summary && (
          <p className={cn('text-[12.5px] text-black/60 dark:text-white/60 leading-relaxed pl-7', !open && 'line-clamp-2')}>{run.summary}</p>
        )}
        {!open && (chips.length > 0 || run.toolCalls > 0) && (
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 pl-7">
            {chips.map((chip, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[11px] text-black/45 dark:text-white/45">
                <chip.icon className="w-3 h-3" strokeWidth={1.75} />
                {chip.n} {chip.label}
              </span>
            ))}
            {chips.length === 0 && run.toolCalls > 0 && (
              <span className="text-[11px] text-black/40 dark:text-white/40">{run.toolCalls} {run.toolCalls === 1 ? 'action' : 'actions'} taken</span>
            )}
          </div>
        )}
      </button>

      {/* Expanded — the full transparency stack */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pl-11 space-y-4">
              {loadingDetail && (
                <div className="flex items-center gap-2 text-[12px] text-black/40 dark:text-white/40 pt-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading details…
                </div>
              )}
              {detailError && (
                <p className="text-[12px] text-black/45 dark:text-white/45 pt-1">Couldn't load the details for this run.</p>
              )}

              {detail && !loadingDetail && (
                <>
                  {/* Plan — what Boult decided to do */}
                  {detail.plan && (
                    <div>
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-black/35 dark:text-white/35 mb-1.5">The plan</p>
                      <p className="text-[12.5px] text-black/65 dark:text-white/65 leading-relaxed whitespace-pre-line">{detail.plan}</p>
                    </div>
                  )}

                  {/* Tools — what actually executed */}
                  {detail.tools.length > 0 && (
                    <div>
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-black/35 dark:text-white/35 mb-1.5">What it did</p>
                      <ul className="space-y-1">
                        {detail.tools.map((t, i) => (
                          <li key={i} className="flex items-center gap-2 text-[12.5px] text-black/65 dark:text-white/65">
                            <span className={cn('w-1 h-1 rounded-full flex-shrink-0', t.ok ? 'bg-emerald-500/70' : 'bg-amber-500/70')} />
                            <span>{t.label}{t.count > 1 ? ` ×${t.count}` : ''}{!t.ok ? ' — failed' : ''}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Direct links — clickable artifacts */}
                  {hasAnyLink && (
                    <div>
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-black/35 dark:text-white/35 mb-1.5">Open what it made</p>
                      <div className="space-y-2">
                        {linkGroups.map(g => {
                          const items = detail.links[g.key];
                          if (!items?.length) return null;
                          return (
                            <div key={g.key}>
                              {items.map((lnk, i) => (
                                <a
                                  key={i}
                                  href={lnk.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 text-[12.5px] text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white py-1 group/link"
                                >
                                  <g.icon className="w-3.5 h-3.5 flex-shrink-0 text-black/40 dark:text-white/40" strokeWidth={1.75} />
                                  <span className="truncate">{lnk.label}</span>
                                  <ExternalLink className="w-3 h-3 flex-shrink-0 text-black/0 group-hover/link:text-black/40 dark:group-hover/link:text-white/40 transition-colors" strokeWidth={2} />
                                </a>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!detail.plan && detail.tools.length === 0 && !hasAnyLink && (
                    <p className="text-[12px] text-black/45 dark:text-white/45">This was a read-only scan — no plan, actions, or artifacts recorded.</p>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AgentRunsSection({ runs, pendingApprovals }: { runs: AgentRunItem[]; pendingApprovals?: number }) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-black/[0.04] dark:bg-white/[0.05] text-black/55 dark:text-white/55">
          <Sparkles className="w-4 h-4" strokeWidth={1.75} />
        </div>
        <h2 className="text-[13px] font-semibold tracking-tight text-black dark:text-white">While you were away</h2>
      </div>
      {/* APPROVAL MODE — the work is done; these are the signatures it's waiting
          on. Framed as confirmation ("waiting for your OK"), never as a task. */}
      {typeof pendingApprovals === 'number' && pendingApprovals > 0 && (
        <a
          href="/dashboard/agent-talk"
          className="group flex items-center justify-between gap-3 mb-2.5 px-4 py-3 rounded-2xl border border-amber-500/25 dark:border-amber-400/20 bg-amber-500/[0.04] dark:bg-amber-400/[0.05] hover:border-amber-500/45 dark:hover:border-amber-400/40 transition-colors"
        >
          <span className="text-[12.5px] text-black/70 dark:text-white/70 leading-snug">
            <span className="font-semibold text-black dark:text-white">{pendingApprovals} {pendingApprovals === 1 ? 'action' : 'actions'}</span>
            {' '}ready — waiting for your OK
          </span>
          <span className="text-[12px] font-medium text-black/50 dark:text-white/50 group-hover:text-black dark:group-hover:text-white transition-colors flex items-center gap-1 flex-shrink-0">
            Review <ArrowUpRight className="w-3 h-3" strokeWidth={2.25} />
          </span>
        </a>
      )}
      <div className="space-y-2.5">
        {runs.map((run) => <AgentRunCard key={run.id} run={run} />)}
      </div>
    </section>
  );
}

// In-memory snapshot so swapping tabs (which remounts this component) is instant.
// Stale-while-revalidate: show cached data immediately, refresh in the background.
// Also persisted to localStorage so a full page RELOAD is instant too (not just tab
// swaps), and so we can serve cache when offline / the token's expired. The payload
// is small (a few buckets), so localStorage is the pragmatic store; IndexedDB would
// be the move if this ever held large per-message bodies.
let TODAY_CACHE: TodayPayload | null = null;
const TODAY_PERSIST_KEY = 'maily_today_snapshot';
const TODAY_PERSIST_TTL = 24 * 60 * 60 * 1000;

function loadPersistedToday(): TodayPayload | null {
  if (TODAY_CACHE) return TODAY_CACHE;
  try {
    const raw = localStorage.getItem(TODAY_PERSIST_KEY);
    if (!raw) return null;
    const { at, payload } = JSON.parse(raw);
    if (!payload || Date.now() - at > TODAY_PERSIST_TTL) return null;
    TODAY_CACHE = payload as TodayPayload;
    return TODAY_CACHE;
  } catch { return null; }
}
function persistToday(payload: TodayPayload) {
  TODAY_CACHE = payload;
  try { localStorage.setItem(TODAY_PERSIST_KEY, JSON.stringify({ at: Date.now(), payload })); } catch { /* quota */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommendations — "Worth your time"
// ─────────────────────────────────────────────────────────────────────────────
//
// 100% accurate by construction: every number, name, and stat below is read
// straight off the real `today` payload (the same Gmail/Calendar/ledger data the
// buckets render). NOTHING here is LLM-generated, so it can't hallucinate a lead
// or a count — and it's instant (pure compute in a useMemo, no network). The
// recommendations just re-rank the day's real signals into the few highest-
// leverage next steps and phrase them with deterministic templates.

interface RecStat { value: number; label: string; }
type RecTone = 'connect' | 'focus' | 'momentum';
interface Recommendation {
  id: string;
  tone: RecTone;
  icon: React.ReactNode;
  title: string;
  summary: string;
  stat: RecStat;
  cta: { label: string; prompt: string };
  // How many REAL feed items this pick references (server-validated refIds).
  groundedIn?: number;
  // A hidden loss caught before it slips — shown with a protective tag.
  atRisk?: boolean;
}


// Display-clean a name so raw fragments ("nand", "ANAND.K", an email) never reach
// the UI looking broken. Mirrors the server-side cleanName in the recs endpoint.
function cleanName(raw: string): string {
  let s = (raw || '').replace(/^["'<]+|["'>]+$/g, '').trim();
  if (!s) return 'someone';
  if (s.includes('@')) s = s.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return s
    .split(/\s+/)
    .map(w => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ') || 'someone';
}

function namesList(names: string[], max = 2): string {
  const clean = names.map(n => cleanName(n)).filter(n => n && n !== 'someone');
  if (clean.length === 0) return 'a few people';
  const shown = clean.slice(0, max);
  const extra = clean.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} +${extra} more` : shown.join(' and ');
}

// Turn the route's generic bucket labels into something that reads like a person
// wrote it, while leaving already-specific (AI-enriched) reasons untouched.
function humanizeReason(reason: string): string {
  const map: Record<string, string> = {
    'Money on the line': 'a revenue thread is waiting on you',
    'Flagged urgent': 'they flagged it urgent',
    'Direct question': 'they asked you a direct question',
    'Wants time on your calendar': 'they want time on your calendar',
    'Needs your attention': 'it needs your call',
  };
  return map[reason?.trim()] || reason || 'waiting on you';
}

// Deterministic fallback recommendations — built PURELY from the real buckets,
// with zero LLM. Shown when the AI recs are unavailable (rate-limited / offline)
// so the section degrades to accurate, instant picks instead of vanishing after
// it analyzes. Every number and name is read straight off the payload, so it can
// never hallucinate a lead or a count. Ordered by what costs most to miss.
function buildDeterministicRecs(
  decide: DecideItem[],
  chase: ChaseItem[],
  actionItems: ActionItem[],
  showUp: ShowUpItem[],
): Recommendation[] {
  const out: Recommendation[] = [];

  // 1. Overdue promises — you committed and it's past due (highest cost to miss).
  const overdue = actionItems.filter(a => a.isOverdue);
  if (overdue.length > 0) {
    out.push({
      id: 'det-overdue',
      tone: 'focus',
      icon: <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />,
      title: overdue.length === 1 ? 'Close an overdue promise' : `Close ${overdue.length} overdue promises`,
      summary: overdue.length === 1
        ? `You committed to "${(overdue[0].text || '').slice(0, 80)}" and it's past due.`
        : `${overdue.length} things you committed to are past due — clear them before they cost you.`,
      stat: { value: overdue.length, label: 'overdue' },
      cta: { label: 'Show me', prompt: 'Show me my overdue promises and help me close each one.' },
      groundedIn: overdue.length,
      atRisk: true,
    });
  }

  // 2. Replies waiting on you (Decide).
  if (decide.length > 0) {
    const first = decide[0];
    const who = cleanName(first.sender?.name || first.sender?.email || '');
    out.push({
      id: 'det-decide',
      tone: 'focus',
      icon: <Reply className="w-3.5 h-3.5" strokeWidth={2} />,
      title: decide.length === 1 ? `Reply to ${who}` : `Clear ${decide.length} replies waiting on you`,
      summary: decide.length === 1
        ? `${who} — ${humanizeReason(first.reason)}.`
        : `${decide.length} threads need your response today — draft them in one pass and move on.`,
      stat: { value: decide.length, label: decide.length === 1 ? 'reply needed' : 'replies needed' },
      cta: {
        label: decide.length === 1 ? 'Draft reply' : 'Draft replies',
        prompt: decide.length === 1
          ? `Draft a reply to ${who}'s email "${(first.subject || '').slice(0, 100)}".`
          : `Draft replies to the ${decide.length} emails waiting on me in my inbox today.`,
      },
      groundedIn: decide.length,
    });
  }

  // 3. Follow-ups going quiet (Chase) — relationship at risk of stalling.
  if (chase.length > 0) {
    const first = chase[0];
    const who = cleanName(first.recipient?.name || first.recipient?.email || '');
    const maxSilent = Math.max(...chase.map(c => c.daysSilent || 0));
    out.push({
      id: 'det-chase',
      tone: 'connect',
      icon: <Clock className="w-3.5 h-3.5" strokeWidth={2} />,
      title: chase.length === 1 ? `Follow up with ${who}` : `Nudge ${chase.length} threads going quiet`,
      summary: chase.length === 1
        ? `You emailed ${who} ${first.daysSilent}d ago about "${(first.subject || '').slice(0, 60)}" — still no reply.`
        : `${chase.length} threads you started have gone quiet — a nudge keeps them warm.`,
      stat: chase.length === 1 ? { value: first.daysSilent || 0, label: 'days silent' } : { value: chase.length, label: 'going quiet' },
      cta: {
        label: 'Draft nudge',
        prompt: chase.length === 1
          ? `Draft a warm, low-pressure follow-up to ${who} about "${(first.subject || '').slice(0, 100)}".`
          : 'Draft friendly follow-up nudges for the threads I am waiting to hear back on.',
      },
      groundedIn: chase.length,
      atRisk: maxSilent >= 7,
    });
  }

  // 4. Meetings to prep for.
  if (showUp.length > 0) {
    const first = showUp[0];
    out.push({
      id: 'det-meeting',
      tone: 'momentum',
      icon: <CalendarClock className="w-3.5 h-3.5" strokeWidth={2} />,
      title: showUp.length === 1 ? 'Prep for your meeting' : `Prep for ${showUp.length} meetings`,
      summary: showUp.length === 1
        ? `"${(first.title || 'A meeting').slice(0, 60)}" is on your calendar — walk in ready.`
        : `${showUp.length} meetings on your calendar — pull context and agendas so you walk in ready.`,
      stat: { value: showUp.length, label: showUp.length === 1 ? 'to prep' : 'meetings' },
      cta: { label: 'Prep me', prompt: 'Prep me for my meetings today — pull the relevant context and draft an agenda for each.' },
      groundedIn: showUp.length,
    });
  }

  return out.slice(0, 4);
}

const TONE_CHIP: Record<RecTone, string> = {
  connect: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/[0.08] dark:bg-emerald-400/[0.08]',
  focus: 'text-black/70 dark:text-white/70 bg-black/[0.05] dark:bg-white/[0.07]',
  momentum: 'text-violet-700 dark:text-violet-300 bg-violet-500/[0.08] dark:bg-violet-400/[0.08]',
};
const TONE_LABEL: Record<RecTone, string> = { connect: 'Connection', focus: 'Productivity', momentum: 'Momentum' };

function RecommendationCard({ rec, onAct }: { rec: Recommendation; onAct: (prompt: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -1 }}
      className="group relative liquid-glass-card rounded-2xl px-4 py-3.5"
    >
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ring-1 ring-black/[0.03] dark:ring-white/[0.04]', TONE_CHIP[rec.tone])}>
          {rec.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {rec.atRisk ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-md text-amber-700 dark:text-amber-300 bg-amber-500/[0.1] dark:bg-amber-400/[0.1]">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                Before it slips
              </span>
            ) : (
              <span className={cn('text-[10px] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-md', TONE_CHIP[rec.tone])}>
                {TONE_LABEL[rec.tone]}
              </span>
            )}
            <span className="text-[11px] tabular-nums text-black/40 dark:text-white/40 font-medium">
              {rec.stat.value} <span className="text-black/30 dark:text-white/30">{rec.stat.label}</span>
            </span>
          </div>
          <h3 className="text-[14.5px] font-medium text-black dark:text-white mb-1 tracking-tight leading-snug">{rec.title}</h3>
          <p className="text-[12.5px] text-black/50 dark:text-white/45 mb-3 line-clamp-2 leading-relaxed">{rec.summary}</p>
          <button
            type="button"
            onClick={() => onAct(rec.cta.prompt)}
            className="inline-flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full text-[12px] font-medium !bg-black !text-white dark:!bg-white dark:!text-black hover:opacity-85 active:scale-[0.97] transition-all duration-150"
          >
            {rec.cta.label}
            <ArrowUpRight className="w-3 h-3 group-hover:translate-x-[1px] group-hover:-translate-y-[1px] transition-transform duration-200" strokeWidth={2.25} />
          </button>
          {typeof rec.groundedIn === 'number' && rec.groundedIn > 0 && (
            <span
              className="ml-auto text-[10.5px] text-black/30 dark:text-white/25 flex-shrink-0"
              title="Every recommendation references verified items from your real feed — never invented."
            >
              from {rec.groundedIn} real {rec.groundedIn === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// The "where your attention goes today" bar — a dependency-free stacked bar +
// legend, all counts pulled straight from the real buckets.
// A live "still working" dot for the briefing header — a soft ping ring.
function PulseDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full rounded-full bg-black/30 dark:bg-white/30 opacity-75 animate-ping" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-black/70 dark:bg-white/70" />
    </span>
  );
}

// Skeleton recommendation card — shown while the AI is composing the picks, so
// the RECOMMENDATIONS section reads as "loading", not empty.
function SkeletonRecCard() {
  return (
    <div className="bg-white dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-9 h-9 rounded-xl bg-black/[0.05] dark:bg-white/[0.06] animate-pulse flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-2.5 py-1">
          <div className="h-3 w-[60%] rounded-full bg-black/[0.07] dark:bg-white/[0.07] animate-pulse" />
          <div className="h-2.5 w-[88%] rounded-full bg-black/[0.04] dark:bg-white/[0.04] animate-pulse" />
        </div>
        <div className="h-6 w-16 rounded-full bg-black/[0.05] dark:bg-white/[0.06] animate-pulse flex-shrink-0" />
      </div>
    </div>
  );
}

// AI recommendation as returned by /api/home-feed/recommendations. The copy is
// AI-written + grounded; the stat is server-computed from real items.
interface AiRecDTO {
  id: string;
  category: 'connect' | 'productivity';
  title: string;
  summary: string;
  boultPrompt: string;
  ctaLabel: string;
  stat: { value: number; label: string };
  // Opportunity Detection: a hidden loss caught before it slips.
  atRisk?: boolean;
  // Server-validated refs to the REAL items this pick is built from (the
  // anti-hallucination gate) — the count doubles as the grounding receipt.
  refIds?: string[];
}

function aiToRec(dto: AiRecDTO): Recommendation {
  return {
    id: dto.id,
    tone: dto.category === 'connect' ? 'connect' : 'focus',
    icon: dto.category === 'connect'
      ? <MessageSquare className="w-3.5 h-3.5" strokeWidth={2} />
      : <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />,
    title: dto.title,
    summary: dto.summary,
    stat: dto.stat,
    cta: { label: dto.ctaLabel, prompt: dto.boultPrompt },
    groundedIn: Array.isArray(dto.refIds) ? dto.refIds.length : undefined,
    atRisk: dto.atRisk === true,
  };
}

const REC_CACHE_PREFIX = 'maily_airecs_';
const REC_APPS_PREFIX = 'maily_airec_apps_';

// Read AI recs from sessionStorage synchronously so frame 1 already knows whether
// to show the cached picks or the loading skeletons (no deterministic flash).
function readCachedRecs(generatedAt: string): Recommendation[] | null {
  if (!generatedAt || typeof window === 'undefined') return null;
  try {
    const cached = sessionStorage.getItem(REC_CACHE_PREFIX + generatedAt);
    if (cached) {
      const dtos = JSON.parse(cached) as AiRecDTO[];
      if (Array.isArray(dtos) && dtos.length) return dtos.map(aiToRec);
    }
  } catch { /* ignore */ }
  return null;
}

// The connected apps the recommendations drew on (e.g. Gmail, Notion, Slack) —
// surfaced in the footer so the user can see it's reading cross-app, not just Gmail.
function readCachedApps(generatedAt: string): string[] {
  if (!generatedAt || typeof window === 'undefined') return [];
  try {
    const cached = sessionStorage.getItem(REC_APPS_PREFIX + generatedAt);
    if (cached) { const a = JSON.parse(cached); if (Array.isArray(a)) return a; }
  } catch { /* ignore */ }
  return [];
}

function RecommendationsSection({
  decide, chase, actionItems, showUp, agentRuns, checkedAgo, generatedAt, servingCached, triage, onAct, onRefresh, onCustomize,
}: {
  decide: DecideItem[];
  chase: ChaseItem[];
  actionItems: ActionItem[];
  showUp: ShowUpItem[];
  agentRuns: AgentRunItem[];
  checkedAgo: string | null;
  generatedAt: string;
  servingCached?: boolean;
  triage?: { scanned: number; surfaced: number };
  onAct: (prompt: string) => void;
  onRefresh: () => void;
  onCustomize: () => void;
}) {
  const hasData = decide.length + chase.length + actionItems.length + showUp.length > 0;
  const [aiRecs, setAiRecs] = useState<Recommendation[] | null>(() => readCachedRecs(generatedAt));
  const [aiApps, setAiApps] = useState<string[]>(() => readCachedApps(generatedAt));
  // Start in the reviewing state when we'll fetch (data present + no cache), so the
  // skeletons show from the first frame instead of flashing deterministic cards.
  const [aiLoading, setAiLoading] = useState<boolean>(() => hasData && !readCachedRecs(generatedAt));

  // Fetch AI recommendations once per data snapshot (keyed by generatedAt),
  // cached in sessionStorage so tab swaps / remounts are instant and don't re-bill.
  useEffect(() => {
    if (!generatedAt) return;
    if (decide.length + chase.length + actionItems.length + showUp.length === 0) return;
    const cacheKey = REC_CACHE_PREFIX + generatedAt;
    let cancelled = false;

    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const dtos = JSON.parse(cached) as AiRecDTO[];
        if (Array.isArray(dtos) && dtos.length) { setAiRecs(dtos.map(aiToRec)); return; }
      }
    } catch { /* ignore */ }

    setAiLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/home-feed/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decide, chase, actionItems, showUp, agentRuns }),
        });
        const json = await res.json().catch(() => null);
        const dtos: AiRecDTO[] = json?.recommendations || [];
        const apps: string[] = Array.isArray(json?.apps) ? json.apps : [];
        if (!cancelled) {
          if (apps.length) {
            setAiApps(apps);
            try { sessionStorage.setItem(REC_APPS_PREFIX + generatedAt, JSON.stringify(apps)); } catch { /* quota */ }
          }
          if (Array.isArray(dtos) && dtos.length) {
            setAiRecs(dtos.map(aiToRec));
            try { sessionStorage.setItem(cacheKey, JSON.stringify(dtos)); } catch { /* quota */ }
          }
        }
      } catch { /* AI unavailable — section stays hidden, never canned */ }
      finally { if (!cancelled) setAiLoading(false); }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedAt]);

  // AI recommendations when the engine produced them — at-risk opportunities
  // float to the top so the buried thing that costs money to miss is seen first.
  const aiSorted = aiRecs && aiRecs.length
    ? [...aiRecs].sort((a, b) => (b.atRisk ? 1 : 0) - (a.atRisk ? 1 : 0))
    : [];
  // When the AI produced nothing usable (rate-limited / offline), fall back to
  // deterministic picks built purely from the real buckets — accurate, instant,
  // never hallucinated — so the section degrades gracefully instead of vanishing
  // right after it finishes analyzing (which read as "it does nothing").
  const recs = aiSorted.length
    ? aiSorted
    : buildDeterministicRecs(decide, chase, actionItems, showUp);
  // "reviewing" = the AI is still composing the picks; drives the live header,
  // the in-progress checklist row, and the recommendation skeletons.
  const reviewing = aiLoading && !aiRecs;

  // Only truly nothing to show (no buckets at all) collapses the section.
  if (recs.length === 0 && !reviewing) return null;

  // REVIEWING YOUR ACTIVITY — the three steps the briefing actually runs, with
  // REAL counts from the buckets (never mock numbers). The first two are done the
  // moment the data is in; the third completes when the AI returns its picks.
  const bold = 'font-semibold text-black/75 dark:text-white/75';
  const steps: { id: string; label: React.ReactNode; done: boolean }[] = [
    {
      id: 'scan',
      // The confidence-scale line: "read N, only K need you" proves it isn't
      // guessing from a sample. Falls back to the old phrasing when the API
      // didn't report a scanned count (cached/legacy snapshots).
      label: triage && triage.scanned > 0
        ? <>Read <span className={bold}>{triage.scanned}</span> {triage.scanned === 1 ? 'email' : 'emails'} — <span className={bold}>{decide.length}</span> {decide.length === 1 ? 'needs' : 'need'} a reply. The rest handled</>
        : <>Scanned your inbox — <span className={bold}>{decide.length}</span> {decide.length === 1 ? 'thread needs' : 'threads need'} a reply</>,
      done: true,
    },
    {
      id: 'check',
      label: <>Checked <span className={bold}>{chase.length}</span> follow-ups, <span className={bold}>{showUp.length}</span> meetings, <span className={bold}>{actionItems.length}</span> promises</>,
      done: true,
    },
    {
      id: 'spot',
      label: reviewing
        ? 'Spotting the moves worth your time…'
        : <>Spotted <span className={bold}>{recs.length}</span> {recs.length === 1 ? 'move' : 'moves'} worth your time</>,
      done: !reviewing,
    },
  ];
  const doneCount = steps.filter(s => s.done).length;

  return (
    <section className="mb-12">
      {/* Live briefing header */}
      <div className="flex items-center justify-center gap-2.5 mb-7">
        {reviewing ? <PulseDot /> : <Sparkles className="w-4 h-4 text-black/55 dark:text-white/55" strokeWidth={2} />}
        <span className="text-[13.5px] font-semibold text-black/80 dark:text-white/80 tracking-tight">
          {reviewing
            ? 'Writing a fresh briefing — a quick catch-up…'
            : `Your briefing${checkedAgo ? ` · ${checkedAgo} ago` : ''}`}
        </span>
      </div>

      {/* Kept-briefing pill — only when we're serving a saved snapshot (offline / stale). */}
      {servingCached && (
        <div className="mb-7 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl liquid-glass">
          <div className="flex items-center gap-2.5 min-w-0">
            <Clock className="w-4 h-4 text-black/40 dark:text-white/40 flex-shrink-0" strokeWidth={2} />
            <span className="text-[13px] text-black/60 dark:text-white/55 truncate">Your last briefing — kept in case you need it</span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white transition-colors flex-shrink-0"
          >
            Refresh <ChevronDown className="w-3.5 h-3.5" strokeWidth={2.25} />
          </button>
        </div>
      )}

      {/* REVIEWING YOUR ACTIVITY */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[11.5px] font-semibold tracking-[0.14em] uppercase text-black/55 dark:text-white/55">Reviewing your activity</h2>
        <span className="text-[11px] font-medium tabular-nums px-2 py-0.5 rounded-full bg-black/[0.05] dark:bg-white/[0.06] text-black/50 dark:text-white/50">
          {doneCount} of {steps.length}
        </span>
      </div>
      <div className="space-y-3 mb-9">
        {steps.map((s) => (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center gap-3"
          >
            {s.done ? (
              <Check className="w-[16px] h-[16px] text-black/70 dark:text-white/70 flex-shrink-0" strokeWidth={2.75} />
            ) : (
              <Loader2 className="w-[15px] h-[15px] text-black/40 dark:text-white/40 animate-spin flex-shrink-0" strokeWidth={2.5} />
            )}
            <span className={cn('text-[14px] tracking-tight', s.done ? 'text-black/65 dark:text-white/60' : 'text-black dark:text-white')}>
              {s.label}
            </span>
          </motion.div>
        ))}
      </div>

      {/* RECOMMENDATIONS */}
      <h2 className="text-[11.5px] font-semibold tracking-[0.14em] uppercase text-black/55 dark:text-white/55 mb-4">Recommendations</h2>
      <div className="space-y-2.5">
        {reviewing ? (
          <>
            <SkeletonRecCard />
            <SkeletonRecCard />
          </>
        ) : (
          <AnimatePresence mode="popLayout">
            {recs.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} onAct={onAct} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Cross-app provenance — shows the connected apps these picks drew on. */}
      {aiApps.length > 1 && (
        <p className="mt-5 text-center text-[10.5px] uppercase tracking-[0.12em] text-black/30 dark:text-white/30">
          Drawing on {aiApps.join(' · ')}
        </p>
      )}

      {/* Footer */}
      <div className="mt-7 pt-4 border-t border-black/[0.05] dark:border-white/[0.06] flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px]">
        <span className="text-black/35 dark:text-white/35">Refreshes daily when you log in</span>
        <span className="text-black/15 dark:text-white/15">|</span>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 font-medium text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} /> Refresh briefing
        </button>
        <span className="text-black/15 dark:text-white/15">|</span>
        <button
          type="button"
          onClick={onCustomize}
          className="inline-flex items-center gap-1.5 font-medium text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white transition-colors"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={2} /> Customize briefing
        </button>
      </div>
    </section>
  );
}

export default function SiftToday() {
  const router = useRouter();
  const { data: session } = useSession();
  const [data, setData] = useState<TodayPayload | null>(() => (typeof window !== 'undefined' ? loadPersistedToday() : null));
  const [loading, setLoading] = useState(() => !(typeof window !== 'undefined' && loadPersistedToday()));
  // A manual "Refresh" triggers a COLD recompute (re-runs the AI triage) that can
  // take ~30–60s. That path keeps the existing data on screen, so `loading` (which
  // only fires when there's no cache) never turns on and the click looked dead.
  // This flag drives the button's own spinner/disabled state so the click always
  // gives instant feedback, independent of whether a snapshot is already cached.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when we're showing cached data because a refresh couldn't reach the server
  // (offline / token expired) — surfaced as a quiet "cached · updated Xm ago" note.
  const [servingCached, setServingCached] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // Transparent Reasoning (P6): the day's prioritization logic stays collapsed by
  // default (protection, not overwhelm) and expands when the founder wants to
  // understand — or challenge — how Maily ranked their day.
  const [showReasoning, setShowReasoning] = useState(false);
  // Dismissals are persisted server-side (durable + cross-device); the Today API
  // already excludes them on load, so this in-memory set only handles instant
  // removal for items dismissed in THIS session before the next fetch.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const undismiss = useCallback((id: string, threadId?: string) => {
    setDismissed((prev) => { const n = new Set(prev); n.delete(id); return n; }); // restore to exact position
    fetch('/api/home-feed/dismiss', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: id, threadId }),
    }).catch(() => {});
  }, []);

  // Dismiss = optimistic remove + persist + (for email items) archive the Gmail
  // thread. Quiet "Removed · Undo" toast restores the card to its exact spot. On
  // a backend failure we roll the cache back and surface a specific error.
  const dismissItem = useCallback((id: string, itemType?: string, threadId?: string) => {
    setDismissed((prev) => new Set(prev).add(id));
    // Keep the persisted snapshot honest so the item can't flash back on an
    // immediate reload (before the server-filtered revalidate lands).
    if (TODAY_CACHE) {
      persistToday({
        ...TODAY_CACHE,
        decide: TODAY_CACHE.decide.filter((i) => i.id !== id),
        chase: TODAY_CACHE.chase.filter((i) => i.id !== id),
        showUp: TODAY_CACHE.showUp.filter((i) => i.id !== id),
        actionItems: TODAY_CACHE.actionItems.filter((i) => i.id !== id),
      });
    }
    const isEmail = itemType === 'decide' || itemType === 'chase';
    fetch('/api/home-feed/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: id, itemType, threadId }),
    })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
      .catch(() => {
        setDismissed((prev) => { const n = new Set(prev); n.delete(id); return n; }); // rollback
        toast.error("Couldn't remove that", { description: 'Check your connection and try again.' });
      });
    toast('Removed', {
      description: isEmail && threadId ? 'Archived in Gmail' : undefined,
      action: { label: 'Undo', onClick: () => undismiss(id, isEmail ? threadId : undefined) },
      duration: 5000,
    });
  }, [undismiss]);

  const [activeDraft, setActiveDraft] = useState<any>(null);
  const [isDraftingNudgeId, setIsDraftingNudgeId] = useState<string | null>(null);
  const [isDraftingDecideId, setIsDraftingDecideId] = useState<string | null>(null);
  // Re-runs the generator for the currently open draft (used by the Voice
  // Profile button to re-draft in the updated voice).
  const redraftRef = useRef<(() => void) | null>(null);

  const handleDraftNudge = async (item: ChaseItem) => {
    setIsDraftingNudgeId(item.id);
    redraftRef.current = () => handleDraftNudge(item);
    setActiveDraft({
      content: '',
      recipientName: item.recipient.name || item.recipient.email.split('@')[0] || 'Recipient',
      recipientEmail: item.recipient.email,
      senderName: session?.user?.name || '',
      subject: item.subject.startsWith('Re:') ? item.subject : `Re: ${item.subject}`,
      threadId: item.threadId,
    });

    try {
      const response = await fetch('/api/email/draft-reply?stream=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailId: item.id,
          category: 'follow-up',
          emailContent: `Draft a polite follow-up nudge to ${item.recipient.name || item.recipient.email} on the thread "${item.subject}" — they haven't replied in ${item.daysSilent} days. Reference the original ask and end with one concrete CTA. Match my voice.`,
          emailSubject: item.subject,
          emailFrom: item.recipient.email
        })
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || 'Failed to generate draft nudge');
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setActiveDraft((prev: any) => prev ? { ...prev, content: renderMarkdown(accumulated) } : null);
        }
      }
    } catch (e) {
       console.error('Failed to generate draft nudge:', e);
       // Same graceful degradation as the reply path — no quota/upgrade nag.
       const msg = String((e as any)?.message || e || '').toLowerCase();
       if (msg.includes('token expired') || msg.includes('invalid_grant') || msg.includes('refresh failed') || msg.includes('sign-in expired')) {
         setActiveDraft(null);
         toast.error('Gmail sign-in expired', { description: 'Reconnect Google from the prompt-box connectors to keep drafting.', duration: 7000 });
       } else {
         // Same as the reply path — keep the box open with one honest line, no
         // auto-close, no fake draft, no endless spinner.
         setActiveDraft((prev: any) => prev ? {
           ...prev,
           content: '<p><em>Couldn’t draft this one right now — the AI models are busy. Close this and try again in a minute.</em></p>',
         } : null);
       }
    } finally {
       setIsDraftingNudgeId(null);
    }
  };

  const handleDraftDecide = async (item: DecideItem) => {
    setIsDraftingDecideId(item.id);
    redraftRef.current = () => handleDraftDecide(item);
    setActiveDraft({
      content: '',
      recipientName: item.sender.name || item.sender.email.split('@')[0] || 'Recipient',
      recipientEmail: item.sender.email,
      senderName: session?.user?.name || '',
      subject: item.subject.startsWith('Re:') ? item.subject : `Re: ${item.subject}`,
      threadId: item.threadId,
    });

    try {
      const response = await fetch('/api/email/draft-reply?stream=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailId: item.id,
          category: 'general',
          emailContent: `Draft a reply to ${item.sender.name || item.sender.email} about "${item.subject}". Match my voice profile and keep it under 4 sentences.`,
          emailSubject: item.subject,
          emailFrom: item.sender.email
        })
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || 'Failed to generate draft reply');
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setActiveDraft((prev: any) => prev ? { ...prev, content: renderMarkdown(accumulated) } : null);
        }
      }

      if (!accumulated.trim()) {
        setActiveDraft((prev: any) => prev ? {
          ...prev,
          content: renderMarkdown(`Hi ${(item.sender.name || item.sender.email).split(' ')[0]},\n\nGot your message — let me think on this and follow up shortly.\n\nBest,`),
        } : null);
        toast.warning('The AI struggled to draft a reply', {
          description: 'Showing a starter you can edit. Try again in a minute if the model was rate-limited.',
          duration: 5000,
        });
      }
    } catch (e) {
       console.error('Failed to generate draft reply:', e);
       // No quota / "upgrade for paid" nag — the model layer falls back to paid
       // silently when configured; if it still can't draft (free pool exhausted,
       // nothing else available), degrade GRACEFULLY to an editable starter the
       // user can finish, never a scary error. Only a truly actionable failure
       // (expired Google sign-in) gets a toast.
       const msg = String((e as any)?.message || e || '').toLowerCase();
       if (msg.includes('token expired') || msg.includes('invalid_grant') || msg.includes('refresh failed') || msg.includes('sign-in expired')) {
         setActiveDraft(null);
         toast.error('Gmail sign-in expired', { description: 'Reconnect Google from the prompt-box connectors to keep drafting.', duration: 7000 });
       } else {
         // Keep the box OPEN on failure — don't auto-close (that read as a glitch),
         // don't fake a draft, and don't spin "Crafting…" forever. Show one honest
         // line the user can read, then close or retry.
         setActiveDraft((prev: any) => prev ? {
           ...prev,
           content: '<p><em>Couldn’t draft this one right now — the AI models are busy. Close this and try again in a minute.</em></p>',
         } : null);
       }
    } finally {
       setIsDraftingDecideId(null);
    }
  };

  const handleSendDraft = async (draftData: any) => {
    const response = await fetch('/api/gmail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: draftData.recipientEmail,
        subject: draftData.subject,
        body: draftData.content,
        threadId: draftData.threadId,
        isHtml: true,
      })
    });
    if (!response.ok) throw new Error("Failed to send");
  };

  const firstName = useMemo(() => {
    const raw = session?.user?.name?.trim();
    if (raw) return raw.split(/\s+/)[0];
    const email = session?.user?.email;
    if (email) {
      const local = email.split('@')[0];
      // Strip common separators, take first chunk, capitalize
      const first = local.split(/[._\-+]/)[0];
      if (first) return first.charAt(0).toUpperCase() + first.slice(1);
    }
    return '';
  }, [session]);

  const load = useCallback(async (opts?: { background?: boolean; force?: boolean }) => {
    const bg = !!opts?.background;
    // A forced, foreground refresh is a user-initiated cold recompute — show the
    // button's spinner even when a cache exists, so the click never looks dead.
    const manualRefresh = !bg && !!opts?.force;
    // Only show the skeleton when there's nothing to show yet — never blank out data
    // we already have (stale-while-revalidate).
    if (!bg && !TODAY_CACHE) setLoading(true);
    if (manualRefresh) setRefreshing(true);
    if (!bg) setError(null);
    try {
      // A manual refresh must bypass the server's 5-min snapshot cache and recompute
      // from Gmail/Calendar; the background revalidate is happy with the cache.
      const url = opts?.force ? '/api/home-feed/today?refresh=1' : '/api/home-feed/today';
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) {
        // Keep showing cache if we have it (e.g. token expired) with a quiet note.
        if (TODAY_CACHE) setServingCached(true);
        else if (!bg) setError(json.error || 'Failed to load.');
        return;
      }
      persistToday(json as TodayPayload);
      setData(json as TodayPayload);
      setServingCached(false);
    } catch (e: any) {
      // Offline / network error → serve cache + note instead of breaking.
      if (TODAY_CACHE) setServingCached(true);
      else if (!bg) setError(e?.message || 'Network error.');
    } finally {
      if (!bg) setLoading(false);
      if (manualRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // If a snapshot is already cached, show it instantly and revalidate quietly —
    // tab swaps no longer wait ~7s. First-ever load shows the skeleton.
    load({ background: !!TODAY_CACHE });
  }, [load]);

  const openBoult = (prompt: string) => {
    try {
      sessionStorage.setItem('boult_prefill', prompt);
    } catch {
      // sessionStorage can throw in incognito or with disk full — push anyway
    }
    router.push('/dashboard/agent-talk');
  };

  const { todayLabel, greeting, GreetingIcon } = useMemo(() => {
    const now = new Date();
    const label = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const hour = now.getHours();
    let g = 'Hello';
    let Icon: typeof Sun = Sun;
    if (hour < 5)        { g = 'Up late';        Icon = Moon; }
    else if (hour < 12)  { g = 'Good morning';   Icon = Sunrise; }
    else if (hour < 17)  { g = 'Good afternoon'; Icon = Sun; }
    else if (hour < 22)  { g = 'Good evening';   Icon = Sunset; }
    else                 { g = 'Good night';     Icon = Moon; }
    const personalized = firstName ? `${g}, ${firstName}` : g;
    return { todayLabel: label, greeting: personalized, GreetingIcon: Icon };
  }, [firstName]);

  const lastUpdated = useMemo(() => (data ? formatRelative(data.generatedAt) : null), [data]);

  // Hide swipe-dismissed items from every bucket (survives background refresh).
  const decideItems = useMemo(() => (data?.decide ?? []).filter((i) => !dismissed.has(i.id)), [data, dismissed]);
  const chaseItems = useMemo(() => (data?.chase ?? []).filter((i) => !dismissed.has(i.id)), [data, dismissed]);
  const showUpItems = useMemo(() => (data?.showUp ?? []).filter((i) => !dismissed.has(i.id)), [data, dismissed]);
  const actionItemsVisible = useMemo(() => (data?.actionItems ?? []).filter((i) => !dismissed.has(i.id)), [data, dismissed]);

  // CONTINUOUS INBOX — the opening line reframes the visit from "catching up"
  // (a backlog to process) to "reviewing progress" (work already done). Built
  // ONLY from real numbers already in the payload: what Maily did while away
  // (emails read + artifacts its agents produced), then the small remainder.
  // Null when nothing actually moved in the gap → the normal subline shows.
  const progress = useMemo(() => {
    if (!data) return null;
    const left = decideItems.length + chaseItems.length + showUpItems.length + actionItemsVisible.length;
    const scanned = data.triage?.scanned ?? 0;
    const runs = data.agentRuns ?? [];
    const artifacts = runs.reduce((n, r) => n
      + (r.artifactCounts?.gmail || 0) + (r.artifactCounts?.calendar || 0)
      + (r.artifactCounts?.notion || 0) + (r.artifactCounts?.slack || 0), 0);
    if (runs.length === 0 && scanned === 0) return null; // nothing happened while away
    const did: string[] = [];
    if (scanned > 0) did.push(`read ${scanned} ${scanned === 1 ? 'email' : 'emails'}`);
    if (artifacts > 0) did.push(`handled ${artifacts}`);
    else if (runs.length > 0) did.push(`ran ${runs.length} ${runs.length === 1 ? 'sweep' : 'sweeps'}`);
    const didClause = did.length ? did.join(' · ') : 'kept things moving';
    const leftClause = left === 0
      ? "nothing needs you — you're clear."
      : `${left} ${left === 1 ? 'thing needs' : 'things need'} you. The rest is handled.`;
    return `While you were away, Maily ${didClause}. ${leftClause}`;
  }, [data, decideItems, chaseItems, showUpItems, actionItemsVisible]);

  return (
    <div className="w-full min-h-screen bg-transparent">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-32">
        {/* Header */}
        <div className="flex items-end justify-between mb-12 gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-black/35 dark:text-white/35 mb-3 font-medium">
              {todayLabel}
            </p>
            <h1 className="text-3xl sm:text-[40px] sm:leading-[1.05] font-semibold text-black dark:text-white tracking-[-0.025em]">
              {greeting}
            </h1>
            <p className="text-[15px] mt-1.5 text-black/55 dark:text-white/55 tracking-tight">
              {progress || data?.briefing?.trim() || "here's what deserves you today."}
            </p>
            {/* Transparent Reasoning (P6) — "Why this order?" reveals HOW Maily
                ranked the day. Collapsed by default so the norm stays calm; one tap
                exposes the tradeoff logic so the founder understands (and can
                challenge) the triage instead of taking it on faith. Only shown when
                there's an actual order to explain (2+ surfaced items) and the agent
                produced grounded reasoning. */}
            {data?.reasoning?.trim() && (decideItems.length + chaseItems.length + showUpItems.length) >= 2 && (
              <div className="mt-2.5">
                <button
                  type="button"
                  onClick={() => setShowReasoning((v) => !v)}
                  aria-expanded={showReasoning}
                  className="group inline-flex items-center gap-1.5 text-[12.5px] font-medium text-black/45 dark:text-white/45 hover:text-black/70 dark:hover:text-white/70 transition-colors"
                >
                  <Sparkles className="w-3 h-3 text-black/35 dark:text-white/35 group-hover:text-black/55 dark:group-hover:text-white/55 transition-colors" strokeWidth={2} />
                  Why this order?
                  <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', showReasoning && 'rotate-180')} strokeWidth={2} />
                </button>
                <AnimatePresence initial={false}>
                  {showReasoning && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2.5 max-w-xl rounded-xl border border-black/[0.07] dark:border-white/[0.08] border-l-2 border-l-black/25 dark:border-l-white/25 bg-black/[0.02] dark:bg-white/[0.03] pl-3.5 pr-4 py-3">
                        <p className="text-[10.5px] uppercase tracking-[0.14em] text-black/35 dark:text-white/35 mb-1.5 font-semibold">How Maily ranked today</p>
                        <p className="text-[13.5px] leading-relaxed text-black/70 dark:text-white/70">{data.reasoning.trim()}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => load({ force: true })}
            disabled={loading || refreshing}
            className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white liquid-glass-btn disabled:opacity-40 flex-shrink-0"
            title="Refresh"
          >
            {loading || refreshing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-500" />
            )}
            <span className="hidden sm:inline">{refreshing ? 'Refreshing…' : servingCached && lastUpdated ? `cached · ${lastUpdated} ago` : lastUpdated ? `${lastUpdated} ago` : 'Refresh'}</span>
          </button>
        </div>

        {/* Command center: what the user's agents did while they were away.
            Renders first, independent of inbox buckets — this is the spec's
            "open HomeFeed, understand everything in 10 seconds" promise. */}
        {data && ((data.agentRuns && data.agentRuns.length > 0) || (data.pendingApprovals ?? 0) > 0) && (
          <AgentRunsSection runs={data.agentRuns ?? []} pendingApprovals={data.pendingApprovals} />
        )}

        {loading && !data && (
          <div className="space-y-10">
            {(['Decide', 'Show up', 'Chase'] as const).map((label) => (
              <section key={label}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-black/[0.04] dark:bg-white/[0.05]" />
                  <div className="h-3 w-20 rounded bg-black/[0.06] dark:bg-white/[0.06]" />
                </div>
                <div className="space-y-2.5">
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              </section>
            ))}
          </div>
        )}

        {error && (
          <div className="py-6 px-5 rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.03] text-[13px] text-black/65 dark:text-white/65">
            {error}
          </div>
        )}

        {data && data.needsReconnect && (data.needsReconnect.gmail || data.needsReconnect.calendar) && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="py-10 px-6 text-center rounded-3xl border border-amber-500/15 dark:border-amber-400/15 bg-amber-500/[0.04] dark:bg-amber-400/[0.04]"
          >
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-amber-500/[0.08] dark:bg-amber-400/[0.08] text-amber-600 dark:text-amber-400 mb-4">
              <AlertTriangle className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <h2 className="text-[16px] font-medium text-black dark:text-white mb-1.5 tracking-tight">
              {data.needsReconnect.gmail && data.needsReconnect.calendar
                ? 'Google sign-in expired'
                : data.needsReconnect.gmail
                  ? 'Gmail sign-in expired'
                  : 'Calendar sign-in expired'}
            </h2>
            <p className="text-[13.5px] text-black/55 dark:text-white/55 mb-5 max-w-sm mx-auto leading-relaxed">
              I tried to refresh in the background but Google rejected the token. Sign in again and I'll pick up right where we left off.
            </p>
            <button
              type="button"
              onClick={() => signIn('google', { callbackUrl: window.location.href, redirect: true })}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium bg-black text-white dark:bg-white dark:text-black hover:bg-black/85 dark:hover:bg-white/85 transition-colors active:scale-[0.97]"
            >
              Sign in with Google
            </button>
          </motion.div>
        )}

        {data && !data.gmailConnected && !data.needsReconnect && (
          <div className="py-12 px-6 text-center rounded-3xl border border-black/[0.06] dark:border-white/[0.06]">
            <Mail className="w-6 h-6 mx-auto mb-3 text-black/40 dark:text-white/40" strokeWidth={1.5} />
            <h2 className="text-[15px] font-medium text-black dark:text-white mb-1.5">Connect Gmail to see your day</h2>
            <p className="text-[13px] text-black/50 dark:text-white/50 mb-5">
              Sift reads only what it needs to surface what matters today.
            </p>
            <button
              type="button"
              onClick={() => signIn('google', { callbackUrl: window.location.href, redirect: true })}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium bg-black text-white dark:bg-white dark:text-black hover:bg-black/85 dark:hover:bg-white/85 transition-colors"
            >
              Connect Gmail
            </button>
          </div>
        )}

        {data && data.gmailConnected && data.emptyAll && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="py-20 text-center"
          >
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-black/[0.04] dark:bg-white/[0.05] ring-1 ring-black/[0.04] dark:ring-white/[0.05] text-black/55 dark:text-white/55 mb-5">
              <GreetingIcon className="w-5 h-5" strokeWidth={1.5} />
            </div>
            <h2 className="text-[20px] font-medium text-black dark:text-white mb-2 tracking-tight">
              …take a breath{firstName ? `, ${firstName}` : ''}.
            </h2>
            <p className="text-[14px] text-black/50 dark:text-white/50 max-w-sm mx-auto leading-relaxed">
              Just scanned your inbox, calendar, and follow-ups — nothing urgent, no meetings, nothing overdue. Rare and good.
            </p>
            {data.generatedAt && (
              <p className="mt-4 text-[11px] uppercase tracking-[0.12em] text-black/30 dark:text-white/30">
                Live data · checked {formatRelative(data.generatedAt)} ago
              </p>
            )}
          </motion.div>
        )}

        {data && data.gmailConnected && !data.emptyAll && (
          <div className="space-y-10">
            {/* WORTH YOUR TIME — personalized next-step recommendations, derived
                deterministically from the real buckets (accurate + instant). */}
            <RecommendationsSection
              decide={decideItems}
              chase={chaseItems}
              actionItems={actionItemsVisible}
              showUp={showUpItems}
              agentRuns={data.agentRuns ?? []}
              checkedAgo={lastUpdated}
              generatedAt={data.generatedAt}
              servingCached={servingCached}
              triage={data.triage}
              onAct={openBoult}
              onRefresh={() => load({ force: true })}
              onCustomize={() => setCustomizeOpen(true)}
            />

            {/* PROMISED (action items from /log) */}
            {actionItemsVisible.length > 0 && (
              <section>
                <BucketHeader
                  label="Promised"
                  count={actionItemsVisible.length}
                  icon={<CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />}
                />
                <div className="space-y-2.5">
                  <AnimatePresence>
                    {actionItemsVisible.map((item) => (
                      <ItemCard
                        key={item.id}
                        topLeft={item.meetingTitle || 'from your notes'}
                        topRight={formatDueLabel(item.dueAt, item.isOverdue)}
                        title={item.text}
                        reason={item.attendees.length > 0
                          ? `Promised after meeting with ${item.attendees.slice(0, 2).join(', ')}${item.attendees.length > 2 ? ` +${item.attendees.length - 2}` : ''}.`
                          : 'From your meeting notes.'}
                        onDismiss={() => dismissItem(item.id, 'actionItem')}
                        primaryAction={{
                          label: item.isOverdue ? 'Handle now' : 'Open',
                          onClick: () => {
                            const ctx = item.attendees.length > 0
                              ? ` (linked to ${item.attendees.join(', ')})`
                              : '';
                            openBoult(`Help me with this action item from "${item.meetingTitle || 'my notes'}"${ctx}: ${item.text}`);
                          },
                        }}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            )}

            {/* DECIDE */}
            <section>
              <BucketHeader
                label="Decide"
                count={decideItems.length}
                icon={<Reply className="w-3.5 h-3.5" strokeWidth={2} />}
              />
              {decideItems.length === 0 ? (
                <EmptyBucket message="Inbox is clear — nothing urgent unanswered." />
              ) : (
                <div className="space-y-2.5">
                  <AnimatePresence>
                    {decideItems.map((item) => (
                      <ItemCard
                        key={item.id}
                        topLeft={item.sender.name || item.sender.email}
                        topRight={formatRelative(item.receivedAt)}
                        title={item.subject}
                        reason={item.reason}
                        signals={item.signals}
                        onDismiss={() => dismissItem(item.id, 'decide', item.threadId)}
                        primaryAction={{
                          label: isDraftingDecideId === item.id ? 'Drafting...' : 'Draft reply',
                          onClick: () => handleDraftDecide(item),
                        }}
                        secondaryAction={{ label: 'Open thread', href: item.gmailUrl }}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </section>

            {/* SHOW UP */}
            <section>
              <BucketHeader
                label="Show up"
                count={showUpItems.length}
                icon={<CalendarClock className="w-3.5 h-3.5" strokeWidth={2} />}
              />
              {showUpItems.length === 0 ? (
                <EmptyBucket message="No meetings on the books today." />
              ) : (
                <div className="space-y-2.5">
                  <AnimatePresence>
                    {showUpItems.map((item) => (
                      <ItemCard
                        key={item.id}
                        topLeft={formatStartTime(item.start)}
                        topRight={`${item.attendeeCount} attendee${item.attendeeCount === 1 ? '' : 's'}`}
                        title={item.title}
                        reason={item.reason || (item.isExternal ? 'External meeting — prep it.' : 'Internal meeting.')}
                        signals={item.signals}
                        onDismiss={() => dismissItem(item.id, 'showUp')}
                        primaryAction={{
                          label: 'Prep me',
                          onClick: () =>
                            openBoult(`/prep ${item.title} at ${formatStartTime(item.start)} today`),
                        }}
                        secondaryAction={
                          item.meetLink ? { label: 'Join', href: item.meetLink } : undefined
                        }
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </section>

            {/* CHASE */}
            <section>
              <BucketHeader
                label="Chase"
                count={chaseItems.length}
                icon={<Clock className="w-3.5 h-3.5" strokeWidth={2} />}
              />
              {chaseItems.length === 0 ? (
                <EmptyBucket message="Nobody owes you a reply right now." />
              ) : (
                <div className="space-y-2.5">
                  <AnimatePresence>
                    {chaseItems.map((item) => (
                      <ItemCard
                        key={item.id}
                        topLeft={item.recipient.name || item.recipient.email}
                        topRight={`${item.daysSilent}d silent`}
                        title={item.subject}
                        reason={item.reason || "You sent this. They haven't replied."}
                        signals={item.signals}
                        onDismiss={() => dismissItem(item.id, 'chase', item.threadId)}
                        primaryAction={{
                          label: isDraftingNudgeId === item.id ? 'Drafting...' : 'Draft nudge',
                          onClick: () => handleDraftNudge(item),
                        }}
                        secondaryAction={{ label: 'Open thread', href: item.gmailUrl }}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Draft Reply Modal */}
        {activeDraft && (
          <SiftDraftModal
            draftData={activeDraft}
            onSendReply={handleSendDraft}
            onDismiss={() => setActiveDraft(null)}
            isVisible={true}
            onRedraft={() => redraftRef.current?.()}
          />
        )}

        {/* Customize Briefing — saving re-fetches so the new prefs take effect now. */}
        <CustomizeBriefingModal
          isOpen={customizeOpen}
          onClose={() => setCustomizeOpen(false)}
          onSaved={() => load({ force: true })}
        />
      </div>
    </div>
  );
}
