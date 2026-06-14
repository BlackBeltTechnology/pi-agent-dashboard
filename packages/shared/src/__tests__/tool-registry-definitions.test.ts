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
  /**
   * Test-isolated module resolver. Defaults to null-returning so the
   * production resolver (which walks the repo's real node_modules) does
   * not leak into chain-order assertions. Tests that exercise the live
   * resolver pass `resolveModule: undefined` and override it explicitly.
   */
  resolveModule?: ((id: string, from: string) => string | null) | null;
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
    // Default-null so bare-import strategies fail in test mode unless
    // the test opts back in. Without this, the new dir-walk fallback in
    // `defaultResolveModule` finds packages on the host's real disk and
    // breaks chain-order assertions. See change:
    // fix-node-resolution-under-electron (follow-up: bare-import
    // exports-map fallback).
    resolveModule:
      opts.resolveModule === null
        ? () => null
        : (opts.resolveModule ?? (() => null)),
  });
  return r;
}

describe("pi binary definition", () => {
  it("chain order: override → bare-import ×2 → managed → where", () => {
    // bare-import strategies probe both pi-coding-agent aliases
    // (@earendil-works + @mariozechner) before falling through to
    // managed-bin and PATH. They fail in this fixture because the
    // injected `exists` returns false for all paths.
    // See change: eliminate-electron-runtime-install F9.
    const r = freshRegistry({
      which: (n) => (n === "pi" ? "/usr/bin/pi" : null),
      // No resolveModule injection — real resolver runs against the
      // repo's node_modules. The bare-import strategy returns a
      // path, but `exists: () => false` invalidates it, so the chain
      // falls through to `where`.
    });
    const res = r.resolve("pi");
    expect(res.tried.map((t) => t.strategy)).toEqual([
      "override",
      "bare-import",
      "bare-import",
      "managed",
      "where",
    ]);
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/usr/bin/pi");
    expect(res.source).toBe("system");
  });

  it("bare-import wins over PATH when bundled cli.js exists (F9)", () => {
    // Simulates the Electron immutable-bundle architecture: a
    // bundled @earendil-works/pi-coding-agent ships inside the
    // server's own node_modules. With no PATH, no managed dir,
    // bare-import must resolve the bundled cli.js — otherwise the
    // server falls into bootstrapInstall() and writes to
    // ~/.pi-dashboard/ (the failure mode F9 documents).
    const bundledPkgJson =
      "/Volumes/PI Dashboard/PI-Dashboard.app/Contents/Resources/server/node_modules/@earendil-works/pi-coding-agent/package.json";
    const bundledCli =
      "/Volumes/PI Dashboard/PI-Dashboard.app/Contents/Resources/server/node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
    const r = new ToolRegistry({
      overrides: new OverridesStore({
        filePath: path.join(os.tmpdir(), `f9-test-${Math.random()}.json`),
        warn: () => {},
      }),
      platform: "linux",
    });
    registerDefaultTools(r, {
      exists: (p) => p === bundledCli, // only the bundled cli.js exists
      which: () => null, // no PATH
      npmRootGlobal: () => "", // no npm-global
      resolveModule: (id, _from) =>
        id === "@earendil-works/pi-coding-agent/package.json"
          ? bundledPkgJson
          : null,
    });
    const res = r.resolve("pi");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(bundledCli);
    expect(res.tried.find((t) => t.strategy === "bare-import")?.result).toBe(
      "ok",
    );
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
  it("probes both @earendil-works (preferred) and @mariozechner (legacy fallback) alias names", () => {
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
  it("registers pi, pi-coding-agent, openspec, npm, npx, node, git, jj, zrok, gh, bash, wt", () => {
    const r = freshRegistry({});
    for (const name of ["pi", "pi-coding-agent", "openspec", "npm", "npx", "node", "git", "jj", "zrok", "gh", "bash", "wt"]) {
      expect(r.has(name)).toBe(true);
    }
  });

  // Chain-order assertions for the bundled-node strategy. See change:
  // fix-node-resolution-under-electron (task 4.3).
  it("node chain: override → bundled-node → managed (runtime) → managed (bin) → where", () => {
    const r = freshRegistry({ exists: () => false, which: () => null });
    const trail = r.resolve("node").tried.map((t) => t.strategy);
    expect(trail).toEqual([
      "override",
      "bundled-node",
      "managed", // managedRuntimeStrategy
      "managed", // managedBinStrategy
      "where",
    ]);
  });

  it("npm chain (Unix): override → bundled-node → managed → where", () => {
    const r = freshRegistry({ exists: () => false, which: () => null, platform: "linux" });
    const trail = r.resolve("npm").tried.map((t) => t.strategy);
    expect(trail).toEqual([
      "override",
      "bundled-node",
      "managed",
      "where",
    ]);
  });

  it("npm chain (Windows): override → bundled-node → managed (runtime) → managed (npm-cli-beside-node) → where", () => {
    const r = freshRegistry({ exists: () => false, which: () => null, platform: "win32" });
    const trail = r.resolve("npm").tried.map((t) => t.strategy);
    expect(trail).toEqual([
      "override",
      "bundled-node",
      "managed",
      "managed",
      "where",
    ]);
  });

  it("npx chain: override → bundled-node → managed (bin) → where", () => {
    const r = freshRegistry({ exists: () => false, which: () => null });
    const trail = r.resolve("npx").tried.map((t) => t.strategy);
    expect(trail).toEqual([
      "override",
      "bundled-node",
      "managed",
      "where",
    ]);
  });

  it("jj resolves via where when found", () => {
    const r = freshRegistry({
      which: (name) => (name === "jj" ? "/usr/local/bin/jj" : null),
    });
    const res = r.resolve("jj");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/usr/local/bin/jj");
    expect(res.source).toBe("system");
  });

  it("jj unavailable returns ok:false without throwing", () => {
    const r = freshRegistry({ which: () => null });
    const res = r.resolve("jj");
    expect(res.ok).toBe(false);
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

describe("bash binary definition", () => {
  // See change: register-bash-and-tool-install-help.
  it("is registered on every platform (no platform gate)", () => {
    for (const platform of ["linux", "darwin", "win32"] as NodeJS.Platform[]) {
      const r = freshRegistry({ platform });
      expect(r.has("bash")).toBe(true);
    }
  });

  it("chain order: override → managed → where", () => {
    const r = freshRegistry({ exists: () => false, which: () => null });
    const trail = r.resolve("bash").tried.map((t) => t.strategy);
    expect(trail).toEqual(["override", "managed", "where"]);
  });

  it("resolves via where on Unix (/bin/bash)", () => {
    const r = freshRegistry({
      which: (n) => (n === "bash" ? "/bin/bash" : null),
      platform: "linux",
    });
    const res = r.resolve("bash");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/bin/bash");
    expect(res.source).toBe("system");
  });

  it("resolves via where on Windows (Git-for-Windows bash.exe)", () => {
    const gfw = "C:\\Program Files\\Git\\bin\\bash.exe";
    const r = freshRegistry({
      which: (n) => (n === "bash" ? gfw : null),
      platform: "win32",
    });
    const res = r.resolve("bash");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(gfw);
    expect(res.source).toBe("system");
  });

  it("override wins over PATH", () => {
    const custom = "/opt/custom/bash";
    const r = freshRegistry({
      overrides: { bash: custom },
      exists: (p) => p === custom,
      which: () => "/bin/bash",
    });
    const res = r.resolve("bash");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(custom);
    expect(res.source).toBe("override");
  });

  it("not found returns ok:false without throwing", () => {
    const r = freshRegistry({ which: () => null, exists: () => false });
    const res = r.resolve("bash");
    expect(res.ok).toBe(false);
    expect(res.path).toBeNull();
  });
});

describe("installHints do not affect resolution (regression guard)", () => {
  // See change: register-bash-and-tool-install-help. Adding installHints
  // metadata must not change resolve() semantics for any tool.
  it("resolve() output never carries installHints", () => {
    const r = freshRegistry({ which: (n) => (n === "git" ? "/usr/bin/git" : null) });
    const res = r.resolve("git") as unknown as Record<string, unknown>;
    expect(res.installHints).toBeUndefined();
  });

  it("tools with hints resolve identically to tools without", () => {
    // git (has hints) and wt (no hints) both resolve via `where`; the
    // presence of hints must not perturb ok/path/source/tried.
    const r = freshRegistry({
      which: (n) => (n === "git" ? "/usr/bin/git" : null),
    });
    const git = r.resolve("git");
    expect(git.ok).toBe(true);
    expect(git.source).toBe("system");
    expect(git.tried.map((t) => t.strategy)).toEqual(["override", "managed", "where"]);
  });
});
