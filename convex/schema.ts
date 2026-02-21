import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // The owner (you)
  users: defineTable({
    name: v.string(),
    email: v.string(),
    createdAt: v.number(),
  }).index("email", ["email"]),

  // Knowledge files with layer (critical for RAG routing)
  knowledge_files: defineTable({
    layer: v.union(
      v.literal("memory"),
      v.literal("people"),
      v.literal("meeting"),
      v.literal("metadata"),
      v.literal("transcript")
    ),
    project: v.string(),
    filePath: v.string(),
    title: v.string(),
    content: v.string(),
    frontmatter: v.any(), // Store parsed frontmatter
    lastSyncedAt: v.number(),
  })
    .index("layer", ["layer"])
    .index("project", ["project"])
    .index("layer_project", ["layer", "project"]),

  // Invitations for friends
  invites: defineTable({
    code: v.string(),
    inviterId: v.id("users"),
    inviteeName: v.string(),
    inviteeEmail: v.optional(v.string()),
    allowedProjects: v.array(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("code", ["code"]),

  // Access policies per invite
  access_policies: defineTable({
    inviteId: v.id("invites"),
    project: v.string(),
    canRead: v.boolean(),
    canSearch: v.boolean(),
  }),
});
