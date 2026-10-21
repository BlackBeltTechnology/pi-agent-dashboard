/**
 * Snapshot + trust-store readers and the snapshot coverage check, shared by the
 * bridge (`project_trust` handler — no server contact) and the server's
 * `host.isProjectTrusted`, so both decide from the SAME bytes with the SAME rules.
 *
 * Everything here is read-only and non-throwing: any doubt yields "no coverage"
 * or a reason code, never a throw and never trust. Nothing is cached across
 * calls (bridge-decomposition rule: no module-level caches).
 *
 * See change: mirror-dashboard-trust-to-pi.
 */
import * as fs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "./dashboard-paths.js";
import {
  ancestorKeys,
  identityMatches,
  isCanonicalAbsolutePath,
  piTrustKey,
  statFolderIdentity,
} from "./pi-trust-mirror.js";
import type { MirrorWithheldReason, PiTrustSnapshot, PiTrustSnapshotEntry } from "./pi-trust-mirror-types.js";
import { hasProjectRootMarker } from "./project-root.js";
import { hookDefHash, normalizeHook } from "./worktree-init-hook.js";

/** `~/.pi/dashboard/pi-trust-mirror.json` — server-written, bridge-read. */
export function piTrustMirrorSnapshotPath(): string {
  return path.join(getDashboardConfigDir(), "pi-trust-mirror.json");
}

/** `~/.pi/dashboard/pi-trust-overrides.json` — per-entry "also trust in pi" choices. */
export function piTrustOverridesPath(): string {
  return path.join(getDashboardConfigDir(), "pi-trust-overrides.json");
}

const SOURCE_KINDS = new Set(["worktreeInit", "workflow", "pinned", "folderWorkspaces", "accessGrants"]);

function validEntry(e: unknown): e is PiTrustSnapshotEntry {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.key === "string" &&
    path.isAbsolute(x.key) &&
    typeof x.sourceKind === "string" &&
    SOURCE_KINDS.has(x.sourceKind) &&
    typeof x.dev === "string" &&
    typeof x.ino === "string" &&
    (x.birthtimeMs === undefined || typeof x.birthtimeMs === "number") &&
    (x.configRoot === undefined || typeof x.configRoot === "string") &&
    (x.hookHash === undefined || typeof x.hookHash === "string")
  );
}

/** The snapshot, or `null` when absent, truncated, or not the expected shape. */
export function readPiTrustMirrorSnapshot(file: string = piTrustMirrorSnapshotPath()): PiTrustSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (p.version !== 1 || typeof p.generation !== "number" || !Array.isArray(p.entries)) return null;
    const live = p.liveCount;
    const liveCount = typeof live === "number" && Number.isInteger(live) && live >= 0 ? live : 0;
    return { version: 1, generation: p.generation, entries: p.entries.filter(validEntry), liveCount };
  } catch {
    return null;
  }
}

export type PiTrustFileRead =
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "ok"; data: Record<string, boolean> };

/**
 * pi's `trust.json` read WITHOUT its lock, with pi's own rules: a leading BOM is
 * stripped, `null` values are absent, an absent file means nothing recorded, and
 * any read/parse/shape failure (or a value other than true/false/null) is
 * `unreadable`. Best-effort at read time — pi re-reads under its lock later.
 */
export function readPiTrustFileLockless(agentDir: string): PiTrustFileRead {
  const file = path.join(agentDir, "trust.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable" };
  }
  try {
    const parsed: unknown = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { kind: "unreadable" };
    const data: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === null) continue;
      if (v !== true && v !== false) return { kind: "unreadable" };
      data[k] = v;
    }
    return { kind: "ok", data };
  } catch {
    return { kind: "unreadable" };
  }
}

/** pi's nearest recorded entry for `cwdKey` (walks `cwdKey` then its ancestors). */
export function nearestRecordedEntry(
  data: Record<string, boolean>,
  cwdKey: string,
): { path: string; decision: boolean } | null {
  for (const k of ancestorKeys(cwdKey)) {
    const v = data[k];
    if (v === true || v === false) return { path: k, decision: v };
  }
  return null;
}

/** Hash of the `worktreeInit` hook currently in `<configRoot>/.pi/settings.json`, or null. */
export function currentHookHash(configRoot: string): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(configRoot, ".pi", "settings.json"), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const hook = normalizeHook((parsed as { worktreeInit?: unknown }).worktreeInit);
    return hook ? hookDefHash(hook) : null;
  } catch {
    return null;
  }
}

function isProjectRoot(dir: string): boolean {
  return isCanonicalAbsolutePath(dir) && hasProjectRootMarker(dir);
}

export type SnapshotCoverage =
  | { covered: true; entry: PiTrustSnapshotEntry }
  | { covered: false; reason?: MirrorWithheldReason };

/**
 * Does a snapshot entry cover `cwd`? Walks the cwd key and its ancestors,
 * nearest first; an entry applies only when its folder still has the recorded
 * identity (dev + ino + birth time when recorded), a hook entry's hook still
 * hashes to the recorded value, and an access-grant entry is still a project
 * root. No entry at all → `{covered:false}` with no reason; the nearest
 * rejected entry's reason is reported otherwise (for the bridge log).
 */
export function coverSnapshot(
  snapshot: PiTrustSnapshot | null,
  cwdKey: string,
  hooks: { currentHookHash?: (configRoot: string) => string | null } = {},
): SnapshotCoverage {
  if (!snapshot || snapshot.entries.length === 0) return { covered: false };
  const byKey = groupByKey(snapshot.entries);
  const hashOf = hooks.currentHookHash ?? currentHookHash;
  let rejected: MirrorWithheldReason | undefined;
  for (const k of ancestorKeys(cwdKey)) {
    const list = byKey.get(k);
    if (!list) continue;
    const identity = statFolderIdentity(k);
    for (const entry of list) {
      const reason = entryRejection(entry, k, identity, hashOf);
      if (!reason) return { covered: true, entry };
      rejected ??= reason;
    }
  }
  return { covered: false, ...(rejected ? { reason: rejected } : {}) };
}

function groupByKey(entries: readonly PiTrustSnapshotEntry[]): Map<string, PiTrustSnapshotEntry[]> {
  const byKey = new Map<string, PiTrustSnapshotEntry[]>();
  for (const e of entries) {
    const list = byKey.get(e.key);
    if (list) list.push(e);
    else byKey.set(e.key, [e]);
  }
  return byKey;
}

/** Why a snapshot entry no longer applies at `folder`, or null when it still does. */
function entryRejection(
  entry: PiTrustSnapshotEntry,
  folder: string,
  identity: ReturnType<typeof statFolderIdentity>,
  hashOf: (configRoot: string) => string | null,
): MirrorWithheldReason | null {
  if (!identityMatches(entry, identity)) return "identity-mismatch";
  if (entry.sourceKind === "worktreeInit" || entry.sourceKind === "workflow") {
    const current = entry.configRoot ? hashOf(entry.configRoot) : null;
    if (current === null || current !== entry.hookHash) return "hook-changed";
  }
  if (entry.sourceKind === "accessGrants" && !isProjectRoot(folder)) return "not-project-root";
  return null;
}

/** `piTrustKey` that never throws: a bad/relative cwd yields `null`. */
export function safePiTrustKey(cwd: string, home: string): string | null {
  try {
    return piTrustKey(cwd, { home });
  } catch {
    return null;
  }
}
