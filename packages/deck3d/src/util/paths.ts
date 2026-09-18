/**
 * Package-root resolution, shared by every module that reads a file shipped
 * with the package (`dist/`, `assets/`, `src/` — template, schema, manifest).
 *
 * A bundled `dist/cli.js` makes `import.meta.url` point at `dist/`, not `src/`,
 * so the old `join(dirname(fileURLToPath(import.meta.url)), "..", "..")` trick
 * breaks once the CLI is bundled. Walk up from the caller's module URL until a
 * `package.json` appears instead: identical result when running unbundled from
 * `src/` under vitest, and correct from the installed bundle.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

/** Absolute package root — the directory holding this package's `package.json`. */
export function pkgRoot(): string {
  if (cached !== undefined) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "package.json"))) {
      cached = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Unreachable for a real install (the package.json is on this path);
      // keep it total rather than throwing inside a path helper.
      cached = process.cwd();
      return cached;
    }
    dir = parent;
  }
}
