"use client";

import React, { useEffect, useState } from "react";
import { Check, Lock, Crown, Sparkles, ArrowRight, ShieldCheck, HelpCircle, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import PricingSection3 from "@/components/ui/pricing-section-3";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import AnimatedGradient from "@/components/ui/animated-gradient";
import { BlurFade } from "@/components/ui/blur-fade";


const POLAR_CHECKOUT_URLS = {
  weekly: "https://buy.polar.sh/polar_cl_nnRbdFq1yLPLgMs9GxDUTx1O6t30yz400ZSR54dcWia",
  monthly: "https://buy.polar.sh/polar_cl_iFCJ2Mq7UbVBQTIiMGwI3STQZTvGfT1EBLyiM1HM5ca",
  annual: "https://buy.polar.sh/polar_cl_I2DWGQPxxX0lvNGzbAeSRbkdCP6TgU9Ybsy7O3pkReC",
  lifetime: "https://buy.polar.sh/polar_cl_T848DqQDK82361tmecJpNmtFgfPubJSb4Eyza2l8yrV"
};

// One plan, everything included — the tiers differ only in how you pay (plus
// badge + support level). The table must never invent capability differences;
// that contradicts the "full product from day one" story told everywhere else.
const COMPARISON_FEATURES = [
  { category: "Core Capabilities", name: "Emails read, triaged & prioritized", weekly: "Unlimited", monthly: "Unlimited", annual: "Unlimited", lifetime: "Unlimited" },
  { category: "Core Capabilities", name: "Replies drafted in your voice", weekly: "Unlimited", monthly: "Unlimited", annual: "Unlimited", lifetime: "Unlimited" },
  { category: "Core Capabilities", name: "AI chat & overnight agents", weekly: "Unlimited", monthly: "Unlimited", annual: "Unlimited", lifetime: "Unlimited" },
  { category: "Integration", name: "Google Calendar Sync", weekly: "Included", monthly: "Included", annual: "Included", lifetime: "Included" },
  { category: "Integration", name: "Notion & Cal.com Sync", weekly: "Included", monthly: "Included", annual: "Included", lifetime: "Included" },
  { category: "Security & Badges", name: "Founding Badge", weekly: "✓ Standard", monthly: "✓ Gold Badge", annual: "✓ Gold Badge", lifetime: "✓ Diamond Badge" },
  { category: "Support", name: "Customer Service", weekly: "Standard", monthly: "Standard", annual: "Priority", lifetime: "24/7 Premium" }
];

const PRICING_FAQS = [
  {
    q: "Is there a free trial?",
    a: "Yes. The monthly plan includes a 3-day free trial via Polar checkout (card required). You won’t be charged during the trial — cancel anytime before day 3. After that it’s $29/month. Annual and Lifetime start immediately at checkout."
  },
  {
    q: "How does the Weekly plan work?",
    a: "It's $8.99 per week for the complete product — nothing is held back compared to the larger plans. It renews every 7 days until you cancel, and you can cancel from your billing portal at any time; access runs to the end of the week you've already paid for. It's the lowest-commitment way to find out whether Maily earns its place in your week."
  },
  {
    q: "Can I upgrade or downgrade anytime?",
    a: "Yes, you can manage your subscription directly inside your billing portal. Upgrades are applied instantly and prorated, while downgrades or cancellations take effect at the end of your current billing period."
  },
  {
    q: "How does the Lifetime founding tier work?",
    a: "The Lifetime tier is a one-time purchase of $499. You secure full access to everything Maily does, forever — same unlimited product as every other plan. You just never pay again."
  },
  {
    q: "Are there any hidden API fees?",
    a: "No. All AI models, tokens, and storage costs are completely covered in your subscription rate. You will never see variable overage fees."
  }
];

export default function PricingPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  useEffect(() => {
    document.title = "Pricing / Maily";
    fetchSubscriptionStatus();
  }, []);

  const fetchSubscriptionStatus = async () => {
    try {
      const response = await fetch("/api/subscription/status");
      if (response.ok) {
        const data = await response.json();
        setCurrentPlan(data.subscription?.planType || "free");
      }
    } catch (error) {
      console.error("Error fetching subscription status:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectPlan = async (planId: "weekly" | "monthly" | "annual" | "lifetime") => {
    let checkoutUrl = "";
    if (planId === "weekly") {
      checkoutUrl = POLAR_CHECKOUT_URLS.weekly;
    } else if (planId === "monthly") {
      checkoutUrl = POLAR_CHECKOUT_URLS.monthly;
    } else if (planId === "annual") {
      checkoutUrl = POLAR_CHECKOUT_URLS.annual;
    } else {
      checkoutUrl = POLAR_CHECKOUT_URLS.lifetime;
    }

    // After this checkout, land the user in the app — NOT back in onboarding.
    // /payment-success reads maily_checkout_return; set it explicitly to
    // /home-feed so a stale onboarding value can't hijack the redirect. The
    // pending_plan markers let /home-feed's just-paid poller wait for the webhook
    // to activate the subscription before granting access.
    try {
      localStorage.setItem("maily_checkout_return", "/home-feed");
      localStorage.setItem("pending_plan", planId);
      localStorage.setItem("pending_plan_timestamp", String(Date.now()));
    } catch { /* localStorage unavailable — payment-success still defaults to /home-feed */ }

    const params = new URLSearchParams();
    if (session?.user?.email) params.set("email", session.user.email);
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://maily.cfd";
    params.set("redirect_url", `${baseUrl}/payment-success`);

    window.location.href = `${checkoutUrl}?${params.toString()}`;
  };

  return (
    <div className="min-h-screen bg-[#030303] text-white flex flex-col items-center justify-start overflow-x-hidden font-satoshi relative pb-32">
      {/* Top Navbar */}
      <Navbar theme="dark" />

      {/* Global Background Grid & Noise */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `radial-gradient(circle, #fff 1px, transparent 1px)`,
            backgroundSize: "24px 24px"
          }}
        />
        <div className="absolute top-[15%] left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-neutral-900/10 blur-[130px]" />
      </div>



      {/* Modular Pricing Component */}
      <PricingSection3
        isLoading={isLoading}
        currentPlan={currentPlan}
        handleSelectPlan={handleSelectPlan}
      />

      {/* FEATURE COMPARISON TABLE */}
      <section className="relative z-10 w-full max-w-5xl mt-36 px-6">
        <div className="text-center mb-16 space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">
            Specs comparison
          </h2>
          <p className="text-3xl md:text-5xl font-light text-white tracking-tight">
            Detailed Feature Comparison
          </p>
        </div>

        <div className="overflow-x-auto rounded-3xl border border-white/[0.04] bg-[#070707] p-4 shadow-2xl">
          <table className="w-full border-collapse text-left text-xs font-sans font-light">
            <thead>
              <tr className="border-b border-white/[0.06] text-neutral-400 uppercase font-bold tracking-widest text-[9px]">
                <th className="py-4 px-6">Feature</th>
                <th className="py-4 px-6">Weekly ($8.99/wk)</th>
                <th className="py-4 px-6">Monthly ($29/mo)</th>
                <th className="py-4 px-6">Annual ($16.58/mo)</th>
                <th className="py-4 px-6">Lifetime Founder ($499)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {COMPARISON_FEATURES.map((feat, idx) => (
                <tr
                  key={idx}
                  className="hover:bg-white/[0.01] transition-colors"
                >
                  <td className="py-4 px-6 font-medium text-white">{feat.name}</td>
                  <td className="py-4 px-6 text-neutral-400">{feat.weekly}</td>
                  <td className="py-4 px-6 text-neutral-400">{feat.monthly}</td>
                  <td className="py-4 px-6 text-neutral-200 font-semibold">{feat.annual}</td>
                  <td className="py-4 px-6 text-neutral-400">{feat.lifetime}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ SECTION */}
      <section className="relative z-10 w-full max-w-4xl mt-36 px-6">
        <div className="text-center mb-20 space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">
            System Inquiries
          </h2>
          <p className="text-3xl md:text-5xl font-light tracking-[-0.04em] text-white">
            Frequently Asked Questions
          </p>
        </div>

        <div className="space-y-4">
          {PRICING_FAQS.map((faq, idx) => {
            const isOpen = activeFaq === idx;
            return (
              <div
                key={idx}
                className="rounded-[24px] border border-white/[0.04] bg-[#070707] overflow-hidden transition-all duration-300"
              >
                <button
                  onClick={() => setActiveFaq(isOpen ? null : idx)}
                  className="w-full px-7 py-6 flex items-center justify-between text-left focus:outline-none"
                >
                  <span className="font-semibold text-xs md:text-sm text-white">
                    {faq.q}
                  </span>
                  <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center border border-white/10 flex-shrink-0">
                    {isOpen ? (
                      <Minus className="w-3.5 h-3.5 text-neutral-300" />
                    ) : (
                      <Plus className="w-3.5 h-3.5 text-neutral-300" />
                    )}
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: "auto" }}
                      exit={{ height: 0 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden border-t border-white/[0.04]"
                    >
                      <div className="px-7 py-6 text-xs md:text-sm text-neutral-400 font-light leading-relaxed bg-white/[0.01]">
                        {faq.a}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}
