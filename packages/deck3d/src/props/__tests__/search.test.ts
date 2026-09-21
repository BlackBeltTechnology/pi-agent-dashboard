import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type MockServer, startMockServer } from "../../__tests__/helpers/mock-http.js";
import { parsePolyResponse, searchPolyPizza, searchProps, vendoredCandidates } from "../search.js";

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
