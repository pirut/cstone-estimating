import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input, inputVariants } from "@/components/ui/input";
import { toNumber } from "@/lib/estimate-calculator";
import { cn } from "@/lib/utils";

const defaultInputClassName = inputVariants({ uiSize: "default" });

export function SectionHeader({
  title,
  done,
}: {
  title: string;
  done: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
      <Badge
        variant={done ? "accent" : "outline"}
        className={cn("text-[10px]", done && "bg-accent/90")}
      >
        {done ? "Complete" : "In progress"}
      </Badge>
    </div>
  );
}

export function RateField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  moneyCurrency,
  moneySuffix,
  percent,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  moneyCurrency?: "USD" | "EUR";
  moneySuffix?: string;
  percent?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </label>
      {moneyCurrency ? (
        <MoneyInput
          className={defaultInputClassName}
          value={value}
          onValueChange={onChange}
          currency={moneyCurrency}
          placeholder={placeholder}
          disabled={disabled}
          suffix={moneySuffix}
        />
      ) : percent ? (
        <PercentInput
          className={defaultInputClassName}
          value={value}
          onValueChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
        />
      ) : (
        <Input
          className={defaultInputClassName}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </div>
  );
}

export function FeatureOptionCombobox({
  className,
  value,
  options,
  onSelect,
  onCreate,
  placeholder,
  disabled,
}: {
  className?: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  onCreate?: (
    label: string
  ) => Promise<{ ok: boolean; value?: string; error?: string }>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [hasTyped, setHasTyped] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>();
    return options
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => {
        const key = entry.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [options]);

  const trimmedQuery = query.trim();
  const filteredOptions = useMemo(() => {
    if (!hasTyped || !trimmedQuery) return normalizedOptions;
    const needle = trimmedQuery.toLowerCase();
    return normalizedOptions.filter((entry) =>
      entry.toLowerCase().includes(needle)
    );
  }, [hasTyped, normalizedOptions, trimmedQuery]);

  const hasExactMatch = normalizedOptions.some(
    (entry) => entry.toLowerCase() === trimmedQuery.toLowerCase()
  );
  const canCreate = Boolean(
    onCreate &&
      hasTyped &&
      trimmedQuery &&
      !hasExactMatch &&
      filteredOptions.length === 0
  );

  useEffect(() => {
    if (open) return;
    setQuery(value);
    setHasTyped(false);
    setError(null);
  }, [open, value]);

  const commitValue = (nextValue: string) => {
    onSelect(nextValue);
    setQuery(nextValue);
    setOpen(false);
    setError(null);
  };

  const handleCreate = async () => {
    if (!onCreate || !trimmedQuery || isCreating) return;
    setIsCreating(true);
    setError(null);
    const result = await onCreate(trimmedQuery);
    setIsCreating(false);
    if (!result.ok) {
      setError(result.error ?? "Unable to add option.");
      return;
    }
    commitValue(result.value ?? trimmedQuery);
  };

  return (
    <div
      className="relative"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && event.currentTarget.contains(nextTarget)) return;
        if (hasTyped) {
          const exact = normalizedOptions.find(
            (entry) => entry.toLowerCase() === trimmedQuery.toLowerCase()
          );
          if (exact) {
            onSelect(exact);
            setQuery(exact);
          } else {
            setQuery(value);
          }
        } else {
          setQuery(value);
        }
        setOpen(false);
        setHasTyped(false);
        setError(null);
      }}
    >
      <Input
        className={className}
        value={query}
        onFocus={() => {
          setOpen(true);
          setHasTyped(false);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setHasTyped(true);
          setOpen(true);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setQuery(value);
            setHasTyped(false);
            setError(null);
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (filteredOptions.length) {
            commitValue(filteredOptions[0]);
            return;
          }
          if (canCreate) {
            void handleCreate();
          }
        }}
        placeholder={placeholder}
        disabled={disabled || isCreating}
      />
      {open ? (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border/70 bg-popover shadow-lg">
          {value ? (
            <button
              type="button"
              className="block w-full border-b border-border/60 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/30"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitValue("")}
            >
              Clear selection
            </button>
          ) : null}
          {filteredOptions.map((option) => (
            <button
              key={option}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/30"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitValue(option)}
            >
              {option}
            </button>
          ))}
          {!filteredOptions.length ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No matching options.
            </div>
          ) : null}
          {canCreate ? (
            <button
              type="button"
              className="block w-full border-t border-border/60 px-3 py-2 text-left text-sm font-medium text-accent hover:bg-accent/10"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void handleCreate()}
              disabled={isCreating}
            >
              {isCreating ? "Adding..." : `Add "${trimmedQuery}" as new option`}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function formatCurrency(value: number, currency: "USD" | "EUR" = "USD") {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatMargin(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

export function MoneyInput({
  className,
  value,
  onValueChange,
  currency,
  placeholder,
  disabled,
  suffix,
}: {
  className?: string;
  value: string;
  onValueChange: (value: string) => void;
  currency: "USD" | "EUR";
  placeholder?: string;
  disabled?: boolean;
  suffix?: string;
}) {
  const symbol = currency === "EUR" ? "€" : "$";
  const normalizedValue = parseMoneyToModel(value);
  const displayValue = formatMoneyForInput(normalizedValue, currency);
  const suffixDisplay = suffix ? ` ${suffix}` : "";
  return (
    <div className="relative">
      <Input
        className={cn(className, suffix && "pr-14")}
        value={displayValue}
        onChange={(event) => onValueChange(parseMoneyToModel(event.target.value))}
        inputMode="decimal"
        placeholder={placeholder ? `${symbol}${placeholder}` : `${symbol}0`}
        disabled={disabled}
      />
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          {suffixDisplay}
        </span>
      ) : null}
    </div>
  );
}

export function PercentInput({
  className,
  value,
  onValueChange,
  placeholder,
  disabled,
}: {
  className?: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Input
      className={className}
      value={formatPercentForInput(value)}
      onChange={(event) => onValueChange(parsePercentToDecimalString(event.target.value))}
      inputMode="decimal"
      placeholder={placeholder ? `${placeholder}%` : "0%"}
      disabled={disabled}
    />
  );
}

function parseMoneyToModel(value: string) {
  let result = "";
  let hasDot = false;

  for (const char of String(value ?? "")) {
    if (char === "-" && !result.length) {
      result += char;
      continue;
    }
    if (char === "." && !hasDot) {
      result += char;
      hasDot = true;
      continue;
    }
    if (char >= "0" && char <= "9") {
      result += char;
    }
  }

  return result;
}

export function parsePercentToDecimalString(value: string) {
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "").trim();
  if (!cleaned) return "";
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return "";
  return String(numeric / 100);
}

export function formatPercentForInput(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" && !value.trim()) return "";
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) return "";
  const percent = Math.round(numeric * 100 * 10000) / 10000;
  return `${percent}%`;
}

function formatMoneyForInput(value: string, currency: "USD" | "EUR") {
  if (!value) return "";
  const symbol = currency === "EUR" ? "€" : "$";
  const isNegative = value.startsWith("-");
  const unsigned = isNegative ? value.slice(1) : value;
  if (!unsigned || unsigned === ".") {
    return `${isNegative ? "-" : ""}${symbol}${unsigned ? "0." : ""}`;
  }

  const [intRaw, decimalRaw] = unsigned.split(".");
  const intDigits = intRaw.replace(/\D/g, "");
  const intValue = intDigits ? Number(intDigits) : 0;
  const intFormatted = Number.isFinite(intValue)
    ? intValue.toLocaleString("en-US")
    : "0";

  return `${isNegative ? "-" : ""}${symbol}${intFormatted}${
    decimalRaw !== undefined ? `.${decimalRaw}` : ""
  }`;
}
