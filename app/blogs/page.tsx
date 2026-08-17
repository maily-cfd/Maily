"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useTheme } from "next-themes";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { Footer } from "@/components/Footer";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { BlurFade } from "@/components/ui/blur-fade";
import AnimatedGradient from "@/components/ui/animated-gradient";
import { BookOpen, Clock, ArrowRight, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const BLOG_POSTS = [
  {
    slug: "best-ai-email-assistant-solo-founders",
    title: "Best AI Email Tools for Solo Founders in 2026 — An Honest Comparison",
    excerpt: "Superhuman, Fyxer, Shortwave, Notion Mail, Gmail's Gemini, and Maily — what each is best at, who should skip us, and how to choose by the job you're hiring for.",
    category: "Comparisons",
    date: "July 2, 2026",
    readTime: "9 min read",
    featured: false,
  },
  {
    slug: "what-is-an-ai-email-employee",
    title: "What Is an AI Email Employee? (And Why It's Not an Assistant)",
    excerpt: "It reads, triages, drafts, books, and follows up autonomously — you approve, it works. The definition of the category, and how it differs from copilots and clients.",
    category: "Industry",
    date: "July 2, 2026",
    readTime: "8 min read",
    featured: false,
  },
  {
    slug: "maily-vs-superhuman",
    title: "Maily vs Superhuman: Speed vs Autonomy (Honest 2026 Comparison)",
    excerpt: "Superhuman makes you faster at email. Maily does the email for you. Two opposite philosophies, honestly compared — including who should pick Superhuman.",
    category: "Comparisons",
    date: "July 2, 2026",
    readTime: "8 min read",
    featured: false,
  },
  {
    slug: "maily-vs-fyxer",
    title: "Maily vs Fyxer: Great Drafts vs a Whole Inbox Employee",
    excerpt: "Fyxer drafts your replies and organizes your inbox. Maily runs the whole job — triage, booking, follow-ups, and a morning briefing. The honest head-to-head.",
    category: "Comparisons",
    date: "July 2, 2026",
    readTime: "7 min read",
    featured: false,
  },
  {
    slug: "founders-lose-deals-inbox",
    title: "Why Founders Lose Deals in Their Inbox (And How to Fix It)",
    excerpt: "The hidden cost of inbox overload isn't just wasted time — it's missed revenue. Here's how high-stakes emails slip through the cracks, and what to do about it.",
    category: "Productivity",
    date: "May 24, 2026",
    readTime: "7 min read",
    featured: true,
  },
  {
    slug: "zero-knowledge-encryption-email-privacy",
    title: "Zero-Knowledge Encryption Explained: How Maily Protects Your Email Without Reading It",
    excerpt: "Most AI email tools need to read your data to work. Maily doesn't. A deep dive into the architecture that keeps your inbox private.",
    category: "Security",
    date: "May 23, 2026",
    readTime: "8 min read",
    featured: false,
  },
  {
    slug: "ai-learns-your-writing-style",
    title: "How AI Learns to Write Exactly Like You: Inside Maily's Neural Voice Profile",
    excerpt: "Generic AI drafts damage relationships. Learn how Maily's 90-day voice analysis builds a writing profile that mirrors your tone, sign-offs, and sentence patterns.",
    category: "Engineering",
    date: "May 22, 2026",
    readTime: "7 min read",
    featured: false,
  },
  {
    slug: "ai-email-agent-vs-assistant",
    title: "AI Email Agent vs. AI Email Assistant: What Actually Matters in 2026",
    excerpt: "An assistant answers questions. An agent takes action. Understanding this distinction is the key to choosing the right tool for your inbox.",
    category: "Industry",
    date: "May 21, 2026",
    readTime: "8 min read",
    featured: false,
  },
  {
    slug: "ai-inbox-triage-reclaim-calendar",
    title: "The 3-Hour Email Rule: How AI Inbox Triage Reclaims Your Calendar",
    excerpt: "Professionals spend 3+ hours per day on email. AI triage doesn't just organize — it gives you back the time you didn't know you were losing.",
    category: "Productivity",
    date: "May 20, 2026",
    readTime: "7 min read",
    featured: false,
  },
];

const CATEGORIES = ["All", "Productivity", "Security", "Engineering", "Industry", "Comparisons"];

export default function BlogsPage() {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [activeCategory, setActiveCategory] = useState("All");

  useEffect(() => {
    setMounted(true);
    document.title = "Platform Insights // Maily Blog";
  }, []);

  const isDark = mounted && (resolvedTheme === "dark" || theme === "dark");
  const currentTheme = isDark ? "dark" : "light";
  const blurBg = isDark ? "#0a0a0a" : "#ffffff";

  const filteredPosts = activeCategory === "All"
    ? BLOG_POSTS
    : BLOG_POSTS.filter((p) => p.category === activeCategory);

  const featuredPost = BLOG_POSTS.find((p) => p.featured);
  const regularPosts = filteredPosts.filter((p) => !p.featured || activeCategory !== "All");

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-[#1a1a1a] dark:text-[#fafafa] flex flex-col items-center justify-start overflow-x-hidden font-satoshi strichpunkt-theme relative selection:bg-neutral-200 dark:selection:bg-neutral-800 transition-colors duration-500">
      <Navbar theme={currentTheme === "dark" ? "dark" : "light"} />
      <div className="fixed top-8 right-8 z-50">
        <AnimatedThemeToggler className="bg-white/80 dark:bg-black/80 backdrop-blur-md shadow-sm border border-neutral-200 dark:border-neutral-800" />
      </div>

      {/* Atmospheric backgrounds */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `radial-gradient(circle, #fff 1px, transparent 1px)`,
            backgroundSize: "24px 24px"
          }}
        />
        <div className="absolute top-[15%] left-1/4 w-[800px] h-[500px] rounded-full bg-[radial-gradient(circle,rgba(150,150,150,0.015),transparent_70%)] blur-[100px]" />
        <div className="absolute top-[45%] right-1/4 w-[700px] h-[500px] rounded-full bg-[radial-gradient(circle,rgba(150,150,150,0.01),transparent_70%)] blur-[120px]" />
      </div>

      <AnimatedGradient
        config={{ preset: "Prism", speed: 6 }}
        noise={{ opacity: 0.008 }}
        className="opacity-15 pointer-events-none"
      />

      {/* Hero Section */}
      <section className="relative z-10 pt-40 pb-8 md:pt-48 md:pb-12 px-6 text-center max-w-4xl mx-auto flex flex-col items-center space-y-4">
        <BlurFade delay={0.05} duration={0.8} yOffset={10} inView>
          <div className="inline-flex items-center gap-2.5 px-4.5 py-1.5 rounded-full bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.06] shadow-2xl mb-4 group cursor-pointer hover:border-white/[0.12] transition-colors">
            <BookOpen className="w-3.5 h-3.5 text-neutral-300 animate-pulse" />
            <span className="text-[10px] font-medium tracking-[0.2em] text-neutral-300 uppercase">
              Platform Insights // Blog
            </span>
          </div>
        </BlurFade>

        <BlurFade delay={0.15} duration={0.8} yOffset={15} inView>
          <h1 className="text-4xl md:text-7xl font-light tracking-[-0.04em] text-black dark:text-white leading-tight">
            Engineering Maily. <br />
            <span className="font-medium italic text-neutral-300 bg-gradient-to-r from-neutral-200 via-neutral-400 to-neutral-500 bg-clip-text text-transparent">Deep Dives & Essays.</span>
          </h1>
        </BlurFade>

        <BlurFade delay={0.28} duration={0.8} yOffset={12} inView>
          <p className="text-neutral-600 dark:text-neutral-400 text-sm md:text-base max-w-xl mx-auto font-light leading-relaxed tracking-tight">
            Explore articles on AI email automation, inbox security, voice profiling, and the future of productivity — written by the team building Maily.
          </p>
        </BlurFade>
      </section>

      {/* Category Filter Tabs */}
      <section className="relative z-10 w-full max-w-4xl mx-auto px-6 pb-8">
        <BlurFade delay={0.35} duration={0.8} yOffset={8} inView>
          <div className="flex items-center gap-2 flex-wrap">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-300 border",
                  activeCategory === cat
                    ? "bg-white text-black border-white/20"
                    : "bg-black/[0.02] dark:bg-white/[0.02] text-neutral-600 dark:text-neutral-400 border-black/[0.06] dark:border-white/[0.06] hover:text-black dark:text-white hover:border-white/[0.12]"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </BlurFade>
      </section>

      {/* Featured Post — only show when "All" is active */}
      {activeCategory === "All" && featuredPost && (
        <section className="relative z-10 w-full max-w-4xl mx-auto px-6 pb-6">
          <BlurFade delay={0.4} duration={0.8} yOffset={18} inView>
            <Link
              href={`/blogs/${featuredPost.slug}`}
              className="group block w-full rounded-3xl border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.01] dark:bg-white/[0.01] hover:bg-black/[0.025] dark:hover:bg-white/[0.025] hover:border-white/[0.1] transition-all duration-500 p-8 md:p-10 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(163,163,163,0.04),transparent_60%)] pointer-events-none" />
              <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex-1 space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 rounded-full bg-neutral-500 dark:neutral-500/10 border border-neutral-500 dark:neutral-500/20 text-[9px] font-bold tracking-[0.15em] text-neutral-600 dark:text-neutral-400 dark:neutral-400 uppercase">
                      Featured
                    </span>
                    <span className="text-[10px] text-neutral-500 dark:text-neutral-500 font-medium">{featuredPost.category}</span>
                  </div>
                  <h2 className="text-2xl md:text-3xl font-medium tracking-tight text-black dark:text-white leading-snug group-hover:text-neutral-200 transition-colors">
                    {featuredPost.title}
                  </h2>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 font-light leading-relaxed max-w-lg">
                    {featuredPost.excerpt}
                  </p>
                  <div className="flex items-center gap-4 text-[11px] text-neutral-500 dark:text-neutral-500 font-medium">
                    <span>{featuredPost.date}</span>
                    <span className="w-1 h-1 rounded-full bg-neutral-700" />
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {featuredPost.readTime}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white/[0.04] border border-white/[0.08] group-hover:bg-white/[0.08] transition-all shrink-0">
                  <ArrowRight className="w-5 h-5 text-neutral-600 dark:text-neutral-400 group-hover:text-black dark:text-white group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            </Link>
          </BlurFade>
        </section>
      )}

      {/* Blog Post Grid */}
      <section className="relative z-10 w-full max-w-4xl mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(activeCategory === "All" ? filteredPosts.filter((p) => !p.featured) : filteredPosts).map((post, idx) => (
            <BlurFade key={post.slug} delay={0.45 + idx * 0.08} duration={0.7} yOffset={14} inView>
              <Link
                href={`/blogs/${post.slug}`}
                className="group block h-full rounded-2xl border border-black/[0.04] dark:border-white/[0.04] bg-black/[0.01] dark:bg-white/[0.01] hover:bg-black/[0.025] dark:hover:bg-white/[0.025] hover:border-black/[0.08] dark:hover:border-white/[0.08] transition-all duration-400 p-6 relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(150,150,150,0.008),transparent_50%)] pointer-events-none" />
                <div className="relative z-10 space-y-3 flex flex-col h-full">
                  <div className="flex items-center gap-3">
                    <span className="text-[9px] font-bold tracking-[0.15em] text-neutral-600 dark:text-neutral-400 dark:neutral-400 uppercase">
                      {post.category}
                    </span>
                    <span className="text-[10px] text-neutral-600">{post.date}</span>
                  </div>
                  <h3 className="text-base font-semibold text-black dark:text-white group-hover:text-neutral-200 transition-colors leading-snug flex-1">
                    {post.title}
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-500 font-light leading-relaxed line-clamp-2">
                    {post.excerpt}
                  </p>
                  <div className="flex items-center justify-between pt-2 border-t border-black/[0.04] dark:border-white/[0.04]">
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {post.readTime}
                    </span>
                    <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-black dark:text-white group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>
              </Link>
            </BlurFade>
          ))}
        </div>
      </section>

      <Footer />

      <ProgressiveBlur position="top" backgroundColor="var(--blur-bg)" height="120px" blurAmount="10px" className="fixed z-40" />
      <ProgressiveBlur position="bottom" backgroundColor="var(--blur-bg)" height="80px" blurAmount="10px" className="fixed z-40" />
    </div>
  );
}
