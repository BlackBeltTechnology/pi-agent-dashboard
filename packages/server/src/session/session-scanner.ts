/**
 * Session scanner — discovers all sessions by scanning
 * `~/.pi/agent/sessions/` and reading `.meta.json` sidecars.
 * Falls back to `.jsonl` parsing for sessions without cached meta.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import type { ArchivedSessionSummary } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { resolvePiSessionsDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { hasGitPathSegment } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { mergeSessionMeta, metaPath, readSessionMeta, type SessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { condenseForFirstMessage } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";
import type { DashboardSession, SessionSource } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { readJsonlMtime } from "./derive-ended-at.js";
import { extractSessionStats } from "./session-stats-reader.js";

function getSessionsDir(): string {
  return resolvePiSessionsDir({ piSessionsDir: loadConfig().piSessionsDir });
}

/** Extract session ID (UUID) from a filename like `<ts>_<uuid>.jsonl` */
function extractSessionId(filename: string): string | null {
  // Format: 2026-03-30T21-39-43-034Z_c7ab4be9-78d1-4764-8197-dbf74fea8bf4.jsonl
  const base = filename.replace(/\.jsonl$/, "").replace(/\.meta\.json$/, "");
  const underscoreIdx = base.indexOf("_");
  if (underscoreIdx === -1) return null;
  return base.slice(underscoreIdx + 1);
}

/** Extract startedAt from a filename timestamp like `2026-03-30T21-39-43-034Z` */
function extractTimestamp(filename: string): number {
  const base = filename.replace(/\.jsonl$/, "").replace(/\.meta\.json$/, "");
  const underscoreIdx = base.indexOf("_");
  if (underscoreIdx === -1) return Date.now();
  // Convert dashes back to colons in time part: 21-39-43-034Z → 21:39:43.034Z
  const tsRaw = base.slice(0, underscoreIdx);
  // Format: 2026-03-30T21-39-43-034Z
  // Need: 2026-03-30T21:39:43.034Z
  const isoStr = tsRaw
    .replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/, "$1:$2:$3.$4");
  const ts = new Date(isoStr).getTime();
  return isNaN(ts) ? Date.now() : ts;
}

/**
 * Whether a PERSISTED `gitWorktree.mainPath` is a plausible working tree.
 *
 * Values written by the superseded `dirname(--git-common-dir)` derivation name
 * a directory that is not a checkout, and they do NOT expire on their own: an
 * ended session never re-probes, and `.meta.json` is re-seeded into memory at
 * every startup. So the repair happens at LOAD time.
 *
 * Best-effort SHAPE test, not an identity check — three conditions, all
 * required:
 *   1. no `.git` path SEGMENT (exact component equality, so a checkout
 *      legitimately at `/work/app.git` survives) — this catches the submodule
 *      phantom `<super>/.git/modules/<name>`;
 *   2. statable on disk;
 *   3. it directly contains a `.git` entry of its own.
 *
 * (2) and (3) are one `statSync` on `<path>/.git`: a successful stat proves
 * both, and one stat per record is the whole filesystem cost — no subprocess.
 *
 * (3) is load-bearing, not belt-and-braces. The `--separate-git-dir` and bare
 * phantoms point at REAL, EXISTING, unrelated directories with no `.git`
 * segment (`/tmp`, a sibling), so existence alone cannot see them — and those
 * are precisely the hardest-to-notice corruptions. A genuine working tree
 * always carries a `.git` entry: a directory in a normal checkout, a file in a
 * submodule or linked worktree.
 *
 * Dropped on ANY stat failure, not only not-found. The accepted cost is that a
 * legitimate checkout on an unmounted volume is dropped and, for an ended
 * session, its grouping is not restored when the volume returns — paid for one
 * unambiguous rule.
 *
 * KNOWN LIMITATION (pinned by test, not a defect): a phantom landing on a
 * directory that is ITSELF a working tree survives — a bare hub at
 * `$HOME/bare.git` yields the phantom `$HOME`, and a dotfiles `$HOME` passes
 * all three conditions. Repairing it would mean re-probing git for every
 * persisted session at startup.
 *
 * See change: add-git-checkout-root-resolver.
 */
function isPlausibleWorktreeMainPath(mainPath: string): boolean {
  if (hasGitPathSegment(mainPath)) return false;
  try {
    statSync(join(mainPath, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Infer worktree parentage from the dashboard's own layout: an ABSOLUTE cwd of
 * the form `<X>/.worktrees/<name>[/<sub>...]`, split at the FIRST `.worktrees`
 * path segment, where `<X>` is non-empty, absolute, and directly contains a
 * `.git` entry.
 *
 * This heals records whose parentage the removal race cleared (the `.git` file
 * vanishes, the bridge reports `null`, meta is written with no `gitWorktree`
 * key). Read-time only — `.meta.json` is never rewritten, so revert = stop
 * inferring. See design D3.
 *
 * Declines (no stat at all) for a relative cwd or a leading `.worktrees`
 * (e.g. `/.worktrees/x`, whose `<X>` would be empty and would stat `.git`
 * against the SERVER's cwd). Reuses `isPlausibleWorktreeMainPath` for the
 * `<X>/.git` stat and its `.git`-segment reject — no subprocess.
 *
 * Known limitation: for a nested `<X>/.worktrees/<A>/.worktrees/<B>` the first
 * segment wins, so `mainPath` is `<X>` even if `B` is a worktree OF `A`. Not a
 * layout the dashboard creates. See change:
 * fix-worktree-grouping-lost-on-remove.
 */
function inferWorktreeFromCwd(
  cwd: string | undefined,
): { mainPath: string; name: string } | undefined {
  if (!cwd || !isAbsolute(cwd)) return undefined;
  const segments = cwd.split(sep);
  const idx = segments.indexOf(".worktrees");
  // `-1` = no `.worktrees` segment; `0` = leading (relative root).
  if (idx <= 0) return undefined;
  if (idx + 1 >= segments.length) return undefined; // no follower → no name
  const mainPath = segments.slice(0, idx).join(sep);
  if (!mainPath || !isAbsolute(mainPath)) return undefined;
  const name = segments[idx + 1];
  if (!name) return undefined;
  if (!isPlausibleWorktreeMainPath(mainPath)) return undefined;
  return { mainPath, name };
}

/** Build a DashboardSession from cached `.meta.json` data. Exported so the
 * unarchive path can rehydrate a row's session before restoring it.
 * See change: archive-sessions-lazy-load. */
export function sessionFromMeta(
  sessionId: string,
  sessionFile: string,
  sessionDir: string,
  meta: SessionMeta,
  startedAt: number,
): DashboardSession {
  // One stat per rebuilt session: the same mtime seeds last-activity, the
  // lifecycle at-rest mark, and (when the persisted meta lacks one) the
  // evidence-derived `endedAt`.
  const jsonlMtime = readJsonlMtime(sessionFile);
  const status = (meta.status as DashboardSession["status"]) ?? "ended";
  const resolvedStartedAt = meta.startedAt ?? startedAt;
  return {
    id: sessionId,
    cwd: meta.cwd ?? "",
    name: meta.name,
    // Restore ORIGIN, or a restart resurrects a remote session as local and
    // hydration opens its recorded `sessionFile` — a path on the origin host
    // that a same-username machine also has (#E15). Absent ⇒ local, which is
    // what every pre-existing sidecar correctly was.
    // See change: serve-retained-remote-transcripts.
    originDeviceId: meta.originDeviceId,
    // Restore name provenance so the auto-naming lockout survives restarts.
    // See change: add-auto-session-naming.
    nameSource: meta.nameSource,
    // Restore the auto-namer stop state so a permanent stop survives a PROCESS
    // restart, not only an extension reload — otherwise a cold start re-spends
    // a full attempt budget and re-emits the error.
    // See change: fix-auto-naming-reasoning-model (design D7).
    autoNamerState: meta.autoNamerState,
    source: (meta.source as SessionSource) ?? "tui",
    // Restore the disposability marker so a restart never reclassifies an
    // ephemeral session as durable (absent ⇒ durable) and lets it escape
    // reaping forever. See change: add-embed-session-lifecycle.
    lifecyclePolicy: meta.lifecyclePolicy,
    // Restore retained notifications so the transcript keeps its notification
    // rows across a restart. See change: split-notify-from-prompt-request.
    notifyLog: meta.notifyLog,
    status,
    model: meta.model,
    thinkingLevel: meta.thinkingLevel,
    startedAt: resolvedStartedAt,
    // The dominant reproduction path: a defective meta carries no `endedAt`, and
    // the cache-fresh branch never rewrites it. Derive from the same evidence
    // rule rather than faithfully reproducing the defect.
    // See change: fix-ended-session-missing-endedat.
    endedAt: meta.endedAt ?? (status === "ended" ? (jsonlMtime ?? resolvedStartedAt) : undefined),
    // Seed last-activity from events.jsonl mtime so the session-card relative-time
    // badge survives server restarts. See change: session-card-last-activity-badge.
    lastActivityAt: jsonlMtime,
    // Seed the lifecycle at-rest mark from the same mtime so a rehydrated
    // quiescent ephemeral session is immediately evaluable by the reaper's
    // quiescence gate without waiting for a fresh run to settle (E14).
    // See change: add-embed-session-lifecycle.
    lastSettledAt: jsonlMtime,
    tokensIn: meta.tokensIn ?? 0,
    tokensOut: meta.tokensOut ?? 0,
    cacheRead: meta.cacheRead,
    cacheWrite: meta.cacheWrite,
    cost: meta.cost ?? 0,
    contextTokens: meta.contextTokens,
    contextWindow: meta.contextWindow,
    sessionFile,
    sessionDir,
    hidden: meta.hidden ?? false,
    // Restore user-owned tags so a tagged session stays tagged across restarts.
    // See change: add-session-tags.
    tags: meta.tags,
    firstMessage: meta.firstMessage,
    attachedProposal: meta.attachedProposal,
    displayPrefsOverride: meta.displayPrefsOverride,
    processDrawerCollapsed: meta.processDrawerCollapsed,
    // Restore unread bit from .meta.json so it survives server restart.
    // See change: session-card-unread-stripes.
    unread: meta.unread,
    // Restore the tri-state git-repo signal from .meta.json so an ended/cold
    // session in a git repo keeps a truthy signal across server restarts
    // without a live bridge — the +Worktree button gate hides only on
    // `=== false`. See change: gate-session-worktree-button-on-git.
    isGitRepo: meta.isGitRepo,
    // Cache the worktree base ref from meta so a later git_info_update
    // can compose it into gitWorktree.base for browser payloads. Field
    // is server-internal storage on DashboardSession (the wire shape's
    // gitWorktree.base is the merged value, not this raw cache).
    // See change: add-worktree-spawn-dialog.
    gitWorktreeBase: meta.gitWorktreeBase,
    // Restore goal ownership from meta so the session-card goal chip resolves
    // its owning goal after a server restart. See change: add-goals-folder-page.
    goalId: meta.goalId,
    // Restore the human owner so owner-scoping survives a restart / cold start
    // without re-reading the sidecar. See change: add-multi-user-identity-plane.
    principalOwner: meta.principalOwner,
    // Restore session classification for the client (grouping / board
    // visibility). Recovery no longer reads `kind` — it reads the core-owned
    // `recover` flag below. See change: reopen-sessions-after-shutdown.
    kind: meta.kind,
    // Restore the core-owned recovery opt-out so cold-start recovery can
    // classify an interrupted session without re-reading the sidecar. Absent
    // ⇒ recoverable (default true). See change: detach-automation-goal-from-core.
    recover: meta.recover,
    // Reconstruct worktree parentage from the persisted grouping subset so
    // cold-start grouping (no live bridge) collapses this session under its
    // parent repo via `resolveSessionGroupPath`, matching live-bridge grouping.
    // `base` is omitted here — it composes separately from `gitWorktreeBase`.
    // See change: fix-cold-start-worktree-session-grouping.
    // A persisted mainPath that is not a plausible working tree is DROPPED
    // (the session degrades to grouping by its own cwd). `.meta.json` is never
    // rewritten — this is a read-time filter, so a revert simply stops
    // filtering. See change: add-git-checkout-root-resolver.
    //
    // When persisted parentage is absent/implausible, infer it from the
    // dashboard's `.worktrees/` layout (heals the removal race). Same
    // read-time-only contract. See design D3.
    // See change: fix-worktree-grouping-lost-on-remove.
    gitWorktree:
      meta.gitWorktree?.mainPath && isPlausibleWorktreeMainPath(meta.gitWorktree.mainPath)
        ? { mainPath: meta.gitWorktree.mainPath, name: meta.gitWorktree.name ?? "" }
        : inferWorktreeFromCwd(meta.cwd),
    // Probe whether the session's cwd still exists on disk. Cheap stat,
    // runs once per ended session at scan time. Avoids the dashboard
    // showing a stale resume button on a session whose dir was removed.
    // See change: add-worktree-lifecycle-actions.
    cwdMissing: meta.cwd ? !existsSync(meta.cwd) : undefined,
    // Mirror the liveness marker so cold-start restore (server.ts) can
    // classify interrupted-session recovery candidates without re-reading
    // the sidecar. See change: reopen-sessions-after-shutdown.
    live: meta.live,
    liveEpoch: meta.liveEpoch,
    closedReason: meta.closedReason,
    dataUnavailable: true,
  };
}

export interface ScanResult {
  sessions: DashboardSession[];
  /** Archived index rows (boot-migrated + already-archived sidecars). */
  archived: ArchivedSessionSummary[];
  /** Ended+hidden sidecars rewritten to archived at scan time (one-shot migration). */
  migrated: number;
  /** Non-hidden sidecars past `archiveAfterDays` archived at scan time. */
  agedOut: number;
  /** Session files whose .meta.json was created or updated (for logging) */
  cacheUpdates: number;
}

export interface ScanOptions {
  /** Effective `sessionList.archiveAfterDays`; 0 disables the age rule. */
  archiveAfterDays?: number;
  /** Injectable clock (tests). */
  now?: number;
}

/** Build a `(endedAt, id)`-sortable index row from an archived sidecar. */
function archivedRowFromMeta(
  sessionId: string,
  sessionFile: string,
  meta: SessionMeta,
  jsonlMtime: number | undefined,
  startedAt: number,
): ArchivedSessionSummary {
  const cwd = meta.cwd ?? "";
  const endedAt = meta.endedAt ?? jsonlMtime ?? startedAt;
  return {
    id: sessionId,
    name: meta.name,
    firstMessage: meta.firstMessage,
    cwd,
    groupPath: cwd,
    gitWorktree: meta.gitWorktree?.mainPath
      ? { mainPath: meta.gitWorktree.mainPath, name: meta.gitWorktree.name ?? "" }
      : undefined,
    endedAt,
    archivedAt: meta.archivedAt ?? endedAt,
    sessionFile,
    // Same reason as `sessionFromMeta` above: the boot re-seed rebuilds archive
    // rows from sidecars, and a row that forgets its origin hydrates from the
    // origin host's path on THIS disk (#E15).
    // See change: serve-retained-remote-transcripts.
    originDeviceId: meta.originDeviceId,
    // Owner restored from the sidecar so a cold-boot archive reseed keeps the
    // archived session owner-gated (§8.1). See change: add-multi-user-identity-plane.
    principalOwner: meta.principalOwner,
  };
}

/**
 * Scan all session directories and return DashboardSession[] from cached meta.
 * For sessions without .meta.json or with stale cache, falls back to .jsonl parsing
 * and writes .meta.json for next time.
 */
export function scanAllSessions(sessionsDir?: string, opts: ScanOptions = {}): ScanResult {
  const dir = sessionsDir ?? getSessionsDir();
  if (!existsSync(dir)) return { sessions: [], archived: [], migrated: 0, agedOut: 0, cacheUpdates: 0 };

  const sessions: DashboardSession[] = [];
  const archived: ArchivedSessionSummary[] = [];
  let migrated = 0;
  let agedOut = 0;
  let cacheUpdates = 0;
  const now = opts.now ?? Date.now();
  const archiveAfterDays = opts.archiveAfterDays ?? loadConfig().sessionList.archiveAfterDays;
  const ageCutoff = archiveAfterDays > 0 ? now - archiveAfterDays * 86_400_000 : Number.NEGATIVE_INFINITY;

  let cwdDirs: string[];
  try {
    cwdDirs = readdirSync(dir).filter((d) => {
      try { return statSync(join(dir, d)).isDirectory(); } catch { return false; }
    });
  } catch {
    return { sessions: [], archived: [], migrated: 0, agedOut: 0, cacheUpdates: 0 };
  }

  for (const cwdDir of cwdDirs) {
    const cwdPath = join(dir, cwdDir);
    let files: string[];
    try {
      files = readdirSync(cwdPath).filter((f) => f.endsWith(".jsonl"));
    } catch { continue; }

    for (const jsonlFile of files) {
      const sessionId = extractSessionId(jsonlFile);
      if (!sessionId) continue;

      const sessionFile = join(cwdPath, jsonlFile);
      const sessionDir = cwdPath;
      const startedAt = extractTimestamp(jsonlFile);

      // Try reading .meta.json
      const meta = readSessionMeta(sessionFile);

      if (meta && meta.cwd) {
        // Boot archive decision, BEFORE any stats extraction or cache-freshness
        // work. Order (design D4): already-archived → index only; else the
        // ended+hidden migration AND the scan-time age rule rewrite the
        // sidecar once and index the row; else restore as today. The persisted
        // status is deliberately ignored (`live !== true` is the test) because
        // a clean server stop leaves a non-`ended` status behind.
        // See change: archive-sessions-lazy-load.
        const jsonlMtime = readJsonlMtime(sessionFile);
        if (meta.archived === true) {
          archived.push(archivedRowFromMeta(sessionId, sessionFile, meta, jsonlMtime, startedAt));
          continue;
        }
        if (meta.live !== true && meta.archived === undefined) {
          const isHiddenMigration = meta.hidden === true;
          const reference = Math.max(meta.endedAt ?? jsonlMtime ?? startedAt, meta.restoredAt ?? 0);
          const isAgedOut = archiveAfterDays > 0 && reference < ageCutoff;
          if (isHiddenMigration || isAgedOut) {
            const archivedAt = meta.endedAt ?? jsonlMtime ?? startedAt;
            // Leave `hidden` untouched so a rolled-back server still sees the
            // session as hidden; add the archive fields only.
            mergeSessionMeta(sessionFile, { archived: true, archivedAt });
            cacheUpdates++;
            if (isHiddenMigration) migrated++;
            else agedOut++;
            archived.push(archivedRowFromMeta(sessionId, sessionFile, { ...meta, archived: true, archivedAt }, jsonlMtime, startedAt));
            continue;
          }
        }

        // Check cache freshness: if .jsonl is newer than cachedAt, re-extract
        let needsReExtract = false;
        if (meta.cachedAt) {
          try {
            const jsonlMtime = statSync(sessionFile).mtimeMs;
            if (jsonlMtime > meta.cachedAt) {
              needsReExtract = true;
            }
          } catch { /* ignore stat errors */ }
        }

        if (!needsReExtract) {
          // Use cached meta as-is
          sessions.push(sessionFromMeta(sessionId, sessionFile, sessionDir, meta, startedAt));
          continue;
        }

        // Stale cache — re-extract stats and merge
        const stats = extractSessionStats(sessionFile);
        if (stats) {
          // Pi's JSONL has no turn_end/contextUsage events, so stats.contextWindow
          // is always inferContextWindow(model) — a hardcoded heuristic that pins
          // any Claude model to 200k and ignores 1M Sonnet variants. The persisted
          // meta.contextWindow came from a real live `turn_end` event, so it's
          // authoritative; only fall back to the inferred value when the model
          // changed (persisted value no longer applies) or none was persisted.
          const effectiveModel = stats.model ?? meta.model;
          const preserveContextWindow =
            meta.contextWindow !== undefined && effectiveModel === meta.model;
          const updated: SessionMeta = {
            ...meta,
            model: stats.model ?? meta.model,
            thinkingLevel: stats.thinkingLevel ?? meta.thinkingLevel,
            tokensIn: stats.tokensIn,
            tokensOut: stats.tokensOut,
            cacheRead: stats.cacheRead,
            cacheWrite: stats.cacheWrite,
            cost: stats.cost,
            contextTokens: stats.lastTotalTokens,
            contextWindow: preserveContextWindow ? meta.contextWindow : stats.contextWindow,
            cachedAt: Date.now(),
          };
          writeSessionMeta(sessionFile, updated);
          cacheUpdates++;
          sessions.push(sessionFromMeta(sessionId, sessionFile, sessionDir, updated, startedAt));
        } else {
          sessions.push(sessionFromMeta(sessionId, sessionFile, sessionDir, meta, startedAt));
        }
        continue;
      }

      // No usable meta — fall back to .jsonl parsing
      const header = readJsonlHeaderSync(sessionFile);
      if (!header) continue;

      const stats = extractSessionStats(sessionFile);
      const newMeta: SessionMeta = {
        ...(meta ?? {}), // preserve any existing partial meta (e.g. source)
        cwd: header.cwd,
        firstMessage: header.firstMessage,
        name: meta?.name ?? header.name,
        startedAt,
        status: "ended",
        // Persist an evidence-derived end time so the rebuilt meta is not itself
        // a fresh source of ended-without-endedAt records; an existing value in
        // prior meta wins. See change: fix-ended-session-missing-endedat.
        endedAt: meta?.endedAt ?? readJsonlMtime(sessionFile) ?? startedAt,
        ...(stats ? {
          model: stats.model,
          thinkingLevel: stats.thinkingLevel,
          tokensIn: stats.tokensIn,
          tokensOut: stats.tokensOut,
          cacheRead: stats.cacheRead,
          cacheWrite: stats.cacheWrite,
          cost: stats.cost,
          contextTokens: stats.lastTotalTokens,
          contextWindow: stats.contextWindow,
        } : {}),
        cachedAt: Date.now(),
      };
      writeSessionMeta(sessionFile, newMeta);
      cacheUpdates++;
      sessions.push(sessionFromMeta(sessionId, sessionFile, sessionDir, newMeta, startedAt));
    }
  }

  return { sessions, archived, migrated, agedOut, cacheUpdates };
}

/** Synchronous JSONL header reader (used during scan) */
function readJsonlHeaderSync(filePath: string): { id: string; cwd: string; name?: string; firstMessage?: string } | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    let header: any = null;
    let name: string | undefined;
    let firstMessage: string | undefined;

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "session" && entry.id) header = entry;
        if (entry.type === "session_info" && entry.name) name = entry.name;
        // See change: render-skill-invocations-collapsibly.
        if (!firstMessage && entry.type === "message" && entry.message?.role === "user") {
          const msg = entry.message;
          if (typeof msg.content === "string") {
            firstMessage = condenseForFirstMessage(msg.content, 200);
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "text" && part.text) {
                firstMessage = condenseForFirstMessage(part.text, 200);
                break;
              }
            }
          }
        }
        if (header && firstMessage) break;
      } catch { /* skip malformed lines */ }
    }

    if (!header) return null;
    return { id: header.id, cwd: header.cwd ?? "", name, firstMessage };
  } catch {
    return null;
  }
}
