/**
 * Client-side view of `GET /api/plugins/craft-web/status` and
 * `POST /api/plugins/craft-web/prepare/:app`.
 *
 * ASSUMED server shapes (the server agent owns the final contract; everything here is
 * parsed defensively — unknown shapes fail closed to a "blocked" gate):
 *
 *   GET status  → 200 { apps: { <appId>: { status: "ok" | <reason>, reason?, message?,
 *                                          version?, sizeGzip?, shimVersion? } } }
 *                 404 (route absent: plugin enabled live, server entry not loaded)
 *                     → treated as `restart-required`.
 *   POST prepare/:app → 2xx { ok: true } | { status: "ok" }            = prepared
 *                       non-2xx or { ok:false, reason } | { status:<reason> } = failed
 *                       (403 = disabled, network failure = offline)
 *   POST csp-report   → body { app, directive }; response ignored.
 *
 * `<reason>` ∈ GATE_REASONS (design D1). A response whose `status` is not "ok" and not a
 * known reason but whose `reason` is, uses `reason`.
 * See change: edit-office-in-pane-with-craft-web.
 */

const GATE_REASONS = [
  "disabled",
  "restart-required",
  "not-verified",
  "not-prepared",
  "shim-outdated",
  "offline",
  "checksum-mismatch",
  "launcher-source",
  "extract-failed",
] as const;
type GateReason = (typeof GATE_REASONS)[number];

interface CraftWebAppStatus {
  status: string;
  reason?: string;
  message?: string;
  version?: string;
  /** Approximate gzip download size in bytes (shown before the first load). */
  sizeGzip?: number;
}

export interface CraftWebStatus {
  apps: Record<string, CraftWebAppStatus>;
}

export type Gate =
  | { kind: "ready" }
  | { kind: "blocked"; reason: GateReason | "unavailable"; sizeGzip?: number; message?: string };

/** Reasons a Prepare click can fix (or retry). */
export const PREPARABLE: ReadonlySet<string> = new Set([
  "not-prepared",
  "shim-outdated",
  "offline",
  "checksum-mismatch",
  "extract-failed",
]);

const isReason = (v: unknown): v is GateReason => typeof v === "string" && (GATE_REASONS as readonly string[]).includes(v);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Defensive parse; `null` when the body is not the documented envelope. */
export function parseStatus(raw: unknown): CraftWebStatus | null {
  if (!isRecord(raw) || !isRecord(raw.apps)) return null;
  const apps: Record<string, CraftWebAppStatus> = {};
  for (const [id, v] of Object.entries(raw.apps)) {
    if (!isRecord(v) || typeof v.status !== "string") continue;
    apps[id] = {
      status: v.status,
      reason: typeof v.reason === "string" ? v.reason : undefined,
      message: typeof v.message === "string" ? v.message : undefined,
      version: typeof v.version === "string" ? v.version : undefined,
      sizeGzip: typeof v.sizeGzip === "number" ? v.sizeGzip : undefined,
    };
  }
  return { apps };
}

/** Gate for one app. A missing app entry fails closed to `not-verified`. */
export function gateFor(status: CraftWebStatus | null, appId: string): Gate {
  const app = status?.apps[appId];
  if (!app) return { kind: "blocked", reason: "not-verified" };
  if (app.status === "ok") return { kind: "ready" };
  const reason = isReason(app.status) ? app.status : isReason(app.reason) ? app.reason : "unavailable";
  return { kind: "blocked", reason, sizeGzip: app.sizeGzip, message: app.message };
}

export type PrepareResult = { ok: true } | { ok: false; reason: string; message?: string };

/** Maps a prepare HTTP outcome onto {@link PrepareResult}. */
export function parsePrepare(httpOk: boolean, httpStatus: number, body: unknown): PrepareResult {
  const rec = isRecord(body) ? body : {};
  const bodyOk = rec.ok === true || rec.status === "ok" || (rec.ok === undefined && rec.status === undefined);
  if (httpOk && bodyOk) return { ok: true };
  if (httpStatus === 403) return { ok: false, reason: "disabled" };
  const reason =
    (typeof rec.reason === "string" && rec.reason) ||
    (typeof rec.status === "string" && rec.status !== "ok" && rec.status) ||
    (typeof rec.error === "string" && rec.error) ||
    `http-${httpStatus}`;
  return { ok: false, reason, message: typeof rec.message === "string" ? rec.message : undefined };
}
