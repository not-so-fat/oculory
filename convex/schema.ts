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
    frontmatter: v.any(),
    lastSyncedAt: v.number(),
  })
    .index("layer", ["layer"])
    .index("project", ["project"])
    .index("layer_project", ["layer", "project"]),

  // Invitations for friends - ENHANCED with granular permissions
  invites: defineTable({
    code: v.string(),
    inviterId: v.id("users"),
    inviteeName: v.string(),
    inviteeEmail: v.optional(v.string()),
    
    // Project-based access control
    allowedProjects: v.array(v.string()),
    
    // Layer-based access control (NEW)
    allowedLayers: v.array(v.string()),
    
    // Permission flags (NEW)
    canSearch: v.boolean(),
    canRead: v.boolean(),
    
    // Rate limiting (NEW)
    rateLimit: v.number(),
    
    // Invite status
    status: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired")
    ),
    
    createdAt: v.number(),
    expiresAt: v.number(),
    lastAccessedAt: v.optional(v.number()),
  })
    .index("code", ["code"])
    .index("inviterId", ["inviterId"])
    .index("status", ["status"]),

  // Access logs for audit (NEW)
  access_logs: defineTable({
    inviteId: v.id("invites"),
    action: v.string(), // "login", "search", "read"
    query: v.optional(v.string()),
    result: v.string(), // "success", "denied", "error"
    deniedReason: v.optional(v.string()),
    timestamp: v.number(),
    ipAddress: v.optional(v.string()),
  })
    .index("inviteId", ["inviteId"])
    .index("timestamp", ["timestamp"]),
});
