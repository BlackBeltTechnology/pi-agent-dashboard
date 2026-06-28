/**
 * Doctor: diagnose the PI Dashboard installation.
 * Delegates portable checks to `@blackbelt-technology/pi-dashboard-shared/doctor-core.js`
 * and keeps Electron-only checks (Electron version, bundled Node, bundled npm,
 * server-code path, offline-packages bundle, server-launch test) inline.
 *
 * See change: doctor-rich-output (tasks 2.1 – 2.10).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app } from "electron";
import { detectPi, detectOpenSpec, detectSystemNode, detectDashboardPackage } from "./dependency-detector.js";

/**
 * PATH-only lookup for the CLI-on-PATH Doctor rows. Bypasses the
 * ToolRegistry deliberately: we want to know whether the user's shell
 * can find `pi`/`openspec`, not whether the bundled library resolves.
 */
function detectOnUserPath(name: string): { found: boolean; path?: string } {
  const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`; // platform-branch-ok
  const r = safeExec(cmd, { timeoutMs: 3000 });
  if (!r.ok) return { found: false };
  const first = r.stdout.trim().split("\n")[0];
  return first ? { found: true, path: first } : { found: false };
}
import { getBundledNodePath, getBundledNpmPath, getBundledNodeDir } from "./bundled-node.js";
import { pickNodeForServer } from "./pick-node.js";
import { isApiKeyConfigured } from "./wizard-state.js";
import { inspectedCredentialFiles } from "@blackbelt-technology/pi-dashboard-shared/credential-detect.js";
import { MANAGED_DIR } from "./managed-paths.js";
// resolveOfflinePackages + installManagedNode imports removed under change:
// eliminate-electron-runtime-install (no offline cache; bundle is immutable).
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import {
  type DoctorCheck,
  type DoctorReport,
  type DoctorStatus,
  runSharedChecks,
  safeExec,
  safeCheck,
  assumedMandatory,
  stampSectionsAndSuggestions,
  formatDoctorReportPlain,
  formatDoctorReportMarkdown as sharedFormatDoctorReportMarkdown,
} from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";

export type { DoctorCheck, DoctorReport, DoctorStatus } from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";

/** Re-export the shared markdown formatter so app-menu/doctor-window can consume it. */
export const formatDoctorReportMarkdown = sharedFormatDoctorReportMarkdown;

/** Get version from a package.json path. */
function getPkgVersion(pkgJsonPath: string): string | null {
  try {
    if (!existsSync(pkgJsonPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * Report the bundled Node runtime status.
 *
 * Under the immutable-bundle architecture (see change:
 * eliminate-electron-runtime-install), the bundled Node lives at
 * `<resourcesPath>/node/` and is the only runtime. The legacy
 * `~/.pi-dashboard/node/` install path is gone.
 */
export async function checkManagedNodeRuntime(opts?: {
  bundledNodeBinary?: string | null;
}): Promise<DoctorCheck> {
  const bundledNodeBinary = opts?.bundledNodeBinary ?? getBundledNodePath();
  if (!bundledNodeBinary || !existsSync(bundledNodeBinary)) {
    return {
      name: "Bundled Node runtime",
      section: "runtime",
      status: "error",
      message: "Bundled Node binary not found",
      detail: "Reinstall the application from the official installer.",
      fixable: false,
    };
  }
  return {
    name: "Bundled Node runtime",
    section: "runtime",
    status: "ok",
    message: `Bundled at ${bundledNodeBinary}`,
  };
}

/**
 * Probe the dashboard server's /api/health endpoint via native fetch.
 *
 * Previously shelled out to `curl -sf` via `safeExec`. That was fragile:
 * the macOS app bundle's PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) does carry
 * `/usr/bin/curl`, but `safeExec` runs through `execSync` which spawns
 * `/bin/sh -c`. Any flake in the shell child (PATH resolution, transient
 * sandbox condition, short timeout vs. busy openspec-poll tick) yields
 * `ok: false` and the renderer surfaces a false WARN ("GET .../api/health
 * returned no response") while the server is actually healthy.
 *
 * Native `fetch` (Node 18+) talks loopback directly with no subprocess and
 * no PATH lookup. AbortController gives us the same 3 s budget without
 * relying on execSync's timeout semantics.
 *
 * See change: harvest-bootstrap-survivor-fixes (cherry-pick 4).
 */
async function probeServer(): Promise<{
  running: boolean;
  version?: string;
  mode?: string;
  starter?: string | null;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  let body: unknown = null;
  try {
    const res = await fetch("http://localhost:8000/api/health", { signal: ctrl.signal });
    if (!res.ok) return { running: false };
    body = await res.json().catch(() => null);
  } catch {
    return { running: false };
  } finally {
    clearTimeout(timer);
  }
  const health = body as Record<string, unknown> | null;
  if (!health) return { running: true };
  return {
    running: true,
    version: typeof health.version === "string" ? health.version : undefined,
    mode: typeof health.mode === "string" ? health.mode : undefined,
    starter: typeof health.starter === "string" ? health.starter : null,
  };
  // `installable` field intentionally dropped under change:
  // eliminate-electron-runtime-install — the runtime install-list flow
  // is gone, so /api/health no longer exposes the field.
}

/** Run all doctor checks. Wraps the body in try/catch so the renderer
 * never receives a rejection from `doctor:run`. */
export async function runDoctor(): Promise<DoctorReport> {
  try {
    return await runDoctorInner();
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const fallback: DoctorCheck = {
      name: "Doctor failed to produce a report",
      section: "diagnostics",
      status: "error",
      message: "Unexpected internal failure",
      detail: `${e.message}\n${(e.stack || "").split("\n").slice(0, 4).join("\n")}`,
      suggestion:
        "Open `~/.pi-dashboard/doctor.log` for full context, then file an issue with the captured error attached.",
    };
    return {
      checks: [fallback],
      summary: { ok: 0, warnings: 0, errors: 1 },
      generatedAt: Date.now(),
    };
  }
}

async function runDoctorInner(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  // ── Electron app ─────────────────────────────────────────────
  const appVersionResult = assumedMandatory("app.getVersion()", () => app.getVersion(), {
    managedDir: MANAGED_DIR,
  });
  const appVersion = appVersionResult.ok ? appVersionResult.value : "unknown";
  if (!appVersionResult.ok) checks.push(appVersionResult.row);

  const electronVersion = process.versions.electron || "unknown";
  const chromeVersion = process.versions.chrome || "unknown";
  checks.push({
    name: "Electron",
    section: "runtime",
    status: "ok",
    message: `${electronVersion} (Chromium ${chromeVersion})`,
    detail: `App version: ${appVersion}, Platform: ${process.platform} ${process.arch}`,
  });

  // ── Bundled Node ─────────────────────────────────────────────
  const bundledNode = getBundledNodePath();
  checks.push(
    await safeCheck("Bundled Node.js", "runtime", () => {
      const sysFound = detectSystemNode().found;
      if (!bundledNode) {
        return {
          name: "Bundled Node.js",
          section: "runtime",
          status: sysFound ? "warning" : "error",
          message: "Not found in app resources",
          detail: `Searched ${(process as { resourcesPath?: string }).resourcesPath ?? "(no resourcesPath)"}`,
          fixable: !sysFound,
        };
      }
      const ver = safeExec(`"${bundledNode}" --version`, { timeoutMs: 15000 });
      if (!ver.ok) {
        const messages: Record<string, string> = {
          "not-found": "Bundled Node binary missing from app resources",
          "permission-denied": "Bundled Node binary not executable",
          timeout: "Bundled Node hung during version probe (15s deadline exceeded)",
          "non-zero-exit": "Bundled Node executed but reported failure",
          unknown: "Bundled Node failed for an unknown reason",
        };
        return {
          name: "Bundled Node.js",
          section: "runtime",
          status: "error",
          message: messages[ver.kind] ?? "Bundled Node failed",
          detail: `${ver.detail}${ver.stderrTail ? `\nstderr: ${ver.stderrTail}` : ""}`,
          kind: ver.kind,
        };
      }
      return {
        name: "Bundled Node.js",
        section: "runtime",
        status: "ok",
        message: `${ver.stdout.trim()} at ${bundledNode}`,
      };
    }),
  );

  // ── Bundled npm ──────────────────────────────────────────────
  const bundledNpm = getBundledNpmPath();
  checks.push(
    await safeCheck("Bundled npm", "runtime", () => {
      if (!bundledNpm) {
        const sysFound = detectSystemNode().found;
        return {
          name: "Bundled npm",
          section: "runtime",
          status: sysFound ? "warning" : "error",
          message: "Not found in app resources",
          detail: `Searched ${(process as { resourcesPath?: string }).resourcesPath ?? "(no resourcesPath)"}`,
        };
      }
      const npmPkg = path.join(path.dirname(bundledNpm), "..", "package.json");
      const ver = getPkgVersion(npmPkg);
      return {
        name: "Bundled npm",
        section: "runtime",
        status: "ok",
        message: `${ver || "installed"} at ${bundledNpm}`,
      };
    }),
  );

  // ── Managed Node runtime ─────────────────────────────────────
  checks.push(await checkManagedNodeRuntime());

  // ── Shared (portable) checks ─────────────────────────────────
  const shared = await runSharedChecks({
    managedDir: MANAGED_DIR,
    detectSystemNode: () => {
      const r = detectSystemNode();
      return { found: r.found, path: r.path };
    },
    detectPi: () => {
      const r = detectPi();
      return { found: r.found, path: r.path, source: r.source };
    },
    detectOpenSpec: () => {
      const r = detectOpenSpec();
      return { found: r.found, path: r.path, source: r.source };
    },
    // CLI-on-PATH checks (split from library check, see change:
    // fix-doctor-bundled-tool-detection). Uses `which`/`where` directly
    // so the result reflects the user's interactive shell state, NOT
    // what the Electron app can resolve via its bundled node_modules.
    detectPiOnPath: () => detectOnUserPath("pi"),
    detectOpenSpecOnPath: () => detectOnUserPath("openspec"),
    probeServer,
    isApiKeyConfigured,
    inspectedCredentialFiles: () => inspectedCredentialFiles(),
  });
  // Splice them in BEFORE the Electron-only "Dashboard server code" / offline / launch-test rows
  // for stable UI ordering. We push them inline now and rely on stampSectionsAndSuggestions for grouping.
  for (const c of shared) checks.push(c);

  // ── Dashboard server code (Electron-only path) ──────────────
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  const bundledServerCli = resourcesPath
    ? path.join(resourcesPath, "server", "packages", "server", "src", "cli.ts")
    : null;
  const hasBundledServer = !!(bundledServerCli && existsSync(bundledServerCli));

  const dashboard = detectDashboardPackage();
  let dashVersion: string | null = null;
  if (dashboard.found && dashboard.path) {
    dashVersion = getPkgVersion(dashboard.path);
  }
  if (hasBundledServer && !dashVersion && resourcesPath) {
    const bundledPkg = path.join(resourcesPath, "server", "packages", "server", "package.json");
    dashVersion = getPkgVersion(bundledPkg);
  }
  checks.push({
    name: "Dashboard server code",
    section: "server",
    status: hasBundledServer || dashboard.found ? "ok" : "error",
    message: hasBundledServer
      ? `v${dashVersion || "?"} (bundled) at ${bundledServerCli}`
      : dashboard.found
        ? `v${dashVersion || "?"} (${dashboard.source}) at ${path.dirname(dashboard.path!)}`
        : "Not found — required for the dashboard server",
    fixable: !hasBundledServer && !dashboard.found,
  });

  // Offline packages bundle check removed under change:
  // eliminate-electron-runtime-install.

  // ── Server starter (from health JSON) ──────────────────
  // Installable-list row removed under change:
  // eliminate-electron-runtime-install (Phase 6.3).
  const probe = await probeServer();
  if (probe.running) {
    checks.push({
      name: "Server starter",
      section: "server",
      status: probe.starter ? "ok" : "warning",
      message: probe.starter ?? "Unknown (old server?)",
    });
  }

  // ── Server launch sanity test (only when server is not running) ──
  if (!probe.running) {
    await runServerLaunchTest(checks, { hasBundledServer, bundledServerCli, bundledNode });
  }

  // Legacy `~/.pi-dashboard/` advisory moved into shared
  // `runSharedChecks(...)` so both Electron Doctor and the server-side
  // `/api/doctor` route emit the same single row. See change:
  // fix-doctor-stale-managed-install-check.

  // ── Stamp section + suggestion ───────────────────────────────
  stampSectionsAndSuggestions(checks);

  // ── Summary ─────────────────────────────────────────────────
  const summary = {
    ok: checks.filter((c) => c.status === "ok").length,
    warnings: checks.filter((c) => c.status === "warning").length,
    errors: checks.filter((c) => c.status === "error").length,
  };
  return { checks, summary, generatedAt: Date.now() };
}

/**
 * Build the `node --import <jiti> -e "import <spec>; ..."` probe command for the
 * Server launch test. The import spec MUST be a `file://` URL, never a raw
 * filesystem path: on Windows a raw absolute path begins with a drive letter
 * (`C:\`), which Node's ESM resolver treats as a URL scheme and rejects with
 * ERR_UNSUPPORTED_ESM_URL_SCHEME. `pathToFileURL` produces the universal form.
 */
export function buildServerLaunchTestCmd(args: { nodeBin: string; jitiUrl: string; testCli: string }): string {
  const { nodeBin, jitiUrl, testCli } = args;
  const importSpec = JSON.stringify(pathToFileURL(testCli).href);
  return `"${nodeBin}" --import "${jitiUrl}" -e "import ${importSpec.replace(/"/g, '\\"')}; setTimeout(() => process.exit(0), 100)"`;
}

async function runServerLaunchTest(
  checks: DoctorCheck[],
  ctx: { hasBundledServer: boolean; bundledServerCli: string | null; bundledNode: string | null },
): Promise<void> {
  const { hasBundledServer, bundledServerCli, bundledNode } = ctx;
  const testCli = hasBundledServer ? bundledServerCli : null;
  // ToolResolver.resolveJiti probes the managed pi install at MANAGED_DIR
  // automatically; no constructor arg needed for that lookup. extraBinDirs
  // is forwarded so binDir-aware probes match the rest of doctor's checks.
  const resolver = new ToolResolver({});
  const jitiUrl = resolver.resolveJiti({ anchor: testCli ?? undefined });
  const pick = pickNodeForServer({
    bundledNodeDir: getBundledNodeDir(),
    processExecPath: process.execPath,
    platform: process.platform,
  });
  const nodeBin = pick.nodeBin;

  if (!testCli || !jitiUrl) {
    checks.push({
      name: "Server launch test",
      section: "server",
      status: "error",
      message: "Cannot test launch — missing components",
      detail: [testCli ? null : "No server CLI", jitiUrl ? null : "No jiti loader (install pi)"].filter(Boolean).join(", "),
    });
    return;
  }

  const extraPaths = [bundledNode ? path.dirname(bundledNode) : null].filter(Boolean) as string[];
  const env = { ...process.env, PATH: `${extraPaths.join(path.delimiter)}${path.delimiter}${process.env.PATH ?? ""}` };
  const cmd = buildServerLaunchTestCmd({ nodeBin, jitiUrl, testCli });
  const r = safeExec(cmd, { timeoutMs: 15000, env });
  if (r.ok) {
    checks.push({
      name: "Server launch test",
      section: "server",
      status: "ok",
      message: "Server launches cleanly",
    });
    return;
  }
  const messages: Record<string, string> = {
    "not-found": "Server launch test: jiti or server CLI binary missing",
    "permission-denied": "Server launch test: binary not executable",
    timeout: "Server hung during launch test (15s deadline exceeded)",
    "non-zero-exit": "Server fails to start",
    unknown: "Server launch test failed for an unknown reason",
  };
  checks.push({
    name: "Server launch test",
    section: "server",
    status: "error",
    message: messages[r.kind] ?? "Server launch test failed",
    detail: `${r.detail}${r.stderrTail ? `\nstderr: ${r.stderrTail}` : ""}`,
    kind: r.kind,
  });
}

/** Plain-text formatter (legacy, byte-identical to pre-refactor output). */
export function formatDoctorReport(report: DoctorReport): string {
  return formatDoctorReportPlain(report);
}
