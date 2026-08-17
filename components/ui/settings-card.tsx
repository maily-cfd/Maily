'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Settings,
    Monitor,
    User,
    Users,
    CreditCard,
    Shield,
    RefreshCw,
    Power,
    ChevronRight,
    Command,
    Cloud,
    Moon,
    Keyboard,
    Settings2,
    Check,
    LogOut,
    Trash2,
    Lock,
    Cpu,
    ShieldCheck,
    Zap,
    Bell,
    Languages,
    MousePointer2,
    Volume2,
    Sparkles,
    HelpCircle,
    Edit3,
    Camera,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Plug
} from 'lucide-react';
import { ToggleSwitch } from './toggle-switch';
import { Button } from './button';
import { DropdownMenu } from './dropdown-menu';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useDashboardSettings } from '@/lib/DashboardSettingsContext';
import { toast } from 'sonner';
import { 
    Info, 
    ArrowRight, 
    ExternalLink, 
    History
} from 'lucide-react';
import { CancellationFlow } from './cancellation-flow';
import { ThemeToggle } from './theme-toggle';
import { SUPPORTED_APPS, V3_DIRECT_ROUTES } from './connectors-modal';

interface SettingsCardProps {
    onClose: () => void;
    onOpenHelp?: () => void;
}

type SettingsSection = 'general' | 'system' | 'account' | 'team' | 'subscription' | 'privacy' | 'integrations';

export function SettingsCard({ onClose, onOpenHelp }: SettingsCardProps) {
    const { data: session, update: updateSession } = useSession();
    const router = useRouter();
    const { settings, updateSetting, resetCache, relaunchApp, subscriptionData, setSubscriptionData } = useDashboardSettings();
    const [activeSection, setActiveSection] = useState<SettingsSection>('general');
    const [isLoadingSubscription, setIsLoadingSubscription] = useState(false);
    const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
    const [integrationStatuses, setIntegrationStatuses] = useState<any[]>([]);

    useEffect(() => {
        if (activeSection === 'integrations') {
            const fetchStatus = async () => {
                try {
                    const res = await fetch('/api/integrations/status');
                    if (res.ok) {
                        const data = await res.json();
                        setIntegrationStatuses(Array.isArray(data.integrations) ? data.integrations : []);
                    }
                } catch (err) {
                    console.error('Failed to fetch status:', err);
                }
            };
            fetchStatus();
        }
    }, [activeSection]);

    useEffect(() => {
        if (typeof window !== 'undefined' && activeSection === 'integrations') {
            const params = new URLSearchParams(window.location.search);
            const success = params.get('success');
            const provider = params.get('provider');
            
            if (success === 'connected' && provider) {
                toast.success('Connection Successful');
                // Clear query params without reload
                window.history.replaceState({}, '', window.location.pathname);
            }
        }
    }, [activeSection]);

    const isAppConnected = (appId: string) => {
        if (Array.isArray(integrationStatuses)) {
            return integrationStatuses.find((s: any) => s.provider === appId)?.connected;
        }
        return (integrationStatuses as any)?.[appId] === true || (integrationStatuses as any)?.[appId]?.connected === true;
    };

    const handleConnectAction = async (appId: string) => {
        if (V3_DIRECT_ROUTES[appId]) {
            window.location.assign(V3_DIRECT_ROUTES[appId]);
            return;
        }
        try {
            const res = await fetch(`/api/integrations/${appId}/auth`);
            if (res.ok) {
                const data = await res.json();
                if (data.url) { window.location.assign(data.url); return; }
            }
            toast.error('Authentication failed. Please try again.');
        } catch {
            toast.error('Could not reach authentication server.');
        }
    };

    const handleDisconnectApp = async (appId: string) => {
        try {
            // PART 25: route through the unified disconnect endpoint built in
            // PART 24 so all three token stores are cleared in one call
            // (boult_integrations + integration_credentials + user_tokens).
            // The legacy DELETE /api/integrations only cleared
            // integration_credentials, leaving the newer boult_integrations
            // row orphaned — chat would keep seeing the connector as
            // connected after the user clicked Disconnect.
            const res = await fetch('/api/boult/connectors/disconnect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: appId }),
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Disconnect failed (${res.status})`);
            }
            const result = await res.json().catch(() => ({}));
            // Refresh status panel from server
            const resStatus = await fetch('/api/integrations/status');
            if (resStatus.ok) {
                const data = await resStatus.json();
                setIntegrationStatuses(Array.isArray(data.integrations) ? data.integrations : []);
            }
            toast.success(
                result?.totalRows
                    ? `Disconnected (${result.totalRows} record${result.totalRows === 1 ? '' : 's'} cleared)`
                    : 'App disconnected',
            );
        } catch (err: any) {
            toast.error(err?.message || 'Failed to disconnect app');
            console.error('[Settings] Disconnect failed:', err);
        }
    };

    const isPro = subscriptionData?.planType?.toLowerCase() === 'pro';
    const isStarter = subscriptionData?.planType?.toLowerCase() === 'starter';
    const isFree = !isPro && !isStarter;
    const isTrial = !!(subscriptionData?.isTrialing || subscriptionData?.status === 'trialing');

    useEffect(() => {
        const fetchSubscription = async () => {
            if (activeSection === 'subscription') {
                // Only show loading if we don't have data yet
                if (!subscriptionData) {
                    setIsLoadingSubscription(true);
                }
                
                try {
                    const response = await fetch('/api/subscription/usage');
                    if (response.ok) {
                        const data = await response.json();
                        setSubscriptionData(data);
                    }
                } catch (error) {
                    console.error('Error fetching subscription data:', error);
                } finally {
                    setIsLoadingSubscription(false);
                }
            }
        };

        fetchSubscription();
    }, [activeSection, setSubscriptionData]);

    const [accountInfo, setAccountInfo] = useState({
        firstName: '',
        lastName: '',
        email: '',
        username: '',
        picture: '/boult-ai-icon.jpg',
        banner: '',
        occupation: 'Founder',
        bio: '',
        joinedDate: new Date().getFullYear().toString()
    });

    useEffect(() => {
        const fetchProfile = async () => {
            try {
                // Fetch full profile data instead of just the basic user info
                const response = await fetch('/api/profile');
                if (response.ok) {
                    const data = await response.json();
                    setAccountInfo({
                        firstName: data.name?.split(' ')[0] || '',
                        lastName: data.name?.split(' ').slice(1).join(' ') || '',
                        email: data.email || '',
                        username: data.username || '',
                        picture: data.avatar_url || data.picture || '/boult-ai-icon.jpg',
                        banner: data.banner_url || '',
                        occupation: data.work_status || 'Founder',
                        bio: data.bio || '',
                        joinedDate: data.created_at ? new Date(data.created_at).getFullYear().toString() : new Date().getFullYear().toString()
                    });
                } else {
                    console.error('Failed to fetch profile:', response.status, response.statusText);
                }
            } catch (error) {
                console.error('Error fetching profile:', error);
            }
        };
        fetchProfile();
    }, []);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const bannerInputRef = useRef<HTMLInputElement>(null);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'banner') => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (type === 'avatar') setUploadingAvatar(true);
        if (type === 'banner') setUploadingBanner(true);

        const formData = new FormData();
        formData.append(type, file);
        formData.append('type', type);

        try {
            const response = await fetch('/api/profile/avatar', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                if (type === 'avatar') {
                    setAccountInfo(prev => ({ ...prev, picture: data.url }));
                } else {
                    setAccountInfo(prev => ({ ...prev, banner: data.url }));
                }
                toast.success(`${type === 'avatar' ? 'Photo' : 'Banner'} uploaded!`);
            } else {
                toast.error(`Failed to upload ${type}`);
            }
        } catch (error) {
            console.error('Upload error:', error);
            toast.error('Error uploading image');
        } finally {
            if (type === 'avatar') setUploadingAvatar(false);
            if (type === 'banner') setUploadingBanner(false);
        }
    };

    const [isSaving, setIsSaving] = useState(false);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [uploadingBanner, setUploadingBanner] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);

    const handleSaveAccount = async () => {
        if (!accountInfo.firstName?.trim()) {
            toast.error('First Name is required');
            return;
        }
        setIsSaving(true);
        try {
            const response = await fetch('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `${accountInfo.firstName} ${accountInfo.lastName}`,
                    username: accountInfo.username,
                    avatar_url: accountInfo.picture,
                    banner_url: accountInfo.banner,
                    work_status: accountInfo.occupation,
                    bio: accountInfo.bio
                }),
            });

            if (response.ok) {
                toast.success('Profile updated successfully');
                setIsEditingProfile(false);
                await updateSession();
            } else {
                const errorData = await response.json();
                console.error('Profile update failed:', errorData);
                toast.error(errorData.error || 'Failed to update profile');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsSaving(false);
        }
    };

    const performDeleteAccount = async () => {
        try {
            const response = await fetch('/api/user/delete-account', { method: 'DELETE' });
            if (response.ok) {
                signOut({ callbackUrl: '/' });
            } else {
                toast.error('Failed to delete account', { description: 'Please try again or contact support.' });
            }
        } catch (error) {
            toast.error('Failed to delete account', { description: 'Something went wrong. Please try again.' });
        }
    };

    const handleDeleteAccount = () => {
        // Styled confirmation instead of native confirm(). Long duration so the
        // permanent-deletion warning can't auto-dismiss before it's read.
        toast('Delete your account?', {
            description: 'This is permanent and wipes all your data. This cannot be undone.',
            duration: 10000,
            action: { label: 'Delete forever', onClick: () => performDeleteAccount() },
            cancel: { label: 'Cancel', onClick: () => {} },
        });
    };

    const MenuButton = ({ id, icon: Icon, label, category = false }: { id?: SettingsSection, icon?: any, label: string, category?: boolean }) => {
        if (category) {
            return (
                <div className="px-4 py-3 first:pt-4">
                    <span className="text-[11px] font-bold tracking-tight text-neutral-500 dark:text-neutral-400">
                        {label}
                    </span>
                </div>
            );
        }

        const isActive = activeSection === id;

        return (
            <button
                onClick={() => id && setActiveSection(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isActive
                        ? 'bg-black/[0.05] dark:bg-white/[0.1] text-black dark:text-white font-serif tracking-tight shadow-sm'
                        : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-black/[0.03] dark:hover:bg-white/5'
                    }`}
            >
                {Icon && <Icon className={`w-4 h-4 transition-colors ${isActive ? 'text-black dark:text-white' : 'text-neutral-500 dark:text-neutral-400 group-hover:text-black dark:group-hover:text-white'}`} strokeWidth={isActive ? 2 : 1.5} />}
                <span className="text-[14px] leading-tight">{label}</span>
            </button>
        );
    };



    return (
        <>
        <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
            onClick={onClose}
        >
            <div
                className="w-full md:max-w-[920px] h-full md:h-[640px] bg-white dark:bg-[#191919] rounded-none md:rounded-[2rem] overflow-hidden flex flex-col md:flex-row shadow-[0_32px_128px_-16px_rgba(0,0,0,0.8)] md:border border-neutral-200 dark:border-white/5"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Sidebar */}
                {/* Sidebar - Horizontal scroll on mobile, vertical on desktop */}
                <div className="w-full md:w-[250px] bg-neutral-50 dark:bg-[#292929] border-b md:border-b-0 md:border-r border-neutral-200 dark:border-white/5 p-4 flex flex-row md:flex-col overflow-x-auto md:overflow-y-hidden shrink-0">
                    <div className="flex flex-row md:flex-col items-center md:items-stretch gap-1 md:gap-0 md:flex-1 md:overflow-y-auto custom-scrollbar pr-1">
                        <div className="hidden md:block">
                             <MenuButton label="Settings" category />
                        </div>
                        <MenuButton id="general" icon={Settings2} label="General" />
                        <MenuButton id="system" icon={Monitor} label="System" />
                        <MenuButton id="integrations" icon={Plug} label="Integrations" />

                        <div className="hidden md:block my-2 h-px bg-neutral-200 dark:bg-white/5" />

                        <div className="hidden md:block">
                            <MenuButton label="Account" category />
                        </div>
                        <MenuButton id="account" icon={User} label="Account" />
                        <MenuButton id="team" icon={Users} label="Team" />
                        <MenuButton id="subscription" icon={CreditCard} label="Subscription" />
                        <MenuButton id="privacy" icon={Shield} label="Privacy" />

                        <div className="hidden md:block my-2 h-px bg-neutral-200 dark:bg-white/5" />
                        
                        <button
                            onClick={() => {
                                onClose();
                                onOpenHelp?.();
                            }}
                            className="hidden md:flex w-full items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white hover:bg-black/[0.03] dark:hover:bg-white/5"
                        >
                            <HelpCircle className="w-4 h-4 text-neutral-500 dark:text-neutral-400" strokeWidth={1.5} />
                            <span className="text-[14px] leading-tight">Help</span>
                        </button>
                    </div>

                    {/* Footer Info - Hidden on mobile */}
                    <div className="hidden md:flex px-4 py-4 items-center justify-between mt-auto">
                        <span className="text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">Maily v1.0.1</span>
                        <div className="w-4 h-4 rounded-full bg-neutral-200 dark:bg-white/5 flex items-center justify-center">
                            <Cloud className="w-2.5 h-2.5 text-neutral-500 dark:text-neutral-400" />
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col h-full relative">
                    {/* Header Title */}
                    <div className="px-6 md:px-10 pt-6 md:pt-8 pb-4 md:pb-6 flex items-center justify-between">
                        <motion.h1
                            key={activeSection}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="text-2xl md:text-4xl font-serif text-black dark:text-white capitalize tracking-tight"
                        >
                            {activeSection === 'subscription' ? 'Subscription' : activeSection === 'privacy' ? 'Privacy' : activeSection.replace('-', ' ')}
                        </motion.h1>

                        <button
                            onClick={onClose}
                            className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-50 dark:bg-white/5 transition-colors group absolute top-4 md:top-6 right-4 md:right-6"
                        >
                            <X className="w-5 h-5 text-neutral-600 group-hover:text-black dark:group-hover:text-white" />
                        </button>
                    </div>

                    <div className="px-6 md:px-10 pb-8 md:pb-8 overflow-y-auto flex-1 custom-scrollbar">
                        <AnimatePresence mode="wait">
                            {activeSection === 'general' && (
                                <motion.div
                                    key="general"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="space-y-6"
                                >
                                    <div className="bg-neutral-50 dark:bg-white/5 rounded-[2.5rem] p-8 md:p-10 border border-neutral-200 dark:border-white/5 space-y-8">
                                        <div className="flex items-center justify-between group">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <Moon className="w-4 h-4 text-purple-500" />
                                                    <h3 className="text-[15px] font-semibold text-black dark:text-white">Appearance</h3>
                                                </div>
                                                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                                                    Toggle between Light, Dark, or System mode.
                                                </p>
                                            </div>
                                            <ThemeToggle />
                                        </div>
                                        <div className="h-px bg-neutral-50 dark:bg-white/5" />
                                        <div className="flex items-center justify-between group">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <Keyboard className="w-4 h-4 text-blue-500" />
                                                    <h3 className="text-[15px] font-semibold text-black dark:text-white">Default Draft Tone</h3>
                                                </div>
                                                <p className="text-sm text-neutral-600 dark:text-neutral-500">Current: <span className="text-black dark:text-white capitalize">{settings.aiTone}</span></p>
                                            </div>
                                            <DropdownMenu
                                                options={[
                                                    { 
                                                        label: "Professional", 
                                                        onClick: () => updateSetting('aiTone', 'professional'),
                                                        Icon: <Shield className="w-4 h-4" />,
                                                        active: settings.aiTone === 'professional'
                                                    },
                                                    { 
                                                        label: "Friendly", 
                                                        onClick: () => updateSetting('aiTone', 'friendly'),
                                                        Icon: <Users className="w-4 h-4" />,
                                                        active: settings.aiTone === 'friendly'
                                                    },
                                                    { 
                                                        label: "Concise", 
                                                        onClick: () => updateSetting('aiTone', 'concise'),
                                                        Icon: <Zap className="w-4 h-4" />,
                                                        active: settings.aiTone === 'concise'
                                                    },
                                                    { 
                                                        label: "Humorous", 
                                                        onClick: () => updateSetting('aiTone', 'humorous'),
                                                        Icon: <Sparkles className="w-4 h-4" />,
                                                        active: settings.aiTone === 'humorous'
                                                    },
                                                    { 
                                                        label: "Mimic My Style", 
                                                        onClick: () => updateSetting('aiTone', 'mimic'),
                                                        Icon: <Cpu className="w-4 h-4" />,
                                                        active: settings.aiTone === 'mimic'
                                                    },
                                                ]}
                                                align="right"
                                            >
                                                {settings.aiTone === 'professional' ? 'Professional' : 
                                                 settings.aiTone === 'friendly' ? 'Friendly' :
                                                 settings.aiTone === 'concise' ? 'Concise' :
                                                 settings.aiTone === 'humorous' ? 'Humorous' :
                                                 settings.aiTone === 'mimic' ? 'Mimic (AI)' : 'Select Tone'}
                                            </DropdownMenu>
                                        </div>
                                        {settings.aiTone === 'mimic' && (
                                            <div className="bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-yellow-500/5 border border-amber-400/25 rounded-2xl p-4 mt-2">
                                                <p className="text-[13px] text-black dark:text-white/90 leading-relaxed">
                                                    <Sparkles className="w-3.5 h-3.5 inline mr-1.5 mb-0.5 text-amber-400" />
                                                    <strong className="text-black dark:text-white font-semibold">AI Voice Cloning:</strong>{' '}
                                                    <span className="text-neutral-900 dark:text-neutral-300">Maily will analyze your sent emails to perfectly replicate your writing style. This process happens automatically when drafting.</span>
                                                </p>
                                            </div>
                                        )}
                                        <div className="h-px bg-neutral-50 dark:bg-white/5" />
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <MousePointer2 className="w-4 h-4 text-emerald-500" />
                                                    <h3 className="text-[15px] font-semibold text-black dark:text-white">Smart Thread Grouping</h3>
                                                </div>
                                                <p className="text-sm text-neutral-500 dark:text-neutral-400">Automatically group related emails using Sift AI.</p>
                                            </div>
                                            <ToggleSwitch checked={settings.smartGrouping} onChange={(v) => updateSetting('smartGrouping', v)} />
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {activeSection === 'system' && (
                                <motion.div
                                    key="system"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="space-y-8"
                                >
                                    <div className="space-y-4">
                                        <h2 className="text-[13px] font-bold tracking-tight text-neutral-500 dark:text-neutral-400 px-1">Keyboard Shortcuts</h2>
                                        <div className="bg-neutral-50 dark:bg-white/5 rounded-[2.5rem] p-6 border border-neutral-200 dark:border-white/5">
                                            <div className="flex items-center gap-2 mb-5">
                                                <Keyboard className="w-4 h-4 text-blue-500" />
                                                <span className="text-[14px] font-semibold text-black dark:text-white">Boult Shortcuts</span>
                                                <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-white/5 px-2 py-0.5 rounded-full border border-neutral-200 dark:border-white/10">macOS / Windows</span>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-0.5">
                                                {[
                                                    { label: 'Focus chat input', keys: ['⌘', 'K'] },
                                                    { label: 'Send message', keys: ['⌘', '↵'] },
                                                    { label: 'New chat', keys: ['⌘', '⇧', 'N'] },
                                                    { label: 'Morning briefing', keys: ['⌘', '⇧', 'B'] },
                                                    { label: 'Check follow-ups', keys: ['⌘', '⇧', 'F'] },
                                                    { label: 'Open audit trail', keys: ['⌘', '⇧', 'A'] },
                                                    { label: 'Copy last response', keys: ['⌘', '⇧', 'C'] },
                                                    { label: 'Toggle sidebar', keys: ['⌘', '\\'] },
                                                    { label: 'Close canvas / panels', keys: ['Esc'] },
                                                    { label: 'Show shortcuts', keys: ['⌘', '/'] },
                                                ].map(({ label, keys }) => (
                                                    <div key={label} className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/[0.04] transition-colors">
                                                        <span className="text-[13px] text-neutral-600 dark:text-neutral-400">{label}</span>
                                                        <div className="flex items-center gap-1">
                                                            {keys.map((k, i) => (
                                                                <kbd key={i} className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-[11px] font-semibold font-mono text-neutral-700 dark:text-white/70 bg-white dark:bg-white/[0.08] border border-neutral-200 dark:border-white/10 rounded-md shadow-sm">
                                                                    {k}
                                                                </kbd>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <p className="mt-4 text-[11px] text-neutral-400 dark:text-neutral-500 text-center">
                                                Press <kbd className="inline text-[10px] px-1 py-0.5 bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded">⌘ /</kbd> anytime in the chat to see this list.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h2 className="text-[13px] font-bold tracking-tight text-neutral-500 dark:text-neutral-400 px-1">App Maintenance</h2>
                                        <div className="bg-neutral-50 dark:bg-white/5 rounded-[24px] p-6 border border-neutral-200 dark:border-white/5 flex items-center justify-center gap-4">
                                            <Button
                                                variant="outline"
                                                onClick={resetCache}
                                                className="border-neutral-200 dark:border-white/10 hover:bg-neutral-50 dark:bg-white/5 text-neutral-600 hover:text-black dark:text-white px-8 h-12 rounded-2xl flex items-center gap-2"
                                            >
                                                <RefreshCw className="w-4 h-4" />
                                                Reset Local Cache
                                            </Button>
                                            <Button
                                                variant="outline"
                                                onClick={relaunchApp}
                                                className="border-neutral-200 dark:border-white/10 hover:bg-neutral-50 dark:bg-white/5 text-neutral-600 hover:text-black dark:text-white px-8 h-12 rounded-2xl flex items-center gap-2"
                                            >
                                                <Power className="w-4 h-4" />
                                                Relaunch App
                                            </Button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {activeSection === 'account' && (
                                <motion.div
                                    key="account"
                                    initial={{ opacity: 0, scale: 0.98 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="space-y-6 focus:outline-none font-satoshi"
                                >
                                    <div className="bg-neutral-900 dark:bg-[#151515] rounded-[24px] border border-neutral-200 dark:border-white/[0.04] overflow-hidden shadow-2xl relative">
                                        {/* X-Style Banner Cover */}
                                        <div className="relative w-full aspect-[3.2/1] border-b border-white/[0.04] overflow-hidden group">
                                            {accountInfo.banner ? (
                                                <img 
                                                    src={accountInfo.banner} 
                                                    alt="Cover Banner" 
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                // Premium STATIC empty cover — intentional design, not a loader
                                                // (the old infinite opacity pulse read as a perpetual spinner).
                                                <div className="w-full h-full relative overflow-hidden">
                                                    <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-[#0e0e0e]" />
                                                    {/* soft ambient glows for depth */}
                                                    <div className="absolute -top-12 right-10 w-56 h-56 rounded-full blur-[72px] bg-indigo-500/12 pointer-events-none" />
                                                    <div className="absolute -bottom-16 left-8 w-56 h-56 rounded-full blur-[84px] bg-violet-500/10 pointer-events-none" />
                                                    {/* fine dot-grid texture */}
                                                    <div
                                                        className="absolute inset-0 pointer-events-none opacity-50"
                                                        style={{
                                                            backgroundImage: 'radial-gradient(circle at center, rgba(255,255,255,0.06) 1px, transparent 1px)',
                                                            backgroundSize: '22px 22px',
                                                        }}
                                                    />
                                                    {/* faint static brand glyph */}
                                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                        <Sparkles className="w-9 h-9 text-white/15" strokeWidth={1.5} />
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {isEditingProfile && (
                                                <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center cursor-pointer z-10">
                                                    {uploadingBanner ? (
                                                        <Loader2 className="w-8 h-8 text-white animate-spin" />
                                                    ) : (
                                                        <>
                                                            <Camera className="w-8 h-8 text-white mb-2" />
                                                            <span className="text-white text-xs font-bold uppercase tracking-wider">Change Cover</span>
                                                        </>
                                                    )}
                                                    <input 
                                                        type="file" 
                                                        accept="image/*" 
                                                        onChange={(e) => handleImageUpload(e, 'banner')} 
                                                        className="hidden" 
                                                    />
                                                </label>
                                            )}
                                        </div>

                                        {/* Profile Header Row */}
                                        <div className="px-6 flex justify-between items-start relative h-12 sm:h-16">
                                            <div className="absolute -top-12 sm:-top-16 left-6 w-20 h-20 sm:w-28 sm:h-28 rounded-full border-[4px] border-neutral-50 dark:border-[#151515] bg-[#1a1a1a] shadow-xl overflow-hidden relative group">
                                                {accountInfo.picture ? (
                                                    <img 
                                                        src={accountInfo.picture} 
                                                        alt="Avatar" 
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-neutral-600 bg-neutral-900">
                                                        <User className="w-8 h-8 sm:w-10 sm:h-10" />
                                                    </div>
                                                )}

                                                {isEditingProfile && (
                                                    <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center cursor-pointer z-10">
                                                        {uploadingAvatar ? (
                                                            <Loader2 className="w-6 h-6 text-white animate-spin" />
                                                        ) : (
                                                            <Camera className="w-6 h-6 text-white" />
                                                        )}
                                                        <input 
                                                            type="file" 
                                                            accept="image/*" 
                                                            onChange={(e) => handleImageUpload(e, 'avatar')} 
                                                            className="hidden" 
                                                        />
                                                    </label>
                                                )}
                                            </div>

                                            <div className="ml-auto mt-4">
                                                {!isEditingProfile ? (
                                                    <button
                                                        onClick={() => setIsEditingProfile(true)}
                                                        className="px-5 py-1.5 rounded-full border border-neutral-300 dark:border-neutral-700 hover:border-neutral-500 hover:bg-black/5 dark:hover:bg-white/5 font-extrabold text-xs text-black dark:text-white transition-all duration-200 shadow-md"
                                                    >
                                                        Edit Profile
                                                    </button>
                                                ) : (
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => setIsEditingProfile(false)}
                                                            className="px-4 py-1.5 rounded-full border border-neutral-300 dark:border-neutral-800 hover:bg-black/5 dark:hover:bg-white/5 text-neutral-500 dark:text-neutral-400 font-extrabold text-xs transition-all duration-200"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            onClick={handleSaveAccount}
                                                            disabled={isSaving}
                                                            className="px-5 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:text-white/40 text-white font-extrabold text-xs flex items-center gap-1.5 transition-all duration-200 shadow-md"
                                                        >
                                                            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                                            Save
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="px-6 pb-6 pt-2 space-y-4">
                                            <div>
                                                {!isEditingProfile ? (
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <h2 className="text-2xl font-black text-black dark:text-white tracking-tight leading-none">
                                                                {accountInfo.firstName} {accountInfo.lastName}
                                                            </h2>
                                                            
                                                            {(subscriptionData?.planType === 'pro' || subscriptionData?.planType === 'annual' || subscriptionData?.planType === 'starter') && (
                                                                <div className="relative group cursor-pointer shrink-0">
                                                                    <svg className="w-5 h-5 filter drop-shadow-[0_0_4px_rgba(245,158,11,0.5)] transition-transform hover:scale-110" viewBox="0 0 24 24" fill="currentColor">
                                                                        <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.99-3.818-3.99-.48 0-.94.1-1.348.27C14.78 2.518 13.483 1.5 12 1.5c-1.483 0-2.78 1.018-3.422 2.28-.408-.17-.867-.27-1.348-.27-2.108 0-3.818 1.78-3.818 3.99 0 .495.084.965.238 1.4-1.273.65-2.148 2.02-2.148 3.6 0 1.58.875 2.95 2.148 3.6-.154.435-.238.905-.238 1.4 0 2.21 1.71 3.99 3.818 3.99.48 0 .94-.1 1.348-.27.643 1.262 1.939 2.28 3.422 2.28 1.483 0 2.78-1.018 3.422-2.28.408.17.867.27 1.348.27 2.108 0 3.818-1.78 3.818-3.99 0-.495-.084-.965-.238-1.4 1.273-.65 2.148-2.02 2.148-3.6zm-12.5 4l-4-4 1.5-1.5 2.5 2.5 6-6 1.5 1.5-7.5 7.5z" fill="url(#goldGradX)" />
                                                                        <defs>
                                                                            <linearGradient id="goldGradX" x1="0%" y1="0%" x2="100%" y2="100%">
                                                                                <stop offset="0%" stopColor="#FCD34D" />
                                                                                <stop offset="50%" stopColor="#F59E0B" />
                                                                                <stop offset="100%" stopColor="#D97706" />
                                                                            </linearGradient>
                                                                        </defs>
                                                                    </svg>
                                                                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50 font-bold border border-white/10">
                                                                        <span className="text-amber-400 mr-1">✦</span> Gold Founder
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {subscriptionData?.planType === 'lifetime' && (
                                                                <div className="relative group cursor-pointer shrink-0">
                                                                    <svg className="w-5 h-5 filter drop-shadow-[0_0_6px_rgba(6,182,212,0.6)] animate-pulse transition-transform hover:scale-110" viewBox="0 0 24 24" fill="currentColor">
                                                                        <path d="M12 2L2 12l10 10 10-10L12 2zm-1.5 14.5l-4-4 1.5-1.5 2.5 2.5 6-6 1.5 1.5-7.5 7.5z" fill="url(#diamondGradX)" />
                                                                        <defs>
                                                                            <linearGradient id="diamondGradX" x1="0%" y1="0%" x2="100%" y2="100%">
                                                                                <stop offset="0%" stopColor="#22D3EE" />
                                                                                <stop offset="35%" stopColor="#6366F1" />
                                                                                <stop offset="70%" stopColor="#A855F7" />
                                                                                <stop offset="100%" stopColor="#EC4899" />
                                                                            </linearGradient>
                                                                        </defs>
                                                                    </svg>
                                                                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50 font-bold border border-white/10">
                                                                        <span className="text-cyan-400 mr-1">💎</span> Diamond Founder
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <p className="text-neutral-500 font-medium text-xs">
                                                            @{accountInfo.username || accountInfo.email.split('@')[0]}
                                                        </p>
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                                                        <div>
                                                            <label className="block text-[9px] font-black uppercase tracking-wider text-neutral-500 mb-1">First Name</label>
                                                            <input 
                                                                type="text"
                                                                value={accountInfo.firstName}
                                                                onChange={(e) => setAccountInfo(prev => ({ ...prev, firstName: e.target.value }))}
                                                                className="w-full px-4 py-2.5 bg-neutral-100 dark:bg-[#222] border border-neutral-200 dark:border-white/5 rounded-2xl text-xs text-black dark:text-white focus:border-blue-500 dark:focus:border-white/10 focus:outline-none transition-all font-sans"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[9px] font-black uppercase tracking-wider text-neutral-500 mb-1">Last Name</label>
                                                            <input 
                                                                type="text"
                                                                value={accountInfo.lastName}
                                                                onChange={(e) => setAccountInfo(prev => ({ ...prev, lastName: e.target.value }))}
                                                                className="w-full px-4 py-2.5 bg-neutral-100 dark:bg-[#222] border border-neutral-200 dark:border-white/5 rounded-2xl text-xs text-black dark:text-white focus:border-blue-500 dark:focus:border-white/10 focus:outline-none transition-all font-sans"
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Bio / Occupation area */}
                                            <div>
                                                {!isEditingProfile ? (
                                                    <div className="space-y-2 mt-1">
                                                        <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200">
                                                            {accountInfo.occupation || 'Founder'}
                                                        </p>
                                                        {accountInfo.bio && (
                                                            <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed max-w-xl whitespace-pre-wrap">
                                                                {accountInfo.bio}
                                                            </p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="mt-4 space-y-4">
                                                        <div>
                                                            <label className="block text-[9px] font-black uppercase tracking-wider text-neutral-500 mb-1">Occupation</label>
                                                            <input 
                                                                type="text"
                                                                value={accountInfo.occupation}
                                                                onChange={(e) => setAccountInfo(prev => ({ ...prev, occupation: e.target.value }))}
                                                                placeholder="E.g., Founder, Engineer, Designer"
                                                                className="w-full px-4 py-2.5 bg-neutral-100 dark:bg-[#222] border border-neutral-200 dark:border-white/5 rounded-2xl text-xs text-black dark:text-white focus:border-blue-500 dark:focus:border-white/10 focus:outline-none transition-all font-satoshi"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[9px] font-black uppercase tracking-wider text-neutral-500 mb-1">Bio</label>
                                                            <textarea 
                                                                value={accountInfo.bio}
                                                                onChange={(e) => setAccountInfo(prev => ({ ...prev, bio: e.target.value }))}
                                                                placeholder="Write a short bio..."
                                                                rows={3}
                                                                className="w-full px-4 py-2.5 bg-neutral-100 dark:bg-[#222] border border-neutral-200 dark:border-white/5 rounded-2xl text-xs text-black dark:text-white focus:border-blue-500 dark:focus:border-white/10 focus:outline-none transition-all resize-none font-satoshi"
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Details Row */}
                                            <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-500 font-medium pt-2">
                                                <div className="flex items-center gap-1.5">
                                                    <Users className="w-3.5 h-3.5" />
                                                    <span>Active Plan: <span className="text-black dark:text-neutral-300 capitalize">{(subscriptionData?.planType && subscriptionData?.planType !== 'none') ? subscriptionData.planType : 'Free'}</span></span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <Lock className="w-3.5 h-3.5" />
                                                    <span>{accountInfo.email}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <History className="w-3.5 h-3.5" />
                                                    <span>Joined {accountInfo.joinedDate}</span>
                                                </div>
                                            </div>

                                        </div>
                                    </div>


                                    <div className="flex items-center justify-between px-2 pt-4">
                                        <div className="flex gap-4">
                                            <Button
                                                variant="ghost"
                                                onClick={() => signOut()}
                                                className="bg-black/5 hover:bg-black/10 dark:bg-white/10 text-neutral-900 dark:text-neutral-300 px-6 h-12 rounded-2xl flex items-center gap-2 font-medium"
                                            >
                                                <LogOut className="w-4 h-4" />
                                                Sign out
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                onClick={handleDeleteAccount}
                                                className="text-neutral-500 dark:text-neutral-400 hover:text-red-500 transition-colors flex items-center gap-2 font-medium"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                Delete account
                                            </Button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
{activeSection === 'subscription' && (() => {
                                const boult = subscriptionData?.features?.boult_ai;
                                const sift = subscriptionData?.features?.sift_analysis;
                                const summary = subscriptionData?.features?.email_summary;
                                const tokens = subscriptionData?.features?.openai_tokens;
                                const isUnlimited = boult?.isUnlimited || isPro;

                                const boultUsed = boult?.usage ?? 0;
                                const boultLimit = boult?.limit ?? 50;
                                const boultRemaining = isUnlimited ? null : (boult?.remaining ?? boultLimit);

                                const tokenUsed = tokens?.usage ?? 0;
                                const tokenLimit = tokens?.limit ?? 50000;
                                const tokenIsUnlimited = tokens?.isUnlimited || isUnlimited;
                                const tokenPct = tokenIsUnlimited ? 0 : Math.min(100, (tokenUsed / tokenLimit) * 100);

                                const fmt = (n: number) => n.toLocaleString();
                                const fmtStat = (used: number, limit: number, unlimited: boolean) =>
                                    unlimited ? `${fmt(used)} used` : `${fmt(used)} / ${fmt(limit)}`;

                                const isExpired = !isFree && subscriptionData?.subscriptionEndsAt && new Date(subscriptionData.subscriptionEndsAt) < new Date();
                                const isActive = subscriptionData?.hasActiveSubscription || isFree;
                                const planLabel = (() => {
                                    if (isFree) return 'Free';
                                    const type = (subscriptionData?.planType || 'Pro');
                                    return type.charAt(0).toUpperCase() + type.slice(1);
                                })();

                                const STARTER_URL = 'https://buy.polar.sh/polar_cl_I2DWGQPxxX0lvNGzbAeSRbkdCP6TgU9Ybsy7O3pkReC';
                                const PRO_URL = 'https://buy.polar.sh/polar_cl_iFCJ2Mq7UbVBQTIiMGwI3STQZTvGfT1EBLyiM1HM5ca';
                                const PORTAL_URL = 'https://polar.sh/maily/portal';
                                const userEmail = session?.user?.email || '';

                                return (
                                <motion.div
                                    key="subscription"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="space-y-6"
                                >
                                    {isLoadingSubscription ? (
                                        <div className="flex items-center justify-center py-20">
                                            <RefreshCw className="w-8 h-8 text-neutral-600 dark:text-neutral-500 animate-spin" />
                                        </div>
                                    ) : (
                                        <>
                                        {/* Plan card */}
                                        <div className="bg-neutral-50 dark:bg-white/5 rounded-[16px] p-8 border border-neutral-200 dark:border-white/5">
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="space-y-1.5">
                                                    <p className="text-[10px] text-neutral-500 dark:text-neutral-500 font-bold uppercase tracking-widest">Current Plan</p>
                                                    <div className="flex items-center gap-2.5">
                                                        <h3 className="text-3xl font-serif text-black dark:text-white">{planLabel}</h3>
                                                        {isTrial && !isExpired && (
                                                            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">Free trial</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 pt-1">
                                                        <div className={`w-1.5 h-1.5 rounded-full ${isActive && !isExpired ? 'bg-emerald-500' : isExpired ? 'bg-red-500' : 'bg-neutral-400'}`} />
                                                        <span className="text-[13px] text-neutral-500 dark:text-neutral-400">
                                                            {isExpired ? 'Expired' : isTrial ? 'Trialing' : isActive ? 'Active' : 'Inactive'}
                                                            {!isFree && subscriptionData?.subscriptionEndsAt && !isExpired && (
                                                                isTrial
                                                                    ? <> · Free until {new Date(subscriptionData.subscriptionEndsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, then $29/mo</>
                                                                    : <> · Renews {new Date(subscriptionData.subscriptionEndsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</>
                                                            )}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end gap-2">
                                                    {isFree && (
                                                        <Button
                                                            onClick={() => { window.location.href = '/pricing' }}
                                                            className="bg-black dark:bg-white text-white dark:text-black hover:opacity-90 px-6 h-10 rounded-2xl font-bold text-[13px] transition-all"
                                                        >
                                                            Upgrade to Pro
                                                        </Button>
                                                    )}
                                                    {isStarter && (
                                                        <Button
                                                            onClick={() => { window.location.href = '/pricing' }}
                                                            className="bg-black dark:bg-white text-white dark:text-black hover:opacity-90 px-6 h-10 rounded-2xl font-bold text-[13px] transition-all"
                                                        >
                                                            Upgrade to Pro
                                                        </Button>
                                                    )}
                                                    {!isFree && (
                                                        <Button
                                                            variant="outline"
                                                            onClick={() => window.open(PORTAL_URL, '_blank')}
                                                            className="border-neutral-200 dark:border-white/10 text-black dark:text-white hover:bg-neutral-100 dark:hover:bg-white/10 px-5 h-10 rounded-2xl text-[13px] font-medium flex items-center gap-2"
                                                        >
                                                            <ExternalLink className="w-3.5 h-3.5" />
                                                            Manage on Polar
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Usage stats */}
                                        <div className="bg-neutral-50 dark:bg-[#070707] rounded-[16px] p-8 border border-neutral-200 dark:border-white/5 space-y-8">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] text-neutral-500 dark:text-neutral-500 font-bold uppercase tracking-widest">Usage</p>
                                                {isUnlimited && (
                                                    <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-500 bg-emerald-500/10 px-3 py-1 rounded-full">Unlimited</span>
                                                )}
                                            </div>

                                            {/* Boult AI */}
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <Sparkles className="w-4 h-4 text-neutral-500 dark:text-neutral-400" strokeWidth={1.5} />
                                                        <span className="text-[15px] font-medium text-black dark:text-white">Boult AI</span>
                                                    </div>
                                                    <span className="text-[15px] font-medium text-black dark:text-white font-mono">
                                                        {isUnlimited ? (
                                                            <span className="flex items-center gap-1.5">
                                                                <span className="text-emerald-500">∞</span>
                                                                <span className="text-neutral-500 text-[13px]">({fmt(boultUsed)} used today)</span>
                                                            </span>
                                                        ) : (
                                                            <span>{fmt(boultRemaining ?? 0)} <span className="text-neutral-400 text-[13px]">/ {fmt(boultLimit)} remaining</span></span>
                                                        )}
                                                    </span>
                                                </div>
                                                {!isUnlimited && (
                                                    <>
                                                        <div className="h-1.5 w-full bg-neutral-200 dark:bg-white/5 rounded-full overflow-hidden">
                                                            <motion.div
                                                                initial={{ width: 0 }}
                                                                animate={{ width: `${Math.min(100, (boultUsed / boultLimit) * 100)}%` }}
                                                                className="h-full bg-black dark:bg-white rounded-full"
                                                            />
                                                        </div>
                                                        <p className="text-[11px] text-neutral-500 pl-7">Resets to {fmt(boultLimit)} at 00:00 every day</p>
                                                    </>
                                                )}
                                            </div>

                                            {/* Secondary stats */}
                                            <div className="pt-6 border-t border-neutral-200 dark:border-white/5 grid grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 uppercase font-bold tracking-wider">Sift AI</p>
                                                    <p className="text-black dark:text-white text-[15px] font-medium">
                                                        {fmtStat(sift?.usage ?? 0, sift?.limit ?? 10, sift?.isUnlimited || isUnlimited)}
                                                    </p>
                                                    {!sift?.isUnlimited && !isUnlimited && (
                                                        <div className="h-1 w-full bg-neutral-200 dark:bg-white/5 rounded-full overflow-hidden">
                                                            <div className="h-full bg-neutral-400 dark:bg-neutral-600 rounded-full" style={{ width: `${Math.min(100, ((sift?.usage ?? 0) / (sift?.limit ?? 10)) * 100)}%` }} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="space-y-2">
                                                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 uppercase font-bold tracking-wider">Summaries</p>
                                                    <p className="text-black dark:text-white text-[15px] font-medium">
                                                        {fmtStat(summary?.usage ?? 0, summary?.limit ?? 20, summary?.isUnlimited || isUnlimited)}
                                                    </p>
                                                    {!summary?.isUnlimited && !isUnlimited && (
                                                        <div className="h-1 w-full bg-neutral-200 dark:bg-white/5 rounded-full overflow-hidden">
                                                            <div className="h-full bg-neutral-400 dark:bg-neutral-600 rounded-full" style={{ width: `${Math.min(100, ((summary?.usage ?? 0) / (summary?.limit ?? 20)) * 100)}%` }} />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Tokens */}
                                            <div className="pt-6 border-t border-neutral-200 dark:border-white/5 space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <Cpu className="w-4 h-4 text-neutral-500 dark:text-neutral-400" strokeWidth={1.5} />
                                                        <span className="text-[15px] font-medium text-black dark:text-white">Tokens Consumed</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-[17px] font-serif text-black dark:text-white">{fmt(tokenUsed)}</span>
                                                        <span className="text-[11px] text-neutral-500 font-sans ml-1.5 uppercase tracking-wider">tokens</span>
                                                    </div>
                                                </div>
                                                {tokenIsUnlimited ? (
                                                    <div className="flex items-center gap-2 text-[11px] text-emerald-500 font-bold uppercase tracking-widest">
                                                        <span>∞</span>
                                                        <span>Unlimited cluster access · OpenRouter</span>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="h-1.5 w-full bg-neutral-200 dark:bg-white/5 rounded-full overflow-hidden">
                                                            <motion.div
                                                                initial={{ width: 0 }}
                                                                animate={{ width: `${tokenPct}%` }}
                                                                className="h-full bg-black dark:bg-white rounded-full"
                                                            />
                                                        </div>
                                                        <div className="flex justify-between items-center text-[10px] text-neutral-500 font-bold uppercase tracking-widest">
                                                            <span>OpenRouter Cluster</span>
                                                            <span>{Math.round(tokenPct)}% of {fmt(tokenLimit)} quota</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Cancel section — paid plans only */}
                                        {!isFree && (
                                            <div>
                                                {!isConfirmingCancel ? (
                                                    <div className="bg-red-500/5 border border-red-500/10 rounded-[16px] p-6 space-y-3">
                                                        <div className="flex items-center gap-3 text-red-500">
                                                            <AlertCircle className="w-4 h-4" />
                                                            <h4 className="text-[15px] font-semibold">{isTrial ? 'Cancel free trial' : 'Cancel Subscription'}</h4>
                                                        </div>
                                                        <p className="text-[13px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                                                            {isTrial ? (
                                                                <>You won't be charged. Cancel before{' '}
                                                                <strong>{subscriptionData?.subscriptionEndsAt ? new Date(subscriptionData.subscriptionEndsAt).toLocaleDateString() : 'your trial ends'}</strong>{' '}
                                                                to avoid the $29/mo charge. You keep Pro until then.</>
                                                            ) : (
                                                                <>You'll keep {isPro ? 'Pro' : 'Starter'} access until{' '}
                                                                <strong>{subscriptionData?.subscriptionEndsAt ? new Date(subscriptionData.subscriptionEndsAt).toLocaleDateString() : 'end of period'}</strong>.</>
                                                            )}
                                                        </p>
                                                        <Button
                                                            onClick={() => setIsConfirmingCancel(true)}
                                                            variant="ghost"
                                                            className="bg-red-500/10 text-red-500 hover:bg-red-500/20 px-5 h-10 rounded-2xl font-medium flex items-center gap-2 text-[13px] transition-all"
                                                        >
                                                            {isTrial ? 'Cancel free trial' : 'Cancel plan'}
                                                            <ArrowRight className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <CancellationFlow
                                                        isOpen={isConfirmingCancel}
                                                        onClose={() => setIsConfirmingCancel(false)}
                                                        subscriptionEndsAt={subscriptionData?.subscriptionEndsAt}
                                                        onConfirm={async (reasons, feedback) => {
                                                            const response = await fetch('/api/subscription/cancel', {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ reasons, feedback }),
                                                            });
                                                            if (response.ok) {
                                                                toast.success(isTrial ? "Free trial cancelled — you won't be charged. Pro stays active until your trial ends." : 'Subscription cancelled. Access remains valid until period end.');
                                                                setIsConfirmingCancel(false);
                                                                const refresh = await fetch('/api/subscription/usage');
                                                                if (refresh.ok) setSubscriptionData(await refresh.json());
                                                            } else {
                                                                toast.error('Failed to cancel. Please contact support.');
                                                            }
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        )}
                                        </>
                                    )}
                                </motion.div>
                                );
                            })()}


                            {activeSection === 'privacy' && (
                                <motion.div
                                    key="privacy"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="space-y-8"
                                >
                                    <div className="bg-neutral-50 dark:bg-white/5 rounded-[16px] p-8 border border-neutral-200 dark:border-white/5 space-y-10">
                                        <div className="flex items-start justify-between">
                                            <div className="space-y-1 max-w-[480px]">
                                                <h3 className="text-[17px] font-bold text-black dark:text-white">Enhanced Privacy Mode</h3>
                                                <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                                                    When active, Maily does not store your conversation history on our cloud. Everything stays local to your browser.
                                                </p>
                                            </div>
                                            <ToggleSwitch checked={settings.privacyMode} onChange={(v) => updateSetting('privacyMode', v)} />
                                        </div>

                                        <div className="h-px bg-neutral-50 dark:bg-white/5" />

                                        <div className="flex items-start justify-between">
                                            <div className="space-y-1 max-w-[480px]">
                                                <h3 className="text-[17px] font-bold text-black dark:text-white">AI Protection Guard</h3>
                                                <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                                                    Prevents prompt injection attacks and exfiltration attempts from your email data.
                                                </p>
                                            </div>
                                            <ToggleSwitch checked={settings.aiProtection} onChange={(v) => updateSetting('aiProtection', v)} />
                                        </div>

                                        <div className="h-px bg-neutral-50 dark:bg-white/5" />

                                        <div className="flex items-start justify-between">
                                            <div className="space-y-1 max-w-[480px]">
                                                <h3 className="text-[17px] font-bold text-black dark:text-white">Local AES-256 Storage</h3>
                                                <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                                                    Encrypts all locally cached emails and drafts before saving them to IndexedDB.
                                                </p>
                                            </div>
                                            <ToggleSwitch checked={settings.aesEncryption} onChange={(v) => updateSetting('aesEncryption', v)} />
                                        </div>

                                        <div className="h-px bg-neutral-50 dark:bg-white/5" />

                                        <div className="flex items-start justify-between">
                                            <div className="space-y-1 max-w-[480px]">
                                                <h3 className="text-[17px] font-bold text-black dark:text-white">Training Contribution</h3>
                                                <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                                                    Allow Maily to use anonymized feedback to improve its email composition models.
                                                </p>
                                            </div>
                                            <ToggleSwitch checked={settings.trainingData} onChange={(v) => updateSetting('trainingData', v)} />
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-center gap-4 py-8 border border-emerald-500/20 bg-emerald-500/[0.02] rounded-[16px] relative overflow-hidden group">
                                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                                        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                                            <ShieldCheck className="w-8 h-8 text-emerald-500" />
                                        </div>
                                        <div className="text-center relative z-10">
                                            <h4 className="text-black dark:text-white text-lg font-bold mb-1 tracking-tight">Maily Shield Active</h4>
                                            <p className="text-neutral-600 dark:text-neutral-500 text-sm max-w-[320px] mx-auto">Your identity and inbox are protected by state-of-the-art encryption.</p>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {['team'].includes(activeSection) && (
                                <motion.div
                                    key="placeholder"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="flex flex-col items-center justify-center py-32 opacity-30"
                                >
                                    <Users className="w-12 h-12 text-neutral-500 dark:text-neutral-400 mb-4 animate-pulse-slow" />
                                    <p className="text-neutral-500 dark:text-neutral-400 font-medium">Coming soon</p>
                                </motion.div>
                            )}

                            {activeSection === 'integrations' && (
                                <motion.div
                                    key="integrations"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="space-y-6"
                                >
                                    <div className="bg-neutral-50 dark:bg-white/5 rounded-[2.5rem] p-8 md:p-10 border border-neutral-200 dark:border-white/5 space-y-6">
                                        <div className="mb-4">
                                            <h3 className="text-[15px] font-semibold text-black dark:text-white mb-1">Connected Apps</h3>
                                            <p className="text-sm text-neutral-500 dark:text-neutral-400">Manage your integrations to extend Maily's capabilities.</p>
                                        </div>
                                        <div className="space-y-4">
                                            {SUPPORTED_APPS.map((app) => {
                                                const isConnected = isAppConnected(app.id);
                                                return (
                                                    <div key={app.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-2xl bg-white dark:bg-[#1C1C1C] border border-neutral-200 dark:border-white/10 shadow-sm gap-4">
                                                        <div className="flex items-center gap-4">
                                                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center p-2.5 shrink-0 ${app.id === 'notion' || app.id === 'cal_com' ? 'bg-white border border-neutral-200 dark:border-white/10' : 'bg-black/5 dark:bg-black/60 border border-neutral-200 dark:border-white/5'}`}>
                                                                <app.icon className="w-full h-full" />
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <h4 className="text-[14px] font-bold text-black dark:text-white tracking-tight">{app.name}</h4>
                                                                    {app.comingSoon && (
                                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-black/5 dark:bg-white/10 text-neutral-500 dark:text-white/40">
                                                                            Coming soon
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="text-[12px] text-neutral-500 dark:text-neutral-400 line-clamp-1">{app.details}</p>
                                                            </div>
                                                        </div>
                                                        <div className="shrink-0 flex items-center">
                                                            {isConnected ? (
                                                                <div className="flex items-center gap-3">
                                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border bg-emerald-50 border-emerald-200 text-emerald-600 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400">
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                                                        Connected
                                                                    </span>
                                                                    <Button 
                                                                        variant="outline" 
                                                                        className="h-9 px-4 rounded-xl border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20 text-xs font-semibold"
                                                                        onClick={() => handleDisconnectApp(app.id)}
                                                                    >
                                                                        Disconnect
                                                                    </Button>
                                                                </div>
                                                            ) : app.comingSoon ? (
                                                                <Button variant="outline" disabled className="h-9 px-4 rounded-xl text-xs font-semibold opacity-50 cursor-not-allowed">
                                                                    Soon
                                                                </Button>
                                                            ) : (
                                                                <Button 
                                                                    variant="default" 
                                                                    className="h-9 px-4 rounded-xl text-xs font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-200"
                                                                    onClick={() => handleConnectAction(app.id)}
                                                                >
                                                                    Connect
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </motion.div>
        </>
    );
}

const Edit = ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
);
