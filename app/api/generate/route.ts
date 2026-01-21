import { NextRequest, NextResponse } from "next/server";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import mappingDefault from "@/config/mapping.json";
import coordinatesDefault from "@/config/coordinates.json";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_DOWNLOAD_MB = Number(process.env.MAX_DOWNLOAD_MB ?? "50");
const MAX_DOWNLOAD_BYTES = MAX_DOWNLOAD_MB * 1024 * 1024;

type CoordSpec = {
  x?: number;
  y?: number;
  size?: number;
  align?: string;
  max_width?: number;
  min_size?: number;
  font?: string;
  font_url?: string;
  color?: string | number[];
  opacity?: number;
  background?: {
    color?: string | number[];
    opacity?: number;
    padding?: number;
    padding_x?: number;
    padding_y?: number;
    width?: number;
    height?: number;
    offset_x?: number;
    offset_y?: number;
  };
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workbookUrl = String(body.workbookUrl || "").trim();
    const templatePdfUrl = String(body.templatePdfUrl || "").trim();
    const mappingUrl = String(body.mappingUrl || "").trim();
    const coordsUrl = String(body.coordsUrl || "").trim();

    if (!workbookUrl || !templatePdfUrl) {
      return NextResponse.json(
        { error: "workbookUrl and templatePdfUrl are required." },
        { status: 400 }
      );
    }

    const [workbookBuffer, templateBuffer] = await Promise.all([
      downloadBuffer(workbookUrl, "Workbook"),
      downloadBuffer(templatePdfUrl, "Template PDF"),
    ]);

    const mappingConfig = mappingUrl
      ? await downloadJson(mappingUrl, "Mapping JSON")
      : mappingDefault;
    const coordsConfig = coordsUrl
      ? await downloadJson(coordsUrl, "Coordinates JSON")
      : coordinatesDefault;

    const fieldValues = buildFieldValues(workbookBuffer, mappingConfig);
    const outputPdf = await stampPdf(
      templateBuffer,
      coordsConfig,
      fieldValues,
      request.nextUrl.origin
    );

    return new NextResponse(outputPdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          "attachment; filename=\"Cornerstone Proposal - Filled.pdf\"",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function downloadJson(url: string, label: string) {
  const buffer = await downloadBuffer(url, label);
  return JSON.parse(buffer.toString("utf-8"));
}

async function downloadBuffer(url: string, label: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "cstone-estimating/1.0" },
  });
  if (!response.ok) {
    throw new Error(`${label} download failed (${response.status}).`);
  }
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_DOWNLOAD_BYTES) {
    throw new Error(`${label} exceeds ${MAX_DOWNLOAD_MB} MB limit.`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`${label} exceeds ${MAX_DOWNLOAD_MB} MB limit.`);
  }
  return Buffer.from(arrayBuffer);
}

function buildFieldValues(workbookBuffer: Buffer, mappingConfig: any) {
  const workbook = XLSX.read(workbookBuffer, {
    type: "buffer",
    cellDates: true,
  });

  const missingValue = mappingConfig.missing_value ?? "";
  const preparedByMap = mappingConfig.prepared_by_map ?? {};
  const fieldSpecs = (mappingConfig.fields ?? {}) as Record<
    string,
    { sheet?: string; cell?: string; format?: string }
  >;

  const values: Record<string, string> = {};

  for (const [fieldName, spec] of Object.entries(fieldSpecs)) {
    const sheetName = String(spec.sheet || "");
    const cell = String(spec.cell || "");
    const format = String(spec.format || "text");
    const raw = getCellValue(workbook, sheetName, cell);
    values[fieldName] = formatValue(raw, format, preparedByMap, missingValue);
  }

  const planSetDate = values.plan_set_date;
  values.plan_set_date_line =
    planSetDate && planSetDate !== missingValue
      ? `Estimate based on plan set dated: ${planSetDate}`
      : missingValue;

  return values;
}

function getCellValue(
  workbook: XLSX.WorkBook,
  sheetName: string,
  cell: string
) {
  if (!sheetName || !cell) return null;
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  const cellData = sheet[cell];
  return cellData?.v ?? null;
}

function formatValue(
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

function formatCurrency(value: unknown, missingValue: string) {
  const numberValue = normalizeNumber(value);
  if (numberValue === null) return missingValue;
  const rounded = Math.round(numberValue * 100) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rounded);
}

function formatDateCover(value: unknown, missingValue: string) {
  const parsed = parseDate(value);
  if (!parsed) return missingValue;
  const month = parsed
    .toLocaleString("en-US", { month: "long" })
    .toUpperCase();
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${month} ${day}, ${parsed.getFullYear()}`;
}

function formatDatePlan(value: unknown, missingValue: string) {
  const parsed = parseDate(value);
  if (!parsed) return missingValue;
  const month = parsed.toLocaleString("en-US", { month: "long" });
  return `${month} ${parsed.getDate()}, ${parsed.getFullYear()}`;
}

function formatInitials(
  value: unknown,
  preparedByMap: Record<string, string>,
  missingValue: string
) {
  if (value === null || value === undefined) return missingValue;
  const initials = String(value).trim();
  if (!initials) return missingValue;
  return preparedByMap[initials] ?? initials;
}

function formatText(value: unknown, missingValue: string) {
  if (value === null || value === undefined) return missingValue;
  const text = String(value).trim();
  return text || missingValue;
}

function normalizeNumber(value: unknown) {
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

function parseDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d);
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

async function stampPdf(
  templateBuffer: Buffer,
  coordsConfig: Record<string, any>,
  fieldValues: Record<string, string>,
  baseUrl: string
) {
  const pdfDoc = await PDFDocument.load(templateBuffer);
  pdfDoc.registerFontkit(fontkit);
  const pages = pdfDoc.getPages();

  const standardFontMap: Record<string, string> = {
    Helvetica: StandardFonts.Helvetica,
    "Helvetica-Bold": StandardFonts.HelveticaBold,
    "Times-Roman": StandardFonts.TimesRoman,
    "Times-Bold": StandardFonts.TimesRomanBold,
    "Courier": StandardFonts.Courier,
    "Courier-Bold": StandardFonts.CourierBold,
  };

  const fontCache = new Map<string, any>();
  const fontsConfig = coordsConfig.fonts ?? {};

  for (const [pageKey, pageFields] of Object.entries(coordsConfig)) {
    if (!pageKey.startsWith("page_")) continue;
    const pageIndex = Number(pageKey.replace("page_", "")) - 1;
    const page = pages[pageIndex];
    if (!page) continue;

    const fields = pageFields as Record<string, CoordSpec>;
    for (const [fieldName, spec] of Object.entries(fields)) {
      if (!spec) continue;
      const value = fieldValues[fieldName];
      if (!value) continue;

      const x = Number(spec.x ?? 0);
      const y = Number(spec.y ?? 0);
      const size = Number(spec.size ?? 10);
      const align = String(spec.align ?? "left");
      const maxWidth = spec.max_width ? Number(spec.max_width) : undefined;
      const minSize = Number(spec.min_size ?? 8);
      const fontName = String(spec.font ?? "Helvetica");
      const font = await resolveFont(
        pdfDoc,
        fontCache,
        fontsConfig,
        standardFontMap,
        fontName,
        spec.font_url,
        baseUrl
      );

      const fitted = fitText(value, font, size, maxWidth, minSize);
      const textWidth = font.widthOfTextAtSize(fitted.text, fitted.size);

      let drawX = x;
      if (align === "right") {
        drawX = x - textWidth;
      } else if (align === "center") {
        drawX = x - textWidth / 2;
      }

      const background = spec.background;
      if (background) {
        const padX = Number(background.padding_x ?? background.padding ?? 0);
        const padY = Number(background.padding_y ?? background.padding ?? 0);
        const offsetX = Number(background.offset_x ?? 0);
        const offsetY = Number(background.offset_y ?? 0);
        const textHeight = font.heightAtSize
          ? font.heightAtSize(fitted.size)
          : fitted.size * 1.1;
        const bgWidth = Number(
          background.width ?? maxWidth ?? textWidth
        );
        const bgHeight = Number(background.height ?? textHeight);
        const bgX = drawX - padX + offsetX;
        const bgY = y - textHeight * 0.25 - padY + offsetY;
        page.drawRectangle({
          x: bgX,
          y: bgY,
          width: bgWidth + padX * 2,
          height: bgHeight + padY * 2,
          color: parseColor(background.color, rgb(1, 1, 1)),
          opacity: clampOpacity(background.opacity),
        });
      }

      page.drawText(fitted.text, {
        x: drawX,
        y,
        size: fitted.size,
        font,
        color: parseColor(spec.color, rgb(0, 0, 0)),
        opacity: clampOpacity(spec.opacity),
      });
    }
  }

  return pdfDoc.save();
}

async function resolveFont(
  pdfDoc: PDFDocument,
  cache: Map<string, any>,
  fontsConfig: Record<string, { url?: string; base64?: string }>,
  standardFontMap: Record<string, string>,
  fontName: string,
  fontUrl?: string,
  baseUrl?: string
) {
  const cacheKey = fontUrl ? `${fontName}:${fontUrl}` : fontName;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (standardFontMap[fontName] && !fontUrl && !fontsConfig[fontName]) {
    const font = await pdfDoc.embedFont(standardFontMap[fontName]);
    cache.set(cacheKey, font);
    return font;
  }

  const source = fontUrl ? { url: fontUrl } : fontsConfig[fontName];
  if (source?.url) {
    const resolvedUrl = toAbsoluteUrl(source.url, baseUrl);
    const bytes = await downloadBuffer(resolvedUrl, `Font ${fontName}`);
    const font = await pdfDoc.embedFont(bytes);
    cache.set(cacheKey, font);
    return font;
  }

  if (source?.base64) {
    const bytes = decodeBase64(source.base64);
    const font = await pdfDoc.embedFont(bytes);
    cache.set(cacheKey, font);
    return font;
  }

  const fallback = await pdfDoc.embedFont(StandardFonts.Helvetica);
  cache.set(cacheKey, fallback);
  return fallback;
}

function toAbsoluteUrl(url: string, baseUrl?: string) {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/") && baseUrl) {
    return `${baseUrl}${url}`;
  }
  return url;
}

function decodeBase64(input: string) {
  const cleaned = input.includes(",") ? input.split(",").pop() ?? "" : input;
  return Buffer.from(cleaned, "base64");
}

function parseColor(value: unknown, fallback: ReturnType<typeof rgb>) {
  if (!value) return fallback;
  if (Array.isArray(value)) {
    const [r, g, b] = value;
    return rgb(normalizeColor(r), normalizeColor(g), normalizeColor(b));
  }
  if (typeof value === "string") {
    const hex = value.trim().replace(/^#/, "");
    if (hex.length === 3 || hex.length === 6) {
      const expanded =
        hex.length === 3
          ? hex
              .split("")
              .map((ch) => ch + ch)
              .join("")
          : hex;
      const intVal = Number.parseInt(expanded, 16);
      if (!Number.isNaN(intVal)) {
        const r = (intVal >> 16) & 255;
        const g = (intVal >> 8) & 255;
        const b = intVal & 255;
        return rgb(r / 255, g / 255, b / 255);
      }
    }
  }
  return fallback;
}

function normalizeColor(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  if (value > 1) return Math.min(value / 255, 1);
  return Math.max(value, 0);
}

function clampOpacity(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return 1;
  return Math.min(Math.max(value, 0), 1);
}

function fitText(
  text: string,
  font: any,
  size: number,
  maxWidth?: number,
  minSize = 8
) {
  if (!maxWidth) return { text, size };
  let currentSize = size;
  while (currentSize >= minSize) {
    const width = font.widthOfTextAtSize(text, currentSize);
    if (width <= maxWidth) return { text, size: currentSize };
    currentSize -= 0.5;
  }

  const ellipsis = "...";
  if (font.widthOfTextAtSize(ellipsis, minSize) > maxWidth) {
    return { text: ellipsis, size: minSize };
  }

  for (let i = text.length; i > 0; i -= 1) {
    const candidate = `${text.slice(0, i).trim()}${ellipsis}`;
    if (font.widthOfTextAtSize(candidate, minSize) <= maxWidth) {
      return { text: candidate, size: minSize };
    }
  }

  return { text: ellipsis, size: minSize };
}
