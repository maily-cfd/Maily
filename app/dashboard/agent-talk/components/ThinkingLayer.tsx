'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Binary, Sparkles, BrainCircuit, Mail, FileText, Search, Zap, Calendar, BarChart3, Pencil, Terminal, CheckCircle2, Globe, Database, ListTodo, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from "@/lib/utils";

export type ThinkingStep = {
    id: string;
    label: string;
    status: 'pending' | 'active' | 'completed' | 'error' | 'blocked_approval';
    type: 'think' | 'search' | 'read' | 'analyze' | 'draft' | 'execute' | 'code';
    detail?: string;
};

export type ThinkingBlock = {
    id: string;
    title: string;
    status: 'pending' | 'active' | 'completed';
    initialContext?: string;
    steps: ThinkingStep[];
    interimConclusion?: string;
    nextActionContext?: string;
    isPreviewable?: boolean;
    previewData?: any;
};

export type SearchSession = {
    sessionId: string;
    query: string;
    sourceType: 'email' | 'notes' | 'web' | 'calendar' | 'notion' | 'tasks';
    status: 'queued' | 'searching' | 'source_processing' | 'complete';
    resultCount?: number;
    selectedSnippets?: { subject?: string; from?: string; date?: string; title?: string }[];
};

interface ThinkingLayerProps {
    blocks: ThinkingBlock[];
    isVisible: boolean;
    currentThought?: string;
    isGenerating?: boolean;
    onStop?: () => void;
    searchSessions?: SearchSession[];
}

const sourceTypeConfig: Record<string, { icon: any; label: string }> = {
    email: { icon: <Mail className="w-3.5 h-3.5" />, label: 'Gmail' },
    notes: { icon: <FileText className="w-3.5 h-3.5" />, label: 'Notes' },
    web: { icon: <Globe className="w-3.5 h-3.5" />, label: 'Web' },
    calendar: { icon: <Calendar className="w-3.5 h-3.5" />, label: 'Calendar' },
    notion: { icon: <Database className="w-3.5 h-3.5" />, label: 'Notion' },
    tasks: { icon: <ListTodo className="w-3.5 h-3.5" />, label: 'Tasks' }
};

function ShiningLabel({ text, className }: { text: string; className?: string }) {
    return (
        <motion.span
            className={cn(
                "bg-[linear-gradient(110deg,#666,35%,#fff,50%,#666,75%,#666)] bg-[length:200%_100%] bg-clip-text text-transparent",
                className
            )}
            initial={{ backgroundPosition: "200% 0" }}
            animate={{ backgroundPosition: "-200% 0" }}
            transition={{
                repeat: Infinity,
                duration: 2,
                ease: "linear",
            }}
        >
            {text}
        </motion.span>
    );
}

/**
 * SearchTransparencyPanel — Refined minimal search block
 */
function SearchTransparencyPanel({ sessions }: { sessions: SearchSession[] }) {
    const [expanded, setExpanded] = useState<boolean>(true);
    const [userToggled, setUserToggled] = useState(false);

    const completedCount = sessions.filter(s => s.status === 'complete').length;
    const isAllComplete = sessions.length > 0 && completedCount === sessions.length;

    // Auto-collapse once every step finishes — the work is done, so the steps
    // fold away into a tidy "Completed N steps" summary the user can re-open.
    // Respects a manual toggle: if the user opened/closed it themselves, we
    // stop auto-managing it.
    useEffect(() => {
        if (isAllComplete && !userToggled) setExpanded(false);
    }, [isAllComplete, userToggled]);

    if (!sessions || sessions.length === 0) return null;

    return (
        <div className="w-full mb-4 relative pl-1">
            <button
                onClick={() => { setUserToggled(true); setExpanded(!expanded); }}
                className="flex items-center gap-2 py-1 text-[12px] font-semibold text-black/40 dark:text-white/30 hover:text-black/60 dark:hover:text-white/50 transition-colors"
            >
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", !expanded && "-rotate-90")} />
                <span className="uppercase tracking-widest">
                    {isAllComplete ? `Completed ${completedCount} step${completedCount !== 1 ? 's' : ''}` : `Executing ${sessions.length} step${sessions.length !== 1 ? 's' : ''}...`}
                </span>
            </button>

            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden mt-2 relative"
                    >
                        {/* Vertical Connector Line */}
                        <div className="absolute left-[7px] top-0 bottom-4 w-[1px] bg-black/[0.08] dark:bg-white/[0.08]" />

                        <div className="space-y-4">
                            {sessions.map((session, index) => {
                                const config = sourceTypeConfig[session.sourceType] || sourceTypeConfig.email;
                                const isSearching = session.status === 'searching' || session.status === 'source_processing';
                                const queries = session.query ? session.query.split('|').map(q => q.trim()).filter(Boolean) : [];
                                const displayQueries = queries.length > 0 ? queries : [`Scanning ${config.label}`];

                                return (
                                    <div key={session.sessionId} className="relative pl-6">
                                        {/* Dot */}
                                        <div className={cn(
                                            "absolute left-[5px] top-[6px] w-[5px] h-[5px] rounded-full z-10 border border-white dark:border-black",
                                            isSearching ? "bg-white dark:bg-white animate-pulse" : "bg-black/20 dark:bg-white/20"
                                        )} />
                                        
                                        <div className="space-y-2">
                                            <p className={cn(
                                                "text-[13px] font-medium tracking-tight",
                                                isSearching ? "text-black dark:text-white" : "text-black/50 dark:text-white/40"
                                            )}>
                                                {isSearching ? <ShiningLabel text={`Searching ${config.label}...`} /> : `Searched ${config.label}`}
                                            </p>

                                            {displayQueries.map((q, i) => (
                                                <div key={i} className="flex items-center gap-2 group/q">
                                                    <ChevronRight className="w-3 h-3 text-black/20 dark:text-white/10 group-hover/q:text-black/40 dark:group-hover/q:text-white/30" />
                                                    <span className="text-[12px] text-black/30 dark:text-white/20 font-medium tracking-tight">{q}</span>
                                                </div>
                                            ))}

                                            {session.selectedSnippets && session.selectedSnippets.length > 0 && (
                                                <div className="flex flex-wrap gap-2 mt-2">
                                                    {session.selectedSnippets.map((snippet, i) => (
                                                        <div key={i} className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.05] dark:border-white/[0.05]">
                                                            <div className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                                                            <span className="text-[11px] text-black/40 dark:text-white/30 font-medium truncate max-w-[120px]">
                                                                {snippet.subject || snippet.title || 'Match'}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/**
 * ThinkingLayer — Minimal, monochromatic task list
 */
export function ThinkingLayer({ blocks, isVisible, currentThought, isGenerating, searchSessions }: ThinkingLayerProps) {
    if (!isVisible || (blocks.length === 0 && !isGenerating && (!searchSessions || searchSessions.length === 0))) return null;

    return (
        <div className="relative pt-1 pb-2 space-y-4">
            {/* Search Transparency */}
            {searchSessions && searchSessions.length > 0 && (
                <SearchTransparencyPanel sessions={searchSessions} />
            )}

            <div className="relative">
                {/* Vertical Connector Line for blocks */}
                {blocks.length > 0 && (
                    <div className="absolute left-[7px] top-2 bottom-2 w-[1px] bg-black/[0.08] dark:bg-white/[0.08]" />
                )}

                <AnimatePresence mode="popLayout">
                    {blocks.map((block) => (
                        <motion.div
                            key={block.id}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="relative pl-6 mb-4 last:mb-0"
                        >
                            {/* Block Dot */}
                            <div className={cn(
                                "absolute left-[5px] top-[8px] w-[5px] h-[5px] rounded-full z-10 border border-white dark:border-black",
                                block.status === 'active' ? "bg-white dark:bg-white animate-pulse" : "bg-black/20 dark:bg-white/20"
                            )} />

                            <div className="space-y-2">
                                <h3 className={cn(
                                    "text-[13px] font-bold tracking-tight transition-all duration-500",
                                    block.status === 'completed' ? "text-black/30 dark:text-white/20" : "text-black/90 dark:text-white/90"
                                )}>
                                    {block.status === 'active' ? <ShiningLabel text={block.title} /> : block.title}
                                </h3>

                                {block.initialContext && block.status === 'active' && (
                                    <p className="text-[12px] text-black/40 dark:text-white/30 tracking-tight leading-relaxed font-medium">
                                        {block.initialContext}
                                    </p>
                                )}

                                {/* Steps as clean list items */}
                                <div className="space-y-1.5 mt-2">
                                    {block.steps.map((step) => (
                                        <div key={step.id} className="flex items-center gap-2 group/step">
                                            <div className={cn(
                                                "w-1 h-1 rounded-full shrink-0 transition-all",
                                                step.status === 'active' ? "bg-white dark:bg-white" : "bg-black/10 dark:bg-white/10"
                                            )} />
                                            <span className={cn(
                                                "text-[12px] font-medium tracking-tight",
                                                step.status === 'active' ? "text-black dark:text-white" : "text-black/30 dark:text-white/20"
                                            )}>
                                                {step.status === 'active' ? <ShiningLabel text={step.label} /> : step.label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {/* Live Thought Stream */}
            {currentThought && (
                <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }}
                    className="pl-6 py-1"
                >
                    <p className="text-[12px] text-black/40 dark:text-white/30 italic font-medium tracking-tight leading-relaxed flex items-center gap-2">
                        <ChevronRight className="w-3 h-3 opacity-30" />
                        <ShiningLabel text={currentThought} className="italic" />
                    </p>
                </motion.div>
            )}
        </div>
    );
}


/**
 * ResultCard — Simple and clear card for Boult execution results
 */
interface ResultCardProps {
    type: string;
    title: string;
    onView: () => void;
    rawContent?: string;
}

const iconCls = "w-5 h-5 text-black/55 dark:text-white/60";
const resultIcons: Record<string, any> = {
    email_draft: <Mail className={iconCls} />,
    summary: <FileText className={iconCls} />,
    research: <Search className={iconCls} />,
    action_plan: <Zap className={iconCls} />,
    reply: <Mail className={iconCls} />,
    notes: <FileText className={iconCls} />,
    meeting_schedule: <Calendar className={iconCls} />,
    analytics: <BarChart3 className={iconCls} />,
    notion: <Database className={iconCls} />,
    tasks: <ListTodo className={iconCls} />,
    report: <FileText className={iconCls} />,
    analysis: <FileText className={iconCls} />,
};

const resultLabels: Record<string, string> = {
    email_draft: 'Email · Draft',
    summary: 'Document · MD',
    research: 'Report · MD',
    action_plan: 'Plan · MD',
    reply: 'Email · Reply',
    notes: 'Notes · MD',
    meeting_schedule: 'Schedule · MD',
    analytics: 'Analytics · MD',
    notion: 'Notion · Page',
    tasks: 'Tasks · MD',
    report: 'Report · MD',
    analysis: 'Analysis · MD',
};

export function ResultCard({ type, title, onView, rawContent }: ResultCardProps) {
    const label = resultLabels[type] || 'Document · MD';
    
    const handleDownload = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!rawContent) return;
        const blob = new Blob([rawContent], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const safeTitle = (title || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '_');
        
        const isEmail = type === 'email_draft' || type === 'reply';
        link.setAttribute('download', `${safeTitle}.${isEmail ? 'txt' : 'md'}`);
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <motion.div
            whileTap={{ scale: 0.99 }}
            onClick={onView}
            className="group relative flex items-center gap-4 p-4 mt-3 mb-3 w-full max-w-[620px] rounded-2xl cursor-pointer boult-glass-card boult-glass-hover"
        >
            {/* Graphic card container — soft neutral tile, straightens on hover */}
            <div className="relative w-11 h-12 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] flex items-center justify-center shrink-0 transform -rotate-3 overflow-hidden transition-transform duration-300 group-hover:rotate-0">
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 dark:via-white/5 to-transparent pointer-events-none" />
                {resultIcons[type] || <FileText className="w-5 h-5 text-black/45 dark:text-white/55 transition-colors" />}
            </div>

            <div className="flex flex-col items-start gap-0.5 flex-1 min-w-0">
                <span className="text-black/90 dark:text-white/90 text-[14px] font-medium tracking-tight truncate group-hover:text-black dark:group-hover:text-white transition-colors">
                    {title || 'Untitled Document'}
                </span>
                <span className="text-[11px] text-black/45 dark:text-white/40 font-medium">
                    {label}
                </span>
            </div>

            {rawContent && (
                <button
                    onClick={handleDownload}
                    className="px-4 py-1.5 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-[11px] font-semibold text-black/80 dark:text-white/90 hover:bg-neutral-100 dark:hover:bg-white/10 hover:border-neutral-300 dark:hover:border-white/20 transition-all active:scale-95 shrink-0"
                >
                    Download
                </button>
            )}
        </motion.div>
    );
}

