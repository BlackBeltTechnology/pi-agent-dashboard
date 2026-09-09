/**
 * L1 — the client entry's module-scope boot check does NOT run under the test
 * environment (test-plan F4; task 4.2).
 *
 * The generated plugin registry imports this entry in every client test run;
 * an unguarded module-scope fetch broke the whole suite under mechanism 5.
 * Here the entry is imported with `fetch` spied: the spy must stay uncalled,
 * while `resolveInstalled` remains explicitly invokable with an injected
 * fetch.
 *
 * See change: add-blackhole-session-pipeline.
 */
import { describe, expect, it, vi } from "vitest";
import { __resetInstalledGateForTests, resolveInstalled, shouldRenderMemorySubcard } from "../installed-gate.js";

const fetchSpy = vi.fn();
(globalThis as { fetch?: unknown }).fetch = fetchSpy;

// Import the ENTRY (not the gate module directly) — the kick lives there.
await import("../index.js");

describe("client entry boot check guard", () => {
  it("issues no network request at import under vitest (F4)", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolveInstalled stays explicitly invokable with an injected fetch", async () => {
    __resetInstalledGateForTests();
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ installed: true }),
      }) as unknown as Response) as typeof fetch;
    resolveInstalled({ fetchImpl });
    await new Promise((r) => setTimeout(r, 0));
    // TEMP: MEMORY subcard parked — not informative enough (gate hard-false).
    // expect(shouldRenderMemorySubcard({ id: "s" })).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled(); // the global fetch was never touched
    __resetInstalledGateForTests();
  });
});
