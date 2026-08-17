'use client';

/**
 * DraftGalleryCard — multi-draft review for Boult (live chat + bg agent).
 *
 * When Boult drafts several replies in one message (the canvases stream in one
 * by one), they collect here as a stack of EXPAND/COLLAPSE draft boxes in a
 * grey palette. Each box is independently editable and can be sent directly —
 * no bulk select/confirm. Unsent drafts remain in Gmail Drafts (the draft tools
 * already saved them).
 *
 * Collapsed: recipient · subject · voice score · status.
 * Expanded:  editable subject + body + a Send button.
 *
 * Props are unchanged from the previous version so the host doesn't change —
 * onSendOne receives the item with the user's edited subject/body.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, X, Check, AlertCircle, Mail, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface DraftGalleryItem {
  id: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  threadId?: string;
  gmailDraftId?: string;
  voiceScore?: number;
}

interface DraftGalleryCardProps {
  drafts: DraftGalleryItem[];
  /** Send one draft. Resolve on success, throw on failure. Receives edits. */
  onSendOne: (item: DraftGalleryItem) => Promise<void>;
  /** Dismiss the stack. Unsent drafts stay in Gmail Drafts. */
  onDismiss: () => void;
}

type RowStatus = 'idle' | 'sending' | 'sent' | 'error';
interface Edit { subject: string; body: string }

export function DraftGalleryCard({ drafts, onSendOne, onDismiss }: DraftGalleryCardProps) {
  // First draft open by default; the rest collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(drafts[0] ? [drafts[0].id] : []));
  const [edits, setEdits] = useState<Record<string, Edit>>(() =>
    Object.fromEntries(drafts.map((d) => [d.id, { subject: d.subject, body: d.body }])),
  );
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});

  const getEdit = (d: DraftGalleryItem): Edit => edits[d.id] || { subject: d.subject, body: d.body };
  const sentCount = drafts.filter((d) => statuses[d.id] === 'sent').length;
  const allSent = drafts.length > 0 && sentCount === drafts.length;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setEdit = (id: string, patch: Partial<Edit>) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const sendOne = async (d: DraftGalleryItem) => {
    if (statuses[d.id] === 'sending' || statuses[d.id] === 'sent') return;
    const e = getEdit(d);
    if (!e.body.trim()) { toast.error('Draft is empty.'); return; }
    setStatuses((s) => ({ ...s, [d.id]: 'sending' }));
    try {
      await onSendOne({ ...d, subject: e.subject, body: e.body });
      setStatuses((s) => ({ ...s, [d.id]: 'sent' }));
      setExpanded((prev) => { const n = new Set(prev); n.delete(d.id); return n; }); // collapse on send
      toast.success(`Sent to ${d.recipientName || d.recipientEmail}.`);
    } catch (err) {
      setStatuses((s) => ({ ...s, [d.id]: 'error' }));
      toast.error(err instanceof Error ? err.message : 'Failed to send.');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="mt-3 mb-1 rounded-2xl overflow-hidden boult-glass-card"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Mail className="w-4 h-4 text-black/50 dark:text-white/55 flex-shrink-0" />
          <h3 className="text-[14px] font-bold text-black/90 dark:text-white/90 truncate">
            {drafts.length} draft{drafts.length === 1 ? '' : 's'} ready to review
          </h3>
        </div>
        <span className="text-[11px] uppercase tracking-wider font-bold text-black/40 dark:text-white/40 tabular-nums flex-shrink-0">
          {sentCount} / {drafts.length} sent
        </span>
      </div>

      {/* Accordion of editable draft boxes */}
      <div className="divide-y divide-black/[0.05] dark:divide-white/[0.05] max-h-[560px] overflow-y-auto">
        {drafts.map((d) => {
          const isOpen = expanded.has(d.id);
          const status = statuses[d.id] || 'idle';
          const e = getEdit(d);
          const snippet = (e.body || '').replace(/\s+/g, ' ').trim().slice(0, 100);
          return (
            <div key={d.id} className={cn(status === 'sent' && 'opacity-60', status === 'error' && 'bg-rose-500/[0.04]')}>
              {/* Collapsed header row — click to expand/collapse */}
              <button
                type="button"
                onClick={() => toggle(d.id)}
                className="w-full flex items-start gap-3 px-5 py-3.5 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
              >
                <div className="pt-0.5 flex-shrink-0">
                  {status === 'sending' ? (
                    <Loader2 className="w-4 h-4 text-black/50 dark:text-white/60 animate-spin" />
                  ) : status === 'sent' ? (
                    <span className="w-4 h-4 rounded-md bg-emerald-500 flex items-center justify-center"><Check className="w-3 h-3 text-white" strokeWidth={3} /></span>
                  ) : status === 'error' ? (
                    <span className="w-4 h-4 rounded-md bg-rose-500/80 flex items-center justify-center"><AlertCircle className="w-3 h-3 text-white" /></span>
                  ) : (
                    <ChevronDown className={cn('w-4 h-4 text-black/40 dark:text-white/40 transition-transform', isOpen && 'rotate-180')} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-[13.5px] font-bold text-black/90 dark:text-white/90 truncate">{d.recipientName || d.recipientEmail}</span>
                    {d.recipientEmail && d.recipientName && (
                      <span className="text-[11px] text-black/35 dark:text-white/35 font-mono truncate">&lt;{d.recipientEmail}&gt;</span>
                    )}
                    {typeof d.voiceScore === 'number' && (
                      <span className="ml-auto flex-shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums tracking-wide bg-black/[0.05] dark:bg-white/[0.07] text-black/55 dark:text-white/55">
                        voice {d.voiceScore}
                      </span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-black/60 dark:text-white/60 truncate mt-0.5 font-medium">{e.subject || '(no subject)'}</p>
                  {!isOpen && <p className="text-[11.5px] text-black/30 dark:text-white/30 truncate mt-0.5">{snippet}</p>}
                </div>
              </button>

              {/* Expanded editor */}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-4 pt-1 bg-black/[0.015] dark:bg-white/[0.02]">
                      {/* Subject */}
                      <div className="flex items-center gap-3 py-2 border-b border-black/[0.06] dark:border-white/[0.06]">
                        <span className="text-[11px] uppercase tracking-wider font-bold text-black/35 dark:text-white/35 shrink-0">Subject</span>
                        <input
                          value={e.subject}
                          onChange={(ev) => setEdit(d.id, { subject: ev.target.value })}
                          disabled={status === 'sending' || status === 'sent'}
                          className="flex-1 bg-transparent border-none focus:outline-none text-[13.5px] text-black/85 dark:text-white/85 disabled:opacity-60"
                          placeholder="Email subject"
                        />
                      </div>
                      {/* Body */}
                      <textarea
                        value={e.body}
                        onChange={(ev) => setEdit(d.id, { body: ev.target.value })}
                        disabled={status === 'sending' || status === 'sent'}
                        rows={Math.min(16, Math.max(6, e.body.split('\n').length + 1))}
                        className="w-full mt-3 bg-white/70 dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] rounded-xl px-4 py-3 text-[13.5px] leading-relaxed text-black/85 dark:text-white/85 focus:outline-none focus:border-black/20 dark:focus:border-white/20 resize-y disabled:opacity-60 draft-editor-scrollbar"
                        placeholder="Write your reply…"
                      />
                      {/* Actions */}
                      <div className="flex items-center justify-end gap-2.5 mt-3">
                        {d.recipientEmail && (
                          <span className="mr-auto text-[11px] text-white/35 font-mono truncate max-w-[55%]">to {d.recipientEmail}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => sendOne(d)}
                          disabled={status === 'sending' || status === 'sent'}
                          className={cn(
                            'inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[12px] tracking-wide uppercase transition-all active:scale-95',
                            status === 'sending' || status === 'sent'
                              ? 'bg-black/10 dark:bg-white/10 text-black/40 dark:text-white/40 cursor-not-allowed'
                              : 'bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90',
                          )}
                        >
                          {status === 'sending'
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending</>
                            : status === 'sent'
                              ? <><Check className="w-3.5 h-3.5" /> Sent</>
                              : <><Send className="w-3.5 h-3.5" /> Send</>}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between gap-3">
        <span className="text-[10.5px] uppercase tracking-widest font-bold text-black/30 dark:text-white/30">
          Edit any draft, then send it directly
        </span>
        <button
          onClick={onDismiss}
          className="px-4 py-2 rounded-xl text-[12px] font-bold tracking-wide uppercase text-black/55 dark:text-white/55 hover:text-black/90 dark:hover:text-white/90 hover:bg-black/5 dark:hover:bg-white/5 transition-colors inline-flex items-center gap-1.5"
        >
          <X className="w-3.5 h-3.5" />
          {allSent ? 'Close' : 'Done — keep rest in Drafts'}
        </button>
      </div>
    </motion.div>
  );
}
