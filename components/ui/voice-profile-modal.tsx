'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, RotateCw, Mic, ExternalLink, Plus, Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface VoiceProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: any;
  onReAnalyze: () => void;
  onCreate: () => void;
  isAnalyzing?: boolean;
  onProfileUpdated?: (profile: any) => void;
}

const DEFAULT_HABITS = [
  'Uses "thanks" not "thank you"',
  'Signs off with first name',
  'Bullet points for lists',
  'Avoids exclamation marks',
  'No "per my last email"',
  'Short subject lines',
  'Oxford commas always',
  'Uses contractions',
  'Emoji in casual emails',
  'Prefers numbered lists',
];

export const VoiceProfileModal = ({ isOpen, onClose, profile, onReAnalyze, onCreate, isAnalyzing = false, onProfileUpdated }: VoiceProfileModalProps) => {
  // --- Tone Sliders ---
  const [formality, setFormality] = useState(50);
  const [detail, setDetail] = useState(40);
  const [warmth, setWarmth] = useState(50);
  const [confidence, setConfidence] = useState(30);

  // --- Habits ---
  const [habits, setHabits] = useState<string[]>([]);
  const [newHabitInput, setNewHabitInput] = useState('');
  const [showHabitInput, setShowHabitInput] = useState(false);

  // --- Custom Instructions ---
  const [customInstructions, setCustomInstructions] = useState('');

  // --- Learning ---
  const [autoImprove, setAutoImprove] = useState(true);
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false);
  // Manual source import — paste your own writing instead of scanning Gmail.
  const [importText, setImportText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<any[]>([]);

  // Read selected text files (.txt/.md/.eml) and append their content as samples
  // (separated by blank lines so each file is its own sample). PDFs aren't parsed
  // client-side — we tell the user to paste the text instead.
  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const parts: string[] = [];
    let skippedPdf = false;
    for (const f of Array.from(files)) {
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') { skippedPdf = true; continue; }
      try {
        let text = await f.text();
        // .eml: drop the headers, keep the body (everything after the first blank line).
        if (/\.eml$/i.test(f.name)) { const i = text.indexOf('\n\n'); if (i > -1) text = text.slice(i + 2); }
        if (text.trim().length >= 10) parts.push(text.trim());
      } catch { /* skip unreadable file */ }
    }
    if (parts.length) setImportText((prev) => [prev.trim(), ...parts].filter(Boolean).join('\n\n'));
    if (skippedPdf) toast.error('PDFs can’t be read here yet — paste the text instead.');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  // Structured voice directives (the user's own-words corrections).
  const [directives, setDirectives] = useState<{ id: string; text: string }[]>([]);
  const [allowEmoji, setAllowEmoji] = useState<boolean | undefined>(undefined);
  const [isRefining, setIsRefining] = useState(false);
  // Live before/after: the sample reply just before a refine, shown next to the new one.
  const [beforePreview, setBeforePreview] = useState<string | null>(null);

  // --- Live Preview ---
  const [previewText, setPreviewText] = useState('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const previewDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // --- Active Profile Tab ---
  const [activeTab, setActiveTab] = useState<'work' | 'personal'>('work');

  // --- Saving ---
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Hydrate from existing profile
  useEffect(() => {
    if (profile?.manual_settings) {
      const ms = profile.manual_settings;
      setFormality(ms.tone?.formality ?? 50);
      setDetail(ms.tone?.detail ?? 40);
      setWarmth(ms.tone?.warmth ?? 50);
      setConfidence(ms.tone?.confidence ?? 30);
      setHabits(ms.habits || []);
      setCustomInstructions(ms.customInstructions || '');
      setDirectives(Array.isArray(ms.directives) ? ms.directives : []);
      setAllowEmoji(typeof ms.allowEmoji === 'boolean' ? ms.allowEmoji : undefined);
      setActiveTab(ms.activeProfile || 'work');
    }
    setSources(Array.isArray(profile?.sources) ? profile.sources : []);
    if (profile?.learning) {
      setAutoImprove(profile.learning.autoImprove ?? true);
    }
    // Set a default preview if none exists
    if (!previewText) {
      setPreviewText(profile?.manual_settings?.tone?.formality > 60
        ? 'Friday is suitable. I will update the calendar invitation accordingly.'
        : 'Friday works for me! I\'ll move it on the calendar.');
    }
  }, [profile]);

  // --- Live Preview Debounce ---
  const fetchPreview = useCallback(async () => {
    setIsLoadingPreview(true);
    try {
      const res = await fetch('/api/user/voice-profile/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manualSettings: {
            tone: { formality, detail, warmth, confidence },
            habits,
            customInstructions,
            directives,        // so the preview reflects "no emojis", "be blunt", etc.
            allowEmoji,
            activeProfile: activeTab,
          }
        })
      });
      const data = await res.json();
      if (data.preview) {
        setPreviewText(data.preview);
      }
    } catch (e) {
      console.warn('Preview fetch failed:', e);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [formality, detail, warmth, confidence, habits, customInstructions, directives, allowEmoji, activeTab]);

  // Trigger preview on settings change (debounced)
  useEffect(() => {
    if (!isOpen) return;
    setHasUnsavedChanges(true);
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(() => {
      fetchPreview();
    }, 1200);
    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
  }, [formality, detail, warmth, confidence, habits, customInstructions, activeTab, isOpen]);

  // --- Save Profile ---
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/user/voice-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tone: { formality, detail, warmth, confidence },
          habits,
          customInstructions,
          learning: { autoImprove },
          activeProfile: activeTab,
        })
      });
      const data = await res.json();
      if (res.ok && data.profile) {
        onProfileUpdated?.(data.profile);
        setHasUnsavedChanges(false);
        toast.success('Voice profile saved');
      } else {
        toast.error(data.error || 'Failed to save profile');
      }
    } catch (e) {
      toast.error('Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  // --- Reset to Defaults ---
  const handleReset = () => {
    setFormality(50);
    setDetail(40);
    setWarmth(50);
    setConfidence(30);
    setHabits([]);
    setCustomInstructions('');
    setAutoImprove(true);
    setHasUnsavedChanges(true);
  };

  // --- Run Email Analysis ---
  const handleRunAnalysis = async () => {
    setIsRunningAnalysis(true);
    try {
      const res = await fetch('/api/user/voice-profile', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.profile) {
        onProfileUpdated?.(data.profile);
        toast.success('Email analysis complete! Profile updated.');
        // Re-hydrate from analyzed profile
        if (data.profile.manual_settings) {
          const ms = data.profile.manual_settings;
          setFormality(ms.tone?.formality ?? formality);
          setDetail(ms.tone?.detail ?? detail);
          setWarmth(ms.tone?.warmth ?? warmth);
          setConfidence(ms.tone?.confidence ?? confidence);
          if (ms.habits?.length) setHabits(ms.habits);
          if (ms.customInstructions) setCustomInstructions(ms.customInstructions);
        }
      } else {
        toast.error(data.error || 'Analysis failed');
      }
    } catch (e) {
      toast.error('Failed to run analysis');
    } finally {
      setIsRunningAnalysis(false);
    }
  };

  // --- Import pasted writing samples ---
  const rehydrateFromProfile = (profile: any) => {
    const ms = profile?.manual_settings;
    if (!ms) return;
    setFormality(ms.tone?.formality ?? formality);
    setDetail(ms.tone?.detail ?? detail);
    setWarmth(ms.tone?.warmth ?? warmth);
    setConfidence(ms.tone?.confidence ?? confidence);
    if (ms.habits?.length) setHabits(ms.habits);
    if (ms.customInstructions) setCustomInstructions(ms.customInstructions);
  };

  const handleImport = async () => {
    if (importText.trim().length < 20) {
      toast.error('Paste a bit more of your writing first.');
      return;
    }
    setIsImporting(true);
    try {
      const res = await fetch('/api/user/voice-profile/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: importText }),
      });
      const data = await res.json();
      if (res.ok && data.profile) {
        onProfileUpdated?.(data.profile);
        rehydrateFromProfile(data.profile);
        setSources(Array.isArray(data.profile.sources) ? data.profile.sources : []);
        setImportText('');
        toast.success(`Learned your voice from ${data.samplesUsed} sample${data.samplesUsed === 1 ? '' : 's'}.`);
      } else {
        toast.error(data.error || 'Import failed');
      }
    } catch {
      toast.error('Failed to import samples');
    } finally {
      setIsImporting(false);
    }
  };

  // --- Refine voice via conversational feedback (distilled into directives) ---
  const handleRefine = async () => {
    const instruction = customInstructions.trim();
    if (instruction.length < 4) {
      toast.error('Tell Boult what to change first.');
      return;
    }
    setIsRefining(true);
    // Snapshot the current sample as the "before" so the user sees what changed.
    setBeforePreview(previewText);
    try {
      const res = await fetch('/api/user/voice-profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDirectives(data.directives || []);
        setCustomInstructions('');
        // Move the structured sliders + emoji policy to match the instruction; the
        // preview effect regenerates the sample (the "after") from these.
        const ms = data.profile?.manual_settings;
        if (ms?.tone) {
          setFormality(ms.tone.formality ?? formality);
          setDetail(ms.tone.detail ?? detail);
          setWarmth(ms.tone.warmth ?? warmth);
          setConfidence(ms.tone.confidence ?? confidence);
        }
        if (typeof ms?.allowEmoji === 'boolean') setAllowEmoji(ms.allowEmoji);
        if (data.profile) onProfileUpdated?.(data.profile);
        const attrCount = data.attributes ? Object.keys(data.attributes).length : 0;
        toast.success(
          attrCount > 0 ? 'Applied — watch the sample update below' : 'Got it — applied to your voice',
        );
      } else {
        setBeforePreview(null);
        toast.error(data.error || 'Could not apply that');
      }
    } catch {
      setBeforePreview(null);
      toast.error('Could not apply that');
    } finally {
      setIsRefining(false);
    }
  };

  const handleRemoveDirective = async (id: string) => {
    const prev = directives;
    setDirectives((d) => d.filter((x) => x.id !== id)); // optimistic
    try {
      const res = await fetch('/api/user/voice-profile', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directiveId: id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDirectives(data.directives || []);
        if (data.profile) onProfileUpdated?.(data.profile);
      } else {
        setDirectives(prev); // rollback
        toast.error('Could not remove that rule');
      }
    } catch {
      setDirectives(prev);
      toast.error('Could not remove that rule');
    }
  };

  // --- Add Habit ---
  const addHabit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed && !habits.includes(trimmed)) {
      setHabits(prev => [...prev, trimmed]);
      setNewHabitInput('');
      setShowHabitInput(false);
    }
  };

  const removeHabit = (habit: string) => {
    setHabits(prev => prev.filter(h => h !== habit));
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/70 backdrop-blur-md"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 30 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="relative w-full max-w-2xl max-h-[85vh] bg-white dark:bg-[#0f0f0f] border border-black/[0.05] dark:border-white/[0.08] rounded-[28px] flex flex-col shadow-[0_40px_120px_rgba(0,0,0,0.15)] dark:shadow-[0_40px_120px_rgba(0,0,0,0.8)] font-sans text-black dark:text-white"
        >
          {/* === HEADER === */}
          <div className="px-8 pt-7 pb-3 flex items-start justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <h2 className="text-[20px] font-semibold tracking-tight text-black/80 dark:text-white/80">Voice Profile</h2>
                {(profile?.status && profile.status !== 'default') && (
                  <div className="flex items-center gap-1.5 px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] text-emerald-400 uppercase font-bold tracking-[0.15em]">active</span>
                  </div>
                )}
              </div>
              <p className="text-[13px] text-black/40 dark:text-white/35 font-light">
                Maily uses this to draft replies that sound like you.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors border border-black/5 dark:border-white/5 mt-1"
            >
              <X className="w-4 h-4 text-black/50 dark:text-white/50" />
            </button>
          </div>

          {/* === PROFILE TABS === */}
          <div className="px-8 pb-4 flex gap-2">
            {(['work', 'personal'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-1.5 rounded-full text-[12px] font-semibold tracking-wide transition-all border ${
                  activeTab === tab
                    ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white border-black/15 dark:border-white/15'
                    : 'bg-transparent text-black/40 dark:text-white/30 border-black/[0.06] dark:border-white/[0.06] hover:text-black/60 dark:hover:text-white/50 hover:border-black/10 dark:hover:border-white/10'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* === SCROLLABLE BODY === */}
          <div className="flex-1 px-8 pb-6 space-y-6 overflow-y-auto custom-scrollbar min-h-0">
            
            {/* ── TONE SECTION ── */}
            <div className="bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-6 space-y-5">
              <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-black/30 dark:text-white/25">Tone</h3>
              <ToneSlider label="Casual" labelRight="Formal" value={formality} onChange={setFormality} />
              <ToneSlider label="Brief" labelRight="Detailed" value={detail} onChange={setDetail} />
              <ToneSlider label="Warm" labelRight="Direct" value={warmth} onChange={setWarmth} />
              <ToneSlider label="Reserved" labelRight="Confident" value={confidence} onChange={setConfidence} />
            </div>

            {/* ── HABITS & PREFERENCES ── */}
            <div className="bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-6 space-y-4">
              <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-black/30 dark:text-white/25">Habits & Preferences</h3>
              <div className="flex flex-wrap gap-2">
                {habits.map((habit) => (
                  <span
                    key={habit}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] rounded-full text-[12px] text-black/80 dark:text-white/70 font-medium group hover:border-red-500/30 transition-colors"
                  >
                    {habit}
                    <button
                      onClick={() => removeHabit(habit)}
                      className="text-black/30 dark:text-white/20 hover:text-red-500 dark:hover:text-red-400 transition-colors ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}

                {/* Suggestion chips (not yet added) */}
                {DEFAULT_HABITS.filter(h => !habits.includes(h)).slice(0, 3).map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => addHabit(suggestion)}
                    className="px-3.5 py-1.5 bg-transparent border border-dashed border-black/[0.1] dark:border-white/[0.08] rounded-full text-[12px] text-black/40 dark:text-white/25 font-medium hover:text-black/70 dark:hover:text-white/50 hover:border-black/20 dark:hover:border-white/15 transition-all"
                  >
                    {suggestion}
                  </button>
                ))}

                {/* Add custom habit */}
                {showHabitInput ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={newHabitInput}
                      onChange={(e) => setNewHabitInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addHabit(newHabitInput);
                        if (e.key === 'Escape') { setShowHabitInput(false); setNewHabitInput(''); }
                      }}
                      placeholder="Type a habit..."
                      className="px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.1] dark:border-white/[0.1] rounded-full text-[12px] text-black/70 dark:text-white/70 font-medium focus:outline-none focus:border-black/20 dark:focus:border-white/20 w-40"
                    />
                    <button
                      onClick={() => addHabit(newHabitInput)}
                      className="text-black/40 dark:text-white/30 hover:text-black/70 dark:hover:text-white/60 text-sm"
                    >
                      ✓
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowHabitInput(true)}
                    className="inline-flex items-center gap-1 px-3.5 py-1.5 bg-transparent border border-dashed border-black/[0.15] dark:border-white/[0.1] rounded-full text-[12px] text-black/40 dark:text-white/25 font-medium hover:text-black/70 dark:hover:text-white/50 hover:border-black/20 dark:hover:border-white/15 transition-all"
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                )}
              </div>
            </div>

            {/* ── PROMPT-EDIT YOUR VOICE ── */}
            <div className="bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-6 space-y-3">
              <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-black/30 dark:text-white/25">Tell Boult how to sound like you</h3>
              <p className="text-[12px] text-black/40 dark:text-white/30 font-light">
                Say what&apos;s off, in plain words. Boult turns it into rules it follows on every draft.
              </p>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleRefine(); }}
                placeholder="E.g., This doesn't sound like me. I never use emojis, and it's too robotic — keep it warm and to the point."
                className="w-full bg-transparent dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-5 py-4 text-[14px] text-black/80 dark:text-white/80 font-light leading-relaxed focus:outline-none focus:border-black/15 dark:focus:border-white/15 resize-none placeholder:text-black/30 dark:placeholder:text-white/20 transition-colors"
                rows={3}
              />
              <div className="flex justify-end">
                <button
                  onClick={handleRefine}
                  disabled={isRefining || customInstructions.trim().length < 4}
                  className="flex items-center gap-2 px-5 py-2.5 bg-black text-white dark:bg-white dark:text-black rounded-xl text-[13px] font-semibold hover:opacity-90 transition-all disabled:opacity-40"
                >
                  {isRefining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Apply'}
                </button>
              </div>

              {directives.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
                  <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-black/25 dark:text-white/20">Your voice rules</p>
                  <div className="flex flex-wrap gap-2">
                    {directives.map((d) => (
                      <span
                        key={d.id}
                        className="group inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.07] border border-black/[0.06] dark:border-white/[0.08] text-[12.5px] text-black/75 dark:text-white/75"
                      >
                        {d.text}
                        <button
                          onClick={() => handleRemoveDirective(d.id)}
                          title="Remove rule"
                          className="w-4 h-4 rounded-full flex items-center justify-center text-black/30 dark:text-white/30 hover:text-black/70 dark:hover:text-white/70 hover:bg-black/[0.08] dark:hover:bg-white/[0.1] transition-colors"
                        >
                          <X className="w-3 h-3" strokeWidth={2.5} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── LEARNING ── */}
            <div className="bg-emerald-500/[0.04] border border-emerald-500/[0.1] rounded-2xl p-6 space-y-5">
              <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-emerald-600 dark:text-emerald-400/60">Learning</h3>
              
              {/* Auto-improve toggle */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[14px] font-semibold text-black/80 dark:text-white/80">Auto-improve from sent mail</p>
                  <p className="text-[12px] text-black/40 dark:text-white/30 font-light mt-0.5">
                    Maily reads your edits to AI drafts and refines this profile
                  </p>
                </div>
                <button
                  onClick={() => setAutoImprove(!autoImprove)}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-300 ${
                    autoImprove ? 'bg-emerald-500' : 'bg-black/10 dark:bg-white/10'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-300 ${
                      autoImprove ? 'translate-x-[22px]' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Run analysis */}
              <div className="flex items-center justify-between gap-4 pt-2 border-t border-emerald-500/[0.08]">
                <div>
                  <p className="text-[14px] font-semibold text-black/80 dark:text-white/80">Analyse past 90 days of sent mail</p>
                  <p className="text-[12px] text-black/40 dark:text-white/30 font-light mt-0.5">
                    Bootstrap this profile from your existing writing patterns
                  </p>
                </div>
                <button
                  onClick={handleRunAnalysis}
                  disabled={isRunningAnalysis}
                  className="flex items-center gap-2 px-5 py-2.5 bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.1] dark:border-white/[0.1] rounded-xl text-[13px] font-semibold text-black/60 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-white transition-all disabled:opacity-40"
                >
                  {isRunningAnalysis ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>Run analysis <ExternalLink className="w-3 h-3" /></>
                  )}
                </button>
              </div>

              {/* Manual import — paste your own writing */}
              <div className="pt-3 border-t border-emerald-500/[0.08] space-y-3">
                <div>
                  <p className="text-[14px] font-semibold text-black/80 dark:text-white/80">Or paste your own writing</p>
                  <p className="text-[12px] text-black/40 dark:text-white/30 font-light mt-0.5">
                    Drop in a few emails, messages, or anything you&apos;ve written. Separate samples with a blank line.
                  </p>
                </div>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={"Paste a few things you've written here…\n\n(blank line between separate samples)"}
                  className="w-full bg-transparent dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-5 py-4 text-[14px] text-black/80 dark:text-white/80 font-light leading-relaxed focus:outline-none focus:border-black/15 dark:focus:border-white/15 resize-none placeholder:text-black/30 dark:placeholder:text-white/20 transition-colors"
                  rows={4}
                />
                <div className="flex items-center justify-between gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.eml,text/plain,text/markdown,message/rfc822"
                    multiple
                    onChange={(e) => handleFiles(e.target.files)}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-black/[0.1] dark:border-white/[0.1] text-[13px] font-semibold text-black/60 dark:text-white/60 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" /> Upload file (.txt, .md, .eml)
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={isImporting || importText.trim().length < 20}
                    className="flex items-center gap-2 px-5 py-2.5 bg-black text-white dark:bg-white dark:text-black rounded-xl text-[13px] font-semibold hover:opacity-90 transition-all disabled:opacity-40"
                  >
                    {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Learn from this'}
                  </button>
                </div>
              </div>

              {/* Sources the profile is learning from */}
              {sources.length > 0 && (
                <div className="pt-3 border-t border-emerald-500/[0.08] space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-black/25 dark:text-white/20">Learning from</p>
                  <div className="space-y-1.5">
                    {sources.slice().reverse().map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12.5px] text-black/55 dark:text-white/55">
                        {s.type === 'manual_import' ? <FileText className="w-3.5 h-3.5 text-black/35 dark:text-white/30 flex-shrink-0" /> : <Mic className="w-3.5 h-3.5 text-black/35 dark:text-white/30 flex-shrink-0" />}
                        <span>{s.type === 'manual_import' ? `Imported ${s.count} sample${s.count === 1 ? '' : 's'}` : 'Gmail scan'}</span>
                        {s.added_at && <span className="text-black/30 dark:text-white/20 ml-auto">{new Date(s.added_at).toLocaleDateString()}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── LIVE PREVIEW ── */}
            <div className="bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-black/30 dark:text-white/25">Live Preview</h3>
              </div>
              <p className="text-[12px] text-black/40 dark:text-white/25 font-light">
                Sample reply to: <span className="italic text-black/50 dark:text-white/40">&ldquo;Can we reschedule Thursday&apos;s call to Friday?&rdquo;</span>
              </p>
              {/* Before (snapshot from just before the last refine) */}
              {beforePreview && (
                <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.05] px-5 py-3 mb-2 opacity-70">
                  <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-black/30 dark:text-white/20 mb-1">Before</p>
                  <p className="text-[13px] text-black/45 dark:text-white/35 font-light leading-relaxed line-through decoration-black/20 dark:decoration-white/20">
                    {beforePreview}
                  </p>
                </div>
              )}
              <div className="bg-transparent dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.04] rounded-xl px-5 py-4 min-h-[48px] relative">
                {beforePreview && (
                  <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-emerald-600 dark:text-emerald-400/60 mb-1">Now</p>
                )}
                {isLoadingPreview ? (
                  <div className="flex items-center gap-2 text-black/40 dark:text-white/20 text-[13px]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {beforePreview ? 'Rewriting in your new voice…' : 'Generating preview...'}
                  </div>
                ) : (
                  <p className="text-[14px] text-black/70 dark:text-white/70 font-light leading-relaxed">
                    {previewText || 'Adjust sliders above to see your profile in action'}
                  </p>
                )}
              </div>
              <p className="text-[11px] text-black/30 dark:text-white/15 font-light">
                {beforePreview ? 'This is how I’ll sound now. Refine again to keep tuning.' : 'Adjust sliders above to see your profile in action'}
              </p>
            </div>
          </div>

          {/* === FOOTER === */}
          <div className="px-8 py-5 border-t border-black/[0.06] dark:border-white/[0.04] flex items-center justify-between">
            <button
              onClick={handleReset}
              className="text-[13px] text-black/40 dark:text-white/25 hover:text-black/70 dark:hover:text-white/50 font-medium transition-colors"
            >
              Reset to Defaults
            </button>
            <div className="flex items-center gap-3">
              {hasUnsavedChanges && (
                <span className="text-[11px] text-amber-400/60 font-medium">Unsaved changes</span>
              )}
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2.5 !bg-zinc-900 dark:!bg-white !text-white dark:!text-black rounded-xl text-[13px] font-bold hover:!bg-zinc-800 dark:hover:!bg-zinc-200 transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Save Profile
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

// ─── Tone Slider Sub-Component ───────────────────────────────────────────────
function ToneSlider({ label, labelRight, value, onChange }: {
  label: string;
  labelRight: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-[13px] text-black/40 dark:text-white/40 font-medium w-20 text-right shrink-0">{label}</span>
      <div className="flex-1 relative group">
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="voice-slider w-full"
        />
      </div>
      <span className="text-[13px] text-black/40 dark:text-white/40 font-medium w-20 shrink-0">{labelRight}</span>
      <style dangerouslySetInnerHTML={{ __html: `
        .voice-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: rgba(0,0,0,0.1);
          outline: none;
          cursor: pointer;
        }
        :global(.dark) .voice-slider, .dark .voice-slider {
          background: rgba(255,255,255,0.12);
        }
        .voice-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #7db4f5;
          border: 2px solid #ffffff;
          box-shadow: 0 0 0 2px rgba(125,180,245,0.15), 0 2px 8px rgba(0,0,0,0.15);
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        :global(.dark) .voice-slider::-webkit-slider-thumb, .dark .voice-slider::-webkit-slider-thumb {
          border: 2px solid #0f0f0f;
          box-shadow: 0 0 0 2px rgba(125,180,245,0.15), 0 2px 8px rgba(0,0,0,0.4);
        }
        .voice-slider::-webkit-slider-thumb:hover {
          transform: scale(1.2);
          box-shadow: 0 0 0 4px rgba(125,180,245,0.2), 0 2px 12px rgba(0,0,0,0.5);
        }
        .voice-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #7db4f5;
          border: 2px solid #ffffff;
          box-shadow: 0 0 0 2px rgba(125,180,245,0.15), 0 2px 8px rgba(0,0,0,0.15);
          cursor: pointer;
        }
        :global(.dark) .voice-slider::-moz-range-thumb, .dark .voice-slider::-moz-range-thumb {
          border: 2px solid #0f0f0f;
          box-shadow: 0 0 0 2px rgba(125,180,245,0.15), 0 2px 8px rgba(0,0,0,0.4);
        }
        .voice-slider::-moz-range-track {
          height: 4px;
          border-radius: 2px;
          background: rgba(0,0,0,0.1);
        }
        :global(.dark) .voice-slider::-moz-range-track, .dark .voice-slider::-moz-range-track {
          background: rgba(255,255,255,0.12);
        }
      ` }} />
    </div>
  );
}
