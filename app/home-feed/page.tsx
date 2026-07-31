"use client";

import { useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import SiftToday from '@/components/ui/sift-today';
import { CommandCenter } from '@/components/ui/command-center';
import { GmailInterfaceFixed } from '@/components/ui/gmail-interface-fixed';
import { PricingOverlay } from '@/components/ui/pricing-overlay';
import { FloatingNavbar } from "@/components/FloatingNavbar";
import confetti from 'canvas-confetti';
import { useState, useCallback } from 'react';
import { Sparkles, Inbox } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { HomeFeedSidebar } from '@/components/ui/home-feed-sidebar';
import { SettingsCard } from '@/components/ui/settings-card';
import { HelpCard } from '@/components/ui/help-card';
import { RewardsCard } from '@/components/ui/rewards-card';

type TabId = 'today' | 'inbox';

function HomeFeedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const [showPricing, setShowPricing] = useState(false);
  // PAYWALL: the AUTHORITATIVE gate is server-side (home-feed/layout.tsx,
  // force-dynamic requirePaidSubscription) — an unpaid user gets an HTTP
  // redirect and never receives this component. So the client renders
  // immediately (no blank backdrop / double-check delay) and the subscription
  // re-check below runs as a BACKGROUND revalidation only: if a plan lapsed
  // mid-session it flips this to false and redirects. Do NOT reintroduce a
  // client-side localStorage grant — the server gate is the source of truth.
  const [accessGranted, setAccessGranted] = useState(true);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const verifyRanRef = useRef(false);
  const [paymentVerified, setPaymentVerified] = useState(false);
  const [activatedPlan, setActivatedPlan] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showRewards, setShowRewards] = useState(false);
  const [usageData, setUsageData] = useState<any>(null);

  // Fetch usage for Rewards card
  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const res = await fetch('/api/subscription/usage');
        if (res.ok) {
          const data = await res.json();
          setUsageData({
            planType: data.planType || 'none',
            features: data.features || {}
          });
        }
      } catch (e) {
        console.warn('Failed to fetch usage', e);
      }
    };
    fetchUsage();
  }, []);

  // PART 69 — Tab is URL-backed (?tab=inbox) so reload preserves the
  // user's last choice. Defaults to 'today' when no tab param is present.
  const tabFromUrl = searchParams.get('tab');
  const initialTab: TabId = tabFromUrl === 'inbox' ? 'inbox' : 'today';
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  const switchTab = useCallback((next: TabId) => {
    setActiveTab(next);
    // Mirror to URL without scrolling or triggering a full nav.
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (next === 'today') params.delete('tab');
    else params.set('tab', next);
    const q = params.toString();
    const url = q ? `?${q}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [searchParams]);

  // Command Center's "Draft reply" hands off here when a thread ALREADY has a
  // Gmail draft — instead of sending a redundant prompt to Arcus, stash the
  // existing draft's content for the Inbox tab's own draft-reply box to pick
  // up (mirrors the established 'arcus_prefill' sessionStorage handoff), then
  // switch tabs so the user lands right on it, ready to review and send.
  const openExistingDraft = useCallback((draft: { threadId: string; to: string; subject: string; body: string; isHtml: boolean }) => {
    try { sessionStorage.setItem('hf_open_draft', JSON.stringify(draft)); } catch { /* incognito */ }
    switchTab('inbox');
  }, [switchTab]);

  // Check authentication, subscription status, and onboarding status
  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated") {
      router.push("/auth/signin");
      return;
    }

    if (status === "authenticated" && session?.user?.email) {
      // Run the access check exactly once per mount. NextAuth can hand us a new
      // `session` object reference on re-render; without this guard the effect
      // re-fires and spins up overlapping polling loops — the "stuck in a loop"
      // the user saw in the console.
      if (verifyRanRef.current) return;
      verifyRanRef.current = true;

      const checkAccessAndSubscription = async () => {
        try {
          // Detect if user might have just returned from payment or activation
          const mightHaveJustPaid = () => {
            // Check if we already verified in this tab session to prevent infinite reload loops
            const alreadyVerified = sessionStorage.getItem('activation_verified_this_session');
            if (alreadyVerified === 'true') return false;

            const referrer = document.referrer || '';
            const pendingPlan = localStorage.getItem('pending_plan');
            const pendingTimestamp = localStorage.getItem('pending_plan_timestamp');

            const isFromPayment = referrer.includes('polar.sh') ||
              referrer.includes('whop.com') ||
              referrer.includes('/payment-success');

            const hasPendingPlan = pendingPlan && pendingTimestamp &&
              (Date.now() - parseInt(pendingTimestamp)) < 10 * 60 * 1000; // 10 min window

            return isFromPayment || !!hasPendingPlan;
          };

          const justPaid = mightHaveJustPaid();
          if (justPaid) {
            setIsVerifyingPayment(true);
          }

          const maxRetries = justPaid ? 20 : 1; // 20 retries x 3s = 60 seconds
          const retryDelay = 3000;
          let triedVerify = false; // one-shot Polar reconcile before denying

          console.log('📡 [HomeFeed] Checking subscription status...', { justPaid, maxRetries });

          for (let attempt = 0; attempt < maxRetries; attempt++) {
            if (attempt > 0) {
              console.log(`⏳ [HomeFeed] Polling attempt ${attempt}/${maxRetries - 1}...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            }

            try {
              // Cache busting
              const subResponse = await fetch(`/api/subscription/status?t=${Date.now()}`);
              if (!subResponse.ok) throw new Error(`Status API error: ${subResponse.status}`);
              
              const subData = await subResponse.json();
              const isExpired = subData.subscription?.isExpired;
              const planType = subData.subscription?.planType;
              // STRICT: `hasActiveSubscription` is polluted (it returns true for
              // free users), so it CANNOT gate access. The real signal is a paid
              // or trial plan type — 'pro'/'starter'/'annual'/'lifetime' (a trial
              // reports as 'pro'). 'free'/'none' never grants access.
              const isPaidPlan = !!planType && planType !== 'free' && planType !== 'none';

              // CASE 1: SUCCESSFUL ACTIVATION (just checked out + real plan + not expired)
              const isSuccess = justPaid && !isExpired && isPaidPlan;
              
              if (isSuccess) {
                console.log('🎉 [HomeFeed] Activation confirmed!', planType);
                localStorage.setItem('onboarding_completed', 'true');
                sessionStorage.setItem('activation_verified_this_session', 'true');
                try { localStorage.setItem('mailient_access_ok', String(Date.now())); sessionStorage.removeItem('mailient_access_denied'); } catch {}
                localStorage.removeItem('pending_plan');
                localStorage.removeItem('pending_plan_timestamp');
                setPaymentVerified(true);

                // Specific plan name for UI
                const planName = planType === 'starter' ? 'Starter' : planType === 'pro' ? 'Pro' : 'Free';
                setActivatedPlan(planName);

                // Grant access directly — NO page reload. The reload was the source
                // of the stuck "Activating…" loop: a reload re-ran this effect and,
                // on slow webhook propagation, could re-enter verification. Showing
                // the success state then revealing the app in-place is loop-proof.
                setAccessGranted(true);
                setTimeout(() => {
                  setIsVerifyingPayment(false);
                  setPaymentVerified(false);
                }, 2500);
                return; // Stop polling
              }

              // CASE 2: STILL PENDING (Either expired or not yet active but we just paid)
              if (justPaid && attempt < maxRetries - 1) {
                console.log('⏳ [HomeFeed] Waiting for state update...');
                continue; // Next attempt
              }

              // CASE 3 — STRICT ACCESS: paid-only. Access requires a real paid or
              // trial plan from a completed Polar checkout. No free tier.
              if (isPaidPlan && !isExpired) {
                localStorage.setItem('onboarding_completed', 'true');
                try { localStorage.setItem('mailient_access_ok', String(Date.now())); sessionStorage.removeItem('mailient_access_denied'); sessionStorage.removeItem('hf_sent_onboarding'); } catch {}
                setIsVerifyingPayment(false);
                setShowPricing(false);
                setAccessGranted(true);
                return; // Access allowed, stop polling
              }

              // CASE 4 — not subscribed (free) OR expired → must subscribe. Finish
              // onboarding first if it isn't done, otherwise send to the paywall.
              if (attempt === maxRetries - 1) {
                // SELF-HEAL: the user may have a real Polar subscription that the
                // webhook failed to sync to our DB (exactly the "trial active in
                // Polar but dashboard says no subscription" case). Reconcile
                // directly with Polar ONCE before denying. /api/subscription/verify
                // queries Polar by email and writes the row if it finds an
                // active/trialing sub.
                if (!triedVerify) {
                  triedVerify = true;
                  console.log('🩺 [HomeFeed] No sub in DB — reconciling with Polar…');
                  try {
                    const vr = await fetch('/api/subscription/verify', { method: 'POST' });
                    const vd = await vr.json().catch(() => ({}));
                    const vPlan = vd?.subscription?.planType;
                    if (vr.ok && vd?.success && vPlan && vPlan !== 'free' && vPlan !== 'none') {
                      console.log('✅ [HomeFeed] Reconciled from Polar:', vPlan);
                      localStorage.setItem('onboarding_completed', 'true');
                      try { localStorage.setItem('mailient_access_ok', String(Date.now())); sessionStorage.removeItem('mailient_access_denied'); sessionStorage.removeItem('hf_sent_onboarding'); } catch {}
                      setIsVerifyingPayment(false);
                      setShowPricing(false);
                      setAccessGranted(true);
                      return; // healed — access granted
                    }
                    console.log('🔎 [HomeFeed] Polar reconcile found nothing active.');
                  } catch (e) {
                    console.warn('[HomeFeed] Polar reconcile failed:', e);
                  }
                }

                setIsVerifyingPayment(false);
                // Remember this tab is unsubscribed AND revoke the durable access
                // marker so the next visit starts blocked (fail closed), not optimistic.
                try { sessionStorage.setItem('mailient_access_denied', '1'); localStorage.removeItem('mailient_access_ok'); } catch {}
                setAccessGranted(false);
                console.log('🔒 [HomeFeed] No active subscription — sending to paywall (onboarding step 13).');
                // Unpaid users always land on the single paywall surface: onboarding
                // step 13. Onboarding parks them there (it won't bounce back here
                // unpaid), so there's no ping-pong to guard against.
                router.replace('/onboarding?step=13');
                return;
              }

            } catch (err) {
              console.error('⚠️ Polling error:', err);
              if (attempt === maxRetries - 1) {
                // Fail closed: can't verify → deny. A transient error should
                // not grant access to an unconfirmed user.
                setIsVerifyingPayment(false);
                try { sessionStorage.setItem('mailient_access_denied', '1'); localStorage.removeItem('mailient_access_ok'); } catch {}
                setAccessGranted(false);
                console.log('🔒 [HomeFeed] API error on final attempt — failing closed.');
                router.replace('/onboarding?step=13');
                return;
              }
            }
          }
        } catch (error) {
          console.error("Error in home-feed init:", error);
          setIsVerifyingPayment(false);
        }
      };
      
      checkAccessAndSubscription();
    }
  }, [status, session, router]);

  // Set page title
  useEffect(() => {
    document.title = 'Mailient - AI Inbox';
  }, []);

  // Check for welcome query param and trigger confetti (reuses searchParams
  // already declared above for the tab state).
  useEffect(() => {
    const welcome = searchParams.get('welcome');
    if (welcome === 'true') {
      const duration = 3 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval = setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        const sparkleConfig = {
          ...defaults,
          particleCount,
          colors: ['#ffffff', '#ffffff', '#e4e4e7', '#d4d4d8', '#18181b'], // Heavily weighted towards white/silver for "shine"
          shapes: ['star', 'circle'] as any,
          scalar: 1.2,
          gravity: 0.8, // Floating effect
          drift: 0,
        };

        confetti({
          ...sparkleConfig,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
        });
        confetti({
          ...sparkleConfig,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
        });
      }, 250);

      // Clean up the URL parameter
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('welcome');
      window.history.replaceState({}, '', newUrl.toString());
    }
  }, [searchParams]);

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push("/");
  };

  // STRICT paywall — the full app is NEVER rendered until access is confirmed.
  // Two states before access is granted:
  //   1. Verifying payment (just came from checkout): show activation overlay only.
  //   2. Not verifying: redirect is already firing; show blank backdrop.
  // The success animation (checkmark) plays inside the full-app render after
  // accessGranted flips to true (React batches setAccessGranted + setPaymentVerified
  // together so the spinner → success transition is seamless).
  if (!accessGranted) {
    if (isVerifyingPayment) {
      return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6">
          <div className="relative">
            <div className="w-16 h-16 border-2 border-neutral-200 dark:border-white/5 rounded-full" />
            <div className="absolute inset-0 w-16 h-16 border-t-2 border-white rounded-full animate-spin" />
          </div>
          <div className="space-y-2 text-center">
            <h2 className="text-xl font-serif text-white">Activating your subscription</h2>
            <p className="text-neutral-500 text-sm max-w-[280px] leading-relaxed">
              We&apos;re confirming your payment with Polar.<br/>This will only take a moment.
            </p>
          </div>
        </div>
      );
    }
    return <div className="min-h-screen bg-arcus-bg" />;
  }

  return (
    <div className="satoshi-home-feed w-full min-h-screen bg-arcus-bg relative flex">
      <HomeFeedSidebar 
        onCollapse={setIsSidebarCollapsed} 
        onOpenSettings={() => setShowSettings(true)}
        onOpenHelp={() => setShowHelp(true)}
        onOpenRewards={() => setShowRewards(true)}
      />
      {/* Margins must equal the sidebar's real widths (72px collapsed / 260px
          expanded) — ml-20/ml-64 (80/256) left an 8px gap / 4px overlap. */}
      <div className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-300 ${isSidebarCollapsed ? 'md:ml-[72px]' : 'md:ml-[260px]'}`}>
        {/* Tab bar — Today (Sift decision queue) | Inbox (traditional view).
          PART 69: sliding pill highlight via Framer layoutId so the
          selected-tab background animates between buttons instead of
          snapping. */}
      {/* Liquid Glass tab switcher — a floating glass pill over the feed
          (iOS 26 style: refraction rim + blur, no full-width solid bar).
          The wrapper stays sticky but is invisible; only the pill floats. */}
      <div className="sticky top-0 z-30 pointer-events-none">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-center">
          <div className="pointer-events-auto relative inline-flex items-center gap-1 p-1 rounded-full liquid-glass">
            {([
              { id: 'today' as TabId, Icon: Sparkles, label: 'Today' },
              { id: 'inbox' as TabId, Icon: Inbox,    label: 'Inbox' },
            ]).map(({ id, Icon, label }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => switchTab(id)}
                  className={`relative inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12.5px] font-medium transition-colors duration-200 ${
                    isActive
                      ? '!text-white dark:!text-black'
                      : 'text-neutral-500 hover:text-black dark:hover:text-white'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="home-tab-pill"
                      className="absolute inset-0 rounded-full !bg-black dark:!bg-white"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 relative z-10" strokeWidth={2} />
                  <span className="relative z-10">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Animated tab body. Crossfade + tiny vertical slide so the swap
          feels intentional, not a hard cut. AnimatePresence mode="wait"
          ensures the outgoing panel finishes its exit before the incoming
          mounts — prevents layout overlap during the transition. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          {activeTab === 'today'
            ? <CommandCenter userName={(session?.user?.name || '').trim().split(/\s+/)[0] || undefined} onOpenExistingDraft={openExistingDraft} />
            : <GmailInterfaceFixed forceTraditionalView />}
        </motion.div>
      </AnimatePresence>
      <FloatingNavbar />
      
      {isVerifyingPayment && (
          <div className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center gap-6">
              {!paymentVerified ? (
                  <>
                      <div className="relative">
                          <div className="w-16 h-16 border-2 border-neutral-200 dark:border-white/5 rounded-full" />
                          <div className="absolute inset-0 w-16 h-16 border-t-2 border-white rounded-full animate-spin" />
                      </div>
                      <div className="space-y-2 text-center">
                          <h2 className="text-xl font-serif text-white">Activating your subscription</h2>
                          <p className="text-neutral-500 text-sm max-w-[280px] leading-relaxed">
                              We&apos;re confirming your payment with Polar.<br/>This will only take a moment.
                          </p>
                      </div>
                  </>
              ) : (
                  <>
                      <div className="relative flex items-center justify-center">
                          <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center" style={{ animation: 'scaleIn 0.4s ease-out' }}>
                              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ animation: 'checkDraw 0.5s ease-out 0.2s both' }}>
                                  <path d="M8 18L15 25L28 11" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                          </div>
                      </div>
                      <div className="space-y-2 text-center">
                          <h2 className="text-xl font-serif text-white">You&apos;re all set!</h2>
                          <p className="text-neutral-500 text-sm">
                              {activatedPlan} plan activated successfully.
                          </p>
                      </div>
                  </>
              )}
              <style jsx>{`
                  @keyframes scaleIn {
                      from { transform: scale(0); opacity: 0; }
                      to { transform: scale(1); opacity: 1; }
                  }
                  @keyframes checkDraw {
                      from { opacity: 0; transform: scale(0.5); }
                      to { opacity: 1; transform: scale(1); }
                  }
              `}</style>
          </div>
      )}
      
        {!isVerifyingPayment && <PricingOverlay isOpen={showPricing} onClose={() => setShowPricing(false)} />}

        <AnimatePresence>
          {showSettings && (
            <SettingsCard 
              onClose={() => setShowSettings(false)} 
              onOpenHelp={() => setShowHelp(true)} 
            />
          )}
          {showHelp && <HelpCard onClose={() => setShowHelp(false)} />}
          {showRewards && (
            <RewardsCard
              onClose={() => setShowRewards(false)}
              usageData={usageData || {
                planType: 'free',
                features: {
                  arcus_ai: { usage: 0, limit: 10, remaining: 10, isUnlimited: false, period: 'daily' },
                  sift_ai: { usage: 0, limit: 5, remaining: 5, isUnlimited: false, period: 'daily' }
                }
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function HomeFeed() {
  return (
    <Suspense fallback={
      // Themed fallback — bg-arcus-bg adapts to light/dark and matches the app
      // ground, so the loading moment never flashes a hardcoded black screen
      // before the feed paints. (Was bg-black: jarring on the light theme and
      // even on dark it flashed pure #000 over the app's #0D0D0D + white cards.)
      <div className="w-full bg-arcus-bg flex items-center justify-center" style={{ height: '100dvh' }}>
        <div className="h-7 w-7 rounded-full border-2 border-neutral-500/25 border-t-neutral-500 animate-spin" />
      </div>
    }>
      <HomeFeedContent />
    </Suspense>
  );
}

