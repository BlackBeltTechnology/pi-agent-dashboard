/**
 * L1 — `createIsPiExtensionInstalled` host capability factory (tasks 2.2;
 * test-plan E14, E15, X4).
 *
 * Contract (dashboard-plugin-loader delta):
 * - answer from the UNION of `listInstalled("global")` and `listInstalled("local")`
 * - match with the requirement-probe's `installedMatchesName` (id/name/
 *   displayName/source incl. `sourcesMatch`), not source-only
 * - boolean-only answer; no package records leak
 * - successful scans cached ~30 s; a rejection is NEVER cached and NEVER
 *   collapses to `false` — the promise rejects (callers cannot distinguish an
 *   authoritative `false` from "unknown")
 *
 * See change: add-blackhole-session-pipeline.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIsPiExtensionInstalled } from "../server/installed-probe.js";

type Record_ = { id?: string; name?: string; displayName?: string; source?: string };

interface Deps {
  global?: Record_[];
  local?: Record_[];
  /** When set, the Nth global scan throws instead of returning. */
  throwOnScan?: number;
}

function makeDeps(deps: Deps) {
  const scans: string[] = [];
  let scanCount = 0;
  const listGlobal = async (): Promise<Record_[]> => {
    scans.push("global");
    scanCount += 1;
    if (deps.throwOnScan === scanCount) throw new Error("registry locked");
    return deps.global ?? [];
  };
  const listLocal = async (): Promise<Record_[]> => {
    scans.push("local");
    return deps.local ?? [];
  };
  return { listGlobal, listLocal, scans };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createIsPiExtensionInstalled", () => {
  it("answers true for a LOCAL-only install matched by displayName (E14)", async () => {
    const { listGlobal, listLocal } = makeDeps({
      global: [],
      local: [{ id: "other-ext", displayName: "pi-blackhole" }],
    });
    const probe = createIsPiExtensionInstalled({ listGlobal, listLocal });
    await expect(probe("pi-blackhole")).resolves.toBe(true);
  });

  it("matches id, name, displayName, and source forms (incl. npm: and sourcesMatch)", async () => {
    const cases: Array<[Record_, boolean]> = [
      [{ id: "pi-blackhole" }, true],
      [{ name: "pi-blackhole" }, true],
      [{ displayName: "pi-blackhole" }, true],
      [{ source: "pi-blackhole" }, true],
      [{ source: "npm:pi-blackhole" }, true],
      [{ id: "something-else" }, false],
      [{ source: "https://github.com/other/repo" }, false],
    ];
    for (const [record, expected] of cases) {
      const { listGlobal, listLocal } = makeDeps({ global: [record], local: [] });
      const probe = createIsPiExtensionInstalled({ listGlobal, listLocal });
      await expect(probe("pi-blackhole")).resolves.toBe(expected);
    }
  });

  it("answers false — boolean only — when no scope holds the name", async () => {
    const { listGlobal, listLocal } = makeDeps({
      global: [{ id: "unrelated" }],
      local: [{ displayName: "unrelated-display" }],
    });
    const probe = createIsPiExtensionInstalled({ listGlobal, listLocal });
    const answer = await probe("pi-blackhole");
    expect(answer).toBe(false);
    expect(typeof answer).toBe("boolean");
  });

  it("runs ONE scan for repeated calls within the cache window (E15a)", async () => {
    const { listGlobal, listLocal, scans } = makeDeps({ global: [{ id: "pi-blackhole" }] });
    const probe = createIsPiExtensionInstalled({ listGlobal, listLocal });
    await probe("pi-blackhole");
    await probe("pi-blackhole");
    await probe("other-name");
    expect(scans.filter((s) => s === "global")).toHaveLength(1);
    expect(scans.filter((s) => s === "local")).toHaveLength(1);
  });

  it("rescans after the TTL expires", async () => {
    vi.useFakeTimers();
    const { listGlobal, listLocal, scans } = makeDeps({ global: [{ id: "pi-blackhole" }] });
    const probe = createIsPiExtensionInstalled({ listGlobal, listLocal });
    await probe("pi-blackhole");
    vi.advanceTimersByTime(31_000);
    await probe("pi-blackhole");
    expect(scans.filter((s) => s === "global")).toHaveLength(2);
  });

  it("rejects when a scope scan throws — never resolves false (X4)", async () => {
    const { listGlobal, listLocal } = makeDeps({ throwOnScan: 1 });
    const probe = createIsPiExtensionInstalled({ listGlobal, listLocal });
    await expect(probe("pi-blackhole")).rejects.toThrow("registry locked");
  });

  it("does NOT cache a rejection — the next call rescans and resolves (E15b)", async () => {
    const { listGlobal, listLocal, scans } = makeDeps({
      throwOnScan: 1,
      global: [{ id: "pi-blackhole" }],
    });
    const probe = createIsPiExtensionInstalled({ listGlobal, listLocal });
    await expect(probe("pi-blackhole")).rejects.toThrow("registry locked");
    await expect(probe("pi-blackhole")).resolves.toBe(true);
    expect(scans.filter((s) => s === "global")).toHaveLength(2);
  });
});
