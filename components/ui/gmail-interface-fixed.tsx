'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, type PanInfo, useAnimation, useDragControls, LayoutGroup } from 'framer-motion';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from './button';
import { SettingsCard } from './settings-card';
import { Badge } from './badge';
import { HomeFeedSidebar } from './home-feed-sidebar';
import { RefreshCw, AlertCircle, TrendingUp, Clock, Target, Zap, Mail, Home, X, User, Sparkles, ArrowLeft, LayoutList, Inbox, ExternalLink, Download, FilePlus, ChevronDown, ChevronRight, Plus, Users, Building, Phone, Loader2, MessageCircle, Send, ArrowUp, CornerDownLeft, Menu, Shield, Activity, PanelLeft, Mic, Copy, Link as LinkIcon, Bold, Italic, Paperclip, Check, Calendar, AlertTriangle, FileText, PenTool } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { toast } from 'sonner';
import { HelpCard } from './help-card';
import { RewardsCard } from './rewards-card';
import { SchedulingModal } from './scheduling-modal';
import { UsageLimitModal } from './usage-limit-modal';
import { UsageBadge } from './bubble-button';
import { TokenExpiryAlert } from './token-expiry-alert';
import { VoiceProfileModal } from './voice-profile-modal';
import { triggerSuccessConfetti } from '@/lib/confetti';
import { useDashboardSettings } from '@/lib/DashboardSettingsContext';
import ChatInterface from '../../app/dashboard/agent-talk/ChatInterface';
import { BoultQuickChat } from './boult-quick-chat';
import { HugeiconsIcon } from '@hugeicons/react';
import { Maximize01Icon, Minimize01Icon } from '@hugeicons/core-free-icons';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './tooltip';

// Simple markdown renderer for bold text
const renderMarkdown = (text: string): string => {
    if (!text) return text;
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Handle paragraphs: Split by double newlines and wrap in <p>
    const paragraphs = text.split(/\n\n+/);

    const renderedParagraphs = paragraphs.map(para => {
        // Handle bold: **text** -> <strong>text</strong>
        let processedPara = para.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-black dark:text-white brightness-125">$1</strong>');

        // Handle bullet points: Start with - or *
        if (processedPara.includes('\n- ') || processedPara.startsWith('- ') || processedPara.includes('\n* ') || processedPara.startsWith('* ')) {
            const lines = processedPara.split('\n');
            const listItems = lines.map(line => {
                const match = line.match(/^[\s]*[-*]\s*(.*)$/);
                if (match) {
                    return `<li>${match[1]}</li>`;
                }
                return line;
            });

            // Rejoin, wrapping groups of <li> in <ul>
            let joinedList = listItems.join('\n');
            joinedList = joinedList.replace(/(<li>[\s\S]*?<\/li>(?:\n<li>[\s\S]*?<\/li>)*)/g, '<ul class="list-disc list-inside my-4 space-y-2">$1</ul>');
            return joinedList;
        }

        // Linkify URLs
        processedPara = linkify(processedPara);

        // Handle single newlines: Convert to <br/>
        processedPara = processedPara.replace(/\n/g, '<br/>');

        return `<p class="mb-4 last:mb-0">${processedPara}</p>`;
    });

    return renderedParagraphs.join('');
};

/**
 * Clean HTML for embedding
 */
function cleanHtml(html: string) {
    if (!html) return '';

    // First style existing links
    let processed = html
        .replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" class="email-link" ')
        .replace(/<button/g, '<button class="email-button" ')
        .replace(/style="[^"]*background-color:[^"]*"/g, (match) => match + ' class="email-styled-element"');

    // Attempt to linkify plain text URLs in HTML (risky but needed)
    // Only linkify if they aren't inside a tag or attribute
    const urlRegex = /(?<!["'=])(https?:\/\/[^\s<]+[^.,;?!)\]\s<])/g;
    return processed.replace(urlRegex, (url) => {
        return linkify(url);
    });
}

/**
 * Wrap raw email HTML in a light-only document so dark app theme cannot
 * force a black iframe canvas (black text on black = blank viewer).
 */
function buildEmailSrcDoc(html: string) {
    const safe = html || '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="color-scheme" content="light only"/><meta name="supported-color-schemes" content="light"/><base target="_blank" rel="noopener noreferrer"/><style>
html,body{margin:0;padding:16px;background:#ffffff!important;color:#1a1a1a!important;color-scheme:light only;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;word-break:break-word;}
img{max-width:100%;height:auto;}a{color:#2563eb;}
</style></head><body>${safe}</body></html>`;
}

function emailBodyLooksLikeHtml(body: string | undefined | null, isHtmlFlag?: boolean) {
    if (isHtmlFlag) return true;
    if (!body) return false;
    return /<\/?[a-z][\s\S]*>/i.test(body);
}

/**
 * Detect and wrap URLs in plain text with premium styling for actions
 */
function linkify(text: string) {
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
            // Premium Action Button Layout
            return `
                <div class="my-6 p-[1px] bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 rounded-2xl shadow-2xl">
                    <div class="bg-white dark:bg-neutral-950 rounded-[0.95rem] p-6 flex flex-col items-center text-center">
                        <div class="w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
                            <svg class="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <h4 class="text-black dark:text-white font-bold text-lg mb-2">Priority Action Detected</h4>
                        <p class="text-neutral-500 dark:text-neutral-400 text-xs mb-6 max-w-[250px]">Secure verification link found in this message</p>
                        <a href="${url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center px-10 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all transform hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(37,99,235,0.4)] no-underline">
                            Open Link
                        </a>
                        <div class="mt-4 text-[9px] text-neutral-400 dark:text-neutral-700 font-mono break-all opacity-40 hover:opacity-100 transition-opacity select-all">
                            ${url}
                        </div>
                    </div>
                </div>
            `;
        }

        const displayUrl = url.length > 55 ? url.substring(0, 52) + '...' : url;
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline underline-offset-4 decoration-blue-500/30 transition-all clickable-link break-all font-medium" title="${url}">${displayUrl}</a>`;
    });
}

interface SiftInsight {
    id: string;
    type: string;
    title: string;
    subtitle: string;
    content: string;
    timestamp: string;
    metadata: any;
    section: string;
    user?: {
        name: string;
        company?: string;
        avatar: string;
        username?: string;
        title?: string;
    };
    source_emails?: {
        id: string;
        subject: string;
        snippet: string;
        sender: {
            name: string;
            email: string;
            avatar?: string;
        };
        receivedAt: string;
        body?: string;
    }[];
}

interface SiftInsightsResponse {
    success: boolean;
    insights: SiftInsight[];
    timestamp: string;
    userEmail: string;
    ai_version: string;
    sift_intelligence_summary?: {
        opportunities_detected: number;
        urgent_action_required: number;
        hot_leads_heating_up: number;
        conversations_at_risk: number;
        missed_follow_ups: number;
        unread_but_important: number;
    };
    nextPageToken?: string;
    error?: string;
    fallback?: any;
}

const LoadingTimer = () => {
    const [seconds, setSeconds] = React.useState(30);

    React.useEffect(() => {
        const timer = setInterval(() => {
            setSeconds(prev => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <span className="ml-1.5 text-[10px] font-mono opacity-50 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded-md border border-black/5 dark:border-white/5 inline-flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {seconds}s
        </span>
    );
};

interface GmailInterfaceFixedProps {
    /** When true, mount in traditional-inbox mode and hide the in-component
     *  Sift/Traditional toggle. The Today/Inbox tabs on the home-feed page
     *  drive the swap instead. */
    forceTraditionalView?: boolean;
}

export function GmailInterfaceFixed({ forceTraditionalView = false }: GmailInterfaceFixedProps = {}) {
    const { data: session } = useSession();
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Auto-fetch the traditional inbox when mounted in inbox-only mode. The
    // home-feed page mounts this with forceTraditionalView=true under the
    // Inbox tab, and the user expects the list to populate without a click.
    useEffect(() => {
        if (forceTraditionalView) {
            fetchTraditionalEmails();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [forceTraditionalView]);
    const [insights, setInsights] = useState<SiftInsight[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string>('');
    const [summary, setSummary] = useState<SiftInsightsResponse['sift_intelligence_summary']>();
    const [nextPageToken, setNextPageToken] = useState<string | null>(null);

    const [mounted, setMounted] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    const [hasInitialLoad, setHasInitialLoad] = useState(false);
    const [selectedInsight, setSelectedInsight] = useState<SiftInsight | null>(null);
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [emailSummary, setEmailSummary] = useState<string | null>(null);
    const [fullEmailBody, setFullEmailBody] = useState<string | null>(null);
    const [isLoadingFullEmail, setIsLoadingFullEmail] = useState(false);

    const [isDrafting, setIsDrafting] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [draftContent, setDraftContent] = useState<string>('');
    const [showDraftEditor, setShowDraftEditor] = useState(false);

    const [showSchedulingModal, setShowSchedulingModal] = useState(false);
    const [schedulingEmailId, setSchedulingEmailId] = useState<string | null>(null);


    const [isGmailConnected, setIsGmailConnected] = useState(true);

    const [isUsageLimitModalOpen, setIsUsageLimitModalOpen] = useState(false);
    const [usageLimitModalData, setUsageLimitModalData] = useState<{
        featureName: string;
        currentUsage: number;
        limit: number;
        period: 'daily' | 'monthly';
        currentPlan: 'free' | 'starter' | 'pro' | 'none';
    } | null>(null);

    const [isTokenExpired, setIsTokenExpired] = useState(false);

    const draftContentEditorRef = useRef<HTMLDivElement>(null);
    const [selection, setSelection] = useState<{ text: string; rect: DOMRect; start: number; end: number; range?: globalThis.Range } | null>(null);
    const [isRefinementActive, setIsRefinementActive] = useState(false);
    const hasFetchedInitialDataRef = useRef(false);
    const summaryAbortControllerRef = useRef<AbortController | null>(null);

    // Sift AI Action Feed state
    const [expandedEmailKey, setExpandedEmailKey] = useState<string | null>(null);
    const [syncingStates, setSyncingStates] = useState<Record<string, 'idle' | 'syncing' | 'success' | 'error'>>({});
    const [archivingStates, setArchivingStates] = useState<Record<string, 'idle' | 'archiving' | 'success' | 'error'>>({});
    const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});

    // Process insights to extract all actionable emails with drafts or insights reasons
    const allActionableEmails = useMemo(() => {
        if (!insights || insights.length === 0) return [];
        
        const emails: any[] = [];
        const seenKeys = new Set<string>();

        insights.forEach((insight: any) => {
            const category = insight.metadata?.category || insight.type;
            // Map the API card types back to standard keys if necessary
            let standardCategory = category;
            if (category === 'urgent-action') standardCategory = 'urgent';
            else if (category === 'hot-leads') standardCategory = 'lead';
            else if (category === 'at-risk') standardCategory = 'risk';
            else if (category === 'missed-followups') standardCategory = 'follow_up';
            else if (category === 'unread-important') standardCategory = 'important';

            const list = insight.source_emails || [];
            list.forEach((email: any) => {
                const uniqueKey = `${standardCategory}-${email.id}`;
                if (seenKeys.has(uniqueKey)) return;
                seenKeys.add(uniqueKey);

                emails.push({
                    ...email,
                    category: standardCategory,
                    uniqueKey
                });
            });
        });

        // Sort by category priority, then by date (most recent first)
        const categoryPriority: Record<string, number> = {
            urgent: 1,
            risk: 2,
            opportunity: 3,
            lead: 4,
            follow_up: 5,
            important: 6
        };

        return emails.sort((a, b) => {
            const pA = categoryPriority[a.category] || 10;
            const pB = categoryPriority[b.category] || 10;
            if (pA !== pB) return pA - pB;
            return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
        });
    }, [insights]);

    const handleSyncDraftCommand = async (email: any) => {
        const emailKey = email.uniqueKey;
        setSyncingStates(prev => ({ ...prev, [emailKey]: 'syncing' }));

        try {
            const draftBody = draftEdits[emailKey] !== undefined ? draftEdits[emailKey] : (email.draft || '');
            const response = await fetch('/api/gmail/drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    threadId: email.threadId || email.id,
                    recipient: email.sender?.email,
                    subject: email.subject,
                    body: draftBody
                })
            });

            if (!response.ok) {
                throw new Error('Failed to sync draft');
            }

            setSyncingStates(prev => ({ ...prev, [emailKey]: 'success' }));
        } catch (error) {
            console.error('Error syncing draft:', error);
            setSyncingStates(prev => ({ ...prev, [emailKey]: 'error' }));
        }
    };

    const handleArchiveEmailCommand = async (email: any) => {
        const emailKey = email.uniqueKey;
        setArchivingStates(prev => ({ ...prev, [emailKey]: 'archiving' }));

        try {
            const response = await fetch(`/api/gmail/messages/${email.id}/archive`, {
                method: 'POST'
            });

            if (!response.ok) {
                throw new Error('Failed to archive email');
            }

            setArchivingStates(prev => ({ ...prev, [emailKey]: 'success' }));
            
            // Seamlessly remove the email from insights list on success to animate it out
            setTimeout(() => {
                setInsights(currentInsights => {
                    return currentInsights.map(insight => {
                        if (!insight.source_emails) return insight;
                        const updatedEmails = insight.source_emails.filter((e: any) => e.id !== email.id);
                        return {
                            ...insight,
                            source_emails: updatedEmails,
                            title: insight.title.replace(/\(\d+\)$/, `(${updatedEmails.length})`)
                        };
                    });
                });
            }, 800);
        } catch (error) {
            console.error('Error archiving email:', error);
            setArchivingStates(prev => ({ ...prev, [emailKey]: 'error' }));
        }
    };

    // Sync state for contentEditable
    useEffect(() => {
        if (draftContentEditorRef.current && !isDrafting && draftContent !== draftContentEditorRef.current.innerHTML) {
            draftContentEditorRef.current.innerHTML = draftContent;
        }
    }, [draftContent, isDrafting]);

    const [refinementInstruction, setRefinementInstruction] = useState('');
    const [isProcessingRefinement, setIsProcessingRefinement] = useState(false);
    const [proposedRefinement, setProposedRefinement] = useState<string | null>(null);
    const [showTooltip, setShowTooltip] = useState(false);
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [linkInputUrl, setLinkInputUrl] = useState('');
    const [draftAttachments, setDraftAttachments] = useState<File[]>([]);
    const attachmentInputRef = useRef<HTMLInputElement>(null);
    const originalAiDraftRef = useRef<string>('');

    // --- All State Hooks ---

    // Usage & Subscription
    const [usageData, setUsageData] = useState<{
        planType: 'free' | 'starter' | 'pro' | 'none';
        features: Record<string, { usage: number; limit: number; period: 'daily' | 'monthly'; remaining: number; isUnlimited: boolean }>;
    } | null>(null);

    // View Management
    const [viewMode, setViewMode] = useState<'home' | 'people'>('home');

    // Traditional View states
    const [isTraditionalView, setIsTraditionalView] = useState(forceTraditionalView);
    const [traditionalEmails, setTraditionalEmails] = useState<any[]>([]);
    const [isLoadingTraditional, setIsLoadingTraditional] = useState(false);
    const [selectedTraditionalEmail, setSelectedTraditionalEmail] = useState<any | null>(null);
    const [isTraditionalModalOpen, setIsTraditionalModalOpen] = useState(false);
    const [isModalExpanded, setIsModalExpanded] = useState(false);
    const [isTraditionalLoadingError, setIsTraditionalLoadingError] = useState(false);
    const [traditionalNextPageToken, setTraditionalNextPageToken] = useState<string | null>(null);
    const [isLoadingMoreTraditional, setIsLoadingMoreTraditional] = useState(false);
    const [hasLoadedMore, setHasLoadedMore] = useState(false);

    // People View states
    const [contacts, setContacts] = useState<any[]>([]);
    const [isLoadingContacts, setIsLoadingContacts] = useState(false);
    const [selectedContactEmail, setSelectedContactEmail] = useState<string | null>(null);
    const [contactDetail, setContactDetail] = useState<any | null>(null);
    const [isLoadingContactDetail, setIsLoadingContactDetail] = useState(false);
    const [peopleSearchQuery, setPeopleSearchQuery] = useState('');

    const {
        settings,
        playSystemSound,
        showNotification
    } = useDashboardSettings();

    const [showSettings, setShowSettings] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [showRewards, setShowRewards] = useState(false);

    // Smart Nudges state
    const [hasAttemptedNudges, setHasAttemptedNudges] = useState(false);

    const [isVoiceProfileModalOpen, setIsVoiceProfileModalOpen] = useState(false);
    const [userVoiceProfile, setUserVoiceProfile] = useState<any>(null);
    const [isAnalyzingVoice, setIsAnalyzingVoice] = useState(false);

    // Fetch voice profile on mount
    useEffect(() => {
        const fetchVoiceProfile = async () => {
            try {
                const response = await fetch('/api/user/voice-profile');
                if (response.ok) {
                    const data = await response.json();
                    if (data.profile?.voice_profile) {
                        setUserVoiceProfile(data.profile.voice_profile);
                    }
                }
            } catch (error) {
                console.error('Error fetching voice profile:', error);
            }
        };
        fetchVoiceProfile();
    }, []);

    // Create/Analyze voice profile
    const handleCreateVoiceProfile = async () => {
        setIsAnalyzingVoice(true);
        try {
            const response = await fetch('/api/user/voice-profile', {
                method: 'POST'
            });
            const data = await response.json();
            
            if (response.ok && data.profile) {
                setUserVoiceProfile(data.profile);
                toast.success('Voice profile created successfully!');
            } else {
                toast.error(data.error || 'Failed to create voice profile');
            }
        } catch (error) {
            console.error('Error creating voice profile:', error);
            toast.error('Failed to create voice profile');
        } finally {
            setIsAnalyzingVoice(false);
        }
    };

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // --- Debouncing for API calls ---
    const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastFetchTimeRef = useRef<number>(0);

    // --- All Callbacks (useCallback) ---




    const fetchSiftInsights = useCallback(async (isLoadMore: boolean = false, forceRefresh: boolean = false) => {
        let timerInterval: any;
        try {
            setLoading(true);
            setError(null);

            const params = new URLSearchParams();
            if (isLoadMore) {
                params.set('loadMore', 'true');
                if (nextPageToken) {
                    params.set('pageToken', nextPageToken);
                }
            }
            if (forceRefresh) {
                params.set('refresh', 'true');
            }
            
            const url = params.toString() 
                ? `/api/home-feed/insights?${params.toString()}`
                : '/api/home-feed/insights';

            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            });

            if (response.status === 401) {
                setIsTokenExpired(true);
                setLoading(false);
                if (timerInterval) clearInterval(timerInterval);
                return;
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (errorData.error === 'Gmail not connected') {
                    setIsGmailConnected(false);
                    setLoading(false);
                if (timerInterval) clearInterval(timerInterval);
                    return;
                }
                throw new Error(errorData.error || `Sift AI encountered an issue (${response.status}). Please try again.`);
            }

            const data: SiftInsightsResponse = await response.json();
            console.log('📡 [Sift AI] Dashboard data received:', data);
            if (data.sift_intelligence_summary) {
                console.log('📊 [Sift AI] Summary stats:', data.sift_intelligence_summary);
            }

            if (data.success) {
                const unsubscribedResponse = await fetch('/api/email/unsubscribe/list', {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                });

                const unsubscribedData = await unsubscribedResponse.json();
                const unsubscribedEmailIds = unsubscribedData.success ? unsubscribedData.emails.map((e: any) => e.email_id) : [];

                const enrichedInsights = (data.insights || []).map(insight => {
                    let sourceEmails: any[] = insight.source_emails || [];
                    if (sourceEmails.length === 0 && insight.metadata) {
                        const meta = insight.metadata;
                        const category = meta.category || insight.type;
                        if (category === 'opportunity') {
                            sourceEmails = meta.opportunityDetails || [];
                        } else if (category === 'urgent' || category === 'urgent-action') {
                            sourceEmails = meta.urgentItems || [];
                        } else if (category === 'lead' || category === 'hot-leads') {
                            sourceEmails = meta.hotLeads || [];
                        } else if (category === 'risk' || category === 'at-risk') {
                            sourceEmails = meta.atRiskConversations || [];
                        } else if (category === 'follow_up' || category === 'missed-followups') {
                            sourceEmails = meta.missedFollowUps || [];
                        } else if (category === 'important' || category === 'unread-important') {
                            sourceEmails = meta.unreadImportantEmails || [];
                        } else {
                            sourceEmails = [];
                        }
                    }
                    const filteredEmails = sourceEmails.filter(email => !unsubscribedEmailIds.includes(email.id));
                    let processedEmails = filteredEmails.map(email => ({ ...email, key: `${email.id}-${insight.type}` }));
                    return { ...insight, source_emails: processedEmails };
                });

                if (isLoadMore) {
                    setInsights(prev => [...prev, ...enrichedInsights]);
                } else {
                    setInsights(enrichedInsights);
                }

                setSummary(data.sift_intelligence_summary);
                setLastUpdated(data.timestamp);
                setNextPageToken(data.nextPageToken || null);
                if (!isLoadMore) setHasInitialLoad(true);

                if (!isLoadMore && data.insights && data.insights.length > 0) {
                    playSystemSound('success');
                    showNotification('Boult Sift AI', {
                        body: `Discovered ${data.insights.length} new structural insights.`,
                        icon: '/favicon.ico'
                    });
                }
            } else {
                throw new Error(data.error || 'Failed to fetch insights');
            }
        } catch (error: any) {
            console.error('Error fetching insights:', error);
            setError(error.message);
            toast.error(error.message);
        } finally {
            setLoading(false);
            if (timerInterval) clearInterval(timerInterval);
        }
    }, [nextPageToken, setInsights, setSummary, setLastUpdated, setNextPageToken, setHasInitialLoad, playSystemSound, showNotification, setIsTokenExpired, setIsGmailConnected]);

    const fetchVoiceProfile = useCallback(async () => {
        try {
            const response = await fetch('/api/user/voice-profile');
            const data = await response.json();
            if (data.profile) {
                setUserVoiceProfile(data.profile);
            }
        } catch (error) {
            console.error('Error fetching voice profile:', error);
        }
    }, []);


    const fetchUsage = useCallback(async (force: boolean = false) => {
        const now = Date.now();

        if (!force && now - lastFetchTimeRef.current < 2000) {
            return;
        }

        if (fetchTimeoutRef.current) {
            clearTimeout(fetchTimeoutRef.current);
        }

        fetchTimeoutRef.current = setTimeout(async () => {
            try {
                const res = await fetch('/api/subscription/usage');
                if (res.status === 401) {
                    setIsTokenExpired(true);
                    return;
                }
                if (res.ok) {
                    const data = await res.json();
                    setUsageData({
                        planType: data.planType || 'none',
                        features: data.features || {}
                    });
                    lastFetchTimeRef.current = Date.now();
                }
            } catch (e) {
                console.warn('Failed to fetch usage', e);
            }
        }, force ? 0 : 500);
    }, [setUsageData]);

    const forceFetchUsage = useCallback(() => {
        fetchUsage(true);
    }, [fetchUsage]);

    useEffect(() => {
        if (session?.user?.email && !hasFetchedInitialDataRef.current) {
            hasFetchedInitialDataRef.current = true;
            fetchUsage(true);
            fetchVoiceProfile();
            // fetchSiftInsights() removed to prevent automatic credit usage on mount/focus
        }
    }, [session, fetchUsage, fetchVoiceProfile]);

    const fetchContacts = useCallback(async (query: string = '') => {
        setIsLoadingContacts(true);
        try {
            const searchParam = query ? `?search=${encodeURIComponent(query)}` : '';
            const response = await fetch(`/api/contacts/profiles${searchParam}`);
            if (!response.ok) throw new Error('Failed to fetch contacts');
            const data = await response.json();
            setContacts(data.contacts || []);
        } catch (err) {
            console.error('Error fetching contacts:', err);
            toast.error('Failed to load contacts');
        } finally {
            setIsLoadingContacts(false);
        }
    }, [setContacts, setIsLoadingContacts]);

    const fetchContactDetail = useCallback(async (email: string) => {
        setIsLoadingContactDetail(true);
        setSelectedContactEmail(email);
        try {
            const response = await fetch(`/api/contacts/profiles/${encodeURIComponent(email)}`);
            if (!response.ok) throw new Error('Failed to fetch contact details');
            const data = await response.json();
            setContactDetail(data.contact);
        } catch (err) {
            console.error('Error fetching contact details:', err);
            toast.error('Failed to load profile details');
        } finally {
            setIsLoadingContactDetail(false);
        }
    }, [setContactDetail, setIsLoadingContactDetail, setSelectedContactEmail]);

    // --- All Effects (useEffect) ---

    useEffect(() => {
        if (viewMode === 'people') {
            fetchContacts(peopleSearchQuery);
        }
    }, [viewMode, peopleSearchQuery, fetchContacts]);

    useEffect(() => {
        // Force fetch usage on component mount to get initial state
        forceFetchUsage();
    }, [forceFetchUsage]);



    useEffect(() => {
        setMounted(true);
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);

        // Cleanup fetch timeout on unmount
        return () => {
            window.removeEventListener('resize', checkMobile);
            if (fetchTimeoutRef.current) {
                clearTimeout(fetchTimeoutRef.current);
            }
        };
    }, []);




    // Reset email selection when closing panel or changing insight
    useEffect(() => {
        if (!selectedInsight) {
            setSelectedEmailId(null);
            setEmailSummary(null);
            setFullEmailBody(null);
            setIsSummarizing(false);
            setShowDraftEditor(false);
            setDraftContent('');
            setIsDrafting(false);
        }
    }, [selectedInsight]);

    // Reset modal expansion state when traditional modal is closed
    useEffect(() => {
        if (!isTraditionalModalOpen) {
            setIsModalExpanded(false);
        }
    }, [isTraditionalModalOpen]);


    // Sync draftContent to editor ref (more robust than dangerouslySetInnerHTML for contentEditable)
    useEffect(() => {
        if (draftContentEditorRef.current && isMounted) {
            // Only update if content actually differs to avoid cursor jump issues
            if (draftContentEditorRef.current.innerHTML !== draftContent) {
                draftContentEditorRef.current.innerHTML = draftContent;
            }
        }
    }, [draftContent, isMounted, showDraftEditor, isDrafting]);

    // AI Text Formatting Utility
    const decodeEntities = useCallback((text: string | null) => {
        if (!text) return '';
        return text
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&nbsp;/g, ' ')
            .replace(/&rsquo;/g, "'")
            .replace(/&lsquo;/g, "'")
            .replace(/&rdquo;/g, '"')
            .replace(/&ldquo;/g, '"')
            .replace(/&ndash;/g, '-')
            .replace(/&mdash;/g, '--');
    }, []);

    const formatAIText = useCallback((text: string | null) => {
        if (!text) return null;
        let decoded = decodeEntities(text);

        // Handle bold markdown **text**
        const parts = decoded.split(/(\*\*.*?\*\*)/g);

        return (
            <>
                {parts.map((part, i) => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                        const boldText = part.slice(2, -2);
                        return (
                            <strong
                                key={i}
                                className="font-bold text-black dark:text-white brightness-150"
                            >
                                {boldText}
                            </strong>
                        );
                    }

                    // Linkify the non-bold part
                    const urlRegex = /(https?:\/\/[^\s<]+[^.,;?!)\]\s<])/g;
                    const subParts = part.split(urlRegex);

                    return subParts.map((subPart, j) => {
                        if (subPart.match(urlRegex)) {
                            return (
                                <a
                                    key={`${i}-${j}`}
                                    href={subPart}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-500 hover:underline font-medium clickable-link"
                                >
                                    {subPart}
                                </a>
                            );
                        }
                        return subPart;
                    });
                })}
            </>
        );
    }, [decodeEntities]);

    const formatDate = useCallback((dateString: string | undefined | null, options?: Intl.DateTimeFormatOptions) => {
        if (!mounted || !dateString) return '';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleString(undefined, options);
        } catch (e) {
            return '';
        }
    }, [mounted]);

    const formatTime = useCallback((dateString: string | undefined | null) => {
        if (!mounted || !dateString) return '';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }, [mounted]);

    const formatDateOnly = useCallback((dateString: string | undefined | null) => {
        if (!mounted || !dateString) return '';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleDateString();
        } catch (e) {
            return '';
        }
    }, [mounted]);

    // Fetch the full email body for "Read Directly" feature
    const fetchFullEmailBody = async (emailId: string) => {
        setIsLoadingFullEmail(true);
        try {
            const response = await fetch(`/api/gmail/messages/${emailId}`);
            if (response.ok) {
                const data = await response.json();
                setFullEmailBody(data.body || data.snippet || 'No content available.');
            } else {
                // Fallback to snippet from source emails
                const snippet = selectedInsight?.source_emails?.find(e => e.id === emailId)?.snippet;
                setFullEmailBody(snippet || 'Could not load email content.');
            }
        } catch (error) {
            console.error('Error fetching full email:', error);
            const snippet = selectedInsight?.source_emails?.find(e => e.id === emailId)?.snippet;
            setFullEmailBody(snippet || 'Could not load email content.');
        } finally {
            setIsLoadingFullEmail(false);
        }
    };

    const handleEmailClick = async (emailId: string) => {
        // Cancel any pending summary request
        if (summaryAbortControllerRef.current) {
            summaryAbortControllerRef.current.abort();
        }

        setSelectedEmailId(emailId);
        setIsSummarizing(true);
        setEmailSummary(null);
        setFullEmailBody(null);

        const controller = new AbortController();
        summaryAbortControllerRef.current = controller;

        try {
            const response = await fetch('/api/email/summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailId }),
                signal: controller.signal
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (data?.error === 'limit_reached') {
                    setUsageLimitModalData({
                        featureName: 'Email Summary',
                        currentUsage: data.usage || 0,
                        limit: data.limit || 0,
                        period: data.period || 'daily',
                        currentPlan: data.planType || 'starter'
                    });
                    setIsUsageLimitModalOpen(true);
                    return;
                }
                throw new Error(data?.error || 'Failed to fetch summary');
            }
            setEmailSummary(decodeEntities(data.summary));
            forceFetchUsage();
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log('Summary request cancelled by user');
                return;
            }
            console.error('Error fetching summary:', error);
            setEmailSummary("Failed to generate summary. Please try again.");
        } finally {
            if (summaryAbortControllerRef.current === controller) {
                setIsSummarizing(false);
                summaryAbortControllerRef.current = null;
            }
        }
    };

    const fetchTraditionalEmails = async () => {
        setIsLoadingTraditional(true);
        setIsTraditionalLoadingError(false);
        setHasLoadedMore(false);
        try {
            const response = await fetch('/api/gmail/messages?maxResults=50');
            if (response.status === 401) {
                setIsTokenExpired(true);
                setIsLoadingTraditional(false);
                return;
            }
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (data.emails) {
                setTraditionalEmails(data.emails);
                setTraditionalNextPageToken(data.nextPageToken);
            } else {
                setTraditionalEmails([]);
                setTraditionalNextPageToken(null);
            }
        } catch (error) {
            console.error('Error fetching traditional emails:', error);
            setIsTraditionalLoadingError(true);
            toast.error('Failed to load traditional view', {
                description: error instanceof Error ? error.message : 'Unknown error'
            });
        } finally {
            setIsLoadingTraditional(false);
        }
    };

    const handleLoadMoreTraditional = async () => {
        if (!traditionalNextPageToken || isLoadingMoreTraditional) return;

        setIsLoadingMoreTraditional(true);
        const toastId = toast.loading('Fetching more emails...');
        try {
            const response = await fetch(`/api/gmail/messages?maxResults=25&pageToken=${traditionalNextPageToken}`);
            if (!response.ok) throw new Error('Failed to load more emails');

            const data = await response.json();
            if (data.emails && data.emails.length > 0) {
                setTraditionalEmails(prev => [...prev, ...data.emails]);
                setTraditionalNextPageToken(data.nextPageToken);
                setHasLoadedMore(true);
                toast.success(`Loaded ${data.emails.length} more emails`, { id: toastId });
            } else {
                setTraditionalNextPageToken(null);
                toast.info('No more emails found', { id: toastId });
            }
        } catch (error) {
            console.error('Error loading more emails:', error);
            toast.error('Failed to load more emails', { id: toastId });
        } finally {
            setIsLoadingMoreTraditional(false);
        }
    };

    const handleTraditionalEmailClick = async (emailId: string) => {
        // Prefill header from the list row so a failed detail fetch never shows
        // a hollow "Sender" shell with a black body.
        const preview = traditionalEmails.find((e) => e.id === emailId);
        setSelectedTraditionalEmail(preview ? { ...preview, body: preview.body || '', isHtml: !!preview.isHtml } : null);
        setIsTraditionalModalOpen(true);
        setIsSummarizing(true);
        try {
            const response = await fetch(`/api/gmail/messages/${emailId}`);
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data?.error) {
                throw new Error(data?.message || data?.error || 'Failed to load email details');
            }
            if (!data?.id) {
                throw new Error('Email response was incomplete');
            }
            setSelectedTraditionalEmail(data);
        } catch (error) {
            console.error('Error fetching email details:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to load email details');
            setSelectedTraditionalEmail(null);
            setIsTraditionalModalOpen(false);
        } finally {
            setIsSummarizing(false);
        }
    };

    const [draftSubject, setDraftSubject] = useState('');
    const [draftTo, setDraftTo] = useState('');
    const [draftOriginalEmailBody, setDraftOriginalEmailBody] = useState('');

    // Command Center hands off an ALREADY-EXISTING Gmail draft here (sessionStorage
    // key 'hf_open_draft', same handoff pattern as 'boult_prefill') when the user
    // clicks "Draft reply" on a thread that already has one — instead of a fresh AI
    // generation, open that real content directly in this editor, ready to review
    // and send. Runs once per mount of the Inbox tab; the key is cleared immediately
    // so revisiting the tab later doesn't reopen a stale handoff.
    useEffect(() => {
        if (!forceTraditionalView) return;
        let raw: string | null = null;
        try { raw = sessionStorage.getItem('hf_open_draft'); } catch { return; }
        if (!raw) return;
        try { sessionStorage.removeItem('hf_open_draft'); } catch { /* ignore */ }
        try {
            const draft = JSON.parse(raw) as { threadId: string; to: string; subject: string; body: string; isHtml: boolean };
            const html = draft.isHtml ? draft.body : (draft.body || '').replace(/\n/g, '<br/>');
            setDraftTo(draft.to || '');
            setDraftSubject(draft.subject || '');
            setDraftOriginalEmailBody(draft.body || '');
            setDraftContent(html);
            setDraftAttachments([]);
            setIsDrafting(false);
            setShowDraftEditor(true);
        } catch {
            /* malformed handoff payload — ignore, no editor opens */
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [forceTraditionalView]);

    const handleTraditionalDraftReply = async (email: any) => {
        setIsDrafting(true);
        setIsGenerating(true);
        setShowDraftEditor(true);
        setDraftContent('');
        setDraftAttachments([]);
        setSelection(null);
        setIsRefinementActive(false);
        setProposedRefinement('');
        
        setDraftTo(email.from?.match(/<(.+)>/)?.[1] || email.from);
        setDraftSubject(`Re: ${email.subject}`);
        setDraftOriginalEmailBody(email.body || email.snippet || '');
        
        try {
            const response = await fetch('/api/email/draft-reply?stream=true', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${(session as any)?.accessToken || ''}`
                },
                body: JSON.stringify({
                    emailId: email.id,
                    category: 'general',
                    tone: settings.aiTone,
                    aiProtection: settings.aiProtection,
                    privacyMode: settings.privacyMode,
                    voiceProfile: userVoiceProfile,
                    emailContent: (email.body || email.snippet || '').substring(0, 3000),
                    emailSubject: email.subject || 'Re:',
                    emailFrom: email.from || '',
                    emailSnippet: email.snippet || ''
                })
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                if (data?.error === 'limit_reached') {
                    setUsageLimitModalData({
                        featureName: 'Draft Reply',
                        currentUsage: data.usage || 0,
                        limit: data.limit || 0,
                        period: data.period || 'monthly',
                        currentPlan: data.planType || 'starter'
                    });
                    setIsUsageLimitModalOpen(true);
                    setShowDraftEditor(false);
                    return;
                }
                throw new Error(data?.error || 'Failed to generate draft');
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let accumulated = '';
            let hasShownFirstContent = false;
            
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    accumulated += decoder.decode(value, { stream: true });
                    
                    const processed = renderMarkdown(decodeEntities(accumulated));
                    setDraftContent(processed);
                    originalAiDraftRef.current = processed;

                    if (!hasShownFirstContent && accumulated.trim().length > 0) {
                        setIsDrafting(false);
                        hasShownFirstContent = true;
                    }
                }
            }

        } catch (error: any) {
            console.error('Error drafting traditional reply:', error);
            toast.error(error.message || 'Failed to generate AI draft');
        } finally {
            setIsDrafting(false);
            setIsGenerating(false);
        }
    };

    // ... (keep existing handleEmailClick)

    const handleDraftReply = async (emailId: string, category: string) => {
        setIsDrafting(true);
        setIsGenerating(true);
        setShowDraftEditor(true);
        setDraftContent('');

        // Get the email to reply to (already loaded in frontend - skip Gmail API call!)
        const email = selectedInsight?.source_emails?.find(e => e.id === emailId);
        if (email) {
            setDraftTo(email.sender.email);
            setDraftSubject(email.subject || 'Reply');
            setDraftOriginalEmailBody(email.body || email.snippet || '');
        }
        
        try {
            const response = await fetch('/api/email/draft-reply?stream=true', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${(session as any)?.accessToken || ''}`
                },
                body: JSON.stringify({
                    emailId,
                    category,
                    tone: settings.aiTone,
                    aiProtection: settings.aiProtection,
                    privacyMode: settings.privacyMode,
                    voiceProfile: userVoiceProfile,
                    // Pass email content directly - skips Gmail API call!
                    emailContent: email?.body || email?.snippet || '',
                    emailSubject: email?.subject || 'Re:',
                    emailFrom: email?.sender?.email || email?.sender?.name || '',
                    emailSnippet: email?.snippet || ''
                })
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                if (data?.error === 'limit_reached') {
                    setUsageLimitModalData({
                        featureName: 'Draft Reply',
                        currentUsage: data.usage || 0,
                        limit: data.limit || 0,
                        period: data.period || 'monthly',
                        currentPlan: data.planType || 'starter'
                    });
                    setIsUsageLimitModalOpen(true);
                    setShowDraftEditor(false);
                    return;
                }
                throw new Error(data?.error || 'Failed to generate draft');
            }

            // Stream response
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let accumulated = '';
            let hasShownFirstContent = false;

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    accumulated += chunk;
                    
                    // Update content immediately
                    setDraftContent(renderMarkdown(decodeEntities(accumulated)));
                    // Save original AI draft for continuous learning
                    originalAiDraftRef.current = renderMarkdown(decodeEntities(accumulated));

                    // Hide "Crafting" overlay once we have real content to show
                    if (!hasShownFirstContent && accumulated.trim().length > 0) {
                        setIsDrafting(false);
                        hasShownFirstContent = true;
                    }
                }
            }

            // If stream completed but no content was produced, show fallback
            if (accumulated.trim().length === 0) {
                setDraftContent('<p>The AI was unable to generate a draft. Please try again.</p>');
                setIsDrafting(false);
            }
            
            forceFetchUsage();
        } catch (error: any) {
            console.error('Error generating draft:', error);
            const msg = String(error?.message || '').toLowerCase();
            const isDailyLimit = msg.includes('429') || msg.includes('daily rate-limited') || msg.includes('free-models-per-day');
            const isBusy = !isDailyLimit && (msg.includes('rate limit') || msg.includes('models are currently busy') || msg.includes('all keys'));
            const isTokenExpired = msg.includes('token expired') || msg.includes('invalid_grant') || msg.includes('refresh failed');
            if (isDailyLimit) {
                toast.error('AI quota hit for today', {
                    description: "OpenRouter's free pool resets at midnight UTC. Open the email in Gmail directly, or upgrade for paid model fallback.",
                    duration: 7000,
                });
                setDraftContent('<p>The free AI model quota is exhausted for today. Open the email in Gmail to reply manually, or upgrade for paid fallback.</p>');
            } else if (isBusy) {
                toast.error('Models are slammed right now', {
                    description: 'Try again in a minute — Google\'s API is throttling the free pool.',
                    duration: 5000,
                });
                setDraftContent('<p>Models are busy right now. Close and try again in a minute.</p>');
            } else if (isTokenExpired) {
                toast.error('Gmail sign-in expired', {
                    description: 'Reconnect Google from the prompt-box connectors.',
                    duration: 7000,
                });
                setDraftContent('<p>Gmail sign-in expired. Reconnect from the connectors button to continue.</p>');
            } else {
                toast.error('Failed to generate draft reply', {
                    description: 'Close and try again. If it persists, the issue is on the model side.',
                });
                setDraftContent('<p>Failed to generate draft. Please close and try again.</p>');
            }
        } finally {
            setIsDrafting(false);
            setIsGenerating(false);
        }
    };


    const [isBoultQuickChatOpen, setIsBoultQuickChatOpen] = useState(false);
    const [quickChatContext, setQuickChatContext] = useState<{ emailId?: string; subject?: string } | null>(null);

    const handleSendAskAI = async (forcedQuery?: string, context?: { emailId?: string; subject?: string }) => {
        const queryToSend = forcedQuery || 'What is this about?';
        
        // Save the pending message and context to localStorage for handover
        localStorage.setItem('pending_boult_message', queryToSend);
        
        if (context?.emailId) {
            localStorage.setItem('pending_boult_options', JSON.stringify({
                emailId: context.emailId,
                subject: context.subject,
                source: 'gmail_interface'
            }));
        }

        if (context) {
            setQuickChatContext(context);
        }
        setIsBoultQuickChatOpen(true);
    };

    // --- Sift Refinement Logic ---
    const draftContainerRef = React.useRef<HTMLDivElement>(null);

    const handleSiftMouseUp = (e: React.MouseEvent) => {
        // Prevent clearing if we are clicking inside the toolkit or actively refining
        if (!showDraftEditor || isDrafting || isRefinementActive || isProcessingRefinement || proposedRefinement) return;

        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

        const range = sel.getRangeAt(0);
        const text = sel.toString();

        if (text && text.trim().length > 0) {
            const containerRect = draftContainerRef.current?.getBoundingClientRect();
            const rect = range.getBoundingClientRect();

            setSelection({
                text,
                start: 0,
                end: text.length,
                range,
                rect: {
                    ...rect,
                    y: rect.top - (containerRect?.top || 0) + 12,
                    x: rect.left - (containerRect?.left || 0) + (rect.width / 2)
                } as DOMRect
            });
            setShowTooltip(true);
        } else {
            // Only clear selection if we actually clicked away from everything
            const target = e.target as HTMLElement;
            if (!target.closest('.refinement-toolkit')) {
                setShowTooltip(false);
                setSelection(null);
            }
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!showDraftEditor) return;

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
                handleAcceptSiftRefinement();
                e.preventDefault();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showDraftEditor, selection, isRefinementActive, proposedRefinement, draftContent]);

    const handleSiftRefinementSubmit = async () => {
        if (!selection || !refinementInstruction.trim()) return;

        setIsProcessingRefinement(true);
        console.log("🚀 Sift Refinement Initiated:", { text: selection.text, instruction: refinementInstruction });

        try {
            const res = await fetch('/api/email/refine-reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fullContent: draftContent,
                    selectedText: selection.text,
                    instruction: refinementInstruction,
                    originalContext: draftOriginalEmailBody
                })
            });

            // Parse response ONCE
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                // Handle limit_reached by showing the upgrade modal
                if (data?.error === 'limit_reached') {
                    setUsageLimitModalData({
                        featureName: 'AI Refinement',
                        currentUsage: data.usage || 0,
                        limit: data.limit || 0,
                        period: data.period || 'daily',
                        currentPlan: data.planType || 'starter'
                    });
                    setIsUsageLimitModalOpen(true);
                    setIsRefinementActive(false);
                    return;
                }
                throw new Error(data?.error || 'Refinement API failed');
            }

            if (data.refinedText) {
                console.log("✅ Sift Refinement Received:", data.refinedText);
                setProposedRefinement(data.refinedText);
                setIsRefinementActive(false);
                setShowTooltip(false);
            } else {
                throw new Error("No refined text returned from AI");
            }
        } catch (error) {
            console.error('❌ Refinement failed:', error);
            toast.error('AI refinement failed', {
                description: error instanceof Error ? error.message : 'Please try again'
            });
            setIsRefinementActive(false);
            setSelection(null);
            setShowTooltip(false);
        } finally {
            setIsProcessingRefinement(false);
            setRefinementInstruction('');
        }
    };

    const handleAcceptSiftRefinement = () => {
        if (!selection || !proposedRefinement) return;
        
        // Use document.execCommand to replace the text seamlessly in the contentEditable
        if (selection.range) {
            const sel = window.getSelection();
            if (sel) {
                sel.removeAllRanges();
                sel.addRange(selection.range);
                document.execCommand('insertText', false, proposedRefinement);
                
                if (draftContentEditorRef.current) {
                    setDraftContent(draftContentEditorRef.current.innerHTML);
                }
            }
        } else {
            // Fallback (if somehow range is lost)
            setDraftContent(draftContent.replace(selection.text, proposedRefinement));
        }

        setProposedRefinement(null);
        setSelection(null);
    };

    const handleScheduleCall = async (emailId: string) => {
        setSchedulingEmailId(emailId);
        setShowSchedulingModal(true);
    };

    const handleEscalate = async (emailId: string) => {
        const toastId = toast.loading('Escalating urgent message...');

        try {
            const email = selectedInsight?.source_emails?.find(e => e.id === emailId);
            if (!email) {
                throw new Error('Email not found');
            }

            // Get the current user's email from session
            const userEmail = session?.user?.email;
            if (!userEmail) {
                throw new Error('User not authenticated');
            }

            // Prepare escalation data
            const escalationData = {
                emailId: emailId,
                subject: email.subject,
                sender: email.sender.email,
                senderName: email.sender.name,
                receivedAt: email.receivedAt,
                snippet: email.snippet,
                userEmail: userEmail,
                urgencyLevel: 'high',
                category: selectedInsight?.type || 'urgent'
            };

            // Call escalation API
            const response = await fetch('/api/email/escalate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(escalationData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to escalate message');
            }

            const result = await response.json();
            toast.success('Message escalated successfully! Team notified.', { id: toastId });
            triggerSuccessConfetti(); // Dopamine boost!
            console.log('✅ Escalation successful:', result);

        } catch (error: unknown) {
            console.error('❌ Escalation failed:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            toast.error(`Escalation failed: ${errorMessage}`, { id: toastId });
        }
    };
    const handleRepairReply = async (emailId: string, category: string) => {
        setIsDrafting(true);
        setShowDraftEditor(true);
        setDraftContent('');

        // Populate specific fields
        const email = selectedInsight?.source_emails?.find(e => e.id === emailId);
        if (email) {
            setDraftSubject(email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`);
            setDraftTo(email.sender.email);
        }

        try {
            const response = await fetch('/api/email/repair-reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailId, category })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (data?.error === 'limit_reached') {
                    setUsageLimitModalData({
                        featureName: 'Repair Reply',
                        currentUsage: data.usage || 0,
                        limit: data.limit || 0,
                        period: data.period || 'monthly',
                        currentPlan: data.planType || 'starter'
                    });
                    setIsUsageLimitModalOpen(true);
                    setShowDraftEditor(false);
                    return;
                }
                throw new Error(data?.error || 'Failed to generate repair reply');
            }
            setDraftContent(renderMarkdown(decodeEntities(data.repairReply)));
            forceFetchUsage();
        } catch (error) {
            console.error('Error generating repair reply:', error);
            setDraftContent(renderMarkdown("Dear there,\n\nThank you for reaching out. I appreciate your message and will respond shortly.\n\nWith gratitude,\n" + (session?.user?.name || 'User')));
        } finally {
            setIsDrafting(false);
            setIsGenerating(false);
        }
    };

    // Hand the newsletter pile-up to Boult: it digests them into a Canvas summary
    // and asks before clearing them out — reusing the tested agentic pipeline.
    const handleDigestNewsletters = () => {
        try {
            localStorage.setItem(
                'pending_boult_message',
                'I am subscribed to too many newsletters and have no time to read them. Digest my newsletters from the last 7 days into one clean summary of what actually matters, then ask me before archiving them out of my inbox.'
            );
            localStorage.removeItem('pending_boult_options');
        } catch { /* localStorage unavailable — navigation still works */ }
        toast.success('Opening Boult to digest your newsletters…');
        window.location.href = '/dashboard/agent-talk';
    };

    const handleUnsubscribe = async (emailId: string) => {
        const toastId = toast.loading('Unsubscribing from newsletter...');

        try {
            const email = selectedInsight?.source_emails?.find(e => e.id === emailId);
            if (!email) {
                throw new Error('Email not found');
            }

            // Get the current user's email from session
            const userEmail = session?.user?.email;
            if (!userEmail) {
                throw new Error('User not authenticated');
            }

            // Prepare unsubscribe data
            const unsubscribeData = {
                emailId: emailId,
                subject: email.subject,
                sender: email.sender.email,
                senderName: email.sender.name,
                receivedAt: email.receivedAt,
                snippet: email.snippet,
                userEmail: userEmail,
                userName: session?.user?.name || '',
                category: selectedInsight?.type || 'unread-important'
            };

            // Call unsubscribe API
            const response = await fetch('/api/email/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(unsubscribeData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to unsubscribe');
            }

            const result = await response.json();
            toast.success('Unsubscribed successfully! This email will no longer appear in your updates.', { id: toastId });
            triggerSuccessConfetti(); // Dopamine boost!
            console.log('✅ Unsubscribe successful:', result);

            // Refresh insights to update the list
            await fetchSiftInsights();

        } catch (error: unknown) {
            console.error('❌ Unsubscribe failed:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            toast.error(`Unsubscribe failed: ${errorMessage}`, { id: toastId });
        }
    };


    const handleSendReply = async () => {
        // Read HTML directly from the contentEditable editor to preserve all formatting
        const editorHtml = draftContentEditorRef.current?.innerHTML || draftContent;
        if (!draftTo || !draftSubject || !editorHtml) {
            toast.error('Please check recipients and content.');
            return;
        }

        const toastId = toast.loading('Sending email...');
        console.log('📡 Sending email to:', draftTo, 'Subject:', draftSubject);

        // Create the "Made by Maily" footer
        const footerHtml = `
            <br/><br/>
            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #888; font-family: system-ui, sans-serif;">
                <span style="opacity: 0.7; font-size: 12px; margin-right: 12px;">Made by Maily</span>
                <a href="https://maily.cfd/auth/signup" style="background-color: #ffffff; color: #000000; padding: 8px 16px; text-decoration: none; border-radius: 6px; font-weight: 500; border: 1px solid #e5e5e5; font-size: 12px; display: inline-block;">Join Now!</a>
            </div>
        `;

        // The editorHtml is already rich HTML from contentEditable (bold=<b>/<strong>, italic=<i>/<em>, link=<a>)
        // We just inline-style it for Gmail compatibility
        const bodyHtml = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 15px; line-height: 1.7; color: #222; text-align: left;">
                ${editorHtml
                    .replace(/<b>/gi, '<b style="font-weight:700;">')
                    .replace(/<strong>/gi, '<strong style="font-weight:700;">')
                    .replace(/<i>/gi, '<i style="font-style:italic;">')
                    .replace(/<em>/gi, '<em style="font-style:italic;">')
                    .replace(/<a /gi, '<a style="color:#1a73e8; text-decoration:underline;" ')
                }
            </div>
            ${footerHtml}
        `;

        try {
            // Encode attachments to base64
            let encodedAttachments: { filename: string, mimeType: string, content: string }[] = [];
            if (draftAttachments && draftAttachments.length > 0) {
                encodedAttachments = await Promise.all(
                    draftAttachments.map(async (file: File) => {
                        return new Promise<{ filename: string, mimeType: string, content: string }>((resolve) => {
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                const base64 = (e.target?.result as string).split(',')[1];
                                resolve({
                                    filename: file.name,
                                    mimeType: file.type || 'application/octet-stream',
                                    content: base64
                                });
                            };
                            reader.readAsDataURL(file);
                        });
                    })
                );
            }

            const response = await fetch('/api/gmail/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: draftTo,
                    subject: draftSubject,
                    body: bodyHtml,
                    isHtml: true,
                    threadId: selectedEmailId,
                    attachments: encodedAttachments
                })
            });

            const data = await response.json();

            if (response.ok) {
                console.log('✅ Email sent successfully:', data);
                toast.success('Email sent successfully!', { id: toastId });
                triggerSuccessConfetti(); // Dopamine boost!

                // Method 3: Continuous Learning — diff AI draft vs user's final version
                if (originalAiDraftRef.current && editorHtml) {
                    try {
                        fetch('/api/user/voice-profile/learn', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                aiDraft: originalAiDraftRef.current,
                                userFinal: editorHtml,
                            })
                        }).catch(() => {}); // Fire-and-forget
                    } catch (e) { /* non-blocking */ }
                }
                originalAiDraftRef.current = '';

                setShowDraftEditor(false);
                setDraftContent('');
                setDraftAttachments([]);
            } else {
                console.error('❌ Failed to send email:', data);
                toast.error(`Failed to send: ${data.error || 'Unknown error'}`, { id: toastId });
            }
        } catch (e) {
            console.error('💥 Send execution failed:', e);
            toast.error('Failed to send email due to a network or execution error.', { id: toastId });
        }
    };

    const refreshInsights = () => fetchSiftInsights();

    const getCardType = (insight: SiftInsight) => {
        const category = insight.metadata?.category || "";
        if (category === 'opportunity') return 'opportunity' as const;
        if (category === 'urgent') return 'urgent-action' as const;
        if (category === 'lead') return 'hot-leads' as const;
        if (category === 'risk') return 'at-risk' as const;
        if (category === 'follow_up') return 'missed-followups' as const;
        if (category === 'important') return 'unread-important' as const;

        const title = (insight.title || "").toLowerCase();
        if (title.includes('urgent') || title.includes('action')) return 'urgent-action' as const;
        if (title.includes('lead') || title.includes('hot')) return 'hot-leads' as const;
        if (title.includes('risk') || title.includes('at risk')) return 'at-risk' as const;
        if (title.includes('follow')) return 'missed-followups' as const;
        if (title.includes('important')) return 'unread-important' as const;
        if (title.includes('opportunity')) return 'opportunity' as const;

        switch (insight.section) {
            case 'opportunities': return 'opportunity' as const;
            case 'ai-highlights': return 'boult-suggestion' as const;
            case 'founder-execution': return 'founder-progress' as const;
            default: return 'inbox-intelligence' as const;
        }
    };

    const getActionButtons = (insight: SiftInsight) => {
        const type = getCardType(insight);
        switch (type) {
            case 'opportunity':
                return ['Draft Reply', 'Schedule Call'];
            case 'urgent-action':
                return ['Reply Now', 'Escalate'];
            case 'hot-leads':
                return ['Coming Soon', 'Schedule Meeting'];
            case 'at-risk':
                return ['Repair Reply', 'Escalate'];
            case 'unread-important':
                return ['Digest newsletters', 'Unsubscribe'];
            case 'missed-followups':
                return ['Send follow-up', 'Schedule call'];
            default:
                return ['Reply', 'View Details'];
        }
    };

    const totalItems = summary ? Object.values(summary as Record<string, number>).reduce((a: number, b: number) => a + b, 0) : 0;

    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isClient, setIsClient] = useState(false);
    useEffect(() => {
        setIsClient(true);
    }, []);

    const setIsBoultOpen = (open: boolean) => {
        setIsBoultQuickChatOpen(open);
    };

    return (
        <LayoutGroup>
            <div
                className={forceTraditionalView
                    ? "w-full bg-transparent flex flex-col overflow-hidden satoshi-dashboard"
                    : "min-h-screen bg-[#F9F8F6] dark:bg-[#0c0c0c] flex overflow-hidden satoshi-dashboard"
                }
                style={{ fontFamily: "Satoshi, sans-serif" }}
            >
                <UsageLimitModal
                    isOpen={isUsageLimitModalOpen}
                    onClose={() => setIsUsageLimitModalOpen(false)}
                    featureName={usageLimitModalData?.featureName || 'AI'}
                    currentUsage={usageLimitModalData?.currentUsage || 0}
                    limit={usageLimitModalData?.limit || 0}
                    period={usageLimitModalData?.period || 'monthly'}
                    currentPlan={usageLimitModalData?.currentPlan || 'starter'}
                />
                {/* Sidebar */}
                {!forceTraditionalView && (
                    <HomeFeedSidebar
                        onOpenSettings={() => setShowSettings(true)}
                        onOpenHelp={() => setShowHelp(true)}
                        onOpenRewards={() => setShowRewards(true)}
                        activeView={viewMode}
                        onCollapse={(collapsed) => setSidebarCollapsed(collapsed)}
                        isOpen={isMobileMenuOpen}
                        onClose={() => setIsMobileMenuOpen(false)}
                    />
                )}

                <AnimatePresence>
                    {showSettings && (
                        <SettingsCard 
                            onClose={() => setShowSettings(false)} 
                            onOpenHelp={() => setShowHelp(true)} 
                        />
                    )}
                    {showHelp && <HelpCard onClose={() => setShowHelp(false)} />}
                    {showRewards && (
                        <RewardsCard
                            onClose={() => setShowRewards(false)}
                            usageData={usageData || {
                                planType: 'free',
                                features: {
                                    boult_ai: { usage: 0, limit: 10, remaining: 10, isUnlimited: false, period: 'daily' },
                                    sift_ai: { usage: 0, limit: 5, remaining: 5, isUnlimited: false, period: 'daily' }
                                }
                            }}
                        />
                    )}
                </AnimatePresence>

                {/* Main Content Wrapper */}
                <motion.div
                    animate={{
                        // Must equal HomeFeedSidebar's real widths (72 collapsed / 260 expanded).
                        marginLeft: isMobile || forceTraditionalView ? 0 : (sidebarCollapsed ? 72 : 260),
                        width: isMobile || forceTraditionalView ? '100%' : `calc(100% - ${sidebarCollapsed ? 72 : 260}px)`
                    }}
                    initial={false}
                    transition={{ type: "spring", stiffness: 260, damping: 32, mass: 0.8 }}
                    className="flex-1 min-h-screen relative overflow-hidden bg-transparent flex flex-col"
                >
                    {/* Mobile Header */}
                    {isMobile && (
                        <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-[#111111] border-b border-neutral-200 dark:border-white/5 sticky top-0 z-40">
                            <button
                                onClick={() => setIsMobileMenuOpen(true)}
                                className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors text-neutral-600 dark:text-neutral-400"
                            >
                                <PanelLeft className="w-5 h-5" />
                            </button>
                            <span className="font-bold text-sm tracking-tight text-neutral-900 dark:text-white whitespace-nowrap">Home Feed</span>
                            <button
                                onClick={() => setIsBoultOpen(true)}
                                className="p-2 bg-black dark:bg-white text-white dark:text-black rounded-lg"
                            >
                                <Sparkles className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                    <TokenExpiryAlert isVisible={isTokenExpired} />

                    {/* Security & Credits Section */}
                    <div className="absolute top-6 right-10 z-50 flex items-center gap-4">
                        {usageData && usageData.planType !== 'pro' && (
                            <UsageBadge
                                icon={<Sparkles className="h-3.5 w-3.5 text-amber-500" />}
                                planName={(usageData.planType as string) === 'starter' ? 'Starter' : (usageData.planType as string) === 'pro' ? 'Pro' : 'Free'}
                                usage={usageData.features?.boult_ai?.usage || 0}
                                limit={usageData.features?.boult_ai?.limit || 5}
                                tooltipContent={
                                    <p className="text-[10px] font-medium uppercase tracking-wider">
                                        {(usageData.planType as string) === 'starter' ? 'Starter' : (usageData.planType as string) === 'pro' ? 'Pro' : 'Free'} Plan
                                        <br />
                                        <span className="text-black dark:text-white/40 font-light lowercase">
                                            {usageData.features?.boult_ai?.remaining ?? 5} credits left
                                        </span>
                                    </p>
                                }
                            />
                        )}
                    </div>

                    {/* The Curvy Content Area.
                        PART 69 — when mounted as the Inbox tab (forceTraditionalView),
                        drop the inner card chrome (rounded corners, border, shadow)
                        so the tab body shares the same flat background as the Today
                        tab and the swap doesn't feel like jumping into a different
                        app. Keeps the chrome for legacy direct-mount paths. */}
                    <div className={forceTraditionalView
                        ? 'min-h-screen overflow-y-auto custom-scrollbar bg-transparent'
                        : 'mt-0 md:mt-2.5 mr-0 md:mr-2.5 mb-0 md:mb-2.5 bg-white dark:bg-[#111111] rounded-none md:rounded-[2.5rem] min-h-screen md:min-h-[calc(100vh-20px)] border-none md:border border-[#EBE9E2] dark:border-white/[0.05] shadow-none md:shadow-[0_20px_50px_rgba(0,0,0,0.06)] dark:shadow-none overflow-y-auto custom-scrollbar'
                    }>
                        <div className={`${viewMode === 'people' ? 'max-w-[1600px]' : 'max-w-5xl'} mx-auto px-4 md:px-10 py-8 md:py-12 duration-500`}>

                            {/* Header */}
                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-12 md:mb-16">
                                <div className="flex items-center gap-4 w-full md:w-auto">
                                    <button
                                        onClick={() => setIsMobileMenuOpen(true)}
                                        className="md:hidden p-2 -ml-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors text-neutral-600 dark:text-neutral-400"
                                    >
                                        <Menu className="w-6 h-6" />
                                    </button>
                                    {/* PART 69 — when mounted as the Inbox tab inside the
                                        home-feed page, the parent already shows a Today/Inbox
                                        tab bar that serves as the page identifier. The
                                        duplicate "Home" heading here looked inconsistent
                                        between the two tabs, so we hide it in that mode. */}
                                    {!forceTraditionalView && (
                                        <>
                                            {viewMode === 'people' ? (
                                                <Users className="w-6 h-6 text-[#fafafa]" strokeWidth={1.5} />
                                            ) : (
                                                <Home className="w-5 h-5 text-[#666666] dark:text-neutral-400" strokeWidth={1.5} />
                                            )}
                                            <h1 className="text-2xl font-semibold text-[#1A1A1A] dark:text-white tracking-tight">
                                                {viewMode === 'people' ? 'People' : 'Home'}
                                            </h1>
                                        </>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center gap-3 md:gap-6 w-full md:w-auto">

                                    {lastUpdated && (
                                        <span className="text-xs text-neutral-600 dark:text-neutral-500 font-light">
                                            Updated {lastUpdated}
                                        </span>
                                    )}
                                    {!forceTraditionalView && (
                                        <button
                                            onClick={() => {
                                                const nextState = !isTraditionalView;
                                                setIsTraditionalView(nextState);
                                                if (nextState && traditionalEmails.length === 0) {
                                                    fetchTraditionalEmails();
                                                }
                                            }}
                                            className="h-10 px-6 bg-white dark:bg-white/[0.05] text-black dark:text-white rounded-xl text-sm font-medium flex items-center gap-3 group border border-neutral-200 dark:border-white/20 transition-all hover:bg-neutral-50 dark:hover:bg-white/[0.1] shadow-sm"
                                        >
                                            {isTraditionalView ? (
                                                <>
                                                    <Sparkles className="h-4 w-4 text-amber-500 group-hover:scale-110 transition-transform" />
                                                    <span className="text-black dark:text-white">Switch to AI Sift</span>
                                                </>
                                            ) : (
                                                <>
                                                    <LayoutList className="h-4 w-4 text-blue-500 group-hover:scale-110 transition-transform" />
                                                    <span className="text-black dark:text-white">Switch to Traditional</span>
                                                </>
                                            )}
                                        </button>
                                    )}

                                    <Button
                                        onClick={() => isTraditionalView ? fetchTraditionalEmails() : fetchSiftInsights(true)}
                                        disabled={loading || isLoadingTraditional || (!isTraditionalView && !nextPageToken)}
                                        className="h-9 px-4 bg-transparent hover:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:text-[#fafafa] rounded-lg transition-colors flex items-center gap-2"
                                        size="sm"
                                    >
                                        <Sparkles className={`h-3.5 w-3.5 ${loading || isLoadingTraditional ? 'animate-pulse' : ''}`} />
                                        <span>{loading || isLoadingTraditional ? 'Sifting...' : 'Load More'}</span>
                                    </Button>
                                    <Button
                                        onClick={() => isTraditionalView ? fetchTraditionalEmails() : fetchSiftInsights(false, true)}
                                        disabled={loading || isLoadingTraditional}
                                        className="h-9 px-4 bg-transparent hover:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:text-[#fafafa] rounded-lg transition-colors flex items-center gap-2"
                                        size="sm"
                                    >
                                        <RefreshCw className={`h-3.5 w-3.5 ${loading || isLoadingTraditional ? 'animate-spin' : ''}`} />
                                        <span>{loading || isLoadingTraditional ? 'Syncing' : 'Refresh'}</span>
                                    </Button>
                                </div>
                            </div>

                            {/* Stats Grid */}
                            {summary && (
                                <div className="mb-12 md:mb-16 overflow-hidden rounded-2xl border border-neutral-200 dark:border-white/5 bg-white dark:bg-[#111111] shadow-[0_20px_50px_rgba(0,0,0,0.06)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y divide-neutral-200 dark:divide-white/5 lg:divide-y-0">
                                         {/* Opportunities */}
                                         <div className="p-6 transition-colors bg-transparent">
                                             <div className="flex items-center gap-3 mb-4">
                                                 <Target className="h-4 w-4 text-neutral-500" strokeWidth={1} />
                                             </div>
                                             <p className="text-2xl font-light text-black dark:text-white mb-1">{summary.opportunities_detected || 0}</p>
                                             <p className="text-xs text-neutral-500 font-light tracking-tight">Opportunities</p>
                                         </div>

                                         {/* Urgent */}
                                         <div className="p-6 transition-colors bg-transparent">
                                             <div className="flex items-center gap-3 mb-4">
                                                 <Zap className="h-4 w-4 text-neutral-500" strokeWidth={1} />
                                             </div>
                                             <p className="text-2xl font-light text-black dark:text-white mb-1">{summary.urgent_action_required || 0}</p>
                                             <p className="text-xs text-neutral-500 font-light tracking-tight">Urgent</p>
                                         </div>

                                         {/* Hot Leads */}
                                         <div className="p-6 transition-colors bg-transparent">
                                             <div className="flex items-center gap-3 mb-4">
                                                 <TrendingUp className="h-4 w-4 text-neutral-500" strokeWidth={1} />
                                             </div>
                                             <p className="text-2xl font-light text-black dark:text-white mb-1">{summary.hot_leads_heating_up || 0}</p>
                                             <p className="text-xs text-neutral-500 font-light tracking-tight">Hot Leads</p>
                                         </div>

                                         {/* At Risk */}
                                         <div className="p-6 transition-colors bg-transparent">
                                             <div className="flex items-center gap-3 mb-4">
                                                 <AlertCircle className="h-4 w-4 text-neutral-500" strokeWidth={1} />
                                             </div>
                                             <p className="text-2xl font-light text-black dark:text-white mb-1">{summary.conversations_at_risk || 0}</p>
                                             <p className="text-xs text-neutral-500 font-light tracking-tight">At Risk</p>
                                         </div>

                                         {/* Follow-ups */}
                                         <div className="p-6 transition-colors bg-transparent">
                                             <div className="flex items-center gap-3 mb-4">
                                                 <Clock className="h-4 w-4 text-neutral-500" strokeWidth={1} />
                                             </div>
                                             <p className="text-2xl font-light text-black dark:text-white mb-1">{summary.missed_follow_ups || 0}</p>
                                             <p className="text-xs text-neutral-500 font-light tracking-tight">Follow-ups</p>
                                         </div>

                                         {/* Important */}
                                         <div className="p-6 transition-colors bg-transparent">
                                             <div className="flex items-center gap-3 mb-4">
                                                 <Mail className="h-4 w-4 text-neutral-500" strokeWidth={1} />
                                             </div>
                                             <p className="text-2xl font-light text-black dark:text-white mb-1">{summary.unread_but_important || 0}</p>
                                             <p className="text-xs text-neutral-500 font-light tracking-tight">Newsletters</p>
                                         </div>
                                     </div>
                                 </div>
                             )}


                            {/* Error & Limit Reached States */}
                            {error && (
                                <div className="mb-12">
                                    {error === 'limit_reached' ? (
                                        <div className="bg-white dark:bg-[#0a0a0a] border border-neutral-200 dark:border-zinc-800/50 rounded-2xl px-6 py-4 flex items-center justify-between shadow-xl backdrop-blur-xl">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 bg-zinc-900 border border-neutral-200 dark:border-zinc-800 rounded-full flex items-center justify-center shrink-0">
                                                    <Sparkles className="w-5 h-5 text-black dark:text-white" />
                                                </div>
                                                <p className="text-neutral-900 dark:text-zinc-200 text-[14px] font-medium tracking-tight">
                                                    Your credits have been used up. Please upgrade your plan for more credits.
                                                </p>
                                            </div>
                                            <a
                                                href="/pricing"
                                                className="h-10 px-6 bg-black text-white hover:bg-black/85 dark:bg-white dark:hover:bg-zinc-200 dark:text-black rounded-full text-[13px] font-bold transition-all shadow-lg shadow-black/10 dark:shadow-white/5 flex items-center justify-center shrink-0 active:scale-95"
                                            >
                                                Upgrade
                                            </a>
                                        </div>
                                    ) : (
                                        <div className="p-4 border border-neutral-200 dark:border-zinc-800 rounded-xl bg-neutral-50 dark:bg-zinc-900/30 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <AlertCircle className="h-4 w-4 text-neutral-600 dark:text-zinc-500" />
                                                <p className="text-sm text-neutral-600 dark:text-zinc-400 font-light">{error}</p>
                                            </div>
                                            {(error.toLowerCase().includes('refresh token') || error.toLowerCase().includes('expired')) && (
                                                <Button
                                                    onClick={() => signOut({ callbackUrl: '/' })}
                                                    variant="outline"
                                                    className="h-8 px-4 text-xs bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-neutral-600 dark:text-neutral-300 border-neutral-300 dark:border-neutral-700/50 flex-shrink-0"
                                                >
                                                    Sign In Again
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* People View */}
                            {viewMode === 'people' ? (
                                <div className="flex gap-6 min-h-[700px] animate-in fade-in slide-in-from-bottom-2 duration-500">

                                    {/* Left Column: Contact Sidebar (Hidden on Mobile/Tablet) */}
                                    <div className="hidden xl:flex w-64 bg-neutral-50 dark:bg-neutral-900/10 border border-neutral-200 dark:border-neutral-800/30 rounded-3xl overflow-hidden flex-col duration-500 border-dashed">
                                        {!selectedContactEmail ? (
                                            <div className="flex-1 flex items-center justify-center p-8 opacity-20">
                                                <div className="w-px h-12 bg-black/20 dark:bg-white/20" />
                                            </div>
                                        ) : (
                                            <div className="p-6 space-y-8 animate-in fade-in slide-in-from-left-4 duration-500">
                                                <div className="space-y-4">
                                                    <h4 className="text-[10px] uppercase tracking-[0.2em] font-bold text-neutral-600">Filters</h4>
                                                    <div className="space-y-1">
                                                        {['All Activity', 'Sent', 'Received', 'Attachments', 'Reminders'].map((filter) => (
                                                            <button key={filter} className="w-full text-left px-3 py-2 text-xs text-neutral-600 hover:text-black dark:text-white hover:bg-black/5 dark:bg-white/5 rounded-lg transition-all font-normal">
                                                                {filter}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="space-y-4">
                                                    <h4 className="text-[10px] uppercase tracking-[0.2em] font-bold text-neutral-600">Timeline</h4>
                                                    <div className="space-y-4 pl-2">
                                                        {[
                                                            { date: 'Recent', desc: 'Latest interaction' },
                                                            { date: '30d+', desc: 'Stable period' },
                                                            { date: 'Initial', desc: 'First contact' }
                                                        ].map((t) => (
                                                            <div key={t.date} className="relative pl-4 border-l border-neutral-200 dark:border-white/5">
                                                                <div className="absolute -left-[4.5px] top-1 w-2 h-2 rounded-full bg-black/10 dark:bg-white/10" />
                                                                <p className="text-[10px] text-black dark:text-white/60 font-medium">{t.date}</p>
                                                                <p className="text-[9px] text-neutral-600 font-light">{t.desc}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Middle Column: Conversation List */}
                                    <div className={`${selectedContactEmail ? 'hidden lg:flex' : 'flex'} flex-1 bg-white dark:bg-[#0a0a0a] border border-neutral-200 dark:border-neutral-800/50 rounded-3xl overflow-hidden flex-col shadow-sm duration-300`}>
                                        <div className="p-6 border-b border-neutral-100 dark:border-white/[0.03] flex items-center justify-between bg-black/[0.01] dark:bg-white/[0.01]">
                                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-neutral-600 dark:text-neutral-500">Recently Contacted</h3>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    placeholder="Search people..."
                                                    value={peopleSearchQuery}
                                                    onChange={(e) => setPeopleSearchQuery(e.target.value)}
                                                    className="bg-black/5 dark:bg-white/5 border border-neutral-200 rounded-full px-4 py-1.5 text-xs text-black dark:text-white placeholder-white/20 focus:outline-none focus:border-neutral-200 dark:border-white/10 transition-all w-48 font-normal"
                                                />
                                            </div>
                                        </div>
                                        <div className="max-h-[700px] overflow-y-auto custom-scrollbar">
                                            {isLoadingContacts && contacts.length === 0 ? (
                                                <div className="py-12 md:py-20 animate-in fade-in duration-700 flex flex-col items-center justify-center">
                                                    <div className="w-8 h-8 border-2 border-neutral-200 dark:border-neutral-700 border-t-neutral-900 dark:border-t-neutral-300 rounded-full animate-spin" />
                                                    <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">Loading contacts...</p>
                                                </div>
                                            ) : contacts.length > 0 ? (
                                                contacts.map((contact) => (
                                                    <div
                                                        key={contact.email}
                                                        onClick={() => fetchContactDetail(contact.email)}
                                                        className={`group flex items-center gap-6 p-5 hover:bg-white/[0.04] active:bg-white/[0.06] transition-all cursor-pointer border-b border-white/[0.02] last:border-0 relative ${selectedContactEmail === contact.email ? 'bg-black/[0.05] dark:bg-white/[0.05]' : ''}`}
                                                    >
                                                        <Avatar className="w-12 h-12 border border-neutral-200 dark:border-white/[0.05]">
                                                            <AvatarFallback className="bg-neutral-800 text-black dark:text-white/50 text-sm font-normal">
                                                                {contact.name?.[0]?.toUpperCase() || contact.email?.[0]?.toUpperCase() || 'U'}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex justify-between items-center mb-1">
                                                                <h4 className="text-sm font-semibold text-black truncate group-hover:text-black dark:text-white transition-colors">
                                                                    {contact.name || contact.email.split('@')[0]}
                                                                </h4>
                                                                <span className="text-[10px] uppercase tracking-widest text-neutral-600 font-medium">
                                                                    {contact.frequency}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-neutral-600 dark:text-neutral-500 truncate font-light leading-relaxed">
                                                                {contact.email}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-3 pr-2">
                                                            <div className="text-[10px] text-black dark:text-white/20 font-mono">
                                                                {contact.totalEmails} emails
                                                            </div>
                                                            <ChevronRight className={`w-4 h-4 text-neutral-600 transition-all ${selectedContactEmail === contact.email ? 'translate-x-1 text-black dark:text-white' : 'opacity-0 group-hover:opacity-100'}`} />
                                                        </div>
                                                        {selectedContactEmail === contact.email && (
                                                            <div className="absolute inset-y-0 left-0 w-1 bg-black dark:bg-white" />
                                                        )}
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="py-32 text-center">
                                                    <Users className="w-8 h-8 mx-auto text-neutral-700 mb-4" strokeWidth={1} />
                                                    <h3 className="text-lg font-light text-neutral-900 dark:text-neutral-300">No contacts found</h3>
                                                    <p className="text-sm text-neutral-600 mt-2 font-light">Try searching for someone else.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Right Column: Profile Details */}
                                    <div className="w-[400px] flex flex-col bg-neutral-900/40 border border-neutral-200 dark:border-neutral-800/50 rounded-3xl overflow-hidden shadow-2xl">
                                        {!selectedContactEmail ? (
                                            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                                                <div className="w-20 h-20 bg-black/[0.02] dark:bg-white/[0.02] border border-white/[0.05] rounded-full flex items-center justify-center mb-6">
                                                    <User className="w-8 h-8 text-black dark:text-white/10" strokeWidth={1} />
                                                </div>
                                                <h3 className="text-lg font-light text-black dark:text-white/30 mb-2">Select a profile</h3>
                                                <p className="text-sm text-black dark:text-white/10 font-light max-w-[200px]">Choose someone from the list to view their relationship history.</p>
                                            </div>
                                        ) : isLoadingContactDetail ? (
                                            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                                                <Loader2 className="w-8 h-8 text-black dark:text-white/20 animate-spin mb-4" />
                                                <p className="text-black dark:text-white/20 font-light">Fetching details...</p>
                                            </div>
                                        ) : contactDetail ? (
                                            <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                                                {/* Profile Header */}
                                                <div className="flex flex-col items-center text-center mb-10">
                                                    <Avatar className="w-24 h-24 border border-neutral-200 dark:border-white/10 mb-6">
                                                        <AvatarFallback className="bg-neutral-800 text-black dark:text-white/80 text-3xl font-normal">
                                                            {(contactDetail.name || contactDetail.email)?.[0]?.toUpperCase()}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <h2 className="text-2xl font-normal text-black dark:text-white mb-1">
                                                        {contactDetail.name || contactDetail.email.split('@')[0]}
                                                    </h2>
                                                    <p className="text-black dark:text-white/40 text-sm font-normal truncate max-w-full">{contactDetail.email}</p>

                                                    <div className="flex gap-3 mt-8">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="border-neutral-200 dark:border-white/10 text-black dark:text-white/80 hover:bg-black/5 dark:bg-white/5 rounded-full px-6 font-normal"
                                                            onClick={() => window.open(`mailto:${contactDetail.email}`, '_blank')}
                                                        >
                                                            Email
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="border-neutral-200 dark:border-white/10 text-black dark:text-white/80 hover:bg-black/5 dark:bg-white/5 rounded-full px-6 font-normal"
                                                            onClick={() => window.open(`tel:${contactDetail.phone || ''}`, '_blank')}
                                                        >
                                                            Call
                                                        </Button>
                                                    </div>
                                                </div>

                                                {/* AI Insight */}
                                                {contactDetail.aiSuggestion && (
                                                    <div className="mb-10 bg-black/5 dark:bg-white/5 border border-neutral-200 dark:border-white/5 rounded-2xl p-6 relative overflow-hidden group">
                                                        <div className="flex items-center gap-2 mb-3 text-black dark:text-white/30">
                                                            <Sparkles className="w-3.5 h-3.5" />
                                                            <span className="text-[10px] font-bold uppercase tracking-widest">AI Intelligence</span>
                                                        </div>
                                                        <p className="text-sm text-black dark:text-white/90 leading-relaxed font-normal italic">
                                                            "{contactDetail.aiSuggestion}"
                                                        </p>
                                                        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-blue-500/10 transition-colors" />
                                                    </div>
                                                )}

                                                {/* Stats Grid */}
                                                <div className="grid grid-cols-2 gap-3 mb-10">
                                                    {[
                                                        { label: 'Total Emails', value: contactDetail.totalEmails },
                                                        { label: 'Score', value: `${contactDetail.relationshipScore}%` },
                                                        { label: 'Sent', value: contactDetail.sentEmails },
                                                        { label: 'Received', value: contactDetail.receivedEmails }
                                                    ].map((item, i) => (
                                                        <div key={i} className="bg-black/[0.02] dark:bg-white/[0.02] border border-neutral-200 dark:border-white/5 rounded-2xl p-4 hover:bg-white/[0.04] transition-colors">
                                                            <span className="text-[10px] text-black dark:text-white/20 block mb-1 font-bold uppercase tracking-wider">{item.label}</span>
                                                            <span className="text-xl text-black dark:text-white font-normal">{item.value}</span>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Sentiment History */}
                                                {contactDetail.sentimentHistory?.length > 0 && (
                                                    <div className="mb-10">
                                                        <h3 className="text-[10px] text-black dark:text-white/20 mb-4 font-bold uppercase tracking-widest">Sentiment Drift</h3>
                                                        <div className="h-16 flex items-end gap-1 px-1">
                                                            {contactDetail.sentimentHistory.map((item: any, index: number) => (
                                                                <div
                                                                    key={index}
                                                                    className="flex-1 bg-black/10 dark:bg-white/10 hover:bg-white/40 transition-all rounded-t-sm"
                                                                    style={{ height: `${item.score}%` }}
                                                                    title={`Score: ${item.score}`}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Subjects */}
                                                {contactDetail.recentSubjects?.length > 0 && (
                                                    <div className="space-y-4">
                                                        <h3 className="text-[10px] text-black dark:text-white/20 font-bold uppercase tracking-widest">Recent Topics</h3>
                                                        <div className="space-y-2">
                                                            {contactDetail.recentSubjects.map((subject: string, index: number) => (
                                                                <div key={index} className="text-xs text-black dark:text-white/60 bg-black/[0.02] dark:bg-white/[0.02] border border-neutral-200 dark:border-white/5 rounded-xl px-4 py-3 truncate font-normal hover:bg-white/[0.04] transition-colors">
                                                                    {subject || '(No subject)'}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ) : isTokenExpired ? (
                                <div className="text-center py-16 px-6 max-w-lg mx-auto rounded-3xl border border-amber-500/20 dark:border-amber-400/15 bg-amber-500/[0.04] dark:bg-amber-400/[0.04]">
                                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/[0.10] dark:bg-amber-400/[0.10] text-amber-600 dark:text-amber-400 mb-5">
                                        <AlertCircle className="w-6 h-6" strokeWidth={1.75} />
                                    </div>
                                    <h3 className="text-xl font-medium text-black dark:text-white mb-2 tracking-tight">Gmail sign-in expired</h3>
                                    <p className="text-sm text-black/55 dark:text-white/55 max-w-sm mx-auto mb-7 leading-relaxed">
                                        I tried refreshing in the background but Google rejected the token. One quick re-sign-in and we're back.
                                    </p>
                                    <Button
                                        onClick={() => signIn('google', { callbackUrl: window.location.href, redirect: true })}
                                        className="h-11 px-6 bg-black text-white dark:bg-white dark:text-black hover:bg-black/85 dark:hover:bg-white/85 rounded-full font-medium inline-flex items-center gap-2 active:scale-[0.97]"
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                        Sign in with Google
                                    </Button>
                                </div>
                            ) : !isGmailConnected ? (
                                /* Gmail not connected — show connect card */
                                <div className="text-center py-20 px-6 max-w-lg mx-auto bg-white/50 dark:bg-white/[0.02] border border-neutral-200 dark:border-white/5 rounded-[3rem] backdrop-blur-3xl shadow-2xl relative overflow-hidden group">
                                    <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent opacity-50 pointer-events-none" />
                                    <div className="relative z-10">
                                        <div className="w-24 h-24 mx-auto mb-10 rounded-full border border-blue-500/20 bg-blue-500/5 flex items-center justify-center relative shadow-[0_0_40px_rgba(59,130,246,0.1)] group-hover:scale-110 transition-transform duration-700">
                                            <div className="absolute inset-0 bg-blue-400/10 blur-2xl rounded-full" />
                                            <Mail className="h-10 w-10 text-blue-500 relative z-10" strokeWidth={1.5} />
                                        </div>
                                        <h3 className="text-3xl font-medium text-black dark:text-white mb-4 tracking-tight">Connect your Workspace</h3>
                                        <p className="text-neutral-600 dark:text-neutral-400 mb-12 font-light leading-relaxed">
                                            Maily needs access to your Gmail to detect opportunities, summarize threads, and help you handle your inbox like a pro.
                                        </p>
                                        <div className="flex flex-col gap-5 items-center">
                                            <Button
                                                onClick={() => signIn("google", { callbackUrl: window.location.href, redirect: true })}
                                                className="h-14 px-12 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl transition-all font-bold shadow-[0_15px_30px_rgba(37,99,235,0.3)] hover:scale-[1.03] active:scale-[0.98] border-none group flex items-center gap-3 overflow-hidden relative"
                                            >
                                                <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20 -translate-x-full group-hover:translate-x-0 transition-transform duration-700" />
                                                <Mail className="w-5 h-5" />
                                                <span>Connect Google Workspace</span>
                                            </Button>
                                            <div className="flex items-center gap-2.5 text-[10px] uppercase tracking-widest text-neutral-500 dark:text-neutral-600 font-black">
                                                <Shield className="w-3.5 h-3.5" />
                                                <span>Cloud Shield Active • AES-256 Encrypted</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                /* Traditional inbox */
                                <div className="animate-in fade-in duration-500">
                                        {/* ... rest of traditional view ... */}
                                        <div className="flex items-center justify-between mb-8">
                                            <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                                                Traditional Inbox
                                            </h2>
                                            <div className="flex items-center gap-3 text-xs text-neutral-600">
                                                <Inbox className="w-3.5 h-3.5" />
                                                <span>Latest 50 emails</span>
                                            </div>
                                        </div>

                                        {isLoadingTraditional ? (
                                            <div className="py-12 md:py-20 animate-in fade-in duration-700 flex flex-col items-center justify-center">
                                                <div className="w-8 h-8 border-2 border-neutral-200 dark:border-neutral-700 border-t-neutral-900 dark:border-t-neutral-300 rounded-full animate-spin" />
                                                <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">Loading emails...</p>
                                            </div>
                                        ) : traditionalEmails.length > 0 ? (
                                            <div className="space-y-px bg-white dark:bg-neutral-900/20 border border-neutral-200 dark:border-neutral-800/50 rounded-2xl overflow-hidden shadow-2xl">
                                                {traditionalEmails.map((email) => (
                                                    <React.Fragment key={email.id}>
                                                        <div
                                                            onClick={() => handleTraditionalEmailClick(email.id)}
                                                            className="group flex items-center gap-6 p-5 hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/[0.04] dark:active:bg-white/[0.06] transition-all cursor-pointer border-b border-black/5 dark:border-white/[0.02] last:border-0 relative overflow-hidden"
                                                        >
                                                            <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800/50 flex items-center justify-center flex-shrink-0 border border-neutral-200 dark:border-white/[0.05] text-black dark:text-white/80 transition-colors">
                                                                {email.from?.[0]?.toUpperCase() || 'M'}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex justify-between items-center mb-1">
                                                                    <h4 className="text-sm font-semibold text-black dark:text-white truncate transition-colors">
                                                                        {email.from?.split('<')[0]?.trim()}
                                                                    </h4>
                                                                    <span className="text-[10px] uppercase tracking-widest text-neutral-500 dark:text-neutral-600 font-medium">
                                                                        {mounted ? new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                                                                    </span>
                                                                </div>
                                                                <p className="text-sm text-black dark:text-white/60 font-medium truncate mb-1">
                                                                    {email.subject}
                                                                </p>
                                                                <p className="text-xs text-neutral-600 dark:text-neutral-500 truncate font-light leading-relaxed">
                                                                    {email.snippet}
                                                                </p>
                                                            </div>
                                                            <div className="flex items-center gap-3 pr-2 border-l border-black/5 dark:border-white/5 pl-4">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleSendAskAI('What is this email about?', { emailId: email.id, subject: email.subject });
                                                                    }}
                                                                    className="w-9 h-9 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-blue-500/20 rounded-xl text-black dark:text-white/30 hover:text-black dark:hover:text-blue-400 transition-all border border-neutral-200 dark:border-white/5 group/ai flex items-center justify-center overflow-hidden"
                                                                    title="Ask AI"
                                                                >
                                                                    <img src="/boult-ai-icon.jpg" alt="Ask AI" className="w-full h-full object-cover brightness-90 group-hover:brightness-110 transition-all grayscale" />
                                                                </button>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleTraditionalDraftReply(email);
                                                                    }}
                                                                    className="w-9 h-9 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-emerald-500/20 rounded-xl text-black dark:text-white/30 hover:text-black dark:hover:text-emerald-400 transition-all border border-neutral-200 dark:border-white/5 flex items-center justify-center"
                                                                    title="AI Draft Reply"
                                                                >
                                                                    <PenTool className="w-4 h-4" />
                                                                </button>
                                                                <ChevronRight className="w-4 h-4 text-neutral-400 group-hover:translate-x-1 transition-transform" />
                                                            </div>
                                                            <div className="absolute inset-y-0 left-0 w-1 bg-black dark:bg-white scale-y-0 group-hover:scale-y-100 transition-transform origin-center" />
                                                        </div>
                                                    </React.Fragment>
                                                ))}

                                                {/* Load More Button */}
                                                {traditionalNextPageToken && (
                                                    <div className="p-8 text-center border-t border-neutral-100 dark:border-white/[0.02] bg-black/[0.01] dark:bg-white/[0.01]">
                                                        <Button
                                                            onClick={handleLoadMoreTraditional}
                                                            disabled={isLoadingMoreTraditional}
                                                            className="h-12 bg-black/5 hover:bg-black/10 dark:bg-white/10 text-black dark:text-white border border-neutral-200 dark:border-white/10 rounded-2xl px-12 transition-all transform hover:scale-105 active:scale-95 group shadow-lg"
                                                        >
                                                            {isLoadingMoreTraditional ? (
                                                                <RefreshCw className="w-4 h-4 animate-spin mr-3" />
                                                            ) : (
                                                                <Plus className="w-4 h-4 mr-3 group-hover:rotate-90 transition-transform duration-300" />
                                                            )}
                                                            Load More Emails
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        ) : isTraditionalLoadingError ? (
                                            <div className="py-32 text-center">
                                                <AlertCircle className="w-8 h-8 mx-auto text-red-900/50 mb-4" />
                                                <h3 className="text-lg font-light text-neutral-900 dark:text-neutral-300">Failed to load Inbox</h3>
                                                <p className="text-sm text-neutral-600 mt-2 mb-8 font-light italic">There was an error connecting to Gmail.</p>
                                                <Button
                                                    onClick={fetchTraditionalEmails}
                                                    className="h-10 px-6 bg-black/5 hover:bg-black/10 dark:bg-white/10 text-black dark:text-white border border-neutral-200 dark:border-white/10 rounded-xl"
                                                >
                                                    Try again
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="py-32 text-center">
                                                <Inbox className="w-8 h-8 mx-auto text-neutral-700 mb-4" strokeWidth={1} />
                                                <h3 className="text-lg font-light text-neutral-900 dark:text-neutral-300">Your inbox is empty</h3>
                                                <p className="text-sm text-neutral-600 mt-2 font-light">All caught up!</p>
                                            </div>
                                        )}
                                    </div>
                                )
                            }
                        </div>
                    </div>
                </motion.div>

                                                {/* Draft Editor UI */}
                                                <div className={`fixed inset-0 z-[1100] flex items-center justify-center p-4 transition-all duration-500 overflow-y-auto ${showDraftEditor ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                                                    {/* Backdrop */}
                                                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDraftEditor(false)} />
                                                    
                                                    {/* Editor Container */}
                                                    <div 
                                                        className="bg-[#fafafa] dark:bg-[#1C1C1C] border border-black/[0.05] dark:border-transparent rounded-[24px] w-full max-w-3xl flex flex-col shadow-2xl relative z-10 mx-auto overflow-hidden"
                                                        style={{ 
                                                            maxHeight: '85vh',
                                                            transform: showDraftEditor ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(20px)',
                                                            transition: 'all 0.5s cubic-bezier(0.32, 0.72, 0, 1)'
                                                        }}
                                                    >
                                                        {/* Header */}
                                                        <div className="flex justify-between items-center px-8 py-5">
                                                            <span className="text-black/40 dark:text-zinc-400 font-medium tracking-wide">Email</span>
                                                            <div className="flex items-center gap-2">
                                                                {/* Attachment Picker */}
                                                                <input
                                                                    ref={attachmentInputRef}
                                                                    type="file"
                                                                    multiple
                                                                    className="hidden"
                                                                    onChange={(e) => {
                                                                        if (e.target.files) {
                                                                            const newFiles = Array.from(e.target.files);
                                                                            const tooLarge = newFiles.some(f => f.size > 15 * 1024 * 1024);
                                                                            if (tooLarge) {
                                                                                toast.error("File size limit is 15MB. Please choose a smaller file.", { id: 'large-file' });
                                                                                return;
                                                                            }
                                                                            setDraftAttachments(prev => [...prev, ...newFiles]);
                                                                            toast.success(`${newFiles.length} file(s) attached`);
                                                                        }
                                                                    }}
                                                                />
                                                                <button 
                                                                    onClick={() => attachmentInputRef.current?.click()}
                                                                    className="p-2 hover:bg-black/5 dark:hover:bg-neutral-800 rounded-lg text-black/40 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors relative"
                                                                    title="Attach files"
                                                                >
                                                                    <Paperclip className="w-[18px] h-[18px]" strokeWidth={1.5} />
                                                                    {draftAttachments.length > 0 && (
                                                                        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-blue-500 rounded-full text-[10px] text-white font-bold flex items-center justify-center">{draftAttachments.length}</span>
                                                                    )}
                                                                </button>
                                                                <button 
                                                                    onClick={() => {
                                                                        const tempDiv = document.createElement('div');
                                                                        tempDiv.innerHTML = draftContentEditorRef.current?.innerHTML || draftContent;
                                                                        navigator.clipboard.writeText(tempDiv.innerText);
                                                                        toast.success('Copied to clipboard');
                                                                    }}
                                                                    className="p-2 hover:bg-black/5 dark:hover:bg-neutral-800 rounded-lg text-black/40 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
                                                                >
                                                                    <Copy className="w-[18px] h-[18px]" strokeWidth={1.5} />
                                                                </button>
                                                                <button 
                                                                    onClick={handleSendReply}
                                                                    className="p-2 hover:bg-black/5 dark:hover:bg-neutral-800 rounded-lg text-black/40 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
                                                                >
                                                                    <Send className="w-[18px] h-[18px]" strokeWidth={1.5} />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Subject Line */}
                                                        <div className="px-8 pb-4 flex items-center gap-4 border-b border-black/[0.06] dark:border-white/[0.04]">
                                                            <span className="text-black dark:text-white font-bold bg-transparent border-none">Subject</span>
                                                            <input 
                                                                value={draftSubject}
                                                                onChange={(e) => setDraftSubject(e.target.value)}
                                                                className="bg-transparent border-none focus:outline-none text-black/80 dark:text-zinc-300 w-full"
                                                                placeholder="Email Subject"
                                                            />
                                                        </div>

                                                        {/* Content Area */}
                                                        <div 
                                                            ref={draftContainerRef} 
                                                            className="px-8 py-6 flex-1 min-h-[350px] relative overflow-y-auto draft-editor-scrollbar"
                                                            onMouseUp={handleSiftMouseUp}
                                                        >
                                                            {isDrafting ? (
                                                                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                                                    <Loader2 className="w-6 h-6 text-black/40 dark:text-neutral-500 animate-spin mb-3" />
                                                                    <p className="text-xs font-medium text-black/50 dark:text-zinc-500 tracking-tight">Crafting...</p>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <div 
                                                                        ref={draftContentEditorRef}
                                                                        contentEditable
                                                                        suppressContentEditableWarning
                                                                        className="w-full h-full text-black dark:text-zinc-100 focus:outline-none leading-[1.8] font-[400] text-[15px] selection:bg-blue-500/30 font-sans [&_a]:text-[#60a5fa] [&_a]:underline [&_a]:cursor-pointer [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic [&_p]:mb-4 [&_p:last-child]:mb-0"
                                                                        onInput={(e) => setDraftContent(e.currentTarget.innerHTML)}
                                                                        style={{ minHeight: '200px' }}
                                                                    />
                                                                    {isGenerating && (
                                                                        <div className="flex items-center gap-2 mt-4 px-1">
                                                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-[boult-dot-pulse_1.5s_infinite]" />
                                                                            <span className="text-[10px] uppercase tracking-widest text-black/50 dark:text-zinc-500 font-bold">Boult Generating...</span>
                                                                        </div>
                                                                    )}
                                                                    {/* Attachment chips */}
                                                                    {draftAttachments.length > 0 && (
                                                                        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
                                                                            {draftAttachments.map((file, i) => (
                                                                                <div key={i} className="flex items-center gap-2 bg-black/[0.04] dark:bg-white/[0.06] rounded-lg px-3 py-1.5 text-sm text-black/70 dark:text-zinc-300">
                                                                                    <Paperclip className="w-3.5 h-3.5 text-zinc-500" />
                                                                                    <span className="max-w-[140px] truncate">{file.name}</span>
                                                                                    <span className="text-zinc-600 text-xs">({(file.size / 1024).toFixed(0)}KB)</span>
                                                                                    <button onClick={() => setDraftAttachments(prev => prev.filter((_, idx) => idx !== i))} className="ml-1 text-zinc-500 hover:text-red-400 transition-colors">
                                                                                        <X className="w-3.5 h-3.5" />
                                                                                    </button>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                    {/* Voice Profile Link */}
                                                                    <div className="mt-4 pt-3 border-t border-black/[0.04] dark:border-white/[0.04]">
                                                                        <button
                                                                            onClick={() => setIsVoiceProfileModalOpen(true)}
                                                                            className="text-[13px] text-black/70 dark:text-white/70 underline underline-offset-2 decoration-black/30 dark:decoration-white/30 hover:text-black dark:hover:text-white hover:decoration-black/50 dark:hover:decoration-white/50 transition-all font-medium flex items-center gap-1.5"
                                                                        >
                                                                            <Mic className="w-3.5 h-3.5" />
                                                                            Voice Profile
                                                                        </button>
                                                                    </div>
                                                                </>
                                                            )}

                                                            {/* Floating Toolbar Toolkit */}
                                                            <AnimatePresence mode="wait">
                                                                {(showTooltip || isRefinementActive || proposedRefinement) && selection && (
                                                                    <motion.div
                                                                        initial={{ opacity: 0, scale: 0.96, y: 8, filter: 'blur(4px)' }}
                                                                        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                                                                        exit={{ opacity: 0, scale: 0.96, y: 8, filter: 'blur(4px)' }}
                                                                        transition={{ type: 'spring', damping: 25, stiffness: 400 }}
                                                                        style={{
                                                                            position: 'absolute',
                                                                            left: `${selection.rect.x}px`,
                                                                            top: `${Math.max(8, selection.rect.y - 50)}px`,
                                                                            transform: 'translateX(-50%)',
                                                                            zIndex: 100
                                                                        }}
                                                                        className="pointer-events-auto refinement-toolkit"
                                                                    >
                                                                        {!isRefinementActive && !proposedRefinement && !showLinkInput && (
                                                                            <div className="bg-white dark:bg-[#2A2A2A] border border-black/10 dark:border-white/10 rounded-[14px] px-2 py-1.5 flex items-center gap-1 shadow-[0_20px_50px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[100]" onMouseDown={(e) => e.preventDefault()}>
                                                                                <button 
                                                                                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setIsRefinementActive(true); }}
                                                                                    className="flex items-center gap-2 pl-3 pr-2 py-1.5 text-[#3b82f6] hover:text-blue-500 dark:hover:text-blue-400 font-medium tracking-wide transition-colors text-[13px]"
                                                                                >
                                                                                    Ask for changes
                                                                                </button>
                                                                                
                                                                                <div className="w-[1px] h-4 bg-black/10 dark:bg-zinc-700"></div>
                                                                                
                                                                                <div className="flex items-center">
                                                                                    <button 
                                                                                        onMouseDown={(e) => {
                                                                                            e.preventDefault();
                                                                                            e.stopPropagation();
                                                                                            setShowLinkInput(true);
                                                                                            setLinkInputUrl('');
                                                                                        }}
                                                                                        className="p-1.5 text-black/40 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
                                                                                        title="Insert link"
                                                                                    >
                                                                                        <LinkIcon className="w-4 h-4" />
                                                                                    </button>
                                                                                    <button 
                                                                                        onMouseDown={(e) => {
                                                                                            e.preventDefault();
                                                                                            e.stopPropagation();
                                                                                            if (selection?.range) {
                                                                                                const sel = window.getSelection();
                                                                                                sel?.removeAllRanges();
                                                                                                sel?.addRange(selection.range);
                                                                                                document.execCommand('bold', false, undefined);
                                                                                                if (draftContentEditorRef.current) setDraftContent(draftContentEditorRef.current.innerHTML);
                                                                                            }
                                                                                        }}
                                                                                        className="p-1.5 px-2.5 text-black/40 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-md font-bold transition-colors text-[14px]"
                                                                                        title="Bold"
                                                                                    >
                                                                                        B
                                                                                    </button>
                                                                                    <button 
                                                                                        onMouseDown={(e) => {
                                                                                            e.preventDefault();
                                                                                            e.stopPropagation();
                                                                                            if (selection?.range) {
                                                                                                const sel = window.getSelection();
                                                                                                sel?.removeAllRanges();
                                                                                                sel?.addRange(selection.range);
                                                                                                document.execCommand('italic', false, undefined);
                                                                                                if (draftContentEditorRef.current) setDraftContent(draftContentEditorRef.current.innerHTML);
                                                                                            }
                                                                                        }}
                                                                                        className="p-1.5 px-2.5 text-black/40 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-md italic transition-colors text-[14px]"
                                                                                        title="Italic"
                                                                                    >
                                                                                        I
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {/* Inline Link Input (replaces browser prompt) */}
                                                                        {showLinkInput && !isRefinementActive && !proposedRefinement && (
                                                                            <div className="bg-white dark:bg-[#2A2A2A] border border-black/10 dark:border-white/10 rounded-[14px] p-1.5 shadow-[0_30px_70px_rgba(0,0,0,0.15)] dark:shadow-[0_30px_70px_rgba(0,0,0,0.6)] w-[320px] z-[100] ring-1 ring-black/5 dark:ring-white/5" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}>
                                                                                <div className="relative">
                                                                                    <input
                                                                                        autoFocus
                                                                                        value={linkInputUrl}
                                                                                        onChange={(e) => setLinkInputUrl(e.target.value)}
                                                                                        onKeyDown={(e) => {
                                                                                            if (e.key === 'Enter' && linkInputUrl.trim()) {
                                                                                                e.preventDefault();
                                                                                                if (selection?.range) {
                                                                                                    const sel = window.getSelection();
                                                                                                    sel?.removeAllRanges();
                                                                                                    sel?.addRange(selection.range);
                                                                                                    const finalUrl = linkInputUrl.startsWith('http') ? linkInputUrl : `https://${linkInputUrl}`;
                                                                                                    document.execCommand('createLink', false, finalUrl);
                                                                                                    // Style the newly created link
                                                                                                    if (draftContentEditorRef.current) {
                                                                                                        draftContentEditorRef.current.querySelectorAll('a').forEach(a => {
                                                                                                            a.style.color = '#60a5fa';
                                                                                                            a.style.textDecoration = 'underline';
                                                                                                            a.setAttribute('target', '_blank');
                                                                                                        });
                                                                                                        setDraftContent(draftContentEditorRef.current.innerHTML);
                                                                                                    }
                                                                                                }
                                                                                                setShowLinkInput(false);
                                                                                                setLinkInputUrl('');
                                                                                            }
                                                                                            if (e.key === 'Escape') {
                                                                                                setShowLinkInput(false);
                                                                                                setLinkInputUrl('');
                                                                                            }
                                                                                        }}
                                                                                        placeholder="Paste or type a URL..."
                                                                                        className="w-full bg-black/[0.04] dark:bg-white/[0.04] text-black dark:text-white text-[13px] py-3 px-4 pr-12 rounded-xl border border-transparent focus:outline-none focus:bg-black/[0.06] dark:focus:bg-white/[0.06] transition-all placeholder:text-black/40 dark:placeholder:text-zinc-500 font-medium"
                                                                                    />
                                                                                    <button
                                                                                        onMouseDown={(e) => {
                                                                                            e.preventDefault();
                                                                                            e.stopPropagation();
                                                                                            if (linkInputUrl.trim() && selection?.range) {
                                                                                                const sel = window.getSelection();
                                                                                                sel?.removeAllRanges();
                                                                                                sel?.addRange(selection.range);
                                                                                                const finalUrl = linkInputUrl.startsWith('http') ? linkInputUrl : `https://${linkInputUrl}`;
                                                                                                document.execCommand('createLink', false, finalUrl);
                                                                                                if (draftContentEditorRef.current) {
                                                                                                    draftContentEditorRef.current.querySelectorAll('a').forEach(a => {
                                                                                                        a.style.color = '#60a5fa';
                                                                                                        a.style.textDecoration = 'underline';
                                                                                                        a.setAttribute('target', '_blank');
                                                                                                    });
                                                                                                    setDraftContent(draftContentEditorRef.current.innerHTML);
                                                                                                }
                                                                                            }
                                                                                            setShowLinkInput(false);
                                                                                            setLinkInputUrl('');
                                                                                        }}
                                                                                        disabled={!linkInputUrl.trim()}
                                                                                        className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-[#3b82f6] rounded-lg flex items-center justify-center text-white hover:bg-blue-400 transition-all disabled:opacity-30"
                                                                                    >
                                                                                        <Check className="w-4 h-4 stroke-[3]" />
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {isRefinementActive && (
                                                                            <div className="bg-white dark:bg-[#2A2A2A] border border-black/10 dark:border-white/10 rounded-[14px] p-1.5 shadow-[0_30px_70px_rgba(0,0,0,0.15)] dark:shadow-[0_30px_70px_rgba(0,0,0,0.6)] w-[360px] z-[100] ring-1 ring-black/5 dark:ring-white/5" onClick={(e) => e.stopPropagation()}>
                                                                                <div className="relative group/input">
                                                                                    <input
                                                                                        autoFocus
                                                                                        value={refinementInstruction}
                                                                                        onChange={(e) => setRefinementInstruction(e.target.value)}
                                                                                        onKeyDown={(e) => {
                                                                                            if (e.key === 'Enter') handleSiftRefinementSubmit();
                                                                                            if (e.key === 'Escape') setIsRefinementActive(false);
                                                                                        }}
                                                                                        placeholder="Describe your changes"
                                                                                        className="w-full bg-black/[0.04] dark:bg-white/[0.04] text-black dark:text-white text-[14px] py-3.5 px-5 pr-14 rounded-xl border border-transparent focus:outline-none focus:bg-black/[0.06] dark:focus:bg-white/[0.06] transition-all placeholder:text-black/40 dark:placeholder:text-zinc-500 font-medium tracking-tight"
                                                                                    />
                                                                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                                                                                        <button
                                                                                            onClick={(e) => { e.stopPropagation(); handleSiftRefinementSubmit(); }}
                                                                                            disabled={isProcessingRefinement || !refinementInstruction.trim()}
                                                                                            className="w-8 h-8 bg-[#3b82f6] rounded-lg flex items-center justify-center text-white hover:bg-blue-400 transition-all disabled:opacity-30 disabled:grayscale"
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
                                                                            <div className="bg-white dark:bg-[#2A2A2A] border border-black/10 dark:border-white/10 rounded-[14px] p-2 flex flex-col gap-3 shadow-[0_30px_70px_rgba(0,0,0,0.15)] dark:shadow-[0_30px_70px_rgba(0,0,0,0.6)] w-[360px] z-[100] ring-1 ring-black/5 dark:ring-white/5" onClick={(e) => e.stopPropagation()}>
                                                                                <div className="px-3 pt-2 text-black/70 dark:text-zinc-200 text-[14px] tracking-wide leading-relaxed font-medium">
                                                                                    <div dangerouslySetInnerHTML={{ __html: proposedRefinement }} />
                                                                                </div>
                                                                                <div className="flex items-center gap-2 mt-1">
                                                                                    <button
                                                                                        onClick={(e) => { e.stopPropagation(); setProposedRefinement(null); }}
                                                                                        className="h-9 w-full rounded-lg text-black/50 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 text-[13px] font-medium transition-all"
                                                                                    >
                                                                                        Discard
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={(e) => { e.stopPropagation(); handleAcceptSiftRefinement(); }}
                                                                                        className="h-9 w-full bg-black dark:bg-white hover:bg-black/80 dark:hover:bg-zinc-200 rounded-lg text-white dark:text-black text-[13px] font-bold transition-all shadow-md"
                                                                                    >
                                                                                        Accept
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </div>
                                                    </div>
                                                </div>



                                                {/* Scheduling Modal */}
                                                <SchedulingModal
                                                    isOpen={showSchedulingModal}
                                                    onClose={() => setShowSchedulingModal(false)}
                                                    emailId={schedulingEmailId || ''}
                                                />

                                                 {isMounted && typeof window !== 'undefined' && isTraditionalModalOpen && createPortal(
                                                     <>
                                                         {/* Traditional Backdrop */}
                                                         <div
                                                             className="fixed inset-0 bg-black/90 backdrop-blur-2xl transition-opacity duration-300"
                                                             style={{
                                                                 zIndex: isModalExpanded ? 9998 : 1300,
                                                                 opacity: isModalExpanded ? 0 : 1,
                                                                 pointerEvents: isModalExpanded ? 'none' : 'auto'
                                                             }}
                                                             onClick={() => setIsTraditionalModalOpen(false)}
                                                         />

                                                         {/* Traditional Email Detailed View Modal */}
                                                         <div
                                                             className={`fixed transition-all duration-500 cubic-bezier(0.32, 0.72, 0, 1) flex flex-col ${
                                                                 isModalExpanded 
                                                                     ? 'inset-0 bg-black w-screen h-screen rounded-none border-none' 
                                                                     : 'top-1/2 left-1/2 bg-black rounded-[2.5rem] border border-neutral-200 dark:border-white/10 shadow-2xl'
                                                             }`}
                                                             style={{
                                                                 width: isModalExpanded ? '100vw' : '75%',
                                                                 height: isModalExpanded ? '100vh' : '90vh',
                                                                 transform: isTraditionalModalOpen 
                                                                     ? (isModalExpanded ? 'translate(0px, 0px) scale(1)' : 'translate(-50%, -50%) scale(1)') 
                                                                     : (isModalExpanded ? 'translate(0px, 5%) scale(0.95)' : 'translate(-50%, -45%) scale(0.95)'),
                                                                 opacity: isTraditionalModalOpen ? 1 : 0,
                                                                 pointerEvents: isTraditionalModalOpen ? 'auto' : 'none',
                                                                 zIndex: isModalExpanded ? 9999 : 1400
                                                             }}
                                                         >
                                                             {/* Header */}
                                                             <div className="p-10 border-b border-neutral-200 dark:border-white/5 flex items-start justify-between">
                                                                 <div className="flex-1 min-w-0 pr-10">
                                                                     {isSummarizing ? (
                                                                         <div className="space-y-3">
                                                                             <div className="h-7 w-2/3 bg-black/5 dark:bg-white/5 rounded-lg animate-pulse" />
                                                                             <div className="h-4 w-1/3 bg-black/5 dark:bg-white/5 rounded-lg animate-pulse" />
                                                                         </div>
                                                                     ) : selectedTraditionalEmail ? (
                                                                         <div className="space-y-4">
                                                                             <h2 className="text-3xl font-semibold text-black dark:text-white tracking-tight leading-tight">
                                                                                 {selectedTraditionalEmail.subject}
                                                                             </h2>
                                                                             <div className="flex flex-wrap items-center gap-5">
                                                                                 <div className="flex items-center gap-3 px-4 py-2 bg-black/5 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-full">
                                                                                     <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center text-black dark:text-white/40 text-sm font-bold">
                                                                                         {selectedTraditionalEmail.from?.[0]?.toUpperCase() || 'U'}
                                                                                     </div>
                                                                                     <div className="flex flex-col">
                                                                                         <span className="text-sm text-black dark:text-white font-medium">
                                                                                             {selectedTraditionalEmail.from?.split('<')[0]?.trim() || 'Sender'}
                                                                                         </span>
                                                                                         <span className="text-[10px] text-neutral-600 dark:text-neutral-500 font-light truncate max-w-[200px]">
                                                                                             {selectedTraditionalEmail.from?.match(/<(.+)>/)?.[1] || selectedTraditionalEmail.from}
                                                                                         </span>
                                                                                     </div>
                                                                                 </div>
                                                                                 <div className="flex items-center gap-2 text-neutral-600 dark:text-neutral-500">
                                                                                     <Clock className="w-4 h-4" />
                                                                                     <span className="text-sm font-light">
                                                                                         {formatDate(selectedTraditionalEmail.date, { dateStyle: 'long', timeStyle: 'short' })}
                                                                                     </span>
                                                                                 </div>
                                                                             </div>
                                                                         </div>
                                                                     ) : null}
                                                                 </div>
                                                                 <div className="flex items-center gap-4">
                                                                     <TooltipProvider>
                                                                         <Tooltip>
                                                                             <TooltipTrigger asChild>
                                                                                 <button
                                                                                     onClick={() => setIsModalExpanded(!isModalExpanded)}
                                                                                     className="p-3 bg-black/5 hover:bg-black/10 dark:bg-white/10 border border-neutral-200 dark:border-white/10 rounded-full text-black hover:text-black dark:text-white transition-all shadow-lg flex items-center justify-center"
                                                                                     aria-label={isModalExpanded ? 'Exit Fullscreen' : 'Expand to Fullscreen'}
                                                                                 >
                                                                                     {isModalExpanded ? (
                                                                                         <HugeiconsIcon icon={Minimize01Icon} className="w-7 h-7" />
                                                                                     ) : (
                                                                                         <HugeiconsIcon icon={Maximize01Icon} className="w-7 h-7" />
                                                                                     )}
                                                                                 </button>
                                                                             </TooltipTrigger>
                                                                             <TooltipContent side="bottom" className="bg-neutral-900 text-white border border-neutral-800 px-3 py-1.5 rounded-lg text-xs font-medium shadow-xl z-[1500]">
                                                                                 {isModalExpanded ? 'Exit Fullscreen' : 'Expand to Fullscreen'}
                                                                             </TooltipContent>
                                                                         </Tooltip>
                                                                     </TooltipProvider>

                                                                     <button
                                                                         onClick={() => setIsTraditionalModalOpen(false)}
                                                                         className="p-3 bg-black/5 hover:bg-black/10 dark:bg-white/10 border border-neutral-200 dark:border-white/10 rounded-full text-black hover:text-black dark:text-white transition-all shadow-lg"
                                                                     >
                                                                         <X className="w-7 h-7" />
                                                                     </button>
                                                                 </div>
                                                             </div>

                                                             {/* Body Content */}
                                                             <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
                                                                 {isSummarizing ? (
                                                                     <div className="flex flex-col items-center justify-center h-full">
                                                                         <RefreshCw className="w-10 h-10 text-black dark:text-white/20 animate-spin mb-6" />
                                                                         <p className="text-black dark:text-white/40 font-light text-xl">Opening message...</p>
                                                                     </div>
                                                                 ) : selectedTraditionalEmail ? (
                                                                     <div className={`mx-auto space-y-12 pb-20 transition-all duration-500 ${isModalExpanded ? 'max-w-6xl' : 'max-w-4xl'}`}>
                                                                         <div className="traditional-email-content font-sans text-lg">
                                                                             {!selectedTraditionalEmail.body ? (
                                                                                 <div className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-white/5 px-6 py-16 text-center text-neutral-500 dark:text-neutral-400">
                                                                                     No message body available for this email.
                                                                                 </div>
                                                                             ) : emailBodyLooksLikeHtml(selectedTraditionalEmail.body, selectedTraditionalEmail.isHtml) ? (
                                                                                 <div className="bg-white rounded-xl overflow-hidden shadow-inner border border-neutral-200 dark:border-white/10 ring-1 ring-black/5 flex">
                                                                                     <iframe
                                                                                         title="Email Content"
                                                                                         srcDoc={buildEmailSrcDoc(selectedTraditionalEmail.body)}
                                                                                         className={`w-full border-none bg-white transition-all duration-500 ${isModalExpanded ? 'min-h-[80vh]' : 'min-h-[60vh]'}`}
                                                                                         sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                                                                                         style={{ backgroundColor: '#ffffff', colorScheme: 'light' }}
                                                                                         onLoad={(e) => {
                                                                                             const iframe = e.target as HTMLIFrameElement;
                                                                                             if (iframe.contentWindow) {
                                                                                                 try {
                                                                                                     const height = iframe.contentWindow.document.documentElement.scrollHeight;
                                                                                                     if (height > 0) iframe.style.height = `${height}px`;
                                                                                                 } catch (err) { /* cross-origin guard */ }
                                                                                             }
                                                                                         }}
                                                                                     />
                                                                                 </div>
                                                                             ) : (
                                                                                 <div
                                                                                     className="whitespace-pre-wrap selection:bg-blue-500/30 text-neutral-900 dark:text-neutral-200 font-light leading-relaxed p-6 bg-white dark:bg-white/5 rounded-2xl font-mono text-sm border border-neutral-200 dark:border-white/10"
                                                                                     dangerouslySetInnerHTML={{ __html: linkify(selectedTraditionalEmail.body) }}
                                                                                 />
                                                                             )}
                                                                         </div>

                                                                         {/* Attachments Section */}
                                                                         {selectedTraditionalEmail.attachments?.length > 0 && (
                                                                             <div className="space-y-6 pt-12 border-t border-neutral-200 dark:border-white/5">
                                                                                 <div className="flex items-center gap-2 text-black dark:text-white/40 text-[10px] uppercase tracking-[0.2em] font-bold">
                                                                                     <Download className="w-3.5 h-3.5" />
                                                                                     Attachments
                                                                                 </div>
                                                                                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                                                     {selectedTraditionalEmail.attachments.map((att: any, i: number) => (
                                                                                         <div key={i} className="flex items-center gap-4 p-4 bg-black/5 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-2xl group hover:border-white/20 transition-all">
                                                                                             <div className="p-3 bg-black/5 dark:bg-white/5 rounded-xl text-black dark:text-white/40">
                                                                                                 {att.mimeType?.startsWith('image/') ? <Sparkles className="w-5 h-5" /> : <Inbox className="w-5 h-5" />}
                                                                                             </div>
                                                                                             <div className="flex-1 min-w-0">
                                                                                                 <p className="text-sm font-medium text-black dark:text-white truncate">{att.filename}</p>
                                                                                                 <p className="text-xs text-neutral-600 dark:text-neutral-500 font-light mt-0.5">{(att.size / 1024).toFixed(0)} KB</p>
                                                                                             </div>
                                                                                             <button
                                                                                                 onClick={() => {
                                                                                                     window.open(`/api/attachments/download?messageId=${selectedTraditionalEmail.id}&attachmentId=${att.attachmentId}&filename=${encodeURIComponent(att.filename)}`, '_blank');
                                                                                                     toast.success('Downloading...', { description: att.filename });
                                                                                                 }}
                                                                                                 className="p-2.5 bg-black/5 hover:bg-black/10 dark:bg-white/10 rounded-xl text-black hover:text-black dark:text-white transition-all shadow-sm"
                                                                                             >
                                                                                                 <Download className="w-4 h-4" />
                                                                                             </button>

                                                                                         </div>
                                                                                     ))}
                                                                                 </div>
                                                                             </div>
                                                                         )}
                                                                     </div>
                                                                 ) : null}
                                                             </div>

                                                             {/* Footer Controls */}
                                                             {!isSummarizing && selectedTraditionalEmail && (
                                                                 <div className="p-10 border-t border-neutral-200 dark:border-white/5 bg-white/[0.01] flex items-center justify-between">
                                                                     <button
                                                                         onClick={() => setIsTraditionalModalOpen(false)}
                                                                         className="px-10 py-4 bg-black/5 hover:bg-black/10 dark:bg-white/10 border border-neutral-200 dark:border-white/10 rounded-2xl text-base font-medium text-black transition-all hover:text-black dark:text-white"
                                                                     >
                                                                         Close Viewer
                                                                     </button>
                                                                     <div className="flex items-center gap-4">
                                                                         <button
                                                                             onClick={() => { setDraftTo(selectedTraditionalEmail.from?.match(/<(.+)>/)?.[1] || selectedTraditionalEmail.from); setDraftSubject(`Re: ${selectedTraditionalEmail.subject}`); setDraftContent(''); setShowDraftEditor(true); }}
                                                                             className="px-8 py-4 bg-black/5 dark:bg-white/5 border border-neutral-200 dark:border-white/10 hover:border-white/20 rounded-2xl text-base font-medium text-black hover:text-black dark:text-white transition-all"
                                                                         >
                                                                             Reply
                                                                         </button>
                                                                         <button
                                                                             onClick={() => handleTraditionalDraftReply(selectedTraditionalEmail)}
                                                                             className="px-8 py-4 bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 hover:border-emerald-500/40 rounded-2xl text-base font-medium text-emerald-600 dark:text-emerald-400 transition-all flex items-center gap-3"
                                                                         >
                                                                             <PenTool className="w-5 h-5" />
                                                                             AI Reply
                                                                         </button>
                                                                         <button
                                                                             onClick={() => window.open(`https://mail.google.com/mail/u/0/#inbox/${selectedTraditionalEmail.id}`, '_blank')}
                                                                             className="flex items-center gap-3 px-10 py-4 bg-black text-white hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-neutral-200 rounded-2xl text-base font-bold transition-all shadow-xl shadow-black/10 dark:shadow-2xl active:scale-95"
                                                                         >
                                                                             <ExternalLink className="w-5 h-5" />
                                                                             Open in Gmail
                                                                         </button>
                                                                     </div>
                                                                 </div>
                                                             )}
                                                         </div>
                                                     </>,
                                                     document.body
                                                 )}




                {/* Global Style for Email Content */}
                <style dangerouslySetInnerHTML={{
                    __html: `
                .traditional-email-content a, 
                .traditional-email-content [href] {
                    color: #3b82f6 !important;
                    text-decoration: underline !important;
                    cursor: var(--custom-cursor) !important;
                    pointer-events: auto !important;
                    display: inline-block !important;
                }
                
                .traditional-email-content .email-link {
                    color: #3b82f6 !important;
                    text-decoration: underline !important;
                }
                
                /* Keep wide HTML tables from blowing out the viewer; do NOT
                   force transparent backgrounds — that turns dark email text
                   into a black screen on the dark modal. */
                .traditional-email-content table {
                    max-width: 100% !important;
                }

                .clickable-link {
                    cursor: var(--custom-cursor) !important;
                    pointer-events: auto !important;
                }

                @keyframes boult-dot-pulse {
                    0% { transform: scale(0.7); opacity: 0.8; }
                    50% { transform: scale(1.2); opacity: 1; }
                    100% { transform: scale(0.7); opacity: 0.8; }
                }
            ` }} />

                {/* New Voice Profile Modal Integration */}
                <VoiceProfileModal
                    isOpen={isVoiceProfileModalOpen}
                    onClose={() => setIsVoiceProfileModalOpen(false)}
                    profile={userVoiceProfile}
                    onCreate={handleCreateVoiceProfile}
                    onReAnalyze={handleCreateVoiceProfile}
                    isAnalyzing={isAnalyzingVoice}
                    onProfileUpdated={(p: any) => setUserVoiceProfile(p)}
                />
                {/* Boult Quick Chat Replacement */}
                <BoultQuickChat 
                    isOpen={isBoultQuickChatOpen}
                    onClose={() => setIsBoultQuickChatOpen(false)}
                    context={quickChatContext}
                />
            </div>
        </LayoutGroup>
    );
}

