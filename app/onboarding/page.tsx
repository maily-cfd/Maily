"use client";

import { useEffect, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import SiftOnboardingPage from "./sift-onboarding";
import posthog from "posthog-js";

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  // Guard: NextAuth can emit a new session object reference on re-renders even
  // when nothing changed. Without this, checkOnboardingStatus re-fires, sees
  // the URL already at step 14/15 (written by replaceState), and bounces the
  // user back to step 13 while they're mid-checkout. Run exactly once.
  const statusCheckedRef = useRef(false);

  // Redirect if not authenticated or if onboarding is already completed
  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated") {
      router.push("/auth/signin");
      return;
    }

    // Check if onboarding is already completed
    if (status === "authenticated" && session?.user?.email) {
      if (statusCheckedRef.current) return;
      statusCheckedRef.current = true;

      const userEmail = session?.user?.email;
      console.log(`📋 [Onboarding] Checking status for: ${userEmail}`);

      // Identify user in PostHog
      posthog.identify(userEmail, {
        email: userEmail,
        name: session.user.name || undefined,
      });

      // Capture login event
      posthog.capture('user_logged_in', {
        email: userEmail,
      });

      const checkOnboardingStatus = async () => {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const forceRedo = urlParams.get('force') === 'true';
          const currentStep = urlParams.get('step');

          if (forceRedo) {
            console.log('🚀 [Onboarding] Force re-do detected. Skipping status checks.');
            localStorage.removeItem('onboarding_completed');
            return;
          }

          // Just returned from checkout (?paid=1) on step 15 — let the onboarding
          // component own verification (it re-checks the subscription, with retry
          // for webhook lag). Bouncing here would steal them off step 15 on a race.
          if (urlParams.get('paid') === '1') {
            console.log('💳 [Onboarding] paid=1 return — deferring to component.');
            return;
          }

          // Steps 13-15 are the checkout funnel (plan select → notifications → done).
          // Do NOT run the status check from here once the user is in this funnel:
          // - Step 13: paywall / plan picker
          // - Step 14: notifications preferences (between plan pick and checkout)
          // - Step 15: "you're all set" / checkout trigger / paid verification
          // Re-running the check at steps 14-15 would see `completed=true + unpaid`
          // (payment not yet captured) and bounce the user back to step 13, creating
          // a loop that prevents them from ever reaching checkout.
          const stepNum = currentStep ? parseInt(currentStep, 10) : 0;
          if (stepNum >= 13 && stepNum <= 15) {
            console.log(`🔒 [Onboarding] In checkout funnel (step ${currentStep}) — staying put.`);
            return;
          }

          // Check local storage status but don't force redirect
          const localDone = localStorage.getItem('onboarding_completed') === 'true';
          console.log(`📋 [Onboarding] Local status: ${localDone}`);

          console.log('📡 [Onboarding] Fetching status from server...');

          // Try multiple times with exponential backoff to handle database replication delays
          const maxRetries = 3;
          let retryCount = 0;
          let serverCompleted = false;

          while (retryCount < maxRetries && !serverCompleted) {
            try {
              const response = await fetch("/api/onboarding/status");
              if (response.ok) {
                const data = await response.json();
                console.log('📡 [Onboarding] Server response:', data);

                if (data.completed) {
                  serverCompleted = true;
                  localStorage.setItem('onboarding_completed', 'true');
                  // Onboarding is done — but ONLY a paid/active user lands in the app.
                  // An unpaid user who completed the flow but abandoned checkout must
                  // NOT be bounced to /home-feed (which would ping-pong them to
                  // /pricing). Keep them inside onboarding, parked on the paywall
                  // (step 13), until they actually pay & activate.
                  try {
                    const subRes = await fetch(`/api/subscription/status?t=${Date.now()}`);
                    const subData = subRes.ok ? await subRes.json() : null;
                    const planType = subData?.subscription?.planType;
                    const isExpired = !!subData?.subscription?.isExpired;
                    const isPaid = !!planType && planType !== 'free' && planType !== 'none' && !isExpired;
                    if (isPaid) {
                      console.log('📋 [Onboarding] Completed + paid — entering app.');
                      router.replace('/home-feed');
                    } else {
                      console.log('🔒 [Onboarding] Completed but UNPAID — parking on paywall (step 13).');
                      localStorage.removeItem('onboarding_completed');
                      const stepParam = new URLSearchParams(window.location.search).get('step');
                      if (stepParam !== '13') router.replace('/onboarding?step=13');
                    }
                  } catch {
                    // On a status error, do NOT optimistically grant the app —
                    // keep them on the paywall (fail closed for access).
                    const stepParam = new URLSearchParams(window.location.search).get('step');
                    if (stepParam !== '13') router.replace('/onboarding?step=13');
                  }
                  return;
                } else if (data.lastStep && data.lastStep >= 1) {
                  if (localDone) localStorage.removeItem('onboarding_completed');
                  // Not completed, resume at the last step they reached (1-indexed flow)
                  const currentParam = new URLSearchParams(window.location.search).get('step');
                  if (currentParam === null || parseInt(currentParam) !== data.lastStep) {
                    console.log(`🚀 [Onboarding] Redirecting to step ${data.lastStep}`);
                    router.push(`/onboarding?step=${data.lastStep}`);
                    serverCompleted = true; // Stop retrying as we found our place
                  } else {
                    console.log(`⏳ [Onboarding] Already on step ${data.lastStep}`);
                    serverCompleted = true;
                  }
                } else {
                  console.log('⏳ [Onboarding] Staying here: Onboarding is NOT complete');
                  if (localDone) localStorage.removeItem('onboarding_completed');
                }
              } else {
                console.error('❌ [Onboarding] Status API failed:', response.status);
              }
            } catch (error) {
              console.error(`⚠️ [Onboarding] Status check failed (attempt ${retryCount + 1}):`, error);
              if (retryCount < maxRetries - 1) {
                // Exponential backoff: 500ms, 1000ms, 2000ms
                const delay = Math.pow(2, retryCount) * 500;
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
            retryCount++;
          }
        } catch (error) {
          console.error("❌ [Onboarding] Error checking status:", error);
        }
      };
      checkOnboardingStatus();
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-black/[0.04] border-t-[#0A0A0A] rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  // Use the new Sift onboarding flow with Suspense
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-black/[0.04] border-t-[#0A0A0A] rounded-full animate-spin" />
      </div>
    }>
      <SiftOnboardingPage />
    </Suspense>
  );
}
