"use client"

import { useRef } from "react"
import {
  motion,
  useInView,
  useReducedMotion,
  UseInViewOptions,
  Variants,
} from "framer-motion"

type MarginType = UseInViewOptions["margin"]

interface BlurFadeProps {
  children: React.ReactNode
  className?: string
  variant?: {
    hidden: { y: number; opacity: number; filter?: string }
    visible: { y: number; opacity: number; filter?: string }
  }
  duration?: number
  delay?: number
  yOffset?: number
  inView?: boolean
  inViewMargin?: MarginType
  /** Ignored — blur filters were the landing scroll jank. Kept for API compat. */
  blur?: string
  /**
   * Re-run the reveal every time the element enters the viewport.
   * Prefer once-only on landing; repeat is expensive on large subtrees.
   */
  repeat?: boolean
}

/**
 * Soft section reveal: opacity + slight rise only.
 * Previously used filter:blur() which forced expensive rasterization on every
 * scroll-triggered animation across the landing page.
 */
export function BlurFade({
  children,
  className,
  variant,
  duration = 0.45,
  delay = 0,
  yOffset = 10,
  inView = false,
  inViewMargin = "-40px",
  repeat = false,
}: BlurFadeProps) {
  const ref = useRef(null)
  const prefersReducedMotion = useReducedMotion()
  const inViewResult = useInView(ref, { once: !repeat, margin: inViewMargin })
  const isInView = !inView || inViewResult

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>
  }

  const defaultVariants: Variants = {
    hidden: {
      y: yOffset,
      opacity: 0,
    },
    visible: {
      y: 0,
      opacity: 1,
    },
  }

  // Strip any caller-supplied filter blur so old call sites stay cheap.
  const combinedVariants = variant
    ? {
        hidden: { y: variant.hidden.y, opacity: variant.hidden.opacity },
        visible: { y: variant.visible.y, opacity: variant.visible.opacity },
      }
    : defaultVariants

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={combinedVariants}
      transition={{
        delay: 0.04 + delay,
        duration,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={className}
      style={{ willChange: "opacity, transform" }}
    >
      {children}
    </motion.div>
  )
}
