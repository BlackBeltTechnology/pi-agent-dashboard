/**
 * Literal-only derivation of a tool call's working directory (design D4 of rich-chat-links).
 *
 * Used by the client to tell the mention resolver where a relative path printed by a tool was
 * relative TO. Pure and dependency-free (runs in the browser): no `node:path`, no filesystem.
 *
 *  1. `base` = a string `cwd` or `workdir` argument, when present and non-empty.
 *  2. For `bash`, ONE leading literal `cd <dir> &&` (the dir is a bare or quoted word) resolves
 *     against `base`. Anything shell-dynamic — `$`, backticks, globs, backslashes, a leading `~`
 *     or `-`, `;`/`||` chaining, a second `cd`, subshells — is NOT parsed and falls back to `base`.
 *  3. Otherwise the result is `base` (or `undefined`).
 *
 * The result is an untrusted HINT: the server re-gates it with containment before any stat.
 * See change: rich-chat-links.
 */

/** A bare word (no whitespace, quotes, shell metacharacters or glob characters) or one quoted literal. */
const CD_RE = /^\s*cd\s+(?:"([^"$`*?[\]{}\\]*)"|'([^'$`*?[\]{}\\]*)'|([^\s"'&;|<>()$`*?[\]{}\\]+))\s*&&(.*)$/s;
const NEXT_CD_RE = /^\s*cd(?:\s|$)/;

function asNonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** Join `rel` onto `base` (POSIX), collapsing `.` and `..`; an absolute `rel` wins. */
function resolveAgainst(base: string | undefined, rel: string): string {
  if (rel.startsWith("/") || base === undefined) return rel;
  const abs = base.startsWith("/");
  const out: string[] = [];
  for (const seg of `${base}/${rel}`.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
      continue;
    }
    out.push(seg);
  }
  return (abs ? "/" : "") + out.join("/") || (abs ? "/" : ".");
}

export function toolWorkdir(toolName: string, args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const a = args as Record<string, unknown>;
  const base = asNonEmptyString(a.cwd) ?? asNonEmptyString(a.workdir);

  if (toolName !== "bash" || typeof a.command !== "string") return base;
  const m = CD_RE.exec(a.command);
  if (!m) return base;
  const dir = m[1] ?? m[2] ?? m[3] ?? "";
  if (dir === "" || dir.startsWith("~") || dir.startsWith("-") || NEXT_CD_RE.test(m[4])) return base;
  return resolveAgainst(base, dir);
}
