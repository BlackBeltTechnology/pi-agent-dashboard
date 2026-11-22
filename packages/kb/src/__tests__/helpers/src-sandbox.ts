// Sandbox copy of the real kb package `src/` (minus __tests__) for the engine-fingerprint /
// closure / gate tests (change: throttle-kb-reindex, D1). Edits land in the copy, never in
// the working tree.
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const KB_PKG = fileURLToPath(new URL("../../../", import.meta.url));
export const KB_SRC = join(KB_PKG, "src");

/** Copies the real `src/` into `<dest>/src` and returns `dest` (a fresh package root). */
export function copyKbSrc(dest: string): string {
  mkdirSync(dest, { recursive: true });
  cpSync(KB_SRC, join(dest, "src"), { recursive: true, filter: (p) => !p.split(/[\\/]/).includes("__tests__") });
  return dest;
}
