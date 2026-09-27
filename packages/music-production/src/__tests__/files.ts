/** Test helpers: package paths and a recursive text-file walk (skips caches and venvs). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO = resolve(PKG, "..", "..");
const SKILLS = join(PKG, ".pi", "skills");

const SKIP = new Set(["__pycache__", "node_modules", ".pytest_cache"]);

export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith(".venv")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function read(path: string): string {
  return readFileSync(path, "utf8");
}

export function skill(name: string): string {
  return read(join(SKILLS, name, "SKILL.md"));
}
