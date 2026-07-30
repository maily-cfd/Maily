"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// ─── dot-grid SVG accent (top-right area, matches screenshot) ────────────────
function DotGrid({ className }: { className?: string }) {
  const cols = 10;
  const rows = 10;
  return (
    <svg
      aria-hidden="true"
      className={cn("pointer-events-none select-none", className)}
      width={cols * 18}
      height={rows * 18}
    >
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => (
          <circle
            key={`${r}-${c}`}
            cx={c * 18 + 5}
            cy={r * 18 + 5}
            r={1.5}
            fill="rgba(255,255,255,0.12)"
          />
        ))
      )}
    </svg>
  );
}

const PRODUCT_LINKS = [
  { label: "Arcus AI", href: "/product/arcus" },
  { label: "Sift Triage", href: "/product/sift" },
  { label: "Voice Profile", href: "/product/drafts" },
  { label: "Pricing", href: "/pricing" },
  { label: "Changelog", href: "/changelog" },
  { label: "Blogs", href: "/blogs" },
];

const RESOURCES_LINKS = [
  { label: "Security", href: "/security" },
  { label: "Support", href: "/support" },
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms of Service", href: "/terms-of-service" },
];

const SOCIALS = [
  {
    label: "X / Twitter",
    href: "https://x.com/maulik_5",
    icon: (
      <svg viewBox="0 0 24 24" className="w-[14px] h-[14px] fill-current" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.265 5.637 5.9-5.637Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    label: "GitHub",
    href: "https://github.com/Maulik-gpt",
    icon: (
      <svg viewBox="0 0 24 24" className="w-[14px] h-[14px] fill-current" aria-hidden="true">
        <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    href: "https://instagram.com/mailientz",
    icon: (
      <svg viewBox="0 0 24 24" className="w-[14px] h-[14px] fill-current" aria-hidden="true">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
      </svg>
    ),
  },
];

export function Footer() {
  const [modalType, setModalType] = React.useState<"creator" | "affiliate" | null>(null);
  const [email, setEmail] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !modalType) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, type: modalType }),
      });
      if (response.ok) {
        setSubmitted(true);
      } else {
        const err = await response.json().catch(() => ({}));
        setError(err.error || 'Something went wrong submitting your application. Please try again.');
      }
    } catch (err) {
      console.error('Error submitting application:', err);
      setError('We couldn’t reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setModalType(null);
    setEmail("");
    setSubmitted(false);
    setSubmitting(false);
  };

  return (
    <footer className="w-full bg-[#0a0a0a] border-t border-white/[0.06] text-neutral-400 font-sans">
      {/* Main grid */}
      <div className="max-w-7xl mx-auto px-8 pt-16 pb-10 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-12">

        {/* Left — brand + tagline */}
        <div className="flex flex-col gap-5 max-w-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[25%] overflow-hidden border border-white/10 bg-white shadow-md shrink-0">
              <img src="/mailient-logo-premium.png" alt="Mailient" className="w-full h-full object-cover" />
            </div>
            <span className="font-extrabold text-[15px] tracking-tight text-white font-satoshi">Mailient</span>
          </div>
          <p className="text-[13px] leading-relaxed text-neutral-500 font-light">
            Mailient removes email from your to-do list entirely. You go build — we&apos;ll handle the inbox.
          </p>
          {/* Socials */}
          <div className="flex items-center gap-4 mt-1">
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                className="text-neutral-500 hover:text-white transition-colors duration-200"
              >
                {s.icon}
              </a>
            ))}
          </div>
        </div>

        {/* Right — columns + dot-grid accent */}
        <div className="relative flex items-start gap-16">
          {/* Dot-grid accent — top-right, same aesthetic as screenshot */}
          <DotGrid className="absolute -top-4 right-0 opacity-60 hidden lg:block" />

          {/* Product column */}
          <div className="relative z-10">
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-neutral-600 mb-5">Product</p>
            <ul className="space-y-3">
              {PRODUCT_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-[13px] text-neutral-400 hover:text-white transition-colors duration-200 font-medium"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources column */}
          <div className="relative z-10">
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-neutral-600 mb-5">Resources</p>
            <ul className="space-y-3">
              {RESOURCES_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-[13px] text-neutral-400 hover:text-white transition-colors duration-200 font-medium"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Join Us column */}
          <div className="relative z-10">
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-neutral-600 mb-5">Join Us</p>
            <ul className="space-y-3">
              <li>
                <button
                  onClick={() => setModalType("creator")}
                  className="text-[13px] text-neutral-400 hover:text-white transition-colors duration-200 font-medium block text-left bg-transparent border-0 p-0 cursor-pointer focus:outline-none"
                >
                  Apply as Creator
                </button>
                <span className="text-[9px] text-neutral-650 font-mono block mt-0.5">Build AI Agents (RevShare)</span>
              </li>
              <li>
                <button
                  onClick={() => setModalType("affiliate")}
                  className="text-[13px] text-neutral-400 hover:text-white transition-colors duration-200 font-medium block text-left bg-transparent border-0 p-0 cursor-pointer focus:outline-none"
                >
                  Apply as Affiliate
                </button>
                <span className="text-[9px] text-neutral-650 font-mono block mt-0.5">Earn recurring commissions</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Big brand text */}
      <div className="w-full flex justify-center items-center pointer-events-none select-none pt-12 pb-6 overflow-hidden max-w-7xl mx-auto">
        <span className="text-[20vw] lg:text-[15rem] leading-none font-bold tracking-tighter text-white/[0.02]">
          mailient
        </span>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/[0.05] px-8 py-5 max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-[11px] text-neutral-600 font-mono">
          &copy; {new Date().getFullYear()} Mailient Inc. All rights reserved.
        </p>
        <div className="flex items-center gap-5">
          <Link href="/terms-of-service" className="text-[11px] text-neutral-600 hover:text-neutral-300 transition-colors">
            Terms of Service
          </Link>
          <Link href="/privacy-policy" className="text-[11px] text-neutral-600 hover:text-neutral-300 transition-colors">
            Privacy Policy
          </Link>
        </div>
      </div>

      {/* Premium Application Modal */}
      {modalType && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md transition-all duration-500">
          <div className="absolute inset-0 z-0" onClick={handleClose} />
          
          <div className="relative z-10 w-full max-w-[440px] rounded-[2.5rem] bg-[#0A0A0A] border border-[#2A2A2A] p-8 md:p-10 shadow-[0_32px_128px_-16px_rgba(0,0,0,0.8)] text-left flex flex-col gap-6">
            <button 
              onClick={handleClose}
              className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/20 hover:text-white transition-all shadow-sm focus:outline-none"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>

            <div className="space-y-2 mt-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.03] border border-white/[0.08] text-[9px] font-mono tracking-wider uppercase text-neutral-400">
                Partner Loop // {modalType === "creator" ? "Creator" : "Affiliate"}
              </span>
              <h3 className="text-xl font-bold text-white tracking-tight">
                {modalType === "creator" ? "Apply as Creator" : "Apply as Affiliate"}
              </h3>
            </div>

            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-[13px] leading-relaxed text-neutral-400 font-light font-sans">
                  {modalType === "creator" 
                    ? "Join as an early AI engineer. Design and publish autonomous email workflow agents to our upcoming Arcus Marketplace. Earn a lucrative 70% revenue share on every execution or subscription you power."
                    : "Become a Mailient partner. Promote our autonomous inbox loop and earn a massive 30% recurring lifetime commission on all subscriptions you refer. No upfront payment required."}
                </p>
                <div className="space-y-3">
                  <label className="text-[10px] font-bold tracking-wider uppercase text-neutral-500 block">Your Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-2xl bg-white/[0.03] border border-white/5 px-5 py-3.5 text-[14px] text-white placeholder:text-white/25 focus:border-white/10 focus:outline-none transition-all leading-normal"
                  />
                </div>
                {error && (
                  <p className="text-[13px] leading-relaxed text-red-400 font-sans" role="alert">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3.5 rounded-2xl bg-white text-black font-bold text-sm active:scale-95 transition-all flex items-center justify-center gap-2 hover:bg-white/90 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed shadow-md cursor-pointer mt-2"
                >
                  {submitting ? "Submitting..." : "Submit Application"}
                </button>
              </form>
            ) : (
              <div className="space-y-4 py-4 text-center flex flex-col items-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-lg mb-2">
                  ✓
                </div>
                <h4 className="text-md font-bold text-white">Application Received!</h4>
                <p className="text-[12px] leading-relaxed text-neutral-400 font-light font-sans max-w-sm">
                  We have queued your email <span className="text-white font-medium">{email}</span>. A founding partner will reach out within 24 hours with your revenue-share onboarding instructions.
                </p>
                <button
                  onClick={handleClose}
                  className="px-6 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] text-white hover:bg-white/5 font-semibold text-xs transition-colors mt-4 cursor-pointer"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </footer>
  );
}
