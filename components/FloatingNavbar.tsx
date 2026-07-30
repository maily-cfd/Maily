"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import {
  Home,
  LayoutList,
  HelpCircle,
  Scale,
  FileText
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { id: "home", label: "Home", icon: Home, href: "/home-feed" },
  // NOTE: "Give a month" (/referrals) used to sit here in second position for
  // discoverability. Removed at the founder's request — this bar now renders on
  // the public landing and product pages, where a logged-out visitor has no
  // referral link to give. /referrals stays reachable from the rewards card in
  // the app, which is where a signed-in user actually is when they'd share it.
  { id: "changelog", label: "Changelog", icon: LayoutList, href: "/changelog" },
  { id: "support", label: "Support", icon: HelpCircle, href: "/contact" },
  { id: "terms", label: "Terms", icon: Scale, href: "/terms-of-service" },
  { id: "privacy", label: "Privacy", icon: FileText, href: "/privacy-policy" },
];

export function FloatingNavbar() {
  const pathname = usePathname();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (pathname === "/home-feed") {
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(true);
    }
  }, [pathname]);

  return (
    <>
      <AnimatePresence>
        {isVisible && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] w-fit px-4 pointer-events-none"
          >
            <LayoutGroup>
              <nav className="relative flex items-center gap-1.5 p-1.5 rounded-[26px] pointer-events-auto transition-all duration-700 hover:scale-[1.02] shadow-[0_6px_6px_rgba(0,0,0,0.2),0_0_20px_rgba(0,0,0,0.1)] overflow-hidden">
                
                {/* Liquid Glass Layers — plain backdrop blur; an SVG displacement
                    filter chained on top forced a full re-raster every scroll frame */}
                <div className="absolute inset-0 z-0 backdrop-blur-[12px]" />
                <div className="absolute inset-0 z-[1] bg-white/20 dark:bg-[#2e2e2e]/40" />
                <div 
                  className="absolute inset-0 z-[2] rounded-[26px]"
                  style={{
                    boxShadow: "inset 2px 2px 1px 0 rgba(255, 255, 255, 0.15), inset -1px -1px 1px 1px rgba(255, 255, 255, 0.05)"
                  }}
                />

                {/* Navbar Items Content */}
                <div className="relative z-10 flex items-center gap-1.5">
                  {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    const isHovered = hoveredId === item.id;
                    const Icon = item.icon;

                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        onMouseEnter={() => setHoveredId(item.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        className="relative flex items-center no-underline"
                      >
                        <motion.div
                          layout
                          transition={{
                            type: "spring",
                            stiffness: 175,
                            damping: 12,
                            mass: 0.5
                          }}
                          className={cn(
                            "relative flex items-center h-11 rounded-full overflow-hidden px-1.5 transition-all duration-500",
                            isActive 
                              ? "bg-white dark:bg-black text-black dark:text-white shadow-lg border border-black/5 dark:border-white/10" 
                              : isHovered 
                                ? "bg-black/5 dark:bg-white/10 text-black dark:text-neutral-100" 
                                : "text-black/60 dark:text-neutral-400"
                          )}
                        >
                          <div 
                            className={cn(
                              "flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-colors duration-300",
                              isActive ? "bg-black/5 dark:bg-white/10" : ""
                            )}
                          >
                            <Icon className={cn("w-[18px] h-[18px]", "text-current")} />
                          </div>
                          
                          <AnimatePresence initial={false}>
                            {(isActive || isHovered) && (
                              <motion.span
                                initial={{ opacity: 0, width: 0, x: -5 }}
                                animate={{ opacity: 1, width: "auto", x: 0 }}
                                exit={{ opacity: 0, width: 0, x: -5 }}
                                transition={{ 
                                  duration: 0.4, 
                                  ease: [0.175, 0.885, 0.32, 1.275]
                                }}
                                className="overflow-hidden"
                              >
                                <span className="ml-2 pr-3 text-[13px] font-bold tracking-tight whitespace-nowrap uppercase">
                                  {item.label}
                                </span>
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </motion.div>

                        {isActive && (
                          <motion.div
                            layoutId="pill"
                            className="absolute inset-0 z-[-1] bg-white dark:bg-black rounded-full"
                            transition={{ type: "spring", stiffness: 175, damping: 12 }}
                          />
                        )}
                      </Link>
                    );
                  })}
                </div>
              </nav>
            </LayoutGroup>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
