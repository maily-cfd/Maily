'use client';

/**
 * MorningBriefing — Premium daily summary card for Boult
 * Shows overnight email activity, meetings, and actionable items
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sun,
  Moon,
  Mail,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Archive,
  Clock,
  ArrowRight,
  Sparkles,
  TrendingUp,
  Users,
  FileText,
  DollarSign,
  ChevronRight,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface BriefingCategory {
  id: string;
  label: string;
  count: number;
  icon: React.ComponentType<any>;
  color: string;
  bgColor: string;
  borderColor: string;
}

interface MeetingItem {
  id: string;
  title: string;
  time: string;
  attendees: string[];
  type: 'discovery' | 'check-in' | 'demo' | 'internal' | 'other';
}

interface ActionItem {
  id: string;
  subject: string;
  from: string;
  urgency: 'high' | 'medium' | 'low';
  type: 'reply' | 'review' | 'approve' | 'follow-up';
  snippet: string;
}

interface MorningBriefingProps {
  userName?: string;
  emailStats?: {
    total: number;
    drafted: number;
    archived: number;
    flagged: number;
  };
  categories?: BriefingCategory[];
  meetings?: MeetingItem[];
  actionItems?: ActionItem[];
  isLoading?: boolean;
  onTriageInbox?: () => void;
  onDraftReplies?: () => void;
  onViewMeetings?: () => void;
  onViewAction?: (id: string) => void;
  onRefresh?: () => void;
  onQuickAction?: (action: string) => void;
}

// ============================================================================
// HELPERS
// ============================================================================

function getGreeting(): { text: string; icon: React.ComponentType<any> } {
  const hour = new Date().getHours();
  if (hour < 12) return { text: 'Good morning', icon: Sun };
  if (hour < 17) return { text: 'Good afternoon', icon: Sun };
  return { text: 'Good evening', icon: Moon };
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  delay = 0
}: {
  icon: React.ComponentType<any>;
  label: string;
  value: number;
  color: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-1.5 p-4 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.06] hover:border-black/[0.12] dark:hover:border-white/[0.12] transition-all group cursor-default"
    >
      <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center border", color)}>
        <Icon className="w-4 h-4" />
      </div>
      <span className="text-2xl font-bold text-black dark:text-white tracking-tight mt-1">{value}</span>
      <span className="text-[11px] text-black/40 dark:text-white/40 font-medium uppercase tracking-wider">{label}</span>
    </motion.div>
  );
}

function CategoryPill({
  category,
  delay = 0,
  onClick
}: {
  category: BriefingCategory;
  delay?: number;
  onClick?: () => void;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all group/cat",
        "hover:scale-[1.02] active:scale-[0.98]",
        category.bgColor,
        category.borderColor
      )}
    >
      <category.icon className={cn("w-4 h-4", category.color)} />
      <span className="text-[13px] font-medium text-black/80 dark:text-white/80">{category.label}</span>
      <span className={cn(
        "ml-auto text-[13px] font-bold tabular-nums",
        category.color
      )}>
        {category.count}
      </span>
    </motion.button>
  );
}

function MeetingCard({ meeting, delay = 0 }: { meeting: MeetingItem; delay?: number }) {
  const typeColors: Record<string, string> = {
    discovery: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
    'check-in': 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
    demo: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
    internal: 'bg-black/5 text-black/50 border-black/10 dark:bg-white/5 dark:text-white/50 dark:border-white/10',
    other: 'bg-black/5 text-black/50 border-black/10 dark:bg-white/5 dark:text-white/50 dark:border-white/10',
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="flex items-center gap-4 p-3.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.06] hover:border-black/[0.12] dark:hover:border-white/[0.12] transition-all group cursor-default"
    >
      <div className="flex flex-col items-center gap-0.5 min-w-[48px]">
        <span className="text-[13px] font-bold text-black/90 dark:text-white/90">{meeting.time}</span>
      </div>
      <div className="w-[1px] h-8 bg-black/[0.08] dark:bg-white/[0.08]" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-black/90 dark:text-white/90 truncate">{meeting.title}</p>
        <p className="text-[11px] text-black/40 dark:text-white/40 truncate">
          {meeting.attendees.join(', ')}
        </p>
      </div>
      <span className={cn(
        "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full border",
        typeColors[meeting.type] || typeColors.other
      )}>
        {meeting.type}
      </span>
    </motion.div>
  );
}

function ActionCard({
  item,
  delay = 0,
  onView
}: {
  item: ActionItem;
  delay?: number;
  onView?: () => void;
}) {
  const urgencyConfig = {
    high: { dot: 'bg-red-500 dark:bg-red-400', text: 'text-red-600 dark:text-red-400', label: 'Urgent' },
    medium: { dot: 'bg-amber-500 dark:bg-amber-400', text: 'text-amber-600 dark:text-amber-400', label: 'Medium' },
    low: { dot: 'bg-black/30 dark:bg-white/30', text: 'text-black/30 dark:text-white/30', label: 'Low' },
  };

  const config = urgencyConfig[item.urgency];

  return (
    <motion.button
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3 }}
      onClick={onView}
      className="w-full flex items-start gap-3 p-3.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.06] hover:border-black/[0.12] dark:hover:border-white/[0.12] transition-all text-left group"
    >
      <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", config.dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-[13px] font-medium text-black/90 dark:text-white/90 truncate">{item.subject}</p>
          <span className={cn("text-[9px] font-bold uppercase tracking-wider", config.text)}>
            {config.label}
          </span>
        </div>
        <p className="text-[11px] text-black/40 dark:text-white/40 truncate">From {item.from}</p>
        <p className="text-[12px] text-black/30 dark:text-white/30 truncate mt-0.5">{item.snippet}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-black/10 dark:text-white/10 group-hover:text-black/30 dark:group-hover:text-white/30 transition-colors mt-1 flex-shrink-0" />
    </motion.button>
  );
}

// ============================================================================
// MAIN COMPONENT
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

export function MorningBriefing({
  userName,
  emailStats,
  categories,
  meetings,
  actionItems,
  isLoading = false,
  onTriageInbox,
  onDraftReplies,
  onViewMeetings,
  onViewAction,
  onRefresh,
  onQuickAction
}: MorningBriefingProps) {
  const { text: greeting, icon: GreetingIcon } = getGreeting();
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  // Default mock data if none provided
  const stats = emailStats || { total: 0, drafted: 0, archived: 0, flagged: 0 };

  const defaultCategories: BriefingCategory[] = categories || [
    { id: 'urgent', label: 'Urgent Client', count: 0, icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/5', borderColor: 'border-red-500/15' },
    { id: 'follow-up', label: 'Follow-up Needed', count: 0, icon: Clock, color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/5', borderColor: 'border-amber-500/15' },
    { id: 'meeting', label: 'Meeting Request', count: 0, icon: Calendar, color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500/5', borderColor: 'border-blue-500/15' },
    { id: 'payment', label: 'Payment / Invoice', count: 0, icon: DollarSign, color: 'text-green-700 dark:text-green-400', bgColor: 'bg-green-500/5', borderColor: 'border-green-500/15' },
    { id: 'noise', label: 'Archived / Noise', count: 0, icon: Archive, color: 'text-black/30 dark:text-white/30', bgColor: 'bg-black/[0.02] dark:bg-white/[0.02]', borderColor: 'border-black/[0.05] dark:border-white/[0.05]' },
  ];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    onRefresh?.();
    setTimeout(() => setIsRefreshing(false), 2000);
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Greeting Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="mb-10"
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-black/[0.06] to-black/[0.01] dark:from-white/10 dark:to-white/[0.02] border border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center">
            <GreetingIcon className="w-5 h-5 text-black/60 dark:text-white/60" />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-medium text-black dark:text-white tracking-tighter" style={{ fontFamily: "'Montserrat', sans-serif" }}>
              {greetingText || `${greeting}${userName ? `, ${userName.trim()}` : ''}`}
            </h1>
          </div>
        </div>
        <p className="text-[15px] text-black/40 dark:text-white/40 leading-relaxed max-w-xl">
          {stats.total > 0
            ? `${stats.total} emails arrived. ${stats.drafted} replies drafted. ${stats.archived} archived. ${stats.flagged > 0 ? `${stats.flagged} need your attention.` : 'Your inbox is clear.'}`
            : 'Your inbox intelligence is ready. Ask Boult to triage, draft, or schedule anything.'}
        </p>
      </motion.div>

      {/* Quick Stats Row */}
      {stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatCard icon={Mail} label="Arrived" value={stats.total} color="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" delay={0.1} />
          <StatCard icon={FileText} label="Drafted" value={stats.drafted} color="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20" delay={0.15} />
          <StatCard icon={Archive} label="Archived" value={stats.archived} color="bg-black/5 text-black/40 border-black/10 dark:bg-white/5 dark:text-white/40 dark:border-white/10" delay={0.2} />
          <StatCard icon={AlertTriangle} label="Flagged" value={stats.flagged} color="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" delay={0.25} />
        </div>
      )}

      {/* Triage Categories */}
      {defaultCategories.some(c => c.count > 0) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-bold text-black/30 dark:text-white/30 uppercase tracking-wider">Inbox Triage</h3>
            <button
              onClick={handleRefresh}
              className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-all"
            >
              <RefreshCw className={cn("w-3.5 h-3.5 text-black/20 dark:text-white/20", isRefreshing && "animate-spin")} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {defaultCategories.filter(c => c.count > 0).map((cat, i) => (
              <CategoryPill key={cat.id} category={cat} delay={0.35 + i * 0.05} />
            ))}
          </div>
        </motion.div>
      )}

      {/* Meetings Today */}
      {meetings && meetings.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-bold text-black/30 dark:text-white/30 uppercase tracking-wider">Today's Meetings</h3>
            <button
              onClick={onViewMeetings}
              className="text-[11px] text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60 transition-colors font-medium flex items-center gap-1"
            >
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2">
            {meetings.slice(0, 3).map((meeting, i) => (
              <MeetingCard key={meeting.id} meeting={meeting} delay={0.45 + i * 0.05} />
            ))}
          </div>
        </motion.div>
      )}

      {/* Action Items */}
      {actionItems && actionItems.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-bold text-black/30 dark:text-white/30 uppercase tracking-wider">Needs Your Decision</h3>
          </div>
          <div className="space-y-2">
            {actionItems.slice(0, 4).map((item, i) => (
              <ActionCard
                key={item.id}
                item={item}
                delay={0.55 + i * 0.05}
                onView={() => onViewAction?.(item.id)}
              />
            ))}
          </div>
        </motion.div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <motion.div
              key={i}
              className="h-16 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] relative overflow-hidden"
              animate={{ opacity: [0.3, 0.5, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.2 }}
            >
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.03] to-transparent w-[200%]"
                animate={{ x: ['-100%', '100%'] }}
                transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MorningBriefing;
