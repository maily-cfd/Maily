"use client";
import React, { useRef, useState } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { TimelineContent } from "@/components/ui/timeline-animation";
import { VerticalCutReveal } from "@/components/ui/vertical-cut-reveal";
import { cn } from "@/lib/utils";
import NumberFlow from "@number-flow/react";
import { Check, Crown, Sparkles, Lock, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { CircleExpandButton } from "@/components/CircleExpandButton";
import { SectionHeader } from "@/components/ui/section-header";

interface PricingProps {
  isLoading?: boolean;
  currentPlan?: string | null;
  handleSelectPlan?: (planId: "weekly" | "monthly" | "annual" | "lifetime") => void;
}

const PricingSwitch = ({
  onSwitch,
  className,
}: {
  onSwitch: (value: string) => void;
  className?: string;
}) => {
  const [selected, setSelected] = useState("1"); // Default to Annual/Yearly

  const handleSwitch = (value: string) => {
    setSelected(value);
    onSwitch(value);
  };

  return (
    <div className={cn("flex justify-center", className)}>
      <div className="relative z-10 mx-auto flex w-fit rounded-full bg-neutral-100 dark:bg-white/[0.02] border border-neutral-200 dark:border-white/[0.08] p-1 shadow-2xl backdrop-blur-md">
        <button
          type="button"
          onClick={() => handleSwitch("0")}
          className={cn(
            "relative z-10 w-fit sm:h-11 cursor-pointer h-9 rounded-full sm:px-6 px-4 sm:py-1.5 py-1 text-xs font-semibold transition-colors duration-300",
            selected === "0" ? "text-[#030303] dark:text-white" : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
          )}
        >
          {selected === "0" && (
            <motion.span
              layoutId="pricing-switch"
              className="absolute inset-0 w-full h-full rounded-full bg-white"
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
            />
          )}
          <span className="relative z-10">Monthly</span>
        </button>

        <button
          type="button"
          onClick={() => handleSwitch("1")}
          className={cn(
            "relative z-10 w-fit cursor-pointer sm:h-11 h-9 flex-shrink-0 rounded-full sm:px-6 px-4 sm:py-1.5 py-1 text-xs font-semibold transition-colors duration-300",
            selected === "1" ? "text-[#030303] dark:text-white" : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
          )}
        >
          {selected === "1" && (
            <motion.span
              layoutId="pricing-switch"
              className="absolute inset-0 w-full h-full rounded-full bg-white"
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-1.5">
            Annual
            <span className={cn(
              "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider",
              selected === "1" ? "bg-[#030303] text-white" : "bg-white text-[#030303]"
            )}>
              Save 40%
            </span>
          </span>
        </button>
      </div>
    </div>
  );
};

export default function PricingSection3({
  isLoading = false,
  currentPlan = null,
  handleSelectPlan = (planId) => {
    console.log(`Select plan requested: ${planId}`);
  },
}: PricingProps) {
  const [isYearly, setIsYearly] = useState(true); // Default to Yearly
  const pricingRef = useRef<HTMLDivElement>(null);

  const revealVariants = {
    visible: (i: number) => ({
      y: 0,
      opacity: 1,
      filter: "blur(0px)",
      transition: {
        delay: i * 0.25,
        duration: 0.5,
      },
    }),
    hidden: {
      filter: "blur(10px)",
      y: -20,
      opacity: 0,
    },
  };

  const togglePricingPeriod = (value: string) => {
    setIsYearly(Number.parseInt(value) === 1);
  };

  const plans = [
    {
      id: "weekly" as const,
      name: "Weekly Access",
      // This is a RECURRING weekly subscription, not a one-time pass. Copy must
      // never imply the charge stops on its own — it renews until cancelled.
      description: "The lowest-commitment way in. Full access to every feature, billed weekly and cancellable anytime.",
      price: 8.99,
      yearlyPrice: 8.99,
      buttonText: "Start Weekly",
      popular: false,
      features: [
        "Full Sift email ingestion & triage",
        "Unlimited custom voice-cloned drafts",
        "Active Sync integrations (Notion, Cal.com)",
        "Standard Arcus AI query access"
      ],
      tag: "Cancel anytime"
    },
    {
      id: "subscription" as const,
      name: "Autonomous Subscription",
      description: "Scale your email operations autonomously. Triages, drafts in your voice, and logs CRM entries in real time. Monthly includes a 3-day free trial.",
      price: 29,
      yearlyPrice: 16.58,
      buttonText: "Start 3-day free trial",
      popular: false,
      features: [
        "Full Sift email ingestion & triage",
        "Unlimited custom voice-cloned drafts",
        "Active Sync integrations (Notion, Cal.com)",
        "Standard Arcus AI query access",
        "Gold Founding Badge status",
        "Gold Slack channel entry"
      ],
      tag: "3-day free trial · card required"
    },
    {
      id: "lifetime" as const,
      name: "Lifetime Founder Plan",
      description: "Secure absolute access forever. One-time payment, zero recurring subscription fees. Complete diamond status.",
      price: 499,
      yearlyPrice: 499, // ALWAYS STAYS $499 - clicking annual only converts subscription!
      buttonText: "Own Mailient Forever",
      popular: true, // Prioritize and highlight Lifetime tier!
      features: [
        "One-time purchase, zero API overhead fees",
        "Lifetime access to Sift, Drafts & Arcus",
        "500 AI queries/month (refilled automatically)",
        "Exclusive Diamond Founding Badge status",
        "VIP Diamond feedback Slack channel",
        "Dedicated founding institutional support SLA"
      ],
      tag: "Elite Founding Tier"
    }
  ];

  return (
    <div
      className="px-4 py-20 min-h-screen max-w-6xl mx-auto relative text-neutral-900 dark:text-white"
      ref={pricingRef}
    >
      {/* Visual background textures inside pricing panel */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden -z-10">
        <div className="absolute top-[10%] left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full bg-white/[0.015] blur-[120px]" />
      </div>

      {/* Centered header + centered billing toggle, matching every other
          section. This was a left-aligned two-column article with the heading
          on one side and the toggle on the other, at 5xl/font-light — a size
          and weight that appeared nowhere else on the site. The heading now
          uses the shared 44px ramp; the VerticalCutReveal animation is kept by
          passing it through as the heading node. */}
      <SectionHeader
        pill="The hiring decision"
        icon={Sparkles}
        heading={
          <VerticalCutReveal
            splitBy="words"
            staggerDuration={0.12}
            staggerFrom="first"
            reverse={true}
            containerClassName="justify-center"
          >
            Your next hire costs $29 a month.
          </VerticalCutReveal>
        }
        subtitle="One plan, everything included — monthly starts with a 3-day free trial (card required, cancel anytime)."
      />

      <TimelineContent
        as="div"
        animationNum={1}
        timelineRef={pricingRef}
        customVariants={revealVariants}
        className="flex justify-center pb-16 mb-16 border-b border-neutral-200 dark:border-white/[0.04]"
      >
        <PricingSwitch onSwitch={togglePricingPeriod} className="shrink-0" />
      </TimelineContent>

      <TimelineContent
        as="div"
        animationNum={2}
        timelineRef={pricingRef}
        customVariants={revealVariants}
        className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto items-stretch"
      >
        {plans.map((plan, index) => {
          const isLifetime = plan.id === "lifetime";
          const isWeekly = plan.id === "weekly";
          const displayPrice = (isLifetime || isWeekly) ? plan.price : (isYearly ? plan.yearlyPrice : plan.price);
          const isCurrentPlanActive = isLifetime ? (currentPlan === "lifetime") : isWeekly ? (currentPlan === "weekly") : (isYearly ? currentPlan === "starter" : currentPlan === "pro");

          return (
            <TimelineContent
              as="div"
              key={plan.name}
              animationNum={index + 3}
              timelineRef={pricingRef}
              customVariants={revealVariants}
              className="flex"
            >
              <Card
                className={cn(
                  "relative w-full flex flex-col justify-between rounded-[32px] p-8 transition-all duration-500 overflow-hidden group backdrop-blur-md",
                  plan.popular
                    ? "bg-white border-neutral-300 ring-1 ring-neutral-200 dark:bg-white/[0.02] dark:border-white/[0.15] dark:ring-white/10"
                    : "bg-white border-neutral-200 hover:border-neutral-300 dark:bg-white/[0.01] dark:border-white/[0.04] dark:hover:border-white/[0.08]"
                )}
              >
                {/* Visual glow backdrop for popular lifetime card */}
                {plan.popular && (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.05),_transparent_70%)] pointer-events-none" />
                )}

                <CardContent className="pt-0 relative z-10 flex-grow">
                  <div className="flex items-center justify-between mb-8">
                    <span className="text-[9px] font-black uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
                      {plan.id === "subscription" && !isYearly
                        ? "3-day free trial"
                        : plan.id === "subscription" && isYearly
                          ? "Flexible Membership"
                          : plan.tag}
                    </span>
                    {plan.popular && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white text-black text-[9px] font-black uppercase tracking-wider shadow-xl">
                        <Crown className="w-3 h-3 text-black" />
                        Prioritized
                      </span>
                    )}
                    {plan.id === "subscription" && !isYearly && !plan.popular && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-[9px] font-black uppercase tracking-wider">
                        Free trial
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline mb-3">
                    <span className="text-4xl md:text-5xl font-light text-neutral-900 dark:text-white flex items-baseline">
                      $
                      <NumberFlow
                        format={{
                          minimumFractionDigits: isLifetime ? 0 : 2,
                          maximumFractionDigits: isLifetime ? 0 : 2,
                        }}
                        value={displayPrice}
                        className="text-4xl md:text-5xl font-light tracking-tight text-neutral-900 dark:text-white inline-block"
                      />
                    </span>
                    <span className="text-neutral-500 dark:text-neutral-400 font-light text-xs ml-2">
                      {isLifetime ? "one-time payment" : isWeekly ? "/week" : (isYearly ? "/month, billed yearly" : "/month")}
                    </span>
                  </div>

                  {plan.id === "subscription" && isYearly && (
                    <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-semibold mb-6">
                      Billed as $199 annually (40% discount applied)
                    </p>
                  )}

                  <h3 className="text-xl font-medium mb-3">{plan.name}</h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 font-light leading-relaxed mb-8">
                    {plan.description}
                  </p>

                  <div className="border-t border-neutral-200 dark:border-white/[0.06] pt-6 space-y-4">
                    <h4 className="font-semibold text-[10px] uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
                      What's Included:
                    </h4>
                    <ul className="space-y-3">
                      {plan.features.map((feature, featureIndex) => (
                        <li key={featureIndex} className="flex items-start gap-3">
                          <span className={cn(
                            "w-5 h-5 rounded-full border grid place-content-center mt-0.5 shrink-0 transition-colors",
                            plan.popular 
                              ? "bg-neutral-900/10 border-neutral-900/20 text-neutral-900 dark:bg-white/10 dark:border-white/20 dark:text-white" 
                              : "bg-neutral-900/5 border-neutral-900/10 text-neutral-900 dark:bg-white/5 dark:border-white/10 dark:text-white"
                          )}>
                            <Check className="w-3.5 h-3.5" />
                          </span>
                          <span className="text-xs text-neutral-600 dark:text-neutral-300 font-light leading-normal">
                            {feature}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>

                <div className="pt-8 relative z-10 shrink-0">
                  <CircleExpandButton
                    onClick={() => {
                      if (isLifetime) {
                        handleSelectPlan("lifetime");
                      } else if (isWeekly) {
                        handleSelectPlan("weekly");
                      } else {
                        handleSelectPlan(isYearly ? "annual" : "monthly");
                      }
                    }}
                    disabled={isLoading || isCurrentPlanActive}
                    // One white button per pricing table: the popular tier is
                    // the primary action, the rest stay in the grey ramp.
                    variant={plan.popular ? "primary" : "secondary"}
                    className={cn(
                      "w-full",
                      isCurrentPlanActive && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {isLoading ? (
                      "Processing..."
                    ) : isCurrentPlanActive ? (
                      "Current Active Plan"
                    ) : plan.id === "subscription" && !isYearly ? (
                      "Start 3-day free trial"
                    ) : plan.id === "subscription" && isYearly ? (
                      "Start Annual"
                    ) : (
                      plan.buttonText
                    )}
                  </CircleExpandButton>
                </div>
              </Card>
            </TimelineContent>
          );
        })}
      </TimelineContent>
    </div>
  );
}
