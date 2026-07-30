"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Mail, Cpu, Send, Layers } from "lucide-react";
import { useSession, signIn, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { ArcusLogo } from "@/components/ui/arcus-logo";

interface NavbarProps {
  theme?: "light" | "dark";
}

export function Navbar({ theme = "light" }: NavbarProps) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isDark = theme === "dark";

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      {/* SVG liquid-glass distortion — same filter used by FloatingNavbar */}
      <svg className="hidden pointer-events-none absolute h-0 w-0" aria-hidden="true">
        <filter id="navbar-liquid-distortion">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.012" numOctaves="1" seed="5" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

    <motion.header
      initial={{ y: -40, opacity: 0, filter: "blur(8px)" }}
      animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-4 left-0 right-0 z-50 flex justify-center px-4 md:px-6 pointer-events-none"
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center justify-between w-full max-w-5xl rounded-full px-6 py-2.5 transition-all duration-500 ease-out relative",
          scrolled
            ? "shadow-[0_25px_60px_rgba(0,0,0,0.55)]"
            : "shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
        )}
      >
        {/* Glass layers clipped inside their own overflow-hidden wrapper so the
            dropdown megamenu can escape the pill without being cut off */}
        <div className="absolute inset-0 z-0 rounded-full overflow-hidden pointer-events-none">
          {/* Layer 1 — backdrop + liquid distortion */}
          <div
            className="absolute inset-0"
            style={{
              backdropFilter: "blur(20px) saturate(160%)",
              WebkitBackdropFilter: "blur(20px) saturate(160%)",
              filter: "url(#navbar-liquid-distortion)",
              isolation: "isolate",
            }}
          />
          {/* Layer 2 — tinted fill */}
          <div className={cn(
            "absolute inset-0 transition-all duration-500",
            scrolled
              ? isDark ? "bg-[#1a1a1a]/70" : "bg-white/75"
              : isDark ? "bg-[#0e0e0e]/50" : "bg-white/45"
          )} />
        </div>

        {/* Layer 3 — border + inset glass rim (outside clip so border renders cleanly) */}
        <div
          className={cn(
            "absolute inset-0 z-[1] rounded-full border pointer-events-none",
            isDark ? "border-white/[0.10]" : "border-white/60"
          )}
          style={{
            boxShadow: isDark
              ? "inset 2px 2px 1px 0 rgba(255,255,255,0.10), inset -1px -1px 1px 1px rgba(255,255,255,0.04)"
              : "inset 2px 2px 1px 0 rgba(255,255,255,0.70), inset -1px -1px 1px 1px rgba(255,255,255,0.25)",
          }}
        />

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group relative z-10">
          <div className="relative w-7 h-7 rounded-[25%] overflow-hidden transition-all duration-500 group-hover:scale-105 border border-white/10 shadow-md bg-white">
            <img 
              src="/mailient-logo-premium.png" 
              alt="Mailient Logo" 
              className="w-full h-full object-cover"
            />
          </div>
          <span className={cn(
            "font-extrabold text-[15px] tracking-tight transition-colors font-satoshi",
            isDark ? "text-white group-hover:text-neutral-200" : "text-neutral-900 group-hover:text-black"
          )}>
            Mailient
          </span>
        </Link>

        {/* Navigation Links */}
        <nav className={cn(
          "hidden md:flex items-center gap-7 text-[12px] font-semibold transition-colors relative z-10",
          isDark ? "text-neutral-400" : "text-neutral-600"
        )}>
          {/* Product Dropdown Trigger */}
          <div
            className="relative py-1 cursor-pointer"
            onMouseEnter={() => setDropdownOpen(true)}
            onMouseLeave={() => setDropdownOpen(false)}
          >
            <button className={cn(
              "flex items-center gap-1 transition-colors focus:outline-none",
              isDark ? "hover:text-white" : "hover:text-neutral-950"
            )}>
              Product
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform duration-300",
                  dropdownOpen && "rotate-180"
                )}
              />
            </button>

            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.97, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: 8, scale: 0.97, filter: "blur(6px)" }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-0 pt-4 z-[100] pointer-events-auto cursor-default"
                >
                  {/* Mega Menu Obsidian Box */}
                  <div 
                    style={{
                      backgroundColor: isDark ? "#161616" : "rgba(255, 255, 255, 0.95)"
                    }}
                    className={cn(
                      "w-[700px] rounded-2xl border p-6 pb-4 shadow-[0_50px_100px_rgba(0,0,0,0.85)] backdrop-blur-3xl relative overflow-hidden text-left flex flex-col justify-between",
                      isDark ? "border-white/[0.12]" : "border-neutral-200/50"
                    )}
                  >
                    
                    <div className="grid grid-cols-3 gap-8 relative z-10">
                      
                      {/* Column 1 */}
                      <div className="flex flex-col space-y-6 pr-4 border-r border-white/[0.04]">
                        <Link href="/product/sift" className="group block cursor-pointer select-none">
                          <span className="text-[10px] font-medium tracking-wide text-neutral-500 uppercase block mb-1">
                            Sift AI
                          </span>
                          <span className="text-[13px] font-semibold text-neutral-300 leading-snug group-hover:text-white transition-all duration-300 block">
                            Triage incoming threads and isolate critical updates
                          </span>
                        </Link>

                        <Link href="/product/drafts" className="group block cursor-pointer select-none">
                          <span className="text-[10px] font-medium tracking-wide text-neutral-500 uppercase block mb-1">
                            Voice Profile
                          </span>
                          <span className="text-[13px] font-semibold text-neutral-300 leading-snug group-hover:text-white transition-all duration-300 block">
                            Build style profiles to write exactly like you
                          </span>
                        </Link>
                      </div>

                      {/* Column 2 */}
                      <div className="flex flex-col space-y-6 pr-4 border-r border-white/[0.04]">
                        <Link href="/product/arcus" className="group block cursor-pointer select-none">
                          <span className="text-[10px] font-medium tracking-wide text-neutral-500 uppercase block mb-1">
                            Arcus Engine
                          </span>
                          <span className="text-[13px] font-semibold text-neutral-300 leading-snug group-hover:text-white transition-all duration-300 block">
                            Delegate complex scheduling and tasks overnight
                          </span>
                        </Link>

                        <Link href="/product/arcus" className="group block cursor-pointer select-none">
                          <span className="text-[10px] font-medium tracking-wide text-neutral-500 uppercase block mb-1">
                            Encryption
                          </span>
                          <span className="text-[13px] font-semibold text-neutral-300 leading-snug group-hover:text-white transition-all duration-300 block">
                            Secure client-side protection for total privacy
                          </span>
                        </Link>
                      </div>

                      {/* Column 3 */}
                      <div className="flex flex-col space-y-6">
                        <Link href="/home-feed" className="group block cursor-pointer select-none">
                          <span className="text-[10px] font-medium tracking-wide text-neutral-500 uppercase block mb-1">
                            Analytics
                          </span>
                          <span className="text-[13px] font-semibold text-neutral-300 leading-snug group-hover:text-white transition-all duration-300 block">
                            Monitor usage metrics and team throughput
                          </span>
                        </Link>

                        <a href="#connectors" className="group block cursor-pointer select-none">
                          <span className="text-[10px] font-medium tracking-wide text-neutral-500 uppercase block mb-1">
                            Connectors
                          </span>
                          <span className="text-[13px] font-semibold text-neutral-300 leading-snug group-hover:text-white transition-all duration-300 block">
                            Integrate Slack, Notion, Cal.com, and Google Meet
                          </span>
                        </a>
                      </div>

                    </div>

                    {/* Divider and Footer */}
                    <div className="border-t border-white/[0.06] pt-4 mt-6 flex items-center justify-between text-xs text-neutral-500 z-10 relative">
                      <Link href="/blogs" className="font-semibold text-neutral-200 hover:text-white transition-colors">
                        Blogs
                      </Link>
                      <Link href="/changelog" className="text-[#5f5bf6] hover:text-[#7875f7] transition-colors font-semibold">
                        Changelog
                      </Link>
                    </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Link
            href="/product/arcus"
            className={cn(
              "transition-colors",
              isDark 
                ? pathname === "/product/arcus" ? "text-white font-bold" : "hover:text-white"
                : pathname === "/product/arcus" ? "text-neutral-950 font-bold" : "hover:text-neutral-950"
            )}
          >
            Arcus
          </Link>

          <Link
            href="/pricing"
            className={cn(
              "transition-colors",
              isDark 
                ? pathname === "/pricing" ? "text-white font-bold" : "hover:text-white"
                : pathname === "/pricing" ? "text-neutral-950 font-bold" : "hover:text-neutral-950"
            )}
          >
            Pricing
          </Link>

          <Link
            href="/security"
            className={cn(
              "transition-colors",
              isDark 
                ? pathname === "/security" ? "text-white font-bold" : "hover:text-white"
                : pathname === "/security" ? "text-neutral-950 font-bold" : "hover:text-neutral-950"
            )}
          >
            Security
          </Link>

          <Link
            href="/changelog"
            className={cn(
              "transition-colors",
              isDark 
                ? pathname === "/changelog" ? "text-white font-bold" : "hover:text-white"
                : pathname === "/changelog" ? "text-neutral-950 font-bold" : "hover:text-neutral-950"
            )}
          >
            Changelog
          </Link>
        </nav>

        {/* Action Buttons */}
        <div className="flex items-center gap-4 relative z-10">
          {status === "authenticated" ? (
            <>
              <Link
                href="/home-feed"
                className={cn(
                  "text-[12px] font-semibold transition-colors",
                  isDark ? "text-neutral-300 hover:text-white" : "text-neutral-600 hover:text-neutral-900"
                )}
              >
                Dashboard
              </Link>
              <button
                onClick={() => signOut()}
                className={cn(
                  "text-[12px] font-semibold transition-colors",
                  isDark ? "text-neutral-400 hover:text-red-400" : "text-neutral-500 hover:text-red-600"
                )}
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/auth/signin"
                className={cn(
                  "text-[12px] font-semibold transition-colors",
                  isDark ? "text-neutral-300 hover:text-white" : "text-neutral-600 hover:text-neutral-900"
                )}
              >
                Sign in
              </Link>
              {/* Real anchor, not a router.push button — the primary conversion
                  CTA must be middle-clickable, openable in a new tab, and
                  crawlable as a link to /auth/signup. */}
              <Link href="/auth/signup" aria-label="Get started with Mailient">
                <LiquidButton
                  variant={isDark ? "default" : "light"}
                  size="sm"
                  className="rounded-full !h-8.5 px-4 font-bold text-[11px] tracking-tight hover:shadow-[0_0_30px_rgba(255,255,255,0.15)] flex items-center gap-1.5"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Get started
                </LiquidButton>
              </Link>
            </>
          )}
        </div>
      </div>
    </motion.header>
    </>
  );
}
