import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    id: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_custom_id", ["id"])
    .index("by_email", ["email"]),

  teams: defineTable({
    id: v.string(),
    name: v.string(),
    domain: v.string(),
    createdAt: v.number(),
    isPrimary: v.optional(v.boolean()),
    parentTeamId: v.optional(v.string()),
    ownerId: v.optional(v.string()),
    marginThresholds: v.optional(
      v.object({
        product_margin_min: v.optional(v.number()),
        install_margin_min: v.optional(v.number()),
        project_margin_min: v.optional(v.number()),
      })
    ),
  })
    .index("by_custom_id", ["id"])
    .index("by_domain", ["domain"])
    .index("by_domain_and_createdAt", ["domain", "createdAt"])
    .index("by_parentTeamId", ["parentTeamId"]),

  memberships: defineTable({
    id: v.string(),
    role: v.string(),
    createdAt: v.number(),
    teamId: v.string(),
    userId: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_teamId", ["teamId"])
    .index("by_userId", ["userId"])
    .index("by_teamId_and_userId", ["teamId", "userId"]),

  estimates: defineTable({
    id: v.string(),
    title: v.string(),
    status: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    version: v.optional(v.number()),
    lastGeneratedAt: v.optional(v.number()),
    templateName: v.optional(v.string()),
    templateUrl: v.optional(v.string()),
    payload: v.any(),
    totals: v.optional(v.any()),
    tags: v.optional(v.any()),
    versionHistory: v.optional(v.any()),
    teamId: v.string(),
    ownerId: v.string(),
    projectId: v.optional(v.string()),
  })
    .index("by_custom_id", ["id"])
    .index("by_teamId", ["teamId"])
    .index("by_projectId", ["projectId"])
    .index("by_teamId_and_updatedAt", ["teamId", "updatedAt"]),

  projects: defineTable({
    id: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    status: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    teamId: v.string(),
    ownerId: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_teamId", ["teamId"])
    .index("by_teamId_and_updatedAt", ["teamId", "updatedAt"]),

  vendors: defineTable({
    id: v.string(),
    name: v.string(),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    allowsSplitFinish: v.optional(v.boolean()),
    usesEuroPricing: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    teamId: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_teamId", ["teamId"])
    .index("by_teamId_and_sortOrder", ["teamId", "sortOrder"]),

  unitTypes: defineTable({
    id: v.string(),
    code: v.string(),
    label: v.string(),
    price: v.number(),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    teamId: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_teamId", ["teamId"])
    .index("by_teamId_and_sortOrder", ["teamId", "sortOrder"]),

  productFeatureOptions: defineTable({
    id: v.string(),
    category: v.string(),
    label: v.string(),
    vendorId: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    teamId: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_teamId", ["teamId"])
    .index("by_teamId_and_category", ["teamId", "category"])
    .index("by_teamId_and_vendorId", ["teamId", "vendorId"]),
});
