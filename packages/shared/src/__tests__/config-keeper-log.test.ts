/**
 * keeperLog config parse boundaries (test-plan #E7).
 *
 * `parseKeeperLogConfig` previously dropped unknown keys, so an operator
 * setting `keeperLog.maxBytes` saw it silently discarded — a silent
 * misconfiguration. These tests pin: valid values pass through; every invalid
 * variant (0, negative, non-numeric, absent) coerces to the default; and the
 * pre-existing `capturePiOutput` field is unaffected.
 * See change: fix-runaway-keeper-log-growth (D7, task 1.2).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_KEEPER_LOG, loadConfig } from "../config.js";

let tmpHome: string;
let realHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "klog-cfg-"));
  realHome = process.env.HOME ?? "";
  process.env.HOME = tmpHome;
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

function configPath(): string {
  return path.join(tmpHome, ".pi", "dashboard", "config.json");
}

function seedKeeperLog(keeperLog: Record<string, unknown>): void {
  mkdirSync(path.dirname(configPath()), { recursive: true });
  // loadConfig merges over defaults; only keeperLog is seeded per case.
  writeFileSync(configPath(), JSON.stringify({ keeperLog }));
}

describe("parseKeeperLogConfig — maxBytes / checkIntervalMs (test-plan #E7)", () => {
  it("valid maxBytes=1048576 survives the parse", () => {
    seedKeeperLog({ maxBytes: 1048576 });
    expect(loadConfig().keeperLog.maxBytes).toBe(1048576);
  });

  it("valid checkIntervalMs passes through", () => {
    seedKeeperLog({ checkIntervalMs: 250 });
    expect(loadConfig().keeperLog.checkIntervalMs).toBe(250);
  });

  it.each([0, -1, -1048576, "big", "1048576", null, true, 1.5, Number.NaN])(
    "invalid maxBytes %p coerces to the default",
    (variant) => {
      seedKeeperLog({ maxBytes: variant });
      expect(loadConfig().keeperLog.maxBytes).toBe(DEFAULT_KEEPER_LOG.maxBytes);
    },
  );

  it.each([0, -1, "fast", null, Number.NaN])(
    "invalid checkIntervalMs %p coerces to the default",
    (variant) => {
      seedKeeperLog({ checkIntervalMs: variant });
      expect(loadConfig().keeperLog.checkIntervalMs).toBe(DEFAULT_KEEPER_LOG.checkIntervalMs);
    },
  );

  it("absent keeperLog block → all defaults", () => {
    mkdirSync(path.dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({}));
    expect(loadConfig().keeperLog).toEqual(DEFAULT_KEEPER_LOG);
  });

  it("both fields set in one block → both parsed", () => {
    seedKeeperLog({ maxBytes: 65536, checkIntervalMs: 250 });
    const parsed = loadConfig().keeperLog;
    expect(parsed.maxBytes).toBe(65536);
    expect(parsed.checkIntervalMs).toBe(250);
  });

  it("capturePiOutput is unaffected by the new fields", () => {
    seedKeeperLog({ capturePiOutput: true, maxBytes: 65536 });
    const parsed = loadConfig().keeperLog;
    expect(parsed.capturePiOutput).toBe(true);
    expect(parsed.maxBytes).toBe(65536);

    seedKeeperLog({ capturePiOutput: false });
    expect(loadConfig().keeperLog.capturePiOutput).toBe(false);
    expect(loadConfig().keeperLog.maxBytes).toBe(DEFAULT_KEEPER_LOG.maxBytes);
  });

  it("DEFAULT_KEEPER_LOG carries the documented defaults (128 MiB / 5 s)", () => {
    expect(DEFAULT_KEEPER_LOG.maxBytes).toBe(134217728);
    expect(DEFAULT_KEEPER_LOG.checkIntervalMs).toBe(5000);
    expect(DEFAULT_KEEPER_LOG.capturePiOutput).toBe(false);
  });

  it("malformed config.json still yields defaults (no throw)", () => {
    mkdirSync(path.dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), "{not json");
    expect(() => readFileSync(configPath(), "utf8")).not.toThrow();
    expect(loadConfig().keeperLog).toEqual(DEFAULT_KEEPER_LOG);
  });
});
