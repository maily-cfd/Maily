'use client';
import { Mail } from "lucide-react";

/**
 * Maily onboarding — short path to value, then trial.
 * Essential screens only: Welcome → Gmail → Scan → Results → Trial → Done.
 * Calendar, voice preview, Boult theater, Notion/Slack, agent setup, and
 * briefing prefs are deferred to in-app nudges so people can try the product
 * before a long questionnaire.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession, signIn, signOut } from 'next-auth/react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ArrowRight, ArrowLeft, Check, Loader2, Lock,
  Mail, Clock, LogOut,
  Sparkles, PenLine, ChevronRight, Inbox, Activity, Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import posthog from 'posthog-js';

/* ─────────────────────────────────────────────────────────────────────────
   Types & constants
   ───────────────────────────────────────────────────────────────────────── */

const FIRST = 1;
const LAST = 15;
type Step = number; // 1..15

/**
 * Skipped in the primary flow (still reachable via deep link briefly, then
 * bounced forward). Keeps setup to ~6 screens instead of 14+.
 * 3 Calendar · 6–9 voice/Boult theater · 10–11 Notion/Slack · 12 agent · 14 briefing
 */
const SKIP_STEPS = new Set([3, 6, 7, 8, 9, 10, 11, 12, 14]);

/** Ordered screens the user actually walks — drives the progress capsule. */
const ACTIVE_FLOW: Step[] = [1, 2, 4, 5, 13, 15];

function bypassSkipped(n: number, dir: 1 | -1): Step {
  let s = n;
  while (SKIP_STEPS.has(s)) s += dir;
  return Math.min(LAST, Math.max(FIRST, s)) as Step;
}

// When Composio carries the Gmail grant, step 2 logs the user in with
// identity-only scopes (no cap) and connects Gmail via a Composio popup.
// Client-readable public mirror of COMPOSIO_GMAIL_AUTH_CONFIG_ID — set
// NEXT_PUBLIC_COMPOSIO_GMAIL=1 in the same envs. Absent = legacy single
// signIn flow, unchanged.
const COMPOSIO_GMAIL_ONBOARDING = process.env.NEXT_PUBLIC_COMPOSIO_GMAIL === '1';

const POLAR_CHECKOUT_URLS: Record<'weekly' | 'monthly' | 'annual' | 'lifetime', string> = {
  weekly:   'https://buy.polar.sh/polar_cl_nnRbdFq1yLPLgMs9GxDUTx1O6t30yz400ZSR54dcWia',
  monthly:  'https://buy.polar.sh/polar_cl_iFCJ2Mq7UbVBQTIiMGwI3STQZTvGfT1EBLyiM1HM5ca',
  annual:   'https://buy.polar.sh/polar_cl_I2DWGQPxxX0lvNGzbAeSRbkdCP6TgU9Ybsy7O3pkReC',
  lifetime: 'https://buy.polar.sh/polar_cl_T848DqQDK82361tmecJpNmtFgfPubJSb4Eyza2l8yrV',
};

type PlanChoice = 'weekly' | 'monthly' | 'annual' | 'lifetime';

interface ScanResult {
  windowDays: number;
  received: number;
  unanswered: number;
  automated: number;
  hoursPerWeek: number;
  receivedCapped?: boolean;
  unansweredCapped?: boolean;
  automatedCapped?: boolean;
  scannedAt?: number;
}

interface AgentSpec {
  name: string;
  summary: string;
  task_description: string;
  cron_schedule: string;
  scheduleLabel: string;
  output_channel: 'gmail' | 'slack' | 'both';
  required_integrations: string[];
  steps: string[];
}

interface CreatedAgent { id: string; name: string; scheduleLabel: string; nextRun?: string; cron?: string }

/* ─────────────────────────────────────────────────────────────────────────
   Utilities
   ───────────────────────────────────────────────────────────────────────── */

function slugifyHandle(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
}

function timeToCron(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const hh = Number.isFinite(h) ? h : 7;
  const mm = Number.isFinite(m) ? m : 0;
  return `${mm} ${hh} * * *`;
}

function prettyTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Next local occurrence of a daily HH:MM time, as an ISO string. */
function nextDailyOccurrence(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const now = new Date();
  const d = new Date(now);
  d.setHours(Number.isFinite(h) ? h : 7, Number.isFinite(m) ? m : 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** Replace only the minute/hour of a 5-field cron, preserving its cadence
    (day-of-month / month / day-of-week). Falls back to a daily cron. */
function setCronTime(cron: string | undefined, hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const mm = Number.isFinite(m) ? m : 0;
  const hh = Number.isFinite(h) ? h : 7;
  const p = (cron || '').trim().split(/\s+/);
  if (p.length !== 5) return `${mm} ${hh} * * *`;
  p[0] = String(mm); p[1] = String(hh);
  return p.join(' ');
}

/** Next local occurrence of a (daily or weekly single-DOW) cron, ISO string.
    Returns null for step crons (e.g. every-30-min) where a fixed time has no
    meaning here. */
function nextRunFromCron(cron: string): string | null {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [minS, hourS, , , dowS] = p;
  const m = parseInt(minS, 10), h = parseInt(hourS, 10);
  if (!Number.isFinite(m) || !Number.isFinite(h)) return null;
  const now = new Date();
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (/^\d$/.test(dowS)) {
    const target = Number(dowS);
    while (d.getTime() <= now.getTime() || d.getDay() !== target) d.setDate(d.getDate() + 1);
  } else if (d.getTime() <= now.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}

/* ─────────────────────────────────────────────────────────────────────────
   Controller
   ───────────────────────────────────────────────────────────────────────── */

export default function SiftOnboardingPage() {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const reduce = useReducedMotion();

  const urlStep = Number(searchParams?.get('step') || FIRST);
  const [step, setStep] = useState<Step>(() => {
    const raw = urlStep >= FIRST && urlStep <= LAST ? urlStep : FIRST;
    return bypassSkipped(raw, 1);
  });

  // Deep links / resume on deferred steps → jump to next active screen.
  useEffect(() => {
    if (SKIP_STEPS.has(step)) {
      const next = bypassSkipped(step, 1);
      setStep(next);
      const params = new URLSearchParams(Array.from(searchParams?.entries() || []));
      params.set('step', String(next));
      window.history.replaceState(null, '', `?${params.toString()}`);
    }
  }, [step, searchParams]);

  // Keep the UI step in sync with ROUTER-driven URL changes. The paywall
  // return path (abandoned checkout → router.replace('?step=13')) and the
  // "Change plan" link depend on this: `step` is state initialized once, so
  // without this sync those redirects changed the URL while the screen stayed
  // frozen on step 15. commit() uses history.replaceState, which does NOT
  // update useSearchParams — so normal forward navigation never re-fires this.
  useEffect(() => {
    if (urlStep >= FIRST && urlStep <= LAST && urlStep !== step) {
      setStep(bypassSkipped(urlStep, 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStep]);

  const firstName = useMemo(() => {
    const raw = session?.user?.name?.trim();
    if (raw) return raw.split(/\s+/)[0];
    const local = session?.user?.email?.split('@')[0] || '';
    const first = local.split(/[._\-+]/)[0];
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
  }, [session]);

  // ── Shared onboarding state (mirrors what gets persisted) ──
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [voiceDone, setVoiceDone] = useState(false);
  const [agentSpec, setAgentSpec] = useState<AgentSpec | null>(null);
  const [createdAgent, setCreatedAgent] = useState<CreatedAgent | null>(null);
  const [planChoice, setPlanChoice] = useState<PlanChoice | null>(null);
  const [briefTime, setBriefTime] = useState('07:00');
  const [briefChannel, setBriefChannel] = useState<'gmail' | 'slack' | 'both'>('gmail');

  // ── Integration status ──
  const [integrations, setIntegrations] = useState<any[]>([]);
  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/status');
      if (res.ok) {
        const d = await res.json();
        setIntegrations(Array.isArray(d.integrations) ? d.integrations : []);
      }
    } catch { /* silent */ }
  }, []);
  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  // Capture the user's real timezone so scheduled agents fire (and display their
  // first run) at the correct local time — the create route reads this.
  const tzSent = useRef(false);
  useEffect(() => {
    if (tzSent.current) return;
    tzSent.current = true;
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (timezone) {
        fetch('/api/boult/agents/timezone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone }),
        }).catch(() => {});
      }
    } catch { /* non-fatal */ }
  }, []);

  const isConnected = useCallback((provider: string) => {
    if (provider === 'gmail') {
      // With Composio carrying Gmail, a session means the user is LOGGED IN
      // (identity-only) but has NOT yet connected Gmail — that grant is a
      // separate Composio consent. So Gmail is "connected" only when the
      // status endpoint says so. In the legacy flow, login IS the Gmail grant,
      // so a session is sufficient.
      const byStatus = integrations.some((s: any) => s.provider === 'gmail' && s.connected);
      return COMPOSIO_GMAIL_ONBOARDING ? byStatus : (!!session || byStatus);
    }
    return integrations.some((s: any) => s.provider === provider && s.connected);
  }, [integrations, session]);

  // Build voice in the background after Gmail is connected — no dedicated screens.
  const voiceKickoff = useRef(false);
  useEffect(() => {
    if (voiceKickoff.current || voiceDone) return;
    if (step < 4 || !isConnected('gmail')) return;
    voiceKickoff.current = true;
    fetch('/api/user/voice-profile', { method: 'POST' })
      .then((res) => { if (res.ok) setVoiceDone(true); })
      .catch(() => { /* non-fatal — drafts still work with defaults */ });
  }, [step, voiceDone, isConnected]);

  // ── Resume from server on mount ──
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    (async () => {
      try {
        const res = await fetch('/api/onboarding/state');
        if (!res.ok) return;
        const d = await res.json();
        const st = d?.state || {};
        // Never restore scan counts from persistence — step 4 always re-reads Gmail
        // so "This is your month" cannot show stale or placeholder numbers.
        if (st.voiceDone) setVoiceDone(true);
        if (st.agent) setCreatedAgent(st.agent);
        if (st.agentSpec) setAgentSpec(st.agentSpec);
        if (st.plan) setPlanChoice(st.plan);
        if (st.briefTime) setBriefTime(st.briefTime);
        if (st.briefChannel) setBriefChannel(st.briefChannel);
        // Only honor server step if the URL didn't pin one explicitly.
        if (!searchParams?.get('step') && typeof d.step === 'number' && d.step >= FIRST && d.step <= LAST) {
          setStep(bypassSkipped(d.step, 1));
        }
      } catch { /* non-fatal */ }
    })();
  }, [searchParams]);

  // ── Commit step + patch to server (per-step persistence) ──
  const commit = useCallback((next: Step, patch?: Record<string, unknown>) => {
    const params = new URLSearchParams(Array.from(searchParams?.entries() || []));
    params.set('step', String(next));
    window.history.replaceState(null, '', `?${params.toString()}`);
    fetch('/api/onboarding/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: next, patch }),
    }).catch(() => {});
  }, [searchParams]);

  const go = useCallback((next: Step, patch?: Record<string, unknown>) => {
    const resolved = bypassSkipped(next, next >= step ? 1 : -1);
    setStep(resolved);
    commit(resolved, patch);
    if (resolved === 3) fetchIntegrations();
  }, [commit, fetchIntegrations, step]);

  const next = useCallback((patch?: Record<string, unknown>) => {
    go(bypassSkipped(Math.min(LAST, step + 1), 1), patch);
  }, [go, step]);
  const back = useCallback(() => {
    go(bypassSkipped(Math.max(FIRST, step - 1), -1));
  }, [go, step]);

  // Scan results require a fresh scan — never show step 5 without one.
  useEffect(() => {
    if (step === 5 && !scan) go(4);
  }, [step, scan, go]);

  // Sign-in with Google already grants Gmail (legacy) or Composio already linked
  // the inbox — don't make users confirm the same connection again on step 2.
  useEffect(() => {
    if (step !== 2 || !isConnected('gmail')) return;
    next();
  }, [step, isConnected, next]);

  // ── In-flow popup OAuth (keeps the user inside onboarding) ──
  // In-flow popup OAuth. `provider` is the integrations provider name
  // (google_calendar | notion | slack). Opens the popup synchronously (so it
  // isn't blocked), points it at the real session-authed auth URL, then polls
  // connection status — auto-closing the popup the moment the app connects, so
  // the user never lands on the dashboard inside the popup.
  const isProviderConnected = useCallback(async (provider: string): Promise<boolean> => {
    try {
      const r = await fetch('/api/integrations/status');
      const j = r.ok ? await r.json() : { integrations: [] };
      return (j.integrations || []).some((i: any) => i.provider === provider && i.connected);
    } catch { return false; }
  }, []);

  const connectViaPopup = useCallback((provider: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const w = 500, h = 640;
      const popup = window.open(
        'about:blank', 'Connect',
        `width=${w},height=${h},left=${window.screenX + (window.outerWidth - w) / 2},top=${window.screenY + (window.outerHeight - h) / 2}`,
      );
      if (!popup) { toast.error('Allow popups for this site, then try again.'); return resolve(false); }

      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(timeout);
        fetchIntegrations();
        resolve(ok);
      };

      const poll = setInterval(async () => {
        if (await isProviderConnected(provider)) {
          try { if (!popup.closed) popup.close(); } catch { /* cross-origin */ }
          finish(true);
        } else if (popup.closed) {
          // Closed without connecting — re-check once in case the callback
          // landed a moment before the window closed.
          finish(await isProviderConnected(provider));
        }
      }, 1000);

      // Safety: stop polling after 3 minutes.
      const timeout = setTimeout(() => finish(false), 180_000);

      (async () => {
        try {
          // gmail/gcal are DIRECT-redirect routes (they 302 to Google/Composio
          // consent), not {url}-returning /auth endpoints. Point the popup
          // straight at them; everything else returns a { url } to load.
          const directRoutes: Record<string, string> = {
            gmail: '/api/boult/v3/oauth/gmail',
            google_calendar: '/api/boult/v3/oauth/gcal',
          };
          if (directRoutes[provider]) {
            popup.location.href = directRoutes[provider];
            return;
          }
          const res = await fetch(`/api/integrations/${provider}/auth`);
          if (!res.ok) throw new Error('start failed');
          const { url } = await res.json();
          if (!url) throw new Error('no url');
          popup.location.href = url;
        } catch {
          try { popup.close(); } catch { /* */ }
          toast.error("That connection didn't start. Try again in a moment.");
          finish(false);
        }
      })();
    });
  }, [fetchIntegrations, isProviderConnected]);

  // ── Complete onboarding (writes the durable record) ──
  const completeOnboarding = useCallback(async () => {
    const username = slugifyHandle(session?.user?.email?.split('@')[0] || firstName || 'maily_user');
    try {
      await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          profileName: session?.user?.name || firstName,
          avatarUrl: session?.user?.image || null,
          plan: planChoice,
          agentConfig: agentSpec ? { ...agentSpec, agentId: createdAgent?.id || null } : null,
        }),
      });
      localStorage.setItem('onboarding_completed', 'true');
    } catch { /* the durable bits already persisted per-step */ }
  }, [session, firstName, planChoice, agentSpec, createdAgent]);

  // ── Cross-fade transition (functional motion only) ──
  const fade = reduce
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
        transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] as const },
      };

  const showChrome = step >= 2; // Welcome is full-bleed

  return (
    <div className="lg-stage min-h-screen text-[#0A0A0A] font-sans flex flex-col relative overflow-hidden">
      {/* Grayscale blobs behind the glass */}
      <div className="lg-blobs" aria-hidden="true">
        <div className="lg-blob lg-blob-a" />
        <div className="lg-blob lg-blob-b" />
        <div className="lg-blob lg-blob-c" />
      </div>

      {showChrome && (
        <header className="sticky top-0 z-30 px-5 pt-4 pb-2">
          <div className="max-w-xl mx-auto flex items-center gap-4">
            <span className="text-[13px] font-medium tracking-tight text-[#0A0A0A]/80 shrink-0">Maily</span>
            <ProgressCapsule step={step} />
            {/* Onboarding is otherwise a one-way corridor — without this, a user
                who signed in with the wrong Google account has no way out but
                the back button. Progress is persisted per-step, so signing out
                and back in resumes where they left off. */}
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/' })}
              aria-label="Sign out"
              title="Sign out"
              className="lg-ghost lg-focus shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium"
            >
              <LogOut className="w-3.5 h-3.5" strokeWidth={2} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>
      )}

      <main className="flex-1 flex items-center justify-center px-5 py-8 relative z-10">
        <div className={cn('w-full', step === 13 ? 'max-w-4xl' : 'max-w-xl')}>
          <AnimatePresence mode="wait">
            <motion.div key={step} {...fade}>
              {step === 1  && <S1Welcome onBegin={() => go(isConnected('gmail') ? 3 : 2)} />}
              {step === 2  && <S2Gmail isConnected={isConnected('gmail')} onConnect={() => {
                // Composio flow: log in with identity-only scopes first (no cap),
                // then connect Gmail via Composio's verified client in a popup.
                // Legacy flow: a single signIn that grants Gmail on our client.
                if (COMPOSIO_GMAIL_ONBOARDING) {
                  if (!session?.user?.email) {
                    signIn('google', { callbackUrl: `${window.location.pathname}?step=2`, redirect: true });
                  } else {
                    connectViaPopup('gmail');
                  }
                } else {
                  signIn('google', { callbackUrl: `${window.location.pathname}?step=2`, redirect: true });
                }
              }} onContinue={() => next()} />}
              {step === 3  && <S3Calendar connected={isConnected('gcal') || isConnected('google_calendar')} onConnect={() => connectViaPopup('google_calendar')} onContinue={() => next()} onSkip={() => next()} />}
              {step === 4  && <S4Scan scan={scan} setScan={setScan} onDone={(s) => next({ scan: s })} onSkip={() => go(13)} reduce={!!reduce} />}
              {step === 5  && (scan
                ? <S5ScanResults scan={scan} onContinue={() => next()} />
                : null)}
              {step === 6  && <S6BuildVoice done={voiceDone} setDone={setVoiceDone} onDone={() => next({ voiceDone: true })} />}
              {step === 7  && <S7VoicePreview onContinue={() => next()} />}
              {step === 8  && <S8MeetBoult onContinue={() => next()} />}
              {step === 9  && <S9Boult scan={scan} firstName={firstName} onContinue={() => next()} reduce={!!reduce} />}
              {step === 12 && <S12Agent spec={agentSpec} setSpec={setAgentSpec} created={createdAgent} setCreated={setCreatedAgent} onContinue={(c) => next(c ? { agent: c, agentSpec } : undefined)} onSkip={() => next()} />}
              {step === 13 && <S13Plan firstName={firstName} plan={planChoice} onChoose={(p) => { try { posthog.capture('paywall_plan_chosen', { plan: p }); } catch { /* analytics never blocks */ } setPlanChoice(p); next({ plan: p }); }} />}
              {step === 14 && <S14Notifications time={briefTime} setTime={setBriefTime} channel={briefChannel} setChannel={setBriefChannel} hasSlack={isConnected('slack')} agent={createdAgent} onUpdate={setCreatedAgent} onContinue={() => next({ briefTime, briefChannel })} />}
              {step === 15 && <S15Done firstName={firstName} agent={createdAgent} scan={scan} briefTime={briefTime} briefChannel={briefChannel} plan={planChoice} onFinish={completeOnboarding} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Quiet back affordance — never on Welcome or the terminal screen */}
      {step > 2 && step < 15 && (
        <footer className="sticky bottom-0 z-30 px-5 pb-5 pt-2">
          <div className="max-w-xl mx-auto">
            <button
              type="button"
              onClick={back}
              className="lg-focus inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-medium text-[#0A0A0A]/45 hover:text-[#0A0A0A]/80 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}


/* ─────────────────────────────────────────────────────────────────────────
   Progress capsule — the signature liquid-glass element
   ───────────────────────────────────────────────────────────────────────── */

function ProgressCapsule({ step }: { step: Step }) {
  // Only the screens people actually walk (Welcome → … → Done).
  const segs = ACTIVE_FLOW.length;
  const activeIdx = Math.max(0, ACTIVE_FLOW.indexOf(step));
  return (
    <div className="lg-capsule flex-1" role="progressbar" aria-valuemin={1} aria-valuemax={segs} aria-valuenow={activeIdx + 1} aria-label="Setup progress">
      {ACTIVE_FLOW.map((segStep, i) => {
        const filled = i <= activeIdx;
        return (
          <div key={segStep} className="lg-capsule-seg flex-1">
            <div className="lg-capsule-fill" style={{ width: filled ? '100%' : '0%' }} />
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Shared bits
   ───────────────────────────────────────────────────────────────────────── */

function Display({ children, className }: { children: React.ReactNode; className?: string }) {
  // Light-weight display headline (Satoshi 400–500). Sentence case enforced by copy.
  return (
    <h1 className={cn('font-medium tracking-[-0.03em] text-[#0A0A0A] leading-[1.08]', className)}>
      {children}
    </h1>
  );
}

function Body({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-[#0A0A0A]/55 leading-relaxed', className)}>{children}</p>;
}

function PrimaryButton({ children, onClick, disabled, type = 'button', className }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit'; className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn('lg-cta lg-focus inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full text-[14.5px] font-medium', className)}
    >
      {children}
    </button>
  );
}

function SkipLink({ onClick, children = 'Skip for now' }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="lg-focus text-[13.5px] font-medium text-[#0A0A0A]/45 hover:text-[#0A0A0A]/80 transition-colors rounded-full px-2 py-1"
    >
      {children}
    </button>
  );
}

function GlassCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('lg-card p-7 md:p-9', className)}>{children}</div>;
}

function IconBadge({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl lg-pane mb-6">
      {children}
    </div>
  );
}

function GoogleMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44c11 0 20-9 20-20 0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5 0 9.6-1.9 13.1-5l-6.1-5c-2 1.4-4.4 2-7 2-5.3 0-9.7-3.4-11.3-8l-6.5 5A20 20 0 0 0 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.5l6.1 5C40 35 44 30 44 24c0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  );
}

/* Real brand marks for the connect screens. */

function GmailMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 192 192" fill="none" aria-hidden="true">
      <path fill="url(#ob-gm-a)" d="M146 44h38v110c0 6.627-5.373 12-12 12h-20a6 6 0 0 1-6-6z"/>
      <path fill="#fc413d" d="M46 44H8v110c0 6.627 5.373 12 12 12h20a6 6 0 0 0 6-6z"/>
      <path fill="url(#ob-gm-b)" d="M39.226 30.456c-8.033-6.752-20.018-5.714-26.77 2.319-6.752 8.032-5.714 20.017 2.319 26.77l76.078 63.949a8 8 0 0 0 10.295 0l76.078-63.95c8.032-6.752 9.07-18.737 2.318-26.77-6.752-8.032-18.737-9.07-26.769-2.318L96 78.18z"/>
      <defs>
        <linearGradient id="ob-gm-a" x1="165" x2="165" y1="44" y2="166" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60d673"/>
          <stop offset=".17" stopColor="#42c868"/>
          <stop offset=".39" stopColor="#0ebc5f"/>
          <stop offset=".62" stopColor="#00a9bb"/>
          <stop offset=".86" stopColor="#3c90ff"/>
          <stop offset="1" stopColor="#3186ff"/>
        </linearGradient>
        <linearGradient id="ob-gm-b" x1="8" x2="184" y1="46.13" y2="46.13" gradientUnits="userSpaceOnUse">
          <stop offset=".08" stopColor="#ff63a0"/>
          <stop offset=".3" stopColor="#fc413d"/>
          <stop offset=".5" stopColor="#fc413d"/>
          <stop offset=".65" stopColor="#fc413d"/>
          <stop offset=".72" stopColor="#fc5c30"/>
          <stop offset=".86" stopColor="#feb10c"/>
          <stop offset=".91" stopColor="#fec700"/>
          <stop offset=".96" stopColor="#ffdb0f"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

function GCalMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 192 192" fill="none" aria-hidden="true">
      <path fill="#bbe2ff" d="M32 36.8C32 20.894 44.894 8 60.8 8h70.4C147.106 8 160 20.894 160 36.8v30.4c0 15.906-12.894 28.8-28.8 28.8H60.8C44.894 96 32 83.106 32 67.2z"/>
      <path fill="#3c90ff" d="M19.867 49.392C17.818 33.82 29.94 20 45.645 20h100.71c15.706 0 27.827 13.82 25.778 29.392L166 96l6.133 46.608C174.182 158.18 162.061 172 146.355 172H45.645c-15.706 0-27.827-13.82-25.778-29.392L26 96z"/>
      <mask id="ob-gc-a" width="154" height="152" x="19" y="20" maskUnits="userSpaceOnUse" style={{ maskType: 'alpha' }}>
        <path fill="#3c90ff" d="M19.867 49.392C17.818 33.82 29.94 20 45.645 20h100.71c15.706 0 27.827 13.82 25.778 29.392L166 96l6.133 46.608C174.182 158.18 162.061 172 146.355 172H45.645c-15.706 0-27.827-13.82-25.778-29.392L26 96z"/>
      </mask>
      <g mask="url(#ob-gc-a)">
        <path fill="url(#ob-gc-b)" d="M0 0h166v76H0z" transform="matrix(1 0 0 -1 13 172)"/>
      </g>
      <mask id="ob-gc-c" width="154" height="152" x="19" y="20" maskUnits="userSpaceOnUse" style={{ maskType: 'alpha' }}>
        <path fill="#3186ff" d="M19.867 49.392C17.818 33.82 29.94 20 45.645 20h100.71c15.706 0 27.827 13.82 25.778 29.392L166 96l6.133 46.608C174.182 158.18 162.061 172 146.355 172H45.645c-15.706 0-27.827-13.82-25.778-29.392L26 96z"/>
      </mask>
      <g mask="url(#ob-gc-c)">
        <path fill="url(#ob-gc-d)" d="M32 27.2C32 16.596 40.596 8 51.2 8h89.6c10.604 0 19.2 8.596 19.2 19.2V96H32z" filter="url(#ob-gc-e)"/>
      </g>
      <path fill="#fff" d="M75.353 133.336q-6.282 0-10.777-2.043t-7.61-5.465q-3.065-3.474-4.342-6.793T51.603 115a2.07 2.07 0 0 1 1.021-1.124l5.67-2.247q.714-.357 1.43-.102.714.204 1.685 2.349 1.022 2.145 2.86 4.546a14.3 14.3 0 0 0 4.495 3.728q2.606 1.328 6.435 1.328 6.18 0 9.807-3.575 3.677-3.575 3.677-9.091 0-5.976-3.882-9.194-3.881-3.269-10.266-3.269h-5.362a1.9 1.9 0 0 1-1.328-.51q-.51-.562-.511-1.277v-5.465q0-.767.51-1.277a1.82 1.82 0 0 1 1.329-.562h4.647q5.721 0 9.194-3.116t3.473-8.07q0-4.902-3.116-7.916t-8.58-3.014q-3.065 0-5.312 1.022a11.5 11.5 0 0 0-3.882 2.86 22.7 22.7 0 0 0-2.809 3.78q-1.174 1.941-1.89 2.145-.714.153-1.379-.255l-5.363-2.605q-.664-.358-.868-1.124t1.226-3.575q1.481-2.86 4.494-5.823a21 21 0 0 1 7.049-4.597q4.035-1.635 9.398-1.634 9.96 0 15.782 5.26 5.823 5.21 5.823 13.791 0 5.925-2.86 10.266-2.81 4.34-7.968 6.13v.204q6.231 1.838 9.806 6.741 3.627 4.853 3.626 11.594 0 9.654-6.742 15.834-6.74 6.18-17.57 6.18zm51.25-1.175q-.868 0-1.533-.664a2.25 2.25 0 0 1-.612-1.583V73.118l-11.492 8.274q-.614.46-1.431.307a1.96 1.96 0 0 1-1.225-.766l-3.32-4.7a1.98 1.98 0 0 1-.358-1.43q.153-.816.817-1.276l20.379-14.557q.256-.204.562-.306.307-.153.715-.153h4.291q.868 0 1.379.613.562.56.562 1.43v69.36q0 .92-.664 1.583a2 2 0 0 1-1.533.664z"/>
      <defs>
        <linearGradient id="ob-gc-b" x1="83" x2="83" y1="76" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4fa0ff"/>
          <stop offset="1" stopColor="#3186ff"/>
        </linearGradient>
        <linearGradient id="ob-gc-d" x1="89.06" x2="89.06" y1="21.75" y2="96.39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a9a8ff"/>
          <stop offset=".8" stopColor="#3c90ff"/>
        </linearGradient>
        <filter id="ob-gc-e" width="152" height="112" x="20" y="-4" colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix"/>
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
          <feGaussianBlur result="effect1_foregroundBlur_37330_7673" stdDeviation="6"/>
        </filter>
      </defs>
    </svg>
  );
}

/* ═══════════════════════════ 1 · WELCOME ═══════════════════════════ */

function S1Welcome({ onBegin }: { onBegin: () => void }) {
  return (
    <div className="text-center px-2">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="inline-block mb-10">
        <div className="w-16 h-16 rounded-[20px] lg-card flex items-center justify-center overflow-hidden mx-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <Mail className="w-full h-full p-1 text-inherit" />
        </div>
      </motion.div>

      <Display className="text-[34px] sm:text-[48px] sm:leading-[1.05] mb-5">
        Your inbox is about to
        <br className="hidden sm:block" /> get an employee.
      </Display>

      <Body className="text-[16px] max-w-md mx-auto mb-10">
        Maily removes email from your to-do list entirely — it works while you sleep. Connect Gmail, see your inbox in 60 seconds, then start a 3-day free trial.
      </Body>

      <PrimaryButton onClick={onBegin} className="px-8 py-3.5 text-[15px]">
        Begin <ArrowRight className="w-4 h-4" />
      </PrimaryButton>
    </div>
  );
}

/* ═══════════════════════════ 2 · CONNECT GMAIL (required) ═══════════════════════════ */

function S2Gmail({ isConnected, onConnect, onContinue }: { isConnected: boolean; onConnect: () => void; onContinue: () => void }) {
  return (
    <div className="text-center">
      <IconBadge><GmailMark size={24} /></IconBadge>
      <Display className="text-[28px] sm:text-[34px] mb-3">Connect your inbox</Display>
      <Body className="text-[15px] max-w-sm mx-auto mb-7">
        Maily reads everything — including the emails you&apos;d never have gotten to — and drafts in your voice. This is the one connection it can&apos;t work without.
      </Body>

      <GlassCard className="text-left max-w-sm mx-auto mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-white border border-black/[0.06] flex items-center justify-center"><GoogleMark /></div>
          <div>
            <p className="text-[14px] font-medium text-[#0A0A0A]">Gmail</p>
            <p className="text-[12.5px] text-[#0A0A0A]/50">Read and draft access</p>
          </div>
          {isConnected && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#0A0A0A]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A]" /> Connected
            </span>
          )}
        </div>
        <div className="flex items-start gap-2 text-[12.5px] text-[#0A0A0A]/55 leading-relaxed">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#0A0A0A]/45" strokeWidth={2} />
          Read and draft access. Revoke anytime. Your emails never train anything.
        </div>
      </GlassCard>

      {isConnected ? (
        <PrimaryButton onClick={onContinue}>Continue <ArrowRight className="w-4 h-4" /></PrimaryButton>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <PrimaryButton onClick={onConnect}><GoogleMark /> Connect Gmail</PrimaryButton>
          <span className="text-[12px] text-[#0A0A0A]/35">Continue unlocks once Gmail is connected.</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════ 3 · CONNECT CALENDAR (skippable) ═══════════════════════════ */

function S3Calendar({ connected, onConnect, onContinue, onSkip }: { connected: boolean; onConnect: () => Promise<boolean>; onContinue: () => void; onSkip: () => void }) {
  const [busy, setBusy] = useState(false);
  const handle = async () => { setBusy(true); const ok = await onConnect(); setBusy(false); if (ok) onContinue(); };
  return (
    <div className="text-center">
      <IconBadge><GCalMark size={24} /></IconBadge>
      <Display className="text-[28px] sm:text-[34px] mb-3">Add your calendar</Display>
      <Body className="text-[15px] max-w-sm mx-auto mb-8">
        So Maily can book meetings without double-booking you.
      </Body>
      {connected ? (
        <PrimaryButton onClick={onContinue}>Continue <ArrowRight className="w-4 h-4" /></PrimaryButton>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <PrimaryButton onClick={handle} disabled={busy}>
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</> : <><GoogleMark /> Connect Google Calendar</>}
          </PrimaryButton>
          <SkipLink onClick={onSkip} />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════ 4 · FIRST SCAN (real data, auto-advance) ═══════════════════════════ */

function S4Scan({ scan, setScan, onDone, onSkip, reduce }: { scan: ScanResult | null; setScan: (s: ScanResult) => void; onDone: (s: ScanResult) => void; onSkip: () => void; reduce: boolean }) {
  const [display, setDisplay] = useState(0);
  const [phase, setPhase] = useState<'reading' | 'settled' | 'error'>('reading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const runId = useRef(0);

  const loadScan = useCallback(async () => {
    const id = ++runId.current;
    setPhase('reading');
    setErrorMsg(null);
    setDisplay(0);
    try {
      const res = await fetch('/api/onboarding/scan', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (runId.current !== id) return;
      if (!res.ok || !d.success) {
        setErrorMsg(
          typeof d?.error === 'string'
            ? (d.error === 'Gmail not connected' ? 'Connect Gmail first, then try again.' : 'Could not read your inbox. Try again.')
            : 'Could not read your inbox. Try again.',
        );
        setPhase('error');
        return;
      }
      const result: ScanResult = {
        windowDays: d.windowDays,
        received: d.received,
        unanswered: d.unanswered,
        automated: d.automated,
        hoursPerWeek: d.hoursPerWeek,
        receivedCapped: d.receivedCapped,
        unansweredCapped: d.unansweredCapped,
        automatedCapped: d.automatedCapped,
        scannedAt: d.scannedAt,
      };
      setScan(result);
      if (reduce) {
        setDisplay(result.received);
        setPhase('settled');
      } else {
        const target = result.received;
        const t0 = performance.now();
        const dur = Math.min(2600, 900 + target);
        const tick = (now: number) => {
          if (runId.current !== id) return;
          const p = Math.min(1, (now - t0) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          setDisplay(Math.round(target * eased));
          if (p < 1) requestAnimationFrame(tick);
          else setPhase('settled');
        };
        requestAnimationFrame(tick);
      }
    } catch {
      if (runId.current !== id) return;
      setErrorMsg('Connection lost while reading your inbox. Try again.');
      setPhase('error');
    }
  }, [setScan, reduce]);

  useEffect(() => {
    loadScan();
  }, [loadScan]);

  // Auto-advance once settled (with a readable beat).
  useEffect(() => {
    if (phase !== 'settled' || !scan) return;
    const t = setTimeout(() => onDone(scan), reduce ? 600 : 2400);
    return () => clearTimeout(t);
  }, [phase, scan, onDone, reduce]);

  if (phase === 'error') {
    return (
      <div className="text-center">
        <IconBadge><Inbox className="w-5 h-5 text-[#0A0A0A]" strokeWidth={1.75} /></IconBadge>
        <Display className="text-[26px] mb-3">Couldn&apos;t read your inbox</Display>
        <Body className="text-[15px] max-w-sm mx-auto mb-7">
          {errorMsg || 'Gmail didn&apos;t return your counts. This screen only shows your real numbers.'}
        </Body>
        <div className="flex flex-col items-center gap-3">
          <PrimaryButton onClick={() => loadScan()}>Try again</PrimaryButton>
          <SkipLink onClick={onSkip}>Skip for now</SkipLink>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="mb-7 flex items-center justify-center gap-2 text-[12.5px] font-medium text-[#0A0A0A]/45">
        {phase === 'reading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {phase === 'reading' ? 'Reading your inbox…' : 'Here’s what we found'}
      </div>

      <div className="tabular-nums font-medium tracking-[-0.04em] text-[#0A0A0A] text-[64px] sm:text-[88px] leading-none mb-3">
        {display.toLocaleString()}{phase === 'settled' && scan?.receivedCapped ? '+' : ''}
      </div>

      <AnimatePresence mode="wait">
        {phase === 'reading' ? (
          <motion.p key="r" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[14px] text-[#0A0A0A]/45">
            emails and counting…
          </motion.p>
        ) : (
          <motion.div key="s" initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Body className="text-[16px] max-w-sm mx-auto">
              You’ve gotten <span className="text-[#0A0A0A] font-medium">{(scan?.received ?? 0).toLocaleString()}{scan?.receivedCapped ? '+' : ''}</span> emails in the last{' '}
              {scan?.windowDays ?? 30} days. <span className="text-[#0A0A0A] font-medium">{(scan?.unanswered ?? 0).toLocaleString()}{scan?.unansweredCapped ? '+' : ''}</span> are still unanswered.
            </Body>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════ 5 · SCAN RESULTS ═══════════════════════════ */

function S5ScanResults({ scan, onContinue }: { scan: ScanResult | null; onContinue: () => void }) {
  const win = scan?.windowDays ?? 30;
  const rows = [
    { label: 'Emails received', value: scan?.received, capped: scan?.receivedCapped, est: false, sub: `last ${win} days` },
    { label: 'Still unanswered', value: scan?.unanswered, capped: scan?.unansweredCapped, est: false, sub: 'unread, from real people' },
    { label: 'Automated / bulk', value: scan?.automated, capped: scan?.automatedCapped, est: false, sub: 'newsletters, updates, promos' },
    { label: 'Hours a week', value: scan?.hoursPerWeek, capped: false, est: true, sub: 'estimated, on email' },
  ];
  return (
    <div>
      <div className="text-center mb-7">
        <IconBadge><Activity className="w-5 h-5 text-[#0A0A0A]" strokeWidth={1.75} /></IconBadge>
        <Display className="text-[26px] sm:text-[32px] mb-3">This is your month</Display>
        <Body className="text-[15px] max-w-sm mx-auto">This is what Maily is going to take off your plate.</Body>
      </div>
      <GlassCard className="divide-y divide-black/[0.06] p-0">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-6 py-4">
            <div>
              <p className="text-[14px] font-medium text-[#0A0A0A]">{r.label}</p>
              <p className="text-[12px] text-[#0A0A0A]/45">{r.sub}</p>
            </div>
            <span className="tabular-nums text-[22px] font-medium tracking-tight text-[#0A0A0A]">
              {r.value != null ? `${r.est ? '~' : ''}${r.value.toLocaleString()}${r.capped ? '+' : ''}` : '—'}
            </span>
          </div>
        ))}
      </GlassCard>
      <p className="text-center text-[11.5px] text-[#0A0A0A]/40 mt-4">Counted from your Gmail over the last {win} days.</p>
      <div className="text-center mt-6">
        <PrimaryButton onClick={onContinue}>Continue <ArrowRight className="w-4 h-4" /></PrimaryButton>
      </div>
    </div>
  );
}

/* ═══════════════════════════ 6 · BUILD VOICE (real, auto-advance) ═══════════════════════════ */

function S6BuildVoice({ done, setDone, onDone }: { done: boolean; setDone: (b: boolean) => void; onDone: () => void }) {
  const [status, setStatus] = useState<'working' | 'done' | 'error'>(done ? 'done' : 'working');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (done) return;
    (async () => {
      // Bound the wait so a slow analysis degrades to the error screen instead
      // of leaving the user stuck on "reading your inbox…" forever.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 58_000);
      try {
        const res = await fetch('/api/user/voice-profile', { method: 'POST', signal: controller.signal });
        if (!res.ok) throw new Error('voice failed');
        setDone(true); setStatus('done');
      } catch { setStatus('error'); }
      finally { clearTimeout(timer); }
    })();
  }, [done, setDone]);

  useEffect(() => {
    if (status !== 'done') return;
    const t = setTimeout(onDone, 900);
    return () => clearTimeout(t);
  }, [status, onDone]);

  return (
    <div className="text-center">
      <IconBadge><PenLine className="w-5 h-5 text-[#0A0A0A]" strokeWidth={1.75} /></IconBadge>
      <Display className="text-[26px] sm:text-[32px] mb-3">Learning how you write</Display>
      <Body className="text-[15px] max-w-sm mx-auto mb-8">
        Maily is reading your last 90 days of sent mail to learn your voice — not a generic AI tone.
      </Body>
      <div className="flex items-center justify-center gap-2.5 text-[13.5px] font-medium text-[#0A0A0A]/55">
        {status === 'working' && <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing your sent mail…</>}
        {status === 'done' && <><Check className="w-4 h-4" /> Voice profile ready</>}
        {status === 'error' && <span className="text-[#0A0A0A]/45">We’ll finish this later — continuing.</span>}
      </div>
      {status === 'error' && (
        <div className="mt-6"><PrimaryButton onClick={onDone}>Continue <ArrowRight className="w-4 h-4" /></PrimaryButton></div>
      )}
    </div>
  );
}

/* ═══════════════════════════ 7 · VOICE PREVIEW ═══════════════════════════ */

interface ToneState { formality: number; detail: number; warmth: number; confidence: number }

function S7VoicePreview({ onContinue }: { onContinue: () => void }) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tone, setTone] = useState<ToneState>({ formality: 50, detail: 40, warmth: 50, confidence: 30 });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/user/voice-profile');
        const d = await res.json();
        // GET returns the DB row { voice_profile: {...} }; PUT/POST return the
        // bare object. Normalize to the profile object either way.
        const p = d?.profile?.voice_profile || d?.profile || null;
        setProfile(p);
        const t = p?.manual_settings?.tone;
        if (t) setTone({ formality: t.formality ?? 50, detail: t.detail ?? 40, warmth: t.warmth ?? 50, confidence: t.confidence ?? 30 });
      } catch { /* non-fatal */ } finally { setLoading(false); }
    })();
  }, []);

  // Real analyzed signals (object shapes, not arrays).
  const toneDesc = profile?.tone?.description || profile?.tone?.primary;
  const toneLabel = typeof toneDesc === 'string' && toneDesc.trim() ? toneDesc : 'Direct, warm, low on filler';
  const signoff = profile?.closing_patterns?.preferred_closings?.[0] || 'Best,';
  const replyLength = profile?.structural_patterns?.typical_email_length
    || profile?.language_patterns?.sentence_length || 'Short, a few lines';
  const formality = profile?.tone?.primary || 'Semi-formal';
  const sample: string | null = (typeof profile?.sample_reply === 'string' && profile.sample_reply.trim())
    ? profile.sample_reply.trim()
    : null;

  const saveTone = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/user/voice-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone }),
      });
      const d = await res.json();
      if (res.ok && d?.profile) setProfile(d.profile?.voice_profile || d.profile);
      setEditing(false);
    } catch {
      toast.error("Couldn't save those adjustments — try again.");
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="text-center mb-7">
        <IconBadge><PenLine className="w-5 h-5 text-[#0A0A0A]" strokeWidth={1.75} /></IconBadge>
        <Display className="text-[26px] sm:text-[32px] mb-3">This is how you sound</Display>
        <Body className="text-[15px] max-w-sm mx-auto">Maily drafts in this voice. You can adjust it any time.</Body>
      </div>

      <GlassCard className="mb-5">
        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-[#0A0A0A]/45"><Loader2 className="w-4 h-4 animate-spin" /> Loading your profile…</div>
        ) : editing ? (
          <div className="space-y-5">
            <ToneSlider label="Formality"  left="Casual"   right="Formal"     value={tone.formality}  onChange={(v) => setTone({ ...tone, formality: v })} />
            <ToneSlider label="Detail"     left="Brief"    right="Detailed"   value={tone.detail}     onChange={(v) => setTone({ ...tone, detail: v })} />
            <ToneSlider label="Warmth"     left="Warm"     right="Direct"     value={tone.warmth}     onChange={(v) => setTone({ ...tone, warmth: v })} />
            <ToneSlider label="Confidence" left="Reserved" right="Confident"  value={tone.confidence} onChange={(v) => setTone({ ...tone, confidence: v })} />
          </div>
        ) : (
          <>
            <div className={cn('grid grid-cols-2 gap-x-6 gap-y-4', sample && 'mb-5')}>
              <Trait label="Tone" value={toneLabel} />
              <Trait label="Typical sign-off" value={signoff} />
              <Trait label="Reply length" value={replyLength} />
              <Trait label="Formality" value={formality} />
            </div>
            {sample && (
              <div className="pt-5 border-t border-black/[0.06]">
                <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[#0A0A0A]/40 mb-2">A draft in your voice</p>
                <p className="text-[14px] text-[#0A0A0A]/80 leading-relaxed italic">“{sample}”</p>
              </div>
            )}
          </>
        )}
      </GlassCard>

      {editing ? (
        <div className="flex items-center justify-center gap-5">
          <PrimaryButton onClick={saveTone} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <>Save voice <Check className="w-4 h-4" /></>}
          </PrimaryButton>
          <SkipLink onClick={() => setEditing(false)}>Cancel</SkipLink>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-5">
          <PrimaryButton onClick={onContinue}>This is me <Check className="w-4 h-4" /></PrimaryButton>
          <SkipLink onClick={() => setEditing(true)}>Adjust</SkipLink>
        </div>
      )}
    </div>
  );
}

function ToneSlider({ label, left, right, value, onChange }: {
  label: string; left: string; right: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-medium text-[#0A0A0A]">{label}</span>
        <span className="text-[11px] tabular-nums text-[#0A0A0A]/35">{value}</span>
      </div>
      <input
        type="range" min={0} max={100} step={5} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="lg-focus w-full accent-[#0A0A0A] h-1.5 cursor-pointer"
      />
      <div className="flex items-center justify-between mt-1 text-[10.5px] text-[#0A0A0A]/40">
        <span>{left}</span><span>{right}</span>
      </div>
    </div>
  );
}

function Trait({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[#0A0A0A]/40 mb-1">{label}</p>
      <p className="text-[14px] font-medium text-[#0A0A0A] capitalize">{value}</p>
    </div>
  );
}

/* ═══════════════════════════ 8 · MEET BOULT ═══════════════════════════ */

function S8MeetBoult({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="text-center">
      <IconBadge><Cpu className="w-5 h-5 text-[#0A0A0A]" strokeWidth={1.75} /></IconBadge>
      <Display className="text-[34px] sm:text-[44px] mb-5">Meet Boult.</Display>
      <Body className="text-[16px] max-w-md mx-auto mb-9">
        Boult is your new employee — the one who runs your inbox. It reads, decides, drafts, schedules,
        and reports — and shows you its reasoning every time, before anything is sent.
      </Body>
      <PrimaryButton onClick={onContinue}>See Boult work <ArrowRight className="w-4 h-4" /></PrimaryButton>
    </div>
  );
}

/* ═══════════════════════════ 9 · BOULT INTERACTION (real SSE → real drafts) ═══════════════════════════ */

interface Moment { kind: 'reason' | 'decision' | 'action' | 'final'; text: string }

function S9Boult({ scan, firstName, onContinue, reduce }: { scan: ScanResult | null; firstName: string; onContinue: () => void; reduce: boolean }) {
  // Cap at 2 — reliable within function time; scan only informs the ask.
  const count = Math.max(1, Math.min(2, scan?.unanswered ?? 2));
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [moments, setMoments] = useState<Moment[]>([]);
  const [drafts, setDrafts] = useState(0);
  const [finalNote, setFinalNote] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const draftsRef = useRef(0);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [moments]);

  const push = (m: Moment) => setMoments((prev) => [...prev, m]);

  const run = async () => {
    setPhase('working');
    setMoments([]);
    setDrafts(0);
    draftsRef.current = 0;
    setFinalNote(null);
    setErrorDetail(null);
    try {
      const res = await fetch('/api/onboarding/boult-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setErrorDetail(
          typeof errBody?.message === 'string'
            ? errBody.message
            : 'Couldn’t start the run. Connect Gmail and try again.',
        );
        setPhase('error');
        return;
      }
      if (!res.body) {
        setErrorDetail('No response from Boult. Try again.');
        setPhase('error');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';
      let errored = false;
      let streamError = '';
      let needsGmail = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const evLine = block.split('\n').find((l) => l.startsWith('event:'));
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
          if (!evLine || !dataLine) continue;
          const type = evLine.slice(6).trim();
          let data: any = {};
          try { data = JSON.parse(dataLine.slice(5).trim()); } catch { /* */ }
          if (type === 'error') {
            errored = true;
            const msg = (data?.message || data?.error || '').toString().trim();
            if (msg) streamError = msg;
            continue;
          }
          if (type === 'connector_required') {
            needsGmail = true;
            errored = true;
            streamError = 'Gmail isn’t connected. Connect it, then run this again.';
            push({ kind: 'decision', text: 'Gmail needs to be connected' });
            continue;
          }
          if (type === 'thinking' || type === 'narrative') {
            const t = (data?.status || data?.text || data?.message || '').toString().trim();
            if (t && t.length > 3) push({ kind: 'reason', text: clip(t) });
          } else if (type === 'tool_call') {
            const label = humanTool(data?.tool || data?.name || '');
            if (label) push({ kind: 'decision', text: label });
          } else if (type === 'tool_result') {
            const name = (data?.tool || data?.name || '').toString();
            if (/draft/i.test(name) && data?.success !== false) {
              draftsRef.current += 1;
              setDrafts(draftsRef.current);
            }
          } else if (type === 'message') {
            const t = (data?.content || data?.text || '').toString().trim();
            if (t) finalText = clip(t, 280);
          }
        }
      }

      if (errored && draftsRef.current === 0) {
        setErrorDetail(streamError || (needsGmail
          ? 'Gmail isn’t connected. Connect it, then run this again.'
          : 'That run didn’t finish. Try again.'));
        setPhase('error');
        return;
      }

      if (finalText) {
        push({ kind: 'final', text: finalText });
        setFinalNote(finalText);
      } else if (draftsRef.current > 0) {
        const note = draftsRef.current === 1
          ? 'One draft is waiting in Gmail. Nothing was sent.'
          : `${draftsRef.current} drafts are waiting in Gmail. Nothing was sent.`;
        push({ kind: 'final', text: note });
        setFinalNote(note);
      }
      setPhase('done');
    } catch {
      setErrorDetail('Connection dropped mid-run. Try again — nothing was sent.');
      setPhase('error');
    }
  };

  return (
    <div>
      <div className="text-center mb-6">
        <IconBadge><Cpu className="w-5 h-5 text-[#0A0A0A]" strokeWidth={1.75} /></IconBadge>
        <Display className="text-[26px] sm:text-[32px] mb-3">Watch Boult work</Display>
        <Body className="text-[15px] max-w-sm mx-auto">
          {phase === 'idle'
            ? <>Boult will draft replies to your {count} oldest unanswered {count === 1 ? 'email' : 'emails'} — in your voice. Nothing sends.</>
            : <>Every decision, in the open{firstName ? `, ${firstName}` : ''}.</>}
        </Body>
      </div>

      {phase === 'idle' && (
        <div className="text-center">
          <GlassCard className="max-w-sm mx-auto mb-6 text-left">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl lg-pane flex items-center justify-center"><Inbox className="w-4 h-4 text-[#0A0A0A]" /></div>
              <div>
                <p className="text-[13.5px] font-medium text-[#0A0A0A]">Draft {count} {count === 1 ? 'reply' : 'replies'}</p>
                <p className="text-[12px] text-[#0A0A0A]/50">Your oldest unanswered {count === 1 ? 'email' : 'emails'} — nothing sends</p>
              </div>
            </div>
          </GlassCard>
          <PrimaryButton onClick={run}>Watch Boult work <ArrowRight className="w-4 h-4" /></PrimaryButton>
        </div>
      )}

      {(phase === 'working' || phase === 'done') && (
        <>
          <div ref={scroller} className="lg-card p-5 max-h-[300px] overflow-y-auto space-y-2.5">
            {moments.map((m, i) => (
              <motion.div
                key={i}
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="flex items-start gap-2.5"
              >
                <MomentDot kind={m.kind} />
                <p className={cn('text-[13.5px] leading-snug', m.kind === 'final' ? 'text-[#0A0A0A] font-medium' : 'text-[#0A0A0A]/70')}>
                  {m.text}
                </p>
              </motion.div>
            ))}
            {phase === 'working' && (
              <div className="flex items-center gap-2 text-[13px] text-[#0A0A0A]/40 pt-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> working…
              </div>
            )}
          </div>

          {phase === 'working' && (
            <div className="text-center mt-4">
              <SkipLink onClick={onContinue}>Skip this step</SkipLink>
            </div>
          )}

          {phase === 'done' && (
            <div className="mt-6 text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full lg-pane text-[13px] font-medium text-[#0A0A0A] mb-6 max-w-sm">
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span className="text-left">
                  {drafts > 0
                    ? (drafts === 1 ? '1 draft saved in Gmail — nothing was sent.' : `${drafts} drafts saved in Gmail — nothing was sent.`)
                    : (finalNote || 'Nothing needed a reply right now.')}
                </span>
              </div>
              <div><PrimaryButton onClick={onContinue}>Continue <ArrowRight className="w-4 h-4" /></PrimaryButton></div>
            </div>
          )}
        </>
      )}

      {phase === 'error' && (
        <div className="text-center">
          <Body className="text-[14px] mb-5 max-w-sm mx-auto text-[#0A0A0A]/70">
            {errorDetail || 'That run didn’t finish. Try again — nothing was sent.'}
          </Body>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <PrimaryButton onClick={run}>Try again</PrimaryButton>
            <SkipLink onClick={onContinue}>Skip this step</SkipLink>
          </div>
        </div>
      )}
    </div>
  );
}

function MomentDot({ kind }: { kind: Moment['kind'] }) {
  if (kind === 'final') return <Check className="w-3.5 h-3.5 mt-0.5 text-[#0A0A0A] shrink-0" strokeWidth={2.5} />;
  if (kind === 'decision') return <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-[#0A0A0A]/60 shrink-0" strokeWidth={2.5} />;
  return <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A]/25 mt-[6px] shrink-0" />;
}

function clip(s: string, n = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

function humanTool(name: string): string {
  const map: Record<string, string> = {
    search_gmail: 'Searching your inbox',
    gmail_search: 'Searching your inbox',
    gmail_bulk_read_threads: 'Reading the threads',
    read_email: 'Reading the email',
    gmail_extract_data_from_threads: 'Pulling out what matters',
    gmail_draft_reply: 'Drafting a reply in your voice',
    gmail_batch_draft_replies: 'Drafting replies in your voice',
    create_draft: 'Saving the draft',
    get_voice_profile: 'Matching your writing voice',
    check_draft_quality: 'Checking the draft sounds like you',
  };
  if (map[name]) return map[name];
  if (/draft/i.test(name)) return 'Drafting a reply in your voice';
  if (/search|read/i.test(name)) return 'Reading your inbox';
  return '';
}

/* ═══════════════════════════ 12 · FIRST AGENT (real create, skippable) ═══════════════════════════ */

const AGENT_TEMPLATES = [
  {
    id: 'morning_inbox_sweep', name: 'Morning Inbox Sweep', tagline: 'Wake up to a triaged inbox with drafts ready',
    schedule: 'Daily 7:00 AM', recommended: true,
    plan: ['Read the last 24h of unread email', 'Draft replies in your voice', 'Archive newsletters & promos', 'Log key conversations to Notion'],
  },
  {
    id: 'meeting_prep_concierge', name: 'Meeting Prep Concierge', tagline: 'A prep doc for every external meeting tomorrow',
    schedule: 'Daily 6:00 PM', recommended: false,
    plan: ['Scan tomorrow’s calendar', 'Pull recent emails with each attendee', 'Write a one-page prep doc', 'Add Meet links & buffers'],
  },
  {
    id: 'weekly_executive_brief', name: 'Weekly Executive Brief', tagline: 'A real executive briefing every Friday',
    schedule: 'Friday 4:00 PM', recommended: false,
    plan: ['Aggregate the week’s email & meetings', 'Find revenue wins & client updates', 'Compose a structured briefing', 'Post to Slack & email it'],
  },
];

type AgentTemplate = (typeof AGENT_TEMPLATES)[number];
type Review =
  | { kind: 'template'; template: AgentTemplate }
  | { kind: 'custom'; spec: AgentSpec };

function S12Agent({ spec, setSpec, created, setCreated, onContinue, onSkip }: {
  spec: AgentSpec | null; setSpec: (s: AgentSpec | null) => void;
  created: CreatedAgent | null; setCreated: (c: CreatedAgent | null) => void;
  onContinue: (created: boolean) => void; onSkip: () => void;
}) {
  const [mode, setMode] = useState<'pick' | 'custom' | 'review'>('pick');
  const [review, setReview] = useState<Review | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  // Design the custom agent, then show its plan for approval (don't create yet).
  const designCustom = async () => {
    if (!customPrompt.trim()) return;
    setBusy(true);
    try {
      const g = await fetch('/api/onboarding/generate-agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: customPrompt }),
      });
      const gd = await g.json();
      if (!gd.success || !gd.agent) throw new Error('design failed');
      setSpec(gd.agent);
      setReview({ kind: 'custom', spec: gd.agent });
      setMode('review');
    } catch {
      toast.error("Couldn't design that agent right now — try rephrasing, or do it later.");
    } finally { setBusy(false); }
  };

  // Approve → actually create the real boult_agents row.
  const approve = async () => {
    if (!review) return;
    setBusy(true);
    try {
      let agent: any;
      if (review.kind === 'template') {
        const res = await fetch('/api/boult/agents/templates', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId: review.template.id }),
        });
        const d = await res.json();
        if (!res.ok || !d.agent?.id) throw new Error(d?.error || 'failed');
        agent = d.agent;
      } else {
        const s = review.spec;
        const res = await fetch('/api/boult/agents/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: s.name, task_description: s.task_description,
            cron_schedule: s.cron_schedule, output_channel: s.output_channel,
            slack_channel: null, skip_confirmations: false,
          }),
        });
        const d = await res.json();
        if (!res.ok || !d.agent?.id) throw new Error(d?.error || 'failed');
        agent = d.agent;
      }
      setCreated({ id: agent.id, name: agent.name, scheduleLabel: agent.scheduleLabel || '', nextRun: agent.nextRun, cron: agent.cron });
      onContinue(true);
    } catch {
      toast.error("Couldn't activate that agent right now — you can add it from your dashboard.");
    } finally { setBusy(false); }
  };

  // ── Review / approve ──
  if (mode === 'review' && review) {
    const name = review.kind === 'template' ? review.template.name : review.spec.name;
    const schedule = review.kind === 'template' ? review.template.schedule : review.spec.scheduleLabel;
    const summary = review.kind === 'template' ? review.template.tagline : review.spec.summary;
    const steps = review.kind === 'template' ? review.template.plan : review.spec.steps;
    return (
      <div>
        <div className="text-center mb-7">
          <IconBadge><Sparkles className="w-5 h-5 text-[#0A0A0A]" strokeWidth={1.75} /></IconBadge>
          <Display className="text-[26px] sm:text-[32px] mb-3">Here’s the plan</Display>
          <Body className="text-[15px] max-w-sm mx-auto">Approve to put it on a schedule. Drafts always wait for your sign-off.</Body>
        </div>
        <GlassCard className="mb-5">
          <p className="text-[16px] font-medium text-[#0A0A0A]">{name}</p>
          <p className="text-[13px] text-[#0A0A0A]/55 mt-0.5">{summary}</p>
          <p className="text-[12px] text-[#0A0A0A]/45 mt-2 inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {schedule}</p>
          <ol className="mt-4 pt-4 border-t border-black/[0.06] space-y-2.5">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full lg-pane text-[11px] font-medium grid place-content-center shrink-0 tabular-nums">{i + 1}</span>
                <span className="text-[13.5px] text-[#0A0A0A]/75 leading-snug">{s}</span>
              </li>
            ))}
          </ol>
        </GlassCard>
        <div className="flex items-center justify-center gap-5">
          <PrimaryButton onClick={approve} disabled={busy}>
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Activating…</> : <>Approve & activate <Check className="w-4 h-4" /></>}
          </PrimaryButton>
          <SkipLink onClick={() => { setReview(null); setMode('pick'); }}>Choose another</SkipLink>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-7">
        <IconBadge><Sparkles className="w-5 h-5 text-[#0A0A0A]" strokeWidth={1.75} /></IconBadge>
        <Display className="text-[26px] sm:text-[32px] mb-3">Set your first agent on a schedule</Display>
        <Body className="text-[15px] max-w-sm mx-auto">Pick one to run on its own, or describe your own. You can change it later.</Body>
      </div>

      {mode === 'pick' ? (
        <div className="space-y-2.5">
          {AGENT_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => { setReview({ kind: 'template', template: t }); setMode('review'); }}
              className={cn(
                'lg-focus w-full text-left lg-card p-5 flex items-center gap-4 transition-transform active:scale-[0.99]',
                t.recommended && 'lg-pulse',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-medium text-[#0A0A0A]">{t.name}</p>
                  {t.recommended && <span className="text-[9px] uppercase tracking-[0.12em] font-bold text-[#0A0A0A]/45">Recommended</span>}
                </div>
                <p className="text-[12.5px] text-[#0A0A0A]/50 mt-0.5">{t.tagline}</p>
                <p className="text-[11.5px] text-[#0A0A0A]/40 mt-1.5 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {t.schedule}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-[#0A0A0A]/30" />
            </button>
          ))}
          <button onClick={() => setMode('custom')} className="lg-focus w-full text-center py-3 text-[13.5px] font-medium text-[#0A0A0A]/55 hover:text-[#0A0A0A] transition-colors">
            Describe your own
          </button>
        </div>
      ) : (
        <div>
          <div className="lg-card p-5 focus-within:border-black/20">
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="e.g. Every morning, triage my inbox and draft replies in my voice."
              rows={4}
              className="w-full bg-transparent border-none text-[15px] text-[#0A0A0A] placeholder:text-[#0A0A0A]/35 focus:outline-none resize-none leading-relaxed"
            />
          </div>
          <div className="flex items-center justify-center gap-5 mt-5">
            <PrimaryButton onClick={designCustom} disabled={!customPrompt.trim() || busy}>
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Designing…</> : <>Design agent <ArrowRight className="w-4 h-4" /></>}
            </PrimaryButton>
            <SkipLink onClick={() => setMode('pick')}>Back to templates</SkipLink>
          </div>
        </div>
      )}

      <div className="text-center mt-6">
        <SkipLink onClick={onSkip}>I’ll do this later</SkipLink>
      </div>
    </div>
  );
}

/* ═══════════════════════════ 13 · CHOOSE PLAN ═══════════════════════════ */

const PLAN_FEATURES = [
  'Full inbox triage & drafting in your voice',
  'Boult operator + scheduled agents',
  'Live Notion, Calendar & Slack sync',
  'Approval queue — you sign off on every send',
];

const PLAN_PRICING: Record<PlanChoice, { label: string; price: string; unit: string; sub: string; badge?: string }> = {
  weekly:   { label: 'Weekly',   price: '$8.99',   unit: '/wk',          sub: 'Billed weekly · cancel anytime', badge: 'Try it out' },
  monthly:  { label: 'Monthly',  price: '$29',     unit: '/mo',          sub: 'Billed monthly' },
  annual:   { label: 'Annual',   price: '$16.58',  unit: '/mo',          sub: '$199/year · 2 months free', badge: '2 months free' },
  lifetime: { label: 'Lifetime', price: '$499',    unit: ' once',        sub: 'Pay once. Yours forever.',  badge: 'Best value' },
};

function S13Plan({ firstName, plan, onChoose }: { firstName: string; plan: PlanChoice | null; onChoose: (p: PlanChoice) => void }) {
  const [selected, setSelected] = useState<PlanChoice>(plan || 'monthly');
  const p = PLAN_PRICING[selected];
  // PAYWALL-INTENT FUNNEL: step 13 is where money lives or dies. This event
  // + paywall_plan_chosen + checkout_started + checkout_paid_verified (S15)
  // give the funnel: viewed -> picked plan -> reached Polar -> actually paid.
  useEffect(() => {
    try { posthog.capture('paywall_viewed', { step: 13 }); } catch { /* analytics never blocks */ }
  }, []);
  return (
    <div>
      <div className="text-center mb-8">
        <Display className="text-[28px] sm:text-[36px] mb-3">{firstName ? `Activate Boult, ${firstName}.` : 'Activate Boult.'}</Display>
        <Body className="text-[15px] max-w-md mx-auto">Your first employee shouldn&apos;t cost $80,000 a year. This one costs $29 a month — and it starts tonight, running on its schedule the moment you&apos;re in.</Body>
      </div>

      <div className="flex justify-center mb-7">
        <div className="lg-capsule !p-1 flex gap-1 rounded-full">
          {(['weekly', 'monthly', 'annual', 'lifetime'] as const).map((opt) => {
            const active = selected === opt;
            return (
              <button
                key={opt}
                onClick={() => setSelected(opt)}
                className={cn('lg-focus relative rounded-full px-4 py-2 text-[12.5px] font-medium transition-colors', active ? 'text-white' : 'text-[#0A0A0A]/55')}
              >
                {active && <motion.span layoutId="plan-toggle" className="absolute inset-0 rounded-full bg-[#0A0A0A]" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />}
                <span className="relative z-10">{PLAN_PRICING[opt].label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <GlassCard className="max-w-md mx-auto text-center">
        {/* Badge was defined in PLAN_PRICING but never rendered — the annual
            and lifetime nudges were invisible at the exact moment they matter. */}
        {p.badge && (
          <div className="inline-flex items-center px-2.5 py-0.5 mb-2 rounded-full bg-[#0A0A0A] text-white text-[11px] font-semibold tracking-wide">
            {p.badge}
          </div>
        )}
        <div className="flex items-baseline justify-center mb-1">
          <span className="text-[48px] font-medium tracking-tight text-[#0A0A0A]">{p.price}</span>
          <span className="text-[13px] text-[#0A0A0A]/50 ml-2">{p.unit}</span>
        </div>
        <p className="text-[12px] text-[#0A0A0A]/45 mb-2">{p.sub}</p>
        {selected === 'monthly' && (
          <div className="inline-flex items-center gap-1.5 mb-6 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <Sparkles className="w-3 h-3 text-emerald-600" strokeWidth={2.5} />
            <span className="text-[12px] font-semibold text-emerald-700">3 days free, then $29/mo — cancel anytime</span>
          </div>
        )}
        {selected !== 'monthly' && <div className="mb-4" />}

        <ul className="space-y-3 text-left mb-7">
          {PLAN_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2.5">
              <span className="w-[18px] h-[18px] rounded-full lg-pane grid place-content-center mt-0.5 shrink-0"><Check className="w-3 h-3 text-[#0A0A0A]" strokeWidth={2.5} /></span>
              <span className="text-[13.5px] text-[#0A0A0A]/75 leading-snug">{f}</span>
            </li>
          ))}
          <li className="flex items-start gap-2.5">
            <span className="w-[18px] h-[18px] rounded-full lg-pane grid place-content-center mt-0.5 shrink-0"><Sparkles className="w-3 h-3 text-[#0A0A0A]" strokeWidth={2.5} /></span>
            <span className="text-[13.5px] text-[#0A0A0A] font-medium leading-snug">Your agent deploys & runs automatically</span>
          </li>
        </ul>

        {/* The CTA carries the risk-reversal, not just the plan name — "Start
            3-day free trial" converts; "Continue with Monthly" reads like a
            commitment. */}
        <PrimaryButton onClick={() => onChoose(selected)} className="w-full">
          {selected === 'weekly'
            ? <>Continue with Weekly <ArrowRight className="w-4 h-4" /></>
            : selected === 'monthly'
              ? <>Start 3-day free trial <ArrowRight className="w-4 h-4" /></>
              : selected === 'annual'
                ? <>Continue with Annual <ArrowRight className="w-4 h-4" /></>
                : <>Get lifetime access <ArrowRight className="w-4 h-4" /></>}
        </PrimaryButton>
        <p className="text-[11.5px] text-[#0A0A0A]/40 mt-3">
          {selected === 'lifetime'
            ? 'Secure checkout · One-time payment'
            : selected === 'monthly'
              ? 'Secure Polar checkout · Card required · Not charged for 3 days · Cancel anytime'
              : 'Secure checkout · Cancel anytime'}
        </p>
      </GlassCard>
    </div>
  );
}

/* ═══════════════════════════ 14 · NOTIFICATIONS ═══════════════════════════ */

function S14Notifications({ time, setTime, channel, setChannel, hasSlack, agent, onUpdate, onContinue }: {
  time: string; setTime: (t: string) => void;
  channel: 'gmail' | 'slack' | 'both'; setChannel: (c: 'gmail' | 'slack' | 'both') => void;
  hasSlack: boolean; agent: CreatedAgent | null; onUpdate: (a: CreatedAgent) => void; onContinue: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const channels: Array<{ id: 'gmail' | 'slack' | 'both'; label: string; disabled?: boolean }> = [
    { id: 'gmail', label: 'Gmail' },
    { id: 'slack', label: 'Slack', disabled: !hasSlack },
    { id: 'both', label: 'Both', disabled: !hasSlack },
  ];

  const save = async () => {
    setSaving(true);
    // Make the preference real: retarget the created agent's briefing TIME +
    // channel while preserving its cadence (a weekly digest stays weekly).
    // Only update what we show (next run / label) if the PATCH actually
    // succeeds, so S15 never displays a schedule the backend didn't accept.
    if (agent?.id) {
      const newCron = setCronTime(agent.cron, time);
      try {
        const res = await fetch('/api/boult/agents', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: agent.id, cron_schedule: newCron, output_channel: channel }),
        });
        if (res.ok) {
          const nextRun = nextRunFromCron(newCron) || nextDailyOccurrence(time);
          onUpdate({ ...agent, cron: newCron, nextRun });
        }
      } catch { /* preference still persisted via state patch on continue */ }
    }
    setSaving(false);
    onContinue();
  };

  return (
    <div>
      <div className="text-center mb-7">
        <IconBadge><Clock className="w-5 h-5 text-[#0A0A0A]" strokeWidth={1.75} /></IconBadge>
        <Display className="text-[26px] sm:text-[32px] mb-3">When’s your briefing?</Display>
        <Body className="text-[15px] max-w-sm mx-auto">Pick a time and where it lands. That’s it.</Body>
      </div>

      <GlassCard className="max-w-sm mx-auto space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[#0A0A0A]/40 mb-2.5">Morning briefing at</p>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="lg-focus w-full bg-white/60 border border-black/[0.08] rounded-xl px-4 py-3 text-[16px] font-medium text-[#0A0A0A]"
          />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[#0A0A0A]/40 mb-2.5">Deliver to</p>
          <div className="grid grid-cols-3 gap-2">
            {channels.map((c) => (
              <button
                key={c.id}
                disabled={c.disabled}
                onClick={() => setChannel(c.id)}
                className={cn(
                  'lg-focus rounded-xl py-2.5 text-[13px] font-medium border transition-all',
                  channel === c.id ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'bg-white/50 text-[#0A0A0A]/70 border-black/[0.08] hover:border-black/20',
                  c.disabled && 'opacity-35 cursor-not-allowed',
                )}
                title={c.disabled ? 'Connect Slack to use this' : undefined}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>

      <div className="text-center mt-7">
        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <>Continue <ArrowRight className="w-4 h-4" /></>}
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ═══════════════════════════ 15 · YOU'RE ALL SET ═══════════════════════════ */

function S15Done({ firstName, agent, scan, briefTime, briefChannel, plan, onFinish }: {
  firstName: string; agent: CreatedAgent | null; scan: ScanResult | null;
  briefTime: string; briefChannel: 'gmail' | 'slack' | 'both'; plan: PlanChoice | null;
  onFinish: () => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Did we just come back from a successful Polar checkout? /payment-success
  // returns the user to /onboarding?step=15&paid=1 after verifying payment.
  const paid = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('paid') === '1';

  const finish = async () => {
    setBusy(true);
    // Returned from checkout (?paid=1)? The param alone is NOT proof — verify the
    // real subscription server-side before letting them into the app. A verified
    // paid/active plan → in. Otherwise (incl. abandoned checkout) → back to the
    // paywall at step 13; never grant access on an unverified URL param.
    if (paid) {
      try {
        const r = await fetch(`/api/subscription/status?t=${Date.now()}`);
        const d = r.ok ? await r.json() : null;
        const pt = d?.subscription?.planType;
        const isPaid = !!pt && pt !== 'free' && pt !== 'none' && !d?.subscription?.isExpired;
        if (isPaid) {
          try { posthog.capture('checkout_paid_verified', { plan: pt }); } catch { /* */ }
          // Payment verified — NOW mark onboarding complete. Doing this before
          // verification was the root cause of unpaid users being flagged as
          // "completed" and slipping through the redirect API.
          await onFinish();
          router.push('/home-feed');
          return;
        }
      } catch { /* fall through to paywall */ }
      try { posthog.capture('checkout_return_unpaid'); } catch { /* */ }
      setBusy(false);
      router.replace('/onboarding?step=13');
      return;
    }
    // No plan chosen yet → send them to pick one (the paywall), not into the app.
    if (!plan) {
      setBusy(false);
      router.replace('/onboarding?step=13');
      return;
    }
    // Send to Polar checkout, remembering where to come back to so the user
    // lands right here (paid) afterward instead of the dashboard.
    // Do NOT call onFinish here — onboarding is only "complete" after payment.
    try {
      localStorage.setItem('pending_plan', plan);
      localStorage.setItem('maily_checkout_return', '/onboarding?step=15&paid=1');
    } catch { /* */ }
    try { posthog.capture('checkout_started', { plan }); } catch { /* */ }

    // Prefer a server-created Polar checkout SESSION (correct org via our access
    // token, email prefilled so the webhook maps the payment to THIS account,
    // reliable success_url + user_id metadata). This is the fix for "21 started,
    // 0 completed" — the static links below leave nowhere real to land and no way
    // to attribute the payment. Fall back to the static link ONLY if the session
    // call fails, so this can never regress below current behaviour.
    try {
      const r = await fetch('/api/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.url) {
        window.location.href = d.url;
        return;
      }
      console.error('[checkout] session create failed — falling back to static link:', d);
    } catch (e) {
      console.error('[checkout] session create threw — falling back to static link:', e);
    }
    window.location.href = POLAR_CHECKOUT_URLS[plan];
  };

  const channelLabel = briefChannel === 'both' ? 'Gmail + Slack' : briefChannel === 'slack' ? 'Slack' : 'Gmail';

  return (
    <div className="text-center">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <IconBadge><Check className="w-5 h-5 text-[#0A0A0A]" strokeWidth={2} /></IconBadge>
      </motion.div>

      <Display className="text-[32px] sm:text-[42px] mb-4">{paid ? 'Boult is on duty.' : 'One step to go live.'}</Display>
      <Body className="text-[15.5px] max-w-md mx-auto mb-8">
        {paid
          ? `${firstName ? `You're set, ${firstName}. ` : ''}Your agent runs on its schedule and everything waits for your approval before it sends. Go build — we'll handle the inbox.`
          : plan === 'weekly'
            ? `${firstName ? `Almost there, ${firstName}. ` : ''}$8.99 a week, cancel whenever you like. Tomorrow morning: one briefing, not an inbox.`
          : plan === 'monthly'
            ? `${firstName ? `Almost there, ${firstName}. ` : ''}Start your 3-day free trial — no charge today, cancel anytime. Tomorrow morning: one briefing, not an inbox.`
            : `${firstName ? `Almost there, ${firstName}. ` : ''}Subscribe and your agent deploys tonight. Tomorrow morning: one briefing, not an inbox. Everything waits for your approval.`}
      </Body>

      <GlassCard className="max-w-sm mx-auto text-left space-y-4 mb-9">
        <SummaryRow icon={<Mail className="w-4 h-4" />} label="Inbox" value="Connected" />
        {agent ? (
          <>
            <SummaryRow icon={<Sparkles className="w-4 h-4" />} label="First agent" value={agent.name} />
            <SummaryRow
              icon={<Clock className="w-4 h-4" />}
              label="First run"
              value={`${agent.nextRun ? new Date(agent.nextRun).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : prettyTime(briefTime)} · ${channelLabel}`}
            />
          </>
        ) : (
          <SummaryRow icon={<Sparkles className="w-4 h-4" />} label="First agent" value="None yet — add one from your dashboard" />
        )}
        {scan?.hoursPerWeek != null && <SummaryRow icon={<Activity className="w-4 h-4" />} label="Taking off your plate" value={`~${scan.hoursPerWeek}h / week`} />}
        {/* The user is one click from a payment page — the price they'll see
            there must be on THIS screen, or Polar's total reads as a surprise. */}
        {!paid && plan && (
          <SummaryRow
            icon={<Check className="w-4 h-4" />}
            label="Plan"
            value={plan === 'weekly' ? 'Weekly — $8.99/week' : plan === 'monthly' ? '3 days free, then $29/mo' : plan === 'annual' ? 'Annual — $199/year' : 'Lifetime — $499 once'}
          />
        )}
      </GlassCard>

      <PrimaryButton onClick={finish} disabled={busy} className="px-8 py-3.5 text-[15px]">
        {busy
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening…</>
          : paid
            ? <>Go to Maily <ArrowRight className="w-4 h-4" /></>
            : !plan
              // Without a plan this button routes to the paywall — say so.
              // "Go to Maily" that lands on a pricing screen reads as a trick.
              ? <>Choose your plan <ArrowRight className="w-4 h-4" /></>
              : plan === 'weekly'
                ? <>Start Weekly <ArrowRight className="w-4 h-4" /></>
              : plan === 'monthly'
                ? <>Start 3-day free trial <ArrowRight className="w-4 h-4" /></>
                : <>Subscribe &amp; deploy <ArrowRight className="w-4 h-4" /></>}
      </PrimaryButton>

      {!paid && plan && (
        <div className="mt-4 flex flex-col items-center gap-1.5">
          <p className="text-[11.5px] text-[#0A0A0A]/40">
            {plan === 'monthly' ? 'No charge today · Secure checkout · Cancel anytime' : plan === 'lifetime' ? 'Secure checkout · One-time payment' : 'Secure checkout · Cancel anytime'}
          </p>
          <SkipLink onClick={() => router.replace('/onboarding?step=13')}>Change plan</SkipLink>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl lg-pane flex items-center justify-center text-[#0A0A0A]/70 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[#0A0A0A]/40">{label}</p>
        <p className="text-[14px] font-medium text-[#0A0A0A] truncate">{value}</p>
      </div>
    </div>
  );
}
