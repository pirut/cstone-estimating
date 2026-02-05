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
import { Separator } from "@/components/ui/separator";
import { db, instantAppId } from "@/lib/instant";
import {
  SignInButton,
  clerkEnabled,
  useOptionalAuth,
  useOptionalUser,
} from "@/lib/clerk";
import { id } from "@instantdb/react";
import { Loader2 } from "lucide-react";

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
  const isOrgOwner = Boolean(
    isPrimaryOwner ||
      (orgTeam?.ownerId && orgTeam.ownerId === instantUser?.id) ||
      orgMembership?.role === "owner"
  );

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams]
  );

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

  useEffect(() => {
    setTeamNameDraft(selectedTeam?.name ?? "");
    setTeamNameError(null);
  }, [selectedTeam?.id, selectedTeam?.name]);

  const handleCreateSubTeam = async () => {
    setTeamError(null);
    if (!instantAppId) {
      setTeamError("InstantDB is not configured yet.");
      return;
    }
    if (!instantUser || !orgTeam) {
      setTeamError("Sign in with an org owner account.");
      return;
    }
    if (!isOrgOwner) {
      setTeamError("Only org owners can create sub teams.");
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
              Only organization owners can manage teams and members.
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
        ) : !isOrgOwner ? (
          <Card className="border-border/60 bg-card/80 shadow-elevated">
            <CardHeader>
              <CardTitle className="text-2xl font-serif">
                Owner access only
              </CardTitle>
              <CardDescription>
                Ask your organization owner to grant access to team management.
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
                  <input
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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
                    {!isOrgOwner ? (
                      <p className="text-xs text-muted-foreground">
                        Only the org owner can assign members to sub teams.
                      </p>
                    ) : null}
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={selectedMemberId ?? ""}
                      onChange={(event) =>
                        setSelectedMemberId(event.target.value || null)
                      }
                      disabled={!availableOrgMembers.length || !isOrgOwner}
                    >
                      <option value="">Select member</option>
                      {availableOrgMembers.map((member) => (
                        <option key={member.id} value={member.user?.id ?? ""}>
                          {getMemberProfile(member).name}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      onClick={handleAddMember}
                      disabled={
                        !selectedMemberId ||
                        memberActionLoading ||
                        !selectedTeam ||
                        !isOrgOwner
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
                        <input
                          className="min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                          value={teamNameDraft}
                          onChange={(event) => setTeamNameDraft(event.target.value)}
                          disabled={!isOrgOwner}
                        />
                        <Button
                          variant="outline"
                          onClick={handleRenameTeam}
                          disabled={
                            !isOrgOwner ||
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
                        Only org owners can rename or delete teams.
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
                                  disabled={memberActionLoading || isOwner || !isOrgOwner}
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
