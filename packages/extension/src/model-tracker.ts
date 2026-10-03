/**
 * Model and thinking-level change detection.
 * Sends model_update only when values actually change.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { isPiCodingAgentName } from "@blackbelt-technology/pi-dashboard-shared/pi-installs/candidates.js";
import type { BridgeContext } from "./bridge-context.js";
import { getCurrentModelString } from "./bridge-context.js";
import { gatherGitInfo, gatherGitStatus } from "./vcs-info.js";

/**
 * Send model_update if model or thinking level has changed since last send.
 */
export function sendModelUpdateIfChanged(bc: BridgeContext): void {
  const model = getCurrentModelString(bc);
  const thinkingLevel = (bc.pi as any).getThinkingLevel?.() ?? undefined;
  if (model === bc.lastModel && thinkingLevel === bc.lastThinkingLevel) return;
  bc.lastModel = model;
  bc.lastThinkingLevel = thinkingLevel;
  if (model) {
    bc.connection.send({
      type: "model_update",
      sessionId: bc.sessionId,
      model,
      thinkingLevel,
    });
  }
}

/**
 * Send session_name_update if name has changed since last send.
 */
export function sendSessionNameIfChanged(bc: BridgeContext): void {
  const name = bc.pi.getSessionName() ?? "";
  if (name === bc.lastSessionName) return;
  bc.lastSessionName = name;
  bc.connection.send({
    type: "session_name_update",
    sessionId: bc.sessionId,
    name,
  });
}

/**
 * Send git_info_update if branch, PR tuple, worktree or status changed since
 * last send. The ONE change-detector: the git-poll tick, reconnect and the
 * PR-status scheduler's probe completion all call it. The PR tuple comes from
 * the async scheduler's cache — no `gh` runs here.
 * See change: redesign-composer-session-strip (D5).
 */
export function sendGitInfoIfChanged(bc: BridgeContext, cwd: string): void {
  const info = gatherGitInfo(cwd);
  if (!info) return;
  // Sync: may reset the tuple (branch change → all-null) and START a probe;
  // never waits for it.
  bc.prStatus?.observe({ sessionId: bc.sessionId, cwd, branch: info.gitBranch });
  const pr = bc.prStatus?.tuple() ?? {};
  const nextPrJson = JSON.stringify(pr);
  // Worktree state diff: serialise to a stable string. `"null"` marks an
  // explicit "cwd is not a worktree" so a subsequent transition into a
  // worktree still counts as a change.
  const nextWorktreeJson = info.gitWorktree ? JSON.stringify(info.gitWorktree) : "null";
  // Working-tree dirtiness + drift, gathered on the same tick (one extra
  // `git status` — cheap; git is already running here). Serialised for a
  // stable change-diff; `"null"` = inconclusive probe this tick.
  // See change: add-session-uncommitted-indicator-and-commit.
  const status = gatherGitStatus(cwd);
  const nextStatusJson = status ? JSON.stringify(status) : "null";
  if (
    info.gitBranch === bc.lastGitBranch &&
    nextPrJson === bc.lastGitPrJson &&
    nextWorktreeJson === bc.lastGitWorktreeJson &&
    nextStatusJson === bc.lastGitStatusJson
  ) return;
  bc.lastGitBranch = info.gitBranch;
  bc.lastGitPrJson = nextPrJson;
  bc.lastGitWorktreeJson = nextWorktreeJson;
  bc.lastGitStatusJson = nextStatusJson;
  bc.connection.send({
    type: "git_info_update",
    sessionId: bc.sessionId,
    ...info,
    // Always the full cached tuple; unknown fields are omitted.
    ...pr,
    // `info` present ⇒ branch resolved ⇒ cwd is a confirmed git repo.
    // See change: gate-session-worktree-button-on-git.
    isGitRepo: true,
    // Use explicit `null` on the wire when worktree state went from
    // present → absent, so the server can clear its cached value.
    gitWorktree: info.gitWorktree ?? null,
    // Omit when the probe was inconclusive so the server keeps the last
    // known status rather than clearing it to a false all-clean.
    ...(status ? { gitStatus: status } : {}),
  });
}

/**
 * Last pi version pushed via `pi_version_update`. Module-scoped: a single pi
 * process has exactly one pi version, so this correctly survives bridge
 * reconnect and suppresses redundant pushes. See change:
 * restore-pi-version-skew-surface.
 */
/**
 * Last sent `pi_version_update`, keyed by session — the server keeps
 * `piVersion` / `piBelowFloor` only in memory, so a new session in the same pi
 * process (session switch) must receive it, and a reconnect clears it
 * (`resetReconnectCaches`). See change: update-pi-core-1-0-adopt-apis (review B2).
 */
let lastPiVersionKey: string | undefined;

const PI_PKG = "@earendil-works/pi-coding-agent";

/**
 * Read a package's `version` without resolving its `./package.json` subpath.
 *
 * Node gates subpath resolution on the package's `exports` map: a package that
 * exports only `"."` makes resolving the `"<pkg>/package.json"` subpath throw
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` (pi 0.80.2 is such a package). So we resolve
 * the always-present `"."` entry instead, then walk up to the nearest
 * `package.json` whose `name` matches — the `name` check avoids grabbing an
 * ancestor workspace manifest under hoisted/linked layouts. `matchName`
 * defaults to the exact `pkgName`; a caller may pass a broader predicate
 * (e.g. `isPiCodingAgentName`). Returns `undefined`
 * (not throw) when no matching manifest is found; a truly-uninstalled package
 * still throws from `resolveEntry`, which the caller catches.
 *
 * `resolveEntry`/`readFile`/`fileExists` are injectable for tests.
 */
export function readPkgVersionByWalkUp(
  pkgName: string,
  resolveEntry: (spec: string) => string,
  readFile: (p: string) => string = (p) => readFileSync(p, "utf8"),
  fileExists: (p: string) => boolean = existsSync,
  matchName: (name: string) => boolean = (name) => name === pkgName,
): string | undefined {
  let dir = dirname(resolveEntry(pkgName));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "package.json");
    if (fileExists(candidate)) {
      const parsed = JSON.parse(readFile(candidate)) as { name?: string; version?: string };
      if (parsed.name !== undefined && matchName(parsed.name)) {
        return typeof parsed.version === "string" ? parsed.version : undefined;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Injectable filesystem probes for {@link readRunningPiVersion}. */
export interface ReadRunningPiVersionFs {
  readFile?: (p: string) => string;
  fileExists?: (p: string) => boolean;
  /** Resolve a symlink chain. Defaults to `fs.realpathSync`. */
  realpath?: (p: string) => string;
}

/**
 * Read the version of the pi process this bridge runs INSIDE, anchored on
 * `process.argv[1]` (pi's CLI entry) rather than a by-name resolution.
 *
 * Why argv, not a by-name resolution: this monorepo hoists a pinned earendil
 * copy at the root, so by-name resolution can read the hoisted NEW version
 * while the session actually runs an OLD host pi (or a pi-coding-agent build
 * under another scope) — reporting a supported pi for a session that is below
 * the floor. The manifest match is scope-agnostic (`isPiCodingAgentName`), so
 * any running pi reports its true version. See change: drop-mariozechner-pi-fork.
 * `process.argv[1]` is the entry node was started with, so the walk-up always
 * lands on the manifest of the running copy.
 *
 * Whole body in try/catch → `undefined`: a missing argv[1], a bun-compiled
 * binary with no reachable manifest, or an unreadable/invalid manifest. A
 * caller must treat `undefined` as "unknown" (no below-floor flag), never as
 * "too old".
 *
 * `argv[1]` is REALPATH-ed first, and that is load-bearing: a pi installed as a
 * bin shim is a SYMLINK (`node_modules/.bin/pi` → `../@…/dist/cli.js`;
 * `/usr/local/bin/pi` → `../lib/node_modules/…/cli.js`) and Node does NOT
 * resolve it for `argv[1]`. Walking from the symlink's directory finds no pi
 * manifest within the depth bound, so the reader would answer `undefined`
 * and an OLD pi would never be flagged below the floor.
 * A failed realpath (deleted symlink target, virtual path) falls back to the
 * literal entry rather than aborting the read.
 *
 * The `fs` probes are injectable for tests. See change:
 * retire-slash-dispatch-via-expand-prompt-templates (design D3). Since
 * update-pi-core-1-0-adopt-apis it feeds `pi_version_update` (the server's
 * below-floor signal) instead of the retired slash-dispatch gate.
 */
export function readRunningPiVersion(
  argv1: string | undefined = process.argv[1],
  fs: ReadRunningPiVersionFs = {},
): string | undefined {
  try {
    if (!argv1) return undefined;
    let entry = argv1;
    try {
      entry = (fs.realpath ?? realpathSync)(argv1);
    } catch {
      // Symlink target gone / non-existent path: keep the literal entry so the
      // walk-up still has a chance (and still fails closed to `undefined`).
      entry = argv1;
    }
    return readPkgVersionByWalkUp(
      PI_PKG,
      () => entry,
      fs.readFile ?? ((p) => readFileSync(p, "utf8")),
      fs.fileExists ?? existsSync,
      isPiCodingAgentName,
    );
  } catch {
    return undefined;
  }
}

/**
 * Send `pi_version_update` when the bridge's pi version differs from the last
 * sent value (including the first read). The version is the RUNNING pi, read
 * argv-anchored via {@link readRunningPiVersion} — never a by-name resolution,
 * which can read a hoisted newer copy. An unknown version (`undefined`) is not
 * sent. A read failure logs a warning and skips the send; the next poll tick
 * retries. `readVersion` is injectable for tests.
 * See change: update-pi-core-1-0-adopt-apis (D2).
 */
export function sendPiVersionIfChanged(
  bc: BridgeContext,
  readVersion: () => string | undefined = readRunningPiVersion,
): void {
  let version: string | undefined;
  try {
    version = readVersion();
  } catch (e) {
    console.warn("[dashboard] pi version read failed:", e);
    return;
  }
  if (!version) return;
  const key = `${bc.sessionId}\u0000${version}`;
  if (key === lastPiVersionKey) return;
  lastPiVersionKey = key;
  bc.connection.send({
    type: "pi_version_update",
    sessionId: bc.sessionId,
    version,
  });
}

/** Test-only: clear the module-scoped pi-version cache. */
export function _resetPiVersionCache(): void {
  lastPiVersionKey = undefined;
}

/**
 * Reset the change-detection caches that aren't persisted on the server
 * side, so a server-restart-driven reconnect re-sends them. `gitBranch`
 * is already persisted to `.meta.json` so it's tolerable for a tick of
 * staleness.
 */
export function resetReconnectCaches(bc: BridgeContext): void {
  // Defensive: reset git so a reconnect through a stale state cache
  // doesn't surface stale branch info if .meta.json wasn't persisted yet.
  bc.lastGitBranch = undefined;
  bc.lastGitPrJson = undefined;
  bc.lastGitWorktreeJson = undefined;
  bc.lastGitStatusJson = undefined;
  // The server does not persist `piVersion`; re-send on the next tick.
  lastPiVersionKey = undefined;
}

/**
 * Emit `cwd_missing` the first time `existsSync(cwd)` flips to false.
 * Debounced via `bc.lastCwdMissing` — once we've reported missing, the
 * tick is a no-op forever (we never reset to false on rediscovery; see
 * the BridgeContext doc-comment for the rationale).
 *
 * Pure with respect to `bc` aside from caching the flag; the only side
 * effect is `connection.send`. See change: add-worktree-lifecycle-actions.
 */
export function sendCwdMissingIfChanged(
  bc: BridgeContext,
  cwd: string,
  exists: (p: string) => boolean = existsSync,
): void {
  if (bc.lastCwdMissing === true) return;
  if (!cwd) return;
  if (exists(cwd)) return;
  bc.lastCwdMissing = true;
  bc.connection.send({
    type: "cwd_missing",
    sessionId: bc.sessionId,
  });
}

