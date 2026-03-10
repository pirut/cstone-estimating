import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

type RawEstimateRecord = {
  id?: string;
  title?: string;
  status?: string;
  updatedAt?: number;
  payload?: Record<string, any> | null;
  versionHistory?: unknown;
  project?: {
    id?: string;
    name?: string;
  } | null;
};

type RawTeamRecord = {
  id?: string;
  name?: string;
  estimates?: RawEstimateRecord[];
};

export type EstimateSharePreview = {
  estimateId: string;
  title: string;
  status: string;
  pandaDocStatus: string;
  updatedAt: number | null;
  customerName: string;
  projectName: string;
  workspaceProjectName: string;
  teamName: string;
};

const DEFAULT_ALLOWED_DOMAIN = "cornerstonecompaniesfl.com";

function coerceText(value: unknown) {
  return String(value ?? "").trim();
}

function decodeEstimateId(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizeUnique(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = coerceText(value).toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

function resolveAllowedDomains() {
  const source = [
    process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN,
    process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS,
    DEFAULT_ALLOWED_DOMAIN,
  ]
    .map((value) => coerceText(value))
    .filter(Boolean)
    .flatMap((value) => value.split(","))
    .map((value) => coerceText(value));

  const domains = normalizeUnique(source);
  return domains.length ? domains : [DEFAULT_ALLOWED_DOMAIN];
}

function extractEstimateField(
  estimate: RawEstimateRecord,
  keys: string[]
): string {
  const payload =
    estimate?.payload && typeof estimate.payload === "object"
      ? estimate.payload
      : null;
  const info =
    payload?.info && typeof payload.info === "object" ? payload.info : null;
  const values =
    payload?.values && typeof payload.values === "object" ? payload.values : null;

  for (const key of keys) {
    const infoValue = coerceText(info?.[key]);
    if (infoValue) return infoValue;
    const valuesValue = coerceText(values?.[key]);
    if (valuesValue) return valuesValue;
    const payloadValue = coerceText(payload?.[key]);
    if (payloadValue) return payloadValue;
  }

  return "";
}

function createPreview(
  estimateId: string,
  team: RawTeamRecord,
  estimate: RawEstimateRecord
): EstimateSharePreview {
  const title = coerceText(estimate?.title) || "Untitled Estimate";
  const customerName =
    extractEstimateField(estimate, ["prepared_for", "customer_name"]) ||
    "Customer not set";
  const payloadProjectName = extractEstimateField(estimate, ["project_name"]);
  const workspaceProjectName = coerceText(estimate?.project?.name);
  const projectName = payloadProjectName || workspaceProjectName || title;
  const pandaDocStatus = resolveLatestPandaDocStatus(estimate?.versionHistory);

  return {
    estimateId,
    title,
    status: coerceText(estimate?.status) || "draft",
    pandaDocStatus,
    updatedAt:
      typeof estimate?.updatedAt === "number" && Number.isFinite(estimate.updatedAt)
        ? estimate.updatedAt
        : null,
    customerName,
    projectName,
    workspaceProjectName,
    teamName: coerceText(team?.name) || "Cornerstone",
  };
}

function resolveLatestPandaDocStatus(rawHistory: unknown) {
  if (!Array.isArray(rawHistory)) return "";
  let latestStatus = "";
  let latestUpdatedAt = 0;
  for (const entry of rawHistory) {
    if (!entry || typeof entry !== "object") continue;
    const pandadoc =
      "pandadoc" in entry && entry.pandadoc && typeof entry.pandadoc === "object"
        ? (entry.pandadoc as Record<string, unknown>)
        : null;
    const status = coerceText(pandadoc?.status);
    if (!status) continue;
    const updatedAtRaw =
      typeof pandadoc?.updatedAt === "number" && Number.isFinite(pandadoc.updatedAt)
        ? pandadoc.updatedAt
        : typeof (entry as Record<string, unknown>).createdAt === "number" &&
            Number.isFinite((entry as Record<string, unknown>).createdAt)
          ? ((entry as Record<string, unknown>).createdAt as number)
          : 0;
    if (!latestStatus || updatedAtRaw >= latestUpdatedAt) {
      latestStatus = status;
      latestUpdatedAt = updatedAtRaw;
    }
  }
  return latestStatus;
}

async function findEstimateInDomain(domain: string, estimateId: string) {
  const teams = (await fetchQuery((api as any).app.teamGraphByDomain, {
    domain,
  })) as RawTeamRecord[];

  for (const team of teams) {
    const estimates = Array.isArray(team?.estimates) ? team.estimates : [];
    for (const estimate of estimates) {
      if (coerceText(estimate?.id) !== estimateId) continue;
      return createPreview(estimateId, team, estimate);
    }
  }

  return null;
}

export function parseEstimateId(rawEstimateId: string) {
  return coerceText(decodeEstimateId(rawEstimateId));
}

export function formatEstimatePreviewId(estimateId: string) {
  if (!estimateId) return "Unknown";
  if (estimateId.length <= 26) return estimateId;
  return `${estimateId.slice(0, 12)}...${estimateId.slice(-8)}`;
}

export function formatEstimateStatus(status: string) {
  const normalized = coerceText(status).toLowerCase();
  if (!normalized) return "Estimate Draft";
  if (normalized === "generated") return "Generated";
  if (normalized === "draft") return "Estimate Draft";
  if (normalized === "archived") return "Archived";
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function formatPandaDocPreviewStatus(status: string) {
  const normalized = coerceText(status).toLowerCase();
  if (!normalized) return "Generated";
  const withoutPrefix = normalized.replace(/^document\./, "");
  if (withoutPrefix === "draft") return "PandaDoc Draft";
  return withoutPrefix
    .split(/[_\s.-]+/)
    .filter(Boolean)
    .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

export function formatEstimatePreviewStatus(preview: EstimateSharePreview | null) {
  if (!preview) return "Estimate Draft";
  const estimateStatus = coerceText(preview.status).toLowerCase();
  if (estimateStatus === "generated" && preview.pandaDocStatus) {
    return formatPandaDocPreviewStatus(preview.pandaDocStatus);
  }
  return formatEstimateStatus(preview.status);
}

export async function resolveEstimateSharePreview(rawEstimateId: string) {
  const estimateId = parseEstimateId(rawEstimateId);
  if (!estimateId) return null;

  const domains = resolveAllowedDomains();
  for (const domain of domains) {
    try {
      const preview = await findEstimateInDomain(domain, estimateId);
      if (preview) return preview;
    } catch {
      continue;
    }
  }

  return null;
}
