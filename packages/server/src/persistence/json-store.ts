/**
 * Atomic JSON file read/write helpers.
 * Uses write-to-tmp + rename pattern to prevent corruption on crash.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Read and parse a JSON file. Returns `fallback` if the file doesn't exist or is invalid.
 */
export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Atomically write a JSON file (write to .tmp, then rename).
 * Creates parent directories if needed.
 *
 * `opts.mode` (e.g. `0o600` for secret-bearing files): the `.tmp` file is
 * chmod'ed UNCONDITIONALLY before the rename: `writeFileSync`'s `mode` only
 * applies on create, so a stale `.tmp` left by a crash would keep its old mode.
 * See change: add-server-push-notifications (Decision 11).
 */
export function writeJsonFile<T>(filePath: string, data: T, opts?: { mode?: number }): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", opts?.mode !== undefined ? { mode: opts.mode } : undefined);
  if (opts?.mode !== undefined) fs.chmodSync(tmpPath, opts.mode);
  fs.renameSync(tmpPath, filePath);
}
