"use client";

import * as React from "react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-0", className)}
      classNames={{
        root: "w-full",
        months: "flex w-full flex-col",
        month: "w-full space-y-4",
        month_caption: "relative flex items-center justify-center px-9 pt-1",
        caption_label: "text-sm font-semibold",
        nav: "absolute inset-x-0 top-1 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-7 w-7 rounded-md opacity-70 hover:opacity-100"
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-7 w-7 rounded-md opacity-70 hover:opacity-100"
        ),
        chevron: "h-4 w-4",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-9 rounded-md text-[0.75rem] font-medium uppercase tracking-[0.1em] text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "h-9 w-9 p-0 text-center text-sm",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 rounded-md p-0 font-normal aria-selected:opacity-100"
        ),
        today: "text-accent",
        selected:
          "bg-accent text-accent-foreground rounded-md [&>button]:bg-accent [&>button]:text-accent-foreground",
        outside: "text-muted-foreground opacity-45",
        disabled: "text-muted-foreground opacity-40",
        hidden: "invisible",
        range_start:
          "bg-accent/25 rounded-l-md [&>button]:bg-accent [&>button]:text-accent-foreground",
        range_middle: "bg-accent/15",
        range_end:
          "bg-accent/25 rounded-r-md [&>button]:bg-accent [&>button]:text-accent-foreground",
        ...classNames,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
