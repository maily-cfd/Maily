'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, AlertCircle, Clock, Zap, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TriageItem {
  id: string;
  from: string;
  to?: string;
  subject: string;
  snippet?: string;
  urgencyScore?: number;
  daysWaiting?: number;
  ruleName?: string;
}

interface TriageResult {
  urgent: TriageItem[];
  followups: TriageItem[];
  delegationMatches: TriageItem[];
  summary: string;
}

interface Props {
  onPrompt?: (prompt: string) => void;
  enabled?: boolean;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FOCUSED_CHECK_INTERVAL_MS = 30 * 1000; // check focus every 30s

export function ProactiveNudge({ onPrompt, enabled = true }: Props) {
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTriage = useCallback(async () => {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastFetchRef.current < POLL_INTERVAL_MS) return;
    lastFetchRef.current = now;

    setLoading(true);
    try {
      const res = await fetch('/api/boult/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: '6h' }),
      });
      if (!res.ok) return;
      const data: TriageResult = await res.json();
      const hasItems = data.urgent.length > 0 || data.followups.length > 0 || data.delegationMatches.length > 0;
      if (hasItems) {
        setTriage(data);
        setDismissed(false);
      }
    } catch { /* silently fail */ } finally {
      setLoading(false);
    }
  }, [enabled]);

  // Poll when window gains focus (Superhuman-style proactive check)
  useEffect(() => {
    if (!enabled) return;

    const onFocus = () => {
      // Only re-fetch if enough time has passed
      if (Date.now() - lastFetchRef.current >= POLL_INTERVAL_MS) {
        fetchTriage();
      }
    };

    window.addEventListener('focus', onFocus);
    // Initial fetch on mount
    fetchTriage();

    // Periodic background poll
    const interval = setInterval(fetchTriage, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [enabled, fetchTriage]);

  const handleItem = (prompt: string) => {
    onPrompt?.(prompt);
    setDismissed(true);
  };

  const totalItems = (triage?.urgent.length ?? 0) + (triage?.followups.length ?? 0) + (triage?.delegationMatches.length ?? 0);

  if (dismissed || !triage || totalItems === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="proactive-nudge"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full mb-3"
      >
        <div className="relative bg-gradient-to-br from-amber-500/[0.07] via-white/80 to-white/80 dark:from-amber-500/8 dark:via-neutral-900/60 dark:to-neutral-900/60 border border-amber-500/25 dark:border-amber-500/20 rounded-2xl overflow-hidden backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center">
                <Bell className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              </div>
              <span className="text-[12px] font-semibold text-amber-700 dark:text-amber-300/90 tracking-tight">
                Boult spotted {totalItems} item{totalItems !== 1 ? 's' : ''} for you
              </span>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="text-black/25 dark:text-white/25 hover:text-black/60 dark:hover:text-white/60 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="px-4 pb-3 space-y-1.5">
            {/* Urgent emails */}
            {triage.urgent.slice(0, 2).map((item) => (
              <NudgeItem
                key={item.id}
                icon={<AlertCircle className="w-3 h-3 text-red-600 dark:text-red-400" />}
                label="Urgent"
                labelColor="text-red-600 dark:text-red-400"
                subject={item.subject}
                meta={item.from?.split('<')[0]?.trim() || item.from}
                onClick={() => handleItem(`Read and help me reply to this urgent email: "${item.subject}"`)}
              />
            ))}

            {/* Follow-ups */}
            {triage.followups.slice(0, 2).map((item, i) => (
              <NudgeItem
                key={`followup-${i}`}
                icon={<Clock className="w-3 h-3 text-blue-600 dark:text-blue-400" />}
                label={`${item.daysWaiting}d`}
                labelColor="text-blue-600 dark:text-blue-400"
                subject={item.subject}
                meta={`Waiting on reply from ${item.to?.split('@')[0] || 'them'}`}
                onClick={() => handleItem(`Follow up on my email "${item.subject}" — draft a polite follow-up`)}
              />
            ))}

            {/* Delegation rule matches */}
            {triage.delegationMatches.slice(0, 1).map((item) => (
              <NudgeItem
                key={item.id}
                icon={<Zap className="w-3 h-3 text-purple-600 dark:text-purple-400" />}
                label={item.ruleName || 'Rule'}
                labelColor="text-purple-600 dark:text-purple-400"
                subject={item.subject}
                meta={item.from?.split('<')[0]?.trim() || item.from}
                onClick={() => handleItem(`Handle this email matching my "${item.ruleName}" rule: "${item.subject}"`)}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function NudgeItem({
  icon, label, labelColor, subject, meta, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  labelColor: string;
  subject: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] hover:bg-black/[0.05] dark:hover:bg-white/[0.07] border border-black/[0.05] dark:border-white/[0.05] hover:border-black/10 dark:hover:border-white/10 transition-all text-left group"
    >
      <div className="flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={cn('text-[10px] font-semibold uppercase tracking-wide', labelColor)}>{label}</span>
          <span className="text-[11px] text-black/70 dark:text-white/70 truncate font-medium">{subject}</span>
        </div>
        <span className="text-[10px] text-black/35 dark:text-white/30 truncate block">{meta}</span>
      </div>
      <ChevronRight className="w-3 h-3 text-black/20 dark:text-white/20 group-hover:text-black/50 dark:group-hover:text-white/50 transition-colors flex-shrink-0" />
    </button>
  );
}
