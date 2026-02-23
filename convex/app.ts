import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, TableNames } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type TeamGraphDoc = {
  id: string;
  name: string;
  domain: string;
  createdAt: number;
  isPrimary?: boolean;
  parentTeamId?: string;
  ownerId?: string;
  memberships: Array<MembershipGraphDoc>;
  estimates: Array<EstimateGraphDoc>;
  projects: Array<ProjectGraphDoc>;
  vendors: Array<VendorGraphDoc>;
  unitTypes: Array<UnitTypeGraphDoc>;
  productFeatureOptions: Array<ProductFeatureOptionGraphDoc>;
};

type UserGraphDoc = {
  id: string;
  email?: string;
  name?: string;
  imageUrl?: string;
};

type MembershipGraphDoc = {
  id: string;
  role: string;
  createdAt: number;
  user: UserGraphDoc | null;
};

type ProjectGraphReferenceDoc = {
  id: string;
  name: string;
  description?: string;
  status?: string;
  createdAt: number;
  updatedAt: number;
  owner: UserGraphDoc | null;
};

type EstimateGraphDoc = {
  id: string;
  title: string;
  status?: string;
  createdAt: number;
  updatedAt: number;
  version?: number;
  lastGeneratedAt?: number;
  templateName?: string;
  templateUrl?: string;
  payload: any;
  totals?: any;
  tags?: any;
  versionHistory?: any;
  owner: UserGraphDoc | null;
  project: ProjectGraphReferenceDoc | null;
};

type ProjectGraphDoc = {
  id: string;
  name: string;
  description?: string;
  status?: string;
  createdAt: number;
  updatedAt: number;
  owner: UserGraphDoc | null;
  estimates: Array<EstimateGraphDoc>;
};

type VendorGraphDoc = {
  id: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
  allowsSplitFinish?: boolean;
  usesEuroPricing?: boolean;
  createdAt: number;
  updatedAt?: number;
};

type UnitTypeGraphDoc = {
  id: string;
  code: string;
  label: string;
  price: number;
  sortOrder?: number;
  isActive?: boolean;
  createdAt: number;
  updatedAt?: number;
};

type ProductFeatureOptionGraphDoc = {
  id: string;
  category: string;
  label: string;
  vendorId?: string;
  sortOrder?: number;
  isActive?: boolean;
  createdAt: number;
  updatedAt?: number;
};

type TxOperation = {
  table:
    | "$users"
    | "teams"
    | "memberships"
    | "estimates"
    | "projects"
    | "vendors"
    | "unitTypes"
    | "productFeatureOptions";
  id: string;
  operation: "create" | "update" | "delete";
  data?: any;
  links?: any;
};

type CompatTable = Exclude<TxOperation["table"], "$users"> | "users";
type Ctx = QueryCtx | MutationCtx;

const txOperationValidator = v.object({
  table: v.union(
    v.literal("$users"),
    v.literal("teams"),
    v.literal("memberships"),
    v.literal("estimates"),
    v.literal("projects"),
    v.literal("vendors"),
    v.literal("unitTypes"),
    v.literal("productFeatureOptions")
  ),
  id: v.string(),
  operation: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
  data: v.optional(v.any()),
  links: v.optional(v.any()),
});

const importTableValidator = v.union(
  v.literal("users"),
  v.literal("teams"),
  v.literal("memberships"),
  v.literal("estimates"),
  v.literal("projects"),
  v.literal("vendors"),
  v.literal("unitTypes"),
  v.literal("productFeatureOptions")
);

function toPublicDoc<T extends { _id: unknown; _creationTime: number }>(doc: T) {
  const { _id, _creationTime, ...rest } = doc;
  return rest;
}

function sanitizeValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (value && typeof value === "object") {
    const result: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      result[key] = sanitizeValue(entry);
    }
    return result;
  }
  return value;
}

function assertObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return sanitizeValue(value) as Record<string, any>;
}

function resolveCompatTable(table: TxOperation["table"]): CompatTable {
  if (table === "$users") return "users";
  return table;
}

async function getByCustomId(ctx: Ctx, table: CompatTable, id: string) {
  switch (table) {
    case "users":
      return await ctx.db.query("users").withIndex("by_custom_id", (q) => q.eq("id", id)).unique();
    case "teams":
      return await ctx.db.query("teams").withIndex("by_custom_id", (q) => q.eq("id", id)).unique();
    case "memberships":
      return await ctx.db
        .query("memberships")
        .withIndex("by_custom_id", (q) => q.eq("id", id))
        .unique();
    case "estimates":
      return await ctx.db.query("estimates").withIndex("by_custom_id", (q) => q.eq("id", id)).unique();
    case "projects":
      return await ctx.db.query("projects").withIndex("by_custom_id", (q) => q.eq("id", id)).unique();
    case "vendors":
      return await ctx.db.query("vendors").withIndex("by_custom_id", (q) => q.eq("id", id)).unique();
    case "unitTypes":
      return await ctx.db.query("unitTypes").withIndex("by_custom_id", (q) => q.eq("id", id)).unique();
    case "productFeatureOptions":
      return await ctx.db
        .query("productFeatureOptions")
        .withIndex("by_custom_id", (q) => q.eq("id", id))
        .unique();
    default:
      return null;
  }
}

function applyLinkPayload(table: CompatTable, base: Record<string, any>, linksValue: unknown) {
  const links = assertObject(linksValue);
  if (table === "memberships") {
    if (typeof links.team === "string") {
      base.teamId = links.team;
    }
    if (typeof links.user === "string") {
      base.userId = links.user;
    }
    return;
  }
  if (table === "estimates") {
    if (typeof links.team === "string") {
      base.teamId = links.team;
    }
    if (typeof links.owner === "string") {
      base.ownerId = links.owner;
    }
    if (typeof links.project === "string") {
      base.projectId = links.project;
    }
    return;
  }
  if (table === "projects") {
    if (typeof links.team === "string") {
      base.teamId = links.team;
    }
    if (typeof links.owner === "string") {
      base.ownerId = links.owner;
    }
    return;
  }
  if (
    table === "vendors" ||
    table === "unitTypes" ||
    table === "productFeatureOptions"
  ) {
    if (typeof links.team === "string") {
      base.teamId = links.team;
    }
  }
}

async function deleteTeamCascade(ctx: MutationCtx, teamDoc: Doc<"teams">) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_teamId", (q) => q.eq("teamId", teamDoc.id))
    .collect();
  for (const membership of memberships) {
    await ctx.db.delete(membership._id);
  }

  const estimates = await ctx.db
    .query("estimates")
    .withIndex("by_teamId", (q) => q.eq("teamId", teamDoc.id))
    .collect();
  for (const estimate of estimates) {
    await ctx.db.delete(estimate._id);
  }

  const projects = await ctx.db
    .query("projects")
    .withIndex("by_teamId", (q) => q.eq("teamId", teamDoc.id))
    .collect();
  for (const project of projects) {
    await ctx.db.delete(project._id);
  }

  const vendors = await ctx.db
    .query("vendors")
    .withIndex("by_teamId", (q) => q.eq("teamId", teamDoc.id))
    .collect();
  for (const vendor of vendors) {
    await ctx.db.delete(vendor._id);
  }

  const unitTypes = await ctx.db
    .query("unitTypes")
    .withIndex("by_teamId", (q) => q.eq("teamId", teamDoc.id))
    .collect();
  for (const unitType of unitTypes) {
    await ctx.db.delete(unitType._id);
  }

  const productFeatureOptions = await ctx.db
    .query("productFeatureOptions")
    .withIndex("by_teamId", (q) => q.eq("teamId", teamDoc.id))
    .collect();
  for (const productFeatureOption of productFeatureOptions) {
    await ctx.db.delete(productFeatureOption._id);
  }

  await ctx.db.delete(teamDoc._id);
}

async function deleteProjectCascade(ctx: MutationCtx, projectDoc: Doc<"projects">) {
  const estimates = await ctx.db
    .query("estimates")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectDoc.id))
    .collect();
  for (const estimate of estimates) {
    await ctx.db.patch(estimate._id, {
      updatedAt: Date.now(),
    });
  }
  await ctx.db.delete(projectDoc._id);
}

async function upsertUserDoc(
  ctx: MutationCtx,
  args: { id: string; email?: string; name?: string; imageUrl?: string }
) {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_custom_id", (q) => q.eq("id", args.id))
    .unique();
  const payload = assertObject({
    email: args.email,
    name: args.name,
    imageUrl: args.imageUrl,
  });
  const now = Date.now();

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...payload,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("users", {
      id: args.id,
      ...payload,
      createdAt: now,
      updatedAt: now,
    });
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_custom_id", (q) => q.eq("id", args.id))
    .unique();
  return user ? toPublicDoc(user) : null;
}

export const teamGraphByDomain = query({
  args: { domain: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const domain = String(args.domain ?? "").trim().toLowerCase();
    if (!domain || domain === "__none__") {
      return [];
    }

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_domain_and_createdAt", (q) => q.eq("domain", domain))
      .order("desc")
      .collect();

    if (!teams.length) return [];

    const teamIds = new Set<string>();
    const userIds = new Set<string>();
    const memberships: Array<Doc<"memberships">> = [];
    const estimates: Array<Doc<"estimates">> = [];
    const projects: Array<Doc<"projects">> = [];
    const vendors: Array<Doc<"vendors">> = [];
    const unitTypes: Array<Doc<"unitTypes">> = [];
    const productFeatureOptions: Array<Doc<"productFeatureOptions">> = [];

    for (const team of teams) {
      teamIds.add(team.id);
      if (typeof team.ownerId === "string" && team.ownerId) {
        userIds.add(team.ownerId);
      }

      const teamMemberships = await ctx.db
        .query("memberships")
        .withIndex("by_teamId", (q) => q.eq("teamId", team.id))
        .collect();
      teamMemberships.forEach((membership) => {
        memberships.push(membership);
        if (membership.userId) {
          userIds.add(membership.userId);
        }
      });

      const teamEstimates = await ctx.db
        .query("estimates")
        .withIndex("by_teamId", (q) => q.eq("teamId", team.id))
        .collect();
      teamEstimates.forEach((estimate) => {
        estimates.push(estimate);
        if (estimate.ownerId) {
          userIds.add(estimate.ownerId);
        }
      });

      const teamProjects = await ctx.db
        .query("projects")
        .withIndex("by_teamId", (q) => q.eq("teamId", team.id))
        .collect();
      teamProjects.forEach((project) => {
        projects.push(project);
        if (project.ownerId) {
          userIds.add(project.ownerId);
        }
      });

      const teamVendors = await ctx.db
        .query("vendors")
        .withIndex("by_teamId", (q) => q.eq("teamId", team.id))
        .collect();
      teamVendors.forEach((vendor) => vendors.push(vendor));

      const teamUnitTypes = await ctx.db
        .query("unitTypes")
        .withIndex("by_teamId", (q) => q.eq("teamId", team.id))
        .collect();
      teamUnitTypes.forEach((unitType) => unitTypes.push(unitType));

      const teamProductFeatureOptions = await ctx.db
        .query("productFeatureOptions")
        .withIndex("by_teamId", (q) => q.eq("teamId", team.id))
        .collect();
      teamProductFeatureOptions.forEach((option) => productFeatureOptions.push(option));
    }

    const userMap = new Map<string, UserGraphDoc>();
    for (const userId of userIds) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_custom_id", (q) => q.eq("id", userId))
        .unique();
      if (!user) continue;
      userMap.set(userId, toPublicDoc(user));
    }

    const projectReferenceMap = new Map<string, ProjectGraphReferenceDoc>();
    const projectMap = new Map<string, ProjectGraphDoc>();
    for (const project of projects) {
      const publicProject = toPublicDoc(project);
      const projectReference: ProjectGraphReferenceDoc = {
        ...(publicProject as Omit<ProjectGraphReferenceDoc, "owner">),
        owner: project.ownerId ? (userMap.get(project.ownerId) ?? null) : null,
      };
      projectReferenceMap.set(project.id, projectReference);
      projectMap.set(project.id, {
        ...projectReference,
        estimates: [],
      });
    }

    const estimateMap = new Map<string, EstimateGraphDoc>();
    for (const estimate of estimates) {
      const publicEstimate = toPublicDoc(estimate);
      const estimateEntry: EstimateGraphDoc = {
        ...(publicEstimate as Omit<EstimateGraphDoc, "owner" | "project">),
        owner: estimate.ownerId ? (userMap.get(estimate.ownerId) ?? null) : null,
        project: estimate.projectId ? (projectReferenceMap.get(estimate.projectId) ?? null) : null,
      };
      estimateMap.set(estimate.id, estimateEntry);
    }

    for (const estimate of estimates) {
      if (!estimate.projectId) continue;
      const project = projectMap.get(estimate.projectId);
      const estimateEntry = estimateMap.get(estimate.id);
      if (!project || !estimateEntry) continue;
      project.estimates.push(estimateEntry);
    }

    const teamGraph: Array<TeamGraphDoc> = teams.map((team) => {
      const teamMemberships = memberships
        .filter((membership) => membership.teamId === team.id)
        .map((membership) => {
          const publicMembership = toPublicDoc(membership);
          return {
            ...(publicMembership as Omit<MembershipGraphDoc, "user">),
            user: membership.userId ? (userMap.get(membership.userId) ?? null) : null,
          };
        });

      const teamEstimates = estimates
        .filter((estimate) => estimate.teamId === team.id)
        .map((estimate) => estimateMap.get(estimate.id))
        .filter((estimate): estimate is EstimateGraphDoc => Boolean(estimate));

      const teamProjects = projects
        .filter((project) => project.teamId === team.id)
        .map((project) => projectMap.get(project.id))
        .filter((project): project is ProjectGraphDoc => Boolean(project));

      const teamVendors = vendors
        .filter((vendor) => vendor.teamId === team.id)
        .map((vendor) => toPublicDoc(vendor) as VendorGraphDoc);

      const teamUnitTypes = unitTypes
        .filter((unitType) => unitType.teamId === team.id)
        .map((unitType) => toPublicDoc(unitType) as UnitTypeGraphDoc);

      const teamProductFeatureOptions = productFeatureOptions
        .filter((option) => option.teamId === team.id)
        .map(
          (option) =>
            toPublicDoc(option) as ProductFeatureOptionGraphDoc
        );

      const publicTeam = toPublicDoc(team);
      return {
        ...(publicTeam as Omit<
          TeamGraphDoc,
          "memberships" | "estimates" | "projects" | "vendors" | "unitTypes" | "productFeatureOptions"
        >),
        memberships: teamMemberships,
        estimates: teamEstimates,
        projects: teamProjects,
        vendors: teamVendors,
        unitTypes: teamUnitTypes,
        productFeatureOptions: teamProductFeatureOptions,
      };
    });

    return teamGraph;
  },
});

export const upsertUser = mutation({
  args: {
    id: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await upsertUserDoc(ctx, args);
  },
});

export const transact = mutation({
  args: {
    operations: v.array(txOperationValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const rawOperation of args.operations) {
      const operation = rawOperation as TxOperation;
      const table = resolveCompatTable(operation.table);
      const existing = await getByCustomId(ctx, table, operation.id);
      const payload = assertObject(operation.data);
      applyLinkPayload(table, payload, operation.links);

      if (operation.operation === "create") {
        const now = Date.now();
        if (table === "users") {
          if (existing) {
            await ctx.db.patch(existing._id, {
              ...payload,
              updatedAt: now,
            });
          } else {
            await ctx.db.insert("users", {
              id: operation.id,
              ...payload,
              createdAt: now,
              updatedAt: now,
            });
          }
          continue;
        }

        if (existing) {
          await ctx.db.patch(existing._id, payload as any);
          continue;
        }

        const createdPayload = {
          id: operation.id,
          ...payload,
        } as any;

        if (typeof createdPayload.createdAt !== "number") {
          createdPayload.createdAt = now;
        }

        switch (table) {
          case "teams":
            await ctx.db.insert("teams", createdPayload);
            break;
          case "memberships":
            await ctx.db.insert("memberships", createdPayload);
            break;
          case "estimates":
            await ctx.db.insert("estimates", createdPayload);
            break;
          case "projects":
            await ctx.db.insert("projects", createdPayload);
            break;
          case "vendors":
            await ctx.db.insert("vendors", createdPayload);
            break;
          case "unitTypes":
            await ctx.db.insert("unitTypes", createdPayload);
            break;
          case "productFeatureOptions":
            await ctx.db.insert("productFeatureOptions", createdPayload);
            break;
          default:
            throw new Error(`Unsupported table for create: ${table}`);
        }
        continue;
      }

      if (operation.operation === "update") {
        if (!existing) {
          throw new Error(`Unable to update missing ${table}:${operation.id}`);
        }
        if (table === "users") {
          await ctx.db.patch(existing._id, {
            ...payload,
            updatedAt: Date.now(),
          });
        } else {
          await ctx.db.patch(existing._id, payload as any);
        }
        continue;
      }

      if (operation.operation === "delete") {
        if (!existing) continue;
        switch (table) {
          case "teams":
            await deleteTeamCascade(ctx, existing as Doc<"teams">);
            break;
          case "projects":
            await deleteProjectCascade(ctx, existing as Doc<"projects">);
            break;
          default:
            await ctx.db.delete((existing as { _id: TableNames })._id as any);
            break;
        }
      }
    }

    return null;
  },
});

export const importRows = mutation({
  args: {
    table: importTableValidator,
    rows: v.array(v.any()),
    replace: v.optional(v.boolean()),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, args) => {
    const table = args.table;

    if (args.replace === true) {
      switch (table) {
        case "users": {
          const docs = await ctx.db.query("users").collect();
          for (const doc of docs) {
            await ctx.db.delete(doc._id);
          }
          break;
        }
        case "teams": {
          const docs = await ctx.db.query("teams").collect();
          for (const doc of docs) {
            await ctx.db.delete(doc._id);
          }
          break;
        }
        case "memberships": {
          const docs = await ctx.db.query("memberships").collect();
          for (const doc of docs) {
            await ctx.db.delete(doc._id);
          }
          break;
        }
        case "estimates": {
          const docs = await ctx.db.query("estimates").collect();
          for (const doc of docs) {
            await ctx.db.delete(doc._id);
          }
          break;
        }
        case "projects": {
          const docs = await ctx.db.query("projects").collect();
          for (const doc of docs) {
            await ctx.db.delete(doc._id);
          }
          break;
        }
        case "vendors": {
          const docs = await ctx.db.query("vendors").collect();
          for (const doc of docs) {
            await ctx.db.delete(doc._id);
          }
          break;
        }
        case "unitTypes": {
          const docs = await ctx.db.query("unitTypes").collect();
          for (const doc of docs) {
            await ctx.db.delete(doc._id);
          }
          break;
        }
        case "productFeatureOptions": {
          const docs = await ctx.db.query("productFeatureOptions").collect();
          for (const doc of docs) {
            await ctx.db.delete(doc._id);
          }
          break;
        }
      }
    }

    let count = 0;
    for (const rawRow of args.rows) {
      const row = assertObject(rawRow);
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      const existing = await getByCustomId(ctx, table, id);

      if (existing) {
        await ctx.db.patch(existing._id, row as any);
      } else {
        switch (table) {
          case "users":
            await ctx.db.insert("users", row as any);
            break;
          case "teams":
            await ctx.db.insert("teams", row as any);
            break;
          case "memberships":
            await ctx.db.insert("memberships", row as any);
            break;
          case "estimates":
            await ctx.db.insert("estimates", row as any);
            break;
          case "projects":
            await ctx.db.insert("projects", row as any);
            break;
          case "vendors":
            await ctx.db.insert("vendors", row as any);
            break;
          case "unitTypes":
            await ctx.db.insert("unitTypes", row as any);
            break;
          case "productFeatureOptions":
            await ctx.db.insert("productFeatureOptions", row as any);
            break;
        }
      }

      count += 1;
    }

    return { count };
  },
});
