/**
 * `PI_DASHBOARD_GRANT_YOLO`: the environment activation of a YOLO session
 * (design D13; tasks 2b.8, 8b.6, 8b.6a).
 *
 * Syntax (decided with the operator, recorded in design D13 and the
 * `access-grant-yolo` spec):
 *
 *   /abs/path                 one root
 *   ["/abs/a","/abs/b"]       several roots, as a JSON array of strings
 *   unscoped                  the deliberate opt-out of scoping
 *
 * A JSON array is used for several roots because a path may itself contain any
 * single separator (`:` on POSIX, `;` on Windows), so no delimiter is safe. The
 * common single-root case stays a plain path. Every root must be ABSOLUTE.
 * Anything else, including `1`, `true`, a relative path, an empty array or
 * malformed JSON, is unparseable and leaves YOLO INACTIVE: never partially
 * applied, never unscoped by accident.
 *
 * This module only parses. Whether each root resolves and passes the forbidden
 * rule is the controller's job (8b.6a: any bad root keeps YOLO inactive).
 *
 * See change: add-access-grant-dialog.
 */
import path from "node:path";

export const YOLO_ENV = "PI_DASHBOARD_GRANT_YOLO";
export const YOLO_UNSCOPED = "unscoped";

export type YoloEnvValue =
  | { kind: "unset" }
  | { kind: "unscoped" }
  | { kind: "scoped"; roots: string[] }
  | { kind: "invalid"; reason: string };

const INVALID = 'expected an absolute path, a JSON array of absolute paths, or "unscoped"';

export function parseYoloEnv(raw: string | undefined): YoloEnvValue {
  if (raw === undefined || raw.trim() === "") return { kind: "unset" };
  const value = raw.trim();
  if (value === YOLO_UNSCOPED) return { kind: "unscoped" };

  if (value.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return { kind: "invalid", reason: `malformed JSON array; ${INVALID}` };
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { kind: "invalid", reason: `empty or non-array value; ${INVALID}` };
    }
    if (!parsed.every((r) => typeof r === "string" && r !== "" && path.isAbsolute(r))) {
      return { kind: "invalid", reason: `every root must be an absolute path; ${INVALID}` };
    }
    return { kind: "scoped", roots: [...new Set(parsed as string[])] };
  }

  if (path.isAbsolute(value)) return { kind: "scoped", roots: [value] };
  return { kind: "invalid", reason: INVALID };
}
