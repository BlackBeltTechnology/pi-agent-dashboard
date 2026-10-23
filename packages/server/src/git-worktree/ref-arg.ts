/**
 * Validator for caller-supplied git arguments (refs, commit-ishes, new branch names, base hints,
 * worktree paths). A PRESENT value must be a non-empty string that does not begin with `-` and
 * contains no C0 control character (0x00–0x1F) or DEL (0x7F); otherwise it could be parsed by git
 * as an option (`--upload-pack=…`, `--orphan=…`) or smuggle a line break.
 *
 * The validator IS the control — no `--end-of-options`. Precedent: `packages/kb/src/sources.ts`.
 *
 * See change: harden-git-terminal-plugin-boundaries (B1r).
 */

/** Stable error `code` carried by `InvalidRefError` and the HTTP 400 body. */
export const INVALID_REF_CODE = "invalid_ref";

export class InvalidRefError extends Error {
  readonly code = INVALID_REF_CODE;
  constructor(message = "invalid git ref") {
    super(message);
    this.name = "InvalidRefError";
  }
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** True iff `v` is a string safe to hand to git as a positional ref/path argument. */
export function isValidRefArg(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.charCodeAt(0) !== 0x2d && !CONTROL_CHARS.test(v);
}

/** Returns `v` when valid, else throws `InvalidRefError`. */
export function assertRefArg(v: unknown, label = "ref"): string {
  if (!isValidRefArg(v)) throw new InvalidRefError(`invalid ${label}`);
  return v;
}

/** A required field that is absent, `null` or `""` (the endpoint's existing "missing parameter" case). */
export function isMissingArg(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}
