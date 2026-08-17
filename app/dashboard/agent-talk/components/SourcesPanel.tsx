'use client';

/**
 * SourcesPanel — collapsible widget under assistant messages showing where
 * the answer came from. Per-tool grouping with item counts and click-to-
 * expand details.
 *
 * Data shape comes from ChatInterface's SSE tool_result aggregation. Each
 * source has a category (gmail / calendar / notion / slack / web / memory /
 * other), an optional title (e.g. email subject, event name), and an
 * optional URL the user can click through to verify.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Mail, Calendar, FileText, MessageSquare, Globe, Brain, Wrench, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SourceCategory =
  | 'gmail'
  | 'calendar'
  | 'notion'
  | 'slack'
  | 'web'
  | 'memory'
  | 'other';

export interface SourceItem {
  category: SourceCategory;
  /** Human-readable title — email subject, event name, page title, URL hostname. */
  title?: string;
  /** Optional clickthrough URL. */
  url?: string;
  /** Optional one-line context — sender name, date, etc. */
  context?: string;
}

interface SourcesPanelProps {
  sources: SourceItem[];
}

const CATEGORY_META: Record<SourceCategory, { label: string; icon: React.ComponentType<any>; color: string }> = {
  gmail:    { label: 'Gmail',    icon: Mail,           color: 'text-rose-300' },
  calendar: { label: 'Calendar', icon: Calendar,       color: 'text-sky-300' },
  notion:   { label: 'Notion',   icon: FileText,       color: 'text-amber-300' },
  slack:    { label: 'Slack',    icon: MessageSquare,  color: 'text-violet-300' },
  web:      { label: 'Web',      icon: Globe,          color: 'text-emerald-300' },
  memory:   { label: 'Memory',   icon: Brain,          color: 'text-fuchsia-300' },
  other:    { label: 'Other',    icon: Wrench,         color: 'text-white/50' },
};

function groupByCategory(sources: SourceItem[]): Array<[SourceCategory, SourceItem[]]> {
  const groups = new Map<SourceCategory, SourceItem[]>();
  for (const s of sources) {
    const cat = s.category || 'other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(s);
  }
  // Stable order — gmail, calendar, notion, slack, web, memory, other
  const order: SourceCategory[] = ['gmail', 'calendar', 'notion', 'slack', 'web', 'memory', 'other'];
  return order
    .filter(k => groups.has(k))
    .map(k => [k, groups.get(k)!] as [SourceCategory, SourceItem[]]);
}

export function SourcesPanel({ sources }: SourcesPanelProps) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;
  const groups = groupByCategory(sources);
  const totalCount = sources.length;

  return (
    <div className="mt-2 mb-1 select-none">
      {/* Tab toggle — very compact pill */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all',
          'border border-boult-border bg-boult-surface/50 hover:bg-boult-surface',
          'text-boult-fg-tertiary hover:text-boult-fg-secondary',
        )}
        aria-expanded={open}
        aria-controls="sources-panel"
      >
        <span>Sources</span>
        <span className="tabular-nums font-mono text-[10px] text-boult-fg-muted">{totalCount}</span>
        <ChevronDown
          className={cn(
            'w-3 h-3 transition-transform duration-200',
            open ? 'rotate-180' : 'rotate-0',
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="sources-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-xl border border-boult-border bg-boult-surface/40 p-3 space-y-3">
              {groups.map(([cat, items]) => {
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Icon className={cn('w-3 h-3', meta.color)} />
                      <span className={cn('text-[10.5px] font-bold uppercase tracking-wider', meta.color)}>
                        {meta.label}
                      </span>
                      <span className="text-[10px] font-mono text-boult-fg-muted tabular-nums">{items.length}</span>
                    </div>
                    <ul className="space-y-1 pl-4">
                      {items.map((item, i) => (
                        <li key={i} className="text-[12px] text-boult-fg-secondary leading-snug">
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-start gap-1.5 hover:text-boult-fg transition-colors group"
                            >
                              <span className="line-clamp-2">{item.title || item.url}</span>
                              <ExternalLink className="w-2.5 h-2.5 mt-0.5 opacity-50 group-hover:opacity-100 flex-shrink-0" />
                            </a>
                          ) : (
                            <span className="line-clamp-2">{item.title || '(untitled)'}</span>
                          )}
                          {item.context && (
                            <div className="text-[10.5px] text-boult-fg-muted mt-0.5 line-clamp-1">{item.context}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
