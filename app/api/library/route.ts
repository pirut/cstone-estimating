import { NextRequest, NextResponse } from "next/server";
import { UTApi } from "uploadthing/server";
import {
  getUploadThingUrlMap,
  listAllUploadThingFiles,
} from "@/lib/server/uploadthing-files";
import { formatTemplateDisplayName } from "@/lib/template-display";

export const runtime = "nodejs";
export const maxDuration = 30;

const utapi = new UTApi();
const LIST_LIMIT = 100;
const MAX_LIST = 1000;

const TYPE_PREFIX: Record<string, string> = {
  workbook: "workbook:",
  template: "template:",
  mapping: "mapping:",
  coordinates: "coordinates:",
  template_config: "template-config:",
  estimate: "estimate:",
};

type LibraryItem = {
  key: string;
  name: string;
  uploadedAt: number;
  url: string;
};

export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get("type") ?? "";
    const prefix = TYPE_PREFIX[type];
    if (!prefix) {
      return NextResponse.json(
        {
          error:
            "Invalid type. Use 'workbook', 'template', 'mapping', 'coordinates', 'template_config', or 'estimate'.",
        },
        { status: 400 }
      );
    }

    const allFiles = await listAllUploadThingFiles(utapi, {
      limit: LIST_LIMIT,
      maxList: MAX_LIST,
    });
    const filtered = allFiles.filter((file) =>
      file.customId?.startsWith(prefix)
    );
    filtered.sort((a, b) => b.uploadedAt - a.uploadedAt);

    const urlMap = await getUploadThingUrlMap(
      utapi,
      filtered.map((file) => file.key)
    );
    const baseItems: LibraryItem[] = filtered.map((file) => ({
      key: file.key,
      name: file.name,
      uploadedAt: file.uploadedAt,
      url: urlMap.get(file.key) ?? "",
    }));
    const items =
      type === "template_config"
        ? await hydrateTemplateNames(baseItems)
        : baseItems;

    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function hydrateTemplateNames(items: LibraryItem[]) {
  const next = await Promise.all(
    items.map(async (item) => {
      const metadata = await readTemplateMetadata(item.url);
      if (!metadata?.name) return item;
      return {
        ...item,
        name: formatTemplateDisplayName(metadata.name, metadata.templateVersion),
      };
    })
  );
  return next;
}

async function readTemplateMetadata(url: string) {
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      name?: unknown;
      templateVersion?: unknown;
    };
    const value = typeof data?.name === "string" ? data.name.trim() : "";
    if (!value) return null;
    const version = Number(data?.templateVersion);
    return {
      name: value,
      templateVersion:
        Number.isFinite(version) && version > 0 ? Math.trunc(version) : undefined,
    };
  } catch {
    return null;
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get("type") ?? "";
    const prefix = TYPE_PREFIX[type];
    if (!prefix) {
      return NextResponse.json(
        {
          error:
            "Invalid type. Use 'workbook', 'template', 'mapping', 'coordinates', 'template_config', or 'estimate'.",
        },
        { status: 400 }
      );
    }

    const key = request.nextUrl.searchParams.get("key");
    if (key) {
      await utapi.deleteFiles([key]);
      return NextResponse.json({ deletedCount: 1 });
    }

    const allFiles = await listAllUploadThingFiles(utapi, {
      limit: LIST_LIMIT,
      maxList: MAX_LIST,
    });
    const keys = allFiles
      .filter((file) => file.customId?.startsWith(prefix))
      .map((file) => file.key);

    if (keys.length > 0) {
      await utapi.deleteFiles(keys);
    }

    return NextResponse.json({ deletedCount: keys.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
