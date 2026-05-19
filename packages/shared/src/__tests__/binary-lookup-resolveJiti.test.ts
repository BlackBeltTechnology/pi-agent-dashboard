/**
 * Tests for `ToolResolver.resolveJiti` — ported from the prior
 * `resolve-jiti.test.ts`. Exercises every anchor in the resolution
 * chain (managed-pi upstream/legacy, system-pi, anchor walk-up,
 * argv fallback, all-miss) plus the URL-shape invariants
 * (`file://` URL output, Windows drive-letter wrapping, upstream
 * jiti chosen before legacy fork).
 *
 * Test seams (`_pathExists`, `_realpath`, `_whichPi`, `_argv1`,
 * `_managedDir`, `resolver`) keep the test pure — no fs / process
 * mutation, no managed-dir on disk.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { ToolResolver, MANAGED_PI_PACKAGES, JITI_PACKAGES } from "../platform/binary-lookup.js";

const MANAGED_DIR = "/fake/.pi-dashboard";

function makeResolver(installed: Record<string, string>) {
  return (spec: string): string => {
    if (spec in installed) return installed[spec]!;
    throw new Error(`Cannot find module '${spec}'`);
  };
}

describe("MANAGED_PI_PACKAGES + JITI_PACKAGES contract", () => {
  it("upstream pi pkg first, legacy fork fallback", () => {
    expect(MANAGED_PI_PACKAGES).toEqual([
      "@earendil-works/pi-coding-agent",
      "@mariozechner/pi-coding-agent",
    ]);
  });

  it("upstream jiti first, legacy fork fallback", () => {
    expect(JITI_PACKAGES).toEqual(["jiti", "@mariozechner/jiti"]);
    // Primary lookup MUST be bare "jiti" — that's what `packages/server/
    // package.json#dependencies.jiti` resolves on a clean npm install.
    // Regression for v0.5.3 fork-name drift; see change:
    // enable-standalone-npm-install task 7.3.
    expect(JITI_PACKAGES[0]).toBe("jiti");
  });
});

describe("ToolResolver.resolveJiti — managed pi", () => {
  it("hits upstream managed pi (@earendil-works) when only it is present", () => {
    const upstreamPkgJson = path.join(
      MANAGED_DIR, "node_modules", "@earendil-works", "pi-coding-agent", "package.json",
    );
    const jitiPkgJson = "/managed/upstream/node_modules/jiti/package.json";
    const url = new ToolResolver().resolveJiti({
      _managedDir: MANAGED_DIR,
      _pathExists: (p) => p === upstreamPkgJson || p === path.join(path.dirname(jitiPkgJson), "lib", "jiti-register.mjs"),
      _whichPi: () => null,
      _argv1: undefined,
      resolver: makeResolver({ "jiti/package.json": jitiPkgJson }),
    });
    expect(url).not.toBeNull();
    expect(url!.startsWith("file://")).toBe(true);
    expect(url!).toMatch(/\/jiti\/lib\/jiti-register\.mjs$/);
    expect(url!).not.toContain("@mariozechner");
  });

  it("falls through to legacy managed pi (@mariozechner) when upstream is absent", () => {
    const legacyPkgJson = path.join(
      MANAGED_DIR, "node_modules", "@mariozechner", "pi-coding-agent", "package.json",
    );
    const jitiPkgJson = "/managed/legacy/node_modules/@mariozechner/jiti/package.json";
    const url = new ToolResolver().resolveJiti({
      _managedDir: MANAGED_DIR,
      _pathExists: (p) =>
        p === legacyPkgJson ||
        p === path.join(path.dirname(jitiPkgJson), "lib", "jiti-register.mjs"),
      _whichPi: () => null,
      _argv1: undefined,
      resolver: makeResolver({
        "@mariozechner/jiti/package.json": jitiPkgJson,
      }),
    });
    expect(url).not.toBeNull();
    expect(url!).toContain("@mariozechner/jiti");
  });

  it("prefers upstream pi over legacy when BOTH managed pkgs are present", () => {
    const upstream = path.join(MANAGED_DIR, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
    const legacy = path.join(MANAGED_DIR, "node_modules", "@mariozechner", "pi-coding-agent", "package.json");
    const upstreamJiti = "/managed/upstream/jiti/package.json";
    const legacyJiti = "/managed/legacy/@mariozechner/jiti/package.json";
    const calls: string[] = [];
    const resolver = (spec: string): string => {
      calls.push(spec);
      if (spec === "jiti/package.json") return upstreamJiti;
      if (spec === "@mariozechner/jiti/package.json") return legacyJiti;
      throw new Error(`nope ${spec}`);
    };
    const url = new ToolResolver().resolveJiti({
      _managedDir: MANAGED_DIR,
      _pathExists: (p) =>
        p === upstream || p === legacy ||
        p === path.join(path.dirname(upstreamJiti), "lib", "jiti-register.mjs"),
      _whichPi: () => null,
      _argv1: undefined,
      resolver,
    });
    expect(url!).toMatch(/\/jiti\/lib\/jiti-register\.mjs$/);
    expect(url!).not.toContain("@mariozechner");
    // Upstream pi anchor produced upstream jiti — legacy pi anchor never tried.
    expect(calls).toEqual(["jiti/package.json"]);
  });
});

describe("ToolResolver.resolveJiti — system pi", () => {
  it("uses which(\"pi\") when managed pi absent", () => {
    const piBin = "/usr/local/bin/pi";
    const piReal = "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
    const jitiPkgJson = "/usr/local/lib/node_modules/jiti/package.json";
    const url = new ToolResolver().resolveJiti({
      _managedDir: MANAGED_DIR,
      _pathExists: (p) => p === path.join(path.dirname(jitiPkgJson), "lib", "jiti-register.mjs"),
      _whichPi: () => piBin,
      _realpath: (p) => (p === piBin ? piReal : p),
      _argv1: undefined,
      resolver: makeResolver({ "jiti/package.json": jitiPkgJson }),
    });
    expect(url!.startsWith("file://")).toBe(true);
    expect(url!).toMatch(/\/jiti\/lib\/jiti-register\.mjs$/);
  });

  it("realpaths a symlinked pi binary before resolving", () => {
    const piSymlink = "/usr/local/bin/pi";
    const piTarget = "/opt/pi/dist/cli.js";
    const jitiPkgJson = "/opt/pi/node_modules/jiti/package.json";
    let realpathArg: string | null = null;
    const url = new ToolResolver().resolveJiti({
      _managedDir: MANAGED_DIR,
      // Managed-pi miss; only the symlinked register file exists.
      _pathExists: (p) => p === path.join(path.dirname(jitiPkgJson), "lib", "jiti-register.mjs"),
      _whichPi: () => piSymlink,
      _realpath: (p) => { realpathArg = p; return piTarget; },
      _argv1: undefined,
      resolver: makeResolver({ "jiti/package.json": jitiPkgJson }),
    });
    expect(realpathArg).toBe(piSymlink);
    expect(url).not.toBeNull();
  });
});

describe("ToolResolver.resolveJiti — anchor walk-up + argv fallback", () => {
  it("uses caller-supplied anchor when prior layers miss", () => {
    const anchor = "/custom/cli/path.js";
    const jitiPkgJson = "/custom/node_modules/jiti/package.json";
    const url = new ToolResolver().resolveJiti({
      anchor,
      _managedDir: MANAGED_DIR,
      _pathExists: (p) => p === anchor || p === path.join(path.dirname(jitiPkgJson), "lib", "jiti-register.mjs"),
      _whichPi: () => null,
      _argv1: undefined,
      resolver: makeResolver({ "jiti/package.json": jitiPkgJson }),
    });
    expect(url).not.toBeNull();
    expect(url!).toMatch(/\/jiti\/lib\/jiti-register\.mjs$/);
  });

  it("returns null when caller-supplied anchor does not exist on disk", () => {
    const url = new ToolResolver().resolveJiti({
      anchor: "/missing/path.js",
      _managedDir: MANAGED_DIR,
      _pathExists: () => false,
      _whichPi: () => null,
      _argv1: undefined,
      resolver: () => "/whatever/jiti/package.json",
    });
    expect(url).toBeNull();
  });

  it("falls back to process.argv[1] (test seam) when all earlier anchors miss", () => {
    const argv = "/runtime/argv1/cli.js";
    const jitiPkgJson = "/runtime/node_modules/jiti/package.json";
    const url = new ToolResolver().resolveJiti({
      _managedDir: MANAGED_DIR,
      _pathExists: () => true,
      _whichPi: () => null,
      _realpath: (p) => p,
      _argv1: argv,
      resolver: makeResolver({ "jiti/package.json": jitiPkgJson }),
    });
    expect(url).not.toBeNull();
  });

  it("resolves jiti shipped as a direct dep of pi-dashboard-server (own-tree, no pi anywhere)", () => {
    // Simulates the npm-install path post enable-standalone-npm-install:
    // - no managed pi at ~/.pi-dashboard/
    // - no system pi on PATH
    // - no caller-supplied anchor
    // - jiti lives in pi-dashboard-server's own node_modules, reachable
    //   via createRequire(argv[1]) walk-up
    const argv = "/usr/local/lib/node_modules/@blackbelt-technology/pi-dashboard-server/bin/pi-dashboard.mjs";
    const jitiPkgJson = "/usr/local/lib/node_modules/@blackbelt-technology/pi-dashboard-server/node_modules/jiti/package.json";
    const url = new ToolResolver().resolveJiti({
      _managedDir: MANAGED_DIR,
      // Managed pi pkg.json + legacy variant miss; only the jiti register exists.
      _pathExists: (p) => p === path.join(path.dirname(jitiPkgJson), "lib", "jiti-register.mjs"),
      _whichPi: () => null,
      _realpath: (p) => p,
      _argv1: argv,
      resolver: makeResolver({ "jiti/package.json": jitiPkgJson }),
    });
    expect(url).not.toBeNull();
    expect(url!.startsWith("file://")).toBe(true);
    expect(url!).toMatch(/\/jiti\/lib\/jiti-register\.mjs$/);
  });

  it("returns null when every anchor misses", () => {
    const url = new ToolResolver().resolveJiti({
      _managedDir: MANAGED_DIR,
      _pathExists: () => false,
      _whichPi: () => null,
      _argv1: undefined,
      resolver: () => { throw new Error("nope"); },
    });
    expect(url).toBeNull();
  });
});

describe("ToolResolver.resolveJiti — URL contract", () => {
  it("returns a file:// URL parseable by new URL()", () => {
    const url = new ToolResolver().resolveJiti({
      _managedDir: MANAGED_DIR,
      _pathExists: () => true,
      _whichPi: () => null,
      _argv1: "/runtime/argv1/cli.js",
      _realpath: (p) => p,
      resolver: makeResolver({ "jiti/package.json": "/r/node_modules/jiti/package.json" }),
    });
    expect(url!.startsWith("file://")).toBe(true);
    expect(() => new URL(url!)).not.toThrow();
    expect(url!.endsWith("/lib/jiti-register.mjs")).toBe(true);
  });

  it("URL-wraps Windows drive-letter pkg.json paths (regression for ERR_UNSUPPORTED_ESM_URL_SCHEME)", () => {
    const winPkgJson = "B:\\Dev\\Nodejs\\global\\node_modules\\@mariozechner\\jiti\\package.json";
    const url = new ToolResolver().resolveJiti({
      _managedDir: MANAGED_DIR,
      _pathExists: () => true,
      _whichPi: () => null,
      _argv1: "C:\\runtime\\cli.js",
      _realpath: (p) => p,
      resolver: makeResolver({ "@mariozechner/jiti/package.json": winPkgJson }),
    });
    expect(url).not.toBeNull();
    expect(url!.startsWith("file:///")).toBe(true);
    expect(() => new URL(url!)).not.toThrow();
    expect(new URL(url!).protocol).toBe("file:");
    expect(url!.toLowerCase()).toContain("/b:/");
    expect(url!.endsWith("/lib/jiti-register.mjs")).toBe(true);
  });
});
