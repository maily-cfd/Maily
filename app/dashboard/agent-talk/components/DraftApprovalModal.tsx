'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Paperclip, Copy, Send, Mic, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { VoiceProfileButton } from '@/components/ui/voice-profile-button';

export interface DraftApprovalData {
  content: string;
  recipientName: string;
  recipientEmail: string;
  senderName?: string;
  subject: string;
  threadId?: string;
  gmailDraftId?: string;
  voiceScore?: number;
  voiceCritique?: string;
}

interface DraftApprovalModalProps {
  isVisible: boolean;
  draftData: DraftApprovalData | null;
  onSendReply: (payload: {
    content: string;
    recipientEmail: string;
    subject: string;
    threadId?: string;
    gmailDraftId?: string;
  }) => Promise<void>;
  onDismiss: () => void;
  /** Optional: re-generate this draft using the (updated) voice profile. */
  onRedraft?: () => void;
}

function markdownToInitialHtml(raw: string): string {
  if (!raw) return '';
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  s = s.replace(
    /\[([^\]]+)\]\(((?:https?|mailto):[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<![*\w])\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/(?<![_\w])_([^_\n]+?)_(?!_)/g, '<em>$1</em>');
  const paragraphs = s.split(/\n\s*\n/);
  return paragraphs
    .map(para => {
      const lines = para.split('\n').map(l => l.trimEnd());
      return `<p>${lines.join('<br>')}</p>`;
    })
    .join('');
}

export function DraftApprovalModal({
  isVisible,
  draftData,
  onSendReply,
  onDismiss,
  onRedraft,
}: DraftApprovalModalProps) {
  const [subject, setSubject] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (draftData) {
      setSubject(draftData.subject || '');
      setSendSuccess(false);
      setTimeout(() => {
        if (contentRef.current) {
          contentRef.current.innerHTML = markdownToInitialHtml(draftData.content || '');
        }
      }, 0);
    }
  }, [draftData]);

  useEffect(() => {
    if (!isVisible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSending) {
        reportFeedback('cancelled');
        onDismiss();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isVisible, isSending, onDismiss]);

  if (!draftData) return null;

  const reportFeedback = (action: 'sent' | 'edited_and_sent' | 'cancelled') => {
    if (!draftData?.recipientEmail) return;
    const originalBody = draftData.content || '';
    const finalBody = action === 'cancelled' ? undefined : (contentRef.current?.innerText || '').trim();
    try {
      fetch('/api/boult/learn/draft-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientEmail: draftData.recipientEmail,
          recipientName: draftData.recipientName,
          subject,
          originalBody,
          finalBody,
          action,
        }),
        keepalive: true,
      }).catch(() => { /* learning is non-critical */ });
    } catch { /* silent */ }
  };

  const handleSend = async () => {
    if (!draftData.recipientEmail) {
      toast.error('Missing recipient email');
      return;
    }
    const finalContent = (contentRef.current?.innerText || '').trim();
    if (!finalContent) {
      toast.error('Draft is empty');
      return;
    }
    setIsSending(true);
    try {
      await onSendReply({
        content: finalContent,
        recipientEmail: draftData.recipientEmail,
        subject,
        threadId: draftData.threadId,
        gmailDraftId: draftData.gmailDraftId,
      });
      setSendSuccess(true);
      toast.success('Email sent');
      const wasEdited = finalContent !== (draftData.content || '').trim();
      reportFeedback(wasEdited ? 'edited_and_sent' : 'sent');
      setTimeout(() => onDismiss(), 1100);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send');
      setIsSending(false);
    }
  };

  const handleCopy = () => {
    const text = contentRef.current?.innerText || '';
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isSending) {
      reportFeedback('cancelled');
      onDismiss();
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={handleBackdropClick}
          className="fixed inset-0 z-[1100] flex items-center justify-center p-4 backdrop-blur-sm bg-black/60 overflow-y-auto"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
            onMouseDown={(e) => e.stopPropagation()}
            className="bg-[#fafafa] dark:bg-[#1C1C1C] border border-black/[0.05] dark:border-transparent rounded-[24px] w-full max-w-3xl flex flex-col shadow-2xl relative mx-auto overflow-hidden"
            style={{ maxHeight: '85vh' }}
          >
            <div className="flex justify-between items-center px-8 py-5">
              <div className="flex items-center gap-4">
                <span className="text-black/40 dark:text-zinc-400 font-medium tracking-wide">Email</span>
                <VoiceProfileButton onApplied={onRedraft} />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled
                  title="Attachments coming soon"
                  className="p-2 rounded-lg text-black/20 dark:text-white/20 cursor-not-allowed"
                >
                  <Paperclip className="w-[18px] h-[18px]" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={isSending}
                  className="p-2 hover:bg-black/5 dark:hover:bg-neutral-800 rounded-lg text-black/40 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Copy"
                >
                  <Copy className="w-[18px] h-[18px]" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isSending || sendSuccess}
                  className="p-2 hover:bg-black/5 dark:hover:bg-neutral-800 rounded-lg text-black/40 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Send"
                >
                  {isSending ? (
                    <Loader2 className="w-[18px] h-[18px] animate-spin" strokeWidth={1.5} />
                  ) : (
                    <Send className="w-[18px] h-[18px]" strokeWidth={1.5} />
                  )}
                </button>
              </div>
            </div>

            <div className="px-8 pb-3 flex items-baseline gap-4">
              <span className="text-black/40 dark:text-white/40 text-[11px] font-bold uppercase tracking-wider w-14 shrink-0">To</span>
              <span className="text-black/80 dark:text-zinc-200 text-[14px] font-medium truncate">
                {draftData.recipientName}
                {draftData.recipientEmail && (
                  <span className="text-black/40 dark:text-white/40 font-mono text-[12px] ml-1.5">&lt;{draftData.recipientEmail}&gt;</span>
                )}
              </span>
            </div>

            <div className="px-8 pb-4 flex items-center gap-4 border-b border-black/[0.06] dark:border-white/[0.04]">
              <span className="text-black/40 dark:text-white/40 text-[11px] font-bold uppercase tracking-wider w-14 shrink-0">Subject</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={isSending}
                className="bg-transparent border-none focus:outline-none text-black/80 dark:text-zinc-200 w-full text-[14px] disabled:opacity-60"
                placeholder="Email Subject"
              />
            </div>

            <div className="px-8 py-6 flex-1 min-h-[280px] overflow-y-auto draft-editor-scrollbar">
              <div
                ref={contentRef}
                contentEditable={!isSending && !sendSuccess}
                suppressContentEditableWarning
                className={cn(
                  'w-full h-full text-black dark:text-zinc-100 focus:outline-none leading-[1.8] font-[400] text-[15px] selection:bg-black/10 dark:selection:bg-white/15 font-sans',
                  '[&_a]:text-black/70 dark:[&_a]:text-white/70 [&_a]:underline [&_a]:underline-offset-2 [&_a]:cursor-pointer',
                  '[&_strong]:font-bold [&_b]:font-bold [&_em]:italic [&_i]:italic',
                  '[&_p]:mb-4 [&_p:last-child]:mb-0',
                  (isSending || sendSuccess) && 'opacity-60 pointer-events-none',
                )}
                style={{ minHeight: '200px' }}
              />

              {typeof draftData.voiceScore === 'number' && (
                <div className="mt-6 pt-4 border-t border-black/[0.04] dark:border-white/[0.04] flex items-center justify-between">
                  <button
                    type="button"
                    className="text-[12px] text-black/40 dark:text-white/30 hover:text-black/70 dark:hover:text-white/60 transition-colors flex items-center gap-1.5 font-medium underline underline-offset-2 decoration-black/15 dark:decoration-white/15"
                  >
                    <Mic className="w-3 h-3" />
                    Voice Profile
                  </button>
                  <div className="text-[11px] text-black/40 dark:text-white/30 font-medium tabular-nums flex items-center gap-2">
                    <span>Voice match</span>
                    <span className="font-mono">{draftData.voiceScore}/100</span>
                  </div>
                </div>
              )}

              {typeof draftData.voiceScore === 'number' && draftData.voiceScore < 70 && draftData.voiceCritique && (
                <div className="mt-2 text-[11px] text-black/50 dark:text-white/40 leading-snug">
                  {draftData.voiceCritique}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
