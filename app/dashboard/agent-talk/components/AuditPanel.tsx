'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, AlertCircle, Clock, ChevronDown, Shield, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AuditEntry {
  id: string;
  run_id: string;
  tool_name: string;
  input_summary: string | null;
  output_summary: string | null;
  duration_ms: number | null;
  success: boolean;
  error_message: string | null;
  iteration: number | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const TOOL_LABELS: Record<string, string> = {
  search_gmail: 'Search Gmail',
  read_email: 'Read Email',
  draft_reply: 'Draft Reply',
  send_email: 'Send Email',
  get_calendar_events: 'Get Calendar',
  schedule_meeting: 'Schedule Meeting',
  search_notion: 'Search Notion',
  create_notion_page: 'Create Notion Page',
  open_canvas: 'Open Canvas',
  update_canvas: 'Update Canvas',
  web_search: 'Web Search',
  check_followups: 'Check Follow-ups',
  get_recipient_context: 'Get Recipient Context',
  remember_about_contact: 'Remember Contact',
  get_delegation_rules: 'Get Rules',
  create_delegation_rule: 'Create Rule',
};

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AuditPanel({ open, onClose }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await window.fetch('/api/boult/audit');
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetch();
  }, [open]);

  const grouped = entries.reduce<Record<string, AuditEntry[]>>((acc, e) => {
    const key = e.run_id ?? 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(e);
    return acc;
  }, {});

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-neutral-950 border-l border-white/10 z-[201] flex flex-col"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-white/40" />
                <span className="text-[13px] font-semibold text-white tracking-tight">Audit Trail</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetch}
                  className={cn('text-white/30 hover:text-white/60 transition-colors', loading && 'animate-spin')}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {loading && entries.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-white/25 text-[12px]">Loading…</div>
              ) : entries.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-6">
                  <Shield className="w-8 h-8 text-white/10" />
                  <p className="text-[12px] text-white/25">No tool calls logged yet. Run Boult to see what actions it takes.</p>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {Object.entries(grouped).slice(0, 20).map(([runId, runEntries]) => (
                    <RunGroup
                      key={runId}
                      runId={runId}
                      entries={runEntries}
                      expanded={expanded === runId}
                      onToggle={() => setExpanded(prev => prev === runId ? null : runId)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-white/[0.06] flex-shrink-0">
              <p className="text-[10px] text-white/20 text-center">
                Every tool call is logged for transparency. No data leaves your account.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function RunGroup({ runId, entries, expanded, onToggle }: {
  runId: string; entries: AuditEntry[]; expanded: boolean; onToggle: () => void;
}) {
  const success = entries.filter(e => e.success).length;
  const failed = entries.filter(e => !e.success).length;
  const totalMs = entries.reduce((s, e) => s + (e.duration_ms ?? 0), 0);
  const firstEntry = entries[entries.length - 1]; // oldest first

  return (
    <div className="border border-white/[0.06] rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            failed > 0 ? 'bg-red-400' : 'bg-emerald-400'
          )} />
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-white/70 truncate">
              {entries.length} tool{entries.length !== 1 ? 's' : ''} · {formatTime(firstEntry?.created_at)}
            </div>
            <div className="text-[10px] text-white/30">{formatDuration(totalMs)} total · {success} ok{failed > 0 ? ` · ${failed} failed` : ''}</div>
          </div>
        </div>
        <ChevronDown className={cn('w-3.5 h-3.5 text-white/25 transition-transform flex-shrink-0', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-white/[0.05] divide-y divide-white/[0.04]">
          {entries.map((e) => (
            <div key={e.id} className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                {e.success
                  ? <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                  : <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                }
                <span className="text-[11px] font-medium text-white/80">
                  {TOOL_LABELS[e.tool_name] ?? e.tool_name}
                </span>
                <span className="ml-auto text-[10px] text-white/25 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />{formatDuration(e.duration_ms)}
                </span>
              </div>
              {e.input_summary && (
                <p className="text-[10px] text-white/30 truncate pl-5">{e.input_summary}</p>
              )}
              {!e.success && e.error_message && (
                <p className="text-[10px] text-red-400/70 truncate pl-5">{e.error_message}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
