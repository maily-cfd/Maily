'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, RefreshCw, LogOut, ChevronRight } from 'lucide-react';

interface TokenExpiryAlertProps {
    isVisible: boolean;
    // WHICH Google connection expired drives both the copy and the reconnect
    // target. When neither is passed we default to reconnecting Gmail (the core
    // grant) so the component still works standalone.
    gmailNeedsReconnect?: boolean;
    calendarNeedsReconnect?: boolean;
    // Where to send the user back after the reconnect completes. Defaults to the
    // current page so they land back where the banner was shown.
    returnTo?: string;
    onClose?: () => void;
}

export function TokenExpiryAlert({
    isVisible,
    gmailNeedsReconnect,
    calendarNeedsReconnect,
    returnTo,
    onClose,
}: TokenExpiryAlertProps) {
    // Reconnect the connection that ACTUALLY expired. Prefer Gmail when both are
    // down (it's the core grant); the banner re-prompts for Calendar afterward.
    const target: 'gmail' | 'gcal' =
        gmailNeedsReconnect ? 'gmail' : calendarNeedsReconnect ? 'gcal' : 'gmail';

    const bothDown = gmailNeedsReconnect && calendarNeedsReconnect;
    const title = bothDown
        ? 'Google Connection Expired'
        : calendarNeedsReconnect
            ? 'Google Calendar Connection Expired'
            : 'Gmail Connection Expired';
    const subtitle = target === 'gcal'
        ? 'Reconnect to resume Boult AI workflows and Calendar sync.'
        : 'Reconnect to resume Boult AI workflows and Gmail syncing.';

    const handleReauthenticate = () => {
        // Reconnect THROUGH the Composio-aware route (consent on Composio's
        // VERIFIED Google client) for the connection that expired — NOT next-auth
        // signIn('google'). signIn re-runs OUR own OAuth client, which is the one
        // looping back with the same error, and it only ever re-grants the
        // login/Gmail identity — never the separate Calendar connection — so it
        // could never clear a Calendar expiry. /api/boult/v3/oauth/{gmail,gcal}
        // redirect to Composio when COMPOSIO_* is configured, else fall back to
        // our own OAuth automatically.
        const rt = returnTo
            || (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/home-feed');
        const path = target === 'gcal' ? '/api/boult/v3/oauth/gcal' : '/api/boult/v3/oauth/gmail';
        window.location.href = `${path}?returnTo=${encodeURIComponent(rt)}`;
    };

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ height: 0, opacity: 0, y: -20 }}
                    animate={{ height: 'auto', opacity: 1, y: 0 }}
                    exit={{ height: 0, opacity: 0, y: -20 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="w-full bg-rose-500 overflow-hidden relative z-[60]"
                >
                    <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center animate-pulse">
                                <AlertCircle className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[13px] font-bold text-white tracking-tight leading-none mb-1">
                                    {title}
                                </span>
                                <span className="text-[11px] text-white/80 font-medium leading-none">
                                    {subtitle}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleReauthenticate}
                                className="px-4 py-1.5 bg-white text-rose-600 rounded-full text-[12px] font-black uppercase tracking-wider hover:bg-neutral-100 transition-colors flex items-center gap-2 group active:scale-95"
                            >
                                <RefreshCw className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-500" />
                                <span>Reconnect Now</span>
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>

                            {onClose && (
                                <button
                                    onClick={onClose}
                                    className="p-1.5 hover:bg-white/10 rounded-full transition-colors"
                                >
                                    <LogOut className="w-4 h-4 text-white/60" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Subtle light beam effect */}
                    <motion.div
                        initial={{ x: '-100%' }}
                        animate={{ x: '100%' }}
                        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent w-full pointer-events-none"
                    />
                </motion.div>
            )}
        </AnimatePresence>
    );
}
