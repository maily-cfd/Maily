// Notification utility functions for managing notifications in localStorage

export interface Notification {
  id: string;
  type: 'like' | 'reply' | 'mention' | 'follow' | 'email' | 'system';
  user: {
    name: string;
    username: string;
    avatar: string;
    verified?: boolean;
  };
  content: string;
  timestamp: string;
  read: boolean;
  action?: string;
  metadata?: {
    originalPost?: string;
    emailSubject?: string;
  };
}

const NOTIFICATIONS_KEY = 'maily_notifications';

export const getNotifications = (): Notification[] => {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(NOTIFICATIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading notifications:', error);
    return [];
  }
};

export const saveNotifications = (notifications: Notification[]): void => {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
    // Dispatch custom event to notify other components
    window.dispatchEvent(new CustomEvent('notificationsUpdated'));
  } catch (error) {
    console.error('Error saving notifications:', error);
  }
};

export const addNotification = (notification: Omit<Notification, 'id' | 'read'>): void => {
  const notifications = getNotifications();
  
  // Check for duplicate notifications (same content and user within last 5 seconds)
  const now = Date.now();
  const recentThreshold = 5000; // 5 seconds
  const isDuplicate = notifications.some(n => {
    if (n.type !== notification.type) return false;
    if (n.user.username !== notification.user.username) return false;
    if (n.content !== notification.content) return false;
    
    // Check if notification was created recently (within threshold)
    const notificationTime = parseInt(n.id.split('_')[1]) || 0;
    return (now - notificationTime) < recentThreshold;
  });
  
  // Don't add duplicate notifications
  if (isDuplicate) {
    return;
  }
  
  const newNotification: Notification = {
    ...notification,
    id: `notification_${now}_${Math.random().toString(36).substr(2, 9)}`,
    read: false,
  };
  
  // Add to beginning of array
  notifications.unshift(newNotification);
  
  // Keep only last 100 notifications
  if (notifications.length > 100) {
    notifications.splice(100);
  }
  
  saveNotifications(notifications);
};

export const markNotificationAsRead = (id: string): void => {
  const notifications = getNotifications();
  const updated = notifications.map(n => 
    n.id === id ? { ...n, read: true } : n
  );
  saveNotifications(updated);
};

export const markAllNotificationsAsRead = (): void => {
  const notifications = getNotifications();
  const updated = notifications.map(n => ({ ...n, read: true }));
  saveNotifications(updated);
};

export const deleteNotification = (id: string): void => {
  const notifications = getNotifications();
  const updated = notifications.filter(n => n.id !== id);
  saveNotifications(updated);
};

export const getUnreadCount = (): number => {
  const notifications = getNotifications();
  return notifications.filter(n => !n.read).length;
};

