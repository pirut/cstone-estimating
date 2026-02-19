type TeamLike = {
  id: string;
  name?: string | null;
  parentTeamId?: string | null;
  isPrimary?: boolean | null;
  createdAt?: number | null;
};

type CatalogTeamLike = TeamLike & {
  vendors?: unknown[] | null;
  unitTypes?: unknown[] | null;
  productFeatureOptions?: unknown[] | null;
};

export function pickOrganizationTeam<T extends TeamLike>(
  teams: T[],
  preferredOrgName?: string
): T | null {
  if (!teams.length) return null;

  const roots = teams.filter((team) => !team.parentTeamId);
  const candidates = roots.length ? roots : teams;
  const normalizedPreferred = String(preferredOrgName ?? "")
    .trim()
    .toLowerCase();

  if (normalizedPreferred) {
    const named = candidates.find(
      (team) => String(team.name ?? "").trim().toLowerCase() === normalizedPreferred
    );
    if (named) return named;
  }

  const primary = candidates.find((team) => team.isPrimary === true);
  if (primary) return primary;

  return candidates.reduce((oldest, team) => {
    if (!oldest) return team;
    const oldestCreated = typeof oldest.createdAt === "number" ? oldest.createdAt : 0;
    const teamCreated = typeof team.createdAt === "number" ? team.createdAt : 0;
    return teamCreated < oldestCreated ? team : oldest;
  }, null as T | null);
}

export function getOrganizationScopedTeams<T extends TeamLike>(
  teams: T[],
  orgTeamId?: string | null
): T[] {
  if (!teams.length) return [];
  if (!orgTeamId) return teams.slice();

  const org = teams.find((team) => team.id === orgTeamId) ?? null;
  const children = teams.filter((team) => team.parentTeamId === orgTeamId);
  if (!org) return children;
  return [org, ...children];
}

export function getCatalogItemCount<T extends CatalogTeamLike>(team?: T | null) {
  if (!team) return 0;
  const vendors = Array.isArray(team.vendors) ? team.vendors.length : 0;
  const unitTypes = Array.isArray(team.unitTypes) ? team.unitTypes.length : 0;
  const options = Array.isArray(team.productFeatureOptions)
    ? team.productFeatureOptions.length
    : 0;
  return vendors + unitTypes + options;
}

export function hasCatalogData<T extends CatalogTeamLike>(team?: T | null) {
  return getCatalogItemCount(team) > 0;
}
