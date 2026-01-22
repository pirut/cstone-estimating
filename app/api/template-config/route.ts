import { NextRequest, NextResponse } from "next/server";
import { UTApi, UTFile } from "uploadthing/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const utapi = new UTApi();

type TemplatePayload = {
  name?: string;
  description?: string;
  templatePdf?: { name?: string; url?: string };
  coords?: Record<string, any>;
  mapping?: Record<string, any>;
};

type TemplateConfig = {
  version: number;
  id: string;
  name: string;
  description?: string;
  templatePdf: { name: string; url: string };
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
    if (!templatePdf?.url) {
      return NextResponse.json(
        { error: "Template PDF URL is required." },
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
    const id = slugify(name);
    const config: TemplateConfig = {
      version: 1,
      id,
      name,
      description: description || undefined,
      templatePdf: {
        name: String(templatePdf.name ?? "template.pdf"),
        url: templatePdf.url,
      },
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
        name: fileResult.name,
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
