import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type MockServer, startMockServer } from "../../__tests__/helpers/mock-http.js";
import { validIR } from "../../ir/__tests__/fixtures.js";
import { validate } from "../../ir/validate.js";
import { ambientCandidates, ambientTemplate, parsePolyResponse, type PropCandidate, searchPolyPizza, searchProps, vendoredCandidates } from "../search.js";

let server: MockServer;
beforeAll(async () => {
  server = await startMockServer();
});
afterAll(async () => {
  await server.close();
});

const POLY_FIXTURE = {
  results: [
    { id: "abc", name: "Robot", Tags: ["robot", "scifi"], TriCount: 1200, Download: "https://x/robot.glb", Licence: "CC0-1.0", Designer: "Someone" },
    { id: "ignored", name: "No download" },
  ],
};

describe("vendored search (7b.2)", () => {
  it("returns manifest hits, id-sorted, and network-free", () => {
    const hits = vendoredCandidates("robot");
    expect(hits.map((h) => h.id)).toEqual(["robot"]);
    expect(hits[0].source).toBe("vendored");
    expect(hits[0].licence).toBe("CC0-1.0");
  });

  it("searches tags too", () => {
    expect(vendoredCandidates("security").map((h) => h.id)).toContain("shield");
  });

  it("puts vendored candidates first", async () => {
    server.set({ body: JSON.stringify(POLY_FIXTURE) });
    const result = await searchProps("robot", { key: "k", endpoint: server.url });
    expect(result.candidates[0].source).toBe("vendored");
    expect(result.candidates.some((c) => c.source === "poly-pizza")).toBe(true);
  });
});

describe("Poly Pizza source (7b.3)", () => {
  it("parses a recorded response", () => {
    const rows = parsePolyResponse(POLY_FIXTURE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "abc", name: "Robot", licence: "CC0-1.0", author: "Someone" });
  });

  it("falls back to vendored-only when unreachable (X7)", async () => {
    server.set({ status: 500, body: "boom" });
    const r = await searchPolyPizza("robot", { key: "k", endpoint: server.url });
    expect(r.candidates).toEqual([]);
    expect(r.notice).toContain("HTTP 500");
  });

  it("falls back with a timeout notice (X6)", async () => {
    server.set({ body: JSON.stringify(POLY_FIXTURE), delayMs: 300 });
    const r = await searchPolyPizza("robot", { key: "k", endpoint: server.url, timeoutMs: 50 });
    expect(r.notice).toContain("timeout");
  });

  it("skips the online source without a key (X7)", async () => {
    const r = await searchPolyPizza("robot", { key: "" });
    expect(r.notice).toContain("no POLY_PIZZA_KEY");
  });
});

/**
 * test-plan #E39 — `--role ambient` filters by triangle budget (inclusive) and
 * prints a placement template, because an ambient entry needs `count`/`anim`/
 * `size` that are easy to get wrong by hand.
 */
describe("E39 ambient prop filter", () => {
  const candidate = (id: string, tris: number): PropCandidate => ({
    source: "vendored",
    id,
    name: id,
    tags: [],
    tris,
    bytes: 100,
    licence: "CC0-1.0",
    author: "x",
  });

  it("keeps candidates at or under the cap and drops the one over it", () => {
    const rows = ambientCandidates([candidate("a", 1999), candidate("b", 2000), candidate("c", 2001)]);
    expect(rows.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("emits an entry that validates once the sha256 is filled in", () => {
    const template = ambientTemplate(candidate("a", 1999));
    expect(template).toMatchObject({ role: "ambient", count: 12, anim: "float", restyle: "palette", size: 0.6 });

    const ir = validIR();
    ir.overrides.props = [{ ...template, sha256: "0".repeat(64), slide: "intro" } as never];
    const result = validate(ir);
    expect(result.errors).toEqual([]);
  });
});
