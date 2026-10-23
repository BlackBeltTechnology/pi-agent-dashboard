/**
 * Request-`cwd` parsing + admission for plugin REST routes (automation, flows).
 *
 * One boundary for the three questions a route asks of a caller-supplied `cwd`,
 * in a fixed order, all BEFORE any filesystem / git access under it:
 *   1. shape    — a present value that is not a single string → 400 `invalid_cwd`
 *                 (array from `?cwd=a&cwd=b`, JSON object / number / boolean);
 *   2. presence — absent or `""` on a route that needs a folder → 400 `cwd_required`
 *                 (never defaulted to the server process cwd);
 *   3. admission — a supplied cwd is decided by the tri-state {@link admitCwd}:
 *                 refuse → 403 (existing plugin refusal body), indeterminate →
 *                 503 `cwd-admission-unavailable` + `Retry-After: 1`.
 * `admitCwd` is never called for outcomes 1 and 2.
 *
 * The caller releases the admission token in its handler `finally` (`release()`).
 * See change: harden-git-terminal-plugin-boundaries (S1r).
 */
import { type AdmitCwdOptions, admissionAllows, admitCwd, releaseAdmission } from "./cwd-guard.js";

export interface RouteCwdOptions {
  /** `true` → an absent or empty cwd is `cwd_required`; `false` → it resolves to `cwd: undefined`. */
  required: boolean;
  /** Live admit set, read on every request (never cached here). Fail-closed default: nothing known. */
  knownCwds?: () => string[];
  /** `admitCwd` options (the host's throttled `onIndeterminate` logger; test seams). */
  admitOptions?: AdmitCwdOptions;
}

export interface RouteCwdRefusal {
  ok: false;
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export type RouteCwdResult = { ok: true; cwd: string | undefined; release: () => void } | RouteCwdRefusal;

const NO_KNOWN = (): string[] => [];
const NOOP = (): void => {};

const DENIED_REASON = "cwd is not a known session or pinned directory.";
const DENIED_HINT = "Pin this directory to allow it, or open a session rooted in it.";

/** Parse (shape → presence) then admit a request `cwd` for a plugin route. */
export async function admitRouteCwdParam(raw: unknown, opts: RouteCwdOptions): Promise<RouteCwdResult> {
  // JSON `null` carries no value: same as absent.
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return {
      ok: false,
      status: 400,
      body: { error: "invalid_cwd", message: "cwd must be a single string" },
    };
  }
  if (raw === undefined || raw === null || raw === "") {
    if (opts.required) {
      return { ok: false, status: 400, body: { error: "cwd_required", message: "cwd is required" } };
    }
    return { ok: true, cwd: undefined, release: NOOP };
  }
  const admission = await admitCwd(raw, opts.knownCwds ?? NO_KNOWN, opts.admitOptions);
  if (admission.kind === "admit" && admissionAllows(admission, raw)) {
    const { token } = admission;
    return { ok: true, cwd: raw, release: () => releaseAdmission(token) };
  }
  if (admission.kind === "indeterminate") {
    return {
      ok: false,
      status: 503,
      body: {
        error: "cwd-admission-unavailable",
        message: "cwd admission could not be decided right now",
        retryAfterMs: 1000,
      },
      headers: { "Retry-After": "1" },
    };
  }
  return {
    ok: false,
    status: 403,
    body: { error: "not-allowed", message: `cwd not allowed: ${raw}`, reason: DENIED_REASON, hint: DENIED_HINT },
  };
}

/** The minimal reply surface {@link sendRouteCwdRefusal} needs (a Fastify reply satisfies it). */
interface ReplyLike {
  code(status: number): unknown;
  header(name: string, value: string): unknown;
}

/** Write a refusal onto `reply` and return its body (handlers `return` it). */
export function sendRouteCwdRefusal(reply: ReplyLike, refusal: RouteCwdRefusal): Record<string, unknown> {
  for (const [k, v] of Object.entries(refusal.headers ?? {})) reply.header(k, v);
  reply.code(refusal.status);
  return refusal.body;
}
