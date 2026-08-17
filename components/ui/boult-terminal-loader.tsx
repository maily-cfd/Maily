"use client"

import * as React from "react"
import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"

interface TerminalLine {
  text: string
  delay: number
}

interface TypingState {
  lineIndex: number
  charIndex: number
}

const terminalSteps: TerminalLine[] = [
  { text: "> Initializing Boult Intelligence Core...", delay: 0 },
  { text: "> Establishing secure link to Google Vault...", delay: 800 },
  { text: "> Authenticating Zero-Knowledge handshake...", delay: 1200 },
  { text: "> Extracting historical interaction patterns...", delay: 1600 },
  { text: "> Calibrating Neural Voice (Mimic My Style)...", delay: 2000 },
  { text: "> Mapping relationship high-leverage nodes...", delay: 2400 },
  { text: "> Syncing Maily Sift categories: Opportunities, Urgent...", delay: 2800 },
  { text: "> De-duplicating cross-channel thread hashes...", delay: 3200 },
  { text: "> Running deep semantic cluster analysis...", delay: 3600 },
  { text: "> Identifying high-impact opportunities...", delay: 4000 },
]

interface BoultTerminalLoaderProps {
  loading?: boolean
}

export function BoultTerminalLoader({ loading = true }: BoultTerminalLoaderProps) {
  const [typingState, setTypingState] = useState<TypingState>({ lineIndex: 0, charIndex: 0 })
  const [completedLines, setCompletedLines] = useState<number[]>([])
  const [cursorVisible, setCursorVisible] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true)

  useEffect(() => {
    if (typingState.lineIndex >= terminalSteps.length) return

    const currentLine = terminalSteps[typingState.lineIndex]
    const isLineComplete = typingState.charIndex >= currentLine.text.length

    if (isLineComplete) {
      const timer = setTimeout(() => {
        setCompletedLines((prev) => [...prev, typingState.lineIndex])
        setTypingState({ lineIndex: typingState.lineIndex + 1, charIndex: 0 })
      }, loading ? 150 : 50) 
      return () => clearTimeout(timer)
    }

    // Speed up typing significantly if loading is already done
    const typingDelay = !loading ? 4 : 30
    const delay = typingState.lineIndex === 0 && typingState.charIndex === 0 ? 0 : typingDelay
    const timer = setTimeout(() => {
      setTypingState((prev) => ({ ...prev, charIndex: prev.charIndex + 1 }))
    }, delay)

    return () => clearTimeout(timer)
  }, [typingState, loading])

  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setCursorVisible((prev) => !prev)
    }, 530)

    return () => clearInterval(cursorInterval)
  }, [])

  // Auto-scroll logic with manual override check
  useEffect(() => {
    if (isAutoScrollEnabled) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [typingState, completedLines, isAutoScrollEnabled])

  // Handle manual scroll to disable auto-scroll when user looks back at logs
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 40
    
    // Only re-enable auto-scroll if user scrolls back to bottom
    if (isAtBottom && !isAutoScrollEnabled) {
      setIsAutoScrollEnabled(true)
    } else if (!isAtBottom && isAutoScrollEnabled) {
      // Disable auto-scroll if user scrolls up
      setIsAutoScrollEnabled(false)
    }
  }

  return (
    <div className="w-full flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div
          className="relative rounded-xl overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #1a1a1a 0%, #0f0f0f 100%)",
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)",
          }}
        >
          {/* Animated border effect with flowing light cycling around */}
          <div
            className="absolute inset-0 rounded-xl pointer-events-none animate-border-flow"
            style={{
              background: `
                linear-gradient(
                  90deg,
                  transparent 0%,
                  transparent 70%,
                  rgba(100, 100, 100, 0.4) 75%,
                  rgba(160, 160, 160, 0.7) 80%,
                  rgba(200, 200, 200, 0.9) 82.5%,
                  rgba(160, 160, 160, 0.7) 85%,
                  rgba(100, 100, 100, 0.4) 90%,
                  transparent 95%,
                  transparent 100%
                )
              `,
              backgroundSize: "400% 400%",
              padding: "1px",
              WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
              WebkitMaskComposite: "xor",
              maskComposite: "exclude",
            }}
          />

          {/* Subtle light streak animation */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.15, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(135deg, transparent 0%, rgba(120, 120, 120, 0.2) 45%, rgba(160, 160, 160, 0.3) 50%, rgba(120, 120, 120, 0.2) 55%, transparent 100%)",
              }}
            />
          </motion.div>

          {/* Terminal header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-b from-boult-raised to-boult-surface-hover border-b border-boult-raised">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-boult-raised hover:bg-boult-raised transition-colors" />
              <div className="w-3 h-3 rounded-full bg-boult-raised hover:bg-boult-raised transition-colors" />
              <div className="w-3 h-3 rounded-full bg-boult-raised hover:bg-boult-raised transition-colors" />
            </div>
            <div className="flex-1 text-center">
              <span className="text-xs font-serif font-medium text-[#8a8a8a] tracking-wide">
                Boult Intelligence Terminal
              </span>
            </div>
            <div className="text-xs text-[#6a6a6a]">
              <span className={`inline-block w-2 h-2 rounded-full ${loading ? 'bg-emerald-500 animate-pulse' : 'bg-[#4a4a4a]'} mr-1.5`} />
              {loading ? 'ACTIVE' : 'READY'}
            </div>
          </div>

          {/* Terminal body */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="h-[380px] overflow-y-auto p-6 font-mono text-[13px] bg-boult-surface custom-scrollbar"
            style={{
              scrollbarWidth: "thin",
              scrollbarColor: "var(--boult-raised) var(--boult-surface)",
            }}
          >
            {completedLines.map((lineIndex) => (
              <div key={lineIndex} className="mb-3">
                <div className="flex items-start gap-2">
                  <span className="text-[#7a7a7a] select-none shrink-0">$</span>
                  <span className="text-[#b8b8b8] leading-relaxed">
                    {terminalSteps[lineIndex].text}
                  </span>
                </div>
              </div>
            ))}

            {typingState.lineIndex < terminalSteps.length && (
              <div className="mb-3">
                <div className="flex items-start gap-2">
                  <span className="text-[#7a7a7a] select-none shrink-0">$</span>
                  <span className="text-[#b8b8b8] leading-relaxed">
                    {terminalSteps[typingState.lineIndex].text.substring(0, typingState.charIndex)}
                    {cursorVisible && (
                      <span className="inline-block w-1.5 h-4 bg-[#7a7a7a] ml-1 self-center" />
                    )}
                  </span>
                </div>
              </div>
            )}

            {typingState.lineIndex >= terminalSteps.length && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="mt-6 pt-4 border-t border-boult-surface-hover"
              >
                <div className="flex items-center gap-2 text-[#6a6a6a]">
                  <span className="text-[#7a7a7a] select-none shrink-0">$</span>
                  <span className="text-[#8a8a8a]">
                    {loading 
                      ? "Intelligence distilled. Finalizing structural mapping..." 
                      : "Intelligence distilled. Mapping dashboard..."}
                  </span>
                  {cursorVisible && (
                    <span className={`inline-block w-1.5 h-4 ${loading ? 'bg-emerald-500/50' : 'bg-[#6366f1]'} ml-1 self-center animate-pulse`} />
                  )}
                </div>
              </motion.div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Terminal footer */}
          <div className="px-4 py-2 bg-gradient-to-t from-boult-surface-hover to-boult-surface border-t border-boult-raised">
            <div className="flex justify-between items-center text-[10px] text-[#6a6a6a] uppercase tracking-widest">
              <span className="font-mono">
                Log: {completedLines.length}/{terminalSteps.length}
              </span>
              {!isAutoScrollEnabled && (
                <button 
                  onClick={() => setIsAutoScrollEnabled(true)}
                  className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded transition-colors"
                >
                  Jump to bottom
                </button>
              )}
              <span className="flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500/20" />
                Neural Core v4.2
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
