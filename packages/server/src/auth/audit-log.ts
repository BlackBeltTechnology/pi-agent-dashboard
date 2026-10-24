/**
 * Auth audit lines — one shared, sanitising emitter for credential/pairing
 * mutations (harden-auth-credentials D2).
 *
 * Format: `[<area>] <verb> k=v k=v`, the same shape as the existing `[pairing]`
 * decision lines. Every value is sanitised (characters outside `[\w.:-]` → `_`)
 * BEFORE any prefix cut, so an attacker-chosen JWT `sub`, device id or peer
 * string can never inject a second record or a fake `k=v`. `ip=` is the SOCKET
 * peer (`request.ip`; `trustProxy` is never enabled) — forwarding headers are
 * never read. Callers pass identifiers and codes only: never a secret, token,
 * hash, key or flow input value.
 *
 * An audit write failure is swallowed: the mutation it describes has already
 * happened and must not turn into a 500.
 */

import type { FastifyRequest } from "fastify";

/** Prefix length for ids / subjects (`id=d0123456`, `actor=session:alice_ex`). */
const PREFIX_LEN = 8;

/** Replace every character outside `[\w.:-]` with `_` (per code point). */
function sanitizeAuditValue(value: unknown): string {
  return String(value ?? "").replace(/[^\w.:-]/gu, "_");
}

/** Sanitise FIRST, then keep the first `len` characters (default 8). */
export function auditPrefix(value: unknown, len: number = PREFIX_LEN): string {
  return sanitizeAuditValue(value).slice(0, len);
}

type AuditFieldValue = string | number | boolean | undefined;

/** Pure formatter: `[area] verb k=v …` — fields with an `undefined` value are omitted. */
function formatAuditLine(area: string, verb: string, fields: Record<string, AuditFieldValue> = {}): string {
  const parts = [`[${sanitizeAuditValue(area)}]`, sanitizeAuditValue(verb)];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${sanitizeAuditValue(key)}=${sanitizeAuditValue(value)}`);
  }
  return parts.join(" ");
}

/**
 * Emit one audit line via `console.log` (the Fastify logger is off). Field
 * values are sanitised here; apply {@link auditPrefix} to ids first. Never throws.
 */
export function auditLine(area: string, verb: string, fields: Record<string, AuditFieldValue> = {}): void {
  try {
    console.log(formatAuditLine(area, verb, fields));
  } catch {
    // Fail-open: a broken log sink must not fail the mutation (AX12).
  }
}

/**
 * `actor=` for a request that passed an auth hook:
 * `session:<sub8>` (login session / identity principal) | `device:<id8>` | `local`.
 * `local` covers the local token and a genuinely-local loopback caller — the
 * only other callers an operator guard admits.
 */
function auditActor(request: FastifyRequest): string {
  const r = request as {
    authVia?: string;
    principalDeviceId?: string;
    sessionPayload?: { sub?: unknown };
    principal?: { sub?: unknown } | null;
  };
  if (r.authVia === "session" || r.authVia === "principal") {
    const sub = r.authVia === "session" ? r.sessionPayload?.sub : r.principal?.sub;
    return `session:${auditPrefix(sub) || "unknown"}`;
  }
  if (r.authVia === "device") return `device:${auditPrefix(r.principalDeviceId) || "unknown"}`;
  return "local";
}

/** `{ actor, ip }` for a request-driven audit line; `ip` is the socket peer only. */
export function auditRequestFields(request: FastifyRequest): { actor: string; ip: string } {
  return { actor: auditActor(request), ip: request.ip };
}
