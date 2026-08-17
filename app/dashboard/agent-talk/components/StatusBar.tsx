'use client';

/**
 * StatusBar — Boult top-level metrics bar
 * Shows emails triaged today, drafts waiting, meetings booked, agents running
 * Persistent across the Boult workspace
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  Mail,
  FileText,
  Calendar,
  Bot,
  Zap,
  TrendingUp
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface StatusBarMetric {
  id: string;
  label: string;
  value: number;
  icon: React.ComponentType<any>;
  color: string;
  pulse?: boolean;
}

interface StatusBarProps {
  emailsTriaged?: number;
  draftsWaiting?: number;
  meetingsBooked?: number;
  agentsRunning?: number;
  className?: string;
  onMetricClick?: (metricId: string) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function StatusBar({
  emailsTriaged = 0,
  draftsWaiting = 0,
  meetingsBooked = 0,
  agentsRunning = 0,
  className,
  onMetricClick,
}: StatusBarProps) {
  const metrics: StatusBarMetric[] = [
    {
      id: 'triaged',
      label: 'Triaged',
      value: emailsTriaged,
      icon: Mail,
      color: 'text-blue-400',
    },
    {
      id: 'drafts',
      label: 'Drafts',
      value: draftsWaiting,
      icon: FileText,
      color: 'text-amber-400',
      pulse: draftsWaiting > 0,
    },
    {
      id: 'meetings',
      label: 'Meetings',
      value: meetingsBooked,
      icon: Calendar,
      color: 'text-green-400',
    },
    {
      id: 'agents',
      label: 'Agents',
      value: agentsRunning,
      icon: Bot,
      color: 'text-purple-400',
      pulse: agentsRunning > 0,
    },
  ];

  const hasActivity = emailsTriaged > 0 || draftsWaiting > 0 || meetingsBooked > 0 || agentsRunning > 0;

  if (!hasActivity) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "flex items-center gap-1 px-1.5 py-1 rounded-full",
        "bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06]",
        "backdrop-blur-md",
        className
      )}
    >
      {/* Activity indicator */}
      <div className="flex items-center gap-1.5 px-2">
        <div className="relative">
          <Zap className="w-3 h-3 text-black/30 dark:text-white/30" />
          {agentsRunning > 0 && (
            <motion.div
              className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-400 rounded-full"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            />
          )}
        </div>
      </div>

      <div className="w-[1px] h-3 bg-black/[0.06] dark:bg-white/[0.06]" />

      {/* Metrics */}
      {metrics.filter(m => m.value > 0).map((metric, i) => (
        <React.Fragment key={metric.id}>
          {i > 0 && <div className="w-[1px] h-3 bg-black/[0.04] dark:bg-white/[0.04]" />}
          <button
            onClick={() => onMetricClick?.(metric.id)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full",
              "hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all",
              "group/metric cursor-default"
            )}
          >
            <metric.icon className={cn("w-3 h-3", metric.color, "opacity-70 group-hover/metric:opacity-100 transition-opacity")} />
            <span className="text-[11px] font-bold text-black/70 dark:text-white/70 tabular-nums group-hover/metric:text-black/90 dark:group-hover/metric:text-white/90 transition-colors">
              {metric.value}
            </span>
            <span className="text-[10px] text-black/30 dark:text-white/25 font-medium hidden sm:inline group-hover/metric:text-black/45 dark:group-hover/metric:text-white/40 transition-colors">
              {metric.label}
            </span>
            {metric.pulse && (
              <motion.div
                className={cn("w-1 h-1 rounded-full", metric.color.replace('text-', 'bg-'))}
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ repeat: Infinity, duration: 2 }}
              />
            )}
          </button>
        </React.Fragment>
      ))}
    </motion.div>
  );
}

export default StatusBar;
