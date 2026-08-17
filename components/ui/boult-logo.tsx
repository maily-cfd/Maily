import * as React from "react";
import { cn } from "@/lib/utils";

export interface BoultLogoProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number; // Size in pixels, default is 64
}

export const BoultLogo = React.forwardRef<HTMLDivElement, BoultLogoProps>(
  ({ className, size = 64, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("relative flex items-center justify-center select-none overflow-hidden rounded-2xl bg-black border border-white/[0.08]", className)}
        style={{ width: size, height: size }}
        {...props}
      >
        <img
          src="/boult-logo.png"
          alt="Boult AI Logo"
          className="w-full h-full object-cover"
        />
      </div>
    );
  }
);

BoultLogo.displayName = "BoultLogo";
