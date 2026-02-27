"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ThemeToggleProps = { className?: string };

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";
  const stateLabel = isDark ? "ON" : "OFF";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "h-10 rounded-full border-border/70 bg-background/80 px-3 text-[11px] font-semibold uppercase tracking-[0.14em]",
        className
      )}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      disabled={!mounted}
      aria-label={isDark ? "Disable Dark Knight Mode" : "Enable Dark Knight Mode"}
      title={isDark ? "Disable Dark Knight Mode" : "Enable Dark Knight Mode"}
    >
      <span
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-full border",
          isDark
            ? "border-accent/40 bg-accent/15"
            : "border-border/70 bg-muted/70"
        )}
        aria-hidden="true"
      >
        <span
          className={cn("h-4 w-4", isDark ? "bg-accent" : "bg-muted-foreground")}
          style={{
            WebkitMaskImage: "url('/batman-5-logo-svgrepo-com.svg')",
            maskImage: "url('/batman-5-logo-svgrepo-com.svg')",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
      </span>
      <span className="text-foreground">Dark Knight Mode</span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[9px] tracking-[0.16em]",
          isDark ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {stateLabel}
      </span>
      <span className="sr-only">Toggle Dark Knight Mode</span>
    </Button>
  );
}
