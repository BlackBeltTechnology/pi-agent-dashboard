/**
 * Session guard — constrain what a spawned pi session may do.
 *
 * change: constrain-agent-tool-surface.
 *
 * A guarded session runs with pi's built-in tools disabled (no bash/read/write/
 * edit/… — so nothing general-purpose can touch the filesystem) and, when a
 * folder policy is configured, a tool-call containment guard extension that
 * rejects any remaining (extension/custom) tool call whose path argument
 * resolves outside the allowed roots.
 *
 * The policy is INTENTIONALLY an open, growable shape: today it enforces
 * `noBuiltinTools` and carries `allowedRoots` for the folder guard; new
 * constraints (per-tool denials, arg predicates, network rules) are added as
 * fields here + a translation in `guardPolicyToSpawn` + enforcement in the
 * guard extension, without touching any spawn call site.
 *
 * Enforcement is keyed on **origin ∪ cwd**: a session is guarded when it is
 * invoice-bot-originated (the plugin marks its own spawns) OR runs in a working
 * directory registered as guarded (covers the client-spawned "Ask"/Kérdezz
 * session, which reaches the generic spawn path where origin is invisible).
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { samePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";

/**
 * What a guarded session is allowed to do. Open by design — add fields here as
 * new constraint kinds are introduced; unknown/unset fields mean "no extra
 * constraint of that kind".
 */
export interface SessionGuardPolicy {
  /** Disable pi's built-in tools (keeps extension/custom tools). Default true. */
  noBuiltinTools?: boolean;
  /**
   * Folders a tool call may reference. A path arg resolving outside every root
   * is blocked by the containment guard. Empty/undefined → defaults to the
   * session cwd at spawn time. (Enforced by the guard extension when set.)
   */
  allowedRoots?: string[];
  /**
   * Tool names the session may NOT call at all (in addition to built-ins being
   * removed). Reserved for future per-tool denials.
   */
  deniedTools?: string[];
}

/** The default policy applied to every invoice-bot-guarded session. */
export const DEFAULT_GUARD_POLICY: Readonly<SessionGuardPolicy> = Object.freeze({
  noBuiltinTools: true,
});

/** Absolute path to the tool-call containment guard extension (loaded via `-e`). */
export const GUARD_EXTENSION_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "session-guard-extension.ts",
);

/** How `spawnPiSession` should mark a spawn's origin guard. */
export type GuardOrigin = boolean | SessionGuardPolicy;

/** Registry of guarded working directories → their policy. */
const guardedDirs = new Map<string, SessionGuardPolicy>();

/** Canonicalize a cwd for stable registry keys. Case-folding is handled at
 *  lookup time via `samePath` (platform-correct), so keys stay display-form. */
function keyOf(cwd: string): string {
  return path.resolve(cwd);
}

/** Find the stored key that refers to the same directory as `cwd`, or null. */
function findKey(cwd: string): string | null {
  const target = keyOf(cwd);
  for (const k of guardedDirs.keys()) if (samePath(k, target)) return k;
  return null;
}

/** Register a working directory as guarded (optionally with a custom policy). */
export function registerGuardedDir(cwd: string, policy?: SessionGuardPolicy): void {
  const existing = findKey(cwd);
  guardedDirs.set(existing ?? keyOf(cwd), { ...DEFAULT_GUARD_POLICY, ...(policy ?? {}) });
}

/** Remove a guarded working directory (idempotent). */
export function unregisterGuardedDir(cwd: string): void {
  const k = findKey(cwd);
  if (k) guardedDirs.delete(k);
}

/** True when `cwd` is a registered guarded directory. */
export function isGuardedDir(cwd: string): boolean {
  return findKey(cwd) !== null;
}

/** Test/observability: snapshot of registered guarded dirs. */
export function guardedDirCount(): number {
  return guardedDirs.size;
}

/**
 * Resolve the effective policy for a spawn from origin ∪ cwd, or `null` when the
 * session is neither invoice-bot-originated nor in a guarded cwd (→ unrestricted).
 * When both apply, the origin policy overlays the cwd policy.
 */
export function resolveGuardForSpawn(input: { cwd: string; origin?: GuardOrigin }): SessionGuardPolicy | null {
  const cwdKey = findKey(input.cwd);
  const fromCwd = cwdKey ? guardedDirs.get(cwdKey) : undefined;
  const originOn = input.origin === true || (input.origin != null && typeof input.origin === "object");
  const fromOrigin = typeof input.origin === "object" ? input.origin : undefined;
  if (!fromCwd && !originOn) return null;
  return { ...DEFAULT_GUARD_POLICY, ...(fromCwd ?? {}), ...(fromOrigin ?? {}) };
}

/** Spawn flags derived from a guard policy: pi CLI flags + env for the guard ext. */
export interface GuardSpawnFlags {
  noBuiltinTools?: boolean;
  loadExtensions?: string[];
  env?: Record<string, string>;
}

/**
 * Translate a resolved policy into spawn flags. `--no-builtin-tools` removes the
 * general tool surface; when a folder policy is present, the containment guard
 * extension is loaded and told the allowed roots via env.
 */
export function guardPolicyToSpawn(policy: SessionGuardPolicy, cwd: string): GuardSpawnFlags {
  const flags: GuardSpawnFlags = {};
  if (policy.noBuiltinTools !== false) flags.noBuiltinTools = true;

  const roots = policy.allowedRoots && policy.allowedRoots.length > 0 ? policy.allowedRoots : [cwd];
  const needsGuard = (policy.allowedRoots && policy.allowedRoots.length > 0) || (policy.deniedTools?.length ?? 0) > 0;
  if (needsGuard) {
    flags.loadExtensions = [GUARD_EXTENSION_PATH];
    flags.env = {
      IB_GUARD_ALLOWED_ROOTS: roots.map((r) => path.resolve(r)).join(path.delimiter),
      ...(policy.deniedTools?.length ? { IB_GUARD_DENIED_TOOLS: policy.deniedTools.join(",") } : {}),
    };
  }
  return flags;
}

// ── Pure containment helpers (shared with the guard extension; unit-tested) ──

/**
 * Collect candidate path strings from an arbitrary tool-call input: any string
 * that looks like a path (absolute, or containing a separator). Recurses arrays
 * and objects. Used by the containment guard to find path arguments to check.
 */
export function collectPathCandidates(input: unknown, out: string[] = []): string[] {
  if (typeof input === "string") {
    if (path.isAbsolute(input) || input.includes("/") || input.includes("\\")) out.push(input);
  } else if (Array.isArray(input)) {
    for (const v of input) collectPathCandidates(v, out);
  } else if (input && typeof input === "object") {
    for (const v of Object.values(input as Record<string, unknown>)) collectPathCandidates(v, out);
  }
  return out;
}

/**
 * True when `candidate` (resolved against `cwd`, then realpath'd when it exists)
 * is one of `roots` or nested under one. Separator/drive-case normalized so it
 * holds on Windows — mirrors the file-read-containment compare.
 */
export function pathWithinRoots(candidate: string, roots: string[], cwd: string): boolean {
  const abs = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
  let real = path.resolve(abs);
  try {
    real = fs.realpathSync(abs);
  } catch {
    /* path may not exist yet — fall back to the resolved (non-real) path */
  }
  return roots.some((root) => {
    const r = path.resolve(root);
    // Walk `real` up to the filesystem root; a match at any level means `real`
    // is `r` or nested under it. `samePath` handles win32/darwin case-folding.
    let cur = real;
    for (;;) {
      if (samePath(cur, r)) return true;
      const parent = path.dirname(cur);
      if (parent === cur) return false;
      cur = parent;
    }
  });
}
