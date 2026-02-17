import { NextRequest, NextResponse } from "next/server";
import { UTApi, UTFile } from "uploadthing/server";
import type {
  MasterTemplateConfig,
  MasterTemplateInclusionMode,
  MasterTemplatePage,
  MasterTemplateSectionKey,
  MasterTemplateSelectionConfig,
  PandaDocBindingTargetType,
  PandaDocTemplateBinding,
  PandaDocTemplateConfig,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const utapi = new UTApi();
const LIST_LIMIT = 100;
const MAX_LIST = 1000;
const TEMPLATE_CONFIG_PREFIX = "template-config:";
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

type TemplatePayload = {
  name?: string;
  templateVersion?: unknown;
  description?: string;
  templatePdf?: { name?: string; url?: string };
  masterTemplate?: unknown;
  pandadoc?: unknown;
  coords?: Record<string, any>;
  mapping?: Record<string, any>;
};

type TemplateConfig = {
  version: number;
  id: string;
  name: string;
  templateVersion: number;
  description?: string;
  templatePdf?: { name: string; url: string };
  masterTemplate?: MasterTemplateConfig;
  pandadoc?: PandaDocTemplateConfig;
  coords: Record<string, any>;
  mapping?: Record<string, any>;
  createdAt: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TemplatePayload;
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Template name is required." }, { status: 400 });
    }

    const templatePdf = body.templatePdf;
    const normalizedMasterTemplate = normalizeMasterTemplate(body.masterTemplate);
    const normalizedPandaDocTemplate = normalizePandaDocTemplate(body.pandadoc);
    const hasTemplatePdf = Boolean(templatePdf?.url);
    const hasMasterTemplatePages =
      normalizedMasterTemplate.pages.length > 0;
    const hasPandaDocTemplate = Boolean(normalizedPandaDocTemplate?.templateUuid);
    if (!hasTemplatePdf && !hasMasterTemplatePages && !hasPandaDocTemplate) {
      return NextResponse.json(
        {
          error:
            "Provide either a template PDF URL, master template pages, or PandaDoc template settings.",
        },
        { status: 400 }
      );
    }

    const coords = body.coords;
    if (!coords || typeof coords !== "object") {
      return NextResponse.json(
        { error: "Coordinates config is required." },
        { status: 400 }
      );
    }

    const mapping =
      body.mapping && typeof body.mapping === "object" ? body.mapping : undefined;
    const description = String(body.description ?? "").trim();
    const templateVersion = normalizeTemplateVersion(body.templateVersion);
    const id = slugify(name);
    const config: TemplateConfig = {
      version: hasPandaDocTemplate ? 3 : hasMasterTemplatePages ? 2 : 1,
      id,
      name,
      templateVersion,
      description: description || undefined,
      templatePdf: hasTemplatePdf
        ? {
            name: String(templatePdf?.name ?? "template.pdf"),
            url: String(templatePdf?.url),
          }
        : undefined,
      masterTemplate: hasMasterTemplatePages ? normalizedMasterTemplate : undefined,
      pandadoc: normalizedPandaDocTemplate,
      coords,
      mapping,
      createdAt: new Date().toISOString(),
    };

    const filename = `${id || "template"}-${Date.now()}.json`;
    const file = new UTFile([JSON.stringify(config, null, 2)], filename, {
      customId: `template-config:${Date.now()}-${id || "template"}`,
      type: "application/json",
    });

    const uploaded = await utapi.uploadFiles(file);
    const fileResult = Array.isArray(uploaded) ? uploaded[0] : uploaded;
    if (fileResult?.key) {
      await deleteOtherTemplateConfigs(fileResult.key);
    }
    return NextResponse.json({
      item: {
        key: fileResult.key,
        name: config.name,
        url: fileResult.ufsUrl ?? fileResult.url,
      },
      template: config,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function slugify(value: string) {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 48);
  return safe || "template";
}

function normalizeTemplateVersion(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.trunc(parsed);
}

async function deleteOtherTemplateConfigs(activeKey: string) {
  const files = await listAllFiles();
  const oldKeys = files
    .filter(
      (file) =>
        file.customId?.startsWith(TEMPLATE_CONFIG_PREFIX) && file.key !== activeKey
    )
    .map((file) => file.key);
  if (!oldKeys.length) return;
  await utapi.deleteFiles(oldKeys);
}

type ListedFile = Awaited<ReturnType<typeof utapi.listFiles>>["files"][number];

async function listAllFiles() {
  const results: ListedFile[] = [];
  let offset = 0;

  while (offset < MAX_LIST) {
    const response = await utapi.listFiles({ limit: LIST_LIMIT, offset });
    results.push(...response.files);
    if (!response.hasMore || response.files.length === 0) {
      break;
    }
    offset += response.files.length;
  }

  return results;
}

function normalizeMasterTemplate(value: unknown): MasterTemplateConfig {
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

function normalizePandaDocTemplate(value: unknown): PandaDocTemplateConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const templateUuid = String(source.templateUuid ?? "").trim();
  const templateName = String(source.templateName ?? "").trim();
  const recipientRole = String(source.recipientRole ?? "").trim();
  const bindings = normalizePandaDocBindings(source.bindings);

  if (!templateUuid && !bindings.length && !recipientRole) {
    return undefined;
  }

  return {
    templateUuid,
    templateName: templateName || undefined,
    recipientRole: recipientRole || undefined,
    bindings,
  };
}

function normalizePandaDocBindings(value: unknown): PandaDocTemplateBinding[] {
  if (!Array.isArray(value)) return [];
  const normalized: PandaDocTemplateBinding[] = [];
  const seen = new Set<string>();

  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const binding = entry as Record<string, unknown>;
    const sourceKey = String(binding.sourceKey ?? "").trim();
    const targetName = String(binding.targetName ?? "").trim();
    if (!sourceKey || !targetName) return;
    const targetType = normalizePandaDocTargetType(binding.targetType);
    const role = String(binding.role ?? "").trim() || undefined;
    const targetFieldType = String(binding.targetFieldType ?? "").trim() || undefined;
    const dedupeKey = `${sourceKey}|${targetType}|${targetName}|${role ?? ""}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push({
      id: String(binding.id ?? `binding-${index + 1}`).trim() || `binding-${index + 1}`,
      sourceKey,
      targetType,
      targetName,
      targetFieldType,
      role,
    });
  });

  return normalized;
}

function normalizePandaDocTargetType(value: unknown): PandaDocBindingTargetType {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "field" ? "field" : "token";
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
