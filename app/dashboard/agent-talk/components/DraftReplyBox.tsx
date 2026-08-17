'use client';

import React, { useState, useEffect } from 'react';
import { Copy, X, Edit2, Mail, Send, Check, Sparkles, ArrowUp, CornerDownLeft, Paperclip, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import WordBlurStream from '../../../../src/WordBlurStream';
import { BoultLogo } from '@/components/ui/boult-logo';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface DraftReplyBoxProps {
    draftData: {
        content: string;
        recipientName: string;
        recipientEmail: string;
        senderName: string;
        originalEmailId?: string;
        subject: string;
        threadId?: string;
        gmailDraftId?: string;
        /** 0-100 voice-match score from reviewDraft (post-draft critique pass). */
        voiceScore?: number;
        /** One-line critique surfaced under the score badge when score < 70. */
        voiceCritique?: string;
    } | null;
    onSendReply: (draftData: {
        content: string;
        recipientEmail: string;
        subject: string;
        threadId?: string;
        gmailDraftId?: string;
    }) => Promise<void>;
    onDismiss: () => void;
    isVisible: boolean;
}

export function DraftReplyBox({
    draftData,
    onSendReply,
    onDismiss,
    isVisible
}: DraftReplyBoxProps) {
    const [editedContent, setEditedContent] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [sendSuccess, setSendSuccess] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    // PART 3: two-click send gate. Send Now opens this overlay; the user must
    // explicitly press Confirm Send in the overlay before handleSend fires.
    // The LLM-driven send path is already gated by Phase 2's executor approval
    // system — this overlay is the *user-driven* gate, replacing the prior
    // one-click send-from-card flow.
    const [showConfirmOverlay, setShowConfirmOverlay] = useState(false);
    
    // AI Refinement State
    const [selection, setSelection] = useState<{ text: string; rect: DOMRect; start: number; end: number } | null>(null);
    const [isRefinementActive, setIsRefinementActive] = useState(false);
    const [refinementInstruction, setRefinementInstruction] = useState('');
    const [isProcessingRefinement, setIsProcessingRefinement] = useState(false);
    const [proposedRefinement, setProposedRefinement] = useState<string | null>(null);
    const [showTooltip, setShowTooltip] = useState(false);

    useEffect(() => {
        if (draftData?.content) {
            setEditedContent(draftData.content);
            setIsEditing(false);
            setSendSuccess(false);
            setSendError(null);
            setProposedRefinement(null);
            setIsRefinementActive(false);
        }
    }, [draftData]);

    // Handle Selection for Refinement
    const handleMouseUp = (e: React.MouseEvent) => {
        if (isRefinementActive || isProcessingRefinement || proposedRefinement) return;
        
        const sel = window.getSelection();
        const textarea = e.currentTarget.querySelector('textarea');
        
        if (isEditing && textarea) {
            // Textarea selection handling
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = editedContent.substring(start, end);

            if (text.trim().length > 0) {
                const rect = textarea.getBoundingClientRect();
                setSelection({ 
                    text, 
                    rect: { 
                        ...rect, 
                        top: e.clientY, 
                        left: e.clientX,
                        width: 0,
                        height: 0,
                        right: e.clientX,
                        bottom: e.clientY,
                        x: e.clientX,
                        y: e.clientY,
                        toJSON: () => {}
                    } as DOMRect, 
                    start, 
                    end 
                });
                setShowTooltip(true);
            } else {
                setShowTooltip(false);
                setSelection(null);
            }
        } else if (sel && sel.toString().trim().length > 0) {
            // Standard DOM selection
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const text = sel.toString();
            
            const start = editedContent.indexOf(text);
            const end = start + text.length;

            if (start !== -1) {
                setSelection({ text, rect, start, end });
                setShowTooltip(true);
            }
        } else {
            setShowTooltip(false);
            setSelection(null);
        }
    };

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
                if (selection && !isRefinementActive) {
                    setIsRefinementActive(true);
                    e.preventDefault();
                }
            }
            if (e.key === 'Escape' && proposedRefinement) {
                setProposedRefinement(null);
                e.preventDefault();
            }
            if (e.key === 'Escape' && isRefinementActive) {
                setIsRefinementActive(false);
                setSelection(null);
                e.preventDefault();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && proposedRefinement) {
                handleAcceptRefinement();
                e.preventDefault();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selection, isRefinementActive, proposedRefinement]);

    const handleRefinementSubmit = async () => {
        if (!selection || !refinementInstruction.trim()) return;
        
        setIsProcessingRefinement(true);
        try {
            const res = await fetch('/api/email/refine-reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fullContent: editedContent,
                    selectedText: selection.text,
                    instruction: refinementInstruction
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'Refinement failed');
            }
            if (data.refinedText) {
                setProposedRefinement(data.refinedText);
                setIsRefinementActive(false);
                setShowTooltip(false);
            } else {
                throw new Error('No refined text returned');
            }
        } catch (error) {
            console.error('Refinement failed:', error);
            setIsRefinementActive(false);
            setSelection(null);
            setShowTooltip(false);
            toast.error(error instanceof Error ? error.message : 'Refinement failed');
        } finally {
            setIsProcessingRefinement(false);
            setRefinementInstruction('');
        }
    };

    const handleAcceptRefinement = () => {
        if (!selection || !proposedRefinement) return;
        const newContent = 
            editedContent.slice(0, selection.start) + 
            proposedRefinement + 
            editedContent.slice(selection.end);
        setEditedContent(newContent);
        setProposedRefinement(null);
        setSelection(null);
    };

    if (!isVisible || !draftData) return null;

    const handleSend = async () => {
        if (!draftData.recipientEmail || !editedContent.trim()) {
            setSendError('Missing recipient email or content');
            return;
        }

        setIsSending(true);
        setSendError(null);

        try {
            await onSendReply({
                content: editedContent,
                recipientEmail: draftData.recipientEmail,
                subject: draftData.subject,
                threadId: draftData.threadId,
                gmailDraftId: draftData.gmailDraftId,
            });
            setSendSuccess(true);
            toast.success('Email sent successfully!');
            setTimeout(() => {
                onDismiss();
            }, 2000);
        } catch (error) {
            setSendError(error instanceof Error ? error.message : 'Failed to send reply');
            toast.error(error instanceof Error ? error.message : 'Failed to send reply');
        } finally {
            setIsSending(false);
        }
    };

    const handleCopyDraft = () => {
        navigator.clipboard.writeText(editedContent);
        toast.success('Copied email to clipboard');
    };

    return (
        <div className="boult-glass-card rounded-[24px] overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-700 max-w-2xl mx-auto my-6 relative select-text">
            {/* Technical subtle noise overlay */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.015] z-[0] bg-[url('/noise.svg')] brightness-100 contrast-150" />

            {/* Ambient Glow */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-black/[0.02] dark:bg-white/[0.02] rounded-full blur-[60px] pointer-events-none" />

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-black/[0.05] dark:border-white/[0.04] bg-black/[0.02] dark:bg-[#333333]/30 relative z-10">
                <div className="flex items-center gap-4">
                    <BoultLogo size={36} className="shrink-0" />
                    <div>
                        <h3 className="text-black dark:text-white font-bold text-xs tracking-wider uppercase">Boult AI Draft</h3>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-tight font-bold">Gmail Triage Agent</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleCopyDraft}
                        className="p-2 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-all duration-300"
                        title="Copy draft"
                    >
                        <Copy className="w-4.5 h-4.5" />
                    </button>
                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        className={cn(
                            "p-2 rounded-xl transition-all duration-300",
                            isEditing
                                ? "bg-black text-white dark:bg-white dark:text-black font-bold"
                                : "hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                        )}
                        title={isEditing ? 'Save changes' : 'Edit message'}
                    >
                        <Edit2 className="w-4.5 h-4.5" />
                    </button>
                    <button
                        onClick={onDismiss}
                        className="p-2 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-xl transition-all duration-300 text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                        title="Dismiss"
                    >
                        <X className="w-4.5 h-4.5" />
                    </button>
                </div>
            </div>

            {/* Recipient & Subject Strip */}
            <div className="px-6 py-4 bg-black/[0.015] dark:bg-[#333333]/15 border-b border-black/[0.05] dark:border-white/[0.04] flex flex-col gap-2 relative z-10">
                <div className="flex items-center gap-4 text-xs tracking-wide">
                    <span className="text-zinc-500 font-bold uppercase tracking-widest w-12 shrink-0">To</span>
                    <span className="text-zinc-800 dark:text-zinc-200 font-semibold">{draftData.recipientName}</span>
                    {draftData.recipientEmail && (
                        <span className="text-zinc-500 font-medium truncate font-mono text-[11px]">&lt;{draftData.recipientEmail}&gt;</span>
                    )}
                </div>
                <div className="h-px bg-black/[0.04] dark:bg-white/[0.02] w-full" />
                <div className="flex items-center gap-4 text-xs tracking-wide">
                    <span className="text-zinc-500 font-bold uppercase tracking-widest w-12 shrink-0">Subject</span>
                    <span className="text-zinc-700 dark:text-zinc-300 font-medium truncate">{draftData.subject}</span>
                </div>
                {typeof draftData.voiceScore === 'number' && (
                    <>
                        <div className="h-px bg-black/[0.04] dark:bg-white/[0.02] w-full" />
                        <div className="flex items-start gap-4 text-xs tracking-wide">
                            <span className="text-zinc-500 font-bold uppercase tracking-widest w-12 shrink-0">Voice</span>
                            <div className="flex flex-col gap-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={cn(
                                            'px-1.5 py-0.5 rounded-md font-bold text-[11px] tracking-wide tabular-nums',
                                            draftData.voiceScore >= 85
                                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                                                : draftData.voiceScore >= 70
                                                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20'
                                                    : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/25',
                                        )}
                                    >
                                        {draftData.voiceScore}/100
                                    </span>
                                    <span className="text-zinc-500 text-[11px]">
                                        {draftData.voiceScore >= 85
                                            ? 'Sounds like you.'
                                            : draftData.voiceScore >= 70
                                                ? 'Mostly matches your voice.'
                                                : 'May not match your voice — review before sending.'}
                                    </span>
                                </div>
                                {draftData.voiceScore < 70 && draftData.voiceCritique && (
                                    <span className="text-rose-600/80 dark:text-rose-300/70 text-[11px] leading-snug">
                                        {draftData.voiceCritique}
                                    </span>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Email Body Content Area */}
            <div className="p-7 relative z-10" onMouseUp={handleMouseUp}>
                {isEditing ? (
                    <textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="w-full min-h-[200px] bg-white/70 dark:bg-[#1A1A1A] border border-black/[0.08] dark:border-white/[0.06] focus:border-black/[0.16] dark:focus:border-white/[0.12] rounded-2xl p-6 text-zinc-900 dark:text-zinc-100 text-[15px] leading-[1.8] resize-none focus:outline-none transition-all duration-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 font-sans selection:bg-blue-500/30"
                        placeholder="Type your message here..."
                        autoFocus
                    />
                ) : (
                    <div className="min-h-[120px] text-zinc-900 dark:text-zinc-100 text-[15px] whitespace-pre-wrap leading-[1.8] selection:bg-blue-500/25 tracking-tight font-sans">
                        {proposedRefinement && selection ? (
                            <>
                                {editedContent.slice(0, selection.start)}
                                <span className="text-zinc-400 dark:text-zinc-500 line-through decoration-red-500/40 decoration-1 bg-red-500/5 px-0.5 rounded">
                                    {selection.text}
                                </span>
                                <span className="text-black dark:text-white bg-blue-500/15 dark:bg-blue-500/20 px-1.5 py-0.5 rounded border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.15)] font-semibold">
                                    <WordBlurStream text={proposedRefinement} loop={false} />
                                </span>
                                {editedContent.slice(selection.end)}
                            </>
                        ) : (
                            editedContent || (
                                <div className="flex flex-col items-center justify-center py-8 text-zinc-500 text-sm gap-3">
                                    <div className="w-6.5 h-6.5 border-[2.5px] border-black/15 border-t-black dark:border-white/20 dark:border-t-white rounded-full animate-spin" />
                                    <span className="font-mono text-[10.5px] uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Boult is writing...</span>
                                </div>
                            )
                        )}
                    </div>
                )}

                {/* World-Class AI Refinement Tooltip */}
                <AnimatePresence mode="wait">
                    {(showTooltip || isRefinementActive || proposedRefinement) && selection && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.98, y: 10, filter: 'blur(8px)' }}
                            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                            exit={{ opacity: 0, scale: 0.98, y: 10, filter: 'blur(8px)' }}
                            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                            style={{
                                position: 'fixed',
                                left: selection.rect.left + (selection.rect.width / 2),
                                top: selection.rect.top - 16,
                                transform: 'translate(-50%, -100%)',
                                zIndex: 1100
                            }}
                            className="pointer-events-auto"
                        >
                            {!isRefinementActive && !proposedRefinement && (
                                <button
                                    onClick={() => setIsRefinementActive(true)}
                                    className="bg-[#2A2A2A] border border-white/[0.08] hover:border-white/20 rounded-full px-5 py-2.5 flex items-center gap-3.5 shadow-2xl backdrop-blur-2xl transition-all duration-300 group active:scale-95"
                                >
                                    <Sparkles className="w-3.5 h-3.5 text-blue-400 group-hover:animate-pulse" />
                                    <span className="text-white font-bold text-xs tracking-tight">Ask for changes</span>
                                    <div className="flex items-center gap-1 opacity-40">
                                        <div className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] font-bold text-white">Ctrl</div>
                                        <div className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] font-bold text-white">M</div>
                                    </div>
                                </button>
                            )}

                            {isRefinementActive && (
                                <div className="bg-[#2A2A2A] border border-white/10 rounded-[18px] p-1.5 shadow-2xl w-[360px] backdrop-blur-3xl overflow-hidden ring-1 ring-white/5">
                                    <div className="relative group/input">
                                        <input
                                            autoFocus
                                            value={refinementInstruction}
                                            onChange={(e) => setRefinementInstruction(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleRefinementSubmit();
                                                if (e.key === 'Escape') setIsRefinementActive(false);
                                            }}
                                            placeholder="Describe your changes..."
                                            className="w-full bg-[#1E1E1E] text-white text-[13.5px] py-3.5 px-5 pr-14 rounded-[14px] border border-transparent focus:outline-none focus:border-white/10 transition-all placeholder:text-zinc-600 font-medium tracking-tight"
                                        />
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                                            {refinementInstruction && !isProcessingRefinement && (
                                                <button 
                                                    onClick={() => setRefinementInstruction('')}
                                                    className="w-6 h-6 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white transition-colors"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                            <button 
                                                onClick={handleRefinementSubmit}
                                                disabled={isProcessingRefinement || !refinementInstruction.trim()}
                                                className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white hover:bg-blue-500 transition-all disabled:opacity-30 disabled:grayscale shadow-lg shadow-blue-500/20 active:scale-90"
                                            >
                                                {isProcessingRefinement ? (
                                                    <div className="w-4 h-4 border-[2px] border-white/20 border-t-white rounded-full animate-spin" />
                                                ) : (
                                                    <ArrowUp className="w-4 h-4 stroke-[3]" />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {proposedRefinement && (
                                <div className="bg-[#2A2A2A] border border-white/10 rounded-[18px] p-2 flex items-center gap-2 shadow-2xl backdrop-blur-3xl ring-1 ring-white/5">
                                    <button 
                                        onClick={() => setProposedRefinement(null)}
                                        className="h-10 px-4 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 text-[13px] font-bold transition-all flex items-center gap-3 active:scale-95"
                                    >
                                        Undo
                                        <div className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] font-bold opacity-40 uppercase">Esc</div>
                                    </button>
                                    <div className="w-px h-6 bg-white/10 mx-1" />
                                    <button 
                                        onClick={handleAcceptRefinement}
                                        className="h-10 px-5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white text-[13px] font-bold transition-all flex items-center gap-4 shadow-xl shadow-blue-500/25 active:scale-95 active:translate-y-0.5"
                                    >
                                        Accept
                                        <div className="flex items-center gap-1 opacity-70">
                                            <div className="px-1.5 py-0.5 rounded border border-white/30 bg-white/10 text-[9px] font-bold uppercase tracking-tighter">Ctrl</div>
                                            <CornerDownLeft className="w-3 h-3" />
                                        </div>
                                    </button>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Footer / Controls */}
            <div className="px-8 py-5 bg-black/[0.02] dark:bg-[#333333]/30 border-t border-black/[0.05] dark:border-white/[0.04] flex items-center justify-between relative z-10">
                <div className="flex items-center gap-3">
                    {sendError ? (
                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-[10px] tracking-wider bg-red-500/5 px-4 py-2 rounded-xl border border-red-500/10 uppercase font-bold">
                            <X className="w-3 h-3" />
                            {sendError}
                        </div>
                    ) : sendSuccess ? (
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-[10px] tracking-wider bg-emerald-500/5 px-4 py-2 rounded-xl border border-emerald-500/10 uppercase font-bold">
                            <Check className="w-3 h-3" />
                            Sent successfully
                        </div>
                    ) : (
                        <span className="text-zinc-500 text-[9px] tracking-widest uppercase font-bold">
                            Review and Send
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {/* Save to Drafts — the draft already lives in Gmail Drafts (saved on
                        create), so this is "close the card, leave the draft alone." */}
                    <button
                        onClick={onDismiss}
                        disabled={isSending || sendSuccess}
                        className="px-5 py-2.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 font-bold text-xs tracking-wider uppercase transition-all duration-300 disabled:opacity-30 disabled:pointer-events-none"
                    >
                        Save to Drafts
                    </button>
                    {/* Edit Draft — toggles the same isEditing state as the header pencil */}
                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        disabled={isSending || sendSuccess}
                        className={cn(
                            'px-5 py-2.5 rounded-xl font-bold text-xs tracking-wider uppercase transition-all duration-300 disabled:opacity-30 disabled:pointer-events-none',
                            isEditing
                                ? 'bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200'
                                : 'text-zinc-600 dark:text-zinc-300 hover:text-black dark:hover:text-white border border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 hover:bg-black/5 dark:hover:bg-white/5',
                        )}
                    >
                        {isEditing ? 'Done Editing' : 'Edit Draft'}
                    </button>
                    {/* Send Now — opens the inline confirm overlay (PART 3). Two clicks
                        are required before the email actually goes out. */}
                    <button
                        onClick={() => {
                            if (!draftData.recipientEmail) {
                                setSendError('Missing recipient email');
                                return;
                            }
                            setSendError(null);
                            setShowConfirmOverlay(true);
                        }}
                        disabled={isSending || sendSuccess || !draftData.recipientEmail}
                        className={cn(
                            'group relative flex items-center gap-2.5 px-6 py-2.5 rounded-xl font-bold text-xs tracking-widest uppercase transition-all duration-300 transform active:scale-95',
                            isSending || sendSuccess
                                ? 'bg-black/5 dark:bg-white/5 text-zinc-400 dark:text-zinc-600 cursor-not-allowed border border-black/5 dark:border-white/5'
                                : 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-lg shadow-emerald-500/25',
                        )}
                    >
                        {isSending ? (
                            <>
                                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Sending...
                            </>
                        ) : sendSuccess ? (
                            <>
                                <Check className="w-3.5 h-3.5" />
                                Sent
                            </>
                        ) : (
                            <>
                                <Send className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                                Send Now
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Inline confirm overlay (PART 3). Sits on top of the card body, not as
                a modal popup — the user stays in context with the draft visible
                underneath. Only this overlay's Confirm Send button calls handleSend. */}
            <AnimatePresence>
                {showConfirmOverlay && !sendSuccess && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="absolute inset-0 z-30 flex items-center justify-center backdrop-blur-md bg-black/55"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 16, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 12, scale: 0.97 }}
                            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                            className="mx-6 w-full max-w-md rounded-[20px] bg-white dark:bg-[#1A1A1A] border border-black/10 dark:border-white/10 shadow-2xl overflow-hidden"
                        >
                            <div className="px-6 py-5 border-b border-black/[0.06] dark:border-white/[0.06]">
                                <p className="text-[10px] tracking-widest uppercase font-bold text-emerald-600/90 dark:text-emerald-400/80 mb-2">Final confirmation</p>
                                <p className="text-[15px] text-black/90 dark:text-white/90 leading-snug">
                                    Sending to <span className="font-semibold">{draftData.recipientName}</span>
                                    {draftData.recipientEmail && (
                                        <span className="font-mono text-[12px] text-black/55 dark:text-white/55"> &lt;{draftData.recipientEmail}&gt;</span>
                                    )}
                                    .
                                </p>
                                <p className="text-[12px] text-black/45 dark:text-white/45 mt-1">This cannot be undone.</p>
                            </div>
                            <div className="px-6 py-4 flex items-center justify-end gap-3 bg-black/[0.02] dark:bg-white/[0.02]">
                                <button
                                    onClick={() => setShowConfirmOverlay(false)}
                                    disabled={isSending}
                                    className="px-5 py-2.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 font-bold text-xs tracking-wider uppercase transition-all duration-300 disabled:opacity-40 disabled:pointer-events-none"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={async () => {
                                        await handleSend();
                                        // Overlay stays mounted through the sending state so the
                                        // user sees the spinner; on success the card auto-dismisses
                                        // via the existing 2s timer.
                                        setShowConfirmOverlay(false);
                                    }}
                                    disabled={isSending}
                                    className={cn(
                                        'flex items-center gap-2.5 px-6 py-2.5 rounded-xl font-bold text-xs tracking-widest uppercase transition-all duration-300 active:scale-95',
                                        isSending
                                            ? 'bg-emerald-500/40 text-white/70 cursor-not-allowed'
                                            : 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-lg shadow-emerald-500/30',
                                    )}
                                >
                                    {isSending ? (
                                        <>
                                            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Sending…
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-3.5 h-3.5" />
                                            Confirm Send
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
