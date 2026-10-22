/**
 * Cwd admission for the file-family routes (change: core-file-cwd-admission, D1/D2/D3/D4): one
 * function every file gate helper, inline route, editor-pane save, grep route and live-preview gate
 * calls, so the shared guard's contract (503 on undecidable, `cwd_unknown` on refusal, canonical
 * anchor) cannot drift between sites.
 *
 * The branch on `admissionAllows(admission, raw)` is right here so static analysis keeps the
 * modelled path-injection barrier. Callers use the returned GUARDED `cwd` (the unmodified request
 * string `admissionAllows` accepted) and release the token when done.
 */
import path from "node:path";
import { admissionAllows, releaseAdmission } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import type { FastifyReply } from "fastify";
import {
  admitRouteCwd,
  CWD_ADMISSION_UNAVAILABLE_BODY,
  type RouteAdmissionDeps,
  sendAdmissionUnavailable,
} from "./route-admission.js";

/**
 * Additive wire fields of a cwd-admission failure (core-file-cwd-admission D3/D4):
 * `code` is `"cwd_unknown"` (refused) or `"cwd-admission-unavailable"` (503, with
 * `message` + `retryAfterMs`). Absent on every other failure.
 */
export interface GateWire {
  code: string;
  message?: string;
  retryAfterMs?: number;
}

/** The minimal shape of a cwd-admission failure; assignable to the file routes' `GateFailure`. */
export interface CwdFailure {
  code: number;
  error: string;
  wire: GateWire;
}

/** The shared 503 of an undecidable cwd admission as a gate failure (D3). */
export const CWD_UNAVAILABLE_FAILURE: CwdFailure = {
  code: 503,
  error: CWD_ADMISSION_UNAVAILABLE_BODY.error,
  wire: {
    code: CWD_ADMISSION_UNAVAILABLE_BODY.code,
    message: CWD_ADMISSION_UNAVAILABLE_BODY.message,
    retryAfterMs: CWD_ADMISSION_UNAVAILABLE_BODY.retryAfterMs,
  },
};

/** A cwd refusal: the route's own pre-change `error` string plus the additive `code: "cwd_unknown"` (D4). */
function cwdRefusal(error: string): CwdFailure {
  return { code: 403, error, wire: { code: "cwd_unknown" } };
}

/**
 * Outcome of {@link admitFileCwd}. `cwd` is the GUARDED request value (the unmodified string
 * `admissionAllows` accepted); `canonCwd` is its canonical form. `release()` ends the
 * admission token: callers run it when done (helpers in a `finally`, inline routes via
 * `reply.raw` close).
 */
export type FileCwdAdmission =
  | { ok: true; cwd: string; canonCwd: string; release: () => void }
  | { ok: false; failure: CwdFailure };

/**
 * Admit a request `cwd` through the shared guard for the file-family routes (change:
 * core-file-cwd-admission, D1). The branch on `admissionAllows(admission, raw)` is right here so
 * the modelled path-injection barrier survives; every file gate helper and inline route calls
 * this one function. A non-string or non-absolute value is refused BEFORE admission (it can never
 * select a global scope or reach `admitCwd`). Indeterminate → the shared 503 failure.
 * With `reply`, the token is released when the response closes.
 */
export async function admitFileCwd(
  raw: unknown,
  routeAdmission: RouteAdmissionDeps,
  opts: { error?: string; reply?: FastifyReply } = {},
): Promise<FileCwdAdmission> {
  const error = opts.error ?? "unknown session path";
  if (typeof raw !== "string" || !path.isAbsolute(raw)) return { ok: false, failure: cwdRefusal(error) };
  const admission = await admitRouteCwd(raw, routeAdmission);
  if (admission.kind === "indeterminate") return { ok: false, failure: CWD_UNAVAILABLE_FAILURE };
  if (admission.kind !== "admit" || !admissionAllows(admission, raw)) {
    return { ok: false, failure: cwdRefusal(error) };
  }
  const token = admission.token;
  const release = (): void => releaseAdmission(token);
  if (opts.reply) {
    opts.reply.raw.once("close", release);
    // The client may have gone while admission ran (`close` already fired): release at once.
    if (opts.reply.raw.destroyed) release();
  }
  return { ok: true, cwd: raw, canonCwd: token.canonCwd, release };
}

/**
 * Containment anchors for an admitted cwd (D2): the request spelling first (relative paths
 * resolve against it), then the canonical cwd when it differs. Layer ② roots are the same for
 * both, so nothing outside the admitted directory is added.
 */
export function cwdAnchors(a: { cwd: string; canonCwd: string }): string[] {
  return a.canonCwd === a.cwd ? [a.cwd] : [a.cwd, a.canonCwd];
}

/** The `cwd_unknown` refusal body of the package, canvas-types, resources and groups routes (D4). */
export const CWD_NOT_ALLOWED_BODY = {
  success: false,
  code: "cwd_unknown",
  error: "cwd not allowed",
  reason: "cwd is not a known session or pinned directory.",
  hint: "Pin this directory to allow it, or open a session rooted in it.",
} as const;

/** Reply with the shared 503 (undecidable) or the 403 {@link CWD_NOT_ALLOWED_BODY} (refused). */
export function sendCwdFailure(
  reply: FastifyReply,
  failure: CwdFailure,
): typeof CWD_NOT_ALLOWED_BODY | typeof CWD_ADMISSION_UNAVAILABLE_BODY {
  if (failure.code === 503) return sendAdmissionUnavailable(reply);
  reply.code(403);
  return CWD_NOT_ALLOWED_BODY;
}

/** Outcome of {@link admitOptionalCwd}: `cwd` is the guarded value, or `undefined` when the request sent none. */
export type OptionalCwdAdmission = { ok: true; cwd: string | undefined } | { ok: false; failure: CwdFailure };

/**
 * Admit a `cwd` that the route treats as optional (package, canvas-types, resources routes). Absent
 * (`undefined`, `null`, `""`) keeps the route's server-chosen fallback and hands the sink `undefined`,
 * never the request value; any other value must be an admitted absolute cwd. The token is released
 * when the response closes. See change: core-file-cwd-admission (D1).
 */
export async function admitOptionalCwd(
  raw: unknown,
  routeAdmission: RouteAdmissionDeps,
  reply: FastifyReply,
): Promise<OptionalCwdAdmission> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, cwd: undefined };
  const admitted = await admitFileCwd(raw, routeAdmission, { error: "cwd not allowed", reply });
  return admitted.ok ? { ok: true, cwd: admitted.cwd } : { ok: false, failure: admitted.failure };
}
