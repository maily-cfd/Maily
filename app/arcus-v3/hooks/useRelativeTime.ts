'use client';
/**
 * Boult V3 — Relative Time Hook
 * Updates every 60 seconds.
 */
import { useState, useEffect } from 'react';

export function useRelativeTime(date: string | Date | null): string {
  const [relative, setRelative] = useState(() => formatRelative(date));

  useEffect(() => {
    const interval = setInterval(() => {
      setRelative(formatRelative(date));
    }, 60000);
    return () => clearInterval(interval);
  }, [date]);

  return relative;
}

function formatRelative(date: string | Date | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
