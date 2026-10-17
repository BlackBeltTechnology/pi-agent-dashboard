/**
 * Pure model of the Services pages: state vocabulary, reason sentences, list
 * grouping and the action-gating table (design D9). No React, no I/O — the
 * components render what this returns and the server stays the authority.
 * See change: add-services-settings-ui.
 */
import type { LogsUnavailableReason, ServiceStatus } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { t as i18nT } from "../i18n/i18n.js";

export type ServiceState = ServiceStatus["state"];
export type Tone = "success" | "info" | "warning" | "error" | "neutral";

/** Shape glyph + text: state is never conveyed by colour alone (WCAG 1.4.1). */
export const STATE_META: Record<string, { label: string; tone: Tone; glyph: string }> = {
  healthy: { label: "Healthy", tone: "success", glyph: "●" },
  idle: { label: "Idle", tone: "neutral", glyph: "○" },
  starting: { label: "Starting", tone: "info", glyph: "◐" },
  stopping: { label: "Stopping", tone: "info", glyph: "◐" },
  stopped: { label: "Stopped", tone: "neutral", glyph: "□" },
  blocked: { label: "Not responding", tone: "warning", glyph: "◆" },
  failed: { label: "Failed", tone: "error", glyph: "▲" },
  "stop-failed": { label: "Stop failed", tone: "error", glyph: "▲" },
  unavailable: { label: "Unavailable", tone: "error", glyph: "▲" },
};

export function stateMeta(state: string): { label: string; tone: Tone; glyph: string } {
  const m = STATE_META[state];
  return m ? { ...m, label: i18nT(`services.state.${state}`, undefined, m.label) } : { label: state, tone: "neutral", glyph: "□" };
}

const REASON_EN: Record<string, string> = {
  "runtime-missing": "No container runtime (Docker or Podman) is installed.",
  "runtime-unreachable": "The container runtime is installed but not running.",
  "host-vm-stopped": "The Podman or Docker machine (VM) is stopped. The dashboard never starts it.",
  "image-absent": "The container image is not on this machine. Starts never download it.",
  "runner-absent": "The runner (uvx or npx) is not installed.",
  "package-absent": "The package is not in the local cache. Starts never download it.",
  "secret-unavailable": "A required secret could not be read.",
  "unsupported-platform": "This service cannot run on this platform.",
  "invalid-definition": "The service definition is invalid.",
  "adoption-uncertain": "A process from before the restart is still running, but the dashboard cannot prove it is this service.",
  "owner-conflict": "A container with this name belongs to another dashboard install.",
  "duplicate-instances": "More than one container claims to be this service.",
};

/** One plain-language sentence for an `unavailable` reason (an unknown code explains itself with the code). */
export const reasonSentence = (reason: string): string => i18nT(`services.reason.${reason}`, undefined, REASON_EN[reason] ?? `Unavailable (${reason}).`);

/** The one plain sentence a row / the why-callout shows for a service that needs attention (null = nothing to explain). */
export function whySentence(s: Pick<ServiceStatus, "state" | "reason">, detailed = false): string | null {
  if (s.state === "unavailable" && s.reason) return reasonSentence(s.reason);
  switch (s.state) {
    case "failed":
      return i18nT("services.why.failed", undefined, "The last start failed.");
    case "blocked":
      return detailed
        ? i18nT("services.why.blockedDetail", undefined, "Running, but its health check keeps failing. The dashboard never kills or relaunches it on its own.")
        : i18nT("services.why.blocked", undefined, "Running, but its health check keeps failing.");
    case "stop-failed":
      return i18nT("services.why.stopFailed", undefined, "The stop did not complete.");
    default:
      return null;
  }
}

const LOGS_REASON_EN: Record<LogsUnavailableReason, string> = {
  external: "The dashboard does not run this service, so it has no output for it.",
  "duplicate-instances": "More than one container claims to be this service, so there is no single output to show.",
  "secrets-changed": "A secret of this service changed after it started. Output is withheld until the service is restarted.",
  "no-output": "No output was captured for this instance. Restart it to capture output.",
  "runtime-error": "The container runtime could not return the output right now. Try again.",
  "secret-unavailable": "Output is withheld: a secret of this service could not be read, so its value could not be hidden.",
  "secret-too-short": "Output is withheld: a secret of this service is shorter than 4 characters, so it cannot be hidden reliably.",
};

export const logsReasonSentence = (reason: string): string =>
  i18nT(`services.logsReason.${reason}`, undefined, (LOGS_REASON_EN as Record<string, string>)[reason] ?? `Output is not available (${reason}).`);

// ── grouping ────────────────────────────────────────────────────────────────

export type ServiceGroup = "attention" | "running" | "stopped";
const ATTENTION: ReadonlySet<string> = new Set(["unavailable", "failed", "blocked", "stop-failed"]);
const RUNNING: ReadonlySet<string> = new Set(["healthy", "idle", "starting", "stopping"]);

export const groupOf = (state: string): ServiceGroup => (ATTENTION.has(state) ? "attention" : RUNNING.has(state) ? "running" : "stopped");
export const needsAttention = (s: Pick<ServiceStatus, "state">): boolean => ATTENTION.has(s.state);

export const GROUP_ORDER: readonly ServiceGroup[] = ["attention", "running", "stopped"];
const GROUP_LABEL_EN: Record<ServiceGroup, string> = { attention: "Needs attention", running: "Running", stopped: "Stopped" };
export const groupLabel = (g: ServiceGroup): string => i18nT(`services.group.${g}`, undefined, GROUP_LABEL_EN[g]);

/** Non-empty groups in display order, each with its services (input order kept). */
export function groupServices(services: readonly ServiceStatus[]): Array<{ group: ServiceGroup; services: ServiceStatus[] }> {
  return GROUP_ORDER.map((group) => ({ group, services: services.filter((s) => groupOf(s.state) === group) })).filter((g) => g.services.length > 0);
}

// ── gating (design D9) ──────────────────────────────────────────────────────

/** `unavailable` reasons that persist until an explicit stop / remove: no plain retry, no reset. */
const STICKY: ReadonlySet<string> = new Set(["adoption-uncertain", "owner-conflict", "duplicate-instances"]);

export interface ServiceActions {
  /** `POST …/start`. "Try again" re-evaluates an `unavailable` service; it never fetches. */
  start: false | "start" | "try-again";
  retry: boolean;
  stop: boolean;
  forceStop: boolean;
  prefetch: boolean;
  pin: boolean;
  unpin: boolean;
  resetData: boolean;
  /** Remove is always available. */
  remove: true;
}

/** The action set legal for `s` — the D9 table, nothing the server would refuse by state. */
export function actionsFor(s: Pick<ServiceStatus, "state" | "reason" | "startedBy" | "mode" | "pinned" | "volumes" | "drivers">): ServiceActions {
  const external = s.startedBy === "external";
  const hasLifecycle = s.mode !== "external";
  const reason = s.reason ?? "";
  const a: ServiceActions = {
    start: false,
    retry: false,
    stop: false,
    forceStop: false,
    prefetch: false,
    pin: s.mode === "managed" && !s.pinned,
    unpin: s.mode === "managed" && s.pinned,
    resetData: false,
    remove: true,
  };
  const declaresVolumes = (s.volumes?.length ?? 0) > 0;
  switch (s.state) {
    case "stopped":
      a.start = "start";
      a.prefetch = s.drivers?.includes("native") === true;
      a.resetData = declaresVolumes;
      break;
    case "starting":
      a.stop = hasLifecycle && !external;
      break;
    case "healthy":
    case "idle":
    case "blocked":
      a.stop = hasLifecycle && !external;
      a.forceStop = hasLifecycle && external;
      break;
    case "stop-failed":
      a.stop = hasLifecycle && !external;
      a.forceStop = hasLifecycle && external;
      break;
    case "failed":
      a.retry = true;
      break;
    case "unavailable":
      if (!STICKY.has(reason)) a.start = "try-again";
      a.stop = reason === "duplicate-instances";
      a.forceStop = reason === "adoption-uncertain";
      a.prefetch = reason === "package-absent";
      a.resetData = declaresVolumes && !STICKY.has(reason);
      break;
    default:
      break; // stopping: nothing
  }
  return a;
}

// ── time ────────────────────────────────────────────────────────────────────

/** "in 12 s" / "in 3 min" / "now" until an ISO time. */
export function untilText(iso: string, now: number = Date.now()): string {
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  if (!Number.isFinite(s) || s <= 0) return i18nT("services.retryNow", undefined, "now");
  return s < 90
    ? i18nT("services.inSeconds", { n: s }, "in {n} s")
    : i18nT("services.inMinutes", { n: Math.round(s / 60) }, "in {n} min");
}
