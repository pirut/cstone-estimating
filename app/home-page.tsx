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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
  type EstimateVersionEntry,
} from "@/lib/estimate-versioning";
import { ConvexAuthSync } from "@/components/convex-auth-sync";
import { ThemeToggle } from "@/components/theme-toggle";
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
import { DEFAULT_MARGIN_THRESHOLDS } from "@/lib/estimate-calculator";
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRightLeft,
  Clock3,
  Eye,
  FileText,
  History,
  Loader2,
  PencilLine,
  Plus,
  Save,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import {
  SignInButton,
  SignOutButton,
  UserButton,
  clerkEnabled,
  useOptionalAuth,
  useOptionalUser,
} from "@/lib/clerk";
import { id } from "@/lib/convex";
import {
  formatPandaDocStatus,
  formatRelativeTime,
  getEstimateProjectType,
  getManualEstimateProgress,
  getMostRecentLibraryItem,
  hasEstimateSnapshotChanges,
  normalizeEstimateTags,
  resolvePandaDocTemplateConfigForEstimate,
  toPandaDocVersionDocument,
  type EstimateSnapshot,
  type PandaDocGenerationResponse,
} from "@/lib/home-page-utils";
import { formatTemplateDisplayName } from "@/lib/template-display";

type DeleteEstimateDialogState = {
  id: string;
  title: string;
  projectId: string;
};

type HomePageProps = {
  routeEstimateId?: string | null;
  mode?: "dashboard" | "estimate";
};

const LINKED_DOCUMENT_POLL_INTERVAL_MS = 20_000;
const UNASSIGNED_PROJECT_KEY = "__unassigned__";
const LOCAL_DRAFT_STORAGE_KEY = "cstone:manual-estimate:draft:v1";
const APP_TAB_TITLE = "Cornerstone Proposal Generator";

function formatBrowserTabTitle(estimateLabel?: string | null) {
  const normalized = String(estimateLabel ?? "").trim();
  if (!normalized) return APP_TAB_TITLE;
  return `${normalized} | ${APP_TAB_TITLE}`;
}

function parseEstimateIdFromPathname(pathname: string) {
  const match = String(pathname ?? "").match(/^\/estimates\/([^/?#]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function mergeTotalsWithPandaDocValue(
  totals: Record<string, any> | null | undefined,
  generation: PandaDocGenerationResponse | null | undefined
) {
  const baseTotals =
    totals && typeof totals === "object" && !Array.isArray(totals)
      ? { ...totals }
      : {};
  const valueAmount = generation?.document?.valueAmount;
  const valueCurrency = String(generation?.document?.valueCurrency ?? "").trim();
  const valueFormatted = String(generation?.document?.valueFormatted ?? "").trim();
  if (
    typeof valueAmount !== "number" &&
    !valueCurrency &&
    !valueFormatted
  ) {
    return Object.keys(baseTotals).length ? baseTotals : null;
  }
  return {
    ...baseTotals,
    ...(typeof valueAmount === "number" && Number.isFinite(valueAmount)
      ? { pandadoc_document_value_amount: valueAmount }
      : {}),
    ...(valueCurrency ? { pandadoc_document_value_currency: valueCurrency } : {}),
    ...(valueFormatted ? { pandadoc_document_value_formatted: valueFormatted } : {}),
  };
}

export default function HomePage({ routeEstimateId = null, mode = "dashboard" }: HomePageProps = {}) {
  const isEstimateMode = mode === "estimate" && Boolean(routeEstimateId);
  const normalizedRouteEstimateId = String(routeEstimateId ?? "").trim();
  const [urlEstimateId, setUrlEstimateId] = useState<string | null>(
    normalizedRouteEstimateId || null
  );
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
  const [projectLibraryQuery, setProjectLibraryQuery] = useState("");
  const [projectCreatePopoverOpen, setProjectCreatePopoverOpen] = useState(false);
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
  const [deletingEstimateId, setDeletingEstimateId] = useState<string | null>(null);
  const [deleteEstimateDialog, setDeleteEstimateDialog] =
    useState<DeleteEstimateDialogState | null>(null);
  const [hasBidFlowStarted, setHasBidFlowStarted] = useState(false);
  const [moveTargetByEstimateId, setMoveTargetByEstimateId] = useState<
    Record<string, string>
  >({});
  const [teamEstimateQuery, setTeamEstimateQuery] = useState("");
  const [teamEstimateScope, setTeamEstimateScope] = useState<
    "all" | "mine" | "recent" | "archived"
  >("all");
  const [projectActionNotice, setProjectActionNotice] = useState<string | null>(null);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [renamingEstimateId, setRenamingEstimateId] = useState<string | null>(null);
  const [renameEstimateValue, setRenameEstimateValue] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameProjectValue, setRenameProjectValue] = useState("");
  const [previewVersionEntry, setPreviewVersionEntry] = useState<EstimateVersionEntry | null>(null);
  const [loadedEstimatePayload, setLoadedEstimatePayload] = useState<Record<
    string,
    any
  > | null>(null);
  const [estimateTags, setEstimateTags] = useState<string[]>([]);
  const [estimateTagInput, setEstimateTagInput] = useState("");
  const progressResetTimeoutRef = useRef<number | null>(null);
  const draftRestoredRef = useRef(false);
  const routedEstimateLoadedRef = useRef<string | null>(null);
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
          projectTypes: {},
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
          projectTypes: {},
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
  const projectLibraryItems = useMemo(() => {
    const list = teamProjects.map((project) => {
      const projectId = String(project?.id ?? "").trim();
      return {
        id: projectId,
        name: String(project?.name ?? "").trim() || "Untitled Project",
        status: String(project?.status ?? "active").trim(),
        estimateCount: Array.isArray(project?.estimates) ? project.estimates.length : 0,
        updatedAt:
          typeof project?.updatedAt === "number"
            ? project.updatedAt
            : typeof project?.createdAt === "number"
              ? project.createdAt
              : null,
      };
    });
    if (unassignedTeamEstimates.length) {
      const latestUnassignedUpdate = unassignedTeamEstimates.reduce<number | null>(
        (latest, estimate) => {
          const updatedAt =
            typeof estimate?.updatedAt === "number" ? estimate.updatedAt : null;
          if (!updatedAt) return latest;
          if (!latest) return updatedAt;
          return updatedAt > latest ? updatedAt : latest;
        },
        null
      );
      list.push({
        id: UNASSIGNED_PROJECT_KEY,
        name: "Unassigned estimates",
        estimateCount: unassignedTeamEstimates.length,
        updatedAt: latestUnassignedUpdate,
      });
    }
    return list;
  }, [teamProjects, unassignedTeamEstimates]);
  const filteredProjectLibraryItems = useMemo(() => {
    const query = projectLibraryQuery.trim().toLowerCase();
    return projectLibraryItems.filter((project) => {
      if (!showArchivedProjects && project.status === "archived") return false;
      if (query && !project.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [projectLibraryItems, projectLibraryQuery, showArchivedProjects]);
  const filteredTeamEstimates = useMemo(() => {
    const query = teamEstimateQuery.trim().toLowerCase();
    const recentCutoff = Date.now() - 1000 * 60 * 60 * 24 * 14;
    return teamEstimates.filter((estimate) => {
      const isArchived = String(estimate?.status ?? "").trim() === "archived";
      if (teamEstimateScope === "archived") {
        if (!isArchived) return false;
      } else {
        if (isArchived) return false;
      }
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
  const activeEstimateTabLabel = useMemo(() => {
    const fromActiveEstimate = String(activeEditingEstimate?.title ?? "").trim();
    if (fromActiveEstimate) return fromActiveEstimate;
    const fromDraftName = estimateName.trim();
    if (fromDraftName) return fromDraftName;
    const fromSelectedUpload = String(selectedEstimate?.name ?? "").trim();
    if (fromSelectedUpload) return fromSelectedUpload;
    if (urlEstimateId) return "Estimate";
    return "";
  }, [
    activeEditingEstimate?.title,
    estimateName,
    selectedEstimate?.name,
    urlEstimateId,
  ]);
  const hasSelectedProject = Boolean(
    activeProjectId && activeProjectId !== UNASSIGNED_PROJECT_KEY
  );
  const activeProjectLabel =
    activeProject?.name ??
    (activeProjectId === UNASSIGNED_PROJECT_KEY
      ? "Unassigned estimates"
      : "No project selected");
  const activeEditingEstimateProjectId = String(
    activeEditingEstimate?.project?.id ?? ""
  ).trim();
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

  const teamMemberNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const team of teams) {
      for (const membership of team.memberships ?? []) {
        const u = membership.user;
        if (u?.id && u?.name) map[u.id] = u.name;
        else if (u?.id && u?.email) map[u.id] = u.email;
      }
    }
    return map;
  }, [teams]);

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
      vendorPrices: Array.isArray(unit.vendorPrices)
        ? Object.fromEntries(
            unit.vendorPrices
              .map((entry: any) => [
                String(entry?.vendorId ?? "").trim(),
                Number(entry?.price),
              ])
              .filter(
                (entry: [string, number]) =>
                  entry[0] && Number.isFinite(entry[1])
              )
          )
        : undefined,
      id: unit.code,
      label: unit.label ?? unit.code,
      price: typeof unit.price === "number" ? unit.price : 0,
    }));
  }, [catalogTeam?.unitTypes]);
  const teamProjectTypeOptions = useMemo(() => {
    const list = (catalogTeam?.projectTypes ?? [])
      .filter((projectType) => projectType.isActive !== false)
      .slice()
      .sort((a, b) => {
        const orderA =
          typeof a.sortOrder === "number" && Number.isFinite(a.sortOrder)
            ? a.sortOrder
            : 0;
        const orderB =
          typeof b.sortOrder === "number" && Number.isFinite(b.sortOrder)
            ? b.sortOrder
            : 0;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.label ?? "").localeCompare(String(b.label ?? ""));
      });

    const seen = new Set<string>();
    const options: string[] = [];
    list.forEach((projectType) => {
      const label = String(projectType.label ?? "").trim();
      if (!label) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      options.push(label);
    });
    return options;
  }, [catalogTeam?.projectTypes]);
  const mergedProjectTypeOptions = useMemo(() => {
    const templateProjectTypes = Array.isArray(
      templateConfig?.masterTemplate?.selection?.projectTypes
    )
      ? templateConfig.masterTemplate.selection.projectTypes
      : [];
    const source = [...teamProjectTypeOptions, ...templateProjectTypes];
    const seen = new Set<string>();
    const merged: string[] = [];
    source.forEach((entry) => {
      const option = String(entry ?? "").trim();
      if (!option) return;
      const key = option.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(option);
    });
    return merged;
  }, [teamProjectTypeOptions, templateConfig?.masterTemplate?.selection?.projectTypes]);

  const manualEstimateProgress = useMemo(
    () => getManualEstimateProgress(estimatePayload, estimateValues),
    [estimatePayload, estimateValues]
  );
  const hasEstimateValues = manualEstimateProgress.complete;
  const hasEstimateInput = manualEstimateProgress.started;
  const hasDraftedBidWorkspace = Boolean(
    editingEstimateId ||
      loadedEstimatePayload ||
      estimatePayload ||
      estimateName.trim() ||
      estimateTags.length ||
      Object.keys(estimateValues).length
  );
  const bidFlowStarted = hasBidFlowStarted || hasDraftedBidWorkspace;
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

  const updateEstimateUrl = useCallback(
    (estimateId: string | null, mode: "push" | "replace" = "push") => {
      if (typeof window === "undefined") return;
      const nextPath = estimateId
        ? `/estimates/${encodeURIComponent(estimateId)}`
        : "/";
      if (window.location.pathname !== nextPath) {
        if (mode === "replace") {
          window.history.replaceState(window.history.state, "", nextPath);
        } else {
          window.history.pushState(window.history.state, "", nextPath);
        }
      }
      setUrlEstimateId(estimateId);
    },
    []
  );

  useEffect(() => {
    setUrlEstimateId(normalizedRouteEstimateId || null);
  }, [normalizedRouteEstimateId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isEstimateMode) return; // handled by the back-block effect below
    const onPopState = () => {
      setUrlEstimateId(parseEstimateIdFromPathname(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isEstimateMode]);

  // Block browser back navigation when viewing an estimate in its own tab.
  // The user should close the tab instead of navigating away.
  useEffect(() => {
    if (typeof window === "undefined" || !isEstimateMode) return;
    // Push a duplicate entry so pressing back stays on this page
    window.history.pushState(null, "", window.location.href);
    const onPopState = () => {
      // Re-push to prevent actually going back
      window.history.pushState(null, "", window.location.href);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isEstimateMode]);

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
    if (typeof document === "undefined") return;
    document.title = formatBrowserTabTitle(activeEstimateTabLabel);
  }, [activeEstimateTabLabel]);

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
    if (urlEstimateId) return;

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

      setHasBidFlowStarted(true);
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
  }, [
    editingEstimateId,
    estimateName,
    estimatePayload,
    estimateTags,
    estimateValues,
    urlEstimateId,
  ]);

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

    const refresh = async () => {
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
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, LINKED_DOCUMENT_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    activeTrackedDocumentId,
    activeTrackedPandaDocDocument?.name,
    activeTrackedPandaDocDocument?.status,
  ]);

  useEffect(() => {
    if (!convexAppUrl || !editingEstimateId || !activeTrackedDocumentId) return;
    if (!linkedDocumentLive || linkedDocumentLive.loading) return;
    if (linkedDocumentLive.id !== activeTrackedDocumentId) return;
    const latestGeneratedDocumentId = String(lastGeneration?.document?.id ?? "").trim();
    if (latestGeneratedDocumentId && latestGeneratedDocumentId !== activeTrackedDocumentId) {
      return;
    }
    const estimate = findTeamEstimateById(editingEstimateId);
    if (!estimate) return;

    const history = getPersistedEstimateHistory(estimate);
    let historyIndex = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const candidateDocumentId = String(
        history[index]?.pandadoc?.documentId ?? ""
      ).trim();
      if (candidateDocumentId === activeTrackedDocumentId) {
        historyIndex = index;
        break;
      }
    }
    if (historyIndex < 0) return;

    const existingEntry = history[historyIndex];
    const existingDocument = existingEntry.pandadoc ?? {
      documentId: activeTrackedDocumentId,
    };
    const nextName = String(linkedDocumentLive.name ?? "").trim() || undefined;
    const nextStatus = String(linkedDocumentLive.status ?? "").trim() || undefined;

    const hasDocumentChanges =
      nextName !== existingDocument.name ||
      nextStatus !== existingDocument.status;

    if (!hasDocumentChanges) return;

    const now = Date.now();
    const nextHistory = [...history];
    nextHistory[historyIndex] = {
      ...existingEntry,
      pandadoc: {
        ...existingDocument,
        documentId: activeTrackedDocumentId,
        name: nextName,
        status: nextStatus,
        updatedAt: now,
      },
    };

    void db
      .transact([
        db.tx.estimates[editingEstimateId].update({
          updatedAt: now,
          versionHistory: nextHistory,
        }),
      ])
      .catch(() => {});
  }, [
    db,
    convexAppUrl,
    editingEstimateId,
    activeTrackedDocumentId,
    linkedDocumentLive,
    lastGeneration?.document?.id,
    findTeamEstimateById,
    getPersistedEstimateHistory,
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
        tone: "loading" as const,
      };
    }

    if (canGenerate) {
      return {
        label: "Ready to generate",
        tone: "ready" as const,
      };
    }

    return {
      label: "Awaiting estimate",
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
    setHasBidFlowStarted(true);
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
    if (urlEstimateId) {
      updateEstimateUrl(null);
    }
  }, [updateEstimateUrl, urlEstimateId]);

  const persistGeneratedEstimateVersion = useCallback(
    async (generation?: PandaDocGenerationResponse | null) => {
      if (!convexAppUrl || !convexUser || !activeTeam || !activeMembership) return;
      const snapshot = buildCurrentEstimateSnapshot();
      if (!snapshot.payload) return;

      const now = Date.now();
      const tags = normalizeEstimateTags(estimateTags);
      const pandadocDocument = toPandaDocVersionDocument(generation, now);
      const totalsWithPandaDocValue = mergeTotalsWithPandaDocValue(
        snapshot.totals,
        generation
      );
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
              totals: totalsWithPandaDocValue,
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
        totals: totalsWithPandaDocValue,
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
            totals: totalsWithPandaDocValue,
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
    const resolvedPandaDocTemplate = resolvePandaDocTemplateConfigForEstimate(
      templatePandaDocConfig,
      estimatePayload,
      estimateValues
    );
    if (resolvedPandaDocTemplate.matchError) {
      setError(resolvedPandaDocTemplate.matchError);
      return;
    }
    const templateRecipientRole = String(
      resolvedPandaDocTemplate.recipientRole ??
        templatePandaDocConfig?.recipientRole ??
        ""
    ).trim();
    const templateUuid = String(
      resolvedPandaDocTemplate.templateUuid ??
        templatePandaDocConfig?.templateUuid ??
        ""
    ).trim();
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
    const signerEmail = emailAddress || trackedRecipientEmail;
    const fallbackNameSegments = preparedByName.split(/\s+/).filter(Boolean);
    const fallbackFirstName = fallbackNameSegments[0] ?? "";
    const fallbackLastName = fallbackNameSegments.slice(1).join(" ");
    const signerFirstName =
      user?.firstName?.trim() || trackedRecipientFirstName || fallbackFirstName;
    const signerLastName =
      user?.lastName?.trim() || trackedRecipientLastName || fallbackLastName;
    const usesStandardCornerstoneSigner =
      defaultSignerRole.toLowerCase() === pandadocSignerRole.toLowerCase();
    const generationRecipient = usesStandardCornerstoneSigner
      ? trackedRecipientEmail
        ? {
            email: trackedRecipientEmail,
            firstName: trackedRecipientFirstName || undefined,
            lastName: trackedRecipientLastName || undefined,
            role: trackedRecipientRole || defaultSignerRole || undefined,
          }
        : undefined
      : signerEmail
        ? {
            email: signerEmail,
            firstName: signerFirstName || undefined,
            lastName: signerLastName || undefined,
            role: defaultSignerRole || undefined,
          }
        : undefined;
    const generatedBy = emailAddress
      ? {
          email: emailAddress,
          firstName: user?.firstName?.trim() || fallbackFirstName || undefined,
          lastName: user?.lastName?.trim() || fallbackLastName || undefined,
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
            generatedBy,
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

      const rawData = (await response.json()) as PandaDocGenerationResponse;
      const data: PandaDocGenerationResponse = rawData;

      setLastGeneration(data);
      if (data.shareResult?.status === "failed") {
        const sharedEmail = String(data.shareResult.email ?? "").trim();
        const shareError = String(data.shareResult.error ?? "").trim();
        setError(
          `PandaDoc generated, but sharing${sharedEmail ? ` with ${sharedEmail}` : ""} failed${shareError ? `: ${shareError}` : "."}`
        );
      }
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
      return false;
    }
    if (!convexUser) {
      setError("Sign in to save estimates.");
      return false;
    }
    if (!activeTeam || !activeMembership) {
      setError("Select a team to save estimates.");
      return false;
    }
    if (!estimatePayload && !Object.keys(estimateValues).length) {
      setError("Enter estimate values before saving.");
      return false;
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
          return false;
        }
        const existingProjectId = String(existingEstimate?.project?.id ?? "").trim() || null;
        const snapshot: EstimateSnapshot = {
          title,
          payload,
          totals,
          templateName,
          templateUrl,
        };
        const snapshotChanged = hasEstimateSnapshotChanges(existingEstimate, snapshot);
        const existingTags = normalizeEstimateTags(existingEstimate?.tags).map((tag) =>
          tag.toLowerCase()
        );
        const nextTags = tags.map((tag) => tag.toLowerCase());
        const tagsChanged =
          JSON.stringify(existingTags.sort()) !== JSON.stringify(nextTags.sort());
        const projectChanged = existingProjectId !== targetProjectId;
        if (!snapshotChanged && !tagsChanged && !projectChanged) {
          return true;
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
        return true;
      }

      const targetProjectId = resolveEstimateProjectId(null);
      if (!targetProjectId) {
        setError("Create or select a project before saving estimates.");
        return false;
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
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
      return false;
    }
  };

  const handleRenameEstimate = useCallback(
    async (estimateId: string, newName: string) => {
      setError(null);
      const normalized = newName.trim();
      if (!normalized) {
        setError("Estimate name can't be empty.");
        return false;
      }
      if (!convexAppUrl || !convexUser || !activeTeam || !activeMembership) {
        setError("Sign in and select a team first.");
        return false;
      }
      try {
        const now = Date.now();
        await db.transact(
          db.tx.estimates[estimateId].update({
            title: normalized,
            updatedAt: now,
          })
        );
        if (editingEstimateId === estimateId) {
          setEstimateName(normalized);
        }
        setProjectActionNotice(`Renamed estimate to "${normalized}".`);
        setRenamingEstimateId(null);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        setError(message);
        return false;
      }
    },
    [activeMembership, activeTeam, convexAppUrl, convexUser, editingEstimateId]
  );

  const handleRenameProject = useCallback(
    async (projectId: string, newName: string) => {
      setError(null);
      const normalized = newName.trim();
      if (!normalized) {
        setError("Project name can't be empty.");
        return false;
      }
      if (!convexAppUrl || !convexUser || !activeTeam || !activeMembership) {
        setError("Sign in and select a team first.");
        return false;
      }
      try {
        const now = Date.now();
        await db.transact(
          db.tx.projects[projectId].update({
            name: normalized,
            updatedAt: now,
          })
        );
        setProjectActionNotice(`Renamed project to "${normalized}".`);
        setRenamingProjectId(null);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        setError(message);
        return false;
      }
    },
    [activeMembership, activeTeam, convexAppUrl, convexUser]
  );

  const handleArchiveEstimate = useCallback(
    async (estimateId: string, archive: boolean) => {
      setError(null);
      if (!convexAppUrl || !convexUser || !activeTeam || !activeMembership) {
        setError("Sign in and select a team first.");
        return;
      }
      setArchivingId(estimateId);
      try {
        const now = Date.now();
        await db.transact(
          db.tx.estimates[estimateId].update({
            status: archive ? "archived" : "draft",
            updatedAt: now,
          })
        );
        setProjectActionNotice(archive ? "Estimate archived." : "Estimate restored.");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        setError(message);
      } finally {
        setArchivingId(null);
      }
    },
    [activeMembership, activeTeam, convexAppUrl, convexUser]
  );

  const handleArchiveProject = useCallback(
    async (projectId: string, archive: boolean) => {
      setError(null);
      if (!convexAppUrl || !convexUser || !activeTeam || !activeMembership) {
        setError("Sign in and select a team first.");
        return;
      }
      setArchivingId(projectId);
      try {
        const now = Date.now();
        await db.transact(
          db.tx.projects[projectId].update({
            status: archive ? "archived" : "active",
            updatedAt: now,
          })
        );
        setProjectActionNotice(archive ? "Project archived." : "Project restored.");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        setError(message);
      } finally {
        setArchivingId(null);
      }
    },
    [activeMembership, activeTeam, convexAppUrl, convexUser]
  );

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

  const handleDeleteTeamEstimate = useCallback(
    (estimate: any) => {
      setError(null);
      if (!convexAppUrl) {
        setError("Convex is not configured yet.");
        return;
      }
      if (!convexUser) {
        setError("Sign in to delete estimates.");
        return;
      }
      if (!activeTeam || !activeMembership) {
        setError("Select a team workspace first.");
        return;
      }

      const estimateId = String(estimate?.id ?? "").trim();
      if (!estimateId) {
        setError("Select an estimate to delete.");
        return;
      }
      const ownerId = String(estimate?.owner?.id ?? "").trim();
      const canDeleteEstimate = Boolean(
        hasTeamAdminAccess || (ownerId && ownerId === convexUser.id)
      );
      if (!canDeleteEstimate) {
        setError("You can only delete estimates you created.");
        return;
      }

      const estimateTitle = String(estimate?.title ?? "").trim() || "Untitled Estimate";
      const sourceProjectId = String(estimate?.project?.id ?? "").trim();
      setDeleteEstimateDialog({
        id: estimateId,
        title: estimateTitle,
        projectId: sourceProjectId,
      });
    },
    [activeMembership, activeTeam, convexAppUrl, convexUser, hasTeamAdminAccess]
  );

  const handleConfirmDeleteTeamEstimate = useCallback(async () => {
    setError(null);
    if (!deleteEstimateDialog) return;
    if (!convexAppUrl) {
      setError("Convex is not configured yet.");
      return;
    }
    if (!convexUser) {
      setError("Sign in to delete estimates.");
      return;
    }
    if (!activeTeam || !activeMembership) {
      setError("Select a team workspace first.");
      return;
    }
    const estimateId = String(deleteEstimateDialog.id ?? "").trim();
    if (!estimateId) {
      setDeleteEstimateDialog(null);
      return;
    }

    setDeletingEstimateId(estimateId);
    try {
      const now = Date.now();
      await db.transact([
        db.tx.estimates[estimateId].delete(),
        ...(deleteEstimateDialog.projectId
          ? [db.tx.projects[deleteEstimateDialog.projectId].update({ updatedAt: now })]
          : []),
      ]);

      if (editingEstimateId === estimateId) {
        setEditingEstimateId(null);
      }
      setHistoryEstimateId((current) => (current === estimateId ? null : current));
      setMoveTargetByEstimateId((previous) => {
        if (!(estimateId in previous)) return previous;
        const next = { ...previous };
        delete next[estimateId];
        return next;
      });
      setProjectActionNotice(`Deleted "${deleteEstimateDialog.title}".`);
      setDeleteEstimateDialog(null);
      if (urlEstimateId && urlEstimateId === estimateId) {
        updateEstimateUrl(null, "replace");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setDeletingEstimateId(null);
    }
  }, [
    activeMembership,
    activeTeam,
    convexAppUrl,
    convexUser,
    deleteEstimateDialog,
    editingEstimateId,
    updateEstimateUrl,
    urlEstimateId,
  ]);

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

    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleGenerate,
    hasSelectedProject,
    handleSaveEstimateToDb,
    resetEstimateWorkspace,
  ]);

  const handleOpenActiveEstimateHistory = useCallback(() => {
    if (!activeEditingEstimate) {
      setError("Load an estimate to inspect version history.");
      return;
    }
    setHistoryEstimateId(activeEditingEstimate.id);
    setProjectActionNotice("Version history opened.");
  }, [activeEditingEstimate]);

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
      setProjectCreatePopoverOpen(false);
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
          marginThresholds: DEFAULT_MARGIN_THRESHOLDS,
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

  const handleLoadTeamEstimate = useCallback((estimate: any) => {
    setHasBidFlowStarted(true);
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
  }, []);

  const handleOpenTeamEstimate = useCallback(
    (estimate: any, mode: "push" | "replace" = "push") => {
      const estimateId = String(estimate?.id ?? "").trim();
      if (!estimateId) return;
      routedEstimateLoadedRef.current = estimateId;
      handleLoadTeamEstimate(estimate);
      updateEstimateUrl(estimateId, mode);
    },
    [handleLoadTeamEstimate, updateEstimateUrl]
  );

  useEffect(() => {
    if (!urlEstimateId) {
      routedEstimateLoadedRef.current = null;
      return;
    }
    const estimate = findTeamEstimateById(urlEstimateId);
    if (!estimate) {
      routedEstimateLoadedRef.current = null;
      return;
    }
    if (routedEstimateLoadedRef.current === urlEstimateId) {
      return;
    }

    routedEstimateLoadedRef.current = urlEstimateId;
    handleLoadTeamEstimate(estimate);
  }, [
    findTeamEstimateById,
    handleLoadTeamEstimate,
    urlEstimateId,
  ]);

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
      setHasBidFlowStarted(true);
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

  return (
    <main className="relative min-h-screen">
      <ConvexAuthSync
        onDomainError={setAuthError}
        onAuthError={setConvexSetupError}
      />
      <div className="relative w-full min-h-screen flex flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-5 sm:px-8">
            <div className="flex items-center gap-4">
              <BrandMark tone="auto" size="sm" />
              <div className="hidden h-6 w-px bg-border sm:block" />
              <span className="hidden text-[13px] text-muted-foreground sm:inline">
                Proposal Studio
              </span>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              {!clerkEnabled ? (
                <span className="text-xs text-muted-foreground">Auth not configured</span>
              ) : authLoaded ? (
                isSignedIn ? (
                  <div className="flex items-center gap-3">
                    <span className="hidden text-sm text-muted-foreground lg:inline">
                      {preparedByName || user?.primaryEmailAddress?.emailAddress}
                    </span>
                    <UserButton />
                  </div>
                ) : (
                  <SignInButton mode="modal">
                    <Button variant="accent" size="sm">
                      Sign in
                    </Button>
                  </SignInButton>
                )
              ) : (
                <span className="text-xs text-muted-foreground">Loading...</span>
              )}
            </div>
          </div>
        </header>
        <div className="flex-1 mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8">
        {authError ? (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {authError}
          </div>
        ) : null}
        {convexSetupBanner ? (
          <div className="mb-6 rounded-lg border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            {convexSetupBanner}
          </div>
        ) : null}
        {!convexAppUrl ? (
          <div className="mb-6 rounded-lg border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Convex is not configured. Add `NEXT_PUBLIC_CONVEX_URL` to
            enable the project library.
          </div>
        ) : null}
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-light tracking-tight sm:text-4xl">
            {isEstimateMode ? "Estimate Editor" : "Dashboard"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {isEstimateMode ? "Build and generate proposals" : "Manage your projects and estimates"}
            </p>
            <Badge variant="outline" className={cn("text-[10px]", statusClassName)}>
              {status.label}
            </Badge>
          </div>
        </div>

        {appLocked ? (
          <section className="mt-4">
            <Card className="shadow-elevated overflow-hidden">
              <div className="bg-cs-gunmetal px-8 py-10 text-center dark:bg-card">
                <BrandMark tone="dark" className="justify-center" />
              </div>
              <CardContent className="flex flex-col items-center gap-5 py-10 text-center">
                <div>
                  <h2 className="text-xl font-serif font-light">Welcome to Proposal Studio</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {authLoaded ? "Sign in with your Microsoft account to get started." : "Checking your account..."}
                  </p>
                </div>
                {clerkEnabled ? (
                  <SignInButton mode="modal">
                    <Button variant="accent" size="lg" className="shadow-glow">
                      Sign in with Microsoft
                    </Button>
                  </SignInButton>
                ) : (
                  <Button variant="accent" size="lg" disabled>
                    Sign in with Microsoft
                  </Button>
                )}
              </CardContent>
            </Card>
          </section>
        ) : (
          <>
        {authLoaded && isSignedIn ? (
          <section className="space-y-6">
            {(convexAuthError || teamError) ? (
              <div className="space-y-2">
                {convexAuthError ? (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {convexAuthError.message}
                  </div>
                ) : null}
                {teamError ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <span>{teamError}</span>
                    <Button variant="outline" size="sm" onClick={handleRetryTeamSetup} disabled={teamSaving}>Retry</Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {convexLoading ? (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                Connecting to workspace...
              </div>
            ) : !convexUser && !convexSetupError && !convexAuthError ? (
              <div className="text-sm text-muted-foreground">
                Waiting for auth sync...
              </div>
            ) : null}
            {teamReady ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-5 py-3 shadow-subtle">
                <div className="flex items-center gap-2.5 text-sm">
                  <div className="h-2 w-2 rounded-full bg-accent" />
                  <span className="font-medium">{orgTeam?.name}</span>
                  <span className="text-muted-foreground">&middot;</span>
                  <span className="text-muted-foreground capitalize">{orgRole === "owner" ? "Owner" : orgRole === "admin" ? "Admin" : "Member"}</span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {hasTeamAdminAccess ? (
                    <Button asChild variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">
                      <Link href="/team-admin">Manage team</Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : !teamError && !convexLoading ? (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                {orgTeam ? "Joining workspace..." : "Setting up workspace..."}
              </div>
            ) : null}

            {!isEstimateMode ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.35fr)_minmax(0,0.65fr)] xl:grid-cols-[minmax(320px,0.35fr)_minmax(0,0.65fr)] items-stretch">
              <div className="flex flex-col">
                <Card className="shadow-elevated flex-1 flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-serif font-light tracking-tight">Projects</CardTitle>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {teamProjects.length} projects &middot; {teamEstimates.length} estimates
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 flex-1 flex flex-col">
                  <div className="space-y-2">
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
                    ) : null}
                  </div>
                  <div className="space-y-2 flex-1 flex flex-col min-h-0">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={projectLibraryQuery}
                          onChange={(event) =>
                            setProjectLibraryQuery(event.target.value)
                          }
                          className="pl-9"
                          placeholder="Search projects..."
                        />
                      </div>
                      <Popover
                          open={projectCreatePopoverOpen}
                          onOpenChange={(open) => {
                            setProjectCreatePopoverOpen(open);
                            if (open && !newProjectName.trim()) {
                              setNewProjectName(
                                estimateName.trim() ||
                                  activeProject?.name ||
                                  "New Project"
                              );
                            }
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="accent"
                              size="icon"
                              className="h-10 w-10 shrink-0"
                              disabled={!isSignedIn || !teamReady}
                            >
                              <Plus className="h-4 w-4" />
                              <span className="sr-only">Create project</span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-72 space-y-3">
                        <p className="text-sm font-semibold text-foreground">
                          New project
                        </p>
                          <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">
                              Project name
                            </label>
                            <Input
                              value={newProjectName}
                              onChange={(event) =>
                                setNewProjectName(event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                void handleCreateProject();
                              }}
                              placeholder="Project name..."
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setProjectCreatePopoverOpen(false)}
                            >
                              Cancel
                            </Button>
                            <Button
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
                          </PopoverContent>
                        </Popover>
                    </div>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => setShowArchivedProjects((v) => !v)}
                      >
                        {showArchivedProjects ? "Hide archived" : "Show archived"}
                      </button>
                    </div>
                    {filteredProjectLibraryItems.length ? (
                      <ScrollArea className="flex-1 min-h-[200px]">
                        <div className="space-y-0.5">
                          {filteredProjectLibraryItems.map((project) => {
                            const isActive = activeProjectId === project.id;
                            const isProjectArchived = project.status === "archived";
                            const isRenaming = renamingProjectId === project.id;
                            const isUnassigned = project.id === UNASSIGNED_PROJECT_KEY;
                            return (
                              <div
                                key={project.id}
                                className={cn(
                                  "group relative rounded-lg px-3 py-2.5 transition-colors",
                                  isActive
                                    ? "bg-accent/8 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-accent"
                                    : "hover:bg-muted/50",
                                  isProjectArchived && "opacity-40"
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    className="flex-1 text-left"
                                    onClick={() => setActiveProjectId(project.id)}
                                  >
                                    <p className={cn("text-sm", isActive ? "font-semibold text-foreground" : "text-foreground")}>
                                      {project.name}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {project.estimateCount} estimate{project.estimateCount === 1 ? "" : "s"}
                                      {project.updatedAt ? ` · ${formatRelativeTime(project.updatedAt)}` : ""}
                                    </p>
                                  </button>
                                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                    {isProjectArchived ? (
                                      <Badge variant="muted" className="mr-1 text-[10px]">Archived</Badge>
                                    ) : null}
                                    {!isUnassigned ? (
                                      <>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-muted-foreground"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setRenamingProjectId(project.id);
                                            setRenameProjectValue(project.name);
                                          }}
                                        >
                                          <PencilLine className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-muted-foreground"
                                          disabled={archivingId === project.id}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleArchiveProject(project.id, !isProjectArchived);
                                          }}
                                        >
                                          {archivingId === project.id ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                          ) : isProjectArchived ? (
                                            <ArchiveRestore className="h-3 w-3" />
                                          ) : (
                                            <Archive className="h-3 w-3" />
                                          )}
                                        </Button>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                                {isRenaming ? (
                                  <div className="mt-2 flex items-center gap-2">
                                    <Input
                                      value={renameProjectValue}
                                      onChange={(e) => setRenameProjectValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          void handleRenameProject(project.id, renameProjectValue);
                                        }
                                        if (e.key === "Escape") setRenamingProjectId(null);
                                      }}
                                      className="h-8 text-sm"
                                      autoFocus
                                    />
                                    <Button size="sm" className="h-8" onClick={() => void handleRenameProject(project.id, renameProjectValue)}>
                                      Save
                                    </Button>
                                    <Button variant="ghost" size="sm" className="h-8" onClick={() => setRenamingProjectId(null)}>
                                      Cancel
                                    </Button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    ) : (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        {projectLibraryItems.length
                          ? "No projects match your search."
                          : "No projects yet."}
                      </p>
                    )}
                  </div>
                </CardContent>
                </Card>
              </div>

              <Card className="shadow-elevated">
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-serif font-light tracking-tight">
                      {activeProject?.name ? activeProject.name : "Estimates"}
                    </CardTitle>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {filteredTeamEstimates.length} of {teamEstimates.length}
                    </span>
                  </div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={teamEstimateQuery}
                      onChange={(event) => setTeamEstimateQuery(event.target.value)}
                      placeholder="Search estimates..."
                      className="pl-9"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(["all", "mine", "recent", "archived"] as const).map((scope) => (
                      <Button
                        key={scope}
                        variant={teamEstimateScope === scope ? "secondary" : "ghost"}
                        size="sm"
                        className={cn("h-8 text-xs", teamEstimateScope !== scope && "text-muted-foreground")}
                        onClick={() => setTeamEstimateScope(scope)}
                      >
                        {scope === "all" ? "All" : scope === "mine" ? "Mine" : scope === "recent" ? "Recent" : "Archived"}
                      </Button>
                    ))}
                    {teamEstimateQuery.trim() ? (
                      <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => setTeamEstimateQuery("")}>
                        Clear
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {projectActionNotice ? (
                    <div className="rounded-lg border border-emerald-600/20 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                      {projectActionNotice}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-end">
                    <Button
                      variant="accent"
                      size="sm"
                      className="shadow-glow/50"
                      onClick={resetEstimateWorkspace}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New estimate
                    </Button>
                  </div>
                  {!teamReady ? (
                    <div className="text-sm text-muted-foreground">
                      Preparing your team workspace...
                    </div>
                  ) : !activeProjectId ? (
                    <div className="rounded-xl border border-border bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
                      Create your first project to start organizing estimates.
                    </div>
                  ) : filteredTeamEstimates.length ? (
                    <div className="space-y-1">
                      {filteredTeamEstimates.map((estimate) => {
                          const currentVersion = getCurrentVersionForEstimate(estimate);
                          const historyOpen = historyEstimateId === estimate.id;
                          const editingCurrent = editingEstimateId === estimate.id;
                          const tags = normalizeEstimateTags(estimate?.tags);
                          const projectType = getEstimateProjectType(estimate);
                          const isEstimateArchived = String(estimate?.status ?? "").trim() === "archived";
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
                          const isDeletingEstimate = deletingEstimateId === estimate.id;
                          const estimateOwnerId = String(
                            estimate?.owner?.id ?? ""
                          ).trim();
                          const canDeleteEstimate = Boolean(
                            hasTeamAdminAccess ||
                              (convexUser?.id &&
                                estimateOwnerId &&
                                estimateOwnerId === convexUser.id)
                          );
                          const isRenamingThisEstimate = renamingEstimateId === estimate.id;
                          const estimateHref = `/estimates/${encodeURIComponent(
                            String(estimate.id ?? "")
                          )}`;
                          return (
                            <div
                              key={estimate.id}
                              className={cn(
                                "group rounded-lg border border-transparent px-3 py-2.5 transition-colors",
                                historyOpen ? "border-border bg-muted/50" : "hover:bg-muted/40",
                                isEstimateArchived && "opacity-50"
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  {isRenamingThisEstimate ? (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        value={renameEstimateValue}
                                        onChange={(e) => setRenameEstimateValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            void handleRenameEstimate(estimate.id, renameEstimateValue);
                                          }
                                          if (e.key === "Escape") setRenamingEstimateId(null);
                                        }}
                                        className="h-8 text-sm"
                                        autoFocus
                                      />
                                      <Button size="sm" className="h-8" onClick={() => void handleRenameEstimate(estimate.id, renameEstimateValue)}>Save</Button>
                                      <Button variant="ghost" size="sm" className="h-8" onClick={() => setRenamingEstimateId(null)}>Cancel</Button>
                                    </div>
                                  ) : (
                                    <Link
                                      href={estimateHref}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-sm font-medium text-foreground hover:text-accent transition-colors"
                                    >
                                      {estimate.title ?? "Untitled"}
                                    </Link>
                                  )}
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <span>v{currentVersion}</span>
                                    {projectType ? (
                                      <>
                                        <span>&middot;</span>
                                        <span>{projectType}</span>
                                      </>
                                    ) : null}
                                    <span>&middot;</span>
                                    <span>{formatRelativeTime(estimate.updatedAt)}</span>
                                    {isEstimateArchived ? (
                                      <>
                                        <span>&middot;</span>
                                        <span className="text-muted-foreground/70">Archived</span>
                                      </>
                                    ) : null}
                                    {editingCurrent ? (
                                      <>
                                        <span>&middot;</span>
                                        <span className="text-accent">Editing</span>
                                      </>
                                    ) : null}
                                  </div>
                                  {tags.length ? (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {tags.map((tag) => (
                                        <Badge key={`${estimate.id}-${tag}`} variant="muted" className="text-[10px]">
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="Rename" onClick={() => { setRenamingEstimateId(estimate.id); setRenameEstimateValue(String(estimate.title ?? "")); }}>
                                    <PencilLine className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={cn("h-7 w-7", historyOpen ? "text-accent" : "text-muted-foreground")}
                                    title="Version history"
                                    disabled={isDeletingEstimate}
                                    onClick={() => {
                                      setHistoryError(null);
                                      setPreviewVersionEntry(null);
                                      setHistoryEstimateId((current) =>
                                        current === estimate.id ? null : estimate.id
                                      );
                                    }}
                                  >
                                    <History className="h-3 w-3" />
                                  </Button>
                                  {destinationProjects.length ? (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-muted-foreground"
                                          title="Move to project"
                                          disabled={isMovingEstimate || isDeletingEstimate}
                                        >
                                          <ArrowRightLeft className="h-3 w-3" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent align="end" className="w-72 space-y-3">
                                        <p className="text-xs text-muted-foreground">
                                          Move to project
                                        </p>
                                        <Select
                                          value={selectedMoveTarget || undefined}
                                          onValueChange={(value) =>
                                            setMoveTargetByEstimateId((previous) => ({
                                              ...previous,
                                              [estimate.id]: value,
                                            }))
                                          }
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select destination project" />
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
                                        <div className="flex justify-end">
                                          <Button
                                            size="sm"
                                            disabled={isMovingEstimate || !selectedMoveTarget}
                                            onClick={() =>
                                              void handleMoveEstimateToProject(estimate, selectedMoveTarget)
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
                                      </PopoverContent>
                                    </Popover>
                                  ) : null}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground"
                                    title={isEstimateArchived ? "Restore" : "Archive"}
                                    disabled={archivingId === estimate.id || isDeletingEstimate}
                                    onClick={() => void handleArchiveEstimate(estimate.id, !isEstimateArchived)}
                                  >
                                    {archivingId === estimate.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : isEstimateArchived ? (
                                      <ArchiveRestore className="h-3 w-3" />
                                    ) : (
                                      <Archive className="h-3 w-3" />
                                    )}
                                  </Button>
                                  {canDeleteEstimate ? (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                      title="Delete"
                                      disabled={isDeletingEstimate}
                                      onClick={() =>
                                        void handleDeleteTeamEstimate(estimate)
                                      }
                                    >
                                      {isDeletingEstimate ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3 w-3" />
                                      )}
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {teamEstimates.length
                        ? "No estimates match your filters."
                        : activeProjectId === UNASSIGNED_PROJECT_KEY
                          ? "No unassigned estimates."
                          : "No estimates in this project yet."}
                    </p>
                  )}
                  {historyError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {historyError}
                    </div>
                  ) : null}
                  {selectedHistoryEstimate ? (
                    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">
                          History: {selectedHistoryEstimate.title ?? "Untitled"}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-muted-foreground"
                          onClick={() => {
                            setHistoryEstimateId(null);
                            setPreviewVersionEntry(null);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      {selectedHistoryEntries.length ? (
                        <ScrollArea className="h-48 rounded-md border border-border">
                          <div className="divide-y divide-border/60">
                            {selectedHistoryEntries.map((entry) => {
                              const actionId = `${selectedHistoryEstimate.id}:${entry.id}`;
                              const reverting = historyActionId === actionId;
                              const isCurrent =
                                selectedHistoryCurrentVersion === entry.version;
                              const isPreviewing = previewVersionEntry?.id === entry.id;
                              return (
                                <div
                                  key={entry.id}
                                  className={cn(
                                    "px-3 py-2",
                                    isPreviewing && "bg-accent/5"
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-4">
                                    <div>
                                      <p className="text-xs font-medium text-foreground">
                                        v{entry.version} ·{" "}
                                        {getEstimateVersionActionLabel(entry.action)}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {entry.createdByUserId && teamMemberNameById[entry.createdByUserId]
                                          ? `${teamMemberNameById[entry.createdByUserId]} · `
                                          : ""}
                                        {new Date(entry.createdAt).toLocaleString()}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      {isCurrent ? (
                                        <Badge variant="outline" className="bg-card">
                                          Current
                                        </Badge>
                                      ) : null}
                                      {!isCurrent && entry.payload ? (
                                        <Button
                                          variant={isPreviewing ? "secondary" : "ghost"}
                                          size="sm"
                                          onClick={() =>
                                            setPreviewVersionEntry(
                                              isPreviewing ? null : entry
                                            )
                                          }
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                          {isPreviewing ? "Close" : "Preview"}
                                        </Button>
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
                      {previewVersionEntry ? (() => {
                        const currentPayload = selectedHistoryEstimate?.payload;
                        const versionPayload = previewVersionEntry.payload;
                        const currentTotals = selectedHistoryEstimate?.totals;
                        const versionTotals = previewVersionEntry.totals;
                        type DiffEntry = { group: string; field: string; current: string; version: string };
                        const diffs: DiffEntry[] = [];
                        const fmtMoney = (v: any) => typeof v === "number" ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "(none)";
                        const fmtPercent = (v: any) => {
                          const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
                          return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : String(v ?? "(empty)");
                        };
                        const str = (v: any) => String(v ?? "").trim();
                        const addDiff = (group: string, field: string, cur: string, ver: string) => {
                          if (cur !== ver) diffs.push({ group, field, current: cur || "(empty)", version: ver || "(empty)" });
                        };

                        // Title
                        addDiff("General", "Estimate name", str(selectedHistoryEstimate?.title), str(previewVersionEntry.title));

                        // Who changed it
                        const versionAuthor = previewVersionEntry.createdByUserId
                          ? teamMemberNameById[previewVersionEntry.createdByUserId] ?? previewVersionEntry.createdByUserId
                          : "";

                        // Info fields (all of them)
                        const allInfoFields = [
                          ["prepared_for", "Prepared for"],
                          ["project_name", "Project name"],
                          ["project_type", "Project type"],
                          ["city_state_zip", "City, State, ZIP"],
                          ["proposal_date", "Proposal date"],
                          ["plan_set_date", "Plan set date"],
                          ["prepared_by", "Prepared by"],
                          ["project_address", "Project address"],
                        ];
                        for (const [key, label] of allInfoFields) {
                          const cur = str(currentPayload?.values?.[key] ?? currentPayload?.info?.[key]);
                          const ver = str(versionPayload?.values?.[key] ?? versionPayload?.info?.[key]);
                          addDiff("Project Details", label, cur, ver);
                        }

                        // Calculator fields
                        const calcFields = [
                          ["product_markup_default", "Default product markup", fmtPercent],
                          ["install_markup", "Install markup", fmtPercent],
                          ["bucking_rate", "Bucking rate", str],
                          ["waterproofing_rate", "Waterproofing rate", str],
                          ["rentals", "Rentals", str],
                          ["override_bucking_cost", "Override bucking cost", str],
                          ["override_waterproofing_cost", "Override waterproof cost", str],
                          ["override_install_total", "Override install total", str],
                        ] as const;
                        for (const [key, label, fmt] of calcFields) {
                          const cur = fmt(currentPayload?.calculator?.[key]);
                          const ver = fmt(versionPayload?.calculator?.[key]);
                          addDiff("Calculator", label, cur, ver);
                        }

                        // Change order fields
                        const coFields = [
                          ["vendorName", "CO vendor"],
                          ["vendorCost", "CO vendor cost"],
                          ["vendorMarkup", "CO vendor markup"],
                          ["laborCost", "CO labor cost"],
                          ["laborMarkup", "CO labor markup"],
                        ];
                        for (const [key, label] of coFields) {
                          const cur = str(currentPayload?.changeOrder?.[key]);
                          const ver = str(versionPayload?.changeOrder?.[key]);
                          addDiff("Change Order", label, cur, ver);
                        }

                        // Products
                        const curProducts: any[] = Array.isArray(currentPayload?.products) ? currentPayload.products : [];
                        const verProducts: any[] = Array.isArray(versionPayload?.products) ? versionPayload.products : [];
                        const maxProducts = Math.max(curProducts.length, verProducts.length);
                        for (let i = 0; i < maxProducts; i++) {
                          const cp = curProducts[i];
                          const vp = verProducts[i];
                          const label = `Product ${i + 1}`;
                          if (!cp && vp) { addDiff("Products", label, "(not present)", `${str(vp.name) || "Unnamed"}`); continue; }
                          if (cp && !vp) { addDiff("Products", label, `${str(cp.name) || "Unnamed"}`, "(removed)"); continue; }
                          if (!cp || !vp) continue;
                          const productFields = [
                            ["name", "Vendor"], ["price", "Price"], ["markup", "Markup"],
                            ["interior_frame_color", "Frame color"], ["exterior_frame_color", "Ext. frame color"],
                            ["glass_type", "Glass type"], ["glass_makeup", "Glass makeup"],
                            ["door_hardware_color", "Door HW color"], ["door_hinge_color", "Door hinge color"],
                            ["window_hardware_color", "Window HW color"],
                          ];
                          for (const [key, fieldLabel] of productFields) {
                            addDiff("Products", `${label} ${fieldLabel}`, str(cp[key]), str(vp[key]));
                          }
                          const boolFields = [
                            ["split_finish", "Split finish"], ["stainless_operating_hardware", "SS hardware"],
                            ["has_screens", "Screens"], ["euroPricingEnabled", "EUR pricing"],
                          ];
                          for (const [key, fieldLabel] of boolFields) {
                            addDiff("Products", `${label} ${fieldLabel}`, cp[key] ? "Yes" : "No", vp[key] ? "Yes" : "No");
                          }
                        }

                        // Bucking lines
                        const curBucking: any[] = Array.isArray(currentPayload?.bucking) ? currentPayload.bucking : [];
                        const verBucking: any[] = Array.isArray(versionPayload?.bucking) ? versionPayload.bucking : [];
                        const maxBucking = Math.max(curBucking.length, verBucking.length);
                        if (curBucking.length !== verBucking.length) {
                          addDiff("Bucking", "Line count", String(curBucking.length), String(verBucking.length));
                        }
                        for (let i = 0; i < maxBucking; i++) {
                          const cb = curBucking[i];
                          const vb = verBucking[i];
                          const label = `Line ${i + 1}`;
                          if (!cb && vb) { addDiff("Bucking", label, "(not present)", "Added"); continue; }
                          if (cb && !vb) { addDiff("Bucking", label, "Present", "(removed)"); continue; }
                          if (!cb || !vb) continue;
                          const buckingFields = [
                            ["unit_type", "Unit type"], ["vendor_id", "Vendor"], ["qty", "Qty"],
                            ["sqft", "SqFt"], ["replacement_qty", "Replacement"], ["clerestory_qty", "Clerestory"],
                          ];
                          for (const [key, fieldLabel] of buckingFields) {
                            addDiff("Bucking", `${label} ${fieldLabel}`, str(cb[key]), str(vb[key]));
                          }
                        }

                        // Totals
                        const totalFields = [
                          ["total_contract_price", "Total contract"],
                          ["product_price", "Product price"],
                          ["installation_price", "Installation price"],
                          ["bucking_price", "Bucking price"],
                          ["waterproofing_price", "Waterproofing price"],
                        ];
                        for (const [key, label] of totalFields) {
                          const cur = currentTotals?.[key];
                          const ver = versionTotals?.[key];
                          if (cur !== ver && (cur != null || ver != null)) {
                            diffs.push({ group: "Totals", field: label, current: fmtMoney(cur), version: fmtMoney(ver) });
                          }
                        }

                        // Group diffs for display
                        const groupOrder = ["General", "Project Details", "Calculator", "Change Order", "Products", "Bucking", "Totals"];
                        const groupedDiffs = groupOrder
                          .map((group) => ({ group, items: diffs.filter((d) => d.group === group) }))
                          .filter((g) => g.items.length > 0);

                        return (
                          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-foreground">
                                Comparing current with v{previewVersionEntry.version}
                              </p>
                              {versionAuthor ? (
                                <p className="text-xs text-muted-foreground">
                                  by {versionAuthor}
                                </p>
                              ) : null}
                            </div>
                            {groupedDiffs.length ? (
                              <div className="space-y-2">
                                {groupedDiffs.map(({ group, items }) => (
                                  <div key={group}>
                                    <p className="text-[10px] font-medium text-muted-foreground mb-1">{group}</p>
                                    <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
                                      {items.map((diff, idx) => (
                                        <div key={`${diff.field}-${idx}`} className="grid grid-cols-3 gap-px bg-border/30 text-xs">
                                          <div className="bg-card px-2 py-1 text-muted-foreground">{diff.field}</div>
                                          <div className="bg-red-500/5 px-2 py-1 text-foreground">{diff.current}</div>
                                          <div className="bg-emerald-500/5 px-2 py-1 text-foreground">{diff.version}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">No differences detected.</p>
                            )}
                          </div>
                        );
                      })() : null}
                    </div>
                  ) : null}
                  {editingEstimateId ? (
                    <div className="text-xs text-muted-foreground">
                      Editing a project estimate.
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
            ) : null}
          </section>
        ) : null}

        {(isEstimateMode || bidFlowStarted) ? (
          <section
            id="step-input"
            className={cn("space-y-6", !isEstimateMode && "mt-10")}
          >
          {isEstimateMode ? (
            <div>
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground" asChild>
                <Link href="/">
                  <ArrowLeft className="h-3 w-3" />
                  Dashboard
                </Link>
              </Button>
            </div>
          ) : null}

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
              marginThresholds={activeTeam?.marginThresholds ?? null}
              projectTypeOptions={mergedProjectTypeOptions}
              onActivate={() => {
                setError(null);
              }}
            />

            <Card id="step-generate" className="shadow-elevated">
              <CardContent className="pt-5 space-y-4">
                {error ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
                {showProgress ? (
                  <div className="space-y-2 rounded-lg bg-muted/50 px-3 py-2.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{progressLabel ?? "Working..."}</span>
                      <span>{progressPercent}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-accent transition-all duration-500"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => void handleSaveEstimateToDb()}
                    disabled={!isSignedIn || !teamReady || !hasSelectedProject}
                  >
                    <Save className="h-4 w-4" />
                    Save to project
                  </Button>
                  <Button
                    variant="accent"
                    className="shadow-glow/50"
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
                    size="sm"
                    onClick={() => void handleCopyPlanningLines()}
                    disabled={
                      !canDownloadPlanningLines ||
                      isPlanningLinesCopying ||
                      isGenerating
                    }
                  >
                    {isPlanningLinesCopying ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5" />
                    )}
                    {isPlanningLinesCopying
                      ? "Copying..."
                      : "Copy _SYNC rows"}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {activeTrackedPandaDocDocument?.documentId ? (
                    <span>
                      PandaDoc: <span className="text-foreground">{activeTrackedPandaDocDocument.name ?? activeTrackedPandaDocDocument.documentId}</span>
                      {" · "}
                      {linkedDocumentLive?.loading
                        ? "checking..."
                        : formatPandaDocStatus(resolvedTrackedDocumentStatus)}
                    </span>
                  ) : null}
                  {templateConfig ? (
                    <span>
                      Preset: <span className="text-foreground">{formatTemplateDisplayName(templateConfig.name, templateConfig.templateVersion)}</span>
                    </span>
                  ) : null}
                </div>

                {activeTrackedPandaDocDocument?.documentId &&
                trackedDocumentNeedsDraftRevert ? (
                  <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-900">
                    Document status is{" "}
                    {formatPandaDocStatus(resolvedTrackedDocumentStatus)}. Regenerate
                    will move it back to Draft.
                  </p>
                ) : null}
                {activeTrackedPandaDocDocument?.documentId &&
                trackedDocumentIsArchived ? (
                  <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-900">
                    The linked document is archived. Regenerate will create a replacement.
                  </p>
                ) : null}
                {activeTrackedPandaDocDocument?.documentId &&
                linkedDocumentLive?.error ? (
                  <p className="text-xs text-muted-foreground">
                    Unable to refresh PandaDoc status: {linkedDocumentLive.error}
                  </p>
                ) : null}

                <div className="flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
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
                    placeholder="Add tag..."
                    className="flex-1 max-w-xs"
                  />
                  {estimateTags.length ? (
                    <div className="flex flex-wrap gap-1.5">
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
                  ) : null}
                </div>

                {lastGeneration?.document?.id ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
                    <span className="text-xs text-muted-foreground">
                      Last: {lastGeneration.document.name ?? lastGeneration.document.id}
                      {" · "}
                      {formatPandaDocStatus(lastGeneration.document.status)}
                    </span>
                    {lastGeneration.session?.url ? (
                      <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                        <a href={lastGeneration.session.url} target="_blank" rel="noreferrer">
                          Signing session
                        </a>
                      </Button>
                    ) : null}
                    {lastGeneration.document?.sharedLink ? (
                      <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                        <a href={lastGeneration.document.sharedLink} target="_blank" rel="noreferrer">
                          Recipient link
                        </a>
                      </Button>
                    ) : null}
                    {lastGeneration.document?.appUrl ? (
                      <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                        <a href={lastGeneration.document.appUrl} target="_blank" rel="noreferrer">
                          Open PandaDoc
                        </a>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </section>
        ) : (
          <section className="mt-10">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 py-12 text-center">
              <FileText className="h-5 w-5 text-muted-foreground/50" />
              <div>
                <p className="text-sm font-serif font-light text-foreground">Ready to build a proposal?</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Select an estimate above or start a new one.
                </p>
              </div>
              <Button variant="accent" size="sm" className="mt-1 shadow-glow/50" onClick={resetEstimateWorkspace}>
                <Plus className="h-3.5 w-3.5" />
                New estimate
              </Button>
            </div>
          </section>
        )}

          </>
        )}

        <AlertDialog
          open={Boolean(deleteEstimateDialog)}
          onOpenChange={(open) => {
            if (open) return;
            if (deletingEstimateId) return;
            setDeleteEstimateDialog(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete estimate?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete{" "}
                <span className="font-semibold text-foreground">
                  {deleteEstimateDialog?.title ?? "this estimate"}
                </span>
                . This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={Boolean(deletingEstimateId)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={Boolean(deletingEstimateId)}
                onClick={(event) => {
                  event.preventDefault();
                  void handleConfirmDeleteTeamEstimate();
                }}
              >
                {deletingEstimateId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete estimate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <footer className="mt-16 border-t border-border pt-6 pb-8">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-medium text-muted-foreground/70">Cornerstone</span>
              <span>&middot;</span>
              <span>Proposal Studio v{APP_VERSION}</span>
            </div>
            <div className="flex items-center gap-4">
              {hasTeamAdminAccess ? (
                <Link className="hover:text-foreground transition-colors" href="/admin">
                  PandaDoc mapping
                </Link>
              ) : null}
              {hasTeamAdminAccess ? (
                <Link className="hover:text-foreground transition-colors" href="/team-admin">
                  Team admin
                </Link>
              ) : null}
            </div>
          </div>
        </footer>
        </div>
      </div>
    </main>
  );
}
