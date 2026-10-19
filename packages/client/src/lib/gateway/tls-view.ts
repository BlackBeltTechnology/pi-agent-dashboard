/**
 * Pure view-model helpers of the Gateway "Built-in HTTPS" section: the status →
 * pill mapping (first match wins, per the approved board), one certificate row's
 * pill + facts + action, and the plain-words mapping of a rejected Apply.
 * Kept out of the components so each rule is a small, directly tested function.
 *
 * See change: add-tailscale-cert-tls (design D11, `mockups/ui-plan.md`).
 */
import { hasTlsDetail, type TlsCertStatus, type TlsStatus } from "@blackbelt-technology/pi-dashboard-shared/tls-status.js";
import {
  mdiAlert,
  mdiCheckCircleOutline,
  mdiClockOutline,
  mdiCloseCircleOutline,
  mdiLoading,
  mdiMinusCircleOutline,
} from "@mdi/js";

type Translate = (key: string, vars?: Record<string, string | number>, fallback?: string) => string;

const DAY_MS = 86_400_000;

export interface TlsPill {
  severity: "neutral" | "info" | "warning" | "error" | "success";
  label: string;
  icon: string;
  spin?: boolean;
}

export const isHeld = (c: TlsCertStatus, now: number): boolean => c.held && typeof c.notAfter === "number" && c.notAfter > now;
const daysLeft = (c: TlsCertStatus, now: number): number => Math.max(0, Math.ceil(((c.notAfter ?? now) - now) / DAY_MS));
const fmtDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Minutes until a scheduled retry, for "Next try in N minutes". */
export function retryMinutes(c: TlsCertStatus, now: number): number | null {
  return typeof c.nextAttemptAt === "number" && c.nextAttemptAt > now ? Math.max(1, Math.round((c.nextAttemptAt - now) / 60_000)) : null;
}

/** Overall status: first match wins. `enabled` may be the optimistic switch value. */
export function deriveTlsPill(status: TlsStatus | null, enabled: boolean, now: number, t: Translate): TlsPill {
  const getting: TlsPill = { severity: "info", label: t("gateway.tls.pill.getting", undefined, "Getting certificate…"), icon: mdiLoading, spin: true };
  if (!status) return { severity: "neutral", label: t("gateway.tls.pill.checking", undefined, "Checking…"), icon: mdiClockOutline };
  if (!enabled) return { severity: "neutral", label: t("gateway.tls.pill.off", undefined, "Off"), icon: mdiMinusCircleOutline };
  if (!hasTlsDetail(status)) return getting;
  if (status.bindError) return { severity: "error", label: t("gateway.tls.pill.stopped", undefined, "Stopped"), icon: mdiCloseCircleOutline };
  if (status.gates.some((g) => !g.ok)) return { severity: "warning", label: t("gateway.tls.pill.setup", undefined, "Setup needed"), icon: mdiAlert };
  const held = status.certs.filter((c) => isHeld(c, now));
  if (held.length > 0) {
    return held.some((c) => c.lastError)
      ? { severity: "warning", label: t("gateway.tls.pill.renewFailing", undefined, "On, renewal failing"), icon: mdiAlert }
      : { severity: "success", label: t("gateway.tls.pill.on", undefined, "On"), icon: mdiCheckCircleOutline };
  }
  if (status.certs.some((c) => c.lastError && c.stage === "idle")) {
    return { severity: "error", label: t("gateway.tls.pill.failed", undefined, "Failed"), icon: mdiCloseCircleOutline };
  }
  return getting;
}

export interface TlsRowView {
  pill: TlsPill;
  facts: string;
  /** Label of the Renew now / Try again now / Working… button. */
  action: string;
  running: boolean;
  held: boolean;
}

/** One certificate row: state pill, facts line and action label. */
export function deriveCertRow(cert: TlsCertStatus, now: number, t: Translate): TlsRowView {
  const held = isHeld(cert, now);
  const running = cert.stage !== "idle";
  const requesting = cert.stage === "requesting";
  const date = fmtDate(cert.notAfter ?? now);
  const days = daysLeft(cert, now);
  const spin = (label: string): TlsPill => ({ severity: "info", label, icon: mdiLoading, spin: true });
  const working = t("gateway.tls.row.working", undefined, "Working…");
  let pill: TlsPill;
  let facts: string;
  if (running && !held) {
    pill = spin(requesting ? t("gateway.tls.row.requesting", undefined, "Requesting…") : working);
    facts = t("gateway.tls.row.requestingFacts", undefined, "Asking for a certificate. This can take up to 2 minutes.");
  } else if (running) {
    pill = spin(requesting ? t("gateway.tls.row.renewing", undefined, "Renewing…") : working);
    facts = t("gateway.tls.row.renewingFacts", { date, days }, "Current certificate valid until {date} ({days} days). Keeps serving while it renews.");
  } else if (held) {
    pill = cert.lastError
      ? { severity: "warning", label: t("gateway.tls.row.daysLeft", { days }, "{days} days left"), icon: mdiAlert }
      : { severity: "success", label: t("gateway.tls.row.valid", { days }, "Valid · {days} days left"), icon: mdiCheckCircleOutline };
    facts = t("gateway.tls.row.validFacts", { date }, "Valid until {date}. Renews automatically when a third of its life is left.");
  } else {
    pill = { severity: "error", label: t("gateway.tls.row.none", undefined, "No certificate"), icon: mdiCloseCircleOutline };
    facts = t("gateway.tls.row.noneFacts", undefined, "Nothing to serve yet.");
  }
  let action: string;
  if (running) action = t("gateway.tls.row.busy", undefined, "Working…");
  else if (held) action = t("gateway.tls.row.renewNow", undefined, "Renew now");
  else action = t("gateway.tls.row.tryNow", undefined, "Try again now");
  return { pill, facts, action, running, held };
}

export interface ApplyErrorView {
  field: "port" | "host";
  message: string;
}

/** Plain words for a rejected Apply (the server's `tls.*` message names the field). */
export function describeApplyError(raw: string, attemptedPort: number, t: Translate): ApplyErrorView {
  if (/tls\.host/.test(raw)) {
    return { field: "host", message: t("gateway.tls.err.host", undefined, "Enter an IP address, for example 100.83.0.1, or localhost.") };
  }
  if (/already used by/.test(raw)) {
    return {
      field: "port",
      message: t("gateway.tls.err.portTaken", { port: attemptedPort }, "Port {port} is already used by the dashboard itself. Pick a free port, for example 8443."),
    };
  }
  if (/tls\.port/.test(raw)) {
    return { field: "port", message: t("gateway.tls.err.portRange", undefined, "Enter a port from 1 to 65535.") };
  }
  return { field: "port", message: raw || t("gateway.tls.err.saveFailed", undefined, "Could not save this setting") };
}

export type ApplyPlan =
  | { kind: "unchanged" }
  | { kind: "invalid" }
  | { kind: "send"; patch: { port?: number; host?: string } };

/** What Apply should do with the drafts: nothing, refuse locally (port out of range), or PUT a minimal patch. */
export function planApply(status: { port: number; host: string }, portDraft: string | null, hostDraft: string | null): ApplyPlan {
  const patch: { port?: number; host?: string } = {};
  if (portDraft !== null && portDraft.trim() !== String(status.port)) {
    const n = Number(portDraft.trim());
    if (!Number.isInteger(n) || n < 1 || n > 65535) return { kind: "invalid" };
    patch.port = n;
  }
  if (hostDraft !== null && hostDraft.trim() !== status.host) patch.host = hostDraft.trim();
  return patch.port === undefined && patch.host === undefined ? { kind: "unchanged" } : { kind: "send", patch };
}
