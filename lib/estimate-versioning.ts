export type EstimateVersionAction =
  | "baseline"
  | "created"
  | "updated"
  | "generated"
  | "reverted";

export type EstimateVersionEntry = {
  id: string;
  version: number;
  action: EstimateVersionAction;
  createdAt: number;
  title: string;
  payload: Record<string, any> | null;
  totals?: Record<string, any> | null;
  templateName?: string;
  templateUrl?: string;
  createdByUserId?: string | null;
  sourceVersion?: number;
};

const MAX_VERSION_HISTORY = 200;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toPositiveInt(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function createVersionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ver_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeEstimateVersionHistory(
  rawHistory: unknown
): EstimateVersionEntry[] {
  if (!Array.isArray(rawHistory)) return [];

  const normalized: EstimateVersionEntry[] = [];
  for (const rawEntry of rawHistory) {
    if (!isRecord(rawEntry)) continue;
    const version = toPositiveInt(rawEntry.version);
    const createdAt = toPositiveInt(rawEntry.createdAt) ?? Date.now();
    const title = String(rawEntry.title ?? "").trim();
    if (!version || !title) continue;
    const actionRaw = String(rawEntry.action ?? "").trim().toLowerCase();
    const action: EstimateVersionAction =
      actionRaw === "created" ||
      actionRaw === "updated" ||
      actionRaw === "generated" ||
      actionRaw === "reverted"
        ? actionRaw
        : "baseline";

    normalized.push({
      id: String(rawEntry.id || createVersionId()),
      version,
      action,
      createdAt,
      title,
      payload: isRecord(rawEntry.payload)
        ? cloneJson(rawEntry.payload)
        : rawEntry.payload === null
          ? null
          : null,
      totals: isRecord(rawEntry.totals) ? cloneJson(rawEntry.totals) : null,
      templateName:
        typeof rawEntry.templateName === "string"
          ? rawEntry.templateName
          : undefined,
      templateUrl:
        typeof rawEntry.templateUrl === "string" ? rawEntry.templateUrl : undefined,
      createdByUserId:
        typeof rawEntry.createdByUserId === "string"
          ? rawEntry.createdByUserId
          : null,
      sourceVersion: toPositiveInt(rawEntry.sourceVersion) ?? undefined,
    });
  }

  normalized.sort((a, b) => {
    if (a.version !== b.version) return a.version - b.version;
    return a.createdAt - b.createdAt;
  });
  return normalized;
}

export function createBaselineEstimateVersion(input: {
  version?: number;
  createdAt?: number;
  title: string;
  payload: Record<string, any> | null;
  totals?: Record<string, any> | null;
  templateName?: string;
  templateUrl?: string;
  createdByUserId?: string | null;
}) {
  const version = toPositiveInt(input.version) ?? 1;
  return {
    id: createVersionId(),
    version,
    action: "baseline" as const,
    createdAt: toPositiveInt(input.createdAt) ?? Date.now(),
    title: input.title.trim() || "Untitled Estimate",
    payload: cloneJson(input.payload ?? null),
    totals: cloneJson(input.totals ?? null),
    templateName: input.templateName,
    templateUrl: input.templateUrl,
    createdByUserId: input.createdByUserId ?? null,
  };
}

export function appendEstimateVersion(
  rawHistory: unknown,
  input: {
    action: Exclude<EstimateVersionAction, "baseline">;
    createdAt?: number;
    title: string;
    payload: Record<string, any> | null;
    totals?: Record<string, any> | null;
    templateName?: string;
    templateUrl?: string;
    createdByUserId?: string | null;
    sourceVersion?: number;
  }
) {
  const history = normalizeEstimateVersionHistory(rawHistory);
  const latestVersion = history.length
    ? history[history.length - 1]?.version ?? 0
    : 0;
  const entry: EstimateVersionEntry = {
    id: createVersionId(),
    version: latestVersion + 1,
    action: input.action,
    createdAt: toPositiveInt(input.createdAt) ?? Date.now(),
    title: input.title.trim() || "Untitled Estimate",
    payload: cloneJson(input.payload ?? null),
    totals: cloneJson(input.totals ?? null),
    templateName: input.templateName,
    templateUrl: input.templateUrl,
    createdByUserId: input.createdByUserId ?? null,
    sourceVersion: toPositiveInt(input.sourceVersion) ?? undefined,
  };

  const nextHistory = [...history, entry].slice(-MAX_VERSION_HISTORY);
  return {
    entry,
    history: nextHistory,
    currentVersion: entry.version,
  };
}

export function getCurrentEstimateVersion(record: {
  version?: unknown;
  versionHistory?: unknown;
}) {
  const directVersion = toPositiveInt(record.version);
  if (directVersion) return directVersion;
  const history = normalizeEstimateVersionHistory(record.versionHistory);
  if (!history.length) return 1;
  return history[history.length - 1]?.version ?? 1;
}

export function getEstimateVersionActionLabel(action: EstimateVersionAction) {
  switch (action) {
    case "created":
      return "Created";
    case "updated":
      return "Saved";
    case "generated":
      return "Generated";
    case "reverted":
      return "Reverted";
    default:
      return "Baseline";
  }
}
