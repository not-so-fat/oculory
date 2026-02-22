import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Valid layers
const VALID_LAYERS = ["memory", "people", "meeting", "metadata", "transcript"];
const DEFAULT_RATE_LIMIT = 10;

// Generate a random invite code
function generateCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// Create an invite with full permissions
export const createInvite = mutation({
  args: {
    inviterId: v.id("users"),
    inviteeName: v.string(),
    inviteeEmail: v.optional(v.string()),
    allowedProjects: v.array(v.string()),
    allowedLayers: v.array(v.string()),
    canSearch: v.optional(v.boolean()),
    canRead: v.optional(v.boolean()),
    rateLimit: v.optional(v.number()),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const expiresInDays = args.expiresInDays || 7;
    const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;

    // Validate layers
    const invalidLayers = args.allowedLayers.filter(
      (l) => !VALID_LAYERS.includes(l)
    );
    if (invalidLayers.length > 0) {
      throw new Error(`Invalid layers: ${invalidLayers.join(", ")}`);
    }

    const code = generateCode();

    const inviteId = await ctx.db.insert("invites", {
      code,
      inviterId: args.inviterId,
      inviteeName: args.inviteeName,
      inviteeEmail: args.inviteeEmail,
      allowedProjects: args.allowedProjects,
      allowedLayers: args.allowedLayers,
      canSearch: args.canSearch ?? true,
      canRead: args.canRead ?? true,
      rateLimit: args.rateLimit ?? DEFAULT_RATE_LIMIT,
      status: "active",
      createdAt: Date.now(),
      expiresAt,
    });

    return { code, inviteId };
  },
});

// Get invite by code
export const getByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query("invites")
      .filter((q) => q.eq(q.field("code"), args.code))
      .take(1);

    if (invites.length === 0) return null;

    const invite = invites[0];

    // Check if expired
    if (invite.expiresAt < Date.now()) {
      return null;
    }

    return invite;
  },
});

// Verify invite is valid (returns full details)
export const verifyInvite = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invites")
      .filter((q) => q.eq(q.field("code"), args.code))
      .first();

    if (!invite) return { valid: false, reason: "not_found" };
    if (invite.expiresAt < Date.now()) return { valid: false, reason: "expired" };
    if (invite.status === "revoked") return { valid: false, reason: "revoked" };
    if (invite.status === "expired") return { valid: false, reason: "expired" };

    return { 
      valid: true, 
      inviteId: invite._id,
      project: invite.allowedProjects[0],
      allowedProjects: invite.allowedProjects,
      allowedLayers: invite.allowedLayers,
      canSearch: invite.canSearch,
      canRead: invite.canRead,
    };
  },
});

// Get user's invites
export const getInvitesByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("invites")
      .filter((q) => q.eq(q.field("inviterId"), args.userId))
      .take(20);
  },
});

// Update last accessed time
export const markAccessed = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.inviteId, {
      lastAccessedAt: Date.now(),
    });
  },
});
