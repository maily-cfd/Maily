'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

interface DashboardSettings {
    smartNudges: boolean;
    aiTone: 'professional' | 'friendly' | 'concise' | 'humorous' | 'mimic';
    smartGrouping: boolean;
    notifications: boolean;
    soundEffects: boolean;
    compactMode: boolean;
    privacyMode: boolean;
    aiProtection: boolean;
    aesEncryption: boolean;
    trainingData: boolean;
    soundExperience: boolean;
    soundVolume: number;
    soundPitch: number;
    soundType: 'mechanical' | 'bubble' | 'macos' | 'vintage';
}

interface DashboardSettingsContextType {
    settings: DashboardSettings;
    updateSetting: (key: keyof DashboardSettings, value: any) => void;
    isBoultOpen: boolean;
    setIsBoultOpen: (open: boolean) => void;
    resetCache: () => void;
    relaunchApp: () => void;
    showNotification: (title: string, options?: NotificationOptions) => void;
    playSystemSound: (type: 'toggle' | 'notification' | 'success' | 'click') => void;
    subscriptionData: any;
    setSubscriptionData: (data: any) => void;
}

const defaultSettings: DashboardSettings = {
    smartNudges: true,
    aiTone: 'professional',
    smartGrouping: true,
    notifications: true,
    soundEffects: true,
    compactMode: false,
    privacyMode: false,
    aiProtection: true,
    aesEncryption: true,
    trainingData: false,
    soundExperience: true,
    soundVolume: 0.5,
    soundPitch: 1.0,
    soundType: 'mechanical',
};

const DashboardSettingsContext = createContext<DashboardSettingsContextType | undefined>(undefined);

export function DashboardSettingsProvider({ children }: { children: React.ReactNode }) {
    const [settings, setSettings] = useState<DashboardSettings>(defaultSettings);
    const [isBoultOpen, setIsBoultOpen] = useState(false);
    const [subscriptionData, setSubscriptionData] = useState<any>(null);
    const { data: session } = useSession();

    // Load settings from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('maily_dashboard_settings');
        if (saved) {
            try {
                setSettings({ ...defaultSettings, ...JSON.parse(saved) });
            } catch (e) {
                console.error('Failed to parse settings', e);
            }
        }
    }, []);

    // Save settings to localStorage
    const updateSetting = useCallback((key: keyof DashboardSettings, value: any) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            localStorage.setItem('maily_dashboard_settings', JSON.stringify(next));
            return next;
        });
    }, []);

    // Keyboard shortcut listener for Boult (Ctrl+K / Cmd+K)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const modifier = isMac ? e.metaKey : e.ctrlKey;
            
            if (modifier && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setIsBoultOpen(prev => !prev);
                if (settings.soundEffects) {
                    playSystemSound('toggle');
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [settings.soundEffects]);

    // System sounds
    const playSystemSound = useCallback((type: 'toggle' | 'notification' | 'success' | 'click') => {
        if (settings.soundExperience) {
            window.dispatchEvent(new CustomEvent('play-ai-sound', { 
                detail: { action: type === 'click' ? 'click' : 'press' } 
            }));
            return;
        }

        if (!settings.soundEffects) return;
        
        const sounds = {
            toggle: '/sounds/toggle.mp3',
            notification: '/sounds/notification.mp3',
            success: '/sounds/success.mp3',
            click: '/sounds/click.mp3'
        };

        const audio = new Audio(sounds[type]);
        audio.volume = 0.4;
        audio.play().catch(e => console.log('Audio play blocked', e));
    }, [settings.soundEffects, settings.soundExperience]);

    // Notification helper
    const showNotification = useCallback((title: string, options?: NotificationOptions) => {
        if (!settings.notifications) return;

        if (Notification.permission === 'granted') {
            new Notification(title, options);
            if (settings.soundEffects) playSystemSound('notification');
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    new Notification(title, options);
                    if (settings.soundEffects) playSystemSound('notification');
                }
            });
        }
    }, [settings.notifications, settings.soundEffects, playSystemSound]);

    const resetCache = useCallback(() => {
        localStorage.clear();
        sessionStorage.clear();
        // Clear IndexedDB if used
        window.indexedDB.databases().then(databases => {
            databases.forEach(db => {
                if (db.name) window.indexedDB.deleteDatabase(db.name);
            });
        });
        toast.success("Local cache reset successfully");
        setTimeout(() => window.location.reload(), 1000);
    }, []);

    const relaunchApp = useCallback(() => {
        window.location.reload();
    }, []);

    return (
        <DashboardSettingsContext.Provider value={{ 
            settings, 
            updateSetting, 
            isBoultOpen, 
            setIsBoultOpen,
            resetCache,
            relaunchApp,
            showNotification,
            playSystemSound,
            subscriptionData,
            setSubscriptionData
        }}>
            {children}
        </DashboardSettingsContext.Provider>
    );
}

export function useDashboardSettings() {
    const context = useContext(DashboardSettingsContext);
    if (context === undefined) {
        throw new Error('useDashboardSettings must be used within a DashboardSettingsProvider');
    }
    return context;
}
