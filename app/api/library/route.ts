import { NextRequest, NextResponse } from "next/server";
import { UTApi } from "uploadthing/server";

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

    const allFiles = await listAllFiles();
    const filtered = allFiles.filter((file) =>
      file.customId?.startsWith(prefix)
    );
    filtered.sort((a, b) => b.uploadedAt - a.uploadedAt);

    const urlMap = await getUrlMap(filtered.map((file) => file.key));
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

function stripTemplateVersionSuffixes(name: string) {
  return name.replace(/(?:\s*\(v\d+\))+$/gi, "").trim();
}

function formatTemplateDisplayName(name: string, templateVersion?: number) {
  const baseName = stripTemplateVersionSuffixes(name);
  if (
    typeof templateVersion === "number" &&
    Number.isFinite(templateVersion) &&
    templateVersion > 0
  ) {
    return `${baseName} (v${Math.trunc(templateVersion)})`;
  }
  return baseName;
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

    const allFiles = await listAllFiles();
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

async function getUrlMap(keys: string[]) {
  const urlMap = new Map<string, string>();
  const chunks = chunk(keys, 100);

  for (const chunkKeys of chunks) {
    if (chunkKeys.length === 0) continue;
    const response = await utapi.getFileUrls(chunkKeys);
    for (const item of response.data) {
      urlMap.set(item.key, item.url);
    }
  }

  return urlMap;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
