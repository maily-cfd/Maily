'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type CommunicationStyle = 'direct' | 'balanced' | 'warm';
type Verbosity = 'brief' | 'normal' | 'detailed';

interface PersonalitySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  // PART 45 — onSave now carries the full settings object so the parent
  // can POST every field in one round-trip. `personality` arg kept for
  // back-compat with any existing call site that ignores the extras.
  onSave: (
    personality: string,
    opts?: { communicationStyle: CommunicationStyle; verbosity: Verbosity },
  ) => void;
  initialPersonality?: string;
  initialCommunicationStyle?: CommunicationStyle;
  initialVerbosity?: Verbosity;
}

const STYLE_OPTIONS: Array<{ value: CommunicationStyle; label: string; hint: string }> = [
  { value: 'direct',   label: 'Direct',   hint: 'No warm openers. Crisp, confident, just the outcome.' },
  { value: 'balanced', label: 'Balanced', hint: 'One short opener, then to the point.' },
  { value: 'warm',     label: 'Warm',     hint: 'Leads with warmth. Shows interest in interesting work.' },
];

const VERBOSITY_OPTIONS: Array<{ value: Verbosity; label: string; hint: string }> = [
  { value: 'brief',    label: 'Brief',    hint: 'One-liners and short paragraphs.' },
  { value: 'normal',   label: 'Normal',   hint: 'Outcome + what needs your attention.' },
  { value: 'detailed', label: 'Detailed', hint: 'Full picture when the task earns it.' },
];

const placeholderVariations = [
  'Give Boult some context...',
  'Describe how Boult should behave...',
  "Set Boult's communication style...",
  "Customize Boult's personality...",
];

export function PersonalitySettingsModal({
  isOpen,
  onClose,
  onSave,
  initialPersonality = '',
  initialCommunicationStyle = 'warm',
  initialVerbosity = 'normal',
}: PersonalitySettingsModalProps) {
  const [personality, setPersonality] = useState(initialPersonality);
  const [communicationStyle, setCommunicationStyle] = useState<CommunicationStyle>(initialCommunicationStyle);
  const [verbosity, setVerbosity] = useState<Verbosity>(initialVerbosity);
  const [placeholderText, setPlaceholderText] = useState('');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState('');
  const placeholderIndexRef = useRef(0);
  const charIndexRef = useRef(0);
  const isTypingRef = useRef(true);
  const animationRef = useRef<NodeJS.Timeout | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPersonality(initialPersonality);
      setCommunicationStyle(initialCommunicationStyle);
      setVerbosity(initialVerbosity);
      setEnhanceError('');
    }
  }, [isOpen, initialPersonality, initialCommunicationStyle, initialVerbosity]);

  // Animated placeholder
  useEffect(() => {
    if (!isOpen) {
      placeholderIndexRef.current = 0;
      charIndexRef.current = 0;
      isTypingRef.current = true;
      setPlaceholderText('');
      if (animationRef.current) clearTimeout(animationRef.current);
      return;
    }

    const animate = () => {
      const current = placeholderVariations[placeholderIndexRef.current];
      if (isTypingRef.current) {
        if (charIndexRef.current < current.length) {
          setPlaceholderText(current.substring(0, charIndexRef.current + 1));
          charIndexRef.current++;
          animationRef.current = setTimeout(animate, 50);
        } else {
          isTypingRef.current = false;
          animationRef.current = setTimeout(animate, 2000);
        }
      } else {
        if (charIndexRef.current > 0) {
          charIndexRef.current--;
          setPlaceholderText(current.substring(0, charIndexRef.current));
          animationRef.current = setTimeout(animate, 30);
        } else {
          placeholderIndexRef.current =
            (placeholderIndexRef.current + 1) % placeholderVariations.length;
          isTypingRef.current = true;
          animationRef.current = setTimeout(animate, 100);
        }
      }
    };

    animate();
    return () => { if (animationRef.current) clearTimeout(animationRef.current); };
  }, [isOpen]);

  const handleEnhance = async () => {
    const draft = personality.trim();
    if (!draft) return;
    setIsEnhancing(true);
    setEnhanceError('');
    try {
      const res = await fetch('/api/agent-talk/personality/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft }),
      });
      const data = await res.json();
      if (!res.ok || !data.enhanced) throw new Error(data.error || 'Enhancement failed');
      setPersonality(data.enhanced);
      setTimeout(() => textareaRef.current?.focus(), 50);
    } catch (err: any) {
      setEnhanceError(err.message || 'Could not enhance. Try again.');
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleSave = () => {
    onSave(personality, { communicationStyle, verbosity });
    onClose();
  };

  const handleCancel = () => {
    setPersonality(initialPersonality);
    setEnhanceError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative p-6 md:p-10 w-[min(90vw,640px)] max-h-[90vh] overflow-y-auto shadow-2xl rounded-[2.5rem] border border-neutral-200 dark:border-[#2a2a2a] bg-white dark:bg-black flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight text-black dark:text-white">
              Boult Personality
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Tell Boult how to behave, communicate, and respond
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all duration-200 border border-neutral-100 dark:border-neutral-800"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PART 45 — Voice + length controls (segmented). Sit ABOVE the free-text
            instructions so the user sets the broad tone first, then layers
            specific binding rules underneath. */}
        <div className="mb-6 space-y-4">
          {/* Communication style */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-white/40 mb-2">
              Communication style
            </label>
            <div className="grid grid-cols-3 gap-2">
              {STYLE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCommunicationStyle(opt.value)}
                  className={cn(
                    'flex flex-col items-start gap-1 px-3.5 py-3 rounded-2xl border text-left transition-all',
                    communicationStyle === opt.value
                      ? 'bg-black dark:bg-white text-white dark:text-black border-transparent shadow-sm'
                      : 'bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-white/70 border-neutral-200 dark:border-[#2a2a2a] hover:border-neutral-300 dark:hover:border-[#3a3a3a]',
                  )}
                >
                  <span className="text-[13px] font-bold">{opt.label}</span>
                  <span className={cn(
                    'text-[11px] leading-snug',
                    communicationStyle === opt.value
                      ? 'text-white/70 dark:text-black/60'
                      : 'text-neutral-500 dark:text-white/40',
                  )}>
                    {opt.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Response length */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-white/40 mb-2">
              Response length
            </label>
            <div className="grid grid-cols-3 gap-2">
              {VERBOSITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVerbosity(opt.value)}
                  className={cn(
                    'flex flex-col items-start gap-1 px-3.5 py-3 rounded-2xl border text-left transition-all',
                    verbosity === opt.value
                      ? 'bg-black dark:bg-white text-white dark:text-black border-transparent shadow-sm'
                      : 'bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-white/70 border-neutral-200 dark:border-[#2a2a2a] hover:border-neutral-300 dark:hover:border-[#3a3a3a]',
                  )}
                >
                  <span className="text-[13px] font-bold">{opt.label}</span>
                  <span className={cn(
                    'text-[11px] leading-snug',
                    verbosity === opt.value
                      ? 'text-white/70 dark:text-black/60'
                      : 'text-neutral-500 dark:text-white/40',
                  )}>
                    {opt.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Free-text custom instructions */}
        <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-white/40 mb-2">
          Custom instructions (binding rules)
        </label>

        {/* Textarea area */}
        <div className="relative mb-3 flex-1">
          <textarea
            ref={textareaRef}
            value={personality}
            onChange={(e) => { setPersonality(e.target.value); setEnhanceError(''); }}
            placeholder={placeholderText || placeholderVariations[0]}
            className="w-full min-h-[260px] p-5 pb-14 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-[#3a3a3a] rounded-[1.5rem] text-black dark:text-white placeholder:text-black/30 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 resize-none font-sans text-[15px] leading-relaxed shadow-inner"
          />

          {/* Enhance button — inside textarea bottom */}
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
            {enhanceError ? (
              <span className="text-[12px] text-red-400">{enhanceError}</span>
            ) : (
              <span className="text-[12px] text-neutral-400 dark:text-white/25">
                {personality.trim()
                  ? `${personality.trim().split(/\s+/).length} words`
                  : 'Write your instructions above'}
              </span>
            )}

            <button
              onClick={handleEnhance}
              disabled={isEnhancing || !personality.trim()}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all duration-200 border',
                personality.trim() && !isEnhancing
                  ? 'bg-black dark:bg-white text-white dark:text-black border-transparent hover:opacity-90 active:scale-95'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-white/25 border-transparent cursor-not-allowed',
              )}
            >
              {isEnhancing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Enhancing…
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  Enhance
                </>
              )}
            </button>
          </div>
        </div>

        {/* Hint */}
        <p className="text-[12px] text-neutral-400 dark:text-white/25 mb-6 leading-relaxed">
          Tip: Write a rough description and hit{' '}
          <span className="font-semibold text-neutral-500 dark:text-white/40">Enhance</span>{' '}
          — Boult will expand it into a detailed professional instruction set.
        </p>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={handleCancel}
            className="px-7 py-3 rounded-2xl font-semibold transition-all duration-200 bg-neutral-100 dark:bg-[#2a2a2a] text-black dark:text-white hover:bg-neutral-200 dark:hover:bg-[#333]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-2xl px-7 py-3 transition-all font-semibold flex items-center gap-2 shadow-lg active:scale-95 bg-black dark:bg-[#fafafa] text-white dark:text-black hover:bg-black/90 dark:hover:bg-neutral-200"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
