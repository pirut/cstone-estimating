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
          "relative h-12 w-12 rounded-2xl shadow-glow",
          isDark ? "bg-white" : "bg-foreground"
        )}
      >
        <div
          className={cn(
            "absolute inset-2 rounded-xl border-2",
            isDark ? "border-foreground/60" : "border-white/80"
          )}
        />
        <div
          className={cn(
            "absolute bottom-2 right-2 h-3.5 w-3.5 rounded-sm",
            isDark ? "bg-accent" : "bg-accent"
          )}
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
