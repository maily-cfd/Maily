'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Calendar, FileText, Zap, ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConnectedIntegration {
  id: string;
  label: string;
}

interface Props {
  visible: boolean;
  connectedIntegrations: string[];
  onPrompt: (prompt: string) => void;
  userName?: string;
}

interface SuggestedPrompt {
  icon: React.ReactNode;
  label: string;
  prompt: string;
  requires?: string[];
  category: 'email' | 'calendar' | 'notion' | 'general';
}

const ALL_PROMPTS: SuggestedPrompt[] = [
  {
    icon: <Mail className="w-4 h-4" />,
    label: 'Catch me up on emails',
    prompt: 'Give me a morning briefing — summarize what\'s in my inbox, flag anything urgent, and list follow-ups I\'m waiting on.',
    requires: ['gmail'],
    category: 'email',
  },
  {
    icon: <Mail className="w-4 h-4" />,
    label: 'Draft a reply for me',
    prompt: 'Read my most recent unread email and draft a professional reply in my voice.',
    requires: ['gmail'],
    category: 'email',
  },
  {
    icon: <Mail className="w-4 h-4" />,
    label: 'Find follow-ups needed',
    prompt: 'Check my sent emails from the last week and find any that haven\'t gotten a reply — I want to follow up.',
    requires: ['gmail'],
    category: 'email',
  },
  {
    icon: <Calendar className="w-4 h-4" />,
    label: "What's on my calendar?",
    prompt: "Show me today's and tomorrow's calendar events, and flag any conflicts or back-to-back meetings.",
    requires: ['gcal'],
    category: 'calendar',
  },
  {
    icon: <Calendar className="w-4 h-4" />,
    label: 'Schedule a meeting',
    prompt: 'Help me schedule a 30-minute meeting this week. Check my availability first.',
    requires: ['gcal'],
    category: 'calendar',
  },
  {
    icon: <FileText className="w-4 h-4" />,
    label: 'Summarize my Notion notes',
    prompt: 'Search my Notion for anything relevant to my current work and give me a quick summary.',
    requires: ['notion'],
    category: 'notion',
  },
  {
    icon: <Zap className="w-4 h-4" />,
    label: 'What should I focus on?',
    prompt: 'Based on my emails and calendar, what are the 3 most important things I should focus on today?',
    category: 'general',
  },
  {
    icon: <Sparkles className="w-4 h-4" />,
    label: 'Set up a delegation rule',
    prompt: 'Help me create a Boult rule: whenever I get a meeting request email, automatically draft 3 proposed times.',
    category: 'general',
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  email: 'text-blue-400 bg-blue-400/10',
  calendar: 'text-emerald-400 bg-emerald-400/10',
  notion: 'text-purple-400 bg-purple-400/10',
  general: 'text-amber-400 bg-amber-400/10',
};

export function OnboardingFlow({ visible, connectedIntegrations, onPrompt, userName }: Props) {
  const available = ALL_PROMPTS.filter(p => {
    if (!p.requires || p.requires.length === 0) return true;
    return p.requires.some(r => connectedIntegrations.includes(r));
  }).slice(0, 6);

  const firstName = userName?.split(' ')[0] || 'there';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="onboarding"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="w-full max-w-xl mx-auto px-2 py-6"
        >
          {/* Greeting */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-5 h-5 text-white/60" />
            </div>
            <h2 className="text-[18px] font-semibold text-white tracking-tight mb-1">
              Good {getTimeOfDay()}, {firstName}
            </h2>
            <p className="text-[13px] text-white/40">
              {connectedIntegrations.length > 0
                ? `Boult is connected to ${connectedIntegrations.map(humanizeIntegration).join(', ')}. What can I help you with?`
                : 'Connect your tools to get started. Try asking Boult anything.'}
            </p>
          </div>

          {/* Suggested prompts grid */}
          {available.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {available.map((p, i) => (
                <motion.button
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.2 }}
                  onClick={() => onPrompt(p.prompt)}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] transition-all text-left group"
                >
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', CATEGORY_COLORS[p.category])}>
                    {p.icon}
                  </div>
                  <span className="text-[12px] font-medium text-white/70 group-hover:text-white/90 transition-colors flex-1 leading-tight">
                    {p.label}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </motion.button>
              ))}
            </div>
          )}

          {connectedIntegrations.length === 0 && (
            <div className="mt-4 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] text-center">
              <p className="text-[11px] text-white/30">
                Connect Gmail, Google Calendar, or Notion via the connector bar above to unlock full power.
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function humanizeIntegration(id: string): string {
  const map: Record<string, string> = {
    gmail: 'Gmail', gcal: 'Google Calendar', notion: 'Notion',
    slack: 'Slack', linear: 'Linear', hubspot: 'HubSpot',
  };
  return map[id] ?? id;
}
