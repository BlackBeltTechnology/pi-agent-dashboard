/**
 * Real-fs ephemeral-HOME smoke test for the LaunchSource V2 `extracted` path.
 *
 * Complements `launch-source.test.ts` (pure unit, mocked fs) by exercising
 * the actual filesystem operations end-to-end:
 *
 *   Tier A — real `extractBundle` over the host-built `resources/server/`
 *            tree into a temp HOME. Catches cpSync ENOTDIR, broken
 *            symlinks, layout drift.
 *   Tier B — real `selectLaunchSource({ preferOverride: "extracted" })`,
 *            which runs extractBundle + workspaces/lockfile normalization +
 *            installStandalone. Catches the jiti chicken-and-egg AND the
 *            workspace-pruning regression where npm install wipes the
 *            extracted @blackbelt-technology/* tree because the bundle's
 *            package-lock.json declares them as workspace links.
 *   Tier C — real `node --import <jiti> <cliPath>` spawn against an
 *            ephemeral port; hits `/api/health`. Catches argv shape
 *            issues, jiti loader resolution, server boot regressions.
 *
 * Each tier skips with a clear reason when its bundled prerequisite is
 * absent (fresh clone with no `npm run build` of the Electron bundle).
 *
 * Runs on host platform (no Docker, no VM). Cost: ~10–60s when all
 * tiers run; <100ms when all tiers skip.
 *
 * See change: simplify-electron-bootstrap-derived-state (Phase C bring-up).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { extractBundle } from "../bundle-extract.js";
import { resolveJitiFromAnchor } from "@blackbelt-technology/pi-dashboard-shared/resolve-jiti.js";

// ── Paths into the host's built bundle ────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, "..", "..", "..");
const RESOURCES_DIR = path.join(ELECTRON_DIR, "resources");
const BUNDLE_SERVER_DIR = path.join(RESOURCES_DIR, "server");
const OFFLINE_CACHE_DIR = path.join(RESOURCES_DIR, "offline-packages");
const BUNDLED_NODE_DIR = path.join(RESOURCES_DIR, "node");

const HAS_BUNDLE = fs.existsSync(path.join(BUNDLE_SERVER_DIR, "package.json"));
const HAS_OFFLINE_CACHE = fs.existsSync(path.join(OFFLINE_CACHE_DIR, "manifest.json"));
const HAS_BUNDLED_NODE = (() => {
  // bundled-node layout differs by OS (matches upstream Node distribution)
  const winNode = path.join(BUNDLED_NODE_DIR, "node.exe");
  const unixNode = path.join(BUNDLED_NODE_DIR, "bin", "node");
  return fs.existsSync(winNode) || fs.existsSync(unixNode);
})();

/**
 * Tier C runs the actual server, which loads node-pty's native module.
 * The bundle's `node-pty/prebuilds/` only contains the build target's
 * triplet (e.g. `win32-x64` after a Windows build). When the host's
 * triplet doesn't match, the spawn fails with a benign "Cannot find
 * native module" error — not a real production bug. Skip Tier C in
 * that case with a clear reason.
 */
const HOST_PTY_TRIPLET = (() => {
  const arch = process.arch; // "x64" | "arm64" | ...
  const platform = process.platform === "darwin" ? "darwin"
    : process.platform === "linux" ? "linux"
    : process.platform === "win32" ? "win32"
    : null;
  return platform ? `${platform}-${arch}` : null;
})();
const HAS_HOST_PTY_PREBUILD = (() => {
  if (!HAS_BUNDLE || !HOST_PTY_TRIPLET) return false;
  const dir = path.join(
    BUNDLE_SERVER_DIR, "node_modules", "node-pty", "prebuilds", HOST_PTY_TRIPLET,
  );
  return fs.existsSync(dir);
})();

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-launch-source-smoke-"));
}

function rmTempHome(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/** Reserve an ephemeral TCP port (release immediately; race window is tolerated). */
async function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

async function waitForHealth(port: number, timeoutMs = 30_000): Promise<{ starter?: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return (await res.json()) as { starter?: string };
    } catch (err) { lastErr = err; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not become healthy on :${port} within ${timeoutMs}ms (last=${String(lastErr)})`);
}

/**
 * Pick the Node binary the smoke test should spawn the server with.
 *
 * Prefer the test host's Node (`process.execPath`) over the bundle's Node.
 * Rationale: the bundled Node may be stale (e.g. a v22.12.0 left over from a
 * previous build run, while the production pin is v22.18.0+). The server's
 * pre-flight version check in `node-version-check.ts` refuses to boot on
 * known-bad versions, so a stale bundle aborts before /api/health responds.
 * The host's Node is whatever runs vitest — if it's bad enough that the
 * server pre-flight aborts, we want to know *that*, not the bundle's stale
 * state.
 *
 * Production users get the canonical bundled Node from the build pipeline
 * (`packages/electron/scripts/download-node.sh v22.18.0 ...`); this test is
 * about the server boot path, not the bundled-runtime selection.
 */
function nodeBinaryForSpawn(): string {
  return process.execPath;
}

/**
 * Stub HOME + resourcesPath, drive the full V2 `extracted` path via
 * `selectLaunchSource({ preferOverride: "extracted" })`, return the resolved
 * managedDir + cliPath for assertions. Caller MUST invoke `cleanup()` to
 * restore env state. tempHome is set on module-scope `tempHome` so afterEach
 * can rm it.
 */
async function runExtractedPath(): Promise<{
  managedDir: string;
  cliPath: string;
  cleanup: () => void;
}> {
  tempHome = makeTempHome();
  const realHome = process.env.HOME;
  const realUserprofile = process.env.USERPROFILE;
  const realResourcesPath = (process as any).resourcesPath;
  process.env.HOME = tempHome;
  if (process.platform === "win32") process.env.USERPROFILE = tempHome;
  (process as any).resourcesPath = RESOURCES_DIR;

  // managed-paths.ts caches MANAGED_DIR via os.homedir() at module-load.
  // Reset so all subsequent imports re-evaluate under the stubbed HOME.
  vi.resetModules();
  const { selectLaunchSource } = await import("../launch-source.js");
  const { MANAGED_DIR } = await import("../managed-paths.js");
  const managedDir = path.join(tempHome!, ".pi-dashboard");
  expect(MANAGED_DIR, "MANAGED_DIR did not re-evaluate under temp HOME").toBe(managedDir);

  const result = await selectLaunchSource({
    isPackaged: true,
    cwd: tempHome!,
    preferOverride: "extracted",
    bundledMinVersion: "0.0.0-smoke",
    resourcesPath: RESOURCES_DIR,
    port: 0,
  });
  expect(result.kind).toBe("extracted");
  const cliPath = (result as { cliPath: string }).cliPath;

  return {
    managedDir,
    cliPath,
    cleanup: () => {
      process.env.HOME = realHome;
      if (realUserprofile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = realUserprofile;
      if (realResourcesPath === undefined) delete (process as any).resourcesPath;
      else (process as any).resourcesPath = realResourcesPath;
    },
  };
}

// ── State ─────────────────────────────────────────────────────────────────────

let tempHome: string | null = null;
const spawned: ChildProcess[] = [];

afterEach(() => {
  for (const child of spawned) {
    if (!child.killed && child.pid) {
      try { process.kill(child.pid, "SIGTERM"); } catch { /* gone */ }
    }
  }
  spawned.length = 0;
  if (tempHome) {
    rmTempHome(tempHome);
    tempHome = null;
  }
});

// ── Tier A: extract the real bundle into a temp HOME ─────────────────────────

describe.skipIf(!HAS_BUNDLE)("Tier A — extractBundle real-fs", () => {
  it("extracts <resources>/server into <tempHome>/.pi-dashboard with the expected layout", () => {
    tempHome = makeTempHome();
    const managedDir = path.join(tempHome, ".pi-dashboard");
    const migrateDir = path.join(tempHome, ".pi", "dashboard", "migrate", "test");

    extractBundle(managedDir, BUNDLE_SERVER_DIR, "0.0.0-smoke", migrateDir);

    expect(fs.readFileSync(path.join(managedDir, ".version"), "utf-8")).toBe("0.0.0-smoke");

    const cliPath = path.join(
      managedDir, "node_modules", "@blackbelt-technology",
      "pi-dashboard-server", "src", "cli.ts",
    );
    expect(fs.existsSync(cliPath)).toBe(true);

    // No ABSOLUTE symlinks under @blackbelt-technology/* (would point to
    // /build/packages/* — invalid on Windows ZIP extraction).
    // docker-make.sh materializes them BEFORE forge packs the bundle.
    // Relative symlinks (e.g. ../../packages/server, written by host npm)
    // are fine: they keep resolving to packages/<x> within managedDir.
    const bbDir = path.join(managedDir, "node_modules", "@blackbelt-technology");
    if (fs.existsSync(bbDir)) {
      for (const name of fs.readdirSync(bbDir)) {
        const entry = path.join(bbDir, name);
        const lst = fs.lstatSync(entry);
        if (!lst.isSymbolicLink()) continue;
        const linkTarget = fs.readlinkSync(entry);
        if (!path.isAbsolute(linkTarget)) continue; // relative symlinks are fine
        expect(
          true,
          `@blackbelt-technology/${name} is an absolute symlink (target=${fs.readlinkSync(entry)}) ` +
            `\u2014 docker-make.sh symlink replacement missed it`,
        ).toBe(false);
      }
    }
  });

  it("BEFORE installStandalone, jiti is unresolvable from the extracted cliPath (regression pin for the chicken-and-egg)", () => {
    tempHome = makeTempHome();
    const managedDir = path.join(tempHome, ".pi-dashboard");
    extractBundle(managedDir, BUNDLE_SERVER_DIR, "0.0.0-smoke");

    const cliPath = path.join(
      managedDir, "node_modules", "@blackbelt-technology",
      "pi-dashboard-server", "src", "cli.ts",
    );
    expect(resolveJitiFromAnchor(cliPath)).toBeNull();
  });
});

// ── Tier B: full V2 extracted path (extract + install) ───────────────────────

describe.skipIf(!HAS_BUNDLE || !HAS_OFFLINE_CACHE || !HAS_BUNDLED_NODE)(
  "Tier B — selectLaunchSource(extracted) end-to-end real-fs",
  () => {
    it(
      "extract + install: pi-coding-agent lands, cliPath survives, jiti resolves",
      { timeout: 180_000 },
      async () => {
        const ctx = await runExtractedPath();
        try {
          // pi-coding-agent landed (provides jiti)
          const piPkgJson = path.join(
            ctx.managedDir, "node_modules", "@mariozechner",
            "pi-coding-agent", "package.json",
          );
          expect(fs.existsSync(piPkgJson), "pi-coding-agent not installed").toBe(true);

          // cliPath SURVIVED the install (regression for the package-lock
          // workspace-reconciliation bug — npm wiped @blackbelt-technology/*
          // when the bundle's lockfile said "workspace link").
          expect(
            fs.existsSync(ctx.cliPath),
            "cliPath was wiped by installStandalone (workspace pruning regression)",
          ).toBe(true);

          // jiti now resolves from the cliPath anchor
          const jitiUrl = resolveJitiFromAnchor(ctx.cliPath);
          expect(jitiUrl, "jiti must be resolvable post-install").toBeTruthy();
          expect(jitiUrl!.startsWith("file://")).toBe(true);
        } finally {
          ctx.cleanup();
        }
      },
    );

    it(
      "recovers when managed dir is degraded (jiti missing) — re-extract on second call",
      { timeout: 240_000 },
      async () => {
        // First call: extract + install yields a healthy managed dir.
        const ctx = await runExtractedPath();
        try {
          // Sanity: jiti reachable after first call.
          expect(resolveJitiFromAnchor(ctx.cliPath)).toBeTruthy();

          // Simulate AV / partial corruption: nuke the @mariozechner subtree
          // (which contains jiti). Marker stays put — exactly the failure
          // mode that produced the FATAL on user's Windows install.
          const mzDir = path.join(
            ctx.managedDir,
            "node_modules",
            "@mariozechner",
          );
          expect(fs.existsSync(mzDir), "precondition: @mariozechner present").toBe(true);
          fs.rmSync(mzDir, { recursive: true, force: true });
          // Health check should now report unhealthy.
          expect(resolveJitiFromAnchor(ctx.cliPath)).toBeNull();

          // Second call: same version marker, but health probe must force
          // re-extract + install. After the call jiti must resolve again.
          // Re-import selectLaunchSource because vi.resetModules() inside
          // runExtractedPath cleared the registry.
          const { selectLaunchSource } = await import("../launch-source.js");
          const result2 = await selectLaunchSource({
            isPackaged: true,
            cwd: tempHome!,
            preferOverride: "extracted",
            bundledMinVersion: "0.0.0-smoke",
            resourcesPath: RESOURCES_DIR,
            port: 0,
          });
          expect(result2.kind).toBe("extracted");
          const cliPath2 = (result2 as { cliPath: string }).cliPath;
          expect(fs.existsSync(cliPath2)).toBe(true);
          expect(
            resolveJitiFromAnchor(cliPath2),
            "jiti must be reachable after auto-recover re-extract",
          ).toBeTruthy();
        } finally {
          ctx.cleanup();
        }
      },
    );
  },
);

// ── Tier C: spawn the server, hit /api/health ────────────────────────────────

describe.skipIf(
  !HAS_BUNDLE || !HAS_OFFLINE_CACHE || !HAS_BUNDLED_NODE || !HAS_HOST_PTY_PREBUILD,
)(
  "Tier C — spawnFromSource real-fs",
  () => {
    let port = 0;
    let piPort = 0;
    beforeAll(async () => {
      port = await pickPort();
      piPort = await pickPort();
    });

    it(
      "spawns the server and /api/health reports starter=Electron",
      { timeout: 240_000 },
      async () => {
        const ctx = await runExtractedPath();
        try {
          const jitiUrl = resolveJitiFromAnchor(ctx.cliPath);
          expect(jitiUrl).toBeTruthy();

          const child = spawn(
            nodeBinaryForSpawn(),
            [
              "--import", jitiUrl!,
              ctx.cliPath,
              "--port", String(port),
              "--pi-port", String(piPort),
            ],
            {
              cwd: ctx.managedDir,
              env: { ...process.env, HOME: tempHome!, DASHBOARD_STARTER: "Electron" },
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          spawned.push(child);
          child.stderr?.on("data", (b) => process.stderr.write(`[server] ${b}`));

          const health = await waitForHealth(port, 60_000);
          expect(health.starter).toBe("Electron");
        } finally {
          ctx.cleanup();
        }
      },
    );
  },
);
