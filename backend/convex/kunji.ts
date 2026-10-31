import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { findKunjiUser, type KunjiTool } from "./lib/kunji";
import { insertNode, MAX_PAGE, writePage } from "./nodes";

// Learn's tools for kunji (kunji SPEC.md → App contract). The notes are one
// shared tree that anyone can read on the site, so the tools see every page;
// kunji still only reaches them for a verified, allowlisted user. The writes
// only add: add_note creates a page in an existing section, append_to_note adds
// to the end of a page. Nothing renames, moves or deletes.

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

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** A topic or section named by its path, e.g. "React / Hooks" (titles, ignoring case). */
async function findSection(ctx: QueryCtx, path: string): Promise<Doc<"nodes">> {
  const parts = path.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new ConvexError('"section" cannot be empty.');
  let options = await ctx.db
    .query("nodes")
    .withIndex("by_parent", (q) => q.eq("parentId", undefined))
    .collect();
  let node: Doc<"nodes"> | undefined;
  const walked: string[] = [];
  for (const part of parts) {
    const sections = options.filter((n) => n.kind === "section");
    const matches = sections.filter((n) => key(n.title) === key(part) || n.slug === key(part));
    if (matches.length !== 1) {
      const where = walked.length ? `in "${walked.join(" / ")}"` : "at the top level";
      const names = sections.map((n) => n.title).join(", ") || "none";
      if (matches.length > 1) throw new ConvexError(`Several sections named "${part}" ${where}.`);
      throw new ConvexError(`No section named "${part}" ${where}. Sections there: ${names}.`);
    }
    node = matches[0];
    walked.push(node.title);
    options = await ctx.db
      .query("nodes")
      .withIndex("by_parent", (q) => q.eq("parentId", node!._id))
      .collect();
  }
  return node!;
}

async function pageView(ctx: QueryCtx, pageId: Id<"nodes">) {
  const page = (await ctx.db.get(pageId))!;
  const trail = await trailOf(ctx, page);
  const markdown = (await markdownOf(ctx, pageId))?.markdown ?? "";
  return {
    id: page._id,
    title: page.title,
    path: trail.map((n) => n.title),
    url: pageUrl(trail[0], page._id),
    length: markdown.length,
  };
}

export const addNote = internalMutation({
  args: { section: v.string(), title: v.string(), markdown: v.string() },
  handler: async (ctx, { section, title, markdown }) => {
    const parent = await findSection(ctx, section);
    const id = await insertNode(ctx, parent, "page", title);
    if (markdown) await writePage(ctx, id, markdown);
    return await pageView(ctx, id);
  },
});

export const appendToNote = internalMutation({
  args: { id: v.string(), markdown: v.string() },
  handler: async (ctx, { id: ref, markdown }) => {
    const id = ctx.db.normalizeId("nodes", ref.trim());
    const page = id === null ? null : await ctx.db.get(id);
    if (page === null || page.kind !== "page") {
      throw new ConvexError(`No note with id "${ref.trim()}". Use search_notes to find one.`);
    }
    const current = (await markdownOf(ctx, page._id))?.markdown ?? "";
    const next = current.trim() ? `${current.replace(/\s+$/, "")}\n\n${markdown}` : markdown;
    if (next.length > MAX_PAGE) throw new ConvexError(`The page would be over ${MAX_PAGE.toLocaleString("en")} characters.`);
    await writePage(ctx, page._id, next);
    return await pageView(ctx, page._id);
  },
});

function requireText(value: unknown, name: string): string {
  const text = String(value ?? "");
  if (!text.trim()) throw new ConvexError(`"${name}" cannot be empty.`);
  return text;
}

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
  {
    name: "add_note",
    description:
      "Create a new Learn page (note) at the end of an existing topic or section, with a title and markdown text. " +
      "Name the place by its path of titles, e.g. \"React\" or \"React / Hooks\" (ignoring case). It never creates " +
      "topics or sections; an unknown name is refused with the names that exist there. Returns the new page's id, " +
      "title, path and url.",
    inputSchema: {
      type: "object",
      properties: {
        section: { type: "string", description: 'Topic or section path, e.g. "React / Hooks".' },
        title: { type: "string", description: "The page title; at most 200 characters." },
        markdown: { type: "string", description: `The page text as markdown (optional); at most ${MAX_PAGE.toLocaleString("en")} characters.` },
      },
      required: ["section", "title"],
      additionalProperties: false,
    },
    handler: async (ctx, _userId, input) =>
      await ctx.runMutation(internal.kunji.addNote, {
        section: input.section as string,
        title: input.title as string,
        markdown: (input.markdown as string | undefined) ?? "",
      }),
  },
  {
    name: "append_to_note",
    description:
      "Add markdown to the end of an existing Learn page, after a blank line; the existing text is kept. Take the id " +
      "from search_notes. If the user is editing that page in the browser with unsaved changes, their next save " +
      "replaces the page and drops what was appended. Returns the page's id, title, path, url and new length.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The page's id from search_notes." },
        markdown: { type: "string", description: "The text to add, as markdown." },
      },
      required: ["id", "markdown"],
      additionalProperties: false,
    },
    handler: async (ctx, _userId, input) =>
      await ctx.runMutation(internal.kunji.appendToNote, {
        id: input.id as string,
        markdown: requireText(input.markdown, "markdown"),
      }),
  },
];
