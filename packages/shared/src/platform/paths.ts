/**
 * OS-aware filesystem path primitives.
 *
 * The dashboard uses paths in three places that need OS-correct behaviour:
 *   1. Pin/unpin directory storage (server-side).
 *   2. Session grouping — matching a session's `cwd` against pinned entries.
 *   3. Path picker UI — parsing user-typed input.
 *
 * This module is the single source of truth. All exported helpers that
 * depend on OS conventions take a trailing `platform: NodeJS.Platform`
 * parameter defaulting to `process.platform` — tests pass it explicitly
 * to exercise both Windows and Unix branches without mutating
 * `process.platform`.
 *
 * ISOMORPHIC: implemented with string operations only (no `node:path`)
 * so the module loads in the browser. The client imports `normalizePath`
 * and `parsePathInput` directly; using `node:path` would have forced
 * Vite to externalize the import and crash the SPA at load time.
 *
 * Windows specifics:
 *   - Each drive letter (A:, B:, …, Z:) is a distinct filesystem root.
 *     `samePath` NEVER merges different drives.
 *   - Drive letters are case-insensitive (`B:\` == `b:\`).
 *   - Path components are case-insensitive on NTFS (default) and HFS+.
 *   - UNC paths (`\\server\share`) are distinct from drive-letter paths.
 *   - Bare drive-relative input (`B:`, `B:Dev`) is defensively treated
 *     as drive-root-plus-partial, NOT as the B-drive's current directory
 *     (which is cwd-dependent and useless in a pin dialog).
 *
 * See change: platform-path-normalization.
 */

// ── Helpers ────────────────────────────────────────────────────────────────

/** True if input is a Windows drive-letter form (`B:`, `B:Dev`) without separator. */
function isDriveLetterForm(value: string): boolean {
  return /^[A-Za-z]:(?![\\/])/.test(value);
}

/** Extract the `B:` prefix from `B:Dev`, else null. */
function driveLetterPrefix(value: string): string | null {
  const m = value.match(/^([A-Za-z]:)(?![\\/])/);
  return m ? m[1] : null;
}

/** Detect the root portion of a path. Returns "" when no root. */
function getRoot(p: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    // UNC: \\server\share  (captures up to the share name, no trailing sep)
    const unc = p.match(/^(?:\\\\|\/\/)([^\\/]+)[\\/]([^\\/]+)(?:[\\/]|$)/);
    if (unc) return `\\\\${unc[1]}\\${unc[2]}\\`;
    // Drive root: "C:\" or "C:/"
    const drive = p.match(/^([A-Za-z]:)[\\/]/);
    if (drive) return `${drive[1]}\\`;
    return "";
  }
  // POSIX
  return p.startsWith("/") ? "/" : "";
}

/**
 * Split a path into segments, collapsing `.` and `..`. Operates on a
 * rootless remainder; caller is responsible for re-prepending the root.
 */
function normalizeSegments(rest: string, sep: string): string[] {
  const split = rest.split(/[\\/]+/).filter((s) => s.length > 0);
  const out: string[] = [];
  for (const seg of split) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      // Rootless `..` that can't be resolved stays (we only call this with
      // rootful paths via getRoot, so this arm is mostly defensive).
      continue;
    }
    out.push(seg);
  }
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Canonicalize a path to the OS-native form:
 *   - Separators match the OS (`\\` on win32, `/` elsewhere).
 *   - Redundant separators collapsed.
 *   - `.` and `..` segments resolved.
 *   - Trailing separator removed EXCEPT for roots.
 *   - Original case preserved (NO lowercasing).
 *
 * Windows subtleties:
 *   - Bare drive-letter input (`B:`, `B:Dev`) is treated defensively as
 *     drive-rooted (`B:\` / `B:\Dev`), NOT as cwd-relative on that drive
 *     (which would be useless for a pin dialog — the dashboard's
 *     `process.cwd()` has no relationship to what the user typed).
 *   - UNC paths are preserved as-is (with the `\\server\share\` root).
 */
export function normalizePath(
  p: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!p) return p;

  if (platform === "win32") {
    // Handle drive-relative forms defensively.
    if (isDriveLetterForm(p)) {
      const prefix = driveLetterPrefix(p)!; // "B:"
      const rest = p.slice(prefix.length);
      if (!rest) return prefix + "\\"; // bare "B:" → "B:\\"
      // "B:Dev" → normalize as if it were "B:\\Dev"
      return normalizePath(prefix + "\\" + rest, "win32");
    }

    const root = getRoot(p, "win32");
    if (root) {
      const rest = p.slice(root.length);
      const segments = normalizeSegments(rest, "\\");
      if (segments.length === 0) return root;
      // Drive root: "C:\" → segments joined with \ after root (no extra sep).
      // UNC root: "\\server\share\" → same pattern.
      return root + segments.join("\\");
    }
    // No root detected — relative path. Normalize separators + segments,
    // leave without a leading root.
    const segments = normalizeSegments(p, "\\");
    return segments.join("\\");
  }

  // POSIX
  const root = getRoot(p, platform);
  if (root) {
    const segments = normalizeSegments(p.slice(root.length), "/");
    if (segments.length === 0) return root;
    return root + segments.join("/");
  }
  const segments = normalizeSegments(p, "/");
  return segments.join("/");
}

/**
 * Filesystem-level equality.
 *   - win32/darwin: case-insensitive (Windows NTFS + macOS HFS+ defaults).
 *   - linux: case-sensitive.
 *
 * Runs both inputs through `normalizePath` first so separator and
 * trailing-separator drift is tolerated uniformly. Cross-drive safety
 * on Windows is automatic — the drive letter is preserved and compared.
 */
export function samePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!a || !b) return a === b;
  const na = normalizePath(a, platform);
  const nb = normalizePath(b, platform);
  if (platform === "linux") return na === nb;
  return na.toLowerCase() === nb.toLowerCase();
}

/**
 * Parse user-typed path input into `{ parent, partial }`:
 *   - `parent` is the directory to browse.
 *   - `partial` is the in-progress filter / typed segment after `parent`.
 *
 * Handles Windows drive-letter roots, UNC roots, Unix roots, mixed
 * separators, and trailing separators.
 */
export function parsePathInput(
  value: string,
  platform: NodeJS.Platform = process.platform,
): { parent: string; partial: string } {
  if (!value) return { parent: platform === "win32" ? "" : "/", partial: "" };

  if (platform === "win32") {
    // Bare drive letter "B:" → drive root.
    if (/^[A-Za-z]:$/.test(value)) {
      return { parent: value[0] + ":\\", partial: "" };
    }
    // Drive-relative "B:Dev" → drive root + partial.
    if (isDriveLetterForm(value)) {
      const prefix = driveLetterPrefix(value)!;
      return { parent: prefix + "\\", partial: value.slice(prefix.length) };
    }

    const lastBackslash = value.lastIndexOf("\\");
    const lastForward = value.lastIndexOf("/");
    const lastSep = Math.max(lastBackslash, lastForward);

    if (lastSep < 0) {
      // No separator — treat whole input as partial.
      return { parent: "", partial: value };
    }

    if (lastSep === value.length - 1) {
      // Ends with separator.
      const parent = value.slice(0, lastSep);
      if (/^[A-Za-z]:$/.test(parent)) return { parent: parent + "\\", partial: "" };
      return { parent: normalizePath(parent, "win32"), partial: "" };
    }

    const parent = value.slice(0, lastSep);
    const partial = value.slice(lastSep + 1);
    const normalizedParent = /^[A-Za-z]:$/.test(parent)
      ? parent + "\\"
      : normalizePath(parent, "win32");
    return { parent: normalizedParent, partial };
  }

  // POSIX
  if (value === "/") return { parent: "/", partial: "" };
  if (value.endsWith("/")) {
    const parent = value.slice(0, -1) || "/";
    return { parent, partial: "" };
  }
  const lastSep = value.lastIndexOf("/");
  if (lastSep < 0) return { parent: "/", partial: value };
  const parent = value.slice(0, lastSep) || "/";
  const partial = value.slice(lastSep + 1);
  return { parent, partial };
}

/** Append the OS-native separator to a path if not already terminated. */
export function withTrailingSep(
  p: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!p) return p;
  const sep = platform === "win32" ? "\\" : "/";
  if (p.endsWith("\\") || p.endsWith("/")) return p;
  return p + sep;
}

/** Join two path segments with the OS-native separator. */
export function joinForDisplay(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!parent) return child;
  if (!child) return parent;
  const sep = platform === "win32" ? "\\" : "/";
  const parentTrimmed = parent.replace(/[\\/]+$/, "");
  const childTrimmed = child.replace(/^[\\/]+/, "");
  // Preserve root's trailing sep — `C:\` + `Users` → `C:\Users`, not `C:Users`.
  if (platform === "win32" && /^[A-Za-z]:$/.test(parentTrimmed)) {
    return parentTrimmed + "\\" + childTrimmed;
  }
  if (parentTrimmed === "") return sep + childTrimmed; // POSIX root case
  return parentTrimmed + sep + childTrimmed;
}

/**
 * True iff `resolved` is a filesystem root on `platform`. Used by
 * server-side `browse.ts` to compute `parent = null` uniformly
 * (replacing the Unix-only `resolved === "/"` check).
 */
export function isFilesystemRoot(
  resolved: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!resolved) return false;
  if (platform === "win32") {
    // Drive-letter root: "C:\" (also accept forward slash form)
    if (/^[A-Za-z]:[\\/]$/.test(resolved)) return true;
    // UNC root: "\\server\share" with optional trailing sep
    if (/^\\\\[^\\]+\\[^\\]+\\?$/.test(resolved)) return true;
    // Bare separator as "current drive root" — Node's path.dirname("/")
    // returns "/" even on Windows, and listDirectories("/") is a valid
    // call for "root of the current drive". Treat it as a root so the
    // picker doesn't show a useless `..` entry.
    if (resolved === "/" || resolved === "\\") return true;
    return false;
  }
  return resolved === "/";
}
