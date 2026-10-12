/**
 * Portable project-name rules for `POST /api/browse/create-project`.
 *
 * A project name is ONE path segment that is valid on every supported platform:
 * non-empty; no leading/trailing whitespace; not `.`/`..`; no trailing `.`; none of
 * `/ \ : * ? " < > |`; no control character (C0, DEL, C1); not a Windows device
 * name (`CON PRN AUX NUL CONIN$ CONOUT$ COM0-9 LPT0-9`, superscript digits too,
 * case-insensitive, with or without an extension); at most 255 UTF-8 bytes.
 *
 * `isPortableProjectName` is the boolean guard the server branches on before it
 * joins the name onto the projects root. It is modelled as a CodeQL
 * `js/path-injection` barrier guard in `.github/codeql/extensions/cwd-guard.model.yml`
 * — keep its name, module path and `Argument[0]` shape stable.
 *
 * See change: streamline-first-run (design D4).
 */

export type ProjectNameProblem = "invalid_name" | "reserved_name" | "too_long";

export const MAX_PROJECT_NAME_BYTES = 255;

// C0 + DEL + C1 control characters.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
const FORBIDDEN_CHARS = /[/\\:*?"<>|]/;
// Matched on the basename up to the first dot, so `aux.txt` is reserved like `aux`.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00B9\u00B2\u00B3]|lpt[0-9\u00B9\u00B2\u00B3])$/i;

/** Why `name` is not a portable project name, or `null` when it is. */
export function projectNameProblem(name: unknown): ProjectNameProblem | null {
  if (typeof name !== "string" || name.length === 0) return "invalid_name";
  if (name !== name.trim() || name === "." || name === "..") return "invalid_name";
  if (CONTROL_CHARS.test(name) || FORBIDDEN_CHARS.test(name) || name.endsWith(".")) return "invalid_name";
  if (WINDOWS_RESERVED.test(name.split(".")[0].trimEnd())) return "reserved_name";
  if (new TextEncoder().encode(name).length > MAX_PROJECT_NAME_BYTES) return "too_long";
  return null;
}

/** Boolean guard: true only for a single, portable path segment. */
export function isPortableProjectName(name: unknown): name is string {
  return projectNameProblem(name) === null;
}
