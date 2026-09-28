/**
 * Path-safe pi-ai subpath derivation (design D5).
 *
 * `resolution.path` is NATIVE-separator (it comes from `path.join` /
 * `fileURLToPath`), so the `/\/dist\/index\.js$/` regex the registry used
 * silently no-ops on Windows — a supported OS with VM smoke coverage. This
 * module derives siblings with `path` operations only, asserts the expected
 * entry basename, and fails with the resolved path in the message rather than
 * returning something unusable.
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { basename, dirname, join, sep } from "node:path";

/** The entry file every supported pi-ai resolves to. */
export const PI_AI_ENTRY_BASENAME = "index.js";
/** The directory that entry file must sit in. */
export const PI_AI_DIST_DIRNAME = "dist";

/**
 * Return pi-ai's `dist/` directory given the resolved entry path.
 *
 * Accepts both POSIX and Windows separators: a Windows-style path handed to a
 * POSIX `node:path` (as a cross-platform unit test does) is normalized first,
 * so derivation is separator-agnostic rather than silently no-op.
 *
 * @throws when the path does not end in `dist/index.js`.
 */
export function piAiDistDir(resolvedPath: string): string {
  if (!resolvedPath) {
    throw new Error("pi-ai subpath derivation: no resolved module path was provided");
  }
  // Normalize foreign separators so a Windows path parses under POSIX `path`
  // and vice versa. Derivation must never depend on the host separator.
  const normalized = resolvedPath.replace(/[\\/]+/g, sep);
  const entry = basename(normalized);
  const dist = dirname(normalized);
  if (entry !== PI_AI_ENTRY_BASENAME || basename(dist) !== PI_AI_DIST_DIRNAME) {
    throw new Error(
      `pi-ai subpath derivation: expected the resolved module to end in ` +
        `${PI_AI_DIST_DIRNAME}${sep}${PI_AI_ENTRY_BASENAME}, got "${resolvedPath}"`,
    );
  }
  return dist;
}

/**
 * Derive an absolute path to a sibling under pi-ai's `dist/`.
 *
 * @param resolvedPath resolved pi-ai entry (`.../dist/index.js`)
 * @param relative slash-separated path relative to `dist/`, e.g. `api/lazy.js`
 */
export function derivePiAiSubpath(resolvedPath: string, relative: string): string {
  return join(piAiDistDir(resolvedPath), ...relative.split("/"));
}
