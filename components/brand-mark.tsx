"use client";

import { cn } from "@/lib/utils";

type BrandMarkProps = {
  tone?: "light" | "dark";
  className?: string;
};

export function BrandMark({ tone = "light", className }: BrandMarkProps) {
  const isDark = tone === "dark";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-2xl border shadow-glow",
          isDark ? "border-white/40 bg-white" : "border-border bg-background"
        )}
      >
        <img
          src="/brand/cornerstone-logo.png"
          alt="Cornerstone"
          className="h-8 w-8 object-contain"
        />
      </div>
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
    </div>
  );
}
