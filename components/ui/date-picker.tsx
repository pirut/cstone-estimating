"use client";

import { CalendarDays } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { inputVariants } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  clearable?: boolean;
};

function DatePicker({
  value = "",
  onChange,
  placeholder = "Pick a date",
  disabled,
  className,
  clearable = true,
}: DatePickerProps) {
  const selectedDate = parseIsoDate(value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            inputVariants({ uiSize: "default" }),
            "justify-start border-border/70 text-left font-normal",
            !selectedDate && "text-muted-foreground",
            className
          )}
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          {selectedDate
            ? selectedDate.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => onChange(date ? formatIsoDate(date) : "")}
          initialFocus
        />
        {clearable && selectedDate ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-xs"
            onClick={() => onChange("")}
          >
            Clear date
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function parseIsoDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }
  return date;
}

function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export { DatePicker };
