/**
 * TOFU (trust-on-first-use) store for worktree-init hooks.
 *
 * Running a project-declared hook executes repo-provided bash / spawns an
 * LLM from a UI click. Before the first run for a given checkout, the user
 * must confirm. Trust is keyed by `repoRoot + sha256(canonical(worktreeInit))`
 * (the hash component is `hookDefHash`), so editing the gate/command/prompt/
 * model re-prompts.
 *
 * Persisted as JSON under `~/.pi/dashboard/worktree-init-trust.json`.
 *
 * See change: generalize-worktree-init-hook.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

/** `repoRoot\u0000hash` → true. Absolute repoRoot is realpath-stable upstream. */
type TrustMap = Record<string, true>;

function storePath(): string {
  return path.join(getDashboardConfigDir(), "worktree-init-trust.json");
}

function trustKey(repoRoot: string, hash: string): string {
  return `${path.resolve(repoRoot)}\u0000${hash}`;
}

function load(): TrustMap {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as TrustMap;
  } catch { /* missing / malformed → empty */ }
  return {};
}

function save(map: TrustMap): void {
  const p = storePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(map, null, 2), "utf8");
  } catch (err) {
    console.warn(`[worktree-init-trust] failed to persist: ${(err as Error)?.message}`);
  }
}

/** True iff trust was recorded for this `repoRoot + hash`. */
export function isTrusted(repoRoot: string, hash: string): boolean {
  return load()[trustKey(repoRoot, hash)] === true;
}

/** Record trust for this `repoRoot + hash`. Idempotent. */
export function recordTrust(repoRoot: string, hash: string): void {
  const map = load();
  map[trustKey(repoRoot, hash)] = true;
  save(map);
}
