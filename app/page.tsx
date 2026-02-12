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
import { UploadCard } from "@/components/upload-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type {
  LibraryItem,
  LibraryState,
  LibraryType,
  TemplateConfig,
  UploadedFile,
  UploadState,
} from "@/lib/types";
import { db, instantAppId } from "@/lib/instant";
import {
  appendEstimateVersion,
  createBaselineEstimateVersion,
  getCurrentEstimateVersion,
  getEstimateVersionActionLabel,
  normalizeEstimateVersionHistory,
  type EstimateVersionEntry,
} from "@/lib/estimate-versioning";
import { InstantAuthSync } from "@/components/instant-auth-sync";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import {
  isProductFeatureCategory,
  type ProductFeatureOption,
} from "@/lib/product-features";
import {
  ArrowDownToLine,
  CheckCircle2,
  CircleDashed,
  FileText,
  History,
  LayoutTemplate,
  Loader2,
} from "lucide-react";
import {
  SignInButton,
  SignOutButton,
  clerkEnabled,
  useOptionalAuth,
  useOptionalUser,
} from "@/lib/clerk";
import { id } from "@instantdb/react";

type EstimateSnapshot = {
  title: string;
  payload: Record<string, any> | null;
  totals: Record<string, any> | null;
  templateName?: string;
  templateUrl?: string;
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
  const { isLoading: instantLoading, user: instantUser, error: instantAuthError } =
    db.useAuth();
  const [uploads, setUploads] = useState<UploadState>({});
  const [error, setError] = useState<string | null>(null);
  const [templateConfig, setTemplateConfig] = useState<TemplateConfig | null>(null);
  const [selectedTemplateConfigKey, setSelectedTemplateConfigKey] = useState<
    string | null
  >(null);
  const [templateConfigError, setTemplateConfigError] = useState<string | null>(null);
  const [templateConfigLoading, setTemplateConfigLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [estimateMode, setEstimateMode] = useState<"workbook" | "estimate">(
    "estimate"
  );
  const [showWorkbookImport, setShowWorkbookImport] = useState(false);
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
  const [authError, setAuthError] = useState<string | null>(null);
  const [instantSetupError, setInstantSetupError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamSetupPending, setTeamSetupPending] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
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
  const [loadedEstimatePayload, setLoadedEstimatePayload] = useState<Record<
    string,
    any
  > | null>(null);
  const progressResetTimeoutRef = useRef<number | null>(null);
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
  const preferredOrgTeamName = (
    process.env.NEXT_PUBLIC_ORG_TEAM_NAME ?? "CORNERSTONE"
  ).trim();
  const normalizedOrgTeamName = preferredOrgTeamName.toLowerCase();
  const teamDomain = (allowedDomain || emailDomain || "").trim();
  const teamLookupDomain = teamDomain || "__none__";

  const teamQuery = instantAppId
    ? {
        teams: {
          $: {
            where: { domain: teamLookupDomain },
            order: { createdAt: "desc" as const },
          },
          memberships: { user: {} },
          estimates: { owner: {} },
          vendors: {},
          unitTypes: {},
          productFeatureOptions: {},
        },
      }
    : { teams: { $: { where: { domain: "__none__" } } } };

  const {
    data: teamData,
    error: teamQueryError,
    isLoading: teamLoading,
  } = db.useQuery(teamQuery);

  const teams = teamData?.teams ?? [];
  const orgTeam = useMemo(() => {
    if (!teams.length) return null;
    const rootTeams = teams.filter((team) => !team.parentTeamId);
    const candidates = rootTeams.length ? rootTeams : teams;
    const namedTeam = normalizedOrgTeamName
      ? candidates.find(
          (team) =>
            team.name?.trim().toLowerCase() === normalizedOrgTeamName
        )
      : null;
    if (namedTeam) return namedTeam;
    const primary = candidates.find((team) => team.isPrimary);
    if (primary) return primary;
    return candidates.reduce((oldest, team) => {
      if (!oldest) return team;
      const oldestTime = oldest.createdAt ?? 0;
      const teamTime = team.createdAt ?? 0;
      return teamTime < oldestTime ? team : oldest;
    }, null as (typeof teams)[number] | null);
  }, [teams]);
  const memberTeams = useMemo(() => {
    if (!instantUser?.id) return [];
    return teams.filter((team) =>
      team.memberships?.some((membership) => membership.user?.id === instantUser.id)
    );
  }, [teams, instantUser?.id]);
  const orgMembership = orgTeam?.memberships?.find(
    (membership) => membership.user?.id === instantUser?.id
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
    (membership) => membership.user?.id === instantUser?.id
  );
  const catalogTeam = orgTeam ?? activeTeam;
  const teamReady = Boolean(orgTeam && orgMembership);
  const isOrgOwner = Boolean(
    isPrimaryOwner ||
      (orgTeam?.ownerId && orgTeam.ownerId === instantUser?.id) ||
      orgRole === "owner"
  );
  const hasTeamAdminAccess = Boolean(isOrgOwner || orgRole === "admin");
  const appLocked = clerkEnabled && (!authLoaded || !isSignedIn);
  const autoProvisionRef = useRef(false);
  const orgSetupRef = useRef<string | null>(null);
  const teamEstimates = useMemo(() => {
    const list = activeTeam?.estimates ?? [];
    return [...list].sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    );
  }, [activeTeam?.estimates]);
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
  const findTeamEstimateById = useCallback(
    (estimateId: string) =>
      teamEstimates.find((estimate) => estimate.id === estimateId) ?? null,
    [teamEstimates]
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
  const canGenerate = Boolean(
    templateConfig?.templatePdf?.url &&
      (estimateMode === "workbook" ? uploads.workbook : hasEstimateValues)
  );
  const canDownloadPlanningLines = Boolean(
    uploads.workbook?.url ||
      estimatePayload ||
      Object.keys(estimateValues).length
  );
  const progressSteps = useMemo(
    () => [
      {
        label:
          estimateMode === "estimate"
            ? "Loading estimate values"
            : "Downloading workbook",
        value: 0.2,
      },
      { label: "Downloading template", value: 0.4 },
      {
        label:
          estimateMode === "estimate"
            ? "Formatting estimate data"
            : "Reading Excel data",
        value: 0.58,
      },
      { label: "Stamping PDF pages", value: 0.78 },
      { label: "Finalizing download", value: 0.9 },
    ],
    [estimateMode]
  );

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
    if (!historyEstimateId) return;
    if (teamEstimates.some((estimate) => estimate.id === historyEstimateId)) {
      return;
    }
    setHistoryEstimateId(null);
    setHistoryError(null);
  }, [historyEstimateId, teamEstimates]);

  useEffect(() => {
    if (!estimatePayload) {
      setEditingEstimateId(null);
    }
  }, [estimatePayload]);

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
    if (!instantUser?.id) return;
    if (!isPrimaryOwner) return;
    if (!orgMembership) return;
    const needsPrimary = !orgTeam.isPrimary;
    const needsRoot = Boolean(orgTeam.parentTeamId);
    const needsOwner = orgTeam.ownerId !== instantUser.id;
    const needsRole = orgMembership.role !== "owner";
    if (!needsPrimary && !needsRoot && !needsOwner && !needsRole) return;
    if (orgSetupRef.current === orgTeam.id) return;
    orgSetupRef.current = orgTeam.id;
    const updates = [
      db.tx.teams[orgTeam.id].update({
        ...(needsPrimary ? { isPrimary: true } : {}),
        ...(needsRoot ? { parentTeamId: null } : {}),
        ...(needsOwner ? { ownerId: instantUser.id } : {}),
      }),
      ...(needsRole
        ? [db.tx.memberships[orgMembership.id].update({ role: "owner" })]
        : []),
    ];
    void db.transact(updates).catch(() => {
      orgSetupRef.current = null;
    });
  }, [db, instantUser?.id, isPrimaryOwner, orgMembership, orgTeam]);

  useEffect(() => {
    if (!instantAppId) return;
    if (!authLoaded || !isSignedIn) return;
    if (!knownOrgLookupLoaded) return;
    if (!instantUser) return;
    if (instantLoading) return;
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

    if (!teams.length) {
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
    teams.length,
    instantAppId,
    instantLoading,
    instantUser,
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
        label: "Generating PDF",
        helper: "Building and stamping the proposal PDF.",
        tone: "loading" as const,
      };
    }

    if (canGenerate) {
      const inputLabel = estimateMode === "estimate" ? "Estimate" : "Workbook";
      return {
        label: "Ready to generate",
        helper: `${inputLabel} and template are selected.`,
        tone: "ready" as const,
      };
    }

    return {
      label: estimateMode === "estimate" ? "Awaiting estimate" : "Awaiting uploads",
      helper:
        estimateMode === "estimate"
          ? "Enter estimate details and select a template."
          : "Upload a workbook and select a template.",
      tone: "idle" as const,
    };
  }, [isGenerating, canGenerate, estimateMode]);

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
      label:
        estimateMode === "estimate"
          ? "Manual estimate is complete"
          : "Workbook is selected",
      done:
        estimateMode === "estimate" ? hasEstimateValues : Boolean(uploads.workbook),
    },
    {
      id: "template",
      label: "Template is selected",
      done: Boolean(templateConfig?.templatePdf?.url),
    },
    {
      id: "generate",
      label: "Proposal is ready to generate",
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
      templateUrl: templateConfig?.templatePdf?.url,
    };
  }, [
    estimateName,
    estimatePayload,
    estimateValues,
    templateConfig?.name,
    templateConfig?.templatePdf?.url,
  ]);

  const persistGeneratedEstimateVersion = useCallback(async () => {
    if (!instantAppId || !instantUser || !activeTeam || !activeMembership) return;
    const snapshot = buildCurrentEstimateSnapshot();
    if (!snapshot.payload) return;

    const now = Date.now();
    if (editingEstimateId) {
      const existingEstimate = findTeamEstimateById(editingEstimateId);
      const shouldCreateNewVersion = hasEstimateSnapshotChanges(
        existingEstimate,
        snapshot
      );
      if (!shouldCreateNewVersion) {
        await db.transact(
          db.tx.estimates[editingEstimateId]
            .update({
              status: "generated",
              updatedAt: now,
              lastGeneratedAt: now,
              templateName: snapshot.templateName,
              templateUrl: snapshot.templateUrl,
            })
            .link({ team: activeTeam.id, owner: instantUser.id })
        );
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
        createdByUserId: instantUser.id,
      });
      await db.transact(
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
          })
          .link({ team: activeTeam.id, owner: instantUser.id })
      );
      return;
    }

    const estimateId = id();
    const versioned = appendEstimateVersion([], {
      action: "generated",
      createdAt: now,
      title: snapshot.title,
      payload: snapshot.payload,
      totals: snapshot.totals,
      templateName: snapshot.templateName,
      templateUrl: snapshot.templateUrl,
      createdByUserId: instantUser.id,
    });
    await db.transact(
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
        })
        .link({ team: activeTeam.id, owner: instantUser.id })
    );
    setEditingEstimateId(estimateId);
  }, [
    activeMembership,
    activeTeam,
    buildCurrentEstimateSnapshot,
    editingEstimateId,
    findTeamEstimateById,
    getPersistedEstimateHistory,
    instantAppId,
    instantUser,
  ]);

  const buildPlanningLinesRequestBody = (format: string) => {
    if (uploads.workbook?.url) {
      return {
        workbookUrl: uploads.workbook.url,
        format,
      };
    }

    const estimateSource =
      estimatePayload ??
      (Object.keys(estimateValues).length
        ? {
            name: estimateName.trim(),
            values: estimateValues,
          }
        : null);

    if (!estimateSource) {
      throw new Error("Upload a workbook or complete a manual estimate first.");
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
    if (!templateConfig?.templatePdf?.url) {
      setError("Select a template from the library.");
      return;
    }
    if (estimateMode === "workbook" && !uploads.workbook) {
      setError("Upload the workbook to continue.");
      return;
    }
    if (estimateMode === "estimate" && !hasEstimateValues) {
      setError("Enter at least one estimate value or load a saved estimate.");
      return;
    }

    const mappingOverride = templateConfig?.mapping;
    const coordsOverride = templateConfig?.coords;
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
          workbookUrl:
            estimateMode === "workbook" ? uploads.workbook?.url : undefined,
          templatePdfUrl: templateConfig.templatePdf.url,
          mappingOverride,
          coordsOverride,
          estimate:
            estimateMode === "estimate"
              ? {
                  ...(estimatePayload ?? {}),
                  name: estimateName.trim(),
                  values:
                    estimatePayload?.values ??
                    (Object.keys(estimateValues).length ? estimateValues : undefined),
                }
              : undefined,
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        let message = "Failed to generate PDF.";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          message = data?.error || message;
        } else {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Cornerstone Proposal - Filled.pdf";
      link.click();
      window.URL.revokeObjectURL(url);
      setProgress(1);
      setProgressLabel("Download ready");
      generationSucceeded = true;

      if (estimateMode === "estimate") {
        try {
          await persistGeneratedEstimateVersion();
        } catch (historyErr) {
          const message =
            historyErr instanceof Error
              ? historyErr.message
              : "Unable to save generated version.";
          setError(`PDF downloaded, but version history update failed: ${message}`);
        }
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
    if (!instantAppId) {
      setError("InstantDB is not configured yet.");
      return;
    }
    if (!instantUser) {
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
    const templateName = templateConfig?.name;
    const templateUrl = templateConfig?.templatePdf?.url;

    try {
      if (editingEstimateId) {
        const existingEstimate = findTeamEstimateById(editingEstimateId);
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
          createdByUserId: instantUser.id,
        });
        await db.transact(
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
            })
            .link({ team: activeTeam.id, owner: instantUser.id })
        );
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
        createdByUserId: instantUser.id,
      });
      await db.transact(
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
          })
          .link({ team: activeTeam.id, owner: instantUser.id })
      );
      setEditingEstimateId(estimateId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  };

  const handleCreateTeam = async () => {
    setTeamError(null);
    if (!instantAppId) {
      setTeamError("InstantDB is not configured yet.");
      return;
    }
    if (!instantUser) {
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
          ownerId: instantUser.id,
        }),
        db.tx.memberships[membershipId]
          .create({ role, createdAt: now })
          .link({ team: teamId, user: instantUser.id }),
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
    if (!instantAppId) {
      setTeamError("InstantDB is not configured yet.");
      return;
    }
    if (!instantUser || !orgTeam) return;
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
          .link({ team: orgTeam.id, user: instantUser.id })
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
    if (!instantAppId || !teamDomain) return [];
    try {
      const snapshot = (await db.queryOnce({
        teams: {
          $: {
            where: { domain: teamLookupDomain },
            order: { createdAt: "desc" as const },
          },
        },
      })) as { teams?: Array<{ id: string }> } | undefined;
      return Array.isArray(snapshot?.teams) ? snapshot.teams : [];
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to verify existing workspace.";
      setTeamError(message);
      return null;
    }
  }, [instantAppId, teamDomain, teamLookupDomain]);

  const handleRetryTeamSetup = () => {
    if (!orgTeam && !teams.length) {
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
    setEstimateMode("estimate");
    setError(null);
    setHistoryError(null);
    setEstimateName(estimate?.title ?? "");
    setLoadedEstimatePayload(estimate?.payload ?? null);
    setEditingEstimateId(estimate?.id ?? null);
    setHistoryEstimateId(estimate?.id ?? null);
  };

  const handleRevertTeamEstimateVersion = async (
    estimate: any,
    revision: EstimateVersionEntry
  ) => {
    setHistoryError(null);
    setError(null);
    if (!instantAppId) {
      setHistoryError("InstantDB is not configured yet.");
      return;
    }
    if (!instantUser) {
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
        createdByUserId: instantUser.id,
        sourceVersion: revision.version,
      });

      await db.transact(
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
          })
          .link({ team: activeTeam.id, owner: instantUser.id })
      );

      setEstimateMode("estimate");
      setEstimateName(revision.title);
      setLoadedEstimatePayload(revision.payload);
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

  const handleLibrarySelect = (type: LibraryType, item: { name: string; url: string }) => {
    if (!item.url) {
      setError("Selected item has no URL. Try refreshing the library.");
      return;
    }
    setError(null);
    setUploads((prev) => ({
      ...prev,
      [type]: { name: item.name, url: item.url },
    }));
    if (type === "template") {
      setTemplateConfig(null);
      setSelectedTemplateConfigKey(null);
    }
  };

  const handleLibraryDeleteAll = async (type: LibraryType) => {
    setLibrary((prev) => ({
      ...prev,
      [type]: { ...prev[type], loading: true, error: null },
    }));

    try {
      const response = await fetch(`/api/library?type=${type}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to delete files.";
        throw new Error(message);
      }
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], items: [] },
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

  useEffect(() => {
    void loadLibrary("workbook");
    void loadLibrary("template_config");
  }, []);

  const handleSelectTemplateConfig = async (item: LibraryItem) => {
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
      if (!data?.templatePdf?.url) {
        throw new Error("Template configuration is missing a PDF.");
      }
      setTemplateConfig(data);
      setSelectedTemplateConfigKey(item.key);
      setUploads((prev) => ({
        ...prev,
        template: { name: data.templatePdf.name, url: data.templatePdf.url },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTemplateConfigError(message);
    } finally {
      setTemplateConfigLoading(false);
    }
  };

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
            <CardTitle className="text-2xl font-serif">Template Library</CardTitle>
            <CardDescription>
              Apply a saved PDF template with its calibrated coordinates.
            </CardDescription>
          </div>
          <Badge variant="outline" className="bg-background/80">
            Required
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
            Loading template library...
          </div>
        ) : library.template_config.items.length ? (
          <ScrollArea className="h-56 rounded-lg border border-border/70 bg-background/70">
            <div className="divide-y divide-border/60">
              {library.template_config.items.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.uploadedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant={
                      selectedTemplateConfigKey === item.key ? "accent" : "outline"
                    }
                    size="sm"
                    onClick={() => handleSelectTemplateConfig(item)}
                  >
                    {selectedTemplateConfigKey === item.key
                      ? "Selected"
                      : "Use template"}
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-sm text-muted-foreground">
            No templates yet. Create one in the admin portal.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>
            Selected template:{" "}
            <span className="text-foreground">
              {templateConfig?.name ?? "None"}
            </span>
          </span>
          {templateConfig ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTemplateConfig(null);
                  setSelectedTemplateConfigKey(null);
                }}
              >
                Clear selection
              </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadLibrary("template_config")}
          >
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <main className="relative min-h-screen overflow-hidden">
      <InstantAuthSync
        onDomainError={setAuthError}
        onAuthError={setInstantSetupError}
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
        {instantSetupError ? (
          <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            Instant auth issue: {instantSetupError}
          </div>
        ) : null}
        {!instantAppId ? (
          <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            InstantDB is not configured. Add `NEXT_PUBLIC_INSTANTDB_APP_ID` to
            enable team estimates.
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
                    Build an estimate, select a template, and download the proposal PDF.
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
                  Access to proposals and team estimates is restricted to your
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
          <section className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <Card className="rounded-3xl border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <div className="space-y-2">
                  <Badge variant="muted" className="bg-muted/80 text-[10px]">
                    Workspace
                  </Badge>
                  <CardTitle className="text-2xl font-serif">Team Workspace</CardTitle>
                  <CardDescription>
                    InstantDB keeps shared estimates synced for your domain.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {instantAuthError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {instantAuthError.message}
                  </div>
                ) : null}
                {instantSetupError ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                    {instantSetupError}
                  </div>
                ) : null}
                {teamError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {teamError}
                  </div>
                ) : null}
                {instantLoading ? (
                  <div className="text-sm text-muted-foreground">
                    Connecting to InstantDB...
                  </div>
                ) : null}
                {!instantLoading && !instantUser && !instantSetupError ? (
                  <div className="text-sm text-muted-foreground">
                    Waiting for Instant auth. If this persists, verify the Clerk
                    client name and session token email claim.
                  </div>
                ) : null}

                {teamReady ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">
                        Organization workspace
                      </p>
                      <p className="text-lg font-semibold text-foreground">
                        {orgTeam?.name}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Domain: {orgTeam?.domain}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="bg-background/80">
                        {orgRole === "owner"
                          ? "Owner"
                          : orgRole === "admin"
                            ? "Admin"
                            : "Member"}
                      </Badge>
                      {hasTeamAdminAccess ? (
                        <Button asChild variant="outline" size="sm">
                          <Link href="/team-admin">Org owner dashboard</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {orgTeam
                        ? "Joining organization workspace..."
                        : "Creating organization workspace..."}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Domain: {teamDomain || "Unknown"}
                    </div>
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
                )}
              </CardContent>
            </Card>
            <Card className="rounded-3xl border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <div className="space-y-2">
                  <Badge variant="muted" className="bg-muted/80 text-[10px]">
                    Shared
                  </Badge>
                  <CardTitle className="text-2xl font-serif">
                    Team Estimates
                  </CardTitle>
                  <CardDescription>
                    Shared estimates for {activeTeam?.name ?? "your team"}.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {memberTeams.length > 1 ? (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Active team
                    </label>
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
                  </div>
                ) : null}
                {!teamReady ? (
                  <div className="text-sm text-muted-foreground">
                    Preparing your team workspace...
                  </div>
                ) : teamEstimates.length ? (
                  <ScrollArea className="h-56 rounded-lg border border-border/70 bg-background/70">
                    <div className="divide-y divide-border/60">
                      {teamEstimates.map((estimate) => {
                        const currentVersion = getCurrentVersionForEstimate(estimate);
                        const historyOpen = historyEstimateId === estimate.id;
                        return (
                          <div
                            key={estimate.id}
                            className="flex items-center justify-between gap-4 px-4 py-3"
                          >
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-foreground">
                                {estimate.title ?? "Untitled"}
                              </p>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline" className="bg-background/80">
                                  v{currentVersion}
                                </Badge>
                                <span>
                                  {estimate.updatedAt
                                    ? new Date(estimate.updatedAt).toLocaleString()
                                    : "No timestamp"}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleLoadTeamEstimate(estimate)}
                              >
                                Load
                              </Button>
                              <Button
                                variant="ghost"
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
                        );
                      })}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No shared estimates yet.
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
                    Editing a shared estimate. Use “Save to team” to update it.
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
            <div className="rounded-2xl border border-border/60 bg-card/80 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <Badge variant="muted" className="bg-muted/80 text-[10px]">
                    Step 1
                  </Badge>
                  <h2 className="text-2xl font-serif text-foreground">
                    Choose Input Source
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Manual estimate is the primary workflow. Workbook import is
                    available in advanced tools.
                  </p>
                </div>
                <Badge variant="outline" className="bg-background/80">
                  {estimateMode === "estimate"
                    ? "Manual estimate active"
                    : "Workbook import active"}
                </Badge>
              </div>
            </div>
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
              onActivate={() => {
                setEstimateMode("estimate");
                setError(null);
              }}
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => void handleSaveEstimateToDb()}
                disabled={!isSignedIn || !teamReady}
              >
                {editingEstimateId ? "Update team estimate" : "Save to team"}
              </Button>
              {editingEstimateId ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLoadedEstimatePayload(null);
                    setEditingEstimateId(null);
                    setHistoryEstimateId(null);
                    setHistoryError(null);
                    setEstimateName("");
                    setEstimateValues({});
                    setEstimatePayload(null);
                  }}
                >
                  New estimate
                </Button>
              ) : null}
              {!clerkEnabled ? (
                <span className="text-xs text-muted-foreground">
                  Configure Clerk + InstantDB to enable team saving.
                </span>
              ) : !activeMembership ? (
                <span className="text-xs text-muted-foreground">
                  Select a team to save estimates.
                </span>
              ) : null}
            </div>
            <Card className="rounded-3xl border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <Badge variant="muted" className="bg-muted/80 text-[10px]">
                      Advanced
                    </Badge>
                    <CardTitle className="text-xl font-serif">
                      Workbook Import
                    </CardTitle>
                    <CardDescription>
                      Optional fallback for legacy workbook-driven jobs.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowWorkbookImport((prev) => !prev)}
                    >
                      {showWorkbookImport
                        ? "Hide workbook tools"
                        : "Show workbook tools"}
                    </Button>
                    {estimateMode === "workbook" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEstimateMode("estimate")}
                      >
                        Use manual estimate
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {showWorkbookImport ? (
                  <UploadCard
                    title="Excel Workbook"
                    description="Job info + bid sheet values (.xlsx)."
                    endpoint="workbook"
                    tag="Optional"
                    selected={uploads.workbook}
                    allowedContent=".xlsx only"
                    uploadLabel="Drop the workbook here or browse"
                    library={library.workbook}
                    onUpload={(file) => {
                      setError(null);
                      setUploads((prev) => ({ ...prev, workbook: file }));
                      setEstimateMode("workbook");
                      setShowWorkbookImport(true);
                      void loadLibrary("workbook");
                    }}
                    onError={setError}
                    onSelectLibrary={(item) => {
                      handleLibrarySelect("workbook", item);
                      setEstimateMode("workbook");
                      setShowWorkbookImport(true);
                    }}
                    onRefreshLibrary={() => loadLibrary("workbook")}
                    onDeleteLibrary={() => handleLibraryDeleteAll("workbook")}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Workbook upload is hidden by default to keep the primary
                    workflow focused on manual estimates.
                  </p>
                )}
                {uploads.workbook ? (
                  <p className="text-xs text-muted-foreground">
                    Current workbook:{" "}
                    <span className="text-foreground">{uploads.workbook.name}</span>
                  </p>
                ) : null}
              </CardContent>
            </Card>
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
                    Generate Proposal
                  </CardTitle>
                  <CardDescription>
                    Combine selected inputs into a branded PDF download.
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
                    {estimateMode === "estimate" ? "Manual estimate" : "Workbook"}
                  </span>
                </div>
                {estimateMode === "estimate" ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Estimate</span>
                    <span className="text-right font-medium text-foreground">
                      {estimateName.trim() ||
                        selectedEstimate?.name ||
                        (hasEstimateInput ? "Manual entry" : "Not started")}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Workbook</span>
                    <span className="text-right font-medium text-foreground">
                      {uploads.workbook?.name ?? "Not selected"}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Template</span>
                  <span className="text-right font-medium text-foreground">
                    {templateConfig?.name ?? "Not selected"}
                  </span>
                </div>
              </div>
              <Separator />
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
                  {isGenerating ? "Generating..." : "Generate Proposal PDF"}
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
              <p className="text-xs text-muted-foreground">
                Generated PDFs are produced on demand and downloaded immediately.
              </p>
            </CardContent>
          </Card>
        </section>

          </>
        )}

        <Separator className="my-12" />

        <footer className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>
            UploadThing handles file storage. Files can be re-used from the
            library tabs in each section.
          </span>
          <div className="flex items-center gap-4">
            {hasTeamAdminAccess ? (
              <Link
                className="hover:text-foreground"
                href="/admin"
              >
                Calibration dashboard
              </Link>
            ) : null}
            <span>Cornerstone Proposal Generator · v{APP_VERSION}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
