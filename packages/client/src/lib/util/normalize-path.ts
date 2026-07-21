/**
 * Client-side path normalization mirroring the server's
 * `session-diff.ts::normalizePath` rule (change:
 * fix-session-diff-open-nongit-and-preview).
 *
 * The session-diff endpoint keys `data.files` by relative-posix paths
 * (absolute-under-cwd → relative; absolute-outside-cwd → dropped; relative →
 * kept). Tool calls, however, may record an ABSOLUTE `args.path`, so a
 * change-summary row and its diff-open lookup can carry an absolute path that
 * never string-equals the relative `data.files` key → the diff blanks.
 *
 * `normalizeUnderCwd` rewrites an absolute-under-cwd path to relative-posix so
 * the client agrees with the server. Anything else (already relative, or
 * absolute-outside-cwd) is returned unchanged.
 */

/** Posix `/`, Windows `\`-rooted / UNC `\\server\share`, or `C:\` / `C:/` drive-absolute. */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * Absolute && under `cwd` → relative-posix; else unchanged.
 * Mirrors `session-diff.ts::normalizePath` (minus the outside-cwd drop — the
 * client keeps outside paths verbatim rather than nulling them).
 */
export function normalizeUnderCwd(rawPath: string, cwd: string | undefined): string {
  if (!rawPath || !cwd) return rawPath;
  if (!isAbsolutePath(rawPath)) return rawPath; // already relative — keep

  const posixRaw = rawPath.replace(/\\/g, "/");
  const posixCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (posixRaw === posixCwd) return ""; // the cwd itself

  const prefix = `${posixCwd}/`;
  if (posixRaw.startsWith(prefix)) return posixRaw.slice(prefix.length);

  return rawPath; // absolute outside cwd — unchanged
}

/**
 * True when `rawPath` is a file this session wrote OUTSIDE its `cwd`
 * (absolute AND not under cwd). After `normalizeUnderCwd`, an in-cwd path is
 * relative and an out-of-cwd path stays absolute, so residual absoluteness is
 * the out-of-cwd signal. Mirrors the server carrying out-of-cwd entries by
 * absolute key. See change: opt-in-out-of-cwd-session-diffs.
 */
export function isOutOfCwd(rawPath: string, cwd: string | undefined): boolean {
  return isAbsolutePath(normalizeUnderCwd(rawPath, cwd));
}
