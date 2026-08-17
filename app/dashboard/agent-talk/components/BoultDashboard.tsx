'use client';

/**
 * BoultDashboard — The Boult Opening Screen
 * Combines MorningBriefing, quick actions, and agents panel toggle
 * This replaces the simple "Ask anything" initial mode
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  FileText,
  PenTool,
  Calendar,
  BarChart3,
  Bot,
  Mail,
  Zap,
  ArrowRight,
  Clock,
  Users,
  ChevronRight,
  MessageCircle,
  X,
  Send,
  Search,
  ShieldCheck,
  Eye,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MorningBriefing } from './MorningBriefing';
import { AgentsPanel } from './AgentsPanel';
import { BoultLogo } from '@/components/ui/boult-logo';

// ============================================================================
// TYPES
// ============================================================================

interface BoultDashboardProps {
  userName?: string;
  onSendMessage: (message: string) => void;
  onSuggestionClick?: (text: string) => void;

  // Morning Briefing data
  emailStats?: {
    total: number;
    drafted: number;
    archived: number;
    flagged: number;
  };
  meetings?: Array<{
    id: string;
    title: string;
    time: string;
    attendees: string[];
    type: 'discovery' | 'check-in' | 'demo' | 'internal' | 'other';
  }>;
  actionItems?: Array<{
    id: string;
    subject: string;
    from: string;
    urgency: 'high' | 'medium' | 'low';
    type: 'reply' | 'review' | 'approve' | 'follow-up';
    snippet: string;
  }>;

  // State
  isLoading?: boolean;

  // Tab Control
  activeTab?: 'home' | 'agents';
  onTabChange?: (tab: 'home' | 'agents') => void;

  // Children - for prompt box
  children?: React.ReactNode;
}

// ============================================================================
// QUICK ACTION CONFIGS
// ============================================================================

const DYNAMIC_GREETINGS = [
  "Back at it!",
  "Ready as you are.",
  "What are we conquering today, {user}?",
  "Let's make some progress.",
  "Welcome back, {user}.",
  "Good to see you, {user}.",
  "Let's clear the queue.",
  "Inbox zen awaits, {user}.",
  "Ready to automate.",
  "Standing by.",
  "Let's crush some tasks, {user}.",
  "At your command.",
  "Let's streamline your day.",
  "Where should we start, {user}?",
  "Your inbox co-pilot is ready.",
  "Let's build something great, {user}.",
  "Ready to run.",
  "Always at your service.",
  "Here we go!",
  "Let's keep the momentum, {user}!"
];

function ConversationalStarter({
  text,
  onClick,
  delay = 0,
}: {
  text: string;
  onClick: () => void;
  delay?: number;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 px-4 py-2.5 rounded-xl",
        "bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05]",
        "hover:border-black/[0.12] dark:hover:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]",
        "transition-all group/starter active:scale-[0.98]",
        "text-left w-full"
      )}
    >
      <MessageCircle className="w-3.5 h-3.5 text-neutral-400 dark:text-white/15 group-hover/starter:text-neutral-700 dark:group-hover/starter:text-white/40 transition-colors flex-shrink-0" />
      <span className="text-[12px] text-neutral-500 dark:text-white/40 group-hover/starter:text-neutral-800 dark:group-hover/starter:text-white/70 transition-colors truncate">
        {text}
      </span>
      <ArrowRight className="w-3 h-3 text-transparent dark:text-white/0 group-hover/starter:text-neutral-400 dark:group-hover/starter:text-white/30 transition-all flex-shrink-0 ml-auto" />
    </motion.button>
  );
}

// ============================================================================
// OUTREACH ANNOUNCEMENT — "New!" pill + live flow-walkthrough card
// ============================================================================
//
// Outreach is a CAPABILITY, not a tab (founder doctrine: no separate feature
// surface). That makes it undiscoverable — this pill is the announcement +
// onboarding. Click → an ANIMATED walkthrough card that auto-plays the outreach
// flow (Intake → Research → Draft → Approve → Send) step by step, then a Start
// button. Start SENDS a short kickoff message; the intent classifier routes it
// to `outreach_kickoff` (tools suppressed) so Boult instantly ASKS for the list
// + pitch in one fast conversational turn — no 40s tool spin, no timeout, and
// nothing sends until the user later approves (the approval law).

// Phrased so classifyUserIntent() → 'outreach_kickoff' (no list present yet).
const OUTREACH_KICKOFF_MESSAGE =
  "I want to run cold outreach. Ask me for the list and the pitch to get started.";

const OUTREACH_PILL_DISMISS_KEY = 'boult_outreach_pill_dismissed_v1';

// The steps the walkthrough animates through. Kept in sync with the outreach
// playbook in system-prompt.ts (intake → research → draft → approve → send).
const OUTREACH_FLOW_STEPS: Array<{ icon: typeof Users; title: string; caption: string }> = [
  { icon: Users, title: 'Intake', caption: 'Reads your list — paste, CSV, or your Notion leads DB.' },
  { icon: Search, title: 'Research', caption: 'Finds a real hook for each person, not a template.' },
  { icon: PenTool, title: 'Draft', caption: 'Writes every email individually, in your voice.' },
  { icon: Eye, title: 'Review', caption: 'Shows samples + a live tracker of the whole batch.' },
  { icon: ShieldCheck, title: 'Approve', caption: 'Nothing sends until you say yes.' },
  { icon: Send, title: 'Send', caption: 'Goes out paced like a human, so you stay trusted.' },
];

function OutreachWalkthroughCard({
  onStart,
  onClose,
}: {
  onStart: () => void;
  onClose: () => void;
}) {
  // Auto-advance the highlighted step; loop so the card feels alive.
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((i) => (i + 1) % OUTREACH_FLOW_STEPS.length), 1400);
    return () => clearInterval(t);
  }, []);

  const progress = ((active + 1) / OUTREACH_FLOW_STEPS.length) * 100;

  return (
    <motion.div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="New: Boult runs your outreach"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-md rounded-3xl overflow-hidden boult-glass-card shadow-2xl"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-black/[0.06] dark:border-white/[0.08]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-black/70 dark:text-white/70 text-[10px] font-semibold uppercase tracking-wider">
                <Sparkles className="w-3 h-3" /> Just shipped
              </span>
              <h2 className="mt-2 text-[18px] font-semibold text-black/90 dark:text-white/90 tracking-tight">
                Boult runs your outreach
              </h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/55 dark:text-white/55">
                Hand it a list and a pitch. It emails everyone, each one personalized, in your voice.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70 hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Animated flow */}
        <div className="px-6 py-5">
          {/* Progress rail */}
          <div className="h-1 w-full rounded-full bg-black/[0.06] dark:bg-white/[0.08] overflow-hidden mb-5">
            <motion.div
              className="h-full rounded-full bg-black dark:bg-white"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>

          {/* Step chips row */}
          <div className="flex items-center gap-1.5 mb-5">
            {OUTREACH_FLOW_STEPS.map((s, i) => {
              const done = i < active;
              const now = i === active;
              const StepIcon = s.icon;
              return (
                <React.Fragment key={s.title}>
                  <motion.div
                    className={cn(
                      'relative flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0 transition-colors',
                      now
                        ? 'bg-black dark:bg-white'
                        : done
                          ? 'bg-emerald-500/12 dark:bg-emerald-400/15'
                          : 'bg-black/[0.04] dark:bg-white/[0.05]',
                    )}
                    animate={now ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {done ? (
                      <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
                    ) : (
                      <StepIcon className={cn('w-4 h-4', now ? 'text-white dark:text-black' : 'text-black/40 dark:text-white/35')} />
                    )}
                  </motion.div>
                  {i < OUTREACH_FLOW_STEPS.length - 1 && (
                    <div className={cn('h-px flex-1 transition-colors', i < active ? 'bg-black/25 dark:bg-white/25' : 'bg-black/[0.08] dark:bg-white/[0.10]')} />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Active step title + caption (crossfades) */}
          <div className="min-h-[52px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <p className="text-[13.5px] font-semibold text-black/85 dark:text-white/85">
                  {active + 1}. {OUTREACH_FLOW_STEPS[active].title}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-black/55 dark:text-white/55">
                  {OUTREACH_FLOW_STEPS[active].caption}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* How to use it later */}
        <div className="px-6 pb-1">
          <div className="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-3.5 py-2.5">
            <p className="text-[11.5px] leading-relaxed text-black/50 dark:text-white/50">
              <span className="font-semibold text-black/70 dark:text-white/70">Anytime after this:</span> just tell
              Boult to "email these people about …" in the chat. No menu, no setup.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-5 flex items-center gap-3">
          <button
            type="button"
            onClick={onStart}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90 font-semibold text-[13px] tracking-wide transition-all active:scale-[0.98]"
          >
            <Send className="w-3.5 h-3.5" /> Start outreach
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-black/50 dark:text-white/50 hover:text-black/80 dark:hover:text-white/80 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            Maybe later
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function OutreachPill({ onStart }: { onStart: (text: string) => void }) {
  const [dismissed, setDismissed] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(OUTREACH_PILL_DISMISS_KEY) === '1') setDismissed(true);
    } catch { /* localStorage blocked — show the pill */ }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(OUTREACH_PILL_DISMISS_KEY, '1'); } catch { /* ignore */ }
  };

  const start = () => {
    setCardOpen(false);
    dismiss(); // they've seen and started it — don't show the pill again
    onStart(OUTREACH_KICKOFF_MESSAGE); // sends the kickoff → Boult asks for list + pitch
  };

  if (dismissed) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="inline-flex items-center gap-1 group/pill"
      >
        <button
          type="button"
          onClick={() => setCardOpen(true)}
          className={cn(
            'inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full boult-glass-pill boult-glass-hover',
            'transition-all active:scale-[0.98]',
          )}
        >
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black text-white dark:bg-white dark:text-black text-[9.5px] font-semibold uppercase tracking-wider">
            <Sparkles className="w-2.5 h-2.5" /> New
          </span>
          <span className="text-[12.5px] font-medium text-black/80 dark:text-white/80">
            Boult can run your cold outreach
          </span>
          <ArrowRight className="w-3 h-3 text-black/35 dark:text-white/35 group-hover/pill:translate-x-0.5 group-hover/pill:text-black/60 dark:group-hover/pill:text-white/60 transition-all" />
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="p-1.5 rounded-full text-black/30 dark:text-white/30 hover:text-black/70 dark:hover:text-white/70 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </motion.div>

      <AnimatePresence>
        {cardOpen && (
          <OutreachWalkthroughCard onStart={start} onClose={() => setCardOpen(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function BoultDashboard({
  userName,
  onSendMessage,
  onSuggestionClick,
  emailStats,
  meetings,
  actionItems,
  isLoading = false,
  activeTab: activeTabProp,
  onTabChange: onTabChangeProp,
  children,
}: BoultDashboardProps) {
  const [localTab, setLocalTab] = useState<'home' | 'agents'>('home');
  const activeTab = activeTabProp !== undefined ? activeTabProp : localTab;
  const setActiveTab = onTabChangeProp !== undefined ? onTabChangeProp : setLocalTab;

  const [greetingText, setGreetingText] = useState('');

  useEffect(() => {
    const randomIndex = Math.floor(Math.random() * DYNAMIC_GREETINGS.length);
    const selectedTemplate = DYNAMIC_GREETINGS[randomIndex];
    let resolvedGreeting = selectedTemplate;
    if (userName) {
      resolvedGreeting = selectedTemplate.replace('{user}', userName.trim());
    } else {
      resolvedGreeting = selectedTemplate.replace(/,?\s*\{user\}/g, '');
    }
    setGreetingText(resolvedGreeting);
  }, [userName]);

  const hasBriefingData = emailStats && emailStats.total > 0;

  const handleQuickAction = (text: string) => {
    if (onSuggestionClick) {
      onSuggestionClick(text);
    } else {
      onSendMessage(text);
    }
  };

  return (
    <div className="flex flex-col items-center w-full min-h-0">
      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'home' ? (
          <motion.div
            key="home"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="w-full max-w-3xl mx-auto"
          >
            {hasBriefingData ? (
              <div className="flex flex-col justify-center min-h-[65vh] py-4">
                <div className="flex-1 flex flex-col justify-center">
                  <MorningBriefing
                    userName={userName}
                    emailStats={emailStats}
                    meetings={meetings}
                    actionItems={actionItems}
                    isLoading={isLoading}
                    onTriageInbox={() => handleQuickAction("Triage my inbox now and categorize all unread emails by urgency")}
                    onDraftReplies={() => handleQuickAction("Draft replies to all emails that need a response")}
                    onViewMeetings={() => handleQuickAction("Show me all my meetings for today with details")}
                    onViewAction={(id) => handleQuickAction(`Show me the email flagged for my attention (ID: ${id})`)}
                    onRefresh={() => handleQuickAction("Refresh my inbox briefing with the latest data")}
                  />
                </div>
                
                {/* Center prompt box */}
                <div className="w-full max-w-2xl mx-auto px-4 mt-8 mb-4">
                  <div className="flex justify-center mb-4">
                    <OutreachPill onStart={onSendMessage} />
                  </div>
                  {children}
                </div>
              </div>
            ) : (
              /* Default greeting when no briefing data - Shifted to upper half, prompt box centered below */
              <div className="flex flex-col justify-center min-h-[65vh] py-4">
                <div className="flex-1 flex flex-col justify-center text-center">
                  <div className="flex justify-center mb-8">
                    <BoultLogo size={64} />
                  </div>
                  <h1
                    className="text-4xl md:text-6xl font-medium text-neutral-900 dark:text-white tracking-tighter mb-4"
                    style={{ fontFamily: "'Montserrat', sans-serif" }}
                  >
                    {greetingText || (userName ? `Hey ${userName.trim()}` : 'Ask anything about your emails')}
                  </h1>
                  <p className="text-[15px] text-neutral-500 dark:text-white/35 max-w-lg mx-auto leading-relaxed">
                    Boult reads your inbox, drafts replies in your tone, books meetings, and manages everything — so you don't have to.
                  </p>
                  <div className="flex justify-center mt-6">
                    <OutreachPill onStart={onSendMessage} />
                  </div>
                </div>

                {/* Center prompt box */}
                <div className="w-full max-w-2xl mx-auto px-4 mt-8 mb-4">
                  {children}
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="agents"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="w-full max-w-3xl mx-auto"
          >
            <AgentsPanel
              onSendMessage={onSendMessage}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default BoultDashboard;
