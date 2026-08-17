import { audioRuntime } from './audio-runtime';

/**
 * Premium Notification Service
 * Manages permissions, desktop popups, and audio synchronization
 */
export class NotificationService {
    static async requestPermission() {
        if (typeof window === 'undefined' || !('Notification' in window)) return false;
        
        if (Notification.permission === 'granted') return true;
        
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    }

    static get permission() {
        if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
        return Notification.permission;
    }

    /**
     * Show a rich desktop notification with optional sound
     */
    static async notify(title, body, options = {}) {
        const { 
            silent = false, 
            soundType = 'notify', // 'notify', 'success', 'complete'
            icon = '/favicon.ico', // Re-use favicon for now
            onClick = null 
        } = options;

        // 1. Trigger Sound procedurally
        if (!silent) {
            try {
                if (soundType === 'success') await audioRuntime.playSuccess();
                else if (soundType === 'complete') await audioRuntime.playComplete();
                else await audioRuntime.playNotify();
            } catch (e) {
                console.warn('Audio feedback failed:', e);
            }
        }

        // 2. Trigger OS Notification
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            const n = new Notification(title, {
                body,
                icon,
                silent: true, // We handle sound ourselves for higher fidelity
                ...options
            });

            if (onClick) {
                n.onclick = (event) => {
                    event.preventDefault();
                    window.focus();
                    onClick(n);
                    n.close();
                };
            } else {
                n.onclick = () => {
                    window.focus();
                    n.close();
                };
            }

            return n;
        }

        return null;
    }

    /**
     * Specialized notification for Boult Mission status
     */
    static async notifyMission(missionGoal, statusMessage, isSuccess = false) {
        return this.notify(
            `Boult: ${missionGoal}`,
            statusMessage,
            {
                soundType: isSuccess ? 'success' : 'notify',
                tag: 'boult-mission' // Overwrite previous mission notifications
            }
        );
    }
}
