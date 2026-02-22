import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Valid layers
const VALID_LAYERS = ["memory", "people", "meeting", "metadata", "transcript"];

// Check if user has access to a specific project
export const checkProjectAccess = query({
  args: {
    inviteId: v.id("invites"),
    project: v.string(),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    
    if (!invite) {
      return { allowed: false, reason: "Invite not found" };
    }
    
    if (invite.status !== "active") {
      return { allowed: false, reason: `Invite is ${invite.status}` };
    }
    
    if (Date.now() > invite.expiresAt) {
      return { allowed: false, reason: "Invite has expired" };
    }
    
    if (!invite.allowedProjects.includes(args.project)) {
      return { allowed: false, reason: `Project '${args.project}' not authorized` };
    }
    
    return { allowed: true };
  },
});

// Check if user has access to a specific layer
export const checkLayerAccess = query({
  args: {
    inviteId: v.id("invites"),
    layer: v.string(),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    
    if (!invite) {
      return { allowed: false, reason: "Invite not found" };
    }
    
    if (invite.status !== "active") {
      return { allowed: false, reason: `Invite is ${invite.status}` };
    }
    
    if (!invite.allowedLayers.includes(args.layer)) {
      return { allowed: false, reason: `Layer '${args.layer}' not authorized` };
    }
    
    return { allowed: true };
  },
});

// Check if user can search
export const checkSearchAccess = query({
  args: {
    inviteId: v.id("invites"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    
    if (!invite) {
      return { allowed: false, reason: "Invite not found" };
    }
    
    if (invite.status !== "active") {
      return { allowed: false, reason: `Invite is ${invite.status}` };
    }
    
    if (Date.now() > invite.expiresAt) {
      return { allowed: false, reason: "Invite has expired" };
    }
    
    if (!invite.canSearch) {
      return { allowed: false, reason: "User not authorized to search" };
    }
    
    return { 
      allowed: true, 
      allowedProjects: invite.allowedProjects,
      allowedLayers: invite.allowedLayers,
      rateLimit: invite.rateLimit,
    };
  },
});

// Revoke an invite
export const revokeAccess = mutation({
  args: {
    inviteId: v.id("invites"),
    inviterId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    
    if (!invite) {
      throw new Error("Invite not found");
    }
    
    if (invite.inviterId !== args.inviterId) {
      throw new Error("Not authorized to revoke this invite");
    }
    
    await ctx.db.patch(args.inviteId, {
      status: "revoked",
    });
    
    return { success: true };
  },
});

// Update invite permissions
export const updatePermissions = mutation({
  args: {
    inviteId: v.id("invites"),
    inviterId: v.id("users"),
    allowedProjects: v.optional(v.array(v.string())),
    allowedLayers: v.optional(v.array(v.string())),
    canSearch: v.optional(v.boolean()),
    canRead: v.optional(v.boolean()),
    rateLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { inviteId, inviterId, ...updates } = args;
    
    const invite = await ctx.db.get(inviteId);
    
    if (!invite) {
      throw new Error("Invite not found");
    }
    
    if (invite.inviterId !== inviterId) {
      throw new Error("Not authorized to modify this invite");
    }
    
    // Validate layers if provided
    if (updates.allowedLayers) {
      const invalidLayers = updates.allowedLayers.filter(
        (l) => !VALID_LAYERS.includes(l)
      );
      if (invalidLayers.length > 0) {
        throw new Error(`Invalid layers: ${invalidLayers.join(", ")}`);
      }
    }
    
    await ctx.db.patch(inviteId, updates);
    
    return { success: true };
  },
});

// Log an access attempt
export const logAccess = mutation({
  args: {
    inviteId: v.id("invites"),
    action: v.string(),
    query: v.optional(v.string()),
    result: v.string(),
    deniedReason: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("access_logs", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

// Get access logs for an owner
export const getAccessLogs = query({
  args: {
    inviterId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    
    // Get all invites by this owner
    const invites = await ctx.db
      .query("invites")
      .filter((q) => q.eq(q.field("inviterId"), args.inviterId))
      .collect();
    
    const inviteIds = new Set(invites.map((i) => i._id));
    
    // Get logs for these invites
    const logs = await ctx.db
      .query("access_logs")
      .order("desc")
      .take(limit);
    
    return logs.filter((log) => inviteIds.has(log.inviteId));
  },
});

// Get invite by ID with full details
export const getInviteDetails = query({
  args: {
    inviteId: v.id("invites"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.inviteId);
  },
});

// List all invites for an owner
export const listInvites = query({
  args: {
    inviterId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("invites")
      .filter((q) => q.eq(q.field("inviterId"), args.inviterId))
      .collect();
  },
});
