import { NextRequest, NextResponse } from "next/server";
import { UTApi, UTFile } from "uploadthing/server";
import type { TemplateConfig } from "@/lib/types";
import {
  normalizeMasterTemplate,
  normalizePandaDocTemplate,
  normalizeTemplateVersion,
  slugify,
} from "@/lib/server/template-config-normalization";
import { listAllUploadThingFiles } from "@/lib/server/uploadthing-files";

export const runtime = "nodejs";
export const maxDuration = 30;

const utapi = new UTApi();
const LIST_LIMIT = 100;
const MAX_LIST = 1000;
const TEMPLATE_CONFIG_PREFIX = "template-config:";

type TemplatePayload = {
  name?: string;
  templateVersion?: unknown;
  description?: string;
  templatePdf?: { name?: string; url?: string };
  masterTemplate?: unknown;
  pandadoc?: unknown;
  coords?: Record<string, unknown>;
  mapping?: Record<string, unknown>;
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
    const hasMasterTemplatePages = normalizedMasterTemplate.pages.length > 0;
    const hasPandaDocTemplate = Boolean(normalizedPandaDocTemplate?.templateUuid);
    const hasPandaDocRules = Boolean(normalizedPandaDocTemplate?.rules?.length);

    if (
      !hasTemplatePdf &&
      !hasMasterTemplatePages &&
      !hasPandaDocTemplate &&
      !hasPandaDocRules
    ) {
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
      version:
        hasPandaDocTemplate || hasPandaDocRules ? 3 : hasMasterTemplatePages ? 2 : 1,
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
      customId: `${TEMPLATE_CONFIG_PREFIX}${Date.now()}-${id || "template"}`,
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

async function deleteOtherTemplateConfigs(activeKey: string) {
  const files = await listAllUploadThingFiles(utapi, {
    limit: LIST_LIMIT,
    maxList: MAX_LIST,
  });
  const oldKeys = files
    .filter(
      (file) =>
        file.customId?.startsWith(TEMPLATE_CONFIG_PREFIX) && file.key !== activeKey
    )
    .map((file) => file.key);
  if (!oldKeys.length) return;
  await utapi.deleteFiles(oldKeys);
}
