/**
 * `canvas()` declare-tool normalization (Decision 5).
 *
 * The model-facing tool input is a CONVENIENCE shape; the real `ViewTarget`
 * (which requires a `cwd` the model must never supply) is produced here,
 * server-side, from the session cwd. A `{kind:"server"}` target does NOT become
 * a `ViewTarget` — it routes to the Decision-4 chip path carrying ONLY a port
 * (the announced host is dropped, so the dashboard can never be tricked into
 * trusting it — it always probes `127.0.0.1:port`).
 *
 * Two entry points share the reject rules:
 *   - `validateCanvasDeclareShape(input)` — cwd-free; the bridge tool's `execute`
 *     uses it to return an honest `{ok:false,error}` ack for a bad shape /
 *     traversal path, WITHOUT needing the session cwd.
 *   - `normalizeCanvasDeclare(input, cwd)` — server-side; anchors the cwd and
 *     yields a DECLARE `CanvasCandidate` or a `ServerChip`.
 *
 * See change: auto-canvas.
 */

import type { CanvasCandidate } from "./canvas-detect.js";
import { type RendererKind, rendererKindForPath } from "./renderer-by-ext.js";
import type { ViewTarget } from "./types.js";

export type CanvasMode = "replace" | "pin" | "section";

export type CanvasDeclareTarget =
  | { kind: "file"; path: string }
  | { kind: "url"; url: string }
  | { kind: "server"; port: number };

export interface CanvasDeclareInput {
  target: CanvasDeclareTarget;
  mode?: CanvasMode;
  title?: string;
  /** mode:"section" only — reserved, v2 no-op. */
  section?: string;
}

/** Chip descriptor for a declared server. Carries ONLY the port — never a host. */
export interface ServerChip {
  kind: "server";
  port: number;
  title?: string;
}

export type CanvasDeclareResult =
  | { ok: true; candidate: CanvasCandidate; mode: CanvasMode; title?: string }
  | { ok: true; chip: ServerChip }
  | { ok: false; error: string };

/** True when a path is absolute or contains a `..` traversal segment. */
function isUnsafePath(p: string): boolean {
  if (p.length === 0) return true;
  if (p.startsWith("/") || p.startsWith("\\")) return true; // POSIX / UNC absolute
  if (/^[A-Za-z]:[\\/]/.test(p)) return true; // Windows drive absolute
  return p.split(/[\\/]/).some((seg) => seg === "..");
}

function isValidPort(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 65535;
}

/**
 * Cwd-free validation for the bridge tool's ack. Returns an error string when
 * the shape is malformed or the path is a traversal/absolute path; otherwise
 * `null` (the server will finish normalization with the real cwd).
 */
export function validateCanvasDeclareShape(
  input: CanvasDeclareInput | undefined,
): string | null {
  const target = input?.target;
  if (!target || typeof target !== "object") return "canvas: missing target";
  if (target.kind === "file") {
    if (typeof target.path !== "string" || target.path.length === 0)
      return "canvas: file target needs a path";
    if (isUnsafePath(target.path))
      return "canvas: path must be relative to the session cwd (no absolute or `..`)";
    return null;
  }
  if (target.kind === "url") {
    if (typeof target.url !== "string" || target.url.length === 0)
      return "canvas: url target needs a url";
    try {
      new URL(target.url);
    } catch {
      return "canvas: url target must be a valid URL";
    }
    return null;
  }
  if (target.kind === "server") {
    if (!isValidPort(target.port)) return "canvas: server target needs a valid port (1–65535)";
    return null;
  }
  return "canvas: unknown target kind";
}

/**
 * Server-side normalization. `cwd` comes from server session state, NEVER the
 * model. A file target is anchored to it (anti-traversal preserved); a url
 * passes through; a server routes to a chip carrying only the port.
 */
export function normalizeCanvasDeclare(
  input: CanvasDeclareInput | undefined,
  cwd: string,
): CanvasDeclareResult {
  const shapeError = validateCanvasDeclareShape(input);
  if (shapeError) return { ok: false, error: shapeError };
  // Non-null after successful validation.
  const { target, mode = "replace", title } = input as CanvasDeclareInput;

  if (target.kind === "server") {
    // NOTE: the announced host (if any) is intentionally dropped here.
    return { ok: true, chip: { kind: "server", port: target.port, title } };
  }

  let viewTarget: ViewTarget;
  let kind: RendererKind;
  if (target.kind === "file") {
    viewTarget = { kind: "file", cwd, path: target.path };
    kind = rendererKindForPath(target.path);
  } else {
    viewTarget = { kind: "url", url: target.url };
    kind = rendererKindForPath(target.url);
  }
  return {
    ok: true,
    candidate: { prio: "DECLARE", target: viewTarget, kind },
    mode,
    title,
  };
}
