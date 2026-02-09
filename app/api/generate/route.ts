import { NextRequest, NextResponse } from "next/server";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import mappingDefault from "@/config/mapping.json";
import coordinatesDefault from "@/config/coordinates.json";
import { downloadBuffer, downloadJson } from "@/lib/server/download";
import { formatValue } from "@/lib/formatting";
import { computeEstimate, DEFAULT_DRAFT } from "@/lib/estimate-calculator";
import {
  CoordSpec,
  getPageFields,
  getSortedPageKeys,
  parsePageKey,
} from "@/lib/coordinates";

export const runtime = "nodejs";
export const maxDuration = 60;

const DOWNLOAD_TIMEOUT_MS = 20000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workbookUrl = String(body.workbookUrl || "").trim();
    const templatePdfUrl = String(body.templatePdfUrl || "").trim();
    const mappingUrl = String(body.mappingUrl || "").trim();
    const coordsUrl = String(body.coordsUrl || "").trim();
    const estimateUrl = String(body.estimateUrl || "").trim();
    const estimatePayload =
      body.estimate && typeof body.estimate === "object" ? body.estimate : null;
    const mappingOverride =
      body.mappingOverride && typeof body.mappingOverride === "object"
        ? body.mappingOverride
        : null;
    const coordsOverride =
      body.coordsOverride && typeof body.coordsOverride === "object"
        ? body.coordsOverride
        : null;

    if (
      !templatePdfUrl ||
      (!workbookUrl && !estimateUrl && !estimatePayload)
    ) {
      return NextResponse.json(
        {
          error:
            "templatePdfUrl and either workbookUrl or estimate data are required.",
        },
        { status: 400 }
      );
    }

    const templateBuffer = await downloadBuffer(
      templatePdfUrl,
      "Template PDF",
      {
        baseUrl: request.nextUrl.origin,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      }
    );

    const mappingConfig = mappingOverride
      ? mappingOverride
      : mappingUrl
        ? await downloadJson(mappingUrl, "Mapping JSON", {
            baseUrl: request.nextUrl.origin,
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
          })
        : mappingDefault;
    const coordsConfig = coordsOverride
      ? coordsOverride
      : coordsUrl
        ? await downloadJson(coordsUrl, "Coordinates JSON", {
            baseUrl: request.nextUrl.origin,
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
          })
        : coordinatesDefault;

    let fieldValues: Record<string, string> = {};
    if (estimatePayload || estimateUrl) {
      const estimateData = estimatePayload
        ? estimatePayload
        : await downloadJson(estimateUrl, "Estimate JSON", {
            baseUrl: request.nextUrl.origin,
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
          });
      fieldValues = buildFieldValuesFromEstimate(estimateData, mappingConfig);
    } else {
      const workbookBuffer = await downloadBuffer(workbookUrl, "Workbook", {
        baseUrl: request.nextUrl.origin,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      });
      fieldValues = buildFieldValues(workbookBuffer, mappingConfig);
    }
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

// downloadBuffer/downloadJson moved to lib/server/download

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
    planSetDate && planSetDate !== missingValue ? planSetDate : missingValue;

  return values;
}

function buildFieldValuesFromEstimate(estimateData: any, mappingConfig: any) {
  const missingValue = mappingConfig.missing_value ?? "";
  const preparedByMap = mappingConfig.prepared_by_map ?? {};
  const fieldSpecs = (mappingConfig.fields ?? {}) as Record<
    string,
    { sheet?: string; cell?: string; format?: string }
  >;

  const sourceValues = extractEstimateValues(estimateData);
  const values: Record<string, string> = {};

  for (const [fieldName, spec] of Object.entries(fieldSpecs)) {
    const format = String(spec.format || "text");
    const raw = sourceValues[fieldName];
    values[fieldName] = formatValue(raw, format, preparedByMap, missingValue);
  }

  const planSetDate = values.plan_set_date;
  values.plan_set_date_line =
    planSetDate && planSetDate !== missingValue ? planSetDate : missingValue;

  return values;
}

function extractEstimateValues(estimateData: any) {
  if (!estimateData || typeof estimateData !== "object") return {};
  if (estimateData.values && typeof estimateData.values === "object") {
    return estimateData.values as Record<string, unknown>;
  }

  if (
    estimateData.info ||
    estimateData.products ||
    estimateData.bucking ||
    estimateData.calculator
  ) {
    const computed = computeEstimate({
      info: estimateData.info ?? {},
      products:
        Array.isArray(estimateData.products) && estimateData.products.length
          ? estimateData.products
          : DEFAULT_DRAFT.products,
      bucking:
        Array.isArray(estimateData.bucking) && estimateData.bucking.length
          ? estimateData.bucking
          : DEFAULT_DRAFT.bucking,
      calculator: {
        ...DEFAULT_DRAFT.calculator,
        ...(estimateData.calculator ?? {}),
      },
    });
    return computed.pdfValues as Record<string, unknown>;
  }

  return estimateData as Record<string, unknown>;
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
  if (!cellData) return null;
  return cellData.v ?? null;
}

// formatting helpers moved to lib/formatting

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

  for (const pageKey of getSortedPageKeys(coordsConfig)) {
    const pageNumber = parsePageKey(pageKey);
    if (!pageNumber) continue;
    const pageIndex = pageNumber - 1;
    const page = pages[pageIndex];
    if (!page) continue;

    const fields = getPageFields(coordsConfig, pageKey) as Record<
      string,
      CoordSpec
    >;
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
    const bytes = await downloadBuffer(resolvedUrl, `Font ${fontName}`, {
      baseUrl,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    });
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
