"use client";

import { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';

interface NotificationIconProps {
  className?: string;
  iconClassName?: string;
  onClick?: () => void;
}

export function NotificationIcon({ className = "", iconClassName = "", onClick }: NotificationIconProps) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // Load unread count
    const loadUnreadCount = () => {
      if (typeof window !== 'undefined') {
        try {
          const stored = localStorage.getItem('maily_notifications');
          if (stored) {
            const notifications = JSON.parse(stored);
            const unread = notifications.filter((n: any) => !n.read).length;
            setUnreadCount(unread);
          }
        } catch (error) {
          console.error('Error loading unread count:', error);
        }
      }
    };

    loadUnreadCount();

    // Listen for notification updates
    const handleUpdate = () => {
      loadUnreadCount();
    };

    window.addEventListener('notificationsUpdated', handleUpdate);
    return () => window.removeEventListener('notificationsUpdated', handleUpdate);
  }, []);

  return (
    <div className={`relative inline-flex ${className}`}>
      <Bell className={iconClassName} />
      {unreadCount > 0 && (
        <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full border-2 border-black z-10"></div>
      )}
    </div>
  );
}

