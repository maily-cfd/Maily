"use client";

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSession } from 'next-auth/react';
import ChatInterface from '../ChatInterface';
import { AgentLoading } from '@/components/ui/agent-loading';

export default function AgentTalkPage() {
    const router = useRouter();
    const params = useParams();
    const [conversationId, setConversationId] = useState<string | null>(null);
    // Seed from the session cache so a page remount (Next re-processing a
    // pushState, params change) doesn't flash the full-screen loader over an
    // active chat — that flash read as "redirected me to /agent-talk". The
    // real checks still run below on every mount and redirect if they fail;
    // the server-side layout gate remains the actual paywall.
    const [isAuthenticated, setIsAuthenticated] = useState(
        () => typeof window !== 'undefined' && sessionStorage.getItem('boult_auth_ok') === '1'
    );

    // Set page title
    useEffect(() => {
        document.title = 'Boult / Maily';
    }, []);

    // Check authentication and onboarding status on component mount
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const session = await getSession();
                if (!session) {
                    // Redirect to sign-in page if not authenticated
                    try { sessionStorage.removeItem('boult_auth_ok'); } catch { /* private mode */ }
                    router.push('/auth/signin?callbackUrl=/dashboard/agent-talk');
                    return;
                }

                // Check onboarding status
                try {
                    const response = await fetch('/api/onboarding/status');
                    if (response.ok) {
                        const data = await response.json();
                        if (!data.completed) {
                            // Onboarding not completed, resume onboarding
                            router.push('/onboarding');
                            return;
                        }
                    }
                } catch (error) {
                    console.error('Error checking onboarding status:', error);
                    // On error, redirect to onboarding to be safe
                    router.push('/onboarding');
                    return;
                }

                // All authenticated users have full access — skip subscription check.
                try { sessionStorage.setItem('boult_auth_ok', '1'); } catch { /* private mode */ }
                setIsAuthenticated(true);
            } catch (error) {
                console.error('Authentication check failed:', error);
                try { sessionStorage.removeItem('boult_auth_ok'); } catch { /* private mode */ }
                router.push('/auth/signin?callbackUrl=/dashboard/agent-talk');
            }
        };

        checkAuth();
    }, [router]);

    useEffect(() => {
        // Extract conversation ID from params
        const id = params?.id;
        const urlConversationId = Array.isArray(id) ? id[0] : id;

        // Check if it's a valid conversation ID format (supports both conv_ format and UUID format)
        if (urlConversationId &&
            (urlConversationId.startsWith('conv_') || /^[0-9a-f-]{36}$/.test(urlConversationId))) {
            setConversationId(urlConversationId);
            console.log('Loading conversation from URL:', urlConversationId);
        } else {
            setConversationId(null);
            console.log('No conversation ID in URL - starting fresh chat');
        }
    }, [params]);

    // Listen to browser popstate (back/forward history navigation)
    useEffect(() => {
        const handlePopState = () => {
            const pathParts = window.location.pathname.split('/');
            const urlConversationId = pathParts[pathParts.length - 1];
            if (urlConversationId &&
                (urlConversationId.startsWith('conv_') || /^[0-9a-f-]{36}$/.test(urlConversationId))) {
                setConversationId(urlConversationId);
            } else {
                setConversationId(null);
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const handleConversationSelect = (selectedConversationId: string) => {
        // Update URL to include conversation ID without triggering full route transition
        window.history.pushState(null, '', `/dashboard/agent-talk/${selectedConversationId}`);
        setConversationId(selectedConversationId);
    };

    const handleNewChat = () => {
        // Navigate back to base agent-talk page for new chat
        window.history.pushState(null, '', '/dashboard/agent-talk');
        setConversationId(null);
    };

    const handleConversationDelete = (deletedConversationId: string) => {
        // If the current conversation was deleted, ensure we're on the base page
        if (conversationId === deletedConversationId) {
            window.history.pushState(null, '', '/dashboard/agent-talk');
            setConversationId(null);
        }
    };

    // Don't render anything if not authenticated
    if (!isAuthenticated) {
        return <AgentLoading />;
    }

    return (
        <div
            className="satoshi-agent-talk agent-talk-container bg-boult-bg"
            style={{
                fontFamily: 'Satoshi, sans-serif',
                height: '100vh',
                overflow: 'hidden'
            }}
        >
            <ChatInterface
                initialConversationId={conversationId}
                onConversationSelect={handleConversationSelect}
                onNewChat={handleNewChat}
                onConversationDelete={handleConversationDelete}
            />
        </div>
    );
}
