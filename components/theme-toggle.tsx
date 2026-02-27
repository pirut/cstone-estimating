"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ThemeToggleProps = { className?: string };
type ThemeName = "light" | "dark";
type ThemeTransitionMode = "batman" | "circle";
type ViewTransitionLike = {
  finished: Promise<void>;
};
type DocumentWithViewTransition = Document & {
  startViewTransition?: (
    updateCallback: () => void | Promise<void>
  ) => ViewTransitionLike;
};

const BATMAN_THEME_ANIMATION_DURATION_MS = 1320;
const CIRCLE_THEME_ANIMATION_DURATION_MS = 860;
const BATMAN_SVG_TRANSITION_MASK = "/svgwaves_io_batman.svg";
const BATMAN_GIF_TRANSITION_MASK = "/theme-transition/batman-gif-1.gif";
const BATMAN_GIF_TRANSITION_CHANCE = 0.1;
const BATMAN_TRANSITION_MASK_ASSETS = [
  BATMAN_SVG_TRANSITION_MASK,
  BATMAN_GIF_TRANSITION_MASK,
] as const;

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const fallbackUnlockTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (fallbackUnlockTimeoutRef.current) {
        window.clearTimeout(fallbackUnlockTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    for (const src of BATMAN_TRANSITION_MASK_ASSETS) {
      const image = new Image();
      image.src = src;
    }
  }, []);

  const isDark = mounted && resolvedTheme === "dark";
  const stateLabel = isDark ? "DARK" : "LIGHT";
  const nextModeLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

  function clearFallbackUnlockTimeout() {
    if (fallbackUnlockTimeoutRef.current) {
      window.clearTimeout(fallbackUnlockTimeoutRef.current);
      fallbackUnlockTimeoutRef.current = null;
    }
  }

  function finalizeTransition() {
    clearFallbackUnlockTimeout();
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      delete root.dataset.themeTransition;
      root.style.removeProperty("--theme-transition-duration");
      root.style.removeProperty("--theme-transition-batman-mask");
    }
    setIsAnimating(false);
  }

  function pickBatmanTransitionMask() {
    return Math.random() < BATMAN_GIF_TRANSITION_CHANCE
      ? BATMAN_GIF_TRANSITION_MASK
      : BATMAN_SVG_TRANSITION_MASK;
  }

  function applyTheme(nextTheme: ThemeName) {
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    setTheme(nextTheme);
  }

  function toggleTheme() {
    if (!mounted || isAnimating) return;

    const nextTheme: ThemeName = isDark ? "light" : "dark";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      applyTheme(nextTheme);
      return;
    }

    const documentWithTransition = document as DocumentWithViewTransition;
    const startViewTransition =
      typeof documentWithTransition.startViewTransition === "function"
        ? documentWithTransition.startViewTransition.bind(documentWithTransition)
        : null;
    if (!startViewTransition) {
      applyTheme(nextTheme);
      return;
    }

    const transitionMode: ThemeTransitionMode =
      nextTheme === "dark" ? "batman" : "circle";
    const transitionDurationMs =
      transitionMode === "batman"
        ? BATMAN_THEME_ANIMATION_DURATION_MS
        : CIRCLE_THEME_ANIMATION_DURATION_MS;
    const root = document.documentElement;
    setIsAnimating(true);
    clearFallbackUnlockTimeout();
    root.dataset.themeTransition = transitionMode;
    root.style.setProperty(
      "--theme-transition-duration",
      `${transitionDurationMs}ms`
    );
    if (transitionMode === "batman") {
      root.style.setProperty(
        "--theme-transition-batman-mask",
        `url("${pickBatmanTransitionMask()}")`
      );
    } else {
      root.style.removeProperty("--theme-transition-batman-mask");
    }

    fallbackUnlockTimeoutRef.current = window.setTimeout(() => {
      finalizeTransition();
    }, transitionDurationMs + 180);

    try {
      const transition = startViewTransition(() => {
        applyTheme(nextTheme);
      });
      transition.finished.finally(() => {
        finalizeTransition();
      });
    } catch {
      applyTheme(nextTheme);
      finalizeTransition();
    }
  }

  return (
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
  );
}
