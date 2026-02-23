// @ts-nocheck
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { EstimateBuilderCard } from "@/components/estimate-builder-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  LibraryItem,
  LibraryState,
  LibraryType,
  TemplateConfig,
  UploadedFile,
} from "@/lib/types";
import { db, convexAppUrl } from "@/lib/convex";
import {
  appendEstimateVersion,
  createBaselineEstimateVersion,
  getCurrentEstimateVersion,
  getEstimateVersionActionLabel,
  normalizeEstimateVersionHistory,
  type EstimateVersionPandaDocDocument,
  type EstimateVersionEntry,
} from "@/lib/estimate-versioning";
import { ConvexAuthSync } from "@/components/convex-auth-sync";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import {
  isProductFeatureCategory,
  type ProductFeatureOption,
} from "@/lib/product-features";
import {
  getOrganizationScopedTeams,
  hasCatalogData,
  pickOrganizationTeam,
} from "@/lib/org-teams";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  CircleDashed,
  FileText,
  FolderKanban,
  History,
  LayoutTemplate,
  Loader2,
  PencilLine,
  Plus,
  Rocket,
  RotateCcw,
  Search,
  Settings2,
  Tag,
  Workflow,
  X,
} from "lucide-react";
import {
  SignInButton,
  SignOutButton,
  clerkEnabled,
  useOptionalAuth,
  useOptionalUser,
} from "@/lib/clerk";
import { id } from "@/lib/convex";

type EstimateSnapshot = {
  title: string;
  payload: Record<string, any> | null;
  totals: Record<string, any> | null;
  templateName?: string;
  templateUrl?: string;
};

type PandaDocGenerationResponse = {
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

function toPandaDocVersionDocument(
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
  return {
    title: snapshot.title.trim() || "Untitled Estimate",
    payload:
      snapshot.payload && typeof snapshot.payload === "object"
        ? (normalizeForComparison(snapshot.payload) as Record<string, any>)
        : null,
    totals:
      snapshot.totals && typeof snapshot.totals === "object"
        ? (normalizeForComparison(snapshot.totals) as Record<string, any>)
        : null,
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

function formatRelativeTime(timestamp: number | null | undefined) {
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

function formatPandaDocStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) return "Unknown";
  const withoutPrefix = normalized.replace(/^document\./, "");
  return withoutPrefix
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
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

const UNASSIGNED_PROJECT_KEY = "__unassigned__";
const LOCAL_DRAFT_STORAGE_KEY = "cstone:manual-estimate:draft:v1";

function normalizeEstimateTags(source: unknown): string[] {
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

function getMostRecentLibraryItem(items: LibraryItem[]) {
  return items
    .slice()
    .sort((left, right) => right.uploadedAt - left.uploadedAt)[0];
}

function getManualEstimateProgress(
  estimatePayload: Record<string, any> | null,
  estimateValues: Record<string, string | number>
) {
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

    if (info || products || bucking) {
      const projectStepComplete = REQUIRED_MANUAL_INFO_FIELDS.every((field) =>
        String(info?.[field] ?? "").trim()
      );
      const productStepComplete = (products ?? []).some((item) => {
        const name = String(item?.name ?? "").trim();
        const price = toFiniteNumber(item?.price);
        return Boolean(name) && price > 0;
      });
      const buckingStepComplete = (bucking ?? []).some((item) => {
        const qty = toFiniteNumber(item?.qty);
        const sqft = toFiniteNumber(item?.sqft);
        return qty > 0 && sqft > 0;
      });
      const installStepComplete =
        toFiniteNumber(estimatePayload?.totals?.total_contract_price) > 0;

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

    if (
      estimatePayload.values &&
      typeof estimatePayload.values === "object" &&
      !Array.isArray(estimatePayload.values)
    ) {
      const values = estimatePayload.values as Record<string, unknown>;
      return {
        started: hasAnyManualInput(values),
        complete:
          REQUIRED_MANUAL_INFO_FIELDS.every((field) =>
            String(values[field] ?? "").trim()
          ) && toFiniteNumber(values.total_contract_price) > 0,
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

function hasEstimateSnapshotChanges(existingEstimate: any, snapshot: EstimateSnapshot) {
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

export default function HomePage() {
  const { isLoaded: authLoaded, isSignedIn } = useOptionalAuth();
  const { user } = useOptionalUser();
  const { isLoading: convexLoading, user: convexUser, error: convexAuthError } =
    db.useAuth();
  const [error, setError] = useState<string | null>(null);
  const [templateConfig, setTemplateConfig] = useState<TemplateConfig | null>(null);
  const [loadedTemplateConfigKey, setLoadedTemplateConfigKey] = useState<
    string | null
  >(null);
  const [templateConfigError, setTemplateConfigError] = useState<string | null>(null);
  const [templateConfigLoading, setTemplateConfigLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [isPlanningLinesCopying, setIsPlanningLinesCopying] = useState(false);
  const [estimateValues, setEstimateValues] = useState<
    Record<string, string | number>
  >({});
  const [estimatePayload, setEstimatePayload] = useState<Record<string, any> | null>(
    null
  );
  const [estimateName, setEstimateName] = useState("");
  const [selectedEstimate, setSelectedEstimate] = useState<UploadedFile | null>(
    null
  );
  const [lastGeneration, setLastGeneration] =
    useState<PandaDocGenerationResponse | null>(null);
  const [linkedDocumentLive, setLinkedDocumentLive] = useState<{
    id: string;
    name?: string;
    status?: string;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [convexSetupError, setConvexSetupError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamSetupPending, setTeamSetupPending] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [teamSetupAction, setTeamSetupAction] = useState<
    "idle" | "creating" | "joining"
  >("idle");
  const [knownOrgTeamId, setKnownOrgTeamId] = useState<string | null>(null);
  const [knownOrgTeamDomain, setKnownOrgTeamDomain] = useState<string | null>(null);
  const [knownOrgLookupLoaded, setKnownOrgLookupLoaded] = useState(false);
  const [editingEstimateId, setEditingEstimateId] = useState<string | null>(null);
  const [historyEstimateId, setHistoryEstimateId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyActionId, setHistoryActionId] = useState<string | null>(null);
  const [movingEstimateId, setMovingEstimateId] = useState<string | null>(null);
  const [moveTargetByEstimateId, setMoveTargetByEstimateId] = useState<
    Record<string, string>
  >({});
  const [teamEstimateQuery, setTeamEstimateQuery] = useState("");
  const [teamEstimateScope, setTeamEstimateScope] = useState<
    "all" | "mine" | "recent"
  >("all");
  const [projectActionNotice, setProjectActionNotice] = useState<string | null>(null);
  const [floatingDockOpen, setFloatingDockOpen] = useState(false);
  const [floatingDockMoveTargetId, setFloatingDockMoveTargetId] = useState("");
  const [dockRenameEstimateOpen, setDockRenameEstimateOpen] = useState(false);
  const [dockRenameEstimateValue, setDockRenameEstimateValue] = useState("");
  const [dockRenameProjectOpen, setDockRenameProjectOpen] = useState(false);
  const [dockRenameProjectValue, setDockRenameProjectValue] = useState("");
  const [dockCreateProjectOpen, setDockCreateProjectOpen] = useState(false);
  const [dockCreateProjectValue, setDockCreateProjectValue] = useState("");
  const [loadedEstimatePayload, setLoadedEstimatePayload] = useState<Record<
    string,
    any
  > | null>(null);
  const [estimateTags, setEstimateTags] = useState<string[]>([]);
  const [estimateTagInput, setEstimateTagInput] = useState("");
  const progressResetTimeoutRef = useRef<number | null>(null);
  const draftRestoredRef = useRef(false);
  const [library, setLibrary] = useState<LibraryState>({
    workbook: { items: [], loading: false, error: null },
    template: { items: [], loading: false, error: null },
    template_config: { items: [], loading: false, error: null },
    estimate: { items: [], loading: false, error: null },
  });
  const preparedByName = useMemo(() => {
    const fullName = user?.fullName?.trim();
    if (fullName) return fullName;
    const firstLast = [user?.firstName, user?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (firstLast) return firstLast;
    const username = user?.username?.trim();
    if (username) return username;
    const emailName = user?.primaryEmailAddress?.emailAddress
      ?.split("@")[0]
      ?.trim();
    return emailName ?? "";
  }, [user]);

  const emailAddress = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? "";
  const emailDomain = emailAddress.split("@")[1] ?? "";
  const primaryOwnerEmail = (
    process.env.NEXT_PUBLIC_PRIMARY_OWNER_EMAIL ??
    "jr@cornerstonecompaniesfl.com"
  )
    .trim()
    .toLowerCase();
  const isPrimaryOwner = Boolean(
    emailAddress && emailAddress === primaryOwnerEmail
  );
  const allowedDomain = (
    process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "cornerstonecompaniesfl.com"
  )
    .trim()
    .toLowerCase();
  const pandadocSignerRole = (
    process.env.NEXT_PUBLIC_PANDADOC_SIGNER_ROLE ?? "Cornerstone"
  ).trim();
  const preferredOrgTeamName = (
    process.env.NEXT_PUBLIC_ORG_TEAM_NAME ?? "CORNERSTONE"
  ).trim();
  const normalizedOrgTeamName = preferredOrgTeamName.toLowerCase();
  const teamDomain = (allowedDomain || emailDomain || "").trim();
  const teamLookupDomain = teamDomain || "__none__";

  const teamQuery = convexAppUrl
    ? {
        teams: {
          $: {
            where: { domain: teamLookupDomain },
            order: { createdAt: "desc" as const },
          },
          memberships: { user: {} },
          estimates: { owner: {}, project: {} },
          projects: { owner: {}, estimates: { owner: {}, project: {} } },
          vendors: {},
          unitTypes: {},
          productFeatureOptions: {},
        },
      }
    : {
        teams: {
          $: { where: { domain: "__none__" } },
          memberships: { user: {} },
          estimates: { owner: {}, project: {} },
          projects: { owner: {}, estimates: { owner: {}, project: {} } },
          vendors: {},
          unitTypes: {},
          productFeatureOptions: {},
        },
      };

  const {
    data: teamData,
    error: teamQueryError,
    isLoading: teamLoading,
  } = db.useQuery(teamQuery);

  const teams = (teamData?.teams ?? []) as Array<any>;
  const orgTeam = useMemo(
    () => pickOrganizationTeam(teams, normalizedOrgTeamName),
    [teams, normalizedOrgTeamName]
  );
  const orgScopedTeams = useMemo(
    () => getOrganizationScopedTeams(teams, orgTeam?.id),
    [orgTeam?.id, teams]
  );
  const memberTeams = useMemo(() => {
    if (!convexUser?.id) return [];
    return orgScopedTeams.filter((team) =>
      team.memberships?.some((membership) => membership.user?.id === convexUser.id)
    );
  }, [orgScopedTeams, convexUser?.id]);
  const allMemberTeams = useMemo(() => {
    if (!convexUser?.id) return [];
    return teams.filter((team) =>
      team.memberships?.some((membership) => membership.user?.id === convexUser.id)
    );
  }, [convexUser?.id, teams]);
  const orgMembership = orgTeam?.memberships?.find(
    (membership) => membership.user?.id === convexUser?.id
  );
  const orgRole = String(orgMembership?.role ?? "")
    .trim()
    .toLowerCase();
  const activeTeam = useMemo(() => {
    if (!memberTeams.length) return null;
    const selected = memberTeams.find((team) => team.id === activeTeamId);
    if (selected) return selected;
    const orgMatch = memberTeams.find((team) => team.id === orgTeam?.id);
    return orgMatch ?? memberTeams[0] ?? null;
  }, [activeTeamId, memberTeams, orgTeam?.id]);
  const activeMembership = activeTeam?.memberships?.find(
    (membership) => membership.user?.id === convexUser?.id
  );
  const catalogTeam = useMemo(() => {
    if (orgTeam && hasCatalogData(orgTeam)) return orgTeam;
    const legacyCatalogTeam = allMemberTeams.find((team) => hasCatalogData(team));
    if (legacyCatalogTeam) return legacyCatalogTeam;
    return orgTeam ?? activeTeam;
  }, [activeTeam, allMemberTeams, orgTeam]);
  const teamReady = Boolean(orgTeam && orgMembership);
  const isOrgOwner = Boolean(
    isPrimaryOwner ||
      (orgTeam?.ownerId && orgTeam.ownerId === convexUser?.id) ||
      orgRole === "owner"
  );
  const hasTeamAdminAccess = Boolean(isOrgOwner || orgRole === "admin");
  const appLocked = clerkEnabled && (!authLoaded || !isSignedIn);
  const isClerkRetrying = Boolean(
    convexSetupError &&
      convexSetupError.toLowerCase().includes("clerk is temporarily unavailable")
  );
  const convexSetupBanner = isClerkRetrying
    ? "Clerk is temporarily unavailable. Retrying sign-in in about 15 seconds."
    : convexSetupError
      ? `Convex auth issue: ${convexSetupError}`
      : null;
  const autoProvisionRef = useRef(false);
  const orgSetupRef = useRef<string | null>(null);
  const allTeamEstimates = useMemo(() => {
    const list = activeTeam?.estimates ?? [];
    return [...list].sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    );
  }, [activeTeam?.estimates]);
  const teamProjects = useMemo(() => {
    const list = activeTeam?.projects ?? [];
    return [...list].sort((a, b) => {
      const left = b.updatedAt ?? b.createdAt ?? 0;
      const right = a.updatedAt ?? a.createdAt ?? 0;
      return left - right;
    });
  }, [activeTeam?.projects]);
  const unassignedTeamEstimates = useMemo(
    () =>
      allTeamEstimates.filter(
        (estimate) => !String(estimate?.project?.id ?? "").trim()
      ),
    [allTeamEstimates]
  );
  const activeProject = useMemo(() => {
    if (!activeProjectId || activeProjectId === UNASSIGNED_PROJECT_KEY) return null;
    return teamProjects.find((project) => project.id === activeProjectId) ?? null;
  }, [activeProjectId, teamProjects]);
  const teamEstimates = useMemo(() => {
    if (activeProjectId === UNASSIGNED_PROJECT_KEY) {
      return unassignedTeamEstimates;
    }
    if (!activeProject) return [];
    const list = activeProject?.estimates ?? [];
    return [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [activeProject, activeProjectId, unassignedTeamEstimates]);
  const filteredTeamEstimates = useMemo(() => {
    const query = teamEstimateQuery.trim().toLowerCase();
    const recentCutoff = Date.now() - 1000 * 60 * 60 * 24 * 14;
    return teamEstimates.filter((estimate) => {
      if (
        teamEstimateScope === "mine" &&
        estimate?.owner?.id !== convexUser?.id
      ) {
        return false;
      }
      if (
        teamEstimateScope === "recent" &&
        (estimate.updatedAt ?? 0) < recentCutoff
      ) {
        return false;
      }
      if (!query) return true;
      const title = String(estimate?.title ?? "")
        .trim()
        .toLowerCase();
      return title.includes(query);
    });
  }, [convexUser?.id, teamEstimateQuery, teamEstimateScope, teamEstimates]);
  const buildLegacyBaselineVersion = useCallback((estimate: any) => {
    if (!estimate || typeof estimate !== "object") return null;
    const payload =
      estimate.payload && typeof estimate.payload === "object"
        ? estimate.payload
        : null;
    if (!payload) return null;

    const baseline = createBaselineEstimateVersion({
      version: getCurrentEstimateVersion(estimate),
      createdAt: estimate.createdAt ?? estimate.updatedAt ?? Date.now(),
      title: String(estimate.title ?? "").trim() || "Untitled Estimate",
      payload,
      totals:
        estimate.totals && typeof estimate.totals === "object"
          ? estimate.totals
          : null,
      templateName:
        typeof estimate.templateName === "string" ? estimate.templateName : undefined,
      templateUrl:
        typeof estimate.templateUrl === "string" ? estimate.templateUrl : undefined,
      createdByUserId:
        typeof estimate.owner?.id === "string" ? estimate.owner.id : null,
    });
    return {
      ...baseline,
      id: `${String(estimate.id ?? "estimate")}-baseline`,
      pandadoc: undefined,
    };
  }, []);
  const getPersistedEstimateHistory = useCallback(
    (estimate: any) => {
      const existing = normalizeEstimateVersionHistory(estimate?.versionHistory);
      if (existing.length) return existing;
      const baseline = buildLegacyBaselineVersion(estimate);
      return baseline ? [baseline] : [];
    },
    [buildLegacyBaselineVersion]
  );
  const getEstimateHistoryForDisplay = useCallback(
    (estimate: any) => {
      const history = getPersistedEstimateHistory(estimate);
      return history
        .slice()
        .sort((a, b) =>
          a.version === b.version ? b.createdAt - a.createdAt : b.version - a.version
        );
    },
    [getPersistedEstimateHistory]
  );
  const getCurrentVersionForEstimate = useCallback(
    (estimate: any) =>
      getCurrentEstimateVersion({
        version: estimate?.version,
        versionHistory: getPersistedEstimateHistory(estimate),
      }),
    [getPersistedEstimateHistory]
  );
  const getLatestPandaDocDocumentForEstimate = useCallback(
    (estimate: any) => {
      const history = getPersistedEstimateHistory(estimate);
      for (let index = history.length - 1; index >= 0; index -= 1) {
        const candidate = history[index]?.pandadoc;
        const documentId = String(candidate?.documentId ?? "").trim();
        if (documentId) return candidate;
      }
      return undefined;
    },
    [getPersistedEstimateHistory]
  );
  const findTeamEstimateById = useCallback(
    (estimateId: string) =>
      allTeamEstimates.find((estimate) => estimate.id === estimateId) ?? null,
    [allTeamEstimates]
  );
  const activeEditingEstimate = useMemo(
    () =>
      editingEstimateId ? findTeamEstimateById(editingEstimateId) : null,
    [editingEstimateId, findTeamEstimateById]
  );
  const hasSelectedProject = Boolean(
    activeProjectId && activeProjectId !== UNASSIGNED_PROJECT_KEY
  );
  const activeEditingEstimateProjectId = String(
    activeEditingEstimate?.project?.id ?? ""
  ).trim();
  const floatingDockMoveOptions = useMemo(
    () =>
      teamProjects.filter((project) => project.id !== activeEditingEstimateProjectId),
    [activeEditingEstimateProjectId, teamProjects]
  );
  const activeTrackedPandaDocDocument = useMemo(
    () =>
      activeEditingEstimate
        ? getLatestPandaDocDocumentForEstimate(activeEditingEstimate)
        : undefined,
    [activeEditingEstimate, getLatestPandaDocDocumentForEstimate]
  );
  const activeTrackedDocumentId = String(
    activeTrackedPandaDocDocument?.documentId ?? ""
  ).trim();
  const activeTrackedDocumentStatus =
    linkedDocumentLive?.id === activeTrackedDocumentId
      ? linkedDocumentLive?.status
      : undefined;
  const resolvedTrackedDocumentStatus =
    activeTrackedDocumentStatus ?? activeTrackedPandaDocDocument?.status;
  const trackedDocumentIsArchived = Boolean(
    activeTrackedDocumentId &&
      resolvedTrackedDocumentStatus === "document.archived"
  );
  const trackedDocumentNeedsDraftRevert = Boolean(
    activeTrackedDocumentId &&
      resolvedTrackedDocumentStatus &&
      !trackedDocumentIsArchived &&
      resolvedTrackedDocumentStatus !== "document.draft"
  );
  const selectedHistoryEstimate = useMemo(
    () =>
      historyEstimateId ? findTeamEstimateById(historyEstimateId) : null,
    [findTeamEstimateById, historyEstimateId]
  );
  const selectedHistoryEntries = useMemo(
    () =>
      selectedHistoryEstimate
        ? getEstimateHistoryForDisplay(selectedHistoryEstimate)
        : [],
    [getEstimateHistoryForDisplay, selectedHistoryEstimate]
  );
  const selectedHistoryCurrentVersion = selectedHistoryEstimate
    ? getCurrentVersionForEstimate(selectedHistoryEstimate)
    : null;

  const vendorOptions = useMemo(
    () => catalogTeam?.vendors ?? [],
    [catalogTeam?.vendors]
  );
  const productFeatureOptions = useMemo(() => {
    const source = catalogTeam?.productFeatureOptions ?? [];
    const normalized: ProductFeatureOption[] = [];
    source.forEach((option, index) => {
      const category = String(option.category ?? "");
      if (!isProductFeatureCategory(category)) return;
      normalized.push({
        id: option.id,
        category,
        label: String(option.label ?? ""),
        vendorId:
          typeof option.vendorId === "string" ? option.vendorId : undefined,
        sortOrder:
          typeof option.sortOrder === "number" ? option.sortOrder : index + 1,
        isActive: option.isActive !== false,
      });
    });
    return normalized;
  }, [catalogTeam?.productFeatureOptions]);
  const panelTypeOptions = useMemo(() => {
    const list = (catalogTeam?.unitTypes ?? [])
      .filter((unit) => unit.isActive !== false && unit.code)
      .slice()
      .sort((a, b) => {
        const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 0;
        const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 0;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.code ?? "").localeCompare(String(b.code ?? ""));
      });
    return list.map((unit) => ({
      id: unit.code,
      label: unit.label ?? unit.code,
      price: typeof unit.price === "number" ? unit.price : 0,
    }));
  }, [catalogTeam?.unitTypes]);

  const manualEstimateProgress = useMemo(
    () => getManualEstimateProgress(estimatePayload, estimateValues),
    [estimatePayload, estimateValues]
  );
  const hasEstimateValues = manualEstimateProgress.complete;
  const hasEstimateInput = manualEstimateProgress.started;
  const canGenerate = Boolean(hasEstimateValues);
  const canDownloadPlanningLines = Boolean(
    estimatePayload || Object.keys(estimateValues).length
  );
  const progressSteps = useMemo(
    () => [
      { label: "Loading estimate values", value: 0.2 },
      { label: "Preparing PandaDoc variables", value: 0.45 },
      { label: "Formatting estimate fields", value: 0.58 },
      { label: "Creating or revising PandaDoc", value: 0.78 },
      { label: "Starting signing session", value: 0.9 },
    ],
    []
  );
  const resolveEstimateProjectId = useCallback(
    (estimate: any) => {
      if (activeProjectId && activeProjectId !== UNASSIGNED_PROJECT_KEY) {
        return activeProjectId;
      }
      const existingProjectId = String(estimate?.project?.id ?? "").trim();
      return existingProjectId || null;
    },
    [activeProjectId]
  );
  const addEstimateTag = useCallback(
    (rawTag: string) => {
      const tag = rawTag.trim().replace(/\s+/g, " ");
      if (!tag) return false;
      const exists = estimateTags.some(
        (entry) => entry.toLowerCase() === tag.toLowerCase()
      );
      if (exists) return false;
      setEstimateTags((previous) => [...previous, tag]);
      return true;
    },
    [estimateTags]
  );
  const removeEstimateTag = useCallback((tag: string) => {
    const normalized = tag.toLowerCase();
    setEstimateTags((previous) =>
      previous.filter((entry) => entry.toLowerCase() !== normalized)
    );
  }, []);

  useEffect(() => {
    if (!teamName && teamDomain) {
      const base = teamDomain.split(".")[0] || "Cornerstone";
      setTeamName(`${base.charAt(0).toUpperCase()}${base.slice(1)} Team`);
    }
  }, [teamDomain, teamName]);

  useEffect(() => {
    if (!memberTeams.length) {
      if (activeTeamId) {
        setActiveTeamId(null);
      }
      return;
    }
    if (!activeTeamId || !memberTeams.some((team) => team.id === activeTeamId)) {
      const nextId =
        memberTeams.find((team) => team.id === orgTeam?.id)?.id ??
        memberTeams[0]?.id ??
        null;
      if (nextId) {
        setActiveTeamId(nextId);
      }
    }
  }, [activeTeamId, memberTeams, orgTeam?.id]);

  useEffect(() => {
    const hasUnassigned = unassignedTeamEstimates.length > 0;
    if (!teamProjects.length && !hasUnassigned) {
      if (activeProjectId) {
        setActiveProjectId(null);
      }
      return;
    }
    if (
      activeProjectId &&
      (activeProjectId === UNASSIGNED_PROJECT_KEY ||
        teamProjects.some((project) => project.id === activeProjectId))
    ) {
      return;
    }
    const nextProjectId =
      teamProjects[0]?.id ?? (hasUnassigned ? UNASSIGNED_PROJECT_KEY : null);
    if (nextProjectId) {
      setActiveProjectId(nextProjectId);
    }
  }, [activeProjectId, teamProjects, unassignedTeamEstimates.length]);

  useEffect(() => {
    if (!floatingDockMoveOptions.length) {
      if (floatingDockMoveTargetId) {
        setFloatingDockMoveTargetId("");
      }
      return;
    }
    if (
      floatingDockMoveTargetId &&
      floatingDockMoveOptions.some((project) => project.id === floatingDockMoveTargetId)
    ) {
      return;
    }
    setFloatingDockMoveTargetId(floatingDockMoveOptions[0]?.id ?? "");
  }, [floatingDockMoveOptions, floatingDockMoveTargetId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const snapshot = {
      estimateName,
      estimateValues,
      estimatePayload,
      estimateTags,
      editingEstimateId,
      activeProjectId,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
  }, [
    activeProjectId,
    editingEstimateId,
    estimateName,
    estimatePayload,
    estimateTags,
    estimateValues,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;

    const hasLocalWork =
      Boolean(estimateName.trim()) ||
      Boolean(estimatePayload) ||
      Object.keys(estimateValues).length > 0 ||
      estimateTags.length > 0 ||
      Boolean(editingEstimateId);
    if (hasLocalWork) return;

    const raw = window.localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        estimateName?: string;
        estimateValues?: Record<string, string | number>;
        estimatePayload?: Record<string, any> | null;
        estimateTags?: string[];
        editingEstimateId?: string | null;
        activeProjectId?: string | null;
      };
      const restoredName = String(parsed?.estimateName ?? "").trim();
      const restoredValues =
        parsed?.estimateValues && typeof parsed.estimateValues === "object"
          ? parsed.estimateValues
          : {};
      const restoredPayload =
        parsed?.estimatePayload && typeof parsed.estimatePayload === "object"
          ? parsed.estimatePayload
          : null;
      const restoredTags = normalizeEstimateTags(parsed?.estimateTags);
      const restoredEditingEstimateId = String(
        parsed?.editingEstimateId ?? ""
      ).trim();
      const restoredActiveProjectId = String(parsed?.activeProjectId ?? "").trim();
      const hasRestoredData =
        Boolean(restoredName) ||
        Object.keys(restoredValues).length > 0 ||
        Boolean(restoredPayload) ||
        restoredTags.length > 0 ||
        Boolean(restoredEditingEstimateId);
      if (!hasRestoredData) return;

      setEstimateName(restoredName);
      setEstimateValues(restoredValues);
      setEstimatePayload(restoredPayload);
      setLoadedEstimatePayload(restoredPayload);
      setEstimateTags(restoredTags);
      if (restoredEditingEstimateId) {
        setEditingEstimateId(restoredEditingEstimateId);
      }
      if (restoredActiveProjectId) {
        setActiveProjectId(restoredActiveProjectId);
      }
      setProjectActionNotice("Restored your last unsaved estimate draft.");
    } catch {
      window.localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
    }
  }, [editingEstimateId, estimateName, estimatePayload, estimateTags, estimateValues]);

  useEffect(() => {
    if (!historyEstimateId) return;
    if (allTeamEstimates.some((estimate) => estimate.id === historyEstimateId)) {
      return;
    }
    setHistoryEstimateId(null);
    setHistoryError(null);
  }, [allTeamEstimates, historyEstimateId]);

  useEffect(() => {
    if (!estimatePayload && !loadedEstimatePayload) {
      setEditingEstimateId(null);
    }
  }, [estimatePayload, loadedEstimatePayload]);

  useEffect(() => {
    if (!editingEstimateId) return;
    if (estimatePayload || loadedEstimatePayload) return;
    const estimate = findTeamEstimateById(editingEstimateId);
    if (!estimate) return;

    setEstimateName(String(estimate?.title ?? ""));
    setLoadedEstimatePayload(estimate?.payload ?? null);
    setEstimateTags(normalizeEstimateTags(estimate?.tags));
    setEstimateTagInput("");
    const linkedProjectId = String(estimate?.project?.id ?? "").trim();
    setActiveProjectId(linkedProjectId || UNASSIGNED_PROJECT_KEY);
    setHistoryEstimateId(estimate?.id ?? null);
  }, [
    editingEstimateId,
    estimatePayload,
    loadedEstimatePayload,
    findTeamEstimateById,
  ]);

  useEffect(() => {
    if (!activeTrackedDocumentId) {
      setLinkedDocumentLive(null);
      return;
    }

    let cancelled = false;
    setLinkedDocumentLive((previous) => ({
      id: activeTrackedDocumentId,
      name:
        previous?.id === activeTrackedDocumentId
          ? previous.name
          : activeTrackedPandaDocDocument?.name,
      status:
        previous?.id === activeTrackedDocumentId
          ? previous.status
          : activeTrackedPandaDocDocument?.status,
      loading: true,
      error: null,
    }));

    void (async () => {
      try {
        const response = await fetch(
          `/api/pandadoc/documents/${encodeURIComponent(activeTrackedDocumentId)}`,
          {
            cache: "no-store",
          }
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || "Failed to load PandaDoc status.");
        }
        if (cancelled) return;
        setLinkedDocumentLive({
          id: activeTrackedDocumentId,
          name: String(data?.document?.name ?? "").trim() || undefined,
          status: String(data?.document?.status ?? "").trim() || undefined,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unknown error.";
        setLinkedDocumentLive((previous) => ({
          id: activeTrackedDocumentId,
          name:
            previous?.id === activeTrackedDocumentId
              ? previous.name
              : activeTrackedPandaDocDocument?.name,
          status:
            previous?.id === activeTrackedDocumentId
              ? previous.status
              : activeTrackedPandaDocDocument?.status,
          loading: false,
          error: message,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeTrackedDocumentId,
    activeTrackedPandaDocDocument?.name,
    activeTrackedPandaDocDocument?.status,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setKnownOrgTeamId(localStorage.getItem("cstone-org-team-id"));
    setKnownOrgTeamDomain(localStorage.getItem("cstone-org-team-domain"));
    setKnownOrgLookupLoaded(true);
  }, []);

  useEffect(() => {
    if (!orgTeam?.id) return;
    if (typeof window === "undefined") return;
    localStorage.setItem("cstone-org-team-id", orgTeam.id);
    localStorage.setItem("cstone-org-team-domain", orgTeam.domain ?? teamDomain);
    setKnownOrgTeamId(orgTeam.id);
    setKnownOrgTeamDomain(orgTeam.domain ?? teamDomain);
  }, [orgTeam?.id, orgTeam?.domain, teamDomain]);

  useEffect(() => {
    if (!orgTeam) return;
    if (!convexUser?.id) return;
    if (!isPrimaryOwner) return;
    if (!orgMembership) return;
    const needsPrimary = !orgTeam.isPrimary;
    const needsRoot = Boolean(orgTeam.parentTeamId);
    const needsOwner = orgTeam.ownerId !== convexUser.id;
    const needsRole = orgMembership.role !== "owner";
    if (!needsPrimary && !needsRoot && !needsOwner && !needsRole) return;
    if (orgSetupRef.current === orgTeam.id) return;
    orgSetupRef.current = orgTeam.id;
    const updates = [
      db.tx.teams[orgTeam.id].update({
        ...(needsPrimary ? { isPrimary: true } : {}),
        ...(needsRoot ? { parentTeamId: null } : {}),
        ...(needsOwner ? { ownerId: convexUser.id } : {}),
      }),
      ...(needsRole
        ? [db.tx.memberships[orgMembership.id].update({ role: "owner" })]
        : []),
    ];
    void db.transact(updates).catch(() => {
      orgSetupRef.current = null;
    });
  }, [db, convexUser?.id, isPrimaryOwner, orgMembership, orgTeam]);

  useEffect(() => {
    if (!convexAppUrl) return;
    if (!authLoaded || !isSignedIn) return;
    if (!knownOrgLookupLoaded) return;
    if (!convexUser) return;
    if (convexLoading) return;
    if (teamReady) return;
    if (!teamData) return;
    if (teamLoading || teamQueryError) return;
    if (teamSaving || teamSetupAction !== "idle" || teamSetupPending) return;
    if (autoProvisionRef.current) return;
    if (!teamDomain) {
      setTeamError("Missing an allowed email domain.");
      return;
    }

    autoProvisionRef.current = true;
    setTeamError(null);

    if (!orgTeam) {
      if (!isPrimaryOwner) {
        setTeamError(
          "Organization workspace has not been created yet. Ask the org owner to create it."
        );
        autoProvisionRef.current = false;
        return;
      }
      void (async () => {
        try {
          const existingTeams = await checkExistingOrgWorkspace();
          if (!existingTeams) {
            return;
          }
          if (existingTeams.length > 0) {
            setTeamError(
              "We found an existing organization workspace. Please wait while it syncs."
            );
            return;
          }
          if (knownOrgTeamId && knownOrgTeamDomain === teamDomain) {
            setTeamError(
              "We couldn't load your existing org workspace. Refresh and try again."
            );
            return;
          }
          await handleCreateTeam();
        } finally {
          autoProvisionRef.current = false;
        }
      })();
      return;
    }

    if (orgTeam && !orgMembership) {
      void handleJoinTeam().finally(() => {
        autoProvisionRef.current = false;
      });
      return;
    }

    autoProvisionRef.current = false;
  }, [
    authLoaded,
    orgMembership,
    orgTeam,
    orgTeam?.id,
    convexAppUrl,
    convexLoading,
    convexUser,
    isSignedIn,
    teamData,
    teamLoading,
    teamQueryError,
    teamDomain,
    teamReady,
    teamSaving,
    teamSetupAction,
    teamSetupPending,
    knownOrgTeamId,
    knownOrgTeamDomain,
    knownOrgLookupLoaded,
    isPrimaryOwner,
    primaryOwnerEmail,
  ]);

  useEffect(() => {
    if (!teamQueryError) return;
    const message =
      teamQueryError instanceof Error
        ? teamQueryError.message
        : "Unable to load team data.";
    setTeamError(message);
  }, [teamQueryError]);

  useEffect(() => {
    if (!teamSetupPending) return;
    if (teamReady || teamError) {
      setTeamSetupPending(false);
      setTeamSetupAction("idle");
    }
  }, [teamError, teamReady, teamSetupPending]);

  useEffect(() => {
    return () => {
      if (progressResetTimeoutRef.current !== null) {
        window.clearTimeout(progressResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isGenerating) return;

    let stepIndex = 0;
    setProgress((prev) => Math.max(prev, progressSteps[0].value));
    setProgressLabel(progressSteps[0].label);

    const interval = window.setInterval(() => {
      stepIndex += 1;
      if (stepIndex >= progressSteps.length) {
        window.clearInterval(interval);
        return;
      }
      setProgress((prev) => Math.max(prev, progressSteps[stepIndex].value));
      setProgressLabel(progressSteps[stepIndex].label);
    }, 900);

    return () => window.clearInterval(interval);
  }, [isGenerating, progressSteps]);

  const status = useMemo(() => {
    if (isGenerating) {
      return {
        label: "Generating PandaDoc",
        helper: "Creating or revising the document and preparing signing.",
        tone: "loading" as const,
      };
    }

    if (canGenerate) {
      return {
        label: "Ready to generate",
        helper: "Estimate is ready.",
        tone: "ready" as const,
      };
    }

    return {
      label: "Awaiting estimate",
      helper: "Enter estimate details.",
      tone: "idle" as const,
    };
  }, [isGenerating, canGenerate]);

  const statusClassName = cn(
    "border px-4 py-1 text-[10px] tracking-[0.32em]",
    status.tone === "loading" &&
      "border-accent/40 bg-accent/20 text-accent-foreground",
    status.tone === "ready" && "border-white/40 bg-white/10 text-white",
    status.tone === "idle" && "border-white/20 bg-white/5 text-white/70"
  );

  const workflowMilestones = [
    {
      id: "input",
      label: "Manual estimate is complete",
      done: hasEstimateValues,
    },
    {
      id: "generate",
      label: "PandaDoc is ready to generate",
      done: canGenerate,
    },
  ] as const;
  const workflowPercent = Math.round(
    (workflowMilestones.filter((item) => item.done).length /
      workflowMilestones.length) *
      100
  );
  const progressPercent = Math.max(0, Math.min(Math.round(progress * 100), 100));

  const buildCurrentEstimateSnapshot = useCallback((): EstimateSnapshot => {
    const payload =
      estimatePayload ??
      (Object.keys(estimateValues).length ? { values: estimateValues } : null);
    const title = estimateName.trim() || "Untitled Estimate";
    const totals =
      payload &&
      typeof payload === "object" &&
      payload.totals &&
      typeof payload.totals === "object"
        ? payload.totals
        : null;
    return {
      title,
      payload,
      totals,
      templateName: templateConfig?.name,
      templateUrl: undefined,
    };
  }, [
    estimateName,
    estimatePayload,
    estimateValues,
    templateConfig?.name,
  ]);
  const resetEstimateWorkspace = useCallback(() => {
    setLoadedEstimatePayload(null);
    setSelectedEstimate(null);
    setEditingEstimateId(null);
    setHistoryEstimateId(null);
    setHistoryError(null);
    setEstimateName("");
    setEstimateValues({});
    setEstimatePayload(null);
    setEstimateTags([]);
    setEstimateTagInput("");
    setProjectActionNotice("Started a new estimate.");
  }, []);

  const persistGeneratedEstimateVersion = useCallback(
    async (generation?: PandaDocGenerationResponse | null) => {
      if (!convexAppUrl || !convexUser || !activeTeam || !activeMembership) return;
      const snapshot = buildCurrentEstimateSnapshot();
      if (!snapshot.payload) return;

      const now = Date.now();
      const tags = normalizeEstimateTags(estimateTags);
      const pandadocDocument = toPandaDocVersionDocument(generation, now);
      if (editingEstimateId) {
        const existingEstimate = findTeamEstimateById(editingEstimateId);
        const targetProjectId = resolveEstimateProjectId(existingEstimate);
        const estimateLinks = {
          team: activeTeam.id,
          owner: convexUser.id,
          ...(targetProjectId ? { project: targetProjectId } : {}),
        };
        const previousPandaDoc =
          existingEstimate &&
          getLatestPandaDocDocumentForEstimate(existingEstimate);
        const previousDocumentId = String(previousPandaDoc?.documentId ?? "").trim();
        const currentDocumentId = String(pandadocDocument?.documentId ?? "").trim();
        const hasTrackedDocumentChanged = Boolean(
          currentDocumentId && currentDocumentId !== previousDocumentId
        );
        const shouldCreateNewVersion =
          hasEstimateSnapshotChanges(existingEstimate, snapshot) ||
          hasTrackedDocumentChanged;
        if (!shouldCreateNewVersion) {
          const operations = [
            db.tx.estimates[editingEstimateId]
              .update({
                status: "generated",
                updatedAt: now,
                lastGeneratedAt: now,
                templateName: snapshot.templateName,
                templateUrl: snapshot.templateUrl,
                tags,
              })
              .link(estimateLinks),
            ...(targetProjectId
              ? [db.tx.projects[targetProjectId].update({ updatedAt: now })]
              : []),
          ];
          await db.transact(operations);
          return;
        }
        const history = existingEstimate
          ? getPersistedEstimateHistory(existingEstimate)
          : [];
        const versioned = appendEstimateVersion(history, {
          action: "generated",
          createdAt: now,
          title: snapshot.title,
          payload: snapshot.payload,
          totals: snapshot.totals,
          templateName: snapshot.templateName,
          templateUrl: snapshot.templateUrl,
          createdByUserId: convexUser.id,
          pandadoc: pandadocDocument,
        });
        const operations = [
          db.tx.estimates[editingEstimateId]
            .update({
              title: snapshot.title,
              status: "generated",
              updatedAt: now,
              lastGeneratedAt: now,
              templateName: snapshot.templateName,
              templateUrl: snapshot.templateUrl,
              payload: snapshot.payload,
              totals: snapshot.totals,
              version: versioned.currentVersion,
              versionHistory: versioned.history,
              tags,
            })
            .link(estimateLinks),
          ...(targetProjectId
            ? [db.tx.projects[targetProjectId].update({ updatedAt: now })]
            : []),
        ];
        await db.transact(operations);
        return;
      }

      const targetProjectId = resolveEstimateProjectId(null);
      const estimateLinks = {
        team: activeTeam.id,
        owner: convexUser.id,
        ...(targetProjectId ? { project: targetProjectId } : {}),
      };
      const estimateId = id();
      const versioned = appendEstimateVersion([], {
        action: "generated",
        createdAt: now,
        title: snapshot.title,
        payload: snapshot.payload,
        totals: snapshot.totals,
        templateName: snapshot.templateName,
        templateUrl: snapshot.templateUrl,
        createdByUserId: convexUser.id,
        pandadoc: pandadocDocument,
      });
      const operations = [
        db.tx.estimates[estimateId]
          .create({
            title: snapshot.title,
            status: "generated",
            createdAt: now,
            updatedAt: now,
            lastGeneratedAt: now,
            templateName: snapshot.templateName,
            templateUrl: snapshot.templateUrl,
            payload: snapshot.payload,
            totals: snapshot.totals,
            version: versioned.currentVersion,
            versionHistory: versioned.history,
            tags,
          })
          .link(estimateLinks),
        ...(targetProjectId
          ? [db.tx.projects[targetProjectId].update({ updatedAt: now })]
          : []),
      ];
      await db.transact(operations);
      setActiveProjectId(targetProjectId ?? UNASSIGNED_PROJECT_KEY);
      setEditingEstimateId(estimateId);
    },
    [
      activeMembership,
      activeTeam,
      buildCurrentEstimateSnapshot,
      estimateTags,
      editingEstimateId,
      findTeamEstimateById,
      getLatestPandaDocDocumentForEstimate,
      getPersistedEstimateHistory,
      convexAppUrl,
      convexUser,
      resolveEstimateProjectId,
    ]
  );

  const buildPlanningLinesRequestBody = (format: string) => {
    const estimateSource =
      estimatePayload ??
      (Object.keys(estimateValues).length
        ? {
            name: estimateName.trim(),
            values: estimateValues,
          }
        : null);

    if (!estimateSource) {
      throw new Error("Complete a manual estimate first.");
    }

    return {
      estimate: estimateSource,
      format,
    };
  };

  const fetchPlanningLinesPasteRows = async () => {
    const response = await fetch("/api/planning-lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPlanningLinesRequestBody("tsv_rows")),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "Failed to build planning lines.");
    }

    return response.text();
  };

  const copyTextToClipboard = async (text: string) => {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(text);
      return;
    }

    if (typeof document === "undefined") {
      throw new Error("Clipboard access is not available.");
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!success) {
      throw new Error("Clipboard copy failed.");
    }
  };

  const handleCopyPlanningLines = async () => {
    setError(null);

    setIsPlanningLinesCopying(true);
    try {
      const text = await fetchPlanningLinesPasteRows();
      await copyTextToClipboard(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsPlanningLinesCopying(false);
    }
  };

  const handleGenerate = async () => {
    setError(null);
    setLastGeneration(null);
    if (!hasEstimateValues) {
      setError("Enter at least one estimate value or load a saved estimate.");
      return;
    }

    const mappingOverride = templateConfig?.mapping;
    const templatePandaDocConfig = templateConfig?.pandadoc;
    const templateBindings = Array.isArray(templatePandaDocConfig?.bindings)
      ? templatePandaDocConfig.bindings
      : [];
    const templateRecipientRole = String(
      templatePandaDocConfig?.recipientRole ?? ""
    ).trim();
    const templateUuid = String(templatePandaDocConfig?.templateUuid ?? "").trim();
    const trackedDocumentId = String(
      activeTrackedPandaDocDocument?.documentId ?? ""
    ).trim();
    const trackedRecipientEmail = String(
      activeTrackedPandaDocDocument?.recipientEmail ?? ""
    ).trim();
    const trackedRecipientFirstName = String(
      activeTrackedPandaDocDocument?.recipientFirstName ?? ""
    ).trim();
    const trackedRecipientLastName = String(
      activeTrackedPandaDocDocument?.recipientLastName ?? ""
    ).trim();
    const trackedRecipientRole = String(
      activeTrackedPandaDocDocument?.recipientRole ?? templateRecipientRole
    ).trim();
    const defaultSignerRole = pandadocSignerRole || trackedRecipientRole || templateRecipientRole;
    const signerEmail = trackedRecipientEmail || emailAddress;
    const fallbackNameSegments = preparedByName.split(/\s+/).filter(Boolean);
    const fallbackFirstName = fallbackNameSegments[0] ?? "";
    const fallbackLastName = fallbackNameSegments.slice(1).join(" ");
    const signerFirstName =
      trackedRecipientFirstName || user?.firstName?.trim() || fallbackFirstName;
    const signerLastName =
      trackedRecipientLastName || user?.lastName?.trim() || fallbackLastName;
    const generationRecipient = signerEmail
      ? {
          email: signerEmail,
          firstName: signerFirstName || undefined,
          lastName: signerLastName || undefined,
          role: defaultSignerRole || undefined,
        }
      : undefined;
    let generationSucceeded = false;

    if (progressResetTimeoutRef.current !== null) {
      window.clearTimeout(progressResetTimeoutRef.current);
      progressResetTimeoutRef.current = null;
    }
    setShowProgress(true);
    setIsGenerating(true);
    setProgress(0.1);
    setProgressLabel("Starting generation");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mappingOverride,
          estimate: {
            ...(estimatePayload ?? {}),
            name: estimateName.trim(),
            values:
              estimatePayload?.values ??
              (Object.keys(estimateValues).length ? estimateValues : undefined),
          },
          pandadoc: {
            templateUuid: templateUuid || undefined,
            recipientRole:
              generationRecipient?.role ? undefined : templateRecipientRole || undefined,
            recipient: generationRecipient,
            bindings: templateBindings,
            documentId: trackedDocumentId || undefined,
            allowCreateFallback: true,
            createSession: false,
            send: false,
          },
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        let message = "Failed to generate PandaDoc document.";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          message = data?.error || message;
        } else {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      const data = (await response.json()) as PandaDocGenerationResponse;
      setLastGeneration(data);
      if (data.document?.id) {
        setLinkedDocumentLive({
          id: data.document.id,
          name: data.document.name,
          status: data.document.status,
          loading: false,
          error: null,
        });
      }

      const launchUrl =
        data.session?.url ||
        data.document?.sharedLink ||
        data.document?.appUrl;
      if (launchUrl) {
        window.open(launchUrl, "_blank", "noopener,noreferrer");
      }

      setProgress(1);
      setProgressLabel(
        data.operation === "updated" ? "PandaDoc revised" : "PandaDoc ready"
      );
      generationSucceeded = true;

      try {
        await persistGeneratedEstimateVersion(data);
      } catch (historyErr) {
        const message =
          historyErr instanceof Error
            ? historyErr.message
            : "Unable to save generated version.";
        setError(
          `PandaDoc completed, but version history update failed: ${message}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
      setProgressLabel("Generation failed");
    } finally {
      setIsGenerating(false);
      progressResetTimeoutRef.current = window.setTimeout(() => {
        setShowProgress(false);
        setProgress(0);
        setProgressLabel(null);
        progressResetTimeoutRef.current = null;
      }, generationSucceeded ? 1200 : 300);
    }
  };

  const handleSaveEstimateToDb = async () => {
    setError(null);
    if (!convexAppUrl) {
      setError("Convex is not configured yet.");
      return;
    }
    if (!convexUser) {
      setError("Sign in to save estimates.");
      return;
    }
    if (!activeTeam || !activeMembership) {
      setError("Select a team to save estimates.");
      return;
    }
    if (!estimatePayload && !Object.keys(estimateValues).length) {
      setError("Enter estimate values before saving.");
      return;
    }

    const now = Date.now();
    const payload = estimatePayload ?? { values: estimateValues };
    const title = estimateName.trim() || "Untitled Estimate";
    const totals =
      payload.totals && typeof payload.totals === "object" ? payload.totals : null;
    const tags = normalizeEstimateTags(estimateTags);
    const templateName = templateConfig?.name;
    const templateUrl = undefined;

    try {
      if (editingEstimateId) {
        const existingEstimate = findTeamEstimateById(editingEstimateId);
        const targetProjectId = resolveEstimateProjectId(existingEstimate);
        if (!targetProjectId) {
          setError("Create or select a project before saving estimates.");
          return;
        }
        const history = existingEstimate
          ? getPersistedEstimateHistory(existingEstimate)
          : [];
        const versioned = appendEstimateVersion(history, {
          action: "updated",
          createdAt: now,
          title,
          payload,
          totals,
          templateName,
          templateUrl,
          createdByUserId: convexUser.id,
        });
        await db.transact([
          db.tx.estimates[editingEstimateId]
            .update({
              title,
              status: "draft",
              updatedAt: now,
              templateName,
              templateUrl,
              payload,
              totals,
              version: versioned.currentVersion,
              versionHistory: versioned.history,
              tags,
            })
            .link({
              team: activeTeam.id,
              owner: convexUser.id,
              project: targetProjectId,
            }),
          db.tx.projects[targetProjectId].update({ updatedAt: now }),
        ]);
        setProjectActionNotice(`Updated "${title}" in the active project.`);
        return;
      }

      const targetProjectId = resolveEstimateProjectId(null);
      if (!targetProjectId) {
        setError("Create or select a project before saving estimates.");
        return;
      }
      const estimateId = id();
      const versioned = appendEstimateVersion([], {
        action: "created",
        createdAt: now,
        title,
        payload,
        totals,
        templateName,
        templateUrl,
        createdByUserId: convexUser.id,
      });
      await db.transact([
        db.tx.estimates[estimateId]
          .create({
            title,
            status: "draft",
            createdAt: now,
            updatedAt: now,
            templateName,
            templateUrl,
            payload,
            totals,
            version: versioned.currentVersion,
            versionHistory: versioned.history,
            tags,
          })
          .link({
            team: activeTeam.id,
            owner: convexUser.id,
            project: targetProjectId,
          }),
        db.tx.projects[targetProjectId].update({ updatedAt: now }),
      ]);
      setEditingEstimateId(estimateId);
      setProjectActionNotice(`Saved "${title}" to the active project.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  };

  const handleRenameCurrentEstimate = useCallback(
    (nextName: string) => {
      const normalized = nextName.trim();
      if (!normalized) {
        setError("Estimate name can't be empty.");
        return false;
      }
      setEstimateName(normalized);
      setProjectActionNotice(`Renamed estimate to "${normalized}".`);
      setDockRenameEstimateOpen(false);
      return true;
    },
    []
  );

  const handleRenameActiveProject = useCallback(async () => {
    setError(null);
    if (!convexAppUrl) {
      setError("Convex is not configured yet.");
      return;
    }
    if (!convexUser) {
      setError("Sign in to rename projects.");
      return;
    }
    if (!activeTeam || !activeMembership) {
      setError("Select a team workspace first.");
      return;
    }
    if (!activeProject) {
      setError("Select a project to rename.");
      return;
    }

    const current = String(activeProject.name ?? "").trim();
    const normalized = dockRenameProjectValue.trim();
    if (!normalized || normalized === current) return;

    try {
      const now = Date.now();
      await db.transact(
        db.tx.projects[activeProject.id].update({
          name: normalized,
          updatedAt: now,
        })
      );
      setProjectActionNotice(`Renamed project to "${normalized}".`);
      setDockRenameProjectOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  }, [
    dockRenameProjectValue,
    activeMembership,
    activeProject,
    activeTeam,
    convexAppUrl,
    convexUser,
  ]);

  const handleMoveEstimateToProject = useCallback(
    async (estimate: any, targetProjectId: string) => {
      setError(null);
      if (!convexAppUrl) {
        setError("Convex is not configured yet.");
        return;
      }
      if (!convexUser) {
        setError("Sign in to move estimates.");
        return;
      }
      if (!activeTeam || !activeMembership) {
        setError("Select a team workspace first.");
        return;
      }
      const estimateId = String(estimate?.id ?? "").trim();
      if (!estimateId) {
        setError("Select an estimate to move.");
        return;
      }
      const destinationProject = teamProjects.find(
        (project) => project.id === targetProjectId
      );
      if (!destinationProject) {
        setError("Choose a valid destination project.");
        return;
      }
      const sourceProjectId = String(estimate?.project?.id ?? "").trim();
      if (sourceProjectId === targetProjectId) return;

      setMovingEstimateId(estimateId);
      try {
        const now = Date.now();
        const operations = [
          db.tx.estimates[estimateId]
            .update({ updatedAt: now })
            .link({
              team: activeTeam.id,
              owner: convexUser.id,
              project: targetProjectId,
            }),
          db.tx.projects[targetProjectId].update({ updatedAt: now }),
          ...(sourceProjectId && sourceProjectId !== targetProjectId
            ? [db.tx.projects[sourceProjectId].update({ updatedAt: now })]
            : []),
        ];
        await db.transact(operations);

        setMoveTargetByEstimateId((previous) => {
          const next = { ...previous };
          delete next[estimateId];
          return next;
        });
        if (editingEstimateId === estimateId) {
          setActiveProjectId(targetProjectId);
        }
        const estimateTitle = String(estimate?.title ?? "").trim() || "Estimate";
        setProjectActionNotice(
          `Moved "${estimateTitle}" to "${destinationProject.name}".`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        setError(message);
      } finally {
        setMovingEstimateId(null);
      }
    },
    [
      activeMembership,
      activeTeam,
      convexAppUrl,
      convexUser,
      editingEstimateId,
      teamProjects,
    ]
  );

  const handleMoveEditingEstimateToProject = useCallback(async () => {
    if (!activeEditingEstimate) {
      setError("Load an estimate before moving it.");
      return;
    }
    if (!floatingDockMoveTargetId) {
      setError("Choose a destination project in the action dock.");
      return;
    }
    await handleMoveEstimateToProject(activeEditingEstimate, floatingDockMoveTargetId);
  }, [activeEditingEstimate, floatingDockMoveTargetId, handleMoveEstimateToProject]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const withModifier = event.metaKey || event.ctrlKey;
      if (!withModifier) return;

      if (key === "s") {
        event.preventDefault();
        if (!hasSelectedProject) {
          setError("Select or create a project before saving estimates.");
          return;
        }
        void handleSaveEstimateToDb();
        return;
      }

      if (key === "enter") {
        event.preventDefault();
        void handleGenerate();
        return;
      }

      if (event.shiftKey && key === "n") {
        event.preventDefault();
        resetEstimateWorkspace();
        return;
      }

      if (key === ".") {
        event.preventDefault();
        setFloatingDockOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleGenerate,
    hasSelectedProject,
    handleSaveEstimateToDb,
    resetEstimateWorkspace,
  ]);

  useEffect(() => {
    if (!floatingDockOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFloatingDockOpen(false);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [floatingDockOpen]);

  useEffect(() => {
    if (floatingDockOpen) return;
    setDockRenameEstimateOpen(false);
    setDockRenameProjectOpen(false);
    setDockCreateProjectOpen(false);
  }, [floatingDockOpen]);

  const handleOpenActiveEstimateHistory = useCallback(() => {
    if (!activeEditingEstimate) {
      setError("Load an estimate to inspect version history.");
      return;
    }
    setHistoryEstimateId(activeEditingEstimate.id);
    setProjectActionNotice("Version history opened.");
  }, [activeEditingEstimate]);

  const handleCreateProjectFromDock = useCallback(async () => {
    setError(null);
    if (!convexAppUrl) {
      setError("Convex is not configured yet.");
      return;
    }
    if (!convexUser) {
      setError("Sign in to create projects.");
      return;
    }
    if (!activeTeam || !activeMembership) {
      setError("Select a team workspace first.");
      return;
    }

    const normalized = dockCreateProjectValue.trim();
    if (!normalized) {
      setError("Enter a project name.");
      return;
    }

    try {
      const now = Date.now();
      const projectId = id();
      await db.transact(
        db.tx.projects[projectId]
          .create({
            name: normalized,
            status: "active",
            createdAt: now,
            updatedAt: now,
          })
          .link({ team: activeTeam.id, owner: convexUser.id })
      );
      setActiveProjectId(projectId);
      setProjectActionNotice(`Created project "${normalized}".`);
      setDockCreateProjectOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  }, [
    dockCreateProjectValue,
    activeMembership,
    activeTeam,
    convexAppUrl,
    convexUser,
  ]);

  const openDockRenameEstimate = useCallback(() => {
    setDockRenameEstimateValue(estimateName.trim() || "Untitled Estimate");
    setDockRenameEstimateOpen(true);
  }, [estimateName]);

  const openDockRenameProject = useCallback(() => {
    setDockRenameProjectValue(String(activeProject?.name ?? "").trim());
    setDockRenameProjectOpen(true);
  }, [activeProject?.name]);

  const openDockCreateProject = useCallback(() => {
    const suggestedName =
      estimateName.trim() ||
      activeEditingEstimate?.title ||
      activeProject?.name ||
      "New Project";
    setDockCreateProjectValue(suggestedName);
    setDockCreateProjectOpen(true);
  }, [activeEditingEstimate?.title, activeProject?.name, estimateName]);

  const handleCreateProject = async () => {
    setError(null);
    if (!convexAppUrl) {
      setError("Convex is not configured yet.");
      return;
    }
    if (!convexUser) {
      setError("Sign in to create projects.");
      return;
    }
    if (!activeTeam || !activeMembership) {
      setError("Select a team workspace first.");
      return;
    }
    const name = newProjectName.trim();
    if (!name) {
      setError("Enter a project name.");
      return;
    }

    setIsCreatingProject(true);
    try {
      const now = Date.now();
      const projectId = id();
      await db.transact(
        db.tx.projects[projectId]
          .create({
            name,
            status: "active",
            createdAt: now,
            updatedAt: now,
          })
          .link({ team: activeTeam.id, owner: convexUser.id })
      );
      setActiveProjectId(projectId);
      setNewProjectName("");
      setProjectActionNotice(`Created project "${name}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleCreateTeam = async () => {
    setTeamError(null);
    if (!convexAppUrl) {
      setTeamError("Convex is not configured yet.");
      return;
    }
    if (!convexUser) {
      setTeamError("Sign in to create a team workspace.");
      return;
    }
    if (!teamDomain) {
      setTeamError("Missing an allowed email domain.");
      return;
    }
    const now = Date.now();
    const teamId = id();
    const membershipId = id();
    const trimmedName =
      preferredOrgTeamName || teamName.trim() || `${teamDomain} Team`;
    const role = "owner";

    setTeamSaving(true);
    setTeamSetupPending(true);
    setTeamSetupAction("creating");
    try {
      await db.transact([
        db.tx.teams[teamId].create({
          name: trimmedName,
          domain: teamDomain,
          createdAt: now,
          isPrimary: true,
          ownerId: convexUser.id,
        }),
        db.tx.memberships[membershipId]
          .create({ role, createdAt: now })
          .link({ team: teamId, user: convexUser.id }),
      ]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : JSON.stringify(err ?? {});
      setTeamError(message || "Unknown error.");
    } finally {
      setTeamSaving(false);
    }
  };

  const handleJoinTeam = async () => {
    setTeamError(null);
    if (!convexAppUrl) {
      setTeamError("Convex is not configured yet.");
      return;
    }
    if (!convexUser || !orgTeam) return;
    const now = Date.now();
    const membershipId = id();
    const role = isPrimaryOwner ? "owner" : "member";
    setTeamSaving(true);
    setTeamSetupPending(true);
    setTeamSetupAction("joining");
    try {
      await db.transact(
        db.tx.memberships[membershipId]
          .create({ role, createdAt: now })
          .link({ team: orgTeam.id, user: convexUser.id })
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : JSON.stringify(err ?? {});
      setTeamError(message || "Unknown error.");
    } finally {
      setTeamSaving(false);
    }
  };

  const checkExistingOrgWorkspace = useCallback(async () => {
    if (!convexAppUrl || !teamDomain) return [];
    try {
      const snapshot = (await db.queryOnce({
        teams: {
          $: {
            where: { domain: teamLookupDomain },
            order: { createdAt: "desc" as const },
          },
        },
      })) as
        | {
            teams?: Array<{
              id: string;
              parentTeamId?: string | null;
              isPrimary?: boolean | null;
            }>;
          }
        | undefined;
      const existing = Array.isArray(snapshot?.teams) ? snapshot.teams : [];
      return existing.filter((team) => !team.parentTeamId || team.isPrimary);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to verify existing workspace.";
      setTeamError(message);
      return null;
    }
  }, [convexAppUrl, teamDomain, teamLookupDomain]);

  const handleRetryTeamSetup = () => {
    if (!orgTeam) {
      if (!isPrimaryOwner) {
        setTeamError(
          "Organization workspace has not been created yet. Ask the org owner to create it."
        );
        return;
      }
      void (async () => {
        const existingTeams = await checkExistingOrgWorkspace();
        if (!existingTeams) return;
        if (existingTeams.length > 0) {
          setTeamError(
            "We found an existing organization workspace. Please wait while it syncs."
          );
          return;
        }
        await handleCreateTeam();
      })();
      return;
    }
    if (orgTeam && !orgMembership) {
      void handleJoinTeam();
    }
  };

  const handleLoadTeamEstimate = (estimate: any) => {
    setError(null);
    setHistoryError(null);
    setEstimateName(estimate?.title ?? "");
    setLoadedEstimatePayload(estimate?.payload ?? null);
    setEstimateTags(normalizeEstimateTags(estimate?.tags));
    setEstimateTagInput("");
    const linkedProjectId = String(estimate?.project?.id ?? "").trim();
    setActiveProjectId(linkedProjectId || UNASSIGNED_PROJECT_KEY);
    setEditingEstimateId(estimate?.id ?? null);
    setHistoryEstimateId(estimate?.id ?? null);
  };

  const handleRevertTeamEstimateVersion = async (
    estimate: any,
    revision: EstimateVersionEntry
  ) => {
    setHistoryError(null);
    setError(null);
    if (!convexAppUrl) {
      setHistoryError("Convex is not configured yet.");
      return;
    }
    if (!convexUser) {
      setHistoryError("Sign in to revert estimate versions.");
      return;
    }
    if (!activeTeam || !activeMembership) {
      setHistoryError("Select a team to revert versions.");
      return;
    }
    if (!revision.payload) {
      setHistoryError("This version does not include a payload to restore.");
      return;
    }

    const actionId = `${estimate.id}:${revision.id}`;
    setHistoryActionId(actionId);
    try {
      const now = Date.now();
      const history = getPersistedEstimateHistory(estimate);
      const targetProjectId = resolveEstimateProjectId(estimate);
      const estimateLinks = {
        team: activeTeam.id,
        owner: convexUser.id,
        ...(targetProjectId ? { project: targetProjectId } : {}),
      };
      const versioned = appendEstimateVersion(history, {
        action: "reverted",
        createdAt: now,
        title: revision.title,
        payload: revision.payload,
        totals: revision.totals ?? null,
        templateName:
          revision.templateName ??
          (typeof estimate?.templateName === "string"
            ? estimate.templateName
            : undefined),
        templateUrl:
          revision.templateUrl ??
          (typeof estimate?.templateUrl === "string"
            ? estimate.templateUrl
            : undefined),
        createdByUserId: convexUser.id,
        sourceVersion: revision.version,
      });

      const operations = [
        db.tx.estimates[estimate.id]
          .update({
            title: revision.title,
            status: "draft",
            updatedAt: now,
            templateName:
              revision.templateName ??
              (typeof estimate?.templateName === "string"
                ? estimate.templateName
                : undefined),
            templateUrl:
              revision.templateUrl ??
              (typeof estimate?.templateUrl === "string"
                ? estimate.templateUrl
                : undefined),
            payload: revision.payload,
            totals: revision.totals ?? null,
            version: versioned.currentVersion,
            versionHistory: versioned.history,
            tags: normalizeEstimateTags(estimate?.tags),
          })
          .link(estimateLinks),
        ...(targetProjectId
          ? [db.tx.projects[targetProjectId].update({ updatedAt: now })]
          : []),
      ];
      await db.transact(operations);

      setEstimateName(revision.title);
      setLoadedEstimatePayload(revision.payload);
      setEstimateTags(normalizeEstimateTags(estimate?.tags));
      setEstimateTagInput("");
      setActiveProjectId(targetProjectId ?? UNASSIGNED_PROJECT_KEY);
      setEditingEstimateId(estimate.id);
      setHistoryEstimateId(estimate.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setHistoryError(message);
    } finally {
      setHistoryActionId(null);
    }
  };

  const loadLibrary = async (type: LibraryType) => {
    setLibrary((prev) => ({
      ...prev,
      [type]: { ...prev[type], loading: true, error: null },
    }));

    try {
      const response = await fetch(`/api/library?type=${type}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to load library.";
        throw new Error(message);
      }
      const data = await response.json();
      setLibrary((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          items: Array.isArray(data.items) ? data.items : [],
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], error: message },
      }));
    } finally {
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  };

  const activeTemplateConfigItem = useMemo(
    () => getMostRecentLibraryItem(library.template_config.items),
    [library.template_config.items]
  );

  useEffect(() => {
    void loadLibrary("template_config");
  }, []);

  const handleSelectTemplateConfig = useCallback(async (item: LibraryItem) => {
    if (!item.url) {
      setTemplateConfigError("Selected template has no URL.");
      return;
    }
    setTemplateConfigError(null);
    setTemplateConfigLoading(true);
    try {
      const response = await fetch(item.url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load template configuration.");
      }
      const data = (await response.json()) as TemplateConfig;
      setTemplateConfig(data);
      setLoadedTemplateConfigKey(item.key);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTemplateConfigError(message);
      setLoadedTemplateConfigKey(item.key);
    } finally {
      setTemplateConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeTemplateConfigItem) {
      setTemplateConfig(null);
      setLoadedTemplateConfigKey(null);
      return;
    }
    if (templateConfigLoading) return;
    if (loadedTemplateConfigKey === activeTemplateConfigItem.key) return;
    void handleSelectTemplateConfig(activeTemplateConfigItem);
  }, [
    activeTemplateConfigItem,
    handleSelectTemplateConfig,
    loadedTemplateConfigKey,
    templateConfigLoading,
  ]);

  const templateCard = (
    <Card
      id="step-template"
      className="rounded-3xl border-border/60 bg-card/80 shadow-elevated"
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="muted" className="bg-muted/80 text-[10px]">
              Step 2
            </Badge>
            <CardTitle className="text-2xl font-serif">Generation Presets</CardTitle>
            <CardDescription>
              Optionally load team mapping presets before creating PandaDoc.
            </CardDescription>
          </div>
          <Badge variant="outline" className="bg-background/80">
            Optional
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {templateConfigError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {templateConfigError}
          </div>
        ) : null}
        {templateConfigLoading ? (
          <div className="text-sm text-muted-foreground">
            Loading template configuration...
          </div>
        ) : null}
        {library.template_config.loading ? (
          <div className="text-sm text-muted-foreground">
            Loading template configuration...
          </div>
        ) : activeTemplateConfigItem ? (
          <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              {activeTemplateConfigItem.name}
            </p>
            <p className="text-xs text-muted-foreground">
              Active team preset. Updated{" "}
              {new Date(activeTemplateConfigItem.uploadedAt).toLocaleString()}.
            </p>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            No preset yet. You can still generate directly from current values.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>
            Active preset:{" "}
            <span className="text-foreground">
              {templateConfig
                ? formatTemplateDisplayName(
                    templateConfig.name,
                    templateConfig.templateVersion
                  )
                : "None"}
            </span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setTemplateConfigError(null);
              setLoadedTemplateConfigKey(null);
              void loadLibrary("template_config");
            }}
          >
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <main className="relative min-h-screen overflow-hidden">
      <ConvexAuthSync
        onDomainError={setAuthError}
        onAuthError={setConvexSetupError}
      />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-80 w-[560px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute top-20 right-0 h-72 w-72 rounded-full bg-foreground/10 blur-3xl" />
        <div className="absolute -bottom-24 left-10 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
      </div>
      <div className="container relative py-8 md:py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/70 px-4 py-3 backdrop-blur-sm">
          <div className="text-xs text-muted-foreground">
            {!clerkEnabled ? (
              <span>Clerk auth is not configured yet.</span>
            ) : authLoaded ? (
              isSignedIn ? (
                <span>Signed in as {user?.primaryEmailAddress?.emailAddress}</span>
              ) : (
                <span>Sign in to access the proposal studio.</span>
              )
            ) : (
              <span>Loading account...</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="hidden bg-background/80 sm:inline-flex">
              v{APP_VERSION}
            </Badge>
            {clerkEnabled && isSignedIn ? (
              <SignOutButton>
                <Button variant="outline" size="sm">
                  Sign out
                </Button>
              </SignOutButton>
            ) : clerkEnabled ? (
              <SignInButton mode="modal">
                <Button variant="accent" size="sm">
                  Sign in
                </Button>
              </SignInButton>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Sign in
              </Button>
            )}
          </div>
        </div>
        {authError ? (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {authError}
          </div>
        ) : null}
        {convexSetupBanner ? (
          <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            {convexSetupBanner}
          </div>
        ) : null}
        {!convexAppUrl ? (
          <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            Convex is not configured. Add `NEXT_PUBLIC_CONVEX_URL` to
            enable the project library.
          </div>
        ) : null}
        <section className="relative overflow-hidden rounded-[32px] border border-border/60 bg-foreground text-white shadow-elevated">
          <div className="absolute -right-28 -top-24 h-72 w-72 rounded-full bg-accent/25 blur-3xl" />
          <div className="absolute bottom-0 left-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
          <div className="relative grid gap-8 p-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <BrandMark tone="dark" />
              <div className="space-y-4">
                <Badge variant="outline" className={statusClassName}>
                  {status.label}
                </Badge>
                <div className="space-y-3">
                  <h1 className="text-4xl font-serif tracking-tight md:text-5xl">
                    Cornerstone Proposal Generator
                  </h1>
                  <p className="max-w-xl text-base text-white/70">
                    Build estimate variables, generate PandaDoc, and launch e-sign.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="accent" size="sm">
                  <a href="#step-input">Start</a>
                </Button>
              </div>
            </div>
            <Card className="border-white/10 bg-white/10 text-white shadow-none backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-xl text-white">Checklist</CardTitle>
                <CardDescription className="text-white/60">
                  {status.helper}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 rounded-xl border border-white/10 bg-black/10 p-4">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.24em] text-white/60">
                    <span>Completion</span>
                    <span>{workflowPercent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500"
                      style={{ width: `${workflowPercent}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  {workflowMilestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                      {milestone.done ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-accent" />
                      ) : (
                        <CircleDashed className="mt-0.5 h-4 w-4 text-white/60" />
                      )}
                      <p className="text-sm text-white/70">{milestone.label}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {appLocked ? (
          <section className="mt-10">
            <Card className="rounded-3xl border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Sign in required
                </CardTitle>
                <CardDescription>
                  Access to proposals and project estimates is restricted to your
                  organization.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {authLoaded ? (
                  <div className="text-sm text-muted-foreground">
                    Use your Microsoft account to continue.
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Checking your account status...
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {clerkEnabled ? (
                    <SignInButton mode="modal">
                      <Button variant="accent" size="sm">
                        Sign in with Microsoft
                      </Button>
                    </SignInButton>
                  ) : (
                    <Button variant="accent" size="sm" disabled>
                      Sign in with Microsoft
                    </Button>
                  )}
                  {!clerkEnabled ? (
                    <Button variant="outline" size="sm" disabled>
                      Clerk not configured
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </section>
        ) : (
          <>
        {authLoaded && isSignedIn ? (
          <section className="mt-10 space-y-4">
            <Card className="rounded-2xl border-border/60 bg-card/80 shadow-elevated">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="muted" className="bg-muted/80 text-[10px]">
                      Workspace
                    </Badge>
                    {teamReady ? (
                      <>
                        <span className="text-sm font-semibold text-foreground">
                          {orgTeam?.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Domain: {orgTeam?.domain}
                        </span>
                        <Badge variant="outline" className="bg-background/80">
                          {orgRole === "owner"
                            ? "Owner"
                            : orgRole === "admin"
                              ? "Admin"
                              : "Member"}
                        </Badge>
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {orgTeam
                            ? "Joining organization workspace..."
                            : "Creating organization workspace..."}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Domain: {teamDomain || "Unknown"}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasTeamAdminAccess ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href="/team-admin">Org owner dashboard</Link>
                      </Button>
                    ) : null}
                    {teamError ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRetryTeamSetup}
                        disabled={teamSaving}
                      >
                        Retry setup
                      </Button>
                    ) : null}
                  </div>
                </div>
                {convexAuthError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {convexAuthError.message}
                  </div>
                ) : null}
                {convexSetupBanner ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                    {convexSetupBanner}
                  </div>
                ) : null}
                {teamError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {teamError}
                  </div>
                ) : null}
                {convexLoading ? (
                  <div className="text-xs text-muted-foreground">
                    Connecting to Convex...
                  </div>
                ) : null}
                {!convexLoading && !convexUser && !convexSetupError ? (
                  <div className="text-xs text-muted-foreground">
                    Waiting for Convex auth. If this persists, verify the Clerk
                    client name and session token email claim.
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border/60 bg-card/80 shadow-elevated">
              <CardHeader className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Badge variant="muted" className="bg-muted/80 text-[10px]">
                      Shared
                    </Badge>
                    <CardTitle className="text-2xl font-serif">
                      Project Library
                    </CardTitle>
                    <CardDescription>
                      Manage projects, compare estimate options, and keep versions
                      grouped by project.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-background/80">
                      {filteredTeamEstimates.length} shown
                    </Badge>
                    <Badge variant="outline" className="bg-background/80">
                      {teamEstimates.length} in project
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    Power workflow: use shortcuts for speed while estimating.
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <Badge variant="outline" className="bg-background/80">
                      Ctrl/Cmd+S save
                    </Badge>
                    <Badge variant="outline" className="bg-background/80">
                      Ctrl/Cmd+Enter generate
                    </Badge>
                    <Badge variant="outline" className="bg-background/80">
                      Ctrl/Cmd+Shift+N new
                    </Badge>
                    <Badge variant="outline" className="bg-background/80">
                      Ctrl/Cmd+. dock
                    </Badge>
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-[0.8fr_0.2fr]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={teamEstimateQuery}
                      onChange={(event) => setTeamEstimateQuery(event.target.value)}
                      placeholder="Search estimates by name..."
                      className="pl-9"
                    />
                  </div>
                  {memberTeams.length > 1 ? (
                    <Select
                      value={activeTeam?.id ?? undefined}
                      onValueChange={(value) => setActiveTeamId(value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select team" />
                      </SelectTrigger>
                      <SelectContent>
                        {memberTeams.map((team) => (
                          <SelectItem key={team.id} value={team.id}>
                            {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center justify-end">
                      <Badge variant="outline" className="bg-background/80">
                        Active team: {activeTeam?.name ?? "N/A"}
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="grid gap-3 lg:grid-cols-[0.65fr_0.35fr]">
                  <Select
                    value={activeProjectId ?? undefined}
                    onValueChange={(value) => setActiveProjectId(value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      {teamProjects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                      {unassignedTeamEstimates.length ? (
                        <SelectItem value={UNASSIGNED_PROJECT_KEY}>
                          Unassigned estimates
                        </SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Input
                      value={newProjectName}
                      onChange={(event) => setNewProjectName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        void handleCreateProject();
                      }}
                      placeholder="New project name..."
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleCreateProject()}
                      disabled={
                        !teamReady ||
                        !isSignedIn ||
                        isCreatingProject ||
                        !newProjectName.trim()
                      }
                    >
                      {isCreatingProject ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Create
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="bg-background/80">
                    <FolderKanban className="mr-1 h-3.5 w-3.5" />
                    {activeProject?.name ??
                      (activeProjectId === UNASSIGNED_PROJECT_KEY
                        ? "Unassigned estimates"
                        : "No project selected")}
                  </Badge>
                  <Button
                    variant={teamEstimateScope === "all" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setTeamEstimateScope("all")}
                  >
                    All
                  </Button>
                  <Button
                    variant={teamEstimateScope === "mine" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setTeamEstimateScope("mine")}
                  >
                    Mine
                  </Button>
                  <Button
                    variant={teamEstimateScope === "recent" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setTeamEstimateScope("recent")}
                  >
                    Updated 14d
                  </Button>
                  {teamEstimateQuery.trim() ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTeamEstimateQuery("")}
                    >
                      Clear search
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {projectActionNotice ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800">
                    {projectActionNotice}
                  </div>
                ) : null}
                {!teamReady ? (
                  <div className="text-sm text-muted-foreground">
                    Preparing your team workspace...
                  </div>
                ) : !activeProjectId ? (
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-4 text-sm text-muted-foreground">
                    Create your first project to start organizing estimates.
                  </div>
                ) : filteredTeamEstimates.length ? (
                  <ScrollArea className="h-72 rounded-xl border border-border/70 bg-background/70">
                    <div className="space-y-2 p-2">
                      {filteredTeamEstimates.map((estimate) => {
                        const currentVersion = getCurrentVersionForEstimate(estimate);
                        const historyOpen = historyEstimateId === estimate.id;
                        const editingCurrent = editingEstimateId === estimate.id;
                        const tags = normalizeEstimateTags(estimate?.tags);
                        const estimateProjectId = String(
                          estimate?.project?.id ?? ""
                        ).trim();
                        const destinationProjects = teamProjects.filter(
                          (project) => project.id !== estimateProjectId
                        );
                        const selectedMoveTarget =
                          moveTargetByEstimateId[estimate.id] ??
                          destinationProjects[0]?.id ??
                          "";
                        const isMovingEstimate = movingEstimateId === estimate.id;
                        return (
                          <div
                            key={estimate.id}
                            className={cn(
                              "rounded-lg border border-border/60 bg-card/80 px-3 py-3",
                              historyOpen && "border-accent/40 bg-accent/5"
                            )}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="space-y-1">
                                <p className="text-sm font-semibold text-foreground">
                                  {estimate.title ?? "Untitled"}
                                </p>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <Badge variant="outline" className="bg-background/80">
                                    v{currentVersion}
                                  </Badge>
                                  {editingCurrent ? (
                                    <Badge
                                      variant="outline"
                                      className="border-accent/40 bg-accent/10 text-foreground"
                                    >
                                      Editing
                                    </Badge>
                                  ) : null}
                                  <span className="inline-flex items-center gap-1">
                                    <Clock3 className="h-3 w-3" />
                                    {formatRelativeTime(estimate.updatedAt)}
                                  </span>
                                  {estimate.updatedAt ? (
                                    <span>{new Date(estimate.updatedAt).toLocaleString()}</span>
                                  ) : null}
                                </div>
                                {tags.length ? (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {tags.map((tag) => (
                                      <Badge
                                        key={`${estimate.id}-${tag}`}
                                        variant="muted"
                                        className="text-[10px]"
                                      >
                                        {tag}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {destinationProjects.length ? (
                                  <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 p-1">
                                    <Select
                                      value={selectedMoveTarget || undefined}
                                      onValueChange={(value) =>
                                        setMoveTargetByEstimateId((previous) => ({
                                          ...previous,
                                          [estimate.id]: value,
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="h-8 min-w-[170px] border-0 bg-transparent px-2 text-xs">
                                        <SelectValue placeholder="Move to..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {destinationProjects.map((project) => (
                                          <SelectItem
                                            key={`${estimate.id}-${project.id}`}
                                            value={project.id}
                                          >
                                            {project.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                      disabled={
                                        isMovingEstimate || !selectedMoveTarget
                                      }
                                      onClick={() =>
                                        void handleMoveEstimateToProject(
                                          estimate,
                                          selectedMoveTarget
                                        )
                                      }
                                    >
                                      {isMovingEstimate ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <ArrowRightLeft className="h-3.5 w-3.5" />
                                      )}
                                      Move
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">
                                    Only project
                                  </span>
                                )}
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleLoadTeamEstimate(estimate)}
                                >
                                  Load
                                </Button>
                                <Button
                                  variant={historyOpen ? "secondary" : "ghost"}
                                  size="sm"
                                  onClick={() => {
                                    setHistoryError(null);
                                    setHistoryEstimateId((current) =>
                                      current === estimate.id ? null : estimate.id
                                    );
                                  }}
                                >
                                  <History className="h-3.5 w-3.5" />
                                  {historyOpen ? "Hide history" : "History"}
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-4 text-sm text-muted-foreground">
                    {teamEstimates.length
                      ? "No estimates match your current filters."
                      : activeProjectId === UNASSIGNED_PROJECT_KEY
                        ? "No unassigned estimates."
                        : "No estimates in this project yet."}
                  </div>
                )}
                {historyError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {historyError}
                  </div>
                ) : null}
                {selectedHistoryEstimate ? (
                  <div className="space-y-2 rounded-lg border border-border/60 bg-background/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Version history:{" "}
                          {selectedHistoryEstimate.title ?? "Untitled"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Reverting creates a new version and keeps the full timeline.
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHistoryEstimateId(null)}
                      >
                        Close
                      </Button>
                    </div>
                    {selectedHistoryEntries.length ? (
                      <ScrollArea className="h-52 rounded-md border border-border/60 bg-background/70">
                        <div className="divide-y divide-border/60">
                          {selectedHistoryEntries.map((entry) => {
                            const actionId = `${selectedHistoryEstimate.id}:${entry.id}`;
                            const reverting = historyActionId === actionId;
                            const isCurrent =
                              selectedHistoryCurrentVersion === entry.version;
                            return (
                              <div
                                key={entry.id}
                                className="flex items-center justify-between gap-4 px-3 py-2"
                              >
                                <div>
                                  <p className="text-xs font-medium text-foreground">
                                    v{entry.version} ·{" "}
                                    {getEstimateVersionActionLabel(entry.action)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {new Date(entry.createdAt).toLocaleString()}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  {isCurrent ? (
                                    <Badge variant="outline" className="bg-background/80">
                                      Current
                                    </Badge>
                                  ) : null}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      void handleRevertTeamEstimateVersion(
                                        selectedHistoryEstimate,
                                        entry
                                      )
                                    }
                                    disabled={reverting || isCurrent || !entry.payload}
                                  >
                                    {reverting ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : null}
                                    Revert
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        No versions recorded yet.
                      </div>
                    )}
                  </div>
                ) : null}
                {editingEstimateId ? (
                  <div className="text-xs text-muted-foreground">
                    Editing a project estimate. Use “Save to project” to update it.
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </section>
        ) : null}

        <section
          id="step-input"
          className="mt-12 space-y-6"
        >
          <div className="space-y-6">
            <EstimateBuilderCard
              values={estimateValues}
              onValuesChange={setEstimateValues}
              name={estimateName}
              onNameChange={setEstimateName}
              preparedByName={preparedByName}
              selectedEstimate={selectedEstimate}
              onSelectEstimate={setSelectedEstimate}
              onEstimatePayloadChange={setEstimatePayload}
              loadPayload={loadedEstimatePayload}
              vendors={vendorOptions}
              panelTypes={panelTypeOptions}
              productFeatureOptions={productFeatureOptions}
              catalogTeamId={catalogTeam?.id ?? null}
              projectTypeOptions={
                templateConfig?.masterTemplate?.selection?.projectTypes
              }
              onActivate={() => {
                setError(null);
              }}
            />
            <Card className="rounded-2xl border-border/60 bg-card/70">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Estimate Tags</CardTitle>
                <CardDescription>
                  Add custom tags like option names, alternates, or change-order
                  candidates.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={estimateTagInput}
                    onChange={(event) => setEstimateTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== ",") return;
                      event.preventDefault();
                      if (addEstimateTag(estimateTagInput)) {
                        setEstimateTagInput("");
                      }
                    }}
                    placeholder="Add a tag and press Enter..."
                    className="min-w-[220px] flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (addEstimateTag(estimateTagInput)) {
                        setEstimateTagInput("");
                      }
                    }}
                    disabled={!estimateTagInput.trim()}
                  >
                    <Tag className="h-4 w-4" />
                    Add tag
                  </Button>
                </div>
                {estimateTags.length ? (
                  <div className="flex flex-wrap gap-2">
                    {estimateTags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="muted"
                        className="inline-flex items-center gap-1"
                      >
                        {tag}
                        <button
                          type="button"
                          className="rounded-full p-0.5 hover:bg-black/10"
                          onClick={() => removeEstimateTag(tag)}
                          aria-label={`Remove ${tag}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No tags yet. Tags are stored with this estimate inside its project.
                  </p>
                )}
              </CardContent>
            </Card>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => void handleSaveEstimateToDb()}
                disabled={!isSignedIn || !teamReady || !hasSelectedProject}
              >
                {editingEstimateId ? "Update project estimate" : "Save to project"}
              </Button>
              {editingEstimateId ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetEstimateWorkspace}
                >
                  New estimate
                </Button>
              ) : null}
              {!clerkEnabled ? (
                <span className="text-xs text-muted-foreground">
                  Configure Clerk + Convex to enable project saving.
                </span>
              ) : !activeMembership ? (
                <span className="text-xs text-muted-foreground">
                  Select a team to save estimates.
                </span>
              ) : !hasSelectedProject ? (
                <span className="text-xs text-muted-foreground">
                  Select or create a project before saving estimates.
                </span>
              ) : null}
            </div>
          </div>
          {templateCard}
        </section>

        <section className="mt-10">
          <Card
            id="step-generate"
            className="h-fit rounded-3xl border-border/60 bg-card/85 shadow-elevated"
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <Badge variant="muted" className="bg-muted/80 text-[10px]">
                    Step 3
                  </Badge>
                  <CardTitle className="text-2xl font-serif">
                    Generate PandaDoc
                  </CardTitle>
                  <CardDescription>
                    Create the proposal in PandaDoc and start signing.
                  </CardDescription>
                </div>
                <LayoutTemplate className="mt-1 h-5 w-5 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
              <div className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-3">
                {workflowMilestones.map((milestone) => (
                  <div key={milestone.id} className="flex items-center gap-2 text-sm">
                    {milestone.done ? (
                      <CheckCircle2 className="h-4 w-4 text-accent" />
                    ) : (
                      <CircleDashed className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        milestone.done ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {milestone.label}
                    </span>
                  </div>
                ))}
              </div>
              {showProgress ? (
                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/40 px-4 py-3">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    <span>{progressLabel ?? "Working..."}</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-border/60">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              ) : null}
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Input source</span>
                  <span className="text-right font-medium text-foreground">
                    Manual estimate
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Estimate</span>
                  <span className="text-right font-medium text-foreground">
                    {estimateName.trim() ||
                      selectedEstimate?.name ||
                      (hasEstimateInput ? "Manual entry" : "Not started")}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Project</span>
                  <span className="text-right font-medium text-foreground">
                    {activeProject?.name ??
                      (activeProjectId === UNASSIGNED_PROJECT_KEY
                        ? "Unassigned estimates"
                        : "Not selected")}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Tags</span>
                  <span className="text-right font-medium text-foreground">
                    {estimateTags.length ? estimateTags.join(", ") : "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Preset</span>
                  <span className="text-right font-medium text-foreground">
                    {templateConfig
                      ? formatTemplateDisplayName(
                          templateConfig.name,
                          templateConfig.templateVersion
                        )
                      : "Not selected"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Linked PandaDoc</span>
                  <span className="text-right font-medium text-foreground">
                    {activeTrackedPandaDocDocument?.documentId
                      ? `Revising ${activeTrackedPandaDocDocument.name ?? activeTrackedPandaDocDocument.documentId}`
                      : "Create new document"}
                  </span>
                </div>
                {activeTrackedPandaDocDocument?.documentId ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Linked status</span>
                    <span className="text-right font-medium text-foreground">
                      {linkedDocumentLive?.loading
                        ? "Checking..."
                        : formatPandaDocStatus(resolvedTrackedDocumentStatus)}
                    </span>
                  </div>
                ) : null}
              </div>
              <Separator />
              {activeTrackedPandaDocDocument?.documentId &&
              trackedDocumentNeedsDraftRevert ? (
                <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-900">
                  Current document status is{" "}
                  {formatPandaDocStatus(resolvedTrackedDocumentStatus)}. Regenerate
                  will move it back to Draft so revisions can be applied.
                </p>
              ) : null}
              {activeTrackedPandaDocDocument?.documentId &&
              trackedDocumentIsArchived ? (
                <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-900">
                  The linked document is no longer accessible (assumed archived).
                  Regenerate will create a replacement document and continue
                  tracking from there.
                </p>
              ) : null}
              {activeTrackedPandaDocDocument?.documentId &&
              linkedDocumentLive?.error ? (
                <p className="text-xs text-muted-foreground">
                  Unable to refresh PandaDoc status: {linkedDocumentLive.error}
                </p>
              ) : null}
              <div className="flex flex-col gap-3">
                <Button
                  variant="accent"
                  size="lg"
                  onClick={handleGenerate}
                  disabled={!canGenerate || isGenerating}
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="h-4 w-4" />
                  )}
                  {isGenerating ? "Generating..." : "Generate PandaDoc"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handleCopyPlanningLines()}
                  disabled={
                    !canDownloadPlanningLines ||
                    isPlanningLinesCopying ||
                    isGenerating
                  }
                >
                  {isPlanningLinesCopying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                  {isPlanningLinesCopying
                    ? "Copying planning lines..."
                    : "Copy _SYNC rows now"}
                </Button>
              </div>
              {lastGeneration?.document?.id ? (
                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm">
                  <p className="font-medium text-foreground">
                    Last document: {lastGeneration.document.name ?? lastGeneration.document.id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {lastGeneration.operation === "updated"
                      ? "Operation: revised existing document"
                      : lastGeneration.fallbackFromDocumentId
                        ? "Operation: created replacement document"
                        : "Operation: created new document"}
                  </p>
                  {lastGeneration.revision?.revertedToDraft ? (
                    <p className="text-xs text-muted-foreground">
                      Reverted from{" "}
                      {formatPandaDocStatus(
                        lastGeneration.revision.previousStatus
                      )}{" "}
                      to Draft before applying updates.
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Status: {formatPandaDocStatus(lastGeneration.document.status)}
                    {lastGeneration.businessCentralSync?.status
                      ? ` · Business Central sync: ${lastGeneration.businessCentralSync.status}`
                      : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {lastGeneration.session?.url ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={lastGeneration.session.url} target="_blank" rel="noreferrer">
                          Open signing session
                        </a>
                      </Button>
                    ) : null}
                    {lastGeneration.document?.sharedLink ? (
                      <Button asChild size="sm" variant="outline">
                        <a
                          href={lastGeneration.document.sharedLink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open recipient link
                        </a>
                      </Button>
                    ) : null}
                    {lastGeneration.document?.appUrl ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={lastGeneration.document.appUrl} target="_blank" rel="noreferrer">
                          Open PandaDoc
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                For saved projects, this step revises the linked PandaDoc
                document. If it is sent, we move it back to Draft and then apply
                updates. Add recipients and send from PandaDoc.
              </p>
            </CardContent>
          </Card>
        </section>

          </>
        )}

        <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
          <div className="relative flex flex-col items-end gap-2">
            <div
              className={cn(
                "flex flex-col items-center gap-2 transition-all duration-250",
                floatingDockOpen
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-3 opacity-0"
              )}
            >
              <div className="group relative flex h-11 w-11 items-center justify-center">
                <span className="pointer-events-none absolute right-[calc(100%+0.6rem)] top-1/2 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-full border border-border/70 bg-card/95 px-2.5 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100">
                  Save To Project
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-11 w-11 rounded-full border border-border/60 shadow-lg"
                  onClick={() => void handleSaveEstimateToDb()}
                  disabled={!isSignedIn || !teamReady || !hasSelectedProject}
                >
                  <Workflow className="h-4 w-4" />
                </Button>
              </div>

              <div className="group relative flex h-11 w-11 items-center justify-center">
                <span className="pointer-events-none absolute right-[calc(100%+0.6rem)] top-1/2 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-full border border-border/70 bg-card/95 px-2.5 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100">
                  Generate PandaDoc
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-11 w-11 rounded-full border border-border/60 shadow-lg"
                  onClick={handleGenerate}
                  disabled={!canGenerate || isGenerating}
                >
                  <Rocket className="h-4 w-4" />
                </Button>
              </div>

              <div className="group relative flex h-11 w-11 items-center justify-center">
                <span className="pointer-events-none absolute right-[calc(100%+0.6rem)] top-1/2 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-full border border-border/70 bg-card/95 px-2.5 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100">
                  Move Loaded Estimate
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-11 w-11 rounded-full border border-border/60 shadow-lg"
                  onClick={() => void handleMoveEditingEstimateToProject()}
                  disabled={
                    !activeEditingEstimate ||
                    !floatingDockMoveTargetId ||
                    !floatingDockMoveOptions.length ||
                    movingEstimateId === activeEditingEstimate.id
                  }
                >
                  {movingEstimateId === activeEditingEstimate?.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <Popover
                open={dockRenameEstimateOpen}
                onOpenChange={(open) => {
                  setDockRenameEstimateOpen(open);
                  if (open) openDockRenameEstimate();
                }}
              >
                <div className="group relative flex h-11 w-11 items-center justify-center">
                  <span className="pointer-events-none absolute right-[calc(100%+0.6rem)] top-1/2 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-full border border-border/70 bg-card/95 px-2.5 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100">
                    Rename Estimate
                  </span>
                  <PopoverTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-11 w-11 rounded-full border border-border/60 shadow-lg"
                    >
                      <PencilLine className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                </div>
                <PopoverContent align="end" className="w-80 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Rename estimate</p>
                    <p className="text-xs text-muted-foreground">
                      Update the working estimate name for this session.
                    </p>
                  </div>
                  <Input
                    value={dockRenameEstimateValue}
                    onChange={(event) => setDockRenameEstimateValue(event.target.value)}
                    placeholder="Estimate name"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDockRenameEstimateOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        handleRenameCurrentEstimate(dockRenameEstimateValue);
                      }}
                    >
                      Save name
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

              <Popover
                open={dockRenameProjectOpen}
                onOpenChange={(open) => {
                  setDockRenameProjectOpen(open);
                  if (open) openDockRenameProject();
                }}
              >
                <div className="group relative flex h-11 w-11 items-center justify-center">
                  <span className="pointer-events-none absolute right-[calc(100%+0.6rem)] top-1/2 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-full border border-border/70 bg-card/95 px-2.5 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100">
                    Rename Project
                  </span>
                  <PopoverTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-11 w-11 rounded-full border border-border/60 shadow-lg"
                      disabled={!activeProject}
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                </div>
                <PopoverContent align="end" className="w-80 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Rename project</p>
                    <p className="text-xs text-muted-foreground">
                      Keep the project library organized for your team.
                    </p>
                  </div>
                  <Input
                    value={dockRenameProjectValue}
                    onChange={(event) => setDockRenameProjectValue(event.target.value)}
                    placeholder="Project name"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDockRenameProjectOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void handleRenameActiveProject()}>
                      Save name
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

              <div className="group relative flex h-11 w-11 items-center justify-center">
                <span className="pointer-events-none absolute right-[calc(100%+0.6rem)] top-1/2 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-full border border-border/70 bg-card/95 px-2.5 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100">
                  Open Version History
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-11 w-11 rounded-full border border-border/60 shadow-lg"
                  onClick={handleOpenActiveEstimateHistory}
                  disabled={!activeEditingEstimate}
                >
                  <History className="h-4 w-4" />
                </Button>
              </div>

              <div className="group relative flex h-11 w-11 items-center justify-center">
                <span className="pointer-events-none absolute right-[calc(100%+0.6rem)] top-1/2 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-full border border-border/70 bg-card/95 px-2.5 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100">
                  New Estimate
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-11 w-11 rounded-full border border-border/60 shadow-lg"
                  onClick={resetEstimateWorkspace}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>

              <Popover
                open={dockCreateProjectOpen}
                onOpenChange={(open) => {
                  setDockCreateProjectOpen(open);
                  if (open) openDockCreateProject();
                }}
              >
                <div className="group relative flex h-11 w-11 items-center justify-center">
                  <span className="pointer-events-none absolute right-[calc(100%+0.6rem)] top-1/2 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-full border border-border/70 bg-card/95 px-2.5 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100">
                    Create Project
                  </span>
                  <PopoverTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-11 w-11 rounded-full border border-border/60 shadow-lg"
                      disabled={!isSignedIn || !teamReady}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                </div>
                <PopoverContent align="end" className="w-80 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Create project</p>
                    <p className="text-xs text-muted-foreground">
                      Spin up a new destination for upcoming estimates.
                    </p>
                  </div>
                  <Input
                    value={dockCreateProjectValue}
                    onChange={(event) => setDockCreateProjectValue(event.target.value)}
                    placeholder="Project name"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDockCreateProjectOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void handleCreateProjectFromDock()}>
                      Create
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <Button
              variant="accent"
              size="icon"
              className="h-14 w-14 rounded-full border border-accent/40 shadow-xl"
              onClick={() => setFloatingDockOpen((open) => !open)}
            >
              {floatingDockOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Workflow className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>

        <Separator className="my-12" />

        <footer className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>
            Estimate snapshots and PandaDoc generation are the primary flow.
          </span>
          <div className="flex items-center gap-4">
            {hasTeamAdminAccess ? (
              <Link className="hover:text-foreground" href="/admin">
                PandaDoc mapping dashboard
              </Link>
            ) : null}
            <span>Cornerstone Proposal Generator · v{APP_VERSION}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
