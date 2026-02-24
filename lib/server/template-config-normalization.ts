import type {
  MasterTemplateConfig,
  MasterTemplateInclusionMode,
  MasterTemplatePage,
  MasterTemplateSectionKey,
  MasterTemplateSelectionConfig,
  PandaDocTemplateConfig,
  PandaDocTemplateRule,
} from "@/lib/types";
import { normalizePandaDocBindings } from "@/lib/server/pandadoc-input";

const DEFAULT_PROJECT_TYPE_FIELD = "project_type";
const DEFAULT_PRODUCT_TYPE_FIELD = "product_type";
const DEFAULT_PROJECT_TYPES = ["New Construction", "Replacement", "Remodel"];
const DEFAULT_SECTION_ORDER: MasterTemplateSectionKey[] = [
  "title",
  "product",
  "process",
  "install_spec",
  "terms",
  "pricing",
];

export function slugify(value: string) {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 48);
  return safe || "template";
}

export function normalizeTemplateVersion(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.trunc(parsed);
}

export function normalizeMasterTemplate(value: unknown): MasterTemplateConfig {
  const sourceObject =
    value && typeof value === "object"
      ? (value as {
          pages?: unknown;
          selection?: unknown;
          projectTypeField?: unknown;
          productTypeField?: unknown;
          projectTypes?: unknown;
          sectionOrder?: unknown;
        })
      : null;
  const source = sourceObject?.pages;
  if (!Array.isArray(source)) {
    return {
      version: 2,
      selection: {
        projectTypeField: DEFAULT_PROJECT_TYPE_FIELD,
        productTypeField: DEFAULT_PRODUCT_TYPE_FIELD,
        projectTypes: DEFAULT_PROJECT_TYPES,
        sectionOrder: DEFAULT_SECTION_ORDER,
      },
      pages: [],
    };
  }

  const pages: MasterTemplatePage[] = source
    .map((entry, index) => normalizeMasterTemplatePage(entry, index))
    .filter(Boolean) as MasterTemplatePage[];

  const selection = normalizeMasterTemplateSelection(sourceObject);

  return {
    version: 2,
    selection,
    pages,
  };
}

export function normalizePandaDocTemplate(
  value: unknown
): PandaDocTemplateConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const templateUuid = String(source.templateUuid ?? "").trim();
  const templateName = String(source.templateName ?? "").trim();
  const recipientRole = String(source.recipientRole ?? "").trim();
  const bindings = normalizePandaDocBindings(source.bindings, { dedupe: true });
  const rules = normalizePandaDocRules(source.rules);

  if (!templateUuid && !bindings.length && !recipientRole && !rules.length) {
    return undefined;
  }

  return {
    templateUuid,
    templateName: templateName || undefined,
    recipientRole: recipientRole || undefined,
    bindings,
    rules: rules.length ? rules : undefined,
  };
}

function normalizePandaDocRules(value: unknown): PandaDocTemplateRule[] {
  if (!Array.isArray(value)) return [];
  const normalized: PandaDocTemplateRule[] = [];
  const seen = new Set<string>();

  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const rule = entry as Record<string, unknown>;
    const templateUuid = String(rule.templateUuid ?? "").trim();
    if (!templateUuid) return;
    const vendorId = String(rule.vendorId ?? "").trim() || undefined;
    const vendorName = String(rule.vendorName ?? "").trim() || undefined;
    const projectType = String(rule.projectType ?? "").trim() || undefined;
    const dedupeKey = `${vendorId ?? ""}|${vendorName ?? ""}|${projectType ?? ""}|${templateUuid}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push({
      id: String(rule.id ?? `rule-${index + 1}`).trim() || `rule-${index + 1}`,
      vendorId,
      vendorName,
      projectType,
      templateUuid,
      templateName: String(rule.templateName ?? "").trim() || undefined,
      recipientRole: String(rule.recipientRole ?? "").trim() || undefined,
      isActive: rule.isActive !== false,
    });
  });

  return normalized;
}

function normalizeMasterTemplatePage(value: unknown, index: number) {
  if (!value || typeof value !== "object") return null;
  const page = value as Record<string, unknown>;
  const inclusionMode = normalizeInclusionMode(page.inclusionMode);
  const sectionKey = normalizeSectionKey(page.sectionKey, index);

  const sourcePdf =
    page.sourcePdf && typeof page.sourcePdf === "object"
      ? (page.sourcePdf as Record<string, unknown>)
      : null;
  const sourceUrl = String(sourcePdf?.url ?? "").trim();
  const sourceName = String(sourcePdf?.name ?? "template.pdf").trim();
  const sourcePage = Number(page.sourcePage ?? 1);
  const dataBindings = Array.isArray(page.dataBindings)
    ? page.dataBindings
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    : [];

  return {
    id: String(page.id ?? `page-${index + 1}`).trim() || `page-${index + 1}`,
    title: String(page.title ?? `Page ${index + 1}`).trim() || `Page ${index + 1}`,
    order: Number(page.order ?? index + 1),
    coordsPageKey:
      String(page.coordsPageKey ?? `page_${index + 1}`).trim() ||
      `page_${index + 1}`,
    sourcePdf: sourceUrl ? { name: sourceName, url: sourceUrl } : undefined,
    sourcePage:
      Number.isFinite(sourcePage) && sourcePage > 0
        ? Math.trunc(sourcePage)
        : 1,
    inclusionMode,
    conditionField: String(page.conditionField ?? "").trim() || undefined,
    conditionValue: String(page.conditionValue ?? "").trim() || undefined,
    vendorKey: String(page.vendorKey ?? "").trim() || undefined,
    sectionKey,
    isFallback: page.isFallback === true,
    dataBindings: dataBindings.length ? dataBindings : undefined,
    notes: String(page.notes ?? "").trim() || undefined,
  } satisfies MasterTemplatePage;
}

function normalizeMasterTemplateSelection(source: {
  selection?: unknown;
  projectTypeField?: unknown;
  productTypeField?: unknown;
  projectTypes?: unknown;
  sectionOrder?: unknown;
} | null): MasterTemplateSelectionConfig {
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
  const projectTypes = normalizeProjectTypes(
    selectionSource.projectTypes ?? source?.projectTypes
  );
  const sectionOrder = normalizeSectionOrder(
    selectionSource.sectionOrder ?? source?.sectionOrder
  );

  return {
    projectTypeField: projectTypeField || DEFAULT_PROJECT_TYPE_FIELD,
    productTypeField: productTypeField || DEFAULT_PRODUCT_TYPE_FIELD,
    projectTypes,
    sectionOrder,
  };
}

function normalizeProjectTypes(value: unknown): string[] {
  const source = Array.isArray(value) ? value : DEFAULT_PROJECT_TYPES;
  const seen = new Set<string>();
  const normalized: string[] = [];
  source.forEach((entry) => {
    const projectType = String(entry ?? "").trim();
    if (!projectType || seen.has(projectType)) return;
    seen.add(projectType);
    normalized.push(projectType);
  });
  if (normalized.length) return normalized;
  return DEFAULT_PROJECT_TYPES.slice();
}

function normalizeSectionOrder(value: unknown): MasterTemplateSectionKey[] {
  const seen = new Set<MasterTemplateSectionKey>();
  const normalized: MasterTemplateSectionKey[] = [];
  const source = Array.isArray(value) ? value : DEFAULT_SECTION_ORDER;
  source.forEach((entry) => {
    const section = normalizeSectionKey(entry, -1);
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

function normalizeSectionKey(
  value: unknown,
  fallbackIndex: number
): MasterTemplateSectionKey {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "title") return "title";
  if (normalized === "product") return "product";
  if (normalized === "process") return "process";
  if (normalized === "install_spec") return "install_spec";
  if (normalized === "terms") return "terms";
  if (normalized === "pricing") return "pricing";
  if (normalized === "custom") return "custom";
  if (fallbackIndex >= 0 && fallbackIndex < DEFAULT_SECTION_ORDER.length) {
    return DEFAULT_SECTION_ORDER[fallbackIndex];
  }
  return "custom";
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
