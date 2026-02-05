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
    },
    allow: {
      view: "isDomainUser || isMember",
      create: "isDomainUser",
      update: "isOwner || isPrimaryOwner",
      delete: "isOwner || isPrimaryOwner",
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
    },
    allow: {
      view: "isDomainUser",
      create: "isDomainUser",
      update: "isDomainUser && (isTeamOwner || isPrimaryOwner)",
      delete: "isDomainUser && (isSelf || isTeamOwner || isPrimaryOwner)",
    },
  },
  estimates: {
    bind: {
      isTeamMember: "auth.id in data.ref('team.memberships.user.id')",
    },
    allow: {
      view: "isTeamMember",
      create: "isTeamMember",
      update: "isTeamMember",
      delete: "isTeamMember",
    },
  },
};

export default perms;
