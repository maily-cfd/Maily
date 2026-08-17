"use client";

import React, { useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { FloatingNavbar } from "@/components/FloatingNavbar";
import {
  ShieldCheck,
  Check,
  Lock,
  Server,
  UserCheck,
  Eye,
  BookOpen,
  Scale,
  FileText,
  Mail,
  Trash2,
  KeyRound,
  Ban,
  ArrowUpRight,
} from "lucide-react";
import AnimatedGradient from "@/components/ui/animated-gradient";
import { BlurFade } from "@/components/ui/blur-fade";
import { SectionHeader } from "@/components/ui/section-header";
import { WordBlurReveal } from "@/components/ui/word-blur-reveal";
import Link from "next/link";

/**
 * /security — rebuilt onto the landing page's design system.
 *
 * WHAT CHANGED AND WHY:
 * - The h1 was text-7xl (72px), larger than the landing hero's 60px, which is
 *   the ceiling for the whole site. A secondary page cannot be the loudest
 *   type on the domain. Now 60px, matching the hero rather than beating it.
 * - Cards had their own treatment (rounded-3xl, bg-white/[0.01],
 *   backdrop-blur-2xl) and their own icon tiles. Both now use the shared
 *   .linear-grid-card and .gradient-tile, so this page belongs to the same
 *   site as everything else.
 * - Section intro now uses the shared SectionHeader.
 * - DEAD COLOUR CLASSES FIXED: text-neutral-350, text-neutral-450 and
 *   text-emerald-450 were used here but are defined nowhere — not in
 *   tailwind config, not in globals.css @theme. Tailwind emits no CSS for
 *   them, so the elements silently inherited their parent's colour. The
 *   "compliance" ticks that were meant to read emerald were rendering grey.
 *   Replaced with real scale values.
 * - FloatingNavbar added; every other public page mounts it.
 */

const PILLARS = [
  {
    icon: Lock,
    title: "Encrypted before it leaves you",
    body: "Records, tokens and cache are encrypted with AES-256 at rest and in transit. Your decryption keys live in your browser and never reach our servers. Email content is processed in memory, not warehoused.",
    proof: "AES-256, keys held client-side",
  },
  {
    icon: Server,
    title: "Never used for training",
    body: "Your email is never used to train AI models — not ours, not our providers', not anyone's. What the AI reads to finish a task stays in that task.",
    proof: "No training. Ever.",
  },
  {
    icon: UserCheck,
    title: "Google OAuth, revocable",
    body: "Maily connects to Gmail through Google's OAuth. We hold no password, we ask only for the scopes we use, and you can revoke access from your Google account in one click.",
    proof: "Isolated token, revoke anytime",
  },
];

/**
 * The EXACT Google permissions we request, from the OAuth scope string in
 * lib/auth.js. Nothing here is aspirational — this is the consent screen a user
 * actually sees. Showing it plainly, with the reason for each, is a stronger
 * trust signal than any adjective, and it must stay in sync with that scope
 * string. If the scopes in lib/auth.js change, change this list.
 */
const SCOPES = [
  {
    label: "gmail.readonly",
    plain: "Read your mail",
    why: "So it can triage what arrives and draft replies in context. Reading is where the work starts.",
  },
  {
    label: "gmail.modify",
    plain: "Label & organise",
    why: "So it can archive, label and file — the tidying you'd otherwise do by hand. It cannot permanently delete on its own.",
  },
  {
    label: "gmail.send",
    plain: "Send the replies you approve",
    why: "So an approved draft actually goes out. Nothing sends without your say-so.",
  },
];

/**
 * Security FAQ. Every answer is grounded in verifiable product behaviour or in
 * the published Privacy Policy (section numbers noted in comments), NOT in
 * claims we cannot back. No certifications are asserted here because none are
 * held yet — see the note in the page footer comment.
 */
const SECURITY_FAQS = [
  {
    icon: Eye,
    q: "Can Maily read my email?",
    // Privacy Policy §6 (encryption) + §6 (zero-knowledge) + §12 (no training).
    a: "Stored data is encrypted into blobs we cannot read — the keys live in your browser. To do a task you ask for, like drafting a reply, the AI reads the relevant message in memory for that task only. It is never warehoused and never used to train a model.",
  },
  {
    icon: KeyRound,
    q: "What exactly can it access?",
    a: "Only the three Google permissions listed above — read, organise, and send. Nothing else in your Google account: not Drive, not Contacts, not your password.",
  },
  {
    icon: Ban,
    q: "Do you sell my data?",
    // Privacy Policy §5.
    a: "Never. Your email content and identity are not sold to advertisers, data brokers, or anyone. We also set no advertising or cross-site tracking cookies.",
  },
  {
    icon: Trash2,
    q: "What happens if I delete my account?",
    // Privacy Policy §8 (retention).
    a: "Your personal data is deleted or anonymised within 30 days, except where the law requires us to keep a record. Revoking Maily's Google access takes one click in your Google account and cuts off inbox access immediately.",
  },
  {
    icon: Server,
    q: "Who else touches my data?",
    // Privacy Policy §11 (service providers) — kept to CATEGORIES, not named
    // vendors, to avoid asserting a specific processor we might change.
    a: "Only the vendors needed to run the service — cloud hosting, the payment processor, the AI model providers, and the email sender — each under a data-processing agreement that forbids using your data for their own purposes. Never for advertising or profiling.",
  },
  {
    icon: ShieldCheck,
    q: "Nothing sends without me, right?",
    a: "Right. Every reply is a draft until you approve it. The agent proposes; you decide. There is no mode where it emails people on your behalf without a review step.",
  },
];

const RESOURCES = [
  {
    icon: BookOpen,
    kind: "Deep dive",
    title: "Zero-knowledge encryption, explained",
    desc: "Most AI email tools have to read your data to work. The architecture that lets Maily not.",
    href: "/blogs/zero-knowledge-encryption-email-privacy",
    external: false,
  },
  {
    icon: FileText,
    kind: "Policy",
    title: "Privacy Policy",
    desc: "What we collect, what we don't, how long we keep it, and the rights you have over it.",
    href: "/privacy-policy",
    external: false,
  },
  {
    icon: Scale,
    kind: "Policy",
    title: "Terms of Service",
    desc: "The agreement that governs your use of Maily, in full.",
    href: "/terms-of-service",
    external: false,
  },
  {
    icon: KeyRound,
    kind: "Your control",
    title: "Manage Google access",
    desc: "See and revoke Maily's Google permissions any time, straight from your Google account.",
    href: "https://myaccount.google.com/permissions",
    external: true,
  },
];

export default function SecurityPage() {
  useEffect(() => {
    document.title = "Security / Maily";
  }, []);

  return (
    <div className="min-h-screen bg-[#000000] text-white flex flex-col items-center justify-start overflow-x-hidden strichpunkt-theme relative selection:bg-white selection:text-black">
      <Navbar theme="dark" />

      {/* Atmospheric backgrounds */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `radial-gradient(circle, #fff 1px, transparent 1px)`,
            backgroundSize: "24px 24px",
          }}
        />
        <div className="absolute top-[20%] left-1/4 w-[700px] h-[700px] rounded-full bg-neutral-900/10 blur-[130px]" />
      </div>

      <AnimatedGradient
        config={{ preset: "Mist", speed: 6 }}
        noise={{ opacity: 0.01 }}
        className="opacity-20 pointer-events-none"
      />

      {/* HERO */}
      <section className="relative z-10 pt-40 pb-16 md:pt-48 md:pb-24 px-6 text-center max-w-3xl mx-auto flex flex-col items-center">
        <BlurFade delay={0.05} duration={0.8} yOffset={10} inView>
          <span className="gradient-pill inline-flex items-center gap-2 rounded-full px-4 py-1.5">
            <ShieldCheck className="w-3 h-3 text-neutral-400 shrink-0" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-neutral-300">
              Security
            </span>
          </span>
        </BlurFade>

        <BlurFade delay={0.15} duration={0.8} yOffset={15} inView>
          {/* Capped at 60px — the landing hero's size is the ceiling for the
              site, and a secondary page must not exceed it. */}
          <h1 className="mt-8 text-4xl md:text-[60px] font-medium tracking-[-0.035em] leading-[1.08] bg-gradient-to-b from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent pb-2">
            We can&apos;t read your email.
            <br />
            Architecture, not a promise.
          </h1>
        </BlurFade>

        <WordBlurReveal
          text="Your email is encrypted in your browser before it reaches our servers. Personal data is stripped before any AI sees it. And nothing sends without your approval."
          delayMs={200}
          className="mt-6 text-neutral-400 text-sm md:text-base max-w-xl mx-auto font-light leading-relaxed"
        />
      </section>

      {/* THE THREE PILLARS */}
      <section className="relative z-10 w-full max-w-6xl px-6 pb-16 md:pb-24 border-t border-white/[0.06] pt-16 md:pt-24">
        <SectionHeader
          pill="How it works"
          icon={Eye}
          heading="Three guarantees, built into the system."
          subtitle="Not policies we could quietly change — properties of how the product is put together."
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PILLARS.map((pillar, i) => {
            const PillarIcon = pillar.icon;
            return (
              <BlurFade key={pillar.title} delay={0.1 + i * 0.08} duration={0.8} inView className="h-full">
                <div className="linear-grid-card linear-grid-card-lift h-full p-8 flex flex-col">
                  <span className="gradient-tile w-12 h-12 relative z-10">
                    <PillarIcon className="w-5 h-5 text-white" />
                  </span>

                  <h3 className="mt-6 text-lg font-semibold text-white relative z-10">
                    {pillar.title}
                  </h3>

                  <WordBlurReveal
                    text={pillar.body}
                    className="mt-3 text-sm text-neutral-400 font-light leading-relaxed font-sans relative z-10"
                  />

                  <div className="mt-8 pt-4 border-t border-white/[0.06] flex items-center gap-2 text-[10px] uppercase font-bold text-neutral-500 tracking-wider relative z-10">
                    {/* Was text-emerald-450 — a class that does not exist, so
                        this tick rendered in the inherited grey. */}
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>{pillar.proof}</span>
                  </div>
                </div>
              </BlurFade>
            );
          })}
        </div>
      </section>

      {/* THE EXACT PERMISSIONS — the real OAuth scopes, plainly */}
      <section className="relative z-10 w-full max-w-5xl px-6 pb-16 md:pb-24 border-t border-white/[0.06] pt-16 md:pt-24">
        <SectionHeader
          pill="What we ask Google for"
          icon={KeyRound}
          heading="Three permissions. No more."
          subtitle="Exactly what the Google consent screen shows you — and why each one is there."
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {SCOPES.map((scope, i) => (
            <BlurFade key={scope.label} delay={0.1 + i * 0.08} duration={0.8} inView className="h-full">
              <div className="linear-grid-card h-full p-8 flex flex-col">
                <span className="font-mono text-[11px] tracking-tight text-emerald-400 relative z-10">
                  {scope.label}
                </span>
                <h3 className="mt-3 text-lg font-semibold text-white relative z-10">
                  {scope.plain}
                </h3>
                <p className="mt-3 text-sm text-neutral-400 font-light leading-relaxed font-sans relative z-10">
                  {scope.why}
                </p>
              </div>
            </BlurFade>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-neutral-500 font-sans">
          We never request access to Drive, Contacts, or the rest of your Google account.
        </p>
      </section>

      {/* SECURITY FAQ */}
      <section className="relative z-10 w-full max-w-4xl px-6 pb-16 md:pb-24 border-t border-white/[0.06] pt-16 md:pt-24">
        <SectionHeader
          pill="Straight answers"
          icon={ShieldCheck}
          heading="What people ask before they trust us."
          subtitle="No hedging. If a question isn't here, the answer is one email away."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {SECURITY_FAQS.map((faq, i) => {
            const FaqIcon = faq.icon;
            return (
              <BlurFade key={faq.q} delay={0.1 + i * 0.06} duration={0.8} inView className="h-full">
                <div className="linear-grid-card h-full p-8 flex flex-col">
                  <div className="flex items-start gap-3 relative z-10">
                    <span className="gradient-tile w-9 h-9 shrink-0">
                      <FaqIcon className="w-4 h-4 text-white" />
                    </span>
                    <h3 className="text-base font-semibold text-white leading-snug pt-1.5">
                      {faq.q}
                    </h3>
                  </div>
                  <p className="mt-4 text-sm text-neutral-400 font-light leading-relaxed font-sans relative z-10">
                    {faq.a}
                  </p>
                </div>
              </BlurFade>
            );
          })}
        </div>
      </section>

      {/* RELATED READING — real, existing pages only */}
      <section className="relative z-10 w-full max-w-5xl px-6 pb-16 md:pb-24 border-t border-white/[0.06] pt-16 md:pt-24">
        <SectionHeader
          pill="Read further"
          icon={BookOpen}
          heading="The full picture, in your own time."
          subtitle="The architecture, the policies, and the switch that's always yours to flip."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {RESOURCES.map((res, i) => {
            const ResIcon = res.icon;
            return (
              <BlurFade key={res.title} delay={0.1 + i * 0.07} duration={0.8} inView className="h-full">
                <Link
                  href={res.href}
                  {...(res.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="linear-grid-card linear-grid-card-lift h-full p-8 flex flex-col group cursor-pointer no-underline"
                >
                  <div className="flex items-center justify-between relative z-10">
                    <span className="gradient-tile w-10 h-10">
                      <ResIcon className="w-4 h-4 text-white" />
                    </span>
                    <ArrowUpRight className="w-4 h-4 text-neutral-600 group-hover:text-white transition-colors" />
                  </div>
                  <span className="mt-6 font-mono text-[10px] tracking-[0.2em] uppercase text-neutral-500 relative z-10">
                    {res.kind}
                  </span>
                  <h3 className="mt-2 text-lg font-semibold text-white relative z-10">
                    {res.title}
                  </h3>
                  <p className="mt-2 text-sm text-neutral-400 font-light leading-relaxed font-sans relative z-10">
                    {res.desc}
                  </p>
                </Link>
              </BlurFade>
            );
          })}
        </div>
      </section>

      {/* CLOSING TRUST STRIP */}
      <section className="relative z-10 w-full max-w-4xl px-6 pb-32">
        <BlurFade delay={0.1} duration={0.8} yOffset={15} inView>
          <div className="linear-grid-card p-8 md:p-12 text-center">
            <p className="text-sm text-neutral-300 font-light leading-relaxed max-w-xl mx-auto font-sans relative z-10">
              Every claim here is verifiable in how the product behaves: encryption happens in your browser, drafts wait for your approval, and revoking access takes one click in your Google account.
            </p>
            <p className="mt-6 text-sm text-neutral-400 font-light leading-relaxed max-w-xl mx-auto font-sans relative z-10">
              Security questions? Email{" "}
              <Link
                href="mailto:support.maily@gmail.com"
                className="text-white font-semibold hover:underline"
              >
                support.maily@gmail.com
              </Link>{" "}
              — you&apos;ll get an answer from the person who wrote the code.
            </p>
          </div>
        </BlurFade>
      </section>

      <Footer />
      <FloatingNavbar />
    </div>
  );
}
