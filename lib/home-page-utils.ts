import type { EstimateVersionPandaDocDocument } from "@/lib/estimate-versioning";
import type { LibraryItem, PandaDocTemplateConfig } from "@/lib/types";
import { hasOverrideInput } from "@/lib/estimate-calculator";

export type EstimateSnapshot = {
  title: string;
  payload: Record<string, any> | null;
  totals: Record<string, any> | null;
  templateName?: string;
  templateUrl?: string;
};

export type PandaDocGenerationResponse = {
  status?: "created" | "updated";
  operation?: "created" | "updated";
  revisedDocumentId?: string;
  fallbackFromDocumentId?: string;
  revision?: {
    revertedToDraft?: boolean;
    previousStatus?: string;
  };
  document?: {
    id?: string;
    name?: string;
    status?: string;
    appUrl?: string;
    sharedLink?: string;
    valueAmount?: number;
    valueCurrency?: string;
    valueFormatted?: string;
  };
  session?: {
    id?: string;
    url?: string;
    expiresAt?: string;
  };
  recipient?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    role?: string;
  };
  businessCentralSync?: {
    status?: string;
    reason?: string;
  };
};

const REQUIRED_MANUAL_INFO_FIELDS = [
  "prepared_for",
  "project_name",
  "proposal_date",
] as const;

function normalizeForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForComparison(entry));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const normalized: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      normalized[key] = normalizeForComparison(entryValue);
    }
    return normalized;
  }
  return value;
}

function toComparableEstimateSnapshot(
  snapshot: EstimateSnapshot
): EstimateSnapshot {
  const normalizedTotals =
    snapshot.totals && typeof snapshot.totals === "object"
      ? (() => {
          const clone = { ...(snapshot.totals as Record<string, any>) };
          delete clone.pandadoc_document_value_amount;
          delete clone.pandadoc_document_value_currency;
          delete clone.pandadoc_document_value_formatted;
          return normalizeForComparison(clone) as Record<string, any>;
        })()
      : null;
  return {
    title: snapshot.title.trim() || "Untitled Estimate",
    payload:
      snapshot.payload && typeof snapshot.payload === "object"
        ? (normalizeForComparison(snapshot.payload) as Record<string, any>)
        : null,
    totals: normalizedTotals,
    templateName: snapshot.templateName?.trim() || undefined,
    templateUrl: snapshot.templateUrl?.trim() || undefined,
  };
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/[$,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasAnyManualInput(values: Record<string, unknown>) {
  return Object.entries(values).some(([key, value]) => {
    if (key === "prepared_by") return false;
    if (typeof value === "number") return Number.isFinite(value) && value > 0;
    return String(value ?? "").trim().length > 0;
  });
}

function isChangeOrderProjectType(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "change order" ||
    normalized === "change-order" ||
    normalized.includes("change order")
  );
}

function normalizeTemplateMatchKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function collectEstimateVendorKeys(
  estimatePayload: Record<string, any> | null,
  estimateValues: Record<string, string | number>
) {
  const vendorIds = new Set<string>();
  const vendorNames = new Set<string>();
  const addVendorId = (value: unknown) => {
    const normalized = normalizeTemplateMatchKey(value);
    if (!normalized) return;
    vendorIds.add(normalized);
  };
  const addVendorName = (value: unknown) => {
    const normalized = normalizeTemplateMatchKey(value);
    if (!normalized) return;
    vendorNames.add(normalized);
  };

  if (estimatePayload && typeof estimatePayload === "object") {
    const products = Array.isArray(estimatePayload.products)
      ? estimatePayload.products
      : [];
    products.forEach((item) => {
      if (!item || typeof item !== "object") return;
      addVendorId((item as Record<string, unknown>).vendorId);
      addVendorName((item as Record<string, unknown>).name);
    });
    const changeOrder =
      estimatePayload.changeOrder && typeof estimatePayload.changeOrder === "object"
        ? (estimatePayload.changeOrder as Record<string, unknown>)
        : null;
    addVendorId(changeOrder?.vendorId);
    addVendorName(changeOrder?.vendorName);
    const values =
      estimatePayload.values &&
      typeof estimatePayload.values === "object" &&
      !Array.isArray(estimatePayload.values)
        ? (estimatePayload.values as Record<string, unknown>)
        : null;
    addVendorName(values?.change_order_vendor);
  }

  addVendorName(estimateValues.change_order_vendor);

  return { vendorIds, vendorNames };
}

export function toPandaDocVersionDocument(
  generation: PandaDocGenerationResponse | null | undefined,
  updatedAt: number
): EstimateVersionPandaDocDocument | undefined {
  const documentId = String(generation?.document?.id ?? "").trim();
  if (!documentId) return undefined;
  const operationRaw = String(
    generation?.operation ?? generation?.status ?? ""
  )
    .trim()
    .toLowerCase();
  const operation =
    operationRaw === "updated" || operationRaw === "created"
      ? (operationRaw as "created" | "updated")
      : undefined;
  return {
    documentId,
    name: String(generation?.document?.name ?? "").trim() || undefined,
    status: String(generation?.document?.status ?? "").trim() || undefined,
    appUrl: String(generation?.document?.appUrl ?? "").trim() || undefined,
    sharedLink:
      String(generation?.document?.sharedLink ?? "").trim() || undefined,
    recipientEmail: String(generation?.recipient?.email ?? "").trim() || undefined,
    recipientFirstName:
      String(generation?.recipient?.firstName ?? "").trim() || undefined,
    recipientLastName:
      String(generation?.recipient?.lastName ?? "").trim() || undefined,
    recipientRole: String(generation?.recipient?.role ?? "").trim() || undefined,
    operation,
    updatedAt,
  };
}

export function getEstimateProjectType(estimate: any) {
  const infoProjectType = String(estimate?.payload?.info?.project_type ?? "").trim();
  if (infoProjectType) return infoProjectType;
  const valuesProjectType = String(estimate?.payload?.values?.project_type ?? "").trim();
  if (valuesProjectType) return valuesProjectType;
  return "";
}

export function resolvePandaDocTemplateConfigForEstimate(
  pandadocConfig: PandaDocTemplateConfig | undefined,
  estimatePayload: Record<string, any> | null,
  estimateValues: Record<string, string | number>
) {
  const defaultTemplateUuid = String(pandadocConfig?.templateUuid ?? "").trim();
  const defaultTemplateName = String(pandadocConfig?.templateName ?? "").trim();
  const defaultRecipientRole = String(pandadocConfig?.recipientRole ?? "").trim();
  const rules = Array.isArray(pandadocConfig?.rules)
    ? pandadocConfig.rules.filter((rule) => rule?.isActive !== false)
    : [];
  if (!rules.length) {
    return {
      templateUuid: defaultTemplateUuid,
      templateName: defaultTemplateName || undefined,
      recipientRole: defaultRecipientRole || undefined,
      matchedRuleId: null as string | null,
    };
  }

  const projectType =
    normalizeTemplateMatchKey(estimatePayload?.info?.project_type) ||
    normalizeTemplateMatchKey(estimatePayload?.values?.project_type) ||
    normalizeTemplateMatchKey(estimateValues.project_type);
  const { vendorIds, vendorNames } = collectEstimateVendorKeys(
    estimatePayload,
    estimateValues
  );

  const scoredRules = rules
    .map((rule, index) => {
      const ruleVendorId = normalizeTemplateMatchKey(rule.vendorId);
      const ruleVendorName = normalizeTemplateMatchKey(rule.vendorName);
      const ruleProjectType = normalizeTemplateMatchKey(rule.projectType);

      if (ruleVendorId && !vendorIds.has(ruleVendorId)) return null;
      if (ruleVendorName && !vendorNames.has(ruleVendorName)) return null;
      if (ruleProjectType && ruleProjectType !== projectType) return null;

      const specificity =
        (ruleVendorId ? 1 : 0) +
        (ruleVendorName ? 1 : 0) +
        (ruleProjectType ? 1 : 0);
      return { rule, index, specificity };
    })
    .filter((entry): entry is { rule: any; index: number; specificity: number } =>
      Boolean(entry)
    )
    .sort((a, b) => {
      if (a.specificity !== b.specificity) return b.specificity - a.specificity;
      return a.index - b.index;
    });

  const matched = scoredRules[0]?.rule;
  if (!matched) {
    return {
      templateUuid: defaultTemplateUuid,
      templateName: defaultTemplateName || undefined,
      recipientRole: defaultRecipientRole || undefined,
      matchedRuleId: null as string | null,
    };
  }

  const matchedTemplateUuid = String(matched.templateUuid ?? "").trim();
  const matchedTemplateName = String(matched.templateName ?? "").trim();
  const matchedRecipientRole = String(matched.recipientRole ?? "").trim();

  return {
    templateUuid: matchedTemplateUuid || defaultTemplateUuid,
    templateName: matchedTemplateName || defaultTemplateName || undefined,
    recipientRole: matchedRecipientRole || defaultRecipientRole || undefined,
    matchedRuleId: String(matched.id ?? "").trim() || null,
  };
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

export function formatPandaDocStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) return "Unknown";
  const withoutPrefix = normalized.replace(/^document\./, "");
  return withoutPrefix
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function normalizeEstimateTags(source: unknown): string[] {
  if (!Array.isArray(source)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  source.forEach((entry) => {
    const tag = String(entry ?? "").trim().replace(/\s+/g, " ");
    if (!tag) return;
    const normalized = tag.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    tags.push(tag);
  });
  return tags;
}

export function getMostRecentLibraryItem(items: LibraryItem[]) {
  return items
    .slice()
    .sort((left, right) => right.uploadedAt - left.uploadedAt)[0];
}

export function getManualEstimateProgress(
  estimatePayload: Record<string, any> | null,
  estimateValues: Record<string, string | number>
) {
  const evaluateChangeOrderStep = (source: Record<string, unknown> | null) => {
    const vendorName = String(
      source?.vendorName ?? source?.change_order_vendor ?? ""
    ).trim();
    const vendorCost = toFiniteNumber(
      source?.vendorCost ?? source?.change_order_vendor_cost
    );
    const laborCost = toFiniteNumber(
      source?.laborCost ?? source?.change_order_labor_cost
    );
    return Boolean(vendorName) && vendorCost > 0 && laborCost > 0;
  };

  if (estimatePayload && typeof estimatePayload === "object") {
    const info =
      estimatePayload.info && typeof estimatePayload.info === "object"
        ? (estimatePayload.info as Record<string, unknown>)
        : null;
    const products = Array.isArray(estimatePayload.products)
      ? (estimatePayload.products as Array<Record<string, unknown>>)
      : null;
    const bucking = Array.isArray(estimatePayload.bucking)
      ? (estimatePayload.bucking as Array<Record<string, unknown>>)
      : null;
    const calculator =
      estimatePayload.calculator &&
      typeof estimatePayload.calculator === "object" &&
      !Array.isArray(estimatePayload.calculator)
        ? (estimatePayload.calculator as Record<string, unknown>)
        : null;
    const values =
      estimatePayload.values &&
      typeof estimatePayload.values === "object" &&
      !Array.isArray(estimatePayload.values)
        ? (estimatePayload.values as Record<string, unknown>)
        : null;
    const changeOrder =
      estimatePayload.changeOrder &&
      typeof estimatePayload.changeOrder === "object" &&
      !Array.isArray(estimatePayload.changeOrder)
        ? (estimatePayload.changeOrder as Record<string, unknown>)
        : null;
    const changeOrderMode =
      String(estimatePayload.mode ?? "").trim().toLowerCase() === "change_order" ||
      isChangeOrderProjectType(info?.project_type ?? values?.project_type);

    if (info || products || bucking) {
      const projectStepComplete = REQUIRED_MANUAL_INFO_FIELDS.every((field) =>
        String(info?.[field] ?? "").trim()
      );
      const totalContractReady =
        toFiniteNumber(estimatePayload?.totals?.total_contract_price) > 0;
      if (changeOrderMode) {
        const changeOrderStepComplete = evaluateChangeOrderStep({
          ...(values ?? {}),
          ...(changeOrder ?? {}),
        });
        return {
          started: projectStepComplete || changeOrderStepComplete || totalContractReady,
          complete:
            projectStepComplete && changeOrderStepComplete && totalContractReady,
        };
      }

      const productStepComplete = (products ?? []).some((item) => {
        const name = String(item?.name ?? "").trim();
        const price = toFiniteNumber(item?.price);
        return Boolean(name) && price > 0;
      });
      const hasBuckingLineItems = (bucking ?? []).some((item) => {
        const qty = toFiniteNumber(item?.qty);
        const sqft = toFiniteNumber(item?.sqft);
        return qty > 0 && sqft > 0;
      });
      const hasBuckingOverrides =
        hasOverrideInput(calculator?.override_bucking_cost as any) &&
        hasOverrideInput(calculator?.override_waterproofing_cost as any);
      const hasInstallOverride = hasOverrideInput(
        calculator?.override_install_total as any
      );
      const buckingStepComplete = hasBuckingLineItems || hasBuckingOverrides;
      const installStepComplete =
        totalContractReady && (hasBuckingLineItems || hasInstallOverride);

      return {
        started:
          projectStepComplete ||
          productStepComplete ||
          buckingStepComplete ||
          installStepComplete,
        complete:
          projectStepComplete &&
          productStepComplete &&
          buckingStepComplete &&
          installStepComplete,
      };
    }

    if (values) {
      const changeOrderModeFromValues = isChangeOrderProjectType(values.project_type);
      const changeOrderStepComplete = evaluateChangeOrderStep(values);
      return {
        started: hasAnyManualInput(values),
        complete:
          REQUIRED_MANUAL_INFO_FIELDS.every((field) => String(values[field] ?? "").trim()) &&
          (changeOrderModeFromValues ? changeOrderStepComplete : true) &&
          toFiniteNumber(values.total_contract_price) > 0,
      };
    }
  }

  const fallbackValues = estimateValues as Record<string, unknown>;
  return {
    started: hasAnyManualInput(fallbackValues),
    complete:
      REQUIRED_MANUAL_INFO_FIELDS.every((field) =>
        String(fallbackValues[field] ?? "").trim()
      ) && toFiniteNumber(fallbackValues.total_contract_price) > 0,
  };
}

export function hasEstimateSnapshotChanges(
  existingEstimate: any,
  snapshot: EstimateSnapshot
) {
  if (!existingEstimate) return true;
  const currentSnapshot = toComparableEstimateSnapshot({
    title: String(existingEstimate.title ?? ""),
    payload:
      existingEstimate.payload && typeof existingEstimate.payload === "object"
        ? existingEstimate.payload
        : null,
    totals:
      existingEstimate.totals && typeof existingEstimate.totals === "object"
        ? existingEstimate.totals
        : null,
    templateName:
      typeof existingEstimate.templateName === "string"
        ? existingEstimate.templateName
        : undefined,
    templateUrl:
      typeof existingEstimate.templateUrl === "string"
        ? existingEstimate.templateUrl
        : undefined,
  });
  const nextSnapshot = toComparableEstimateSnapshot(snapshot);
  return JSON.stringify(currentSnapshot) !== JSON.stringify(nextSnapshot);
}
