'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Sparkles, Clock, X, Check, Loader2, Zap } from 'lucide-react';

type GrantAction = 'send_email' | 'schedule_meeting' | 'send_slack_message' | 'send_slack_dm' | 'calcom_book';

interface Grant { action_type: GrantAction; target_key: string; level: string; delay_mode: string; approve_count: number; reject_count: number; suggested: boolean; label?: string; }
interface ActionRow { id: string; tool_name: string; summary?: string; status: string; execute_at: string; target_key?: string; }
interface Settings { enabled: boolean; bufferMinutes: number; allowInstant: boolean; }

const ACTION_LABEL: Record<string, string> = {
  send_email: 'Email replies',
  schedule_meeting: 'Meeting bookings',
  send_slack_message: 'Slack messages',
  send_slack_dm: 'Slack DMs',
  calcom_book: 'Cal.com bookings',
};
// Never let an unexpected action_type crash the panel via undefined.toLowerCase().
const actionLabel = (a: string) => ACTION_LABEL[a] || 'Actions';

export default function AutonomyPanel() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [suggestions, setSuggestions] = useState<Grant[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    setErr(false);
    try {
      const res = await fetch('/api/boult/autonomy');
      if (!res.ok) throw new Error();
      const d = await res.json();
      setSettings(d.settings);
      setGrants(d.grants || []);
      setSuggestions(d.suggestions || []);
      setActions(d.pendingActions || []);
    } catch { setErr(true); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Tick once a second so the countdowns stay live while the panel is open.
  useEffect(() => {
    const hasPending = actions.some(a => a.status === 'auto_scheduled');
    if (!hasPending) return;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [actions]);

  const post = async (payload: any, okMsg?: string) => {
    try {
      const res = await fetch('/api/boult/autonomy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      if (okMsg) toast.success(okMsg);
      await load();
    } catch { toast.error('Something went wrong. Please try again.'); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 text-boult-fg-muted animate-spin" /></div>;
  }
  if (err || !settings) {
    return (
      <div className="p-4 bg-boult-raised/60 border border-boult-divider rounded-xl flex items-center justify-between gap-3">
        <p className="text-[13px] text-boult-fg-secondary">Couldn’t load autonomy settings.</p>
        <button onClick={() => { setLoading(true); load(); }} className="px-3 py-1.5 rounded-lg bg-boult-fg text-boult-fg-inverse text-[12px] font-bold">Retry</button>
      </div>
    );
  }

  const pending = actions.filter(a => a.status === 'auto_scheduled');
  const history = actions.filter(a => a.status !== 'auto_scheduled').slice(0, 8);

  const countdown = (iso: string) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'sending…';
    const m = Math.floor(ms / 60000); const s = Math.floor((ms % 60000) / 1000);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="space-y-7">
      {/* Intro + master switch */}
      <div className="p-4 bg-boult-surface/60 border border-boult-border rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-boult-raised/80 flex items-center justify-center text-boult-fg-secondary flex-shrink-0"><ShieldCheck className="w-4 h-4" /></div>
            <div>
              <p className="text-[14px] font-bold text-boult-fg">Autonomy</p>
              <p className="text-[12.5px] text-boult-fg-muted leading-relaxed mt-0.5 max-w-md">
                Let Boult handle routine actions to people you trust — without asking each time. Every auto action waits a short window so you can Stop it first. Off by default; you earn it contact by contact.
              </p>
            </div>
          </div>
          <button
            onClick={() => post({ op: 'settings', enabled: !settings.enabled }, settings.enabled ? 'Autonomy paused' : 'Autonomy enabled')}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${settings.enabled ? 'bg-emerald-500' : 'bg-boult-divider'}`}
            aria-label="Toggle autonomy"
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settings.enabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        {settings.enabled && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-boult-divider/60 text-[12.5px] text-boult-fg-secondary">
            <Clock className="w-3.5 h-3.5 text-boult-fg-muted" /> Undo window:
            {[5, 10, 30].map(m => (
              <button key={m} onClick={() => post({ op: 'settings', bufferMinutes: m })}
                className={`px-2 py-0.5 rounded-md text-[12px] font-semibold ${settings.bufferMinutes === m ? 'bg-boult-fg text-boult-fg-inverse' : 'bg-boult-raised text-boult-fg-secondary hover:text-boult-fg'}`}>
                {m}m
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="space-y-2.5">
          <p className="text-[12px] font-bold uppercase tracking-wider text-boult-fg-muted">Ready to automate</p>
          {suggestions.map(s => (
            <div key={`${s.action_type}|${s.target_key}`} className="p-3.5 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-xl flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <p className="text-[13px] text-boult-fg leading-snug">
                  You’ve approved <span className="font-bold">{s.approve_count}</span> {actionLabel(s.action_type).toLowerCase()} to <span className="font-bold">{s.label || s.target_key}</span>. Let Boult handle these automatically?
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => post({ op: 'acceptSuggestion', action: s.action_type, targetKey: s.target_key }, 'Automated — Boult will handle these')}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-bold hover:bg-emerald-600 active:scale-95 transition-all flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Yes
                </button>
                <button onClick={() => post({ op: 'dismissSuggestion', action: s.action_type, targetKey: s.target_key })}
                  className="px-3 py-1.5 rounded-lg text-boult-fg-secondary hover:text-boult-fg hover:bg-boult-raised text-[12px] font-semibold transition-all">
                  Keep asking
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* In-flight auto actions */}
      {pending.length > 0 && (
        <div className="space-y-2.5">
          <p className="text-[12px] font-bold uppercase tracking-wider text-boult-fg-muted">About to happen</p>
          {pending.map(a => (
            <div key={a.id} className="p-3.5 bg-boult-surface/60 border border-boult-border rounded-xl flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] text-boult-fg truncate">{a.summary || a.tool_name}</p>
                <p className="text-[12px] text-boult-fg-muted mt-0.5 flex items-center gap-1.5"><Clock className="w-3 h-3" /> sends in {countdown(a.execute_at)}</p>
              </div>
              <button onClick={() => post({ op: 'stopAction', id: a.id }, 'Stopped')}
                className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-[12px] font-bold hover:bg-red-500/20 active:scale-95 transition-all flex items-center gap-1 flex-shrink-0">
                <X className="w-3.5 h-3.5" /> Stop
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Per-target grants */}
      <div className="space-y-2.5">
        <p className="text-[12px] font-bold uppercase tracking-wider text-boult-fg-muted">Who Boult can act for</p>
        {grants.filter(g => g.level !== 'inherit').length === 0 ? (
          <p className="text-[13px] text-boult-fg-muted">Nothing automated yet. As you approve Boult’s actions, it’ll suggest contacts to handle on their own.</p>
        ) : (
          grants.filter(g => g.level !== 'inherit').map(g => (
            <div key={`${g.action_type}|${g.target_key}`} className="p-3 bg-boult-surface/40 border border-boult-border rounded-xl flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-boult-fg truncate">{g.label || g.target_key}</p>
                <p className="text-[11.5px] text-boult-fg-muted">{actionLabel(g.action_type)}</p>
              </div>
              <select
                value={g.level === 'auto' ? (g.delay_mode === 'instant' ? 'auto_instant' : 'auto_buffer') : g.level}
                onChange={(e) => {
                  const v = e.target.value;
                  const payload = v.startsWith('auto')
                    ? { op: 'setGrant', action: g.action_type, targetKey: g.target_key, level: 'auto', delayMode: v === 'auto_instant' ? 'instant' : 'buffer', label: g.label }
                    : { op: 'setGrant', action: g.action_type, targetKey: g.target_key, level: v, label: g.label };
                  post(payload, 'Updated');
                }}
                className="text-[12px] font-semibold bg-boult-raised border border-boult-divider rounded-lg px-2 py-1.5 text-boult-fg flex-shrink-0 outline-none"
              >
                <option value="auto_buffer">Auto · undo window</option>
                {settings.allowInstant && <option value="auto_instant">Auto · instant</option>}
                <option value="hold">Ask me</option>
                <option value="never">Never</option>
              </select>
            </div>
          ))
        )}
      </div>

      {/* Recent autonomous activity */}
      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-bold uppercase tracking-wider text-boult-fg-muted">Recently handled</p>
          {history.map(a => (
            <div key={a.id} className="flex items-center gap-2 text-[12.5px] text-boult-fg-secondary px-1">
              {a.status === 'done' ? <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                : a.status === 'cancelled' ? <X className="w-3.5 h-3.5 text-boult-fg-muted flex-shrink-0" />
                : <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
              <span className="truncate">{a.summary || a.tool_name}</span>
              <span className="text-boult-fg-muted ml-auto flex-shrink-0">{a.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
