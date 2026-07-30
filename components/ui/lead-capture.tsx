"use client";

import { useState } from "react";
import { ArrowRight, Check, Mail } from "lucide-react";
import { BlurFade } from "@/components/ui/blur-fade";

/**
 * Landing-page email capture — the soft conversion for the ~94% of visitors who
 * leave without connecting Gmail (341 landing visits -> 20 signups).
 *
 * OPT-IN ONLY. It sends the visitor's OWN typed email to /api/leads, which fires
 * one strong hook email. It never touches anonymous visitors — there is no email
 * to send to a pageview, and we don't de-anonymise anyone.
 *
 * The promise here matches what the email actually delivers (the founder's
 * one-line case for the product), so nothing is oversold.
 */
export function LeadCapture() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState(""); // honeypot — real users never see this
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "loading") return;
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company, source: "landing" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Something went wrong. Try again.");
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setError("Something went wrong. Try again.");
      setState("error");
    }
  };

  return (
    <section className="py-16 md:py-28 px-6 w-full max-w-3xl mx-auto border-t border-white/[0.06] z-10 relative">
      <BlurFade delay={0.1} duration={0.8} inView>
        <div className="linear-grid-card p-8 md:p-12 text-center relative">
          <span className="gradient-tile w-11 h-11 mx-auto relative z-10">
            <Mail className="w-5 h-5 text-white" />
          </span>

          <h2 className="mt-6 text-2xl md:text-[32px] font-medium tracking-[-0.025em] leading-tight bg-gradient-to-b from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent relative z-10">
            Not ready to connect Gmail?
          </h2>
          <p className="mt-3 text-sm md:text-base text-[#c8ccd4] font-light leading-relaxed max-w-md mx-auto relative z-10">
            Leave your email. I&apos;ll send you the 60-second case for why Mailient exists — start whenever you&apos;re ready.
          </p>

          {state === "done" ? (
            <div className="mt-8 inline-flex items-center gap-2 text-sm text-emerald-400 relative z-10">
              <Check className="w-4 h-4" />
              Sent. Check your inbox.
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 relative z-10">
              {/* Honeypot: positioned off-screen, hidden from real users. */}
              <div aria-hidden="true" className="absolute left-[-9999px] top-0 w-px h-px overflow-hidden">
                <label>
                  Company
                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </label>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch gap-3 max-w-md mx-auto">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  aria-label="Your email"
                  className="flex-1 rounded-full bg-white/[0.03] border border-white/15 px-5 py-3 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/30 transition-colors"
                />
                <button
                  type="submit"
                  disabled={state === "loading"}
                  className="rounded-full bg-white text-black font-semibold text-sm px-6 py-3 inline-flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors disabled:opacity-60 shrink-0"
                >
                  {state === "loading" ? "Sending…" : <>Send it <ArrowRight className="w-4 h-4" aria-hidden="true" /></>}
                </button>
              </div>

              {state === "error" && (
                <p className="mt-3 text-xs text-red-400">{error}</p>
              )}
              <p className="mt-4 text-[11px] text-neutral-400">
                One email. No list, no spam — unsubscribe by ignoring it.
              </p>
            </form>
          )}
        </div>
      </BlurFade>
    </section>
  );
}
