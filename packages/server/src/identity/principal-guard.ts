/**
 * Validate → copy → freeze a resolver's `PrincipalResolution` before it is
 * exposed to request/ticket/socket state (openspec §3.3 / design D3).
 *
 * A resolver is plugin-owned code; its return value may carry getters, extra
 * enumerable props, prototype pollution, or a mutable object the plugin keeps
 * a reference to. Core NEVER trusts that shape: it reads the four fields it
 * knows, rejects anything malformed, then builds a fresh frozen plain object.
 *
 * Rejection (returns `null`, caller logs + treats as no-claim) when:
 *   - `iss` or `sub` is not a non-empty string, or exceeds the length cap;
 *   - `email` is present but not a bounded non-blank string;
 *   - `expiresAt` is not a finite number that is still in the future given the
 *     configured skew floor (a coarse sanity floor — the resolver already
 *     applied skew inside its OWN validity decision, D3).
 */

import type {
  Principal,
  PrincipalResolution,
} from "@blackbelt-technology/pi-dashboard-shared/identity.js";

/** Upper bound on `iss`/`sub`/`email` length — a DoS/abuse guard, not a spec. */
const MAX_FIELD_LENGTH = 4096;

function validString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= MAX_FIELD_LENGTH;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Read only an own DATA property — inherited values/getters never execute. */
function ownData(obj: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/**
 * @param skewSeconds the configured clock-skew floor (same value the resolver
 *   used) so the future-expiry sanity check and the resolver's own decision
 *   cannot disagree at the boundary.
 * @param now injectable clock (ms) for tests; defaults to `Date.now()`.
 * @returns a frozen, copied resolution, or `null` when the input is malformed.
 */
export function sanitizePrincipalResolution(
  raw: unknown,
  skewSeconds: number,
  now: number = Date.now(),
): PrincipalResolution | null {
  try {
    if (!isPlainObject(raw)) return null;
    const principal = ownData(raw, "principal");
    if (!isPlainObject(principal)) return null;

    const iss = ownData(principal, "iss");
    const sub = ownData(principal, "sub");
    const email = ownData(principal, "email");
    if (!validString(iss) || !validString(sub)) return null;
    if (email !== undefined && !validString(email)) return null;

    const expiresAt = ownData(raw, "expiresAt");
    if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
    // Coarse future-expiry floor, forgiving up to the resolver's own skew.
    if (expiresAt <= now - skewSeconds * 1000) return null;

    const cleanPrincipal: Principal = Object.freeze(
      email !== undefined ? { iss, sub, email } : { iss, sub },
    );
    return Object.freeze({ principal: cleanPrincipal, expiresAt });
  } catch {
    // Proxies can throw from getPrototypeOf/getOwnPropertyDescriptor. Plugin
    // output is untrusted: malformed shapes are neutralized, never a 500.
    return null;
  }
}
