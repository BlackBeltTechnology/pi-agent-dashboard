/**
 * Publication write path for `runtime.resolved` — the server half of design
 * D8 (change unify-pi-runtime-identity; tasks 4.1/4.2, folded test tasks
 * 9.6/9.7/9.22). The block SHAPES are already unit-tested against
 * `buildPublishedRuntimeBlock` in packages/shared/src/__tests__/spawn-runtime.test.ts
 * (test-plan E6 read half); these tests cover the write: raw-JSON
 * round-trip, override preservation, corrupt-config bail, leftover-tmp
 * safety, stale-block non-steering, and the `pi-dashboard runtime` print.
 *
 * Exemplar: packages/shared/src/__tests__/spawn-runtime.test.ts
 * (ResolvedRuntime fixture + injectable-probe style).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ResolvedRuntime,
  type ResolveSpawnRuntimeOpts,
  resolveSpawnRuntime,
} from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-runtime.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdRuntime } from "../cli.js";
import { publishResolvedRuntime, readPublishedRuntimeBlock } from "../runtime-publication.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "runtime-publication-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** A per-test config path inside the tmp dir. */
function configPath(name = "config.json"): string {
  return path.join(tmp, name);
}

/** Write JSON config (creating parents). */
function writeConfig(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

// ── Fixtures (mirror spawn-runtime.test.ts base shape) ──────────────────────

const base = {
  version: "v25.1.0",
  identity: null,
  trail: [],
  piFloor: "22.19.0",
  piFloorSource: "fallback" as const,
  arm: "npm" as const,
};

const userRt: ResolvedRuntime = {
  ...base,
  nodeBinary: "/home/u/.nvm/versions/node/v25.1.0/bin/node",
  nodeBinDir: "/home/u/.nvm/versions/node/v25.1.0/bin",
  abi: 141,
  source: "system",
  rung: "user",
  resolvedAt: "2026-08-30T00:00:00.000Z",
};

const bundledRt: ResolvedRuntime = {
  ...base,
  nodeBinary: "/Applications/App.app/Contents/Resources/node/bin/node",
  nodeBinDir: "/Applications/App.app/Contents/Resources/node/bin",
  abi: 137,
  source: "bundled-electron",
  rung: "bundled",
  resolvedAt: "2026-08-30T00:00:00.000Z",
};

/** Touch a file (and parents) so `existsSync` sees a candidate binary. */
function touch(p: string): string {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "");
  return p;
}

// ── E6 write half (task 9.6) ────────────────────────────────────────────────

describe("publishResolvedRuntime — E6 write half (task 9.6)", () => {
  it("user runtime: override round-trips identical, unknown keys survive, full block persisted", () => {
    const cfg = configPath();
    writeConfig(cfg, {
      port: 8123,
      runtime: { override: "/opt/node22/bin/node", keep: "me" },
      customTopLevel: { nested: { deep: true } },
      listKey: [1, 2, 3],
    });

    const { block, written } = publishResolvedRuntime(userRt, { configPath: cfg });

    expect(written).toBe(true);
    const after = JSON.parse(readFileSync(cfg, "utf-8"));
    // User-owned override: byte-identical string value before/after (never written).
    expect(after.runtime.override).toBe("/opt/node22/bin/node");
    // Sibling + unknown keys survive.
    expect(after.runtime.keep).toBe("me");
    expect(after.customTopLevel).toEqual({ nested: { deep: true } });
    expect(after.listKey).toEqual([1, 2, 3]);
    expect(after.port).toBe(8123);
    // The block carries the full outside-bundle shape.
    expect(after.runtime.resolved).toEqual(block);
    expect(block).toEqual({
      nodeBinDir: "/home/u/.nvm/versions/node/v25.1.0/bin",
      nodeBinary: "/home/u/.nvm/versions/node/v25.1.0/bin/node",
      abi: 141,
      source: "system",
      resolvedAt: "2026-08-30T00:00:00.000Z",
    });
  });

  it("bundled runtime: persisted block is path-free", () => {
    const cfg = configPath();
    writeConfig(cfg, { runtime: { override: "/opt/node22/bin/node" } });

    const { block, written } = publishResolvedRuntime(bundledRt, { configPath: cfg });

    expect(written).toBe(true);
    const after = JSON.parse(readFileSync(cfg, "utf-8"));
    expect(after.runtime.resolved).toEqual(block);
    expect(block).toEqual({
      source: "bundled-electron",
      abi: 137,
      resolvedAt: "2026-08-30T00:00:00.000Z",
    });
    expect(JSON.stringify(after.runtime.resolved)).not.toMatch(/App\.app|nodeBinary/);
    // Override still intact alongside the path-free block.
    expect(after.runtime.override).toBe("/opt/node22/bin/node");
  });

  it("publishes into an absent config (creates the file)", () => {
    const cfg = configPath("nested/absent-config.json");
    const { written } = publishResolvedRuntime(userRt, { configPath: cfg });
    expect(written).toBe(true);
    const after = JSON.parse(readFileSync(cfg, "utf-8"));
    expect(after.runtime.resolved.nodeBinary).toBe(userRt.nodeBinary);
  });
});

// ── X4 write safety (task 9.22) ─────────────────────────────────────────────

describe("publishResolvedRuntime — write safety X4 (task 9.22)", () => {
  it("(a) leftover .tmp from an interrupted write is overwritten, config intact", () => {
    const cfg = configPath();
    writeConfig(cfg, { port: 1, runtime: { override: "/x/node" } });
    // Simulate an interrupted atomic write: garbage left at the tmp path.
    writeFileSync(`${cfg}.tmp`, "{ this is garbage from an interrupted write");

    const { written } = publishResolvedRuntime(userRt, { configPath: cfg });

    expect(written).toBe(true);
    // The tmp file was consumed by the rename — never left behind to be
    // mistaken for config later.
    expect(existsSync(`${cfg}.tmp`)).toBe(false);
    const after = JSON.parse(readFileSync(cfg, "utf-8")); // throws if truncated
    expect(after.runtime.resolved.abi).toBe(141);
    expect(after.runtime.override).toBe("/x/node");
    expect(after.port).toBe(1);
  });

  it("(b) corrupt config: bails, file byte-identical, warning logged", () => {
    const cfg = configPath();
    mkdirSync(path.dirname(cfg), { recursive: true });
    writeFileSync(cfg, "{ not json");
    const before = readFileSync(cfg, "utf-8");
    const warn = vi.fn();

    const { block, written } = publishResolvedRuntime(userRt, { configPath: cfg, warn });

    expect(written).toBe(false);
    expect(readFileSync(cfg, "utf-8")).toBe(before);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/corrupt\/unparseable/);
    // The would-be block is still returned for the caller's log line.
    expect(block.abi).toBe(141);
  });

  it("(c) unknown keys + nested objects survive the round-trip", () => {
    const cfg = configPath();
    const rich = {
      port: 8000,
      cors: { allowedOrigins: ["https://a.example", "https://b.example"] },
      sessions: { maxPerWorkspace: 7 },
      totallyUnknown: { deep: { deeper: { leaf: [1, { x: "y" }] } } },
      runtime: { resolved: { stale: "block" }, userNote: "keep me" },
    };
    writeConfig(cfg, rich);

    publishResolvedRuntime(userRt, { configPath: cfg });

    const after = JSON.parse(readFileSync(cfg, "utf-8"));
    expect(after.cors).toEqual(rich.cors);
    expect(after.sessions).toEqual(rich.sessions);
    expect(after.totallyUnknown).toEqual(rich.totallyUnknown);
    expect(after.runtime.userNote).toBe("keep me");
    // The previous resolved block is REPLACED, not merged.
    expect(after.runtime.resolved).not.toHaveProperty("stale");
    expect(after.runtime.resolved.nodeBinary).toBe(userRt.nodeBinary);
  });
});

// ── E7: a stale block never steers resolution (task 9.7) ────────────────────

describe("stale block does not steer — E7 (task 9.7)", () => {
  it("stale runtime.resolved names a deleted binary; ladder resolves fresh and republish overwrites", () => {
    const cfg = configPath();
    writeConfig(cfg, {
      runtime: {
        override: null,
        resolved: {
          nodeBinary: "/gone/deleted/node",
          nodeBinDir: "/gone/deleted",
          abi: 99,
          source: "system",
          resolvedAt: "2020-01-01T00:00:00.000Z",
        },
      },
    });

    // A real, gate-passing user Node the ladder can resolve on its own.
    const userNode = touch(path.join(tmp, "user", "bin", "node"));
    const opts: ResolveSpawnRuntimeOpts = {
      arm: "npm",
      platform: "darwin",
      homedir: path.join(tmp, "home"),
      managedDir: path.join(tmp, "managed"),
      resourcesPath: path.join(tmp, "resources"),
      piEntry: null,
      // Isolation: never consult this process's real config/overrides.
      overrideBinary: null,
      toolOverrideNode: null,
      env: { PATH: "/usr/bin:/bin" },
      pathWhich: (name: string) => (name === "node" ? userNode : null),
      loginShellWhich: () => null,
      versionProbe: () => ({ version: "v25.1.0", abi: 141 }),
      exists: () => true,
    };

    // Resolution is entirely ladder-driven — the published block names a
    // deleted binary and must contribute nothing.
    const fresh = resolveSpawnRuntime(opts);
    expect(fresh.rung).toBe("user"); // not derived from the stale block
    expect(fresh.nodeBinary).toBe(userNode);

    // Republish: the stale path is overwritten, not appended.
    const { written } = publishResolvedRuntime(fresh, { configPath: cfg });
    expect(written).toBe(true);
    const after = JSON.parse(readFileSync(cfg, "utf-8"));
    expect(after.runtime.resolved.nodeBinary).toBe(userNode);
    expect(JSON.stringify(after.runtime.resolved)).not.toMatch(/\/gone\/deleted/);
    expect(readPublishedRuntimeBlock(cfg)?.abi).toBe(141);
  });
});

// ── `pi-dashboard runtime` CLI print (task 4.2 verify) ──────────────────────

describe("cmdRuntime — CLI print (task 4.2)", () => {
  it("prints the published block and a live resolution with binary, version, ABI, source", () => {
    const cfg = configPath();
    writeConfig(cfg, {
      runtime: {
        resolved: {
          nodeBinDir: "/pub",
          nodeBinary: "/pub/node",
          abi: 141,
          source: "system",
          resolvedAt: "2026-08-30T00:00:00.000Z",
        },
      },
    });

    const lines: string[] = [];
    cmdRuntime({ configPath: cfg, resolve: () => userRt, out: (l) => lines.push(l) });
    const text = lines.join("\n");

    // Live half: binary, version, ABI, source (task 4.2 verify).
    expect(text).toContain(userRt.nodeBinary);
    expect(text).toContain(userRt.version);
    expect(text).toContain(String(userRt.abi));
    expect(text).toContain(userRt.source);
    // Published half: the block from config, pretty-printed.
    expect(text).toContain("/pub/node");
    expect(text).toContain("resolvedAt");
  });

  it("notes the canonical floor fallback and the absent published half", () => {
    const lines: string[] = [];
    cmdRuntime({
      configPath: configPath("absent.json"),
      resolve: () => userRt,
      out: (l) => lines.push(l),
    });
    const text = lines.join("\n");

    // userRt.piFloorSource is "fallback" — the CLI has no pi entry context.
    expect(text).toContain("canonical floor");
    expect(text).toMatch(/none — the server has not completed a startup yet/);
  });
});
