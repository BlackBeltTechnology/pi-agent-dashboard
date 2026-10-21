/**
 * Browser-safe wire types + validators for the live trust query
 * (`POST /api/pi-trust/query`). No Node imports.
 *
 * A covered answer has two shapes, by requester class:
 *   - local (genuinely local proof): the covering folder, its source kind and
 *     the folder identity recorded when the live entry was created;
 *   - remote (paired device): only `{covered, salt, digest}` — never the source
 *     kind or an identity.
 *
 * See change: mirror-dashboard-trust-live-remote (D1, D4, D5).
 */
import type { MirrorSourceKind } from "./pi-trust-mirror-types.js";

/** Body cap (bytes) and cwd cap (characters) of a live query. */
export const PI_TRUST_QUERY_MAX_BODY_BYTES = 8192;
export const PI_TRUST_QUERY_MAX_CWD = 4096;

export const PI_TRUST_QUERY_PATH = "/api/pi-trust/query";

export interface PiTrustLiveQueryRequest {
  cwd: string;
}

export type PiTrustLiveQueryBodyCheck =
  | { ok: true; cwd: string }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Validate a parsed query body: an object with a string `cwd` that is absolute,
 * NUL-free and at most 4,096 characters. The byte cap is the caller's (it needs
 * the raw length). Never throws.
 */
export function validatePiTrustQueryBody(body: unknown, rawBytes?: number): PiTrustLiveQueryBodyCheck {
  if (typeof rawBytes === "number" && rawBytes > PI_TRUST_QUERY_MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "body too large" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "malformed body" };
  const cwd = (body as { cwd?: unknown }).cwd;
  if (typeof cwd !== "string" || cwd.length === 0) return { ok: false, status: 400, error: "cwd required" };
  if (cwd.length > PI_TRUST_QUERY_MAX_CWD) return { ok: false, status: 400, error: "cwd too long" };
  if (cwd.includes("\0")) return { ok: false, status: 400, error: "cwd malformed" };
  if (!(cwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("\\\\"))) {
    return { ok: false, status: 400, error: "cwd must be absolute" };
  }
  return { ok: true, cwd };
}

export type PiTrustLiveAnswer =
  | { covered: false }
  | { covered: true; salt: string; digest: string }
  | {
      covered: true;
      key: string;
      sourceKind: MirrorSourceKind;
      dev: string;
      ino: string;
      birthtimeMs?: number;
    };

export type PiTrustLiveCovered = Exclude<PiTrustLiveAnswer, { covered: false }>;

export function isRemoteLiveAnswer(a: PiTrustLiveCovered): a is Extract<PiTrustLiveCovered, { salt: string }> {
  return "salt" in a;
}

/** Strictly parse an answer body; anything that is not one of the three shapes is `null`. */
export function parsePiTrustLiveAnswer(body: unknown): PiTrustLiveAnswer | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.covered === false) return { covered: false };
  if (b.covered !== true) return null;
  if (typeof b.salt === "string" && typeof b.digest === "string" && b.salt && b.digest) {
    return { covered: true, salt: b.salt, digest: b.digest };
  }
  if (
    typeof b.key === "string" &&
    typeof b.sourceKind === "string" &&
    typeof b.dev === "string" &&
    typeof b.ino === "string" &&
    (b.birthtimeMs === undefined || typeof b.birthtimeMs === "number")
  ) {
    return {
      covered: true,
      key: b.key,
      sourceKind: b.sourceKind as MirrorSourceKind,
      dev: b.dev,
      ino: b.ino,
      ...(typeof b.birthtimeMs === "number" ? { birthtimeMs: b.birthtimeMs } : {}),
    };
  }
  return null;
}
