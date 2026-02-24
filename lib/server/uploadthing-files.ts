import type { UTApi } from "uploadthing/server";

const DEFAULT_LIST_LIMIT = 100;
const DEFAULT_MAX_LIST = 1000;

export type ListedUploadThingFile = Awaited<
  ReturnType<UTApi["listFiles"]>
>["files"][number];

export async function listAllUploadThingFiles(
  utapi: UTApi,
  options?: {
    limit?: number;
    maxList?: number;
  }
) {
  const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
  const maxList = options?.maxList ?? DEFAULT_MAX_LIST;
  const results: ListedUploadThingFile[] = [];
  let offset = 0;

  while (offset < maxList) {
    const response = await utapi.listFiles({ limit, offset });
    results.push(...response.files);
    if (!response.hasMore || response.files.length === 0) {
      break;
    }
    offset += response.files.length;
  }

  return results;
}

export async function getUploadThingUrlMap(
  utapi: UTApi,
  keys: string[],
  chunkSize = 100
) {
  const urlMap = new Map<string, string>();
  const chunks = chunk(keys, chunkSize);

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
