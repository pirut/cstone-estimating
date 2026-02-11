const allowedDomain =
  process.env.INSTANT_ALLOWED_EMAIL_DOMAIN ??
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ??
  "cornerstonecompaniesfl.com";
const normalizedAllowedDomain = allowedDomain.trim().toLowerCase();
const primaryOwnerEmail =
  process.env.INSTANT_PRIMARY_OWNER_EMAIL ??
  process.env.NEXT_PUBLIC_PRIMARY_OWNER_EMAIL ??
  "jr@cornerstonecompaniesfl.com";
const normalizedPrimaryOwnerEmail = primaryOwnerEmail.trim().toLowerCase();
const isDomainUser = normalizedAllowedDomain
  ? `auth.id != null && (auth.email == null || auth.email.endsWith('@${normalizedAllowedDomain}'))`
  : "auth.id != null";
const isPrimaryOwner = normalizedPrimaryOwnerEmail
  ? `auth.email != null && auth.email == '${normalizedPrimaryOwnerEmail}'`
  : "false";
const isTeammate = "auth.id in data.ref('memberships.team.memberships.user.id')";
const isTeamMember = "auth.id in data.ref('team.memberships.user.id')";
const isTeamOwner = "auth.id == data.ref('team.ownerId')";
const isWorkspaceAdmin =
  "('owner' in auth.ref('$user.memberships.role')) || ('admin' in auth.ref('$user.memberships.role'))";

const perms = {
  $users: {
    allow: {
      view: `auth.id == data.id || ${isTeammate} || ${isDomainUser}`,
      update: "auth.id == data.id",
    },
  },
  teams: {
    bind: {
      isDomainUser,
      isMember: "auth.id in data.ref('memberships.user.id')",
      isOwner: "auth.id == data.ownerId",
      isPrimaryOwner,
      isWorkspaceAdmin,
    },
    allow: {
      view: "isDomainUser || isMember",
      create:
        "isPrimaryOwner || (isDomainUser && data.isPrimary == true) || (isWorkspaceAdmin && data.parentTeamId != null)",
      update: "isWorkspaceAdmin || isPrimaryOwner",
      delete: "(isWorkspaceAdmin || isPrimaryOwner) && data.isPrimary != true",
    },
  },
  memberships: {
    bind: {
      isDomainUser,
      isSelf: "auth.id in data.ref('user.id')",
      isTeamMember: "auth.id in data.ref('team.memberships.user.id')",
      isTeamOwner: "auth.id in data.ref('team.ownerId')",
      isPrimaryOwner,
      isOrgTeam: "true in data.ref('team.isPrimary')",
      isWorkspaceAdmin,
    },
    allow: {
      view: "isDomainUser",
      create: "isDomainUser",
      update: "isDomainUser && (isWorkspaceAdmin || isPrimaryOwner)",
      delete: "isDomainUser && (isSelf || isWorkspaceAdmin || isPrimaryOwner)",
    },
  },
  estimates: {
    bind: {
      isTeamMember,
      isTeamOwner,
      isPrimaryOwner,
      isWorkspaceAdmin,
    },
    allow: {
      view: "isTeamMember || isWorkspaceAdmin || isTeamOwner || isPrimaryOwner",
      create: "isTeamMember",
      update: "isTeamMember || isWorkspaceAdmin || isTeamOwner || isPrimaryOwner",
      delete: "isTeamMember || isWorkspaceAdmin || isTeamOwner || isPrimaryOwner",
    },
  },
  vendors: {
    bind: {
      isTeamMember,
      isTeamOwner,
      isPrimaryOwner,
      isWorkspaceAdmin,
    },
    allow: {
      view: "isTeamMember",
      create: "isWorkspaceAdmin || isTeamOwner || isPrimaryOwner",
      update: "isWorkspaceAdmin || isTeamOwner || isPrimaryOwner",
      delete: "isWorkspaceAdmin || isTeamOwner || isPrimaryOwner",
    },
  },
  unitTypes: {
    bind: {
      isTeamMember,
      isTeamOwner,
      isPrimaryOwner,
      isWorkspaceAdmin,
    },
    allow: {
      view: "isTeamMember",
      create: "isWorkspaceAdmin || isTeamOwner || isPrimaryOwner",
      update: "isWorkspaceAdmin || isTeamOwner || isPrimaryOwner",
      delete: "isWorkspaceAdmin || isTeamOwner || isPrimaryOwner",
    },
  },
};

export default perms;
