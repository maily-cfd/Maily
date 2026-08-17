'use client';

import { motion } from 'framer-motion';
import { ExternalLink, Video, Calendar, FileText, Undo2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Notion page preview thumbnail ──────────────────────────────────────────────

function NotionPagePreview({ title }: { title: string }) {
  return (
    <div className="w-[140px] flex-shrink-0 bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/8 rounded-xl p-3 flex flex-col gap-2 select-none">
      <div className="flex items-center gap-1.5">
        <span className="text-[15px]">📝</span>
        <span className="text-[11px] font-semibold text-zinc-800 dark:text-white/80 truncate leading-tight">{title}</span>
      </div>
      <div className="space-y-1.5 mt-0.5">
        <div className="h-[5px] bg-black/10 dark:bg-white/15 rounded-full w-full" />
        <div className="h-[5px] bg-black/10 dark:bg-white/15 rounded-full w-[85%]" />
        <div className="h-[5px] bg-black/5 dark:bg-white/10 rounded-full w-[60%]" />
        <div className="h-[5px] bg-black/5 dark:bg-white/8 rounded-full w-[75%]" />
      </div>
    </div>
  );
}

// ── Calendar event preview thumbnail ──────────────────────────────────────────

function CalendarPreview({ title, startTime }: { title: string; startTime?: string }) {
  const formatted = startTime
    ? new Date(startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    : null;
  return (
    <div className="w-[140px] flex-shrink-0 bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/8 rounded-xl p-3 flex flex-col gap-2 select-none">
      <div className="flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0" />
        <span className="text-[11px] font-semibold text-zinc-800 dark:text-white/80 truncate leading-tight">{title}</span>
      </div>
      {formatted && (
        <p className="text-[10px] text-zinc-500 dark:text-white/40 font-mono leading-tight">{formatted}</p>
      )}
      <div className="space-y-1.5">
        <div className="h-[5px] bg-black/10 dark:bg-white/15 rounded-full w-full" />
        <div className="h-[5px] bg-black/5 dark:bg-white/10 rounded-full w-[70%]" />
      </div>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

export interface ActionResultData {
  type: 'notion_page' | 'calendar_event' | 'email_sent';
  title: string;
  url?: string;
  meetLink?: string;
  startTime?: string;
  attendees?: string[];
  contentPreview?: string;
  /** For email_sent: recipient display name shown in the pill label */
  recipientName?: string;
  /** For email_sent: short verb label override */
  verbLabel?: string;
}

interface ActionResultCardProps {
  data: ActionResultData;
  onUndo?: () => void;
}

export function ActionResultCard({ data, onUndo }: ActionResultCardProps) {
  // PART 8 #2 — compact "Email sent!" pill. Bulk send screenshots show
  // ~12 of these stacked vertically, so this variant deliberately stays
  // small (single row, no thumbnail, no metadata block) while the
  // Notion/Calendar variants keep their richer thumbnail layout.
  if (data.type === 'email_sent') {
    const label = data.verbLabel || 'Email sent!';
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="mt-1.5 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl boult-glass"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400 flex-shrink-0" />
          <span className="text-[13.5px] font-medium text-zinc-900 dark:text-white/85 truncate">
            {label}
            {data.recipientName && (
              <span className="text-zinc-500 dark:text-white/45 font-normal"> — {data.recipientName}</span>
            )}
          </span>
        </div>
        {data.url && (
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex-shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-all active:scale-95',
              'text-zinc-700 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white',
              'hover:bg-zinc-100 dark:hover:bg-white/8',
            )}
          >
            View thread
          </a>
        )}
      </motion.div>
    );
  }

  const isNotion = data.type === 'notion_page';
  const isCalendar = data.type === 'calendar_event';

  const verbLabel = isNotion ? 'Created' : isCalendar ? 'Scheduled' : 'Completed';
  const actionLabel = isNotion ? 'Open page' : isCalendar ? 'Open in Calendar' : 'Open';
  const primaryUrl = isCalendar ? data.url : data.url;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="mt-3 mb-1 flex items-stretch gap-3 p-4 rounded-2xl overflow-hidden boult-glass-card"
    >
      {/* Left: info + actions */}
      <div className="flex-1 flex flex-col justify-between min-w-0 gap-3">
        <div>
          <p className="text-[10px] font-semibold text-zinc-400 dark:text-white/30 uppercase tracking-widest mb-1">
            {verbLabel}
          </p>
          <h4 className="text-[15px] font-bold text-zinc-900 dark:text-white/90 leading-snug truncate">
            {data.title}
          </h4>
          {isCalendar && data.startTime && (
            <p className="text-[12px] text-zinc-500 dark:text-white/40 mt-0.5">
              {new Date(data.startTime).toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', hour12: true,
              })}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {primaryUrl && (
            <a
              href={primaryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-black text-[12px] font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-white/90 active:scale-95 transition-all shadow-sm"
            >
              {isNotion ? <FileText className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
              {actionLabel}
            </a>
          )}

          {isCalendar && data.meetLink && (
            <a
              href={data.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-200/50 dark:bg-white/8 text-zinc-800 dark:text-white/80 text-[12px] font-semibold rounded-lg hover:bg-zinc-200 dark:hover:bg-white/12 active:scale-95 transition-all border border-zinc-200 dark:border-white/10"
            >
              <Video className="w-3.5 h-3.5" />
              Join Meet
            </a>
          )}

          {onUndo && (
            <button
              onClick={onUndo}
              title="Undo"
              className="p-1.5 rounded-lg text-zinc-400 dark:text-white/30 hover:text-zinc-700 dark:hover:text-white/60 hover:bg-black/5 dark:hover:bg-white/6 transition-all"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {isCalendar && data.attendees && data.attendees.length > 0 && (
          <p className="text-[11px] text-zinc-500 dark:text-white/35 truncate">
            Invited: {data.attendees.join(', ')}
          </p>
        )}
      </div>

      {/* Right: page/event preview thumbnail */}
      {isNotion && <NotionPagePreview title={data.title} />}
      {isCalendar && <CalendarPreview title={data.title} startTime={data.startTime} />}
    </motion.div>
  );
}
