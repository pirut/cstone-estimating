import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
      name: i.string().optional(),
      imageUrl: i.string().optional(),
    }),
    teams: i.entity({
      name: i.string(),
      domain: i.string().indexed(),
      createdAt: i.number().indexed(),
      isPrimary: i.boolean().indexed().optional(),
      parentTeamId: i.string().indexed().optional(),
      ownerId: i.string().indexed().optional(),
    }),
    memberships: i.entity({
      role: i.string(),
      createdAt: i.number(),
    }),
    estimates: i.entity({
      title: i.string().indexed(),
      status: i.string().indexed().optional(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().indexed(),
      version: i.number().indexed().optional(),
      lastGeneratedAt: i.number().indexed().optional(),
      templateName: i.string().optional(),
      templateUrl: i.string().optional(),
      payload: i.json(),
      totals: i.json().optional(),
      versionHistory: i.json().optional(),
    }),
    vendors: i.entity({
      name: i.string(),
      sortOrder: i.number().indexed().optional(),
      isActive: i.boolean().indexed().optional(),
      allowsSplitFinish: i.boolean().indexed().optional(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().indexed().optional(),
    }),
    productFeatureOptions: i.entity({
      category: i.string().indexed(),
      label: i.string(),
      vendorId: i.string().indexed().optional(),
      sortOrder: i.number().indexed().optional(),
      isActive: i.boolean().indexed().optional(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().indexed().optional(),
    }),
    unitTypes: i.entity({
      code: i.string().indexed(),
      label: i.string(),
      price: i.number(),
      sortOrder: i.number().indexed().optional(),
      isActive: i.boolean().indexed().optional(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().indexed().optional(),
    }),
  },
  links: {
    teamMembers: {
      forward: {
        on: "memberships",
        has: "one",
        label: "team",
        onDelete: "cascade",
      },
      reverse: {
        on: "teams",
        has: "many",
        label: "memberships",
      },
    },
    memberUser: {
      forward: {
        on: "memberships",
        has: "one",
        label: "user",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "memberships",
      },
    },
    estimateTeam: {
      forward: {
        on: "estimates",
        has: "one",
        label: "team",
        onDelete: "cascade",
      },
      reverse: {
        on: "teams",
        has: "many",
        label: "estimates",
      },
    },
    estimateOwner: {
      forward: {
        on: "estimates",
        has: "one",
        label: "owner",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "estimates",
      },
    },
    vendorTeam: {
      forward: {
        on: "vendors",
        has: "one",
        label: "team",
        onDelete: "cascade",
      },
      reverse: {
        on: "teams",
        has: "many",
        label: "vendors",
      },
    },
    productFeatureOptionTeam: {
      forward: {
        on: "productFeatureOptions",
        has: "one",
        label: "team",
        onDelete: "cascade",
      },
      reverse: {
        on: "teams",
        has: "many",
        label: "productFeatureOptions",
      },
    },
    unitTypeTeam: {
      forward: {
        on: "unitTypes",
        has: "one",
        label: "team",
        onDelete: "cascade",
      },
      reverse: {
        on: "teams",
        has: "many",
        label: "unitTypes",
      },
    },
  },
});

type _AppSchema = typeof _schema;
export interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export default schema;
