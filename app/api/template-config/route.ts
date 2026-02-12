import { NextRequest, NextResponse } from "next/server";
import { UTApi, UTFile } from "uploadthing/server";
import type {
  MasterTemplateConfig,
  MasterTemplateInclusionMode,
  MasterTemplatePage,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const utapi = new UTApi();

type TemplatePayload = {
  name?: string;
  templateVersion?: unknown;
  description?: string;
  templatePdf?: { name?: string; url?: string };
  masterTemplate?: unknown;
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
    const hasTemplatePdf = Boolean(templatePdf?.url);
    const hasMasterTemplatePages =
      normalizedMasterTemplate.pages.length > 0;
    if (!hasTemplatePdf && !hasMasterTemplatePages) {
      return NextResponse.json(
        {
          error:
            "Provide either a template PDF URL or at least one master template page.",
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
      version: hasMasterTemplatePages ? 2 : 1,
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

function normalizeMasterTemplate(value: unknown): MasterTemplateConfig {
  const source =
    value && typeof value === "object"
      ? (value as { pages?: unknown }).pages
      : null;
  if (!Array.isArray(source)) {
    return { version: 1, pages: [] };
  }

  const pages: MasterTemplatePage[] = source
    .map((entry, index) => normalizeMasterTemplatePage(entry, index))
    .filter(Boolean) as MasterTemplatePage[];

  return {
    version: 1,
    pages,
  };
}

function normalizeMasterTemplatePage(value: unknown, index: number) {
  if (!value || typeof value !== "object") return null;
  const page = value as Record<string, unknown>;
  const rawMode = String(page.inclusionMode ?? "always").trim().toLowerCase();
  const inclusionMode = (
    ["always", "product", "vendor", "field"].includes(rawMode)
      ? rawMode
      : "always"
  ) as MasterTemplateInclusionMode;

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
    dataBindings: dataBindings.length ? dataBindings : undefined,
    notes: String(page.notes ?? "").trim() || undefined,
  } satisfies MasterTemplatePage;
}
