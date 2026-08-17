"use client";

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, Zap, ArrowRight, RefreshCw, AlertTriangle } from 'lucide-react';
import { signIn } from 'next-auth/react';
import { cn } from '@/lib/utils';
import type { ScheduledAgentData } from './ScheduledAgentCard';

// Maps the agent's required-integration id → the real session-authed OAuth
// route segment (/api/integrations/{seg}/auth). The old /api/connectors/oauth
// route never existed, so connecting here always 404'd.
const PROVIDER_AUTH: Record<string, string> = {
  gcal: 'google_calendar',
  google_calendar: 'google_calendar',
  calendar: 'google_calendar',
  google_meet: 'google_meet',
  notion: 'notion',
  notion_calendar: 'notion_calendar',
  slack: 'slack',
  calcom: 'cal_com',
  cal_com: 'cal_com',
};

// ── Integration icon components ───────────────────────────────────────────────

function GmailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636C.732 21.002 0 20.27 0 19.366V5.457c0-.904.732-1.636 1.636-1.636h.273L12 10.728 21.091 3.821h.273c.904 0 1.636.732 1.636 1.636z" fill="#EA4335"/>
    </svg>
  );
}

function GCalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.75 3H6.25A3.25 3.25 0 003 6.25v11.5A3.25 3.25 0 006.25 21h11.5A3.25 3.25 0 0021 17.75V6.25A3.25 3.25 0 0017.75 3zM8 16.5H6.5V11H8v5.5zm5.25 0h-1.5v-2.25h-1V13h1v-2h1.5v2h1v1.25h-1V16.5zm4.25 0H16V11h1.5v5.5zM3 9h18V7H3v2z" fill="#4285F4"/>
    </svg>
  );
}

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.521A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" fill="#E01E5A"/>
    </svg>
  );
}

function NotionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" fill="currentColor"/>
    </svg>
  );
}

// ── Integration metadata ───────────────────────────────────────────────────────

const INTEGRATION_INFO: Record<string, { label: string; Icon: React.FC<{ className?: string }>; description: string }> = {
  gmail:  { label: 'Gmail',            Icon: GmailIcon,  description: 'Read and send emails' },
  gcal:   { label: 'Google Calendar',  Icon: GCalIcon,   description: 'Read and create calendar events' },
  slack:  { label: 'Slack',            Icon: SlackIcon,  description: 'Send Slack messages and DMs' },
  notion: { label: 'Notion',           Icon: NotionIcon, description: 'Read and write Notion pages' },
};

// ── Waiting indicator ─────────────────────────────────────────────────────────

function WaitingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="flex items-center gap-2 px-4 pb-3"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" className="flex-shrink-0">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => (
          <motion.circle
            key={deg}
            cx={7 + 5 * Math.cos((deg * Math.PI) / 180)}
            cy={7 + 5 * Math.sin((deg * Math.PI) / 180)}
            r="1.2"
            fill="#EAB308"
            animate={{ opacity: [1, 0.15, 1] }}
            transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </svg>
      <span className="text-[11px] font-medium text-amber-600/90 dark:text-yellow-400/80">
        Waiting for you to connect and proceed
      </span>
    </motion.div>
  );
}

// ── Agent params stored so we can create after all integrations are connected ──

export interface IntegrationRequiredData {
  agentName: string;
  required: string[];
  connected: string[];
  missing: string[];
  agentParams: {
    name: string;
    task_description: string;
    cron_schedule: string;
    output_channel: string;
    slack_channel: string | null;
    skip_confirmations: boolean;
    expires_at: string | null;
  };
}

interface IntegrationRequiredCardProps {
  data: IntegrationRequiredData;
  /** Called when agent is successfully created — parent should swap this card for a ScheduledAgentCard */
  onAgentCreated: (agent: ScheduledAgentData) => void;
}

export function IntegrationRequiredCard({ data, onAgentCreated }: IntegrationRequiredCardProps) {
  const [connectedSet, setConnectedSet] = useState<Set<string>>(new Set(data.connected));
  const [isCreating, setIsCreating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedId, setLastFailedId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const allConnected = data.required.every(r => connectedSet.has(r));

  // ── Re-check connected integrations ─────────────────────────────────────────
  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/boult/v3/integrations');
      if (!res.ok) return;
      const json = await res.json();
      const providers: string[] = (json.integrations || []).map((i: any) => i.provider as string);
      // Also check user_tokens (google login) via the existing status endpoint
      const statusRes = await fetch('/api/integrations/status').catch(() => null);
      if (statusRes?.ok) {
        const status = await statusRes.json();
        const connectedArray = status.integrations || [];
        if (connectedArray.some((i: any) => i.provider === 'gmail' && i.connected)) providers.push('gmail');
        if (connectedArray.some((i: any) => i.provider === 'google_calendar' && i.connected)) providers.push('gcal');
      }
      setConnectedSet(new Set(providers));
    } catch { /* non-critical */ } finally {
      setIsRefreshing(false);
    }
  }, []);

  // ── OAuth popup ──────────────────────────────────────────────────────────────
  const connectIntegration = async (integrationId: string) => {
    setConnectingId(integrationId);
    setError(null);
    setLastFailedId(null);

    // Gmail comes from the primary Google login, not a connector OAuth.
    if (integrationId === 'gmail') {
      signIn('google', { callbackUrl: window.location.href });
      return;
    }

    const provider = PROVIDER_AUTH[integrationId];
    if (!provider) {
      setConnectingId(null);
      setLastFailedId(integrationId);
      setError("That integration can't be connected here yet.");
      return;
    }

    // Open the popup synchronously (within the click) so it isn't blocked.
    const w = 500, h = 640;
    const popup = window.open(
      'about:blank',
      'Connect Integration',
      `width=${w},height=${h},left=${window.screenX + (window.outerWidth - w) / 2},top=${window.screenY + (window.outerHeight - h) / 2}`,
    );
    if (!popup) {
      setConnectingId(null);
      setLastFailedId(integrationId);
      setError('Popup was blocked — allow popups for this site and retry.');
      return;
    }

    const isConnected = async (): Promise<boolean> => {
      try {
        const r = await fetch('/api/integrations/status');
        const j = r.ok ? await r.json() : { integrations: [] };
        return (j.integrations || []).some((i: any) => i.provider === provider && i.connected);
      } catch { return false; }
    };

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      setConnectingId(null);
      refresh();
      if (!ok) {
        setLastFailedId(integrationId);
        setError("The connection didn't complete. Retry below — finish the sign-in in the popup window.");
      }
    };

    // Poll status and auto-close the popup the moment it connects, so the user
    // never lands on the dashboard inside the popup.
    const poll = setInterval(async () => {
      if (await isConnected()) {
        try { if (!popup.closed) popup.close(); } catch { /* cross-origin */ }
        finish(true);
      } else if (popup.closed) {
        finish(await isConnected());
      }
    }, 1000);
    const timeout = setTimeout(() => finish(false), 180_000);

    try {
      const res = await fetch(`/api/integrations/${provider}/auth`);
      if (!res.ok) throw new Error('start failed');
      const { url } = await res.json();
      if (!url) throw new Error('no url');
      popup.location.href = url;
    } catch {
      try { popup.close(); } catch { /* */ }
      finish(false);
    }
  };

  // ── Create the agent (skip=true bypasses integration check) ─────────────────
  const createAgent = async (skip = false) => {
    if (!skip && !allConnected) return;
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/boult/agents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.agentParams),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create agent');
      onAgentCreated(json.agent as ScheduledAgentData);
    } catch (err: any) {
      setError(err.message || 'Failed to create agent');
      setIsCreating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className="w-full max-w-[640px] mx-auto mb-4 rounded-3xl boult-glass-card overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.06] dark:border-zinc-200/10">
        <div className="flex items-center gap-2.5">
          <div className="p-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Zap className="w-4 h-4 fill-amber-400/20" />
          </div>
          <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest">
            Required Integrations
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={isRefreshing}
          className="p-1.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-all disabled:opacity-40"
          title="Re-check connections"
        >
          <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
        </button>
      </div>

      {/* Spec preview — modern Obsidian card styling */}
      <div className="mx-6 mt-4 p-4.5 rounded-2xl bg-black/[0.03] dark:bg-zinc-950/60 border border-black/[0.05] dark:border-zinc-200/5 shadow-inner">
        <p className="text-[14px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug mb-1">{data.agentName}</p>
        <p className="text-[12px] text-zinc-600 dark:text-zinc-400 leading-relaxed mb-3 font-light">
          {data.agentParams.task_description}
        </p>
        <div className="flex items-center gap-4 text-[11px] text-zinc-500 font-mono">
          <span className="flex items-center gap-1.5 bg-black/[0.04] dark:bg-zinc-900 px-2 py-1 rounded-md border border-black/[0.06] dark:border-zinc-800">
            <span>📅</span> {data.agentParams.cron_schedule}
          </span>
          <span>→</span>
          <span className="capitalize flex items-center gap-1.5 bg-black/[0.04] dark:bg-zinc-900 px-2 py-1 rounded-md border border-black/[0.06] dark:border-zinc-800">
            <span>🚀</span> {data.agentParams.output_channel}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-4 space-y-3">
        <p className="text-[13px] text-zinc-600 dark:text-zinc-400 leading-relaxed font-light">
          Activate the integrations below to deploy this agent.
        </p>

        <div className="space-y-2.5">
          {data.required.map(id => {
            const info = INTEGRATION_INFO[id] ?? { label: id, Icon: null, description: '' };
            const isConnected = connectedSet.has(id);
            const isConnecting = connectingId === id;

            return (
              <div
                key={id}
                className={cn(
                  'flex items-center gap-4 px-4 py-3 rounded-2xl border transition-all duration-300',
                  isConnected
                    ? 'bg-emerald-500/[0.04] border-emerald-500/20 hover:bg-emerald-500/[0.06]'
                    : 'bg-black/[0.02] dark:bg-zinc-900/40 border-black/[0.07] dark:border-zinc-800 hover:border-black/[0.14] dark:hover:border-zinc-700/60 hover:bg-black/[0.04] dark:hover:bg-zinc-900/60',
                )}
              >
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-950 border border-black/[0.07] dark:border-zinc-800 flex items-center justify-center shrink-0 shadow-sm">
                  {info.Icon
                    ? <info.Icon className="w-5.5 h-5.5" />
                    : <span className="text-[12px] font-bold text-zinc-500 dark:text-zinc-400">{info.label[0]}</span>
                  }
                </div>

                {/* Label + description */}
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-zinc-800 dark:text-zinc-200 leading-tight mb-0.5">{info.label}</p>
                  <p className="text-[11.5px] text-zinc-500 truncate font-light">{info.description}</p>
                </div>

                {/* Status / connect */}
                <AnimatePresence mode="wait" initial={false}>
                  {isConnected ? (
                    <motion.div
                      key="connected"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ type: 'spring', damping: 18, stiffness: 320 }}
                      className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 shrink-0 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-bold tracking-tight">Connected</span>
                    </motion.div>
                  ) : (
                    <motion.button
                      key="connect"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => connectIntegration(id)}
                      disabled={isConnecting}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[12px] font-bold bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 hover:scale-[1.02] active:scale-[0.98] transition-all shrink-0 disabled:opacity-60 shadow-lg shadow-black/10 dark:shadow-black/25"
                    >
                      {isConnecting ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : lastFailedId === id ? (
                        <RefreshCw className="w-3 h-3" />
                      ) : (
                        <ArrowRight className="w-3 h-3" />
                      )}
                      {isConnecting ? 'Connecting…' : lastFailedId === id ? 'Retry' : 'Connect'}
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex items-start gap-2.5 mt-2 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20"
            >
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-[12px] text-red-700 dark:text-red-300 leading-relaxed">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-black/[0.06] dark:border-zinc-200/10 bg-black/[0.015] dark:bg-zinc-950/20 flex flex-col items-center gap-3">
        <button
          onClick={() => createAgent(false)}
          disabled={!allConnected || isCreating}
          className={cn(
            'flex items-center gap-2 px-6 py-3 rounded-2xl text-[13px] font-extrabold tracking-wide transition-all w-full justify-center shadow-lg',
            allConnected && !isCreating
              ? 'bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-100 hover:scale-[1.01] active:scale-[0.99] shadow-black/10 dark:shadow-white/5'
              : 'bg-black/[0.04] dark:bg-zinc-900 border border-black/[0.07] dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed',
          )}
        >
          {isCreating ? (
            <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Creating Agent…</>
          ) : (
            <><Zap className="w-3.5 h-3.5 fill-current" /> Create Agent</>
          )}
        </button>
        <button
          onClick={() => createAgent(true)}
          disabled={isCreating}
          className="text-[11.5px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors font-medium"
        >
          Create without connecting (agent may fail)
        </button>
      </div>

       <div className="border-t border-black/[0.04] dark:border-zinc-200/5 bg-black/[0.02] dark:bg-zinc-950/40 py-2.5 flex justify-center">
        <WaitingIndicator />
      </div>
    </motion.div>
  );
}
