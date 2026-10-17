/**
 * `pi-obs doctor` — offline diagnostics, no password, no healthy service needed
 * (design D9, D12). Reports: installation (path / version ≥ 28 / arch),
 * websocket config state (enabled, port, password present + short warning —
 * never the value), exposure (`*:<port>` listener, spike F1), start-argv
 * preflight of the service definition, recovery suspension, and findings from
 * the NEWEST OBS log: permission grants/denials, `Invalid target display ID`
 * (`stale-display-binding`), unclean shutdown / safe mode, obs-websocket and
 * background-removal load lines. A log over 4 MiB is read as its first 64 KiB +
 * last 4 MiB (`truncated: true`). A black frame is never a permission signal.
 * See change: add-obs-studio-plugin.
 */
import fs from "node:fs";
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import type { Installation } from "./detect.js";
import { newestLog, readLaunchState } from "./launch.js";
import type { Platform } from "./paths.js";
import { readWsConfig, SHORT_PASSWORD } from "./ws-config.js";

export const LOG_TAIL_BYTES = 4 * 1024 * 1024;
const LOG_HEAD_BYTES = 64 * 1024;

interface Issue {
  code: string;
  message: string;
  advice?: string;
}

interface LogFindings {
  file?: string;
  truncated: boolean;
  permissions: Array<{ permission: string; granted: boolean }>;
  invalidDisplay: boolean;
  uncleanShutdown: boolean;
  safeMode: boolean;
  websocketLoaded: boolean;
  backgroundRemovalLoaded: boolean;
}

/** Read the whole log, or head + tail when it is larger than the tail window. */
function readLogWindow(file: string): { text: string; truncated: boolean } {
  const size = fs.statSync(file).size;
  if (size <= LOG_TAIL_BYTES) return { text: fs.readFileSync(file, "utf8"), truncated: false };
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(LOG_HEAD_BYTES);
    fs.readSync(fd, head, 0, LOG_HEAD_BYTES, 0);
    const tail = Buffer.alloc(LOG_TAIL_BYTES);
    fs.readSync(fd, tail, 0, LOG_TAIL_BYTES, size - LOG_TAIL_BYTES);
    return { text: `${head.toString("utf8")}\n…\n${tail.toString("utf8")}`, truncated: true };
  } finally {
    fs.closeSync(fd);
  }
}

function scanLog(text: string): Omit<LogFindings, "file" | "truncated"> {
  const permissions: LogFindings["permissions"] = [];
  for (const m of text.matchAll(/\[macOS\] Permission for (.+?) (granted|denied)/g)) {
    const permission = m[1].trim();
    const i = permissions.findIndex((p) => p.permission === permission);
    const row = { permission, granted: m[2] === "granted" };
    if (i >= 0) permissions[i] = row;
    else permissions.push(row);
  }
  return {
    permissions,
    invalidDisplay: /Invalid target display ID/.test(text),
    uncleanShutdown: /Crash or unclean shutdown detected/.test(text),
    safeMode: /\[Safe Mode\]/i.test(text),
    websocketLoaded: /\[obs-websocket\][^\n]*(?:obs_module_load|Module loaded|WebSocket server)/i.test(text),
    backgroundRemovalLoaded: /\[obs-backgroundremoval\][^\n]*(?:loaded|version)/i.test(text),
  };
}

function logFindings(configDir: string): LogFindings | undefined {
  const log = newestLog(configDir);
  if (!log) return undefined;
  const { text, truncated } = readLogWindow(log.file);
  return { file: log.file, truncated, ...scanLog(text) };
}

const PERMISSION_PANES: Record<string, string> = {
  "screen capture": "Screen & System Audio Recording",
  "video device access": "Camera",
  "audio device access": "Microphone",
  "input monitoring": "Input Monitoring",
  accessibility: "Accessibility",
};

export interface DoctorDeps {
  platform: Platform;
  configDir: string;
  state: string;
  install: Installation;
  def?: ServiceDefinition;
  exists: (p: string) => boolean;
  /** Listener classification for the websocket port (spike F1). */
  exposure: (port: number) => Promise<"loopback" | "all-interfaces" | "unknown">;
}

export interface DoctorReport {
  install: Installation;
  websocket: { configured: boolean; enabled: boolean; port: number; authRequired: boolean; passwordPresent: boolean; shortPassword: boolean };
  exposure: "loopback" | "all-interfaces" | "unknown";
  service?: { id: string; mode: string; startArgvOk?: boolean };
  recovery: { suspended: boolean; strikes: number; corrupt: boolean };
  log?: LogFindings;
  issues: Issue[];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear list of independent checks, each pushing its own issue
export async function doctor(d: DoctorDeps): Promise<DoctorReport> {
  const issues: Issue[] = [];
  const inst = d.install;
  if (!inst.found) issues.push({ code: "not-installed", message: "OBS Studio is not installed", advice: "run `pi-obs install` (asks before installing)" });
  else if (inst.supported === false) issues.push({ code: "unsupported-version", message: `OBS ${inst.version} is older than 28 (no obs-websocket v5)`, advice: "update OBS; provisioning is refused" });
  for (const w of inst.warnings) issues.push({ code: "install-warning", message: w });

  const { exists, config } = readWsConfig(d.configDir);
  const pw = typeof config.server_password === "string" ? config.server_password : "";
  const port = typeof config.server_port === "number" ? config.server_port : 4455;
  const websocket = {
    configured: exists,
    enabled: config.server_enabled === true,
    port,
    authRequired: config.auth_required === true,
    passwordPresent: pw.length > 0,
    shortPassword: pw.length > 0 && pw.length < SHORT_PASSWORD,
  };
  if (!websocket.enabled) issues.push({ code: "websocket-disabled", message: "obs-websocket is not enabled", advice: "run `pi-obs provision`" });
  if (websocket.shortPassword) issues.push({ code: "short-password", message: `the obs-websocket password is shorter than ${SHORT_PASSWORD} characters`, advice: "rotate it with `pi-obs provision --update`" });

  const exposure = websocket.enabled ? await d.exposure(port).catch(() => "unknown" as const) : "unknown";
  if (exposure === "all-interfaces") {
    issues.push({ code: "exposure-all-interfaces", message: `obs-websocket listens on all interfaces (*:${port}); OBS has no bind-address setting`, advice: `block port ${port} from other hosts in the firewall` });
  }

  let service: DoctorReport["service"];
  if (d.def) {
    service = { id: d.def.id, mode: d.def.mode };
    const argv = d.def.lifecycle?.start?.[d.platform];
    if (argv) {
      const missing = argv.slice(0, 2).filter((p) => !d.exists(p));
      service.startArgvOk = missing.length === 0;
      if (missing.length) issues.push({ code: "start-argv-missing", message: `the service start command names a missing path: ${missing.join(", ")}`, advice: "re-provision: `pi-obs provision --update`" });
    }
  }

  const ls = readLaunchState(d.state);
  const recovery = { suspended: ls.state.suspended || ls.corrupt, strikes: ls.state.strikes, corrupt: ls.corrupt };
  if (recovery.suspended) {
    issues.push({
      code: "recovery-suspended",
      message: ls.corrupt ? "launch-state.json was unreadable, so automatic crash recovery is suspended" : `OBS crashed early ${ls.state.strikes} times in a row; automatic crash recovery is suspended`,
      advice: "answer OBS's safe-mode prompt on the host, then run `pi-obs launch --reset-recovery`",
    });
  }

  const log = logFindings(d.configDir);
  if (log) {
    for (const p of log.permissions.filter((x) => !x.granted)) {
      const pane = PERMISSION_PANES[p.permission.toLowerCase()] ?? p.permission;
      issues.push({ code: "permission-denied", message: `macOS denied OBS ${p.permission}`, advice: `System Settings → Privacy & Security → ${pane}: enable OBS, then fully restart OBS` });
    }
    if (log.invalidDisplay) {
      issues.push({ code: "stale-display-binding", message: "a screen-capture source points at a display that no longer exists (Invalid target display ID)", advice: "list displays with `pi-obs devices list --kind display`, then `pi-obs input bind <input> --display <uuid>` (`doctor --live` names the inputs)" });
    }
    if (log.uncleanShutdown) issues.push({ code: "unclean-shutdown", message: "the last OBS run did not shut down cleanly (Crash or unclean shutdown detected)" });
    if (log.safeMode) issues.push({ code: "safe-mode", message: "OBS ran in safe mode (third-party plugins and websockets disabled)" });
  }
  return { install: inst, websocket, exposure, ...(service ? { service } : {}), recovery, ...(log ? { log } : {}), issues };
}
