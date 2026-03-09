"use client";

import { cn } from "@/lib/utils";

type BrandMarkProps = {
  tone?: "light" | "dark" | "auto";
  size?: "default" | "sm";
  className?: string;
};

export function BrandMark({ tone = "light", size = "default", className }: BrandMarkProps) {
  const isDark = tone === "dark";
  const isAuto = tone === "auto";
  const isSmall = size === "sm";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border",
          isSmall ? "h-8 w-8" : "h-12 w-12 rounded-2xl shadow-glow",
          isDark ? "border-white/40 bg-white" : isAuto ? "border-border/60 bg-card" : "border-border bg-background"
        )}
      >
        <img
          src="/brand/cornerstone-logo.png"
          alt="Cornerstone"
          className={cn("object-contain", isSmall ? "h-5 w-5" : "h-8 w-8")}
        />
      </div>
      {!isSmall ? (
        <div>
          <p
            className={cn(
              "text-[11px] uppercase tracking-[0.4em]",
              isDark ? "text-white/70" : "text-muted-foreground"
            )}
          >
            Cornerstone
          </p>
          <p
            className={cn(
              "text-2xl font-serif",
              isDark ? "text-white" : "text-foreground"
            )}
          >
            Proposal Studio
          </p>
        </div>
      ) : null}
    </div>
  );
}
