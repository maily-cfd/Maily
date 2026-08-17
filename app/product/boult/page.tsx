"use client";

import React, { useEffect, useState, Suspense, lazy } from "react";
import { Navbar } from "@/components/Navbar";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowRight, ShieldCheck,
  ChevronRight
} from "lucide-react";
import Link from "next/link";
import { BlurFade } from "@/components/ui/blur-fade";
import { FloatingNavbar } from "@/components/FloatingNavbar";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { BoultLogo } from "@/components/ui/boult-logo";
import { WordBlurStream } from "@/src/WordBlurStream";
import { CTASection } from "@/components/ui/hero-dithering-card";
import { Footer } from "@/components/Footer";
import { CircleExpandButton } from "@/components/CircleExpandButton";
import { DemoVideo } from "@/components/ui/demo-video";

const Dithering = lazy(() => 
  import("@paper-design/shaders-react").then((mod) => ({ default: mod.Dithering }))
);

const boultFaqs = [
  {
    q: "What exactly is Boult?",
    a: "Boult is Maily's AI agent — the part that takes action, not just answers. It reads your email threads, drafts replies in your voice, books meetings on your calendar, searches the web, reads your Notion, and runs scheduled tasks in the background while you sleep. It is the difference between an inbox tool and an inbox employee."
  },
  {
    q: "Does Boult actually send emails on my behalf?",
    a: "Only when you explicitly approve it. Boult drafts everything first and shows it to you before anything goes out. If you set up a background agent and turn on autonomous mode for that specific agent, it can send — but that is a deliberate choice you make per agent, not a default. You are always in control."
  },
  {
    q: "How does Boult learn to write like me?",
    a: "Boult reads your last 90 days of sent emails to understand how you write — your greeting, your sign-off, your tone with clients versus partners, your sentence length, your vocabulary. Every draft it writes goes through that voice profile. Your clients should not be able to tell the difference."
  },
  {
    q: "What are Scheduling Agents?",
    a: "Scheduling Agents are autonomous tasks you create once in plain English and forget about. You tell Boult what to do, when to do it, and where to send the results — Gmail, Slack, or both. Boult runs it on schedule with no tab open, no prompt, no reminder needed. You wake up to the results in your inbox."
  },
  {
    q: "Can Boult access my Google Calendar and Notion?",
    a: "Yes — if you grant it access. Boult uses standard OAuth to connect to Google Calendar and Notion. It reads your schedule to check availability and book meetings, and reads your Notion to pull context when drafting or reporting. You can revoke access to any connected app instantly from your settings."
  },
  {
    q: "Does Boult train on my emails?",
    a: "Never. What Boult reads to complete a task stays in that session. Your emails are not used to train any AI model — not Maily's, not Anthropic's, not anyone else's. Your data exists to serve you, not to improve a product you did not consent to contribute to."
  },
  {
    q: "What is the Canvas Panel?",
    a: "Canvas is a full workspace that slides open alongside the Boult chat when a task is too big for a single reply — a proposal, a weekly digest, a meeting prep document, a client analysis. Boult writes into it in real time. You can edit it inline, export it as a PDF, or send it directly as an email from inside Canvas."
  },
  {
    q: "What happens if Boult makes a mistake?",
    a: "Boult never sends anything without your approval unless you have explicitly enabled autonomous mode for a specific agent. If a draft is wrong, you edit it or discard it. If an agent produces a bad report, you tell Boult and it adjusts. Nothing is irreversible until you say so."
  },
  {
    q: "How many Boult queries do I get?",
    a: "All paid plans — Monthly ($29/mo), Annual ($16.58/mo billed $199/year), and Lifetime Founder ($499) — include unlimited Boult queries. There is no free tier. Subscribe to any plan and get full, unrestricted access to Boult."
  },
  {
    q: "Can I use Boult without the rest of Maily?",
    a: "Boult is built into Maily and works alongside Sift AI and the inbox view. You cannot use it as a standalone product — but you do not need to use every feature. Many users open Maily purely to talk to Boult and never look at anything else."
  }
];

export default function BoultProductPage() {
  const [activeAccordion, setActiveAccordion] = useState<number | null>(null);

  useEffect(() => {
    document.title = "Boult — the AI running your inbox | Maily";
  }, []);

  return (
    <div className="min-h-screen bg-[#000000] text-white flex flex-col items-center justify-start overflow-x-hidden font-satoshi strichpunkt-theme relative selection:bg-white selection:text-black">
      
      {/* Sticky Translucent Header */}
      <Navbar theme="dark" />

      {/* Atmospheric dark premium monochrome meshes */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        {/* Massive top glowing backdrop blur */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1400px] h-[700px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.025),rgba(255,255,255,0.01),transparent_70%)] blur-[120px]" />
        
        {/* Subtle dynamic warm mesh spotlights */}
        <div className="absolute top-[15%] left-[10%] w-[600px] h-[600px] rounded-full bg-white/[0.003] blur-[160px]" />
        <div className="absolute top-[35%] right-[5%] w-[800px] h-[800px] rounded-full bg-white/[0.002] blur-[200px]" />
      </div>

      {/* 1. HERO SECTION */}
      <section className="relative w-full pt-44 pb-20 md:pt-52 px-6 flex flex-col items-center text-center max-w-7xl mx-auto z-10">
        
        {/* WebGL Backing Shader */}
        <Suspense fallback={<div className="absolute inset-0 bg-[#000000] pointer-events-none" />}>
          <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.05] blur-[100px] scale-[1.05] mix-blend-screen [mask-image:radial-gradient(ellipse_at_center,black_45%,transparent_85%)]">
            <Dithering
              colorBack="#000000" 
              colorFront="#ffffff"
              shape="warp"
              type="4x4"
              speed={0.12}
              className="size-full"
              minPixelRatio={1}
            />
          </div>
        </Suspense>

        <div className="w-full flex flex-col items-center text-center max-w-5xl z-10">
          
          {/* Eyebrow Platform Badge */}
          <BlurFade delay={0.05} duration={0.8} yOffset={10} inView>
            <div className="inline-flex items-center gap-2.5 px-4 py-1 rounded-full bg-white/[0.02] border border-white/[0.05] shadow-2xl mb-8">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-300"></span>
              </span>
              <span className="text-[10px] font-medium tracking-[0.15em] text-[#8a8f98] uppercase font-mono">
                Product // Boult Flagship
              </span>
            </div>
          </BlurFade>

          {/* Headline & Subtitle */}
          <BlurFade delay={0.15} duration={0.8} yOffset={15} inView>
            <h1 className="text-4xl md:text-[68px] font-medium tracking-[-0.03em] text-white leading-[1.08] max-w-4xl">
              Inbox Employee. <br />On autopilot.
            </h1>
          </BlurFade>

          {/* Sleek Detailed Word Blur Streaming Subtitle */}
          <BlurFade delay={0.25} duration={0.8} yOffset={12} inView>
            <div className="text-base md:text-[20px] text-[#8a8f98] leading-relaxed max-w-2xl mt-4 font-light font-sans tracking-tight">
              <WordBlurStream
                text="It reads every thread, drafts replies in your voice, books your meetings, and runs on schedule while you sleep. Nothing sends without your approval."
                msPerWord={80}
                startupMs={400}
                loop={false}
              />
            </div>
          </BlurFade>

          {/* Thick Solid Black Clean Pill Button */}
          <BlurFade delay={0.35} duration={0.8} yOffset={10} inView>
            <div className="flex flex-col items-center gap-12 mt-10">
              <CircleExpandButton href="/auth/signup">
                Start free trial
              </CircleExpandButton>
            </div>
          </BlurFade>

        </div>
      </section>

      {/* 2. Real Boult footage — no coded triple-pane mockup */}
      <section className="py-24 px-6 w-full max-w-7xl mx-auto z-10 relative">
        <div className="text-center mb-16">
          <span className="font-mono text-[9px] tracking-[0.2em] text-indigo-400 uppercase font-bold block mb-4">
            EVERY DECISION IN THE OPEN
          </span>
          <h2 className="text-3xl md:text-[42px] font-medium tracking-[-0.025em] leading-tight font-sans bg-gradient-to-b from-white via-neutral-100 to-neutral-500 bg-clip-text text-transparent">
            Watch it work. Approve what goes out.
          </h2>
        </div>
        <div className="w-full linear-grid-card !rounded-[24px] overflow-hidden relative aspect-video max-h-[580px]">
          <DemoVideo
            src="/demos/boult-demo.mp4"
            poster="/demos/boult-demo.jpg"
            label="Boult working on a real inbox — drafts, reasoning, and approvals"
            className="absolute inset-0 w-full h-full"
          />
        </div>
      </section>

      {/* 3. ALTERNATING FEATURES GRID (Matching Codex image structured layout with gradient background wrapper cards) */}
      <section className="py-32 px-6 w-full max-w-7xl mx-auto border-t border-white/[0.06] z-10 relative text-center">
        
        <div className="mb-24">
          <span className="font-mono text-[9px] tracking-[0.2em] text-indigo-400 uppercase font-bold block mb-4">
            WHAT YOUR NEW EMPLOYEE DOES
          </span>
          <h2 className="text-4xl md:text-[54px] font-medium tracking-[-0.035em] leading-tight font-sans bg-gradient-to-b from-white via-neutral-100 to-neutral-500 bg-clip-text text-transparent">
            It does the work. You approve it.
          </h2>
        </div>

        <div className="space-y-36 max-w-5xl mx-auto">
          
          {/* Row 1: Visual Card on the right */}
          <div className="flex flex-col lg:flex-row items-center gap-16 text-left">
            <div className="flex-1 space-y-6">
              <h3 className="text-2xl md:text-[28px] font-medium tracking-tight text-white leading-snug">
                From one reply to a full inbox sweep.
              </h3>
              <p className="text-sm text-neutral-400 leading-relaxed font-light font-sans">
                Ask for a single draft or hand it the whole morning. It finds the open slot, books the call, and writes the reply the way you would have written it.
              </p>
              <div className="pt-2">
                <Link href="/product/sift" className="inline-flex items-center gap-1 text-xs font-semibold text-white hover:underline">
                  See how it picks what matters
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            <div className="flex-1 w-full rounded-[24px] overflow-hidden border border-white/[0.06] relative h-[320px]">
              <DemoVideo
                src="/demos/voice-demo.mp4"
                poster="/demos/voice-demo.jpg"
                label="Boult drafting in your learned voice on a real inbox"
                className="absolute inset-0 w-full h-full"
              />
            </div>
          </div>

          {/* Row 2: Visual Card on the left */}
          <div className="flex flex-col lg:flex-row-reverse items-center gap-16 text-left">
            <div className="flex-1 space-y-6">
              <h3 className="text-2xl md:text-[28px] font-medium tracking-tight text-white leading-snug">
                It works while the tab is closed.
              </h3>
              <p className="text-sm text-neutral-400 leading-relaxed font-light font-sans">
                No tab open, no prompt, no reminder. It runs on schedule in the background — sweeping your inbox, chasing follow-ups, watching your calendar — and reports back every morning.
              </p>
              <div className="pt-2">
                <Link href="/product/drafts" className="inline-flex items-center gap-1 text-xs font-semibold text-white hover:underline">
                  See drafts in your voice
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            <div className="flex-1 w-full rounded-[24px] overflow-hidden border border-white/[0.06] relative h-[320px]">
              <DemoVideo
                src="/demos/agent-demo.mp4"
                poster="/demos/agent-demo.jpg"
                label="Background scheduling agent running on a real inbox"
                className="absolute inset-0 w-full h-full"
              />
            </div>
          </div>

          {/* Row 3: Visual Card on the right */}
          <div className="flex flex-col lg:flex-row items-center gap-16 text-left">
            <div className="flex-1 space-y-6">
              <h3 className="text-2xl md:text-[28px] font-medium tracking-tight text-white leading-snug">
                Plugged into what you already use.
              </h3>
              <p className="text-sm text-neutral-400 leading-relaxed font-light font-sans">
                Gmail, Google Calendar, Cal.com, Notion. It turns messy email threads into booked meetings, reminders, and clean notes — filed where you already keep them.
              </p>
              <div className="pt-2">
                <Link href="/pricing" className="inline-flex items-center gap-1 text-xs font-semibold text-white hover:underline">
                  See pricing — everything included
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            <div className="flex-1 w-full rounded-[24px] overflow-hidden border border-white/[0.06] relative h-[320px]">
              <DemoVideo
                src="/demos/connect-gmail-demo.mp4"
                poster="/demos/connect-gmail-demo.jpg"
                label="Connecting Gmail so Boult can work on your real inbox"
                className="absolute inset-0 w-full h-full"
              />
            </div>
          </div>

        </div>
      </section>

      {/* 4. SECURITY & INTEGRITY STRIP */}
      <section className="py-20 px-6 w-full max-w-7xl mx-auto border-t border-white/[0.06] z-10 relative">
        <div className="w-full linear-grid-card !rounded-[20px] py-4 px-6 hover:shadow-[0_20px_40px_rgba(99,102,241,0.06)] hover:border-white/[0.1] transition-all duration-300 flex items-center justify-between text-left cursor-pointer">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span className="text-[11px] text-neutral-400 font-sans">
              Your emails are encrypted in your browser before they leave it. Personal data is stripped before any AI sees it.
            </span>
          </div>
          <Link href="/security" className="text-[10px] text-white font-semibold hover:underline flex items-center gap-1">
            Read Security Standard
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>

      {/* BOULT FAQ ACCORDION SECTION */}
      <section className="py-32 px-6 w-full max-w-7xl mx-auto border-t border-white/[0.06] z-10 relative">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
          
          <div className="lg:col-span-4 space-y-4 text-left">
            <span className="font-mono text-[10px] tracking-[0.2em] text-[#8a8f98] uppercase font-bold">COMMON QUESTIONS</span>
            <h2 className="text-3xl md:text-[40px] font-medium tracking-[-0.025em] leading-tight bg-gradient-to-b from-white via-neutral-100 to-neutral-500 bg-clip-text text-transparent">
              Frequently asked questions.
            </h2>
            <p className="text-xs text-[#8a8f98] leading-relaxed font-light font-sans max-w-sm">
              The short version: it runs your inbox, and nothing sends without you. Details below.
            </p>
          </div>

          <div className="lg:col-span-8 flex flex-col space-y-4 w-full">
            {boultFaqs.map((faq, index) => (
              <div key={index} className="border-b border-white/[0.06] pb-4 text-left">
                <div 
                  onClick={() => setActiveAccordion(activeAccordion === index ? null : index)}
                  className="flex items-center justify-between py-4 cursor-pointer text-sm font-semibold text-white hover:text-neutral-300 transition-colors"
                >
                  <span>{faq.q}</span>
                  <span className="text-xs text-neutral-500 font-mono">{activeAccordion === index ? "[-]" : "[+]"}</span>
                </div>
                <AnimatePresence>
                  {activeAccordion === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="text-sm text-[#8a8f98] font-light leading-relaxed font-sans pb-4 min-h-[3rem]">
                        <WordBlurStream
                          text={faq.a}
                          msPerWord={20}
                          loop={false}
                          startupMs={100}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* Premium Dithered CTA Section */}
      <CTASection />

      <Footer />

      {/* Premium Progressive Blurs for Top/Bottom edges */}
      <ProgressiveBlur position="top" backgroundColor="#000000" height="120px" blurAmount="10px" className="fixed z-40" />
      <ProgressiveBlur position="bottom" backgroundColor="#000000" height="80px" blurAmount="10px" className="fixed z-40" />

      {/* Premium Liquid Glass Floating Navigation Overlay */}
      <FloatingNavbar />
    </div>
  );
}
