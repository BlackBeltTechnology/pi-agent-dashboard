/**
 * Static-source contracts for the bundled pi runtime and the build scripts
 * that ship it. Pins current behaviour only (spec-only change).
 *
 * Covers test-plan #E10 (runtime declarations), #E13 (local builder
 * arch-cache invalidation) and #X5 (removed bundled-extensions step).
 *
 * See change: cleanup-stale-fork-specs.
 */

import { spawnSync } from "node:child_process"; // ban:child_process-ok — runs the script under test
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.join(REPO_ROOT, ...p), "utf8");

/** Drop full-line `#` / `//` comments so historical notes don't trip name checks. */
const stripComments = (src: string) =>
  src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(#|\/\/)/.test(l))
    .join("\n");

describe("bundled server ships the pi runtime (E10)", () => {
  const serverPkg = JSON.parse(read("packages", "server", "package.json")) as {
    dependencies: Record<string, string>;
  };
  const bundleSrc = read("packages", "electron", "scripts", "bundle-server.mjs");

  it("server dependencies carry pi, openspec and tsx, and not the legacy fork", () => {
    const deps = Object.keys(serverPkg.dependencies);
    expect(deps).toContain("@earendil-works/pi-coding-agent");
    expect(deps).toContain("@fission-ai/openspec");
    expect(deps).toContain("tsx");
    expect(deps).not.toContain("@mariozechner/pi-coding-agent");
  });

  // Root `dependencies` hold ONLY the bundled plugins' third-party union;
  // pi/openspec/tsx still arrive solely through the server workspace.
  // See change: bundle-plugin-third-party-deps (test-plan #E14).
  it("bundlePkg declares workspaces and no dependencies", () => {
    const m = bundleSrc.match(/const bundlePkg = \{([\s\S]*?)\n\};/);
    expect(m).not.toBeNull();
    const body = m![1]!;
    expect(body).toMatch(/\bworkspaces:/);
    const depLines = body.split("\n").filter((l) => /\bdependencies\b/.test(l));
    expect(depLines.map((l) => l.trim())).toEqual(["dependencies: pluginRuntimeDeps,"]);
    expect(body).not.toMatch(/pi-coding-agent|openspec|\btsx\b/);
    const call = bundleSrc.match(/collectPluginRuntimeDeps\(\{([\s\S]*?)\}\)/);
    expect(call).not.toBeNull();
    expect(call![1]).toMatch(/\bworkspaceManifests\b/);
  });

  // mcp-client-plugin is a direct server dependency: installed from the registry
  // its `shared ^<base>` misses the bundled `<base>-ci.*` workspace and npm nests a
  // stale published shared → bundled server boots into RECOVERY MODE.
  // Plus every first-party dep of a bundled plugin (see bundled-plugins-complete.test.ts).
  it("BUNDLED_WORKSPACE_PKGS is the server core + every first-party dep of server/bundled plugins", () => {
    const m = bundleSrc.match(/const BUNDLED_WORKSPACE_PKGS = \[([\s\S]*?)\];/);
    expect(m).not.toBeNull();
    const names = [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(names).toEqual([
      "server",
      "shared",
      "extension",
      "dashboard-plugin-runtime",
      // dashboard-plugin-runtime depends on app-kit (`./embedded-app`).
      // See change: add-plugin-app-host.
      "app-kit",
      "mcp-client-plugin",
      "bus-client",
      "client-utils",
      "document-converter",
      "kb",
      "mcp-server-plugin",
      "session-distiller",
      "system-one",
      // craft-web-plugin depends on craft-apps (provisionWeb), which depends on nano-banana.
      // See change: edit-office-in-pane-with-craft-web.
      "craft-apps",
      "nano-banana",
    ]);
  });

  // npm 10 arborist resolves workspace devDependencies even under --omit=dev and
  // crashes in #loadPeerSet ("reading 'edgesOut'") on mcp-client-plugin's vitest.
  it("strips devDependencies from bundled workspace package.json copies before npm install", () => {
    const code = stripComments(bundleSrc);
    const strip = code.search(/delete\s+\w+\.devDependencies/);
    const install = code.indexOf('"install", "--omit=dev"');
    expect(strip).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(strip);
  });
});

describe("local builder arch-cache invalidation (E13)", () => {
  const script = read("packages", "electron", "scripts", "build-installer.sh");

  it("wipes resources/node and resources/server on arch change", () => {
    expect(script).toMatch(/rm -rf "\$ELECTRON_DIR\/resources\/node"\s*\\\s*\n\s*"\$ELECTRON_DIR\/resources\/server"/);
  });

  it("has no offline-packages step", () => {
    expect(script).not.toContain("offline-packages");
  });

  it("runs bundle-server.mjs (not .sh), under `arch -x86_64` for x64 cross builds", () => {
    expect(script).toContain("scripts/bundle-server.mjs");
    expect(script).not.toContain("bundle-server.sh");
    expect(script).toMatch(/cross_prefix="arch -x86_64"/);
    expect(script).toMatch(/\$cross_prefix node "\$ELECTRON_DIR\/scripts\/bundle-server\.mjs"/);
  });
});

// The freshness watch set is derived (bundle workspaces + bundled plugins), and
// a (re)bundle is followed by the plugin resolvability gate.
// See change: bundle-plugin-third-party-deps (design D6; test-plan #E24).
describe("local builder bundle freshness is derived (E24)", () => {
  const script = read("packages", "electron", "scripts", "build-installer.sh");

  it("iterates bundle-watch-paths.mjs output instead of a hardcoded watch list", () => {
    expect(script).toMatch(/node "\$ELECTRON_DIR\/scripts\/bundle-watch-paths\.mjs"/);
    expect(script).not.toMatch(/"\$PROJECT_DIR\/packages\/server\/src"/);
  });

  it("runs assert-bundled-plugins-complete.mjs after bundle-server.mjs", () => {
    const bundle = script.lastIndexOf('scripts/bundle-server.mjs"');
    const gate = script.indexOf("scripts/assert-bundled-plugins-complete.mjs");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(bundle);
  });
});

describe("removed bundled-extensions step stays gone (X5)", () => {
  for (const wf of ["_electron-build.yml", "publish.yml"]) {
    it(`${wf} references neither bundle-recommended-extensions nor bundle-server.sh`, () => {
      const src = stripComments(read(".github", "workflows", wf));
      expect(src).not.toContain("bundle-recommended-extensions");
      expect(src).not.toContain("bundle-server.sh");
    });
  }

  it("_electron-build.yml bundles the server with bundle-server.mjs", () => {
    const src = stripComments(read(".github", "workflows", "_electron-build.yml"));
    expect(src).toMatch(/run: node packages\/electron\/scripts\/bundle-server\.mjs/);
  });
});

// Release-lock mode (design D1/D3). See change: pin-electron-bundle-dependency-tree
// (test-plan #E14, #E15).
describe("bundle-server.mjs release-lock argv (E14)", () => {
  const script = path.join(REPO_ROOT, "packages", "electron", "scripts", "bundle-server.mjs");
  const serverVersion = (JSON.parse(read("packages", "server", "package.json")) as { version: string }).version;

  it.each([
    [["--release-lock="], /empty version/],
    [["--release-lock"], /--release-lock=<version>/],
    [["--release-lock", "0.10.0"], /--release-lock=<version>/],
    [["--release-lock=0.10.0", "--source-only"], /--source-only/],
    [["--release-lock=0.0.1"], /differs from the server workspace version/],
  ])("%j exits non-zero before any npm spawn, naming the misuse", (argv, message) => {
    const bundleDir = path.join(REPO_ROOT, "packages", "electron", "resources", "server");
    const before = fs.existsSync(bundleDir) ? fs.statSync(bundleDir).mtimeMs : null;
    const r = spawnSync(process.execPath, [script, ...argv], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(message);
    expect(r.stdout).not.toContain("Bundling dashboard server"); // fails before any work
    expect(fs.existsSync(bundleDir) ? fs.statSync(bundleDir).mtimeMs : null).toBe(before);
  });

  it("the stamped server version is a valid release-lock value", async () => {
    const { parseReleaseLockArgs } = await import(path.join(REPO_ROOT, "packages", "electron", "scripts", "lib", "release-lock.mjs"));
    expect(parseReleaseLockArgs([`--release-lock=${serverVersion}`], { serverVersion })).toEqual({ mode: "release-lock", version: serverVersion });
    expect(parseReleaseLockArgs(["--source-only"], { serverVersion })).toEqual({ mode: "floating" });
  });
});

describe("bundle install argv (E15)", () => {
  const code = stripComments(read("packages", "electron", "scripts", "bundle-server.mjs"));

  it("floating mode runs `npm install --omit=dev --no-audit --no-fund --no-package-lock`", () => {
    expect(code).toContain('["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"]');
  });

  it("release-lock mode runs `npm ci --omit=dev --no-audit --no-fund --allow-remote=all`", () => {
    expect(code).toContain('["ci", "--omit=dev", "--no-audit", "--no-fund", "--allow-remote=all"]');
  });

  it("neither install uses pnpm", () => {
    expect(code).not.toMatch(/\bpnpm\b/);
  });

  it("release-lock mode runs its install inside withTempLockFile and exits only after it", () => {
    const fn = code.slice(code.indexOf("async function installFromReleaseLock"), code.indexOf("async function releaseLockInstall"));
    expect(fn).toMatch(/await withTempLockFile\(lockFile,/);
    // process.exit sits in the catch, after the helper's finally has removed the lock.
    expect(fn.indexOf("process.exit(1)")).toBeGreaterThan(fn.indexOf("catch (err)"));
    // nothing inside the install body may exit the process (it would skip the cleanup)
    expect(code.slice(code.indexOf("async function releaseLockInstall"), code.indexOf("Stamp `resources/server"))).not.toContain("process.exit");
  });
});
