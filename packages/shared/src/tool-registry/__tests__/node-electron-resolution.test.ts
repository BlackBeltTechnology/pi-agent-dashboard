/**
 * Full-chain integration tests for `node`/`npm`/`npx` resolution under
 * the three packaging layouts that ship the dashboard today:
 *
 *   1. Packaged Electron — process.resourcesPath set + bundled-node
 *      present. Resolution SHALL pick `bundled-node`,
 *      `source === "bundled"`.
 *   2. Electron dev      — resourcesPath set but `<resourcesPath>/node/`
 *      absent (electron-forge start points at the source tree).
 *      Chain SHALL fall through to `where`, `source === "system"`.
 *   3. Standalone CLI    — resourcesPath unset (non-Electron host).
 *      Chain SHALL behave identically to pre-patch, falling through
 *      to managed/where as appropriate.
 *
 * NOTE: The previous bootstrap-cube harness at
 * `packages/shared/src/__tests__/bootstrap/families/` was removed by
 * `eliminate-electron-runtime-install`. This file replaces the
 * proposal's planned `node-electron-resolution.test.ts` cell at the
 * tool-registry layer instead of the bootstrap layer.
 *
 * See change: fix-node-resolution-under-electron (task 4.2).
 */
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  OverridesStore,
  ToolRegistry,
  registerDefaultTools,
} from "../index.js";

function freshRegistry(opts: {
  platform?: NodeJS.Platform;
  resourcesPath?: string;
  exists?: (p: string) => boolean;
  which?: (name: string) => string | null;
  execPath?: string;
  realpath?: (p: string) => string;
}) {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `node-electron-${Math.random()}.json`),
    warn: () => {},
  });
  const r = new ToolRegistry({
    overrides: store,
    platform: opts.platform ?? "linux",
    // Pass an explicit env so the registry does NOT autopopulate
    // resourcesPath from the live process. Tests that want
    // "Electron host" pass a value; tests that want "standalone CLI"
    // pass undefined.
    env: opts.resourcesPath ? { resourcesPath: opts.resourcesPath } : {},
  });
  registerDefaultTools(r, {
    exists: opts.exists ?? (() => false),
    which: opts.which ?? (() => null),
    npmRootGlobal: () => "",
    // Inject the interpreter + realpath seams so `nodeScriptToArgv`
    // argv assembly is deterministic under test. Without these, two
    // machine-state leaks reach past the mocks (change:
    // fix-node-electron-resolution-test-isolation):
    //   leak A — `resolveJsScript` → real `realpathSync` derefs an
    //     installed `/Applications/PI-Dashboard.app/.../npm` symlink to
    //     a real `npm-cli.js`, firing the node-wrap branch.
    //   leak B — `nodeScriptToArgv`'s `process.execPath` fallback yields
    //     the host's managed node (`~/.pi-dashboard/node/bin/node`).
    ...(opts.execPath ? { execPath: opts.execPath } : {}),
    ...(opts.realpath ? { realpath: opts.realpath } : {}),
  });
  return r;
}

describe("packaged Electron — bundled-node wins", () => {
  const RP = "/Applications/PI-Dashboard.app/Contents/Resources";
  const BUNDLED_NODE = path.join(RP, "node", "bin", "node");
  const BUNDLED_NPM = path.join(RP, "node", "bin", "npm");
  const BUNDLED_NPX = path.join(RP, "node", "bin", "npx");

  it("node resolves to <resourcesPath>/node/bin/node with source 'bundled'", () => {
    const r = freshRegistry({
      platform: "darwin",
      resourcesPath: RP,
      exists: (p) => p === BUNDLED_NODE,
      which: () => "/usr/local/bin/node",
    });
    const res = r.resolve("node");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(BUNDLED_NODE);
    expect(res.source).toBe("bundled");
    expect(res.tried.find((t) => t.strategy === "bundled-node")?.result).toBe(
      "ok",
    );
  });

  it("npm (executor) resolves to bundled with argv = [bundled-npm]", () => {
    const r = freshRegistry({
      platform: "darwin",
      resourcesPath: RP,
      exists: (p) => p === BUNDLED_NPM,
      // Inject a fake interpreter and an identity realpath so the
      // executor case asserts against mocked state only — BUNDLED_NPM
      // (not a `.js` path) does not deref, so `nodeScriptToArgv`
      // returns `[BUNDLED_NPM]` without ever reading host machine state.
      execPath: "/fake/interpreter/node",
      realpath: (p) => p,
    });
    const res = r.resolveExecutor("npm");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(BUNDLED_NPM);
    expect(res.source).toBe("bundled");
    expect(res.argv).toEqual([BUNDLED_NPM]);
    // No-leak guard: the resolved argv must not carry any real-fs path
    // sourced from `process.execPath` (managed node `~/.pi-dashboard`)
    // or a `realpathSync` deref. Fails pre-fix (argv leaked
    // `~/.pi-dashboard/node/bin/node` + a real `npm-cli.js`), passes post-fix.
    expect(res.argv).not.toContain(process.execPath);
    expect(res.argv.some((a) => a.includes(".pi-dashboard"))).toBe(false);
    expect(res.argv.some((a) => a.includes("npm-cli.js"))).toBe(false);
  });

  it("npx resolves to bundled", () => {
    const r = freshRegistry({
      platform: "darwin",
      resourcesPath: RP,
      exists: (p) => p === BUNDLED_NPX,
    });
    const res = r.resolve("npx");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(BUNDLED_NPX);
    expect(res.source).toBe("bundled");
  });

  it("Windows packaged: node.exe + npm.cmd + npx.cmd", () => {
    const winRP = "C:\\Program Files\\PI Dashboard\\resources";
    const winNode = path.join(winRP, "node", "node.exe");
    const winNpm = path.join(winRP, "node", "npm.cmd");
    const winNpx = path.join(winRP, "node", "npx.cmd");
    const r = freshRegistry({
      platform: "win32",
      resourcesPath: winRP,
      exists: (p) => p === winNode || p === winNpm || p === winNpx,
    });
    expect(r.resolve("node").path).toBe(winNode);
    expect(r.resolve("node").source).toBe("bundled");
    expect(r.resolve("npm").path).toBe(winNpm);
    expect(r.resolve("npm").source).toBe("bundled");
    expect(r.resolve("npx").path).toBe(winNpx);
    expect(r.resolve("npx").source).toBe("bundled");
  });

  it("override beats bundled", () => {
    const override = "/opt/custom/node";
    const store = new OverridesStore({
      filePath: path.join(os.tmpdir(), `override-beats-bundled-${Math.random()}.json`),
      warn: () => {},
    });
    store.set("node", override);
    const r = new ToolRegistry({
      overrides: store,
      platform: "darwin",
      env: { resourcesPath: RP },
    });
    registerDefaultTools(r, {
      exists: (p) => p === override || p === BUNDLED_NODE,
      which: () => null,
      npmRootGlobal: () => "",
    });
    const res = r.resolve("node");
    expect(res.path).toBe(override);
    expect(res.source).toBe("override");
    // bundled-node strategy SHALL NOT have run.
    expect(res.tried.find((t) => t.strategy === "bundled-node")).toBeUndefined();
  });
});

describe("Electron dev — bundled-node misses, falls through to system", () => {
  // electron-forge start: resourcesPath points at the source tree, no
  // <resourcesPath>/node/ subdir.
  const DEV_RP = "/Users/dev/Project/pi-agent-dashboard/packages/electron";

  it("node falls through to where, source 'system'", () => {
    const r = freshRegistry({
      platform: "darwin",
      resourcesPath: DEV_RP,
      exists: () => false, // nothing on disk at the resources path
      which: (n) => (n === "node" ? "/usr/local/bin/node" : null),
    });
    const res = r.resolve("node");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/usr/local/bin/node");
    expect(res.source).toBe("system");
    const trail = res.tried.map((t) => t.strategy);
    expect(trail).toContain("bundled-node");
    expect(trail).toContain("where");
    expect(res.tried.find((t) => t.strategy === "bundled-node")?.result).toMatch(
      /^missing: /,
    );
  });
});

describe("standalone CLI — no resourcesPath, no regression", () => {
  it("node resolves via where; bundled-node fast-fails with 'no resourcesPath'", () => {
    const r = freshRegistry({
      platform: "linux",
      resourcesPath: undefined,
      exists: () => false,
      which: (n) => (n === "node" ? "/usr/bin/node" : null),
    });
    const res = r.resolve("node");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/usr/bin/node");
    expect(res.source).toBe("system");
    expect(res.tried.find((t) => t.strategy === "bundled-node")?.result).toBe(
      "no resourcesPath",
    );
  });

  it("npm falls through to where when standalone (Unix)", () => {
    const r = freshRegistry({
      platform: "linux",
      resourcesPath: undefined,
      exists: () => false,
      which: (n) => (n === "npm" ? "/usr/bin/npm" : null),
    });
    const res = r.resolve("npm");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/usr/bin/npm");
    expect(res.source).toBe("system");
  });

  it("npx falls through to where when standalone", () => {
    const r = freshRegistry({
      platform: "linux",
      resourcesPath: undefined,
      exists: () => false,
      which: (n) => (n === "npx" ? "/usr/bin/npx" : null),
    });
    const res = r.resolve("npx");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/usr/bin/npx");
    expect(res.source).toBe("system");
  });
});
