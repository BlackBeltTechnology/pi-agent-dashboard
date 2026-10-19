/**
 * The shim source the post-install hook ships into every build, and its version.
 * `src/shim/craft-shim.js` declares `const SHIM_VERSION = <n>;` on its own line (column 0); the server
 * reads that literal so a shim change can never be missed by a second constant.
 *
 * See change: edit-office-in-pane-with-craft-web (D2, D4).
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** Absolute path of the packaged shim (`src/shim/craft-shim.js`). */
export const SHIM_SOURCE_PATH = fileURLToPath(new URL("../shim/craft-shim.js", import.meta.url));

const VERSION_RE = /^const SHIM_VERSION = (\d+);/m;

/** Parse the `SHIM_VERSION` literal of a shim source; throws when absent or not a positive integer. */
export function parseShimVersion(source: string): number {
  const m = VERSION_RE.exec(source);
  const n = m ? Number(m[1]) : Number.NaN;
  if (!Number.isInteger(n) || n < 1) throw new Error("craft-shim.js declares no `const SHIM_VERSION = <n>;`");
  return n;
}

/** Version of the shim at `file` (re-read when its mtime changes). */
export function createShimVersionReader(file: string = SHIM_SOURCE_PATH): () => number {
  let cached: { mtimeMs: number; version: number } | undefined;
  return () => {
    const mtimeMs = fs.statSync(file).mtimeMs;
    if (!cached || cached.mtimeMs !== mtimeMs) cached = { mtimeMs, version: parseShimVersion(fs.readFileSync(file, "utf8")) };
    return cached.version;
  };
}
