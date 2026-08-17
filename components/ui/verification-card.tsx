"use client";
import { Mail } from "lucide-react";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VerificationCardProps {
  idNumber?: string;
  name?: string;
  validThru?: string;
  label?: string;
}

export function VerificationCard({
  idNumber,
  name,
  validThru,
  label,
}: VerificationCardProps) {
  const cardRef = React.useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cardRef.current.style.setProperty("--mouse-x", `${x}px`);
    cardRef.current.style.setProperty("--mouse-y", `${y}px`);
  };

  if (!idNumber || !name || !validThru) return null;

  // Cleanup ID for display: ensure it doesn't look cut off
  const displayId = idNumber.startsWith('MEMBER') 
    ? idNumber.replace('MEMBER', 'ML-')
    : idNumber;

  const isFree = label?.includes('FREE') || label?.includes('MEMBER CARD');

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "relative h-[240px] w-[400px] rounded-[32px] p-8 shadow-2xl text-black dark:text-white flex flex-col justify-between overflow-hidden select-none group border border-neutral-200 dark:border-white/10"
      )}
      style={{
        background: isFree 
          ? "linear-gradient(135deg, #050505 0%, #1a1a1a 100%)" 
          : "linear-gradient(135deg, #0a0a0b 0%, #2a228c 100%)",
      }}
    >
      {/* Noise Texture Overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay bg-[url('/noise.svg')]" />

      {/* Mesh Glow Overlay */}
      <div 
        className="absolute -top-[20%] -right-[10%] w-[80%] h-[80%] blur-[80px] opacity-20 pointer-events-none transition-all duration-1000 group-hover:opacity-40 group-hover:scale-110"
        style={{
          background: isFree 
            ? "radial-gradient(circle, #ffffff 0%, transparent 70%)"
            : "radial-gradient(circle, #4f46e5 0%, transparent 70%)",
        }}
      />

      {/* ... top section ... */}
      <div className="relative z-10 flex justify-between items-start">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-black/10 dark:bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center overflow-hidden">
                <Mail className="w-full h-full p-1 text-inherit" />
            </div>
            <div className="flex flex-col">
                <span className="text-lg font-bold tracking-tight leading-none">Maily</span>
                <span className="text-[10px] text-black dark:text-white/40 font-medium tracking-widest uppercase mt-1">
                    {isFree ? "Free Tier" : "Pro Pass"}
                </span>
            </div>
        </div>
        <div className="px-3 py-1 rounded-full bg-black/5 dark:bg-white/5 border border-neutral-200 dark:border-white/10 backdrop-blur-sm">
            <span className="text-[10px] font-bold tracking-[0.1em] text-black dark:text-white/60 uppercase">
                {isFree ? "MEMBER" : "PRO"}
            </span>
        </div>
      </div>

      <div className="relative z-10 my-4">
        <h2 className="text-[28px] font-mono font-medium tracking-[0.15em] text-black dark:text-white/90 drop-shadow-lg">
          {displayId}
        </h2>
      </div>

      <div className="relative z-10 flex justify-between items-end">
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-black dark:text-white/40 font-bold tracking-widest uppercase">Cardholder</span>
            <span className="text-[15px] font-bold tracking-wide text-black dark:text-white/95 uppercase truncate max-w-[240px]">
                {name}
            </span>
        </div>
        <div className="flex flex-col items-end gap-1">
            <span className="text-[10px] text-black dark:text-white/40 font-bold tracking-widest uppercase">Valid Thru</span>
            <span className="text-[16px] font-mono font-bold text-black dark:text-white/90">
                {validThru}
            </span>
        </div>
      </div>

      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] to-transparent pointer-events-none" />
      
      {/* Interactive Mouse Follow Glow */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none bg-[radial-gradient(circle_at_var(--mouse-x,50%)_var(--mouse-y,50%),rgba(255,255,255,0.1)_0%,transparent_50%)]" />
    </motion.div>
  );
}
