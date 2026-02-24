import type { PandaDocTemplateBinding } from "@/lib/types";

export const ANY_VENDOR_VALUE = "__any_vendor__";
export const ANY_PROJECT_TYPE_VALUE = "__any_project_type__";
export const ALL_PROJECT_FILTER_VALUE = "__all_projects__";
export const UNASSIGNED_PROJECT_FILTER_VALUE = "__unassigned_projects__";

export type LibraryItem = {
  key: string;
  name: string;
  uploadedAt: number;
  url: string;
};

export type PandaDocTemplateListItem = {
  id: string;
  name: string;
  dateModified?: string;
  dateCreated?: string;
  version?: string;
};

export type PandaDocTemplateDetails = {
  id: string;
  name: string;
  roles: Array<{ id: string; name: string; signingOrder?: string }>;
  tokens: Array<{ name: string }>;
  fields: Array<{ name: string; mergeField?: string; type?: string }>;
};

export function normalizedKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function createBinding(
  details: PandaDocTemplateDetails | null,
  sourceKeys: string[],
  sourceKey = sourceKeys[0] ?? ""
): PandaDocTemplateBinding {
  const firstToken = details?.tokens[0]?.name ?? "";
  return {
    id: `binding-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourceKey,
    targetType: "token",
    targetName: firstToken,
  };
}

function addFlatKeys(value: unknown, keys: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  Object.keys(value as Record<string, unknown>).forEach((key) => {
    const normalized = key.trim();
    if (!normalized) return;
    keys.add(normalized);
  });
}

export function collectKeysFromEstimatePayload(value: unknown, keys: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const payload = value as Record<string, unknown>;
  addFlatKeys(payload, keys);
  addFlatKeys(payload.values, keys);
  addFlatKeys(payload.info, keys);
}

export function formatRelativeTime(timestamp: number | null | undefined) {
  if (!timestamp || !Number.isFinite(timestamp)) return "No timestamp";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3_600_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}m ago`;
  if (diffMs < 86_400_000) {
    return `${Math.max(1, Math.floor(diffMs / 3_600_000))}h ago`;
  }
  if (diffMs < 604_800_000) {
    return `${Math.max(1, Math.floor(diffMs / 86_400_000))}d ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

export function hasSameStringRecord(
  current: Record<string, string>,
  next: Record<string, string>
) {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  if (currentKeys.length !== nextKeys.length) return false;
  return currentKeys.every((key) => current[key] === next[key]);
}
