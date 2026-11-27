/**
 * The seven `openspec*` keys (tasks 7.9–7.12 #E4 #E5 #E27 #E30): integers only, clamps with one log line,
 * names/refs validated (`invalid_config`), and the lock TTL clamp that keeps `setTimeout` in range.
 * See change: add-agent-teams-openspec.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { capturingLogger } from "../../../__tests__/harness/store-env.js";
import { createConfigReader } from "../../config.js";
import { createOpenspecConfigReader, FETCH_TIMEOUT_MAX_MS, isValidBranchRef, LOCK_TTL_RANGE, OPENSPEC_DEFAULTS, type OpenspecConfig } from "../config.js";

function reader(raw: Record<string, unknown>) {
  const { logger, logs } = capturingLogger();
  return { read: createOpenspecConfigReader(() => raw, logger), logs };
}
const ok = (r: ReturnType<ReturnType<typeof reader>["read"]>): OpenspecConfig => {
  if (!r.ok) throw new Error(`invalid_config ${r.key}`);
  return r.config;
};

describe("defaults and the core reader pass-through", () => {
  it("unset keys use the documented defaults, silently", () => {
    const { read, logs } = reader({});
    expect(ok(read())).toEqual({ groupParallel: 2, shipSkill: "ship-it", reviewSkill: "review-code", worktreeBase: "develop", mergeBase: "develop", lockTtlMs: 1_800_000, fetchTimeoutMs: 8000 });
    expect(logs.warn).toEqual([]);
  });

  it("the core config reader passes the raw openspec* values through unvalidated", () => {
    const { logger } = capturingLogger();
    const cfg = createConfigReader(() => ({ openspecGroupParallel: "2", openspecLockTtlMs: 5, other: 1 }), logger)();
    expect(cfg.openspecRaw).toMatchObject({ openspecGroupParallel: "2", openspecLockTtlMs: 5 });
    expect(cfg.openspecRaw).not.toHaveProperty("other");
  });

  it("the shipped schema declares every key with its default", async () => {
    const schema = (await import("../../../configSchema.json", { with: { type: "json" } })).default as { properties: Record<string, { default?: unknown }> };
    expect(schema.properties.openspecGroupParallel?.default).toBe(OPENSPEC_DEFAULTS.groupParallel);
    expect(schema.properties.openspecLockTtlMs?.default).toBe(OPENSPEC_DEFAULTS.lockTtlMs);
    expect(schema.properties.openspecFetchTimeoutMs?.default).toBe(OPENSPEC_DEFAULTS.fetchTimeoutMs);
    expect(schema.properties.openspecShipSkill?.default).toBe("ship-it");
    expect(schema.properties.openspecReviewSkill?.default).toBe("review-code");
    expect(schema.properties.openspecWorktreeBase?.default).toBe("develop");
    expect(schema.properties.openspecMergeBase?.default).toBe("develop");
  });
});

describe("openspecGroupParallel (7.9 #E4)", () => {
  it.each([
    [1, 1, 0],
    [2, 2, 0],
    [5, 5, 0],
    [6, 5, 1],
    [9, 5, 1],
    [1e9, 5, 1],
    [0, 1, 1],
    [-1, 1, 1],
  ])("integer %s → %s with %s clamp line(s)", (v, want, lines) => {
    const { read, logs } = reader({ openspecGroupParallel: v });
    expect(ok(read({ effectiveMaxTeammates: 5 })).groupParallel).toBe(want);
    expect(logs.warn.filter((l) => l.includes("outside"))).toHaveLength(lines);
  });

  it.each([[1.5], ["2"], [Number.NaN], [null], [Number.POSITIVE_INFINITY], [true]])("non-integer %s → default 2 + a warning", (v) => {
    const { read, logs } = reader({ openspecGroupParallel: v });
    expect(ok(read({ effectiveMaxTeammates: 5 })).groupParallel).toBe(2);
    expect(logs.warn.some((l) => l.includes("not a valid integer"))).toBe(true);
  });

  it("is bounded by an effective maxTeammates of 1, with the default too", () => {
    expect(ok(reader({ openspecGroupParallel: 4 }).read({ effectiveMaxTeammates: 1 })).groupParallel).toBe(1);
    expect(ok(reader({}).read({ effectiveMaxTeammates: 1 })).groupParallel).toBe(1);
  });

  it("logs a given clamp once, however often the config is read", () => {
    const { read, logs } = reader({ openspecGroupParallel: 9 });
    for (let i = 0; i < 5; i++) read({ effectiveMaxTeammates: 5 });
    expect(logs.warn).toHaveLength(1);
  });
});

describe("names and refs (7.10 #E5)", () => {
  it.each([
    ["ship-it", true],
    ["a", true],
    ["a".repeat(64), true],
    ["a".repeat(65), false],
    ["Ship", false],
    ["x/y", false],
    ["", false],
    ["-a", false],
  ])("openspecShipSkill %j → valid %s", (v, valid) => {
    const r = reader({ openspecShipSkill: v, openspecReviewSkill: v }).read();
    expect(r.ok).toBe(valid);
    if (!r.ok) expect(r.key).toBe("openspecShipSkill");
  });

  const refs: Array<[string, boolean]> = [["develop", true], ["origin/develop", true], ["--upload-pack=x", false], ["-x", false], ["a..b", false], ["a b", false], ["HEAD", false], ["@{-1}", false], ["refs/heads/x", true], ["x.lock", false], ["é", true]];

  it.each(refs)("openspecWorktreeBase / openspecMergeBase %j → valid %s", (v, valid) => {
    expect(reader({ openspecWorktreeBase: v }).read().ok).toBe(valid);
    expect(reader({ openspecMergeBase: v }).read().ok).toBe(valid);
  });

  it("agrees with `git check-ref-format --branch` for every value that is not option-like", () => {
    for (const [v] of refs) {
      if (v.startsWith("-") || v.includes("@{")) continue;
      let git = true;
      try {
        execFileSync("git", ["check-ref-format", "--branch", v], { cwd: os.tmpdir(), stdio: "ignore" });
      } catch {
        git = false;
      }
      expect(isValidBranchRef(v), v).toBe(git);
    }
  });

  it("rejects non-strings, control characters and over-long refs without running git", () => {
    for (const v of [undefined, null, 1, {}, "a\u0000b", "a\nb", "x".repeat(300)]) expect(isValidBranchRef(v)).toBe(false);
  });

  it("an invalid value names its key", () => {
    expect(reader({ openspecMergeBase: "a..b" }).read()).toMatchObject({ ok: false, key: "openspecMergeBase" });
    expect(reader({ openspecWorktreeBase: "--upload-pack=x" }).read()).toMatchObject({ ok: false, key: "openspecWorktreeBase" });
  });
});

describe("openspecLockTtlMs clamp (7.11 #E27, config part)", () => {
  it.each([
    [1_800_000, 1_800_000, false],
    [0, LOCK_TTL_RANGE.min, true],
    [-1, LOCK_TTL_RANGE.min, true],
    [1, LOCK_TTL_RANGE.min, true],
    [2 ** 31 - 1, LOCK_TTL_RANGE.max, true],
    [2 ** 31, LOCK_TTL_RANGE.max, true],
    [3e9, LOCK_TTL_RANGE.max, true],
    [60_000, 60_000, false],
    [86_400_000, 86_400_000, false],
  ])("%s → %s (clamp line: %s)", (v, want, clamped) => {
    const { read, logs } = reader({ openspecLockTtlMs: v });
    expect(ok(read()).lockTtlMs).toBe(want);
    expect(logs.warn.some((l) => l.includes("outside"))).toBe(clamped);
  });

  it("NaN / non-integers use the default with a warning", () => {
    const { read, logs } = reader({ openspecLockTtlMs: Number.NaN });
    expect(ok(read()).lockTtlMs).toBe(1_800_000);
    expect(logs.warn).toHaveLength(1);
    expect(ok(reader({ openspecLockTtlMs: 1.5 }).read()).lockTtlMs).toBe(1_800_000);
  });

  it("never exceeds what setTimeout accepts", () => {
    for (const v of [3e9, 2 ** 53, Number.MAX_SAFE_INTEGER]) expect(ok(reader({ openspecLockTtlMs: v }).read()).lockTtlMs).toBeLessThanOrEqual(2 ** 31 - 1);
  });
});

describe("openspecFetchTimeoutMs (7.12 #E30)", () => {
  it.each([
    [undefined, 8000, 0],
    [1, 1, 0],
    [8000, 8000, 0],
    [10000, 10000, 0],
    [10001, FETCH_TIMEOUT_MAX_MS, 1],
    [2 ** 40, FETCH_TIMEOUT_MAX_MS, 1],
  ])("%s → %s (%s clamp line)", (v, want, lines) => {
    const { read, logs } = reader(v === undefined ? {} : { openspecFetchTimeoutMs: v });
    expect(ok(read()).fetchTimeoutMs).toBe(want);
    expect(logs.warn.filter((l) => l.includes("outside"))).toHaveLength(lines);
  });

  it.each([[0], [-1], [1.5], ["8000"], [Number.NaN], [null]])("%j → default 8000 + a warning", (v) => {
    const { read, logs } = reader({ openspecFetchTimeoutMs: v });
    expect(ok(read()).fetchTimeoutMs).toBe(8000);
    expect(logs.warn).toHaveLength(1);
  });
});
