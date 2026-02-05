const allowedDomain =
  process.env.INSTANT_ALLOWED_EMAIL_DOMAIN ??
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ??
  "cornerstonecompaniesfl.com";
const normalizedAllowedDomain = allowedDomain.trim().toLowerCase();
const isDomainUser = normalizedAllowedDomain
  ? `auth.id != null && (auth.email == null || auth.email.endsWith('@${normalizedAllowedDomain}'))`
  : "auth.id != null";
const isTeammate = "auth.id in data.ref('memberships.team.memberships.user.id')";

const perms = {
  $users: {
    allow: {
      view: isTeammate,
      update: "auth.id == data.id",
    },
  },
  teams: {
    bind: {
      isDomainUser,
      isMember: "auth.id in data.ref('memberships.user.id')",
      isOwner: "auth.id == data.ownerId",
    },
    allow: {
      view: "isDomainUser || isMember",
      create: "isDomainUser",
      update: "isMember",
      delete: "isOwner",
    },
  },
  memberships: {
    bind: {
      isDomainUser,
      isSelf: "auth.id in data.ref('user.id')",
      isTeamMember: "auth.id in data.ref('team.memberships.user.id')",
      isTeamOwner: "auth.id in data.ref('team.ownerId')",
      isOrgTeam: "true in data.ref('team.isPrimary')",
    },
    allow: {
      view: "isDomainUser && isTeamMember",
      create: "isDomainUser",
      update: "isDomainUser && isTeamOwner",
      delete: "isDomainUser && (isSelf || isTeamOwner)",
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
