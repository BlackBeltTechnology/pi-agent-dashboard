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
import { app } from "electron";
import { detectPi, detectOpenSpec, detectSystemNode, detectDashboardPackage } from "./dependency-detector.js";
import { getBundledNodePath, getBundledNpmPath } from "./bundled-node.js";
import { isApiKeyConfigured } from "./wizard-state.js";
import { MANAGED_DIR } from "./managed-paths.js";
import { resolveOfflinePackages } from "./offline-packages.js";
import { installManagedNode } from "@blackbelt-technology/pi-dashboard-shared/bootstrap-install.js";
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
 * Repair-and-report for the managed Node runtime under
 * `~/.pi-dashboard/node/`. Always invokes `installManagedNode` so a
 * missing or version-mismatched copy is restored; idempotent when the
 * marker matches.
 */
export async function checkManagedNodeRuntime(opts?: {
  install?: typeof installManagedNode;
  bundledNodeBinary?: string | null;
  managedDir?: string;
}): Promise<DoctorCheck> {
  const install = opts?.install ?? installManagedNode;
  const bundledNodeBinary = opts?.bundledNodeBinary ?? getBundledNodePath();
  const managedDir = opts?.managedDir ?? MANAGED_DIR;
  const bundledDir = bundledNodeBinary
    ? (process.platform === "win32" // platform-branch-ok
        ? path.dirname(bundledNodeBinary)
        : path.dirname(path.dirname(bundledNodeBinary)))
    : null;

  let installError: string | undefined;
  try {
    const r = await install({ bundledNodeDir: bundledDir, managedDir });
    if (!r.ok) installError = r.error;
  } catch (err) {
    installError = err instanceof Error ? err.message : String(err);
  }

  const managedNodeBinary = process.platform === "win32"
    ? path.join(managedDir, "node", "node.exe")
    : path.join(managedDir, "node", "bin", "node");
  const markerPath = path.join(managedDir, "node", ".version");
  const present = existsSync(managedNodeBinary);
  const markerVersion = existsSync(markerPath)
    ? readFileSync(markerPath, "utf-8").trim() || null
    : null;

  if (installError) {
    return {
      name: "Managed Node runtime",
      section: "runtime",
      status: "warning",
      message: `Failed to install: ${installError}`,
      detail: `Target: ${path.join(managedDir, "node")}`,
      fixable: true,
    };
  }
  if (!present && !bundledDir) {
    return {
      name: "Managed Node runtime",
      section: "runtime",
      status: "warning",
      message: "Not installed (no bundled source — standalone CLI install)",
      detail: `System Node will be used. Target: ${path.join(managedDir, "node")}`,
    };
  }
  if (!present) {
    return {
      name: "Managed Node runtime",
      section: "runtime",
      status: "error",
      message: "Install attempted but binary not found",
      detail: `Target: ${managedNodeBinary}`,
      fixable: true,
    };
  }
  return {
    name: "Managed Node runtime",
    section: "runtime",
    status: "ok",
    message: `${markerVersion || "installed"} at ${path.join(managedDir, "node")}`,
  };
}

/** Probe the dashboard server's /api/health endpoint via curl through safeExec. */
function probeServer(): Promise<{
  running: boolean;
  version?: string;
  mode?: string;
  starter?: string | null;
  installable?: { total: number; installed: number; failed: string[] } | null;
}> {
  const r = safeExec("curl -sf http://localhost:8000/api/health 2>/dev/null", { timeoutMs: 3000 });
  if (!r.ok || !r.stdout.trim()) return Promise.resolve({ running: false });
  try {
    const health = JSON.parse(r.stdout);
    return Promise.resolve({
      running: true,
      version: typeof health.version === "string" ? health.version : undefined,
      mode: typeof health.mode === "string" ? health.mode : undefined,
      starter: typeof health.starter === "string" ? health.starter : null,
      installable:
        health.installable && typeof health.installable === "object"
          ? {
              total: health.installable.total ?? 0,
              installed: health.installable.installed ?? 0,
              failed: Array.isArray(health.installable.failed) ? health.installable.failed : [],
            }
          : null,
    });
  } catch {
    return Promise.resolve({ running: true });
  }
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
    probeServer,
    isApiKeyConfigured,
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

  // ── Offline packages bundle ──────────────────────────────────
  const offlineRow = assumedMandatory(
    "resolveOfflinePackages",
    () => (resourcesPath ? resolveOfflinePackages(resourcesPath) : { present: false as const, reason: "no resourcesPath" }),
    { managedDir: MANAGED_DIR },
  );
  if (!offlineRow.ok) {
    checks.push(offlineRow.row);
  } else {
    const offlineResolution = offlineRow.value;
    if (offlineResolution.present) {
      const m = offlineResolution.manifest;
      const pkgList = m.packages.map((p) => `${p.name.split("/").pop()}@${p.version}`).join(", ");
      checks.push({
        name: "Offline packages bundle",
        section: "server",
        status: "ok",
        message: `Present (target=${m.targetPlatform}, ${m.packages.length} pinned)`,
        detail: `${pkgList} — bundled ${m.bundledAt}, sha256 ${m.sha256.slice(0, 12)}…`,
      });
    } else {
      checks.push({
        name: "Offline packages bundle",
        section: "server",
        status: "warning",
        message: "Not bundled (registry-install mode)",
        detail: `First-run will require network access to registry.npmjs.org. Reason: ${offlineResolution.reason}`,
      });
    }
  }

  // ── Server starter / installable list (from health JSON) ────
  const probe = await probeServer();
  if (probe.running) {
    checks.push({
      name: "Server starter",
      section: "server",
      status: probe.starter ? "ok" : "warning",
      message: probe.starter ?? "Unknown (old server?)",
    });
    if (probe.installable) {
      const failCount = probe.installable.failed.length;
      checks.push({
        name: "Installable list",
        section: "server",
        status: failCount > 0 ? "error" : "ok",
        message:
          `${probe.installable.installed}/${probe.installable.total} installed` +
          (failCount > 0 ? `, ${failCount} failed: ${probe.installable.failed.join(", ")}` : ""),
        fixable: failCount > 0,
      });
    }
  }

  // ── Server launch sanity test (only when server is not running) ──
  if (!probe.running) {
    await runServerLaunchTest(checks, { hasBundledServer, bundledServerCli, bundledNode });
  }

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

async function runServerLaunchTest(
  checks: DoctorCheck[],
  ctx: { hasBundledServer: boolean; bundledServerCli: string | null; bundledNode: string | null },
): Promise<void> {
  const { hasBundledServer, bundledServerCli, bundledNode } = ctx;
  const ext = process.platform === "win32" ? ".cmd" : "";
  const managedTsxBin = path.join(MANAGED_DIR, "node_modules", ".bin", "tsx" + ext);
  let testTsxBin: string | null = existsSync(managedTsxBin) ? managedTsxBin : null;
  if (!testTsxBin) {
    const lookup = safeExec(process.platform === "win32" ? "where tsx" : "which tsx", { timeoutMs: 5000 });
    if (lookup.ok) testTsxBin = lookup.stdout.trim().split("\n")[0] || null;
  }
  const testCli = hasBundledServer ? bundledServerCli : null;

  if (!testCli || !testTsxBin) {
    checks.push({
      name: "Server launch test",
      section: "server",
      status: "error",
      message: "Cannot test launch — missing components",
      detail: [testCli ? null : "No server CLI", testTsxBin ? null : "No tsx binary"].filter(Boolean).join(", "),
    });
    return;
  }

  const extraPaths = [bundledNode ? path.dirname(bundledNode) : null, path.dirname(testTsxBin)].filter(Boolean) as string[];
  const env = { ...process.env, PATH: `${extraPaths.join(path.delimiter)}${path.delimiter}${process.env.PATH ?? ""}` };
  const importSpec = JSON.stringify(testCli);
  const cmd = `"${testTsxBin}" -e "import ${importSpec.replace(/"/g, '\\"')}; setTimeout(() => process.exit(0), 100)"`;
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
    "not-found": "Server launch test: tsx or server CLI binary missing",
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
