/**
 * L1 — pure parsing for the web-access card (change: render-unclaimed-custom-entries;
 * test-plan E8–E14, X5). Counts must never be partial; the parser must be total.
 *
 * @structural-pin drift guard: `body-limits.ts` mirrors the client reducer's CUSTOM_BODY_MAX_CHARS, which a plugin cannot import; the value is a code-shape fact
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CUSTOM_BODY_MAX_CHARS } from "../body-limits.js";
import {
  MAX_FETCH_URLS,
  MAX_QUERIES,
  MAX_RESULTS_PER_QUERY,
  parseWebSearchPayload,
  safeHttpUrl,
  summarizeBody,
} from "../parse-web-search.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(here, "fixtures", name), "utf-8"));
const pretty = (o: unknown) => JSON.stringify(o, null, 2);
const counts = (s: ReturnType<typeof summarizeBody>) => ({
  ...(s.queries !== undefined ? { q: s.queries } : {}),
  ...(s.results !== undefined ? { r: s.results } : {}),
  ...(s.urls !== undefined ? { urls: s.urls } : {}),
});
const res = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `t${i}`, url: `https://e.com/${i}`, snippet: "s" }));

// See change: retro-ux-chat-rendering (test-plan E11)
describe("summarizeBody — failed count (E11)", () => {
  it.each([
    ["1 query error", { type: "search", queries: [{ query: "a", results: res(1) }, { query: "b", error: "timeout", results: [] }, { query: "c", results: [] }] }, 1],
    ["0 errors", { type: "search", queries: [{ query: "a", results: res(1) }] }, undefined],
    ["null error is not a failure", { type: "search", queries: [{ query: "a", error: null, results: [] }] }, undefined],
    ["fetch urlMetadata error", { type: "fetch", urlMetadata: [{ url: "https://e.com", error: "HTTP 404" }, { url: "https://f.com" }] }, 1],
    ["older urls strings", { type: "fetch", urls: ["https://e.com", "https://f.com"] }, undefined],
  ])("%s", (_name, body, failed) => {
    expect(summarizeBody(pretty(body)).failed).toBe(failed);
  });

  it("placeholder results list + one error → failed 1, results omitted", () => {
    const s = summarizeBody(pretty({ type: "search", queries: [{ query: "a", error: "x", results: "[truncated: deep]" }] }));
    expect(s.failed).toBe(1);
    expect(s.results).toBeUndefined();
  });

  it("placeholder queries list → no failed count", () => {
    expect(summarizeBody(pretty({ type: "search", queries: "[array truncated]" })).failed).toBeUndefined();
  });
});

describe("summarizeBody — collapsed counts are never partial (E8)", () => {
  it("search with 2 queries holding 5 + 3 results → q2 r8", () => {
    const body = pretty({ type: "search", queries: [{ query: "a", results: res(5) }, { query: "b", results: res(3) }] });
    expect(counts(summarizeBody(body))).toEqual({ q: 2, r: 8 });
  });
  it("queries replaced by an ingest placeholder string → no counts", () => {
    expect(counts(summarizeBody(pretty({ type: "search", queries: "[array truncated]" })))).toEqual({});
  });
  it("one query's results replaced by a placeholder → queries but no results", () => {
    const body = pretty({ type: "search", queries: [{ query: "a", results: res(2) }, { query: "b", results: "[truncated: deep]" }] });
    expect(counts(summarizeBody(body))).toEqual({ q: 2 });
  });
  it("fetch counts urlMetadata, else the older urls shape", () => {
    expect(counts(summarizeBody(pretty({ type: "fetch", urlMetadata: [{}, {}, {}, {}] })))).toEqual({ urls: 4 });
    expect(counts(summarizeBody(pretty({ type: "fetch", urls: [{}, {}, {}] })))).toEqual({ urls: 3 });
  });
  it("research / unknown subtype / marker / ≥64000 chars / invalid JSON → label only", () => {
    expect(counts(summarizeBody(pretty({ type: "research", artifact: {} })))).toEqual({});
    expect(counts(summarizeBody(pretty({ type: "zzz", queries: [] })))).toEqual({});
    expect(counts(summarizeBody(`«3 earlier lines hidden»\n${pretty({ type: "search", queries: [] })}`))).toEqual({});
    const huge = JSON.stringify({ type: "search", queries: [], pad: "x".repeat(64_000) });
    expect(counts(summarizeBody(huge))).toEqual({});
    expect(counts(summarizeBody("{bad"))).toEqual({});
  });
  it("reports the subtype when it is recognised", () => {
    expect(summarizeBody(pretty({ type: "search", queries: [] })).type).toBe("search");
    expect(summarizeBody(pretty({ type: "fetch", urls: [] })).type).toBe("fetch");
    expect(summarizeBody("{bad").type).toBeUndefined();
  });
});

describe("parseWebSearchPayload — bounds and shapes", () => {
  it("E9: results per query are capped at 20 with +N", () => {
    for (const [n, shown, more] of [[20, 20, 0], [21, 20, 1], [35, 20, 15]] as const) {
      const v = parseWebSearchPayload({ type: "search", queries: [{ query: "q", results: res(n) }] });
      expect(v?.kind).toBe("search");
      if (v?.kind !== "search") throw new Error("not search");
      expect(v.queries[0].results.length).toBe(shown);
      expect(v.queries[0].omittedResults).toBe(more);
    }
    expect(MAX_RESULTS_PER_QUERY).toBe(20);
  });
  it("E9: queries capped at 20 and fetch urls at 50 with +N", () => {
    for (const [n, more] of [[20, 0], [21, 1]] as const) {
      const v = parseWebSearchPayload({ type: "search", queries: Array.from({ length: n }, () => ({ query: "q", results: [] })) });
      if (v?.kind !== "search") throw new Error("not search");
      expect(v.queries.length).toBe(20);
      expect(v.omittedQueries).toBe(more);
    }
    for (const [n, more] of [[50, 0], [51, 1]] as const) {
      const v = parseWebSearchPayload({ type: "fetch", urlMetadata: Array.from({ length: n }, (_, i) => ({ url: `https://e.com/${i}` })) });
      if (v?.kind !== "fetch") throw new Error("not fetch");
      expect(v.items.length).toBe(50);
      expect(v.omitted).toBe(more);
    }
    expect([MAX_QUERIES, MAX_FETCH_URLS]).toEqual([20, 50]);
  });
  it("E10: the older fetch shape derives size from content length", () => {
    const v = parseWebSearchPayload({ type: "fetch", urls: [{ url: "https://e.com", title: "T", content: "abcd" }] });
    if (v?.kind !== "fetch") throw new Error("not fetch");
    expect(v.items[0]).toEqual({ url: "https://e.com", title: "T", size: 4, error: null });
  });
  it("E11: provider text joins providers[], else provider", () => {
    const v = parseWebSearchPayload({
      type: "search",
      queries: [
        { query: "a", providers: ["exa", "brave"], results: [] },
        { query: "b", provider: "exa", results: [] },
      ],
    });
    if (v?.kind !== "search") throw new Error("not search");
    expect(v.queries.map((q) => q.providers)).toEqual(["exa, brave", "exa"]);
  });
  it("E12: malformed results are counted, not invented", () => {
    const v = parseWebSearchPayload({
      type: "search",
      queries: [{ query: "q", results: [{ title: "t", url: "https://e.com", snippet: "s" }, "x", null] }],
    });
    if (v?.kind !== "search") throw new Error("not search");
    expect(v.queries[0].results.length).toBe(1);
    expect(v.skipped).toBe(2);
  });
  it("X5: total on garbage — never throws, null or skipped > 0", () => {
    const garbage: unknown[] = [
      null,
      7,
      "x",
      [],
      { type: "search", queries: {} },
      { type: "search", queries: [null, { results: {} }] },
      { type: "fetch", urlMetadata: [1] },
    ];
    for (const g of garbage) {
      const v = parseWebSearchPayload(g);
      if (v === null) continue;
      expect(v.skipped, JSON.stringify(g)).toBeGreaterThan(0);
    }
  });
});

describe("body-limits drift guard", () => {
  it("mirrors the client reducer's CUSTOM_BODY_MAX_CHARS", () => {
    const src = readFileSync(join(here, "../../../../client/src/lib/chat/event-reducer.ts"), "utf-8");
    const m = /export const CUSTOM_BODY_MAX_CHARS = ([\d_]+);/.exec(src);
    expect(m, "reducer constant not found").toBeTruthy();
    expect(Number(m![1].replace(/_/g, ""))).toBe(CUSTOM_BODY_MAX_CHARS);
  });
});

describe("safeHttpUrl (E13)", () => {
  it("normalizes http(s) URLs", () => {
    expect(safeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpUrl("http://x.org")).toBe("http://x.org/");
    expect(safeHttpUrl("HTTPS://Example.COM/a b")).toBe("https://example.com/a%20b");
  });
  it("rejects every other scheme, relative, credentialed and garbage input", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      " javascript:alert(1)",
      "\tjavascript:x",
      "data:text/html,x",
      "//host/x",
      "https://trusted.com@evil.example/",
      "https://u:p@x.org",
      "not a url",
    ]) {
      expect(safeHttpUrl(bad), bad).toBeNull();
    }
    expect(safeHttpUrl(undefined as unknown as string)).toBeNull();
  });
});

describe("real logged payload shapes (E14)", () => {
  it("search fixture → typed view and collapsed counts", () => {
    const f = fixture("search.json");
    const v = parseWebSearchPayload(f);
    if (v?.kind !== "search") throw new Error("not search");
    expect(v.queries.map((q) => q.results.length)).toEqual([3, 2]);
    expect(v.queries[0].providers).toBe("exa");
    expect(counts(summarizeBody(pretty(f)))).toEqual({ q: 2, r: 5 });
  });
  it("fetch fixtures (both shapes) → typed views and collapsed counts", () => {
    const a = fixture("fetch-url-metadata.json");
    const va = parseWebSearchPayload(a);
    if (va?.kind !== "fetch") throw new Error("not fetch");
    expect(va.items.map((i) => i.size)).toEqual([12748, 0]);
    expect(va.items[1].error).toBe("HTTP 404");
    expect(counts(summarizeBody(pretty(a)))).toEqual({ urls: 2 });
    const b = fixture("fetch-urls.json");
    const vb = parseWebSearchPayload(b);
    if (vb?.kind !== "fetch") throw new Error("not fetch");
    expect(vb.items.length).toBe(3);
    expect(counts(summarizeBody(pretty(b)))).toEqual({ urls: 3 });
  });
  it("research fixture → null view (label only), no throw", () => {
    const f = fixture("research.json");
    expect(parseWebSearchPayload(f)).toBeNull();
    expect(counts(summarizeBody(pretty(f)))).toEqual({});
  });
});
