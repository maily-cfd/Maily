"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useMotionValue, useMotionTemplate } from "framer-motion";
import {
  Zap,
  Bot,
  Layers,
  Calendar,
  ChevronRight,
  Mail,
  ArrowRight,
  Sparkles,
  Inbox,
  Minus,
  Plus,
  Play,
  Pause,
  VolumeX,
  Volume2,
  Maximize,
  MoreVertical,
  Lock,
  Globe,
  Server,
  UserCheck,
  Check,
  MessageSquare,
  Terminal,
  Eye,
  Monitor,
  ShieldCheck,
  Clock,
  Briefcase,
  AlertCircle
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import Link from "next/link";
import { cn } from "@/lib/utils";
import PricingSection3 from "@/components/ui/pricing-section-3";
import { useRouter } from "next/navigation";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { Features8 } from "@/components/ui/features-8";
import { CTASection } from "@/components/ui/hero-dithering-card";
import { Footer } from "@/components/Footer";
import { WordBlurStream } from "@/src/WordBlurStream";
import { SpecialText } from "@/components/ui/special-text";
import { BlurFade } from "@/components/ui/blur-fade";
import NumberFlow from "@number-flow/react";
import { EtheralShadow } from "@/components/ui/etheral-shadow";
import { CircleExpandButton } from "@/components/CircleExpandButton";
import { FloatingNavbar } from "@/components/FloatingNavbar";
import { SectionHeader } from "@/components/ui/section-header";
import { TestimonialsSection } from "@/components/ui/testimonials-section";
import { WordBlurReveal } from "@/components/ui/word-blur-reveal";
import { DemoVideo } from "@/components/ui/demo-video";
import { LeadCapture } from "@/components/ui/lead-capture";
import { landingFaqs } from "@/lib/landing-faqs";

function ActiveCounter({ target = 1420 }: { target?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
        }
      },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isInView) {
      setCount(target);
    } else {
      setCount(0);
    }
  }, [target, isInView]);

  return (
    <span ref={ref} className="inline-flex items-center">
      <NumberFlow value={count} />
    </span>
  );
}

// landingFaqs moved to lib/landing-faqs.ts (shared with homepage FAQPage JSON-LD)

const DESCRIPTIONS = [
  "Mailient removes email from your to-do list entirely.",
  "The most expensive email in your inbox is the one you never opened.",
  "Wake up. Read one briefing. Never dread Gmail again.",
];

// Isolated so its 5s rotation re-renders this span, not the whole page.
function RotatingTagline() {
  const [descIndex, setDescIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setDescIndex((prev) => (prev + 1) % DESCRIPTIONS.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const currentText = DESCRIPTIONS[descIndex];
  const dynamicSpeed = Math.max(4, Math.floor(750 / (currentText.length * 4)));

  return (
    <SpecialText speed={dynamicSpeed} delay={0} className="text-lg md:text-[22px] text-[#8a8f98] font-sans font-light tracking-wide text-center">
      {currentText}
    </SpecialText>
  );
}

// Isolated so timeupdate ticks (~4/s while playing) re-render only the player,
// not the whole page; also pauses itself whenever it scrolls offscreen.
function HeroVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const userPausedRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          if (!video.paused) video.pause();
        } else if (!userPausedRef.current && video.paused) {
          video.play().catch(() => {});
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const togglePlay = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!videoRef.current) return;
    if (isPlaying) {
      userPausedRef.current = true;
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      userPausedRef.current = false;
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => console.log("Play failed:", err));
    }
  };

  const toggleMute = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    videoRef.current.muted = newMuted;
    setIsMuted(newMuted);
  };

  const toggleFullscreen = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!videoRef.current) return;
    if (!document.fullscreenElement) {
      videoRef.current.requestFullscreen().catch((err) => {
        console.error("Error attempting to enable full-screen mode:", err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return (
    <div
      onClick={(e) => togglePlay(e)}
      className={cn(
        "w-full max-w-4xl aspect-[16/9] bg-[#050505] border border-white/[0.08] rounded-[28px] mt-20 relative z-20 overflow-hidden group cursor-pointer transition-shadow duration-500",
        isPlaying ? "shadow-none" : "shadow-[0_50px_100px_rgba(0,0,0,0.85)]"
      )}
    >
      <video
        ref={videoRef}
        src="/founder-demo.mp4"
        autoPlay
        loop
        muted={isMuted}
        playsInline
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        className="w-full h-full object-cover relative z-10"
      />

      {/* Custom Video Controls Overlay */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 p-4 pb-0 flex flex-col justify-end z-35 transition-all duration-300 opacity-0 group-hover:opacity-100 group-hover:bg-gradient-to-t group-hover:from-black/90 group-hover:via-black/40 group-hover:to-transparent select-none"
      >

        {/* Buttons Row */}
        <div className="flex items-center justify-between px-2 pb-3 text-white/90">
          {/* Left: Play/Pause & Time */}
          <div className="flex items-center gap-4">
            <button
              onClick={(e) => togglePlay(e)}
              className="hover:text-white transition-colors focus:outline-none"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-white stroke-none" />
              ) : (
                <Play className="w-4 h-4 fill-white stroke-none" />
              )}
            </button>
            <span className="text-[11px] font-mono tracking-wider opacity-85">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Right: Mute & Fullscreen */}
          <div className="flex items-center gap-4">
            <button
              onClick={(e) => toggleMute(e)}
              className="hover:text-white transition-colors focus:outline-none"
            >
              {isMuted ? (
                <VolumeX className="w-4.5 h-4.5" />
              ) : (
                <Volume2 className="w-4.5 h-4.5" />
              )}
            </button>
            <button
              onClick={(e) => toggleFullscreen(e)}
              className="hover:text-white transition-colors focus:outline-none"
            >
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Custom Progress Bar / Scrubber at the very bottom */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            if (!videoRef.current || !duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = clickX / rect.width;
            const newTime = percentage * duration;
            videoRef.current.currentTime = newTime;
            setCurrentTime(newTime);
          }}
          className="w-full h-1 bg-white/20 hover:h-1.5 transition-all duration-200 cursor-pointer relative z-40"
        >
          <div
            className="h-full bg-white relative transition-all duration-100"
            style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// Autoplay "Three Things" cycle. The video steps (1 & 2) advance on the
// video's onEnded so the FULL clip always plays regardless of load time;
// these durations are generous FALLBACKS that only fire if a video fails to
// load/play (so the carousel never freezes). ALL THREE steps are videos now, so
// every entry here must stay comfortably LONGER than its clip — step 0 was a
// 10s timer for the old static mockup, and leaving it there would have yanked
// the 22s home-feed clip away mid-play.
// Clip lengths: home-feed 22.1s · voice 11.8s · agent 20.3s.
const STEP_DURATIONS = [30000, 20000, 30000]; // ms — all FALLBACKS [Home feed, Voice demo, Scheduling demo]

export function LinearLanding() {
  const router = useRouter();
  const [activeAccordion, setActiveAccordion] = useState<number | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const threeThingsRef = useRef<HTMLElement>(null);
  const [threeThingsInView, setThreeThingsInView] = useState(false);

  // Mouse position tracker for cursor-reactive lighting on cards
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const { left, top } = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - left);
    mouseY.set(e.clientY - top);
  };

  useEffect(() => {
    const el = threeThingsRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setThreeThingsInView(entry.isIntersecting),
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The cycle only runs while the section is on screen — offscreen it neither
  // advances steps nor remounts demo videos.
  useEffect(() => {
    if (!threeThingsInView) return;
    const timer = setTimeout(() => {
      setActiveStep((prev) => (prev + 1) % 3);
    }, STEP_DURATIONS[activeStep] ?? 10000);
    return () => clearTimeout(timer);
  }, [activeStep, threeThingsInView]);

  // The demo videos would otherwise keep decoding (and their onEnded would keep
  // advancing the carousel) while scrolled far away; pause them offscreen and
  // resume in place when the section is back.
  useEffect(() => {
    const videos = threeThingsRef.current?.querySelectorAll("video");
    if (!videos) return;
    videos.forEach((v) => {
      if (!threeThingsInView) {
        if (!v.paused) v.pause();
      } else if (v.paused) {
        v.play().catch(() => {});
      }
    });
  }, [threeThingsInView, activeStep]);

  useEffect(() => {
    document.title = "Mailient — Runs your inbox while you build your company";
  }, []);

  return (
    <div className="min-h-screen bg-[#000000] text-white flex flex-col items-center justify-start overflow-x-hidden font-inter strichpunkt-theme relative selection:bg-white selection:text-black">
      
      {/* 0. Custom Radar & Orbital Keyframes */}
      <style dangerouslySetInnerHTML={{ __html: `
        .strichpunkt-theme {
          font-family: 'Strichpunkt Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        }
        .strichpunkt-theme :not(.font-mono):not([class*="font-mono"]):not(code):not(pre) {
          font-family: 'Strichpunkt Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        }
        @keyframes radar-pulse {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.05); opacity: 0.4; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
        @keyframes orb-float {
          0%, 100% { transform: translateY(0px) scale(1) rotate(0deg); }
          50% { transform: translateY(-12px) scale(1.03) rotate(3deg); }
        }
        @keyframes laser-pulse {
          from { stroke-dashoffset: 170; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes drift-left {
          0% { transform: translateX(0) scaleY(1); }
          50% { transform: translateX(-25%) scaleY(1.05); }
          100% { transform: translateX(-50%) scaleY(1); }
        }
        @keyframes drift-right {
          0% { transform: translateX(-50%) scaleY(1); }
          50% { transform: translateX(-25%) scaleY(1.08); }
          100% { transform: translateX(0) scaleY(1); }
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
      <section className="relative w-full pt-40 pb-0 md:pt-48 flex flex-col items-center text-center z-10 bg-gradient-to-b from-[#000000] via-[#09090b] to-[#16161a] overflow-hidden">
        {/* White-grey glow from the bottom of the hero section spreading up */}
        <div className="absolute inset-x-0 bottom-0 h-[250px] bg-[radial-gradient(ellipse_at_bottom,rgba(255,255,255,0.08),transparent_70%)] pointer-events-none z-10" />

        {/* Etheral Shadow Background Layer */}
        <div className="absolute inset-0 z-0 pointer-events-none opacity-40 mix-blend-screen select-none">
          <EtheralShadow
            color="rgba(128, 128, 128, 1)"
            animation={{ scale: 100, speed: 90 }}
            noise={{ opacity: 1, scale: 1.2 }}
            sizing="fill"
          />
        </div>

        <div className="w-full flex flex-col items-center max-w-5xl z-10 mx-auto px-6">
          
          {/* Headline & Subtitle */}
          <BlurFade delay={0.1} duration={0.8} inView>
            <h1 className="text-4xl md:text-[60px] font-medium tracking-[-0.035em] leading-[1.08] max-w-3xl bg-gradient-to-b from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent pb-2">
              You run your company,
              <br />
              We run your inbox.
            </h1>
          </BlurFade>

          <BlurFade delay={0.2} duration={0.8} inView>
            <p className="text-lg md:text-[22px] text-[#8a8f98] leading-relaxed max-w-4xl mt-8 font-light min-h-[4rem] flex items-center justify-center">
              <RotatingTagline />
            </p>
          </BlurFade>

          {/* Premium CTAs */}
          <BlurFade delay={0.3} duration={0.8} inView>
            <div className="flex flex-wrap items-center justify-center gap-4 mt-12">
              <CircleExpandButton href="/auth/signup">
                Get started free
              </CircleExpandButton>

              {/* Points at #demos (the real product-demo videos), not
                  #sample-brief — that anchor is the illustrative before/after
                  panel, so the old link promised footage and delivered a mockup. */}
              <CircleExpandButton href="#demos" variant="secondary">
                Watch Mailient handle a real inbox
              </CircleExpandButton>
            </div>
          </BlurFade>

          {/* 16:9 Floating Obsidian Demo Video Window */}
          <BlurFade delay={0.4} duration={1.0} inView>
            <HeroVideoPlayer />
          </BlurFade>

      </div>

      {/* Clear Separation Line at the bottom of the Metallic Hero */}
      <div className="w-full h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent relative z-25 mt-16 md:mt-24" />

      {/* NOTE: a PerspectiveMarquee sat here as a "trusted by" wall. It was
          mounted with no `items` prop, so it fell through to that component's
          DEFAULT_ITEMS placeholder and scrolled Vercel / Linear / Stripe /
          Figma / Notion / Raycast / Arc / Cursor — none of whom are customers.
          Removed outright rather than relabeled: the integrations story is
          already told properly by the #connectors orbit section below, and
          pre-launch we have no customer logos to show. Nothing beats fake
          social proof except no social proof. */}
    </section>

      {/* 1.5 THE PROBLEM — WHY MAILIENT MANIFESTO (moved up: problem right after hero, per positioning spec) */}
      <section className="py-16 md:py-32 px-6 w-full max-w-4xl mx-auto border-t border-white/[0.06] z-10 relative flex flex-col items-center text-left">
        <BlurFade delay={0.1} duration={0.8} inView>
          <div className="w-full space-y-12">
          
          <SectionHeader
            pill="Why Mailient"
            icon={AlertCircle}
            heading="Email was supposed to be a tool. For most founders, it became the job."
            subtitle="Every founder has lost money to an email they saw too late. You have too — you just can't name which one."
          />

          <div className="space-y-8 text-neutral-400 font-sans font-light leading-relaxed text-base md:text-lg">
            {/* Pain-point cards moved onto the shared .linear-grid-card-inner
                treatment — they had their own one-off fill and radius. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-10">
              <div className="linear-grid-card-inner linear-grid-card-lift p-6 space-y-2">
                <span className="text-xs font-mono text-neutral-500">PAIN POINT 01</span>
                <p className="text-sm text-neutral-200">The email that sat in your inbox for three days while you meant to reply.</p>
              </div>
              <div className="linear-grid-card-inner linear-grid-card-lift p-6 space-y-2">
                <span className="text-xs font-mono text-neutral-500">PAIN POINT 02</span>
                <p className="text-sm text-neutral-200">The client who went cold because you got buried in other threads.</p>
              </div>
              <div className="linear-grid-card-inner linear-grid-card-lift p-6 space-y-2">
                <span className="text-xs font-mono text-neutral-500">PAIN POINT 03</span>
                <p className="text-sm text-neutral-200">The meeting that never got booked because the scheduling back-and-forth took a week.</p>
              </div>
              <div className="linear-grid-card-inner linear-grid-card-lift p-6 space-y-2">
                <span className="text-xs font-mono text-neutral-500">PAIN POINT 04</span>
                <p className="text-sm text-neutral-200">The Sunday night dread of opening Gmail and seeing 200 unread messages staring back.</p>
              </div>
            </div>

            {/* Compressed from ~700 words / 12 paragraphs to the four beats that
                actually carry the argument: the cost, the gap no other tool
                covers, the reframe, the price. The long-form version was the
                second thing on the page — a wall of essay copy in the highest
                bounce region. The lines kept here are the strongest ones from
                it, verbatim; the connective tissue is gone. */}
            {/* Cut again — this was four paragraphs of solid prose and read as
                an essay. Nobody reads an essay on a landing page. What survives
                is one number, one contrast, and one reframe, each on its own
                line so the section can be SCANNED rather than read. */}
            <p className="text-white font-normal text-xl md:text-2xl tracking-tight leading-snug text-center">
              <span className="text-white font-medium">13 hours a week</span>, gone to your inbox.
              <br className="hidden md:block" />
              <span className="text-neutral-500"> A part-time job you never hired for.</span>
            </p>

            <WordBlurReveal
              text="Gmail sorts what you read. Superhuman speeds up what you read. None of them watch the email you never opened — where the money actually leaks."
              className="text-center text-base md:text-lg"
            />

            <WordBlurReveal
              text="So Mailient isn't a faster inbox. It's a hire — at $29 a month."
              className="text-white font-normal text-xl md:text-2xl tracking-tight leading-snug text-center pt-2"
            />

          </div>

        </div>
        </BlurFade>
      </section>

      {/* 2. THREE THINGS IT DOES INTERACTIVE SECTION */}
      <section id="demos" ref={threeThingsRef} className="py-16 md:py-32 px-6 w-full max-w-7xl mx-auto border-t border-white/[0.06] z-10 relative text-left">
        {/* This section previously had NO heading at all — it opened straight
            into the tab list, so a scroller hit three product demos with no
            statement of what they were demonstrating. */}
        <BlurFade delay={0.1} duration={0.8} inView>
          <SectionHeader
            pill="What it does"
            icon={Sparkles}
            heading="Three things, running without you."
            subtitle="Watch each one on a real inbox — no mockups."
          />
        </BlurFade>

        {/* 4/8 split, was 5/7 — the demo panel is the argument here, so it gets
            the space. The selector column only has to hold three short labels. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center">

          {/* Left panel: Vertical connected capability selectors */}
          <BlurFade delay={0.1} duration={0.8} inView className="lg:col-span-4 w-full">
            <div className="space-y-12" role="tablist" aria-label="Product demos">
              {/* Step 1 */}
              {/* Tab semantics: these three selectors drive the demo panel on
                  the right, so they are a tablist, not decorative divs. They
                  were div+onClick — keyboard users could not switch demos at
                  all. NOTE the button wraps only the label+heading: the expanded
                  body contains a CircleExpandButton, which renders an <a>, and
                  an anchor nested inside a button is invalid HTML. */}
              <div className="text-left">
              <button
                type="button"
                role="tab"
                aria-selected={activeStep === 0}
                aria-controls="demo-panel"
                onClick={() => setActiveStep(0)}
                className="group cursor-pointer select-none text-left w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded-lg"
              >
              <span className={cn(
                "font-mono text-[10px] tracking-[0.2em] font-medium block transition-all duration-300",
                activeStep === 0 ? "text-[#8a8f98] mb-3" : "text-neutral-700 group-hover:text-neutral-500 mb-1"
              )}>
                01 // Only what needs you
              </span>
              <h3 className={cn(
                "font-medium tracking-tight leading-tight transition-all duration-500",
                activeStep === 0
                  ? "text-2xl md:text-[34px] text-white"
                  : "text-xl md:text-2xl text-neutral-600 group-hover:text-neutral-400"
              )}>
                Only the emails that deserve your attention.
              </h3>
              </button>
              {activeStep === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="mt-4 space-y-4"
                >
                  <p className="text-sm md:text-base text-neutral-400 leading-relaxed font-light font-sans max-w-sm">
                    The few emails that need a decision. The rest is handled.
                  </p>
                  <CircleExpandButton
                    href="/product/sift"
                    variant="secondary"
                    className="text-xs md:text-sm"
                  >
                    See what mornings look like
                  </CircleExpandButton>
                </motion.div>
              )}
            </div>

            {/* Step 2 */}
            <div className="text-left">
              <button
                type="button"
                role="tab"
                aria-selected={activeStep === 1}
                aria-controls="demo-panel"
                onClick={() => setActiveStep(1)}
                className="group cursor-pointer select-none text-left w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded-lg"
              >
              <span className={cn(
                "font-mono text-[10px] tracking-[0.2em] font-medium block transition-all duration-300",
                activeStep === 1 ? "text-[#8a8f98] mb-3" : "text-neutral-700 group-hover:text-neutral-500 mb-1"
              )}>
                02 // Sounds exactly like you
              </span>
              <h3 className={cn(
                "font-medium tracking-tight leading-tight transition-all duration-500",
                activeStep === 1
                  ? "text-2xl md:text-[34px] text-white"
                  : "text-xl md:text-2xl text-neutral-600 group-hover:text-neutral-400"
              )}>
                Replies that sound like you.
              </h3>
              </button>
              {activeStep === 1 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="mt-4 space-y-4"
                >
                  <p className="text-sm md:text-base text-neutral-400 leading-relaxed font-light font-sans max-w-sm">
                    Learned from your sent mail. Ask for 15 at once — it writes all 15.
                  </p>
                  <CircleExpandButton
                    href="/product/drafts"
                    variant="secondary"
                    className="text-xs md:text-sm"
                  >
                    See a draft in your voice
                  </CircleExpandButton>
                </motion.div>
              )}
            </div>

            {/* Step 3 */}
            <div className="text-left">
              <button
                type="button"
                role="tab"
                aria-selected={activeStep === 2}
                aria-controls="demo-panel"
                onClick={() => setActiveStep(2)}
                className="group cursor-pointer select-none text-left w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded-lg"
              >
              <span className={cn(
                "font-mono text-[10px] tracking-[0.2em] font-medium block transition-all duration-300",
                activeStep === 2 ? "text-[#8a8f98] mb-3" : "text-neutral-700 group-hover:text-neutral-500 mb-1"
              )}>
                03 // While you sleep
              </span>
              <h3 className={cn(
                "font-medium tracking-tight leading-tight transition-all duration-500",
                activeStep === 2
                  ? "text-2xl md:text-[34px] text-white"
                  : "text-xl md:text-2xl text-neutral-600 group-hover:text-neutral-400"
              )}>
                Repetitive work happens while you sleep.
              </h3>
              </button>
              {activeStep === 2 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="mt-4 space-y-4"
                >
                  <p className="text-sm md:text-base text-neutral-400 leading-relaxed font-light font-sans max-w-sm">
                    Describe the job, pick when it runs. Set it once.
                  </p>
                  <CircleExpandButton
                    href="#pricing"
                    variant="secondary"
                    className="text-xs md:text-sm"
                  >
                    Put work on autopilot
                  </CircleExpandButton>
                </motion.div>
              )}
            </div>
          </div>
        </BlurFade>

          {/* Right panel: dynamic high-contrast visual display */}
          <BlurFade delay={0.25} duration={0.8} inView className="lg:col-span-8 w-full h-[440px] md:h-[580px]">
            <div id="demo-panel" role="tabpanel" className="bg-[#050505] border border-white/[0.08] rounded-[28px] p-5 md:p-10 shadow-2xl h-full flex flex-col justify-between relative overflow-hidden">
            {/* Custom Dither Dot Grid Overlay */}
            <div className="absolute inset-y-0 left-0 w-[45%] pointer-events-none opacity-[0.08] mix-blend-screen select-none"
                 style={{
                   backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
                   backgroundSize: "16px 16px",
                 }}
            />
            
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.01),transparent_60%)] pointer-events-none" />

            <AnimatePresence mode="wait">
              {activeStep === 0 && (
                <motion.div
                  key="homefeed"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.4 }}
                  className="absolute inset-0 z-10 bg-[#050505]"
                >
                  {/* Live demo — the real Today feed on a real inbox. Replaced a
                      hand-built mockup: this section claims "only what needs you",
                      and a fabricated screenshot is the one thing that can't prove it. */}
                  <video
                    src="/demos/home-feed-demo.mp4"
                    poster="/demos/home-feed-demo.jpg"
                    autoPlay
                    muted
                    playsInline
                    preload="auto"
                    onEnded={() => setActiveStep((prev) => (prev + 1) % 3)}
                    aria-label="The Mailient home feed showing only the emails that need a decision"
                    className="w-full h-full object-cover"
                  />
                </motion.div>
              )}

              {activeStep === 1 && (
                <motion.div
                  key="drafts"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.4 }}
                  className="absolute inset-0 z-10 bg-[#050505]"
                >
                  {/* Live demo — Arcus drafting a reply in your voice */}
                  <video
                    src="/demos/voice-demo.mp4"
                    poster="/demos/voice-demo.jpg"
                    autoPlay
                    muted
                    playsInline
                    preload="auto"
                    onEnded={() => setActiveStep((prev) => (prev + 1) % 3)}
                    aria-label="Mailient drafting an email reply in your voice"
                    className="w-full h-full object-contain lg:object-cover"
                  />
                </motion.div>
              )}

              {activeStep === 2 && (
                <motion.div
                  key="book"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.4 }}
                  className="absolute inset-0 z-10 bg-[#050505]"
                >
                  {/* Live demo — creating a background scheduling agent in plain English */}
                  <video
                    src="/demos/agent-demo.mp4"
                    poster="/demos/agent-demo.jpg"
                    autoPlay
                    muted
                    playsInline
                    preload="auto"
                    onEnded={() => setActiveStep((prev) => (prev + 1) % 3)}
                    aria-label="Creating a background scheduling agent in plain English"
                    className="w-full h-full object-cover"
                  />
                </motion.div>
              )}
            </AnimatePresence>

          </div>
        </BlurFade>

      </div>
    </section>

      {/* 3.5 HOW MAILIENT WORKS — three steps, no jargon */}
      <section className="py-16 md:py-24 px-6 w-full max-w-5xl mx-auto border-t border-white/[0.06] z-10 relative">
        <BlurFade delay={0.1} duration={0.8} inView>
          <SectionHeader
            pill="How it works"
            icon={Layers}
            heading="Three steps. Then it's handled."
            subtitle="Connect once, and stop thinking about your inbox."
          />

          {/* Each step is now a card with a lit gradient tile, rather than three
              columns of bare text. The tile is the dark-canvas inversion of the
              black icon squircle those light templates use. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <div className="linear-grid-card linear-grid-card-lift p-8 space-y-4">
              <span className="gradient-tile w-12 h-12 relative z-10">
                <Mail className="w-5 h-5 text-white" />
              </span>
              <span className="font-mono text-[10px] tracking-[0.2em] text-neutral-600 font-bold block relative z-10">STEP 1</span>
              <h3 className="text-lg font-semibold text-white relative z-10">Connect Gmail.</h3>
              <WordBlurReveal
                text="Two minutes, secure Google sign-in. Your email stays in Gmail — nothing moves, nothing to configure."
                className="text-sm text-neutral-400 font-light leading-relaxed font-sans relative z-10"
              />
            </div>
            <div className="linear-grid-card linear-grid-card-lift p-8 space-y-4">
              <span className="gradient-tile w-12 h-12 relative z-10">
                <Eye className="w-5 h-5 text-white" />
              </span>
              <span className="font-mono text-[10px] tracking-[0.2em] text-neutral-600 font-bold block relative z-10">STEP 2</span>
              <h3 className="text-lg font-semibold text-white relative z-10">It learns how you write.</h3>
              <WordBlurReveal
                text="From your last 90 days of sent mail: your greetings, your rhythm, your sign-offs. Drafts start sounding like you, not like AI."
                className="text-sm text-neutral-400 font-light leading-relaxed font-sans relative z-10"
              />
            </div>
            <div className="linear-grid-card linear-grid-card-lift p-8 space-y-4">
              <span className="gradient-tile w-12 h-12 relative z-10">
                <Inbox className="w-5 h-5 text-white" />
              </span>
              <span className="font-mono text-[10px] tracking-[0.2em] text-neutral-600 font-bold block relative z-10">STEP 3</span>
              <h3 className="text-lg font-semibold text-white relative z-10">Mornings arrive organized.</h3>
              <WordBlurReveal
                text="Overnight it reads everything, drafts the replies, books the meetings, chases the silence — and leaves you one briefing. Nothing sends without your approval."
                className="text-sm text-neutral-400 font-light leading-relaxed font-sans relative z-10"
              />
            </div>
          </div>
        </BlurFade>
      </section>

      {/* CONNECT GMAIL — the setup objection, answered with footage.
          Deliberately its OWN section rather than a clip dropped into "How it
          works": that section is three steps at equal weight, and burying a
          27-second video inside step 1 would both unbalance it and hide the
          clip. Here the recording is the whole point of the section.
          Copy is one line — the video is the argument. */}
      <section id="connect-gmail" className="py-16 md:py-32 px-6 w-full max-w-6xl mx-auto border-t border-white/[0.06] z-10 relative">
        <BlurFade delay={0.1} duration={0.8} inView>
          <SectionHeader
            pill="Connect Gmail"
            icon={Mail}
            heading="Two minutes. One sign-in. Done."
            subtitle="Your mail never leaves Gmail — nothing to migrate, nothing to configure."
          />
        </BlurFade>

        <BlurFade delay={0.2} duration={0.9} inView>
          <div className="linear-grid-card p-2 md:p-3 relative">
            <div className="rounded-[20px] overflow-hidden aspect-[1280/708] relative z-10">
              <DemoVideo
                src="/demos/connect-gmail-demo.mp4"
                poster="/demos/connect-gmail-demo.jpg"
                label="Connecting a Gmail account to Mailient with a single Google sign-in"
              />
            </div>
          </div>
        </BlurFade>
      </section>

      {/* 4. FLAGSHIP MEET ARCUS SECTION */}
      <section className="py-20 md:py-36 px-6 w-full max-w-7xl mx-auto border-t border-white/[0.06] z-10 relative">
        <BlurFade delay={0.1} duration={0.9} inView>
          <SectionHeader
            pill="Meet Arcus"
            icon={Bot}
            heading="Meet your new employee."
            subtitle="We named it Arcus. You'll just say: handled."
          />
        </BlurFade>
        <BlurFade delay={0.2} duration={0.9} inView>
          <div
            className="w-full linear-grid-card p-6 md:p-16 flex flex-col lg:flex-row gap-10 lg:gap-16 items-center relative group"
            onMouseMove={handleMouseMove}
          >
            {/* Card Cursor Lighting Glow spotlight */}
            <motion.div
              className="absolute inset-0 z-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{
                background: useMotionTemplate`radial-gradient(800px circle at ${mouseX}px ${mouseY}px, rgba(255,255,255,0.015), transparent 80%)`,
              }}
            />

            {/* Heading and pill lifted out to the SectionHeader above; this
                column keeps only the body copy and the CTA. */}
            <div className="flex-1 space-y-6 text-left relative z-10">
              {/* Was one dense run-on sentence that buried four capabilities and
                  four integrations in a single breath. Same content, broken
                  into a scannable list — a landing page gets skimmed, not read. */}
              <p className="text-base md:text-lg text-white font-normal leading-snug tracking-tight max-w-xl">
                Tell it &ldquo;clear my inbox and prep tomorrow.&rdquo;
              </p>

              <ul className="space-y-2.5 max-w-xl">
                {[
                  "Triages the flood",
                  "Drafts replies in your voice",
                  "Books the calls",
                  "Chases the follow-ups",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-neutral-400 font-light font-sans">
                    <Check className="w-3.5 h-3.5 text-white shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>

              <p className="text-sm text-neutral-500 font-light font-sans max-w-xl">
                Then shows you the few things that still need you.
              </p>

              <div className="pt-6">
                <Link
                  href="/product/arcus"
                  className="px-8 py-3 linear-cta text-white text-xs tracking-tight flex items-center gap-2 w-fit cursor-pointer"
                >
                  See it at work
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            {/* Real footage of Arcus working, replacing the mocked terminal
                panel that stood here — a hand-written "MORNING INBOX SWEEP"
                readout listing 214 threads scanned, 18 replies at 89% average
                confidence, 41 newsletters archived. Every one of those numbers
                was invented. It was labelled EXAMPLE, which made it honest but
                not persuasive: a fabricated readout is the weakest possible
                proof for a section whose entire claim is "it does the work".
                A recording of the thing actually running is the strongest. */}
            <div className="flex-1 w-full linear-grid-card-inner p-2 relative overflow-hidden">
              <div className="rounded-[10px] overflow-hidden aspect-[1280/758] relative z-10">
                <DemoVideo
                  src="/demos/arcus-demo.mp4"
                  poster="/demos/arcus-demo.jpg"
                  label="Arcus triaging an inbox, drafting replies and booking meetings on request"
                />
              </div>
            </div>

          </div>
        </BlurFade>
      </section>

      {/* 3. RADAR CIRCULAR APP ORBITS INTEGRATIONS */}
      <section id="connectors" className="py-16 md:py-32 px-6 w-full max-w-7xl mx-auto border-t border-white/[0.06] z-10 relative text-center flex flex-col items-center overflow-hidden">
        
        {/* Graphite and White glassmorphism styles */}
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes systematic-orbit {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes systematic-counter-orbit {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(-360deg); }
          }
          .orbits-wrapper {
            position: relative;
            width: 480px;
            height: 480px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .orbit-ring {
            position: absolute;
            width: 320px;
            height: 320px;
            border-radius: 50%;
            border: 1px dashed rgba(255, 255, 255, 0.05);
            pointer-events: none;
            z-index: 0;
          }
          .orbit-node-container {
            position: absolute;
            width: 480px;
            height: 480px;
            animation: systematic-orbit 36s linear infinite;
            pointer-events: none;
          }
          .orbit-node {
            position: absolute;
            left: 240px;
            top: 240px;
            margin-left: -40px; /* half of node width (80px) */
            margin-top: -40px; /* half of node height (80px) */
            width: 80px;
            height: 80px;
            pointer-events: auto;
          }
          /* Spread nodes symmetrically at exactly 60 deg increments at 160px radius */
          .orbit-node-1 { transform: rotate(0deg) translate(160px) rotate(0deg); }
          .orbit-node-2 { transform: rotate(60deg) translate(160px) rotate(-60deg); }
          .orbit-node-3 { transform: rotate(120deg) translate(160px) rotate(-120deg); }
          .orbit-node-4 { transform: rotate(180deg) translate(160px) rotate(-180deg); }
          .orbit-node-5 { transform: rotate(240deg) translate(160px) rotate(-240deg); }
          .orbit-node-6 { transform: rotate(300deg) translate(160px) rotate(-300deg); }

          .glass-button {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: linear-gradient(135deg, rgba(20, 20, 22, 0.8) 0%, rgba(8, 8, 9, 0.9) 100%);
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 
              0 12px 32px rgba(0, 0, 0, 0.5), 
              inset 0 1px 1px rgba(255, 255, 255, 0.07);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            animation: systematic-counter-orbit 36s linear infinite;
            cursor: pointer;
            position: relative;
            z-index: 10;
          }
          .glass-button:hover {
            transform: scale(1.08);
            border-color: rgba(255, 255, 255, 0.2);
            box-shadow: 
              0 0 35px rgba(255, 255, 255, 0.06),
              0 18px 40px rgba(0, 0, 0, 0.7),
              inset 0 1px 1px rgba(255, 255, 255, 0.15);
          }
          
          .graphite-glow-halo {
            position: absolute;
            width: 130px;
            height: 130px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.005) 50%, transparent 70%);
            pointer-events: none;
            z-index: 0;
            transition: all 0.4s ease;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
          }
          .glass-button:hover + .graphite-glow-halo {
            background: radial-gradient(circle, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.015) 50%, transparent 70%);
            transform: translate(-50%, -50%) scale(1.08);
          }

          .central-squircle {
            position: absolute;
            width: 96px;
            height: 96px;
            border-radius: 26px;
            background: linear-gradient(135deg, rgba(28, 28, 30, 0.95) 0%, rgba(10, 10, 11, 0.98) 100%);
            border: 1.5px solid rgba(255, 255, 255, 0.1);
            box-shadow: 
              0 0 45px rgba(255, 255, 255, 0.04),
              0 15px 35px rgba(0, 0, 0, 0.8),
              inset 0 1px 1px rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 20;
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            cursor: pointer;
          }
          .central-squircle:hover {
            transform: scale(1.04);
            border-color: rgba(255, 255, 255, 0.22);
            box-shadow: 
              0 0 55px rgba(255, 255, 255, 0.07),
              0 20px 45px rgba(0, 0, 0, 0.9),
              inset 0 1px 1px rgba(255, 255, 255, 0.15);
          }
        ` }} />

        {/* Had a bare heading and no label — now on the shared header. */}
        <SectionHeader
          pill="Connectors"
          icon={Globe}
          heading="Integrated directly with your favourite platforms."
          subtitle="Gmail, Calendar, Meet, Notion, Slack and Cal.com — connected, not copied."
        />

        {/* Structured Network Map Display Box with White/Graphite Palette */}
        <div className="relative w-full max-w-[600px] h-[400px] md:h-[520px] flex items-center justify-center mb-6 scale-75 sm:scale-90 md:scale-100 select-none">
          
          {/* Subtle large silver radial backdrop glow */}
          <div className="absolute w-[450px] h-[450px] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.015)_0%,transparent_70%)] pointer-events-none z-0" />

          <div className="orbits-wrapper">
            {/* Elegant Dashed Circular Path representing the orbit track */}
            <div className="orbit-ring" />

            {/* Central squircle Mailient node */}
            <div className="central-squircle group">
              {/* Soft background glow */}
              <div className="absolute w-24 h-24 rounded-[26px] bg-white/[0.01] blur-md pointer-events-none group-hover:bg-white/[0.02] transition-colors" />
              <img 
                src="/mailient-logo-premium.png" 
                alt="Mailient Hub" 
                className="w-12 h-12 object-cover relative z-10 transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-xl bg-neutral-950 border border-white/10 text-white font-mono text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none shadow-2xl">
                Mailient Core Hub
              </div>
            </div>

            {/* Orbiting glassmorphism icons */}
            <div className="orbit-node-container">
              
              {/* Node 1: Cal.com */}
              <div className="orbit-node orbit-node-1">
                <div className="glass-button group">
                  <svg xmlns="http://www.w3.org/2000/svg" xmlSpace="preserve" viewBox="0 0 512 512" className="w-10 h-10 transition-transform duration-300 group-hover:scale-105 relative z-10">
                    <path d="M458 512H56c-30.4 0-55-24.6-55-55V55C1 24.6 25.6 0 56 0h402c30.4 0 55 24.6 55 55v402c0 30.4-24.6 55-55 55" style={{ fill: '#fff' }}/>
                    <path d="M162.8 347.3c-50.4 0-88.4-39.9-88.4-89.3s35.9-89.6 88.4-89.6c27.9 0 47 8.6 62.1 28l-24.3 20.1c-10.1-10.8-22.5-16.2-37.8-16.2-34.1 0-52.8 26.1-52.8 57.6s20.5 57.1 52.8 57.1c15.1 0 28-5.3 38.4-16.2l23.9 21c-14.5 18.9-34.3 27.5-62.3 27.5m166.4-131.2h32.7v128.1h-32.7v-18.7c-6.7 13.2-18.1 22.2-39.7 22.2-34.6 0-62.3-30.1-62.3-66.9 0-37 27.7-66.9 62.3-66.9 21.5 0 33 8.9 39.7 22.2zm1.1 64.5c0-20-13.8-36.6-35.4-36.6-20.8 0-34.4 16.7-34.4 36.6 0 19.4 13.6 36.6 34.4 36.6 21.4 0 35.4-16.7 35.4-36.6M385 164.3h32.7v179.6H385z" style={{ fill: '#242424' }}/>
                  </svg>
                  <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded bg-neutral-950 border border-white/10 text-white font-mono text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl z-30">
                    Cal.com Booking
                  </div>
                </div>
                <div className="graphite-glow-halo" />
              </div>

              {/* Node 2: Notion */}
              <div className="orbit-node orbit-node-2">
                <div className="glass-button group">
                  <svg xmlns="http://www.w3.org/2000/svg" xmlSpace="preserve" viewBox="0 0 512 512" id="notion" className="w-10 h-10 transition-transform duration-300 group-hover:scale-105 relative z-10">
                    <path d="M41.8 22.1 325.1 1.2c34.8-3 43.7-1 65.6 14.9l90.4 63.7c14.9 11 19.9 13.9 19.9 25.9v349.4c0 21.9-8 34.9-35.8 36.8l-329 19.9c-20.9 1-30.8-2-41.8-15.9l-66.6-86.6C15.9 393.4 11 381.4 11 367.5V56.9c0-17.9 7.9-32.8 30.8-34.8" style={{ fill: '#fff' }}/>
                    <path d="M325.1 1.2 41.8 22.1C18.9 24.1 11 39 11 56.9v310.6c0 13.9 5 25.9 16.9 41.8l66.6 86.6c10.9 13.9 20.9 16.9 41.8 15.9l329-19.9c27.8-2 35.8-14.9 35.8-36.8V105.7c0-11.3-4.5-14.6-17.6-24.2l-92.7-65.4C368.8.2 359.9-1.8 325.1 1.2M143.7 100c-26.9 1.8-33 2.2-48.2-10.2L56.7 58.9c-3.9-4-2-9 8-10L337 29.1c22.9-2 34.8 6 43.7 12.9l46.7 33.8c2 1 7 7 1 7L147.2 99.7zm-31.3 352.1V155.5c0-13 4-18.9 15.9-19.9l323-18.9c11-1 15.9 6 15.9 18.9v294.6c0 13-2 23.9-19.9 24.9L138.2 473c-17.9 1-25.8-5-25.8-20.9m305.1-280.7c2 9 0 17.9-9 18.9l-14.9 3v219c-12.9 7-24.8 10.9-34.8 10.9-15.9 0-19.9-5-31.8-19.9L229.6 250v148.3l30.8 7s0 17.9-24.9 17.9l-68.6 4c-2-4 0-13.9 6.9-15.9l17.9-5V210.2l-24.8-2c-2-9 3-21.9 16.9-22.9l73.6-5 101.4 155.3V198.3l-25.8-3c-2-11 6-18.9 15.9-19.9z" style={{ fillRule: 'evenodd', clipRule: 'evenodd' }}/>
                  </svg>
                  <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded bg-neutral-950 border border-white/10 text-white font-mono text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl z-30">
                    Notion Workspace
                  </div>
                </div>
                <div className="graphite-glow-halo" />
              </div>

              {/* Node 3: Notion Calendar */}
              <div className="orbit-node orbit-node-3">
                <div className="glass-button group">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="94.5 88 312.85 325" className="w-10 h-10 transition-transform duration-300 group-hover:scale-105 relative z-10">
                    <path d="M398.579 135.841C404.242 141.152 407.35 148.439 407.35 156.355V372.638C407.35 372.725 407.347 372.812 407.343 372.9C407.329 373.178 407.3 373.455 407.3 373.733L407.325 373.859C407.325 386.91 397.107 398.225 384.27 399.798C383.352 399.948 382.433 400.062 381.489 400.125L169.818 412.937C169.151 412.975 168.497 413 167.842 413C167.767 413 167.695 412.994 167.622 412.987C167.55 412.981 167.477 412.975 167.402 412.975C167.251 412.975 167.103 412.981 166.955 412.987C166.807 412.994 166.659 413 166.508 413C158.97 413 151.91 410.231 146.461 405.109C140.559 399.559 137.275 391.944 137.275 383.688V373.405C137.275 371.316 136.872 370.196 134.443 370.196C134.443 370.196 127.786 370.322 127.094 370.322C118.687 370.322 110.822 367.227 104.744 361.513C98.1621 355.32 94.5378 346.837 94.5378 337.638L94.5 136.495C94.5 117.806 109.677 101.658 128.327 100.501L329.264 88.066C338.438 87.4996 347.134 90.5956 353.716 96.7752C360.297 102.955 363.921 111.425 363.921 120.637V126.993C363.921 126.993 363.795 129.12 366.552 129.032L377.563 128.365C385.453 127.861 392.916 130.53 398.579 135.841Z" fill="white"/>
                    <path d="M128.454 357.071C122.803 357.008 117.782 355.562 113.881 351.924C113.881 351.924 113.868 351.924 113.856 351.899C113.403 351.458 112.975 350.552C109.489 347.028 107.815 342.51 107.815 337.627L107.777 136.484C107.777 124.843 117.593 114.397 129.209 113.679L330.12 101.245C330.561 101.22 330.988 101.207 331.429 101.207C336.45 101.207 341.132 103.019 344.706 106.392C345.196 106.858 345.662 107.336 346.09 107.84C346.837 108.692 347.5 109.602 348.08 110.564C347.501 109.609 346.834 108.702 346.09 107.852C349.098 111.351 350.746 115.806 350.746 120.639V125.787C350.746 125.787 350.872 130.003 346.694 130.28L346.719 130.305L161.928 141.884C148.375 142.727 137.364 154.469 137.364 168.049C137.364 168.049 137.288 353.699 137.275 354C137.137 357.071 134.607 357.071 132.518 357.071H128.454Z" fill="black"/>
                    <path d="M394.126 373.546C394.151 373.244 394.176 372.941 394.176 372.639L394.126 155.274C394.05 154.129 393.861 153.009 393.546 151.939C392.817 149.434 391.457 147.182 389.532 145.382C386.776 142.802 383.177 141.405 379.313 141.405C378.974 141.405 378.633 141.417 378.294 141.443L163.854 154.884C163.779 154.889 163.703 154.902 163.628 154.914C163.527 154.93 163.426 154.947 163.326 154.947C156.505 155.652 150.792 161.617 150.326 168.451C150.301 168.753 150.301 169.043 150.301 169.345V382.318C150.301 382.42 150.307 382.519 150.314 382.616C150.32 382.711 150.326 382.804 150.326 382.896C150.464 387.667 152.365 392.021 155.75 395.205C158.77 398.049 162.646 399.66 166.837 399.875H167.504L381.83 386.899C381.893 386.899 381.956 386.88 382.019 386.88C382.065 386.873 382.111 386.866 382.158 386.862C382.174 386.862 382.191 386.861 382.208 386.861C388.538 385.691 393.684 380.002 394.126 373.546ZM183.927 376.339C176.59 376.855 170.096 374.364 170.297 364.748V215.08C170.297 209.946 174.526 206.661 179.194 206.421L365.747 195.233C370.404 194.994 374.216 198.367 374.216 203.036V352.968C374.216 358.455 372.845 365.516 363.406 365.881H363.381L363.368 365.893L183.927 376.339Z" fill="black"/>
                    <path d="M227.066 252.787C218.406 253.322 215.462 259.932 215.474 270.09V271.876C214.441 272.119 213.576 272.349 212.53 272.41C206.291 272.799 201.79 267.733 201.778 258.644C201.766 244.744 214.221 231.658 237.952 230.188C259.081 228.875 272.631 257.089C272.643 270.636 261.392 280.247 250.311 283.26C271.098 284.282 279.771 295.873 279.795 310.66C279.819 335.97 261.307 350.319 232.722 352.106L232.029 352.154C210.547 353.491 195.465 345.338 195.453 331.255C195.453 323.236 201.327 316.444 210.159 315.897C210.852 315.849 211.545 315.994 212.238 315.946C213.99 330.283 223.697 335.557 233.391 334.961C242.745 334.378 249.325 328.084 249.313 319.165V318.813C249.301 304.901 237.685 304.209 220.193 303.516L217.408 286.93C233.683 283.954 241.82 278.631 241.808 269.008C241.808 258.668 236.067 252.253 227.066 252.811V252.787Z" fill="black"/>
                    <path d="M305.181 245.959C287.859 250.965 284.041 243.358 285.938 235.388C296.325 232.958 323.341 224.854 333.558 221.196L333.68 327.987L352.57 330.732C352.57 337.683 348.605 342.032 341.501 342.482C335.614 342.846 321.93 343.345 315.349 343.758C305.132 344.39 286.424 345.921 286.424 345.921C285.901 344.524 285.731 341.862C285.731 338.472 287.105 334.998 291.606 333.478L305.29 329.056L305.193 245.971L305.181 245.959Z" fill="black"/>
                  </svg>
                  <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded bg-neutral-950 border border-white/10 text-white font-mono text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl z-30">
                    Notion Calendar
                  </div>
                </div>
                <div className="graphite-glow-halo" />
              </div>

              {/* Node 4: Google Calendar */}
              <div className="orbit-node orbit-node-4">
                <div className="glass-button group">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 141.7 141.7" id="google-calendar" className="w-10 h-10 transition-transform duration-300 group-hover:scale-105 relative z-10">
                    <path fill="#fff" d="M95.8,45.9H45.9V95.8H95.8Z"></path>
                    <path fill="#34a853" d="M95.8,95.8H45.9v22.5H95.8Z"></path>
                    <path fill="#4285f4" d="M95.8,23.4H30.9a7.55462,7.55462,0,0,0-7.5,7.5V95.8H45.9V45.9H95.8Z"></path>
                    <path fill="#188038" d="M23.4,95.8v15a7.55462,7.55462,0,0,0,7.5,7.5h15V95.8Z"></path>
                    <path fill="#fbbc04" d="M118.3,45.9H95.8V95.8h22.5Z"></path>
                    <path fill="#1967d2" d="M118.3,45.9v-15a7.55462,7.55462,0,0,0-7.5-7.5h-15V45.9Z"></path>
                    <path fill="#ea4335" d="M95.8,118.3l22.5-22.5H95.8Z"></path>
                    <polygon fill="#2a83f8" points="77.916 66.381 75.53 63.003 84.021 56.868 87.243 56.868 87.243 85.747 82.626 85.747 82.626 62.772 77.916 66.381"></polygon>
                    <path fill="#2a83f8" d="M67.29834,70.55785A7.88946,7.88946,0,0,0,70.78,64.12535c0-4.49-4-8.12-8.94-8.12a8.77525,8.77525,0,0,0-8.74548,6.45379l3.96252,1.58258a4.41779,4.41779,0,0,1,4.473-3.51635,4.138,4.138,0,1,1,.06256,8.24426v.00513h-.0559l-.00666.00061-.00964-.00061H59.15v3.87677h2.70642L61.88,72.65a4.70514,4.70514,0,1,1,0,9.37,5.35782,5.35782,0,0,1-3.96588-1.69354,4.59717,4.59717,0,0,1-.80408-1.2442l-.69757-1.69946L52.23005,79c.62,4.33,4.69,7.68,9.61,7.68,5.36,0,9.7-3.96,9.7-8.83A8.63346,8.63346,0,0,0,67.29834,70.55785Z"></path>
                  </svg>
                  <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded bg-neutral-950 border border-white/10 text-white font-mono text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl z-30">
                    Google Calendar
                  </div>
                </div>
                <div className="graphite-glow-halo" />
              </div>

              {/* Node 5: Google Meet */}
              <div className="orbit-node orbit-node-5">
                <div className="glass-button group">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" id="google-meet" className="w-10 h-10 transition-transform duration-300 group-hover:scale-105 relative z-10">
                    <path fill="#00ac47" d="M24,21.45V25a2.0059,2.0059,0,0,1-2,2H9V21h9V16Z"></path>
                    <polygon fill="#31a950" points="24 11 24 21.45 18 16 18 11 24 11"></polygon>
                    <polygon fill="#ea4435" points="9 5 9 11 3 11 9 5"></polygon>
                    <rect width="6" height="11" x="3" y="11" fill="#4285f4"></rect>
                    <path fill="#ffba00" d="M24,7v4h-.5L18,16V11H9V5H22A2.0059,2.0059,0,0,1,24,7Z"></path>
                    <path fill="#0066da" d="M9,21v6H5a2.0059,2.0059,0,0,1-2-2V21Z"></path>
                    <path fill="#00ac47" d="M29,8.26V23.74a.9989.9989,0,0,1-1.67.74L24,21.45,18,16l5.5-5,.5-.45,3.33-3.03A.9989.9989,0,0,1,29,8.26Z"></path>
                    <polygon fill="#188038" points="24 10.55 24 21.45 18 16 23.5 11 24 10.55"></polygon>
                  </svg>
                  <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded bg-neutral-950 border border-white/10 text-white font-mono text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl z-30">
                    Google Meet
                  </div>
                </div>
                <div className="graphite-glow-halo" />
              </div>

              {/* Node 6: Slack */}
              <div className="orbit-node orbit-node-6">
                <div className="glass-button group">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" className="w-10 h-10 transition-transform duration-300 group-hover:scale-105 relative z-10">
                    <path d="M27.255 80.719c0 7.33-5.978 13.317-13.309 13.317C6.616 94.036.63 88.049.63 80.719s5.987-13.317 13.317-13.317h13.309zm6.709 0c0-7.33 5.987-13.317 13.317-13.317s13.317 5.986 13.317 13.317v33.335c0 7.33-5.986 13.317-13.317 13.317-7.33 0-13.317-5.987-13.317-13.317zm0 0" fill="#de1c59"/>
                    <path d="M47.281 27.255c-7.33 0-13.317-5.978-13.317-13.309C33.964 6.616 39.951.63 47.281.63s13.317 5.987 13.317 13.317v13.309zm0 6.709c7.33 0 13.317 5.987 13.317 13.317s-5.986 13.317-13.317 13.317H13.946C6.616 60.598.63 54.612.63 47.281c0-7.33 5.987-13.317 13.317-13.317zm0 0" fill="#35c5f0"/>
                    <path d="M100.745 47.281c0-7.33 5.978-13.317 13.309-13.317 7.33 0 13.317 5.987 13.317 13.317s-5.987 13.317-13.317 13.317h-13.309zm-6.709 0c0 7.33-5.987 13.317-13.317 13.317s-13.317-5.986-13.317-13.317V13.946C67.402 6.616 73.388.63 80.719.63c7.33 0 13.317 5.987 13.317 13.317zm0 0" fill="#2eb57d"/>
                    <path d="M80.719 100.745c7.33 0 13.317 5.978 13.317 13.309 0 7.33-5.987 13.317-13.317 13.317s-13.317-5.987-13.317-13.317v-13.309zm0-6.709c-7.33 0-13.317-5.987-13.317-13.317s5.986-13.317 13.317-13.317h33.335c7.33 0 13.317 5.986 13.317 13.317 0 7.33-5.987 13.317-13.317 13.317zm0 0" fill="#ebb02e"/>
                  </svg>
                  <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded bg-neutral-950 border border-white/10 text-white font-mono text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl z-30">
                    Slack Workspaces
                  </div>
                </div>
                <div className="graphite-glow-halo" />
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* 5. THE MORNING SIDE-BY-SIDE: Chaos vs Overnight Clarity */}
      <section id="sample-brief" className="py-16 md:py-32 px-6 w-full max-w-7xl mx-auto border-t border-white/[0.06] z-10 relative">
        <BlurFade delay={0.1} duration={0.8} inView>
          <SectionHeader
            pill="The morning transition"
            icon={Clock}
            heading="Chaos vs overnight clarity."
            subtitle={
              <span className="block min-h-[2.5rem]">
                <WordBlurStream
                  text="Most mornings you wake up already behind. Mailient clears it overnight — so you start on top of it, not buried."
                  msPerWord={80}
                  startupMs={300}
                  holdMs={5000}
                />
              </span>
            }
          />

          {/* 246 -> 3 is the whole section now.
              Two 460px detail panels used to sit under this, each with invented
              email rows and fabricated metric chips ("14h Drag", "8h Delay",
              "TONE SIGNED"). That was the densest block of reading left on the
              page below the fold, it restated what this number already says in
              one glance, and it was more made-up telemetry. Deleted — the
              contrast is stronger without a paragraph explaining it. */}
          <div className="flex flex-col items-center text-center select-none">
            <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-neutral-600 mb-2">Yesterday</span>
            <span className="text-5xl md:text-7xl font-medium tracking-tight text-neutral-600 line-through decoration-red-500/60 decoration-2">246 unread</span>
            <span className="text-neutral-700 text-3xl my-6 font-light">↓</span>
            <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-neutral-500 mb-2">Today</span>
            <span className="text-6xl md:text-8xl font-medium tracking-tight bg-gradient-to-b from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent">3 decisions.</span>
          </div>

        </BlurFade>
      </section>

      {/* 6. SOCIAL PROOF, STAT ROW, SECURITY STRIP */}
      <section className="py-16 md:py-32 px-6 w-full max-w-7xl mx-auto border-t border-white/[0.06] z-10 relative">
        <BlurFade delay={0.1} duration={0.8} inView>
          <div className="max-w-5xl mx-auto">
          
          {/* Founder-time row — what the founder gets BACK, not what the machine
              does. These figures are ILLUSTRATIVE (a target morning), not
              measured medians — we have no usage data yet. They are labeled as
              such on screen; swap in real medians once live briefs exist and
              then drop the "what a handled morning looks like" framing. */}
          <SectionHeader
            pill="What you get back"
            icon={Clock}
            heading="What a handled morning looks like."
            subtitle="Illustrative of a typical morning — not averaged usage data."
          />
          {/* Was four bare text columns floating on the page background. Now
              lit cards with icon tiles and a much larger figure — this is the
              payoff section, so the numbers should carry the most weight in it.
              The figures remain illustrative; the subtitle says so. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-12 md:mb-24 text-left">
            {[
              { icon: Clock, label: "Every morning", value: <>2h 14m</>, caption: "Returned to you. Go build." },
              { icon: Briefcase, label: "Every week", value: <><ActiveCounter target={13} />h</>, caption: "Of email work off your plate." },
              { icon: Inbox, label: "By 7am", value: <ActiveCounter target={3} />, caption: "Decisions left. It handled the rest." },
              { icon: Check, label: "You owe", value: <ActiveCounter target={0} />, caption: "Emails. Follow-ups chased for you." },
            ].map(({ icon: StatIcon, label, value, caption }, i) => (
              <BlurFade key={label} inView repeat duration={0.6} delay={i * 0.07} blur="6px" className="h-full">
              <div
                className="linear-grid-card linear-grid-card-lift p-6 flex flex-col gap-4 h-full"
              >
                <span className="gradient-tile w-10 h-10 relative z-10">
                  <StatIcon className="w-4 h-4 text-white" />
                </span>
                <span className="font-mono text-[9px] tracking-[0.2em] text-[#8a8f98] uppercase font-bold relative z-10">
                  {label}
                </span>
                {/* SOLID white, not gradient text. `bg-clip-text
                    text-transparent` rendered these blank: NumberFlow draws its
                    digits in its own element, which does not inherit the
                    background-clip, so it kept `color: transparent` and
                    painted nothing. Card 1 survived only because "2h 14m" is a
                    plain string; the three NumberFlow cards lost their values
                    entirely (one showed a bare "h" suffix).
                    Do not reintroduce gradient text around <NumberFlow>. */}
                <span className="text-3xl md:text-4xl font-semibold tracking-tight text-white relative z-10">
                  {value}
                </span>
                <span className="text-[11px] text-neutral-500 font-light font-sans relative z-10 mt-auto">
                  {caption}
                </span>
              </div>
              </BlurFade>
            ))}
          </div>


          {/* Product statement cards. These were previously styled as pull-quotes
              (serif open-quote glyph + em-dash attribution), which reads as a
              customer testimonial at a glance even though the attribution line
              was a label, not a person. Pre-launch we have no testimonials, so
              the quote styling is removed entirely and these are now plainly
              labeled product claims. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left mb-12 md:mb-24">
            <div className="linear-grid-card linear-grid-card-lift p-8 relative text-left">
              <span className="font-mono text-[10px] tracking-[0.2em] text-neutral-500 uppercase block mb-4 relative z-10">
                What mornings become
              </span>
              <p className="text-sm text-neutral-300 font-light leading-relaxed font-sans relative z-10">
                You open Mailient and there are only two emails left to think about. The other two hundred are read, sorted, answered, or archived — each with a note explaining what happened to it.
              </p>
            </div>

            <div className="linear-grid-card linear-grid-card-lift p-8 relative text-left">
              <span className="font-mono text-[10px] tracking-[0.2em] text-neutral-500 uppercase block mb-4 relative z-10">
                Why it&apos;s different
              </span>
              <p className="text-sm text-neutral-300 font-light leading-relaxed font-sans relative z-10">
                It learns who you are — your VIPs, your voice, what&apos;s strategic versus routine — and gets sharper every run. You&apos;re not operating software. You hired someone.
              </p>
            </div>
          </div>

          {/* Security Strip */}
          <div className="w-full linear-grid-card !rounded-2xl py-4 px-6 hover:shadow-[0_20px_40px_rgba(16,185,129,0.06)] hover:border-white/[0.1] transition-all duration-300 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 text-left">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-[11px] text-neutral-400 font-sans">
                Your emails are encrypted in your browser before they leave it. Personal data is stripped before any AI sees it.
              </span>
            </div>
            <Link href="/security" className="text-[10px] text-white font-semibold hover:underline flex items-center gap-1 shrink-0 whitespace-nowrap">
              Read Security Standard
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

        </div>
        </BlurFade>
      </section>



      {/* Customer testimonials. Renders nothing until lib/testimonials.ts has a
          real entry — see the note in that file on why it ships empty. */}
      <TestimonialsSection />

      {/* Core capability grid — moved ABOVE pricing. It previously rendered
          after the pricing section, so the last substantive argument for the
          product sat below the ask, where nobody still deciding would reach it.
          Order is now: capabilities → price → objections (FAQ) → CTA. */}
      <BlurFade delay={0.1} duration={0.8} inView>
        <Features8 />
      </BlurFade>

      {/* MODULAR PRICING SECTION — id is load-bearing: in-page CTAs target #pricing */}
      <section id="pricing" className="w-full border-t border-white/[0.06] z-10 relative">
        <BlurFade delay={0.1} duration={0.8} inView>
          <PricingSection3
            handleSelectPlan={(planId) => {
              router.push("/pricing");
            }}
          />
        </BlurFade>
      </section>

      {/* FAQ ACCORDION SECTION — objection handling, directly after the price */}
      <section className="py-16 md:py-32 px-6 w-full max-w-7xl mx-auto border-t border-white/[0.06] z-10 relative">
        <BlurFade delay={0.1} duration={0.8} inView>
          {/* Was a 4/8 split with the header stranded in the left column. Now
              the shared centered header over a single measured column, which
              is also easier to read — accordion rows no longer run 8 columns
              wide on desktop. */}
          <SectionHeader
            pill="Common questions"
            icon={MessageSquare}
            heading="Frequently asked questions."
            subtitle="The short version: Mailient removes email from your to-do list entirely."
          />

          <div className="flex flex-col space-y-4 w-full max-w-3xl mx-auto">
            {landingFaqs.map((faq, index) => (
              <div key={index} className="border-b border-white/[0.06] pb-4 text-left">
                {/* Real <button> with aria-expanded/aria-controls — this was a
                    div+onClick, so the entire FAQ was unreachable by keyboard
                    and invisible to screen readers. */}
                <button
                  type="button"
                  onClick={() => setActiveAccordion(activeAccordion === index ? null : index)}
                  aria-expanded={activeAccordion === index}
                  aria-controls={`faq-panel-${index}`}
                  id={`faq-trigger-${index}`}
                  className="w-full flex items-center justify-between gap-4 py-4 cursor-pointer text-sm font-semibold text-white text-left hover:text-neutral-300 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded-sm"
                >
                  <span>{faq.q}</span>
                  <span aria-hidden="true" className="text-xs text-neutral-500 font-mono shrink-0">{activeAccordion === index ? "[-]" : "[+]"}</span>
                </button>
                <AnimatePresence>
                  {activeAccordion === index && (
                    <motion.div
                      id={`faq-panel-${index}`}
                      role="region"
                      aria-labelledby={`faq-trigger-${index}`}
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
        </BlurFade>
      </section>

      {/* Soft-conversion email capture — for visitors who won't connect Gmail
          yet. Opt-in only; fires one hook email via /api/leads. */}
      <LeadCapture />

      {/* Premium Dithered CTA Section */}
      <BlurFade delay={0.1} duration={0.8} inView>
        <CTASection />
      </BlurFade>

      <Footer />

      {/* Edge blurs, both shorter than the 120px/80px they started at — enough
          to soften content passing under the fixed chrome without eating the
          viewport. The bottom blur reads as intentional again now that the
          floating nav is back: it gives that bar a surface to sit against
          instead of leaving it floating on bare black. Both sit at z-40, under
          the floating nav's z-[100]. */}
      <ProgressiveBlur position="top" backgroundColor="#000000" height="72px" blurAmount="10px" className="fixed z-40" />
      <ProgressiveBlur position="bottom" backgroundColor="#000000" height="96px" blurAmount="10px" className="fixed z-40" />

      {/* Floating navigation — restored at the founder's request after being
          pulled in 4918b3b. */}
      <FloatingNavbar />
    </div>
  );
}
