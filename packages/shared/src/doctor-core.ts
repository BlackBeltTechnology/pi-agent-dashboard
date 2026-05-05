/**
 * Doctor core — shared diagnostic primitives used by both the Electron app
 * (`packages/electron/src/lib/doctor.ts`) and the dashboard server route
 * (`packages/server/src/routes/doctor-routes.ts`).
 *
 * Hosts the canonical type system, section taxonomy, suggestion mapping,
 * fault-tolerance helpers (`safeCheck` / `safeExec` / `assumedMandatory`),
 * a shared `runSharedChecks` for non-Electron checks, and the Markdown
 * report formatter.
 *
 * See change: doctor-rich-output (proposal.md, design.md).
 */
import { execSync } from "./platform/exec.js";
import { existsSync, readFileSync, statSync, renameSync, appendFileSync } from "node:fs";
import path from "node:path";

// ─── Types ─────────────────────────────────────────────────────────────

export type DoctorSection = "runtime" | "pi-tooling" | "server" | "setup" | "diagnostics";

export type DoctorStatus = "ok" | "warning" | "error";

export type ExecFailureKind =
  | "not-found"
  | "permission-denied"
  | "timeout"
  | "non-zero-exit"
  | "unknown";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  section: DoctorSection;
  message: string;
  detail?: string;
  suggestion?: string;
  fixable?: boolean;
  /** Populated when the check ran an external command and it failed. */
  kind?: ExecFailureKind;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  summary: { ok: number; warnings: number; errors: number };
  generatedAt?: number;
}

// ─── stripAnsi ─────────────────────────────────────────────────────────

/**
 * Strip standard ANSI CSI / OSC escape sequences. No external dependency.
 */
export function stripAnsi(input: string): string {
  if (!input) return "";
  // CSI sequences: ESC [ ... letter (incl. SGR colors, cursor moves)
  // OSC sequences: ESC ] ... BEL or ESC \
  // Plus a few standalone escapes (ESC = ESC + char like ESC ( B).
  // eslint-disable-next-line no-control-regex
  const csi = /\u001b\[[0-?]*[ -/]*[@-~]/g;
  // eslint-disable-next-line no-control-regex
  const osc = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
  // eslint-disable-next-line no-control-regex
  const single = /\u001b[@-Z\\-_]/g;
  return input.replace(csi, "").replace(osc, "").replace(single, "");
}

// ─── safeExec ──────────────────────────────────────────────────────────

export interface SafeExecOk {
  ok: true;
  stdout: string;
}
export interface SafeExecErr {
  ok: false;
  kind: ExecFailureKind;
  message: string;
  detail: string;
  exitCode?: number;
  stderrTail?: string;
  /** Whatever timeoutMs was used for the call (ms). */
  timeoutMs: number;
}
export type SafeExecResult = SafeExecOk | SafeExecErr;

export interface SafeExecOpts {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/**
 * Run a command via `execSync`, classify failures, and capture a stderr tail.
 *
 * Defaults: 5000 ms timeout, `windowsHide: true`. Cold-start probes (bundled
 * Node, server-launch test) pass `timeoutMs: 15000`.
 */
export function safeExec(cmd: string, opts: SafeExecOpts = {}): SafeExecResult {
  const timeoutMs = opts.timeoutMs ?? 5000;
  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
      env: opts.env,
      cwd: opts.cwd,
    });
    return { ok: true, stdout: stdout.toString() };
  } catch (err) {
    return classifyExecError(err, cmd, timeoutMs);
  }
}

function classifyExecError(err: unknown, cmd: string, timeoutMs: number): SafeExecErr {
  const e = err as NodeJS.ErrnoException & {
    status?: number;
    signal?: NodeJS.Signals | null;
    stdout?: Buffer | string;
    stderr?: Buffer | string;
  };
  const stderrRaw = e.stderr ? e.stderr.toString() : "";
  const stderrTail = stripAnsi(stderrRaw).slice(-500);
  const stdoutRaw = e.stdout ? e.stdout.toString() : "";
  const code = e.code ?? "";
  const errno = (e as { errno?: number }).errno;
  const status = e.status;
  const signal = e.signal;
  const baseMsg = e.message || String(err);

  // ENOENT — binary not found / file missing
  if (code === "ENOENT") {
    return {
      ok: false,
      kind: "not-found",
      message: "Command not found",
      detail: `${cmd}\n${baseMsg}`,
      stderrTail: stderrTail || undefined,
      timeoutMs,
    };
  }
  // EACCES / EPERM — permission denied
  if (code === "EACCES" || code === "EPERM") {
    return {
      ok: false,
      kind: "permission-denied",
      message: "Permission denied",
      detail: `${cmd}\n${baseMsg}`,
      stderrTail: stderrTail || undefined,
      timeoutMs,
    };
  }
  // Timeout — execSync throws ETIMEDOUT (errno -2 on linux, signal SIGTERM, code "ETIMEDOUT")
  if (
    code === "ETIMEDOUT" ||
    signal === "SIGTERM" ||
    errno === -2 ||
    /timed?\s*out/i.test(baseMsg)
  ) {
    return {
      ok: false,
      kind: "timeout",
      message: `Command did not respond within ${Math.round(timeoutMs / 1000)}s`,
      detail: `${cmd}\nDeadline: ${timeoutMs}ms`,
      stderrTail: stderrTail || undefined,
      timeoutMs,
    };
  }
  // Non-zero exit
  if (typeof status === "number" && status !== 0) {
    return {
      ok: false,
      kind: "non-zero-exit",
      message: `Command exited with status ${status}`,
      detail: `${cmd}${stdoutRaw ? `\nstdout: ${stripAnsi(stdoutRaw).slice(-200)}` : ""}`,
      exitCode: status,
      stderrTail: stderrTail || undefined,
      timeoutMs,
    };
  }
  // Unknown
  return {
    ok: false,
    kind: "unknown",
    message: "Command failed",
    detail: `${cmd}\n${baseMsg}`,
    stderrTail: stderrTail || undefined,
    timeoutMs,
  };
}

// ─── safeCheck ─────────────────────────────────────────────────────────

/**
 * Per-check fault-isolation wrapper. Catches any throw / rejection from
 * `fn` and returns a `diagnostics`-section error row that carries a
 * non-empty `message` / `detail` / `suggestion`. Never propagates.
 */
export async function safeCheck(
  name: string,
  section: DoctorSection,
  fn: () => DoctorCheck | Promise<DoctorCheck>,
): Promise<DoctorCheck> {
  try {
    const result = await fn();
    // If caller forgot to set section, default it.
    if (!result.section) result.section = section;
    return result;
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const stack = (e.stack || "").split("\n").slice(0, 4).join("\n");
    return {
      name,
      section,
      status: "error",
      message: "Check failed to run",
      detail: `${e.message}\n${stack}`,
      suggestion:
        "This is a doctor-internal failure. Please file an issue with the Markdown export attached.",
    };
  }
}

// ─── assumedMandatory ─────────────────────────────────────────────────

export interface AssumedDeps {
  /** Managed install dir. `<managedDir>/doctor.log` is the log path. */
  managedDir: string;
}

const DOCTOR_LOG_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Wrap a "should-never-fail" operation. On throw:
 *   1. Append a JSON line to `<managedDir>/doctor.log` (with prior ring rotation if >1MB).
 *   2. Return a diagnostics-section error row labelled "Doctor internal: <label>".
 *
 * Both rotation and append are wrapped in try/catch and silently drop
 * on failure — a broken log file MUST never cascade into the report.
 */
export function assumedMandatory<T>(
  label: string,
  fn: () => T,
  deps: AssumedDeps,
): { ok: true; value: T } | { ok: false; row: DoctorCheck } {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    appendDoctorLog(deps.managedDir, label, e);
    return {
      ok: false,
      row: {
        name: `Doctor internal: ${label}`,
        section: "diagnostics",
        status: "error",
        message: "An assumed-safe operation failed",
        detail: `${e.message}\n${(e.stack || "").split("\n").slice(0, 4).join("\n")}`,
        suggestion:
          "Open `~/.pi-dashboard/doctor.log` for full context, then file an issue with the Markdown export attached.",
      },
    };
  }
}

function appendDoctorLog(managedDir: string, label: string, err: Error): void {
  try {
    const logPath = path.join(managedDir, "doctor.log");
    rotateDoctorLogIfNeeded(logPath);
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        label,
        message: err.message,
        stack: (err.stack || "").split("\n").slice(0, 6).join(" | "),
      }) + "\n";
    appendFileSync(logPath, line, { encoding: "utf-8" });
  } catch {
    // logging failure must never propagate
  }
}

function rotateDoctorLogIfNeeded(logPath: string): void {
  try {
    if (!existsSync(logPath)) return;
    const size = statSync(logPath).size;
    if (size <= DOCTOR_LOG_MAX_BYTES) return;
    const rotated = `${logPath}.1`;
    try {
      // Best-effort: rename overwrites on POSIX, but on Windows we may need to remove the old .1 first.
      renameSync(logPath, rotated);
    } catch {
      // try once more after best-effort cleanup
      try {
        const fs = require("node:fs") as typeof import("node:fs");
        if (existsSync(rotated)) fs.rmSync(rotated, { force: true });
        renameSync(logPath, rotated);
      } catch {
        // give up silently
      }
    }
  } catch {
    // never propagate
  }
}

// ─── Section + suggestion taxonomy ────────────────────────────────────

/**
 * Canonical check-name → section. Every check name pushed by either
 * `runSharedChecks` (here) or `runDoctor` (Electron) MUST appear here.
 */
export const SECTION_OF: Record<string, DoctorSection> = {
  // runtime
  Electron: "runtime",
  "System Node.js": "runtime",
  "Bundled Node.js": "runtime",
  "Bundled npm": "runtime",
  "Managed Node runtime": "runtime",
  // pi-tooling
  "pi CLI": "pi-tooling",
  "openspec CLI": "pi-tooling",
  // server
  "Dashboard server code": "server",
  "Offline packages bundle": "server",
  "TypeScript loader (tsx)": "server",
  "Dashboard server": "server",
  "Server starter": "server",
  "Installable list": "server",
  "Server log (~/.pi-dashboard/server.log)": "server",
  "Server launch test": "server",
  // setup
  "Setup wizard": "setup",
  "API key": "setup",
  // diagnostics
  "Managed install (~/.pi-dashboard)": "diagnostics",
};

/**
 * Suggestion factories. Returns a remediation string tailored to the
 * status / failure kind, or `undefined` for ok rows.
 *
 * Strings use only the small Markdown subset `**bold**`,
 * single-backtick `code`, `[text](url)`. Lint-enforced in
 * `doctor-core.test.ts`.
 */
export type SuggestionFn = (
  status: DoctorStatus,
  detail?: string,
  kind?: ExecFailureKind,
) => string | undefined;

const reinstallPi = "Reinstall **PI Dashboard** or run the setup wizard from the App menu (Help → Setup).";

function execKindSuggestion(label: string, kind?: ExecFailureKind, timeoutSec = 5): string {
  switch (kind) {
    case "not-found":
      return `${label} binary missing. Reinstall **PI Dashboard** or check your PATH.`;
    case "permission-denied":
      return `${label} binary not executable. On Linux run `+"`chmod +x <path>`"+`; on macOS run `+"`xattr -cr <Resources>`"+` to clear quarantine.`;
    case "timeout":
      return `${label} did not respond within ${timeoutSec}s. Antivirus or endpoint security is likely scanning the binary on first launch — wait 30s and re-run, or whitelist the app.`;
    case "non-zero-exit":
      return `${label} executed but reported failure. ${reinstallPi}`;
    default:
      return `${label} failed for an unknown reason. ${reinstallPi}`;
  }
}

export const SUGGESTIONS: Record<string, SuggestionFn> = {
  Electron: () => undefined, // never fails today
  "System Node.js": (status) =>
    status === "ok"
      ? undefined
      : "System Node.js not on PATH. The bundled runtime will be used; this is fine for most users. To install, see [nodejs.org](https://nodejs.org).",
  "Bundled Node.js": (status, _d, kind) =>
    status === "ok" ? undefined : execKindSuggestion("Bundled Node", kind, 15),
  "Bundled npm": (status, _d, kind) =>
    status === "ok" ? undefined : execKindSuggestion("Bundled npm", kind, 5),
  "Managed Node runtime": (status) =>
    status === "ok"
      ? undefined
      : "Managed Node runtime missing under `~/.pi-dashboard/node`. Re-run the setup wizard (Help → Setup).",
  "pi CLI": (status, _d, kind) =>
    status === "ok"
      ? undefined
      : kind
        ? execKindSuggestion("pi CLI", kind, 5)
        : "`pi` not found. Run the setup wizard (Help → Setup) to install it under `~/.pi-dashboard`.",
  "openspec CLI": (status, _d, kind) =>
    status === "ok"
      ? undefined
      : kind
        ? execKindSuggestion("openspec CLI", kind, 5)
        : "`openspec` not found. Optional, but required for OpenSpec workflows. Run the setup wizard.",
  "Dashboard server code": (status) =>
    status === "ok"
      ? undefined
      : "Dashboard server code not found in app resources. Reinstall **PI Dashboard**.",
  "Offline packages bundle": (status) =>
    status === "ok"
      ? undefined
      : "Offline packages bundle absent. First-run install will require network access to `registry.npmjs.org`.",
  "TypeScript loader (tsx)": (status) =>
    status === "ok"
      ? undefined
      : "`tsx` not found. Required to run the dashboard server. Run the setup wizard (Help → Setup).",
  "Dashboard server": (status) =>
    status === "ok"
      ? undefined
      : "Dashboard server not running on `http://localhost:8000`. It will be started automatically when needed.",
  "Server starter": (status) =>
    status === "ok"
      ? undefined
      : "Server starter unknown — older server build. Restart the server.",
  "Installable list": (status) =>
    status === "ok"
      ? undefined
      : "Some installable packages failed to install. Check `~/.pi-dashboard/server.log` for details.",
  "Server log (~/.pi-dashboard/server.log)": (status) =>
    status === "ok"
      ? undefined
      : "Recent server log entries shown — the server may have failed to start. Open the log for full context.",
  "Server launch test": (status, _d, kind) =>
    status === "ok"
      ? undefined
      : kind
        ? execKindSuggestion("Server launch test", kind, 15)
        : "Server failed to start during the doctor's test launch. Check `detail` for the captured stderr.",
  "Setup wizard": (status) =>
    status === "ok"
      ? undefined
      : "Setup wizard has not completed. Open **Help → Setup** in the app menu.",
  "API key": (status) =>
    status === "ok"
      ? undefined
      : "No API key configured. Pi sessions need an LLM provider key. Configure one in **Settings → Providers**.",
  "Managed install (~/.pi-dashboard)": (status) =>
    status === "ok"
      ? undefined
      : "Managed install incomplete. Run the setup wizard (**Help → Setup**) to finish first-run install.",
};

// ─── runSharedChecks ──────────────────────────────────────────────────

export interface SharedChecksDeps {
  managedDir: string;
  /** Detector for system Node ({path, found}). */
  detectSystemNode: () => { found: boolean; path?: string };
  /** Detector for pi CLI ({path, source, found}). */
  detectPi: () => { found: boolean; path?: string; source?: string };
  /** Detector for openspec CLI. */
  detectOpenSpec: () => { found: boolean; path?: string; source?: string };
  /** Optional: localhost server probe. Default uses curl-style fetch. */
  probeServer?: () => Promise<{
    running: boolean;
    version?: string;
    mode?: string;
    starter?: string | null;
    installable?: { total: number; installed: number; failed: string[] } | null;
  }>;
  /** Optional: api-key check. */
  isApiKeyConfigured?: () => boolean;
}

export async function runSharedChecks(deps: SharedChecksDeps): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const managedDir = deps.managedDir;

  // System Node
  checks.push(
    await safeCheck("System Node.js", "runtime", () => {
      const sys = deps.detectSystemNode();
      if (!sys.found) {
        return {
          name: "System Node.js",
          section: "runtime",
          status: "warning",
          message: "Not found on PATH (bundled Node will be used)",
          detail: "PATH searched without success",
        };
      }
      const ver = safeExec(`"${sys.path}" --version`, { timeoutMs: 5000 });
      if (!ver.ok) {
        return {
          name: "System Node.js",
          section: "runtime",
          status: "warning",
          message: ver.message,
          detail: `${ver.detail}${ver.stderrTail ? `\nstderr: ${ver.stderrTail}` : ""}`,
          kind: ver.kind,
        };
      }
      return {
        name: "System Node.js",
        section: "runtime",
        status: "ok",
        message: `${ver.stdout.trim()} at ${sys.path}`,
      };
    }),
  );

  // pi CLI
  checks.push(
    await safeCheck("pi CLI", "pi-tooling", () => {
      const pi = deps.detectPi();
      if (!pi.found || !pi.path) {
        return {
          name: "pi CLI",
          section: "pi-tooling",
          status: "error",
          message: "Not found — required to run agent sessions",
          detail: "Searched system PATH and managed install",
          fixable: true,
        };
      }
      const ver = safeExec(`"${pi.path}" --version`, { timeoutMs: 5000 });
      const versionDisplay = ver.ok ? ver.stdout.trim() : "?";
      return {
        name: "pi CLI",
        section: "pi-tooling",
        status: "ok",
        message: `${versionDisplay} (${pi.source ?? "unknown"}) at ${pi.path}`,
      };
    }),
  );

  // openspec CLI
  checks.push(
    await safeCheck("openspec CLI", "pi-tooling", () => {
      const os = deps.detectOpenSpec();
      if (!os.found || !os.path) {
        return {
          name: "openspec CLI",
          section: "pi-tooling",
          status: "warning",
          message: "Not found — optional, needed for OpenSpec workflows",
          detail: "Searched system PATH and managed install",
          fixable: true,
        };
      }
      const ver = safeExec(`"${os.path}" --version`, { timeoutMs: 5000 });
      const versionDisplay = ver.ok ? ver.stdout.trim() : "?";
      return {
        name: "openspec CLI",
        section: "pi-tooling",
        status: "ok",
        message: `${versionDisplay} (${os.source ?? "unknown"}) at ${os.path}`,
      };
    }),
  );

  // tsx (TypeScript loader)
  checks.push(
    await safeCheck("TypeScript loader (tsx)", "server", () => {
      const managedTsxPkg = path.join(managedDir, "node_modules", "tsx", "package.json");
      let tsxVersion: string | null = null;
      try {
        if (existsSync(managedTsxPkg)) {
          const pkg = JSON.parse(readFileSync(managedTsxPkg, "utf-8"));
          tsxVersion = pkg.version || null;
        }
      } catch {
        // ignore
      }
      let systemTsx: string | null = null;
      const lookupCmd = process.platform === "win32" ? "where tsx" : "which tsx"; // platform-branch-ok: localised PATH-lookup primitive
      const lookup = safeExec(lookupCmd, { timeoutMs: 5000 });
      if (lookup.ok) {
        systemTsx = lookup.stdout.trim().split("\n")[0] || null;
      }
      const found = !!tsxVersion || !!systemTsx;
      if (!found) {
        return {
          name: "TypeScript loader (tsx)",
          section: "server",
          status: "error",
          message: "Not found — required to run the dashboard server",
          detail: `Looked under ${managedTsxPkg} and on PATH`,
          fixable: true,
        };
      }
      return {
        name: "TypeScript loader (tsx)",
        section: "server",
        status: "ok",
        message: tsxVersion
          ? `v${tsxVersion} (managed) at ${path.dirname(managedTsxPkg)}`
          : `(system) at ${systemTsx}`,
      };
    }),
  );

  // Dashboard server probe
  checks.push(
    await safeCheck("Dashboard server", "server", async () => {
      if (!deps.probeServer) {
        return {
          name: "Dashboard server",
          section: "server",
          status: "warning",
          message: "Not probed (no probe configured)",
          detail: "deps.probeServer was not provided",
        };
      }
      const r = await deps.probeServer();
      if (!r.running) {
        return {
          name: "Dashboard server",
          section: "server",
          status: "warning",
          message: "Not running — will be started automatically when needed",
          detail: "GET http://localhost:8000/api/health returned no response",
        };
      }
      return {
        name: "Dashboard server",
        section: "server",
        status: "ok",
        message: `Running${r.version ? " v" + r.version : ""}${r.mode ? " (" + r.mode + " mode)" : ""} at http://localhost:8000`,
      };
    }),
  );

  // Server log presence (filesystem read — assumedMandatory)
  {
    const logPath = path.join(managedDir, "server.log");
    const result = assumedMandatory(
      "read server.log tail",
      () => {
        if (!existsSync(logPath)) return null;
        const content = readFileSync(logPath, "utf-8");
        return content.split("\n").slice(-10).join("\n").trim();
      },
      { managedDir },
    );
    if (!result.ok) {
      checks.push(result.row);
    } else if (result.value) {
      checks.push({
        name: "Server log (~/.pi-dashboard/server.log)",
        section: "server",
        status: "warning",
        message: "Last entries:",
        detail: result.value,
      });
    }
  }

  // API key
  if (deps.isApiKeyConfigured) {
    checks.push(
      await safeCheck("API key", "setup", () => {
        const has = deps.isApiKeyConfigured!();
        return {
          name: "API key",
          section: "setup",
          status: has ? "ok" : "warning",
          message: has
            ? "Configured in pi settings"
            : "Not configured — pi sessions will need a key to use LLM providers",
          detail: has
            ? undefined
            : `Looked at ~/.pi/agent/settings.json (anthropicApiKey / openaiApiKey / providers[].apiKey)`,
        };
      }),
    );
  }

  // Managed install
  checks.push(
    await safeCheck("Managed install (~/.pi-dashboard)", "diagnostics", () => {
      const managedExists = existsSync(managedDir);
      const managedModules = existsSync(path.join(managedDir, "node_modules"));
      const okState = managedExists && managedModules;
      return {
        name: "Managed install (~/.pi-dashboard)",
        section: "diagnostics",
        status: okState ? "ok" : "warning",
        message: managedExists
          ? managedModules
            ? `Exists with node_modules at ${managedDir}`
            : "Exists but no node_modules — may need reinstall"
          : "Not created yet — will be set up on first run",
        detail: okState ? undefined : `Path: ${managedDir}`,
      };
    }),
  );

  return checks;
}

// ─── Stamping helper ──────────────────────────────────────────────────

/**
 * Single post-pass. Stamps `section` (using SECTION_OF when not already set)
 * and `suggestion` (when status is non-ok). Mutates in place AND returns.
 */
export function stampSectionsAndSuggestions(checks: DoctorCheck[]): DoctorCheck[] {
  for (const c of checks) {
    if (!c.section) {
      const inferred = SECTION_OF[c.name];
      if (inferred) c.section = inferred;
      else c.section = "diagnostics";
    }
    if (c.status !== "ok" && !c.suggestion) {
      const fn = SUGGESTIONS[c.name];
      const s = fn?.(c.status, c.detail, c.kind);
      if (s) c.suggestion = s;
    }
  }
  return checks;
}

// ─── Markdown formatter ───────────────────────────────────────────────

const SECTION_ORDER: DoctorSection[] = [
  "runtime",
  "pi-tooling",
  "server",
  "setup",
  "diagnostics",
];
const SECTION_LABEL: Record<DoctorSection, string> = {
  runtime: "Runtime",
  "pi-tooling": "PI Tooling",
  server: "Server",
  setup: "Setup",
  diagnostics: "Diagnostics",
};

/** Escape pipe / newline / backtick so cell content cannot break the table. */
function fenceCell(text: string | undefined): string {
  if (!text) return "";
  // Wrap in fenced text inline. Markdown table cells don't honour real fences,
  // but we wrap with backticks-as-code and replace bar / newline / backtick
  // with safe substitutes so the column count stays intact.
  const safe = text
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
  return "<code>" + safe + "</code>";
}

function statusIcon(s: DoctorStatus): string {
  return s === "ok" ? "✅" : s === "warning" ? "⚠️" : "❌";
}

export function formatDoctorReportMarkdown(report: DoctorReport): string {
  const lines: string[] = [];
  const { ok, warnings, errors } = report.summary;
  lines.push(`# PI Dashboard Doctor`);
  lines.push("");
  lines.push(`**Summary:** ${ok} ok · ${warnings} warning(s) · ${errors} error(s)`);
  lines.push("");

  for (const section of SECTION_ORDER) {
    const rows = report.checks.filter((c) => c.section === section);
    if (rows.length === 0) continue;
    lines.push(`## ${SECTION_LABEL[section]}`);
    lines.push("");
    lines.push("| Status | Check | Message | Detail |");
    lines.push("| --- | --- | --- | --- |");
    for (const c of rows) {
      const detailCell = c.detail ? fenceCell(c.detail) : "";
      const messageCell = c.message.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
      lines.push(`| ${statusIcon(c.status)} | ${c.name} | ${messageCell} | ${detailCell} |`);
    }
    lines.push("");
  }

  const nonOk = report.checks.filter((c) => c.status !== "ok" && c.suggestion);
  if (nonOk.length > 0) {
    lines.push(`## Remediation`);
    lines.push("");
    for (const c of nonOk) {
      lines.push(`- **${c.name}** — ${c.suggestion}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Plain-text formatter ─────────────────────────────────────────────

/**
 * Plain-text formatter, byte-compatible with the legacy
 * `formatDoctorReport` in `packages/electron/src/lib/doctor.ts`.
 * Re-exported from there so callers see no change.
 */
export function formatDoctorReportPlain(report: DoctorReport): string {
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
  lines.push(
    `  ${report.summary.ok} passed, ${report.summary.warnings} warnings, ${report.summary.errors} errors`,
  );

  if (report.summary.errors > 0) {
    const fixable = report.checks.filter((c) => c.status === "error" && c.fixable);
    if (fixable.length > 0) {
      lines.push("");
      lines.push(`  ${fixable.length} error(s) can be fixed automatically.`);
      lines.push("  Run setup wizard to install missing components.");
    }
  }

  return lines.join("\n");
}
