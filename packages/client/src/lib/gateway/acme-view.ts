/**
 * Pure view-model helpers of the Gateway "Domain certificates" (ACME DNS-01) groups:
 * stage → step mapping, the group status pill (first match wins, per
 * `mockups/ui-plan.md`), the renewal window, the CNAME record, check time and the
 * client-side field checks the editor runs before it asks the server.
 * The server stays authoritative; these only spare a round trip for obvious typos.
 *
 * See change: add-acme-dns01-certs (design D5, D11).
 */
import type { TlsCertStatus, TlsGate, TlsSourceStatus } from "@blackbelt-technology/pi-dashboard-shared/tls-status.js";
import { mdiAlert, mdiAlertCircleOutline, mdiCheckCircleOutline, mdiLoading } from "@mdi/js";
import type { StoredAcmeEntry } from "./tls-api.js";
import { isHeld, type TlsPill } from "./tls-view.js";

type Translate = (key: string, vars?: Record<string, string | number>, fallback?: string) => string;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Issuance stages the ACME source reports, in order. Any other non-idle value is shown as "Working…". */
export const ACME_STAGES = ["order", "dns-publish", "propagation", "validation", "finalize"] as const;
export const isAcmeStage = (stage: string): boolean => (ACME_STAGES as readonly string[]).includes(stage);

/** Let's Encrypt certificates live 90 days; renewal starts when a third is left (the row's "Renews automatically" copy). */
const ASSUMED_VALIDITY_DAYS = 90;
const RENEWAL_WINDOW_DAYS = ASSUMED_VALIDITY_DAYS / 3;

/** A held certificate with at most a third of its life left. */
export const inRenewalWindow = (cert: TlsCertStatus, now: number): boolean =>
  isHeld(cert, now) && (cert.notAfter ?? 0) - now <= RENEWAL_WINDOW_DAYS * DAY_MS;

export const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const isWildcard = (name: string): boolean => name.startsWith("*.");

/** `_acme-challenge.<name minus a leading "*.">` — the host the CNAME record sits at. */
export const challengeHost = (name: string): string => `_acme-challenge.${isWildcard(name) ? name.slice(2) : name}`;

/** Source-level detail as a boolean (the status wire type allows `"true"`). */
const flag = (v: string | boolean | undefined): boolean => v === true || v === "true";

export const isStaging = (source: TlsSourceStatus): boolean => flag(source.details?.staging);

/** The solver of a source as status reports it. */
export const solverTypeOf = (source: TlsSourceStatus): "cloudflare" | "acme-dns" | null => {
  const v = source.details?.solverType;
  return v === "cloudflare" || v === "acme-dns" ? v : null;
};

/** ms epoch the CNAME check for `name` last ran (`details["checkedAt:<domain>"]`), or null. */
export function checkedAtOf(source: TlsSourceStatus, name: string): number | null {
  const d = source.details;
  if (!d) return null;
  for (const key of [name, isWildcard(name) ? name.slice(2) : name]) {
    const v = d[`checkedAt:${key}`];
    if (typeof v === "string") {
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return null;
}

/** "Checked N minutes ago." with `Just now` under a minute. */
export function checkedAgo(checkedAt: number, now: number, t: Translate): string {
  const minutes = Math.floor(Math.max(0, now - checkedAt) / MINUTE_MS);
  if (minutes < 1) return t("gateway.acme.checkedNow", undefined, "Checked just now.");
  if (minutes < 60) return t("gateway.acme.checkedMinutes", { minutes }, "Checked {minutes} minutes ago.");
  return t("gateway.acme.checkedHours", { hours: Math.floor(minutes / 60) }, "Checked {hours} hours ago.");
}

/** Did the DNS provider refuse the credentials (as opposed to "not entered yet")? */
export const isRejectedCredentials = (gate: TlsGate): boolean => gate.id === "credentials" && /reject|forbidden|unauthori[sz]ed|\b40[13]\b/i.test(gate.hint ?? "");

/** The CA marked a challenge `invalid` (the source puts it in `lastError`). */
export const isCaInvalid = (cert: TlsCertStatus): boolean => !!cert.lastError && /\binvalid\b/i.test(cert.lastError);

/** Unmet gates that apply to `name`: its own, plus the source-wide ones. */
export const gatesFor = (gates: TlsGate[], name: string): TlsGate[] => gates.filter((g) => !g.ok && (g.name === undefined || g.name === name));

/** Group status pill: first match wins (`mockups/ui-plan.md` "Status → group pill"). */
export function deriveAcmeGroupPill(source: TlsSourceStatus, certs: TlsCertStatus[], gates: TlsGate[], now: number, t: Translate): TlsPill {
  const unmet = gates.filter((g) => !g.ok);
  const credentials = unmet.find((g) => g.id === "credentials");
  if (credentials) {
    return isRejectedCredentials(credentials)
      ? { severity: "error", label: t("gateway.acme.pill.failing", undefined, "Failing"), icon: mdiAlertCircleOutline }
      : { severity: "warning", label: t("gateway.acme.pill.setup", undefined, "Setup needed"), icon: mdiAlert };
  }
  if (unmet.length > 0) {
    const blocked = certs.some((c) => inRenewalWindow(c, now));
    return blocked
      ? { severity: "warning", label: t("gateway.acme.pill.attention", undefined, "Needs attention"), icon: mdiAlert }
      : { severity: "warning", label: t("gateway.acme.pill.setup", undefined, "Setup needed"), icon: mdiAlert };
  }
  if (certs.some((c) => c.stage !== "idle")) {
    return { severity: "info", label: t("gateway.acme.pill.getting", undefined, "Getting certificates…"), icon: mdiLoading, spin: true };
  }
  if (certs.some((c) => c.lastError)) {
    return { severity: "error", label: t("gateway.acme.pill.failing", undefined, "Failing"), icon: mdiAlertCircleOutline };
  }
  if (certs.length > 0 && certs.every((c) => isHeld(c, now))) {
    return isStaging(source)
      ? { severity: "warning", label: t("gateway.acme.pill.staging", undefined, "Staging only"), icon: mdiAlert }
      : { severity: "success", label: t("gateway.acme.pill.on", undefined, "On"), icon: mdiCheckCircleOutline };
  }
  return { severity: "info", label: t("gateway.acme.pill.getting", undefined, "Getting certificates…"), icon: mdiLoading, spin: true };
}

// ── editor field checks ──

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Lowercase, one trailing dot stripped; null when it is not a hostname (or `*.` + hostname). */
export function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();
  if (d.endsWith(".")) d = d.slice(0, -1);
  if (d.length === 0 || d.length > 253) return null;
  const body = d.startsWith("*.") ? d.slice(2) : d;
  const labels = body.split(".");
  if (!labels.every((l) => LABEL.test(l))) return null;
  // An IPv4 literal passes the label rule; every real hostname ends in a non-numeric label.
  if (/^\d+$/.test(labels[labels.length - 1])) return null;
  return d;
}

export type IdProblem = "empty" | "format" | "reserved" | "taken";

/** The prerequisite's source id rule: `^[a-z0-9][a-z0-9-]{0,31}$`, unique, `tailscale` reserved. */
export function idProblem(id: string, taken: readonly string[]): IdProblem | null {
  if (id === "") return "empty";
  if (id === "tailscale") return "reserved";
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) return "format";
  return taken.includes(id) ? "taken" : null;
}

export const directoryKind = (directory: string): "staging" | "production" | "custom" =>
  directory === "staging" || directory === "production" ? directory : "custom";

/** Where the editor field a server message is about lives (`"domains must…"`, `"tls.sources[1].email …"`). */
export type EditorField = "id" | "email" | "domain" | "directory" | "solver" | null;
export function fieldOfServerMessage(message: string): EditorField {
  if (/\bdomains?\b/i.test(message)) return "domain";
  if (/\bemail\b/i.test(message)) return "email";
  if (/\bdirectory\b/i.test(message)) return "directory";
  if (/\b(solver|zoneId|subdomain|fulldomain|server|acme-dns|cloudflare)\b/i.test(message)) return "solver";
  if (/\bid\b|\bsource\b|reserved/i.test(message)) return "id";
  return null;
}

/** First stored entry for `id`, if any. */
export const findStored = (sources: StoredAcmeEntry[], id: string): StoredAcmeEntry | undefined => sources.find((s) => s.id === id);
