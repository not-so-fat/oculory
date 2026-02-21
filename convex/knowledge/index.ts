import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Layer priority for RAG (from Lexicon search rules)
const LAYER_PRIORITY = {
  memory: 1,
  people: 2,
  meeting: 3,
  metadata: 4,
  transcript: 5,
} as const;

// Search by layer with full-text content search
export const searchByLayer = query({
  args: {
    layer: v.union(
      v.literal("memory"),
      v.literal("people"),
      v.literal("meeting"),
      v.literal("metadata"),
      v.literal("transcript")
    ),
    project: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 5;

    // Full-text search using contains
    const results = await ctx.db
      .query("knowledge_files")
      .filter((q) =>
        q.and(
          q.eq(q.field("layer"), args.layer),
          q.eq(q.field("project"), args.project),
          q.contains(q.field("content"), args.query)
        )
      )
      .take(limit);

    return results.map((r) => ({
      ...r,
      _rank: LAYER_PRIORITY[r.layer as keyof typeof LAYER_PRIORITY] || 999,
    }));
  },
});

// Search across all layers with priority
export const searchAllLayers = query({
  args: {
    project: v.string(),
    query: v.string(),
    questionType: v.optional(
      v.union(
        v.literal("what_know"),
        v.literal("about_person"),
        v.literal("what_happened"),
        v.literal("prepare_meeting"),
        v.literal("decisions"),
        v.literal("general")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;

    // Determine which layers to search based on question type
    const layersToSearch = getLayersForQuestionType(args.questionType || "general");

    let allResults: typeof ctx.db[] = [];

    for (const layer of layersToSearch) {
      const results = await ctx.db
        .query("knowledge_files")
        .filter((q) =>
          q.and(
            q.eq(q.field("layer"), layer),
            q.eq(q.field("project"), args.project),
            q.contains(q.field("content"), args.query)
          )
        )
        .take(limit);

      allResults.push(...results.map((r) => ({
        ...r,
        _rank: LAYER_PRIORITY[r.layer as keyof typeof LAYER_PRIORITY] || 999,
      })));
    }

    // Sort by layer priority
    allResults.sort((a, b) => a._rank - b._rank);

    return allResults.slice(0, limit);
  },
});

// Determine which layers to search based on question type
function getLayersForQuestionType(
  questionType: "what_know" | "about_person" | "what_happened" | "prepare_meeting" | "decisions" | "general"
): Array<"memory" | "people" | "meeting" | "metadata" | "transcript"> {
  switch (questionType) {
    case "about_person":
      return ["people", "meeting", "memory"];
    case "what_happened":
      return ["meeting", "memory"];
    case "prepare_meeting":
      return ["people", "memory", "meeting"];
    case "decisions":
      return ["memory", "meeting"];
    case "what_know":
      return ["memory", "meeting", "people"];
    default:
      return ["memory", "people", "meeting", "metadata", "transcript"];
  }
}

// Get document by ID
export const getDocument = query({
  args: { id: v.id("knowledge_files") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Search by title (for specific person lookup)
export const searchByTitle = query({
  args: {
    project: v.string(),
    title: v.string(),
    layer: v.optional(
      v.union(
        v.literal("memory"),
        v.literal("people"),
        v.literal("meeting"),
        v.literal("metadata"),
        v.literal("transcript")
      )
    ),
  },
  handler: async (ctx, args) => {
    let queryBuilder = ctx.db
      .query("knowledge_files")
      .filter((q) =>
        q.and(
          q.eq(q.field("project"), args.project),
          q.contains(q.field("title"), args.title)
        )
      );

    if (args.layer) {
      queryBuilder = queryBuilder.filter((q) => q.eq(q.field("layer"), args.layer!));
    }

    return await queryBuilder.take(10);
  },
});

// Sync file mutation
export const syncFile = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    // Check if file already exists
    const existing = await ctx.db
      .query("knowledge_files")
      .filter((q) =>
        q.and(
          q.eq(q.field("filePath"), args.filePath),
          q.eq(q.field("layer"), args.layer)
        )
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        lastSyncedAt: Date.now(),
      });
      return existing._id;
    } else {
      return await ctx.db.insert("knowledge_files", {
        ...args,
        lastSyncedAt: Date.now(),
      });
    }
  },
});

// Get all documents for a project
export const getProjectDocuments = query({
  args: {
    project: v.string(),
    layer: v.optional(
      v.union(
        v.literal("memory"),
        v.literal("people"),
        v.literal("meeting"),
        v.literal("metadata"),
        v.literal("transcript")
      )
    ),
  },
  handler: async (ctx, args) => {
    let queryBuilder = ctx.db
      .query("knowledge_files")
      .filter((q) => q.eq(q.field("project"), args.project));

    if (args.layer) {
      queryBuilder = queryBuilder.filter((q) => q.eq(q.field("layer"), args.layer!));
    }

    return await queryBuilder.take(100);
  },
});
