'use client';

import { cn } from '@/lib/utils';

/**
 * Premium shimmer skeletons — use these instead of spinners for any
 * data-fetching state (inbox load, conversation list, dashboard pull).
 * A spinner says "wait"; a skeleton says "your content is arriving".
 */

function Bar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-boult-elevated',
        'before:absolute before:inset-0 before:-translate-x-full',
        'before:bg-gradient-to-r before:from-transparent before:via-white/[0.06] before:to-transparent',
        'before:animate-[shimmer_1.4s_infinite]',
        className,
      )}
    />
  );
}

/** A single message-card skeleton (assistant reply placeholder). */
export function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 py-2 w-full max-w-[640px]">
      <Bar className="h-3 w-[42%]" />
      <Bar className="h-3 w-[88%]" />
      <Bar className="h-3 w-[74%]" />
      <Bar className="h-3 w-[60%]" />
      <style jsx global>{`
        @keyframes shimmer { 100% { transform: translateX(100%); } }
      `}</style>
    </div>
  );
}

/** A list-row skeleton (conversation history / inbox rows). */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 w-full">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-xl border border-boult-border bg-boult-elevated/50"
        >
          <Bar className="w-9 h-9 rounded-lg shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <Bar className="h-2.5 w-[55%]" />
            <Bar className="h-2.5 w-[80%]" />
          </div>
        </div>
      ))}
      <style jsx global>{`
        @keyframes shimmer { 100% { transform: translateX(100%); } }
      `}</style>
    </div>
  );
}

export { Bar as SkeletonBar };
export default MessageSkeleton;
