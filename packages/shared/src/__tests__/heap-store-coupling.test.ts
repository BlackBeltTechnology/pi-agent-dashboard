/**
 * Server-heap × store-budget coupling: the pinned guard predicate and the
 * build-time ordering invariant.
 *
 * The invariant is a vitest assertion over the REAL shared defaults, never a
 * module-scope throw — a throw in a browser-imported module would brick the SPA
 * on a mispairing instead of failing CI (design D2). The fixture cases prove it
 * fails closed.
 *
 * See change: guard-server-heap-and-store-coupling
 * (test-plan #E1, #E2, #E3, #E9, #X1, #X2).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASELINE_MB,
  CRASH_RATIO,
  DEFAULT_SERVER_HEAP,
  HEAP_MB_PER_BUDGET_MIB,
  serverHeapStoreCoupling,
} from "../heap-limits.js";
import { DEFAULT_MEMORY_LIMITS } from "../memory-limits.js";

const MIB = 1024 * 1024;
const CEILING = 1536;

describe("shared constants (test-plan #E2)", () => {
  it("exports the three factors with their measured values", () => {
    expect(HEAP_MB_PER_BUDGET_MIB).toBe(1.33);
    expect(BASELINE_MB).toBe(112);
    expect(CRASH_RATIO).toBe(0.82);
  });

  it("the guard reads the constants rather than inlining their literals", () => {
    const src = readFileSync(path.join(import.meta.dirname, "..", "heap-limits.ts"), "utf8");
    const body = src.slice(src.indexOf("export function serverHeapStoreCoupling"));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    expect(fn).toContain("HEAP_MB_PER_BUDGET_MIB");
    expect(fn).toContain("BASELINE_MB");
    expect(fn).toContain("CRASH_RATIO");
    for (const literal of ["1.33", "112", "0.82"]) expect(fn).not.toContain(literal);
  });
});

describe("guard predicate across the range (test-plan #E1)", () => {
  it.each([
    [384, false],
    [768, false],
    [1024, true],
    [2048, true],
  ])("%i MiB against a 1536 MB ceiling → warn=%s", (budgetMiB, warn) => {
    expect(serverHeapStoreCoupling(budgetMiB * MIB, CEILING).warn).toBe(warn);
  });

  it("1024 MiB resolves per the pinned formula: 1473.92 > 1259.52", () => {
    const r = serverHeapStoreCoupling(1024 * MIB, CEILING);
    expect(r.projectedHeapMb).toBe(Math.round(1024 * 1.33 + 112));
    expect(r.crashPointMb).toBe(Math.round(1536 * 0.82));
    expect(r.warn).toBe(true);
  });

  it("0 (unlimited) warns as UNBOUNDED with no heap figure, at any ceiling", () => {
    for (const ceiling of [64, 1536, 65536]) {
      const r = serverHeapStoreCoupling(0, ceiling);
      expect(r).toMatchObject({ warn: true, unbounded: true, projectedHeapMb: null });
    }
  });

  it("a finite warning reports the heap-equivalent, not the raw budget", () => {
    const r = serverHeapStoreCoupling(2048 * MIB, CEILING);
    expect(r.unbounded).toBe(false);
    expect(r.projectedHeapMb).toBe(Math.round(2048 * 1.33 + 112));
    expect(r.projectedHeapMb).not.toBe(2048);
  });

  it("non-finite or negative inputs never warn", () => {
    expect(serverHeapStoreCoupling(Number.NaN, CEILING).warn).toBe(false);
    expect(serverHeapStoreCoupling(-1, CEILING).warn).toBe(false);
    expect(serverHeapStoreCoupling(768 * MIB, Number.NaN).warn).toBe(false);
  });
});

describe("byte-denominated default does not warn spuriously (test-plan #E9)", () => {
  it("805306368 bytes against 1536 MB is silent", () => {
    expect(serverHeapStoreCoupling(805306368, CEILING).warn).toBe(false);
  });

  it("the shipped default pairing is silent", () => {
    expect(
      serverHeapStoreCoupling(DEFAULT_MEMORY_LIMITS.maxTotalEventBytes, DEFAULT_SERVER_HEAP.maxOldSpaceMb).warn,
    ).toBe(false);
  });
});

// ── Ordering invariant (design D2) ──────────────────────────────────────────

/** The V8 ceiling the dashboard used before the store was bounded. */
const UNBOUNDED_ERA_CEILING_MB = 8192;

/**
 * Returns a failure message when a lowered server default ships without a
 * BOUNDED store budget, else `null`. Boundedness, not presence: a `0` default
 * is the guaranteed-OOM case.
 */
function heapDefaultsPairingError(
  serverDefaultMb: number,
  memoryLimitsDefault: { maxTotalEventBytes?: number },
): string | null {
  if (serverDefaultMb >= UNBOUNDED_ERA_CEILING_MB) return null;
  const budget = memoryLimitsDefault.maxTotalEventBytes;
  if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) return null;
  return (
    `DEFAULT_SERVER_HEAP.maxOldSpaceMb (${serverDefaultMb}) is below ${UNBOUNDED_ERA_CEILING_MB} but ` +
    `DEFAULT_MEMORY_LIMITS.maxTotalEventBytes is ${budget === undefined ? "missing" : budget} (unbounded store). ` +
    `Restore a non-zero maxTotalEventBytes default, or raise the server default back to ${UNBOUNDED_ERA_CEILING_MB}.`
  );
}

describe("ordering invariant — the lowered default needs a bounded store", () => {
  it("X1: a missing budget default fails and names both defaults", () => {
    const err = heapDefaultsPairingError(1536, {});
    expect(err).toMatch(/DEFAULT_SERVER_HEAP\.maxOldSpaceMb \(1536\)/);
    expect(err).toMatch(/DEFAULT_MEMORY_LIMITS\.maxTotalEventBytes is missing/);
  });

  it("X2: an unlimited (0) budget default fails", () => {
    expect(heapDefaultsPairingError(1536, { maxTotalEventBytes: 0 })).toMatch(/is 0 \(unbounded store\)/);
  });

  it("E3: a bounded pairing passes", () => {
    expect(heapDefaultsPairingError(1536, { maxTotalEventBytes: 768 * MIB })).toBeNull();
  });

  it("the SHIPPED defaults satisfy the invariant (the CI gate)", () => {
    expect(heapDefaultsPairingError(DEFAULT_SERVER_HEAP.maxOldSpaceMb, DEFAULT_MEMORY_LIMITS)).toBeNull();
  });
});
