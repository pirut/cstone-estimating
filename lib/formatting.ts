export type MappingConfig = {
  missing_value?: string;
  prepared_by_map?: Record<string, string>;
  fields?: Record<string, { sheet?: string; cell?: string; format?: string }>;
};

export function formatValue(
  value: unknown,
  format: string,
  preparedByMap: Record<string, string>,
  missingValue: string
) {
  switch (format) {
    case "currency":
      return formatCurrency(value, missingValue);
    case "date_cover":
      return formatDateCover(value, missingValue);
    case "date_plan":
      return formatDatePlan(value, missingValue);
    case "initials":
      return formatInitials(value, preparedByMap, missingValue);
    default:
      return formatText(value, missingValue);
  }
}

export function formatPreviewValue(
  value: unknown,
  format: string | undefined,
  preparedByMap: Record<string, string>,
  missingValue: string
) {
  if (value === null || value === undefined) return null;
  return formatValue(value, format ?? "text", preparedByMap, missingValue);
}

export function formatCurrency(value: unknown, missingValue: string) {
  const numberValue = normalizeNumber(value);
  if (numberValue === null) return missingValue;
  const rounded = Math.round(numberValue * 100) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rounded);
}

export function formatDateCover(value: unknown, missingValue: string) {
  const parsed = parseDate(value);
  if (!parsed) return missingValue;
  const month = parsed
    .toLocaleString("en-US", { month: "long" })
    .toUpperCase();
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${month} ${day}, ${parsed.getFullYear()}`;
}

export function formatDatePlan(value: unknown, missingValue: string) {
  const parsed = parseDate(value);
  if (!parsed) return missingValue;
  const month = parsed.toLocaleString("en-US", { month: "long" });
  return `${month} ${parsed.getDate()}, ${parsed.getFullYear()}`;
}

export function formatInitials(
  value: unknown,
  preparedByMap: Record<string, string>,
  missingValue: string
) {
  if (value === null || value === undefined) return missingValue;
  const initials = String(value).trim();
  if (!initials) return missingValue;
  return preparedByMap[initials] ?? initials;
}

export function formatText(value: unknown, missingValue: string) {
  if (value === null || value === undefined) return missingValue;
  const text = String(value).trim();
  return text || missingValue;
}

export function normalizeNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,]/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === "number") {
    return parseExcelSerialDate(value);
  }
  if (typeof value === "string") {
    const cleaned = value.trim();
    if (!cleaned) return null;

    const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }

    const mdyMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (mdyMatch) {
      const [, month, day, yearRaw] = mdyMatch;
      const year = yearRaw.length === 2 ? Number(`20${yearRaw}`) : Number(yearRaw);
      return new Date(year, Number(month) - 1, Number(day));
    }
  }
  return null;
}

function parseExcelSerialDate(value: number) {
  if (!Number.isFinite(value)) return null;
  const days = Math.floor(value);
  if (days <= 0) return null;

  // Excel incorrectly treats 1900 as a leap year. Adjust for serials >= 60.
  const adjustedDays = days >= 60 ? days - 1 : days;
  const epoch = new Date(1899, 11, 31);
  const date = new Date(
    epoch.getFullYear(),
    epoch.getMonth(),
    epoch.getDate() + adjustedDays
  );
  return Number.isNaN(date.valueOf()) ? null : date;
}
