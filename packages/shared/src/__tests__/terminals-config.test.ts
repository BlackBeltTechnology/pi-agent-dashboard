/**
 * `terminals.*` config block: PTY caps + inline orphan TTL, fail-safe parsing.
 * See change: harden-server-capability-bounds (test-plan #E5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BROWSE_CONFIG, DEFAULT_TERMINALS_CONFIG, loadConfig, parseBrowseConfig, parseTerminalsConfig } from "../config.js";

describe("parseTerminalsConfig", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("defaults are 32 / 16 / 600000", () => {
    expect(DEFAULT_TERMINALS_CONFIG).toEqual({ maxConcurrent: 32, maxPerOwner: 16, inlineOrphanTtlMs: 600_000 });
    expect(parseTerminalsConfig(undefined)).toEqual(DEFAULT_TERMINALS_CONFIG);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    [0, 32],
    [-1, 32],
    [2.5, 32],
    ["x", 32],
    [1, 1],
    [64, 64],
  ])("maxConcurrent %j -> %j", (raw, want) => {
    const out = parseTerminalsConfig({ maxConcurrent: raw });
    expect(out.maxConcurrent).toBe(want);
    // one warn line per invalid value, none for a valid one
    expect(warn).toHaveBeenCalledTimes(want === raw ? 0 : 1);
  });

  it("applies the same rule to maxPerOwner and inlineOrphanTtlMs", () => {
    const out = parseTerminalsConfig({ maxPerOwner: 0, inlineOrphanTtlMs: 1.5 });
    expect(out.maxPerOwner).toBe(16);
    expect(out.inlineOrphanTtlMs).toBe(600_000);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(parseTerminalsConfig({ maxPerOwner: 4, inlineOrphanTtlMs: 5000 })).toMatchObject({
      maxPerOwner: 4,
      inlineOrphanTtlMs: 5000,
    });
  });

  it("a non-object block falls back to defaults without throwing", () => {
    expect(parseTerminalsConfig("nope")).toEqual(DEFAULT_TERMINALS_CONFIG);
    expect(parseTerminalsConfig(null)).toEqual(DEFAULT_TERMINALS_CONFIG);
  });
});

describe("loadConfig terminals block", () => {
  let testDir: string;
  let origHome: string;
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "terminals-config-"));
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("is read from config.json and defaults when absent", () => {
    expect(loadConfig().terminals).toEqual(DEFAULT_TERMINALS_CONFIG);
    fs.writeFileSync(
      path.join(testDir, ".pi", "dashboard", "config.json"),
      JSON.stringify({ terminals: { maxConcurrent: 2 } }),
    );
    expect(loadConfig().terminals).toEqual({ ...DEFAULT_TERMINALS_CONFIG, maxConcurrent: 2 });
  });
});

describe("browse.confineRemote", () => {
  it("defaults to true; only an explicit false disables it", () => {
    expect(DEFAULT_BROWSE_CONFIG).toEqual({ confineRemote: true });
    expect(parseBrowseConfig(undefined)).toEqual({ confineRemote: true });
    expect(parseBrowseConfig({})).toEqual({ confineRemote: true });
    expect(parseBrowseConfig({ confineRemote: false })).toEqual({ confineRemote: false });
    for (const v of [0, "false", null, "no"]) expect(parseBrowseConfig({ confineRemote: v })).toEqual({ confineRemote: true });
    expect(parseBrowseConfig("nope")).toEqual({ confineRemote: true });
  });
});
