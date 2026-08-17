"use client";
import { Mail } from "lucide-react";

import { useState, useEffect, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { 
    LayoutGrid, 
    FileText, 
    Settings2, 
    ChevronRight,
    Sparkles,
    LogOut,
    Gift,
    HelpCircle,
    MessageCircle,
    X
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { HugeiconsIcon } from '@hugeicons/react';
import { Menu01Icon } from '@hugeicons/core-free-icons';
import { FeedbackDialog } from './feedback-dialog';

interface HomeFeedSidebarProps {
    className?: string;
    onPeopleClick?: () => void;
    onOpenSettings?: () => void;
    onOpenHelp?: () => void;
    onOpenRewards?: () => void;
    activeView?: 'home' | 'people';
    onCollapse?: (collapsed: boolean) => void;
    isOpen?: boolean;
    onClose?: () => void;
}

export function HomeFeedSidebar({ 
    className = '', 
    onPeopleClick, 
    onOpenSettings, 
    onOpenHelp,
    onOpenRewards,
    activeView = 'home', 
    onCollapse,
    isOpen = false,
    onClose
}: HomeFeedSidebarProps) {
    const { data: session } = useSession();
    const router = useRouter();
    const pathname = usePathname();
    const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMounted, setIsMounted] = useState(false);
    const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

    // Sync saved preference on client mount
    useEffect(() => {
        const saved = localStorage.getItem('sidebar_collapsed');
        if (saved === 'true') {
            setIsCollapsed(true);
        }
        const timer = setTimeout(() => {
            setIsMounted(true);
        }, 50);
        return () => clearTimeout(timer);
    }, []);

    // Persist sidebar state safely once mounted
    useEffect(() => {
        if (isMounted) {
            localStorage.setItem('sidebar_collapsed', isCollapsed.toString());
        }
    }, [isCollapsed, isMounted]);
    const [userHandle, setUserHandle] = useState<string>('');
    const moreMenuRef = useRef<HTMLDivElement>(null);

    // Fetch user handle for logout button
    useEffect(() => {
        if (session?.user?.email) {
            const emailPart = session.user.email.split('@')[0];
            setUserHandle(emailPart); // Default to email part
            
            // Try to fetch profile for actual username
            fetch('/api/profile')
                .then(res => res.json())
                .then(data => {
                    const username = data?.preferences?.username || data?.username;
                    if (username) setUserHandle(username);
                })
                .catch(err => console.error('Failed to fetch profile for handle:', err));
        }
    }, [session?.user?.email]);

    useEffect(() => {
        if (onCollapse) onCollapse(isCollapsed);
    }, [isCollapsed, onCollapse]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
                setIsMoreOptionsOpen(false);
            }
        }
        if (isMoreOptionsOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isMoreOptionsOpen]);

    const handleLogout = async () => {
        setIsMoreOptionsOpen(false);
        await signOut({ redirect: false });
        router.push("/");
    };

    const mainNavItems = [
        { id: 'home', icon: LayoutGrid, label: 'Home', route: '/home-feed' },
        { id: 'boult', icon: Sparkles, label: 'Boult', route: '/dashboard/agent-talk' },
    ];

    const bottomNavItems = [
        { id: 'gift', icon: Gift, label: 'Rewards', onClick: onOpenRewards, route: '' },
        { id: 'settings', icon: Settings2, label: 'Settings', onClick: onOpenSettings, route: '' },
        { id: 'help', icon: HelpCircle, label: 'Help', onClick: onOpenHelp, route: '' },
    ];

    return (
        <TooltipProvider>
                {/* Plain CSS transition — width (desktop collapse) + transform (mobile
                    drawer slide). duration-300 with Tailwind's default easing matches the
                    main content's `transition-[margin] duration-300` exactly, so panel and
                    feed move together. No Framer animate/spring/layout anywhere. The
                    transition is gated on isMounted so the initial collapsed state (read
                    from localStorage) paints without animating on load. */}
                <div
                    style={{ width: isCollapsed ? 72 : 260 }}
                    className={`fixed left-0 top-0 h-screen bg-[#F4F5F8]/70 dark:bg-black/60 backdrop-blur-2xl backdrop-saturate-150 border-r border-[#EBE9E2]/80 dark:border-white/[0.06] flex flex-col z-[100] md:z-50 ${isMounted ? 'transition-all duration-300' : ''} ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} ${className} ${!isOpen ? 'pointer-events-none md:pointer-events-auto' : 'pointer-events-auto shadow-2xl'}`}
                >
                    {/* Mobile Close Button */}
                    <AnimatePresence>
                        {isOpen && (
                            <motion.div 
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                className="md:hidden absolute top-6 right-4 z-[110]"
                            >
                                <button 
                                    onClick={onClose}
                                    className="p-2 hover:bg-black/5 dark:hover:bg-white/[0.05] rounded-full transition-colors text-neutral-600 dark:text-boult-fg-tertiary"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    
                    <div className="pt-6" />

                    {/* Logo & App Name */}
                    <div className="px-3.5 mb-8 flex items-center justify-between relative">
                        <div
                            role="button"
                            aria-label={isCollapsed ? 'Open menu' : 'Go to home'}
                            className="flex items-center gap-3 cursor-pointer group"
                            onClick={() => {
                                // Collapsed: the logo IS the menu toggle — click expands the
                                // sidebar. Expanded: it's the brand mark — click goes home.
                                // px-3.5 left-aligns the logo so it sits dead-center on the
                                // 72px collapsed rail — no reposition between states.
                                if (isCollapsed) setIsCollapsed(false);
                                else router.push('/home-feed');
                            }}
                        >
                            <div className="w-11 h-11 relative flex items-center justify-center rounded-[14px] overflow-hidden bg-black shadow-lg group-hover:scale-105 transition-transform">
                                {/* Brand logo. When collapsed it simply fades out on hover to
                                    reveal the three-bars menu beneath — a clean crossfade,
                                    no scaling. When expanded it stays put. */}
                                <Mail className="w-full h-full p-1 text-inherit" />
                                {isCollapsed && (
                                    <span className="absolute inset-0 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                        <HugeiconsIcon icon={Menu01Icon} size={22} strokeWidth={2} />
                                    </span>
                                )}
                            </div>

                            <AnimatePresence initial={false}>
                                {!isCollapsed && (
                                    <motion.span
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.15 }}
                                        className="text-xl font-bold tracking-tight text-[#1A1A1A] dark:text-white whitespace-nowrap"
                                    >
                                        Maily
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Collapse toggle — only when expanded. Three bars via HugeIcons,
                            replacing the old lucide PanelLeft. The floating edge button that
                            used to expand the collapsed rail is gone; the logo handles that. */}
                        {!isCollapsed && (
                            <motion.button
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.1 }}
                                onClick={() => setIsCollapsed(true)}
                                aria-label="Collapse sidebar"
                                className="p-1.5 hover:bg-black/5 dark:hover:bg-boult-surface rounded-lg transition-colors text-neutral-600 dark:text-boult-fg-tertiary hover:text-neutral-900 dark:hover:text-white border border-transparent hover:border-[#EBE9E2] dark:hover:border-boult-divider"
                            >
                                <HugeiconsIcon icon={Menu01Icon} size={20} strokeWidth={2} />
                            </motion.button>
                        )}
                    </div>

                    {/* Sidebar Scroll Area */}
                    <div className="flex-1 px-3 py-2 space-y-8 overflow-y-auto no-scrollbar pt-2">
                        {/* Top Navigation */}
                        <div className="space-y-1.5">
                            {mainNavItems.map((item, index) => {
                                const Icon = item.icon;
                                const isActive = pathname === item.route || (item.id === 'home' && pathname === '/home-feed');
                                
                                return (
                                    <Tooltip key={item.id} delayDuration={0}>
                                        <TooltipTrigger asChild>
                                            <button
                                                onClick={() => router.push(item.route)}
                                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors duration-200 group relative ${
                                                    isActive
                                                    ? 'bg-black/5 dark:bg-white/[0.08] text-[#1A1A1A] dark:text-white font-semibold border border-[#EBE9E2] dark:border-white/[0.1]'
                                                    : 'text-[#666666] dark:text-boult-fg-tertiary hover:text-[#1A1A1A] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/[0.05]'
                                                }`}
                                            >
                                                <span className="w-6 flex justify-center shrink-0">
                                                    <Icon size={20} className={`transition-colors duration-300 ${isActive ? 'text-amber-500' : 'text-[#666666] dark:text-boult-fg-tertiary group-hover:text-black dark:group-hover:text-white'}`} strokeWidth={ isActive ? 2 : 1.5} />
                                                </span>

                                                <AnimatePresence initial={false}>
                                                    {!isCollapsed && (
                                                        <motion.span
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            exit={{ opacity: 0 }}
                                                            transition={{ duration: 0.15 }}
                                                            className="text-[14px] tracking-tight whitespace-nowrap"
                                                        >
                                                            {item.label}
                                                        </motion.span>
                                                    )}
                                                </AnimatePresence>

                                                {isActive && !isCollapsed && (
                                                    <motion.div
                                                        layoutId="active-nav-indicator"
                                                        className="absolute right-2 w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                                                    />
                                                )}
                                            </button>
                                        </TooltipTrigger>
                                        {isCollapsed && <TooltipContent side="right" className="bg-black text-white border-white/10 rounded-lg">{item.label}</TooltipContent>}
                                    </Tooltip>
                                );
                            })}
                        </div>
                    </div>

                    {/* Support Navigation (Pinned at bottom) */}
                    <div className="px-3 pb-8 space-y-1.5 pt-6">
                        {bottomNavItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = pathname === item.route;

                            return (
                                <Tooltip key={item.id} delayDuration={0}>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={() => {
                                                if (item.onClick) {
                                                    item.onClick();
                                                } else if (item.route) {
                                                    router.push(item.route);
                                                }
                                            }}
                                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors duration-200 group ${
                                                isActive
                                                ? 'bg-black/5 dark:bg-boult-raised text-[#1A1A1A] dark:text-white font-semibold border border-[#EBE9E2] dark:border-boult-divider'
                                                : 'text-[#666666] dark:text-boult-fg-tertiary hover:text-[#1A1A1A] dark:hover:text-white hover:bg-black/5 dark:hover:bg-boult-elevated'
                                            }`}
                                        >
                                            <span className="w-6 flex justify-center shrink-0">
                                                <Icon size={20} className={`transition-colors duration-300 ${isActive ? 'text-[#1A1A1A] dark:text-white' : 'text-[#666666] dark:text-boult-fg-tertiary group-hover:text-black dark:group-hover:text-white'}`} strokeWidth={1.5} />
                                            </span>

                                            <AnimatePresence initial={false}>
                                                {!isCollapsed && (
                                                    <motion.span
                                                        initial={{ opacity: 0 }}
                                                        animate={{ opacity: 1 }}
                                                        exit={{ opacity: 0 }}
                                                        transition={{ duration: 0.15 }}
                                                        className="text-[14px] tracking-tight whitespace-nowrap"
                                                    >
                                                        {item.label}
                                                    </motion.span>
                                                )}
                                            </AnimatePresence>
                                        </button>
                                    </TooltipTrigger>
                                    {isCollapsed && <TooltipContent side="right" className="bg-black text-white border-white/10 rounded-lg">{item.label}</TooltipContent>}
                                </Tooltip>
                            );
                        })}
                    </div>

                    {/* User Detail (Only shown when expanded) */}
                    <div className="px-3 pb-6 border-t border-[#EBE9E2] dark:border-white/[0.06]">
                        <AnimatePresence mode="wait">
                            {!isCollapsed ? (
                                <motion.div 
                                    key="user-expanded"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 10 }}
                                    className="pt-4"
                                    ref={moreMenuRef}
                                >
                                    <button
                                        onClick={() => setIsMoreOptionsOpen(!isMoreOptionsOpen)}
                                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/[0.05] transition-all group"
                                    >
                                        <motion.div 
                                            layout
                                            className="w-7 h-7 rounded-full overflow-hidden border border-[#EBE9E2] dark:border-boult-divider bg-white dark:bg-black shrink-0"
                                        >
                                            <img
                                                src={(session?.user?.image?.startsWith('http') || session?.user?.image?.startsWith('/')) ? session.user.image : "/user-avatar.png?v=2"}
                                                alt="User"
                                                className="w-full h-full object-cover"
                                            />
                                        </motion.div>
                                        <div className="flex flex-col items-start overflow-hidden flex-1">
                                            <span className="text-[13px] font-medium text-[#1A1A1A] dark:text-white truncate w-full">
                                                {session?.user?.name || 'Account'}
                                            </span>
                                            <span className="text-[10px] text-[#666666] dark:text-boult-fg-tertiary truncate w-full">
                                                Manage Profile
                                            </span>
                                        </div>
                                        <ChevronRight className={`ml-auto w-4 h-4 text-[#666666] dark:text-boult-fg-tertiary transition-transform ${isMoreOptionsOpen ? 'rotate-90' : ''}`} />
                                    </button>
                                    
                                    <AnimatePresence>
                                        {isMoreOptionsOpen && (
                                            <motion.div 
                                                initial={{ opacity: 0, height: 0, y: 5 }}
                                                animate={{ opacity: 1, height: 'auto', y: 0 }}
                                                exit={{ opacity: 0, height: 0, y: 5 }}
                                                className="mt-2 space-y-1 px-1 overflow-hidden"
                                            >
                                                <button
                                                    onClick={() => {
                                                        setIsFeedbackOpen(true);
                                                        setIsMoreOptionsOpen(false);
                                                    }}
                                                    className="w-full flex items-center gap-3 px-3 py-2 text-neutral-600 dark:text-boult-fg-tertiary hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/[0.05] rounded-lg transition-all text-sm group"
                                                >
                                                    <MessageCircle size={16} className="text-neutral-600 dark:text-boult-fg-tertiary group-hover:text-black dark:group-hover:text-white transition-colors" />
                                                    <span>Feedback</span>
                                                </button>
                                                <div className="h-px w-full bg-black/5 dark:bg-white/[0.06] my-1" />
                                                <button
                                                    onClick={handleLogout}
                                                    className="w-full flex items-center gap-3 px-3 py-2 text-red-500/80 hover:bg-red-500/5 rounded-lg transition-all text-sm"
                                                >
                                                    <LogOut size={16} />
                                                    <span>Log out @{userHandle}</span>
                                                </button>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            ) : (
                                <motion.div 
                                    key="user-collapsed"
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    className="flex justify-center pt-4"
                                >
                                     <motion.div 
                                        whileHover={{ scale: 1.1 }}
                                        whileTap={{ scale: 0.9 }}
                                        className="w-8 h-8 rounded-full overflow-hidden border border-[#EBE9E2] dark:border-boult-divider bg-white dark:bg-black cursor-pointer"
                                        onClick={() => setIsCollapsed(false)}
                                    >
                                        <img
                                            src={(session?.user?.image?.startsWith('http') || session?.user?.image?.startsWith('/')) ? session.user.image : "/user-avatar.png?v=2"}
                                            alt="User"
                                            className="w-full h-full object-cover grayscale opacity-80"
                                        />
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <FeedbackDialog open={isFeedbackOpen} onOpenChange={setIsFeedbackOpen} />
                </div>

            {/* Mobile Backdrop */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[90] md:hidden"
                    />
                )}
            </AnimatePresence>
        </TooltipProvider>
    );
}

const MoreHorizontal = ({ className }: { className?: string }) => (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
    </svg>
);
