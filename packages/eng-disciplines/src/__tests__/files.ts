/** Test helpers: eng-disciplines package paths, the reverse-spec-for-rebuild skill dir, and the guard runner. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO = resolve(PKG, "..", "..");
export const SKILL = join(PKG, ".pi", "skills", "reverse-spec-for-rebuild");
const GUARD = join(SKILL, "scripts", "guard.mjs");

export function read(path: string): string {
  return readFileSync(path, "utf8");
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run `node guard.mjs ...args` with `cwd` as the working directory. */
export function guard(cwd: string, ...args: string[]): RunResult {
  const r = spawnSync(process.execPath, [GUARD, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
