/**
 * Client-side path normalization matching server `session-diff.ts::normalizePath`.
 *
 * Absolute paths under the session cwd become relative-posix keys so
 * `DiffViewer` can find entries in `data.files` (always relative-to-cwd).
 * Already-relative paths and absolute-outside-cwd paths are left (normalized
 * separators only). See change: fix-session-diff-open-nongit-and-preview.
 */

/** True for POSIX absolute (`/…`) or Windows drive absolute (`C:/…`). */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

/** Collapse backslashes to forward slashes; strip trailing slash (except root). */
export function toPosix(p: string): string {
  const s = p.replace(/\\/g, "/");
  if (s.length > 1 && s.endsWith("/")) return s.replace(/\/+$/, "");
  return s;
}

/**
 * If `rawPath` is absolute and under `cwd`, return the relative-posix form.
 * Otherwise return the path with posix separators (relative unchanged).
 * Empty / missing cwd → posix-normalize only.
 */
export function normalizeUnderCwd(rawPath: string, cwd?: string | null): string {
  if (!rawPath) return rawPath;
  const raw = toPosix(rawPath);
  if (!cwd) return raw.replace(/^\.\//, "");

  const base = toPosix(cwd);
  if (!isAbsolutePath(raw)) {
    // Relative: strip leading ./ only
    return raw.replace(/^\.\//, "");
  }

  // Exact cwd match → "." (rare; no useful file key)
  if (pathsEqual(raw, base)) return ".";

  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (raw.startsWith(prefix)) {
    return raw.slice(prefix.length);
  }
  // Windows drive paths: case-insensitive prefix match, keep remainder casing
  if (/^[A-Za-z]:\//.test(raw) && /^[A-Za-z]:\//.test(base)) {
    const rawL = raw.toLowerCase();
    const prefL = prefix.toLowerCase();
    if (rawL.startsWith(prefL)) {
      return raw.slice(prefix.length);
    }
  }
  // Outside cwd — leave absolute (server would drop; client keeps for display)
  return raw;
}

function pathsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (/^[A-Za-z]:\//.test(a) && /^[A-Za-z]:\//.test(b)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return false;
}
