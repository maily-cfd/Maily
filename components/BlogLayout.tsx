"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useTheme } from "next-themes";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { Footer } from "@/components/Footer";
import { DynamicIslandTOC } from "@/components/ui/dynamic-island-toc";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { BlurFade } from "@/components/ui/blur-fade";
import AnimatedGradient from "@/components/ui/animated-gradient";
import { ArrowLeft, Clock, Calendar, ChevronRight, ArrowRight } from "lucide-react";

interface BlogMeta {
  title: string;
  description: string;
  date: string;
  readTime: string;
  category: string;
  slug: string;
  author?: string;
}

interface RelatedPost {
  title: string;
  slug: string;
  category: string;
  readTime: string;
}

interface BlogLayoutProps {
  meta: BlogMeta;
  children: React.ReactNode;
  tableOfContents?: { id: string; label: string }[];
  relatedPosts?: RelatedPost[];
}

export function BlogLayout({ meta, children, tableOfContents = [], relatedPosts = [] }: BlogLayoutProps) {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [readProgress, setReadProgress] = useState(0);
  const [activeSection, setActiveSection] = useState("");

  // Article structured data — built from the same meta object every post
  // already passes, so all posts (and future ones) get schema for free.
  // Client components are still server-rendered, so this is in the initial HTML.
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: meta.title,
    description: meta.description,
    datePublished: new Date(meta.date).toISOString(),
    url: `https://maily.cfd/blogs/${meta.slug}`,
    mainEntityOfPage: `https://maily.cfd/blogs/${meta.slug}`,
    author: { "@type": "Organization", name: "Maily", url: "https://x.com/Mailycfd" },
    publisher: {
      "@type": "Organization",
      name: "Maily",
      url: "https://maily.cfd",
      logo: { "@type": "ImageObject", url: "https://maily.cfd/logo-maily.png" },
    },
  };

  useEffect(() => {
    setMounted(true);
    document.title = `${meta.title} // Maily Blog`;
  }, [meta.title]);

  const isDark = mounted && (resolvedTheme === "dark" || theme === "dark");
  const currentTheme = isDark ? "dark" : "light";
  const blurBg = isDark ? "#0a0a0a" : "#ffffff";

  useEffect(() => {
    const handleScroll = () => {
      const article = document.getElementById("blog-article");
      if (!article) return;
      const rect = article.getBoundingClientRect();
      const scrollHeight = article.scrollHeight - window.innerHeight;
      const scrolled = Math.max(0, -rect.top);
      const progress = Math.min(100, (scrolled / scrollHeight) * 100);
      setReadProgress(progress);

      // Track active TOC section
      if (tableOfContents.length > 0) {
        for (let i = tableOfContents.length - 1; i >= 0; i--) {
          const el = document.getElementById(tableOfContents[i].id);
          if (el) {
            const elRect = el.getBoundingClientRect();
            if (elRect.top <= 120) {
              setActiveSection(tableOfContents[i].id);
              break;
            }
          }
        }
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [tableOfContents]);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-[#1a1a1a] dark:text-[#fafafa] flex flex-col items-center justify-start overflow-x-hidden font-satoshi strichpunkt-theme relative selection:bg-neutral-200 dark:selection:bg-neutral-800 transition-colors duration-500">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <Navbar theme={currentTheme === "dark" ? "dark" : "light"} />
      <div className="fixed top-8 right-8 z-50">
        <AnimatedThemeToggler className="bg-white/80 dark:bg-black/80 backdrop-blur-md shadow-sm border border-neutral-200 dark:border-neutral-800" />
      </div>

      {/* Reading Progress Bar */}
      <div className="fixed top-0 left-0 right-0 z-[60] h-[2px] bg-transparent">
        <div
          className="h-full bg-gradient-to-r from-neutral-500 dark:neutral-500 via-white to-neutral-400 dark:neutral-400 transition-all duration-150 ease-out"
          style={{ width: `${readProgress}%` }}
        />
      </div>

      {/* Atmospheric backgrounds */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.012]"
          style={{
            backgroundImage: `radial-gradient(circle, #fff 1px, transparent 1px)`,
            backgroundSize: "24px 24px"
          }}
        />
        <div className="absolute top-[10%] left-1/4 w-[800px] h-[500px] rounded-full bg-[radial-gradient(circle,rgba(150,150,150,0.012),transparent_70%)] blur-[100px]" />
        <div className="absolute top-[50%] right-1/4 w-[700px] h-[500px] rounded-full bg-[radial-gradient(circle,rgba(150,150,150,0.008),transparent_70%)] blur-[120px]" />
      </div>

      <AnimatedGradient
        config={{ preset: "Prism", speed: 6 }}
        noise={{ opacity: 0.006 }}
        className="opacity-10 pointer-events-none"
      />

      {/* Hero / Article Header */}
      <section className="relative z-10 pt-36 pb-12 md:pt-44 md:pb-16 px-6 text-center max-w-4xl mx-auto flex flex-col items-center space-y-5">
        {/* Back to blog */}
        <BlurFade delay={0.05} duration={0.7} yOffset={8} inView>
          <Link
            href="/blogs"
            className="inline-flex items-center gap-2 text-[11px] font-medium tracking-wide text-neutral-500 dark:text-neutral-500 hover:text-neutral-300 transition-colors uppercase group mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            All Posts
          </Link>
        </BlurFade>

        {/* Category Badge */}
        <BlurFade delay={0.1} duration={0.8} yOffset={10} inView>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.06] shadow-2xl">
            <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 dark:neutral-400 animate-pulse" />
            <span className="text-[10px] font-medium tracking-[0.2em] text-neutral-600 dark:text-neutral-400 uppercase">
              {meta.category}
            </span>
          </div>
        </BlurFade>

        {/* Title */}
        <BlurFade delay={0.18} duration={0.8} yOffset={14} inView>
          <h1 className="text-3xl md:text-[52px] font-medium tracking-[-0.035em] text-black dark:text-white leading-[1.12] max-w-3xl">
            {meta.title}
          </h1>
        </BlurFade>

        {/* Subtitle / Description */}
        <BlurFade delay={0.26} duration={0.8} yOffset={10} inView>
          <p className="text-neutral-600 dark:text-neutral-400 text-sm md:text-base max-w-2xl mx-auto font-light leading-relaxed tracking-tight">
            {meta.description}
          </p>
        </BlurFade>

        {/* Meta Row */}
        <BlurFade delay={0.32} duration={0.8} yOffset={8} inView>
          <div className="flex items-center gap-5 text-[11px] text-neutral-500 dark:text-neutral-500 font-medium">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {meta.date}
            </span>
            <span className="w-1 h-1 rounded-full bg-neutral-700" />
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {meta.readTime}
            </span>
            <span className="w-1 h-1 rounded-full bg-neutral-700" />
            <span>{meta.author || "Maily"}</span>
          </div>
        </BlurFade>

        {/* Divider */}
        <div className="w-full max-w-xl h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent mt-4" />
      </section>

      {/* Article Body + TOC Sidebar */}
      <section className="relative z-10 w-full max-w-7xl mx-auto px-6 pb-20">
        <div className="flex gap-12 items-start">
          {/* Table of Contents — Desktop Sidebar */}
          {tableOfContents.length > 0 && (
            <aside className="hidden xl:block w-56 shrink-0 sticky top-28">
              <BlurFade delay={0.4} duration={0.8} yOffset={10} inView>
                <div className="space-y-1">
                  <span className="text-[9px] font-bold tracking-[0.2em] text-neutral-600 uppercase block mb-3">
                    In this article
                  </span>
                  {tableOfContents.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className={`block text-[11px] py-1.5 pl-3 border-l-2 transition-all duration-300 font-medium ${
                        activeSection === item.id
                          ? "border-neutral-400 dark:neutral-400 text-black dark:text-white"
                          : "border-black/[0.04] dark:border-white/[0.04] text-neutral-500 dark:text-neutral-500 hover:text-neutral-300 hover:border-white/[0.1]"
                      }`}
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              </BlurFade>
            </aside>
          )}

          {/* Main Article Content */}
          <article
            id="blog-article"
            className="flex-1 max-w-[720px] mx-auto blog-article-content"
          >
            <BlurFade delay={0.38} duration={0.9} yOffset={16} inView>
              {children}
            </BlurFade>
          </article>
        </div>
      </section>

      {/* Related Posts */}
      {relatedPosts.length > 0 && (
        <section className="relative z-10 w-full max-w-4xl mx-auto px-6 pb-16">
          <div className="border-t border-black/[0.06] dark:border-white/[0.06] pt-12">
            <h3 className="text-xs font-bold tracking-[0.2em] text-neutral-500 dark:text-neutral-500 uppercase mb-8">
              Continue Reading
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {relatedPosts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blogs/${post.slug}`}
                  className="group block p-6 rounded-2xl border border-black/[0.04] dark:border-white/[0.04] bg-black/[0.01] dark:bg-white/[0.01] hover:bg-black/[0.03] dark:hover:bg-white/[0.03] hover:border-black/[0.08] dark:hover:border-white/[0.08] transition-all duration-300"
                >
                  <span className="text-[9px] font-bold tracking-[0.15em] text-neutral-600 dark:text-neutral-400 dark:neutral-400 uppercase block mb-2">
                    {post.category}
                  </span>
                  <span className="text-sm font-semibold text-black dark:text-white group-hover:text-neutral-200 transition-colors block leading-snug">
                    {post.title}
                  </span>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-2 flex items-center gap-1.5">
                    {post.readTime}
                    <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA Section */}
      <section className="relative z-10 w-full max-w-4xl mx-auto px-6 pb-24">
        <div className="border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.01] dark:bg-white/[0.01] backdrop-blur-xl rounded-3xl p-10 md:p-14 text-center space-y-5 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(163,163,163,0.06),transparent_60%)] pointer-events-none" />
          <h3 className="text-2xl md:text-3xl font-medium tracking-tight text-black dark:text-white relative z-10">
            Ready to reclaim your inbox?
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 font-light max-w-md mx-auto relative z-10">
            Maily handles your email while you sleep. Autonomous triage, voice-matched drafts, and encrypted privacy — all on autopilot.
          </p>
          <a
            href="/auth/signup"
            className="inline-flex items-center gap-2 px-7 py-3 bg-white text-black font-bold text-sm rounded-full hover:bg-neutral-200 transition-colors relative z-10"
          >
            Get started free
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>

      <Footer />

      <ProgressiveBlur position="top" backgroundColor="var(--blur-bg)" height="120px" blurAmount="10px" className="fixed z-40" />
      <ProgressiveBlur position="bottom" backgroundColor="var(--blur-bg)" height="80px" blurAmount="10px" className="fixed z-40" />
      <DynamicIslandTOC selector=".blog-article-content h2, .blog-article-content h3" />

      {/* Blog Article Typography Styles */}
      <style dangerouslySetInnerHTML={{ __html: `
        .blog-article-content h2 {
          font-size: 1.6rem;
          font-weight: 600;
          color: #1a1a1a;
          margin-top: 3rem;
          margin-bottom: 1rem;
          letter-spacing: -0.02em;
          line-height: 1.3;
          scroll-margin-top: 100px;
        }
        .blog-article-content h3 {
          font-size: 1.2rem;
          font-weight: 600;
          color: #1a1a1a;
          margin-top: 2rem;
          margin-bottom: 0.75rem;
          letter-spacing: -0.01em;
          line-height: 1.4;
          scroll-margin-top: 100px;
        }
        .blog-article-content p {
          font-size: 1rem;
          line-height: 1.85;
          color: #525252;
          margin-bottom: 1.25rem;
          font-weight: 300;
        }
        .blog-article-content strong {
          color: #1a1a1a;
          font-weight: 600;
        }
        .blog-article-content em {
          color: #525252;
          font-style: italic;
        }
        .blog-article-content ul, .blog-article-content ol {
          margin-bottom: 1.25rem;
          padding-left: 1.5rem;
        }
        .blog-article-content li {
          font-size: 1rem;
          line-height: 1.85;
          color: #525252;
          margin-bottom: 0.5rem;
          font-weight: 300;
        }
        .blog-article-content li::marker {
          color: #525252;
        }
        .blog-article-content a {
          color: #1a1a1a;
          text-decoration: underline;
          text-underline-offset: 3px;
          transition: color 0.2s;
        }
        .blog-article-content a:hover {
          color: #1a1a1a;
        }
        .blog-article-content blockquote {
          border-left: 3px solid var(--border);
          padding-left: 1.25rem;
          margin: 1.5rem 0;
          color: #525252;
          font-style: italic;
          font-weight: 300;
        }
        .blog-article-content .callout-box {
          background: var(--secondary);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 1.5rem;
          margin: 1.5rem 0;
        }
        .blog-article-content .callout-box p {
          margin-bottom: 0;
        }
        .blog-article-content hr {
          border: none;
          border-top: 1px solid var(--border);
          margin: 2.5rem 0;
        }
        .blog-article-content code {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
          background: var(--accent);
          border: 1px solid var(--border);
          padding: 0.15rem 0.4rem;
          border-radius: 6px;
          font-size: 0.875rem;
          color: #1a1a1a;
        }
        .dark .blog-article-content h2, 
        .dark .blog-article-content h3, 
        .dark .blog-article-content strong, 
        .dark .blog-article-content a,
        .dark .blog-article-content code {
          color: #fafafa;
        }
        .dark .blog-article-content p, 
        .dark .blog-article-content li, 
        .dark .blog-article-content em,
        .dark .blog-article-content blockquote {
          color: #d4d4d4;
        }
        .dark .blog-article-content li::marker {
          color: #d4d4d4;
        }
      `}} />
    </div>
  );
}
