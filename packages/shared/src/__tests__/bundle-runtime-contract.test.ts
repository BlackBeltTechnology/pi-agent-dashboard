/**
 * Static-source contracts for the bundled pi runtime and the build scripts
 * that ship it. Pins current behaviour only (spec-only change).
 *
 * Covers test-plan #E10 (runtime declarations), #E13 (local builder
 * arch-cache invalidation) and #X5 (removed bundled-extensions step).
 *
 * See change: cleanup-stale-fork-specs.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

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

  it("bundlePkg declares workspaces and no dependencies", () => {
    const m = bundleSrc.match(/const bundlePkg = \{([\s\S]*?)\n\};/);
    expect(m).not.toBeNull();
    const body = m![1]!;
    expect(body).toMatch(/\bworkspaces:/);
    expect(body).not.toMatch(/\bdependencies\b/);
  });

  // mcp-client-plugin is a direct server dependency: installed from the registry
  // its `shared ^<base>` misses the bundled `<base>-ci.*` workspace and npm nests a
  // stale published shared → bundled server boots into RECOVERY MODE.
  it("BUNDLED_WORKSPACE_PKGS is server, shared, extension, dashboard-plugin-runtime, mcp-client-plugin", () => {
    const m = bundleSrc.match(/const BUNDLED_WORKSPACE_PKGS = \[([\s\S]*?)\];/);
    expect(m).not.toBeNull();
    const names = [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(names).toEqual(["server", "shared", "extension", "dashboard-plugin-runtime", "mcp-client-plugin"]);
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
