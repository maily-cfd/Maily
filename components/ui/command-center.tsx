'use client';

/**
 * Command Center — the redesigned home feed.
 *
 * The old feed was an activity LOG: it told you what already happened. This is a
 * COMMAND CENTER: it opens with where your world stands right now and what needs
 * you, then shows the momentum behind it.
 *
 * Structure (top → bottom), each section a real data source, none invented:
 *   1. Hero      — greeting + one-line AI summary of the day + four stat tiles.
 *   2. Your week — a real 7-day activity chart (arcus_agent_runs; empty state is
 *                  honest, never a fabricated trend).
 *   3. Key conversations — THE new capability. Your important threads and where
 *                  each currently STANDS (awaiting you / waiting on them /
 *                  meeting booked), derived from the already-AI-triaged
 *                  decide/chase/showUp pools, deduped per person.
 *   4. Needs a reply — the subset that is genuinely on you right now.
 *   5. Your meetings — upcoming, with one-click scheduling.
 *   6. Worth your time — cross-app recommendations (Gmail·Cal·Notion·Slack).
 *   7. While you were away — what your agents did.
 *
 * Every action is a one-click handoff to Arcus with a prefilled prompt
 * (sessionStorage 'arcus_prefill' → /dashboard/agent-talk), the same proven flow
 * the recommendations already use — so we reuse the real draft/schedule engine
 * rather than reproducing a streaming editor here.
 */

import { useEffect, useMemo, useState, useCallback, useId, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ResponsiveContainer, Cell, Tooltip as RTooltip,
  AreaChart, Area, XAxis,
  PieChart, Pie,
} from 'recharts';
import {
  Sparkles, Mail, Calendar, Clock, ArrowRight, MessageSquare,
  CheckCircle2, Reply, CalendarPlus, Inbox, Zap, ChevronRight, AlertTriangle,
  FileText, Hash, RefreshCw, Quote, Check, Plus, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TokenExpiryAlert } from './token-expiry-alert';
import { ConnectorsModal, SUPPORTED_APPS } from './connectors-modal';

// The dithering shader (WebGL, animates per frame) is the same premium texture
// the landing CTA uses. Lazy + in-view gated so it never renders unseen.
const Dithering = lazy(() =>
  import('@paper-design/shaders-react').then((m) => ({ default: m.Dithering })),
);

// ── Data shapes (mirror /api/home-feed/today + week-activity) ───────────────────
interface DecideItem { id: string; threadId: string; sender: { name: string; email: string }; subject: string; reason: string; receivedAt: string; gmailUrl: string; signals?: string[]; }
interface ChaseItem { id: string; threadId: string; recipient: { name: string; email: string }; subject: string; daysSilent: number; sentAt: string; gmailUrl: string; reason?: string; signals?: string[]; }
interface ShowUpItem { id: string; start: string; end: string | null; title: string; attendeeCount: number; meetLink: string | null; hangoutLink: string | null; isExternal: boolean; reason?: string; }
interface AgentRunItem { id: string; agentName: string; status: string; summary: string | null; toolCalls: number; ranAt: string; artifactCounts: { gmail: number; calendar: number; notion: number; slack: number }; }
interface TodayData {
  decide: DecideItem[]; showUp: ShowUpItem[]; chase: ChaseItem[]; actionItems: any[]; agentRuns: AgentRunItem[]; summary: string | null;
  // The AI triage agent's one-line read of the day ("All quiet — nothing needs
  // you", or "Priya's proposal + the Acme renewal lead"). The route returns this
  // as `briefing`; it's the reliable, specific "Sift says…" line the hero shows
  // when the cross-app recommendations pass (which powers `sift`) is unavailable
  // or rate-limited. Previously the hero read `today.summary`, a field the route
  // never sets — so the agent's briefing never showed and the line fell back to
  // generic filler.
  briefing?: string;
  // DIRECT AI-triage error — set only when the reasons fell to deterministic
  // labels (agent + enrich both failed). Shown on "Needs a reply", never masked.
  aiError?: string;
  // A dead Gmail/Calendar token used to be silently swallowed inside the
  // server's per-source fetchers, so it read as "0 items, inbox handled"
  // instead of "your connection is broken." Live-verified 2026-07-23 against
  // a real expired-token account and fixed server-side; this field is what
  // makes it visible here instead of lying that everything's fine.
  needsReconnect?: { gmail?: boolean; calendar?: boolean };
}
interface WeekDay { date: string; label: string; isToday: boolean; runs: number; actions: number; }
interface WeekData { days: WeekDay[]; totalRuns: number; totalActions: number; hasData: boolean; }
interface Rec { id: string; category: string; title: string; summary: string; arcusPrompt: string; ctaLabel: string; stat: { value: number; label: string }; atRisk?: boolean; }
// Real per-app signal counts from /api/home-feed/recommendations — already
// connection-gated there (a gatherer only ever produces a signal for an app
// with a live token) and toggle-gated by Customize Briefing, so a nonzero
// count here means "connected AND active," never an invented number.
interface AppCounts { gmail: number; calendar: number; notion: number; slack: number; calcom: number; }
// The "Sift says…" ecosystem read — same endpoint, same real items, an extra
// field on the one LLM call already being made (no added cost/latency).
interface SiftSummary { headline: string; analysis: string; }
// What the existing Gmail draft for a thread looks like, handed to the Inbox
// tab's draft-reply box so it can open pre-filled instead of going to Arcus.
interface ExistingDraft { threadId: string; to: string; subject: string; body: string; isHtml: boolean; }

// ── "Your world" — the cross-app synthesis from /api/home-feed/world. A relationship
// rendered as a LIVING thing: its Gmail status fused with the same person's calendar,
// Cal.com, Notion, and Slack signals (joined ONLY by exact email / exact full-name,
// never guessed). This replaced the Gmail-only "Key conversations" scan.
type WorldApp = 'gmail' | 'calendar' | 'notion' | 'slack' | 'calcom';
type RelationshipKind = 'investor' | 'candidate' | 'customer' | 'lead' | 'vendor' | 'press';
interface WorldAppChip { app: WorldApp; label: string; evidence: string; }
interface WorldEntry {
  key: string; name: string; email: string;
  status: ConvoStatus;
  headline: string; whyNow: string; apps: WorldAppChip[];
  kind?: RelationshipKind; receipts?: string[];
  atRisk: boolean; riskScore: number; riskReason?: string;
  daysSince: number; lastActivityIso: string; messageCount: number; nextAction: string;
}
interface WorldData { entities: WorldEntry[]; slipping: WorldEntry[]; appsPresent: WorldApp[]; aiError?: string; error?: string; }

// A person-keyed conversation with its current status. Derived, never invented.
// 'active' = a genuinely ongoing thread that's neither on you nor gone quiet
// (server /api/home-feed/conversations returns this whenever the latest message
// doesn't clear either threshold) — it was missing from this union even though
// the server has always been able to send it, which meant STATUS_META[c.status]
// silently returned undefined and crashed the card. Fixed here.
type ConvoStatus = 'awaiting_you' | 'waiting_on_them' | 'meeting_booked' | 'active';

// ── helpers ─────────────────────────────────────────────────────────────────
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const diff = Date.now() - t;
  const past = diff >= 0;
  const m = Math.abs(diff) / 60000;
  if (m < 60) return past ? `${Math.round(m)}m ago` : `in ${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return past ? `${Math.round(h)}h ago` : `in ${Math.round(h)}h`;
  const d = Math.round(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}
function clockTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Instant-load cache: show the last snapshot the moment the tab paints, then
// revalidate in the background. This is what SiftToday did and I'd dropped —
// the reason the redesign "took too long to load" was a cold wait on the
// server AI triage every single time.
function readCache<T>(k: string): T | null {
  try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; }
}
function writeCache(k: string, v: unknown) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } }

export function CommandCenter({ userName, onOpenExistingDraft }: {
  userName?: string;
  // Passed down from home-feed/page.tsx: switches to the Inbox tab and hands
  // the existing draft to its draft-reply box. Optional so CommandCenter can
  // still render standalone (e.g. in a future test/story) without it.
  onOpenExistingDraft?: (draft: ExistingDraft) => void;
}) {
  const [today, setToday] = useState<TodayData | null>(() => readCache('cc_today'));
  const [week, setWeek] = useState<WeekData | null>(() => readCache('cc_week'));
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [appCounts, setAppCounts] = useState<AppCounts | null>(() => readCache('cc_appcounts'));
  const [sift, setSift] = useState<SiftSummary | null>(() => readCache('cc_sift'));
  // The DIRECT recommendations-AI error (429 / timeout / exhausted chain), shown
  // in place of a masking fallback per founder directive ("no fallbacks on
  // anything in home-feed"). Never cached — an error is a live state, not data.
  const [recsError, setRecsError] = useState<string | null>(null);
  const [world, setWorld] = useState<WorldData | null>(() => readCache('cc_world'));
  const [worldLoading, setWorldLoading] = useState(() => !readCache('cc_world'));
  // Only block on a skeleton when we have NOTHING cached to show.
  const [loading, setLoading] = useState(() => !readCache('cc_today'));
  // Separate from `week`/`appCounts` being null (which is also the genuine
  // "no data" state) — these track whether their fetch has resolved AT LEAST
  // ONCE, so the analytics panel can tell "still loading" apart from
  // "genuinely empty" instead of flashing a false empty state while the
  // request is still in flight.
  const [weekLoaded, setWeekLoaded] = useState(() => !!readCache('cc_week'));
  const [recsLoaded, setRecsLoaded] = useState(() => !!readCache('cc_appcounts') || !!readCache('cc_sift'));
  // Cross-app connection state for the "Your stack" strip. null until the first
  // status fetch resolves (slim skeleton instead of a wrong "0 connected" flash);
  // cached as an array (a Set isn't JSON) so a revisit paints instantly.
  const [connectedApps, setConnectedApps] = useState<Set<string> | null>(() => {
    const c = readCache<string[]>('cc_stack');
    return Array.isArray(c) ? new Set(c) : null;
  });
  const [showConnectors, setShowConnectors] = useState(false);
  const [integrationsNudgeDismissed, setIntegrationsNudgeDismissed] = useState(() => {
    try { return localStorage.getItem('mailient_integrations_nudge_dismissed') === '1'; } catch { return false; }
  });

  const openArcus = useCallback((prompt: string) => {
    // ONE CLICK: open the Arcus command palette (the Ctrl+K panel) right here and
    // auto-send the prompt — no redirect to /dashboard/agent-talk, no manual send.
    // The globally-mounted ArcusCommandPalette listens for this event and does both.
    window.dispatchEvent(new CustomEvent('arcus:submit', { detail: { prompt } }));
  }, []);

  // Force a fresh Today recompute (bypasses the server cache) — the retry behind
  // the "Needs a reply" AI-error card.
  const refetchToday = useCallback(async () => {
    try {
      const r = await fetch('/api/home-feed/today?refresh=1');
      if (r.ok) {
        const j = await r.json();
        if (j?.success !== false) { setToday(j); writeCache('cc_today', j); }
      }
    } catch { /* leave the error card up */ }
  }, []);

  // Force a fresh cross-app world synthesis (bypasses the ::world cache) — the
  // retry behind the "Your world" AI-error card.
  const refetchWorld = useCallback(async () => {
    try {
      const r = await fetch('/api/home-feed/world?refresh=1');
      if (r.ok) { const j = await r.json(); setWorld(j); writeCache('cc_world', j); }
    } catch { /* leave the error card up */ }
  }, []);

  // Which apps are connected — powers the "Your stack" strip. Fail-soft: on any
  // error, resolve to an empty set (strip renders, everything shows connectable)
  // rather than leaving the strip stuck on its skeleton.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/integrations/status');
        if (!r.ok) { if (alive) setConnectedApps(prev => prev ?? new Set()); return; }
        const j = await r.json();
        const set = new Set<string>((j?.integrations || []).filter((i: any) => i?.connected).map((i: any) => String(i.provider)));
        if (alive) { setConnectedApps(set); writeCache('cc_stack', [...set]); }
      } catch { if (alive) setConnectedApps(prev => prev ?? new Set()); }
    })();
    return () => { alive = false; };
  }, []);

  const needsIntegrationsNudge = useMemo(() => {
    if (integrationsNudgeDismissed || !connectedApps) return false;
    const hasNotion = connectedApps.has('notion');
    const hasSlack = connectedApps.has('slack');
    return !hasNotion || !hasSlack;
  }, [connectedApps, integrationsNudgeDismissed]);

  const dismissIntegrationsNudge = useCallback(() => {
    setIntegrationsNudgeDismissed(true);
    try { localStorage.setItem('mailient_integrations_nudge_dismissed', '1'); } catch { /* */ }
  }, []);

  // "Needs a reply" → Draft reply: check for an already-existing Gmail draft on
  // this thread FIRST. If one exists, this is NOT an Arcus job — hand it to the
  // Inbox tab's own draft-reply box (pre-filled, ready to review/send) instead
  // of sending a redundant "draft a reply" prompt to Arcus, which would either
  // duplicate the draft or confuse the user about which one is current. Fails
  // soft to the normal Arcus prompt on any error/timeout/missing callback.
  const handleDraftReply = useCallback(async (d: DecideItem) => {
    const prompt = `Draft a reply to ${d.sender.name || d.sender.email} about "${d.subject}". Read the thread first, then write it in my voice.`;
    if (onOpenExistingDraft) {
      try {
        const res = await fetch(`/api/gmail/drafts/for-thread?threadId=${encodeURIComponent(d.threadId)}`, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const j = await res.json();
          if (j?.exists) {
            onOpenExistingDraft({ threadId: d.threadId, to: j.to || '', subject: j.subject || d.subject, body: j.body || '', isHtml: !!j.isHtml });
            return;
          }
        }
      } catch { /* fall through to Arcus */ }
    }
    openArcus(prompt);
  }, [onOpenExistingDraft, openArcus]);

  // Refresh BOTH sources the analytics panel actually draws from: week-activity
  // (the area chart / spark tiles / radar) AND recommendations (the donut +
  // Sift text). The old version only re-fetched week-activity — the donut and
  // Sift could never be refreshed at all, which is exactly the "the analytics
  // never seem to actually redo the AI work" bug. Reuses the current `today`
  // snapshot as recommendations' input (this button refreshes analytics, not
  // the whole feed — Needs a Reply/Key Conversations have their own data).
  const [analyticsRefreshing, setAnalyticsRefreshing] = useState(false);
  const refreshAnalytics = useCallback(async () => {
    setAnalyticsRefreshing(true);
    try {
      const [w, r] = await Promise.allSettled([
        fetch('/api/home-feed/week-activity').then(res => res.ok ? res.json() : null),
        today
          ? fetch('/api/home-feed/recommendations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ decide: today.decide, chase: today.chase, actionItems: today.actionItems, showUp: today.showUp }),
            }).then(res => res.ok ? res.json() : null)
          : Promise.resolve(null),
      ]);
      if (w.status === 'fulfilled' && w.value) { setWeek(w.value); writeCache('cc_week', w.value); }
      setWeekLoaded(true);
      if (r.status === 'fulfilled' && r.value) {
        const j = r.value;
        setRecsError(j?.error || null);
        setRecs(Array.isArray(j?.recommendations) ? j.recommendations : []);
        if (j?.appCounts) { setAppCounts(j.appCounts); writeCache('cc_appcounts', j.appCounts); }
        setSift(j?.sift || null);
        if (j?.sift) writeCache('cc_sift', j.sift);
      } else {
        setRecsError('Recommendations refresh failed.');
      }
      setRecsLoaded(true);
    } finally {
      setAnalyticsRefreshing(false);
    }
  }, [today]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [t, w] = await Promise.allSettled([
        fetch('/api/home-feed/today').then(r => r.ok ? r.json() : null),
        fetch('/api/home-feed/week-activity').then(r => r.ok ? r.json() : null),
      ]);
      if (!alive) return;
      if (t.status === 'fulfilled' && t.value?.success !== false && t.value) { setToday(t.value); writeCache('cc_today', t.value); }
      if (w.status === 'fulfilled' && w.value) { setWeek(w.value); writeCache('cc_week', w.value); }
      setWeekLoaded(true);
      setLoading(false);
    })();
    // The cross-app WORLD synthesis runs on its own timeline (cached server-side),
    // so it never blocks the hero/stats. Its own skeleton covers the wait.
    (async () => {
      try {
        const r = await fetch('/api/home-feed/world');
        if (alive && r.ok) {
          const j = await r.json();
          setWorld(j); writeCache('cc_world', j);
        }
      } catch { /* keep cached */ }
      finally { if (alive) setWorldLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  // Recommendations depend on today's pools, so fire once today is in.
  useEffect(() => {
    if (!today) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/home-feed/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decide: today.decide, chase: today.chase,
            actionItems: today.actionItems, showUp: today.showUp,
          }),
        });
        if (!alive) return;
        if (res.ok) {
          const j = await res.json();
          // Surface the DIRECT AI error (no masking fallback) — see recsError.
          setRecsError(j?.error || null);
          setRecs(Array.isArray(j?.recommendations) ? j.recommendations : []);
          if (j?.appCounts) { setAppCounts(j.appCounts); writeCache('cc_appcounts', j.appCounts); }
          setSift(j?.sift || null);
          if (j?.sift) writeCache('cc_sift', j.sift);
        } else {
          setRecsError(`Recommendations request failed (HTTP ${res.status})`);
          setRecs([]);
        }
      } catch (e) { if (alive) { setRecs([]); setRecsError(`Recommendations request failed — ${String((e as any)?.message || 'network error')}`); } }
      finally { if (alive) setRecsLoaded(true); }
    })();
    return () => { alive = false; };
  }, [today]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }, []);
  const dateLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  );

  // ── The four headline stats — the state of the USER'S world, not Mailient's
  // activity. "handled for you" (an agent-activity metric) was dropped from the
  // hero (it's now the demoted "Handled quietly" strip at the bottom) and
  // replaced with the founder's own open commitments — the things on their plate.
  const stats = useMemo(() => {
    return {
      reply: today?.decide.length || 0,       // emails waiting on your reply
      meetings: today?.showUp.length || 0,     // meetings coming up
      awaiting: today?.chase.length || 0,      // people YOU'RE waiting on
      toClose: today?.actionItems?.length || 0, // your open commitments / to-dos
    };
  }, [today]);

  // ── Time intelligence (Phase 4) — a real read of the founder's day, computed
  // from their actual calendar events: how much of today is meetings, whether
  // they're stacked back-to-back, and how many are external. All derived, no AI.
  const meetingIntel = useMemo(() => {
    const items = today?.showUp || [];
    const start0 = new Date(); start0.setHours(0, 0, 0, 0);
    const end0 = new Date(start0); end0.setDate(end0.getDate() + 1);
    const todays = items.filter(m => { const s = new Date(m.start).getTime(); return s >= start0.getTime() && s < end0.getTime(); });
    let mins = 0;
    for (const m of todays) {
      if (!m.end) continue;
      const d = (new Date(m.end).getTime() - new Date(m.start).getTime()) / 60000;
      if (d > 0 && d < 600) mins += d;
    }
    const sorted = [...todays].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    let backToBack = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].end ? new Date(sorted[i - 1].end as string).getTime() : 0;
      const curStart = new Date(sorted[i].start).getTime();
      if (prevEnd && curStart - prevEnd <= 5 * 60000) backToBack++;
    }
    return {
      today: todays.length,
      hours: mins / 60,
      backToBack,
      external: items.filter(m => m.isExternal).length,
    };
  }, [today]);

  const meetingsSub = useMemo(() => {
    const parts: string[] = [];
    if (meetingIntel.today > 0) {
      parts.push(`${meetingIntel.today} today`);
      if (meetingIntel.hours >= 0.5) parts.push(`${meetingIntel.hours.toFixed(1)}h in meetings`);
      if (meetingIntel.backToBack > 0) parts.push(`${meetingIntel.backToBack} back-to-back`);
    }
    if (meetingIntel.external > 0) parts.push(`${meetingIntel.external} external`);
    return parts.length ? parts.join(' · ') : 'Upcoming';
  }, [meetingIntel]);

  const worldEntities = world?.entities || [];
  const slipping = world?.slipping || [];

  if (loading) return <CommandCenterSkeleton />;

  const nothingPressing = stats.reply === 0 && stats.meetings === 0 && stats.awaiting === 0;
  // Overdue commitments push the 4th tile to "attn" tone — an overdue promise is
  // exactly the kind of thing loss-aversion says should visually stand out.
  const overdueCount = (today?.actionItems || []).filter((a: any) => a?.isOverdue).length;
  // A dead token used to be indistinguishable from a genuinely empty, handled
  // inbox — same 0/0/0 stats either way. This makes the difference visible
  // instead of telling the user "you're all set" when nothing could load.
  const gmailNeedsReconnect = !!today?.needsReconnect?.gmail;
  const calendarNeedsReconnect = !!today?.needsReconnect?.calendar;
  const hasReconnectIssue = gmailNeedsReconnect || calendarNeedsReconnect;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 space-y-8">
      {hasReconnectIssue && (
        <div className="-mx-4 sm:-mx-6 -mt-6">
          <TokenExpiryAlert
            isVisible={hasReconnectIssue}
            gmailNeedsReconnect={gmailNeedsReconnect}
            calendarNeedsReconnect={calendarNeedsReconnect}
            returnTo="/home-feed"
          />
        </div>
      )}
      {/* 1 ── HERO — greeting + Sift line + world stats, over a faint dither
          texture (the premium accent, in-view gated + reduced-motion safe). ─── */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="relative -mx-2 px-2 py-3 sm:-mx-4 sm:px-4">
        <DitherAmbient />
        <div className="relative z-10">
        <p className="text-[13px] font-medium text-arcus-fg-tertiary">{dateLabel}</p>
        <h1 className="mt-1 text-[28px] sm:text-[34px] font-semibold tracking-tight text-arcus-fg">
          {greeting}{userName ? `, ${userName}` : ''}.
        </h1>
        <div className="mt-2 max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-arcus-fg-tertiary">Sift says…</p>
          <p className="mt-1 text-[15px] font-medium leading-relaxed text-arcus-fg">
            {hasReconnectIssue
              ? `Your ${[gmailNeedsReconnect && 'Gmail', calendarNeedsReconnect && 'Calendar'].filter(Boolean).join(' and ')} connection expired — reconnect above to see what actually needs you.`
              : sift?.headline
                ? sift.headline
                : recsError
                  // FOUNDER DIRECTIVE — surface the DIRECT AI error, never a masking
                  // fallback. (The today agent's briefing still powers the reasons
                  // below; here we show why "Sift says…" itself couldn't run.)
                  ? <span className="text-rose-600 dark:text-rose-400">AI error — {recsError}</span>
                  : today?.briefing?.trim()
                    || (nothingPressing
                      ? 'Nothing needs you right now — your inbox is handled.'
                      : 'Here’s what deserves your attention today.')}
          </p>
          {/* The full 3-4 line read of the founder's table today — the point of
              "Sift says…". Loads a beat after the headline (rides the recs call),
              so the hero never shows a gap while waiting. */}
          {sift?.analysis && (
            <p className="mt-2 text-[14px] leading-[1.6] text-arcus-fg-secondary">{sift.analysis}</p>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatTile icon={<Reply className="w-4 h-4" />} value={stats.reply} label="need a reply" tone={stats.reply > 0 ? 'attn' : 'calm'} />
          <StatTile icon={<Calendar className="w-4 h-4" />} value={stats.meetings} label={stats.meetings === 1 ? 'meeting' : 'meetings'} tone="calm" />
          <StatTile icon={<Clock className="w-4 h-4" />} value={stats.awaiting} label="awaiting reply" tone="calm" />
          <StatTile icon={<CheckCircle2 className="w-4 h-4" />} value={stats.toClose} label="to close" tone={overdueCount > 0 ? 'attn' : 'calm'} />
        </div>
        </div>
      </motion.section>

      {needsIntegrationsNudge && (
        <div className="arcus-glass-card rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-arcus-fg tracking-tight">Connect Slack &amp; Notion when you’re ready</p>
            <p className="text-[12.5px] text-arcus-fg-secondary mt-0.5 leading-relaxed">
              Optional — briefings in Slack, deals and notes in Notion. Skip anytime; you can always connect from Your stack.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={dismissIntegrationsNudge}
              className="h-9 px-3.5 rounded-xl border border-arcus-border text-[12.5px] font-medium text-arcus-fg-tertiary hover:text-arcus-fg hover:bg-arcus-surface-hover transition-colors"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => setShowConnectors(true)}
              className="h-9 px-3.5 rounded-xl bg-arcus-fg text-arcus-fg-inverse text-[12.5px] font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
            >
              Connect <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 1.5 ── YOUR STACK — cross-app connection surface. Makes the fusion
          VISIBLE and one tap away: connected apps light up, the rest invite a
          connect. Skeleton until the status fetch resolves. ────────────────── */}
      {connectedApps
        ? <YourStack connected={connectedApps} onManage={() => setShowConnectors(true)} />
        : <div className="arcus-glass-card rounded-2xl h-[104px] animate-pulse" />}

      {/* 2 ── WHAT'S SLIPPING — the loss-aversion lane. What's genuinely at risk
          ACROSS every app, ranked by cost-to-miss. A founder loses deals by never
          SEEING them; this is the one thing a home can do that matters most. ─── */}
      {slipping.length > 0 && (
        <Section title="What’s slipping" sub="At risk across your apps — ranked by what it costs to miss">
          <div className="space-y-2">
            {slipping.slice(0, 4).map(e => (
              <SlippingRow key={e.key} e={e} onHandle={() => openArcus(e.nextAction)} />
            ))}
          </div>
        </Section>
      )}

      {/* 3 ── YOUR WORLD RIGHT NOW — the cross-app relationship spine (replaced
          the Gmail-only "Key conversations"). Each card is one person/company as
          a LIVING thing: their email status FUSED with the same person's
          calendar, Cal.com, Notion & Slack signals. ────────────────────────── */}
      {worldEntities.length > 0 ? (
        <Section title="Your world right now" sub={worldSubline(world)}>
          {world?.aiError && <div className="mb-2.5"><FeedErrorCard message={world.aiError} onRetry={refetchWorld} /></div>}
          <div className="grid sm:grid-cols-2 gap-2.5">
            {worldEntities.map(e => (
              <WorldCard key={e.key} e={e} onHandle={() => openArcus(e.nextAction)} />
            ))}
          </div>
        </Section>
      ) : worldLoading ? (
        <Section title="Your world right now" sub="Reading across your connected apps…">
          <div className="grid sm:grid-cols-2 gap-2.5">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-32 rounded-2xl bg-arcus-surface animate-pulse" />)}
          </div>
        </Section>
      ) : world?.error ? (
        <Section title="Your world right now" sub="Across your connected apps">
          <FeedErrorCard message={world.error} onRetry={refetchWorld} />
        </Section>
      ) : null}

      {/* 4 ── NEEDS A REPLY ─────────────────────────────────────────────────── */}
      {today && (today.decide.length > 0 || today.aiError) && (
        <Section title="Needs a reply" sub="On you right now">
          {today.aiError && (
            <div className="mb-2.5">
              <FeedErrorCard message={today.aiError} onRetry={refetchToday} />
            </div>
          )}
          <div className="space-y-2">
            {today.decide.slice(0, 5).map(d => (
              <ReplyRow
                key={d.id}
                who={d.sender.name || d.sender.email}
                subject={d.subject}
                reason={d.reason}
                when={relTime(d.receivedAt)}
                signals={d.signals}
                onDraft={() => handleDraftReply(d)}
                onOpen={() => window.open(d.gmailUrl, '_blank')}
              />
            ))}
          </div>
        </Section>
      )}

      {/* 5 ── ON YOUR PLATE — the founder's own commitments (Phase 4). What THEY
          promised, from their meeting notes — tracked with due dates + overdue.
          The hero's "to close" number, made real and actionable. ────────────── */}
      {today && today.actionItems.length > 0 && (
        <Section title="On your plate" sub="Commitments you made — from your meetings">
          <div className="space-y-2">
            {today.actionItems.slice(0, 6).map((a: any) => (
              <CommitmentRow
                key={a.id}
                item={a}
                onDo={() => openArcus(`Help me handle this commitment: "${a.text}"${a.meetingTitle ? ` (from my "${a.meetingTitle}" meeting)` : ''}. Suggest the next step and draft anything needed.`)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* 6 ── YOUR MEETINGS (with time-intelligence sub-line, Phase 4) ────────── */}
      {today && today.showUp.length > 0 && (
        <Section
          title="Your meetings"
          sub={meetingsSub}
          action={{ label: 'Schedule something', onClick: () => openArcus('Find a free 30-minute slot this week and schedule a meeting. Ask me who with and what about.') }}
        >
          <div className="space-y-2">
            {today.showUp.slice(0, 5).map(m => (
              <MeetingRow
                key={m.id}
                title={m.title}
                start={m.start}
                attendeeCount={m.attendeeCount}
                isExternal={m.isExternal}
                meetLink={m.meetLink || m.hangoutLink}
                onPrep={() => openArcus(`Prep me for "${m.title}". Pull recent email and calendar context on the attendees.`)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* 7 ── WORTH YOUR TIME (cross-app) ───────────────────────────────────── */}
      {recsError ? (
        <Section title="Worth your time" sub="Across Gmail, Calendar, Notion & Slack">
          <FeedErrorCard message={recsError} onRetry={refreshAnalytics} />
        </Section>
      ) : recs && recs.length > 0 ? (
        <Section title="Worth your time" sub="Across Gmail, Calendar, Notion & Slack">
          <div className="grid sm:grid-cols-2 gap-2.5">
            {recs.slice(0, 4).map(r => (
              <RecCard key={r.id} r={r} onDo={() => openArcus(r.arcusPrompt)} />
            ))}
          </div>
        </Section>
      ) : null}

      {/* 8 ── HANDLED QUIETLY (demoted agent-activity footer) ──────────────────
          FRAME FLIP: this used to be TWO headline sections ("Your week" analytics
          + "While you were away") reporting what MAILIENT did — making the tool
          the protagonist of its own user's home. Founder feedback: "displays
          tasks completed by Mailient rather than those performed by the user."
          Collapsed to one quiet, honest reassurance line by default; the same
          rich analytics (KPI pills, chart, cross-app donut) still live one click
          away for anyone who wants them — nothing was deleted, just demoted. ─── */}
      <HandledQuietlyStrip
        week={week}
        weekLoaded={weekLoaded}
        appCounts={appCounts}
        recsLoaded={recsLoaded}
        recsError={recsError}
        refreshing={analyticsRefreshing}
        onRefresh={refreshAnalytics}
        onSchedule={() => openArcus('Set up a scheduled agent that gives me a morning briefing every weekday at 8am.')}
        agentRuns={today?.agentRuns || []}
      />

      {/* The connect flow itself — opened from the "Your stack" strip. Self-
          contained (handles its own OAuth redirects + status). On close, refetch
          status so a just-connected app flips to "connected" without a reload. */}
      <ConnectorsModal
        isOpen={showConnectors}
        onClose={() => {
          setShowConnectors(false);
          fetch('/api/integrations/status')
            .then(r => r.ok ? r.json() : null)
            .then(j => {
              if (!j?.integrations) return;
              const set = new Set<string>(j.integrations.filter((i: any) => i?.connected).map((i: any) => String(i.provider)));
              setConnectedApps(set);
              writeCache('cc_stack', [...set]);
            })
            .catch(() => {});
        }}
      />
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

// Direct-error card — shown in place of a masking fallback whenever a home-feed
// AI call fails (founder directive: "no fallbacks on anything in home-feed").
// Renders the real error text + a retry, so a 429 / timeout / exhausted chain is
// visible instead of hidden behind plausible filler.
function FeedErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-4 flex items-start gap-3">
      <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-rose-600 dark:text-rose-400">AI error</p>
        <p className="text-[12.5px] text-arcus-fg-secondary mt-0.5 break-words leading-relaxed">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-arcus-border text-[12px] font-medium text-arcus-fg-secondary hover:bg-arcus-surface-hover transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      )}
    </div>
  );
}

function Section({ title, sub, action, children }: { title: string; sub?: string; action?: { label: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.4 }}>
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-arcus-fg">{title}</h2>
          {sub && <p className="text-[12.5px] text-arcus-fg-tertiary mt-0.5">{sub}</p>}
        </div>
        {action && (
          <button onClick={action.onClick} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-arcus-fg-secondary hover:text-arcus-fg transition-colors">
            {action.label} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {children}
    </motion.section>
  );
}

function StatTile({ icon, value, label, tone }: { icon: React.ReactNode; value: number; label: string; tone: 'attn' | 'calm' | 'good' }) {
  return (
    <div className="rounded-2xl arcus-glass-card px-4 py-3.5">
      <div className={cn(
        'inline-flex items-center justify-center w-8 h-8 rounded-xl mb-2',
        tone === 'attn' ? 'bg-amber-500/10 text-amber-500'
          : tone === 'good' ? 'bg-emerald-500/10 text-emerald-500'
            : 'bg-arcus-elevated text-arcus-fg-tertiary',
      )}>
        {icon}
      </div>
      <div className="text-[26px] font-semibold tracking-tight text-arcus-fg tabular-nums leading-none">{value}</div>
      <div className="text-[12px] text-arcus-fg-tertiary mt-1">{label}</div>
    </div>
  );
}

// Status → { badge classes, solid bar-fill class, label, icon }. One entry per
// value the server or the derived fallback can actually produce — `active` was
// missing even though /api/home-feed/conversations has always been able to
// return it, so any card in that state hit STATUS_META[undefined] and crashed
// the section. `fill` is the SAME hue as the badge (never a second palette) so
// the pulse chart and the cards below it read as one system.
const STATUS_META: Record<ConvoStatus, { label: string; cls: string; fill: string; Icon: any }> = {
  awaiting_you: { label: 'Awaiting your reply', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', fill: 'bg-amber-500', Icon: Reply },
  waiting_on_them: { label: 'Waiting on them', cls: 'bg-arcus-elevated text-arcus-fg-tertiary border-arcus-border', fill: 'bg-arcus-fg-muted', Icon: Clock },
  meeting_booked: { label: 'Meeting booked', cls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20', fill: 'bg-indigo-500', Icon: Calendar },
  active: { label: 'Active thread', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20', fill: 'bg-blue-500', Icon: MessageSquare },
};
// Per-app chip metadata — the icon + accent that renders each fused cross-app
// signal on a world card. This is what makes "email quiet 8d · meets Thu · Slack
// waiting" read as one relationship living across the founder's whole stack.
const WORLD_APP_META: Record<WorldApp, { Icon: any; label: string; varName: string }> = {
  gmail:    { Icon: Mail,         label: 'Gmail',    varName: '--arcus-chart-blue' },
  calendar: { Icon: Calendar,     label: 'Calendar', varName: '--arcus-chart-green' },
  calcom:   { Icon: CalendarPlus, label: 'Cal.com',  varName: '--arcus-chart-aqua' },
  notion:   { Icon: FileText,     label: 'Notion',   varName: '--arcus-chart-magenta' },
  slack:    { Icon: Hash,         label: 'Slack',    varName: '--arcus-chart-yellow' },
};
const APP_ORDER: WorldApp[] = ['gmail', 'calendar', 'calcom', 'notion', 'slack'];

// Relationship-kind badge styling. The kind itself is inferred server-side ONLY
// from a clear keyword signal in the real thread (never a name), so a badge is a
// fact the founder can trust — it tells them what this person is at a glance.
const KIND_META: Record<RelationshipKind, { label: string; cls: string }> = {
  investor:  { label: 'Investor',  cls: 'bg-violet-500/12 text-violet-600 dark:text-violet-300 border-violet-500/25' },
  candidate: { label: 'Candidate', cls: 'bg-sky-500/12 text-sky-600 dark:text-sky-300 border-sky-500/25' },
  customer:  { label: 'Customer',  cls: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300 border-emerald-500/25' },
  lead:      { label: 'Lead',      cls: 'bg-teal-500/12 text-teal-600 dark:text-teal-300 border-teal-500/25' },
  vendor:    { label: 'Vendor',    cls: 'bg-slate-500/12 text-slate-600 dark:text-slate-300 border-slate-500/25' },
  press:     { label: 'Press',     cls: 'bg-pink-500/12 text-pink-600 dark:text-pink-300 border-pink-500/25' },
};

// The verbatim quote that proves the insight — the actual ask/promise/number
// pulled from the real message body. Rendered as a subtle receipt so the founder
// sees what was *said*, not a paraphrase. Empty bodies simply render nothing.
function ReceiptQuote({ text }: { text: string }) {
  return (
    <div className="mt-2.5 flex gap-2 rounded-xl bg-arcus-elevated/70 border border-arcus-border/70 px-2.5 py-2">
      <Quote className="w-3.5 h-3.5 text-arcus-fg-muted shrink-0 mt-[1px]" />
      <p className="text-[12px] text-arcus-fg-secondary italic leading-relaxed line-clamp-2">{text}</p>
    </div>
  );
}

// ── Dither ambient — a slow, faint, in-view-gated WebGL texture behind the hero.
// The premium "dither" accent, kept low-opacity + slow so it reads as texture,
// not motion. Honors prefers-reduced-motion by simply never mounting the shader,
// and unmounts when scrolled away so it never animates unseen ([[landing-perf]]).
function DitherAmbient() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} aria-hidden className="absolute inset-0 z-0 overflow-hidden rounded-3xl pointer-events-none">
      {active && (
        <Suspense fallback={null}>
          <div
            className="absolute -inset-x-[15%] -top-[60%] h-[240%] opacity-[0.07] dark:opacity-[0.12]"
            style={{
              maskImage: 'radial-gradient(115% 85% at 12% 25%, #000 0%, #000 38%, transparent 74%)',
              WebkitMaskImage: 'radial-gradient(115% 85% at 12% 25%, #000 0%, #000 38%, transparent 74%)',
            }}
          >
            <Dithering colorBack="#00000000" colorFront="#6f6f6f" shape="warp" type="4x4" speed={0.06} className="size-full" minPixelRatio={1} />
          </div>
        </Suspense>
      )}
    </div>
  );
}

// ── Your stack — the cross-app connection surface. It makes the fusion VISIBLE:
// which apps are wired into your world (full-color, checked) and which aren't
// (dimmed, one tap to connect). This is what turns a Gmail-only feed into a
// whole-workday command center — connect Calendar/Notion/Slack/Meet/Cal.com and
// the world cards start fusing those people's signals. One tap opens the modal.
const STACK_APP_IDS = ['gmail', 'google_calendar', 'google_meet', 'notion', 'slack', 'cal_com'];

function YourStack({ connected, onManage }: { connected: Set<string>; onManage: () => void }) {
  const apps = STACK_APP_IDS
    .map(id => SUPPORTED_APPS.find(a => a.id === id))
    .filter(Boolean) as typeof SUPPORTED_APPS;
  const count = apps.filter(a => connected.has(a.id)).length;
  const all = count === apps.length;
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.4 }}>
      <div className="arcus-glass-card rounded-2xl p-4 sm:p-[18px]">
        <div className="flex items-center justify-between gap-3 mb-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-arcus-elevated text-arcus-fg-tertiary shrink-0">
              <Layers className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[14.5px] font-semibold tracking-tight text-arcus-fg leading-tight">Your stack</h2>
              <p className="text-[12px] text-arcus-fg-tertiary leading-tight mt-0.5">
                {all ? 'Every app is fused into your world' : `${count} of ${apps.length} connected · connect more to see your whole world fuse`}
              </p>
            </div>
          </div>
          <button onClick={onManage} className="shrink-0 inline-flex items-center gap-1 text-[12.5px] font-medium text-arcus-fg-secondary hover:text-arcus-fg transition-colors">
            Manage <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {apps.map(app => {
            const on = connected.has(app.id);
            const Icon = app.icon as any;
            return (
              <button
                key={app.id}
                onClick={onManage}
                title={on ? `${app.name} — connected` : `Connect ${app.name}`}
                className={cn(
                  'group inline-flex items-center gap-2 h-9 pl-2.5 pr-2.5 rounded-xl border transition-all duration-200',
                  on
                    ? 'border-arcus-border bg-arcus-elevated/60'
                    : 'border-arcus-border/60 hover:bg-arcus-elevated/40 hover:border-arcus-fg-muted/40 hover:-translate-y-px',
                )}
              >
                <span className={cn('inline-flex items-center justify-center w-[18px] h-[18px] shrink-0 transition-all', on ? '' : 'grayscale opacity-40 group-hover:opacity-70')}>
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <span className={cn('text-[12.5px] font-medium', on ? 'text-arcus-fg' : 'text-arcus-fg-tertiary')}>{app.name}</span>
                {on
                  ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" strokeWidth={2.5} />
                  : <Plus className="w-3.5 h-3.5 text-arcus-fg-muted shrink-0 group-hover:text-arcus-fg-tertiary" />}
              </button>
            );
          })}
        </div>
      </div>
    </motion.section>
  );
}

// "Across Gmail, Calendar & Notion" — the honest sub-line naming ONLY the apps
// that actually contributed a fused signal this pass (connection- + activity-gated).
function worldSubline(world: WorldData | null): string {
  const present = (world?.appsPresent || []).filter(a => a in WORLD_APP_META);
  const names = APP_ORDER.filter(a => present.includes(a)).map(a => WORLD_APP_META[a].label);
  if (names.length <= 1) return 'Where each relationship stands right now';
  const last = names.pop();
  return `Fused across ${names.join(', ')} & ${last}`;
}

// A single cross-app fusion chip (an app icon + a short real-fact label). The
// full evidence line rides in `title` so a hover confirms exactly why it's here.
function AppChip({ chip }: { chip: WorldAppChip }) {
  const meta = WORLD_APP_META[chip.app];
  if (!meta) return null;
  const Icon = meta.Icon;
  return (
    <span
      title={chip.evidence}
      className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-arcus-elevated border border-arcus-border text-arcus-fg-tertiary"
    >
      <Icon className="w-3 h-3 shrink-0" style={{ color: `var(${meta.varName})` }} />
      {chip.label}
    </span>
  );
}

// A world card — one person/company as a LIVING relationship: status, what it's
// about, the AI "why now" line, and the fused cross-app chips. The whole card
// hands its next move to Arcus on click.
function WorldCard({ e, onHandle }: { e: WorldEntry; onHandle: () => void }) {
  const s = STATUS_META[e.status];
  const kind = e.kind ? KIND_META[e.kind] : null;
  // Gmail status is already the pill + whyNow — showing only the CROSS-app chips
  // keeps the card about fusion, not a restatement of the email row.
  const chips = e.apps.filter(c => c.app !== 'gmail').sort((a, b) => APP_ORDER.indexOf(a.app) - APP_ORDER.indexOf(b.app));
  const receipt = e.receipts?.[0];
  return (
    <button
      onClick={onHandle}
      className={cn(
        'group text-left rounded-2xl arcus-glass-card arcus-glass-hover p-4',
        e.atRisk && 'ring-1 ring-rose-500/30',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[14px] font-semibold text-arcus-fg truncate">{e.name}</span>
          {kind && (
            <span className={cn('shrink-0 px-1.5 py-0.5 rounded-md border text-[9.5px] font-semibold uppercase tracking-wide', kind.cls)}>
              {kind.label}
            </span>
          )}
        </div>
        {e.atRisk ? (
          <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20">
            <AlertTriangle className="w-3 h-3" /> at risk
          </span>
        ) : (
          <span className={cn('shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] font-medium', s.cls)}>
            <s.Icon className="w-3 h-3" /> {s.label}
          </span>
        )}
      </div>
      <p className="text-[13px] text-arcus-fg-secondary line-clamp-1 mb-1">{e.headline}</p>
      <p className="text-[12.5px] text-arcus-fg-tertiary line-clamp-2 leading-relaxed">{e.whyNow}</p>
      {receipt && <ReceiptQuote text={receipt} />}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {chips.map((c, i) => <AppChip key={`${c.app}-${i}`} chip={c} />)}
        </div>
      )}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[11px] text-arcus-fg-muted">{e.messageCount} msg{e.messageCount === 1 ? '' : 's'} · {relTime(e.lastActivityIso)}</span>
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-arcus-fg-tertiary group-hover:text-arcus-fg transition-colors">
          Handle it <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </button>
  );
}

// A "What's slipping" row — an at-risk relationship, its cost-to-miss reason
// front and center, the fused apps behind it, one click to act.
function SlippingRow({ e, onHandle }: { e: WorldEntry; onHandle: () => void }) {
  const kind = e.kind ? KIND_META[e.kind] : null;
  const chips = e.apps.filter(c => c.app !== 'gmail').sort((a, b) => APP_ORDER.indexOf(a.app) - APP_ORDER.indexOf(b.app));
  const receipt = e.receipts?.[0];
  return (
    <div className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.07] backdrop-blur-xl p-4 flex items-start gap-3 shadow-[0_16px_40px_-24px_rgba(225,29,72,0.25)]">
      <div className="w-9 h-9 rounded-xl bg-rose-500/10 flex items-center justify-center shrink-0 text-rose-500">
        <AlertTriangle className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[14px] font-semibold text-arcus-fg truncate">{e.name}</span>
            {kind && (
              <span className={cn('shrink-0 px-1.5 py-0.5 rounded-md border text-[9.5px] font-semibold uppercase tracking-wide', kind.cls)}>
                {kind.label}
              </span>
            )}
          </div>
          <span className="text-[11px] text-rose-600 dark:text-rose-400 font-medium shrink-0">at risk</span>
        </div>
        <p className="text-[12.5px] text-arcus-fg-secondary mt-0.5 line-clamp-2 leading-relaxed">
          {e.riskReason ? e.riskReason.replace(/^[^:]+:\s*/, '') : e.whyNow}
        </p>
        {receipt && <ReceiptQuote text={receipt} />}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {chips.map((c, i) => <AppChip key={`${c.app}-${i}`} chip={c} />)}
          </div>
        )}
        <div className="flex items-center gap-2 mt-2.5">
          <button onClick={onHandle} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-arcus-fg text-arcus-fg-inverse text-[12.5px] font-semibold hover:opacity-90 transition-opacity">
            <Zap className="w-3.5 h-3.5" /> Handle it
          </button>
        </div>
      </div>
    </div>
  );
}

function ReplyRow({ who, subject, reason, when, signals, onDraft, onOpen }: { who: string; subject: string; reason: string; when: string; signals?: string[]; onDraft: () => void; onOpen: () => void }) {
  return (
    <div className="rounded-2xl arcus-glass-card p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl bg-arcus-elevated flex items-center justify-center shrink-0 text-arcus-fg-tertiary">
        <Mail className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-semibold text-arcus-fg truncate">{who}</span>
          <span className="text-[11.5px] text-arcus-fg-muted shrink-0">{when}</span>
        </div>
        <p className="text-[13px] text-arcus-fg-secondary truncate">{subject}</p>
        {reason && <p className="text-[12.5px] text-arcus-fg-tertiary mt-1 line-clamp-2 leading-relaxed">{reason}</p>}
        {signals && signals.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {signals.slice(0, 3).map((s, i) => (
              <span key={i} className="text-[10.5px] px-2 py-0.5 rounded-full bg-arcus-elevated text-arcus-fg-tertiary border border-arcus-border">{s}</span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 mt-2.5">
          <button onClick={onDraft} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-arcus-fg text-arcus-fg-inverse text-[12.5px] font-semibold hover:opacity-90 transition-opacity">
            <Reply className="w-3.5 h-3.5" /> Draft reply
          </button>
          <button onClick={onOpen} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-arcus-border text-arcus-fg-secondary text-[12.5px] font-medium hover:bg-arcus-surface-hover transition-colors">
            Open thread
          </button>
        </div>
      </div>
    </div>
  );
}

function MeetingRow({ title, start, attendeeCount, isExternal, meetLink, onPrep }: { title: string; start: string; attendeeCount: number; isExternal: boolean; meetLink: string | null; onPrep: () => void }) {
  return (
    <div className="rounded-2xl arcus-glass-card p-4 flex items-center gap-3">
      <div className="flex flex-col items-center justify-center w-14 shrink-0">
        <span className="text-[15px] font-semibold text-arcus-fg tabular-nums leading-none">{clockTime(start)}</span>
        <span className="text-[10.5px] text-arcus-fg-muted mt-1">{relTime(start)}</span>
      </div>
      <div className="w-px self-stretch bg-arcus-border" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-arcus-fg truncate">{title}</p>
        <p className="text-[12px] text-arcus-fg-tertiary mt-0.5">
          {attendeeCount} attendee{attendeeCount === 1 ? '' : 's'}{isExternal ? ' · external' : ''}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {meetLink && (
          <a href={meetLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-arcus-border text-arcus-fg-secondary text-[12.5px] font-medium hover:bg-arcus-surface-hover transition-colors">
            Join
          </a>
        )}
        <button onClick={onPrep} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-arcus-fg text-arcus-fg-inverse text-[12.5px] font-semibold hover:opacity-90 transition-opacity">
          <Zap className="w-3.5 h-3.5" /> Prep me
        </button>
      </div>
    </div>
  );
}

// A commitment the founder made (from meeting notes) — real text, due date /
// overdue flag, the meeting it came from, and one click to hand it to Arcus.
function CommitmentRow({ item, onDo }: { item: any; onDo: () => void }) {
  const due = item?.dueAt ? new Date(item.dueAt) : null;
  const dueLabel = due && !isNaN(due.getTime()) ? due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  const overdue = !!item?.isOverdue;
  return (
    <div className={cn('rounded-2xl border p-4 flex items-start gap-3', overdue ? 'border-rose-500/30 bg-rose-500/[0.06]' : 'border-arcus-border bg-arcus-surface')}>
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', overdue ? 'bg-rose-500/10 text-rose-500' : 'bg-arcus-elevated text-arcus-fg-tertiary')}>
        <CheckCircle2 className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] text-arcus-fg leading-snug line-clamp-2">{item?.text}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {item?.meetingTitle && <span className="text-[11.5px] text-arcus-fg-tertiary truncate max-w-[220px]">from “{item.meetingTitle}”</span>}
          {overdue
            ? <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">overdue</span>
            : dueLabel && <span className="text-[11.5px] text-arcus-fg-muted">due {dueLabel}</span>}
        </div>
      </div>
      <button onClick={onDo} className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-arcus-border text-arcus-fg-secondary text-[12.5px] font-medium hover:bg-arcus-surface-hover transition-colors">
        <Zap className="w-3.5 h-3.5" /> Do it
      </button>
    </div>
  );
}

function RecCard({ r, onDo }: { r: Rec; onDo: () => void }) {
  return (
    <button onClick={onDo} className="group text-left rounded-2xl arcus-glass-card arcus-glass-hover p-4">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-[14px] font-semibold text-arcus-fg leading-snug">{r.title}</span>
        {r.atRisk && (
          <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10.5px] font-medium">
            <AlertTriangle className="w-3 h-3" /> at risk
          </span>
        )}
      </div>
      <p className="text-[12.5px] text-arcus-fg-tertiary leading-relaxed line-clamp-2">{r.summary}</p>
      <span className="inline-flex items-center gap-1 mt-2.5 text-[12px] font-medium text-arcus-fg-secondary group-hover:text-arcus-fg transition-colors">
        {r.ctaLabel || 'Do it'} <ChevronRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

const APP_ICON: Record<string, any> = { gmail: Mail, calendar: Calendar, notion: MessageSquare, slack: MessageSquare };
function AgentRunRow({ run }: { run: AgentRunItem }) {
  const chips = (['gmail', 'calendar', 'notion', 'slack'] as const)
    .map(k => ({ k, n: run.artifactCounts[k] })).filter(x => x.n > 0);
  return (
    <div className="rounded-2xl arcus-glass-card p-4 flex items-start gap-3">
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
        run.status === 'error' || run.status === 'transient_error' ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500')}>
        {run.status === 'running' ? <Clock className="w-4 h-4 animate-pulse" /> : <CheckCircle2 className="w-4 h-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-semibold text-arcus-fg truncate">{run.agentName}</span>
          <span className="text-[11.5px] text-arcus-fg-muted shrink-0">{relTime(run.ranAt)}</span>
        </div>
        {run.summary && <p className="text-[12.5px] text-arcus-fg-tertiary mt-0.5 line-clamp-2 leading-relaxed">{run.summary}</p>}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {chips.map(({ k, n }) => {
              const I = APP_ICON[k];
              return (
                <span key={k} className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-arcus-elevated text-arcus-fg-tertiary border border-arcus-border capitalize">
                  <I className="w-3 h-3" /> {n} {k}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared textured fill (stipple + wash) ────────────────────────────────────
// Recharts renders each chart into its OWN <svg>, so defs must be declared
// inside every chart that uses them. Two layers per hue: a soft top-to-bottom
// gradient "wash" (dataviz house rule: area fills stay a wash, ~10-30%
// opacity, never a saturated block) plus a small tiled dot pattern for the
// stippled/particle texture — together, layered under a crisp stroke line,
// they read as the textured fill in the reference dashboard without ever
// drawing a solid block of color.
function stippleDefs(id: string, colorVar: string) {
  return (
    <defs>
      <linearGradient id={`${id}-wash`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={colorVar} stopOpacity={0.3} />
        <stop offset="100%" stopColor={colorVar} stopOpacity={0} />
      </linearGradient>
      <pattern id={`${id}-dots`} width="4" height="4" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.65" fill={colorVar} fillOpacity={0.55} />
      </pattern>
    </defs>
  );
}

// ── A faint dot-stipple + refraction-sheen overlay — the "pill texture" that
// makes the frosted glass feel tactile. Theme-neutral dot color reads in both
// light and dark; the sheen is the top-left specular of the liquid-glass family.
// pointer-events-none + absolute so it never affects layout or interaction.
function GlassTexture() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(130,130,145,0.16) 0.6px, transparent 0.75px)',
          backgroundSize: '7px 7px',
          maskImage: 'linear-gradient(to bottom right, rgba(0,0,0,0.85), transparent 75%)',
          WebkitMaskImage: 'linear-gradient(to bottom right, rgba(0,0,0,0.85), transparent 75%)',
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.10] via-transparent to-transparent dark:from-white/[0.06]" />
    </>
  );
}

// ── Textured glass stat pill — one scalar KPI on a frosted, lightly-stippled
// surface. Deliberately NOT a mini-chart: the trend lives ONCE, in the area
// chart below (the old design plotted the same actions series in a spark tile,
// the big chart, AND a radar — three times — which this redesign removes).
function StatPill({ icon, value, label, accent }: {
  icon: React.ReactNode; value: string; label: string; accent?: string;
}) {
  return (
    <div className="arcus-glass-pill arcus-glass-hover rounded-2xl p-4 relative overflow-hidden">
      <GlassTexture />
      <div className="relative">
        <span
          className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-arcus-elevated"
          style={{ color: accent ? `var(${accent})` : 'var(--arcus-fg-tertiary)' }}
        >
          {icon}
        </span>
        <div className="text-[26px] font-semibold tracking-tight text-arcus-fg tabular-nums leading-none mt-3">{value}</div>
        <div className="text-[12px] text-arcus-fg-tertiary mt-1 truncate">{label}</div>
      </div>
    </div>
  );
}

// ── The big "your week" area chart — real 7-day activity, textured fill,
// crisp stroke, hover crosshair+tooltip (values live there, never drawn
// permanently), the busiest day emphasized with a larger dot, and a manual
// refresh. One series → no legend (the title names it). Frosted glass card.
function WeekAreaChart({ week, onRefresh, refreshing }: { week: WeekData; onRefresh: () => void; refreshing: boolean }) {
  const id = `week-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const peak = Math.max(...week.days.map((d) => d.actions), 0);
  return (
    <div className="arcus-glass-card rounded-2xl p-5 relative overflow-hidden">
      <GlassTexture />
      <div className="relative flex items-start justify-between mb-1">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-arcus-fg-tertiary">Actions per day</p>
          <p className="text-[12px] text-arcus-fg-muted mt-0.5">What Arcus handled each day, last 7 days</p>
        </div>
        <button
          onClick={onRefresh}
          aria-label="Refresh this week's activity"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-arcus-fg-tertiary hover:text-arcus-fg hover:bg-arcus-elevated transition-colors shrink-0"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
        </button>
      </div>
      <div className="relative h-[190px] mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={week.days} margin={{ top: 14, right: 8, bottom: 0, left: 8 }}>
            {stippleDefs(id, 'var(--arcus-chart-blue)')}
            <XAxis
              dataKey="label" tickLine={false} axisLine={false}
              tick={{ fontSize: 11, fill: 'var(--arcus-fg-muted, #9a9a9a)' }} dy={6}
            />
            <RTooltip
              cursor={{ stroke: 'var(--arcus-border, #d4d4d4)', strokeWidth: 1 } as any}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as WeekDay;
                return (
                  <div className="arcus-glass-card rounded-lg px-2.5 py-1.5">
                    <div className="text-[11px] font-semibold text-arcus-fg">{d.label}{d.isToday ? ' · so far' : ''}</div>
                    <div className="text-[11px] text-arcus-fg-tertiary">{d.actions} action{d.actions === 1 ? '' : 's'} · {d.runs} run{d.runs === 1 ? '' : 's'}</div>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="actions" stroke="none" fill={`url(#${id}-wash)`} />
            <Area type="monotone" dataKey="actions" stroke="none" fill={`url(#${id}-dots)`} />
            <Area
              type="monotone" dataKey="actions" stroke="var(--arcus-chart-blue)" strokeWidth={2} fill="none"
              // Selective emphasis — the busiest day gets a larger ringed dot so
              // the eye lands on it; every other point is a quiet 2.5px dot. The
              // number itself lives in the "busiest" pill above, so we don't
              // double-label it here.
              dot={(props: any) => {
                const isPeak = peak > 0 && props?.payload?.actions === peak;
                return (
                  <circle
                    key={`d-${props?.payload?.date ?? props?.index}`}
                    cx={props.cx} cy={props.cy}
                    r={isPeak ? 4.5 : 2.5}
                    fill="var(--arcus-chart-blue)"
                    stroke={isPeak ? 'var(--arcus-surface)' : 'none'}
                    strokeWidth={isPeak ? 2 : 0}
                  />
                );
              }}
              activeDot={{ r: 5, stroke: 'var(--arcus-surface)', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Across your apps — live, connection-gated per-app signal counts from
// /api/home-feed/recommendations (bounces/replies-needed for Gmail, prep-needed
// meetings for Calendar, stale pages for Notion, awaiting-reply DMs for Slack,
// upcoming bookings for Cal.com). A slice only exists here if that app is BOTH
// connected and produced a real signal this pass — nothing invented, nothing
// shown for an app the user hasn't connected. Donut is the endorsed form here
// (part-to-whole, ≤5 clearly-separated segments with a legend) rather than the
// bar-length comparison used elsewhere on this page.
const APP_CHART_META = {
  gmail:    { label: 'Gmail',    Icon: Mail,         varName: '--arcus-chart-blue' },
  calendar: { label: 'Calendar', Icon: Calendar,     varName: '--arcus-chart-green' },
  notion:   { label: 'Notion',   Icon: FileText,     varName: '--arcus-chart-magenta' },
  slack:    { label: 'Slack',    Icon: Hash,         varName: '--arcus-chart-yellow' },
  calcom:   { label: 'Cal.com',  Icon: CalendarPlus, varName: '--arcus-chart-aqua' },
} as const;

function AppsDonut({ counts }: { counts: AppCounts | null }) {
  const rows = useMemo(() => {
    if (!counts) return [];
    return (Object.keys(APP_CHART_META) as Array<keyof typeof APP_CHART_META>)
      .map((k) => ({ key: k, value: counts[k], ...APP_CHART_META[k] }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [counts]);

  if (rows.length === 0) return null;
  const total = rows.reduce((n, r) => n + r.value, 0);

  return (
    <div className="arcus-glass-card rounded-2xl p-5 relative overflow-hidden">
      <GlassTexture />
      <p className="relative text-[11px] font-semibold uppercase tracking-wide text-arcus-fg-tertiary mb-2.5">Across your apps</p>
      <div className="relative flex flex-wrap gap-x-3 gap-y-1.5 mb-3">
        {rows.map((r) => (
          <span key={r.key} className="inline-flex items-center gap-1.5 text-[11.5px] text-arcus-fg-tertiary">
            <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: `var(${r.varName})` }} />
            {r.label}
          </span>
        ))}
      </div>
      <div className="relative h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows} dataKey="value" nameKey="label"
              innerRadius="64%" outerRadius="100%" paddingAngle={2}
              stroke="var(--arcus-surface)" strokeWidth={3}
            >
              {rows.map((r) => <Cell key={r.key} fill={`var(${r.varName})`} />)}
            </Pie>
            <RTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof rows)[number];
                return (
                  <div className="arcus-glass-card rounded-lg px-2.5 py-1.5">
                    <div className="text-[11px] font-semibold text-arcus-fg">{p.label}</div>
                    <div className="text-[11px] text-arcus-fg-tertiary">{p.value} signal{p.value === 1 ? '' : 's'}</div>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[24px] font-semibold tracking-tight text-arcus-fg tabular-nums leading-none">{total}</span>
          <span className="text-[10.5px] text-arcus-fg-tertiary mt-1">signals right now</span>
        </div>
      </div>
    </div>
  );
}

// ── "This week, in short" — the panel that REPLACED the weekday radar (which
// re-plotted the exact same actions-by-day series as the area chart above — a
// dataviz redundancy). This gives NEW, genuinely useful reads instead, every
// one honestly derived from the real week.days: the busiest day (with a
// share-of-peak bar), how many of the 7 days had activity (as dots), and the
// average actions per run (an efficiency read). Frosted glass to match.
function WeekInsights({ week }: { week: WeekData }) {
  const busiest = week.days.reduce((a, b) => (b.actions > a.actions ? b : a), week.days[0]);
  const maxActions = Math.max(...week.days.map((d) => d.actions), 1);
  const activeDays = week.days.filter((d) => d.runs > 0).length;
  const perRun = week.totalRuns > 0 ? week.totalActions / week.totalRuns : 0;
  const blue = 'var(--arcus-chart-blue)';
  return (
    <div className="arcus-glass-card rounded-2xl p-5 relative overflow-hidden">
      <GlassTexture />
      <p className="relative text-[11px] font-semibold uppercase tracking-wide text-arcus-fg-tertiary mb-4">This week, in short</p>
      <div className="relative space-y-4">
        {/* Busiest day — with a share-of-peak bar */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[12.5px] text-arcus-fg-secondary">Busiest day</span>
            <span className="text-[12.5px] font-semibold text-arcus-fg tabular-nums">
              {busiest.label} · {busiest.actions} action{busiest.actions === 1 ? '' : 's'}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-arcus-elevated overflow-hidden">
            <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${(busiest.actions / maxActions) * 100}%`, background: blue }} />
          </div>
        </div>

        {/* Active days — 7 dots, one lit per day with a run */}
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] text-arcus-fg-secondary">Active days</span>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1">
              {week.days.map((d) => (
                <span
                  key={d.date}
                  title={`${d.label}: ${d.runs} run${d.runs === 1 ? '' : 's'}`}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: d.runs > 0 ? blue : 'var(--arcus-fg-muted)', opacity: d.runs > 0 ? 1 : 0.3 }}
                />
              ))}
            </div>
            <span className="text-[12.5px] font-semibold text-arcus-fg tabular-nums">{activeDays}/7</span>
          </div>
        </div>

        {/* Efficiency — actions per run */}
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] text-arcus-fg-secondary">Actions per run</span>
          <span className="text-[12.5px] font-semibold text-arcus-fg tabular-nums">
            {perRun > 0 ? `~${perRun.toFixed(1)}` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

// A skeleton block matching one analytics tile's footprint — pulsing, never a
// blank flash. Used both for first-load (nothing fetched yet) and to fill the
// donut's slot while recommendations are still in flight. Frosted to match.
function AnalyticsTileSkeleton({ h }: { h: string }) {
  return <div className={cn('arcus-glass-pill rounded-2xl animate-pulse', h)} />;
}

// ── Orchestrates the whole analytics dashboard: a real loading skeleton while
// the first fetch is in flight (never the false-empty "no activity" state —
// that used to flash before week-activity had even resolved), the honest
// empty state once we KNOW there's no agent activity, and otherwise the two
// spark tiles + big area chart + (donut when there's connected-app data) +
// weekday radar. `refreshing` re-runs BOTH week-activity and recommendations
// (the donut/Sift source) — the earlier version only refreshed the chart,
// which meant the donut could never actually be refreshed.
function AnalyticsSection({ week, weekLoaded, appCounts, recsLoaded, recsError, refreshing, onRefresh, onSchedule }: {
  week: WeekData | null; weekLoaded: boolean; appCounts: AppCounts | null; recsLoaded: boolean; recsError: string | null;
  refreshing: boolean; onRefresh: () => void; onSchedule: () => void;
}) {
  if (!weekLoaded) {
    return (
      <Section title="Your week" sub="Loading your activity…">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-2.5">
          {[0, 1, 2, 3].map((i) => <AnalyticsTileSkeleton key={i} h="h-[104px]" />)}
        </div>
        <AnalyticsTileSkeleton h="h-[248px]" />
        <div className="grid lg:grid-cols-2 gap-2.5 mt-2.5">
          <AnalyticsTileSkeleton h="h-[212px]" />
          <AnalyticsTileSkeleton h="h-[212px]" />
        </div>
      </Section>
    );
  }

  if (!week || !week.hasData) {
    return (
      <Section title="Your week" sub="Arcus activity, last 7 days">
        <div className="arcus-glass-card rounded-2xl p-8 text-center relative overflow-hidden">
          <GlassTexture />
          <div className="relative">
            <div className="w-11 h-11 rounded-2xl bg-arcus-elevated flex items-center justify-center mx-auto mb-3 text-arcus-fg-tertiary">
              <Zap className="w-5 h-5" />
            </div>
            <p className="text-[14px] font-medium text-arcus-fg">No agent activity yet this week</p>
            <p className="text-[12.5px] text-arcus-fg-tertiary mt-1 max-w-sm mx-auto">Schedule an agent and this fills in — a daily briefing, an inbox sweep, meeting prep.</p>
            <button onClick={onSchedule} className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-arcus-fg text-arcus-fg-inverse text-[12.5px] font-semibold hover:opacity-90 transition-opacity">
              <CalendarPlus className="w-4 h-4" /> Schedule an agent
            </button>
          </div>
        </div>
      </Section>
    );
  }

  const hasApps = !!appCounts && Object.values(appCounts).some((v) => v > 0);
  // The donut's slot: the DIRECT error if recommendations failed (founder
  // directive — no masking fallback), else real data, a loading skeleton while
  // recs are in flight, or nothing once we KNOW there's genuinely no signal.
  const showDonutSlot = !!recsError || hasApps || !recsLoaded;
  const avg = Math.round(week.totalActions / 7);
  const busiestDay = week.days.reduce((a, b) => (b.actions > a.actions ? b : a), week.days[0]);

  return (
    <Section title="Your week" sub={`${week.totalActions} action${week.totalActions === 1 ? '' : 's'} across ${week.totalRuns} run${week.totalRuns === 1 ? '' : 's'}, last 7 days`}>
      {/* Refetch keeps the frame — the existing charts hold at reduced opacity
          (dim + pulse) while refreshing rather than being torn out and
          replaced, so a manual refresh never causes a layout jump. */}
      <div className={cn('transition-opacity duration-300', refreshing && 'opacity-50 pointer-events-none animate-pulse')}>
        {/* Textured glass KPI pills — the scalar headlines, once each. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-2.5">
          <StatPill icon={<Zap className="w-4 h-4" />} value={week.totalActions.toLocaleString()} label="actions this week" accent="--arcus-chart-blue" />
          <StatPill icon={<Sparkles className="w-4 h-4" />} value={String(week.totalRuns)} label={`agent run${week.totalRuns === 1 ? '' : 's'}`} accent="--arcus-chart-aqua" />
          <StatPill icon={<Clock className="w-4 h-4" />} value={String(avg)} label="daily average" />
          <StatPill icon={<Calendar className="w-4 h-4" />} value={String(busiestDay.actions)} label={`busiest · ${busiestDay.label}`} accent="--arcus-chart-blue" />
        </div>
        <WeekAreaChart week={week} onRefresh={onRefresh} refreshing={refreshing} />
        <div className={cn('grid gap-2.5 mt-2.5', showDonutSlot && 'lg:grid-cols-2')}>
          {recsError
            ? <FeedErrorCard message={recsError} onRetry={onRefresh} />
            : hasApps ? <AppsDonut counts={appCounts} /> : (!recsLoaded ? <AnalyticsTileSkeleton h="h-[212px]" /> : null)}
          <WeekInsights week={week} />
        </div>
      </div>
    </Section>
  );
}

// ── "Handled quietly" — the demoted home for everything that reports what
// MAILIENT did (was two headline sections: "Your week" analytics + "While you
// were away"). FRAME FLIP (founder feedback: the feed showed "tasks completed
// by Mailient rather than those performed by the user"): this collapses both
// into ONE quiet reassurance line at the very bottom of the feed. Nothing is
// deleted — AnalyticsSection (the glass KPI pills / chart / cross-app donut /
// insights) and the agent-run list are exactly what shipped before, just
// nested behind a click instead of being the page's visual anchor. Renders
// nothing at all until there's real activity to report (never an empty
// "Handled quietly" line with nothing behind it).
function HandledQuietlyStrip({
  week, weekLoaded, appCounts, recsLoaded, recsError, refreshing, onRefresh, onSchedule, agentRuns,
}: {
  week: WeekData | null; weekLoaded: boolean; appCounts: AppCounts | null; recsLoaded: boolean; recsError: string | null;
  refreshing: boolean; onRefresh: () => void; onSchedule: () => void; agentRuns: AgentRunItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasWeek = !!week && week.hasData;
  if (!weekLoaded) return null; // stay silent while loading rather than reserve footer space
  if (!hasWeek && agentRuns.length === 0) return null; // genuinely nothing to report yet

  const totalRuns = week?.totalRuns ?? 0;
  const totalActions = week?.totalActions ?? 0;
  const summary = hasWeek
    ? `${totalRuns} run${totalRuns === 1 ? '' : 's'}, ${totalActions} action${totalActions === 1 ? '' : 's'} this week`
    : `${agentRuns.length} recent run${agentRuns.length === 1 ? '' : 's'}`;

  return (
    <div className="pt-1 border-t border-arcus-border/60">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-2 py-3 text-left group"
      >
        <span className="inline-flex items-center gap-2 text-[12.5px] text-arcus-fg-tertiary group-hover:text-arcus-fg-secondary transition-colors">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/70 shrink-0" />
          Handled quietly · {summary}
        </span>
        <ChevronRight className={cn('w-3.5 h-3.5 text-arcus-fg-tertiary shrink-0 transition-transform duration-200', expanded && 'rotate-90')} />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-2 space-y-4">
              {hasWeek && (
                <AnalyticsSection
                  week={week} weekLoaded={weekLoaded} appCounts={appCounts} recsLoaded={recsLoaded}
                  recsError={recsError} refreshing={refreshing} onRefresh={onRefresh} onSchedule={onSchedule}
                />
              )}
              {agentRuns.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-arcus-fg-tertiary mb-2">While you were away</p>
                  <div className="space-y-2">
                    {agentRuns.slice(0, 4).map((r) => <AgentRunRow key={r.id} run={r} />)}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


function CommandCenterSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 space-y-8 animate-pulse">
      <div className="space-y-3">
        <div className="h-4 w-32 bg-arcus-surface rounded" />
        <div className="h-8 w-64 bg-arcus-surface rounded" />
        <div className="h-4 w-96 max-w-full bg-arcus-surface rounded" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-arcus-surface rounded-2xl" />)}
        </div>
      </div>
      <div className="h-40 bg-arcus-surface rounded-2xl" />
      <div className="grid sm:grid-cols-2 gap-2.5">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-28 bg-arcus-surface rounded-2xl" />)}
      </div>
    </div>
  );
}
