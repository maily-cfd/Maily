'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, SlidersHorizontal, Loader2, Mail, Calendar, CalendarClock, FileText, MessageSquare, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
// Type-only import — keeps the server-side lib (supabase) out of the client bundle.
import type { BriefingPrefs, BriefingFocus, BriefingTone } from '@/lib/boult/briefing-prefs';

const DEFAULTS: BriefingPrefs = {
  focus: 'balanced',
  tone: 'warm',
  apps: { gmail: true, calendar: true, calcom: true, notion: true, slack: true },
  maxRecommendations: 3,
  customInstructions: '',
};

const FOCUS_OPTS: { value: BriefingFocus; label: string; hint: string }[] = [
  { value: 'balanced', label: 'Balanced', hint: 'A mix of relationships and getting things done' },
  { value: 'connections', label: 'Connections', hint: 'Lean toward people going quiet, follow-ups, intros' },
  { value: 'productivity', label: 'Productivity', hint: 'Lean toward clearing replies, overdue work, prep' },
];

const TONE_OPTS: { value: BriefingTone; label: string }[] = [
  { value: 'direct', label: 'Direct' },
  { value: 'warm', label: 'Warm' },
  { value: 'detailed', label: 'Detailed' },
];

const APP_OPTS: { key: keyof BriefingPrefs['apps']; label: string; icon: React.ReactNode }[] = [
  { key: 'gmail', label: 'Gmail', icon: <Mail className="w-4 h-4" strokeWidth={2} /> },
  { key: 'calendar', label: 'Calendar & Meet', icon: <Calendar className="w-4 h-4" strokeWidth={2} /> },
  { key: 'calcom', label: 'Cal.com', icon: <CalendarClock className="w-4 h-4" strokeWidth={2} /> },
  { key: 'notion', label: 'Notion', icon: <FileText className="w-4 h-4" strokeWidth={2} /> },
  { key: 'slack', label: 'Slack', icon: <MessageSquare className="w-4 h-4" strokeWidth={2} /> },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold tracking-[0.14em] uppercase text-black/45 dark:text-white/45 mb-2.5">{children}</h3>;
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex p-1 rounded-2xl bg-black/[0.04] dark:bg-white/[0.05] gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 py-2 rounded-xl text-[13px] font-medium transition-all',
            value === o.value
              ? 'bg-white dark:bg-white/[0.1] text-black dark:text-white shadow-sm'
              : 'text-black/45 dark:text-white/45 hover:text-black/70 dark:hover:text-white/70',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className={cn('relative w-10 h-6 rounded-full transition-colors flex-shrink-0', on ? 'bg-black dark:bg-white' : 'bg-black/[0.12] dark:bg-white/[0.15]')}
    >
      <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white dark:bg-black shadow transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

interface CustomizeBriefingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful save so the feed can re-fetch with the new prefs. */
  onSaved?: () => void;
}

export function CustomizeBriefingModal({ isOpen, onClose, onSaved }: CustomizeBriefingModalProps) {
  const [prefs, setPrefs] = useState<BriefingPrefs>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/home-feed/briefing-prefs');
        const json = await res.json().catch(() => null);
        if (!cancelled && json?.prefs) setPrefs(json.prefs as BriefingPrefs);
      } catch { /* keep defaults */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/home-feed/briefing-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs }),
      });
      if (!res.ok) throw new Error('save failed');
      toast.success('Briefing preferences saved');
      onSaved?.();
      onClose();
    } catch {
      toast.error("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  const setApp = (key: keyof BriefingPrefs['apps']) =>
    setPrefs((p) => ({ ...p, apps: { ...p.apps, [key]: !p.apps[key] } }));

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-lg max-h-[88vh] bg-white dark:bg-[#0f0f0f] border border-black/[0.05] dark:border-white/[0.08] rounded-[28px] flex flex-col shadow-[0_40px_120px_rgba(0,0,0,0.18)] dark:shadow-[0_40px_120px_rgba(0,0,0,0.8)] font-sans text-black dark:text-white overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-black/[0.05] dark:border-white/[0.06]">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-black/[0.05] dark:bg-white/[0.07] flex items-center justify-center text-black/70 dark:text-white/70">
                  <SlidersHorizontal className="w-4 h-4" strokeWidth={2} />
                </span>
                <div>
                  <h2 className="text-[16px] font-semibold tracking-tight leading-none">Customize briefing</h2>
                  <p className="text-[12px] text-black/45 dark:text-white/45 mt-1">How your daily "Worth your time" picks are shaped</p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-black/40 dark:text-white/40 hover:bg-black/[0.05] dark:hover:bg-white/[0.07] hover:text-black dark:hover:text-white transition-colors">
                <X className="w-4 h-4" strokeWidth={2.25} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-7">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-black/40 dark:text-white/40">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Focus */}
                  <div>
                    <SectionLabel>Focus</SectionLabel>
                    <Segmented value={prefs.focus} onChange={(focus) => setPrefs((p) => ({ ...p, focus }))} options={FOCUS_OPTS} />
                    <p className="text-[12px] text-black/45 dark:text-white/45 mt-2 leading-relaxed">
                      {FOCUS_OPTS.find((o) => o.value === prefs.focus)?.hint}
                    </p>
                  </div>

                  {/* Tone */}
                  <div>
                    <SectionLabel>Tone</SectionLabel>
                    <Segmented value={prefs.tone} onChange={(tone) => setPrefs((p) => ({ ...p, tone }))} options={TONE_OPTS} />
                  </div>

                  {/* Sources */}
                  <div>
                    <SectionLabel>Pull signals from</SectionLabel>
                    <div className="rounded-2xl border border-black/[0.06] dark:border-white/[0.07] divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                      {APP_OPTS.map((a) => (
                        <div key={a.key} className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-2.5 text-[13.5px] text-black/75 dark:text-white/75">
                            <span className="text-black/45 dark:text-white/45">{a.icon}</span>
                            {a.label}
                          </div>
                          <Toggle on={prefs.apps[a.key]} onClick={() => setApp(a.key)} />
                        </div>
                      ))}
                    </div>
                    <p className="text-[11.5px] text-black/35 dark:text-white/35 mt-2">Only apps you've connected contribute — toggling off skips one even when connected.</p>
                  </div>

                  {/* Count */}
                  <div>
                    <SectionLabel>How many moves</SectionLabel>
                    <Segmented
                      value={String(prefs.maxRecommendations)}
                      onChange={(v) => setPrefs((p) => ({ ...p, maxRecommendations: Number(v) }))}
                      options={[{ value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]}
                    />
                  </div>

                  {/* Custom instructions */}
                  <div>
                    <SectionLabel>Anything specific?</SectionLabel>
                    <textarea
                      value={prefs.customInstructions}
                      onChange={(e) => setPrefs((p) => ({ ...p, customInstructions: e.target.value.slice(0, 500) }))}
                      placeholder="e.g. always surface revenue threads first · ignore newsletters · flag anyone I haven't replied to in 2+ days"
                      rows={3}
                      className="w-full px-4 py-3 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.07] text-[13.5px] text-black dark:text-white placeholder:text-black/30 dark:placeholder:text-white/25 focus:outline-none focus:border-black/20 dark:focus:border-white/20 transition-colors resize-none leading-relaxed"
                    />
                    <div className="flex items-center gap-1.5 mt-2 text-[11.5px] text-black/35 dark:text-white/35">
                      <Sparkles className="w-3 h-3" strokeWidth={2} />
                      Honored where it applies — Boult never invents items to satisfy it.
                      <span className="ml-auto tabular-nums">{prefs.customInstructions.length}/500</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-black/[0.05] dark:border-white/[0.06]">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-full text-[13px] font-medium text-black/55 dark:text-white/55 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || loading}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-[13px] font-semibold bg-black text-white dark:bg-white dark:text-black hover:opacity-85 active:scale-[0.98] transition-all disabled:opacity-40"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default CustomizeBriefingModal;
