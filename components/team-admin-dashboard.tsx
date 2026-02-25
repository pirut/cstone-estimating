"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConvexAuthSync } from "@/components/convex-auth-sync";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DEFAULT_PROJECT_TYPES,
  DEFAULT_UNIT_TYPES,
  DEFAULT_VENDORS,
} from "@/lib/catalog-defaults";
import {
  DEFAULT_MARGIN_THRESHOLDS,
  normalizeMarginThresholds,
} from "@/lib/estimate-calculator";
import {
  PRODUCT_FEATURE_CATEGORIES,
  PRODUCT_FEATURE_CATEGORY_LABELS,
  isProductFeatureCategory,
} from "@/lib/product-features";
import {
  getOrganizationScopedTeams,
  pickOrganizationTeam,
} from "@/lib/org-teams";
import { db, convexAppUrl } from "@/lib/convex";
import {
  SignInButton,
  clerkEnabled,
  useOptionalAuth,
  useOptionalUser,
} from "@/lib/clerk";
import { id } from "@/lib/convex";
import { GripVertical, Loader2, Plus, Save, Trash2 } from "lucide-react";
import {
  CATALOG_SCOPE_ALL_TEAMS,
  FEATURE_SCOPE_ALL_PRODUCTS,
  formatDateTime,
  formatThresholdPercentInput,
  getInsertionIndexFromDrag,
  hasSameSerializedValue,
  parseThresholdPercentInput,
  reorderDraftListByInsertion,
  toEstimateAdminDrafts,
  toProductFeatureOptionDrafts,
  toProjectTypeDrafts,
  toUnitTypeDrafts,
  toVendorDrafts,
  type EstimateAdminDraft,
  type ProductFeatureOptionDraft,
  type ProjectTypeDraft,
  type UnitTypeDraft,
  type VendorDraft,
} from "@/components/team-admin-dashboard.helpers";
import type { TeamRecord } from "@/lib/team-records";

type TeamAdminDashboardProps = {
  embedded?: boolean;
  includeAuthSync?: boolean;
  showHeader?: boolean;
  showFooter?: boolean;
  includeEstimateSection?: boolean;
  showWorkspaceSections?: boolean;
  showCatalogSection?: boolean;
  sectionId?: string;
};

export default function TeamAdminPage({
  embedded = false,
  includeAuthSync = true,
  showHeader = true,
  showFooter = true,
  includeEstimateSection = true,
  showWorkspaceSections = true,
  showCatalogSection = true,
  sectionId,
}: TeamAdminDashboardProps) {
  const { isLoaded: authLoaded, isSignedIn } = useOptionalAuth();
  const { user } = useOptionalUser();
  const { isLoading: convexLoading, user: convexUser, error: convexAuthError } =
    db.useAuth();
  const tx = db.tx as any;
  const [convexSetupError, setConvexSetupError] = useState<string | null>(null);
  const [subTeamName, setSubTeamName] = useState("");
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [memberActionLoading, setMemberActionLoading] = useState(false);

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
  const clerkName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    emailAddress;
  const clerkImageUrl =
    user?.imageUrl ||
    (user && "profileImageUrl" in user && typeof user.profileImageUrl === "string"
      ? user.profileImageUrl
      : "");
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

  const teamQuery = convexAppUrl
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
          projectTypes: {},
          productFeatureOptions: {},
        },
      }
    : {
        teams: {
          $: { where: { domain: "__none__" } },
          memberships: { user: {} },
          estimates: { owner: {} },
          vendors: {},
          unitTypes: {},
          projectTypes: {},
          productFeatureOptions: {},
        },
      };

  const { data: teamData } = db.useQuery(teamQuery);
  const teams = (teamData?.teams ?? []) as TeamRecord[];
  const orgTeam = useMemo(
    () => pickOrganizationTeam(teams, normalizedOrgTeamName),
    [teams, normalizedOrgTeamName]
  );
  const orgScopedTeams = useMemo(
    () => getOrganizationScopedTeams(teams, orgTeam?.id),
    [orgTeam?.id, teams]
  );
  const subTeamCount = useMemo(() => {
    if (!orgTeam?.id) return orgScopedTeams.length;
    return orgScopedTeams.filter((team) => team.id !== orgTeam.id).length;
  }, [orgScopedTeams, orgTeam?.id]);

  const orgMembership = orgTeam?.memberships?.find(
    (membership) => membership.user?.id === convexUser?.id
  );
  const orgRole = String(orgMembership?.role ?? "")
    .trim()
    .toLowerCase();
  const isOrgOwner = Boolean(
    isPrimaryOwner ||
      (orgTeam?.ownerId && orgTeam.ownerId === convexUser?.id) ||
      orgRole === "owner"
  );
  const hasTeamAdminAccess = Boolean(isOrgOwner || orgRole === "admin");

  const selectedTeam = useMemo(
    () => orgScopedTeams.find((team) => team.id === selectedTeamId) ?? null,
    [orgScopedTeams, selectedTeamId]
  );
  const catalogScopeOptions = useMemo(() => {
    const list = teams.slice();
    return list.sort((a, b) => {
      if (orgTeam?.id && a.id === orgTeam.id) return -1;
      if (orgTeam?.id && b.id === orgTeam.id) return 1;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""));
    });
  }, [orgTeam?.id, teams]);
  const [catalogScopeTeamId, setCatalogScopeTeamId] = useState<string>(
    CATALOG_SCOPE_ALL_TEAMS
  );
  useEffect(() => {
    if (!catalogScopeOptions.length) {
      setCatalogScopeTeamId(CATALOG_SCOPE_ALL_TEAMS);
      return;
    }
    if (catalogScopeTeamId === CATALOG_SCOPE_ALL_TEAMS) return;
    if (catalogScopeOptions.some((team) => team.id === catalogScopeTeamId)) return;
    setCatalogScopeTeamId(CATALOG_SCOPE_ALL_TEAMS);
  }, [catalogScopeOptions, catalogScopeTeamId]);
  const catalogTeam = useMemo(() => {
    if (catalogScopeTeamId === CATALOG_SCOPE_ALL_TEAMS) return null;
    return (
      catalogScopeOptions.find((team) => team.id === catalogScopeTeamId) ?? null
    );
  }, [catalogScopeOptions, catalogScopeTeamId]);
  const catalogDisplayTeams = useMemo(() => {
    if (!catalogScopeOptions.length) return [];
    return catalogTeam ? [catalogTeam] : catalogScopeOptions;
  }, [catalogScopeOptions, catalogTeam]);
  const catalogScopeLabel = catalogTeam
    ? `Team: ${catalogTeam.name}`
    : "All teams (view only)";

  const vendorRecords = useMemo(() => {
    const list = catalogDisplayTeams.flatMap((team) =>
      (team.vendors ?? []).map((vendor) => ({ ...vendor, __teamName: team.name ?? "" }))
    );
    return list.sort((a, b) => {
      const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 0;
      const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 0;
      if (orderA !== orderB) return orderA - orderB;
      const byName = String(a.name ?? "").localeCompare(String(b.name ?? ""));
      if (byName !== 0) return byName;
      return String(a.__teamName ?? "").localeCompare(String(b.__teamName ?? ""));
    });
  }, [catalogDisplayTeams]);

  const unitTypeRecords = useMemo(() => {
    const list = catalogDisplayTeams.flatMap((team) =>
      (team.unitTypes ?? []).map((unit) => ({ ...unit, __teamName: team.name ?? "" }))
    );
    return list.sort((a, b) => {
      const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 0;
      const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 0;
      if (orderA !== orderB) return orderA - orderB;
      const byCode = String(a.code ?? "").localeCompare(String(b.code ?? ""));
      if (byCode !== 0) return byCode;
      return String(a.__teamName ?? "").localeCompare(String(b.__teamName ?? ""));
    });
  }, [catalogDisplayTeams]);
  const unitTypeVendorColumns = useMemo(() => {
    const source = catalogTeam?.vendors ?? [];
    return source
      .filter(
        (vendor) => vendor.isActive !== false && typeof vendor.id === "string" && vendor.id
      )
      .slice()
      .sort((a, b) => {
        const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 0;
        const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 0;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      })
      .map((vendor) => ({
        id: String(vendor.id),
        name: String(vendor.name ?? ""),
      }));
  }, [catalogTeam?.vendors]);
  const unitTypeGridTemplate = useMemo(
    () =>
      [
        "auto",
        "minmax(96px,1fr)",
        "minmax(150px,1.6fr)",
        "minmax(110px,1fr)",
        ...unitTypeVendorColumns.map(() => "minmax(130px,1fr)"),
        "minmax(70px,0.6fr)",
        "auto",
      ].join(" "),
    [unitTypeVendorColumns]
  );
  const unitTypeTableMinWidth = 760 + unitTypeVendorColumns.length * 130;
  const projectTypeRecords = useMemo(() => {
    const list = catalogDisplayTeams.flatMap((team) =>
      (team.projectTypes ?? []).map((projectType) => ({
        ...projectType,
        __teamName: team.name ?? "",
      }))
    );
    return list.sort((a, b) => {
      const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 0;
      const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 0;
      if (orderA !== orderB) return orderA - orderB;
      const byLabel = String(a.label ?? "").localeCompare(String(b.label ?? ""));
      if (byLabel !== 0) return byLabel;
      return String(a.__teamName ?? "").localeCompare(String(b.__teamName ?? ""));
    });
  }, [catalogDisplayTeams]);

  const productFeatureOptionRecords = useMemo(() => {
    const list = catalogDisplayTeams.flatMap((team) =>
      (team.productFeatureOptions ?? []).map((option) => ({
        ...option,
        __teamName: team.name ?? "",
      }))
    );
    return list.sort((a, b) => {
      const categoryA = String(a.category ?? "");
      const categoryB = String(b.category ?? "");
      if (categoryA !== categoryB) return categoryA.localeCompare(categoryB);
      const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 0;
      const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 0;
      if (orderA !== orderB) return orderA - orderB;
      const byLabel = String(a.label ?? "").localeCompare(String(b.label ?? ""));
      if (byLabel !== 0) return byLabel;
      return String(a.__teamName ?? "").localeCompare(String(b.__teamName ?? ""));
    });
  }, [catalogDisplayTeams]);

  const orgMembers = orgTeam?.memberships ?? [];
  const selectedTeamMembers = selectedTeam?.memberships ?? [];
  const availableOrgMembers = orgMembers.filter((member) => {
    const memberId = member.user?.id;
    if (!memberId) return false;
    return !selectedTeamMembers.some(
      (teamMember) => teamMember.user?.id === memberId
    );
  });

  const getMemberProfile = (member?: (typeof orgMembers)[number]) => {
    const memberId = member?.user?.id ?? "";
    const isCurrent =
      (memberId && memberId === convexUser?.id) ||
      (emailAddress && member?.user?.email === emailAddress);
    const name = isCurrent
      ? clerkName
      : member?.user?.name || member?.user?.email || member?.user?.id || "User";
    const email = isCurrent ? emailAddress : member?.user?.email;
    const imageUrl = isCurrent ? clerkImageUrl : member?.user?.imageUrl;
    return { name, email, imageUrl, memberId };
  };

  const getInitials = (label: string) =>
    label
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";

  useEffect(() => {
    if (!orgScopedTeams.length) {
      setSelectedTeamId(null);
      return;
    }
    if (
      !selectedTeamId ||
      !orgScopedTeams.some((team) => team.id === selectedTeamId)
    ) {
      setSelectedTeamId(orgTeam?.id ?? orgScopedTeams[0]?.id ?? null);
    }
  }, [orgScopedTeams, orgTeam?.id, selectedTeamId]);

  useEffect(() => {
    setSelectedMemberId(null);
  }, [selectedTeamId]);

  const [teamNameDraft, setTeamNameDraft] = useState("");
  const [teamNameError, setTeamNameError] = useState<string | null>(null);
  const [teamNameSaving, setTeamNameSaving] = useState(false);
  const [teamMarginDraft, setTeamMarginDraft] = useState({
    product: "",
    install: "",
    project: "",
  });
  const [teamMarginError, setTeamMarginError] = useState<string | null>(null);
  const [teamMarginStatus, setTeamMarginStatus] = useState<string | null>(null);
  const [teamMarginSaving, setTeamMarginSaving] = useState(false);
  const [teamDeleteError, setTeamDeleteError] = useState<string | null>(null);
  const [teamDeleteLoading, setTeamDeleteLoading] = useState(false);
  const [vendorDrafts, setVendorDrafts] = useState<VendorDraft[]>([]);
  const [vendorSaving, setVendorSaving] = useState(false);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [vendorStatus, setVendorStatus] = useState<string | null>(null);
  const [unitTypeDrafts, setUnitTypeDrafts] = useState<UnitTypeDraft[]>([]);
  const [unitTypeSaving, setUnitTypeSaving] = useState(false);
  const [unitTypeError, setUnitTypeError] = useState<string | null>(null);
  const [unitTypeStatus, setUnitTypeStatus] = useState<string | null>(null);
  const [projectTypeDrafts, setProjectTypeDrafts] = useState<ProjectTypeDraft[]>(
    []
  );
  const [projectTypeSaving, setProjectTypeSaving] = useState(false);
  const [projectTypeError, setProjectTypeError] = useState<string | null>(null);
  const [projectTypeStatus, setProjectTypeStatus] = useState<string | null>(null);
  const [productFeatureOptionDrafts, setProductFeatureOptionDrafts] = useState<
    ProductFeatureOptionDraft[]
  >([]);
  const [productFeatureOptionSaving, setProductFeatureOptionSaving] =
    useState(false);
  const [productFeatureOptionError, setProductFeatureOptionError] = useState<
    string | null
  >(null);
  const [productFeatureOptionStatus, setProductFeatureOptionStatus] = useState<
    string | null
  >(null);
  const [featureEditorVendorId, setFeatureEditorVendorId] = useState<string>(
    FEATURE_SCOPE_ALL_PRODUCTS
  );
  const [estimateDrafts, setEstimateDrafts] = useState<EstimateAdminDraft[]>([]);
  const [estimateSavingId, setEstimateSavingId] = useState<string | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [estimateStatus, setEstimateStatus] = useState<string | null>(null);
  const [dragVendorIndex, setDragVendorIndex] = useState<number | null>(null);
  const [vendorDropIndex, setVendorDropIndex] = useState<number | null>(null);
  const [dragUnitTypeIndex, setDragUnitTypeIndex] = useState<number | null>(null);
  const [unitTypeDropIndex, setUnitTypeDropIndex] = useState<number | null>(null);
  const [dragProjectTypeIndex, setDragProjectTypeIndex] = useState<number | null>(
    null
  );
  const [projectTypeDropIndex, setProjectTypeDropIndex] = useState<number | null>(
    null
  );
  const [dragFeatureState, setDragFeatureState] = useState<{
    groupId: string;
    entryIndex: number;
  } | null>(null);
  const [featureDropState, setFeatureDropState] = useState<{
    groupId: string;
    insertionIndex: number;
  } | null>(null);

  useEffect(() => {
    setTeamNameDraft(selectedTeam?.name ?? "");
    setTeamNameError(null);
  }, [selectedTeam?.id, selectedTeam?.name]);

  useEffect(() => {
    const normalized = normalizeMarginThresholds(selectedTeam?.marginThresholds);
    const nextDraft = {
      product: formatThresholdPercentInput(normalized.product_margin_min),
      install: formatThresholdPercentInput(normalized.install_margin_min),
      project: formatThresholdPercentInput(normalized.project_margin_min),
    };
    setTeamMarginDraft((previous) =>
      hasSameSerializedValue(previous, nextDraft) ? previous : nextDraft
    );
    setTeamMarginError(null);
    setTeamMarginStatus(null);
  }, [selectedTeam?.id, selectedTeam?.marginThresholds]);

  useEffect(() => {
    const next = toVendorDrafts(vendorRecords);
    setVendorDrafts((previous) =>
      hasSameSerializedValue(previous, next) ? previous : next
    );
  }, [vendorRecords]);

  useEffect(() => {
    const next = toUnitTypeDrafts(unitTypeRecords);
    setUnitTypeDrafts((previous) =>
      hasSameSerializedValue(previous, next) ? previous : next
    );
  }, [unitTypeRecords]);

  useEffect(() => {
    const next = toProjectTypeDrafts(projectTypeRecords);
    setProjectTypeDrafts((previous) =>
      hasSameSerializedValue(previous, next) ? previous : next
    );
  }, [projectTypeRecords]);

  useEffect(() => {
    const next = toProductFeatureOptionDrafts(productFeatureOptionRecords);
    setProductFeatureOptionDrafts((previous) =>
      hasSameSerializedValue(previous, next) ? previous : next
    );
  }, [productFeatureOptionRecords]);

  useEffect(() => {
    if (featureEditorVendorId === FEATURE_SCOPE_ALL_PRODUCTS) return;
    const hasSelectedVendor = vendorRecords.some(
      (vendor) => vendor.id === featureEditorVendorId
    );
    if (!hasSelectedVendor) {
      setFeatureEditorVendorId(FEATURE_SCOPE_ALL_PRODUCTS);
    }
  }, [featureEditorVendorId, vendorRecords]);

  const estimateRecords = useMemo(() => {
    const list = (selectedTeam?.estimates ?? []).slice();
    return list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [selectedTeam?.estimates]);

  const estimateSourceById = useMemo(
    () =>
      new Map(
        estimateRecords
          .filter((estimate) => Boolean(estimate.id))
          .map((estimate) => [String(estimate.id), estimate])
      ),
    [estimateRecords]
  );

  useEffect(() => {
    const next = toEstimateAdminDrafts(estimateRecords);
    setEstimateDrafts((previous) =>
      hasSameSerializedValue(previous, next) ? previous : next
    );
    setEstimateError(null);
    setEstimateStatus(null);
    setEstimateSavingId(null);
  }, [estimateRecords, selectedTeam?.id]);

  const handleCreateSubTeam = async () => {
    setTeamError(null);
    if (!convexAppUrl) {
      setTeamError("Convex is not configured yet.");
      return;
    }
    if (!convexUser || !orgTeam) {
      setTeamError("Sign in with an organization admin account.");
      return;
    }
    if (!hasTeamAdminAccess) {
      setTeamError("Only organization owners and admins can create sub teams.");
      return;
    }
    if (!subTeamName.trim()) {
      setTeamError("Provide a team name.");
      return;
    }

    const now = Date.now();
    const teamId = id();
    const membershipId = id();
    setTeamSaving(true);
    try {
      await db.transact([
        tx.teams[teamId].create({
          name: subTeamName.trim(),
          domain: teamDomain,
          createdAt: now,
          isPrimary: false,
          parentTeamId: orgTeam.id,
          ownerId: convexUser.id,
          marginThresholds: DEFAULT_MARGIN_THRESHOLDS,
        }),
        tx.memberships[membershipId]
          .create({ role: "owner", createdAt: now })
          .link({ team: teamId, user: convexUser.id }),
      ]);
      setSubTeamName("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTeamError(message);
    } finally {
      setTeamSaving(false);
    }
  };

  const handleRenameTeam = async () => {
    setTeamNameError(null);
    if (!selectedTeam) return;
    if (!hasTeamAdminAccess) {
      setTeamNameError("Only organization owners and admins can rename teams.");
      return;
    }
    const trimmed = teamNameDraft.trim();
    if (!trimmed) {
      setTeamNameError("Team name cannot be empty.");
      return;
    }
    if (trimmed === selectedTeam.name) return;
    setTeamNameSaving(true);
    try {
      await db.transact(tx.teams[selectedTeam.id].update({ name: trimmed }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTeamNameError(message);
    } finally {
      setTeamNameSaving(false);
    }
  };

  const handleSaveTeamMargins = async () => {
    setTeamMarginError(null);
    setTeamMarginStatus(null);
    if (!selectedTeam) return;
    if (!hasTeamAdminAccess) {
      setTeamMarginError(
        "Only organization owners and admins can update margin thresholds."
      );
      return;
    }

    const productMarginMin = parseThresholdPercentInput(teamMarginDraft.product);
    const installMarginMin = parseThresholdPercentInput(teamMarginDraft.install);
    const projectMarginMin = parseThresholdPercentInput(teamMarginDraft.project);

    if (
      productMarginMin === null ||
      installMarginMin === null ||
      projectMarginMin === null
    ) {
      setTeamMarginError("Margin thresholds must be numbers between 0 and 100.");
      return;
    }

    setTeamMarginSaving(true);
    try {
      await db.transact(
        tx.teams[selectedTeam.id].update({
          marginThresholds: normalizeMarginThresholds({
            product_margin_min: productMarginMin,
            install_margin_min: installMarginMin,
            project_margin_min: projectMarginMin,
          }),
        })
      );
      setTeamMarginStatus("Margin thresholds updated.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTeamMarginError(message);
    } finally {
      setTeamMarginSaving(false);
    }
  };

  const handleDeleteTeam = async () => {
    setTeamDeleteError(null);
    if (!selectedTeam) return;
    if (!isOrgOwner) {
      setTeamDeleteError("Only organization owners can delete teams.");
      return;
    }
    if (selectedTeam.isPrimary) {
      setTeamDeleteError("You cannot delete the org workspace.");
      return;
    }
    if (!window.confirm(`Delete ${selectedTeam.name}? This cannot be undone.`)) {
      return;
    }
    setTeamDeleteLoading(true);
    try {
      await db.transact(tx.teams[selectedTeam.id].delete());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTeamDeleteError(message);
    } finally {
      setTeamDeleteLoading(false);
    }
  };

  const handleAddMember = async () => {
    setMemberActionError(null);
    if (!hasTeamAdminAccess) {
      setMemberActionError("Only organization owners and admins can add members.");
      return;
    }
    if (!convexUser || !selectedTeam || !selectedMemberId) return;
    const now = Date.now();
    const membershipId = id();
    setMemberActionLoading(true);
    try {
      await db.transact(
        tx.memberships[membershipId]
          .create({ role: "member", createdAt: now })
          .link({ team: selectedTeam.id, user: selectedMemberId })
      );
      setSelectedMemberId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setMemberActionError(message);
    } finally {
      setMemberActionLoading(false);
    }
  };

  const handleRemoveMember = async (membershipId?: string, memberId?: string) => {
    setMemberActionError(null);
    if (!hasTeamAdminAccess) {
      setMemberActionError(
        "Only organization owners and admins can remove members."
      );
      return;
    }
    if (!membershipId || !selectedTeam) return;
    if (memberId && memberId === selectedTeam.ownerId) {
      setMemberActionError("Transfer ownership before removing the owner.");
      return;
    }
    setMemberActionLoading(true);
    try {
      await db.transact(tx.memberships[membershipId].delete());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setMemberActionError(message);
    } finally {
      setMemberActionLoading(false);
    }
  };

  const handleMakeOwner = async (membershipId?: string, memberId?: string) => {
    setMemberActionError(null);
    if (!isOrgOwner) {
      setMemberActionError("Only organization owners can transfer ownership.");
      return;
    }
    if (!membershipId || !memberId || !selectedTeam) return;
    const previousOwner = selectedTeam.memberships?.find(
      (membership) => membership.user?.id === selectedTeam.ownerId
    );
    const updates = [
      tx.memberships[membershipId].update({ role: "owner" }),
      ...(previousOwner && previousOwner.id !== membershipId
        ? [tx.memberships[previousOwner.id].update({ role: "member" })]
        : []),
      tx.teams[selectedTeam.id].update({ ownerId: memberId }),
    ];
    setMemberActionLoading(true);
    try {
      await db.transact(updates);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setMemberActionError(message);
    } finally {
      setMemberActionLoading(false);
    }
  };

  const handleSetMemberRole = async (
    membershipId?: string,
    role?: "admin" | "member"
  ) => {
    setMemberActionError(null);
    if (!isOrgOwner) {
      setMemberActionError("Only organization owners can change member roles.");
      return;
    }
    if (!membershipId || !role || !selectedTeam) return;
    setMemberActionLoading(true);
    try {
      await db.transact(tx.memberships[membershipId].update({ role }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setMemberActionError(message);
    } finally {
      setMemberActionLoading(false);
    }
  };

  const canEditCatalog = Boolean(hasTeamAdminAccess && catalogTeam);
  const isAllCatalogScope = catalogTeam === null;

  const handleDropVendor = (insertionIndex: number) => {
    setVendorDrafts((prev) => {
      if (dragVendorIndex === null) return prev;
      return reorderDraftListByInsertion(prev, dragVendorIndex, insertionIndex);
    });
    setDragVendorIndex(null);
    setVendorDropIndex(null);
  };

  const handleDropUnitType = (insertionIndex: number) => {
    setUnitTypeDrafts((prev) => {
      if (dragUnitTypeIndex === null) return prev;
      return reorderDraftListByInsertion(
        prev,
        dragUnitTypeIndex,
        insertionIndex
      );
    });
    setDragUnitTypeIndex(null);
    setUnitTypeDropIndex(null);
  };

  const handleDropProjectType = (insertionIndex: number) => {
    setProjectTypeDrafts((prev) => {
      if (dragProjectTypeIndex === null) return prev;
      return reorderDraftListByInsertion(
        prev,
        dragProjectTypeIndex,
        insertionIndex
      );
    });
    setDragProjectTypeIndex(null);
    setProjectTypeDropIndex(null);
  };

  const handleDropFeatureOption = (
    groupId: string,
    insertionIndex: number,
    entries: Array<{ option: ProductFeatureOptionDraft; index: number }>
  ) => {
    setProductFeatureOptionDrafts((prev) => {
      if (!dragFeatureState) return prev;
      if (dragFeatureState.groupId !== groupId) return prev;

      const reorderedEntryIndices = reorderDraftListByInsertion(
        entries.map((entry, idx) => ({
          sortOrder: idx + 1,
          index: entry.index,
        })),
        dragFeatureState.entryIndex,
        insertionIndex
      ).map((entry) => entry.index);

      const next = prev.slice();
      reorderedEntryIndices.forEach((draftIndex, order) => {
        const existing = next[draftIndex];
        if (!existing) return;
        next[draftIndex] = { ...existing, sortOrder: order + 1 };
      });
      return next;
    });
    setDragFeatureState(null);
    setFeatureDropState(null);
  };

  const handleVendorChange = (index: number, patch: Partial<VendorDraft>) => {
    setVendorDrafts((prev) =>
      prev.map((vendor, idx) => (idx === index ? { ...vendor, ...patch } : vendor))
    );
  };

  const handleAddVendor = () => {
    const nextOrder =
      vendorDrafts.reduce(
        (max, vendor) => Math.max(max, vendor.sortOrder || 0),
        0
      ) + 1;
    setVendorDrafts((prev) => [
      ...prev,
      {
        name: "",
        sortOrder: nextOrder,
        isActive: true,
        allowsSplitFinish: false,
        usesEuroPricing: false,
      },
    ]);
  };

  const handleSaveVendors = async () => {
    setVendorError(null);
    setVendorStatus(null);
    if (!catalogTeam) {
      setVendorError("Select a specific team in Catalog scope before editing vendors.");
      return;
    }
    if (!canEditCatalog) {
      setVendorError("Only organization owners and admins can update vendors.");
      return;
    }

    const cleaned = vendorDrafts
      .map((vendor) => ({
        ...vendor,
        name: vendor.name.trim(),
        sortOrder:
          typeof vendor.sortOrder === "number" && Number.isFinite(vendor.sortOrder)
            ? vendor.sortOrder
            : 0,
      }))
      .filter((vendor) => vendor.name);

    if (!cleaned.length) {
      setVendorError("Add at least one vendor before saving.");
      return;
    }

    const seen = new Set<string>();
    for (const vendor of cleaned) {
      const key = vendor.name.toLowerCase();
      if (seen.has(key)) {
        setVendorError(`Duplicate vendor: ${vendor.name}`);
        return;
      }
      seen.add(key);
    }

    const now = Date.now();
    const txs = cleaned.map((vendor, index) => {
      const payload = {
        name: vendor.name,
        sortOrder: vendor.sortOrder || index + 1,
        isActive: vendor.isActive,
        allowsSplitFinish: vendor.allowsSplitFinish,
        usesEuroPricing: vendor.usesEuroPricing,
        updatedAt: now,
      };
      if (vendor.id) {
        return tx.vendors[vendor.id].update(payload);
      }
      const vendorId = id();
      return tx.vendors[vendorId]
        .create({ ...payload, createdAt: now })
        .link({ team: catalogTeam.id });
    });

    setVendorSaving(true);
    try {
      await db.transact(txs);
      setVendorStatus("Vendors updated.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setVendorError(message);
    } finally {
      setVendorSaving(false);
    }
  };

  const handleDeleteVendor = async (vendor: VendorDraft) => {
    setVendorError(null);
    setVendorStatus(null);
    if (!vendor.id) {
      setVendorDrafts((prev) => prev.filter((item) => item !== vendor));
      return;
    }
    if (!window.confirm(`Delete vendor "${vendor.name}"?`)) return;
    setVendorSaving(true);
    try {
      await db.transact(tx.vendors[vendor.id].delete());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setVendorError(message);
    } finally {
      setVendorSaving(false);
    }
  };

  const handleSeedVendors = async () => {
    setVendorError(null);
    setVendorStatus(null);
    if (!catalogTeam) {
      setVendorError("Select a specific team in Catalog scope before seeding vendors.");
      return;
    }
    if (!canEditCatalog) {
      setVendorError("Only organization owners and admins can seed vendors.");
      return;
    }
    if (vendorRecords.length) {
      setVendorError("Vendors already exist.");
      return;
    }
    const now = Date.now();
    const txs = DEFAULT_VENDORS.map((vendor) => {
      const vendorId = id();
      return tx.vendors[vendorId]
        .create({
          name: vendor.name,
          sortOrder: vendor.sortOrder,
          isActive: vendor.isActive,
          allowsSplitFinish: false,
          usesEuroPricing: false,
          createdAt: now,
          updatedAt: now,
        })
        .link({ team: catalogTeam.id });
    });
    setVendorSaving(true);
    try {
      await db.transact(txs);
      setVendorStatus("Seeded default vendors.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setVendorError(message);
    } finally {
      setVendorSaving(false);
    }
  };

  const handleUnitTypeChange = (index: number, patch: Partial<UnitTypeDraft>) => {
    setUnitTypeDrafts((prev) =>
      prev.map((unit, idx) => (idx === index ? { ...unit, ...patch } : unit))
    );
  };

  const handleUnitTypeVendorPriceChange = (
    index: number,
    vendorId: string,
    value: string
  ) => {
    setUnitTypeDrafts((prev) =>
      prev.map((unit, idx) =>
        idx === index
          ? {
              ...unit,
              vendorPrices: {
                ...(unit.vendorPrices ?? {}),
                [vendorId]: value,
              },
            }
          : unit
      )
    );
  };

  const handleAddUnitType = () => {
    const nextOrder =
      unitTypeDrafts.reduce(
        (max, unit) => Math.max(max, unit.sortOrder || 0),
        0
      ) + 1;
    setUnitTypeDrafts((prev) => [
      ...prev,
      {
        code: "",
        label: "",
        price: "",
        vendorPrices: {},
        sortOrder: nextOrder,
        isActive: true,
      },
    ]);
  };

  const handleSaveUnitTypes = async () => {
    setUnitTypeError(null);
    setUnitTypeStatus(null);
    if (!catalogTeam) {
      setUnitTypeError("Select a specific team in Catalog scope before editing unit types.");
      return;
    }
    if (!canEditCatalog) {
      setUnitTypeError(
        "Only organization owners and admins can update unit types."
      );
      return;
    }

    const cleaned = unitTypeDrafts
      .map((unit) => ({
        ...unit,
        code: unit.code.trim(),
        label: unit.label.trim(),
        price: unit.price.trim(),
        vendorPrices: Object.fromEntries(
          Object.entries(unit.vendorPrices ?? {})
            .map(([vendorId, vendorPrice]) => [
              vendorId.trim(),
              String(vendorPrice ?? "").trim(),
            ])
            .filter(([vendorId]) => vendorId)
        ),
        sortOrder:
          typeof unit.sortOrder === "number" && Number.isFinite(unit.sortOrder)
            ? unit.sortOrder
            : 0,
      }))
      .filter((unit) => unit.code || unit.label || unit.price);

    if (!cleaned.length) {
      setUnitTypeError("Add at least one unit type before saving.");
      return;
    }

    const seenCodes = new Set<string>();
    const validatedUnits: Array<{
      id?: string;
      code: string;
      label: string;
      priceValue: number;
      vendorPrices: Array<{ vendorId: string; price: number }>;
      sortOrder: number;
      isActive: boolean;
    }> = [];
    for (const unit of cleaned) {
      if (!unit.code || !unit.label) {
        setUnitTypeError("Unit type code and label are required.");
        return;
      }
      if (!unit.price) {
        setUnitTypeError(`Price required for ${unit.code}.`);
        return;
      }
      const key = unit.code.toLowerCase();
      if (seenCodes.has(key)) {
        setUnitTypeError(`Duplicate unit type: ${unit.code}`);
        return;
      }
      seenCodes.add(key);
      const priceValue = Number(unit.price);
      if (!Number.isFinite(priceValue)) {
        setUnitTypeError(`Invalid price for ${unit.code}.`);
        return;
      }

      const vendorPrices: Array<{ vendorId: string; price: number }> = [];
      for (const [vendorId, rawVendorPrice] of Object.entries(
        unit.vendorPrices ?? {}
      )) {
        if (!rawVendorPrice) continue;
        const vendorPriceValue = Number(rawVendorPrice);
        if (!Number.isFinite(vendorPriceValue)) {
          const vendorLabel =
            unitTypeVendorColumns.find((vendor) => vendor.id === vendorId)?.name ||
            vendorId;
          setUnitTypeError(`Invalid vendor price for ${unit.code} / ${vendorLabel}.`);
          return;
        }
        vendorPrices.push({ vendorId, price: vendorPriceValue });
      }
      validatedUnits.push({
        id: unit.id,
        code: unit.code,
        label: unit.label,
        priceValue,
        vendorPrices,
        sortOrder: unit.sortOrder,
        isActive: unit.isActive,
      });
    }

    const now = Date.now();
    const txs = validatedUnits.map((unit, index) => {
      const payload = {
        code: unit.code,
        label: unit.label,
        price: unit.priceValue,
        vendorPrices: unit.vendorPrices,
        sortOrder: unit.sortOrder || index + 1,
        isActive: unit.isActive,
        updatedAt: now,
      };
      if (unit.id) {
        return tx.unitTypes[unit.id].update(payload);
      }
      const unitId = id();
      return tx.unitTypes[unitId]
        .create({ ...payload, createdAt: now })
        .link({ team: catalogTeam.id });
    });

    setUnitTypeSaving(true);
    try {
      await db.transact(txs);
      setUnitTypeStatus("Unit types updated.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setUnitTypeError(message);
    } finally {
      setUnitTypeSaving(false);
    }
  };

  const handleDeleteUnitType = async (unit: UnitTypeDraft) => {
    setUnitTypeError(null);
    setUnitTypeStatus(null);
    if (!unit.id) {
      setUnitTypeDrafts((prev) => prev.filter((item) => item !== unit));
      return;
    }
    if (!window.confirm(`Delete unit type "${unit.code}"?`)) return;
    setUnitTypeSaving(true);
    try {
      await db.transact(tx.unitTypes[unit.id].delete());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setUnitTypeError(message);
    } finally {
      setUnitTypeSaving(false);
    }
  };

  const handleSeedUnitTypes = async () => {
    setUnitTypeError(null);
    setUnitTypeStatus(null);
    if (!catalogTeam) {
      setUnitTypeError("Select a specific team in Catalog scope before seeding unit types.");
      return;
    }
    if (!canEditCatalog) {
      setUnitTypeError(
        "Only organization owners and admins can seed unit types."
      );
      return;
    }
    if (unitTypeRecords.length) {
      setUnitTypeError("Unit types already exist.");
      return;
    }
    const now = Date.now();
    const txs = DEFAULT_UNIT_TYPES.map((unit) => {
      const unitId = id();
      return tx.unitTypes[unitId]
        .create({
          code: unit.code,
          label: unit.label,
          price: unit.price,
          sortOrder: unit.sortOrder,
          isActive: unit.isActive,
          createdAt: now,
          updatedAt: now,
        })
        .link({ team: catalogTeam.id });
    });
    setUnitTypeSaving(true);
    try {
      await db.transact(txs);
      setUnitTypeStatus("Seeded default unit types.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setUnitTypeError(message);
    } finally {
      setUnitTypeSaving(false);
    }
  };

  const handleProjectTypeChange = (
    index: number,
    patch: Partial<ProjectTypeDraft>
  ) => {
    setProjectTypeDrafts((prev) =>
      prev.map((projectType, idx) =>
        idx === index ? { ...projectType, ...patch } : projectType
      )
    );
  };

  const handleAddProjectType = () => {
    const nextOrder =
      projectTypeDrafts.reduce(
        (max, projectType) => Math.max(max, projectType.sortOrder || 0),
        0
      ) + 1;
    setProjectTypeDrafts((prev) => [
      ...prev,
      {
        label: "",
        sortOrder: nextOrder,
        isActive: true,
      },
    ]);
  };

  const handleSaveProjectTypes = async () => {
    setProjectTypeError(null);
    setProjectTypeStatus(null);
    if (!catalogTeam) {
      setProjectTypeError(
        "Select a specific team in Catalog scope before editing project types."
      );
      return;
    }
    if (!canEditCatalog) {
      setProjectTypeError(
        "Only organization owners and admins can update project types."
      );
      return;
    }

    const cleaned = projectTypeDrafts
      .map((projectType) => ({
        ...projectType,
        label: projectType.label.trim(),
        sortOrder:
          typeof projectType.sortOrder === "number" &&
          Number.isFinite(projectType.sortOrder)
            ? projectType.sortOrder
            : 0,
      }))
      .filter((projectType) => projectType.label);

    if (!cleaned.length) {
      setProjectTypeError("Add at least one project type before saving.");
      return;
    }

    const seenLabels = new Set<string>();
    for (const projectType of cleaned) {
      const key = projectType.label.toLowerCase();
      if (seenLabels.has(key)) {
        setProjectTypeError(`Duplicate project type: ${projectType.label}`);
        return;
      }
      seenLabels.add(key);
    }

    const now = Date.now();
    const txs = cleaned.map((projectType, index) => {
      const payload = {
        label: projectType.label,
        sortOrder: projectType.sortOrder || index + 1,
        isActive: projectType.isActive,
        updatedAt: now,
      };
      if (projectType.id) {
        return tx.projectTypes[projectType.id].update(payload);
      }
      const projectTypeId = id();
      return tx.projectTypes[projectTypeId]
        .create({ ...payload, createdAt: now })
        .link({ team: catalogTeam.id });
    });

    setProjectTypeSaving(true);
    try {
      await db.transact(txs);
      setProjectTypeStatus("Project types updated.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setProjectTypeError(message);
    } finally {
      setProjectTypeSaving(false);
    }
  };

  const handleDeleteProjectType = async (projectType: ProjectTypeDraft) => {
    setProjectTypeError(null);
    setProjectTypeStatus(null);
    if (!projectType.id) {
      setProjectTypeDrafts((prev) => prev.filter((item) => item !== projectType));
      return;
    }
    if (!window.confirm(`Delete project type "${projectType.label}"?`)) return;
    setProjectTypeSaving(true);
    try {
      await db.transact(tx.projectTypes[projectType.id].delete());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setProjectTypeError(message);
    } finally {
      setProjectTypeSaving(false);
    }
  };

  const handleSeedProjectTypes = async () => {
    setProjectTypeError(null);
    setProjectTypeStatus(null);
    if (!catalogTeam) {
      setProjectTypeError(
        "Select a specific team in Catalog scope before seeding project types."
      );
      return;
    }
    if (!canEditCatalog) {
      setProjectTypeError(
        "Only organization owners and admins can seed project types."
      );
      return;
    }
    if (projectTypeRecords.length) {
      setProjectTypeError("Project types already exist.");
      return;
    }
    const now = Date.now();
    const txs = DEFAULT_PROJECT_TYPES.map((projectType) => {
      const projectTypeId = id();
      return tx.projectTypes[projectTypeId]
        .create({
          label: projectType.label,
          sortOrder: projectType.sortOrder,
          isActive: projectType.isActive,
          createdAt: now,
          updatedAt: now,
        })
        .link({ team: catalogTeam.id });
    });
    setProjectTypeSaving(true);
    try {
      await db.transact(txs);
      setProjectTypeStatus("Seeded default project types.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setProjectTypeError(message);
    } finally {
      setProjectTypeSaving(false);
    }
  };

  const scopedFeatureVendorId =
    featureEditorVendorId === FEATURE_SCOPE_ALL_PRODUCTS
      ? ""
      : featureEditorVendorId;
  const scopedFeatureVendor = vendorRecords.find(
    (vendor) => vendor.id === scopedFeatureVendorId
  );
  const scopedFeatureVendorLabel =
    featureEditorVendorId === FEATURE_SCOPE_ALL_PRODUCTS
      ? "All products (default options)"
      : scopedFeatureVendor?.name ?? "Selected vendor";
  const scopedVendorDisallowsSplitFinish = Boolean(
    scopedFeatureVendor && scopedFeatureVendor.allowsSplitFinish !== true
  );

  const featureCategoryGroups = useMemo(() => {
    if (!scopedVendorDisallowsSplitFinish) {
      return PRODUCT_FEATURE_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        categories: [category.id],
        createCategory: category.id,
      }));
    }

    return [
      {
        id: "frame_color",
        label: "Frame color",
        categories: [
          "interior_frame_color",
          "exterior_frame_color",
        ] as const,
        createCategory: "interior_frame_color" as const,
      },
      ...PRODUCT_FEATURE_CATEGORIES.filter(
        (category) =>
          category.id !== "interior_frame_color" &&
          category.id !== "exterior_frame_color"
      ).map((category) => ({
        id: category.id,
        label: category.label,
        categories: [category.id] as const,
        createCategory: category.id,
      })),
    ];
  }, [scopedVendorDisallowsSplitFinish]);

  const featureOptionsByCategory = useMemo(
    () =>
      featureCategoryGroups.map((group) => {
        const entries = productFeatureOptionDrafts
          .map((option, index) => ({ option, index }))
          .filter(
            ({ option }) =>
              group.categories.some((categoryId) => categoryId === option.category) &&
              (option.vendorId || "") === scopedFeatureVendorId
          )
          .sort((a, b) => {
            if (a.option.sortOrder !== b.option.sortOrder) {
              return a.option.sortOrder - b.option.sortOrder;
            }
            return a.option.label.localeCompare(b.option.label);
          });
        return { group, entries };
      }),
    [featureCategoryGroups, productFeatureOptionDrafts, scopedFeatureVendorId]
  );

  const scopedFeatureOptionCount = featureOptionsByCategory.reduce(
    (total, group) => total + group.entries.length,
    0
  );

  const handleProductFeatureOptionChange = (
    index: number,
    patch: Partial<ProductFeatureOptionDraft>
  ) => {
    setProductFeatureOptionDrafts((prev) =>
      prev.map((option, idx) =>
        idx === index ? { ...option, ...patch } : option
      )
    );
  };

  const handleAddProductFeatureOption = (categoryId?: string) => {
    const targetGroup =
      featureCategoryGroups.find((group) => group.id === categoryId) ??
      featureCategoryGroups[0];
    const category = targetGroup?.createCategory ?? "";
    const nextOrder =
      productFeatureOptionDrafts.reduce(
        (max, option) => {
          const sameCategory = targetGroup?.categories.some(
            (categoryIdToMatch) => categoryIdToMatch === option.category
          );
          const sameScope = (option.vendorId || "") === scopedFeatureVendorId;
          if (!sameCategory || !sameScope) return max;
          return Math.max(max, option.sortOrder || 0);
        },
        0
      ) + 1;
    setProductFeatureOptionDrafts((prev) => [
      ...prev,
      {
        category,
        vendorId: scopedFeatureVendorId,
        label: "",
        sortOrder: nextOrder,
        isActive: true,
      },
    ]);
  };

  const handleSaveProductFeatureOptions = async () => {
    setProductFeatureOptionError(null);
    setProductFeatureOptionStatus(null);
    if (!catalogTeam) {
      setProductFeatureOptionError(
        "Select a specific team in Catalog scope before editing feature options."
      );
      return;
    }
    if (!canEditCatalog) {
      setProductFeatureOptionError(
        "Only organization owners and admins can update feature options."
      );
      return;
    }

    const vendorAllowsSplitById = new Map(
      vendorRecords.map((vendor) => [vendor.id, vendor.allowsSplitFinish === true])
    );

    const cleaned = productFeatureOptionDrafts
      .map((option) => ({
        ...option,
        category: (() => {
          const normalizedCategory = option.category.trim();
          const vendorId = option.vendorId.trim();
          const vendorAllowsSplit = vendorId
            ? vendorAllowsSplitById.get(vendorId) === true
            : true;
          if (
            !vendorAllowsSplit &&
            normalizedCategory === "exterior_frame_color"
          ) {
            return "interior_frame_color";
          }
          return normalizedCategory;
        })(),
        vendorId: option.vendorId.trim(),
        label: option.label.trim(),
        sortOrder:
          typeof option.sortOrder === "number" &&
          Number.isFinite(option.sortOrder)
            ? option.sortOrder
            : 0,
      }))
      .filter((option) => option.category || option.label || option.vendorId);

    if (!cleaned.length) {
      setProductFeatureOptionError(
        "Add at least one feature option before saving."
      );
      return;
    }

    const seen = new Set<string>();
    for (const option of cleaned) {
      if (!isProductFeatureCategory(option.category)) {
        setProductFeatureOptionError(
          `Invalid feature category: ${option.category || "missing"}`
        );
        return;
      }
      if (!option.label) {
        setProductFeatureOptionError(
          `${PRODUCT_FEATURE_CATEGORY_LABELS[option.category]} requires a label.`
        );
        return;
      }
      const key = [
        option.category,
        option.vendorId || "__all__",
        option.label.toLowerCase(),
      ].join("|");
      if (seen.has(key)) {
        setProductFeatureOptionError(
          `Duplicate option "${option.label}" in ${PRODUCT_FEATURE_CATEGORY_LABELS[option.category]}.`
        );
        return;
      }
      seen.add(key);
    }

    const now = Date.now();
    const txs = cleaned.map((option, index) => {
      const payload = {
        category: option.category,
        label: option.label,
        vendorId: option.vendorId || undefined,
        sortOrder: option.sortOrder || index + 1,
        isActive: option.isActive,
        updatedAt: now,
      };
      if (option.id) {
        return tx.productFeatureOptions[option.id].update(payload);
      }
      const optionId = id();
      return tx.productFeatureOptions[optionId]
        .create({ ...payload, createdAt: now })
        .link({ team: catalogTeam.id });
    });

    setProductFeatureOptionSaving(true);
    try {
      await db.transact(txs);
      setProductFeatureOptionStatus("Feature options updated.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setProductFeatureOptionError(message);
    } finally {
      setProductFeatureOptionSaving(false);
    }
  };

  const handleDeleteProductFeatureOption = async (
    option: ProductFeatureOptionDraft
  ) => {
    setProductFeatureOptionError(null);
    setProductFeatureOptionStatus(null);
    if (!option.id) {
      setProductFeatureOptionDrafts((prev) =>
        prev.filter((item) => item !== option)
      );
      return;
    }
    if (!window.confirm(`Delete feature option "${option.label}"?`)) return;
    setProductFeatureOptionSaving(true);
    try {
      await db.transact(tx.productFeatureOptions[option.id].delete());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setProductFeatureOptionError(message);
    } finally {
      setProductFeatureOptionSaving(false);
    }
  };

  const handleEstimateDraftChange = (
    estimateId: string,
    patch: Partial<EstimateAdminDraft>
  ) => {
    setEstimateDrafts((prev) =>
      prev.map((estimate) =>
        estimate.id === estimateId ? { ...estimate, ...patch } : estimate
      )
    );
  };

  const handleSaveEstimate = async (estimate: EstimateAdminDraft) => {
    setEstimateError(null);
    setEstimateStatus(null);
    if (!hasTeamAdminAccess) {
      setEstimateError("Only organization owners and admins can edit estimates.");
      return;
    }
    if (!selectedTeam) {
      setEstimateError("Select a team before editing estimates.");
      return;
    }
    const title = estimate.title.trim();
    if (!title) {
      setEstimateError("Estimate title cannot be empty.");
      return;
    }

    const now = Date.now();
    setEstimateSavingId(estimate.id);
    try {
      await db.transact(
        tx.estimates[estimate.id].update({
          title,
          updatedAt: now,
        })
      );
      handleEstimateDraftChange(estimate.id, { title, updatedAt: now });
      setEstimateStatus(`Saved "${title}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setEstimateError(message);
    } finally {
      setEstimateSavingId(null);
    }
  };

  const handleDeleteEstimate = async (estimate: EstimateAdminDraft) => {
    setEstimateError(null);
    setEstimateStatus(null);
    if (!hasTeamAdminAccess) {
      setEstimateError("Only organization owners and admins can delete estimates.");
      return;
    }
    if (!selectedTeam) {
      setEstimateError("Select a team before deleting estimates.");
      return;
    }
    if (!window.confirm(`Delete "${estimate.title || "Untitled Estimate"}"?`)) {
      return;
    }
    setEstimateSavingId(estimate.id);
    try {
      await db.transact(tx.estimates[estimate.id].delete());
      setEstimateDrafts((prev) => prev.filter((entry) => entry.id !== estimate.id));
      setEstimateStatus(
        `Deleted "${estimate.title || "Untitled Estimate"}".`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setEstimateError(message);
    } finally {
      setEstimateSavingId(null);
    }
  };

  const renderAuthGate = () => {
    if (!clerkEnabled) {
      return (
        <Card className="border-border/60 bg-card/80 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-2xl font-serif">
              Clerk not configured
            </CardTitle>
          </CardHeader>
        </Card>
      );
    }

    if (!authLoaded || !isSignedIn) {
      return (
        <Card className="border-border/60 bg-card/80 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-2xl font-serif">
              Sign in required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SignInButton mode="modal">
              <Button variant="accent" size="sm">
                Sign in with Microsoft
              </Button>
            </SignInButton>
          </CardContent>
        </Card>
      );
    }

    return null;
  };

  const isClerkRetrying = Boolean(
    convexSetupError &&
      convexSetupError.toLowerCase().includes("clerk is temporarily unavailable")
  );
  const convexSetupBanner = isClerkRetrying
    ? "Clerk is temporarily unavailable. Retrying sign-in in about 15 seconds."
    : convexSetupError
      ? `Convex auth issue: ${convexSetupError}`
      : null;
  const authGate = renderAuthGate();

  return (
    <section
      id={sectionId ?? (embedded ? "team-operations" : undefined)}
      className={embedded ? "w-full bg-background" : "min-h-screen bg-background"}
    >
      {includeAuthSync ? (
        <ConvexAuthSync onAuthError={setConvexSetupError} />
      ) : null}
      <div
        className={
          embedded
            ? "w-full px-4 py-8 sm:px-6 lg:px-8 xl:px-10 2xl:px-12"
            : "container py-10"
        }
      >
        {showHeader ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-serif">Team Admin</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="accent" size="sm">
                {embedded ? (
                  <a href="#pandadoc-mapping">Open PandaDoc mapping</a>
                ) : (
                  <Link href="/admin#pandadoc-mapping">Open PandaDoc mapping</Link>
                )}
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/">Back to workspace</Link>
              </Button>
            </div>
          </div>
        ) : null}

        {convexSetupBanner ? (
          <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            {convexSetupBanner}
          </div>
        ) : null}

        {convexAuthError ? (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {convexAuthError.message}
          </div>
        ) : null}

        {authGate ? (
          authGate
        ) : !hasTeamAdminAccess ? (
          <Card className="border-border/60 bg-card/80 shadow-elevated">
            <CardHeader>
              <CardTitle className="text-2xl font-serif">
                Admin access only
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                Signed in as {user?.primaryEmailAddress?.emailAddress}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            {showWorkspaceSections ? (
              <>
                <Card id="org-overview" className="border-border/60 bg-card/80 shadow-elevated">
                  <CardHeader>
                    <CardTitle className="text-2xl font-serif">
                      Organization overview
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {convexLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Connecting to Convex...
                      </div>
                    ) : null}
                    {orgTeam ? (
                      <>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">
                            Org workspace
                          </p>
                          <p className="text-lg font-semibold text-foreground">
                            {orgTeam.name}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="bg-background/80">
                            Members: {orgTeam.memberships?.length ?? 0}
                          </Badge>
                          <Badge variant="outline" className="bg-background/80">
                            Sub teams: {subTeamCount}
                          </Badge>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Organization workspace has not been created yet.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-card/80 shadow-elevated">
                  <CardHeader>
                    <CardTitle className="text-2xl font-serif">
                      Create sub team
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {teamError ? (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {teamError}
                      </div>
                    ) : null}
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">
                        Team name
                      </label>
                      <Input
                        value={subTeamName}
                        onChange={(event) => setSubTeamName(event.target.value)}
                        placeholder="Estimator Pod A"
                      />
                    </div>
                    <Button
                      variant="accent"
                      onClick={handleCreateSubTeam}
                      disabled={teamSaving || !orgTeam}
                    >
                      {teamSaving ? "Creating..." : "Create sub team"}
                    </Button>
                  </CardContent>
                </Card>

                <Card id="team-directory" className="border-border/60 bg-card/80 shadow-elevated lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-2xl font-serif">Teams</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-6 lg:grid-cols-[0.6fr_0.4fr]">
                    <ScrollArea className="h-72 rounded-lg border border-border/70 bg-background/70">
                      <div className="divide-y divide-border/60">
                        {orgScopedTeams.map((team) => {
                          const isPrimary = team.isPrimary;
                          return (
                            <button
                              key={team.id}
                              type="button"
                              className={`flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition ${
                                selectedTeamId === team.id
                                  ? "bg-accent/10"
                                  : "hover:bg-muted/40"
                              }`}
                              onClick={() => setSelectedTeamId(team.id)}
                            >
                              <div>
                                <p className="text-sm font-semibold text-foreground">
                                  {team.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Members: {team.memberships?.length ?? 0}
                                </p>
                              </div>
                              {isPrimary ? (
                                <Badge variant="outline" className="bg-background/80">
                                  Org
                                </Badge>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </ScrollArea>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-foreground">
                          Add org member
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Add a teammate from the org workspace to this team.
                        </p>
                        {!hasTeamAdminAccess ? (
                          <p className="text-xs text-muted-foreground">
                            Owners and admins can assign members to sub teams.
                          </p>
                        ) : null}
                        <Select
                          value={selectedMemberId ?? "__none__"}
                          onValueChange={(value) =>
                            setSelectedMemberId(value === "__none__" ? null : value)
                          }
                          disabled={!availableOrgMembers.length || !hasTeamAdminAccess}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select member" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select member</SelectItem>
                            {availableOrgMembers.map((member) => (
                              <SelectItem key={member.id} value={member.user?.id ?? member.id}>
                                {getMemberProfile(member).name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          onClick={handleAddMember}
                          disabled={
                            !selectedMemberId ||
                            memberActionLoading ||
                            !selectedTeam ||
                            !hasTeamAdminAccess
                          }
                        >
                          Add member
                        </Button>
                      </div>
                      {availableOrgMembers.length === 0 ? (
                        <div className="text-xs text-muted-foreground">
                          All org members are already on this team.
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>

                <Card id="team-members" className="border-border/60 bg-card/80 shadow-elevated lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Team members
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {memberActionError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {memberActionError}
                  </div>
                ) : null}
                {teamNameError ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                    {teamNameError}
                  </div>
                ) : null}
                {teamMarginError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {teamMarginError}
                  </div>
                ) : null}
                {teamMarginStatus ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
                    {teamMarginStatus}
                  </div>
                ) : null}
                {teamDeleteError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {teamDeleteError}
                  </div>
                ) : null}
                {!selectedTeam ? (
                  <div className="text-sm text-muted-foreground">
                    Select a team to see members.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border/60 bg-background/70 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Team settings
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Input
                          className="min-w-[220px] flex-1"
                          value={teamNameDraft}
                          onChange={(event) => setTeamNameDraft(event.target.value)}
                          disabled={!hasTeamAdminAccess}
                        />
                        <Button
                          variant="outline"
                          onClick={handleRenameTeam}
                          disabled={
                            !hasTeamAdminAccess ||
                            teamNameSaving ||
                            !teamNameDraft.trim() ||
                            teamNameDraft.trim() === selectedTeam.name
                          }
                        >
                          {teamNameSaving ? "Saving..." : "Save name"}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={handleDeleteTeam}
                          disabled={
                            !isOrgOwner || teamDeleteLoading || selectedTeam.isPrimary
                          }
                        >
                          {teamDeleteLoading ? "Deleting..." : "Delete team"}
                        </Button>
                      </div>
                      <div className="mt-4 space-y-3 rounded-lg border border-border/60 bg-card/60 p-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Margin thresholds
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Minimum required margins used in Calculated Totals checks.
                          </p>
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">
                              Product margin (%)
                            </label>
                            <Input
                              inputMode="decimal"
                              value={teamMarginDraft.product}
                              onChange={(event) =>
                                setTeamMarginDraft((prev) => ({
                                  ...prev,
                                  product: event.target.value,
                                }))
                              }
                              placeholder="0"
                              disabled={!hasTeamAdminAccess}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">
                              Install margin (%)
                            </label>
                            <Input
                              inputMode="decimal"
                              value={teamMarginDraft.install}
                              onChange={(event) =>
                                setTeamMarginDraft((prev) => ({
                                  ...prev,
                                  install: event.target.value,
                                }))
                              }
                              placeholder="0"
                              disabled={!hasTeamAdminAccess}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">
                              Overall project margin (%)
                            </label>
                            <Input
                              inputMode="decimal"
                              value={teamMarginDraft.project}
                              onChange={(event) =>
                                setTeamMarginDraft((prev) => ({
                                  ...prev,
                                  project: event.target.value,
                                }))
                              }
                              placeholder="0"
                              disabled={!hasTeamAdminAccess}
                            />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            onClick={handleSaveTeamMargins}
                            disabled={!hasTeamAdminAccess || teamMarginSaving}
                          >
                            {teamMarginSaving ? "Saving..." : "Save margins"}
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Owners and admins can rename teams. Only owners can
                        delete teams and transfer ownership.
                      </p>
                    </div>

                    {selectedTeamMembers.length ? (
                      <div className="space-y-3">
                        {selectedTeamMembers.map((membership) => {
                          const memberId = membership.user?.id;
                          const isOwner = memberId === selectedTeam.ownerId;
                          const profile = getMemberProfile(membership);
                          const initials = getInitials(profile.name);
                          const imageUrl = profile.imageUrl ?? "";
                          return (
                            <div
                              key={membership.id}
                              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border/60 bg-background/70 px-4 py-3"
                            >
                              <div className="flex items-center gap-3">
                                {imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={imageUrl}
                                    alt={profile.name}
                                    className="h-10 w-10 rounded-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent-foreground">
                                    {initials}
                                  </div>
                                )}
                                <div>
                                  <p className="text-sm font-semibold text-foreground">
                                    {profile.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {profile.email ?? profile.memberId ?? "Unknown user"}
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {isOwner ? (
                                  <Badge
                                    variant="outline"
                                    className="bg-background/80"
                                  >
                                    Owner
                                  </Badge>
                                ) : membership.role === "admin" ? (
                                  <Badge
                                    variant="outline"
                                    className="bg-background/80"
                                  >
                                    Admin
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="bg-background/80"
                                  >
                                    Member
                                  </Badge>
                                )}
                                {!isOwner ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      handleMakeOwner(membership.id, memberId)
                                    }
                                    disabled={memberActionLoading || !isOrgOwner}
                                  >
                                    Make owner
                                  </Button>
                                ) : null}
                                {!isOwner && selectedTeam.isPrimary ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      handleSetMemberRole(
                                        membership.id,
                                        membership.role === "admin"
                                          ? "member"
                                          : "admin"
                                      )
                                    }
                                    disabled={memberActionLoading || !isOrgOwner}
                                  >
                                    {membership.role === "admin"
                                      ? "Make member"
                                      : "Make admin"}
                                  </Button>
                                ) : null}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleRemoveMember(membership.id, memberId)
                                  }
                                  disabled={
                                    memberActionLoading ||
                                    isOwner ||
                                    !hasTeamAdminAccess
                                  }
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No members yet.
                      </div>
                    )}
                    {selectedTeam.isPrimary ? (
                      <p className="text-xs text-muted-foreground">
                        Admins on the org workspace can edit teams and org
                        settings.
                      </p>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>

            {includeEstimateSection ? (
                <Card
                id="team-estimates"
                className="border-border/60 bg-card/80 shadow-elevated lg:col-span-2"
              >
                <CardHeader>
                  <CardTitle className="text-2xl font-serif">
                    Team estimates
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {estimateError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {estimateError}
                    </div>
                  ) : null}
                  {estimateStatus ? (
                    <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      {estimateStatus}
                    </div>
                  ) : null}
                  {!selectedTeam ? (
                    <div className="text-sm text-muted-foreground">
                      Select a team to manage estimates.
                    </div>
                  ) : !estimateDrafts.length ? (
                    <div className="rounded-lg border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                      No saved team estimates yet for {selectedTeam.name}.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {estimateDrafts.map((estimate) => {
                        const sourceEstimate = estimateSourceById.get(estimate.id);
                        const sourceTitle = String(sourceEstimate?.title ?? "").trim();
                        const draftTitle = estimate.title.trim();
                        const isBusy = estimateSavingId === estimate.id;
                        const canSaveName =
                          Boolean(draftTitle) && draftTitle !== sourceTitle;
                        return (
                          <div
                            key={estimate.id}
                            className="rounded-lg border border-border/60 bg-background/70 px-4 py-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Input
                                className="min-w-[280px] flex-1"
                                value={estimate.title}
                                onChange={(event) =>
                                  handleEstimateDraftChange(estimate.id, {
                                    title: event.target.value,
                                  })
                                }
                                placeholder="Estimate title"
                                disabled={!hasTeamAdminAccess || isBusy}
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleSaveEstimate(estimate)}
                                disabled={!hasTeamAdminAccess || isBusy || !canSaveName}
                              >
                                {isBusy ? (
                                  "Saving..."
                                ) : (
                                  <>
                                    <Save className="h-4 w-4" />
                                    Save name
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleDeleteEstimate(estimate)}
                                disabled={!hasTeamAdminAccess || isBusy}
                              >
                                Delete
                              </Button>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline" className="bg-background/80">
                                Status: {estimate.status || "active"}
                              </Badge>
                              <Badge variant="outline" className="bg-background/80">
                                Version: {estimate.version ?? 1}
                              </Badge>
                              <span>Owner: {estimate.ownerLabel}</span>
                              <span>Created: {formatDateTime(estimate.createdAt)}</span>
                              <span>Updated: {formatDateTime(estimate.updatedAt)}</span>
                              <span>
                                Last generated: {formatDateTime(estimate.lastGeneratedAt)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}
              </>
            ) : null}

            {showCatalogSection ? (
              <Card id="catalog-settings" className="border-border/60 bg-card/80 shadow-elevated lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Catalog settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-8">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Catalog scope
                  </label>
                  <Select
                    value={catalogScopeTeamId}
                    onValueChange={setCatalogScopeTeamId}
                  >
                    <SelectTrigger className="max-w-xl">
                      <SelectValue placeholder="Select catalog scope" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CATALOG_SCOPE_ALL_TEAMS}>
                        All teams (view only)
                      </SelectItem>
                      {catalogScopeOptions.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {isAllCatalogScope
                      ? "Showing combined catalog data across all teams. Select a specific team to edit."
                      : `Editing catalog for ${catalogTeam?.name ?? "selected team"}.`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Drag rows using the grip icon to reorder sort order.
                  </p>
                </div>
                {!hasTeamAdminAccess ? (
                  <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    Only organization owners and admins can edit catalog settings.
                  </div>
                ) : null}

                <section className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Vendors</p>
                    <p className="text-xs text-muted-foreground">
                      Controls product dropdowns and whether split finish is
                      available per product, plus optional EUR pricing inputs.
                    </p>
                  </div>
                  {vendorError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {vendorError}
                    </div>
                  ) : null}
                  {vendorStatus ? (
                    <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      {vendorStatus}
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-border/70 bg-background/70 overflow-x-auto">
                    <div className="min-w-[940px]">
                      <div className="grid grid-cols-[auto_2fr_1.1fr_1fr_0.8fr_auto] gap-2 border-b border-border/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                        <span>Active</span>
                        <span>Name</span>
                        <span>Split finish</span>
                        <span>EUR pricing</span>
                        <span>Order</span>
                        <span></span>
                      </div>
                      <div className="divide-y divide-border/60">
                        {vendorDrafts.map((vendor, index) => (
                          <div
                            key={vendor.id ?? `vendor-${index}`}
                            className="relative grid grid-cols-[auto_2fr_1.1fr_1fr_0.8fr_auto] items-center gap-2 px-3 py-2 text-sm"
                            draggable={canEditCatalog}
                            onDragStart={() => {
                              setDragVendorIndex(index);
                              setVendorDropIndex(index);
                            }}
                            onDragOver={(event) => {
                              if (dragVendorIndex === null) return;
                              event.preventDefault();
                              setVendorDropIndex(
                                getInsertionIndexFromDrag(event, index)
                              );
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              handleDropVendor(
                                vendorDropIndex ??
                                  getInsertionIndexFromDrag(event, index)
                              );
                            }}
                            onDragEnd={() => {
                              setDragVendorIndex(null);
                              setVendorDropIndex(null);
                            }}
                          >
                            {dragVendorIndex !== null && vendorDropIndex === index ? (
                              <div className="pointer-events-none absolute left-2 right-2 top-0 h-0.5 rounded-full bg-accent" />
                            ) : null}
                            {dragVendorIndex !== null &&
                            index === vendorDrafts.length - 1 &&
                            vendorDropIndex === vendorDrafts.length ? (
                              <div className="pointer-events-none absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-accent" />
                            ) : null}
                            <Checkbox
                              checked={vendor.isActive}
                              onCheckedChange={(checked) =>
                                handleVendorChange(index, {
                                  isActive: checked === true,
                                })
                              }
                              disabled={!canEditCatalog}
                            />
                            <Input
                              uiSize="xs"
                              value={vendor.name}
                              onChange={(event) =>
                                handleVendorChange(index, { name: event.target.value })
                              }
                              placeholder="Vendor name"
                              disabled={!canEditCatalog}
                            />
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox
                                checked={vendor.allowsSplitFinish}
                                onCheckedChange={(checked) =>
                                  handleVendorChange(index, {
                                    allowsSplitFinish: checked === true,
                                  })
                                }
                                disabled={!canEditCatalog}
                              />
                              <span>Allow split finish</span>
                            </label>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox
                                checked={vendor.usesEuroPricing}
                                onCheckedChange={(checked) =>
                                  handleVendorChange(index, {
                                    usesEuroPricing: checked === true,
                                  })
                                }
                                disabled={!canEditCatalog}
                              />
                              <span>Uses EUR pricing</span>
                            </label>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <GripVertical className="h-4 w-4" />
                              <span>{index + 1}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteVendor(vendor)}
                              disabled={!canEditCatalog || vendorSaving}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        {!vendorDrafts.length ? (
                          <div className="px-3 py-3 text-sm text-muted-foreground">
                            No vendors yet.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddVendor}
                      disabled={!canEditCatalog}
                    >
                      <Plus className="h-4 w-4" />
                      Add vendor
                    </Button>
                    <Button
                      variant="accent"
                      size="sm"
                      onClick={handleSaveVendors}
                      disabled={!canEditCatalog || vendorSaving}
                    >
                      {vendorSaving ? (
                        "Saving..."
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Save vendors
                        </>
                      )}
                    </Button>
                    {!vendorRecords.length ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSeedVendors}
                        disabled={!canEditCatalog || vendorSaving}
                      >
                        Seed defaults
                      </Button>
                    ) : null}
                  </div>
                </section>

                <Separator />

                <section className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Project types
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Controls the Project Type dropdown in the estimate builder.
                    </p>
                  </div>
                  {projectTypeError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {projectTypeError}
                    </div>
                  ) : null}
                  {projectTypeStatus ? (
                    <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      {projectTypeStatus}
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-border/70 bg-background/70 overflow-x-auto">
                    <div className="min-w-[620px]">
                      <div className="grid grid-cols-[auto_2fr_0.6fr_auto] gap-2 border-b border-border/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                        <span>Active</span>
                        <span>Label</span>
                        <span>Order</span>
                        <span></span>
                      </div>
                      <div className="divide-y divide-border/60">
                        {projectTypeDrafts.map((projectType, index) => (
                          <div
                            key={projectType.id ?? `project-type-${index}`}
                            className="relative grid grid-cols-[auto_2fr_0.6fr_auto] items-center gap-2 px-3 py-2 text-sm"
                            draggable={canEditCatalog}
                            onDragStart={() => {
                              setDragProjectTypeIndex(index);
                              setProjectTypeDropIndex(index);
                            }}
                            onDragOver={(event) => {
                              if (dragProjectTypeIndex === null) return;
                              event.preventDefault();
                              setProjectTypeDropIndex(
                                getInsertionIndexFromDrag(event, index)
                              );
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              handleDropProjectType(
                                projectTypeDropIndex ??
                                  getInsertionIndexFromDrag(event, index)
                              );
                            }}
                            onDragEnd={() => {
                              setDragProjectTypeIndex(null);
                              setProjectTypeDropIndex(null);
                            }}
                          >
                            {dragProjectTypeIndex !== null &&
                            projectTypeDropIndex === index ? (
                              <div className="pointer-events-none absolute left-2 right-2 top-0 h-0.5 rounded-full bg-accent" />
                            ) : null}
                            {dragProjectTypeIndex !== null &&
                            index === projectTypeDrafts.length - 1 &&
                            projectTypeDropIndex === projectTypeDrafts.length ? (
                              <div className="pointer-events-none absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-accent" />
                            ) : null}
                            <Checkbox
                              checked={projectType.isActive}
                              onCheckedChange={(checked) =>
                                handleProjectTypeChange(index, {
                                  isActive: checked === true,
                                })
                              }
                              disabled={!canEditCatalog}
                            />
                            <Input
                              uiSize="xs"
                              value={projectType.label}
                              onChange={(event) =>
                                handleProjectTypeChange(index, {
                                  label: event.target.value,
                                })
                              }
                              placeholder="Project type label"
                              disabled={!canEditCatalog}
                            />
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <GripVertical className="h-4 w-4" />
                              <span>{index + 1}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteProjectType(projectType)}
                              disabled={!canEditCatalog || projectTypeSaving}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        {!projectTypeDrafts.length ? (
                          <div className="px-3 py-3 text-sm text-muted-foreground">
                            No project types yet.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddProjectType}
                      disabled={!canEditCatalog}
                    >
                      <Plus className="h-4 w-4" />
                      Add project type
                    </Button>
                    <Button
                      variant="accent"
                      size="sm"
                      onClick={handleSaveProjectTypes}
                      disabled={!canEditCatalog || projectTypeSaving}
                    >
                      {projectTypeSaving ? (
                        "Saving..."
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Save project types
                        </>
                      )}
                    </Button>
                    {!projectTypeRecords.length ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSeedProjectTypes}
                        disabled={!canEditCatalog || projectTypeSaving}
                      >
                        Seed defaults
                      </Button>
                    ) : null}
                  </div>
                </section>

                <Separator />

                <section className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Unit types
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Drives bucking line items and the install calculator.
                      Default price is used when a vendor-specific price is blank.
                    </p>
                  </div>
                  {unitTypeError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {unitTypeError}
                    </div>
                  ) : null}
                  {unitTypeStatus ? (
                    <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      {unitTypeStatus}
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-border/70 bg-background/70 overflow-x-auto">
                    <div style={{ minWidth: `${unitTypeTableMinWidth}px` }}>
                      <div
                        className="grid gap-2 border-b border-border/60 px-3 py-2 text-xs font-semibold text-muted-foreground"
                        style={{ gridTemplateColumns: unitTypeGridTemplate }}
                      >
                        <span>Active</span>
                        <span>Code</span>
                        <span>Label</span>
                        <span>Default price</span>
                        {unitTypeVendorColumns.map((vendor) => (
                          <span key={`unit-header-${vendor.id}`} title={vendor.name}>
                            {vendor.name}
                          </span>
                        ))}
                        <span>Order</span>
                        <span></span>
                      </div>
                      <div className="divide-y divide-border/60">
                        {unitTypeDrafts.map((unit, index) => (
                          <div
                            key={unit.id ?? `unit-${index}`}
                            className="relative grid items-center gap-2 px-3 py-2 text-sm"
                            style={{ gridTemplateColumns: unitTypeGridTemplate }}
                            draggable={canEditCatalog}
                            onDragStart={() => {
                              setDragUnitTypeIndex(index);
                              setUnitTypeDropIndex(index);
                            }}
                            onDragOver={(event) => {
                              if (dragUnitTypeIndex === null) return;
                              event.preventDefault();
                              setUnitTypeDropIndex(
                                getInsertionIndexFromDrag(event, index)
                              );
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              handleDropUnitType(
                                unitTypeDropIndex ??
                                  getInsertionIndexFromDrag(event, index)
                              );
                            }}
                            onDragEnd={() => {
                              setDragUnitTypeIndex(null);
                              setUnitTypeDropIndex(null);
                            }}
                          >
                            {dragUnitTypeIndex !== null && unitTypeDropIndex === index ? (
                              <div className="pointer-events-none absolute left-2 right-2 top-0 h-0.5 rounded-full bg-accent" />
                            ) : null}
                            {dragUnitTypeIndex !== null &&
                            index === unitTypeDrafts.length - 1 &&
                            unitTypeDropIndex === unitTypeDrafts.length ? (
                              <div className="pointer-events-none absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-accent" />
                            ) : null}
                            <Checkbox
                              checked={unit.isActive}
                              onCheckedChange={(checked) =>
                                handleUnitTypeChange(index, {
                                  isActive: checked === true,
                                })
                              }
                              disabled={!canEditCatalog}
                            />
                            <Input
                              uiSize="xs"
                              value={unit.code}
                              onChange={(event) =>
                                handleUnitTypeChange(index, {
                                  code: event.target.value,
                                })
                              }
                              placeholder="SH"
                              disabled={!canEditCatalog}
                            />
                            <Input
                              uiSize="xs"
                              value={unit.label}
                              onChange={(event) =>
                                handleUnitTypeChange(index, {
                                  label: event.target.value,
                                })
                              }
                              placeholder="Single Hung"
                              disabled={!canEditCatalog}
                            />
                            <Input
                              uiSize="xs"
                              value={unit.price}
                              onChange={(event) =>
                                handleUnitTypeChange(index, {
                                  price: event.target.value,
                                })
                              }
                              inputMode="decimal"
                              placeholder="0"
                              disabled={!canEditCatalog}
                            />
                            {unitTypeVendorColumns.map((vendor) => (
                              <Input
                                key={`unit-${unit.id ?? index}-vendor-${vendor.id}`}
                                uiSize="xs"
                                value={unit.vendorPrices?.[vendor.id] ?? ""}
                                onChange={(event) =>
                                  handleUnitTypeVendorPriceChange(
                                    index,
                                    vendor.id,
                                    event.target.value
                                  )
                                }
                                inputMode="decimal"
                                placeholder="Default"
                                disabled={!canEditCatalog}
                              />
                            ))}
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <GripVertical className="h-4 w-4" />
                              <span>{index + 1}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteUnitType(unit)}
                              disabled={!canEditCatalog || unitTypeSaving}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        {!unitTypeDrafts.length ? (
                          <div className="px-3 py-3 text-sm text-muted-foreground">
                            No unit types yet.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddUnitType}
                      disabled={!canEditCatalog}
                    >
                      <Plus className="h-4 w-4" />
                      Add unit type
                    </Button>
                    <Button
                      variant="accent"
                      size="sm"
                      onClick={handleSaveUnitTypes}
                      disabled={!canEditCatalog || unitTypeSaving}
                    >
                      {unitTypeSaving ? (
                        "Saving..."
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Save unit types
                        </>
                      )}
                    </Button>
                    {!unitTypeRecords.length ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSeedUnitTypes}
                        disabled={!canEditCatalog || unitTypeSaving}
                      >
                        Seed defaults
                      </Button>
                    ) : null}
                  </div>
                </section>

                <Separator />

                <section className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Product feature options
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Organize dropdown values by vendor and feature type. Pick a
                      vendor scope, then edit glass, frame color, and hardware
                      options in separate lists.
                    </p>
                  </div>
                  {productFeatureOptionError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {productFeatureOptionError}
                    </div>
                  ) : null}
                  {productFeatureOptionStatus ? (
                    <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      {productFeatureOptionStatus}
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                    <div className="grid gap-3 md:grid-cols-[2fr_auto] md:items-end">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Editing scope
                        </label>
                        <Select
                          value={featureEditorVendorId}
                          onValueChange={setFeatureEditorVendorId}
                          disabled={!vendorRecords.length}
                        >
                          <SelectTrigger className="max-w-xl">
                            <SelectValue placeholder="Select product scope" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={FEATURE_SCOPE_ALL_PRODUCTS}>
                              All products (default options)
                            </SelectItem>
                            {vendorRecords.map((vendor) => (
                              <SelectItem key={vendor.id} value={vendor.id}>
                                {vendor.name}
                                {isAllCatalogScope &&
                                typeof vendor.__teamName === "string" &&
                                vendor.__teamName.trim()
                                  ? ` (${vendor.__teamName})`
                                  : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Scope: {scopedFeatureVendorLabel} · {scopedFeatureOptionCount} option
                        {scopedFeatureOptionCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {featureOptionsByCategory.map(({ group, entries }) => (
                      <div
                        key={`${featureEditorVendorId}-${group.id}`}
                        className="rounded-lg border border-border/70 bg-background/70 p-3"
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {group.label}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {entries.length} option{entries.length === 1 ? "" : "s"}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAddProductFeatureOption(group.id)}
                            disabled={!canEditCatalog}
                          >
                            <Plus className="h-4 w-4" />
                            Add {group.label.toLowerCase()}
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {entries.map(({ option, index }, entryIndex) => (
                            <div
                              key={option.id ?? `feature-option-${group.id}-${index}`}
                              className="relative grid grid-cols-[auto_2fr_0.7fr_auto] items-center gap-2 rounded-lg border border-border/60 px-2 py-2 text-sm"
                              draggable={canEditCatalog}
                              onDragStart={() => {
                                setDragFeatureState({
                                  groupId: group.id,
                                  entryIndex,
                                });
                                setFeatureDropState({
                                  groupId: group.id,
                                  insertionIndex: entryIndex,
                                });
                              }}
                              onDragOver={(event) => {
                                if (!dragFeatureState) return;
                                if (dragFeatureState.groupId !== group.id) return;
                                event.preventDefault();
                                setFeatureDropState({
                                  groupId: group.id,
                                  insertionIndex: getInsertionIndexFromDrag(
                                    event,
                                    entryIndex
                                  ),
                                });
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                handleDropFeatureOption(
                                  group.id,
                                  featureDropState?.groupId === group.id
                                    ? featureDropState.insertionIndex
                                    : getInsertionIndexFromDrag(event, entryIndex),
                                  entries
                                );
                              }}
                              onDragEnd={() => {
                                setDragFeatureState(null);
                                setFeatureDropState(null);
                              }}
                            >
                              {dragFeatureState?.groupId === group.id &&
                              featureDropState?.groupId === group.id &&
                              featureDropState.insertionIndex === entryIndex ? (
                                <div className="pointer-events-none absolute left-2 right-2 top-0 h-0.5 rounded-full bg-accent" />
                              ) : null}
                              {dragFeatureState?.groupId === group.id &&
                              featureDropState?.groupId === group.id &&
                              entryIndex === entries.length - 1 &&
                              featureDropState.insertionIndex === entries.length ? (
                                <div className="pointer-events-none absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-accent" />
                              ) : null}
                              <Checkbox
                                checked={option.isActive}
                                onCheckedChange={(checked) =>
                                  handleProductFeatureOptionChange(index, {
                                    isActive: checked === true,
                                  })
                                }
                                disabled={!canEditCatalog}
                              />
                              <Input
                                uiSize="xs"
                                value={option.label}
                                onChange={(event) =>
                                  handleProductFeatureOptionChange(index, {
                                    label: event.target.value,
                                  })
                                }
                                placeholder={`Add ${group.label.toLowerCase()} option`}
                                disabled={!canEditCatalog}
                              />
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <GripVertical className="h-4 w-4" />
                                <span>{index + 1}</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteProductFeatureOption(option)}
                                disabled={!canEditCatalog || productFeatureOptionSaving}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          {!entries.length ? (
                            <div className="rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                              No options yet for {group.label.toLowerCase()} in this
                              scope.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="accent"
                      size="sm"
                      onClick={handleSaveProductFeatureOptions}
                      disabled={!canEditCatalog || productFeatureOptionSaving}
                    >
                      {productFeatureOptionSaving ? (
                        "Saving..."
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Save feature options
                        </>
                      )}
                    </Button>
                  </div>
                </section>
              </CardContent>
              </Card>
            ) : null}
          </div>
        )}

        {showFooter ? (
          <>
            <Separator className="my-10" />
            <footer className="text-xs text-muted-foreground">
              Admin actions require Convex and Clerk to be configured for your
              organization.
            </footer>
          </>
        ) : null}
      </div>
    </section>
  );
}
