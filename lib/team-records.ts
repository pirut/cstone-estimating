export type ConvexUserRecord = {
  id?: string;
  name?: string;
  email?: string;
  imageUrl?: string;
};

export type MembershipRecord = {
  id: string;
  role?: string;
  createdAt?: number;
  user?: ConvexUserRecord;
};

export type VendorRecord = {
  id: string;
  name?: string;
  sortOrder?: number;
  isActive?: boolean;
  allowsSplitFinish?: boolean;
  usesEuroPricing?: boolean;
};

export type UnitTypeRecord = {
  id: string;
  code?: string;
  label?: string;
  price?: number;
  vendorPrices?: UnitTypeVendorPriceRecord[];
  sortOrder?: number;
  isActive?: boolean;
};

export type UnitTypeVendorPriceRecord = {
  vendorId: string;
  price: number;
};

export type ProjectTypeRecord = {
  id: string;
  label?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type ProductFeatureOptionRecord = {
  id: string;
  category?: string;
  vendorId?: string;
  label?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type ProjectRecord = {
  id: string;
  name?: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type EstimateVersionHistoryEntryRecord = {
  payload?: unknown;
};

export type EstimateRecord = {
  id: string;
  title?: string;
  status?: string;
  version?: number;
  createdAt?: number;
  updatedAt?: number;
  lastGeneratedAt?: number;
  payload?: unknown;
  versionHistory?: EstimateVersionHistoryEntryRecord[];
  owner?: ConvexUserRecord;
  project?: ProjectRecord | null;
};

export type TeamRecord = {
  id: string;
  name?: string;
  domain?: string;
  isPrimary?: boolean;
  parentTeamId?: string;
  ownerId?: string;
  marginThresholds?: Partial<MarginThresholds> | null;
  memberships?: MembershipRecord[];
  estimates?: EstimateRecord[];
  vendors?: VendorRecord[];
  unitTypes?: UnitTypeRecord[];
  projectTypes?: ProjectTypeRecord[];
  productFeatureOptions?: ProductFeatureOptionRecord[];
  projects?: ProjectRecord[];
};
import type { MarginThresholds } from "@/lib/estimate-calculator";
