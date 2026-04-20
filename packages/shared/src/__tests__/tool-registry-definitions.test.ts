/**
 * Tests for the standard tool definitions (strategies + registration).
 *
 * We inject fake `exists` / `which` / `npmRootGlobal` so tests are
 * deterministic across platforms and don't depend on the test host's
 * real filesystem or PATH.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  ToolRegistry,
  registerDefaultTools,
  OverridesStore,
} from "../tool-registry/index.js";

function freshRegistry(opts: {
  exists?: (p: string) => boolean;
  which?: (name: string) => string | null;
  npmRootGlobal?: () => string;
  overrides?: Record<string, string>;
  platform?: NodeJS.Platform;
}) {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `tool-registry-test-${Math.random()}.json`),
    warn: () => {},
  });
  for (const [k, v] of Object.entries(opts.overrides ?? {})) store.set(k, v);

  const r = new ToolRegistry({
    overrides: store,
    platform: opts.platform ?? "linux",
  });
  registerDefaultTools(r, {
    exists: opts.exists ?? (() => false),
    which: opts.which ?? (() => null),
    npmRootGlobal: opts.npmRootGlobal ?? (() => ""),
  });
  return r;
}

describe("pi binary definition", () => {
  it("chain order: override → managed → where", () => {
    const r = freshRegistry({ which: (n) => (n === "pi" ? "/usr/bin/pi" : null) });
    const res = r.resolve("pi");
    expect(res.tried.map((t) => t.strategy)).toEqual([
      "override",
      "managed",
      "where",
    ]);
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/usr/bin/pi");
    expect(res.source).toBe("system");
  });

  it("managed wins over system when MANAGED_BIN/pi exists", () => {
    const managed = path.join(os.homedir(), ".pi-dashboard", "node_modules", ".bin", "pi");
    const r = freshRegistry({
      exists: (p) => p === managed,
      which: () => "/usr/bin/pi",
      platform: "linux",
    });
    const res = r.resolve("pi");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(managed);
    expect(res.source).toBe("managed");
  });

  it("picks .cmd extension on Windows", () => {
    const managed = path.join(os.homedir(), ".pi-dashboard", "node_modules", ".bin", "pi.cmd");
    const r = freshRegistry({
      exists: (p) => p === managed,
      platform: "win32",
    });
    const res = r.resolve("pi");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(managed);
  });

  it("override wins when set and path exists", () => {
    const custom = "/opt/custom/pi";
    const r = freshRegistry({
      overrides: { pi: custom },
      exists: (p) => p === custom, // validate() passes
    });
    const res = r.resolve("pi");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(custom);
    expect(res.source).toBe("override");
  });

  it("invalid override falls through to next strategy with 'invalid:' reason", () => {
    const r = freshRegistry({
      overrides: { pi: "/does/not/exist" },
      which: () => "/usr/bin/pi",
      exists: (p) => p === "/usr/bin/pi", // override path fails validate
    });
    const res = r.resolve("pi");
    expect(res.ok).toBe(true);
    expect(res.source).toBe("system");
    expect(res.tried[0].strategy).toBe("override");
    expect(res.tried[0].result).toMatch(/^invalid:/);
  });
});

describe("pi-coding-agent module definition", () => {
  it("probes both @mariozechner and @oh-my-pi alias names", () => {
    const r = freshRegistry({ exists: () => false });
    const res = r.resolve("pi-coding-agent");
    const names = res.tried.map((t) => t.strategy);
    // First strategy: override. Then two bare-import (one per alias),
    // then two managed, then two npm-global.
    expect(names[0]).toBe("override");
    expect(names.filter((n) => n === "bare-import").length).toBe(2);
    expect(names.filter((n) => n === "managed").length).toBe(2);
    expect(names.filter((n) => n === "npm-global").length).toBe(2);
  });

  it("managed strategy hits ~/.pi-dashboard/node_modules/<pkg>/dist/index.js", () => {
    const managed = path.join(
      os.homedir(), ".pi-dashboard", "node_modules",
      "@mariozechner", "pi-coding-agent", "dist", "index.js",
    );
    const r = freshRegistry({ exists: (p) => p === managed });
    const res = r.resolve("pi-coding-agent");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(managed);
    expect(res.source).toBe("managed");
  });

  it("npm-global strategy uses <npm root -g>/<pkg>/dist/index.js", () => {
    const npmRoot = "/npm/global/root";
    const entry = path.join(npmRoot, "@mariozechner", "pi-coding-agent", "dist", "index.js");
    const r = freshRegistry({
      exists: (p) => p === entry,
      npmRootGlobal: () => npmRoot,
    });
    const res = r.resolve("pi-coding-agent");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(entry);
    expect(res.source).toBe("npm-global");
  });

  it("fails cleanly when no strategy succeeds", () => {
    const r = freshRegistry({
      exists: () => false,
      npmRootGlobal: () => "",
    });
    const res = r.resolve("pi-coding-agent");
    expect(res.ok).toBe(false);
    expect(res.path).toBeNull();
    expect(res.source).toBeNull();
    // Trail should include override + 2 bare-import + 2 managed + 2 npm-global.
    expect(res.tried.length).toBeGreaterThanOrEqual(5);
    expect(res.tried.some((t) => t.strategy === "npm-global")).toBe(true);
  });
});

describe("openspec binary definition", () => {
  it("finds openspec.cmd under managed bin on Windows", () => {
    const managed = path.join(os.homedir(), ".pi-dashboard", "node_modules", ".bin", "openspec.cmd");
    const r = freshRegistry({ exists: (p) => p === managed, platform: "win32" });
    const res = r.resolve("openspec");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(managed);
  });

  it("falls through managed → where on Unix when managed is absent", () => {
    const r = freshRegistry({
      exists: () => false,
      which: (n) => (n === "openspec" ? "/usr/local/bin/openspec" : null),
      platform: "darwin",
    });
    const res = r.resolve("openspec");
    expect(res.ok).toBe(true);
    expect(res.source).toBe("system");
    expect(res.path).toBe("/usr/local/bin/openspec");
  });
});

describe("registered tool set", () => {
  it("registers pi, pi-coding-agent, openspec, npm, node, git, zrok, wt", () => {
    const r = freshRegistry({});
    for (const name of ["pi", "pi-coding-agent", "openspec", "npm", "node", "git", "zrok", "wt"]) {
      expect(r.has(name)).toBe(true);
    }
  });

  it("wt resolves via where when found", () => {
    const r = freshRegistry({
      platform: "win32",
      which: (name) => (name === "wt" ? "C:\\WindowsApps\\wt.exe" : null),
    });
    const res = r.resolve("wt");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("C:\\WindowsApps\\wt.exe");
    expect(res.source).toBe("system");
  });

  it("wt unavailable returns ok:false without error", () => {
    const r = freshRegistry({ platform: "win32", which: () => null });
    const res = r.resolve("wt");
    expect(res.ok).toBe(false);
  });

  it("does NOT register tsx (it's a loader, not a spawn target)", () => {
    const r = freshRegistry({});
    expect(r.has("tsx")).toBe(false);
  });

  it("registers Windows-only process utilities on win32, NOT ps/pgrep", () => {
    const r = freshRegistry({ platform: "win32" });
    expect(r.has("tasklist")).toBe(true);
    expect(r.has("taskkill")).toBe(true);
    expect(r.has("wmic")).toBe(true);
    expect(r.has("powershell")).toBe(true);
    // ps/pgrep are POSIX-only; they'd always show "not found" on Windows
    // and pollute the Tools UI with red rows the code never calls.
    expect(r.has("ps")).toBe(false);
    expect(r.has("pgrep")).toBe(false);
  });

  it("registers POSIX process utilities on linux/darwin, NOT tasklist etc.", () => {
    for (const platform of ["linux", "darwin"] as NodeJS.Platform[]) {
      const r = freshRegistry({ platform });
      expect(r.has("ps")).toBe(true);
      expect(r.has("pgrep")).toBe(true);
      expect(r.has("tasklist")).toBe(false);
      expect(r.has("taskkill")).toBe(false);
      expect(r.has("wmic")).toBe(false);
      expect(r.has("powershell")).toBe(false);
    }
  });

  it("does NOT register pi-dashboard (it's the package this code is part of)", () => {
    const r = freshRegistry({});
    expect(r.has("pi-dashboard")).toBe(false);
  });
});
