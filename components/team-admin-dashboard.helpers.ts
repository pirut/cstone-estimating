import type { DragEvent } from "react";

export const FEATURE_SCOPE_ALL_PRODUCTS = "__all_products__";
export const CATALOG_SCOPE_ALL_TEAMS = "__all_teams__";

export type VendorDraft = {
  id?: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  allowsSplitFinish: boolean;
  usesEuroPricing: boolean;
};

export type UnitTypeDraft = {
  id?: string;
  code: string;
  label: string;
  price: string;
  sortOrder: number;
  isActive: boolean;
};

export type ProductFeatureOptionDraft = {
  id?: string;
  category: string;
  vendorId: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
};

export type ProjectTypeDraft = {
  id?: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
};

export type EstimateAdminDraft = {
  id: string;
  title: string;
  status: string;
  version: number | null;
  createdAt: number | null;
  updatedAt: number | null;
  lastGeneratedAt: number | null;
  ownerLabel: string;
};

type VendorLike = {
  id?: string;
  name?: string;
  sortOrder?: number;
  isActive?: boolean;
  allowsSplitFinish?: boolean;
  usesEuroPricing?: boolean;
};

type UnitTypeLike = {
  id?: string;
  code?: string;
  label?: string;
  price?: number;
  sortOrder?: number;
  isActive?: boolean;
};

type ProjectTypeLike = {
  id?: string;
  label?: string;
  sortOrder?: number;
  isActive?: boolean;
};

type ProductFeatureOptionLike = {
  id?: string;
  category?: string;
  vendorId?: string;
  label?: string;
  sortOrder?: number;
  isActive?: boolean;
};

type EstimateLike = {
  id?: string;
  title?: string;
  status?: string;
  version?: number;
  createdAt?: number;
  updatedAt?: number;
  lastGeneratedAt?: number;
  owner?: {
    id?: string;
    name?: string;
    email?: string;
  };
};

export function hasEuroLabel(name: string) {
  const normalized = String(name ?? "").trim().toLowerCase();
  return /\b(eur|euro)\b/.test(normalized) || normalized.includes("€");
}

export function formatThresholdPercentInput(value: number) {
  if (!Number.isFinite(value)) return "";
  const percent = value * 100;
  const rounded = Math.round(percent * 100) / 100;
  if (Math.abs(rounded % 1) < 0.000001) {
    return String(Math.trunc(rounded));
  }
  return rounded.toFixed(2);
}

export function parseThresholdPercentInput(value: string) {
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 100) return null;
  return parsed / 100;
}

export function hasSameSerializedValue(current: unknown, next: unknown) {
  try {
    return JSON.stringify(current) === JSON.stringify(next);
  } catch {
    return false;
  }
}

export function reorderDraftListByInsertion<T extends { sortOrder: number }>(
  list: T[],
  fromIndex: number,
  insertionIndex: number
) {
  if (
    fromIndex < 0 ||
    fromIndex >= list.length ||
    insertionIndex < 0 ||
    insertionIndex > list.length ||
    insertionIndex === fromIndex ||
    insertionIndex === fromIndex + 1
  ) {
    return list;
  }
  const next = list.slice();
  const [moved] = next.splice(fromIndex, 1);
  const targetIndex = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
  next.splice(targetIndex, 0, moved);
  return next.map((item, index) => ({ ...item, sortOrder: index + 1 }));
}

export function getInsertionIndexFromDrag(
  event: DragEvent<HTMLElement>,
  rowIndex: number
) {
  const rect = event.currentTarget.getBoundingClientRect();
  const offsetY = event.clientY - rect.top;
  const isAfter = offsetY > rect.height / 2;
  return isAfter ? rowIndex + 1 : rowIndex;
}

export function toVendorDrafts(vendorRecords: VendorLike[]) {
  return vendorRecords.map((vendor, index) => ({
    id: vendor.id,
    name: vendor.name ?? "",
    sortOrder: typeof vendor.sortOrder === "number" ? vendor.sortOrder : index + 1,
    isActive: vendor.isActive !== false,
    allowsSplitFinish: vendor.allowsSplitFinish === true,
    usesEuroPricing:
      vendor.usesEuroPricing === true ||
      (vendor.usesEuroPricing === undefined && hasEuroLabel(String(vendor.name ?? ""))),
  }));
}

export function toUnitTypeDrafts(unitTypeRecords: UnitTypeLike[]) {
  return unitTypeRecords.map((unit, index) => ({
    id: unit.id,
    code: unit.code ?? "",
    label: unit.label ?? "",
    price:
      typeof unit.price === "number" && Number.isFinite(unit.price)
        ? unit.price.toString()
        : "",
    sortOrder: typeof unit.sortOrder === "number" ? unit.sortOrder : index + 1,
    isActive: unit.isActive !== false,
  }));
}

export function toProjectTypeDrafts(projectTypeRecords: ProjectTypeLike[]) {
  return projectTypeRecords.map((projectType, index) => ({
    id: projectType.id,
    label: String(projectType.label ?? ""),
    sortOrder:
      typeof projectType.sortOrder === "number" ? projectType.sortOrder : index + 1,
    isActive: projectType.isActive !== false,
  }));
}

export function toProductFeatureOptionDrafts(
  optionRecords: ProductFeatureOptionLike[]
) {
  return optionRecords.map((option, index) => ({
    id: option.id,
    category: String(option.category ?? ""),
    vendorId:
      typeof option.vendorId === "string" && option.vendorId.trim()
        ? option.vendorId
        : "",
    label: String(option.label ?? ""),
    sortOrder: typeof option.sortOrder === "number" ? option.sortOrder : index + 1,
    isActive: option.isActive !== false,
  }));
}

export function toEstimateAdminDrafts(estimateRecords: EstimateLike[]) {
  return estimateRecords.map((estimate) => {
    const ownerName = String(estimate.owner?.name ?? "").trim();
    const ownerEmail = String(estimate.owner?.email ?? "").trim();
    return {
      id: String(estimate.id ?? ""),
      title: String(estimate.title ?? ""),
      status: String(estimate.status ?? "active"),
      version: typeof estimate.version === "number" ? estimate.version : null,
      createdAt: typeof estimate.createdAt === "number" ? estimate.createdAt : null,
      updatedAt: typeof estimate.updatedAt === "number" ? estimate.updatedAt : null,
      lastGeneratedAt:
        typeof estimate.lastGeneratedAt === "number" ? estimate.lastGeneratedAt : null,
      ownerLabel:
        ownerName || ownerEmail || String(estimate.owner?.id ?? "").trim() || "Unknown owner",
    } satisfies EstimateAdminDraft;
  });
}

export function formatDateTime(timestamp: number | null) {
  if (typeof timestamp !== "number") return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
