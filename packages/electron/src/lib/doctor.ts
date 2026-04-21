/**
 * Doctor: diagnose the PI Dashboard installation.
 * Checks all required binaries, services, and configuration.
 * Reports what's found, what's missing, and can fix missing pieces.
 */
import { execSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { app } from "electron";
import { detectPi, detectOpenSpec, detectSystemNode, detectDashboardPackage } from "./dependency-detector.js";
import { getBundledNodePath, getBundledNpmPath } from "./bundled-node.js";
import { isApiKeyConfigured, readModeFile } from "./wizard-state.js";
import { MANAGED_DIR } from "./managed-paths.js";
import { resolveOfflinePackages } from "./offline-packages.js";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
  detail?: string;
  fixable?: boolean;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  summary: { ok: number; warnings: number; errors: number };
}

/** Get version from a command, or null. */
function getVersion(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

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

/** Run all doctor checks. */
export function runDoctor(): DoctorReport {
  const checks: DoctorCheck[] = [];

  // ── Electron app ─────────────────────────────────────────────

  const electronVersion = process.versions.electron || "unknown";
  const chromeVersion = process.versions.chrome || "unknown";
  checks.push({
    name: "Electron",
    status: "ok",
    message: `${electronVersion} (Chromium ${chromeVersion})`,
    detail: `App version: ${app.getVersion()}, Platform: ${process.platform} ${process.arch}`,
  });

  // ── Node.js ──────────────────────────────────────────────────

  // System Node
  const systemNode = detectSystemNode();
  const systemNodeVersion = systemNode.found
    ? getVersion(`"${systemNode.path}" --version`)
    : null;

  checks.push({
    name: "System Node.js",
    status: systemNode.found ? "ok" : "warning",
    message: systemNode.found
      ? `${systemNodeVersion} at ${systemNode.path}`
      : "Not found on PATH (bundled Node will be used)",
  });

  // Bundled Node
  const bundledNode = getBundledNodePath();
  const bundledNodeVersion = bundledNode ? getVersion(`"${bundledNode}" --version`) : null;

  checks.push({
    name: "Bundled Node.js",
    status: bundledNode ? "ok" : (systemNode.found ? "warning" : "error"),
    message: bundledNode
      ? `${bundledNodeVersion} at ${bundledNode}`
      : "Not found in app resources",
    fixable: !bundledNode && !systemNode.found,
  });

  // Bundled npm
  const bundledNpm = getBundledNpmPath();
  const bundledNpmVersion = bundledNpm
    ? getPkgVersion(path.join(path.dirname(bundledNpm), "..", "package.json"))
    : null;
  checks.push({
    name: "Bundled npm",
    status: bundledNpm ? "ok" : (systemNode.found ? "warning" : "error"),
    message: bundledNpm
      ? `${bundledNpmVersion || "installed"} at ${bundledNpm}`
      : "Not found in app resources",
  });

  // ── pi CLI ───────────────────────────────────────────────────

  const pi = detectPi();
  let piVersion: string | null = null;
  if (pi.found && pi.path) {
    // Try CLI --version first, fall back to package.json
    piVersion = getVersion(`"${pi.path}" --version 2>/dev/null`);
  }
  const managedPiPkg = path.join(MANAGED_DIR, "node_modules", "@mariozechner", "pi-coding-agent", "package.json");
  const managedPiVersion = getPkgVersion(managedPiPkg);
  const piDisplayVersion = piVersion || managedPiVersion;

  checks.push({
    name: "pi CLI",
    status: pi.found ? "ok" : "error",
    message: pi.found
      ? `v${piDisplayVersion || "?"} (${pi.source}) at ${pi.path}`
      : "Not found — required to run agent sessions",
    fixable: !pi.found,
  });

  // ── openspec CLI ─────────────────────────────────────────────

  const openspec = detectOpenSpec();
  let openspecVersion: string | null = null;
  if (openspec.found && openspec.path) {
    openspecVersion = getVersion(`"${openspec.path}" --version 2>/dev/null`);
  }
  const managedOsPkg = path.join(MANAGED_DIR, "node_modules", "@fission-ai", "openspec", "package.json");
  const managedOsVersion = getPkgVersion(managedOsPkg);
  const osDisplayVersion = openspecVersion || managedOsVersion;

  checks.push({
    name: "openspec CLI",
    status: openspec.found ? "ok" : "warning",
    message: openspec.found
      ? `v${osDisplayVersion || "?"} (${openspec.source}) at ${openspec.path}`
      : "Not found — optional, needed for OpenSpec workflows",
    fixable: !openspec.found,
  });

  // ── Dashboard package ────────────────────────────────────────

  // Check for bundled server (in Electron resources) OR installed package
  const bundledServerCli = (process as any).resourcesPath
    ? path.join((process as any).resourcesPath, "server", "packages", "server", "src", "cli.ts")
    : null;
  const hasBundledServer = bundledServerCli && existsSync(bundledServerCli);

  const dashboard = detectDashboardPackage();
  let dashVersion: string | null = null;
  if (dashboard.found && dashboard.path) {
    dashVersion = getPkgVersion(dashboard.path);
  }
  if (hasBundledServer && !dashVersion) {
    const bundledPkg = path.join((process as any).resourcesPath, "server", "packages", "server", "package.json");
    dashVersion = getPkgVersion(bundledPkg);
  }

  checks.push({
    name: "Dashboard server code",
    status: hasBundledServer || dashboard.found ? "ok" : "error",
    message: hasBundledServer
      ? `v${dashVersion || "?"} (bundled) at ${bundledServerCli}`
      : dashboard.found
        ? `v${dashVersion || "?"} (${dashboard.source}) at ${path.dirname(dashboard.path!)}`
        : "Not found — required for the dashboard server",
    fixable: !hasBundledServer && !dashboard.found,
  });

  // ── Offline packages bundle ─────────────────────────
  // Per-platform cacache of pi + openspec + tsx. Present in release
  // builds (via BUNDLE_OFFLINE_PACKAGES=1 in CI), absent in dev builds.
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  const offlineResolution = resourcesPath
    ? resolveOfflinePackages(resourcesPath)
    : { present: false as const, reason: "no resourcesPath" };

  if (offlineResolution.present) {
    const m = offlineResolution.manifest;
    const pkgList = m.packages.map(p => `${p.name.split("/").pop()}@${p.version}`).join(", ");
    checks.push({
      name: "Offline packages bundle",
      status: "ok",
      message: `Present (target=${m.targetPlatform}, ${m.packages.length} pinned)`,
      detail: `${pkgList} — bundled ${m.bundledAt}, sha256 ${m.sha256.slice(0, 12)}…`,
    });
  } else {
    checks.push({
      name: "Offline packages bundle",
      status: "warning",
      message: "Not bundled (registry-install mode)",
      detail: `First-run will require network access to registry.npmjs.org. Reason: ${offlineResolution.reason}`,
    });
  }

  // ── tsx / TypeScript loader ──────────────────────────────────

  const managedTsx = path.join(MANAGED_DIR, "node_modules", "tsx", "package.json");
  const tsxVersion = getPkgVersion(managedTsx);
  let systemTsx: string | null = null;
  let systemTsxVersion: string | null = null;
  try {
    systemTsx = execSync(process.platform === "win32" ? "where tsx" : "which tsx", {
      encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    }).trim().split("\n")[0];
    if (systemTsx) {
      systemTsxVersion = getVersion(`"${systemTsx}" --version 2>/dev/null`);
    }
  } catch { /* not found */ }

  const tsxFound = !!tsxVersion || !!systemTsx;
  const tsxDisplayVersion = tsxVersion || systemTsxVersion;
  checks.push({
    name: "TypeScript loader (tsx)",
    status: tsxFound ? "ok" : "error",
    message: tsxFound
      ? tsxVersion
        ? `v${tsxVersion} (managed) at ${path.dirname(managedTsx)}`
        : `v${systemTsxVersion || "?"} (system) at ${systemTsx}`
      : "Not found — required to run the dashboard server",
    fixable: !tsxFound,
  });

  // ── Dashboard server ─────────────────────────────────────────

  let serverRunning = false;
  let serverMode: string | null = null;
  let serverVersion: string | null = null;
  try {
    const res = execSync("curl -sf http://localhost:8000/api/health 2>/dev/null", {
      encoding: "utf-8", timeout: 3000,
    });
    if (res) {
      serverRunning = true;
      try {
        const health = JSON.parse(res);
        serverMode = health.mode || null;
        serverVersion = health.version || null;
      } catch { /* not JSON */ }
    }
  } catch { /* not running */ }

  checks.push({
    name: "Dashboard server",
    status: serverRunning ? "ok" : "warning",
    message: serverRunning
      ? `Running${serverVersion ? " v" + serverVersion : ""}${serverMode ? " (" + serverMode + " mode)" : ""} at http://localhost:8000`
      : "Not running — will be started automatically when needed",
  });

  // ── Setup wizard state ───────────────────────────────────────

  const modeConfig = readModeFile();
  checks.push({
    name: "Setup wizard",
    status: modeConfig ? "ok" : "warning",
    message: modeConfig
      ? `Completed (${modeConfig.mode} mode, ${modeConfig.completedAt})`
      : "Not completed — wizard will run on next launch",
  });

  // ── API key ──────────────────────────────────────────────────

  const hasApiKey = isApiKeyConfigured();
  checks.push({
    name: "API key",
    status: hasApiKey ? "ok" : "warning",
    message: hasApiKey
      ? "Configured in pi settings"
      : "Not configured — pi sessions will need a key to use LLM providers",
  });

  // ── Server log ─────────────────────────────────────────────

  const logPath = path.join(MANAGED_DIR, "server.log");
  let lastLogLines = "";
  if (existsSync(logPath)) {
    try {
      const content = readFileSync(logPath, "utf-8");
      lastLogLines = content.split("\n").slice(-10).join("\n").trim();
    } catch { /* ignore */ }
  }

  if (!serverRunning && lastLogLines) {
    checks.push({
      name: "Server log (~/.pi-dashboard/server.log)",
      status: "warning",
      message: "Last entries:",
      detail: lastLogLines,
    });
  }

  // If server not running, try a test launch to capture the error
  if (!serverRunning) {
    const testCli = hasBundledServer ? bundledServerCli : null;
    // Use tsx binary (not --import register.js — that doesn't shim __dirname)
    const ext = process.platform === "win32" ? ".cmd" : "";
    const managedTsxBin = path.join(MANAGED_DIR, "node_modules", ".bin", "tsx" + ext);
    const testTsxBin = existsSync(managedTsxBin) ? managedTsxBin : systemTsx;

    if (testCli && testTsxBin) {
      let testError = "";
      try {
        // Build PATH with bundled node + managed bins (same as server-lifecycle.ts)
        const testEnv = { ...process.env };
        const extraPaths = [bundledNode ? path.dirname(bundledNode) : null, path.dirname(testTsxBin)].filter(Boolean);
        testEnv.PATH = `${extraPaths.join(path.delimiter)}${path.delimiter}${testEnv.PATH || ""}`;
        // Use tsx binary to load the server CLI — same as server-lifecycle.ts
        const testCmd = `"${testTsxBin}" -e "import '${testCli.replace(/'/g, "\\'")}'; setTimeout(() => process.exit(0), 100)" 2>&1`;
        execSync(testCmd, { encoding: "utf-8", timeout: 10000, env: testEnv });
      } catch (err: any) {
        testError = (err.stderr || err.stdout || err.message || "").toString().trim();
        // Take last 10 lines
        testError = testError.split("\n").slice(-10).join("\n");
      }
      if (testError) {
        checks.push({
          name: "Server launch test",
          status: "error",
          message: "Server fails to start:",
          detail: testError,
        });
      }
    } else {
      checks.push({
        name: "Server launch test",
        status: "error",
        message: "Cannot test launch — missing components:",
        detail: [
          testCli ? null : "No server CLI",
          testTsxBin ? null : "No tsx binary",
        ].filter(Boolean).join(", "),
      });
    }
  }

  // ── Managed install directory ────────────────────────────────

  const managedExists = existsSync(MANAGED_DIR);
  const managedPkgJson = existsSync(path.join(MANAGED_DIR, "package.json"));
  const managedModules = existsSync(path.join(MANAGED_DIR, "node_modules"));

  checks.push({
    name: "Managed install (~/.pi-dashboard)",
    status: managedExists && managedModules ? "ok" : managedExists ? "warning" : "warning",
    message: managedExists
      ? managedModules
        ? `Exists with node_modules at ${MANAGED_DIR}`
        : `Exists but no node_modules — may need reinstall`
      : "Not created yet — will be set up on first run",
  });

  // ── Summary ──────────────────────────────────────────────────

  const summary = {
    ok: checks.filter(c => c.status === "ok").length,
    warnings: checks.filter(c => c.status === "warning").length,
    errors: checks.filter(c => c.status === "error").length,
  };

  return { checks, summary };
}

/** Format the doctor report as a readable string. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push("PI Dashboard Doctor");
  lines.push("═".repeat(50));
  lines.push("");

  for (const check of report.checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warning" ? "⚠" : "✗";
    const fixHint = check.fixable ? " [fixable]" : "";
    lines.push(`  ${icon} ${check.name}${fixHint}`);
    lines.push(`    ${check.message}`);
    if (check.detail) lines.push(`    ${check.detail}`);
  }

  lines.push("");
  lines.push("─".repeat(50));
  lines.push(`  ${report.summary.ok} passed, ${report.summary.warnings} warnings, ${report.summary.errors} errors`);

  if (report.summary.errors > 0) {
    const fixable = report.checks.filter(c => c.status === "error" && c.fixable);
    if (fixable.length > 0) {
      lines.push("");
      lines.push(`  ${fixable.length} error(s) can be fixed automatically.`);
      lines.push("  Run setup wizard to install missing components.");
    }
  }

  return lines.join("\n");
}
