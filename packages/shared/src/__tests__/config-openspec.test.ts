import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, DEFAULT_OPENSPEC_POLL } from "../config.js";

describe("loadConfig — openspec poll block", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-openspec-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("applies all defaults when openspec block is missing", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
    const cfg = loadConfig();
    expect(cfg.openspec).toEqual(DEFAULT_OPENSPEC_POLL);
    expect(cfg.openspec.pollIntervalSeconds).toBe(60);
    expect(cfg.openspec.maxConcurrentSpawns).toBe(3);
    expect(cfg.openspec.changeDetection).toBe("mtime");
    expect(cfg.openspec.jitterSeconds).toBe(5);
  });

  it("accepts valid values", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      openspec: { pollIntervalSeconds: 60, maxConcurrentSpawns: 5, changeDetection: "always", jitterSeconds: 10 },
    }));
    const cfg = loadConfig();
    expect(cfg.openspec.pollIntervalSeconds).toBe(60);
    expect(cfg.openspec.maxConcurrentSpawns).toBe(5);
    expect(cfg.openspec.changeDetection).toBe("always");
    expect(cfg.openspec.jitterSeconds).toBe(10);
  });

  it("clamps pollIntervalSeconds below the minimum (5)", () => {
    fs.writeFileSync(configFile, JSON.stringify({ openspec: { pollIntervalSeconds: 1 } }));
    expect(loadConfig().openspec.pollIntervalSeconds).toBe(5);
  });

  it("clamps pollIntervalSeconds above the maximum (3600)", () => {
    fs.writeFileSync(configFile, JSON.stringify({ openspec: { pollIntervalSeconds: 999_999 } }));
    expect(loadConfig().openspec.pollIntervalSeconds).toBe(3600);
  });

  it("clamps maxConcurrentSpawns to [1, 16]", () => {
    fs.writeFileSync(configFile, JSON.stringify({ openspec: { maxConcurrentSpawns: 0 } }));
    expect(loadConfig().openspec.maxConcurrentSpawns).toBe(1);

    fs.writeFileSync(configFile, JSON.stringify({ openspec: { maxConcurrentSpawns: 100 } }));
    expect(loadConfig().openspec.maxConcurrentSpawns).toBe(16);
  });

  it("clamps jitterSeconds to [0, 60]", () => {
    fs.writeFileSync(configFile, JSON.stringify({ openspec: { jitterSeconds: -5 } }));
    expect(loadConfig().openspec.jitterSeconds).toBe(0);

    fs.writeFileSync(configFile, JSON.stringify({ openspec: { jitterSeconds: 120 } }));
    expect(loadConfig().openspec.jitterSeconds).toBe(60);
  });

  it("falls back to 'mtime' when changeDetection is unknown", () => {
    fs.writeFileSync(configFile, JSON.stringify({ openspec: { changeDetection: "bogus" } }));
    expect(loadConfig().openspec.changeDetection).toBe("mtime");
  });

  it("coerces non-number values to defaults", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      openspec: { pollIntervalSeconds: "thirty", maxConcurrentSpawns: null, jitterSeconds: undefined },
    }));
    const cfg = loadConfig();
    expect(cfg.openspec.pollIntervalSeconds).toBe(60);
    expect(cfg.openspec.maxConcurrentSpawns).toBe(3);
    expect(cfg.openspec.jitterSeconds).toBe(5);
  });

  it("ignores unknown keys in the openspec block", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      openspec: { pollIntervalSeconds: 45, nonsenseField: "ignored", another: 42 },
    }));
    const cfg = loadConfig();
    expect(cfg.openspec.pollIntervalSeconds).toBe(45);
    expect((cfg.openspec as any).nonsenseField).toBeUndefined();
    expect((cfg.openspec as any).another).toBeUndefined();
  });

  it("is stable through round-trip (load → stringify → load)", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      openspec: { pollIntervalSeconds: 90, maxConcurrentSpawns: 4, changeDetection: "always", jitterSeconds: 12 },
    }));
    const first = loadConfig();
    fs.writeFileSync(configFile, JSON.stringify(first));
    const second = loadConfig();
    expect(second.openspec).toEqual(first.openspec);
  });
});

describe("loadConfig — openspec.enabled (auto-hide-empty-session-subcards)", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `test-config-openspec-enabled-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("defaults to true when openspec block is absent", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
    expect(loadConfig().openspec.enabled).toBe(true);
  });

  it("defaults to true when openspec block has other fields but no `enabled`", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ openspec: { pollIntervalSeconds: 60 } }),
    );
    expect(loadConfig().openspec.enabled).toBe(true);
  });

  it("preserves explicit `false`", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ openspec: { enabled: false } }),
    );
    const cfg = loadConfig();
    expect(cfg.openspec.enabled).toBe(false);
    // sibling fields keep their defaults
    expect(cfg.openspec.pollIntervalSeconds).toBe(60);
  });

  it("preserves explicit `true`", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ openspec: { enabled: true } }),
    );
    expect(loadConfig().openspec.enabled).toBe(true);
  });

  it("falls back to default true on non-boolean", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ openspec: { enabled: "yes" } }),
    );
    expect(loadConfig().openspec.enabled).toBe(true);
  });

  it("round-trips through load → stringify → load", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ openspec: { enabled: false, pollIntervalSeconds: 90 } }),
    );
    const first = loadConfig();
    fs.writeFileSync(configFile, JSON.stringify(first));
    const second = loadConfig();
    expect(second.openspec.enabled).toBe(false);
    expect(second.openspec.pollIntervalSeconds).toBe(90);
  });
});
