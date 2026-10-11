/**
 * Path confinement that survives symlinks. `resolve()` normalises spelling
 * only; `readFileSync` follows links, so a link inside the deck directory can
 * point at a file outside it. Every read of a user-named file under a deck
 * directory compares REAL paths.
 */
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

/** True when `file` exists and its real path lies inside the real path of `rootDir`. */
export function realInside(rootDir: string, file: string): boolean {
  if (!existsSync(file) || !existsSync(rootDir)) return false;
  const rel = relative(realpathSync(rootDir), realpathSync(file));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
