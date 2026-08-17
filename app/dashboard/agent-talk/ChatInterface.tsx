"use client";

import { Send, Mail, Upload, User, User2, MessageCircle, DoorOpen, Bell, Mail as EmailIcon, MoreHorizontal, LogOut, Settings, ChevronRight, ChevronLeft, ChevronDown, CheckCircle2, Circle, Edit, History, LayoutGrid, Zap, Volume2, Sparkles, FileText, Calendar, BarChart3, PenTool, BrainCircuit, Search, Check, X, PanelLeft, Menu, Compass, Terminal, Share2, Bot, Globe, MessageSquare, Shield } from 'lucide-react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AddSquareIcon, Cancel01Icon, WorkHistoryIcon } from '@hugeicons/core-free-icons';
import { ChatHistoryModal } from './components/ChatHistoryModal';
import { SuggestionChips } from './components/SuggestionChips';
// PART 46 — slash-command registry (for /help generation + handler typing).
import { SLASH_COMMANDS } from '@/lib/boult/skills';
import { humanizeToolName } from '@/lib/boult/tool-labels';
import { ThinkingLayer, ResultCard, type ThinkingStep, type ThinkingBlock, type SearchSession } from './components/ThinkingLayer';
import { ConnectorRequiredPanel, type ConnectorRequiredEntry } from './components/ThinkingLayerV2';
import { AskUserCard, type AskQuestion } from './components/AskUserCard';
import { type AgentStep, type AgentNarrative } from './components/AgentExecutionTimeline';
import { LiveStepTracker } from './components/LiveStepTracker';
import { TaskProgressCard, type TaskList } from './components/TaskProgressCard';
import { DraftReplyBox } from './components/DraftReplyBox';
import { DraftApprovalModal } from './components/DraftApprovalModal';
import { DraftGalleryCard, type DraftGalleryItem } from './components/DraftGalleryCard';
import { ActionResultCard } from './components/ActionResultCard';
import { ScheduledAgentCard, type ScheduledAgentData } from './components/ScheduledAgentCard';
import { IntegrationRequiredCard, type IntegrationRequiredData } from './components/IntegrationRequiredCard';
import { ConfirmationCard, type ConfirmationData } from './components/ConfirmationCard';
import { ChatPlanCard, type PlanCardData } from './components/ChatPlanCard';
import { PlanPreviewCard, type PlanPreviewData } from './components/PlanPreviewCard';
import { SourcesPanel, type SourceItem } from './components/SourcesPanel';
import { CanvasPanel, type CanvasData } from './components/CanvasPanel';
import { ChatSelectionToolbar } from './components/ChatSelectionToolbar';
import { ArtifactsGalleryPanel } from './components/ArtifactsGalleryPanel';
import PlanArtifactCard from './components/PlanArtifactCard';
import { PlanModeBrief } from './components/PlanModeBrief';
import { PlanCanvas } from './components/PlanCanvas';
import { SearchExecutionPanel } from './components/SearchExecutionPanel';
import { ConnectorBar } from './components/ConnectorBar';
import { StatusBar } from './components/StatusBar';
import { BoultDashboard } from './components/BoultDashboard';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PromptInputBox } from '@/components/ui/ai-prompt-box';
import { ConnectorsModal } from '@/components/ui/connectors-modal';
import { EmailSelectionModal } from '@/components/ui/email-selection-modal';
import { BoultSettingsModal } from '@/components/ui/boult-settings-modal';
import { GradientButton } from '@/components/ui/gradient-button';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { RainbowButton } from '@/components/ui/rainbow-button';
import { HomeFeedSidebar } from "@/components/ui/home-feed-sidebar";
import { TextShimmer } from '@/components/ui/text-shimmer';
import WordBlurStream from '../../../src/WordBlurStream';
import { GlassButton, GlassTabContainer } from "@/components/ui/apple-tahoe-liquid-glass-button";
import { BoultLogo } from "@/components/ui/boult-logo";

import { UsageLimitModal } from '@/components/ui/usage-limit-modal';
import { SettingsCard } from '@/components/ui/settings-card';
import { HelpCard } from '@/components/ui/help-card';
import { RewardsCard } from '@/components/ui/rewards-card';
import { ShiningText } from '@/components/ui/shining-text';

import { Button as Button1 } from '@/components/ui/button-1';
import { MorphingSquare } from '@/components/ui/morphing-square';
import { useTheme } from 'next-themes';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { toast } from 'sonner';
import { cn } from "@/lib/utils";
import { audioRuntime } from '@/lib/audio-runtime';
import { NotificationService } from '@/lib/notification-service';
import { GradientWave } from '@/components/ui/gradient-wave';
import { SpiralLoader } from '@/components/ui/spiral-loader';
import { useBoultAgentStream } from './hooks/useBoultAgentStream';
import { useBoultV3Feed } from './hooks/useBoultV3Feed';
import { usePlanModeBrief } from './hooks/usePlanModeBrief';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ShortcutsModal } from './components/ShortcutsModal';
import { ProactiveNudge } from './components/ProactiveNudge';

function capitalizeTitle(str: string): string {
  if (!str) return '';
  return str
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const GRA_DEFORM = { incline: 0.3, noiseAmp: 150, noiseFlow: 2 };

const THINKING_MESSAGES = ["Clarifying Intent", "Reasoning Context", "Architecting Plan", "Executing Tools", "Securing Action", "Delivering Value", "Iterating Results"];

const DEEP_THINKING_MESSAGES = ["Deep Clarification", "Strategic Reasoning", "Workflow Planning", "Complex Execution", "Safety Verification", "Intelligence Synthesis", "Outcome Optimization"];

function RollingThinkingStatus({ onToggle, isOpen, isDeepThinking }: { onToggle: () => void, isOpen: boolean, isDeepThinking?: boolean }) {
  const [index, setIndex] = useState(0);
  const messages = isDeepThinking ? DEEP_THINKING_MESSAGES : THINKING_MESSAGES;

  useEffect(() => {
    const timer = setTimeout(() => {
      setIndex((prev) => (prev + 1) % messages.length);
    }, index === 0 ? (isDeepThinking ? 8000 : 5000) : (isDeepThinking ? 4000 : 2500));
    return () => clearTimeout(timer);
  }, [index, isDeepThinking, messages.length]);

  return (
    <div className="flex items-center gap-2 group/status cursor-pointer select-none py-1.5" onClick={onToggle}>
      <div className="relative">
        <motion.span
          className="text-[14px] font-bold tracking-tight bg-[linear-gradient(110deg,#666,35%,#fff,50%,#666,75%,#666)] bg-[length:250%_100%] bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(255,255,255,0.15)]"
          initial={{ backgroundPosition: "200% 0" }}
          animate={{ backgroundPosition: ["200% 0", "-200% 0"] }}
          transition={{ repeat: Infinity, duration: 2.5, ease: "linear" }}
        >
          {messages[index]}
        </motion.span>
        {/* Subtle Liquid Wave Overlay */}
        <motion.div 
          className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500/10 to-transparent w-[200%] pointer-events-none"
          animate={{ x: ['-100%', '100%'] }}
          transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
        />
      </div>
      <ChevronDown className={cn("w-3.5 h-3.5 text-black/20 dark:text-white/20 transition-all duration-700 group-hover/status:text-white/40", isOpen ? "rotate-180" : "")} />
    </div>
  );
}


// Detect and wrap URLs in plain text with premium styling for actions
const linkify = (text: string, isUser: boolean = false): string => {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s<]+[^.,;?!)\]\s<])/g;

  return text.replace(urlRegex, (url) => {
    const lowerUrl = url.toLowerCase();
    const isAction = lowerUrl.includes('verify') ||
      lowerUrl.includes('confirm') ||
      lowerUrl.includes('activate') ||
      lowerUrl.includes('reset') ||
      lowerUrl.includes('token=') ||
      lowerUrl.includes('password');

    if (isAction && url.length > 50) {
      // Simplified Security Action
      return `<div class="my-4 p-5 bg-white/[0.03] border border-neutral-200 dark:border-white/10 rounded-2xl relative group overflow-hidden">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 bg-black/5 dark:bg-white/5 rounded-xl flex items-center justify-center border border-neutral-200 dark:border-white/10">
            <svg class="w-5 h-5 text-black dark:text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <div class="flex-1 text-left">
            <h4 class="text-black dark:text-white font-bold text-[11px] tracking-tight uppercase">Security required</h4>
            <p class="text-black dark:text-white/30 text-[9px] tracking-tight uppercase">Verify link to proceed</p>
          </div>
          <a href="${url}" target="_blank" rel="noopener noreferrer" class="px-5 py-2 bg-white hover:bg-neutral-200 text-black font-bold text-[10px] tracking-tight uppercase rounded-lg transition-all no-underline">Verify</a>
        </div>
        <div class="mt-4 text-[9px] text-black dark:text-white/10 break-all opacity-40 select-all cursor-text py-2 px-3 bg-black/[0.02] dark:bg-white/[0.02] rounded-lg border border-white/[0.05]">${url}</div>
      </div>`;
    }

    const displayUrl = url.length > 55 ? url.substring(0, 52) + '...' : url;
    const linkColorClass = isUser ? "text-blue-600 hover:text-blue-800" : "text-black dark:text-white/60 hover:text-black dark:text-white";
    const decorationClass = isUser ? "decoration-blue-200 hover:decoration-blue-600" : "decoration-white/20 hover:decoration-white/100";

    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="${linkColorClass} underline underline-offset-4 ${decorationClass} transition-all text-[13px] tracking-tight break-all" title="${url}">${displayUrl}</a>`;
  });
};

const MarkdownComponents: any = {
  h1: ({ children }: any) => <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-4 mt-6 first:mt-0 tracking-tight border-b border-black/10 dark:border-white/10 pb-2">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-3 mt-5 tracking-tight flex items-center gap-2">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-2 mt-4 tracking-tight">{children}</h3>,
  h4: ({ children }: any) => <h4 className="text-base font-bold text-zinc-900 dark:text-white mb-2 mt-3">{children}</h4>,
  h5: ({ children }: any) => <h5 className="text-sm font-bold text-zinc-900 dark:text-white mb-1 mt-2">{children}</h5>,
  h6: ({ children }: any) => <h6 className="text-xs font-bold text-zinc-900 dark:text-white mb-1 mt-2 uppercase tracking-widest">{children}</h6>,
  p: ({ children }: any) => <p className="mb-4 last:mb-0 leading-relaxed text-[16px] text-zinc-800 dark:text-zinc-100">{children}</p>,
  ul: ({ children }: any) => <ul className="list-none pl-0 mb-4 space-y-2 text-zinc-800 dark:text-zinc-100">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal pl-6 mb-4 space-y-1.5 text-zinc-800 dark:text-zinc-100">{children}</ol>,
  li: ({ children }: any) => {
    // Check if this is a main bullet (starts with ◆) or sub bullet (starts with •)
    const text = typeof children === 'string' ? children : '';
    const isMainBullet = text.toString().startsWith('◆');
    const isActionItem = text.toString().includes('⚠️') || text.toString().includes('✅') || text.toString().includes('❌');
    return (
      <li className={cn(
        "flex items-start gap-2",
        isMainBullet && "font-medium text-zinc-900 dark:text-white",
        isActionItem && "bg-black/[0.03] dark:bg-white/[0.03] rounded-lg px-3 py-2 -mx-3"
      )}>
        <span className={cn(
          "mt-1.5 flex-shrink-0",
          isMainBullet ? "w-1.5 h-1.5 bg-zinc-800 dark:bg-white rounded-full" : "w-1.5 h-1.5 bg-zinc-400 dark:bg-white/40 rounded-full"
        )} />
        <span className="flex-1">{children}</span>
      </li>
    );
  },
  table: ({ children }: any) => (
    <div className="my-6 w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-zinc-50/50 dark:bg-[#1C1C1C] shadow-md dark:shadow-xl">
      <table className="w-full border-collapse text-sm text-left">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: any) => <thead className="bg-zinc-100 dark:bg-[#242424] border-b border-zinc-200 dark:border-white/[0.08]">{children}</thead>,
  th: ({ children }: any) => <th className="px-4 py-3 font-bold text-zinc-700 dark:text-white uppercase tracking-wider text-[11px]">{children}</th>,
  td: ({ children }: any) => {
    // Highlight status symbols in table cells
    const text = typeof children === 'string' ? children : '';
    const hasStatus = /[✅❌⚠️⏳💰🚀🔥⚡📊📈]/.test(text.toString());
    return (
      <td className={cn(
        "px-4 py-2.5 text-zinc-800 dark:text-white border-b border-zinc-100 dark:border-white/[0.06] last:border-0",
        hasStatus && "font-medium"
      )}>{children}</td>
    );
  },
  tr: ({ children }: any) => <tr className="hover:bg-zinc-100/50 dark:hover:bg-white/[0.04] transition-colors">{children}</tr>,
  hr: () => <div className="my-6 h-px bg-gradient-to-r from-transparent via-zinc-200 dark:via-white/20 to-transparent" />,
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-zinc-300 dark:border-white/30 pl-4 py-2 my-4 bg-zinc-100/40 dark:bg-white/[0.02] rounded-r-lg">
      <p className="text-zinc-700 dark:text-white italic text-sm">{children}</p>
    </blockquote>
  ),
  code: ({ node, inline, className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    const lang = match ? match[1] : '';
    return (
      <code className={cn(
        "font-mono text-sm",
        inline
          ? "px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/[0.08] text-zinc-800 dark:text-white"
          : "block p-4 bg-zinc-50 dark:bg-boult-elevated border border-zinc-200 dark:border-boult-border rounded-lg text-zinc-800 dark:text-white my-4 overflow-x-auto",
        className
      )} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }: any) => (
    <pre className="block my-4 bg-zinc-50 dark:bg-boult-elevated border border-zinc-200 dark:border-boult-border rounded-lg overflow-hidden">
      {children}
    </pre>
  ),
  a: ({ node, ...props }: any) => (
    <a
      className="text-zinc-800 dark:text-white underline underline-offset-4 decoration-zinc-300 dark:decoration-white/30 hover:decoration-zinc-500 dark:hover:decoration-white/70 transition-all font-medium hover:text-zinc-900 dark:hover:text-white"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  strong: ({ children }: any) => <strong className="font-bold text-zinc-900 dark:text-white">{children}</strong>,
  em: ({ children }: any) => <em className="italic text-zinc-800 dark:text-white">{children}</em>
};

const TypewriterMarkdown = ({ content, speed = 4, hideLinks }: { content: string, speed?: number, hideLinks?: boolean }) => {
  const [displayedText, setDisplayedText] = useState("");
  const [isDone, setIsDone] = useState(false);
  const cleanedContent = content.replace(/<br\s*\/?>/gi, '\n');
  const words = cleanedContent.split(/(\s+)/); // Preserve spaces
  const indexRef = useRef(0);

  useEffect(() => {
    // If content is short or we already started, reset if content changed significantly
    // But usually we just want to run it once for the final response
    let currentText = "";
    indexRef.current = 0;
    setDisplayedText("");
    setIsDone(false);

    const interval = setInterval(() => {
      if (indexRef.current >= words.length) {
        setIsDone(true);
        clearInterval(interval);
        return;
      }

      // Add 2-3 words at a time for "fast" word-by-word feel
      const batchSize = 3;
      for (let i = 0; i < batchSize && indexRef.current < words.length; i++) {
        currentText += words[indexRef.current];
        indexRef.current++;
      }

      setDisplayedText(currentText);
    }, speed);

    return () => clearInterval(interval);
  }, [content, speed]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        ...MarkdownComponents,
        ...(hideLinks ? { a: ({ node, ...props }) => <span className="text-inherit underline underline-offset-2 opacity-50 cursor-default">{props.children}</span> } : {})
      }}
    >
      {isDone ? cleanedContent : displayedText}
    </ReactMarkdown>
  );
};


const MessageContent = ({ content, isUser, isTyping, isNewResponse, hideLinks }: { content: any, isUser?: boolean, isTyping?: boolean, isNewResponse?: boolean, hideLinks?: boolean }) => {
  const textColorClass = "text-white";
  let textContent = typeof content === 'string' ? content : (content.text || '');
  textContent = textContent.replace(/<br\s*\/?>/gi, '\n');

  const shouldAnimate = (isTyping || isNewResponse) && !isUser;

  const markdownComponents = useMemo(() => {
    const base = {
      ...MarkdownComponents,
      ...(hideLinks ? { a: ({ node, ...props }: any) => <span className="text-inherit underline underline-offset-2 opacity-50 cursor-default">{props.children}</span> } : {})
    };

    if (shouldAnimate) {
      // Wrap pure-text paragraph contents with WordBlurStream so each word
      // fades in from a soft blur. Inline emphasis (strong/em/code/links)
      // still renders through the base components — only the bare text
      // nodes inside a paragraph get the blur animation. List items get
      // the same treatment for parity with paragraphs.
      const animateChildren = (children: any): any => {
        if (typeof children === 'string') {
          return <WordBlurStream text={children} loop={false} msPerWord={70} startupMs={250} maxBlurPx={5} />;
        }
        if (Array.isArray(children)) {
          return children.map((c, i) =>
            typeof c === 'string'
              ? <WordBlurStream key={i} text={c} loop={false} msPerWord={70} startupMs={250} maxBlurPx={5} />
              : c
          );
        }
        return children;
      };
      const Para = (base as any).p;
      const Li = (base as any).li;
      return {
        ...base,
        p: (props: any) => Para
          ? <Para {...props}>{animateChildren(props.children)}</Para>
          : <p>{animateChildren(props.children)}</p>,
        li: (props: any) => Li
          ? <Li {...props}>{animateChildren(props.children)}</Li>
          : <li>{animateChildren(props.children)}</li>,
      };
    }

    return base;
  }, [shouldAnimate, hideLinks]);

  return (
    <div className={cn(
      "w-full",
      textColorClass,
      !isUser && "max-w-none prose prose-invert prose-headings:mb-4 prose-p:mb-4 prose-li:mb-1 prose-table:my-6"
    )}>
      {/* No spinner and no blinking caret here — the thinking indicator by
          the executor box is the ONLY live-process animation. A second one
          under the text doubled the indicators and, when a stream stalled,
          sat there pulsing forever. */}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {textContent}
      </ReactMarkdown>
    </div>
  );
};

const MissionStatusHeader = ({ mission }: { mission: any }) => {
  if (!mission) return null;

  const statusLabels: any = {
    draft: 'Draft ready',
    waiting_on_user: 'Input required',
    waiting_on_other: 'In progress',
    done: 'Completed',
    archived: 'Archived'
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-boult-surface border border-boult-border rounded-xl w-fit mb-8 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse shrink-0" />
        <span className="text-black dark:text-white/95 text-[13px] font-bold tracking-tight">{mission.goal}</span>
      </div>
      <div className="h-3 w-[1px] bg-black/10 dark:bg-white/10" />
      <span className="text-[10px] font-black uppercase tracking-widest text-black dark:text-white/20">
        {statusLabels[mission.status] || mission.status}
      </span>
    </div>
  );
};

function isNotesRelatedQuery(message: string): boolean {
  const notesKeywords = [
    'note', 'notes', 'my notes', 'find note', 'search note', 'look for note',
    'remember', 'reminder', 'todo', 'task', 'list', 'ideas', 'thoughts',
    'journal', 'diary', 'memo', 'record', 'write down', 'saved note',
    'created note', 'made note', 'stored note', 'keep note'
  ];
  const lowerMessage = message.toLowerCase();
  return notesKeywords.some((keyword) => lowerMessage.includes(keyword));
}

function isEmailRelatedQuery(message: string): boolean {
  const emailKeywords = [
    'email', 'emails', 'inbox', 'gmail', 'message', 'messages',
    'unread', 'read', 'urgent', 'important', 'starred',
    'today', 'yesterday', 'this week', 'recent', 'latest',
    'from', 'subject', 'attachment', 'search', 'find', 'check'
  ];
  const lowerMessage = message.toLowerCase();
  return emailKeywords.some((keyword) => lowerMessage.includes(keyword));
}

function extractSearchTerm(message: string): string {
  const patterns = [
    /find\s+(?:my\s+)?notes?(?:\s+|\s*about|\s*on|\s*regarding)\s+(.+)/i,
    /search\s+(?:for\s+)?notes?(?:\s+|\s*about|\s*on|\s*regarding)\s+(.+)/i,
    /look\s+for\s+(?:my\s+)?notes?(?:\s+|\s*about|\s*on|\s*regarding)\s+(.+)/i,
    /show\s+me\s+(?:my\s+)?notes?(?:\s+|\s*about|\s*on|\s*regarding)\s+(.+)/i,
    /what\s+notes?(?:\s+do\s+i\s+have)?(?:\s*about|\s*on|\s*regarding)\s+(.+)/i,
    /remember\s+(?:anything\s+about\s+)?(.+)/i,
    /my\s+notes\s+on\s+(.+)/i,
    /notes\s+about\s+(.+)/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return message.trim();
}

// All XML-like tags that free models (Llama, Gemini, Qwen) emit internally.
const MODEL_INTERNAL_TAGS = [
  'thinking', 'thought', 'tool', 'tool_call', 'tool_use', 'tool_result',
  'reasoning', 'reflection', 'scratchpad',
  'system', 'context', 'instruction', 'plan', 'step',
];
const MODEL_WRAP_TAGS = ['answer', 'output', 'result', 'response', 'final', 'message', 'reply'];

function extractThinking(message: string): { thinking: string; cleanText: string } {
  if (typeof message !== 'string') return { thinking: '', cleanText: '' };

  let thinking = '';
  let cleanText = message;

  // 1. Extract content inside <thinking> for display in the thinking layer
  const thinkMatch = cleanText.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  if (thinkMatch) thinking = thinkMatch[1].trim();

  // 2. Remove all closed blocks for every known internal tag
  for (const tag of MODEL_INTERNAL_TAGS) {
    cleanText = cleanText.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  }

  // 3. Remove any streaming-open INTERNAL tag (no closing tag yet) — truncate
  //    from there. NEVER truncate from wrap tags (<answer>/<output>/<result>):
  //    those hold the real reply and deleting from them blanks the message.
  for (const tag of MODEL_INTERNAL_TAGS) {
    const idx = cleanText.search(new RegExp(`<${tag}[\\s>]`, 'i'));
    if (idx !== -1) cleanText = cleanText.slice(0, idx);
  }

  // 4. Strip stray tags (internal + wrap) but KEEP wrap-tag content
  for (const tag of [...MODEL_INTERNAL_TAGS, ...MODEL_WRAP_TAGS]) {
    cleanText = cleanText.replace(new RegExp(`<\\/?${tag}[^>]*>`, 'gi'), '');
  }

  // 5. Remove any partial malformed tag artifacts at start of lines (e.g. "<th<tool", "<th>")
  cleanText = cleanText.replace(/^<[^>\n]{0,40}$/gm, '');

  // 5b. Strip lines that are ONLY a leaked programming literal ("False",
  //     "True", "None", "null", "undefined"). Free models emit these as
  //     stray text around tool calls and they rendered verbatim in chat.
  cleanText = cleanText.replace(/^\s*(?:true|false|none|null|undefined)\s*[.!]?\s*$/gim, '');

  // 6. Collapse excess blank lines
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

  return { thinking, cleanText };
}

interface Email {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

/**
 * F5.1 — Collision-free message id generator. Date.now() alone can collide
 * when two messages are created in the same millisecond (rapid retry,
 * suggestion-click + send within ~1ms). We OR-combine the timestamp with a
 * monotonically increasing counter so two calls in the same ms still get
 * distinct ids. JS numbers stay safe up to 2^53; this stays well below.
 */
let __msgIdCounter = 0;
function nextMessageId(): number {
  __msgIdCounter = (__msgIdCounter + 1) % 1000;
  return Date.now() * 1000 + __msgIdCounter;
}

/**
 * PART 31 — Map a tool_result event to one or more SourceItem rows for the
 * Sources tab. Pulls a few useful fields out of the summary string by
 * tool-specific regex; for tools we don't recognize we still emit a
 * generic 'other' source so the user can see SOMETHING ran.
 *
 * Intentionally conservative — if extraction fails we return a one-line
 * fallback rather than spamming garbled tokens.
 */
// Past-tense human labels ("Searched inbox") → active voice ("Searching inbox")
// for the live step pills. First-word verb map; unknown verbs pass through
// unchanged (a past-tense label while active is still far better than a raw
// tool id).
const ACTIVE_VERB: Record<string, string> = {
  Searched: 'Searching', Read: 'Reading', Drafted: 'Drafting', Sent: 'Sending',
  Checked: 'Checking', Booked: 'Booking', Logged: 'Logging', Created: 'Creating',
  Applied: 'Applying', Labeled: 'Labeling', Archived: 'Archiving', Digested: 'Digesting',
  Reviewed: 'Reviewing', Scanned: 'Scanning', Cancelled: 'Cancelling', Prepped: 'Prepping',
  Resolved: 'Resolving', Updated: 'Updating', Wrote: 'Writing', Posted: 'Posting',
  Recalled: 'Recalling', Saved: 'Saving', Found: 'Finding', Pulled: 'Pulling',
  Analyzed: 'Analyzing', Prepared: 'Preparing', Generated: 'Generating', Built: 'Building',
  Opened: 'Opening', Researched: 'Researching', Summarized: 'Summarizing', Used: 'Using',
};
function toActiveVoice(label: string): string {
  const [first, ...rest] = label.split(' ');
  const active = ACTIVE_VERB[first];
  return active ? [active, ...rest].join(' ') : label;
}

function extractSourcesFromToolResult(toolName: string, summary: string, params?: Record<string, any>): SourceItem[] {
  if (!toolName) return [];
  const s = (summary || '').toString();
  const sources: SourceItem[] = [];

  // Gmail-family tools
  if (/^(search_gmail|gmail_unlimited_search|gmail_bulk_read_threads|read_email|gmail_read_thread)$/.test(toolName)) {
    // Search-style: "Found N email(s)…" + per-line "From: X   Subject: Y"
    const lines = s.split('\n');
    let currentFrom = '';
    let currentSubject = '';
    for (const line of lines) {
      const fromMatch = line.match(/^\s*From:\s*(.+?)\s*$/);
      const subjMatch = line.match(/^\s*Subject:\s*(.+?)\s*$/);
      if (fromMatch) currentFrom = fromMatch[1];
      if (subjMatch) {
        currentSubject = subjMatch[1];
        if (currentSubject) {
          sources.push({ category: 'gmail', title: currentSubject, context: currentFrom });
          currentFrom = '';
          currentSubject = '';
        }
      }
    }
    if (sources.length === 0) {
      const countMatch = s.match(/Found\s+(\d+)\s+email/);
      const q = params?.query || params?.gmailQuery || '';
      sources.push({
        category: 'gmail',
        title: countMatch ? `${countMatch[1]} email${countMatch[1] === '1' ? '' : 's'} matching: ${q || '(query)'}` : (q ? `Gmail: ${q}` : 'Gmail search'),
      });
    }
    return sources;
  }

  if (/^(draft_reply|draft_cold_email|send_email|gmail_batch_draft_replies|gmail_batch_send_emails)$/.test(toolName)) {
    // "Draft saved to Gmail successfully.\nTo: X <y@z>\nSubject: ABC\nGmail URL: https://..."
    const subj = s.match(/Subject:\s*(.+?)(?:\n|$)/)?.[1];
    const to = s.match(/To:\s*(.+?)(?:\n|$)/)?.[1];
    const url = s.match(/Gmail URL:\s*(https?:\/\/[^\s]+)/)?.[1];
    sources.push({
      category: 'gmail',
      title: subj || (toolName.includes('send') ? 'Email sent' : 'Draft saved'),
      context: to,
      url,
    });
    return sources;
  }

  // Calendar
  if (/^(get_calendar_events|calendar_get_availability|calendar_unlimited_scan)$/.test(toolName)) {
    const lines = s.split('\n');
    let current = '';
    for (const line of lines) {
      const eventMatch = line.match(/^\s*\d+\.\s+(.+?)\s*$/);
      const whenMatch = line.match(/^\s*When:\s*(.+?)\s*$/);
      if (eventMatch) current = eventMatch[1];
      if (whenMatch && current) {
        sources.push({ category: 'calendar', title: current, context: whenMatch[1] });
        current = '';
      }
    }
    if (sources.length === 0) {
      const eventCount = s.match(/(\d+)\s+(?:upcoming\s+)?event/i);
      sources.push({ category: 'calendar', title: eventCount ? `${eventCount[1]} calendar event(s)` : 'Calendar scan' });
    }
    return sources;
  }

  if (/^(schedule_meeting|calendar_batch_create_events)$/.test(toolName)) {
    const title = s.match(/Meeting created:\s*"([^"]+)"/)?.[1];
    const start = s.match(/Start:\s*(.+?)(?:\n|$)/)?.[1];
    const url = s.match(/Calendar URL:\s*(https?:\/\/[^\s]+)/)?.[1];
    sources.push({ category: 'calendar', title: title || 'Meeting scheduled', context: start, url });
    return sources;
  }

  // Notion
  if (/^(search_notion|notion_read_page|notion_get_calendar_events|fetch_notion_schema)$/.test(toolName)) {
    const lines = s.split('\n').slice(0, 10);
    for (const line of lines) {
      const m = line.match(/^\s*[-•]\s+(.+?)\s*$/);
      if (m && m[1].length > 2 && m[1].length < 200) {
        sources.push({ category: 'notion', title: m[1] });
      }
    }
    if (sources.length === 0) {
      sources.push({ category: 'notion', title: params?.query ? `Notion: ${params.query}` : 'Notion search' });
    }
    return sources;
  }

  if (/^(create_notion_page|notion_create_task|notion_auto_log_all_communication|notion_batch_create_database_entries|notion_deal_tracking_automation)$/.test(toolName)) {
    const url = s.match(/URL:\s*(https?:\/\/[^\s]+)/)?.[1];
    const title = params?.title || 'Notion page';
    sources.push({ category: 'notion', title, url });
    return sources;
  }

  // Slack
  if (/^(send_slack_message|slack_send_dm|slack_post_daily_briefing|slack_team_digest_weekly|send_slack)/.test(toolName)) {
    const channel = params?.channel || 'DM';
    sources.push({ category: 'slack', title: `Posted to ${channel}` });
    return sources;
  }
  if (/^(slack_get_channels|slack_find_user)$/.test(toolName)) {
    sources.push({ category: 'slack', title: toolName.replace(/_/g, ' ') });
    return sources;
  }

  // Web
  if (/^(web_search|web_search_instant|web_search_unlimited|company_intelligence_research|contact_research_and_verification)$/.test(toolName)) {
    // Look for URLs in the summary
    const urls = (s.match(/https?:\/\/[^\s)]+/g) || []).slice(0, 5);
    if (urls.length) {
      for (const url of urls) {
        try {
          const host = new URL(url).hostname.replace(/^www\./, '');
          sources.push({ category: 'web', title: host, url });
        } catch { /* skip */ }
      }
    } else {
      const q = params?.query || params?.queries?.[0] || '';
      sources.push({ category: 'web', title: q ? `Search: ${q}` : 'Web search' });
    }
    return sources;
  }

  // Memory
  if (/^(memory_search|memory_get_contact_profile|memory_unlimited_scan|memory_relationship_intelligence|searchMemoriesRaw)$/.test(toolName)) {
    const countMatch = s.match(/(\d+)\s+memor/i);
    sources.push({
      category: 'memory',
      title: countMatch ? `${countMatch[1]} memory item${countMatch[1] === '1' ? '' : 's'}` : 'Memory lookup',
    });
    return sources;
  }
  if (/^(memory_save|remember_about_contact|memory_bulk_save_learning|record_processed_items)$/.test(toolName)) {
    sources.push({ category: 'memory', title: 'Saved to memory' });
    return sources;
  }

  // Everything else — generic
  sources.push({ category: 'other', title: toolName.replace(/_/g, ' '), context: s.length < 100 ? s : undefined });
  return sources;
}

interface AgentMessage {
  id: number;
  type: 'agent';
  role: 'assistant';
  notes?: any[];
  content: {
    text: string;
    list: string[];
    footer: string;
  } | string;
  time: string;
  meta?: {
    actionType?: 'notes' | 'email' | 'general' | string;
    notesResult?: any;
    emailResult?: any;
    mission?: any;
    agentProcess?: any;
    completedSteps?: string[];
    thinkingBlocks?: ThinkingBlock[];
    internalThought?: string;
    isStreaming?: boolean;
    actionHistory?: any[];
    taskList?: TaskList;
    planText?: string;
    /** The "on it…" opener — the model's first pre-tool line. Renders as a
     *  permanent chat line ABOVE the executor box; never replaced by the
     *  final report. */
    ackText?: string;
    agentSteps?: AgentStep[];
    agentNarratives?: AgentNarrative[];
    agentRunId?: string;
    agentDurationMs?: number;
    chipSuggestions?: Array<{ label: string; prompt: string }>;
    /**
     * PART 66 — interactive question card persisted on the assistant message.
     * Set when the AI calls ask_user. Cleared (set to undefined) once the user
     * submits or dismisses. Persisted via localStorage so the card survives
     * page reload — the conversation re-opens with the card right where the
     * user left it.
     */
    pendingQuestion?: { questions: AskQuestion[]; runId: string; planMode?: boolean };
    result?: {
      type: string;
      title: string;
      canvasData: any;
    };
    limitReached?: boolean;
    usageData?: any;
    canvasApproval?: {
      status: 'pending' | 'accepted' | 'declined';
      title?: string;
      description?: string;
      canvasData?: any;
      canvasType?: string;
    };
    searchSessions?: SearchSession[];
    planArtifact?: any; // Phase 2: Plan artifact for execution
    executionResult?: any; // Phase 1: Execution gateway result
    error?: any; // Phase 1: Error with recovery hints
    recoveryHint?: any; // Phase 1: Error recovery guidance
    externalRefs?: any; // Phase 1: External references from execution
    requiresRetry?: boolean; // Phase 1: Whether retry is required
    liveThinking?: string;
    thinkingComplete?: boolean;
    /**
     * PART 8 #1 — accumulating live-progress lines for bulk operations.
     * Each new SSE 'progress' event appends one line ("Creating 17 drafts now",
     * "Got 11 of 17 created. Finishing the remaining 6 now.", "All 17 drafts
     * created. Displaying them now."). Rendered as a single stacked block on
     * the assistant message above the rest of the content.
     */
    progressLines?: string[];
    draftReply?: {
      content: string;
      recipientEmail: string;
      recipientName: string;
      senderName: string;
      subject: string;
      threadId?: string;
      gmailDraftId?: string;
      /** Post-draft voice-match score (0-100) from reviewDraft. */
      voiceScore?: number;
      /** One-line critique surfaced under the score badge when score < 70. */
      voiceCritique?: string;
    };
    /**
     * PART 8 #5 — accumulating array of all email_draft canvases produced in
     * this assistant turn. When length >= 2 the render block shows the
     * DraftGalleryCard instead of the single-draft modal. Single drafts
     * still populate draftReply (above) for backwards compat with the modal.
     */
    draftReplies?: Array<{
      content: string;
      recipientEmail: string;
      recipientName: string;
      senderName: string;
      subject: string;
      threadId?: string;
      gmailDraftId?: string;
      voiceScore?: number;
      voiceCritique?: string;
    }>;
    planCard?: PlanCardData;
    planIntro?: string;
    hasError?: boolean;
    errorMessage?: string;
    needsConfirmation?: boolean;
    partialFailure?: {
      done: string[];
      failed: { tool: string; error: string }[];
      question: string;
    };
    /** Single action card kept for backwards compat — new flows use actionResults. */
    actionResult?: {
      type: 'notion_page' | 'calendar_event' | 'email_sent';
      title: string;
      url?: string;
      meetLink?: string;
      startTime?: string;
      attendees?: string[];
      contentPreview?: string;
      recipientName?: string;
      verbLabel?: string;
    };
    /**
     * PART 8 #2 — stacked action cards for bulk operations.
     * Each successful send_email / create_notion_page / schedule_meeting
     * pushes its card here; the UI renders them as a vertical list.
     * actionResult (singular, above) stays populated with the most-recent
     * entry for backwards compat with code that reads .actionResult, but
     * the render path prefers actionResults when both exist.
     */
    actionResults?: Array<{
      type: 'notion_page' | 'calendar_event' | 'email_sent';
      title: string;
      url?: string;
      meetLink?: string;
      startTime?: string;
      attendees?: string[];
      contentPreview?: string;
      recipientName?: string;
      verbLabel?: string;
    }>;
    scheduledAgent?: ScheduledAgentData;
    integrationRequired?: IntegrationRequiredData;
    confirmationData?: ConfirmationData;
    confirmationStatus?: 'confirmed' | 'cancelled';
    searchExecution?: {
      mainQuery: string;
      subQueries: Array<{
        id: string;
        query: string;
        status: 'pending' | 'running' | 'completed' | 'error';
        results?: number;
      }>;
      sources: Array<{
        id: string;
        title: string;
        url?: string;
        icon?: string;
        snippet?: string;
        type: 'web' | 'email' | 'document' | 'calendar' | 'database';
        connectorId?: string;
      }>;
      answer?: string;
      isSearching: boolean;
    };
    suggestions?: string[];
    canvasExpansion?: boolean; // Phase 2: Whether to show canvas expansion prompt
    continueClicked?: boolean; // Whether the 'Continue' button after credit replenishment was clicked
    connectorRequired?: {
      connectors: ConnectorRequiredEntry[];
      waitingForUser?: boolean;
      dismissed?: boolean;
    };
    /** PART 9 — orchestration plan emitted before the first tool call */
    orchestrationPlan?: {
      intent: string;
      steps: Array<{
        label: string;
        tools: string[];
        parallel: boolean;
        isWrite: boolean;
        requiredIntegration: string | null;
      }>;
      missingIntegrations: string[];
      estimatedCalls: { min: number; max: number };
      stepStatuses?: Record<number, 'pending' | 'running' | 'completed' | 'failed'>;
    };
    /** PART 9 — emitted when budget runs out before all plan steps complete */
    partialCompletion?: {
      completed: string[];
      skipped: string[];
      reason: string;
    };
    /** PART 10 Fix 7 — agent plan preview before creating a scheduled agent */
    agentPlanPreview?: {
      agentName: string;
      taskDescription: string;
      cronSchedule: string;
      outputChannel: string;
      agentPlan: PlanPreviewData;
      agentParams: Record<string, any>;
    };
    /** Stage-1 spec confirmation — shown after create_scheduled_agent first call */
    agentSpecConfirm?: {
      agentName: string;
      specMarkdown: string;
      agentParams: Record<string, any>;
      confirmed?: boolean;
    };
    /** PART 31 — Sources tab data. Per-tool grouping of items the assistant
     *  consulted to produce its answer. Built up during the tool_result SSE
     *  stream from per-tool summary text. */
    sources?: Array<{
      category: 'gmail' | 'calendar' | 'notion' | 'slack' | 'web' | 'memory' | 'other';
      title?: string;
      url?: string;
      context?: string;
    }>;
  };
}

interface UserMessageAttachment {
  name: string;
  url: string;
  type: string;
  size: number;
}

// One edited branch of a user turn: the prompt the user sent AND the assistant
// reply it produced. Editing + resending appends a version; the arrows on the
// user pill page between them, swapping BOTH the prompt and its answer.
interface UserMessageVersion {
  content: string;
  attachments?: UserMessageAttachment[];
  /** The assistant reply this prompt produced. Serializable AgentMessage. */
  reply?: AgentMessage | null;
}

interface UserMessage {
  id: number;
  type: 'user';
  role: 'user';
  notes?: any[];
  content: string;
  time: string;
  attachments?: UserMessageAttachment[];
  /** Edit history. Index 0 is the original. Absent = never edited. */
  versions?: UserMessageVersion[];
  /** Which version is currently shown (index into versions). */
  activeVersion?: number;
}

type Message = AgentMessage | UserMessage;



interface ChatInterfaceProps {
  initialConversationId?: string | null;
  onConversationSelect?: (conversationId: string) => void;
  onNewChat?: () => void;
  onConversationDelete?: (conversationId: string) => void;
  isEmbedded?: boolean;
}

// Global styles for custom scrollbar and typography
const NoScrollbarStyles = () => (
  <style jsx global>{`
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap');
    
    body {
      font-family: 'Montserrat', sans-serif !important;
    }

    .boult-scrollbar::-webkit-scrollbar {
      width: 6px;
    }
    .boult-scrollbar::-webkit-scrollbar-track {
      background: transparent;
    }
    .boult-scrollbar::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 10px;
    }
    .boult-scrollbar::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .boult-scrollbar {
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }
    .no-scrollbar::-webkit-scrollbar {
      display: none !important;
    }
    .no-scrollbar {
      -ms-overflow-style: none !important; /* IE and Edge */
      scrollbar-width: none !important; /* Firefox */
    }
  `}</style>
);

const THINKING_LABELS = ['Thinking', 'Reasoning', 'Analyzing', 'Planning', 'Processing'];

function AgentThinkingSection({ content, isComplete }: { content: string, isComplete?: boolean }) {
  const [timer, setTimer] = useState(0);
  const [labelIdx, setLabelIdx] = useState(0);
  const startTimeRef = useRef(Date.now());

  // Rolling label cycle
  useEffect(() => {
    if (isComplete) return;
    const id = setInterval(() => setLabelIdx(i => (i + 1) % THINKING_LABELS.length), 2800);
    return () => clearInterval(id);
  }, [isComplete]);

  // Elapsed timer
  useEffect(() => {
    if (isComplete) return;
    startTimeRef.current = Date.now();
    const id = setInterval(() => setTimer(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isComplete]);

  if (!content) return null;

  return (
    <div className="flex flex-col gap-1.5 mt-1 mb-2 min-w-0">
      {/* Header — single line, no wrap */}
      <div className="flex items-center gap-2 min-w-0">
        {!isComplete ? (
          <SpiralLoader size={20} className="flex-shrink-0 opacity-85" />
        ) : (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-4 h-4 rounded-full bg-boult-elevated border border-boult-border flex items-center justify-center flex-shrink-0"
          >
            <div className="w-1 h-1 rounded-full bg-black/40 dark:bg-white/25" />
          </motion.div>
        )}

        {!isComplete ? (
          <AnimatePresence mode="wait">
            <motion.span
              key={labelIdx}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              className="text-[12px] font-semibold bg-[linear-gradient(110deg,#000,30%,#888,50%,#000,70%,#000)] dark:bg-[linear-gradient(110deg,#555,30%,#ddd,50%,#555,70%,#555)] bg-[length:250%_100%] bg-clip-text text-transparent select-none whitespace-nowrap shrink-0"
              style={{ backgroundSize: '250% 100%', animation: 'shimmer-text 3s linear infinite' }}
            >
              {THINKING_LABELS[labelIdx]}
            </motion.span>
          </AnimatePresence>
        ) : (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-[11px] font-medium text-black/40 dark:text-white/20 tracking-widest select-none uppercase whitespace-nowrap shrink-0"
          >
            Thought
          </motion.span>
        )}

        {!isComplete && (
          <span className="text-[11px] font-mono text-black/50 dark:text-white/25 tabular-nums shrink-0">{timer}s</span>
        )}
      </div>

      {/* The live thought itself — one quiet line, updating as the loop
          reasons. Generic status placeholders ("Thinking...", "Analysing
          your request…") are already carried by the shimmer label above;
          rendering them here too read as a SECOND loader. Only real thought
          sentences earn this line. */}
      {!isComplete && content && content.length > 3 && !/^[A-Za-z\s'’-]{0,48}(?:\.\.\.|…)$/.test(content.trim()) && (
        <AnimatePresence mode="wait">
          <motion.p
            key={content}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="text-[12.5px] text-black/45 dark:text-white/40 leading-snug pl-7 -mt-0.5 line-clamp-2"
          >
            {content}
          </motion.p>
        </AnimatePresence>
      )}

      <style jsx global>{`
        @keyframes shimmer-text {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}


function AgentTaskPill({ step }: { step: AgentStep }) {
  const getIcon = () => {
    switch (step.tool) {
      case 'search_gmail':
      case 'search_inbox':
        return <Search className="w-3.5 h-3.5" />;
      case 'read_email':
      case 'read_browser_page':
        return <Compass className="w-3.5 h-3.5" />;
      case 'get_sent_emails':
      case 'save_draft':
      case 'draft_reply':
        return <Mail className="w-3.5 h-3.5" />;
      case 'send_email':
        return <Send className="w-3.5 h-3.5" />;
      case 'schedule_meeting':
      case 'get_calendar_events':
        return <Calendar className="w-3.5 h-3.5" />;
      case 'web_search':
      case 'search_web':
        return <Globe className="w-3.5 h-3.5" />;
      case 'search_notion':
        return <FileText className="w-3.5 h-3.5" />;
      case 'open_canvas':
        return <Zap className="w-3.5 h-3.5" />;
      case 'send_slack_message':
        return <MessageSquare className="w-3.5 h-3.5" />;
      default:
        return <Terminal className="w-3.5 h-3.5" />;
    }
  };

  const contextLine = step.context || step.params?.query || step.params?.subject || step.params?.title || '';

  return (
    <div className={cn(
      "flex flex-col gap-0.5 px-3 py-1.5 rounded-2xl w-fit mt-2 group/pill transition-all border",
      step.status === 'active'
        ? "bg-boult-surface border-boult-divider shadow-[0_0_10px_rgba(255,255,255,0.05)] overflow-hidden relative"
        : "bg-boult-elevated border-boult-border hover:bg-boult-surface hover:border-boult-divider"
    )}>
      {step.status === 'active' && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent w-[200%]"
          animate={{ x: ['-100%', '100%'] }}
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
        />
      )}
      <div className="flex items-center gap-2.5 z-10 relative">
        <div className={cn(
          "flex items-center justify-center w-5 h-5 rounded-full border transition-all relative overflow-hidden flex-shrink-0",
          step.status === 'active'
            ? "bg-white/20 border-white/30 text-white shadow-[0_0_12px_rgba(255,255,255,0.4)]"
            : "bg-boult-elevated border-boult-border text-boult-fg-tertiary group-hover/pill:text-boult-fg group-hover/pill:border-boult-divider"
        )}>
          {step.status === 'active' && (
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-[200%]"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            />
          )}
          {getIcon()}
        </div>
        <div>
          {step.status === 'active' ? (
            <TextShimmer className="text-[13px] text-white/80 tracking-tight font-medium" duration={2}>
              {step.label}
            </TextShimmer>
          ) : (
            <span className="text-[13px] text-white/50 group-hover/pill:text-white/80 transition-colors tracking-tight font-medium">
              {step.label}
            </span>
          )}
        </div>
        {step.status === 'active' && (
          <div className="flex items-center gap-1 ml-1">
            <motion.div className="w-1 h-1 rounded-full bg-white/40" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, times: [0, 0.5, 1] }} />
            <motion.div className="w-1 h-1 rounded-full bg-white/40" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.3, times: [0, 0.5, 1] }} />
            <motion.div className="w-1 h-1 rounded-full bg-white/40" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.6, times: [0, 0.5, 1] }} />
          </div>
        )}
        {step.status === 'completed' && (
          <Check className="w-3 h-3 text-green-400/50 ml-1" />
        )}
      </div>
      {/* Context line — query/subject being searched */}
      {contextLine && (
        <p className={cn(
          "text-[11px] pl-7 leading-tight truncate max-w-[280px]",
          step.status === 'active' ? "text-white/35 italic" : "text-white/20"
        )}>
          {contextLine}
        </p>
      )}
      {/* Result snippet — shown when completed */}
      {step.status === 'completed' && step.summary && (
        <p className="text-[11px] pl-7 text-white/25 leading-tight line-clamp-2 max-w-[280px]">
          {step.summary}
        </p>
      )}
    </div>
  );
}

// ─── Collapsible Execution Steps wrapper ─────────────────────────────────────
// The dependency-ordered plan built before the first tool call, with per-phase
// statuses the SSE handlers already advance off REAL tool events (tool_call →
// running, tool_result → completed/failed). Rendered as the Manus-style phase
// rail at the top of the processing trace — zero extra LLM calls, and it can
// never show progress that didn't happen because the statuses ARE the run.
interface PhasePlanData {
  intent: string;
  steps: Array<{ label: string; tools: string[]; parallel: boolean; isWrite: boolean; requiredIntegration: string | null }>;
  stepStatuses?: Record<number, 'pending' | 'running' | 'completed' | 'failed'>;
}

function PhaseStatusIcon({ status }: { status: 'pending' | 'running' | 'completed' | 'failed' }) {
  if (status === 'completed') {
    return <Check className="w-3.5 h-3.5 text-black/45 dark:text-white/45 flex-shrink-0" strokeWidth={2.5} />;
  }
  if (status === 'failed') {
    return <X className="w-3.5 h-3.5 text-black/60 dark:text-white/60 flex-shrink-0" strokeWidth={2.5} />;
  }
  if (status === 'running') {
    return (
      <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
        <motion.span
          className="w-2 h-2 rounded-full bg-black/70 dark:bg-white/70"
          animate={{ scale: [1, 1.25, 1], opacity: [0.55, 1, 0.55] }}
          transition={{ repeat: Infinity, duration: 1.3, ease: 'easeInOut' }}
        />
      </span>
    );
  }
  return <Circle className="w-3.5 h-3.5 text-black/20 dark:text-white/20 flex-shrink-0" strokeWidth={2} />;
}

function CollapsibleSteps({
  steps,
  narratives,
  isActive,
  runId,
  totalDurationMs,
  plan,
}: {
  steps: AgentStep[];
  narratives?: AgentNarrative[];
  isActive: boolean;
  runId?: string;
  totalDurationMs?: number;
  plan?: PhasePlanData;
}) {
  // The box holds real tool work only — thinking-type steps render OUTSIDE
  // the box (AgentThinkingSection), so they neither open the box nor count.
  const visibleSteps = steps.filter(s => s.type !== 'thinking');

  // Collapsed until the run proves it's a real multi-step task. Manual clicks
  // always win over the auto behavior.
  const [collapsed, setCollapsed] = useState(true);
  const userToggledRef = useRef(false);

  // Auto-expand once the AI is visibly running multiple steps.
  useEffect(() => {
    if (isActive && visibleSteps.length >= 2 && !userToggledRef.current) {
      setCollapsed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, visibleSteps.length]);

  // Auto-collapse once the run finishes.
  const prevActiveRef = useRef(isActive);
  useEffect(() => {
    if (prevActiveRef.current && !isActive) {
      setCollapsed(true);
      userToggledRef.current = false;
    }
    prevActiveRef.current = isActive;
  }, [isActive]);

  // No real tool step yet = no box. A message that never runs tools never
  // shows the box at all; while the model is only thinking, the indicator
  // outside the box carries that state.
  if (visibleSteps.length === 0) return null;

  const completedCount = visibleSteps.filter(s => s.status === 'completed').length;
  const totalCount = visibleSteps.length;

  // Manus-style phase rail — only when the plan has real multi-phase shape.
  const showPhases = !!plan && plan.steps.length >= 2;
  const runningPhase = showPhases
    ? plan!.steps.find((_, i) => plan!.stepStatuses?.[i] === 'running')?.label
    : undefined;
  // Live line for the collapsed header: current phase, else the running step.
  const runningStep = isActive
    ? [...visibleSteps].reverse().find(s => s.status === 'active')
    : undefined;
  const liveLabel = runningPhase || runningStep?.context || runningStep?.label;

  const headerLabel = collapsed
    ? isActive
      ? liveLabel || `Working… ${completedCount}/${totalCount}`
      : `${totalCount} step${totalCount !== 1 ? 's' : ''} completed`
    : isActive
    ? runningPhase
      ? `${runningPhase} · ${completedCount}/${totalCount}`
      : `${completedCount} / ${totalCount} steps`
    : `${totalCount} step${totalCount !== 1 ? 's' : ''} completed`;

  return (
    <div className={cn('mt-1 mb-4 boult-glass rounded-2xl px-3.5 transition-all w-[640px] max-w-full', collapsed ? 'py-2' : 'py-2.5')}>
      {/* Toggle row */}
      <button
        onClick={() => {
          userToggledRef.current = true;
          setCollapsed(c => !c);
        }}
        className={cn(
          'flex items-center gap-1.5 text-black/45 dark:text-white/35 hover:text-black/70 dark:hover:text-white/60 transition-colors w-full min-w-0',
          collapsed ? 'mb-0' : 'mb-1.5',
        )}
      >
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200',
            collapsed ? '-rotate-90' : 'rotate-0',
          )}
        />
        {collapsed && isActive ? (
          <motion.span
            className="text-[12px] font-medium tracking-wide truncate bg-[linear-gradient(110deg,#0000005c,35%,#000,50%,#0000005c,75%,#0000005c)] dark:bg-[linear-gradient(110deg,#ffffff59,35%,#fff,50%,#ffffff59,75%,#ffffff59)] bg-[length:250%_100%] bg-clip-text text-transparent"
            initial={{ backgroundPosition: '200% 0' }}
            animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
            transition={{ repeat: Infinity, duration: 2.5, ease: 'linear' }}
          >
            {headerLabel}
          </motion.span>
        ) : (
          <span className="text-[12px] font-medium tracking-wide truncate">{headerLabel}</span>
        )}
        {isActive && (
          <motion.span
            className="inline-block w-1 h-1 rounded-full bg-black/40 dark:bg-white/35 flex-shrink-0"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
          />
        )}
      </button>

      {/* Content */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            {/* Phase rail — the run's plan with live statuses driven by real
                tool events. The "Deep research → Analyze → Deliver" anatomy. */}
            {showPhases && (
              <div className="mb-2.5 pb-2.5 border-b border-black/[0.05] dark:border-white/[0.06] space-y-1.5">
                {plan!.steps.map((s, i) => {
                  const st = plan!.stepStatuses?.[i] || 'pending';
                  return (
                    <div key={i} className="flex items-center gap-2 min-w-0">
                      <PhaseStatusIcon status={st} />
                      <span className={cn(
                        'text-[12.5px] tracking-tight truncate',
                        st === 'running'
                          ? 'text-black/85 dark:text-white/85 font-medium'
                          : st === 'completed'
                            ? 'text-black/40 dark:text-white/35'
                            : st === 'failed'
                              ? 'text-black/60 dark:text-white/55'
                              : 'text-black/30 dark:text-white/25',
                      )}>
                        {s.label}
                      </span>
                      {s.parallel && st === 'running' && (
                        <span className="text-[10px] text-black/30 dark:text-white/25 font-medium flex-shrink-0">parallel</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <LiveStepTracker
              steps={steps}
              narratives={narratives}
              isActive={isActive}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Boult Error Card ──────────────────────────────────────────────────────────
/**
 * PART 8 #6 — Classify a raw error string into a severity bucket so the
 * card can pick the right border color, icon, and primary action. Keeps
 * the LLM- and route-side error messages from leaking through raw.
 */
type BoultErrorKind = 'auth' | 'error' | 'warning';
function classifyBoultError(message: string | undefined): BoultErrorKind {
  if (!message) return 'error';
  const m = message.toLowerCase();
  // Auth/scope problems → "Reconnect" action makes sense
  if (
    m.includes('gmail_scope_missing') ||
    m.includes('gcal_scope_missing') ||
    m.includes('scope') ||
    m.includes('reconnect') ||
    m.includes('not connected') ||
    m.includes('unauthorized') ||
    m.includes('token expired') ||
    m.includes('403')
  ) return 'auth';
  // Transient warnings → auto-retry already wired in for these.
  // PART 25: added "models are currently busy" / "models busy" / "all passes"
  // because the engine throws "All models are currently busy. Please try
  // again in a moment." when every free OpenRouter key is rate-limited.
  // The screenshot showed this hitting the hard-red 'error' path instead
  // of the soft-yellow auto-retry path because none of the previous tokens
  // matched the engine's actual error text.
  if (
    m.includes('exhausted') ||
    m.includes('timed out') ||
    m.includes('timeout') ||
    m.includes('rate limit') ||
    m.includes('429') ||
    m.includes('models are currently busy') ||
    m.includes('models busy') ||
    m.includes('all passes') ||
    m.includes('please try again in a moment') ||
    m.includes('service unavailable') ||
    m.includes('503')
  ) return 'warning';
  return 'error';
}

function BoultErrorCard({
  errorMessage,
  onRetry,
  onReconnect,
}: {
  errorMessage?: string;
  onRetry: () => void;
  /** When the error is an auth problem this opens the integrations modal. */
  onReconnect?: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [nextRetryInMs, setNextRetryInMs] = useState<number | null>(null);

  const kind = classifyBoultError(errorMessage);
  const isExhausted = kind === 'warning';

  const RETRY_DELAYS_MS = [5000, 12000, 30000];
  const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;
  const exhaustedAttempts = attempt >= MAX_ATTEMPTS;

  useEffect(() => {
    setRetrying(false);
  }, [errorMessage]);

  useEffect(() => {
    if (!isExhausted || retrying || exhaustedAttempts) return;
    const delay = RETRY_DELAYS_MS[attempt];
    setNextRetryInMs(delay);
    const tick = setInterval(() => {
      setNextRetryInMs(prev => prev !== null && prev > 1000 ? prev - 1000 : prev);
    }, 1000);
    const fire = setTimeout(() => {
      clearInterval(tick);
      setNextRetryInMs(null);
      setRetrying(true);
      setAttempt(a => a + 1);
      onRetry();
    }, delay);
    return () => { clearTimeout(fire); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, isExhausted, retrying, errorMessage]);

  const handleRetry = () => {
    setAttempt(0);
    setRetrying(true);
    onRetry();
  };

  const headline =
    kind === 'auth'
      ? "I can't reach that integration."
      : kind === 'warning'
        ? exhaustedAttempts
          ? 'Models are slammed right now.'
          : 'Boult is taking a moment.'
        : 'Boult was unable to reply.';

  const subtitle = (() => {
    if (kind === 'auth' || kind === 'error') {
      return errorMessage && errorMessage.length < 240 ? errorMessage : 'Something went wrong. Please try again.';
    }
    if (exhaustedAttempts) {
      return `The models are slammed right now. Give it a minute and try again.`;
    }
    if (retrying) return `Retry attempt ${attempt} running…`;
    if (nextRetryInMs !== null) {
      const sec = Math.max(1, Math.ceil(nextRetryInMs / 1000));
      return `All models busy — retry ${attempt + 1} of ${MAX_ATTEMPTS} in ${sec}s…`;
    }
    return 'All models busy — retrying…';
  })();

  // Border + icon palette per kind
  const palette = kind === 'auth'
    ? {
        border: 'border-amber-500/35',
        bg: 'bg-amber-500/[0.04]',
        iconBg: 'bg-amber-500/15 border-amber-500/30',
        iconColor: 'text-amber-400',
      }
    : kind === 'warning'
      ? {
          border: 'border-white/15',
          bg: 'bg-boult-surface-hover',
          iconBg: 'bg-boult-elevated border-boult-border',
          iconColor: 'text-white/55',
        }
      : {
          border: 'border-rose-500/35',
          bg: 'bg-rose-500/[0.04]',
          iconBg: 'bg-rose-500/15 border-rose-500/30',
          iconColor: 'text-rose-400',
        };

  const Icon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={palette.iconColor}>
      {kind === 'error' ? (
        // X-in-circle for hard failures
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </>
      ) : kind === 'auth' ? (
        // Shield-style for auth
        <>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </>
      ) : (
        // Warning circle for transient
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </>
      )}
    </svg>
  );

  const showReconnect = kind === 'auth' && onReconnect;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', damping: 24, stiffness: 280 }}
      className={cn(
        'flex items-center justify-between gap-4 px-4 py-3.5 rounded-2xl border w-full max-w-lg mt-1',
        palette.border,
        palette.bg,
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center mt-0.5',
          palette.iconBg,
        )}>
          <Icon />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-boult-fg leading-tight">{headline}</p>
          <p className="text-[12px] text-boult-fg-tertiary mt-0.5 leading-snug break-words">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {showReconnect && (
          <button
            onClick={onReconnect}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 text-white text-[12px] font-semibold hover:bg-amber-400 transition-all shadow-sm"
          >
            Reconnect
          </button>
        )}
        <button
          onClick={handleRetry}
          disabled={retrying}
          className={cn(
            'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm',
            showReconnect
              ? 'border border-boult-border text-boult-fg-secondary hover:text-boult-fg hover:bg-boult-surface-hover'
              : 'bg-boult-fg text-boult-fg-inverse hover:bg-boult-fg/90',
          )}
        >
          {retrying ? (
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 11-6.219-8.56" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          )}
          {showReconnect ? 'Try again' : 'Retry'}
        </button>
      </div>
    </motion.div>
  );
}


// ─── PART 9: Partial Completion Card ──────────────────────────────────────────
// Shown when the tool-call budget ran out before all planned steps could run.
// Distinct from PartialFailureCard (which is tool errors) — this is clean
// budget exhaustion: some steps were simply not reached.
function PartialCompletionCard({
  skipped,
  reason,
}: {
  completed: string[]; // kept in type for future use; completed tools shown in ThinkingLayer
  skipped: string[];
  reason: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 24, stiffness: 260 }}
      className="mt-3 rounded-2xl overflow-hidden border border-boult-border bg-boult-elevated"
    >
      {/* Skipped steps */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-3.5 h-3.5 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Steps not reached</p>
        </div>
        <div className="flex flex-col gap-1">
          {skipped.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-white/20 flex-shrink-0" />
              <span className="text-[12px] text-white/45">{s}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Reason footer */}
      <div className="px-4 py-2 border-t border-boult-border bg-white/[0.02]">
        <p className="text-[11px] text-white/30">{reason}</p>
      </div>
    </motion.div>
  );
}

// ─── Partial Failure Card ──────────────────────────────────────────────────────
function PartialFailureCard({
  done,
  failed,
  question,
}: {
  done: string[];
  failed: { tool: string; error: string }[];
  question: string;
}) {
  const toolLabel = (name: string) =>
    name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 24, stiffness: 260 }}
      className="mt-4 rounded-2xl overflow-hidden border border-boult-border bg-boult-elevated"
    >
      {/* Done section */}
      {done.length > 0 && (
        <div className="px-4 py-3 border-b border-boult-border">
          <p className="text-[10px] font-bold text-boult-fg-muted uppercase tracking-widest mb-2">Done</p>
          <div className="flex flex-col gap-1">
            {done.map(t => (
              <div key={t} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400/60 flex-shrink-0" />
                <span className="text-[12px] text-boult-fg-secondary font-mono">{toolLabel(t)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Failed section */}
      <div className="px-4 py-3 border-b border-boult-border">
        <p className="text-[10px] font-bold text-red-400/60 uppercase tracking-widest mb-2">Needs attention</p>
        <div className="flex flex-col gap-2">
          {failed.map(f => (
            <div key={f.tool}>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400/60 flex-shrink-0" />
                <span className="text-[12px] text-boult-fg font-semibold font-mono">{toolLabel(f.tool)}</span>
              </div>
              <p className="text-[11px] text-boult-fg-muted pl-3.5 mt-0.5 leading-snug">{f.error}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Recovery question */}
      <div className="px-4 py-3">
        <p className="text-[12px] text-boult-fg-tertiary leading-snug">{question}</p>
      </div>
    </motion.div>
  );
}

// ─── Proceed Confirm Buttons ───────────────────────────────────────────────────
function ProceedConfirmButtons({ onProceed, onDismiss }: { onProceed: () => void; onDismiss: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  const [proceeded, setProceeded] = useState(false);

  if (dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, type: 'spring', damping: 24, stiffness: 260 }}
      className="mt-3 space-y-2.5"
    >
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setProceeded(true); onProceed(); setDismissed(true); }}
          className="px-4 py-2 rounded-xl bg-white text-black text-[12px] font-semibold hover:bg-white/90 transition-all shadow-sm"
        >
          Yes, proceed
        </button>
        <button
          onClick={() => { onDismiss(); setDismissed(true); }}
          className="px-4 py-2 rounded-xl bg-boult-surface border border-boult-border text-boult-fg-tertiary text-[12px] font-medium hover:bg-boult-raised hover:text-boult-fg-secondary transition-all"
        >
          Cancel
        </button>
      </div>

      {/* Waiting indicator */}
      {!proceeded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center gap-2"
        >
          {/* Dotted spinning circle */}
          <svg width="14" height="14" viewBox="0 0 14 14" className="flex-shrink-0">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => (
              <motion.circle
                key={deg}
                cx={7 + 5 * Math.cos((deg * Math.PI) / 180)}
                cy={7 + 5 * Math.sin((deg * Math.PI) / 180)}
                r="1.2"
                fill="#EAB308"
                animate={{ opacity: [1, 0.15, 1] }}
                transition={{
                  repeat: Infinity,
                  duration: 1.2,
                  delay: i * 0.15,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </svg>
          <span className="text-[11px] font-medium text-yellow-400/80">
            Waiting for you to proceed
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}

// --- Premium Components for Action Buttons ---
// A long user prompt collapses past this many characters (roughly the 6-7
// lines the pill shows before it feels like a wall). Below it, no toggle.
const USER_MSG_COLLAPSE_CHARS = 320;

/**
 * UserMessageBlock — the user's turn as a bubble with:
 *   • Show more / Show less for long prompts (collapsed by default)
 *   • an action row UNDER the bubble: version arrows (‹ 2/2 ›) · Copy · Edit
 * Edit resends the prompt as a new version; the arrows page between versions,
 * swapping both the prompt shown and the assistant reply below it.
 */
const UserMessageBlock = ({
  msg,
  isLoading,
  isLatestUser,
  onEdit,
  onSelectVersion,
}: {
  msg: UserMessage;
  isLoading: boolean;
  isLatestUser: boolean;
  onEdit: (msg: UserMessage) => void;
  onSelectVersion: (msgId: number, versionIndex: number) => void;
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const text = typeof msg.content === 'string' ? msg.content : '';
  const isLong = text.length > USER_MSG_COLLAPSE_CHARS;

  const versionCount = msg.versions?.length ?? 1;
  const activeVersion = msg.activeVersion ?? (versionCount - 1);
  const hasVersions = versionCount > 1;

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    toast.success('Message copied to clipboard');
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="flex flex-col items-end w-full">
      <div className="relative overflow-hidden boult-glass-pill px-5 py-3 rounded-[22px] text-black dark:text-white max-w-full">
        {isLoading && isLatestUser && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent w-[200%] pointer-events-none"
            animate={{ x: ['-100%', '100%'] }}
            transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
          />
        )}
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.06] via-transparent to-transparent pointer-events-none"
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
        />

        {/* Prompt text — collapsed to ~6 lines when long and not expanded */}
        <div
          className={cn(
            'relative z-[1] whitespace-pre-wrap break-words leading-relaxed text-[15px]',
            isLong && !expanded && 'line-clamp-6',
          )}
        >
          {text}
        </div>

        {isLong && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="relative z-[1] mt-1.5 flex items-center gap-1 text-[13px] font-semibold text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white transition-colors"
          >
            {expanded ? 'Show less' : 'Show more'}
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}

        {/* Attachments */}
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="relative z-[1] mt-3 flex flex-wrap gap-2 pt-3 border-t border-black/10 dark:border-white/10">
            {msg.attachments.map((file, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 bg-black/5 dark:bg-white/5 rounded-lg border border-black/10 dark:border-white/10 max-w-[200px]">
                {file.type.startsWith('image/') ? (
                  <div className="w-8 h-8 rounded-md overflow-hidden flex-shrink-0">
                    <img src={file.url} alt={file.name} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-md bg-black/5 dark:bg-white/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-black/40 dark:text-white/40" />
                  </div>
                )}
                <div className="flex flex-col overflow-hidden">
                  <span className="text-[11px] text-black dark:text-white font-medium truncate">{file.name}</span>
                  <span className="text-[9px] text-black/40 dark:text-white/40">{(file.size / 1024).toFixed(0)} KB</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action row UNDER the bubble, pinned to its bottom-RIGHT edge.
          w-full + justify-end makes the alignment explicit — it can't drift
          left on any flex intrinsic-sizing quirk. Subtle by default
          (readable on touch, where there's no hover), brightening on hover. */}
      <div className="w-full flex items-center justify-end gap-1 mt-1.5 pr-1 opacity-60 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity">
        {/* Version arrows — only once there's an edit history */}
        {hasVersions && (
          <div className="flex items-center gap-0.5 mr-1 text-black/50 dark:text-white/50">
            <button
              onClick={() => onSelectVersion(msg.id, activeVersion - 1)}
              disabled={activeVersion <= 0}
              className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Previous version"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[12px] font-medium tabular-nums select-none">
              {activeVersion + 1}/{versionCount}
            </span>
            <button
              onClick={() => onSelectVersion(msg.id, activeVersion + 1)}
              disabled={activeVersion >= versionCount - 1}
              className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Next version"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <button
          onClick={handleCopy}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-black/45 dark:text-white/45 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          title="Copy"
        >
          {isCopied ? (
            <Check className="w-3.5 h-3.5 text-green-500 dark:text-green-400" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          )}
        </button>

        <button
          onClick={() => onEdit(msg)}
          disabled={isLoading}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-black/45 dark:text-white/45 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Edit"
        >
          <Edit className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};


const MessageActionButtons = ({ msg, onFeedback, onRegenerate, isLoading, onShare }: { msg: Message, onFeedback: (type: 'like' | 'dislike', id: string | number) => void, onRegenerate: (id: number) => void, isLoading: boolean, onShare?: () => Promise<string | null> }) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [isDisliked, setIsDisliked] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleCopy = () => {
    const text = typeof msg.content === 'string' ? msg.content : msg.content.text;
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    toast.success("Content copied to clipboard");
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!onShare) return;
    setIsShared(true);
    try {
      const shareUrl = await onShare();
      if (shareUrl) {
        navigator.clipboard.writeText(shareUrl);
        toast.success(
          <div className="flex flex-col gap-0.5">
            <p className="font-bold text-[13px]">Copied link to clipboard.</p>
            <p className="text-white/40 text-[11px]">Shared links can be viewed by anyone with the link.</p>
          </div>,
          { duration: 4000 }
        );
      } else {
        toast.error("Failed to generate share link.");
        setIsShared(false);
        return;
      }
    } catch {
      toast.error("Failed to generate share link.");
      setIsShared(false);
      return;
    }
    setTimeout(() => setIsShared(false), 3000);
  };

  const handleLike = () => {
    setIsLiked(true);
    onFeedback('like', msg.id.toString());
    setTimeout(() => setIsLiked(false), 1500);
  };

  const handleDislike = () => {
    setIsDisliked(true);
    onFeedback('dislike', msg.id.toString());
    setTimeout(() => setIsDisliked(false), 1500);
  };

  // Regenerate spin animation is driven by onRegenerate triggering the modal

  return (
    <div className={cn("mt-5 flex flex-wrap items-center gap-2 max-w-full transition-opacity", isLoading ? "opacity-30 pointer-events-none" : "group-hover/msg:opacity-100")}>
      <div className="inline-flex items-center gap-1.5 p-1.5 bg-boult-elevated border border-boult-border rounded-full backdrop-blur-md">
        {/* Copy Button */}
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              onClick={handleCopy}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-all text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white relative"
            >
              <AnimatePresence mode="wait">
                {isCopied ? (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} key="check">
                    <Check className="w-4 h-4 text-green-400" />
                  </motion.div>
                ) : (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} key="copy">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          </TooltipTrigger>
          <TooltipContent className="bg-white dark:bg-boult-surface-hover border-black/10 dark:border-boult-border text-black dark:text-white rounded-xl px-3 py-2 shadow-2xl">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold">Copy text</span>
              <span className="text-black/20 dark:text-white/20 text-[10px] font-mono">⌘C</span>
            </div>
          </TooltipContent>
        </Tooltip>

        {/* Share Button */}
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              onClick={handleShare}
              className={cn(
                "w-8 h-8 flex items-center justify-center rounded-full transition-all relative",
                isShared ? "bg-black/10 dark:bg-white/10 text-black dark:text-white" : "hover:bg-black/5 dark:hover:bg-white/10 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
              )}
            >
              <AnimatePresence mode="wait">
                {isShared ? (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} key="check-share">
                    <Check className="w-4 h-4" />
                  </motion.div>
                ) : (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} key="share">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          </TooltipTrigger>
          <TooltipContent className="bg-white dark:bg-boult-surface-hover border-black/10 dark:border-boult-border text-black dark:text-white rounded-xl px-3 py-2 shadow-2xl">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold">Share link</span>
              <span className="text-black/20 dark:text-white/20 text-[10px] font-mono">⌘L</span>
            </div>
          </TooltipContent>
        </Tooltip>

        {/* Like Button */}
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              onClick={handleLike}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-all text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
            >
              <motion.div
                animate={isLiked ? { scale: [1, 1.3, 1], color: '#4ade80' } : {}}
                transition={{ duration: 0.4 }}
              >
                <svg className="w-4 h-4" fill={isLiked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>
              </motion.div>
            </button>
          </TooltipTrigger>
          <TooltipContent className="bg-white dark:bg-boult-surface-hover border-black/10 dark:border-boult-border text-black dark:text-white rounded-xl px-3 py-2 shadow-2xl">
            <span className="text-[11px] font-bold">Helpful</span>
          </TooltipContent>
        </Tooltip>

        {/* Dislike Button */}
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              onClick={handleDislike}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-all text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
            >
              <motion.div
                animate={isDisliked ? { scale: [1, 1.3, 1], color: '#f87171' } : {}}
                transition={{ duration: 0.4 }}
              >
                <svg className="w-4 h-4" fill={isDisliked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" /></svg>
              </motion.div>
            </button>
          </TooltipTrigger>
          <TooltipContent className="bg-white dark:bg-boult-surface-hover border-black/10 dark:border-boult-border text-black dark:text-white rounded-xl px-3 py-2 shadow-2xl">
            <span className="text-[11px] font-bold">Not helpful</span>
          </TooltipContent>
        </Tooltip>

        {/* Regenerate Button */}
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              onClick={() => onRegenerate(msg.id as number)}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-all text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
            >
              <motion.div
                animate={isRegenerating ? { rotate: 360 } : {}}
                transition={{ duration: 0.6, ease: "easeInOut" }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </motion.div>
            </button>
          </TooltipTrigger>
          <TooltipContent className="bg-white dark:bg-boult-surface-hover border-black/10 dark:border-boult-border text-black dark:text-white rounded-xl px-3 py-2 shadow-2xl">
            <span className="text-[11px] font-bold">Regenerate</span>
          </TooltipContent>
        </Tooltip>
      </div>

      {(msg as any).meta?.durationMs && (
        <span className="text-[10px] font-mono text-white/20 ml-2">
          {(((msg as any).meta.durationMs) / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
};

export default function ChatInterface({
  initialConversationId = null,
  onConversationSelect,
  onNewChat,
  onConversationDelete,
  isEmbedded = false
}: ChatInterfaceProps) {
  type LiveThinkingStep = {
    id: string;
    label: string;
    status: 'pending' | 'active' | 'completed' | 'error';
    type: 'think' | 'search' | 'read' | 'analyze' | 'draft' | 'execute';
  };

  const router = useRouter();
  const [message, setMessage] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  // Prefill handed over from SiftToday's recommendation buttons. Drained on mount
  // and then AUTO-SENT by the effect after handleSend — previously this only
  // setMessage()'d, which the child prompt box never reads, so the action ran
  // nothing. Stored in state so we can fire handleSend once the chat has settled.
  const [pendingPrefill, setPendingPrefill] = useState<string | null>(null);

  // SiftToday → Boult prefill bridge. The home-feed action buttons stash a
  // prompt in sessionStorage before navigating here; we drain it on mount.
  useEffect(() => {
    try {
      const prefill = sessionStorage.getItem('boult_prefill');
      if (prefill) {
        sessionStorage.removeItem('boult_prefill');
        setPendingPrefill(prefill);
      }
    } catch { /* sessionStorage unavailable — ignore */ }
  }, []);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [newMessageIds, setNewMessageIds] = useState<Set<number>>(new Set());
  const [regenerateModal, setRegenerateModal] = useState<{ isOpen: boolean, msgId: number | null }>({ isOpen: false, msgId: null });
  // Edit-a-prompt modal. Editing resends and appends a new version to that
  // user turn; the arrows on the pill page between versions.
  const [editModal, setEditModal] = useState<{ isOpen: boolean; msgId: number | null; text: string }>({ isOpen: false, msgId: null, text: '' });
  const [isInitialMode, setIsInitialMode] = useState<boolean>(!initialConversationId);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState<number>(0);
  const [isUsageLimitModalOpen, setIsUsageLimitModalOpen] = useState(false);
  const [usageLimitModalData, setUsageLimitModalData] = useState<any>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isRewardsOpen, setIsRewardsOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(initialConversationId || null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [conversations, setConversations] = useState<{ [key: string]: Message[] }>({});
  const [isNewConversation, setIsNewConversation] = useState<boolean>(!initialConversationId);
  const [selectedEmails, setSelectedEmails] = useState<Email[]>([]);
  /**
   * Text the user highlighted in the Canvas document and sent over with
   * "Add to chat". Held as pending context until the next send, then attached
   * to that message and cleared — the same lifecycle as selectedEmails.
   */
  // Pinned text selections awaiting the next send — from the canvas document OR
  // from the chat transcript itself. `kind` drives only the wording (chip label
  // + how the passage is framed to the model); everything else is shared.
  const [canvasSelections, setCanvasSelections] = useState<Array<{ id: number; text: string; docTitle: string; kind?: 'canvas' | 'chat' }>>([]);
  const [chatTitle, setChatTitle] = useState<string>('');
  const [suggestionInput, setSuggestionInput] = useState<{ text: string; id: number } | undefined>(undefined);
  const [isTitleMenuOpen, setIsTitleMenuOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [isStarred, setIsStarred] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const titleMenuRef = useRef<HTMLDivElement>(null);

  // Close title menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (titleMenuRef.current && !titleMenuRef.current.contains(event.target as Node)) {
        setIsTitleMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Inline conversation rename (replaces the native prompt()). Focus + select the
  // input the moment editing starts so the user can just type.
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const commitTitle = () => {
    const next = capitalizeTitle(titleDraft);
    setIsEditingTitle(false);
    if (!next || next === chatTitle) return;
    setChatTitle(next);
    if (currentConversationId) {
      try {
        localStorage.setItem(`conv_${currentConversationId}_title`, next);
        const raw = localStorage.getItem(`conversation_${currentConversationId}`);
        if (raw) {
          const data = JSON.parse(raw);
          data.title = next;
          localStorage.setItem(`conversation_${currentConversationId}`, JSON.stringify(data));
        }
      } catch { /* localStorage/JSON best-effort — the in-memory title still updates */ }
    }
    toast.success('Conversation renamed');
  };

  const [isIntegrationsModalOpen, setIsIntegrationsModalOpen] = useState<boolean>(false);

  // Auto-open the connectors modal when we land back from an OAuth redirect
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'connected') {
      setIsIntegrationsModalOpen(true);
      // Strip the query params so a refresh doesn't re-trigger the modal
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);
  const [isEmailSelectionModalOpen, setIsEmailSelectionModalOpen] = useState<boolean>(false);
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState<boolean>(false);
  const [isPersonalityModalOpen, setIsPersonalityModalOpen] = useState(false);
  const [savedPersonality, setSavedPersonality] = useState<string>('');
  const [instructionsEnabled, setInstructionsEnabled] = useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  // PART 45 — user-tunable voice + length prefs (loaded from /api/agent-talk/personality).
  const [communicationStyle, setCommunicationStyle] = useState<'direct' | 'balanced' | 'warm'>('warm');
  const [verbosity, setVerbosity] = useState<'brief' | 'normal' | 'detailed'>('normal');
  // PART 47 — Ask / Auto write-action mode, with the same persistence pattern.
  // Drives the prompt-box dropdown + the per-request body field on /api/boult/chat.
  const [actionMode, setActionMode] = useState<'ask' | 'auto'>('ask');
  const [gmailAccessToken, setGmailAccessToken] = useState<string | null>(null);
  const [gmailTokenSource, setGmailTokenSource] = useState<string | null>(null);
  const [isNotesQuery, setIsNotesQuery] = useState<boolean>(false);
  const [notesSearchQuery, setNotesSearchQuery] = useState<string>('');
  const [showNotesFetching, setShowNotesFetching] = useState<boolean>(false);
  const [notesResults, setNotesResults] = useState<any[]>([]);

  // Boult V2 State
  const [activeMission, setActiveMission] = useState<any>(null);
  const [liveThinkingBlocks, setLiveThinkingBlocks] = useState<ThinkingBlock[]>([]);
  const [currentThought, setCurrentThought] = useState<string | undefined>(undefined);
  const [pendingReplyProposal, setPendingReplyProposal] = useState<any>(null);

  // Boult view mode: 'feed' (default) or 'plan_mode' (daily brief)
  const [boultView, setBoultView] = useState<'feed' | 'plan_mode'>('feed');
  const [dashboardTab, setDashboardTab] = useState<'home' | 'agents'>('home');

  // Boult V3 Plan Mode Brief
  const {
    brief: planModeBrief,
    briefDate: planModeBriefDate,
    isLoading: isPlanModeLoading,
    generateNew: generateNewBrief,
  } = usePlanModeBrief();

  // Boult V3 Reactive Feed — surfaces webhook-driven plans in the chat
  const {
    activePlans: v3ActivePlans,
    completedPlans: v3CompletedPlans,
    buildPlan: v3BuildPlan,
    executePlan: v3ExecutePlan,
    dismissPlan: v3DismissPlan,
    refresh: v3Refresh,
  } = useBoultV3Feed({
    enabled: true,
    pollInterval: 30000,
    onNewPlan: (plan) => {
      toast.info(`Boult detected: ${plan.title}`, {
        description: plan.objective?.substring(0, 80),
        duration: 5000,
      });
    },
  });

  // Live thinking state (AI-generated, shown during loading)
  const [searchSessions, setSearchSessions] = useState<SearchSession[]>([]);

  // ... (inside the component)

  const normalizeIntentPlanBlock = (plan: any[], initialResponse?: string): ThinkingBlock => {
    return {
      id: 'main-work',
      title: plan[0]?.description || 'Executing requested task',
      status: 'active',
      initialContext: initialResponse,
      steps: plan.map((step: any, index: number) => ({
        id: `live-${step.step || index}`,
        label: step.action || step.description || `Working on step ${index + 1}`,
        status: 'pending' as const,
        type: (step.type || 'think') as any
      }))
    };
  };
  const [isThinkingStepsOpen, setIsThinkingStepsOpen] = useState<boolean>(false);

  // Canvas Panel state
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [showArtifactsPanel, setShowArtifactsPanel] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<{ isOpen: boolean, type: 'like' | 'dislike', msgId: string | number | null }>({ isOpen: false, type: 'like', msgId: null });
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [canvasData, setCanvasData] = useState<CanvasData | null>(null);
  const [isCanvasExecuting, setIsCanvasExecuting] = useState(false);
  const [activeRun, setActiveRun] = useState<{ runId: string; status?: string; phase?: string } | null>(null);
  const [isProcessingPlan, setIsProcessingPlan] = useState(false);
  const [isDeepThinkingState, setIsDeepThinkingState] = useState<boolean>(false);
  const [isSearchingState, setIsSearchingState] = useState<boolean>(false);

  // Agent Loop execution timeline state (Phase 2)
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [isAgentLoopActive, setIsAgentLoopActive] = useState(false);
  const [liveTaskList, setLiveTaskList] = useState<TaskList | null>(null);
  const [agentRunMeta, setAgentRunMeta] = useState<{ runId?: string; totalDurationMs?: number } | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<{ questions: AskQuestion[]; runId: string; planMode?: boolean } | null>(null);
  const [liveActivityLine, setLiveActivityLine] = useState<string>('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  const [userName, setUserName] = useState<string>('User');
  const [emailStats, setEmailStats] = useState({
    total: 0,
    drafted: 0,
    archived: 0,
    flagged: 0,
  });

  const [meetings, setMeetings] = useState<any[]>([]);
  const [actionItems, setActionItems] = useState<any[]>([]);
  const [scheduledAgents, setScheduledAgents] = useState<any[]>([]);
  const [isDashboardDataLoading, setIsDashboardDataLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const res = await fetch('/api/agent-talk/dashboard');
        if (res.ok) {
          const data = await res.json();
          if (data.userName) setUserName(data.userName.trim());
          setEmailStats(data.emailStats || emailStats);
          setMeetings(data.meetings || []);
          setActionItems(data.actionItems || []);
          setScheduledAgents(data.agents || []);
        }
      } catch (e) {
        console.error('Failed to fetch dashboard data', e);
      } finally {
        setIsDashboardDataLoading(false);
      }
    }
    fetchDashboardData();
  }, []);



  // Subscription state - to hide upgrade button for Pro users
  const [currentPlan, setCurrentPlan] = useState<'free' | 'starter' | 'pro' | 'none' | null>(null);
  const [isSharingGlobal, setIsSharingGlobal] = useState(false);
  // Audio & Notification State
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Sync notification state and request permission
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedNotify = localStorage.getItem('boult_notifications_enabled') === 'true';
      const savedSound = localStorage.getItem('boult_sound_enabled') !== 'false';

      setNotificationsEnabled(savedNotify && NotificationService.permission === 'granted');
      setSoundEnabled(savedSound);
      audioRuntime.setEnabled(savedSound);
    }
  }, []);

  const toggleNotifications = async () => {
    const isGranted = await NotificationService.requestPermission();
    if (isGranted) {
      setNotificationsEnabled(true);
      localStorage.setItem('boult_notifications_enabled', 'true');
    }
  };

  const toggleSound = () => {
    const newState = !soundEnabled;
    setSoundEnabled(newState);
    audioRuntime.setEnabled(newState);
    localStorage.setItem('boult_sound_enabled', String(newState));
  };

  // Global Click Sound Listener
  const isMountedRef = useRef(false);
  useEffect(() => {
    // Small delay to prevent sounds on initial mount/auto-navigation
    const timer = setTimeout(() => {
      isMountedRef.current = true;
    }, 500);

    const handleGlobalClick = (e: MouseEvent) => {
      if (!isMountedRef.current) return;

      const target = e.target as HTMLElement;
      // Play sound if clicking a button, link, or role="button"
      if (
        target.closest('button') ||
        target.closest('a') ||
        target.getAttribute('role') === 'button' ||
        target.closest('.interactive-card')
      ) {
        audioRuntime.playClick();
      }
    };

    window.addEventListener('click', handleGlobalClick);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleGlobalClick);
    };
  }, [soundEnabled]);

  const [boultCredits, setBoultCredits] = useState<{
    usage: number;
    limit: number;
    remaining: number;
    period: 'daily' | 'monthly';
    isUnlimited?: boolean;
  } | null>(null);

  const canvasResolversRef = useRef<Record<number, (approved: boolean) => void>>({});

  const handleAcceptCanvas = useCallback((msgId: number) => {
    setMessages(prev => prev.map(m => {
      if (m.id === msgId && m.type === 'agent') {
        const agentMsg = m as AgentMessage;
        if (agentMsg.meta?.canvasApproval) {
          const approval = agentMsg.meta.canvasApproval;
          if (approval.canvasData) {
            setCanvasData(approval.canvasData);
            setIsCanvasOpen(true);
          }
          return {
            ...agentMsg,
            meta: {
              ...agentMsg.meta,
              canvasApproval: { ...approval, status: 'accepted' as const }
            }
          } as AgentMessage;
        }
      }
      return m;
    }));

    if (canvasResolversRef.current[msgId]) {
      canvasResolversRef.current[msgId](true);
      delete canvasResolversRef.current[msgId];
    }

    toast.success('Mission accepted', { description: 'Opening Boult Workspace...' });
    
    // Resume agent loop with approval
    setTimeout(() => {
      processAgentLoopMessage("I approve opening the canvas. Please proceed with the task in the canvas.", currentConversationId as string, false);
    }, 500);
  }, [currentConversationId]);

  const handleDeclineCanvas = useCallback((msgId: number) => {
    setMessages(prev => prev.map(m => {
      if (m.id === msgId && m.type === 'agent') {
        const agentMsg = m as AgentMessage;
        if (agentMsg.meta?.canvasApproval) {
          return {
            ...agentMsg,
            meta: {
              ...agentMsg.meta,
              canvasApproval: { ...agentMsg.meta.canvasApproval, status: 'declined' as const }
            }
          } as AgentMessage;
        }
      }
      return m;
    }));

    if (canvasResolversRef.current[msgId]) {
      canvasResolversRef.current[msgId](false);
      delete canvasResolversRef.current[msgId];
    }

    toast.info('Mission declined', { description: 'Continuing in chat mode.' });

    // Resume agent loop with denial
    setTimeout(() => {
      processAgentLoopMessage("I decline opening the canvas. Please proceed with the task in plain chat.", currentConversationId as string, false);
    }, 500);
  }, [currentConversationId]);

  const handleContinueWithCredits = useCallback((msgId: number) => {
    // 1. Mark this message as continued to avoid double-clicks
    setMessages(prev => prev.map(m => {
      if (m.id === msgId && m.type === 'agent') {
        return { ...m, meta: { ...(m as AgentMessage).meta, continueClicked: true } };
      }
      return m;
    }));

    // 2. Add the "Continue" message to the UI
    const continueMsg: UserMessage = {
      id: nextMessageId(),
      type: 'user',
      role: 'user',
      content: "Continue",
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    };
    setMessages(prev => [...prev, continueMsg]);

    // 3. Trigger the AI
    if (currentConversationId) {
      processAIMessage("Continue", currentConversationId, false);
    }
  }, [currentConversationId]);

  const handleRegenerateClick = (msgId: number) => {
    setRegenerateModal({ isOpen: true, msgId });
  };

  const handleConfirmRegenerate = () => {
    const msgId = regenerateModal.msgId;
    if (msgId === null) return;

    // 1. Find the assistant message
    const assistantMsgIndex = messages.findIndex(m => m.id === msgId);
    if (assistantMsgIndex === -1) return;

    // 2. Find preceding user message
    const userMsgIndex = assistantMsgIndex - 1;
    if (userMsgIndex < 0 || messages[userMsgIndex].role !== 'user') {
      toast.error("Could not find original request to regenerate.");
      setRegenerateModal({ isOpen: false, msgId: null });
      return;
    }

    const userMsg = messages[userMsgIndex] as UserMessage;
    const messageText = userMsg.content;
    const attachments = userMsg.attachments;

    // 3. Remove assistant message
    const newMessages = messages.slice(0, assistantMsgIndex);
    setMessages(newMessages);

    // 4. Update localStorage
    if (currentConversationId) {
      const existingConversationRaw = localStorage.getItem(`conversation_${currentConversationId}`);
      if (existingConversationRaw) {
        try {
          const existingData = JSON.parse(existingConversationRaw);
          existingData.messages = newMessages;
          localStorage.setItem(`conversation_${currentConversationId}`, JSON.stringify(existingData));
        } catch (e) {
          console.error('Error updating storage for regeneration:', e);
        }
      }
    }

    // 5. Close modal and trigger AI
    setRegenerateModal({ isOpen: false, msgId: null });
    processAIMessage(messageText, currentConversationId as string, false, attachments);
  };

  // ── Edit a prompt + resend, with per-turn version history ───────────────────
  // Persist the current messages array to localStorage — shared by the edit and
  // version-switch flows so the branch state survives reload.
  const persistMessages = (msgs: Message[]) => {
    if (!currentConversationId) return;
    try {
      const raw = localStorage.getItem(`conversation_${currentConversationId}`);
      const data = raw ? JSON.parse(raw) : { id: currentConversationId, messages: [], title: chatTitle || '' };
      data.messages = msgs;
      data.lastUpdated = new Date().toISOString();
      localStorage.setItem(`conversation_${currentConversationId}`, JSON.stringify(data));
    } catch (e) {
      console.error('Error persisting messages:', e);
    }
  };

  const handleEditClick = (msg: UserMessage) => {
    setEditModal({ isOpen: true, msgId: msg.id, text: msg.content });
  };

  const handleEditSubmit = () => {
    const { msgId, text } = editModal;
    if (msgId === null) return;
    if (isLoading || isAgentLoopActive) { toast.error('Wait for the current reply to finish.'); return; }
    const edited = text.trim();
    if (!edited) { toast.error("Message can't be empty."); return; }

    const userIndex = messages.findIndex(m => m.id === msgId);
    if (userIndex === -1 || messages[userIndex].role !== 'user') {
      setEditModal({ isOpen: false, msgId: null, text: '' });
      return;
    }
    const userMsg = messages[userIndex] as UserMessage;
    if (edited === userMsg.content) { setEditModal({ isOpen: false, msgId: null, text: '' }); return; }

    // The assistant reply that immediately follows this user turn (if any).
    const replyMsg = (messages[userIndex + 1] && messages[userIndex + 1].role === 'assistant')
      ? (messages[userIndex + 1] as AgentMessage)
      : null;

    // Seed the version history from the original turn on first edit. Build it
    // immutably — never mutate the version objects held in React state.
    const baseVersions: UserMessageVersion[] = userMsg.versions
      ? userMsg.versions
      : [{ content: userMsg.content, attachments: userMsg.attachments, reply: replyMsg }];
    // Keep the current active version's reply fresh before branching away.
    const curActive = userMsg.activeVersion ?? (baseVersions.length - 1);
    const existingVersions: UserMessageVersion[] = baseVersions.map((v, i) =>
      i === curActive ? { ...v, reply: replyMsg } : v,
    );

    existingVersions.push({ content: edited, attachments: userMsg.attachments, reply: null });
    const newActive = existingVersions.length - 1;

    const updatedUserMsg: UserMessage = {
      ...userMsg,
      content: edited,
      versions: existingVersions,
      activeVersion: newActive,
    };

    // Drop this turn's old assistant reply; the resend appends a fresh one.
    const truncated = messages.slice(0, userIndex);
    const withEditedUser = [...truncated, updatedUserMsg];
    setMessages(withEditedUser);
    persistMessages(withEditedUser);

    setEditModal({ isOpen: false, msgId: null, text: '' });
    // Resend — the completing reply lands as the newest assistant message and
    // is captured into this version the next time we switch or persist.
    // truncateFromId drops this turn's stale pre-edit prompt/reply from history.
    processAIMessage(edited, currentConversationId as string, false, userMsg.attachments, { truncateFromId: msgId });
  };

  const handleSelectVersion = (msgId: number, versionIndex: number) => {
    setMessages(prev => {
      const userIndex = prev.findIndex(m => m.id === msgId);
      if (userIndex === -1 || prev[userIndex].role !== 'user') return prev;
      const userMsg = prev[userIndex] as UserMessage;
      const versions = userMsg.versions;
      if (!versions || versionIndex < 0 || versionIndex >= versions.length) return prev;

      const curActive = userMsg.activeVersion ?? (versions.length - 1);
      if (versionIndex === curActive) return prev;

      // The assistant reply currently shown for this turn (live state — may be
      // fresher than the stored snapshot, e.g. just-streamed).
      const liveReply = (prev[userIndex + 1] && prev[userIndex + 1].role === 'assistant')
        ? (prev[userIndex + 1] as AgentMessage)
        : null;

      const nextVersions = versions.map((v, i) =>
        i === curActive ? { ...v, reply: liveReply } : v,
      );
      const target = nextVersions[versionIndex];

      const updatedUserMsg: UserMessage = {
        ...userMsg,
        content: target.content,
        attachments: target.attachments,
        versions: nextVersions,
        activeVersion: versionIndex,
      };

      // Rebuild: everything before the user turn, the swapped user message,
      // the target version's reply (if any), then everything AFTER this turn's
      // old reply (later turns are preserved).
      const before = prev.slice(0, userIndex);
      const hadReply = liveReply ? 1 : 0;
      const after = prev.slice(userIndex + 1 + hadReply);
      const rebuilt: Message[] = [
        ...before,
        updatedUserMsg,
        ...(target.reply ? [target.reply] : []),
        ...after,
      ];
      persistMessages(rebuilt);
      return rebuilt;
    });
  };

  // After an edit-resend finishes, capture the fresh assistant reply into the
  // active version so it survives reload and can be paged back to. Runs only
  // when idle (a completed reply) to avoid snapshotting a half-streamed one.
  useEffect(() => {
    if (isLoading || isAgentLoopActive) return;
    let changed = false;
    const next = messages.map((m, i) => {
      if (m.role !== 'user') return m;
      const u = m as UserMessage;
      if (!u.versions || u.versions.length < 2) return m;
      const active = u.activeVersion ?? (u.versions.length - 1);
      const reply = (messages[i + 1] && messages[i + 1].role === 'assistant')
        ? (messages[i + 1] as AgentMessage)
        : null;
      const stored = u.versions[active]?.reply ?? null;
      // Only write when the live reply is a real, finished message that differs
      // from what's stored (by id) — avoids an update loop.
      if (reply && !(reply as AgentMessage).meta?.isStreaming && stored?.id !== reply.id) {
        const versions = u.versions.map((v, vi) => vi === active ? { ...v, reply } : v);
        changed = true;
        return { ...u, versions };
      }
      return m;
    });
    if (changed) {
      setMessages(next);
      persistMessages(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAgentLoopActive, messages]);

  const refreshBoultCredits = useCallback(async (showToast = false) => {
    try {
      const res = await fetch('/api/subscription/usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureType: 'boult_ai', increment: false })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) return;

      const period: 'daily' | 'monthly' = data.period === 'monthly' ? 'monthly' : 'daily';
      const next: {
        usage: number;
        limit: number;
        remaining: number;
        period: 'daily' | 'monthly';
        isUnlimited?: boolean;
      } = {
        usage: Number(data.usage) || 0,
        limit: Number(data.limit) || 0,
        remaining: Number(data.remaining) || 0,
        period,
        isUnlimited: !!data.isUnlimited
      };

      setBoultCredits(next);

      if (showToast && !next.isUnlimited && next.limit > 0) {
        toast.success('Credits Updated', {
          description: `Boult AI: ${next.usage}/${next.limit} used (${next.remaining} left ${next.period === 'daily' ? 'today' : 'this month'})`
        });
      }
    } catch {
      // ignore
    }
  }, []);


  // Fetch subscription status on mount and activate pending plans
  useEffect(() => {
    const fetchAndActivateSubscription = async () => {
      try {
        // First, check if there's a pending plan that needs activation (user returned from Whop)
        const pendingPlan = localStorage.getItem('pending_plan');
        const pendingTimestamp = localStorage.getItem('pending_plan_timestamp');

        // If there's a pending plan from less than 1 hour ago, activate it
        if (pendingPlan && pendingTimestamp) {
          const timestamp = parseInt(pendingTimestamp);
          const oneHourAgo = Date.now() - (60 * 60 * 1000);

          if (timestamp > oneHourAgo) {
            console.log('🔄 Found pending plan, activating:', pendingPlan);

            // Activate the subscription
            const activateResponse = await fetch('/api/subscription/status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ planType: pendingPlan })
            });

            if (activateResponse.ok) {
              console.log('✅ Subscription activated successfully!');
              // Clear pending plan after successful activation
              localStorage.removeItem('pending_plan');
              localStorage.removeItem('pending_plan_timestamp');
            }
          } else {
            // Pending plan is too old, clear it
            localStorage.removeItem('pending_plan');
            localStorage.removeItem('pending_plan_timestamp');
          }
        }

        // Now fetch current subscription status
        const response = await fetch('/api/subscription/status');
        if (response.ok) {
          const data = await response.json();
          if (data.subscription?.hasActiveSubscription || data.subscription?.planType === 'free') {
            setCurrentPlan(data.subscription.planType as 'free' | 'starter' | 'pro');
          } else {
            setCurrentPlan('none');
          }
        }

        await refreshBoultCredits(false);
      } catch (error) {
        console.error('Error in subscription flow:', error);
        setCurrentPlan('none');
      }
    };
    fetchAndActivateSubscription();
  }, []);

  const [showDraftBox, setShowDraftBox] = useState<boolean>(false);

  // Integration status
  const [integrations, setIntegrations] = useState<{
    gmail: boolean;
    'google-calendar': boolean;
    'google-meet': boolean;
  }>({
    gmail: false,
    'google-calendar': false,
    'google-meet': false
  });

  // Derived list of connected integration IDs for components that need it
  const connectedIntegrationIds = [
    integrations.gmail && 'gmail',
    integrations['google-calendar'] && 'gcal',
    integrations['google-meet'] && 'gcal',
  ].filter(Boolean) as string[];

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  const shortcuts = useKeyboardShortcuts({
    enabled: true,
    onFocusInput: () => {
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="Boult"]') ||
        document.querySelector<HTMLTextAreaElement>('textarea');
      textarea?.focus();
    },
    onSend: () => {
      const sendBtn = document.querySelector<HTMLButtonElement>('[aria-label="Send"], button[type="submit"]');
      sendBtn?.click();
    },
    onCloseCanvas: () => { setIsCanvasOpen(false); setShowShortcutsModal(false); },
    onNewChat: () => startNewChat(),
    onShowShortcuts: () => setShowShortcutsModal(prev => !prev),
    onMorningBrief: () => {
      setSuggestionInput({ text: 'Give me a morning briefing — summarize my inbox, flag urgent emails, and list follow-ups.', id: Date.now() });
    },
    onFollowUps: () => {
      setSuggestionInput({ text: 'Check my sent emails from the last week and find any that haven\'t gotten a reply.', id: Date.now() });
    },
    onCopyLastResponse: () => {
      const lastAgentMsg = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAgentMsg) {
        const text = typeof lastAgentMsg.content === 'string' ? lastAgentMsg.content : (lastAgentMsg.content as any)?.text ?? '';
        if (text) { navigator.clipboard.writeText(text); toast.success('Last response copied'); }
      }
    },
    onToggleSidebar: () => setIsSidebarCollapsed(prev => !prev),
    onEscapeAction: () => {
      if (showShortcutsModal) { setShowShortcutsModal(false); return; }
      if (isCanvasOpen) { setIsCanvasOpen(false); return; }
    },
  });

  // --- Helper Functions (Hoisted up for usage in useEffect) ---

  const generateConversationId = () => {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substr(2, 9);
    return `conv_${timestamp}_${randomStr}`;
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data:*/ *;base64, prefix for the raw base64 if needed, 
        // but for OpenRouter it's usually better to keep the data URL or just the base64.
        // Let's keep the full data URL for now.
        resolve(result);
      };
      reader.onerror = error => reject(error);
    });
  };

  const saveConversationToStorage = (conversationId: string, messages: Message[], title: string) => {
    const accurateMessageCount = messages.length;
    const conversationData = {
      id: conversationId,
      title: title,
      messages: messages,
      lastUpdated: new Date().toISOString(),
      messageCount: accurateMessageCount
    };
    localStorage.setItem(`conversation_${conversationId}`, JSON.stringify(conversationData));
    localStorage.setItem(`conv_${conversationId}_title`, title);
  };

  // Generate AI-powered chat title based on user's first message
  const generateChatTitle = async (userMessage: string): Promise<string> => {
    try {
      const response = await fetch('/api/agent-talk/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.title && data.title.length > 0) {
          const capitalized = capitalizeTitle(data.title);
          console.log('🏷️ AI-generated chat title:', capitalized);
          setChatTitle(capitalized);
          return capitalized;
        }
      }
    } catch (error) {
      console.error('Error generating chat title:', error);
    }

    // Fallback: Use first words of message
    const fallbackTitle = userMessage.trim().split(' ').slice(0, 5).join(' ');
    const rawFallback = fallbackTitle.length > 40 ? fallbackTitle.substring(0, 40) + '...' : fallbackTitle;
    return capitalizeTitle(rawFallback);
  };

  const handleGlobalShare = async () => {
    if (messages.length === 0) {
      toast.error("Nothing to share yet. Start a conversation first!");
      return;
    }

    setIsSharingGlobal(true);
    try {
      const response = await fetch('/api/agent-talk/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: currentConversationId,
          messages: messages,
          title: chatTitle
        })
      });

      if (!response.ok) throw new Error("Failed to generate share link");

      const data = await response.json();
      const shareUrl = data.shareUrl;

      // Copy to clipboard
      await navigator.clipboard.writeText(shareUrl);
      
      toast.success("Share link copied!", {
        description: "Anyone with this link can view this conversation."
      });
    } catch (error) {
      console.error('Share error:', error);
      toast.error("Could not generate share link. Please try again.");
    } finally {
      setIsSharingGlobal(false);
    }
  };

  const buildFallbackThinkingBlocks = (messageText: string): ThinkingBlock[] => {
    const emailRelated = isEmailRelatedQuery(messageText);
    const notesRelated = isNotesRelatedQuery(messageText);

    return [{
      id: 'fallback-block',
      title: 'Planning and initialization',
      status: 'active',
      initialContext: 'Identifying the most efficient roadmap to fulfill your objective...',
      steps: [
        { id: 'fb-1', label: 'Analyzing intent', status: 'active', type: 'think' },
        { id: 'fb-2', label: notesRelated ? 'Retrieving notes' : emailRelated ? 'Searching Gmail' : 'Checking context', status: 'pending', type: emailRelated ? 'search' : 'read' }
      ]
    }];
  };

  const normalizeIntentPlanSteps = (plan: any[]): LiveThinkingStep[] =>
    plan.map((step: any, index: number) => ({
      id: `live-${step.step || index}`,
      label: step.description || step.action || `Working on step ${index + 1}`,
      status: index === 0 ? 'active' : 'pending',
      type: (step.type || 'think') as LiveThinkingStep['type']
    }));


  const formatStepEvidence = (evidence: any): string => {
    if (!evidence) return '';
    const items = Array.isArray(evidence) ? evidence : (Array.isArray(evidence.items) ? evidence.items : []);
    if (!items.length) return '';
    return items.slice(0, 4).map((item: any) => {
      const sender = item.sender || 'Unknown';
      const subject = item.subject || '';
      const thread = item.threadId ? ('Thread: ' + item.threadId) : '';
      return [sender, subject, thread].filter(Boolean).join(' | ');
    }).join('\\n');
  };

  const getStepLabel = (tool: string, params: any, status: 'active' | 'completed' | 'error') => {
    const isActive = status === 'active';
    switch (tool) {
      // Legacy tool names
      case 'search_inbox': return isActive ? `Searching emails${params?.query ? ` for "${params.query}"` : '...'}` : `Searched emails${params?.query ? ` for "${params.query}"` : ''}`;
      case 'search_web': return isActive ? `Researching web${params?.query ? ` for "${params.query}"` : '...'}` : `Researched web${params?.query ? ` for "${params.query}"` : ''}`;
      case 'read_browser_page': return isActive ? `Visiting ${params?.url || 'page'}...` : `Visited ${params?.url || 'page'}`;
      case 'save_draft': return isActive ? 'Drafting response...' : 'Drafted response';
      case 'create_note': return isActive ? 'Creating note...' : 'Created note';
      case 'search_notes': return isActive ? 'Searching notes...' : 'Searched notes';
      // New Boult rebuild tool names
      case 'search_gmail': return isActive ? `Searching inbox${params?.query ? ` for "${params.query}"` : '...'}` : `Searched inbox${params?.query ? ` for "${params.query}"` : ''}`;
      case 'read_email': return isActive ? 'Reading email thread...' : 'Read email thread';
      case 'get_sent_emails': return isActive ? 'Analyzing your writing style...' : 'Analyzed writing style';
      case 'draft_reply': return isActive ? `Drafting reply${params?.subject ? ` to "${params.subject}"` : '...'}` : `Drafted reply${params?.subject ? ` to "${params.subject}"` : ''}`;
      case 'send_email': return isActive ? 'Sending email...' : 'Sent email';
      case 'request_confirmation': return isActive ? 'Waiting for your approval…' : 'Confirmation requested';
      case 'schedule_meeting': return isActive ? `Scheduling meeting${params?.title ? ` "${params.title}"` : '...'}` : `Scheduled meeting${params?.title ? ` "${params.title}"` : ''}`;
      case 'get_calendar_events': return isActive ? 'Reading your calendar...' : 'Read calendar';
      case 'search_notion': return isActive ? `Searching Notion${params?.query ? ` for "${params.query}"` : '...'}` : `Searched Notion${params?.query ? ` for "${params.query}"` : ''}`;
      case 'create_notion_page': return isActive ? `Creating page${params?.title ? ` "${params.title}"` : '...'}` : `Created page${params?.title ? ` "${params.title}"` : ''}`;
      case 'open_canvas': return isActive ? `Opening canvas${params?.title ? ` "${params.title}"` : '...'}` : `Opened canvas${params?.title ? ` "${params.title}"` : ''}`;
      case 'web_search': return isActive ? `Searching web${params?.query ? ` for "${params.query}"` : '...'}` : `Searched web${params?.query ? ` for "${params.query}"` : ''}`;
      case 'send_slack_message': return isActive ? `Sending Slack message${params?.channel ? ` to ${params.channel}` : '...'}` : `Sent Slack message${params?.channel ? ` to ${params.channel}` : ''}`;
      // Fallback: every other tool goes through the shared human-label map
      // (lib/boult/tool-labels), so the activity feed always reads like an
      // employee narrating work — never `Running gmail_bulk_read_threads...`.
      default: {
        const label = humanizeToolName(tool);
        return isActive ? `${toActiveVoice(label)}…` : label;
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT LOOP — SSE-based agentic processing (Phase 1)
  // ═══════════════════════════════════════════════════════════════════════════
  const processAgentLoopMessage = async (messageText: string, conversationIdToUse: string, isNew: boolean, options: any = {}, attachments?: Array<{ name: string; url: string; type: string; size?: number }>) => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    const assistantMsgId = nextMessageId();
    // When an answer to a clarifying question comes back, the API gets the
    // full "Q: … / A: …" context (messageText) but the transcript shows only
    // the clean answer (displayText). Persistence must match the transcript.
    const displayedUserText: string = (options.displayText || messageText);

    setIsLoading(true);
    setIsAgentLoopActive(true);
    setLiveActivityLine('');
    setLiveThinkingBlocks([]);
    setLiveTaskList(null);

    // Seed the step tracker with an initial "understanding" pill so the user
    // sees meaningful feedback from the very first frame, before any SSE events.
    const initThinkingStep: AgentStep = {
      id: 'al-init-thinking',
      type: 'thinking',
      tool: 'thinking',
      label: 'Understanding your request…',
      status: 'active',
      startedAt: Date.now(),
      iteration: 0,
      params: {},
    };
    setAgentSteps([initThinkingStep]);

    // Add placeholder assistant message
    const placeholderMsg: AgentMessage = {
      id: assistantMsgId,
      type: 'agent',
      role: 'assistant',
      content: { text: '', list: [], footer: '' },
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      meta: { actionType: 'agent_loop', isStreaming: true, liveThinking: 'Thinking...', agentSteps: [initThinkingStep] }
    };
    setMessages(prev => [...prev, placeholderMsg]);

    // Build conversation history from current messages to give Boult memory
    // G4 — Wider context: keep the last 40 turns instead of 20 so long
    // threads, multi-step approvals, and earlier instructions stay in scope.
    // 40 × ~200 tokens = ~8k of conversation history — well within budget.
    // On an edit-resend, the closure `messages` is stale (still holds the old
    // prompt + its old reply for this turn). truncateFromId drops that turn and
    // everything after it so the model doesn't see the pre-edit version as
    // history — the edited prompt is passed separately as messageText.
    const truncIdx = options.truncateFromId != null
      ? messages.findIndex(m => m.id === options.truncateFromId)
      : -1;
    const historySource = truncIdx >= 0 ? messages.slice(0, truncIdx) : messages;
    const history = historySource
      .filter(m => m.id !== assistantMsgId && (m.role === 'user' || m.role === 'assistant'))
      .slice(-40)
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.role === 'user'
          ? ((m as UserMessage).content || '')
          : ((m as AgentMessage).content as any)?.text || '',
      }))
      .filter(h => h.content);

    try {
      const response = await fetch('/api/boult/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageText,
          conversationId: conversationIdToUse,
          history,
          isPlanMode: options.isPlanMode || false,
          // F12 — Forward attachments so the backend can build vision content blocks.
          attachments: attachments || [],
          // PART 47 — per-request override of the saved action mode (Ask / Auto).
          // When 'auto', the chat route sets skipConfirmations=true on the run.
          ...(options.actionMode === 'ask' || options.actionMode === 'auto'
            ? { actionMode: options.actionMode }
            : {}),
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (errData?.error === 'limit_reached') {
          setUsageLimitModalData({ featureName: 'Ask AI', currentUsage: errData.usage || 0, limit: errData.limit || 0, period: errData.period || 'daily', currentPlan: errData.planType || 'starter' });
          setIsUsageLimitModalOpen(true);
        }
        throw new Error(errData.message || `Request failed (${response.status})`);
      }

      if (!response.body) throw new Error('No stream body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';
      let finalContent = '';
      let finalProcessedText = '';
      let rawOutput = '';
      let stepIndex = 0;
      let streamFinishedNormally = false;
      let hadQuestionEvent = false;
      let questionBubbleText = '';   // question text shown as the assistant reply
      let switchedToPlanMode = false; // AI called switch_to_plan_mode — re-run in plan mode
      let runDeadlineHit = false;     // loop ran out of time/tool budget mid-task → auto-continue
      let hadPlanEvent = false;
      let currentAgentSteps: AgentStep[] = [initThinkingStep]; // seed with the thinking pill
      let currentAgentNarratives: AgentNarrative[] = []; // populated by narrative events
      let currentTaskList: TaskList | null = null;    // populated by task_list event
      let currentPlanText = '';                       // populated by plan_text event
      let currentCanvasResult: any = null;            // populated by canvas event (reports/docs)
      let currentScheduledAgent: ScheduledAgentData | null = null; // populated by canvas scheduled_agent
      let currentIntegrationRequired: IntegrationRequiredData | null = null; // populated by canvas integration_required
      let currentActionResult: any = null;            // populated by canvas notion_page / calendar_event
      let currentDraftReply: any = null;              // populated by canvas email_draft
      let streamedDraftCount = 0;                     // # of email_draft canvases seen this turn (for the cut-off fallback)

      // Stall guard — if the stream goes silent for 90s (hung model call,
      // dead connection the browser never surfaces), stop reading and let
      // the "finished unexpectedly" path below finalize the message. Without
      // this a stalled run sat live forever, wasting the user's time.
      const STALL_TIMEOUT_MS = 90_000;
      let stalled = false;

      while (true) {
        let stallTimer: ReturnType<typeof setTimeout> | undefined;
        const readResult = await Promise.race([
          reader.read(),
          new Promise<'__stalled__'>(resolve => {
            stallTimer = setTimeout(() => resolve('__stalled__'), STALL_TIMEOUT_MS);
          }),
        ]);
        clearTimeout(stallTimer);
        if (readResult === '__stalled__') {
          stalled = true;
          try { reader.cancel(); } catch { /* already closed */ }
          break;
        }
        const { done, value } = readResult;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith('data: ') || !currentEventType) continue;

          let data: any;
          try { data = JSON.parse(line.slice(6).trim()); } catch { continue; }

          switch (currentEventType) {
            case 'run_start':
              // No step added — just update the thinking label
              setMessages(msgs => msgs.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                return { ...m, meta: { ...(m.meta || {}), liveThinking: 'Thinking...' } };
              }));
              break;

            case 'conversational':
              // FAST PATH: this is casual chat, not a task. Drop the seed
              // "Understanding…" step entirely so the reply lands with NO
              // processing card — just a warm answer, like a person texting back.
              currentAgentSteps = [];
              setAgentSteps([]);
              setMessages(msgs => msgs.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                return { ...m, meta: { ...(m.meta || {}), agentSteps: [], liveThinking: '' } };
              }));
              break;

            case 'task_list': {
              if (Array.isArray(data.tasks) && data.tasks.length > 0) {
                currentTaskList = { tasks: data.tasks, completedCount: 0 };
                setLiveTaskList(currentTaskList);
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return { ...m, meta: { ...(m.meta || {}), taskList: currentTaskList! } };
                }));
              }
              break;
            }

            case 'progress': {
              // PART 8 #1 — bulk-operation live progress. The loop emits
              // start / update / complete phases when ≥3 same-tool calls fire
              // in one batch. We render the phases as stacked lines in a
              // single live block at the top of the assistant message.
              const phase = (data.phase || 'update') as 'start' | 'update' | 'complete';
              const current = typeof data.current === 'number' ? data.current : 0;
              const total = typeof data.total === 'number' ? data.total : 0;
              const label = typeof data.label === 'string' ? data.label : 'items';
              const line =
                phase === 'start'
                  ? `Writing ${total} ${label}…`
                  : phase === 'complete'
                    ? `${total} ${label} ready.`
                    : `${current} of ${total} ${label} done…`;
              setMessages(msgs => msgs.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                const prev = ((m as AgentMessage).meta?.progressLines || []) as string[];
                // Skip if identical to the last line (network races can repeat)
                if (prev.length && prev[prev.length - 1] === line) return m;
                return { ...m, meta: { ...(m.meta || {}), progressLines: [...prev, line] } };
              }));
              break;
            }

            case 'task_progress': {
              const completed = typeof data.completedCount === 'number' ? data.completedCount : 0;
              if (currentTaskList) {
                currentTaskList = { tasks: currentTaskList.tasks, completedCount: completed };
                setLiveTaskList({ ...currentTaskList });
              }
              setMessages(msgs => msgs.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                const existing = (m as AgentMessage).meta?.taskList;
                if (!existing) return m;
                return { ...m, meta: { ...(m.meta || {}), taskList: { ...existing, completedCount: completed } } };
              }));
              break;
            }

            case 'thinking': {
              const thinkStatus = data.status || data.step || 'Thinking...';
              // Update the label on the initial thinking step pill while it's still active.
              if (currentAgentSteps.length > 0 && currentAgentSteps[0].id === 'al-init-thinking' && currentAgentSteps[0].status === 'active') {
                currentAgentSteps = currentAgentSteps.map(s =>
                  s.id === 'al-init-thinking' ? { ...s, label: thinkStatus } : s
                );
                setAgentSteps(currentAgentSteps);
              }
              setMessages(msgs => msgs.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                return { ...m, meta: { ...(m.meta || {}), liveThinking: thinkStatus, agentSteps: currentAgentSteps } };
              }));
              break;
            }

            case 'plan_text': {
              if (data.content) {
                currentPlanText = data.content;
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return { ...m, meta: { ...(m.meta || {}), planText: data.content } };
                }));
              }
              break;
            }

            case 'canvas': {
              const cv = data;
              if (!cv?.title) break;

              // ── Scheduled agent card ─────────────────────────────────────────
              // Created via create_scheduled_agent. Renders an inline card that
              // opens a detail sidebar; never opens the canvas panel.
              if (cv.type === 'scheduled_agent' && cv.pageMeta) {
                const a: string[] = cv.pageMeta.attendees || [];
                const scheduledAgent: ScheduledAgentData = {
                  id: cv.pageMeta.pageId || '',
                  name: cv.title,
                  task: cv.pageMeta.contentPreview || '',
                  scheduleLabel: a[0] || 'Scheduled',
                  cron: a[1] || '',
                  channel: a[2] || 'gmail',
                  skipConfirmations: a[3] === 'true',
                  status: a[4] || 'active',
                  nextRun: cv.pageMeta.startTime,
                };
                currentScheduledAgent = scheduledAgent;
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return { ...m, meta: { ...(m.meta || {}), scheduledAgent } };
                }));
                break;
              }

              // ── Integration required gate ────────────────────────────────────
              // Emitted when create_scheduled_agent detects missing integrations.
              if (cv.type === 'integration_required' && cv.pageMeta) {
                const pm = cv.pageMeta as any;
                const integrationRequired: IntegrationRequiredData = {
                  agentName: cv.title,
                  required: pm.required || [],
                  connected: pm.connected || [],
                  missing: pm.missing || [],
                  agentParams: pm.agentParams || {},
                };
                currentIntegrationRequired = integrationRequired;
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return { ...m, meta: { ...(m.meta || {}), integrationRequired } };
                }));
                break;
              }

              // ── Confirmation required card ───────────────────────────────────
              if (cv.type === 'confirmation_required' && cv.pageMeta) {
                const pm = cv.pageMeta as any;
                const confirmationData: ConfirmationData = {
                  action: pm.action || cv.title || 'Action',
                  description: pm.description || '',
                  why: pm.why || undefined,
                  details: pm.details || {},
                  // Threaded through so the card's Confirm click can POST to
                  // /api/boult/approval/confirm — without it the executor gate
                  // refuses the subsequent send/schedule/post/create call.
                  approvalId: pm.approvalId || undefined,
                };
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return { ...m, meta: { ...(m.meta || {}), confirmationData } };
                }));
                break;
              }

              // ── Agent spec confirmation (Stage 1) ────────────────────────────
              // Emitted by create_scheduled_agent Stage 1. Renders the spec
              // inside the canvas panel AND shows a chat-side card with
              // Confirm/Edit buttons. User clicks Confirm → frontend sends a
              // structured message that re-invokes the tool with _creationStage: "plan".
              if (cv.type === 'agent_spec_confirm' && cv.pageMeta) {
                const pm = cv.pageMeta as any;
                // Auto-open the canvas panel with the spec
                setCanvasData({
                  title: cv.title || pm.agentName,
                  type: 'report',
                  raw: cv.markdown || '',
                  content: cv.markdown || '',
                } as any);
                setIsCanvasOpen(true);
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return {
                    ...m,
                    meta: {
                      ...(m.meta || {}),
                      agentSpecConfirm: {
                        agentName: pm.agentName || cv.title,
                        specMarkdown: cv.markdown || '',
                        agentParams: pm.agentParams || {},
                      },
                    },
                  };
                }));
                break;
              }

              // ── Agent plan preview (Fix 7) ───────────────────────────────────
              if (cv.type === 'agent_plan_preview' && cv.pageMeta) {
                const pm = cv.pageMeta as any;
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return {
                    ...m,
                    meta: {
                      ...(m.meta || {}),
                      agentPlanPreview: {
                        agentName: pm.agentName || cv.title,
                        taskDescription: pm.taskDescription || '',
                        cronSchedule: pm.cronSchedule || '0 7 * * *',
                        outputChannel: pm.outputChannel || 'gmail',
                        agentPlan: pm.agentPlan,
                        agentParams: pm.agentParams || {},
                      },
                    },
                  };
                }));
                break;
              }

              // ── Action result cards (Notion page, Calendar event, Email sent) ───
              // These get a rich inline card rather than opening the canvas panel.
              // PART 8 #2 — Each card appends to actionResults so bulk operations
              // (e.g. 12 send_email tool calls in one run) stack as a vertical list
              // instead of last-write-wins replacing the previous card.
              const isActionCard =
                cv.type === 'notion_page' ||
                cv.type === 'calendar_event' ||
                cv.type === 'email_sent';
              if (isActionCard && cv.pageMeta) {
                const pm = cv.pageMeta as any;
                const nextCard = {
                  type: cv.type,
                  title: cv.title,
                  url: pm.url,
                  meetLink: pm.meetLink,
                  startTime: pm.startTime,
                  attendees: pm.attendees,
                  contentPreview: pm.contentPreview,
                  recipientName: pm.recipientName,
                  verbLabel: pm.verbLabel,
                };
                currentActionResult = nextCard;
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  const prevList = ((m as AgentMessage).meta?.actionResults || []) as any[];
                  return {
                    ...m,
                    meta: {
                      ...(m.meta || {}),
                      actionResult: nextCard,
                      actionResults: [...prevList, nextCard],
                    },
                  };
                }));
                break;
              }

              // ── Standard canvas panel (documents, email drafts, notes) ────────
              if (cv.markdown) {
                const canvasContent = cv.type === 'email_draft' && cv.draftMeta
                  ? cv.draftMeta
                  : cv.markdown;

                if (cv.type !== 'email_draft' && cv.type !== 'reply') {
                  setCanvasData({ type: cv.type || 'notes', title: cv.title, content: canvasContent, raw: cv.markdown, isUpdate: cv.isUpdate === true });
                  setIsCanvasOpen(true);
                }

                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  const draftReply = cv.type === 'email_draft' && cv.draftMeta
                    ? {
                        content: cv.draftMeta.body || '',
                        recipientEmail: cv.draftMeta.to || '',
                        recipientName: cv.draftMeta.recipientName || cv.draftMeta.to?.split('@')[0] || 'Recipient',
                        senderName: userName,
                        subject: cv.draftMeta.subject || cv.title || '',
                        threadId: cv.draftMeta.threadId,
                        gmailDraftId: cv.draftMeta.gmailDraftId,
                        voiceScore: (cv.draftMeta as any).voiceScore,
                        voiceCritique: (cv.draftMeta as any).voiceCritique,
                      }
                    : undefined;
                  if (draftReply) { currentDraftReply = draftReply; streamedDraftCount++; }

                  // PART 8 #5 — accumulate every draft this turn into draftReplies
                  // so the render block can swap to the gallery layout at 2+.
                  // Last-write-wins on draftReply (legacy single-draft path) is kept
                  // for backwards compat with the modal render code.
                  const prevDraftReplies: any[] = (m.meta?.draftReplies as any[]) || [];
                  const draftReplies = draftReply
                    ? [...prevDraftReplies, draftReply]
                    : prevDraftReplies;
                  currentCanvasResult = {
                    type: cv.type || 'notes',
                    title: cv.title || 'Action Results Summary',
                    canvasData: {
                      type: cv.type || 'notes',
                      title: cv.title || 'Action Results Summary',
                      content: canvasContent,
                      raw: cv.markdown,
                    },
                  };
                  return {
                    ...m,
                    meta: {
                      ...(m.meta || {}),
                      ...(draftReply ? { draftReply } : {}),
                      ...(draftReplies.length > 0 ? { draftReplies } : {}),
                      result: currentCanvasResult,
                    },
                  };
                }));
              }
              break;
            }

            case 'tool_call': {
              stepIndex++;
              const activeLabel = getStepLabel(data.tool, data.params, 'active');
              const nextToolCallSteps = currentAgentSteps.map(s =>
                s.status === 'active' ? { ...s, status: 'completed' as const, completedAt: Date.now(), label: getStepLabel(s.tool || '', s.params || {}, 'completed') } : s
              );
              nextToolCallSteps.push({
                id: `al-tool-${stepIndex}`,
                type: 'tool_call',
                tool: data.tool,
                label: activeLabel,
                // Narrated Execution Protocol: the model's own first-person line
                // for THIS call ("Scanning your inbox for unanswered investor
                // threads") — falls back to the raw param fragment for old runs.
                context: data.narration || data.params?.query || data.params?.message || data.params?.summary || data.params?.subject || '',
                status: 'active',
                startedAt: Date.now(),
                iteration: data.iteration,
                params: data.params
              });
              currentAgentSteps = nextToolCallSteps;
              setAgentSteps(nextToolCallSteps);
              setLiveActivityLine(data.narration || activeLabel);
              setMessages(msgs => msgs.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                // PART 10 Fix 6: update orchestration plan stepStatuses — mark matching step as 'running'
                const plan = (m as any).meta?.orchestrationPlan;
                const updatedStatuses = plan?.stepStatuses ? { ...plan.stepStatuses } : undefined;
                if (updatedStatuses && plan?.steps) {
                  const planStepIdx = (plan.steps as any[]).findIndex((s: any) =>
                    Array.isArray(s.tools) && s.tools.includes(data.tool)
                  );
                  if (planStepIdx >= 0 && updatedStatuses[planStepIdx] !== 'completed') {
                    updatedStatuses[planStepIdx] = 'running';
                  }
                }
                return {
                  ...m,
                  meta: {
                    ...(m.meta || {}),
                    thinkingComplete: true,
                    agentSteps: nextToolCallSteps,
                    ...(updatedStatuses && plan ? { orchestrationPlan: { ...plan, stepStatuses: updatedStatuses } } : {}),
                  },
                };
              }));
              break;
            }

            case 'tool_result': {
              const toolSuccess = data.success !== false;
              const nextResultSteps = currentAgentSteps.map(s =>
                s.status === 'active'
                  ? {
                      ...s,
                      status: toolSuccess ? 'completed' as const : 'error' as const,
                      completedAt: Date.now(),
                      summary: data.summary || `${data.tool} ${toolSuccess ? 'done' : 'failed'}`,
                      label: getStepLabel(s.tool || '', s.params || {}, toolSuccess ? 'completed' : 'error'),
                    }
                  : s
              );
              currentAgentSteps = nextResultSteps;
              setAgentSteps(nextResultSteps);
              setLiveActivityLine('');
              setMessages(msgs => msgs.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                // PART 10 Fix 6: update orchestration plan stepStatuses — mark matching step as completed/failed
                const plan = (m as any).meta?.orchestrationPlan;
                const updatedStatuses = plan?.stepStatuses ? { ...plan.stepStatuses } : undefined;
                if (updatedStatuses && plan?.steps) {
                  const planStepIdx = (plan.steps as any[]).findIndex((s: any) =>
                    Array.isArray(s.tools) && s.tools.includes(data.tool)
                  );
                  if (planStepIdx >= 0) {
                    updatedStatuses[planStepIdx] = toolSuccess ? 'completed' : 'failed';
                  }
                }
                // PART 31 — Extract Source items from the tool result and
                // append to meta.sources. Only on success and only when there
                // was useful data — failures and empty results don't earn a
                // source row.
                let nextSources = (m.meta as any)?.sources as SourceItem[] | undefined;
                if (toolSuccess && data.summary) {
                  const newItems = extractSourcesFromToolResult(data.tool || '', data.summary || '', data.params || {});
                  if (newItems.length) {
                    const existing = nextSources || [];
                    // De-dup by (category + title + url) to keep the panel tight
                    const seen = new Set(existing.map(s => `${s.category}|${s.title || ''}|${s.url || ''}`));
                    const merged = [...existing];
                    for (const item of newItems) {
                      const key = `${item.category}|${item.title || ''}|${item.url || ''}`;
                      if (!seen.has(key)) {
                        seen.add(key);
                        merged.push(item);
                      }
                    }
                    nextSources = merged;
                  }
                }
                return {
                  ...m,
                  meta: {
                    ...(m.meta || {}),
                    agentSteps: nextResultSteps,
                    ...(updatedStatuses && plan ? { orchestrationPlan: { ...plan, stepStatuses: updatedStatuses } } : {}),
                    ...(nextSources ? { sources: nextSources } : {}),
                  },
                };
              }));
              break;
            }

            case 'ack': {
              // The "on it…" opener — the model's first pre-tool line. Lands as
              // a PERMANENT chat line above the executor box (the transcript
              // reads: ack → steps → final report, like a person texting
              // "on it" and then delivering). Never cleared by done/message.
              if (data.text?.trim()) {
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return { ...m, meta: { ...(m.meta || {}), ackText: data.text.trim() } };
                }));
              }
              break;
            }

            case 'narrative': {
              // Intermediate narrative text emitted between tool call groups
              if (data.text?.trim()) {
                const narrative: AgentNarrative = { iteration: data.iteration ?? 0, text: data.text.trim() };
                currentAgentNarratives = [...currentAgentNarratives, narrative];
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  // Also feed narrative into liveThinking so AgentThinkingSection shows real AI reasoning
                  return { ...m, meta: { ...(m.meta || {}), agentNarratives: currentAgentNarratives, liveThinking: data.text.trim() } };
                }));
              }
              break;
            }

            case 'tool_error':
              const nextErrorSteps = currentAgentSteps.map(s =>
                s.status === 'active'
                  ? { ...s, status: 'error' as const, completedAt: Date.now(), summary: `Error: ${data.error}`, label: `Error: ${data.error}` }
                  : s
              );
              currentAgentSteps = nextErrorSteps;
              setAgentSteps(nextErrorSteps);
              setMessages(msgs => msgs.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                return { ...m, meta: { ...(m.meta || {}), agentSteps: nextErrorSteps } };
              }));
              break;

            case 'approval_required':
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                return {
                  ...m,
                  meta: {
                    ...(m.meta || {}),
                    isStreaming: false,
                    canvasApproval: {
                      status: 'pending',
                      title: `Approve ${data.tool}?`,
                      description: data.description || 'This action requires your approval to proceed.',
                      canvasData: {
                        content: data.params || {},
                        type: 'workflow'
                      }
                    },
                    actionType: data.tool,
                    actionPayload: data.params,
                    agentSteps: currentAgentSteps
                  }
                };
              }));
              break;

            case 'message': {
              // Mark the initial thinking step as completed when the final message arrives
              // (covers the case where no tool calls were made, so the step stayed active).
              if (currentAgentSteps.some(s => s.status === 'active')) {
                currentAgentSteps = currentAgentSteps.map(s =>
                  s.status === 'active'
                    ? { ...s, status: 'completed' as const, completedAt: Date.now(), label: s.id === 'al-init-thinking' ? 'Analyzed your request' : s.label }
                    : s
                );
                setAgentSteps(currentAgentSteps);
              }

              rawOutput += (data.content || '');
              const { thinking: liveThinkingText, cleanText: roadmapText } = extractThinking(rawOutput);
              finalContent = roadmapText;

              // Open canvas panel if the agent produced canvas content (excluding inline-card types)
              if (data.canvasContent && data.canvasContent.type !== 'email_draft' && data.canvasContent.type !== 'reply' && data.canvasContent.type !== 'scheduled_agent' && data.canvasContent.type !== 'integration_required' && data.canvasContent.type !== 'confirmation_required' && data.canvasContent.markdown) {
                const cv = data.canvasContent;
                // email_draft needs structured {to,subject,body} from draftMeta —
                // NOT the raw markdown (which wraps in a "[Open in Gmail]" footer
                // and leaves To/Subject blank). The tool returns `draftMeta`.
                const canvasContent = cv.type === 'email_draft' && cv.draftMeta
                  ? cv.draftMeta
                  : cv.markdown;
                setCanvasData({
                  type: cv.type || 'notes',
                  title: cv.title,
                  content: canvasContent,
                  raw: cv.markdown,
                });
                setIsCanvasOpen(true);
              }

              setMessages(prev => prev.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                
                // If this step produced canvas content, persist it under the message result metadata
                let extraMeta = {};
                if (data.canvasContent) {
                  const cv = data.canvasContent;
                  const canvasContent = cv.type === 'email_draft' && cv.draftMeta ? cv.draftMeta : cv.markdown;
                  extraMeta = {
                    result: {
                      type: cv.type || 'notes',
                      title: cv.title || 'Action Results Summary',
                      canvasData: {
                        type: cv.type || 'notes',
                        title: cv.title || 'Action Results Summary',
                        content: canvasContent,
                        raw: cv.markdown
                      }
                    }
                  };
                }

                return {
                  ...m,
                  content: { text: finalContent.trim(), list: [], footer: '' },
                  meta: {
                    ...(m.meta || {}),
                    liveThinking: liveThinkingText || (m.meta as any)?.liveThinking,
                    thinkingComplete: finalContent.trim().length > 0 ? true : (m.meta as any)?.thinkingComplete,
                    agentSteps: currentAgentSteps,
                    agentNarratives: currentAgentNarratives,
                    ...extraMeta
                  }
                };
              }));
              break;
            }

            case 'suggestions':
              if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
                setMessages(prev => prev.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return {
                    ...m,
                    meta: {
                      ...(m.meta || {}),
                      chipSuggestions: data.suggestions
                        .filter((s: any) => typeof s?.label === 'string' && typeof s?.prompt === 'string')
                        .slice(0, 3)
                        .map((s: any) => ({ label: String(s.label).slice(0, 60), prompt: String(s.prompt).slice(0, 500) })),
                    },
                  };
                }));
              }
              break;

            case 'error':
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                return {
                  ...m,
                  content: { text: '', list: [], footer: '' },
                  meta: {
                    ...(m.meta || {}),
                    isStreaming: false,
                    hasError: true,
                    errorMessage: data.message || 'Something went wrong, please try again.',
                    agentSteps: currentAgentSteps,
                    liveThinking: '',
                  },
                };
              }));
              // Error = stream is closing — mark as finished so the "unexpected close" path is skipped
              streamFinishedNormally = true;
              // DO NOT destroy a document the user is reading. This used to run
              // setIsCanvasOpen(false) + setCanvasData(null) on every error, so
              // if Boult wrote a doc and then anything later in the run failed —
              // a rate limit, a tool error, a timeout — the panel slammed shut
              // and the document disappeared mid-read, with the error message
              // appearing somewhere the user was no longer looking. The failure
              // is already reported in the message above; a finished artifact
              // outlives the run that produced it. Only clear when there is
              // nothing to lose.
              setCanvasData(prev => {
                if (!prev) setIsCanvasOpen(false);
                return prev;
              });
              break;

            case 'mode_switch': {
              // The AI decided mid-run that this request deserves a reviewed
              // plan before execution. The stream ends here; after the read
              // loop we re-dispatch the SAME message in plan mode.
              if (data.mode === 'plan' && !options.isPlanMode) {
                switchedToPlanMode = true;
                streamFinishedNormally = true;
              }
              break;
            }

            case 'question': {
              // AI needs user input — stream stops intentionally here
              streamFinishedNormally = true;
              hadQuestionEvent = true;
              const qPayload = {
                questions: data.questions || [],
                runId: data.runId || '',
                // Carry the mode so the answer resumes the SAME mode. A plan-mode
                // clarify question answered into agent mode skipped the plan.
                planMode: options.isPlanMode === true,
              };
              // The question IS the reply. Without this the assistant turn
              // rendered as an empty bubble with a stuck thinking shimmer —
              // the card floated above the prompt but the transcript showed
              // nothing. Put the question text (no Q:/A: tags) in the bubble
              // so the conversation reads like a person asking.
              const questionText = (qPayload.questions as AskQuestion[])
                .map(q => q?.text || '')
                .filter(Boolean)
                .join('\n\n');
              questionBubbleText = finalContent.trim() || questionText;
              setPendingQuestion(qPayload);
              // PART 66 — also persist on the latest assistant message so the
              // card survives reload. The conversation autosave writes the
              // whole messages[] array to localStorage; pendingQuestion is
              // now part of that meta, so reopening the chat restores the
              // card right where the user left it.
              setMessages(msgs => {
                if (!msgs.length) return msgs;
                const last = msgs[msgs.length - 1];
                if (last.type !== 'agent') return msgs;
                return [
                  ...msgs.slice(0, -1),
                  {
                    ...last,
                    content: { text: questionBubbleText, list: [], footer: '' },
                    meta: {
                      ...last.meta,
                      pendingQuestion: qPayload,
                      isStreaming: false,
                      thinkingComplete: true,
                      liveThinking: '',
                    },
                  },
                ];
              });
              setIsLoading(false);
              setIsAgentLoopActive(false);
              break;
            }

            case 'connector_required': {
              // Emitted by the chat-route Gmail scope preflight OR mid-loop
              // when a Gmail tool returns gmail_scope_missing. Renders the
              // ConnectorRequiredPanel inline so the user can reconnect without
              // leaving the chat. Auto-opens the integrations modal as well
              // so reconnection is one click away.
              const connectors = (data.connectors || []) as Array<{ id: string; name: string; description: string; connected?: boolean }>;
              if (connectors.length) {
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return {
                    ...m,
                    meta: {
                      ...(m.meta || {}),
                      connectorRequired: {
                        connectors,
                        waitingForUser: data.waitingForUser ?? true,
                      },
                    },
                  };
                }));
              }
              break;
            }

            case 'partial_failure': {
              // Structured failure report from Layer 3 of the agentic loop
              setMessages(msgs => msgs.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                return {
                  ...m,
                  meta: {
                    ...(m.meta || {}),
                    partialFailure: {
                      done: data.done || [],
                      failed: data.failed || [],
                      question: data.question || '',
                    },
                  },
                };
              }));
              break;
            }

            case 'orchestration_plan': {
              // PART 9 — execution plan built before first tool call.
              // Stored on message meta; rendered as a collapsible plan card
              // that shows the user what Boult intends to do and in what order.
              if (data.steps?.length) {
                const initialStepStatuses: Record<number, 'pending' | 'running' | 'completed' | 'failed'> = {};
                data.steps.forEach((_: any, i: number) => { initialStepStatuses[i] = 'pending'; });
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return {
                    ...m,
                    meta: {
                      ...(m.meta || {}),
                      orchestrationPlan: {
                        intent: data.intent || '',
                        steps: data.steps || [],
                        missingIntegrations: data.missingIntegrations || [],
                        estimatedCalls: data.estimatedCalls || { min: 1, max: 5 },
                        stepStatuses: initialStepStatuses,
                      },
                    },
                  };
                }));
              }
              break;
            }

            case 'partial_completion': {
              // PART 9 — budget ran out before all plan steps could run.
              // Different from partial_failure (which is tool errors) — this is
              // a clean budget exhaustion where some steps were simply skipped.
              if (data.skipped?.length) {
                setMessages(msgs => msgs.map(m => {
                  if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                  return {
                    ...m,
                    meta: {
                      ...(m.meta || {}),
                      partialCompletion: {
                        completed: data.completed || [],
                        skipped: data.skipped || [],
                        reason: data.reason || 'Tool call budget reached.',
                      },
                    },
                  };
                }));
              }
              break;
            }

            case 'plan': {
              // Plan mode — store the plan card on the message meta
              hadPlanEvent = true;
              const planCard: PlanCardData = {
                title: data.title || 'Plan',
                markdown: data.markdown || '',
                status: 'proposed',
                createdAt: new Date().toISOString(),
              };
              // One-sentence intro shown above the plan card
              const planIntro = `I've put together a plan titled "${planCard.title}". Review it below — click Execute to run it step by step, or Cancel to start over.`;
              finalProcessedText = ''; // plan card replaces the text message
              streamFinishedNormally = true;
              setMessages(msgs => msgs.map(m => {
                if (m.id !== assistantMsgId || m.type !== 'agent') return m;
                return {
                  ...m,
                  content: { text: '', list: [], footer: '' },
                  meta: {
                    ...(m.meta || {}),
                    isStreaming: false,
                    planCard,
                    planIntro,
                    // _planForDocs: used only by ArtifactsGalleryPanel — does NOT trigger PlanCanvas
                    _planForDocs: {
                      title: planCard.title,
                      markdown: planCard.markdown,
                    },
                  },
                };
              }));
              break;
            }

            case 'done':
              streamFinishedNormally = true;
              finalProcessedText = finalContent.trim();
              // The loop ran out of time/tool budget with work unfinished —
              // the client continues the task in a fresh invocation (up to 2
              // extra passes), so big tasks are never cut off. Question/plan
              // turns end on purpose and never set deadlineHit server-side.
              runDeadlineHit =
                data?.deadlineHit === true &&
                !hadQuestionEvent &&
                !hadPlanEvent &&
                (options.autoContinueDepth || 0) < 2;
              // A run that called NO tools is just a reply — drop the processing
              // card entirely so simple answers read like a person responding,
              // not software finishing a job. The trace is for real work only.
              const ranTools = currentAgentSteps.some(s => s.type === 'tool_call' || s.type === 'tool_result');
              // A plan card IS the message — no chat text needed there. A
              // question turn keeps the question text as the reply so the
              // transcript never shows an empty assistant bubble.
              if (hadPlanEvent) {
                finalProcessedText = '';
              } else if (hadQuestionEvent) {
                finalProcessedText = questionBubbleText;
              } else if (!finalProcessedText) {
                finalProcessedText = runDeadlineHit
                  ? 'This one is big — I used up this pass and I\'m continuing in a fresh one right now. Progress so far is in the steps above.'
                  : ranTools
                    ? "I worked through that, but the written summary didn't make it back this time. If I was drafting a reply, it's saved in your Gmail Drafts — open Drafts to review and send. Ask me again and I'll walk you through exactly what I found."
                    : '';
              }

              // Detect vague-instruction planning pass response — ends with "Should I proceed?"
              const needsConfirmation = /should\s+i\s+proceed\??$/i.test(finalProcessedText.trim());

              const finalSteps = ranTools
                ? currentAgentSteps.map(s =>
                    s.status === 'active' ? { ...s, status: 'completed' as const, completedAt: Date.now() } : s
                  )
                : [];

              setMessages(msgs => msgs.map(m => {
                if (m.id !== assistantMsgId || m.role !== 'assistant') return m;
                return {
                  ...m,
                  content: { text: finalProcessedText, list: [], footer: '' },
                  meta: {
                    ...(m.meta || {}),
                    isStreaming: false,
                    needsConfirmation,
                    agentSteps: finalSteps,
                    agentRunId: data?.runId,
                    agentDurationMs: data?.durationMs,
                    liveThinking: ''
                  }
                };
              }));
              
              setAgentSteps(finalSteps);
              setIsAgentLoopActive(false);
              setLiveTaskList(null);
              setLiveActivityLine('');
              setAgentRunMeta({ runId: data.runId, totalDurationMs: data.durationMs });
              break;
          }
          currentEventType = '';
        }
      }

      // AI-initiated agent → plan mode switch: drop this run's placeholder and
      // re-run the same message through the plan-mode pipeline. The re-dispatch
      // is deferred so this call's finally block settles loading state first.
      if (switchedToPlanMode) {
        setMessages(prev => prev.filter(m => m.id !== assistantMsgId));
        setAgentSteps([]);
        toast.info('Boult is planning this one first', {
          description: 'This request is big enough to deserve a reviewable plan before execution.',
        });
        setTimeout(() => {
          processAgentLoopMessage(messageText, conversationIdToUse, isNew, { ...options, isPlanMode: true }, attachments);
        }, 0);
        return;
      }

      // ── Auto-continuation ─────────────────────────────────────────────────
      // The loop exhausted its time/tool budget mid-task. Start a FRESH
      // invocation that picks up exactly where this one stopped — the tool
      // trace + partial summary ride along in the prompt, since a new function
      // can't share the dead one's memory. Capped at 2 extra passes per turn.
      // displayText = the original prompt so persistence never adds a
      // duplicate user bubble; the transcript just shows the agent continuing.
      if (runDeadlineHit) {
        const depth = (options.autoContinueDepth || 0) + 1;
        const toolTrace = currentAgentSteps
          .filter(s => s.type === 'tool_call' && s.status !== 'error')
          .map(s => `- ${s.label}${s.summary ? `: ${String(s.summary).replace(/\s+/g, ' ').slice(0, 180)}` : ''}`)
          .join('\n')
          .slice(0, 3500);
        const partial = finalContent.trim().slice(0, 800);
        const contPrompt =
          `[CONTINUE — pass ${depth + 1} of the SAME task] The previous pass ran out of its execution window mid-task. ` +
          `Original request: "${messageText.slice(0, 600)}"\n\n` +
          `Work ALREADY COMPLETED in the previous pass (do NOT redo any of it — its results are real):\n${toolTrace || '- (no tool work completed yet)'}\n\n` +
          (partial ? `Partial notes from the previous pass:\n${partial}\n\n` : '') +
          `Pick up exactly where it left off: finish ONLY the remaining work with tools, then deliver ONE complete final answer covering the ENTIRE task.`;
        setTimeout(() => {
          processAgentLoopMessage(contPrompt, conversationIdToUse, false, {
            ...options,
            autoContinueDepth: depth,
            displayText: displayedUserText,
          }, attachments);
        }, 400);
        // No return — fall through so this pass's partial message persists.
      }

      // Check if the stream closed without a 'done' event (e.g. timeout or sudden disconnect)
      if (!streamFinishedNormally) {
        console.warn(`⚠️ Stream finished unexpectedly without DONE event${stalled ? ' (stalled — no data for 90s)' : ''}. Finalizing state.`);
        
        const autoCompletedSteps = currentAgentSteps.map(s =>
          s.status === 'active' ? { ...s, status: 'completed' as const, completedAt: Date.now() } : s
        );

        // If drafts already streamed in this turn, the gallery is rendering
        // below — point the user at the cards instead of the misleading "saved
        // to Gmail Drafts / ask again" line.
        const fallbackText = hadQuestionEvent
          ? questionBubbleText
          : hadPlanEvent
            ? ''
            : finalContent.trim() || (streamedDraftCount > 0
                ? `I drafted ${streamedDraftCount} repl${streamedDraftCount === 1 ? 'y' : 'ies'} — review and send each from the cards below.`
                : currentAgentSteps.length > 0
                  ? "I worked through that, but the response got cut off before the summary came back. If I was drafting a reply, it's saved in your Gmail Drafts. Ask me again and I'll lay out what I found."
                  : '');

        setMessages(msgs => msgs.map(m => {
          if (m.id !== assistantMsgId || m.type !== 'agent') return m;
          return {
            ...m,
            content: { text: fallbackText, list: [], footer: '' },
            meta: {
              ...(m.meta || {}),
              isStreaming: false,
              agentSteps: autoCompletedSteps,
              liveThinking: ''
            }
          };
        }));
        setAgentSteps(autoCompletedSteps);
        setIsAgentLoopActive(false);
        setLiveActivityLine('');
      }

      setNewMessageIds(prev => new Set(prev).add(assistantMsgId));

      if (conversationIdToUse) {
        const existingRaw = localStorage.getItem(`conversation_${conversationIdToUse}`);
        const existing = existingRaw ? JSON.parse(existingRaw) : { id: conversationIdToUse, messages: [], title: messageText.split(' ').slice(0, 5).join(' '), lastUpdated: '', messageCount: 0 };
        
        // Check if the user message from handleSubmit is already present in existing messages
        const hasUserMsg = (existing.messages || []).some((m: any) => m.role === 'user' && m.content === displayedUserText);
        let allMsgs = existing.messages || [];
        if (!hasUserMsg) {
          const userMsg: UserMessage = { id: nextMessageId(), type: 'user', role: 'user', content: displayedUserText, time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) };
          allMsgs = [...allMsgs, userMsg];
        }

        // PART 21: persist whatever real text the run produced — no
        // "Done — completed [tool salad]" fabrication. Empty string is the
        // correct persisted value when cards carry the response. Question
        // turns persist the question text so the transcript never shows an
        // empty assistant reply on reload.
        const finalPersistedText = hadPlanEvent
          ? ''
          : hadQuestionEvent
            ? questionBubbleText
            : (finalProcessedText || finalContent || '').trim();
        // Capture the in-memory message's live meta so EVERY card type the SSE
        // handlers set on this message (agentSpecConfirm, agentPlanPreview,
        // confirmationData, connectorRequired, actionResults,
        // etc.) survives the localStorage round-trip. The old code rebuilt
        // meta from a hand-rolled allow-list of closure variables, dropping
        // any card type that wasn't explicitly tracked there.
        let liveMeta: any = null;
        setMessages(prev => {
          const live = prev.find(m => m.id === assistantMsgId && m.type === 'agent') as AgentMessage | undefined;
          if (live) liveMeta = live.meta || null;
          return prev;
        });

        const agentMsg: AgentMessage = {
          id: assistantMsgId,
          type: 'agent',
          role: 'assistant',
          content: { text: finalPersistedText, list: [], footer: '' },
          time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          meta: {
            // Persist whatever the live message accumulated during streaming
            ...(liveMeta || {}),
            // Then layer the closure-derived fields on top so the most-recent
            // values from this turn always win (kept for backwards compat with
            // any handlers that set these via closures, not message meta).
            agentSteps: currentAgentSteps,
            agentNarratives: currentAgentNarratives,
            ...(currentTaskList ? { taskList: currentTaskList } : {}),
            ...(currentPlanText ? { planText: currentPlanText } : {}),
            ...(currentScheduledAgent ? { scheduledAgent: currentScheduledAgent } : {}),
            ...(currentIntegrationRequired ? { integrationRequired: currentIntegrationRequired } : {}),
            ...(currentActionResult ? { actionResult: currentActionResult } : {}),
            ...(currentDraftReply ? { draftReply: currentDraftReply } : {}),
            ...(currentCanvasResult ? { result: currentCanvasResult } : {}),
            // Clear streaming-only flags before persisting
            isStreaming: false,
            liveThinking: '',
          }
        };

        allMsgs = [...allMsgs, agentMsg];
        const unique = allMsgs.filter((msg: any, idx: number, self: any[]) => idx === self.findIndex(t => t.id === msg.id));
        const convTitle = capitalizeTitle(existing.title || chatTitle || messageText.slice(0, 60));
        localStorage.setItem(`conversation_${conversationIdToUse}`, JSON.stringify({ ...existing, messages: unique, lastUpdated: new Date().toISOString(), messageCount: unique.length }));

        // Persist to Supabase (fire-and-forget — localStorage is the read cache)
        fetch('/api/boult/conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: conversationIdToUse, messages: unique, title: convTitle }),
        }).catch(() => { /* non-critical */ });

        // F3 — Defensive re-save AFTER React has flushed all pending
        // setMessages updates. PART 20 fixed the meta capture but the
        // closure still reads state mid-flush; on slower devices late SSE
        // events (sources panel, signals, undo refs) hadn't landed yet.
        // requestAnimationFrame + microtask drain → guaranteed final state.
        if (typeof window !== 'undefined') {
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                let freshMeta: any = null;
                setMessages(prev => {
                  const live = prev.find(m => m.id === assistantMsgId && m.type === 'agent') as AgentMessage | undefined;
                  if (live) freshMeta = live.meta || null;
                  return prev;
                });
                if (!freshMeta) return;
                const existingRaw2 = localStorage.getItem(`conversation_${conversationIdToUse}`);
                if (!existingRaw2) return;
                const parsed = JSON.parse(existingRaw2);
                const idx = (parsed.messages || []).findIndex((m: any) => m.id === assistantMsgId);
                if (idx < 0) return;
                parsed.messages[idx] = {
                  ...parsed.messages[idx],
                  meta: { ...(parsed.messages[idx].meta || {}), ...freshMeta, isStreaming: false, liveThinking: '' },
                };
                parsed.lastUpdated = new Date().toISOString();
                localStorage.setItem(`conversation_${conversationIdToUse}`, JSON.stringify(parsed));
                fetch('/api/boult/conversation', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ conversationId: conversationIdToUse, messages: parsed.messages, title: parsed.title }),
                }).catch(() => { /* non-critical */ });
              } catch { /* never break on persistence */ }
            }, 0);
          });
        }

        if (isNew) {
          generateChatTitle(messageText).then(title => {
            // Update the main conversation localStorage object so history shows the AI title
            const rawConv = localStorage.getItem(`conversation_${conversationIdToUse}`);
            if (rawConv) {
              try {
                const convData = JSON.parse(rawConv);
                convData.title = title;
                localStorage.setItem(`conversation_${conversationIdToUse}`, JSON.stringify(convData));
              } catch { /* ignore */ }
            }
            localStorage.setItem(`conv_${conversationIdToUse}_title`, title);
            setChatTitle(title);
            fetch('/api/boult/conversation', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ conversationId: conversationIdToUse, messages: unique, title }),
            }).catch(() => { });
          }).catch(() => { });
        }
      }

      if (finalContent && (notificationsEnabled || soundEnabled)) {
        NotificationService.notify('Boult Response', finalContent.substring(0, 100), { soundType: 'notify', silent: !notificationsEnabled });
      }

    } catch (err: any) {
      if (err.name === 'AbortError') { setMessages(prev => prev.filter(m => m.id !== assistantMsgId)); return; }
      console.error('[AgentLoop] Error:', err);
      // Same rule as the 'error' event: a document that finished writing is not
      // "stale" because a later step failed. Destroying it here threw away
      // completed work the user could see on screen — including anything they
      // had just edited in the panel. Keep it; only drop an empty canvas.
      setCanvasData(prev => {
        if (!prev) setIsCanvasOpen(false);
        return prev;
      });

      const isLimitError = err.message?.toLowerCase().includes('limit') ||
        err.message?.toLowerCase().includes('credits') ||
        err.message?.toLowerCase().includes('quota') ||
        err.message?.toLowerCase().includes('403');

      setMessages(prev => prev.map(m => {
        if (m.id !== assistantMsgId || m.role !== 'assistant') return m;
        const errMsg = err.message || 'The connection was lost during processing.';
        return {
          ...m,
          content: { text: '', list: [], footer: '' },
          meta: {
            ...(m.meta || {}),
            isStreaming: false,
            limitReached: isLimitError,
            hasError: !isLimitError,
            errorMessage: errMsg,
            liveThinking: '',
          },
        };
      }));

      // Save error message to localStorage so it persists on reload
      if (conversationIdToUse) {
        const existingRaw = localStorage.getItem(`conversation_${conversationIdToUse}`);
        const existing = existingRaw ? JSON.parse(existingRaw) : { id: conversationIdToUse, messages: [], title: messageText.split(' ').slice(0, 5).join(' '), lastUpdated: '', messageCount: 0 };
        
        // Check if the user message from handleSubmit is already present in existing messages
        const hasUserMsg = (existing.messages || []).some((m: any) => m.role === 'user' && m.content === displayedUserText);
        let allMsgs = existing.messages || [];
        if (!hasUserMsg) {
          const userMsg: UserMessage = { id: nextMessageId(), type: 'user', role: 'user', content: displayedUserText, time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) };
          allMsgs = [...allMsgs, userMsg];
        }

        const errorContentText = `${err.message || 'The connection was lost during processing.'}. Please try again.`;
        const agentMsg: AgentMessage = {
          id: assistantMsgId,
          type: 'agent',
          role: 'assistant',
          content: { text: '', list: [], footer: '' },
          time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          meta: { limitReached: isLimitError, hasError: !isLimitError, errorMessage: err.message || 'The connection was lost during processing.' },
        };
        
        allMsgs = [...allMsgs, agentMsg];
        const unique = allMsgs.filter((msg: any, idx: number, self: any[]) => idx === self.findIndex(t => t.id === msg.id));
        localStorage.setItem(`conversation_${conversationIdToUse}`, JSON.stringify({ ...existing, messages: unique, lastUpdated: new Date().toISOString(), messageCount: unique.length }));

        if (isNew) {
          generateChatTitle(messageText).then(title => {
            const rawConv2 = localStorage.getItem(`conversation_${conversationIdToUse}`);
            if (rawConv2) {
              try {
                const cd2 = JSON.parse(rawConv2);
                cd2.title = title;
                localStorage.setItem(`conversation_${conversationIdToUse}`, JSON.stringify(cd2));
              } catch { /* ignore */ }
            }
            localStorage.setItem(`conv_${conversationIdToUse}_title`, title);
            setChatTitle(title);
          }).catch(() => { });
        }
      }
    } finally {
      setIsLoading(false);
      setIsAgentLoopActive(false);
      setLiveTaskList(null);
      setLiveThinkingBlocks([]);
      setTimeout(() => scrollToBottom(true), 100);
    }
  };

  async function processAIMessage(messageText: string, conversationIdToUse: string, isNew: boolean, attachments?: any[], options: any = {}) {
    // ── Agent Loop routing: Use the new autonomous SSE loop for ALL queries ──────
    // The AI will now autonomously decide to use search, canvas, or plan tools.
    return processAgentLoopMessage(messageText, conversationIdToUse, isNew, options, attachments);

  };

  // Canvas execution handler - Phase 1: Integrated with Execution Gateway
  const handleCanvasExecute = async (action: string, data: any) => {
    setIsCanvasExecuting(true);
    try {
      const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const approvalToken = canvasData?.approvalTokens?.[action];

      console.log(`[Boult:Canvas] Executing action '${action}' with requestId=${requestId}`);
      const response = await fetch('/api/boult/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Execute: ${action}`,
          runId: activeRun?.runId || null,
          conversationId: currentConversationId,
          isNewConversation: false,
          actionType: action,
          actionPayload: data,
          approvalToken,
          actionRequestId: requestId,
          executeCanvasAction: action,
          canvasActionData: data
        })
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '(no body)');
        console.error(`[Boult:Canvas] POST /api/boult/chat failed — status=${response.status}, body=${errBody}`);
      }
      const result = await response.json().catch(() => ({ error: 'Failed to parse response' }));

      // Phase 1: Handle all execution statuses from the gateway
      const executionStatus = result.resultStatus || result.executionResult?.status;
      const isSuccess = result.executionResult?.success || executionStatus === 'completed' || executionStatus === 'already_completed';

      if (isSuccess) {
        // Handle already_completed (idempotency) differently
        if (executionStatus === 'already_completed') {
          toast.info(result.message || 'This action was already completed', {
            description: 'No duplicate action was performed.'
          });
        } else {
          toast.success(result.message || 'Action completed successfully');
        }

        setIsCanvasOpen(false);
      } else {
        // Phase 1: Handle categorized errors with recovery hints
        const errorCategory = result.error?.category || result.executionResult?.error?.category;
        const recoveryHint = result.recoveryHint || result.executionResult?.error?.recoveryHint;

        let errorMessage = result.message || 'Action failed';
        let actionDescription = '';

        if (recoveryHint) {
          errorMessage = recoveryHint.userMessage || errorMessage;

          // Add actionable guidance based on recovery action
          if (recoveryHint.requiresUserAction) {
            switch (recoveryHint.recoveryAction) {
              case 'reconnect_integration':
                actionDescription = 'Please reconnect your Gmail account in Integrations settings.';
                break;
              case 'check_permissions':
                actionDescription = 'Check your account permissions and try again.';
                break;
              case 'revise_input':
                actionDescription = 'Please review your input and try again.';
                break;
              case 'request_approval':
                actionDescription = 'This action requires your approval to proceed.';
                break;
            }
          } else if (recoveryHint.autoRetry) {
            actionDescription = 'We\'ll automatically retry this action.';
          }
        }

        toast.error(errorMessage, {
          description: actionDescription,
          duration: 6000
        });

        // Add error message to chat with recovery guidance
        const errorAgentMessage: AgentMessage = {
          id: nextMessageId(),
          type: 'agent',
          role: 'assistant',
          notes: [],
          content: {
            text: errorMessage,
            list: actionDescription ? [actionDescription] : [],
            footer: errorCategory ? `Error: ${errorCategory}` : ''
          },
          meta: {
            error: result.error || result.executionResult?.error,
            recoveryHint: recoveryHint,
            requiresRetry: recoveryHint?.autoRetry || false
          },
          time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        };
        setMessages(prev => [...prev, errorAgentMessage]);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to execute action';
      toast.error('Execution failed', {
        description: errorMessage
      });
      console.error('[Boult:Canvas] Execution error:', { action, error, message: errorMessage });

      // Add error to chat
      const errorAgentMessage: AgentMessage = {
        id: nextMessageId(),
        type: 'agent',
        role: 'assistant',
        notes: [],
        content: {
          text: 'Sorry, something went wrong while executing that action.',
          list: [errorMessage],
          footer: 'Please try again or contact support if the issue persists.'
        },
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      };
      setMessages(prev => [...prev, errorAgentMessage]);
    } finally {
      setIsCanvasExecuting(false);
    }
  };

  // Plan approval handlers (Phase 2)
  // Plan approval is handled by handlePlanApprove (L1823) which also updates message state

  const handleDeclinePlan = async (plan: any) => {
    try {
      console.log(`[Boult:Plan] Declining plan: ${plan.planId}`);
      const declineRes = await fetch('/api/boult/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Decline plan: ${plan.planId}`,
          runId: activeRun?.runId || null,
          conversationId: currentConversationId,
          isNewConversation: false,
          actionType: 'decline_plan',
          actionPayload: { planId: plan.planId },
          executeCanvasAction: 'decline_plan',
          canvasActionData: { planId: plan.planId }
        })
      });
      if (!declineRes.ok) {
        console.error(`[Boult:Plan] Decline failed — status=${declineRes.status}`);
      }

      toast.info('Plan declined');
    } catch (error) {
      console.error('[Boult:Plan] Error declining plan:', error);
      toast.error('Error declining plan');
    }
  };

  // Plan approval handler (Phase 2)
  const handlePlanApprove = async (planId: string, messageId: number) => {
    setIsProcessingPlan(true);
    try {
      console.log(`[Boult:Plan] Approving plan: ${planId}`);
      const response = await fetch('/api/boult/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Approve and execute plan: ${planId}`,
          runId: activeRun?.runId || null,
          conversationId: currentConversationId,
          isNewConversation: false,
          actionType: 'approve_plan',
          actionPayload: { planId },
          executeCanvasAction: 'approve_plan',
          canvasActionData: { planId }
        })
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '(no body)');
        console.error(`[Boult:Plan] Approve failed — status=${response.status}, body=${errBody}`);
      }
      const result = await response.json().catch(() => ({ error: 'Failed to parse response' }));

      if (result.executionResult?.success || result.success) {
        toast.success(result.message || 'Plan approved and execution started');

        // Update the message to show the plan is now executing
        setMessages(prev => prev.map(m => {
          if (m.id === messageId && m.type === 'agent') {
            const agentMsg = m as AgentMessage;
            const currentPlan = agentMsg.meta?.planArtifact;
            if (!currentPlan) return m;

            return {
              ...agentMsg,
              meta: {
                ...agentMsg.meta,
                planArtifact: {
                  ...currentPlan,
                  status: 'executing' as const
                }
              }
            };
          }
          return m;
        }));

        // Poll for execution updates
        if (result.run?.runId) {
          setActiveRun({
            runId: result.run.runId,
            status: 'executing',
            phase: 'execution'
          });
        }
      } else {
        toast.error(result.message || 'Plan approval failed');
      }
    } catch (error) {
      toast.error('Failed to approve plan');
      console.error('[Boult:Plan] Approval error:', error);
    } finally {
      setIsProcessingPlan(false);
    }
  };

  // Strand-proofing: if a conversation id in the URL turns out to be dead — an
  // orphan client-generated id that was never persisted, an empty record, or a
  // failed fetch — don't leave the user stuck on the welcome screen with a dead
  // id in the URL (the "generates an id then does nothing" bug). Reset cleanly to
  // a fresh new chat at the base route, no jarring jump.
  const resetToFreshChat = () => {
    // NOTE: leave loadedConversationIdRef pinned to the dead id (don't null it),
    // so the init effect can't immediately re-fetch the same dead id before the
    // parent's null state propagates.
    setMessages([]);
    setCurrentConversationId(null);
    setIsInitialMode(true);
    setIsNewConversation(false);
    setChatTitle('');
    if (onNewChat) {
      onNewChat(); // syncs parent state + URL so the dead id can't re-trigger a load
    } else {
      window.history.replaceState(null, '', '/dashboard/agent-talk');
    }
  };

  const loadConversation = (conversationId: string) => {
    const savedConversation = localStorage.getItem(`conversation_${conversationId}`);
    if (savedConversation) {
      try {
        const conversationData = JSON.parse(savedConversation);
        const loadedMessages = conversationData.messages || [];

        setMessages(loadedMessages);
        setConversations(prev => ({ ...prev, [conversationId]: loadedMessages }));
        setCurrentConversationId(conversationId);
        setIsInitialMode(false);
        setIsNewConversation(false);
        setShowHistory(false);
        setSelectedConversationId(conversationId);
        setChatTitle(conversationData.title || '');

        // Navigate to the conversation URL — parent owns the URL (single nav).
        loadedConversationIdRef.current = conversationId;
        if (conversationId !== initialConversationId) {
          if (onConversationSelect) onConversationSelect(conversationId);
          else window.history.pushState(null, '', `/dashboard/agent-talk/${conversationId}`);
        }

        // Scroll to bottom after messages are loaded
        setTimeout(() => scrollToBottom(true), 150);

        // Check for pending AI trigger
        const pendingId = localStorage.getItem('pending_boult_id');
        if (pendingId === conversationId) {
          const pendingMsg = localStorage.getItem('pending_boult_message');
          const pendingOptionsRaw = localStorage.getItem('pending_boult_options');

          try {
            if (pendingMsg) {
              console.log('Resuming pending AI call for new conversation:', conversationId);
              let options = {};
              try {
                if (pendingOptionsRaw) options = JSON.parse(pendingOptionsRaw);
              } catch (e) {
                console.error('Error parsing pending options:', e);
              }
              processAIMessage(pendingMsg, conversationId, true, [], options);
            }
          } finally {
            // Explicitly clear pending state to prevent cross-contamination
            localStorage.removeItem('pending_boult_id');
            localStorage.removeItem('pending_boult_message');
            localStorage.removeItem('pending_boult_options');
          }
        }
      } catch (error) {
        console.error('Error loading conversation from localStorage:', error);
      }
    } else {
      // If not in localStorage, fetch from API
      fetch(`/api/boult/conversation/${conversationId}`)
        .then(response => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
        .then(data => {
          if (data && Array.isArray(data.messages) && data.messages.length > 0) {
            const formattedMessages = data.messages.map((msg: any) => {
              if (msg.type === 'agent' && typeof msg.content === 'string') {
                return { ...msg, content: { text: msg.content, list: [], footer: '' } };
              }
              return msg;
            });
            setMessages(formattedMessages);
            setConversations(prev => ({ ...prev, [conversationId]: formattedMessages }));

            setCurrentConversationId(conversationId);
            setIsInitialMode(false);
            setIsNewConversation(false);
            setShowHistory(false);
            setSelectedConversationId(conversationId);
            setChatTitle(data.title || '');

            // Navigate to the conversation URL — parent owns the URL (single nav).
            loadedConversationIdRef.current = conversationId;
            if (onConversationSelect) onConversationSelect(conversationId);
            else window.history.pushState(null, '', `/dashboard/agent-talk/${conversationId}`);

            // Scroll to bottom after messages are loaded
            setTimeout(() => scrollToBottom(true), 150);
          } else {
            // Conversation exists nowhere / has no messages → don't strand on welcome.
            resetToFreshChat();
          }
        })
        .catch(err => {
          console.error('Error fetching conversation:', err);
          resetToFreshChat();
        });
    }
  };

  const handleLogout = async () => {
    setIsMoreOptionsOpen(false);
    await signOut({ redirect: false });
    router.push("/");
  };

  const loadPersonalityPreferences = async () => {
    try {
      const response = await fetch('/api/agent-talk/personality');
      if (response.ok) {
        const data = await response.json();
        setSavedPersonality(data.personality || '');
        setInstructionsEnabled(data.instructionsEnabled !== false);
        setMemoryEnabled(data.memoryEnabled !== false);
        // PART 45 — voice + length prefs.
        if (data.communicationStyle === 'direct' || data.communicationStyle === 'balanced' || data.communicationStyle === 'warm') {
          setCommunicationStyle(data.communicationStyle);
        }
        if (data.verbosity === 'brief' || data.verbosity === 'normal' || data.verbosity === 'detailed') {
          setVerbosity(data.verbosity);
        }
        // PART 47 — action mode.
        if (data.actionMode === 'ask' || data.actionMode === 'auto') {
          setActionMode(data.actionMode);
        }
      }
    } catch (error) {
      console.error('Error loading personality preferences:', error);
    }
  };

  const handleSavePersonality = async (
    personality: string,
    enabled: boolean,
    style?: { communicationStyle: 'direct' | 'balanced' | 'warm'; verbosity: 'brief' | 'normal' | 'detailed' },
  ) => {
    try {
      const response = await fetch('/api/agent-talk/personality', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personality,
          instructionsEnabled: enabled,
          // PART 45 — only POST when provided so older callers keep working.
          ...(style?.communicationStyle ? { communicationStyle: style.communicationStyle } : {}),
          ...(style?.verbosity ? { verbosity: style.verbosity } : {}),
        }),
      });
      if (response.ok) {
        setSavedPersonality(personality);
        setInstructionsEnabled(enabled);
        if (style?.communicationStyle) setCommunicationStyle(style.communicationStyle);
        if (style?.verbosity) setVerbosity(style.verbosity);
      }
    } catch (error) {
      console.error('Error saving personality preferences:', error);
    }
  };

  const handleToggleMemory = (enabled: boolean) => {
    setMemoryEnabled(enabled);
  };

  // PART 47 — persist the Ask / Auto choice as soon as the user flips the
  // prompt-box dropdown. Fire-and-forget — local state is the source of
  // truth for the current session; the POST just makes the choice survive
  // a reload. Failures are silent so a Supabase blip never blocks chat.
  const handleActionModeChange = (mode: 'ask' | 'auto') => {
    setActionMode(mode);
    fetch('/api/agent-talk/personality', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // The endpoint requires personality even for partial updates — pass
        // the current saved value so we don't accidentally clear it.
        personality: savedPersonality,
        instructionsEnabled,
        actionMode: mode,
      }),
    }).catch(() => { /* silent — local state already updated */ });
  };

  // PART 46 — slash-command client handlers. Triggered when the user submits
  // a /<name> whose registry entry has kind:'client'. Each branch maps to an
  // existing local action — opening a modal, clearing state, or injecting a
  // help message. Server-kind commands (/brief, /inbox, etc.) NEVER reach
  // this function — they go through onSend → chat route where the registry's
  // expandSlashCommand swaps the slash for its canonical prompt template.
  const handleSlashClientCommand = (
    handlerName: 'openAgents' | 'openMemorySettings' | 'openSettings' | 'clearConversation' | 'showHelp',
  ) => {
    switch (handlerName) {
      case 'openAgents':
      case 'openMemorySettings':
      case 'openSettings':
        // PART 53 — /agents, /memory, /settings are now AI skills handled
        // server-side; the registry entries use kind: 'prompt'. These case
        // branches kept for type-completeness only and should never fire.
        break;
      case 'clearConversation':
        setMessages([]);
        setCurrentConversationId(null);
        break;
      case 'showHelp': {
        // Inject a synthetic assistant message listing every slash command,
        // grouped by category. Reads directly from the registry so adding a
        // command = automatically discoverable via /help with zero extra wiring.
        const grouped = SLASH_COMMANDS.reduce((acc, cmd) => {
          if (!acc[cmd.category]) acc[cmd.category] = [];
          acc[cmd.category].push(cmd);
          return acc;
        }, {} as Record<string, typeof SLASH_COMMANDS>);
        const labels: Record<string, string> = { workflows: 'Workflows', profile: 'Profile', navigation: 'Navigation' };
        const lines: string[] = ['**Slash commands** — type `/` in the prompt box to start.', ''];
        for (const cat of ['workflows', 'profile', 'navigation'] as const) {
          if (!grouped[cat]?.length) continue;
          lines.push(`**${labels[cat]}**`);
          for (const cmd of grouped[cat]) {
            lines.push(`- \`/${cmd.name}\` — ${cmd.description}`);
          }
          lines.push('');
        }
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: 'assistant',
          type: 'agent',
          content: { text: lines.join('\n'), list: [], footer: '' },
          time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          meta: {},
        } as any]);
        break;
      }
    }
  };

  // Pull a fresh Gmail access token — only if Gmail is actually connected
  // (avoids the 404 network error when Gmail integration doesn't exist)
  useEffect(() => {
    const fetchGmailToken = async () => {
      try {
        // First check if Gmail is connected before hitting the token endpoint
        const statusRes = await fetch('/api/integrations/status');
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          const gmailConnected = statusData.integrations?.gmail || false;
          if (!gmailConnected) {
            console.log('[Boult:Init] Gmail not connected — skipping token fetch.');
            setGmailAccessToken(null);
            setGmailTokenSource(null);
            return;
          }
        }

        console.log('[Boult:Init] Gmail connected — fetching access token...');
        const res = await fetch('/api/agent-talk/gmail-token');
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          console.warn(`[Boult:Init] Gmail token not available — status=${res.status}, reason=${errBody.error || 'unknown'}.`);
          setGmailAccessToken(null);
          setGmailTokenSource(null);
          return;
        }

        const data = await res.json();
        console.log(`[Boult:Init] Gmail token loaded successfully (source=${data.source || 'unknown'})`);
        setGmailAccessToken(data.accessToken || null);
        setGmailTokenSource(data.source || null);
      } catch (error) {
        console.error('[Boult:Init] Failed to load Gmail token for agent:', error);
        setGmailAccessToken(null);
        setGmailTokenSource(null);
      }
    };

    fetchGmailToken();
  }, []);

  // Fetch integration status
  useEffect(() => {
    const fetchIntegrations = async () => {
      try {
        const res = await fetch('/api/integrations/status');
        if (res.ok) {
          const data = await res.json();
          setIntegrations({
            gmail: data.integrations?.gmail || false,
            'google-calendar': data.integrations?.['google-calendar'] || false,
            'google-meet': data.integrations?.['google-meet'] || false
          });
          console.log('Integrations loaded:', data.integrations);
        }
      } catch (error) {
        console.error('Failed to load integration status:', error);
      }
    };

    fetchIntegrations();
  }, []);

  // Debug modal state changes
  useEffect(() => {
    console.log('ChatInterface: Email modal state changed:', isEmailSelectionModalOpen);
    console.log('ChatInterface: Email modal should be rendering:', isEmailSelectionModalOpen ? 'YES' : 'NO');
  }, [isEmailSelectionModalOpen]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isActuallyAtBottom, setIsActuallyAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const loadedConversationIdRef = useRef<string | null>(null);

  // Load initial conversation if provided via URL
  useEffect(() => {
    if (initialConversationId && loadedConversationIdRef.current !== initialConversationId) {
      console.log('Loading conversation from URL:', initialConversationId);
      loadedConversationIdRef.current = initialConversationId;
      loadConversation(initialConversationId);
    } else if (!initialConversationId && !isNewConversation) {
      // A null parent prop must NEVER wipe an active conversation. This
      // branch used to fire mid-conversation (the prop can flicker null
      // right after the 2nd message flips isNewConversation to false) and
      // blanked the workspace to the initial screen while the URL still
      // held the conversation — the "kicked back to /agent-talk, refresh
      // to recover" bug that also orphaned the in-flight run. Reset ONLY
      // when the URL is genuinely at base AND nothing is streaming.
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      const urlHasConversation = /\/dashboard\/agent-talk\/(?:conv_|[0-9a-f-]{36})/.test(path);
      if (!urlHasConversation && !isLoading && !isAgentLoopActive) {
        console.log('No conversation ID provided - starting fresh chat');
        // Ensure we're in initial mode for new chats
        setIsInitialMode(true);
        setCurrentConversationId(null);
        setMessages([]);
        // Unpin so re-opening the same conversation later reloads it.
        loadedConversationIdRef.current = null;
      }
    }
  }, [initialConversationId, currentConversationId, isNewConversation]);

  // Save current conversation ID to localStorage whenever it changes (but not for new chats)
  useEffect(() => {
    if (currentConversationId && !isInitialMode) {
      localStorage.setItem('lastActiveConversation', currentConversationId);
      console.log('Saved active conversation:', currentConversationId);
    }
  }, [currentConversationId ?? null, isInitialMode]);

  // Initial Load: Restore conversation from URL or handle manual re-sync
  useEffect(() => {
    if (initialConversationId && isInitialMode) {
      console.log('🔄 Initial conversion ID detected, hydrating workspace:', initialConversationId);
      loadConversation(initialConversationId);
    }
  }, [initialConversationId, isInitialMode]);

  // Tracks programmatic scrolls so handleScroll doesn't override the user's manually-scrolled position
  const isProgrammaticScrollRef = useRef(false);

  const handleScroll = useCallback(() => {
    // Ignore scroll events fired by our own programmatic scrollToBottom calls
    if (isProgrammaticScrollRef.current) return;

    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;

      isAtBottomRef.current = isAtBottom;
      setIsActuallyAtBottom(isAtBottom);
      // isInitialMode guard lives in the JSX (`showScrollButton && !isInitialMode`)
      setShowScrollButton(!isAtBottom);
    }
  }, []);

  // Callback ref to reliably attach the scroll event listener when the DOM node mounts
  const setScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.removeEventListener('scroll', handleScroll);
    }
    scrollContainerRef.current = node;
    if (node) {
      node.addEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  const scrollToBottom = (instant = false) => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const isAlreadyAtBottom = scrollHeight - scrollTop - clientHeight < 10;
      if (isAlreadyAtBottom) {
        isProgrammaticScrollRef.current = false;
        return;
      }

      // Suppress handleScroll during this programmatic scroll
      isProgrammaticScrollRef.current = true;
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: instant ? "auto" : "smooth"
      });
      // Clear the flag after the scroll event has had time to fire
      const container = scrollContainerRef.current;
      const clearFlag = () => { isProgrammaticScrollRef.current = false; };
      if ('onscrollend' in container) {
        container.addEventListener('scrollend', clearFlag, { once: true });
      }
      // Always run a safety timeout to clear the flag in case the scroll event doesn't fire
      setTimeout(clearFlag, instant ? 100 : 800);
    } else if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: instant ? "auto" : "smooth",
        block: "end"
      });
    }
  };

  // Unified Natural Auto-Scroll logic
  const prevMessagesLength = useRef(messages.length);
  const prevIsLoading = useRef(isLoading);
  const prevIsAgentActive = useRef(isAgentLoopActive);
  const prevThinkingStepsOpen = useRef(isThinkingStepsOpen);

  useEffect(() => {
    if (!scrollContainerRef.current) return;

    const isNewMessage = messages.length > prevMessagesLength.current;
    prevMessagesLength.current = messages.length;

    const isStreaming = isLoading || isAgentLoopActive;
    const wasStreaming = prevIsLoading.current || prevIsAgentActive.current;
    prevIsLoading.current = isLoading;
    prevIsAgentActive.current = isAgentLoopActive;

    const justOpenedThinking = isThinkingStepsOpen && !prevThinkingStepsOpen.current;
    prevThinkingStepsOpen.current = isThinkingStepsOpen;

    const lastMessage = messages[messages.length - 1];
    const isUserSent = lastMessage?.role === 'user';

    // 1. If user sent a new message, smoothly scroll down and reset bottom tracking
    if (isNewMessage && isUserSent) {
      scrollToBottom(false);
      isAtBottomRef.current = true;
      setIsActuallyAtBottom(true);
      setShowScrollButton(false);
      return;
    }

    // 2. If expanding thinking steps, smoothly scroll down
    if (justOpenedThinking) {
      scrollToBottom(false);
      return;
    }

    // 3. During streaming/loading, keep scroll locked at bottom instantly to keep up cleanly
    if (isStreaming && isAtBottomRef.current) {
      scrollToBottom(true);
      return;
    }

    // 4. When streaming completes, perform a final smooth scroll alignment
    if (wasStreaming && !isStreaming && isAtBottomRef.current) {
      scrollToBottom(false);
      return;
    }
  }, [messages, isLoading, isAgentLoopActive, isThinkingStepsOpen, liveThinkingBlocks]);

  // Remove new message IDs after animation
  useEffect(() => {
    newMessageIds.forEach(id => {
      setTimeout(() => {
        setNewMessageIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
      }, 300); // Match animation duration
    });
  }, [newMessageIds]);

  const loadConversationsFromStorage = () => {
    const conversations: { [key: string]: any } = {};

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('conversation_')) {
        try {
          const data = JSON.parse(localStorage.getItem(key) || '{}');
          if (data.id && data.title) {
            conversations[data.id] = data;
          }
        } catch (error) {
          console.error('Error loading conversation:', error);
        }
      }
    }

    return conversations;
  };

  const handleSend = async (forcedMessage?: string, files?: File[], options: { isDeepThinking?: boolean; isCanvas?: boolean; isSearch?: boolean; isPlanMode?: boolean; modelId?: string; displayText?: string } = {}) => {
    const messageText = (forcedMessage || message).trim();
    // A pinned canvas selection counts as content on its own — the same guard
    // exists in PromptInputBox.handleSubmit, and BOTH had to change or the
    // send would still no-op here after passing the first one.
    if (!messageText && (!files || files.length === 0) && canvasSelections.length === 0) return;
    // displayText: what the transcript shows for this user turn. The full
    // messageText (e.g. "Q: … / A: …" clarifying-answer context) still goes
    // to the API — the tags just never render in the chat.
    const displayText = (options.displayText || '').trim() || messageText;

    // Clear any pending question card (user may be typing manually instead)
    if (!forcedMessage) setPendingQuestion(null);

    const isDeepThinking = options?.isDeepThinking || false;
    const isCanvas = options?.isCanvas || false;
    const isSearch = options?.isSearch || false;
    const isPlanMode = options?.isPlanMode || false;

    // Determine if this is a new conversation or continuation
    const shouldCreateNewConversation = !currentConversationId;

    // Process files if any
    const attachments = files && files.length > 0
      ? await Promise.all(files.map(async file => ({
        name: file.name,
        url: URL.createObjectURL(file), // Local URL for preview
        type: file.type,
        size: file.size,
        base64: await fileToBase64(file)
      })))
      : [];

    // Include selected emails as attachments
    if (selectedEmails.length > 0) {
      selectedEmails.forEach(email => {
        const emailContent = `From: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\n\nSnippet: ${email.snippet}`;
        attachments.push({
          name: `Attached Email: ${email.subject}`,
          url: '',
          type: 'text/email',
          size: emailContent.length,
          base64: btoa(encodeURIComponent(emailContent).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode(parseInt(p1, 16)))),
          isEmail: true
        } as any);
      });
      // Clear selected emails after processing
      setSelectedEmails([]);
    }

    // Canvas selections ride the SAME attachment channel as emails. The chat
    // route's embedTextAttachments() inlines any text/* attachment into the
    // user message before the model sees it, so a quote from the document
    // reaches the LLM as real readable text rather than a filename it would
    // otherwise hallucinate around. type is text/plain (not a custom MIME) for
    // exactly that reason — embedTextAttachments filters on TEXT_MIME_RE.
    if (canvasSelections.length > 0) {
      canvasSelections.forEach(sel => {
        const body = sel.kind === 'chat'
          ? `The user highlighted this passage from earlier in this conversation and is asking about it:\n\n${sel.text}`
          : `The user highlighted this passage in the document "${sel.docTitle}" and is asking about it:\n\n${sel.text}`;
        attachments.push({
          name: sel.kind === 'chat' ? 'Selection from chat' : `Selection from ${sel.docTitle}`,
          url: '',
          type: 'text/plain',
          size: body.length,
          base64: btoa(encodeURIComponent(body).replace(/%([0-9A-F]{2})/g, (_m, p1) => String.fromCharCode(parseInt(p1, 16)))),
          isCanvasSelection: true,
        } as any);
      });
      setCanvasSelections([]);
    }

    // Generate conversation ID if this is a new conversation
    let conversationIdToUse = currentConversationId;
    if (shouldCreateNewConversation) {
      conversationIdToUse = generateConversationId();
      setCurrentConversationId(conversationIdToUse);
      setIsNewConversation(true);
      // `attachments ? attachments[0].name : …` threw on an EMPTY array — the
      // array is always truthy, so [0] was undefined and .name blew up. It was
      // unreachable before only because a send required text or a file; a
      // pinned canvas selection can now reach here with neither.
      localStorage.setItem(`conv_${conversationIdToUse}_title`, messageText || attachments[0]?.name || 'New Chat');
      // Pin the ref immediately so the initialConversationId useEffect skips
      // loadConversation and doesn't overwrite our in-flight messages state.
      loadedConversationIdRef.current = conversationIdToUse as string;
      // Parent owns the URL (single nav). Fall back to a direct pushState only
      // when there's no parent handler (embedded use) — doing both was a double
      // navigation that Next 16 re-processes via useParams.
      if (onConversationSelect) onConversationSelect(conversationIdToUse as string);
      else window.history.pushState(null, '', `/dashboard/agent-talk/${conversationIdToUse}`);
      setShowHistory(false);
    } else {
      setIsNewConversation(false);
    }

    // Start loading state immediately
    setIsLoading(true);

    // Exit initial mode after first message
    if (isInitialMode) {
      setIsInitialMode(false);
    }

    const newMessage: UserMessage = {
      id: nextMessageId(),
      type: 'user',
      role: 'user',
      notes: [],
      content: displayText,
      attachments,
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
    };

    // Optimistically add user message and clear input
    setMessages(prev => [...prev, newMessage]);
    setMessage('');

    // Update conversations state
    setConversations(prev => ({
      ...prev,
      [conversationIdToUse as string]: [...(prev[conversationIdToUse as string] || []), newMessage]
    }));

    // Pre-save to localStorage so it survives potential refreshes
    const existingRawForPreSave = localStorage.getItem(`conversation_${conversationIdToUse}`);
    let historyMessages = messages;
    if (existingRawForPreSave) {
      try {
        const existingData = JSON.parse(existingRawForPreSave);
        if (existingData.messages && existingData.messages.length > historyMessages.length) {
          historyMessages = existingData.messages;
        }
      } catch (e) {
        console.error('Error parsing existing conversation for pre-save:', e);
      }
    }

    const conversationData = {
      id: conversationIdToUse as string,
      messages: [...historyMessages, newMessage],
      title: capitalizeTitle(chatTitle || messageText.trim().split(' ').slice(0, 5).join(' ')),
      lastUpdated: new Date().toISOString(),
      messageCount: historyMessages.length + 1
    };
    localStorage.setItem(`conversation_${conversationIdToUse}`, JSON.stringify(conversationData));

    // Process the AI message — always immediate, no localStorage handoff.
    processAIMessage(messageText, conversationIdToUse as string, shouldCreateNewConversation, attachments, { isDeepThinking, isCanvas, isSearch, isPlanMode, modelId: options?.modelId, displayText });
  };

  // Prefill handed over from SiftToday's recommendation buttons. This used to
  // auto-SEND — but if handleSend bailed on any precondition the prompt was
  // already drained and silently lost, and the user landed on an empty chat
  // with no idea why ("the redirect does nothing"). Now the handoff is VISIBLE:
  // the request lands in the composer, focused, with a toast explaining where
  // it came from — the user reads it and hits send. Transparent and unlosable.
  useEffect(() => {
    if (!pendingPrefill) return;
    const text = pendingPrefill;
    setPendingPrefill(null);
    setSuggestionInput({ text, id: Date.now() });
    toast.info('Handed over from your briefing', {
      description: 'The request is in the box below — review it and hit send.',
      duration: 5000,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrefill]);

  const startNewChat = () => {
    // Save current conversation asynchronously in the background before starting new one
    if (messages.length > 0 && currentConversationId) {
      saveConversation().catch(console.error);
    }

    // The PARENT page owns URL changes (handleNewChat pushState's + sets state).
    // Doing our own pushState too made it a DOUBLE navigation, which Next 16
    // re-processes via useParams — the repeated re-render that read as a reload.
    // Defer to the parent; fall back to a direct pushState only when embedded.
    if (onNewChat) { onNewChat(); } else { window.history.pushState(null, '', '/dashboard/agent-talk'); }

    // Clear all conversation state for new chat instantly
    setMessages([]);
    setIsInitialMode(true);
    setIsNewConversation(true);
    setSelectedConversationId(null);
    setCurrentConversationId(null);
    setChatTitle('');
    setConversations({});
    setShowHistory(false);

    // Clear any stored conversation ID from localStorage
    localStorage.removeItem('lastActiveConversation');

    console.log('Started new chat - all conversation state cleared');
  };

  const handleTryOut = (prompt: string) => {
    setSuggestionInput({ text: prompt, id: Date.now() });
    setIsIntegrationsModalOpen(false);
  };



  const saveConversation = async () => {
    if (messages.length === 0 || !currentConversationId) return;

    try {
      await fetch('/api/boult/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: currentConversationId,
          messages,
          title: capitalizeTitle(chatTitle || messages[0]?.content?.toString?.()?.slice(0, 60) || 'Conversation'),
        }),
      });
    } catch (error) {
      console.error('Error saving conversation to DB:', error);
    }
  };

  const handleSendReply = async (draftData: any) => {
    if (!currentConversationId || !activeMission) return;

    try {
      setIsLoading(true);
      console.log('[Boult:Reply] Sending reply to:', draftData.recipientEmail);
      const res = await fetch('/api/boult/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `APPROVED: Send this reply to ${draftData.recipientEmail}`, // This triggers the next step
          conversationId: currentConversationId,
          activeMission,
          runId: activeRun?.runId || null,
          approvalPayload: draftData // Pass the edited content back
        })
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '(no body)');
        console.error(`[Boult:Reply] POST /api/boult/chat failed — status=${res.status}, body=${errBody}`);
        throw new Error(`Failed to send reply (${res.status})`);
      }

      const data = await res.json();

      // Update state with result
      if (data.activeMission) setActiveMission(data.activeMission);

      // Clear proposal
      setPendingReplyProposal(null);

      const agentMessage: AgentMessage = {
        id: nextMessageId(),
        type: 'agent',
        role: 'assistant',
        notes: [],
        content: data.message,
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        meta: {
          actionType: data.actionType,
          emailResult: data.emailResult
        }
      };

      setMessages(prev => [...prev, agentMessage]);
      setNewMessageIds(prev => new Set(prev).add(agentMessage.id));

    } catch (error) {
      console.error('Error sending reply:', error);
      toast.error('Failed to send reply');
    } finally {
      setIsLoading(false);
      setTimeout(() => scrollToBottom(true), 100);
    }
  };

  const handleConversationDelete = async (deletedConversationId: string) => {
    console.log('Conversation deleted:', deletedConversationId);
    console.log('Current conversation ID:', currentConversationId);

    // Check if the deleted conversation is the currently displayed one
    if (currentConversationId === deletedConversationId) {
      console.log('Current conversation was deleted - clearing state and navigating');

      // Clear current conversation state
      setMessages([]);
      setCurrentConversationId(null);
      setSelectedConversationId(null);
      setIsInitialMode(true);
      setIsNewConversation(true);

      // Clear from localStorage
      localStorage.removeItem(`conversation_${deletedConversationId}`);
      localStorage.removeItem(`conv_${deletedConversationId}_title`);
      localStorage.removeItem('lastActiveConversation');

      // Notify parent to navigate back to /agent-talk
      if (onConversationDelete) {
        onConversationDelete(deletedConversationId);
      }
    }
  };

  // Auto-save conversation periodically
  useEffect(() => {
    if (messages.length > 0) {
      const interval = setInterval(saveConversation, 30000); // Save every 30 seconds
      return () => clearInterval(interval);
    }
  }, [messages]);

  // Save conversation when component unmounts or when starting new chat
  useEffect(() => {
    return () => {
      if (messages.length > 0) {
        saveConversation();
      }
    };
  }, []);

  // Poll operator run state for long-running or queued workflows
  useEffect(() => {
    if (!activeRun?.runId) return;
    if (!isLoading && !isCanvasExecuting && activeRun.status === 'completed') return;

    let cancelled = false;
    const pollRun = async () => {
      try {
        // Note: Run polling endpoint is not currently implemented.
        // The SSE stream already provides real-time updates.
        // This polling is a fallback for cases where the SSE stream disconnects.
        const res = await fetch(`/api/boult/v3/chat?pollRunId=${activeRun.runId}`);
        if (!res.ok) {
          // Run polling is best-effort; the SSE stream handles real-time updates
          if (res.status !== 404) {
            console.warn(`[Boult:Poll] Run poll returned status=${res.status} for runId=${activeRun.runId}`);
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        if (Array.isArray(data.steps) && data.steps.length > 0) {
          const activeStep = data.steps.find((s: any) => s.status === 'active' || s.status === 'blocked_approval');
          if (activeStep?.label) {
            setCurrentThought(activeStep.label);
          } else if (data.run?.status === 'complete') {
            setCurrentThought('Objective successfully fulfilled.');
          }

          setLiveThinkingBlocks([{
            id: 'running-mission',
            title: data.run?.phase === 'research' ? 'Deep information retrieval' : data.run?.phase === 'execution' ? 'Executing strategic actions' : 'Processing mission data',
            status: 'active',
            initialContext: data.run?.status === 'complete' ? 'Mission finalized and insights synthesized.' : 'Interpreting live telemetry and orchestrating agentic steps...',
            steps: data.steps.map((s: any) => ({
              id: s.id || `step-${s.order}`,
              label: s.label || `Step ${s.order}`,
              status: (s.status === 'blocked_approval' ? 'active' : (s.status || 'pending')) as 'pending' | 'active' | 'completed' | 'error',
              type: (s.kind || 'think') as 'pending' | 'active' | 'completed' | 'error' | 'think' | 'search' | 'read' | 'binary' | 'script' | 'brain' | 'draft' | 'execute' | 'spark' | 'mail' | 'calendar' | 'chart',
              expandedContent: [s.detail || '', formatStepEvidence(s.evidence)].filter(Boolean).join('\n\n')
            }))
          }]);
        }

        if (data.run?.runId) {
          setActiveRun({
            runId: data.run.runId,
            status: data.run.status,
            phase: data.run.phase
          });
        }
      } catch (error) {
        console.error('[Boult:Poll] Run polling failed:', error);
      }
    };

    pollRun();
    const interval = setInterval(pollRun, 2200);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeRun?.runId, activeRun?.status, isLoading, isCanvasExecuting]);

  return (
    <TooltipProvider>
      <>
        <UsageLimitModal
          isOpen={isUsageLimitModalOpen}
          onClose={() => setIsUsageLimitModalOpen(false)}
          featureName={usageLimitModalData?.featureName || 'Ask AI'}
          currentUsage={usageLimitModalData?.currentUsage || 0}
          limit={usageLimitModalData?.limit || 0}
          period={usageLimitModalData?.period || 'daily'}
          currentPlan={usageLimitModalData?.currentPlan || 'starter'}
        />

        <ShortcutsModal
          open={showShortcutsModal}
          onClose={() => setShowShortcutsModal(false)}
          shortcuts={shortcuts}
        />


        <div className="flex h-full w-full text-boult-fg bg-boult-bg selection:bg-boult-surface selection:text-boult-fg dark:selection:bg-boult-surface dark:selection:text-boult-fg overflow-hidden relative tracking-tight" style={{ height: '100vh', overflow: 'hidden' }}>
          {/* Apple-style Premium Grain Overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-[100] bg-[url('/noise.svg')] brightness-100 contrast-150" />

          {/* Subtle Ambient Glows for Depth - Disabled in dark mode for pure plain black */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            {!isDark && (
              <>
                <GradientWave
                  colors={["#EBEBEB", "#F5F5F5", "#FAFAFA", "#F5F5F5"]}
                  className="opacity-40"
                  deform={GRA_DEFORM}
                  isPlaying={false}
                />
                <div className="absolute -top-[10%] -right-[10%] w-[60%] h-[60%] rounded-full blur-[140px] bg-neutral-200/50" />
                <div className="absolute -bottom-[10%] -left-[10%] w-[50%] h-[50%] rounded-full blur-[120px] bg-neutral-100/40" />
              </>
            )}
          </div>

          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ x: '110%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '110%', opacity: 0 }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="fixed right-4 top-4 bottom-4 w-80 bg-[#F4F5F8] dark:bg-[#0A0A0A] border border-[#E2E8F0] dark:border-[#2A2A2A] flex flex-col z-[100] shadow-2xl rounded-[32px] overflow-hidden"
              >
                <div className="absolute top-6 right-6 z-[110]">
                  <button
                    onClick={() => setShowHistory(false)}
                    className="p-2 hover:bg-[#ECEFF1] dark:hover:bg-[#1A1A1A] rounded-full transition-all text-[#475569] hover:text-[#0A0B0D] dark:text-[#737373] dark:hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <ChatHistoryModal
                    key={`history-${historyRefreshKey}`}
                    isOpen={showHistory}
                    onClose={() => setShowHistory(false)}
                    onConversationSelect={loadConversation}
                    onConversationDelete={handleConversationDelete}
                    onNewMission={startNewChat}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!isEmbedded && (
            <HomeFeedSidebar
              className="z-50"
              onCollapse={(collapsed) => setIsSidebarCollapsed(collapsed)}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onOpenHelp={() => setIsHelpOpen(true)}
              onOpenRewards={() => setIsRewardsOpen(true)}
              isOpen={isMobileMenuOpen}
              onClose={() => setIsMobileMenuOpen(false)}
            />
          )}

          <LayoutGroup>
            {/* Main Layout Wrapper - Absolute positioned to fill screen strictly */}
            <div
              className={cn(
                "absolute inset-0 bg-boult-bg overflow-hidden flex flex-col md:flex-row",
                !isEmbedded ? (isSidebarCollapsed ? "md:left-20" : "md:left-64") : "left-0",
                "left-0"
              )}
              style={{ height: isEmbedded ? '100%' : '100vh', maxHeight: isEmbedded ? '100%' : '100vh' }}
            >
              {/* Chat Column (Order 1 - LEFT) - Premium Refinement */}
              <div
                className="flex-1 flex flex-col relative h-full min-w-0 order-1 bg-boult-bg backdrop-blur-3xl border-l border-boult-border rounded-none shadow-none overflow-hidden"
                style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100%' }}
              >
                {/* Header - Glassmorphic fixed height */}
                <div className="shrink-0 z-40 bg-boult-bg/40 backdrop-blur-md border-none" style={{ flexShrink: 0 }}>
                  <div className="relative px-4 sm:px-8 py-4">
                    {/* Mobile menu button — only shown on small screens */}
                    <div className="md:hidden absolute left-4 top-1/2 -translate-y-1/2 z-50">
                      <button
                        onClick={() => setIsMobileMenuOpen(prev => !prev)}
                        className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/[0.08] transition-all"
                      >
                        <Menu className="w-5 h-5" />
                      </button>
                    </div>
                    {/* Centered Agent/Home Toggle */}
                    {isInitialMode && boultView === 'feed' && (
                      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto">
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        >
                          <GlassTabContainer className="flex items-center gap-1 p-1">
                            <button
                              onClick={() => setDashboardTab('home')}
                              className={cn(
                                "relative px-5 py-2 rounded-full text-[12px] font-bold transition-all flex items-center gap-2 select-none",
                                dashboardTab === 'home'
                                  ? "text-boult-fg"
                                  : "text-boult-fg-tertiary hover:text-boult-fg-secondary"
                              )}
                            >
                              {dashboardTab === 'home' && (
                                <motion.div
                                  layoutId="activeBoultTab"
                                  className="absolute inset-0 bg-white/[0.08] dark:bg-white/[0.12] border border-white/10 rounded-full"
                                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                                />
                              )}
                              <Sparkles className="w-3.5 h-3.5 z-10" />
                              <span className="z-10">Home</span>
                            </button>
                            <button
                              onClick={() => setDashboardTab('agents')}
                              className={cn(
                                "relative px-5 py-2 rounded-full text-[12px] font-bold transition-all flex items-center gap-2 select-none",
                                dashboardTab === 'agents'
                                  ? "text-boult-fg"
                                  : "text-boult-fg-tertiary hover:text-boult-fg-secondary"
                              )}
                            >
                              {dashboardTab === 'agents' && (
                                <motion.div
                                  layoutId="activeBoultTab"
                                  className="absolute inset-0 bg-white/[0.08] dark:bg-white/[0.12] border border-white/10 rounded-full"
                                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                                />
                              )}
                              <Bot className="w-3.5 h-3.5 z-10" />
                              <span className="z-10">Agent</span>
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[8px] font-extrabold tracking-wider uppercase border border-amber-500/20 ml-0.5 z-10">
                                Beta
                              </span>
                              {scheduledAgents && scheduledAgents.filter(a => a.status === 'running').length > 0 && (
                                <motion.div
                                  className="w-1.5 h-1.5 bg-green-400 rounded-full z-10"
                                  animate={{ opacity: [1, 0.4, 1] }}
                                  transition={{ repeat: Infinity, duration: 1.5 }}
                                />
                              )}
                            </button>
                          </GlassTabContainer>
                        </motion.div>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Mobile Menu Button */}
                        {!isEmbedded && (
                          <button
                            onClick={() => setIsMobileMenuOpen(true)}
                            className="md:hidden p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors text-neutral-600 dark:text-neutral-400"
                          >
                            <PanelLeft className="w-5 h-5" />
                          </button>
                        )}

                        {/* Leftmost: Title and Dropdown with refined Zinc styling */}
                        {!isInitialMode && (
                          <div className="relative" ref={titleMenuRef}>
                            <div className="flex items-center bg-boult-surface border border-boult-border rounded-xl overflow-hidden shadow-sm transition-all hover:border-boult-divider group">
                              {isEditingTitle ? (
                                <input
                                  ref={titleInputRef}
                                  value={titleDraft}
                                  onChange={(e) => setTitleDraft(e.target.value)}
                                  onBlur={commitTitle}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
                                    else if (e.key === 'Escape') { e.preventDefault(); setIsEditingTitle(false); }
                                  }}
                                  maxLength={120}
                                  placeholder="conversation name"
                                  className="pl-4 pr-3 py-2 bg-transparent text-[13px] font-bold text-black dark:text-white/90 tracking-tight outline-none w-[240px] placeholder:text-black/30 dark:placeholder:text-white/30"
                                />
                              ) : (
                                <>
                                  <button
                                    onClick={() => setIsTitleMenuOpen(!isTitleMenuOpen)}
                                    className="pl-4 pr-3 py-2 hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors flex items-center gap-2.5 max-w-[280px]"
                                  >
                                    <span className="text-[13px] font-bold text-black dark:text-white/90 truncate tracking-tight">
                                      {chatTitle ? capitalizeTitle(chatTitle) : 'New Conversation'}
                                    </span>
                                  </button>
                                  <div className="w-[1px] h-4 bg-white/[0.12]" />
                                  <button
                                    onClick={() => setIsTitleMenuOpen(!isTitleMenuOpen)}
                                    className="px-3 py-2 hover:bg-black/[0.05] dark:bg-white/[0.05] transition-colors"
                                  >
                                    <ChevronDown className={`w-3.5 h-3.5 text-black dark:text-white/40 group-hover:text-black dark:group-hover:text-white/80 transition-transform duration-300 ease-out ${isTitleMenuOpen ? 'rotate-180' : ''}`} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Dropdown Menu */}
                        {isTitleMenuOpen && (
                          <div className="absolute top-full left-0 mt-2 w-48 bg-[#1A1A1A] border border-boult-border rounded-xl shadow-2xl py-1.5 z-[100] animate-in fade-in zoom-in-95 duration-200">
                            <button
                              onClick={() => {
                                setIsStarred(!isStarred);
                                setIsTitleMenuOpen(false);
                                toast.success(isStarred ? 'Removed from favorites' : 'Added to favorites');
                              }}
                              className="w-full px-3 py-2 text-left text-sm text-black hover:text-black dark:text-white hover:bg-black/[0.05] dark:bg-white/[0.05] transition-colors flex items-center gap-2.5"
                            >
                              <Sparkles className={`w-4 h-4 ${isStarred ? 'text-yellow-400 fill-yellow-400' : ''}`} />
                              <span>{isStarred ? 'Unstar' : 'Star'}</span>
                            </button>
                            <button
                              onClick={() => {
                                setTitleDraft(chatTitle || '');
                                setIsEditingTitle(true);
                                setIsTitleMenuOpen(false);
                              }}
                              className="w-full px-3 py-2 text-left text-sm text-black hover:text-black dark:text-white hover:bg-black/[0.05] dark:bg-white/[0.05] transition-colors flex items-center gap-2.5"
                            >
                              <PenTool className="w-4 h-4" />
                              <span>Rename</span>
                            </button>
                            <button
                              onClick={() => {
                                setIsTitleMenuOpen(false);
                                toast.info('Projects integration coming soon');
                              }}
                              className="w-full px-3 py-2 text-left text-sm text-black hover:text-black dark:text-white hover:bg-black/[0.05] dark:bg-white/[0.05] transition-colors flex items-center gap-2.5"
                            >
                              <LayoutGrid className="w-4 h-4" />
                              <span>Add to project</span>
                            </button>
                            <div className="h-[1px] bg-black/[0.05] dark:bg-white/[0.05] my-1" />
                            <button
                              onClick={() => {
                                const convId = currentConversationId;
                                setIsTitleMenuOpen(false);
                                if (!convId) return;
                                // Styled confirmation instead of native confirm().
                                toast('Delete this conversation?', {
                                  description: 'This permanently removes the chat and its history.',
                                  action: { label: 'Delete', onClick: () => handleConversationDelete(convId) },
                                  cancel: { label: 'Cancel', onClick: () => {} },
                                });
                              }}
                              className="w-full px-3 py-2 text-left text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors flex items-center gap-2.5"
                            >
                              <HugeiconsIcon icon={Cancel01Icon} size={16} />
                              <span>Delete</span>
                            </button>
                          </div>
                        )}

                        {/* Settings Icon (replaced New Chat/Edit) */}
                        <Tooltip delayDuration={100}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => setIsPersonalityModalOpen(true)}
                              className="p-2 hover:bg-black/5 dark:bg-white/5 rounded-lg transition-all text-black hover:text-black dark:text-white/60 focus:outline-none"
                            >
                              <Settings className="w-4 h-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <span className="text-[10px]">Settings</span>
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      {/* Right Side: StatusBar + New Chat and History */}
                      <div className="flex items-center gap-3">
                        {/* Status Bar — live metrics */}
                        <StatusBar
                          emailsTriaged={0}
                          draftsWaiting={0}
                          meetingsBooked={0}
                          agentsRunning={0}
                          onMetricClick={(id) => {
                            if (id === 'agents') {
                              // Could navigate to agents tab
                            }
                          }}
                        />



                        <div className="flex items-center gap-1">
                          <Tooltip delayDuration={100}>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startNewChat();
                                }}
                                className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-all text-black dark:text-white/60 focus:outline-none focus:ring-0"
                              >
                                <HugeiconsIcon icon={AddSquareIcon} size={20} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <span className="text-[10px]">New Chat <kbd className="ml-1 opacity-50">⌘⇧N</kbd></span>
                            </TooltipContent>
                          </Tooltip>

                          <Tooltip delayDuration={100}>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowHistory(!showHistory);
                                }}
                                className={`p-2 rounded-lg transition-all focus:outline-none focus:ring-0 ${showHistory ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white' : 'hover:bg-black/5 dark:bg-white/5 text-black dark:text-white/60'}`}
                              >
                                <HugeiconsIcon icon={WorkHistoryIcon} size={20} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <span className="text-[10px]">History</span>
                            </TooltipContent>
                          </Tooltip>

                          {/* Documents/Artifacts Gallery Button instead of Plan Mode */}
                          <Tooltip delayDuration={100}>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (showArtifactsPanel) {
                                    setShowArtifactsPanel(false);
                                  } else {
                                    setShowArtifactsPanel(true);
                                    setIsCanvasOpen(false);
                                  }
                                }}
                                className={`p-2 rounded-lg transition-all focus:outline-none focus:ring-0 ${showArtifactsPanel ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white' : 'hover:bg-black/5 dark:hover:bg-white/5 text-black dark:text-white/60'}`}
                              >
                                <FileText className="w-5 h-5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <span className="text-[10px]">{showArtifactsPanel ? 'Close Library' : 'Library'}</span>
                            </TooltipContent>
                          </Tooltip>

                          <Tooltip delayDuration={100}>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleGlobalShare();
                                }}
                                disabled={isSharingGlobal}
                                className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-all text-black dark:text-white/60 focus:outline-none focus:ring-0 disabled:opacity-50"
                              >
                                {isSharingGlobal ? (
                                  <div className="w-5 h-5 border-2 border-black/20 dark:border-white/20 border-t-black dark:border-t-white rounded-full animate-spin" />
                                ) : (
                                  <Share2 className="w-5 h-5" />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <span className="text-[10px]">Share Chat</span>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Chat Body - Absolute Layout Rebuild to avoid displacement */}
                <div
                  className="flex-1 relative z-20 min-h-0 min-w-0"
                  style={{ flex: '1 1 0%', minHeight: 0, overflow: 'hidden' }}
                >
                  <div
                    ref={setScrollContainerRef}
                    className="absolute inset-0 overflow-y-auto px-3 sm:px-6 py-4 scroll-smooth boult-scrollbar"
                    style={{ paddingBottom: isInitialMode ? undefined : '140px' }}
                  >
                    <div className="max-w-3xl mx-auto w-full">
                      {/* Plan Mode View */}
                      {boultView === 'plan_mode' ? (
                        <div className="py-6">
                          <PlanModeBrief
                            brief={planModeBrief}
                            loading={isPlanModeLoading}
                            onGenerate={generateNewBrief}
                          />
                        </div>
                      ) : (
                        <>
                      {/* Boult V3 Reactive Plan Cards */}
                      {v3ActivePlans.length > 0 && (
                        <div className="mb-6 space-y-4">
                          {v3ActivePlans.map((plan) => (
                            <PlanArtifactCard
                              key={plan.planId}
                              plan={plan}
                              isNew={true}
                              onUpdate={() => v3Refresh()}
                            />
                          ))}
                        </div>
                      )}
                      {/* Boult V3 Completed Plans (collapsed) */}
                      {v3CompletedPlans.length > 0 && messages.length === 0 && (
                        <div className="mb-6 space-y-2 opacity-80">
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '0 4px',
                            marginBottom: 8,
                          }}>
                            <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.10)' }} />
                            <span style={{
                              fontFamily: 'var(--font-ui, Inter, sans-serif)',
                              fontSize: 11,
                              color: 'var(--text-on-light-tertiary, #8A8D96)',
                            }}>Completed</span>
                            <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.10)' }} />
                          </div>
                          {v3CompletedPlans.slice(0, 5).map((plan) => (
                            <PlanArtifactCard
                              key={plan.planId}
                              plan={plan}
                            />
                          ))}
                        </div>
                      )}
                        </>
                      )}
                      {!isInitialMode && integrations.gmail && (
                        <ProactiveNudge
                          enabled={!isLoading}
                          onPrompt={(prompt) => {
                            setSuggestionInput({ text: prompt, id: Date.now() });
                          }}
                        />
                      )}

                      {isInitialMode && boultView === 'feed' ? (
                        <div className="flex flex-col items-center justify-center min-h-[50vh] py-8 animate-fade-in relative">

                          <BoultDashboard
                            userName={userName}
                            onSendMessage={(msg) => handleSend(msg)}
                            onSuggestionClick={(text) => setSuggestionInput({ text, id: Date.now() })}
                            isLoading={isLoading}
                            emailStats={emailStats}
                            meetings={meetings}
                            actionItems={actionItems}
                            activeTab={dashboardTab}
                            onTabChange={setDashboardTab}
                          >
                            {/* Prompt box passed as children */}
                            <PromptInputBox
                              onSend={(msg, files, opts) => handleSend(msg, files, opts)}
                              onStop={() => abortControllerRef.current?.abort()}
                              isLoading={isLoading}
                              placeholder="Tell Boult what to do..."
                              onSearchClick={() => { }}
                              onAttachEmailClick={() => setIsEmailSelectionModalOpen(true)}
                              onPersonalityClick={() => setIsPersonalityModalOpen(true)}
                              onSlashClientCommand={handleSlashClientCommand}
                              actionMode={actionMode}
                              onActionModeChange={handleActionModeChange}
                              selectedEmailsCount={selectedEmails.length}
                          canvasSelections={canvasSelections}
                          onRemoveCanvasSelection={(id) => setCanvasSelections(prev => prev.filter(s => s.id !== id))}
                              suggestionInput={suggestionInput}
                              showConnectBanner={false}
                              onConnectClick={() => setIsIntegrationsModalOpen(true)}
                              currentPlan={currentPlan || 'free'}
                              onUpgradeClick={() => {
                                setUsageLimitModalData({
                                  featureName: 'Premium Models',
                                  currentUsage: 0,
                                  limit: 0,
                                  period: 'monthly',
                                  currentPlan: currentPlan || 'starter'
                                });
                                setIsUsageLimitModalOpen(true);
                              }}
                            />
                          </BoultDashboard>
                        </div>
                      ) : (
                        <div className="space-y-4 pt-4">
                          {activeMission && <MissionStatusHeader mission={activeMission} />}
                          {messages.map((msg) => (
                            <div
                              key={msg.id}
                              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                            >
                              <div className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} max-w-full items-start`}>
                                {msg.role === 'user' && (
                                  <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center border overflow-hidden bg-boult-raised border-boult-border">
                                    <User2 className="w-4 h-4 text-white/50" />
                                  </div>
                                )}
                                <div className="flex flex-col max-w-[95%] group/msg">
                                  {msg.role === 'user' && (
                                    <UserMessageBlock
                                      msg={msg as UserMessage}
                                      isLoading={isLoading}
                                      isLatestUser={msg.id === messages.filter(m => m.role === 'user').pop()?.id}
                                      onEdit={handleEditClick}
                                      onSelectVersion={handleSelectVersion}
                                    />
                                  )}
                                  <div className={`transition-all relative overflow-hidden text-black dark:text-white px-0 py-1 ${msg.role === 'user' ? 'hidden' : ''}`}>
                                    {msg.role === 'assistant' && msg.meta?.limitReached && (
                                      <div className="flex items-center gap-2 mb-3 opacity-60">
                                        <BoultLogo size={16} />
                                        <span className="text-[12px] text-black dark:text-white/90 font-medium tracking-tight">Boult AI</span>
                                        <span className="px-1.5 py-0.5 bg-black/10 dark:bg-white/10 text-black dark:text-white/40 text-[9px] font-bold rounded uppercase tracking-widest leading-none">Lite</span>
                                      </div>
                                    )}

                                    {/* The "on it…" ack — the model's opener, a PERMANENT chat line
                                        above the executor box. The turn reads: ack → steps → report. */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.ackText && (
                                      <MessageContent
                                        content={(msg as AgentMessage).meta!.ackText!}
                                        isUser={false}
                                      />
                                    )}

                                    {/* Executor box — the collapsible steps card, under the ack */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.agentSteps && !(msg as AgentMessage).meta?.limitReached && ((msg as AgentMessage).meta!.agentSteps!).length > 0 && (
                                       <CollapsibleSteps
                                         steps={(msg as AgentMessage).meta!.agentSteps!}
                                         narratives={(msg as AgentMessage).meta?.agentNarratives}
                                         isActive={(msg as AgentMessage).meta?.isStreaming !== false}
                                         runId={(msg as AgentMessage).meta?.agentRunId}
                                         totalDurationMs={(msg as AgentMessage).meta?.agentDurationMs}
                                         plan={(msg as AgentMessage).meta?.orchestrationPlan}
                                       />
                                     )}

                                     {/* Thoughts live UNDER the executor box, never as main chat text */}
                                     {msg.role === 'assistant' && (msg as AgentMessage).meta?.liveThinking && (
                                       <AgentThinkingSection
                                         content={(msg as AgentMessage).meta!.liveThinking!}
                                         isComplete={(msg as AgentMessage).meta?.thinkingComplete}
                                       />
                                     )}

                                     {/* Plan text — quiet one-line narration of what Boult is doing */}
                                     {msg.role === 'assistant' && (msg as AgentMessage).meta?.planText && (
                                       <p className="text-[13px] text-black/45 dark:text-white/40 leading-relaxed mb-3">
                                         {(msg as AgentMessage).meta!.planText}
                                       </p>
                                     )}

                                     {/* User prompts render in UserMessageBlock above — only assistant
                                         content flows through MessageContent here. */}
                                     {msg.role === 'assistant' && !((msg as AgentMessage).meta?.hasError) && ((msg as AgentMessage).meta?.isStreaming !== true || (typeof msg.content === 'string' ? msg.content : msg.content.text).length > 0 || isAgentLoopActive) && !(
                                       // Suppress skeleton bars while the thinking card is showing with no real content yet
                                       (msg as AgentMessage).meta?.liveThinking &&
                                       !(msg as AgentMessage).meta?.thinkingComplete &&
                                       (typeof msg.content === 'string' ? msg.content : (msg.content as any)?.text || '').length === 0
                                     ) && (
                                       <MessageContent
                                         content={msg.content}
                                         isUser={false}
                                         isTyping={isLoading && msg.id === messages[messages.length - 1].id}
                                         isNewResponse={msg.id === messages[messages.length - 1].id && !isLoading}
                                         hideLinks={(msg as AgentMessage).meta?.limitReached}
                                       />
                                     )}

                                     {/* PART 9 — Partial completion card: budget ran out before all steps ran */}
                                     {msg.role === 'assistant' && (msg as AgentMessage).meta?.partialCompletion && (
                                       <PartialCompletionCard
                                         completed={(msg as AgentMessage).meta!.partialCompletion!.completed}
                                         skipped={(msg as AgentMessage).meta!.partialCompletion!.skipped}
                                         reason={(msg as AgentMessage).meta!.partialCompletion!.reason}
                                       />
                                     )}

                                     {/* Partial failure card — shown when some tools failed during a run */}
                                     {msg.role === 'assistant' && (msg as AgentMessage).meta?.partialFailure && (
                                       <PartialFailureCard
                                         done={(msg as AgentMessage).meta!.partialFailure!.done}
                                         failed={(msg as AgentMessage).meta!.partialFailure!.failed}
                                         question={(msg as AgentMessage).meta!.partialFailure!.question}
                                       />
                                     )}

                                     {/* Proceed / Cancel buttons — shown when Boult interpreted a vague instruction */}
                                     {msg.role === 'assistant' && (msg as AgentMessage).meta?.needsConfirmation && !isLoading && (
                                       <ProceedConfirmButtons
                                         onProceed={() => handleSend('Yes, proceed.')}
                                         onDismiss={() => {
                                           setMessages(prev => prev.map(m =>
                                             m.id === msg.id ? { ...m, meta: { ...(m as AgentMessage).meta, needsConfirmation: false } } : m
                                           ));
                                         }}
                                       />
                                     )}

                                    {/* User attachments now render inside UserMessageBlock above. */}
                                    {msg.role === 'assistant' && msg.notes && msg.notes.length > 0 && (
                                      <div className="mt-4 space-y-3 pt-4 border-t border-graphite-border/50">
                                        <div className="grid grid-cols-1 gap-3">
                                          {msg.notes.map((note: any, idx: number) => (
                                            <div key={note.id || idx} className="bg-boult-elevated border border-boult-border rounded-xl p-4">
                                              <div className="text-graphite-text font-medium leading-snug mb-1">{note.subject || '(No Subject)'}</div>
                                              {note.content && <div className="text-graphite-muted text-sm line-clamp-2">{note.content}</div>}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {msg.role === 'assistant' && msg.meta?.internalThought && (
                                      <details className="mt-4 border-t border-boult-border pt-3 group/thought">
                                        <summary className="flex items-center gap-2 cursor-pointer text-black hover:text-black dark:text-white/60 transition-colors list-none">
                                          <BrainCircuit className="w-3.5 h-3.5" />
                                          <span className="text-[11px] font-bold tracking-wide uppercase">Internal Reasoning</span>
                                          <ChevronDown className="w-3 h-3 transition-transform group-open/thought:rotate-180" />
                                        </summary>
                                        <div className="mt-2 pl-4 border-l border-boult-border py-2">
                                          <p className="text-black dark:text-white/40 text-[12px] leading-relaxed whitespace-pre-wrap italic">
                                            {msg.meta.internalThought}
                                          </p>
                                        </div>
                                      </details>
                                    )}



                                    {/* Plan Canvas (Inline + Full-Screen Modal) */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.planArtifact && (
                                      <div className="mt-4">
                                        <PlanCanvas
                                          plan={(msg as AgentMessage).meta!.planArtifact!}
                                          onExecute={async (planId) => {
                                            await handlePlanApprove(planId, msg.id as number);
                                          }}
                                          onDecline={async (planId) => {
                                            await handleDeclinePlan((msg as AgentMessage).meta!.planArtifact!);
                                          }}
                                          isProcessing={isProcessingPlan}
                                        />
                                      </div>
                                    )}

                                    {/* Plan intro paragraph */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.planIntro && (
                                      <p className="text-[13px] text-white/55 leading-[1.7] mb-1 mt-1">
                                        {(msg as AgentMessage).meta!.planIntro}
                                      </p>
                                    )}

                                    {/* Chat Plan Card — rendered when plan mode generates a plan */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.planCard && (
                                      <ChatPlanCard
                                        plan={(msg as AgentMessage).meta!.planCard!}
                                        onExecute={(plan) => {
                                          // Update card status to executing
                                          setMessages(prev => prev.map(m =>
                                            m.id === msg.id && m.type === 'agent'
                                              ? { ...m, meta: { ...(m as AgentMessage).meta, planCard: { ...plan, status: 'executing' as const } } }
                                              : m
                                          ));
                                          // Run the plan step by step via the agent loop
                                          const execMessage = `Execute this plan step by step, using available tools for each action item:\n\n${plan.markdown}`;
                                          if (currentConversationId) {
                                            processAIMessage(execMessage, currentConversationId, false, [], { isPlanMode: false });
                                          }
                                          // Mark as completed after agent loop finishes (optimistic)
                                          setTimeout(() => {
                                            setMessages(prev => prev.map(m =>
                                              m.id === msg.id && m.type === 'agent'
                                                ? { ...m, meta: { ...(m as AgentMessage).meta, planCard: { ...plan, status: 'completed' as const } } }
                                                : m
                                            ));
                                          }, 500);
                                        }}
                                        onCancel={(plan) => {
                                          // Mark as cancelled
                                          setMessages(prev => prev.map(m =>
                                            m.id === msg.id && m.type === 'agent'
                                              ? { ...m, meta: { ...(m as AgentMessage).meta, planCard: { ...plan, status: 'cancelled' as const } } }
                                              : m
                                          ));
                                          // AI acknowledges cancellation
                                          if (currentConversationId) {
                                            processAIMessage('The user cancelled the plan. Ask them what else you can help with.', currentConversationId, false, [], { isPlanMode: false });
                                          }
                                        }}
                                      />
                                    )}

                                    {/* Phase 2: Canvas Expansion Prompt */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.canvasExpansion && (
                                      <div
                                        className="mt-4 p-4 rounded-2xl border border-boult-border bg-boult-elevated backdrop-blur-sm"
                                      >
                                        <p className="text-[13px] text-black/50 dark:text-white/50 mb-3">
                                          This content is quite rich. Would you like to expand it on the canvas for a better view?
                                        </p>
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => setIsCanvasOpen(true)}
                                            className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black text-[12px] font-bold rounded-xl hover:bg-black/80 dark:hover:bg-neutral-200 transition-all"
                                          >
                                            Yes, open canvas
                                          </button>
                                          <button
                                            onClick={() => {
                                              // Remove the expansion prompt from this message
                                              setMessages(prev => prev.map(m => {
                                                if (m.id === msg.id && m.type === 'agent') {
                                                  return { ...m, meta: { ...(m as AgentMessage).meta, canvasExpansion: undefined } };
                                                }
                                                return m;
                                              }));
                                            }}
                                            className="px-4 py-2 text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60 text-[12px] font-bold rounded-xl bg-black/[0.03] dark:bg-white/[0.03] hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-all"
                                          >
                                            No, keep it here
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {/* Search Execution Panel (Phase 4) */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.searchExecution && (
                                      <div className="mt-4">
                                        <SearchExecutionPanel
                                          mainQuery={(msg as AgentMessage).meta!.searchExecution!.mainQuery}
                                          subQueries={(msg as AgentMessage).meta!.searchExecution!.subQueries}
                                          isSearching={(msg as AgentMessage).meta!.searchExecution!.isSearching}
                                          sources={(msg as AgentMessage).meta!.searchExecution!.sources}
                                          answer={(msg as AgentMessage).meta!.searchExecution!.answer}
                                          onSourceClick={(source) => {
                                            if (source.url) {
                                              window.open(source.url, '_blank');
                                            }
                                          }}
                                        />
                                      </div>
                                    )}



                                    {msg.role === 'assistant' && msg.meta?.limitReached && (
                                      <div className="flex flex-col gap-3 mt-4">
                                        <div className="flex flex-col gap-1 px-1">
                                          <p className="text-white/80 text-[14px] font-medium tracking-tight">
                                            You don't have enough credits. Please upgrade via the below link to continue.
                                          </p>
                                          <a
                                            href="/pricing"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-white/40 text-[13px] hover:text-white/60 underline underline-offset-4 transition-colors w-fit break-all"
                                          >
                                            https://maily.cfd/pricing
                                          </a>
                                        </div>

                                        <div className="group relative flex items-center justify-between gap-4 px-6 py-4 w-full max-w-[700px] bg-boult-elevated border border-boult-border rounded-2xl transition-all duration-500 hover:border-boult-divider shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden mt-4">
                                          {/* Premium Sweep Animation */}
                                          <motion.div
                                            className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500/[0.05] to-transparent w-[200%]"
                                            animate={{ x: ['-100%', '100%'] }}
                                            transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                                          />
                                          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

                                          <div className="flex items-center gap-3.5 z-10">
                                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 relative overflow-hidden">
                                              <motion.div
                                                className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-transparent"
                                                animate={{ opacity: [0.3, 0.6, 0.3] }}
                                                transition={{ repeat: Infinity, duration: 2 }}
                                              />
                                              <Sparkles className="w-5 h-5 text-blue-400 z-10" />
                                            </div>
                                            <p className="text-white/90 text-[13.5px] font-medium tracking-tight">
                                              {boultCredits && (boultCredits.remaining > 0 || boultCredits.isUnlimited)
                                                ? "Your credits have been updated. You can have Boult continue working on this task."
                                                : "Your credits have been used up. Please upgrade your plan for more credits."}
                                            </p>
                                          </div>

                                          {boultCredits && (boultCredits.remaining > 0 || boultCredits.isUnlimited) ? (
                                            <button
                                              disabled={msg.meta.continueClicked}
                                              onClick={() => handleContinueWithCredits(msg.id as number)}
                                              className="relative z-10 px-6 py-2 bg-white hover:bg-neutral-200 text-black font-bold text-[13px] tracking-tight rounded-full transition-all active:scale-95 shadow-lg shrink-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
                                            >
                                              {msg.meta.continueClicked ? 'Continued' : 'Continue'}
                                            </button>
                                          ) : (
                                            <button
                                              onClick={() => window.open('/pricing', '_blank')}
                                              className="relative z-10 px-6 py-2 bg-white hover:bg-neutral-200 text-black font-bold text-[13px] tracking-tight rounded-full transition-all active:scale-95 shadow-lg shrink-0"
                                            >
                                              Upgrade
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.canvasApproval && (
                                      <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                        <div className={cn(
                                          "relative group overflow-hidden bg-boult-surface-hover border border-boult-border rounded-2xl p-5 shadow-2xl transition-all",
                                          (msg as AgentMessage).meta!.canvasApproval!.status !== 'pending' && "opacity-60"
                                        )}>
                                          <div className="flex items-start gap-3.5 relative z-10">
                                            <div className="w-10 h-10 rounded-xl bg-boult-elevated border border-boult-border flex items-center justify-center shrink-0">
                                              <Sparkles className={cn("w-5 h-5", (msg as AgentMessage).meta!.canvasApproval!.status === 'accepted' ? "text-blue-400" : "text-black dark:text-white/40")} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <h4 className="text-black dark:text-white font-bold text-[14px] tracking-tight mb-1">
                                                {(msg as AgentMessage).meta!.canvasApproval!.title || 'Launch Boult Mission?'}
                                              </h4>
                                              <p className="text-black dark:text-white/40 text-[12px] leading-relaxed line-clamp-2">
                                                {(msg as AgentMessage).meta!.canvasApproval!.description || 'This request would be best handled in the specialized Boult Workspace. Would you like to open it?'}
                                              </p>
                                            </div>
                                          </div>

                                          {(msg as AgentMessage).meta!.canvasApproval!.status === 'pending' ? (
                                            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-boult-border">
                                              <button
                                                onClick={() => handleAcceptCanvas(msg.id as number)}
                                                className="px-5 py-2 bg-white hover:bg-neutral-200 text-black font-bold text-[12px] rounded-full transition-all flex items-center gap-2 active:scale-95"
                                              >
                                                <CheckCircle2 className="w-4 h-4" />
                                                <span>Yes, open Canvas</span>
                                              </button>
                                              <button
                                                onClick={() => handleDeclineCanvas(msg.id as number)}
                                                className="px-5 py-2 bg-black/5 hover:bg-black/10 dark:bg-white/10 text-black dark:text-white/60 font-medium text-[12px] rounded-full transition-all active:scale-95"
                                              >
                                                <span>No, stay here</span>
                                              </button>
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-boult-border">
                                              <div className="flex items-center gap-2 px-3 py-1.5 bg-boult-elevated rounded-full border border-boult-border">
                                                {(msg as AgentMessage).meta!.canvasApproval!.status === 'accepted' ? (
                                                  <div className="flex items-center gap-2 text-blue-400 text-[12px] font-bold">
                                                    <Check className="w-4 h-4" />
                                                    <span>Mission Accepted</span>
                                                  </div>
                                                ) : (
                                                  <div className="flex items-center gap-2 text-black dark:text-white/30 text-[12px] font-bold">
                                                    <X className="w-4 h-4" />
                                                    <span>Stayed in chat</span>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.result && !(msg as AgentMessage).meta?.canvasApproval && (
                                      <ResultCard
                                        type={(msg as AgentMessage).meta!.result!.type}
                                        title={(msg as AgentMessage).meta!.result!.title}
                                        rawContent={(msg as AgentMessage).meta!.result!.canvasData?.raw || (typeof (msg as AgentMessage).meta!.result!.canvasData?.content === 'string' ? (msg as AgentMessage).meta!.result!.canvasData?.content : undefined)}
                                        onView={() => {
                                          if ((msg as AgentMessage).meta?.result) {
                                            setCanvasData((msg as AgentMessage).meta!.result!.canvasData);
                                            setIsCanvasOpen(true);
                                          }
                                        }}
                                      />
                                    )}

                                    {/* Agent Spec Confirmation (Stage 1) — shown before plan preview */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.agentSpecConfirm && (
                                      <motion.div
                                        initial={{ opacity: 0, y: 12, scale: 0.97 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                                        className={cn(
                                          'mt-3 w-full rounded-[20px] border overflow-hidden',
                                          isDark
                                            ? 'bg-white/[0.04] border-white/[0.09] shadow-[0_4px_24px_rgba(0,0,0,0.3)]'
                                            : 'bg-white border-black/[0.09] shadow-sm',
                                        )}
                                      >
                                        <div className={cn(
                                          'flex items-center gap-2.5 px-4 py-3 border-b',
                                          isDark ? 'border-white/[0.07]' : 'border-black/[0.06]',
                                        )}>
                                          <span className="text-base">📋</span>
                                          <span className={cn(
                                            'text-[13px] font-bold',
                                            isDark ? 'text-white/90' : 'text-neutral-900',
                                          )}>
                                            Review the spec
                                          </span>
                                        </div>
                                        <div className="px-4 py-3">
                                          <p className={cn(
                                            'text-[13px] leading-relaxed',
                                            isDark ? 'text-white/65' : 'text-neutral-600',
                                          )}>
                                            The full specification for <strong>{(msg as AgentMessage).meta!.agentSpecConfirm!.agentName}</strong> is open in the canvas. Confirm to continue to the run-time plan, or edit the canvas first.
                                          </p>
                                        </div>
                                        <div className={cn(
                                          'flex items-center gap-2.5 px-4 py-3 border-t',
                                          isDark ? 'border-white/[0.06]' : 'border-black/[0.05]',
                                        )}>
                                          {(msg as AgentMessage).meta!.agentSpecConfirm!.confirmed ? (
                                            <div className={cn(
                                              'flex items-center gap-2 text-[13px] font-semibold',
                                              isDark ? 'text-emerald-400' : 'text-emerald-600',
                                            )}>
                                              <Check className="w-4 h-4" strokeWidth={2.5} />
                                              Confirmed — creating your agent…
                                            </div>
                                          ) : (
                                          <>
                                          <button
                                            onClick={() => {
                                              const sc = (msg as AgentMessage).meta!.agentSpecConfirm!;
                                              if (sc.confirmed) return; // already confirmed — ignore re-clicks
                                              const p = sc.agentParams || {};
                                              // Mark confirmed (keep the card visible in a confirmed state)
                                              // rather than deleting it — the user should still see what they
                                              // approved instead of having it vanish.
                                              setMessages(prev => prev.map(m =>
                                                m.id === msg.id && m.type === 'agent'
                                                  ? { ...m, meta: { ...(m as AgentMessage).meta, agentSpecConfirm: { ...sc, confirmed: true } } }
                                                  : m
                                              ));
                                              if (currentConversationId) {
                                                // Single confirmation → directly create the agent.
                                                // No plan-preview middle stage. The UI passes _planApproved:true
                                                // so the tool bypasses the spec-confirm gate and inserts the row.
                                                const createMsg = [
                                                  `Spec approved for "${sc.agentName}". Create the agent now.`,
                                                  `Call create_scheduled_agent with these exact parameters AND _planApproved: true:`,
                                                  `- name: "${p.name || sc.agentName}"`,
                                                  `- task_description: "${p.task_description || ''}"`,
                                                  `- cron_schedule: "${p.cron_schedule || '0 7 * * *'}"`,
                                                  `- output_channel: "${p.output_channel || 'gmail'}"`,
                                                  ...(p.slack_channel ? [`- slack_channel: "${p.slack_channel}"`] : []),
                                                  `- skip_confirmations: ${p.skip_confirmations ?? false}`,
                                                  `- _planApproved: true`,
                                                ].join('\n');
                                                processAIMessage(createMsg, currentConversationId, false, [], { isPlanMode: false });
                                              }
                                            }}
                                            className="flex-1 py-2 rounded-xl text-[13px] font-bold transition-all bg-indigo-500 hover:bg-indigo-400 text-white shadow-[0_0_12px_rgba(99,102,241,0.2)]"
                                          >
                                            Confirm
                                          </button>
                                          <button
                                            onClick={() => {
                                              // Just open canvas — user edits inline, then clicks Confirm spec
                                              const sc = (msg as AgentMessage).meta!.agentSpecConfirm!;
                                              setCanvasData({
                                                title: sc.agentName,
                                                type: 'report',
                                                raw: sc.specMarkdown,
                                                content: sc.specMarkdown,
                                              } as any);
                                              setIsCanvasOpen(true);
                                            }}
                                            className={cn(
                                              'px-4 py-2 rounded-xl text-[13px] font-medium border transition-all',
                                              isDark
                                                ? 'border-white/[0.12] text-white/60 hover:bg-white/[0.05]'
                                                : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50',
                                            )}
                                          >
                                            Edit in canvas
                                          </button>
                                          </>
                                          )}
                                        </div>
                                      </motion.div>
                                    )}

                                    {/* PART 10 Fix 7: Agent Plan Preview — shown before creating a scheduled agent */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.agentPlanPreview && (msg as AgentMessage).meta!.agentPlanPreview!.agentPlan && (
                                      <PlanPreviewCard
                                        plan={(msg as AgentMessage).meta!.agentPlanPreview!.agentPlan as PlanPreviewData}
                                        onExecute={() => {
                                          const preview = (msg as AgentMessage).meta!.agentPlanPreview!;
                                          const p = preview.agentParams || {};
                                          setMessages(prev => prev.map(m =>
                                            m.id === msg.id && m.type === 'agent'
                                              ? { ...m, meta: { ...(m as AgentMessage).meta, agentPlanPreview: undefined } }
                                              : m
                                          ));
                                          if (currentConversationId) {
                                            // Pass all original params + _planApproved:true so the tool
                                            // skips the preview gate on this second call.
                                            const approvalMsg = [
                                              `Create the scheduled agent now. The user has reviewed and approved the plan.`,
                                              `Call create_scheduled_agent with these exact parameters:`,
                                              `- name: "${p.name || preview.agentName}"`,
                                              `- task_description: "${p.task_description || preview.taskDescription}"`,
                                              `- cron_schedule: "${p.cron_schedule || preview.cronSchedule}"`,
                                              `- output_channel: "${p.output_channel || preview.outputChannel}"`,
                                              ...(p.slack_channel ? [`- slack_channel: "${p.slack_channel}"`] : []),
                                              `- skip_confirmations: ${p.skip_confirmations ?? false}`,
                                              `- _planApproved: true`,
                                            ].join('\n');
                                            processAIMessage(approvalMsg, currentConversationId, false, [], { isPlanMode: false });
                                          }
                                        }}
                                        onCancel={() => {
                                          setMessages(prev => prev.map(m =>
                                            m.id === msg.id && m.type === 'agent'
                                              ? { ...m, meta: { ...(m as AgentMessage).meta, agentPlanPreview: undefined } }
                                              : m
                                          ));
                                        }}
                                      />
                                    )}

                                    {/* Scheduled-agent flow — swap IntegrationRequired → ScheduledAgent with a smooth transition */}
                                    {msg.role === 'assistant' && ((msg as AgentMessage).meta?.scheduledAgent || (msg as AgentMessage).meta?.integrationRequired) && (
                                      <AnimatePresence mode="wait" initial={false}>
                                        {(msg as AgentMessage).meta?.scheduledAgent ? (
                                          <motion.div
                                            key="scheduled"
                                            initial={{ opacity: 0, y: 12, scale: 0.97 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -8, scale: 0.97 }}
                                            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
                                          >
                                            <ScheduledAgentCard
                                              data={(msg as AgentMessage).meta!.scheduledAgent!}
                                            />
                                          </motion.div>
                                        ) : (
                                          <motion.div
                                            key="integration"
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -8, scale: 0.97 }}
                                            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                                          >
                                            <IntegrationRequiredCard
                                              data={(msg as AgentMessage).meta!.integrationRequired!}
                                              onAgentCreated={(agent) => {
                                                setMessages(msgs => msgs.map(m => {
                                                  if (m.id !== msg.id || m.type !== 'agent') return m;
                                                  return {
                                                    ...m,
                                                    meta: {
                                                      ...(m as AgentMessage).meta,
                                                      scheduledAgent: agent,
                                                      integrationRequired: undefined,
                                                    },
                                                  };
                                                }));
                                              }}
                                            />
                                          </motion.div>
                                        )}
                                      </AnimatePresence>
                                    )}

                                    {/* PART 8 #1 — Live progress block. Renders the stacked
                                        progress lines as a single in-place updating block above
                                        the rest of the assistant's cards. Hidden when there are
                                        no lines yet so we don't show an empty container. */}
                                    {msg.role === 'assistant' && Array.isArray((msg as AgentMessage).meta?.progressLines) && ((msg as AgentMessage).meta!.progressLines!.length > 0) && (
                                      <div className="mt-2 mb-3 flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-zinc-300 dark:text-white/85">
                                        {(msg as AgentMessage).meta!.progressLines!.map((line, i, arr) => {
                                          const isLast = i === arr.length - 1;
                                          const isComplete = isLast && /\bready\.$/.test(line);
                                          return (
                                            <div
                                              key={i}
                                              className={cn(
                                                'transition-opacity duration-300',
                                                isLast ? 'opacity-100' : 'opacity-55',
                                                isComplete && 'text-emerald-400/95 font-medium',
                                              )}
                                            >
                                              {line}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {/* Confirmation card — shown when AI needs user approval before a major action */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.confirmationData && (
                                      <ConfirmationCard
                                        data={(msg as AgentMessage).meta!.confirmationData!}
                                        status={(msg as AgentMessage).meta?.confirmationStatus}
                                        onAction={async (action) => {
                                          // Mark the card as resolved
                                          setMessages(msgs => msgs.map(m => {
                                            if (m.id !== msg.id || m.type !== 'agent') return m;
                                            return {
                                              ...m,
                                              meta: {
                                                ...(m as AgentMessage).meta,
                                                confirmationStatus: action === 'confirm' ? 'confirmed' : 'cancelled',
                                              },
                                            };
                                          }));
                                          // Flip the server-side approval row first so the executor
                                          // gate in send_email / schedule_meeting / send_slack_message /
                                          // create_notion_page lets the LLM proceed on the next turn.
                                          // Without this round trip, the LLM's follow-up write tool call
                                          // refuses with code 'confirmation_required'.
                                          const approvalId = (msg as AgentMessage).meta?.confirmationData?.approvalId;
                                          if (approvalId) {
                                            try {
                                              await fetch('/api/boult/approval/confirm', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                  approvalId,
                                                  decision: action === 'confirm' ? 'confirm' : 'cancel',
                                                }),
                                              });
                                            } catch (err) {
                                              // Network failure here means the gate will refuse the write
                                              // on the next turn — surface it but don't abort the flow.
                                              console.warn('[Boult] approval/confirm failed:', err);
                                            }
                                          }
                                          // Resume the agent with the user's decision
                                          const response = action === 'confirm'
                                            ? `Confirmed — please proceed with the action.`
                                            : `Cancelled — please skip this action and let me know if you'd like to do something else.`;
                                          setTimeout(() => {
                                            if (currentConversationId) {
                                              processAgentLoopMessage(response, currentConversationId, false);
                                            } else {
                                              // PART 36: don't let "Confirmed" be a silent dead-end. If the
                                              // conversation lost its id (rare, but happened on refresh-mid-flow),
                                              // tell the user and let them re-prompt rather than sit on a green
                                              // pill that doesn't advance the agent.
                                              toast.error(
                                                action === 'confirm'
                                                  ? 'Confirmed, but the conversation lost its session. Send a quick "go ahead" to resume.'
                                                  : 'Cancelled. Send a new message to continue.',
                                              );
                                            }
                                          }, 300);
                                        }}
                                      />
                                    )}

                                    {/* PART 8 #6 — Severity-aware error card. Auth errors get an amber
                                        border, shield icon, and a "Reconnect" button that opens the
                                        integrations modal. Hard failures get a rose border + X-in-circle.
                                        Transient (rate-limit / timeout) keeps the neutral palette and
                                        auto-retries after 3s. */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.hasError && (
                                      <BoultErrorCard
                                        errorMessage={(msg as AgentMessage).meta?.errorMessage}
                                        onReconnect={() => setIsIntegrationsModalOpen(true)}
                                        onRetry={() => {
                                          // Find the last user message before this one
                                          const msgIdx = messages.findIndex(m => m.id === msg.id);
                                          const prevUser = [...messages.slice(0, msgIdx)].reverse().find(m => m.role === 'user');
                                          const retryText = prevUser
                                            ? (typeof prevUser.content === 'string' ? prevUser.content : (prevUser.content as any).text || '')
                                            : '';
                                          if (retryText && currentConversationId) {
                                            // Clear the error message first
                                            setMessages(prev => prev.filter(m => m.id !== msg.id));
                                            processAIMessage(retryText, currentConversationId, false);
                                          }
                                        }}
                                      />
                                    )}

                                    {/* Action Result Card — shown after Notion page created or meeting scheduled */}
                                    {/* PART 8 #2 — stacked action result cards. When actionResults
                                        is populated (bulk operations push every card into the
                                        array), render the full list. Falls back to the legacy
                                        single actionResult for older flows that haven't migrated. */}
                                    {msg.role === 'assistant' && !(msg as AgentMessage).meta?.isStreaming && (
                                      (() => {
                                        const list = (msg as AgentMessage).meta?.actionResults;
                                        if (Array.isArray(list) && list.length > 0) {
                                          return (
                                            <div className="mt-1 flex flex-col gap-0">
                                              {list.map((card, i) => (
                                                <ActionResultCard key={`${card.url || card.title}-${i}`} data={card as any} />
                                              ))}
                                            </div>
                                          );
                                        }
                                        const single = (msg as AgentMessage).meta?.actionResult;
                                        if (single) {
                                          return <ActionResultCard data={single} />;
                                        }
                                        return null;
                                      })()
                                    )}

                                    {/* PART 8 #5 — Bulk gallery for 2+ drafts. Multiple email_draft
                                        canvases this turn => render one DraftGalleryCard instead of
                                        cycling through modal-per-draft (unusable past ~3). User picks
                                        which to send via checkboxes, then confirms once. Unselected
                                        drafts stay in Gmail Drafts. */}
                                    {msg.role === 'assistant' && Array.isArray((msg as AgentMessage).meta?.draftReplies) && ((msg as AgentMessage).meta!.draftReplies!.length >= 2) && !(msg as AgentMessage).meta?.isStreaming && (
                                      <DraftGalleryCard
                                        drafts={((msg as AgentMessage).meta!.draftReplies!.map((d, i): DraftGalleryItem => ({
                                          id: d.gmailDraftId || `${d.recipientEmail}-${i}`,
                                          recipientName: d.recipientName,
                                          recipientEmail: d.recipientEmail,
                                          subject: d.subject,
                                          body: d.content,
                                          threadId: d.threadId,
                                          gmailDraftId: d.gmailDraftId,
                                          voiceScore: d.voiceScore,
                                        })))}
                                        onSendOne={async (item) => {
                                          const res = await fetch('/api/agent-talk/send-email', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                              to: item.recipientEmail,
                                              subject: item.subject,
                                              content: item.body,
                                              threadId: item.threadId,
                                              gmailDraftId: item.gmailDraftId,
                                            }),
                                          });
                                          if (!res.ok) {
                                            const errJson = await res.json().catch(() => ({}));
                                            throw new Error(errJson.error || `Failed (${res.status})`);
                                          }
                                        }}
                                        onDismiss={() => {
                                          setMessages(prev => prev.map(m =>
                                            m.id === msg.id ? { ...m, meta: { ...(m as AgentMessage).meta, draftReply: undefined, draftReplies: undefined } } : m
                                          ));
                                        }}
                                      />
                                    )}

                                    {/* PART 8 #3 — Draft Approval Modal (full-screen overlay) replaces the
                                        old inline DraftReplyBox for SINGLE-draft approvals only. When
                                        draftReplies.length >= 2 the gallery (above) renders instead. */}
                                    {msg.role === 'assistant'
                                      && (msg as AgentMessage).meta?.draftReply
                                      && (!Array.isArray((msg as AgentMessage).meta?.draftReplies) || ((msg as AgentMessage).meta!.draftReplies!.length < 2))
                                      && !(msg as AgentMessage).meta?.isStreaming && (
                                      <DraftApprovalModal
                                        isVisible={true}
                                        draftData={(msg as AgentMessage).meta!.draftReply!}
                                        onDismiss={() => {
                                          setMessages(prev => prev.map(m =>
                                            m.id === msg.id ? { ...m, meta: { ...(m as AgentMessage).meta, draftReply: undefined } } : m
                                          ));
                                        }}
                                        onSendReply={async ({ content, recipientEmail, subject, threadId, gmailDraftId }) => {
                                          const res = await fetch('/api/agent-talk/send-email', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ to: recipientEmail, subject, content, threadId, gmailDraftId }),
                                          });
                                          if (!res.ok) {
                                            const errJson = await res.json().catch(() => ({}));
                                            throw new Error(errJson.error || `Failed to send email (${res.status})`);
                                          }
                                          // Dismiss the modal
                                          setMessages(prev => prev.map(m =>
                                            m.id === msg.id ? { ...m, meta: { ...(m as AgentMessage).meta, draftReply: undefined } } : m
                                          ));
                                          // Inject a confirmation message from Boult
                                          const recipientName = (msg as AgentMessage).meta?.draftReply?.recipientName || recipientEmail.split('@')[0];
                                          const confirmId = Date.now() + 2;
                                          setMessages(prev => [...prev, {
                                            id: confirmId,
                                            role: 'assistant' as const,
                                            type: 'agent' as const,
                                            content: { text: `✅ Email sent to **${recipientName}**.`, list: [], footer: '' },
                                            time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
                                            meta: {},
                                          } as any]);
                                        }}
                                      />
                                    )}

                                    {/* Connector Required Panel — shown when execution needs an integration */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.connectorRequired && !(msg as AgentMessage).meta?.connectorRequired?.dismissed && (
                                      <ConnectorRequiredPanel
                                        connectors={(msg as AgentMessage).meta!.connectorRequired!.connectors}
                                        waitingForUser={(msg as AgentMessage).meta!.connectorRequired!.waitingForUser ?? true}
                                        onConnect={(id) => {
                                          setIsIntegrationsModalOpen(true);
                                        }}
                                        onSkip={() => {
                                          // Mark the card dismissed so it
                                          // disappears from the chat.
                                          setMessages(prev => prev.map(m =>
                                            m.id === msg.id
                                              ? { ...m, meta: { ...(m as AgentMessage).meta, connectorRequired: { ...(m as AgentMessage).meta!.connectorRequired!, dismissed: true } } }
                                              : m
                                          ));
                                          // PART 68: Skip should be INTERNAL — the AI
                                          // continues without that integration, not just
                                          // stop. We send a follow-up user message that
                                          // tells the loop to work with what's available.
                                          // The chat looks like: card → "Skip <X>" bubble →
                                          // AI keeps going with the other tools.
                                          const required = (msg as AgentMessage).meta?.connectorRequired;
                                          const names = (required?.connectors || [])
                                            .filter((c) => !c.connected)
                                            .map((c) => c.name);
                                          if (names.length === 0) return;
                                          const list = names.join(', ');
                                          const skipMsg = `Skip ${list} — continue with what you can do without ${names.length === 1 ? 'it' : 'them'}. Don't try to use ${names.length === 1 ? 'that integration' : 'those integrations'} this turn.`;
                                          handleSend(skipMsg);
                                        }}
                                        onApply={() => {
                                          setMessages(prev => prev.map(m =>
                                            m.id === msg.id
                                              ? { ...m, meta: { ...(m as AgentMessage).meta, connectorRequired: { ...(m as AgentMessage).meta!.connectorRequired!, dismissed: true, waitingForUser: false } } }
                                              : m
                                          ));
                                        }}
                                        onViewAll={() => setIsIntegrationsModalOpen(true)}
                                      />
                                    )}

                                    {/* PART 57 — follow-up suggestion chips. Shown below the
                                        assistant message when the run produced chips. Clicking a
                                        chip fires its prompt as the user's next message. */}
                                    {msg.role === 'assistant' && (msg as AgentMessage).meta?.chipSuggestions && !((msg as AgentMessage).meta?.isStreaming) && !((msg as AgentMessage).meta?.hasError) && (
                                      <SuggestionChips
                                        chips={(msg as AgentMessage).meta!.chipSuggestions as Array<{ label: string; prompt: string }>}
                                        disabled={isLoading || isAgentLoopActive}
                                        onPick={(prompt) => {
                                          if (currentConversationId) {
                                            processAgentLoopMessage(prompt, currentConversationId, false);
                                          } else {
                                            handleSend(prompt);
                                          }
                                        }}
                                      />
                                    )}

                                    {/* Action buttons — AFTER all cards. Hidden whenever the
                                        assistant is still asking the user for something (pending
                                        question, spec/plan/integration/confirmation card waiting
                                        for a click, agent loop currently running for this msg). */}
                                    {(() => {
                                      if (msg.role !== 'assistant') return null;
                                      const m = msg as AgentMessage;
                                      if (m.meta?.limitReached || m.meta?.isStreaming || m.meta?.hasError) return null;
                                      // Only show the feedback bar on the LAST assistant message of the
                                      // conversation — i.e. the finished result. It should not appear under
                                      // every intermediate message of a multi-step task (spec card, "agent
                                      // is live" step, etc.). The bar means "rate this answer", and only the
                                      // final answer is rateable. While a newer user/assistant turn exists
                                      // after this one, this message is mid-task scaffolding.
                                      const isLastMessage = m.id === messages[messages.length - 1]?.id;
                                      if (!isLastMessage) return null;
                                      // Don't show while the agent loop is still working on this final turn.
                                      if (isAgentLoopActive) return null;
                                      // ── "Still asking the user" gate ──
                                      const isStillAskingUser =
                                        !!m.meta?.agentSpecConfirm ||
                                        !!m.meta?.agentPlanPreview ||
                                        !!m.meta?.confirmationData ||
                                        !!(m.meta?.connectorRequired && m.meta.connectorRequired.waitingForUser && !m.meta.connectorRequired.dismissed) ||
                                        !!(m.meta?.integrationRequired && !m.meta.scheduledAgent) ||
                                        // Pending follow-up question card attached to THIS msg
                                        !!m.meta?.pendingQuestion ||
                                        !!pendingQuestion;
                                      if (isStillAskingUser) return null;
                                      return (
                                        <MessageActionButtons
                                          msg={msg}
                                          isLoading={isLoading}
                                          onFeedback={(type, id) => setFeedbackModal({ isOpen: true, type, msgId: id })}
                                          onRegenerate={handleRegenerateClick}
                                          onShare={async () => {
                                            if (!currentConversationId || messages.length === 0) return null;
                                            try {
                                              const res = await fetch('/api/agent-talk/share', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                  conversationId: currentConversationId,
                                                  messages,
                                                  title: capitalizeTitle(chatTitle || messages[0]?.content?.toString?.()?.slice(0, 60) || 'Conversation'),
                                                }),
                                              });
                                              const data = await res.json();
                                              return data.shareUrl || null;
                                            } catch { return null; }
                                          }}
                                        />
                                      );
                                    })()}
                                  </div>
                                  {/* PART 31 — Sources tab. Renders ONLY when the assistant
                                      finished, has source items, and isn't waiting for the user. */}
                                  {(() => {
                                    if (msg.role !== 'assistant') return null;
                                    const m = msg as AgentMessage;
                                    const srcs = m.meta?.sources;
                                    if (!srcs || srcs.length === 0) return null;
                                    if (m.meta?.isStreaming || m.meta?.hasError || m.meta?.limitReached) return null;
                                    const isStillAskingUser =
                                      !!m.meta?.agentSpecConfirm ||
                                      !!m.meta?.agentPlanPreview ||
                                      !!m.meta?.confirmationData ||
                                      !!(m.meta?.connectorRequired && m.meta.connectorRequired.waitingForUser && !m.meta.connectorRequired.dismissed) ||
                                      !!(m.meta?.integrationRequired && !m.meta.scheduledAgent) ||
                                      (!!pendingQuestion && m.id === messages[messages.length - 1]?.id);
                                    const isThisMsgActive = isAgentLoopActive && m.id === messages[messages.length - 1]?.id;
                                    if (isStillAskingUser || isThisMsgActive) return null;
                                    return <SourcesPanel sources={srcs} />;
                                  })()}
                                  {(() => {
                                    // Same gate for the timestamp — don't print "9:43 AM" under
                                    // a card that's still waiting on the user.
                                    if (msg.role === 'assistant') {
                                      const m = msg as AgentMessage;
                                      const isStillAskingUser =
                                        !!m.meta?.agentSpecConfirm ||
                                        !!m.meta?.agentPlanPreview ||
                                        !!m.meta?.confirmationData ||
                                        !!(m.meta?.connectorRequired && m.meta.connectorRequired.waitingForUser && !m.meta.connectorRequired.dismissed) ||
                                        !!(m.meta?.integrationRequired && !m.meta.scheduledAgent) ||
                                        !!m.meta?.pendingQuestion ||
                                        (!!pendingQuestion && m.id === messages[messages.length - 1]?.id);
                                      const isThisMsgActive = isAgentLoopActive && m.id === messages[messages.length - 1]?.id;
                                      if (isStillAskingUser || isThisMsgActive) return null;
                                    }
                                    return (
                                      <div className={`mt-2 px-1 text-[10px] tracking-tight text-graphite-muted-2 opacity-60 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                                        {msg.time}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          ))}
                          {/* All processing animations removed per request */}
                          <div ref={messagesEndRef} className="h-8" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Fixed Prompt Box for Conversation Mode */}
                  {!isInitialMode && (
                    <div
                      className="absolute bottom-0 left-0 right-0 z-50 bg-boult-bg"
                      style={{ backgroundColor: 'var(--boult-bg)' }}
                    >
                      {/* Premium, theme-aware seamless fade gradient to make scrolled content merge beautifully into the page background */}
                      <div
                        className="absolute bottom-full left-0 right-0 h-10 pointer-events-none"
                        style={{
                          background: `linear-gradient(to top, var(--boult-bg) 0%, transparent 100%)`
                        }}
                      />

                      <div className="max-w-3xl mx-auto w-full px-6 py-6 relative">
                        {/* Scroll to Bottom Button - centered dynamically above the prompt container */}
                        <AnimatePresence>
                          {showScrollButton && (
                            <motion.div
                              initial={{ opacity: 0, y: 10, scale: 0.9 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 10, scale: 0.9 }}
                              className="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 z-50"
                            >
                              <button
                                onClick={() => {
                                  scrollToBottom(false);
                                  isAtBottomRef.current = true;
                                  setIsActuallyAtBottom(true);
                                  setShowScrollButton(false);
                                }}
                                className="w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-b from-zinc-100/95 to-white/95 dark:bg-gradient-to-b dark:from-zinc-800/95 dark:to-zinc-950/95 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white border border-zinc-200/80 dark:border-zinc-700/80 shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.3)] backdrop-blur-md hover:scale-110 active:scale-95 transition-all duration-200 group"
                              >
                                <ChevronDown className="w-5 h-5 group-hover:translate-y-0.5 transition-transform duration-200" />
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        {/* Ask User Card — appears when AI needs clarification.
                            PART 66: persisted on the last assistant message's
                            meta so it survives reload. We surface the card if
                            EITHER live state holds a question (fresh stream)
                            OR the last assistant message has an unanswered one
                            (reopened conversation). Same render path. */}
                        {(() => {
                          const lastMsg = messages[messages.length - 1];
                          const persistedQ = (lastMsg?.type === 'agent' && lastMsg.meta?.pendingQuestion) || null;
                          const activeQ = pendingQuestion || persistedQ;
                          if (!activeQ) return null;

                          const clearQuestion = () => {
                            setPendingQuestion(null);
                            setMessages(msgs => {
                              if (!msgs.length) return msgs;
                              const last = msgs[msgs.length - 1];
                              if (last.type !== 'agent' || !last.meta?.pendingQuestion) return msgs;
                              const { pendingQuestion: _, ...restMeta } = last.meta;
                              return [
                                ...msgs.slice(0, -1),
                                { ...last, meta: restMeta },
                              ];
                            });
                          };

                          return (
                            <AnimatePresence>
                              <AskUserCard
                                questions={activeQ.questions}
                                onSubmit={(answers) => {
                                  clearQuestion();
                                  // Internally the model gets full Q/A context;
                                  // the transcript shows only the clean answers.
                                  const internal = activeQ.questions
                                    .map((q, i) => `Q: ${q.text}\nA: ${answers[i]}`)
                                    .join('\n\n');
                                  const display = answers.length === 1
                                    ? answers[0]
                                    : answers.map((a, i) => `${i + 1}. ${a}`).join('\n');
                                  handleSend(internal, undefined, {
                                    displayText: display,
                                    // Resume in the mode the question came from —
                                    // a plan-mode clarify continues into the plan.
                                    isPlanMode: activeQ.planMode === true,
                                  });
                                }}
                                onDismiss={clearQuestion}
                              />
                            </AnimatePresence>
                          );
                        })()}

                        {/* Task progress — collapsed by default, expands upward above prompt */}
                        {liveTaskList && (
                          <TaskProgressCard
                            taskList={liveTaskList}
                            isActive={isAgentLoopActive}
                          />
                        )}
                        {/* Execution steps live ONLY inside the collapsible box on the
                            assistant message — no duplicate pill strip above the prompt. */}
                        <PromptInputBox
                          onSend={(msg, files, opts) => handleSend(msg, files, opts)}
                          onStop={() => abortControllerRef.current?.abort()}
                          isLoading={isLoading}
                          placeholder="Ask follow-up..."
                          onSearchClick={() => { }}
                          onAttachEmailClick={() => setIsEmailSelectionModalOpen(true)}
                          onPersonalityClick={() => setIsPersonalityModalOpen(true)}
                          onSlashClientCommand={handleSlashClientCommand}
                          actionMode={actionMode}
                          onActionModeChange={handleActionModeChange}
                          selectedEmailsCount={selectedEmails.length}
                          canvasSelections={canvasSelections}
                          onRemoveCanvasSelection={(id) => setCanvasSelections(prev => prev.filter(s => s.id !== id))}
                          suggestionInput={suggestionInput}
                          onConnectClick={() => setIsIntegrationsModalOpen(true)}
                          currentPlan={currentPlan || 'free'}
                          hideShadow={isActuallyAtBottom}
                          onUpgradeClick={() => {
                            setUsageLimitModalData({
                              featureName: 'Premium Models',
                              currentUsage: 0,
                              limit: 0,
                              period: 'monthly',
                              currentPlan: currentPlan || 'starter'
                            });
                            setIsUsageLimitModalOpen(true);
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Canvas Sidebar or Artifacts Gallery Sidebar (Order 2 - RIGHT) */}
              <AnimatePresence mode="wait">
                {isCanvasOpen && canvasData ? (
                  <motion.div
                    key="canvas-panel"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="h-full flex-shrink-0 bg-boult-surface border border-boult-border rounded-[32px] z-50 overflow-hidden order-2 relative shadow-2xl"
                  >
                    <CanvasPanel
                      isOpen={isCanvasOpen}
                      onClose={() => setIsCanvasOpen(false)}
                      canvasData={canvasData}
                      onExecute={handleCanvasExecute}
                      isExecuting={isCanvasExecuting}
                      isSidebarCollapsed={isSidebarCollapsed}
                      onAddSelectionToChat={({ text, docTitle }) => {
                        setCanvasSelections(prev => {
                          // Re-adding an identical passage is a mis-click, not
                          // an instruction to send it twice.
                          if (prev.some(p => p.text === text)) return prev;
                          return [...prev, { id: Date.now(), text, docTitle }];
                        });
                      }}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </LayoutGroup>
        </div>
        {/* Highlight any text in the transcript → "Add to chat". Scoped to the
            scroll container, so composer/sidebar selections never trigger it.
            Rendered once here; it manages its own portal + visibility. */}
        <ChatSelectionToolbar
          rootRef={scrollContainerRef}
          onAdd={(text) => {
            setCanvasSelections(prev => {
              if (prev.some(p => p.text === text)) return prev;
              return [...prev, { id: Date.now(), text, docTitle: 'chat', kind: 'chat' }];
            });
          }}
        />
        <NoScrollbarStyles />
        <ConnectorsModal isOpen={isIntegrationsModalOpen} onClose={() => setIsIntegrationsModalOpen(false)} onTryOut={handleTryOut} />
        <EmailSelectionModal
          isOpen={isEmailSelectionModalOpen}
          onClose={() => setIsEmailSelectionModalOpen(false)}
          onSelectEmails={(emails: Email[]) => {
            setSelectedEmails(prev => [...prev, ...emails]);
            setIsEmailSelectionModalOpen(false);
          }}
        />
        <BoultSettingsModal
          isOpen={isPersonalityModalOpen}
          onClose={() => setIsPersonalityModalOpen(false)}
          onSaveInstructions={handleSavePersonality}
          onToggleMemory={handleToggleMemory}
          initialInstructions={savedPersonality}
          initialInstructionsEnabled={instructionsEnabled}
          initialMemoryEnabled={memoryEnabled}
          initialCommunicationStyle={communicationStyle}
          initialVerbosity={verbosity}
        />

        {/* Library overlay modal */}
        <ArtifactsGalleryPanel
          isOpen={showArtifactsPanel}
          onClose={() => setShowArtifactsPanel(false)}
          onSelectArtifact={(data) => {
            setCanvasData(data);
            setIsCanvasOpen(true);
            setShowArtifactsPanel(false);
          }}
          messages={messages}
        />

        {/* Global Modals for Sidebar Actions */}
        <AnimatePresence>
          {isSettingsOpen && <SettingsCard onClose={() => setIsSettingsOpen(false)} />}
          {isHelpOpen && <HelpCard onClose={() => setIsHelpOpen(false)} />}
          {isRewardsOpen && (
            <RewardsCard
              onClose={() => setIsRewardsOpen(false)}
              usageData={{
                planType: (boultCredits?.isUnlimited ? 'pro' : 'starter'),
                features: {
                  boult_ai: {
                    usage: boultCredits?.usage ?? 0,
                    limit: boultCredits?.limit ?? 10,
                    remaining: boultCredits?.remaining ?? 10,
                    period: boultCredits?.period ?? 'daily',
                    isUnlimited: !!boultCredits?.isUnlimited
                  },
                  sift_ai: { usage: 0, limit: 5, remaining: 5, isUnlimited: false, period: 'daily' }
                }
              }}
            />
          )}
        </AnimatePresence>

        {/* Feedback Modal for Like/Dislike */}
        <AnimatePresence>
          {feedbackModal.isOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setFeedbackModal(prev => ({ ...prev, isOpen: false }))}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-boult-surface border border-boult-border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
              >
                <div className="p-6">
                  <h3 className="text-white text-lg font-bold mb-2 tracking-tight">
                    {feedbackModal.type === 'like' ? 'What did you like about this?' : 'How can we improve this?'}
                  </h3>
                  <p className="text-boult-fg-tertiary text-[13px] mb-4">
                    {feedbackModal.type === 'like' ? 'Your feedback helps Boult learn your preferences and tailor future responses.' : 'Your feedback helps Boult avoid mistakes and improve reasoning accuracy.'}
                  </p>
                  <textarea
                    className="w-full h-32 bg-boult-bg border border-boult-border rounded-xl p-4 text-white placeholder:text-boult-fg-muted focus:outline-none focus:border-boult-divider resize-none text-[13px]"
                    placeholder={feedbackModal.type === 'like' ? 'I liked how...' : 'It would be better if...'}
                    autoFocus
                  />
                </div>
                <div className="px-6 py-4 bg-boult-elevated border-t border-boult-border flex items-center justify-end gap-3">
                  <button onClick={() => setFeedbackModal(prev => ({ ...prev, isOpen: false }))} className="px-4 py-2 text-white/50 hover:text-white text-[13px] font-medium transition-colors">Cancel</button>
                  <button onClick={() => {
                    toast.success('Feedback submitted', { description: 'Thank you for helping improve Boult AI.' });
                    setFeedbackModal(prev => ({ ...prev, isOpen: false }));
                  }} className="px-5 py-2 bg-white text-black text-[13px] font-bold rounded-full hover:bg-neutral-200 transition-colors">Submit</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        {/* Regenerate Confirmation Modal */}
        <AnimatePresence>
          {regenerateModal.isOpen && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setRegenerateModal({ isOpen: false, msgId: null })}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-boult-surface border border-boult-border rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl"
              >
                <div className="p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-boult-elevated flex items-center justify-center mx-auto mb-4 border border-boult-border">
                    <svg className="w-6 h-6 text-boult-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </div>
                  <h3 className="text-boult-fg text-lg font-bold mb-2 tracking-tight">Regenerate reply?</h3>
                  <p className="text-boult-fg-secondary text-[13px] leading-relaxed">
                    This will remove the current response and Boult will attempt to generate a new one based on your request.
                  </p>
                </div>
                <div className="px-6 py-4 bg-boult-elevated border-t border-boult-border flex items-center gap-3">
                  <button onClick={() => setRegenerateModal({ isOpen: false, msgId: null })} className="flex-1 px-4 py-2.5 text-boult-fg-secondary hover:text-boult-fg text-[13px] font-bold transition-colors bg-boult-bg hover:bg-boult-surface-hover border border-boult-border rounded-xl">Cancel</button>
                  <button onClick={handleConfirmRegenerate} className="flex-1 px-4 py-2.5 bg-boult-fg text-boult-bg text-[13px] font-bold rounded-xl hover:opacity-90 transition-opacity">Regenerate</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Edit Prompt Modal — edit the message and resend as a new version */}
        <AnimatePresence>
          {editModal.isOpen && (
            <div
              className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
              onClick={() => setEditModal({ isOpen: false, msgId: null, text: '' })}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 10 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-boult-surface border border-boult-border rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl"
              >
                <div className="px-5 pt-5 pb-3 flex items-center gap-2">
                  <Edit className="w-4 h-4 text-boult-fg-tertiary" />
                  <span className="text-[12px] font-bold text-boult-fg-secondary uppercase tracking-widest">Edit message</span>
                </div>
                <div className="px-5 pb-2">
                  <textarea
                    autoFocus
                    value={editModal.text}
                    onChange={(e) => setEditModal(prev => ({ ...prev, text: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleEditSubmit(); }
                      if (e.key === 'Escape') setEditModal({ isOpen: false, msgId: null, text: '' });
                    }}
                    rows={Math.min(14, Math.max(3, editModal.text.split('\n').length + 1))}
                    className="w-full bg-boult-bg border border-boult-border rounded-xl p-4 text-boult-fg text-[15px] leading-relaxed placeholder:text-boult-fg-muted focus:outline-none focus:border-boult-divider resize-none max-h-[50vh]"
                    placeholder="Edit your message…"
                  />
                </div>
                <div className="px-5 py-4 flex items-center justify-between gap-3">
                  <span className="text-[11px] text-boult-fg-muted">Sending replaces the reply and keeps both versions.</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditModal({ isOpen: false, msgId: null, text: '' })}
                      className="px-5 py-2.5 rounded-full text-[13px] font-bold text-boult-fg-secondary hover:text-boult-fg bg-boult-elevated hover:bg-boult-surface-hover border border-boult-border transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleEditSubmit}
                      disabled={!editModal.text.trim()}
                      className="px-6 py-2.5 rounded-full text-[13px] font-bold text-boult-bg bg-boult-fg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </>
    </TooltipProvider>
  );
}
