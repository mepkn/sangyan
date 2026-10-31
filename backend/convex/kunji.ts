import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { findKunjiUser, type KunjiTool } from "./lib/kunji";

// Learn's tools for kunji (kunji SPEC.md → App contract). The notes are one
// shared tree that anyone can read on the site, so the tools see every page;
// kunji still only reaches them for a verified, allowlisted user. Read-only.

const SEARCH_LIMIT = 10;
const SEARCH_MAX = 50;
/** Longest note body get_note returns; longer ones are cut and marked truncated. */
const NOTE_MAX = 100_000;
const SNIPPET = 160;

export const access = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => await findKunjiUser(ctx, email),
});

/** Titles from the topic down to the page's parent, e.g. ["React", "Hooks"]. */
async function trailOf(ctx: QueryCtx, page: Doc<"nodes">): Promise<Doc<"nodes">[]> {
  const trail: Doc<"nodes">[] = [];
  for (let id = page.parentId; id; ) {
    const node: Doc<"nodes"> | null = await ctx.db.get(id);
    if (node === null) break;
    trail.unshift(node);
    id = node.parentId;
  }
  return trail;
}

function pageUrl(topic: Doc<"nodes"> | undefined, pageId: Id<"nodes">): string | null {
  const site = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  return site && topic?.slug ? `${site}/${topic.slug}/${pageId}` : null;
}

async function markdownOf(ctx: QueryCtx, pageId: Id<"nodes">) {
  return await ctx.db
    .query("contents")
    .withIndex("by_node", (q) => q.eq("nodeId", pageId))
    .first();
}

/** About SNIPPET characters around the first word of the query found in the text. */
export function snippet(markdown: string, query: string): string {
  const text = markdown.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const at = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => lower.indexOf(w))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (at ?? 0) - SNIPPET / 2);
  const cut = text.slice(start, start + SNIPPET);
  return (start > 0 ? "…" : "") + cut + (start + SNIPPET < text.length ? "…" : "");
}

export const searchNotes = internalQuery({
  args: { query: v.string(), limit: v.number() },
  handler: async (ctx, { query, limit }) => {
    // Title matches first, then pages whose text matches. Convex search ORs the
    // words and ranks by relevance.
    const byTitle = await ctx.db
      .query("nodes")
      .withSearchIndex("search_title", (q) => q.search("title", query).eq("kind", "page"))
      .take(limit);
    const byText = await ctx.db
      .query("contents")
      .withSearchIndex("search_markdown", (q) => q.search("markdown", query))
      .take(limit);
    const ids: Id<"nodes">[] = [];
    for (const id of [...byTitle.map((n) => n._id), ...byText.map((c) => c.nodeId)]) {
      if (!ids.includes(id)) ids.push(id);
    }
    const results = [];
    for (const id of ids.slice(0, limit)) {
      const page = await ctx.db.get(id);
      if (page === null || page.kind !== "page") continue;
      const trail = await trailOf(ctx, page);
      const markdown = (await markdownOf(ctx, id))?.markdown ?? "";
      results.push({
        id,
        title: page.title,
        path: trail.map((n) => n.title),
        snippet: snippet(markdown, query),
        url: pageUrl(trail[0], id),
        updatedAt: new Date(page.updatedAt).toISOString(),
      });
    }
    return { results };
  },
});

export const getNote = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id: ref }) => {
    const id = ctx.db.normalizeId("nodes", ref.trim());
    const page = id === null ? null : await ctx.db.get(id);
    if (page === null || page.kind !== "page") {
      throw new ConvexError(`No note with id "${ref.trim()}". Use search_notes to find one.`);
    }
    const trail = await trailOf(ctx, page);
    const markdown = (await markdownOf(ctx, page._id))?.markdown ?? "";
    return {
      id: page._id,
      title: page.title,
      path: trail.map((n) => n.title),
      url: pageUrl(trail[0], page._id),
      updatedAt: new Date(page.updatedAt).toISOString(),
      markdown: markdown.slice(0, NOTE_MAX),
      ...(markdown.length > NOTE_MAX && { truncated: true, length: markdown.length }),
    };
  },
});

export const tools: KunjiTool[] = [
  {
    name: "search_notes",
    description:
      "Search the user's Learn notes (pages of study notes on React, Svelte, Express and more, grouped by topic " +
      "and section) by words in the title or text. Matches any of the words, best first, title matches before " +
      "text matches. Returns each page's id, title, path (topic and sections above it), a short snippet, url and " +
      "last update. Use get_note with the id to read a whole page.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for, e.g. \"useEffect cleanup\"." },
        limit: { type: "integer", description: `How many pages to return, 1–${SEARCH_MAX} (default ${SEARCH_LIMIT}).` },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: async (ctx, _userId, input) => {
      const query = (input.query as string).trim();
      if (!query) throw new ConvexError('"query" cannot be empty.');
      const limit = (input.limit as number | undefined) ?? SEARCH_LIMIT;
      if (limit < 1 || limit > SEARCH_MAX) throw new ConvexError(`"limit" must be from 1 to ${SEARCH_MAX}.`);
      return await ctx.runQuery(internal.kunji.searchNotes, { query, limit });
    },
  },
  {
    name: "get_note",
    description:
      "Read one Learn note in full: its title, path (topic and sections above it), url, last update and its text " +
      `as markdown (cut at ${NOTE_MAX.toLocaleString("en")} characters, marked truncated). Take the id from search_notes.`,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The page's id from search_notes." } },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (ctx, _userId, input) => await ctx.runQuery(internal.kunji.getNote, { id: input.id as string }),
  },
];
