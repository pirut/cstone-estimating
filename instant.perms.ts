const perms = {
  teams: {
    allow: {
      view: "auth.id != null",
      create: "auth.id != null",
      update: "auth.id in data.ref('memberships.user.id')",
      delete: "auth.id in data.ref('memberships.user.id')",
    },
  },
  memberships: {
    allow: {
      view: "auth.id in data.ref('team.memberships.user.id')",
      create: "auth.id != null",
      update: "auth.id in data.ref('team.memberships.user.id')",
      delete: "auth.id in data.ref('team.memberships.user.id')",
    },
  },
  estimates: {
    allow: {
      view: "auth.id in data.ref('team.memberships.user.id')",
      create: "auth.id in data.ref('team.memberships.user.id')",
      update: "auth.id in data.ref('team.memberships.user.id')",
      delete: "auth.id in data.ref('team.memberships.user.id')",
    },
  },
};

export default perms;
