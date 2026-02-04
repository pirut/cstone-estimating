const allowedDomain = "cornerstonecompaniesfl.com";
const isDomainUser = `auth.email != null && auth.email.endsWith('@${allowedDomain}')`;

const perms = {
  teams: {
    bind: {
      isDomainUser,
      isMember: "auth.id in data.ref('memberships.user.id')",
    },
    allow: {
      view: "isDomainUser || isMember",
      create: "isDomainUser",
      update: "isMember",
      delete: "isMember",
    },
  },
  memberships: {
    bind: {
      isDomainUser,
      isSelf: "auth.id in data.ref('user.id')",
      isTeamMember: "auth.id in data.ref('team.memberships.user.id')",
    },
    allow: {
      view: "isDomainUser && isTeamMember",
      create: "isDomainUser && isSelf",
      update: "isDomainUser && isTeamMember",
      delete: "isDomainUser && isTeamMember",
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
