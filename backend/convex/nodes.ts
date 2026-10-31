import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { currentEditorId, requireEditor } from "./lib/access";

const kind = v.union(v.literal("section"), v.literal("page"));

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "topic"
  );
}

function cleanTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new ConvexError("Title cannot be empty.");
  if (t.length > 200) throw new ConvexError("Title is too long.");
  return t;
}

async function getNode(ctx: QueryCtx, id: Id<"nodes">): Promise<Doc<"nodes">> {
  const node = await ctx.db.get(id);
  if (node === null) throw new ConvexError("Not found.");
  return node;
}

function children(ctx: QueryCtx, parentId: Id<"nodes"> | undefined) {
  return ctx.db
    .query("nodes")
    .withIndex("by_parent", (q) => q.eq("parentId", parentId))
    .collect();
}

async function uniqueSlug(ctx: QueryCtx, title: string, except?: Id<"nodes">) {
  const base = slugify(title);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await ctx.db
      .query("nodes")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (taken === null || taken._id === except) return slug;
  }
}

export const viewer = query({
  args: {},
  handler: async (ctx) => ({ canEdit: (await currentEditorId(ctx)) !== null }),
});

export const topics = query({
  args: {},
  handler: async (ctx) => {
    const topics = await children(ctx, undefined);
    return Promise.all(
      topics.map(async (t) => ({
        ...t,
        pageCount: (
          await ctx.db
            .query("nodes")
            .withIndex("by_topic", (q) => q.eq("topicId", t._id))
            .collect()
        ).filter((n) => n.kind === "page").length,
      })),
    );
  },
});

/** A topic and every node below it, flat; the client builds the tree. */
export const topicTree = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const topic = await ctx.db
      .query("nodes")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (topic === null) return null;
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_topic", (q) => q.eq("topicId", topic._id))
      .collect();
    return { topic, nodes };
  },
});

/** Every page title, for the Ctrl+K finder. */
export const allPages = query({
  args: {},
  handler: async (ctx) => {
    const nodes = await ctx.db.query("nodes").collect();
    const byId = new Map(nodes.map((n) => [n._id, n]));
    return nodes
      .filter((n) => n.kind === "page")
      .map((n) => {
        const trail: string[] = [];
        for (let p = n.parentId && byId.get(n.parentId); p; p = p.parentId && byId.get(p.parentId)) {
          trail.unshift(p.title);
        }
        const topic = n.topicId ? byId.get(n.topicId) : undefined;
        return { _id: n._id, title: n.title, trail, topicSlug: topic?.slug ?? "" };
      });
  },
});

export const content = query({
  args: { nodeId: v.id("nodes") },
  handler: async (ctx, { nodeId }) => {
    const row = await ctx.db
      .query("contents")
      .withIndex("by_node", (q) => q.eq("nodeId", nodeId))
      .first();
    return { markdown: row?.markdown ?? "", updatedAt: row?.updatedAt ?? null };
  },
});

export const createTopic = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    await requireEditor(ctx);
    title = cleanTitle(title);
    const siblings = await children(ctx, undefined);
    const slug = await uniqueSlug(ctx, title);
    await ctx.db.insert("nodes", {
      kind: "section",
      title,
      slug,
      order: siblings.length,
      updatedAt: Date.now(),
    });
    return slug;
  },
});

/** Adds a section or page at the end of `parent`; shared with kunji's add_note. */
export async function insertNode(
  ctx: MutationCtx,
  parent: Doc<"nodes">,
  kind: Doc<"nodes">["kind"],
  title: string,
): Promise<Id<"nodes">> {
  if (parent.kind !== "section") throw new ConvexError("Pages cannot contain other items.");
  const siblings = await children(ctx, parent._id);
  return ctx.db.insert("nodes", {
    kind,
    title: cleanTitle(title),
    parentId: parent._id,
    topicId: parent.topicId ?? parent._id,
    order: siblings.length,
    updatedAt: Date.now(),
  });
}

export const create = mutation({
  args: { parentId: v.id("nodes"), kind, title: v.string() },
  handler: async (ctx, args) => {
    await requireEditor(ctx);
    return insertNode(ctx, await getNode(ctx, args.parentId), args.kind, args.title);
  },
});

export const rename = mutation({
  args: { id: v.id("nodes"), title: v.string() },
  handler: async (ctx, { id, title }) => {
    await requireEditor(ctx);
    const node = await getNode(ctx, id);
    title = cleanTitle(title);
    const patch: Partial<Doc<"nodes">> = { title, updatedAt: Date.now() };
    if (node.parentId === undefined) patch.slug = await uniqueSlug(ctx, title, id);
    await ctx.db.patch(id, patch);
    return patch.slug ?? null;
  },
});

async function removeTree(ctx: MutationCtx, id: Id<"nodes">) {
  for (const child of await children(ctx, id)) await removeTree(ctx, child._id);
  const rows = await ctx.db
    .query("contents")
    .withIndex("by_node", (q) => q.eq("nodeId", id))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
  await ctx.db.delete(id);
}

export const remove = mutation({
  args: { id: v.id("nodes") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx);
    await getNode(ctx, id);
    await removeTree(ctx, id);
  },
});

/** Moves a node under `parentId` (a section in the same topic) at `index`. */
export const move = mutation({
  args: { id: v.id("nodes"), parentId: v.id("nodes"), index: v.number() },
  handler: async (ctx, { id, parentId, index }) => {
    await requireEditor(ctx);
    const node = await getNode(ctx, id);
    const parent = await getNode(ctx, parentId);
    if (node.parentId === undefined) throw new ConvexError("Topics cannot be moved.");
    if (parent.kind !== "section") throw new ConvexError("Pages cannot contain other items.");
    if ((parent.topicId ?? parent._id) !== node.topicId) throw new ConvexError("Cannot move between topics.");
    // Refuse to move a section into itself or its own descendants.
    for (let p: Doc<"nodes"> | null = parent; p; p = p.parentId ? await ctx.db.get(p.parentId) : null) {
      if (p._id === id) throw new ConvexError("Cannot move a section into itself.");
    }
    const siblings = (await children(ctx, parentId)).filter((n) => n._id !== id);
    siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, node);
    for (const [i, s] of siblings.entries()) {
      if (s._id === id) await ctx.db.patch(id, { parentId, order: i });
      else if (s.order !== i) await ctx.db.patch(s._id, { order: i });
    }
  },
});

export const MAX_PAGE = 500_000;

/** Replaces a page's markdown; shared with kunji's add_note and append_to_note. */
export async function writePage(ctx: MutationCtx, nodeId: Id<"nodes">, markdown: string): Promise<number> {
  const node = await getNode(ctx, nodeId);
  if (node.kind !== "page") throw new ConvexError("Only pages have content.");
  if (markdown.length > MAX_PAGE) throw new ConvexError("Page is too large.");
  const now = Date.now();
  const row = await ctx.db
    .query("contents")
    .withIndex("by_node", (q) => q.eq("nodeId", nodeId))
    .first();
  if (row === null) await ctx.db.insert("contents", { nodeId, markdown, updatedAt: now });
  else if (row.markdown !== markdown) await ctx.db.patch(row._id, { markdown, updatedAt: now });
  await ctx.db.patch(nodeId, { updatedAt: now });
  return now;
}

export const save = mutation({
  args: { nodeId: v.id("nodes"), markdown: v.string() },
  handler: async (ctx, { nodeId, markdown }) => {
    await requireEditor(ctx);
    return writePage(ctx, nodeId, markdown);
  },
});
