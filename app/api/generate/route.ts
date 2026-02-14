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
  toPageKey,
} from "@/lib/coordinates";
import type {
  MasterTemplateInclusionMode,
  MasterTemplateSectionKey,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DOWNLOAD_TIMEOUT_MS = 20000;
const DEFAULT_PROJECT_TYPE_FIELD = "project_type";
const DEFAULT_PRODUCT_TYPE_FIELD = "product_type";
const DEFAULT_SECTION_ORDER: MasterTemplateSectionKey[] = [
  "title",
  "product",
  "process",
  "install_spec",
  "terms",
  "pricing",
];

type NormalizedMasterTemplatePage = {
  id: string;
  title: string;
  order: number;
  coordsPageKey: string;
  sourcePdf?: { name: string; url: string };
  sourcePage: number;
  inclusionMode: MasterTemplateInclusionMode;
  conditionField?: string;
  conditionValue?: string;
  vendorKey?: string;
  sectionKey?: MasterTemplateSectionKey;
  isFallback: boolean;
  dataBindings: string[];
};

type NormalizedMasterTemplate = {
  pages: NormalizedMasterTemplatePage[];
  selection: {
    projectTypeField: string;
    productTypeField: string;
    sectionOrder: MasterTemplateSectionKey[];
  };
};

type TemplateAssembly = {
  templateBuffer: Buffer;
  renderPageKeys?: string[];
  derivedFieldValues?: Record<string, string>;
};

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
    const masterTemplate = normalizeMasterTemplate(body.masterTemplate);
    const hasMasterTemplatePages = masterTemplate.pages.length > 0;

    if (
      (!templatePdfUrl && !hasMasterTemplatePages) ||
      (!workbookUrl && !estimateUrl && !estimatePayload)
    ) {
      return NextResponse.json(
        {
          error:
            "Provide templatePdfUrl or masterTemplate pages and either workbookUrl or estimate data.",
        },
        { status: 400 }
      );
    }

    const templateBuffer = templatePdfUrl
      ? await downloadBuffer(templatePdfUrl, "Template PDF", {
          baseUrl: request.nextUrl.origin,
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
        })
      : null;

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
    let estimateDataForRules: Record<string, unknown> | null = null;
    let sourceValuesForRules: Record<string, unknown> = {};
    if (estimatePayload || estimateUrl) {
      const estimateData = estimatePayload
        ? estimatePayload
        : await downloadJson(estimateUrl, "Estimate JSON", {
            baseUrl: request.nextUrl.origin,
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
          });
      sourceValuesForRules = extractEstimateValues(estimateData);
      fieldValues = buildFieldValuesFromSourceValues(
        sourceValuesForRules,
        mappingConfig
      );
      estimateDataForRules =
        estimateData && typeof estimateData === "object"
          ? (estimateData as Record<string, unknown>)
          : null;
    } else {
      const workbookBuffer = await downloadBuffer(workbookUrl, "Workbook", {
        baseUrl: request.nextUrl.origin,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      });
      fieldValues = buildFieldValues(workbookBuffer, mappingConfig);
      sourceValuesForRules = { ...fieldValues };
    }

    let templateAssembly: TemplateAssembly | null = null;
    if (hasMasterTemplatePages) {
      templateAssembly = await assembleMasterTemplate({
        masterTemplate,
        fallbackTemplateBuffer: templateBuffer,
        baseUrl: request.nextUrl.origin,
        fieldValues,
        sourceValues: sourceValuesForRules,
        estimateData: estimateDataForRules,
      });
    } else if (templateBuffer) {
      templateAssembly = { templateBuffer };
    }

    if (!templateAssembly?.templateBuffer) {
      throw new Error("No template pages were available for generation.");
    }
    fieldValues = mergeMissingFieldValues(
      fieldValues,
      templateAssembly.derivedFieldValues ?? {}
    );

    const outputPdf = await stampPdf(
      templateAssembly.templateBuffer,
      coordsConfig,
      fieldValues,
      request.nextUrl.origin,
      templateAssembly.renderPageKeys
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

function buildFieldValuesFromSourceValues(
  sourceValues: Record<string, unknown>,
  mappingConfig: any
) {
  const missingValue = mappingConfig.missing_value ?? "";
  const preparedByMap = mappingConfig.prepared_by_map ?? {};
  const fieldSpecs = (mappingConfig.fields ?? {}) as Record<
    string,
    { sheet?: string; cell?: string; format?: string }
  >;

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

function normalizeMasterTemplate(value: unknown): NormalizedMasterTemplate {
  const source =
    value && typeof value === "object"
      ? (value as {
          pages?: unknown;
          selection?: unknown;
          projectTypeField?: unknown;
          productTypeField?: unknown;
          sectionOrder?: unknown;
        })
      : null;
  const rawPages = source?.pages;
  const pages = Array.isArray(rawPages)
    ? (rawPages
        .map((entry, index) => normalizeMasterTemplatePage(entry, index))
        .filter(Boolean) as NormalizedMasterTemplatePage[])
    : [];
  return {
    pages,
    selection: normalizeMasterTemplateSelection(source),
  };
}

function normalizeMasterTemplatePage(value: unknown, index: number) {
  if (!value || typeof value !== "object") return null;
  const page = value as Record<string, unknown>;
  const sourcePdf =
    page.sourcePdf && typeof page.sourcePdf === "object"
      ? (page.sourcePdf as Record<string, unknown>)
      : null;
  const sourceUrl = String(sourcePdf?.url ?? "").trim();

  return {
    id: String(page.id ?? `page-${index + 1}`).trim() || `page-${index + 1}`,
    title: String(page.title ?? `Page ${index + 1}`).trim() || `Page ${index + 1}`,
    order: Number(page.order ?? index + 1),
    coordsPageKey:
      String(page.coordsPageKey ?? toPageKey(index + 1)).trim() ||
      toPageKey(index + 1),
    sourcePdf: sourceUrl
      ? { name: String(sourcePdf?.name ?? "template.pdf"), url: sourceUrl }
      : undefined,
    sourcePage: Math.max(1, Math.trunc(Number(page.sourcePage ?? 1) || 1)),
    inclusionMode: normalizeInclusionMode(page.inclusionMode),
    conditionField: String(page.conditionField ?? "").trim() || undefined,
    conditionValue: String(page.conditionValue ?? "").trim() || undefined,
    vendorKey: String(page.vendorKey ?? "").trim() || undefined,
    sectionKey: normalizeSectionKey(page.sectionKey),
    isFallback: page.isFallback === true,
    dataBindings: Array.isArray(page.dataBindings)
      ? page.dataBindings
          .map((binding) => String(binding ?? "").trim())
          .filter(Boolean)
      : [],
  } satisfies NormalizedMasterTemplatePage;
}

function normalizeInclusionMode(value: unknown): MasterTemplateInclusionMode {
  const normalized = String(value ?? "always").trim().toLowerCase();
  if (normalized === "project_type") return "project_type";
  if (normalized === "product_type") return "product_type";
  if (normalized === "product") return "product";
  if (normalized === "vendor") return "vendor";
  if (normalized === "field") return "field";
  return "always";
}

function normalizeSectionKey(value: unknown): MasterTemplateSectionKey | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "title") return "title";
  if (normalized === "product") return "product";
  if (normalized === "process") return "process";
  if (normalized === "install_spec") return "install_spec";
  if (normalized === "terms") return "terms";
  if (normalized === "pricing") return "pricing";
  if (normalized === "custom") return "custom";
  return undefined;
}

function normalizeMasterTemplateSelection(source: {
  selection?: unknown;
  projectTypeField?: unknown;
  productTypeField?: unknown;
  sectionOrder?: unknown;
} | null) {
  const selectionSource =
    source?.selection && typeof source.selection === "object"
      ? (source.selection as Record<string, unknown>)
      : {};
  const projectTypeField = String(
    selectionSource.projectTypeField ?? source?.projectTypeField ?? ""
  ).trim();
  const productTypeField = String(
    selectionSource.productTypeField ?? source?.productTypeField ?? ""
  ).trim();
  return {
    projectTypeField: projectTypeField || DEFAULT_PROJECT_TYPE_FIELD,
    productTypeField: productTypeField || DEFAULT_PRODUCT_TYPE_FIELD,
    sectionOrder: normalizeSectionOrder(
      selectionSource.sectionOrder ?? source?.sectionOrder
    ),
  };
}

function normalizeSectionOrder(value: unknown): MasterTemplateSectionKey[] {
  const seen = new Set<MasterTemplateSectionKey>();
  const normalized: MasterTemplateSectionKey[] = [];
  const source = Array.isArray(value) ? value : DEFAULT_SECTION_ORDER;
  source.forEach((entry) => {
    const section = normalizeSectionKey(entry);
    if (!section || section === "custom" || seen.has(section)) return;
    seen.add(section);
    normalized.push(section);
  });
  DEFAULT_SECTION_ORDER.forEach((section) => {
    if (seen.has(section)) return;
    seen.add(section);
    normalized.push(section);
  });
  return normalized;
}

async function assembleMasterTemplate({
  masterTemplate,
  fallbackTemplateBuffer,
  baseUrl,
  fieldValues,
  sourceValues,
  estimateData,
}: {
  masterTemplate: NormalizedMasterTemplate;
  fallbackTemplateBuffer: Buffer | null;
  baseUrl: string;
  fieldValues: Record<string, string>;
  sourceValues: Record<string, unknown>;
  estimateData: Record<string, unknown> | null;
}): Promise<TemplateAssembly> {
  const sortedPages = masterTemplate.pages
    .slice()
    .sort((a, b) => a.order - b.order);

  const products = getEstimateProducts(estimateData);
  const projectTypeValue = resolveProjectTypeValue({
    fieldValues,
    sourceValues,
    estimateData,
    projectTypeField: masterTemplate.selection.projectTypeField,
  });
  const productTypeFallbackValues = resolveProductTypeFallbackValues({
    fieldValues,
    sourceValues,
    estimateData,
    productTypeField: masterTemplate.selection.productTypeField,
  });

  const matchContext = {
    fieldValues,
    sourceValues,
    estimateData,
    products,
    projectTypeValue,
    productTypeFallbackValues,
    selection: masterTemplate.selection,
  };

  const hasSectionDrivenPages = sortedPages.some(
    (page) => Boolean(page.sectionKey) && page.sectionKey !== "custom"
  );

  let selectedPages: NormalizedMasterTemplatePage[] = [];
  let selectedProduct: Record<string, unknown> | null = null;

  if (hasSectionDrivenPages) {
    const selectedBySection = selectMasterTemplatePagesBySection(
      sortedPages,
      matchContext
    );
    selectedPages = selectedBySection.pages;
    selectedProduct = selectedBySection.selectedProduct;
  } else {
    selectedPages = sortedPages.filter(
      (page) => evaluateMasterTemplatePageMatch(page, matchContext).matched
    );
  }

  if (!selectedPages.length) {
    if (!fallbackTemplateBuffer) {
      throw new Error("Master template rules excluded every page.");
    }
    return { templateBuffer: fallbackTemplateBuffer };
  }

  const derivedFieldValues = buildDerivedProductFieldValues({
    selectedProduct: selectedProduct ?? products[0] ?? null,
    fieldValues,
    sourceValues,
    estimateData,
    productTypeField: masterTemplate.selection.productTypeField,
    projectTypeField: masterTemplate.selection.projectTypeField,
    projectTypeValue,
  });

  const assembled = await PDFDocument.create();
  const downloadedTemplateCache = new Map<string, PDFDocument>();
  const fallbackTemplateDoc = fallbackTemplateBuffer
    ? await PDFDocument.load(fallbackTemplateBuffer)
    : null;
  const renderPageKeys: string[] = [];

  for (const page of selectedPages) {
    let sourceDoc: PDFDocument | null = null;
    if (page.sourcePdf?.url) {
      const cached = downloadedTemplateCache.get(page.sourcePdf.url);
      if (cached) {
        sourceDoc = cached;
      } else {
        const sourceBuffer = await downloadBuffer(
          page.sourcePdf.url,
          `Template page ${page.title}`,
          {
            baseUrl,
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
          }
        );
        sourceDoc = await PDFDocument.load(sourceBuffer);
        downloadedTemplateCache.set(page.sourcePdf.url, sourceDoc);
      }
    } else if (fallbackTemplateDoc) {
      sourceDoc = fallbackTemplateDoc;
    }

    if (!sourceDoc) continue;

    const sourcePageIndex = Math.min(
      Math.max(page.sourcePage - 1, 0),
      Math.max(sourceDoc.getPageCount() - 1, 0)
    );
    const copiedPages = await assembled.copyPages(sourceDoc, [sourcePageIndex]);
    const copiedPage = copiedPages[0];
    if (!copiedPage) continue;
    assembled.addPage(copiedPage);
    renderPageKeys.push(page.coordsPageKey);
  }

  if (!assembled.getPageCount()) {
    if (!fallbackTemplateBuffer) {
      throw new Error("Master template did not resolve to any pages.");
    }
    return { templateBuffer: fallbackTemplateBuffer, derivedFieldValues };
  }

  const buffer = Buffer.from(await assembled.save());
  return { templateBuffer: buffer, renderPageKeys, derivedFieldValues };
}

function selectMasterTemplatePagesBySection(
  pages: NormalizedMasterTemplatePage[],
  context: {
    fieldValues: Record<string, string>;
    sourceValues: Record<string, unknown>;
    estimateData: Record<string, unknown> | null;
    products: Record<string, unknown>[];
    projectTypeValue: string;
    productTypeFallbackValues: string[];
    selection: NormalizedMasterTemplate["selection"];
  }
) {
  const selected: NormalizedMasterTemplatePage[] = [];
  const selectedIds = new Set<string>();
  let selectedProduct: Record<string, unknown> | null = null;

  for (const sectionKey of context.selection.sectionOrder) {
    const candidates = pages.filter((page) => page.sectionKey === sectionKey);
    if (!candidates.length) continue;

    const picked = pickBestSectionPage(candidates, context);
    if (!picked || selectedIds.has(picked.page.id)) continue;
    selected.push(picked.page);
    selectedIds.add(picked.page.id);
    if (sectionKey === "product" && picked.match.matchedProduct) {
      selectedProduct = picked.match.matchedProduct;
    }
  }

  const customPages = pages.filter((page) => {
    const pageSection = page.sectionKey ?? "custom";
    if (pageSection !== "custom") return false;
    if (selectedIds.has(page.id)) return false;
    return evaluateMasterTemplatePageMatch(page, context).matched;
  });
  customPages.forEach((page) => {
    selected.push(page);
    selectedIds.add(page.id);
  });

  return { pages: selected, selectedProduct };
}

function pickBestSectionPage(
  candidates: NormalizedMasterTemplatePage[],
  context: {
    fieldValues: Record<string, string>;
    sourceValues: Record<string, unknown>;
    estimateData: Record<string, unknown> | null;
    products: Record<string, unknown>[];
    projectTypeValue: string;
    productTypeFallbackValues: string[];
    selection: NormalizedMasterTemplate["selection"];
  }
) {
  const evaluated = candidates.map((page) => ({
    page,
    match: evaluateMasterTemplatePageMatch(page, context),
  }));
  const matched = evaluated
    .filter((entry) => entry.match.matched)
    .sort((left, right) => {
      if (left.match.score !== right.match.score) {
        return right.match.score - left.match.score;
      }
      return left.page.order - right.page.order;
    });
  if (matched.length) return matched[0];

  const fallback = evaluated
    .filter(
      (entry) => entry.page.isFallback || entry.page.inclusionMode === "always"
    )
    .sort((left, right) => left.page.order - right.page.order);
  return fallback[0] ?? null;
}

function evaluateMasterTemplatePageMatch(
  page: NormalizedMasterTemplatePage,
  context: {
    fieldValues: Record<string, string>;
    sourceValues: Record<string, unknown>;
    estimateData: Record<string, unknown> | null;
    products: Record<string, unknown>[];
    projectTypeValue: string;
    productTypeFallbackValues: string[];
    selection: NormalizedMasterTemplate["selection"];
  }
): { matched: boolean; score: number; matchedProduct: Record<string, unknown> | null } {
  if (page.inclusionMode === "always") {
    return { matched: true, score: 1, matchedProduct: null };
  }

  if (page.inclusionMode === "project_type") {
    if (!page.conditionValue) {
      return { matched: true, score: 2, matchedProduct: null };
    }
    const matched = compareMatchTerms(context.projectTypeValue, page.conditionValue);
    return { matched, score: matched ? 3 : 0, matchedProduct: null };
  }

  if (page.inclusionMode === "field") {
    const fieldKey = page.conditionField || page.dataBindings[0];
    if (!fieldKey) {
      return { matched: true, score: 1, matchedProduct: null };
    }
    const fieldValue = resolveContextValue(context, fieldKey);
    if (!fieldValue.trim()) {
      return { matched: false, score: 0, matchedProduct: null };
    }
    if (!page.conditionValue) {
      return { matched: true, score: 2, matchedProduct: null };
    }
    const matched = compareMatchTerms(fieldValue, page.conditionValue);
    return { matched, score: matched ? 3 : 0, matchedProduct: null };
  }

  if (page.inclusionMode === "product_type" || page.inclusionMode === "product") {
    const query = page.conditionValue;
    if (!query) {
      return {
        matched: true,
        score: 2,
        matchedProduct: context.products[0] ?? null,
      };
    }
    const matchedProduct = findMatchingProduct(context.products, query, {
      productTypeField: context.selection.productTypeField,
      includeVendorTokens: false,
    });
    if (matchedProduct) {
      return { matched: true, score: 3, matchedProduct };
    }
    const fallbackMatched = context.productTypeFallbackValues.some((token) =>
      compareMatchTerms(token, query)
    );
    if (!context.products.length && !context.productTypeFallbackValues.length) {
      return {
        matched: true,
        score: 1,
        matchedProduct: null,
      };
    }
    return {
      matched: fallbackMatched,
      score: fallbackMatched ? 3 : 0,
      matchedProduct: context.products[0] ?? null,
    };
  }

  if (page.inclusionMode === "vendor") {
    const query = page.conditionValue || page.vendorKey;
    if (!query) {
      return {
        matched: true,
        score: 2,
        matchedProduct: context.products[0] ?? null,
      };
    }
    const matchedProduct = findMatchingProduct(context.products, query, {
      productTypeField: context.selection.productTypeField,
      includeVendorTokens: true,
    });
    if (!matchedProduct && !context.products.length) {
      return {
        matched: true,
        score: 1,
        matchedProduct: null,
      };
    }
    return {
      matched: Boolean(matchedProduct),
      score: matchedProduct ? 3 : 0,
      matchedProduct: matchedProduct ?? null,
    };
  }

  return { matched: true, score: 1, matchedProduct: null };
}

function resolveProjectTypeValue(context: {
  fieldValues: Record<string, string>;
  sourceValues: Record<string, unknown>;
  estimateData: Record<string, unknown> | null;
  projectTypeField: string;
}) {
  return (
    resolveContextValue(context, context.projectTypeField) ||
    resolveContextValue(context, DEFAULT_PROJECT_TYPE_FIELD) ||
    resolveContextValue(context, "info.project_type")
  );
}

function resolveProductTypeFallbackValues(context: {
  fieldValues: Record<string, string>;
  sourceValues: Record<string, unknown>;
  estimateData: Record<string, unknown> | null;
  productTypeField: string;
}) {
  const values = [
    resolveContextValue(context, context.productTypeField),
    resolveContextValue(context, DEFAULT_PRODUCT_TYPE_FIELD),
    resolveContextValue(context, "info.product_type"),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function resolveContextValue(
  context: {
    fieldValues: Record<string, string>;
    sourceValues: Record<string, unknown>;
    estimateData: Record<string, unknown> | null;
  },
  key: string
) {
  const normalizedKey = String(key ?? "").trim();
  if (!normalizedKey) return "";

  const directFieldValue = context.fieldValues[normalizedKey];
  if (typeof directFieldValue === "string" && directFieldValue.trim()) {
    return directFieldValue;
  }

  const sourceDirect = stringifyUnknown(context.sourceValues[normalizedKey]).trim();
  if (sourceDirect) return sourceDirect;

  const sourceByPath = stringifyUnknown(
    readValueByPath(context.sourceValues, normalizedKey)
  ).trim();
  if (sourceByPath) return sourceByPath;

  const estimateDirect = context.estimateData
    ? stringifyUnknown(context.estimateData[normalizedKey]).trim()
    : "";
  if (estimateDirect) return estimateDirect;

  const estimateByPath = context.estimateData
    ? stringifyUnknown(readValueByPath(context.estimateData, normalizedKey)).trim()
    : "";
  return estimateByPath;
}

function readValueByPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== "object") return undefined;
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return undefined;

  let current: unknown = source;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return undefined;
    if (!(segment in (current as Record<string, unknown>))) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function findMatchingProduct(
  products: Record<string, unknown>[],
  query: string,
  options: {
    productTypeField: string;
    includeVendorTokens: boolean;
  }
) {
  for (const product of products) {
    const tokens = getProductSearchTokens(product, {
      productTypeField: options.productTypeField,
      includeVendorTokens: options.includeVendorTokens,
    });
    if (tokens.some((token) => compareMatchTerms(token, query))) {
      return product;
    }
  }
  return null;
}

function getEstimateProducts(estimateData: Record<string, unknown> | null) {
  if (!estimateData) return [] as Record<string, unknown>[];
  const rawProducts = estimateData.products;
  if (!Array.isArray(rawProducts)) return [] as Record<string, unknown>[];
  return rawProducts.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function getProductSearchTokens(
  product: Record<string, unknown>,
  options: {
    productTypeField: string;
    includeVendorTokens: boolean;
  }
) {
  const typeToken =
    stringifyUnknown(readValueByPath(product, options.productTypeField)) ||
    stringifyUnknown(product.product_type);
  const coreTokens = [
    typeToken,
    stringifyUnknown(product.name),
    stringifyUnknown(product.product),
    stringifyUnknown(product.sku),
  ];
  const vendorTokens = options.includeVendorTokens
    ? [
        stringifyUnknown(product.vendorId),
        stringifyUnknown(product.vendor),
        stringifyUnknown(product.manufacturer),
        stringifyUnknown(product.supplier),
      ]
    : [];
  return [...coreTokens, ...vendorTokens]
    .map((token) => token.trim())
    .filter(Boolean);
}

function compareMatchTerms(value: string, query: string) {
  const queryTerms = splitMatchTerms(query);
  if (!queryTerms.length) return true;
  return queryTerms.some((term) => compareContains(value, term));
}

function splitMatchTerms(value: string) {
  return value
    .split(/[\n,|]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildDerivedProductFieldValues({
  selectedProduct,
  fieldValues,
  sourceValues,
  estimateData,
  productTypeField,
  projectTypeField,
  projectTypeValue,
}: {
  selectedProduct: Record<string, unknown> | null;
  fieldValues: Record<string, string>;
  sourceValues: Record<string, unknown>;
  estimateData: Record<string, unknown> | null;
  productTypeField: string;
  projectTypeField: string;
  projectTypeValue: string;
}) {
  const derived: Record<string, string> = {};
  if (projectTypeValue.trim()) {
    derived.project_type = projectTypeValue;
    derived.selected_project_type = projectTypeValue;
  }

  const selectedTypeFromContext =
    resolveContextValue({ fieldValues, sourceValues, estimateData }, productTypeField) ||
    resolveContextValue(
      { fieldValues, sourceValues, estimateData },
      DEFAULT_PRODUCT_TYPE_FIELD
    );

  if (selectedProduct) {
    const productType =
      stringifyUnknown(readValueByPath(selectedProduct, productTypeField)) ||
      stringifyUnknown(selectedProduct.product_type) ||
      stringifyUnknown(selectedProduct.name) ||
      selectedTypeFromContext;
    const productName =
      stringifyUnknown(selectedProduct.name) ||
      stringifyUnknown(selectedProduct.product) ||
      productType;

    derived.product_type = productType;
    derived.selected_product_type = productType;
    derived.selected_product_name = productName;
    derived.selected_product_vendor =
      stringifyUnknown(selectedProduct.vendor) ||
      stringifyUnknown(selectedProduct.vendorId) ||
      stringifyUnknown(selectedProduct.manufacturer) ||
      "";
    derived.selected_product_vendor_id = stringifyUnknown(selectedProduct.vendorId);
    derived.selected_product_price = stringifyUnknown(selectedProduct.price);

    Object.entries(selectedProduct).forEach(([key, value]) => {
      const token = stringifyUnknown(value);
      if (!token.trim()) return;
      derived[`selected_product_${normalizeFieldKey(key)}`] = token;
    });
  } else if (selectedTypeFromContext) {
    derived.product_type = selectedTypeFromContext;
    derived.selected_product_type = selectedTypeFromContext;
  }

  return derived;
}

function normalizeFieldKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)+/g, "");
}

function mergeMissingFieldValues(
  source: Record<string, string>,
  extra: Record<string, string>
) {
  const next = { ...source };
  Object.entries(extra).forEach(([key, value]) => {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey) return;
    const normalizedValue = String(value ?? "").trim();
    if (!normalizedValue) return;
    if (next[normalizedKey] && next[normalizedKey].trim()) return;
    next[normalizedKey] = normalizedValue;
  });
  return next;
}

function stringifyUnknown(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function compareContains(value: string, query: string) {
  const left = value.trim().toLowerCase();
  const right = query.trim().toLowerCase();
  if (!right) return true;
  return left.includes(right);
}

// formatting helpers moved to lib/formatting

async function stampPdf(
  templateBuffer: Buffer,
  coordsConfig: Record<string, any>,
  fieldValues: Record<string, string>,
  baseUrl: string,
  renderPageKeys?: string[]
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

  const stampPlan = renderPageKeys?.length
    ? renderPageKeys.map((pageKey, index) => ({ pageKey, pageIndex: index }))
    : getSortedPageKeys(coordsConfig)
        .map((pageKey) => {
          const pageNumber = parsePageKey(pageKey);
          if (!pageNumber) return null;
          return { pageKey, pageIndex: pageNumber - 1 };
        })
        .filter(Boolean) as Array<{ pageKey: string; pageIndex: number }>;

  for (const planEntry of stampPlan) {
    const page = pages[planEntry.pageIndex];
    if (!page) continue;

    const fields = getPageFields(coordsConfig, planEntry.pageKey) as Record<
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
