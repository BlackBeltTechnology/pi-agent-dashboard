/**
 * `sessionHeap` / `serverHeap` config parse boundaries.
 *
 * Pins the load-time fallback convention: an invalid heap value never reaches
 * a spawned process's argv because `loadConfig` already replaced it with the
 * default. Also pins the two similarly-named keys apart — `memoryLimits`
 * bounds the EVENT STORE, `sessionHeap` bounds V8.
 *
 * See change: bound-session-heap-and-gc-telemetry
 * (test-plan #E1–#E7, #E23).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MEMORY_LIMITS,
  DEFAULT_SERVER_HEAP,
  DEFAULT_SESSION_HEAP,
  loadConfig,
  subagentHeapBudget,
} from "../config.js";

let tmpHome: string;
let realHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "heap-cfg-"));
  realHome = process.env.HOME ?? "";
  process.env.HOME = tmpHome;
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

function seed(config: Record<string, unknown>): void {
  const file = path.join(tmpHome, ".pi", "dashboard", "config.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config));
}

describe("heap defaults (test-plan #E1)", () => {
  it("an empty config yields 512 / 1536 and leaves the optional fields unset", () => {
    seed({});
    const cfg = loadConfig();
    expect(cfg.sessionHeap.maxOldSpaceMb).toBe(512);
    expect(cfg.serverHeap.maxOldSpaceMb).toBe(1536);
    // ABSENT, not `0` — a `0` would be a request V8 rejects.
    expect(cfg.sessionHeap.initialOldSpaceMb).toBeUndefined();
    expect(cfg.sessionHeap.maxSemiSpaceMb).toBeUndefined();
  });

  it("the shipped defaults are the exported constants", () => {
    expect(DEFAULT_SESSION_HEAP.maxOldSpaceMb).toBe(512);
    expect(DEFAULT_SERVER_HEAP.maxOldSpaceMb).toBe(1536);
  });
});

describe("maxOldSpaceMb floor is 64 (test-plan #E2, #E3, #E4)", () => {
  it("63 is below the floor and falls back to the default", () => {
    seed({ sessionHeap: { maxOldSpaceMb: 63 } });
    expect(loadConfig().sessionHeap.maxOldSpaceMb).toBe(512);
  });

  it("64 — the floor itself — is valid", () => {
    seed({ sessionHeap: { maxOldSpaceMb: 64 } });
    expect(loadConfig().sessionHeap.maxOldSpaceMb).toBe(64);
  });

  it("65 is valid", () => {
    seed({ sessionHeap: { maxOldSpaceMb: 65 } });
    expect(loadConfig().sessionHeap.maxOldSpaceMb).toBe(65);
  });

  it("the same floor governs serverHeap", () => {
    seed({ serverHeap: { maxOldSpaceMb: 63 } });
    expect(loadConfig().serverHeap.maxOldSpaceMb).toBe(1536);
    seed({ serverHeap: { maxOldSpaceMb: 64 } });
    expect(loadConfig().serverHeap.maxOldSpaceMb).toBe(64);
  });
});

describe("invalid values fall back rather than throw (test-plan #E5)", () => {
  it.each([0, -1, 1024.5, "lots", null, [], true, Number.NaN, Number.POSITIVE_INFINITY])(
    "%p resolves to the 512 default without throwing",
    (variant) => {
      seed({ sessionHeap: { maxOldSpaceMb: variant } });
      expect(() => loadConfig()).not.toThrow();
      expect(loadConfig().sessionHeap.maxOldSpaceMb).toBe(512);
    },
  );

  it("a non-object sessionHeap block falls back wholesale", () => {
    seed({ sessionHeap: "512" });
    expect(loadConfig().sessionHeap.maxOldSpaceMb).toBe(512);
  });
});

describe("partial blocks keep sibling defaults (test-plan #E6)", () => {
  it("maxSemiSpaceMb alone still yields the default maxOldSpaceMb", () => {
    seed({ sessionHeap: { maxSemiSpaceMb: 8 } });
    const heap = loadConfig().sessionHeap;
    expect(heap.maxSemiSpaceMb).toBe(8);
    expect(heap.maxOldSpaceMb).toBe(512);
  });

  it("initialOldSpaceMb survives when valid and drops when not", () => {
    seed({ sessionHeap: { initialOldSpaceMb: 128 } });
    expect(loadConfig().sessionHeap.initialOldSpaceMb).toBe(128);
    seed({ sessionHeap: { initialOldSpaceMb: "128" } });
    expect(loadConfig().sessionHeap.initialOldSpaceMb).toBeUndefined();
  });
});

describe("memoryLimits independence (test-plan #E7)", () => {
  it("setting sessionHeap leaves the event-store limits untouched", () => {
    seed({ sessionHeap: { maxOldSpaceMb: 256 } });
    expect(loadConfig().memoryLimits).toEqual(DEFAULT_MEMORY_LIMITS);
  });

  it("setting memoryLimits leaves the heap blocks untouched", () => {
    seed({ memoryLimits: { maxTotalEventBytes: 1024 } });
    const cfg = loadConfig();
    expect(cfg.sessionHeap).toEqual(DEFAULT_SESSION_HEAP);
    expect(cfg.serverHeap).toEqual(DEFAULT_SERVER_HEAP);
  });
});

describe("subagent coupling guard (test-plan #E23)", () => {
  it.each([
    [2, 170, false],
    [4, 102, false],
    [5, 85, true],
    [8, 56, true],
  ])(
    "maxConcurrentSubagents=%i leaves %i MB per child (warn=%s)",
    (concurrency, perChildMb, warn) => {
      const budget = subagentHeapBudget(512, concurrency);
      expect(budget.perChildMb).toBe(perChildMb);
      expect(budget.warn).toBe(warn);
    },
  );

  it("is inert on nonsense input rather than warning spuriously", () => {
    expect(subagentHeapBudget(512, -1)).toEqual({ perChildMb: 0, warn: false });
    expect(subagentHeapBudget(512, Number.POSITIVE_INFINITY).warn).toBe(false);
  });
});
