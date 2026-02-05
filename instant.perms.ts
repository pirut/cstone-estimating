const allowedDomain = "cornerstonecompaniesfl.com";
const isDomainUser = `auth.email != null && auth.email.endsWith('@${allowedDomain}')`;
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
      create: "isDomainUser && (data.isPrimary == true || auth.id == data.ownerId)",
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
      create: "isDomainUser && (isSelf || isTeamOwner || isOrgTeam)",
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
