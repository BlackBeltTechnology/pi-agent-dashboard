/**
 * Live-server-preview target validation — the SSRF boundary.
 *
 * Pure, browser-safe (no `node:*`) so the client pre-validates and the server
 * enforces with the SAME rule. Only loopback hosts are embeddable; everything
 * else (cloud metadata `169.254.169.254`, private LAN, public hosts) is
 * rejected to prevent the dashboard from being turned into an SSRF proxy.
 *
 * See change: improve-content-editor (live-server-preview §6).
 */

/** Hosts that resolve to the local machine only. */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

export interface LiveServerTargetInput {
  host: string;
  port: number;
  label?: string;
}

export interface LiveServerTarget {
  id: string;
  label: string;
  host: string;
  port: number;
}

export type LiveTargetValidation =
  | { ok: true; host: string; port: number; label: string }
  | { ok: false; error: string };

/** Normalise + validate a live-server target. Loopback-only; port 1..65535. */
export function validateLiveTarget(input: unknown): LiveTargetValidation {
  // Robust to non-object input (e.g. a `null`/primitive entry in a hand-edited
  // persisted allowlist) — never throw during validation.
  if (!input || typeof input !== "object") {
    return { ok: false, error: "target must be an object" };
  }
  const { host: rawHost, port: rawPort, label: rawLabelIn } = input as {
    host?: unknown;
    port?: unknown;
    label?: unknown;
  };
  const host = typeof rawHost === "string" ? rawHost.trim().toLowerCase() : "";
  if (!host) return { ok: false, error: "host is required" };
  if (!LOOPBACK_HOSTS.has(host)) {
    return { ok: false, error: "only loopback hosts (localhost, 127.0.0.1, ::1) are allowed" };
  }
  const port = typeof rawPort === "number" ? rawPort : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "port must be an integer in 1..65535" };
  }
  const rawLabel = typeof rawLabelIn === "string" ? rawLabelIn.trim() : "";
  const label = rawLabel || `${host}:${port}`;
  return { ok: true, host, port, label };
}

/** The proxied path a validated target is served under on the main origin. */
export function liveServerPath(id: string): string {
  return `/live/${id}/`;
}
