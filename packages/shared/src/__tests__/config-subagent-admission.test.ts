/**
 * Config resolution for subagent fan-out admission — `maxConcurrentSubagents`
 * and the optional saturation thresholds.
 *
 * See change: bound-subagent-fanout-under-host-pressure (D1/D5/D6).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_CONCURRENT_SUBAGENTS,
  loadConfig,
  parseSubagentSaturation,
  resolveMaxConcurrentSubagents,
} from "../config.js";

describe("resolveMaxConcurrentSubagents", () => {
  it("resolves an absent value to the active default", () => {
    expect(resolveMaxConcurrentSubagents(undefined)).toBe(DEFAULT_MAX_CONCURRENT_SUBAGENTS);
    expect(DEFAULT_MAX_CONCURRENT_SUBAGENTS).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_MAX_CONCURRENT_SUBAGENTS).toBeLessThan(3);
  });

  it("honours an explicit non-negative integer, including the 0 disable value", () => {
    expect(resolveMaxConcurrentSubagents(0)).toBe(0);
    expect(resolveMaxConcurrentSubagents(1)).toBe(1);
    expect(resolveMaxConcurrentSubagents(5)).toBe(5);
  });

  it("resolves malformed values to the fail-open (uncapped) path, never to 0", () => {
    for (const raw of [-1, 1.5, "two", null, {}, true, Number.NaN]) {
      const resolved = resolveMaxConcurrentSubagents(raw);
      expect(resolved).toBe(Number.POSITIVE_INFINITY);
      expect(resolved).not.toBe(0);
    }
  });
});

describe("parseSubagentSaturation", () => {
  it("keeps only positive finite thresholds", () => {
    expect(
      parseSubagentSaturation({ eventLoopDelayMs: 500, cpuPercent: 80, loadAvg1m: 4 }),
    ).toEqual({ eventLoopDelayMs: 500, cpuPercent: 80, loadAvg1m: 4 });
  });

  it("drops non-positive / non-numeric thresholds and collapses to undefined", () => {
    expect(parseSubagentSaturation({ eventLoopDelayMs: 0, cpuPercent: -1, loadAvg1m: "x" })).toBeUndefined();
    expect(parseSubagentSaturation({ eventLoopDelayMs: 0, cpuPercent: 90 })).toEqual({ cpuPercent: 90 });
    expect(parseSubagentSaturation(undefined)).toBeUndefined();
    expect(parseSubagentSaturation("nope")).toBeUndefined();
  });
});

describe("loadConfig maxConcurrentSubagents + saturation round-trip", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-admission-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("defaults to an active cap when the key is absent", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
    const cfg = loadConfig();
    expect(cfg.maxConcurrentSubagents).toBe(DEFAULT_MAX_CONCURRENT_SUBAGENTS);
    expect(cfg.subagentSaturation).toBeUndefined();
  });

  it("honours an explicit stored value and parses thresholds", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ maxConcurrentSubagents: 3, subagentSaturation: { loadAvg1m: 4 } }),
    );
    const cfg = loadConfig();
    expect(cfg.maxConcurrentSubagents).toBe(3);
    expect(cfg.subagentSaturation).toEqual({ loadAvg1m: 4 });
  });

  it("round-trips the explicit 0 disable value", () => {
    fs.writeFileSync(configFile, JSON.stringify({ maxConcurrentSubagents: 0 }));
    expect(loadConfig().maxConcurrentSubagents).toBe(0);
  });

  it("fails open on a malformed stored value", () => {
    fs.writeFileSync(configFile, JSON.stringify({ maxConcurrentSubagents: "lots" }));
    expect(loadConfig().maxConcurrentSubagents).toBe(Number.POSITIVE_INFINITY);
  });
});
