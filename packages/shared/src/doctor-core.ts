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

import dns from "node:dns";
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { whichSync } from "./platform/binary-lookup.js";
import { execSync } from "./platform/exec.js";
import { getGitSourceReadout } from "./platform/git-source.js";
import { readZrokEnvironment } from "./zrok-env.js";

// Used by the TypeScript-loader check to locate bundled jiti/tsx via
// Node's standard module resolution — finds copies under
// `Resources/server/node_modules/` in the Electron bundle. See change:
// fix-doctor-bundled-tool-detection.
const doctorRequire = createRequire(import.meta.url);
function tryResolvePkg(name: string): string | null {
  try {
    return doctorRequire.resolve(`${name}/package.json`);
  } catch {
    return null;
  }
}

// ─── Types ─────────────────────────────────────────────────────────────

export type DoctorSection =
  | "runtime"
  | "pi-tooling"
  | "server"
  | "tunnel"
  | "setup"
  | "diagnostics";

/**
 * Structural view of the tunnel-watchdog status the doctor consumes.
 * Mirrors `TunnelWatchdogStatus` from
 * `packages/server/src/tunnel-watchdog.ts` but lives here so the shared
 * doctor-core can stay free of server imports.
 */
export interface TunnelWatchdogStatusLike {
  running: boolean;
  intervalMs: number;
  failureThreshold: number;
  probeTimeoutMs: number;
  lastProbeAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  consecutiveFailures: number;
  lastRecycleAt: number | null;
  recycleCount: number;
}

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
  // See change: make-all-ui-text-i18n — optional code-mapping fields let the
  // web client translate STABLE check messages via `resolveServerMessage`.
  // `message` stays the English fallback; `code` maps to `err.<code>` and
  // `vars` supply interpolation values. Absent on pure data-readout rows.
  code?: string;
  vars?: Record<string, string | number>;
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
  // See change: make-all-ui-text-i18n — coded classifier + vars propagated
  // into the consuming DoctorCheck so the message can be translated.
  code?: string;
  vars?: Record<string, string | number>;
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
      code: "doctor.command_not_found",
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
      code: "doctor.permission_denied",
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
    const seconds = Math.round(timeoutMs / 1000);
    return {
      ok: false,
      kind: "timeout",
      message: `Command did not respond within ${seconds}s`,
      code: "doctor.command_timeout",
      vars: { seconds },
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
      code: "doctor.command_exit_status",
      vars: { status },
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
    code: "doctor.command_failed",
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
      code: "doctor.check_failed_to_run",
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
        code: "doctor.assumed_safe_operation_failed",
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
        if (existsSync(rotated)) rmSync(rotated, { force: true });
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
  // Two-row split: library (embedded, used by dashboard internals via
  // Node module resolution) vs. CLI on PATH (callable from a user's
  // shell or a non-dashboard subprocess). See change:
  // fix-doctor-bundled-tool-detection.
  "pi (library)": "pi-tooling",
  "pi (CLI on PATH)": "pi-tooling",
  "openspec (library)": "pi-tooling",
  "openspec (CLI on PATH)": "pi-tooling",
  // Legacy aliases retained so any client still matching the old names
  // (older Electron Doctor renderers) keeps section mapping.
  "pi CLI": "pi-tooling",
  "openspec CLI": "pi-tooling",
  // server
  "Dashboard server code": "server",
  "Offline packages bundle": "server",
  "TypeScript loader": "server",
  "Dashboard server": "server",
  "Server starter": "server",
  "Installable list": "server",
  "Server log (~/.pi-dashboard/server.log)": "server",
  "Server launch test": "server",
  // setup
  "Setup wizard": "setup",
  "API key": "setup",
  "Attached server version": "setup",
  // tunnel
  "zrok binary": "tunnel",
  "zrok environment": "tunnel",
  "zrok API reachable": "tunnel",
  "zrok version compatible": "tunnel",
  "tunnel runtime": "tunnel",
  // diagnostics
  "Legacy install directory": "diagnostics",
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
  "pi (library)": (status, _d, kind) =>
    status === "ok"
      ? undefined
      : kind
        ? execKindSuggestion("pi (library)", kind, 5)
        : "pi library not found in any known location (bundled, managed, or PATH). Reinstall **PI Dashboard** or run the setup wizard.",
  "pi (CLI on PATH)": (status) =>
    status === "ok"
      ? undefined
      : "`pi` is not on your shell `$PATH`. Dashboard-spawned sessions still work (the dashboard injects PATH for them), but you cannot run `pi` from a fresh terminal. Fix: `npm i -g @earendil-works/pi-coding-agent`, or add the dashboard's `server/node_modules/.bin` to your PATH.",
  "openspec (library)": (status, _d, kind) =>
    status === "ok"
      ? undefined
      : kind
        ? execKindSuggestion("openspec (library)", kind, 5)
        : "openspec library not found. Optional, but required for OpenSpec workflows the dashboard runs internally. Run the setup wizard.",
  "openspec (CLI on PATH)": (status) =>
    status === "ok"
      ? undefined
      : "`openspec` is not on your shell `$PATH`. Dashboard-spawned sessions still work; manual terminal use does not. Fix: `npm i -g @fission-ai/openspec`, or add the dashboard's `server/node_modules/.bin` to your PATH.",
  // Legacy aliases (kept so older renderers don't lose suggestions).
  "pi CLI": (status) =>
    status === "ok" ? undefined : "`pi` not found. Run the setup wizard (Help → Setup) to install it under `~/.pi-dashboard`.",
  "openspec CLI": (status) =>
    status === "ok" ? undefined : "`openspec` not found. Optional, but required for OpenSpec workflows. Run the setup wizard.",
  "Dashboard server code": (status) =>
    status === "ok"
      ? undefined
      : "Dashboard server code not found in app resources. Reinstall **PI Dashboard**.",
  "Offline packages bundle": (status) =>
    status === "ok"
      ? undefined
      : "Offline packages bundle absent. First-run install will require network access to `registry.npmjs.org`.",
  "TypeScript loader": (status) =>
    status === "ok"
      ? undefined
      : "No TypeScript loader (jiti or tsx) found. Required to run the dashboard server. Run the setup wizard (Help → Setup).",
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
      : "Sign in to a provider in **Settings → Providers** — either an OAuth subscription (Claude Pro/Max, ChatGPT Plus/Pro) or an API key. Pi sessions need at least one credential to use LLM providers.",
  // Defensive fallback only — the live emission path in
  // `checkAttachedServerVersion` sets a launch-source-specific `suggestion`
  // inline, so the stamping `!c.suggestion` guard means this never runs in
  // production. Kept to satisfy the Decision-8 lint. See change:
  // electron-attach-ownership-fixes.
  "Attached server version": (status) =>
    status === "ok"
      ? undefined
      : "The attached dashboard server's version differs from this app bundle, or the server is unreachable. See the row detail for the launch-source-specific fix.",
  "zrok binary": (status) =>
    status === "ok"
      ? undefined
      : `\`zrok\` (or \`zrok2\`) not found on this machine. Install v2: on macOS \`brew install zrok\`; on Linux/Windows download the \`zrok2\` binary — see [docs.zrok.io](https://docs.zrok.io/docs/getting-started/). Restart the dashboard after install so the binary is picked up.`,
  "zrok environment": (status) =>
    status === "ok"
      ? undefined
      : "zrok is not enrolled on this machine. Create an account at [zrok.io](https://zrok.io/) (or `zrok invite` from another enrolled host), then run `zrok enable <token>` once. The dashboard's tunnel button will then work.",
  "zrok API reachable": (status) =>
    status === "ok"
      ? undefined
      : "DNS lookup of `api-v2.zrok.io` (or the enrolled `api_endpoint`) failed. Check your network connection, DNS resolver, and any VPN or corporate proxy. The tunnel cannot start until this host resolves.",
  "zrok version compatible": (status) =>
    status === "ok"
      ? undefined
      : "Your zrok client is too old (v1, `0.4.x`) for the hosted `api-v2.zrok.io`, which returns HTTP 500 on enable/share. Upgrade to v2: `brew upgrade zrok` (macOS) or re-download the `zrok2` binary.",
  "tunnel runtime": (status) =>
    status === "ok"
      ? undefined
      : "Active tunnel is failing its periodic health probe. Click the 🌐 Tunnel button in the sidebar to recycle it, or check `~/.pi-dashboard/server.log` for the underlying error.",
  // Defensive fallback only — the live emission path in `runSharedChecks`
  // sets `suggestion` inline, so the stamping `!c.suggestion` guard means
  // this factory never runs in production. Kept to satisfy the Decision-8
  // lint (every `SECTION_OF` name must have a non-empty suggestion for
  // non-ok statuses). See change: fix-doctor-stale-managed-install-check.
  "Legacy install directory": (status) =>
    status === "ok"
      ? undefined
      : "Left over from a previous version. Nothing reads or writes `~/.pi-dashboard/` under the immutable-bundle architecture. Delete the directory manually to reclaim disk space.",
};

// (macos-alias DMG-maker prereq check removed — electron-builder produces the
// DMG now via hdiutil, not the macos-alias native module. See change:
// fix-local-electron-dmg-build.)

// ─── dns helper (test seam) ─────────────────────────────────────────

/**
 * Default DNS lookup with a hard timeout. Used by the `zrok API
 * reachable` check. Exposed as the `dnsLookup` test seam on
 * `SharedChecksDeps` so tests inject a mock instead of hitting real DNS.
 */
export async function defaultDnsLookup(host: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof (timer as any).unref === "function") (timer as any).unref();
    dns.promises
      .lookup(host)
      .then(() => {
        clearTimeout(timer);
        resolve();
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Parse the major version from `zrok version` stdout. Accepts an optional
 * leading `v` and any surrounding text (e.g. `zrok v2.0.4`, `v0.4.51`,
 * `2.0.0-rc.1`). Returns the integer major, or `null` when no semver-shaped
 * token is present (garbage → caller warns "unknown"). See change:
 * support-zrok-v2.
 */
export function parseZrokMajor(out: string): number | null {
  const m = out.match(/\bv?(\d+)\.(\d+)\.(\d+)(?:[-.][0-9A-Za-z.-]+)?\b/);
  if (!m) return null;
  const major = parseInt(m[1], 10);
  return Number.isFinite(major) ? major : null;
}

// ─── Attached-server version skew (Electron arm only) ────────────

/** Minimal `/api/health` shape the version-skew check consumes. */
export interface AttachedHealthLike {
  version?: string;
  launchSource?: string;
}

export interface AttachedServerVersionDeps {
  /** The running shell's application version (Electron `app.getVersion()`). */
  appVersion: string;
  /** Fetch `/api/health`; resolve null (or throw) when unreachable. */
  healthFetcher: () => Promise<AttachedHealthLike | null>;
}

/**
 * Compare the shell's bundled version against the attached server's
 * `/api/health.version`. Electron-arm only — a server comparing its own pkg
 * version to its own self-fetch is a loopback tautology. Suggestion text is
 * launch-source-specific (npm upgrade vs stop-the-pi-session vs quit-other-
 * Electron). See change: electron-attach-ownership-fixes.
 */
export async function checkAttachedServerVersion(
  deps: AttachedServerVersionDeps,
): Promise<DoctorCheck> {
  let health: AttachedHealthLike | null = null;
  try {
    health = await deps.healthFetcher();
  } catch {
    health = null;
  }
  if (!health || !health.version) {
    return {
      name: "Attached server version",
      section: "setup",
      status: "error",
      message: "Attached dashboard server is unreachable or reports no version",
      code: "doctor.attached_server_unreachable",
      detail: "GET /api/health returned no response or a body without a `version` field",
      suggestion:
        "Confirm a dashboard server is running on the configured port, then re-run Doctor.",
    };
  }
  if (deps.appVersion === health.version) {
    return {
      name: "Attached server version",
      section: "setup",
      status: "ok",
      message: `Server and app bundle both v${health.version}`,
      code: "doctor.server_app_version_match",
      vars: { version: health.version },
    };
  }
  const ls = health.launchSource;
  let suggestion: string;
  if (ls === "standalone") {
    suggestion =
      `Run \`npm i -g @blackbelt-technology/pi-dashboard@${deps.appVersion}\` and restart your terminal session.`;
  } else if (ls === "bridge" || ls === "bridge-orphaned") {
    suggestion =
      "Stop the pi session that started this server (or run `pi-dashboard stop`) and relaunch the app.";
  } else if (ls === "electron") {
    suggestion =
      "Quit the other Electron instance or use the zombie-adoption prompt to take ownership.";
  } else {
    // Unknown / missing launchSource (older server, unenumerated launch mode):
    // don't misattribute it to the electron case — give a source-agnostic hint.
    suggestion =
      "The attached server's version differs from this app bundle. Determine how that server was started (npm, a pi session, or another app) and update it from there.";
  }
  return {
    name: "Attached server version",
    section: "setup",
    status: "warning",
    message: `Dashboard server reports v${health.version}; this app bundle is v${deps.appVersion}`,
    code: "doctor.server_app_version_skew",
    vars: { serverVersion: health.version, appVersion: deps.appVersion },
    detail: `launchSource: ${ls ?? "unknown"}`,
    suggestion,
  };
}

// ─── runSharedChecks ──────────────────────────────────────────────────

export interface SharedChecksDeps {
  managedDir: string;
  /** Detector for system Node ({path, found}). */
  detectSystemNode: () => { found: boolean; path?: string };
  /**
   * Resolver for the zrok binary. When omitted, the `zrok binary` check is
   * skipped entirely. The server wires this to the same `ToolResolver`
   * used by `tunnel.ts` so diagnostic and runtime never disagree about
   * which binary will be invoked.
   */
  resolveZrokBinary?: () => { found: boolean; path?: string };
  /**
   * Test seam for the `zrok version compatible` check. Given the resolved
   * binary path, returns the raw `zrok version` stdout. Defaults to
   * `safeExec("<path>" version)`. Only invoked when `resolveZrokBinary`
   * reports a found binary — the check NEVER spawns on a missing binary.
   */
  runZrokVersion?: (binPath: string) => { ok: boolean; stdout: string };
  /**
   * Test seam for the `zrok API reachable` check. Defaults to
   * `dns.promises.lookup` with a 3000 ms hard cap. Should resolve on
   * success and reject with an `Error` on failure (NXDOMAIN, EAI_AGAIN,
   * timeout, etc.) so the check can surface the captured reason.
   */
  dnsLookup?: (host: string, timeoutMs: number) => Promise<void>;
  /**
   * Read the in-process tunnel-watchdog status. Returns `null` when no
   * tunnel is active. Omitted in Electron (no server in process) — the
   * `tunnel runtime` check then resolves to `ok` with "no tunnel data
   * available" so the section still renders four rows on both surfaces.
   */
  getTunnelWatchdogStatus?: () => TunnelWatchdogStatusLike | null;
  /**
   * Detector for the pi **library** (embedded copy used by the dashboard
   * via Node module resolution). Returns the resolved entry path.
   */
  detectPi: () => { found: boolean; path?: string; source?: string };
  /** Detector for the openspec **library** (embedded copy). */
  detectOpenSpec: () => { found: boolean; path?: string; source?: string };
  /**
   * Detector for `pi` on the user's shell `$PATH`. Distinct from the
   * library check above: even when the library is bundled inside the
   * app, a user opening a fresh terminal cannot run `pi` unless it is
   * also installed somewhere on PATH (`npm i -g`, brew, nvm, etc.).
   * Optional for backward compatibility; when omitted, the row is
   * suppressed.
   */
  detectPiOnPath?: () => { found: boolean; path?: string };
  /** Detector for `openspec` on the user's shell `$PATH`. */
  detectOpenSpecOnPath?: () => { found: boolean; path?: string };
  /** Optional: localhost server probe. Default uses curl-style fetch. */
  probeServer?: () => Promise<{
    running: boolean;
    version?: string;
    mode?: string;
    starter?: string | null;
    installable?: { total: number; installed: number; failed: string[] } | null;
  }>;
  /** Optional: api-key / credential check. */
  isApiKeyConfigured?: () => boolean;
  /**
   * Optional: absolute paths inspected by `isApiKeyConfigured`. When set,
   * the API-key check's `detail` field names these exactly; when omitted,
   * a generic two-file list is used. See change:
   * fix-doctor-oauth-credential-detection.
   */
  inspectedCredentialFiles?: () => string[];
  /**
   * Test seam for the legacy `~/.pi-dashboard/` advisory. Defaults to
   * the real shared detector. Tests inject a mock to exercise both
   * present / absent branches hermetically.
   * See change: fix-doctor-stale-managed-install-check.
   */
  detectLegacyManagedDir?: () =>
    | { present: false }
    | { present: true; path: string; pkgCount: number; sizeMb: number };
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
          code: "doctor.node_not_on_path",
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
          code: ver.code,
          vars: ver.vars,
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

  // pi (library) — embedded copy used by the dashboard internally
  checks.push(
    await safeCheck("pi (library)", "pi-tooling", () => {
      const pi = deps.detectPi();
      if (!pi.found || !pi.path) {
        return {
          name: "pi (library)",
          section: "pi-tooling",
          status: "error",
          message: "Library not found — dashboard cannot spawn agent sessions",
          code: "doctor.lib_not_found_pi",
          detail: "Searched override, bundled (server/node_modules), managed install, and system PATH",
          fixable: true,
        };
      }
      const ver = safeExec(`"${pi.path}" --version`, { timeoutMs: 5000 });
      const versionDisplay = ver.ok ? ver.stdout.trim() : "?";
      return {
        name: "pi (library)",
        section: "pi-tooling",
        status: "ok",
        message: `${versionDisplay} (${pi.source ?? "unknown"}) at ${pi.path}`,
      };
    }),
  );

  // pi (CLI on PATH) — distinct from library; what `which pi` returns
  if (deps.detectPiOnPath) {
    const detectPiOnPath = deps.detectPiOnPath;
    checks.push(
      await safeCheck("pi (CLI on PATH)", "pi-tooling", () => {
        const r = detectPiOnPath();
        if (!r.found || !r.path) {
          return {
            name: "pi (CLI on PATH)",
            section: "pi-tooling",
            status: "warning",
            message: "Not on $PATH — `pi` won't run from a fresh terminal",
            code: "doctor.pi_not_on_path",
            detail: "Dashboard-spawned sessions still work (the dashboard injects PATH for them). Manual `pi` invocation in any other shell does not.",
            fixable: true,
          };
        }
        return {
          name: "pi (CLI on PATH)",
          section: "pi-tooling",
          status: "ok",
          message: `On PATH at ${r.path}`,
        };
      }),
    );
  }

  // openspec (library)
  checks.push(
    await safeCheck("openspec (library)", "pi-tooling", () => {
      const os = deps.detectOpenSpec();
      if (!os.found || !os.path) {
        return {
          name: "openspec (library)",
          section: "pi-tooling",
          status: "warning",
          message: "Library not found — dashboard-internal OpenSpec workflows disabled",
          code: "doctor.lib_not_found_openspec",
          detail: "Searched override, bundled (server/node_modules), managed install, and system PATH",
          fixable: true,
        };
      }
      const ver = safeExec(`"${os.path}" --version`, { timeoutMs: 5000 });
      const versionDisplay = ver.ok ? ver.stdout.trim() : "?";
      return {
        name: "openspec (library)",
        section: "pi-tooling",
        status: "ok",
        message: `${versionDisplay} (${os.source ?? "unknown"}) at ${os.path}`,
      };
    }),
  );

  // openspec (CLI on PATH)
  if (deps.detectOpenSpecOnPath) {
    const detectOpenSpecOnPath = deps.detectOpenSpecOnPath;
    checks.push(
      await safeCheck("openspec (CLI on PATH)", "pi-tooling", () => {
        const r = detectOpenSpecOnPath();
        if (!r.found || !r.path) {
          return {
            name: "openspec (CLI on PATH)",
            section: "pi-tooling",
            status: "warning",
            message: "Not on $PATH — `openspec` won't run from a fresh terminal",
            code: "doctor.openspec_not_on_path",
            detail: "Optional. Needed only for running `openspec` manually in a terminal; dashboard-internal use already covered by the library row above.",
            fixable: true,
          };
        }
        return {
          name: "openspec (CLI on PATH)",
          section: "pi-tooling",
          status: "ok",
          message: `On PATH at ${r.path}`,
        };
      }),
    );
  }

  // TypeScript loader (jiti preferred; tsx accepted as fallback)
  // The dashboard server runs via jiti by default (see shared/server-launcher.ts
  // resolveJiti). tsx was the legacy choice and is still accepted if jiti is
  // unavailable. The check passes when EITHER loader is resolvable so users
  // running on jiti don't see a spurious error.
  checks.push(
    await safeCheck("TypeScript loader", "server", () => {
      const managedJitiPkg = path.join(managedDir, "node_modules", "jiti", "package.json");
      const managedTsxPkg = path.join(managedDir, "node_modules", "tsx", "package.json");

      function readVersion(pkgPath: string): string | null {
        try {
          if (!existsSync(pkgPath)) return null;
          const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
          return pkg.version || null;
        } catch {
          return null;
        }
      }
      const jitiVersion = readVersion(managedJitiPkg);
      const tsxVersion = readVersion(managedTsxPkg);

      // Bundled fallback: look up jiti/tsx via Node module resolution
      // so copies inside the Electron bundle's `Resources/server/node_modules/`
      // satisfy the check. Without this, Electron-launched servers
      // falsely reported the loader as missing even though they were
      // running on it.
      const bundledJitiPkg = jitiVersion ? null : tryResolvePkg("jiti");
      const bundledTsxPkg = tsxVersion ? null : tryResolvePkg("tsx");
      const bundledJitiVersion = bundledJitiPkg ? readVersion(bundledJitiPkg) : null;
      const bundledTsxVersion = bundledTsxPkg ? readVersion(bundledTsxPkg) : null;

      let systemTsx: string | null = null;
      const lookupCmd = process.platform === "win32" ? "where tsx" : "which tsx"; // platform-branch-ok: localised PATH-lookup primitive
      const lookup = safeExec(lookupCmd, { timeoutMs: 5000 });
      if (lookup.ok) {
        systemTsx = lookup.stdout.trim().split("\n")[0] || null;
      }

      if (jitiVersion) {
        return {
          name: "TypeScript loader",
          section: "server",
          status: "ok",
          message: `jiti v${jitiVersion} (managed) at ${path.dirname(managedJitiPkg)}`,
        };
      }
      if (tsxVersion) {
        return {
          name: "TypeScript loader",
          section: "server",
          status: "ok",
          message: `tsx v${tsxVersion} (managed) at ${path.dirname(managedTsxPkg)}`,
        };
      }
      if (bundledJitiVersion && bundledJitiPkg) {
        return {
          name: "TypeScript loader",
          section: "server",
          status: "ok",
          message: `jiti v${bundledJitiVersion} (bundled) at ${path.dirname(bundledJitiPkg)}`,
        };
      }
      if (bundledTsxVersion && bundledTsxPkg) {
        return {
          name: "TypeScript loader",
          section: "server",
          status: "ok",
          message: `tsx v${bundledTsxVersion} (bundled) at ${path.dirname(bundledTsxPkg)}`,
        };
      }
      if (systemTsx) {
        return {
          name: "TypeScript loader",
          section: "server",
          status: "ok",
          message: `tsx (system) at ${systemTsx}`,
        };
      }
      return {
        name: "TypeScript loader",
        section: "server",
        status: "error",
        message: "Not found — required to run the dashboard server",
        code: "doctor.ts_loader_not_found",
        detail: `Looked under ${managedJitiPkg}, ${managedTsxPkg}, bundled (server/node_modules), and on PATH`,
        fixable: true,
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
          code: "doctor.server_not_probed",
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
          code: "doctor.server_not_running",
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
        code: "doctor.server_log_last_entries",
        detail: result.value,
      });
    }
  }

  // API key — see change: fix-doctor-oauth-credential-detection.
  // Detector inspects BOTH settings.json (API-key fields) and auth.json
  // (OAuth + provider-stored keys). `deps.inspectedCredentialFiles` is
  // optional so older deps shapes keep working; falls back to a generic
  // file list when absent.
  if (deps.isApiKeyConfigured) {
    checks.push(
      await safeCheck("API key", "setup", () => {
        const has = deps.isApiKeyConfigured!();
        const files = deps.inspectedCredentialFiles
          ? deps.inspectedCredentialFiles()
          : ["~/.pi/agent/settings.json", "~/.pi/agent/auth.json"];
        return {
          name: "API key",
          section: "setup",
          status: has ? "ok" : "warning",
          message: has
            ? "Configured"
            : "Not configured — pi sessions will need a credential to use LLM providers",
          code: has ? "doctor.api_key_configured" : "doctor.api_key_not_configured",
          detail: has ? undefined : `Inspected: ${files.join(", ")}`,
        };
      }),
    );
  }

  // ── Tunnel section ───────────────────────────────────────────────

  // zrok binary — only run when the caller provided a resolver
  if (deps.resolveZrokBinary) {
    const resolveZrokBinary = deps.resolveZrokBinary;
    checks.push(
      await safeCheck("zrok binary", "tunnel", () => {
        const r = resolveZrokBinary();
        if (!r.found || !r.path) {
          return {
            name: "zrok binary",
            section: "tunnel",
            status: "warning",
            message: "Not found — public tunnel button cannot be used",
            code: "doctor.zrok_binary_not_found",
            detail: "Searched override, managed install, and system PATH",
          };
        }
        return {
          name: "zrok binary",
          section: "tunnel",
          status: "ok",
          message: `Found at ${r.path}`,
        };
      }),
    );
  }

  // zrok environment — always runs; checks ~/.zrok2 then ~/.zrok
  checks.push(
    await safeCheck("zrok environment", "tunnel", () => {
      const r = readZrokEnvironment();
      if (!r.found) {
        return {
          name: "zrok environment",
          section: "tunnel",
          status: "warning",
          message: "Not enrolled — public tunnel cannot start",
          code: "doctor.zrok_not_enrolled",
          detail: r.reason ?? "No zrok environment file present",
        };
      }
      return {
        name: "zrok environment",
        section: "tunnel",
        status: "ok",
        message: `Enrolled (${r.kind}) at ${r.path}`,
      };
    }),
  );

  // zrok API reachable — DNS probe of the v2 host (api-v2.zrok.io) with 3s cap,
  // or the enrolled env's api_endpoint host when present (self-hosted / pinned
  // controllers). This is a coarse DNS gate; it CANNOT detect the HTTP-500
  // out-of-date failure mode — the version-compat check below is the actual
  // root-cause detector. See change: support-zrok-v2.
  checks.push(
    await safeCheck("zrok API reachable", "tunnel", async () => {
      const lookup = deps.dnsLookup ?? defaultDnsLookup;
      let host = "api-v2.zrok.io";
      try {
        const env = readZrokEnvironment();
        if (env.found && env.env?.apiEndpoint) {
          host = new URL(env.env.apiEndpoint).hostname || host;
        }
      } catch { /* fall back to the hosted v2 host */ }
      try {
        await lookup(host, 3000);
        return {
          name: "zrok API reachable",
          section: "tunnel",
          status: "ok",
          message: `DNS lookup of ${host} succeeded`,
          code: "doctor.zrok_dns_ok",
        };
      } catch (err: any) {
        const reason = err?.message ?? String(err);
        return {
          name: "zrok API reachable",
          section: "tunnel",
          status: "warning",
          message: `DNS lookup of ${host} failed`,
          code: "doctor.zrok_dns_failed",
          detail: reason,
        };
      }
    }),
  );

  // zrok version compatible — the REAL root-cause detector for the field 500s.
  // A too-old (major < 2) client hits `api-v2.zrok.io` and gets HTTP 500 on
  // enable/share. Short-circuits to `unavailable` when no binary resolves
  // (never spawns ENOENT). See change: support-zrok-v2.
  if (deps.resolveZrokBinary) {
    const runZrokVersion = deps.runZrokVersion;
    const detectZrok = deps.resolveZrokBinary;
    checks.push(
      await safeCheck("zrok version compatible", "tunnel", () => {
        const bin = detectZrok();
        if (!bin.found || !bin.path) {
          // Unavailable: no binary resolves, so NEVER spawn (ENOENT). Report a
          // non-failing informational row that defers to the 'zrok binary' row
          // (which already warns) rather than double-counting the warning.
          return {
            name: "zrok version compatible",
            section: "tunnel",
            status: "ok",
            message: "zrok not installed — version not checked",
            code: "doctor.zrok_version_unavailable",
            detail: "Install zrok (see the 'zrok binary' row) — version cannot be checked until it resolves",
          };
        }
        const raw = runZrokVersion
          ? runZrokVersion(bin.path)
          : safeExec(`"${bin.path}" version`, { timeoutMs: 5000 });
        const out = raw.ok ? raw.stdout : "";
        const parsed = parseZrokMajor(out);
        if (parsed === null) {
          return {
            name: "zrok version compatible",
            section: "tunnel",
            status: "warning",
            message: "Could not parse zrok version",
            code: "doctor.zrok_version_unknown",
            detail: out.trim() ? `Unparseable output: ${out.trim().slice(0, 120)}` : "No version output",
          };
        }
        if (parsed < 2) {
          return {
            name: "zrok version compatible",
            section: "tunnel",
            status: "warning",
            message: `${out.trim()} is too old (v1) — hosted api-v2.zrok.io returns HTTP 500`,
            code: "doctor.zrok_version_too_old",
            detail: "Upgrade: `brew upgrade zrok` (macOS) or re-download zrok2 from the v2 release. v1 (0.4.x) cannot talk to the v2 API.",
          };
        }
        return {
          name: "zrok version compatible",
          section: "tunnel",
          status: "ok",
          message: `zrok major v${parsed} (\u2265 2) is compatible`,
          code: "doctor.zrok_version_ok",
        };
      }),
    );
  }

  // tunnel runtime — consumes the watchdog status when available
  checks.push(
    await safeCheck("tunnel runtime", "tunnel", () => {
      if (!deps.getTunnelWatchdogStatus) {
        return {
          name: "tunnel runtime",
          section: "tunnel",
          status: "ok",
          message: "No tunnel data available",
          code: "doctor.tunnel_no_data",
          detail: "The host process does not run an in-process tunnel watchdog",
        };
      }
      const wd = deps.getTunnelWatchdogStatus();
      if (!wd) {
        return {
          name: "tunnel runtime",
          section: "tunnel",
          status: "ok",
          message: "No tunnel active",
          code: "doctor.tunnel_none_active",
          detail: "Click the 🌐 Tunnel button to start one",
        };
      }
      const now = Date.now();
      const staleAfter = wd.intervalMs * 3;
      const stale =
        wd.lastSuccessAt === null || now - wd.lastSuccessAt > staleAfter;
      const failing = wd.consecutiveFailures > 0;
      if (failing || stale) {
        return {
          name: "tunnel runtime",
          section: "tunnel",
          status: "warning",
          message: failing
            ? `Probe failing (${wd.consecutiveFailures}/${wd.failureThreshold})`
            : "No successful probe in the last 3 intervals",
          code: failing ? "doctor.tunnel_probe_failing" : "doctor.tunnel_no_recent_probe",
          vars: (failing
            ? { failures: wd.consecutiveFailures, threshold: wd.failureThreshold }
            : undefined) as Record<string, string | number> | undefined,
          detail: [
            `lastFailureReason: ${wd.lastFailureReason ?? "(none yet)"}`,
            `recycleCount: ${wd.recycleCount}`,
            `lastSuccessAt: ${wd.lastSuccessAt ? new Date(wd.lastSuccessAt).toISOString() : "(never)"}`,
          ].join("\n"),
        };
      }
      return {
        name: "tunnel runtime",
        section: "tunnel",
        status: "ok",
        message: `Healthy — ${wd.recycleCount} recycle(s) so far`,
        code: "doctor.tunnel_healthy",
        vars: { recycles: wd.recycleCount } as Record<string, string | number>,
        detail: `lastSuccessAt: ${new Date(wd.lastSuccessAt!).toISOString()}`,
      };
    }),
  );

  // Legacy ~/.pi-dashboard advisory — emit ONLY when the directory
  // exists. Under R3 (change: eliminate-electron-runtime-install)
  // nothing reads or writes this directory. This row tells the user
  // it is safe to delete. Clean installs see nothing.
  // See change: fix-doctor-stale-managed-install-check.
  try {
    const detect =
      deps.detectLegacyManagedDir ??
      (await import("./legacy-managed-dir.js")).detectLegacyManagedDir;
    const legacy = detect();
    if (legacy.present) {
      checks.push({
        name: "Legacy install directory",
        section: "diagnostics",
        status: "warning",
        message: `Legacy directory at ${legacy.path} — no longer used. Safe to delete manually.`,
        detail: `${legacy.pkgCount} packages, ~${legacy.sizeMb} MB.`,
        suggestion:
          "Left over from a previous version. Nothing reads or writes it under the immutable-bundle architecture. " +
          `Delete it manually (e.g. \`rm -rf ${legacy.path}\`) to reclaim disk space.`,
      });
    }
  } catch {
    /* advisory only — never block doctor output */
  }

  // Windows-only: bundled-vs-host git & shell source. See change:
  // embed-git-bash-on-windows.
  try {
    const readout = getGitSourceReadout(whichSync);
    if (readout) {
      const tag = `(${readout.source})`;
      const wantHostButBundled = readout.setting === "host" && readout.source === "bundled";
      checks.push({
        name: "git source",
        section: "runtime",
        status: wantHostButBundled ? "error" : readout.gitPath ? "ok" : "warning",
        message: wantHostButBundled
          ? "windowsGitSource is 'host' but git/bash are not on PATH; using bundled fallback"
          : `${readout.gitVersion ?? "git"} ${tag}`,
        code: wantHostButBundled ? "doctor.git_source_host_fallback" : undefined,
        detail: readout.gitPath ?? "git.exe not resolved",
        suggestion: wantHostButBundled
          ? "Install Git for Windows, or set windowsGitSource to 'auto' / 'bundled'."
          : undefined,
      });
      checks.push({
        name: "bash source",
        section: "runtime",
        status: readout.shellPath ? "ok" : "warning",
        message: readout.shellPath ? `sh ${tag}` : "no POSIX shell resolved",
        code: readout.shellPath ? undefined : "doctor.no_posix_shell",
        detail: readout.shellPath ?? "sh.exe / bash.exe not resolved",
      });
    }
  } catch {
    /* advisory only — never block doctor output */
  }

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
  "tunnel",
  "setup",
  "diagnostics",
];
const SECTION_LABEL: Record<DoctorSection, string> = {
  runtime: "Runtime",
  "pi-tooling": "PI Tooling",
  server: "Server",
  tunnel: "Tunnel",
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
