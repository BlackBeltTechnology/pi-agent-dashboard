/**
 * Mirror of pi's path comparison (pi-coding-agent 1.5.0 `dist/utils/paths.js`
 * `getPathComparisonKey` / `pathsEqual`, used by `trust-manager.js` to match
 * `trust.json` keys): both paths are resolved, and on win32 compared
 * case-insensitively. No filesystem access — comparison only, never display.
 *
 * The path module is injectable so the win32 branch is testable on any host;
 * the default is read at call time (as pi's `getPlatformPathApi`).
 * See change: update-pi-core-1-5-adopt-apis (design D2).
 */
import path from "node:path";

/** `node:path`, `path.win32` or `path.posix` (all share this shape). */
export type PathApi = typeof path.posix;

/** `path.win32` on Windows, else `path.posix` — read at call time. */
export function nativePathApi(): PathApi {
  // Mirrors pi's getPlatformPathApi, read at call time so tests can simulate win32.
  return process.platform === "win32" ? path.win32 : path.posix; // platform-branch-ok: pi parity
}

/** pi's `getPathComparisonKey`: resolved, lower-cased on win32. */
export function piPathComparisonKey(p: string, pathApi: PathApi = nativePathApi()): string {
  const resolved = pathApi.resolve(p);
  return pathApi === path.win32 ? resolved.toLowerCase() : resolved;
}

/** pi's `pathsEqual`: both paths name the same location. */
export function piPathsEqual(a: string, b: string, pathApi: PathApi = nativePathApi()): boolean {
  return piPathComparisonKey(a, pathApi) === piPathComparisonKey(b, pathApi);
}
