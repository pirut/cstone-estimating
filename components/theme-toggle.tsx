"use client";

import { useEffect, useState } from "react";
import { Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ThemeToggleProps = {
  className?: string;
};

function BatSymbol({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M2.25 13.2c1.16-.04 2.03-.6 2.67-1.66.76.56 1.6.85 2.53.85.43-1.13 1.18-1.97 2.27-2.48.26.68.67 1.02 1.23 1.02s.97-.34 1.23-1.02c1.09.51 1.84 1.35 2.27 2.48.93 0 1.77-.29 2.53-.85.64 1.06 1.51 1.62 2.67 1.66-.7.65-1.54 1.08-2.54 1.29-.65 1.84-2.03 3.02-4.16 3.51-.35-.44-.72-.81-1.11-1.11-.39.3-.76.67-1.11 1.11-2.13-.49-3.51-1.67-4.16-3.51-1-.21-1.84-.64-2.54-1.29Zm3.98-3.99.59-2.49 1.71 1.63c.58-.74 1.07-1.59 1.47-2.54.4.95.89 1.8 1.47 2.54l1.71-1.63.59 2.49 2.2-.18-1.14 2.03a3.2 3.2 0 0 1-.67.14c-.56-1.1-1.41-2-2.58-2.66-.49.93-1.05 1.4-1.68 1.4s-1.19-.47-1.68-1.4c-1.17.66-2.02 1.56-2.58 2.66a3.2 3.2 0 0 1-.67-.14L4 9.03l2.23.18Z" />
    </svg>
  );
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn("relative", className)}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      disabled={!mounted}
      aria-label={isDark ? "Switch to light mode" : "Switch to Dark Knight Mode"}
      title={isDark ? "Switch to light mode" : "Switch to Dark Knight Mode"}
    >
      <Sun
        className={cn(
          "h-4 w-4 transition-all",
          isDark ? "rotate-90 scale-0" : "rotate-0 scale-100"
        )}
      />
      <BatSymbol
        className={cn(
          "absolute h-4 w-4 transition-all",
          isDark ? "rotate-0 scale-100" : "-rotate-90 scale-0"
        )}
      />
      <span className="sr-only">Toggle Dark Knight Mode</span>
    </Button>
  );
}
