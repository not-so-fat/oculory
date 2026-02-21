import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Generate a random invite code
function generateCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// Create an invite
export const createInvite = mutation({
  args: {
    inviterId: v.id("users"),
    inviteeName: v.string(),
    inviteeEmail: v.optional(v.string()),
    allowedProjects: v.array(v.string()),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const expiresInDays = args.expiresInDays || 7;
    const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;

    const code = generateCode();

    const inviteId = await ctx.db.insert("invites", {
      code,
      inviterId: args.inviterId,
      inviteeName: args.inviteeName,
      inviteeEmail: args.inviteeEmail,
      allowedProjects: args.allowedProjects,
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

// Verify invite is valid
export const verifyInvite = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invites")
      .filter((q) => q.eq(q.field("code"), args.code))
      .first();

    if (!invite) return { valid: false, reason: "not_found" };
    if (invite.expiresAt < Date.now()) return { valid: false, reason: "expired" };

    return { valid: true, project: invite.allowedProjects[0] };
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
