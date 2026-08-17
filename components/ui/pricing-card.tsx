"use client";

import {
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import NumberFlow from "@number-flow/react";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Button } from "./button";
import { PLANS } from "@/lib/subscription-service";
import { useSession } from "next-auth/react";

const mailyPlans = [
  {
    id: "monthly",
    name: "Monthly",
    description: "Full access, billed monthly",
    price: 29,
    priceLabel: "/month",
    features: [
      "Unlimited AI Draft Replies",
      "Unlimited Boult AI",
      "Unlimited Summaries",
      "Full Sift email triage",
      "Gold Founding Badge",
    ],
    checkoutUrl: "https://buy.polar.sh/polar_cl_iFCJ2Mq7UbVBQTIiMGwI3STQZTvGfT1EBLyiM1HM5ca",
  },
  {
    id: "annual",
    name: "Annual",
    description: "Save 40% — billed yearly",
    price: 16.58,
    priceLabel: "/month",
    subLabel: "Billed as $199 annually",
    features: [
      "Everything in Monthly",
      "40% annual savings",
      "Priority AI Processing",
      "Gold Founding Badge",
      "Priority Support",
    ],
    checkoutUrl: "https://buy.polar.sh/polar_cl_I2DWGQPxxX0lvNGzbAeSRbkdCP6TgU9Ybsy7O3pkReC",
    highlighted: true,
  },
  {
    id: "lifetime",
    name: "Lifetime Founder",
    description: "Pay once, own forever",
    price: 499,
    priceLabel: "one-time",
    features: [
      "Everything in Annual",
      "Lifetime access — zero recurring fees",
      "Diamond Founding Badge",
      "VIP Diamond Slack channel",
      "Dedicated founder support SLA",
    ],
    checkoutUrl: "https://buy.polar.sh/polar_cl_T848DqQDK82361tmecJpNmtFgfPubJSb4Eyza2l8yrV",
  },
];

const TRANSITION = {
  type: "spring" as const,
  stiffness: 300,
  damping: 30,
  mass: 0.8,
};

interface PricingCardProps {
    onClose?: () => void;
}

export function PricingCard({ onClose }: PricingCardProps) {
  const { data: session } = useSession();
  const [selectedPlan, setSelectedPlan] = useState("annual");
  const [isActivating, setIsActivating] = useState(false);

  const handleSubscribe = (planId: string, checkoutUrl?: string) => {
    if (checkoutUrl) {
        setIsActivating(true);
        // Set flags so HomeFeed knows we're waiting for payment
        localStorage.setItem('pending_plan', planId);
        localStorage.setItem('pending_plan_timestamp', Date.now().toString());
        
        // Build checkout URL with parameters
        const params = new URLSearchParams();
        if (session?.user?.email) {
            params.set('email', session.user.email);
        }
        
        // CRITICAL: Set redirect URL so users come back to our payment success page
        const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://maily.cfd';
        params.set('redirect_url', `${baseUrl}/payment-success`);

        // Redirect in the same window so they come back to the app easily
        window.location.href = `${checkoutUrl}?${params.toString()}`;
    } else if (onClose) {
        onClose();
    }
  };

  return (
    <div className="w-full max-w-[420px] flex flex-col gap-4 p-4 px-3 sm:p-5 rounded-[28px] border border-white/10 bg-[#0A0A0A] shadow-2xl transition-colors duration-300 not-prose text-white">
      <div className="flex flex-col gap-3 mb-1">
        <div className="flex items-center justify-between">
            <h1 className="text-2xl font-serif text-white tracking-tight">
              Select a Plan
            </h1>
            {onClose && (
                <button onClick={onClose} className="text-neutral-600 dark:text-neutral-500 hover:text-white transition-colors">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                </button>
            )}
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Your subscription has expired. Choose a plan to continue with premium features.</p>
      </div>

      <div className="flex flex-col gap-3">
        {mailyPlans.map((plan) => {
          const isSelected = selectedPlan === plan.id;
          const price = plan.price;

          return (
            <div
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className="relative cursor-pointer group"
            >
              <div
                className={`relative rounded-2xl bg-white/[0.03] border transition-all duration-300 ${
                  isSelected ? "z-10 border-white/20 bg-white/[0.05]" : "border-white/5 hover:border-white/10"
                }`}
              >
                <div className="p-4">
                  <div className="flex justify-between items-start">
                    <div className="flex gap-4">
                      <div className="mt-1 shrink-0">
                        <div
                          className={`w-6 h-6 rounded-full border flex items-center justify-center transition-all duration-300 ${
                            isSelected
                              ? "border-white bg-white"
                              : "border-white/10"
                          }`}
                        >
                          <AnimatePresence mode="wait" initial={false}>
                            {isSelected && (
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                exit={{ scale: 0 }}
                                className="w-2.5 h-2.5 rounded-full bg-black"
                                transition={{
                                  type: "spring",
                                  stiffness: 300,
                                  damping: 25,
                                  duration: 0.2,
                                }}
                              />
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                      <div>
                        <h3 className="text-lg font-medium text-white leading-tight">
                          {plan.name}
                        </h3>
                        <p className="text-sm text-neutral-600 dark:text-neutral-500 capitalize">
                          {plan.description}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-medium text-white">
                        <NumberFlow
                          value={price}
                          format={{ style: "currency", currency: "USD", minimumFractionDigits: plan.id === 'lifetime' ? 0 : 2 }}
                        />
                      </div>
                      <div className="text-xs text-neutral-600 dark:text-neutral-500/60 flex items-center justify-end gap-1 ">
                        {plan.priceLabel}
                      </div>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {isSelected && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                          duration: 0.4,
                          ease: [0.32, 0.72, 0, 1],
                        }}
                        className="overflow-hidden w-full"
                      >
                        <div className="pt-4 flex flex-col gap-4">
                          {plan.subLabel && (
                            <p className="text-[10px] text-neutral-400 font-semibold">{plan.subLabel}</p>
                          )}
                          <div className="flex flex-col gap-2.5">
                            {plan.features.map((feature, idx) => (
                              <motion.div
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{
                                  delay: idx * 0.05,
                                  duration: 0.3,
                                }}
                                key={idx}
                                className="flex items-center gap-3 text-sm text-neutral-900 dark:text-neutral-300 "
                              >
                                <HugeiconsIcon
                                  icon={Tick02Icon}
                                  size={16}
                                  className="text-white"
                                />
                                {feature}
                              </motion.div>
                            ))}
                          </div>

                          <Button 
                            onClick={() => handleSubscribe(plan.id, plan.checkoutUrl)}
                            disabled={isActivating}
                            className="w-full h-10 rounded-xl font-bold transition-all bg-white text-black hover:bg-neutral-200"
                          >
                            {plan.id === 'lifetime' ? 'Own Maily Forever' : 'Subscribe Now'}
                            {isActivating && <span className="ml-2 animate-spin">◌</span>}
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
