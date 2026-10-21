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

/**
 * Notified after the persisted store is written. Feeds the pi-trust mirror
 * snapshot; set once by the server. See change: mirror-dashboard-trust-to-pi.
 */
let trustChanged: (() => void) | undefined;
export function setTrustChangedListener(fn: (() => void) | undefined): void {
  trustChanged = fn;
}

/**
 * Notified SYNCHRONOUSLY when the in-memory session set changes (record / revoke
 * of a `session` entry). Separate from {@link setTrustChangedListener}: that one
 * fires only after a persisted write, and a session entry must never reach disk.
 * Feeds the pi-trust live count. See change: mirror-dashboard-trust-live-remote.
 */
let sessionTrustChanged: (() => void) | undefined;
export function setSessionTrustChangedListener(fn: (() => void) | undefined): void {
  sessionTrustChanged = fn;
}
function notifySessionTrustChanged(): void {
  try {
    sessionTrustChanged?.();
  } catch {
    /* a listener never fails a grant */
  }
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

/**
 * Persist the map. Default: a write failure is warned and swallowed (legacy
 * behaviour — a grant must not crash a route). `strict` rethrows so a caller that
 * reports success to the operator (revoking dashboard trust that is mirrored into
 * pi) can report the failure instead. See change: mirror-dashboard-trust-to-pi.
 */
function save(map: TrustMap, strict = false): void {
  const p = storePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(map, null, 2), "utf8");
    try {
      trustChanged?.();
    } catch {
      /* a listener never fails a grant */
    }
  } catch (err) {
    if (strict) throw err;
    console.warn(`[worktree-init-trust] failed to persist: ${(err as Error)?.message}`);
  }
}

/**
 * The PERSISTED (project-scope) entries as `{ repoRoot, hash }` — never the
 * in-memory session set (server-lifetime trust does not count toward the pi
 * mirror). Keys are `path.resolve`d; the mirror translates them to pi's key form.
 * See change: mirror-dashboard-trust-to-pi.
 */
export function listPersistedTrust(): Array<{ repoRoot: string; hash: string }> {
  const out: Array<{ repoRoot: string; hash: string }> = [];
  for (const [key, value] of Object.entries(load())) {
    if (value !== true) continue;
    const i = key.indexOf("\u0000");
    if (i <= 0) continue;
    out.push({ repoRoot: key.slice(0, i), hash: key.slice(i + 1) });
  }
  return out;
}

/**
 * The IN-MEMORY session entries as `{ repoRoot, hash }` ("until the dashboard
 * restarts"). Live pi-trust source only: never persisted, never in the snapshot.
 * Keys are `path.resolve`d; the live provider translates them to pi's key form.
 * See change: mirror-dashboard-trust-live-remote.
 */
export function listSessionTrust(): Array<{ repoRoot: string; hash: string }> {
  const out: Array<{ repoRoot: string; hash: string }> = [];
  for (const key of sessionTrust) {
    const i = key.indexOf("\u0000");
    if (i <= 0) continue;
    out.push({ repoRoot: key.slice(0, i), hash: key.slice(i + 1) });
  }
  return out;
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
export function recordTrust(
  repoRoot: string,
  hash: string,
  scope: TrustScope = "project",
  opts: { strict?: boolean } = {},
): void {
  const key = trustKey(repoRoot, hash);
  if (scope === "session") {
    sessionTrust.add(key);
    notifySessionTrustChanged();
    return;
  }
  const map = load();
  map[key] = true;
  save(map, opts.strict === true);
}

/**
 * Revoke trust for this `repoRoot + hash` from BOTH stores. Idempotent.
 *
 * A subject may hold session trust, project trust, or both; revoke clears the
 * in-memory session entry (so the grant dies without a process restart) AND
 * deletes the persisted project entry. A key absent from both is a no-op and
 * leaves the store file untouched.
 * See change: add-access-grants-and-review (task 6.1).
 */
/**
 * Revoke one recorded fingerprint, or — when `hash` is omitted or empty — EVERY
 * fingerprint recorded for `repoRoot`.
 *
 * The all-fingerprints form is what the Access tab calls: the aggregate drops
 * hashes, so the tab lists one row per REPO and cannot name one. Deleting only
 * the literal `repoRoot\0` key matched nothing, which made the tab's revoke a
 * silent no-op that still returned `{success:true}` while `isTrusted` stayed
 * true — the button appeared to work and revoked nothing (found by the task 8.7
 * review; the route comment already claimed this semantics, unimplemented).
 */
export function revokeTrust(repoRoot: string, hash?: string, opts: { strict?: boolean } = {}): void {
  const matches = (key: string): boolean =>
    hash ? key === trustKey(repoRoot, hash) : key.startsWith(trustKey(repoRoot, ""));

  let sessionRemoved = false;
  for (const key of [...sessionTrust]) {
    if (matches(key)) {
      sessionTrust.delete(key);
      sessionRemoved = true;
    }
  }
  if (sessionRemoved) notifySessionTrustChanged();

  const map = load();
  let changed = false;
  for (const key of Object.keys(map)) {
    if (matches(key)) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) save(map, opts.strict === true);
}
