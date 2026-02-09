import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const inputVariants = cva(
  "flex w-full border border-border/70 bg-background/85 text-foreground ring-offset-background shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      uiSize: {
        default: "h-11 rounded-xl px-3 py-2 text-sm",
        sm: "h-10 rounded-lg px-3 py-2 text-sm",
        xs: "h-8 rounded-md px-2 py-1 text-sm",
      },
    },
    defaultVariants: {
      uiSize: "default",
    },
  }
);

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", uiSize, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputVariants({ uiSize }), className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input, inputVariants };
