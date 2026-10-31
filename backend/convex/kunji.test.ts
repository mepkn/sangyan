/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { checkInput, secretMatches } from "./lib/kunji";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "kjs_test-secret";
const ME = "me@example.com";

beforeEach(() => {
  vi.stubEnv("KUNJI_SECRET", SECRET);
  vi.stubEnv("ALLOWED_EMAILS", `${ME},stranger@example.com`);
});
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("users", { email: ME, emailVerificationTime: 1 });
    // An unverified sign-up with someone else's email must never count.
    await ctx.db.insert("users", { email: "other@example.com" });
    await ctx.db.insert("users", { email: "stranger@example.com", emailVerificationTime: 1 });
    const now = 1_700_000_000_000;
    const react = await ctx.db.insert("nodes", { kind: "section", title: "React", slug: "react", order: 0, updatedAt: now });
    const hooks = await ctx.db.insert("nodes", { kind: "section", title: "Hooks", parentId: react, topicId: react, order: 0, updatedAt: now });
    const page = async (parentId: typeof react, title: string, markdown: string) => {
      const id = await ctx.db.insert("nodes", { kind: "page", title, parentId, topicId: react, order: 0, updatedAt: now });
      if (markdown) await ctx.db.insert("contents", { nodeId: id, markdown, updatedAt: now });
      return id;
    };
    const effect = await page(hooks, "useEffect", "# useEffect\n\nReturn a cleanup function to unsubscribe.");
    const state = await page(hooks, "useState", "Holds local state between renders.");
    const intro = await page(react, "Introduction", "React renders components. " + "x".repeat(300) + " portals live here.");
    const empty = await page(react, "Empty page", "");
    return { react, hooks, effect, state, intro, empty };
  });
  return { t, ...ids };
}

const post = (body: unknown, secret = SECRET) => ({
  method: "POST",
  headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

type T = Awaited<ReturnType<typeof setup>>["t"];
async function call(t: T, tool: string, input: unknown = {}, userEmail = ME) {
  const res = await t.fetch("/kunji/call", post({ tool, input, userEmail }));
  expect(res.status).toBe(200);
  return await res.json();
}

describe("secret check", () => {
  it("compares exactly", async () => {
    expect(await secretMatches(SECRET, SECRET)).toBe(true);
    expect(await secretMatches(SECRET + "x", SECRET)).toBe(false);
    expect(await secretMatches("", "")).toBe(false);
  });

  it.each([
    ["GET", "/kunji/tools"],
    ["POST", "/kunji/access"],
    ["POST", "/kunji/call"],
  ])("%s %s refuses a wrong or missing secret", async (method, path) => {
    const { t } = await setup();
    const body = method === "POST" ? JSON.stringify({ userEmail: ME, tool: "search_notes" }) : undefined;
    expect((await t.fetch(path, { method, headers: { Authorization: "Bearer nope" }, body })).status).toBe(401);
    expect((await t.fetch(path, { method, body })).status).toBe(401);
  });

  it("refuses everything when KUNJI_SECRET is unset", async () => {
    vi.stubEnv("KUNJI_SECRET", "");
    const { t } = await setup();
    expect((await t.fetch("/kunji/tools", { headers: { Authorization: "Bearer " } })).status).toBe(401);
  });
});

describe("checkInput", () => {
  it("checks required keys, types and unknown fields", () => {
    const schema = {
      type: "object" as const,
      properties: { q: { type: "string" as const }, n: { type: "integer" as const } },
      required: ["q"],
      additionalProperties: false as const,
    };
    expect(checkInput(schema, { q: "x", n: 2 })).toBeNull();
    expect(checkInput(schema, {})).toBe('Missing "q".');
    expect(checkInput(schema, { q: "x", n: 1.5 })).toBe('"n" must be an integer.');
    expect(checkInput(schema, { q: "x", z: 1 })).toBe('Unknown field "z".');
    expect(checkInput(schema, [])).toBe("Input must be a JSON object.");
  });
});

describe("GET /kunji/tools", () => {
  it("lists the tools with their schemas", async () => {
    const { t } = await setup();
    const res = await t.fetch("/kunji/tools", { headers: { Authorization: `Bearer ${SECRET}` } });
    const tools = (await res.json()) as { name: string; inputSchema: { type: string } }[];
    expect(tools.map((x) => x.name)).toEqual(["search_notes", "get_note"]);
    expect(tools.every((x) => x.inputSchema.type === "object" && /^[a-z][a-z0-9_]{0,63}$/.test(x.name))).toBe(true);
  });
});

describe("POST /kunji/access", () => {
  it.each([
    [ME, "ok"],
    ["ME@Example.com ", "ok"],
    ["nobody@example.com", "no_account"],
    ["other@example.com", "no_account"], // unverified
  ])("%s → %s", async (userEmail, status) => {
    const { t } = await setup();
    const res = await t.fetch("/kunji/access", post({ userEmail }));
    expect(await res.json()).toEqual({ status });
  });

  it("is not_allowed once the email leaves ALLOWED_EMAILS", async () => {
    const { t } = await setup();
    vi.stubEnv("ALLOWED_EMAILS", "someone@else.com");
    expect(await (await t.fetch("/kunji/access", post({ userEmail: ME }))).json()).toEqual({ status: "not_allowed" });
  });

  it("is no_account when two verified rows share the email", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => void (await ctx.db.insert("users", { email: ME, emailVerificationTime: 1 })));
    expect(await (await t.fetch("/kunji/access", post({ userEmail: ME }))).json()).toEqual({ status: "no_account" });
  });

  it("needs userEmail", async () => {
    const { t } = await setup();
    expect((await t.fetch("/kunji/access", post({}))).status).toBe(400);
  });
});
describe("POST /kunji/call", () => {
  it("refuses no_account, not_allowed, unknown tools and bad input", async () => {
    const { t } = await setup();
    expect(await call(t, "search_notes", { query: "hooks" }, "nobody@example.com")).toMatchObject({ ok: false, error: { code: "no_account" } });
    expect(await call(t, "delete_everything")).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
    expect(await call(t, "search_notes", {})).toMatchObject({ ok: false, error: { code: "bad_input", message: 'Missing "query".' } });
    expect(await call(t, "search_notes", { query: "x", limit: 51 })).toMatchObject({ ok: false, error: { code: "tool_error" } });
    expect(await call(t, "search_notes", { query: "  " })).toMatchObject({ ok: false, error: { code: "tool_error" } });
    vi.stubEnv("ALLOWED_EMAILS", "someone@else.com");
    expect(await call(t, "search_notes", { query: "hooks" })).toMatchObject({ ok: false, error: { code: "not_allowed" } });
  });

  it("search_notes finds pages by title and by text, with path, snippet and url", async () => {
    vi.stubEnv("SITE_URL", "https://learn.example.com/");
    const { t, effect, intro } = await setup();
    const { result } = await call(t, "search_notes", { query: "cleanup" });
    expect(result.results[0]).toMatchObject({
      id: effect,
      title: "useEffect",
      path: ["React", "Hooks"],
      url: `https://learn.example.com/react/${effect}`,
    });
    expect(result.results[0].snippet).toContain("cleanup function");
    const byTitle = await call(t, "search_notes", { query: "useState" });
    expect(byTitle.result.results.map((r: { title: string }) => r.title)).toContain("useState");
    const deep = await call(t, "search_notes", { query: "portals" });
    expect(deep.result.results[0]).toMatchObject({ id: intro, path: ["React"] });
    expect(deep.result.results[0].snippet).toMatch(/^….*portals/);
  });

  it("search_notes never returns sections and honours limit", async () => {
    const { t } = await setup();
    const hooks = await call(t, "search_notes", { query: "Hooks React useEffect useState" , limit: 1 });
    expect(hooks.result.results).toHaveLength(1);
    const all = await call(t, "search_notes", { query: "Hooks React" });
    expect(all.result.results.every((r: { title: string }) => r.title !== "Hooks")).toBe(true);
  });

  it("get_note reads a page in full and refuses sections and junk ids", async () => {
    const { t, effect, hooks, empty } = await setup();
    const { result } = await call(t, "get_note", { id: effect });
    expect(result).toMatchObject({ id: effect, title: "useEffect", path: ["React", "Hooks"], markdown: expect.stringContaining("cleanup") });
    expect(result.truncated).toBeUndefined();
    expect((await call(t, "get_note", { id: empty })).result.markdown).toBe("");
    expect(await call(t, "get_note", { id: hooks })).toMatchObject({ ok: false, error: { code: "tool_error" } });
    expect(await call(t, "get_note", { id: "nope" })).toMatchObject({ ok: false, error: { code: "tool_error", message: expect.stringContaining("search_notes") } });
  });

  it("get_note cuts very long pages", async () => {
    const { t, state } = await setup();
    await t.run(async (ctx) => {
      const row = await ctx.db.query("contents").withIndex("by_node", (q) => q.eq("nodeId", state)).first();
      await ctx.db.patch(row!._id, { markdown: "a".repeat(100_010) });
    });
    const { result } = await call(t, "get_note", { id: state });
    expect(result).toMatchObject({ truncated: true, length: 100_010 });
    expect(result.markdown).toHaveLength(100_000);
  });
});
