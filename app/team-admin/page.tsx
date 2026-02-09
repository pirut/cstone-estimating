"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { InstantAuthSync } from "@/components/instant-auth-sync";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_UNIT_TYPES, DEFAULT_VENDORS } from "@/lib/catalog-defaults";
import { db, instantAppId } from "@/lib/instant";
import {
  SignInButton,
  clerkEnabled,
  useOptionalAuth,
  useOptionalUser,
} from "@/lib/clerk";
import { id } from "@instantdb/react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

type VendorDraft = {
  id?: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

type UnitTypeDraft = {
  id?: string;
  code: string;
  label: string;
  price: string;
  sortOrder: number;
  isActive: boolean;
};

export default function TeamAdminPage() {
  const { isLoaded: authLoaded, isSignedIn } = useOptionalAuth();
  const { user } = useOptionalUser();
  const { isLoading: instantLoading, user: instantUser, error: instantAuthError } =
    db.useAuth();
  const [instantSetupError, setInstantSetupError] = useState<string | null>(null);
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

  const teamQuery = instantAppId
    ? {
        teams: {
          $: {
            where: { domain: teamLookupDomain },
            order: { createdAt: "desc" as const },
          },
          memberships: { user: {} },
          vendors: {},
          unitTypes: {},
        },
      }
    : { teams: { $: { where: { domain: "__none__" } } } };

  const { data: teamData } = db.useQuery(teamQuery);
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

  const orgMembership = orgTeam?.memberships?.find(
    (membership) => membership.user?.id === instantUser?.id
  );
  const orgRole = String(orgMembership?.role ?? "")
    .trim()
    .toLowerCase();
  const isOrgOwner = Boolean(
    isPrimaryOwner ||
      (orgTeam?.ownerId && orgTeam.ownerId === instantUser?.id) ||
      orgRole === "owner"
  );
  const hasTeamAdminAccess = Boolean(isOrgOwner || orgRole === "admin");

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams]
  );
  const catalogTeam = orgTeam ?? selectedTeam;

  const vendorRecords = useMemo(() => {
    const list = (catalogTeam?.vendors ?? []).slice();
    return list.sort((a, b) => {
      const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 0;
      const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 0;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""));
    });
  }, [catalogTeam?.vendors]);

  const unitTypeRecords = useMemo(() => {
    const list = (catalogTeam?.unitTypes ?? []).slice();
    return list.sort((a, b) => {
      const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 0;
      const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 0;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.code ?? "").localeCompare(String(b.code ?? ""));
    });
  }, [catalogTeam?.unitTypes]);

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
      (memberId && memberId === instantUser?.id) ||
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
    if (!teams.length) {
      setSelectedTeamId(null);
      return;
    }
    if (!selectedTeamId || !teams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(orgTeam?.id ?? teams[0]?.id ?? null);
    }
  }, [orgTeam?.id, selectedTeamId, teams]);

  useEffect(() => {
    setSelectedMemberId(null);
  }, [selectedTeamId]);

  const [teamNameDraft, setTeamNameDraft] = useState("");
  const [teamNameError, setTeamNameError] = useState<string | null>(null);
  const [teamNameSaving, setTeamNameSaving] = useState(false);
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

  useEffect(() => {
    setTeamNameDraft(selectedTeam?.name ?? "");
    setTeamNameError(null);
  }, [selectedTeam?.id, selectedTeam?.name]);

  useEffect(() => {
    const next = vendorRecords.map((vendor, index) => ({
      id: vendor.id,
      name: vendor.name ?? "",
      sortOrder:
        typeof vendor.sortOrder === "number" ? vendor.sortOrder : index + 1,
      isActive: vendor.isActive !== false,
    }));
    setVendorDrafts(next);
  }, [vendorRecords]);

  useEffect(() => {
    const next = unitTypeRecords.map((unit, index) => ({
      id: unit.id,
      code: unit.code ?? "",
      label: unit.label ?? "",
      price:
        typeof unit.price === "number" && Number.isFinite(unit.price)
          ? unit.price.toString()
          : "",
      sortOrder:
        typeof unit.sortOrder === "number" ? unit.sortOrder : index + 1,
      isActive: unit.isActive !== false,
    }));
    setUnitTypeDrafts(next);
  }, [unitTypeRecords]);

  const handleCreateSubTeam = async () => {
    setTeamError(null);
    if (!instantAppId) {
      setTeamError("InstantDB is not configured yet.");
      return;
    }
    if (!instantUser || !orgTeam) {
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
        db.tx.teams[teamId].create({
          name: subTeamName.trim(),
          domain: teamDomain,
          createdAt: now,
          isPrimary: false,
          parentTeamId: orgTeam.id,
          ownerId: instantUser.id,
        }),
        db.tx.memberships[membershipId]
          .create({ role: "owner", createdAt: now })
          .link({ team: teamId, user: instantUser.id }),
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
      await db.transact(db.tx.teams[selectedTeam.id].update({ name: trimmed }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setTeamNameError(message);
    } finally {
      setTeamNameSaving(false);
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
      await db.transact(db.tx.teams[selectedTeam.id].delete());
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
    if (!instantUser || !selectedTeam || !selectedMemberId) return;
    const now = Date.now();
    const membershipId = id();
    setMemberActionLoading(true);
    try {
      await db.transact(
        db.tx.memberships[membershipId]
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
      await db.transact(db.tx.memberships[membershipId].delete());
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
      db.tx.memberships[membershipId].update({ role: "owner" }),
      ...(previousOwner && previousOwner.id !== membershipId
        ? [db.tx.memberships[previousOwner.id].update({ role: "member" })]
        : []),
      db.tx.teams[selectedTeam.id].update({ ownerId: memberId }),
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

  const canEditCatalog = Boolean(hasTeamAdminAccess && catalogTeam);

  const handleVendorChange = (index: number, patch: Partial<VendorDraft>) => {
    setVendorDrafts((prev) =>
      prev.map((vendor, idx) =>
        idx === index ? { ...vendor, ...patch } : vendor
      )
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
      { name: "", sortOrder: nextOrder, isActive: true },
    ]);
  };

  const handleSaveVendors = async () => {
    setVendorError(null);
    setVendorStatus(null);
    if (!catalogTeam) {
      setVendorError("Select an organization team before editing vendors.");
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
        updatedAt: now,
      };
      if (vendor.id) {
        return db.tx.vendors[vendor.id].update(payload);
      }
      const vendorId = id();
      return db.tx.vendors[vendorId]
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
      await db.transact(db.tx.vendors[vendor.id].delete());
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
      setVendorError("Select an organization team before seeding vendors.");
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
      return db.tx.vendors[vendorId]
        .create({
          name: vendor.name,
          sortOrder: vendor.sortOrder,
          isActive: vendor.isActive,
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
        sortOrder: nextOrder,
        isActive: true,
      },
    ]);
  };

  const handleSaveUnitTypes = async () => {
    setUnitTypeError(null);
    setUnitTypeStatus(null);
    if (!catalogTeam) {
      setUnitTypeError("Select an organization team before editing unit types.");
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
    }

    const now = Date.now();
    const txs = cleaned.map((unit, index) => {
      const priceValue = Number(unit.price);
      const payload = {
        code: unit.code,
        label: unit.label,
        price: priceValue,
        sortOrder: unit.sortOrder || index + 1,
        isActive: unit.isActive,
        updatedAt: now,
      };
      if (unit.id) {
        return db.tx.unitTypes[unit.id].update(payload);
      }
      const unitId = id();
      return db.tx.unitTypes[unitId]
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
      await db.transact(db.tx.unitTypes[unit.id].delete());
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
      setUnitTypeError("Select an organization team before seeding unit types.");
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
      return db.tx.unitTypes[unitId]
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

  const renderAuthGate = () => {
    if (!clerkEnabled) {
      return (
        <Card className="border-border/60 bg-card/80 shadow-elevated">
          <CardHeader>
            <CardTitle className="text-2xl font-serif">
              Clerk not configured
            </CardTitle>
            <CardDescription>
              Add the Clerk publishable key to enable team admin access.
            </CardDescription>
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
            <CardDescription>
              Only organization owners and admins can manage teams and members.
            </CardDescription>
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

  const authGate = renderAuthGate();

  return (
    <main className="min-h-screen bg-background">
      <InstantAuthSync onAuthError={setInstantSetupError} />
      <div className="container py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-serif">Team Admin</h1>
            <p className="text-sm text-muted-foreground">
              Manage organization teams and memberships.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back to workspace</Link>
          </Button>
        </div>

        {instantSetupError ? (
          <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            Instant auth issue: {instantSetupError}
          </div>
        ) : null}

        {instantAuthError ? (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {instantAuthError.message}
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
              <CardDescription>
                Ask your organization owner to grant owner/admin access.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                Signed in as {user?.primaryEmailAddress?.emailAddress}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Organization overview
                </CardTitle>
                <CardDescription>
                  Primary workspace for {teamDomain || "your domain"}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {instantLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connecting to InstantDB...
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
                        Teams: {teams.length}
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
                <CardDescription>
                  Add a focused team within your organization.
                </CardDescription>
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

            <Card className="border-border/60 bg-card/80 shadow-elevated lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">Teams</CardTitle>
                <CardDescription>
                  Select a team to manage its members.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-[0.6fr_0.4fr]">
                <ScrollArea className="h-72 rounded-lg border border-border/70 bg-background/70">
                  <div className="divide-y divide-border/60">
                    {teams.map((team) => {
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

            <Card className="border-border/60 bg-card/80 shadow-elevated lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Team members
                </CardTitle>
                <CardDescription>
                  Manage roles and access for the selected team.
                </CardDescription>
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
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/80 shadow-elevated lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Catalog settings
                </CardTitle>
                <CardDescription>
                  Manage the vendor list and unit type pricing used in estimates.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                {!catalogTeam ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                    Select or create the organization workspace to edit catalog
                    settings.
                  </div>
                ) : null}
                {!hasTeamAdminAccess ? (
                  <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    Only organization owners and admins can edit vendors and unit
                    types.
                  </div>
                ) : null}

                <section className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Vendors</p>
                    <p className="text-xs text-muted-foreground">
                      Controls the product type dropdown in the estimate builder.
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
                    <div className="min-w-[640px]">
                      <div className="grid grid-cols-[auto_2fr_1fr_auto] gap-2 border-b border-border/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                        <span>Active</span>
                        <span>Name</span>
                        <span>Order</span>
                        <span></span>
                      </div>
                      <div className="divide-y divide-border/60">
                        {vendorDrafts.map((vendor, index) => (
                          <div
                            key={vendor.id ?? `vendor-${index}`}
                            className="grid grid-cols-[auto_2fr_1fr_auto] items-center gap-2 px-3 py-2 text-sm"
                          >
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
                            <Input
                              uiSize="xs"
                              className="w-24"
                              type="number"
                              value={vendor.sortOrder}
                              onChange={(event) =>
                                handleVendorChange(index, {
                                  sortOrder: Number(event.target.value || 0),
                                })
                              }
                              disabled={!canEditCatalog}
                            />
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
                      Unit types
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Drives bucking line items and the install calculator.
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
                    <div className="min-w-[760px]">
                      <div className="grid grid-cols-[auto_1fr_1.6fr_1fr_0.6fr_auto] gap-2 border-b border-border/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                        <span>Active</span>
                        <span>Code</span>
                        <span>Label</span>
                        <span>Price</span>
                        <span>Order</span>
                        <span></span>
                      </div>
                      <div className="divide-y divide-border/60">
                        {unitTypeDrafts.map((unit, index) => (
                          <div
                            key={unit.id ?? `unit-${index}`}
                            className="grid grid-cols-[auto_1fr_1.6fr_1fr_0.6fr_auto] items-center gap-2 px-3 py-2 text-sm"
                          >
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
                            <Input
                              uiSize="xs"
                              className="w-20"
                              type="number"
                              value={unit.sortOrder}
                              onChange={(event) =>
                                handleUnitTypeChange(index, {
                                  sortOrder: Number(event.target.value || 0),
                                })
                              }
                              disabled={!canEditCatalog}
                            />
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
              </CardContent>
            </Card>
          </div>
        )}

        <Separator className="my-10" />

        <footer className="text-xs text-muted-foreground">
          Admin actions require InstantDB and Clerk to be configured for your
          organization.
        </footer>
      </div>
    </main>
  );
}
