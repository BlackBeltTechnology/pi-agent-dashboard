/**
 * TOFU (trust-on-first-use) store for worktree-init hooks.
 *
 * Running a project-declared hook executes repo-provided bash / spawns an
 * LLM from a UI click. Before the first run for a given checkout, the user
 * must confirm. Trust is keyed by `repoRoot + sha256(canonical(worktreeInit))`
 * (the hash component is `hookDefHash`), so editing the gate/command/prompt/
 * model re-prompts.
 *
 * Trust has two scopes:
 *   - `project` — persisted as JSON under `~/.pi/dashboard/worktree-init-trust.json`
 *     (today's behavior, survives restart).
 *   - `session` — held in a module-level in-memory Set, never written to disk,
 *     gone on server restart/deploy. Honest lifetime: "until the dashboard
 *     server restarts".
 * `isTrusted` is satisfied by EITHER store (OR-combine). Both key entries via
 * the identical `trustKey` (`path.resolve`-based) so `./repo` and `/abs/repo`
 * never diverge across the split.
 *
 * See change: generalize-worktree-init-hook, add-session-scoped-init-trust.
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

/** Trust scope. `session` = memory-only; `project` = persisted JSON store. */
export type TrustScope = "session" | "project";

/**
 * In-memory session trust keys (scope `session`). Process-global, per D5:
 * a grant from any client is visible to all until the server restarts. Keyed
 * via `trustKey`, identical to the persisted store (D3a).
 */
const sessionTrust = new Set<string>();

/** Test seam: reset the in-memory session set (simulates a fresh process). */
export function __resetSessionTrust(): void {
  sessionTrust.clear();
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

/**
 * True iff trust was recorded for this `repoRoot + hash` in EITHER the in-memory
 * session set OR the persisted project store (OR-combine).
 */
export function isTrusted(repoRoot: string, hash: string): boolean {
  const key = trustKey(repoRoot, hash);
  return sessionTrust.has(key) || load()[key] === true;
}

/**
 * Record trust for this `repoRoot + hash`. Idempotent.
 *
 * `scope` defaults to `project` (backward compatible — every existing caller
 * and any omitted-field request preserves today's persistent behavior). A
 * `session` grant adds to the in-memory set and never writes disk.
 */
export function recordTrust(repoRoot: string, hash: string, scope: TrustScope = "project"): void {
  const key = trustKey(repoRoot, hash);
  if (scope === "session") {
    sessionTrust.add(key);
    return;
  }
  const map = load();
  map[key] = true;
  save(map);
}
