"use client";

import { cn } from "@/lib/utils";

type BrandMarkProps = {
  tone?: "light" | "dark" | "auto";
  size?: "default" | "sm";
  className?: string;
};

export function BrandMark({ tone = "light", size = "default", className }: BrandMarkProps) {
  const isDark = tone === "dark";
  const isSmall = size === "sm";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "flex shrink-0 items-center justify-center",
          isSmall ? "h-8 w-8" : "h-11 w-11",
        )}
      >
        <img
          src="/brand/cornerstone-logo.png"
          alt="Cornerstone"
          className={cn("object-contain", isSmall ? "h-7 w-7" : "h-10 w-10")}
        />
      </div>
      {!isSmall ? (
        <div>
          <p
            className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.35em]",
              isDark ? "text-white/60" : "text-muted-foreground"
            )}
          >
            Cornerstone
          </p>
          <p
            className={cn(
              "text-xl font-serif font-light tracking-tight",
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
