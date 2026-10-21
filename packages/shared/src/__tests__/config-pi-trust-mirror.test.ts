import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectiveLiveQueryTimeoutMs, loadConfig, parsePiTrustMirror } from "../config.js";

/**
 * `piTrustMirror` loader defaults (test-plan #E21).
 * See change: mirror-dashboard-trust-to-pi, mirror-dashboard-trust-live-remote (#E1).
 */
let dir: string;
let origHome: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-trust-mirror-"));
  origHome = process.env.HOME!;
  process.env.HOME = dir;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(value: unknown): void {
  fs.mkdirSync(path.join(dir, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".pi", "dashboard", "config.json"), JSON.stringify(value));
}

describe("piTrustMirror loader (#E21)", () => {
  it("absent group → defaults (enabled, no interactive, accessGrants off, rest on)", () => {
    write({});
    expect(loadConfig().piTrustMirror).toEqual({
      enabled: true,
      coverInteractive: false,
      liveQuery: true,
      sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false, yolo: true },
    });
  });

  it("partial { enabled:false } merges over defaults", () => {
    write({ piTrustMirror: { enabled: false } });
    const cfg = loadConfig().piTrustMirror;
    expect(cfg.enabled).toBe(false);
    expect(cfg.coverInteractive).toBe(false);
    expect(cfg.sources.pinned).toBe(true);
    expect(cfg.sources.accessGrants).toBe(false);
  });

  it("partial sources merge; non-boolean values fall back to defaults", () => {
    write({ piTrustMirror: { coverInteractive: "yes", sources: { pinned: false, accessGrants: true, workflow: 1 } } });
    const cfg = loadConfig().piTrustMirror;
    expect(cfg.coverInteractive).toBe(false);
    expect(cfg.sources).toMatchObject({ pinned: false, accessGrants: true, workflow: true, worktreeInit: true });
  });
});

describe("live query settings (#E1)", () => {
  const cases: Array<[string, unknown, number, number]> = [
    ["unset", undefined, 300, 1000],
    ["49 clamps up", 49, 50, 50],
    ["50", 50, 50, 50],
    ["1000", 1000, 1000, 1000],
    ["1001 clamps down", 1001, 1000, 1000],
    ["5000 clamps down", 5000, 1000, 1000],
    ["-1 clamps up", -1, 50, 50],
    ["NaN reads as default", Number.NaN, 300, 1000],
    ["Infinity reads as default", Number.POSITIVE_INFINITY, 300, 1000],
    ['"300" (string) reads as default', "300", 300, 1000],
  ];
  it.each(cases)("liveQueryTimeoutMs %s", (_name, raw, local, remote) => {
    const cfg = parsePiTrustMirror(raw === undefined ? {} : { liveQueryTimeoutMs: raw });
    expect(effectiveLiveQueryTimeoutMs(cfg, false)).toBe(local);
    expect(effectiveLiveQueryTimeoutMs(cfg, true)).toBe(remote);
  });

  it("liveQuery and sources.yolo default true; explicit false is honoured; non-boolean falls back", () => {
    expect(parsePiTrustMirror({}).liveQuery).toBe(true);
    expect(parsePiTrustMirror({}).sources.yolo).toBe(true);
    expect(parsePiTrustMirror({ liveQuery: false, sources: { yolo: false } })).toMatchObject({
      liveQuery: false,
      sources: { yolo: false },
    });
    expect(parsePiTrustMirror({ liveQuery: "no", sources: { yolo: 0 } })).toMatchObject({
      liveQuery: true,
      sources: { yolo: true },
    });
  });

  it("loadConfig carries the live fields from disk", () => {
    write({ piTrustMirror: { liveQuery: false, liveQueryTimeoutMs: 700 } });
    const cfg = loadConfig().piTrustMirror;
    expect(cfg.liveQuery).toBe(false);
    expect(effectiveLiveQueryTimeoutMs(cfg, false)).toBe(700);
  });
});
