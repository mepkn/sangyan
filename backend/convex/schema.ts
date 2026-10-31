import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  // The content tree. Topics (React, Svelte...) are top-level sections with a
  // slug and no parent; everything below them carries its topic's id.
  nodes: defineTable({
    kind: v.union(v.literal("section"), v.literal("page")),
    title: v.string(),
    parentId: v.optional(v.id("nodes")),
    topicId: v.optional(v.id("nodes")),
    slug: v.optional(v.string()),
    order: v.number(),
    updatedAt: v.number(),
  })
    .index("by_parent", ["parentId", "order"])
    .index("by_topic", ["topicId"])
    .index("by_slug", ["slug"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["kind"] }),

  // Page bodies, kept apart so saving a page does not re-send the tree.
  contents: defineTable({
    nodeId: v.id("nodes"),
    markdown: v.string(),
    updatedAt: v.number(),
  })
    .index("by_node", ["nodeId"])
    .searchIndex("search_markdown", { searchField: "markdown" }),
});
