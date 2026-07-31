"use client";

import { useState, useEffect, useRef, Suspense, lazy } from "react";
import { motion, AnimatePresence, useMotionValue, useMotionTemplate } from "framer-motion";
import { Layers, Check, Shield, Zap, Sparkles, ArrowRight, Mail, Play, AlertCircle, ShieldCheck, ChevronRight } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { FloatingNavbar } from "@/components/FloatingNavbar";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { Footer } from "@/components/Footer";
import { CircleExpandButton } from "@/components/CircleExpandButton";
import { DemoVideo } from "@/components/ui/demo-video";

const Dithering = lazy(() => 
  import("@paper-design/shaders-react").then((mod) => ({ default: mod.Dithering }))
);

export default function SiftProductPage() {
  const [activeTab, setActiveTab] = useState(0);

  // Mouse position tracker for cursor-reactive lighting on card
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const { left, top } = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - left);
    mouseY.set(e.clientY - top);
  };

  useEffect(() => {
    document.title = "Sift — only what needs you | Mailient";
  }, []);

  return (
    <div className="min-h-screen bg-[#000000] text-white flex flex-col items-center justify-start overflow-x-hidden font-satoshi strichpunkt-theme relative selection:bg-white selection:text-black">
      
      {/* 0. Custom Radar & Orbital Keyframes */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes radar-pulse {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.05); opacity: 0.4; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
      `}} />

      {/* Atmospheric lighting */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        <div className="absolute top-[4%] left-1/2 -translate-x-1/2 w-[1000px] h-[500px] rounded-full bg-neutral-900/10 blur-[180px]" />
        <div className="absolute top-[25%] left-[5%] w-[500px] h-[500px] rounded-full bg-white/[0.005] blur-[150px]" />
        <div className="absolute bottom-[20%] right-[5%] w-[800px] h-[800px] rounded-full bg-neutral-950/20 blur-[200px]" />
      </div>

      {/* Sticky Translucent Header */}
      <Navbar theme="dark" />

      {/* 1. HERO SECTION */}
      <section className="relative w-full pt-40 pb-20 md:pt-48 px-6 flex flex-col items-center text-center max-w-7xl mx-auto z-10">
        
        {/* WebGL Backing Shader */}
        <Suspense fallback={<div className="absolute inset-0 bg-[#000000] pointer-events-none" />}>
          <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.06] blur-[90px] scale-[1.05] mix-blend-screen [mask-image:radial-gradient(ellipse_at_center,black_45%,transparent_85%)]">
            <Dithering
              colorBack="#000000" 
              colorFront="#ffffff"
              shape="warp"
              type="4x4"
              speed={0.15}
              className="size-full"
              minPixelRatio={1}
            />
          </div>
        </Suspense>

        <div className="w-full flex flex-col items-center max-w-5xl z-10">
          
          {/* Eyebrow Platform Badge */}
          <BlurFade delay={0.05} duration={0.8} yOffset={10} inView>
            <div className="inline-flex items-center gap-2.5 px-4 py-1 rounded-full bg-white/[0.02] border border-white/[0.05] shadow-2xl mb-8">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neutral-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-neutral-300"></span>
              </span>
              <span className="text-[10px] font-medium tracking-[0.15em] text-[#8a8f98] uppercase font-mono">
                Product // Sift
              </span>
            </div>
          </BlurFade>

          {/* Headline & Subtitle */}
          <BlurFade delay={0.15} duration={0.8} yOffset={15} inView>
            <h1 className="text-4xl md:text-[68px] font-medium tracking-[-0.03em] text-white leading-[1.08] max-w-4xl">
              Only the emails that <br />deserve your attention.
            </h1>
          </BlurFade>

          <BlurFade delay={0.28} duration={0.8} yOffset={12} inView>
            <p className="text-base md:text-[18px] text-[#8a8f98] leading-relaxed max-w-2xl mt-6 font-light font-sans">
              Mailient separates the deals, decisions, and real requests from the newsletters and noise — automatically. You see a handful of emails a day. It handles the rest.
            </p>
          </BlurFade>

          {/* Premium CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-4 mt-12">
            <CircleExpandButton
              onClick={() => signIn("google", { callbackUrl: "/onboarding" })}
            >
              Connect Gmail for Sift
            </CircleExpandButton>

            <CircleExpandButton
              href="#sift-showcase"
              variant="secondary"
            >
              Watch Sift work
            </CircleExpandButton>
          </div>

        </div>
      </section>

      {/* 2. INTERACTIVE WIDGET SHOWCASE */}
      <section id="sift-showcase" className="py-32 px-6 w-full max-w-7xl mx-auto border-t border-white/[0.06] z-10 relative">
        <div 
          className="w-full linear-grid-card !rounded-[32px] p-8 md:p-16 flex flex-col lg:flex-row gap-16 items-center relative group"
          onMouseMove={handleMouseMove}
        >
          {/* Card Cursor Lighting Glow spotlight */}
          <motion.div
            className="absolute inset-0 z-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
            style={{
              background: useMotionTemplate`radial-gradient(800px circle at ${mouseX}px ${mouseY}px, rgba(255,255,255,0.015), transparent 80%)`,
            }}
          />

          <div className="flex-1 space-y-6 text-left relative z-10">
            <span className="px-3.5 py-1 rounded-full bg-neutral-900 border border-white/[0.08] text-[9px] font-mono tracking-[0.15em] text-[#8a8f98] uppercase">
              HOW IT DECIDES
            </span>

            <h2 className="text-4xl md:text-[54px] font-medium tracking-[-0.03em] text-white leading-tight font-sans">
              It reads everything. You read almost nothing.
            </h2>

            <p className="text-xs text-neutral-400 leading-relaxed font-light font-sans max-w-xl">
              It doesn't match keywords — it reads every message the way you would, and understands who's asking, what they want, and whether it can wait.
            </p>

            <ul className="space-y-4 pt-2">
              <li className="flex items-start gap-3 text-xs text-neutral-300 font-light">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Opportunities surface:</strong> investor emails, warm leads, and partnership asks rise straight to the top.</span>
              </li>
              <li className="flex items-start gap-3 text-xs text-neutral-300 font-light">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Noise disappears:</strong> newsletters and promotions get archived silently — you never see them.</span>
              </li>
              <li className="flex items-start gap-3 text-xs text-neutral-300 font-light">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Urgent means urgent:</strong> real deadlines and direct customer asks get flagged, with the reason why.</span>
              </li>
            </ul>
          </div>

          {/* Real product footage — no coded inbox mockup */}
          <div className="flex-1 w-full linear-grid-card !rounded-2xl overflow-hidden h-[340px] relative">
            <DemoVideo
              src="/demos/home-feed-demo.mp4"
              poster="/demos/home-feed-demo.jpg"
              label="Sift on a real inbox — only the emails that need a decision"
              className="absolute inset-0 w-full h-full"
            />
          </div>

        </div>
      </section>

      {/* 3. SECURITY STRIP */}
      <section className="py-20 px-6 w-full max-w-7xl mx-auto border-t border-white/[0.06] z-10 relative">
        <div className="w-full linear-grid-card !rounded-[20px] py-4 px-6 hover:shadow-[0_20px_40px_rgba(99,102,241,0.06)] hover:border-white/[0.1] transition-all duration-300 flex items-center justify-between text-left cursor-pointer">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
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

      <Footer />

      {/* Premium Progressive Blurs for Top/Bottom edges */}
      <ProgressiveBlur position="top" backgroundColor="#000000" height="120px" blurAmount="10px" className="fixed z-40" />
      <ProgressiveBlur position="bottom" backgroundColor="#000000" height="80px" blurAmount="10px" className="fixed z-40" />

      {/* Premium Liquid Glass Floating Navigation Overlay */}
      <FloatingNavbar />
    </div>
  );
}
