"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
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
          "inline-flex h-7 w-7 items-center justify-center rounded-full border p-1",
          isDark
            ? "border-accent/60 bg-accent/40"
            : "border-border/70 bg-muted/80"
        )}
        aria-hidden="true"
      >
        <Image
          src="/svgwaves_io_batman.svg"
          alt=""
          width={18}
          height={18}
          className={cn(
            "h-[18px] w-[18px] object-contain",
            isDark ? "brightness-0 contrast-125" : "brightness-0 contrast-110"
          )}
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
