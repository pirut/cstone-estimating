"use client";

import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ThemeToggleProps = { className?: string };
type ThemeName = "light" | "dark";
type ThemeTransition = {
  nextTheme: ThemeName;
  key: number;
};

const THEME_SWAP_DELAY_MS = 420;
const THEME_ANIMATION_DURATION_MS = 860;

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [transition, setTransition] = useState<ThemeTransition | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const swapTimeoutRef = useRef<number | null>(null);
  const cleanupTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (swapTimeoutRef.current) {
        window.clearTimeout(swapTimeoutRef.current);
      }
      if (cleanupTimeoutRef.current) {
        window.clearTimeout(cleanupTimeoutRef.current);
      }
    };
  }, []);

  const isDark = mounted && resolvedTheme === "dark";
  const stateLabel = isDark ? "DARK" : "LIGHT";
  const nextModeLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

  function clearTransitionTimers() {
    if (swapTimeoutRef.current) {
      window.clearTimeout(swapTimeoutRef.current);
      swapTimeoutRef.current = null;
    }
    if (cleanupTimeoutRef.current) {
      window.clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }
  }

  function toggleTheme() {
    if (!mounted || isAnimating) return;

    const nextTheme: ThemeName = isDark ? "light" : "dark";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTheme(nextTheme);
      return;
    }

    clearTransitionTimers();
    setIsAnimating(true);
    setTransition({ nextTheme, key: Date.now() });

    swapTimeoutRef.current = window.setTimeout(() => {
      setTheme(nextTheme);
      swapTimeoutRef.current = null;
    }, THEME_SWAP_DELAY_MS);

    cleanupTimeoutRef.current = window.setTimeout(() => {
      setTransition(null);
      setIsAnimating(false);
      cleanupTimeoutRef.current = null;
    }, THEME_ANIMATION_DURATION_MS);
  }

  const transitionOverlay =
    transition && typeof document !== "undefined"
      ? createPortal(
          <div
            key={transition.key}
            aria-hidden="true"
            className={cn(
              "theme-theme-transition",
              transition.nextTheme === "dark"
                ? "theme-bat-transition--dark"
                : "theme-circle-transition--light"
            )}
            style={
              {
                animationDuration: `${THEME_ANIMATION_DURATION_MS}ms`,
              } as CSSProperties
            }
          />,
          document.body
        )
      : null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "h-10 rounded-full border-border/70 bg-background/80 px-3 text-[11px] font-semibold uppercase tracking-[0.14em]",
          className
        )}
        onClick={toggleTheme}
        disabled={!mounted || isAnimating}
        aria-label={nextModeLabel}
        title={nextModeLabel}
      >
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full border p-1",
            isDark
              ? "border-accent/60 bg-accent/40"
              : "border-border/70 bg-muted/80"
          )}
          aria-hidden="true"
        >
          <span className="relative h-[18px] w-[18px]">
            <Sun
              className={cn(
                "absolute inset-0 h-[18px] w-[18px] text-amber-500 transition-all duration-500",
                isDark
                  ? "scale-[0.45] -rotate-90 opacity-0"
                  : "scale-100 rotate-0 opacity-100"
              )}
              style={{ transitionTimingFunction: "cubic-bezier(0.2, 0.72, 0.2, 1)" }}
            />
            <span
              className={cn(
                "absolute inset-0 h-[18px] w-[18px] bg-accent-foreground transition-all duration-500",
                isDark
                  ? "scale-100 rotate-0 opacity-100"
                  : "scale-[0.45] rotate-90 opacity-0"
              )}
              style={{
                transitionTimingFunction: "cubic-bezier(0.2, 0.72, 0.2, 1)",
                WebkitMaskImage: "url('/svgwaves_io_batman.svg')",
                maskImage: "url('/svgwaves_io_batman.svg')",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
                WebkitMaskSize: "contain",
                maskSize: "contain",
              }}
            />
          </span>
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[9px] tracking-[0.16em]",
            isDark
              ? "bg-accent text-accent-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {stateLabel}
        </span>
        <span className="sr-only">{nextModeLabel}</span>
      </Button>
      {transitionOverlay}
    </>
  );
}
