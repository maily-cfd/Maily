'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';

export interface ConfirmationData {
  action: string;
  description: string;
  /**
   * One line of observed receipts ("She asked for Thursday; your 2pm is
   * free.") — the reason this is the right call, so the user can approve at
   * a glance instead of re-deriving the judgment themselves. Approval Mode:
   * confirmation, not inspection.
   */
  why?: string;
  details?: Record<string, string>;
  /**
   * Server-issued approval id from request_confirmation. When the user clicks
   * Confirm, the card POSTs this to /api/boult/approval/confirm before
   * resuming the agent — the executor-level gate in send_email /
   * schedule_meeting / send_slack_message / create_notion_page checks for
   * an approved row with this id before proceeding.
   *
   * Optional: legacy in-flight cards from before the gate landed won't have
   * one; the gate falls back to a no-op in that case.
   */
  approvalId?: string;
}

interface ConfirmationCardProps {
  data: ConfirmationData;
  status?: 'confirmed' | 'cancelled';
  onAction: (action: 'confirm' | 'cancel') => void;
}

export function ConfirmationCard({ data, status, onAction }: ConfirmationCardProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = !mounted || resolvedTheme === 'dark';

  // Safety net: if the parent never flips `status` (network blip, missing
  // currentConversationId, etc.), the Confirm button used to sit on
  // "Confirming…" forever and there was no way to retry. Reset after 8s so
  // the user can try again instead of being stuck.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 8000);
    return () => clearTimeout(t);
  }, [loading]);

  // Keyboard: Enter confirms, Escape cancels. Active only while the card is
  // unresolved (status === undefined) AND not mid-confirm. Matches the
  // DraftApprovalModal's Esc behavior so the two confirmation surfaces feel
  // the same.
  useEffect(() => {
    if (status || loading) return;
    const handler = (e: KeyboardEvent) => {
      // Ignore if the user is typing into an input — the chat composer must
      // keep its own Enter behavior.
      const t = e.target as HTMLElement | null;
      const isEditable = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (isEditable) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        setLoading(true);
        onAction('confirm');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onAction('cancel');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [status, loading, onAction]);

  // Resolved state — show a compact pill
  if (status) {
    return (
      <div className={cn(
        'mt-3 w-full rounded-[14px] border px-4 py-2.5 flex items-center gap-2.5 text-[12px] font-medium',
        status === 'confirmed'
          ? isDark
            ? 'bg-white/[0.06] border-white/[0.12] text-white/80'
            : 'bg-neutral-100 border-neutral-300 text-neutral-800'
          : isDark
            ? 'bg-white/[0.04] border-white/[0.08] text-white/35'
            : 'bg-neutral-50 border-neutral-200 text-neutral-400',
      )}>
        {status === 'confirmed'
          ? <Check className="w-3.5 h-3.5 flex-shrink-0" />
          : <X className="w-3.5 h-3.5 flex-shrink-0" />}
        {status === 'confirmed'
          ? `Confirmed — proceeding with ${data.action}`
          : `Cancelled — ${data.action} skipped`}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className="mt-3 w-full rounded-[20px] overflow-hidden boult-glass-card"
    >
      {/* Header */}
      <div className={cn(
        'flex items-center gap-2.5 px-4 py-3 border-b',
        isDark ? 'border-white/[0.07]' : 'border-black/[0.06]',
      )}>
        <AlertCircle className={cn('w-4 h-4 flex-shrink-0', isDark ? 'text-white/45' : 'text-neutral-500')} />
        <span className={cn(
          'text-[11px] font-bold uppercase tracking-widest',
          isDark ? 'text-white/50' : 'text-neutral-500',
        )}>
          Confirmation required
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5">
        <div>
          <p className={cn('text-[15px] font-bold mb-0.5 leading-snug', isDark ? 'text-white/90' : 'text-neutral-900')}>
            {data.action}
          </p>
          <p className={cn('text-[13px] leading-relaxed', isDark ? 'text-white/55' : 'text-neutral-600')}>
            {data.description}
          </p>
          {data.why && (
            <p className={cn(
              'mt-1.5 text-[12px] leading-relaxed flex items-start gap-1.5',
              isDark ? 'text-white/40' : 'text-neutral-500',
            )}>
              <Check className={cn('w-3 h-3 mt-[3px] flex-shrink-0', isDark ? 'text-emerald-400/70' : 'text-emerald-600/80')} strokeWidth={2.5} />
              <span>{data.why}</span>
            </p>
          )}
        </div>

        {data.details && Object.keys(data.details).length > 0 && (
          <div className={cn(
            'rounded-xl border px-3 py-2 space-y-1.5',
            isDark ? 'bg-white/[0.03] border-white/[0.07]' : 'bg-neutral-50 border-neutral-200/70',
          )}>
            {Object.entries(data.details).map(([key, val]) => val ? (
              <div key={key} className="flex items-start gap-2 text-[12px]">
                <span className={cn(
                  'capitalize font-medium flex-shrink-0 w-14',
                  isDark ? 'text-white/35' : 'text-neutral-400',
                )}>
                  {key}
                </span>
                <span className={cn(
                  'font-semibold break-all min-w-0',
                  isDark ? 'text-white/75' : 'text-neutral-700',
                )}>
                  {val}
                </span>
              </div>
            ) : null)}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={cn(
        'flex items-center gap-2.5 px-4 py-3 border-t',
        isDark ? 'border-white/[0.06]' : 'border-black/[0.05]',
      )}>
        <button
          onClick={() => { if (!loading) { setLoading(true); onAction('confirm'); } }}
          disabled={loading}
          className={cn(
            'flex-1 py-2 rounded-xl text-[13px] font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed',
            isDark
              ? 'bg-white text-black hover:bg-zinc-200'
              : 'bg-black text-white hover:bg-neutral-800',
          )}
        >
          {loading ? 'Confirming…' : 'Confirm'}
        </button>
        <button
          onClick={() => { if (!loading) onAction('cancel'); }}
          disabled={loading}
          className={cn(
            'px-4 py-2 rounded-xl text-[13px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed',
            isDark
              ? 'text-white/45 hover:text-white/70 hover:bg-white/[0.05]'
              : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100',
          )}
        >
          Cancel
        </button>
        {/* The keyboard path, made visible — approving should cost one keystroke. */}
        <span className={cn(
          'hidden sm:block ml-1 text-[10.5px] tabular-nums select-none flex-shrink-0',
          isDark ? 'text-white/25' : 'text-neutral-400/80',
        )}>
          ↵ confirm · esc cancel
        </span>
      </div>
    </motion.div>
  );
}
