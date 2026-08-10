/**
 * REST routes for the kb-plugin, mounted on the shared Fastify instance.
 * Reindex + config writes run in the dashboard-server process (NOT a pi
 * session), so a cold worktree with no live session is both indexable and
 * configurable (design §2).
 *
 *   GET  /api/kb/stats?cwd=<abs>    → { files, chunks, indexed, staleCount, indexing, jobStatus, lastError? }
 *   POST /api/kb/reindex?cwd=<abs>  → 202 { status:"running", jobId }  (non-blocking; poll /stats for completion + jobStatus:error). See change: fix-kb-index-feedback.
 *   GET  /api/kb/config?cwd=<abs>   → { config, origin, projectPath }
 *   PUT  /api/kb/config?cwd=<abs>   → 200 { config, origin, projectPath } | 400 { error }
 *
 * Every route validates `cwd` against the host-provided known-folder set
 * (session cwds ∪ pinned dirs) BEFORE opening a store or touching disk, so an
 * untrusted `cwd` can never drive arbitrary-path indexing (design §3, §8).
 * Both sides of the match are realpath-canonicalized (pins are stored
 * symlink-resolved, a session cwd / raw query may not be), and a git worktree
 * whose MAIN repo is a known folder is admitted too — so a session-less
 * worktree that no live session or pin covers is still indexable
 * (kb-folder-slot spec). See change: fix-kb-worktree-cwd-guard.
 *
 * See change: add-kb-folder-slot.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  indexSource,
  type KbConfig,
  loadConfig,
  SqliteFtsStore,
  validateConfig,
} from "@blackbelt-technology/pi-dashboard-kb";
import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { KbConfigPatch, KbReindexResult, KbStats } from "../shared/kb-plugin-types.js";
import type { KbJobRegistry } from "./job-registry.js";

export interface KbRouteDeps {
  /** Live known-folder set for cwd validation (session cwds ∪ pinned dirs). */
  knownCwds: () => string[];
  registry: KbJobRegistry;
}

/** Absolute project config path for a folder (mirrors kb `projectConfigPath`). */
export function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "dashboard", "knowledge_base.json");
}

/** Canonicalize an absolute path for comparison: resolve, then follow symlinks
 *  (best-effort — a non-existent path keeps its resolved form). Pins are stored
 *  realpath-canonicalized while session cwds / the raw query string may reach
 *  the same folder via a symlink (macOS /var→/private/var, a symlinked repo
 *  root), so BOTH sides of the guard must canonicalize identically or the match
 *  spuriously fails. See change: fix-kb-worktree-cwd-guard. */
function canonPath(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/** If `cwd` is inside a git worktree, return its MAIN working-tree path (parent
 *  of the shared git-common-dir), else null. Server-derived via git — never a
 *  client-supplied main path — so a worktree is admitted only when its parent
 *  repo is independently a known folder. Enables reindexing a SESSION-LESS
 *  worktree that neither a live session cwd nor a pin covers.
 *  See change: fix-kb-worktree-cwd-guard. */
function worktreeMainPath(cwd: string): string | null {
  try {
    const commonDir = execFileSync(
      "git",
      ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
    ).trim();
    return commonDir ? dirname(commonDir) : null;
  } catch {
    return null;
  }
}

/** Pure cwd guard shared by the REST routes and the plugin_action handler:
 *  a cwd is allowed when it (or its git-worktree MAIN repo) is a known folder.
 *  Both sides canonicalize. See change: fix-plugin-action-fanout-and-handlers. */
export function isAllowedCwd(cwd: string | undefined, known: () => string[]): cwd is string {
  if (!cwd) return false;
  const target = canonPath(cwd);
  const knownCanon = known().map(canonPath);
  if (knownCanon.includes(target)) return true;
  // Admit a git worktree whose MAIN repo is a known folder (covers a
  // session-less worktree — worktrees are never pinned and their session is
  // transient, so the parent repo is the durable trust anchor).
  const main = worktreeMainPath(cwd);
  if (main && knownCanon.includes(canonPath(main))) return true;
  return false;
}

/** Reject a cwd that is missing or not a known folder. Returns true when handled. */
function rejectCwd(reply: FastifyReply, cwd: string | undefined, known: () => string[]): cwd is undefined {
  if (!cwd) {
    reply.code(400).send({ error: "Missing cwd" });
    return true;
  }
  if (isAllowedCwd(cwd, known)) return false;
  reply.code(403).send({ error: "cwd not allowed" });
  return true;
}

/** Open (and DDL-init) the folder's resolved KB store. Absent db → empty store. */
function openStore(cwd: string): { store: SqliteFtsStore; cfg: ReturnType<typeof loadConfig> } {
  const cfg = loadConfig(cwd);
  const store = new SqliteFtsStore(cfg.dbAbsPath);
  store.init();
  return { store, cfg };
}

/** Count source files that drifted since their AGENTS.md row was acknowledged.
 *  Reads the extension-written `dox-staleness.json` (`{ rowPath: acknowledgedSha }`).
 *  Source-file drift ONLY — markdown drift is out of scope (design §6). */
function countStale(cwd: string): number {
  const sf = join(cwd, ".pi", "dashboard", "kb", "dox-staleness.json");
  if (!existsSync(sf)) return 0;
  let map: Record<string, string>;
  try {
    map = JSON.parse(readFileSync(sf, "utf8")) as Record<string, string>;
  } catch {
    return 0;
  }
  let stale = 0;
  for (const [rowPath, ackedSha] of Object.entries(map)) {
    const abs = isAbsolute(rowPath) ? rowPath : resolve(cwd, rowPath);
    if (!existsSync(abs)) continue;
    let sha: string;
    try {
      sha = createHash("sha256").update(readFileSync(abs)).digest("hex");
    } catch {
      continue;
    }
    if (sha !== ackedSha) stale++;
  }
  return stale;
}

/** Run `indexSource` over the folder's resolved (filesystem) sources. */
export async function reindexAll(cwd: string): Promise<KbReindexResult> {
  const { store, cfg } = openStore(cwd);
  try {
    let changed = 0;
    for (const src of cfg.resolvedSources) {
      const stats = await indexSource(
        store,
        { root: src.id, dir: src.dir },
        {
          include: cfg.include,
          exclude: cfg.exclude,
          extensions: cfg.extensions,
          indexAgentsFiles: cfg.indexAgentsFiles,
          includeSourceMarkdown: cfg.includeSourceMarkdown,
        },
      );
      changed += stats.changed;
    }
    return { changed, chunks: store.counts().chunks };
  } finally {
    store.close();
  }
}

/** Atomic project-config write (tmp + rename), creating parent dirs. */
function writeProjectConfig(cwd: string, obj: Partial<KbConfig>): string {
  const path = projectConfigPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
  return path;
}

type PutResult = { ok: true; projectPath: string } | { ok: false; code: number; error: string };

/**
 * Merge the edited path fields over the current on-disk project file (so
 * untouched fields round-trip unchanged; empty file for a worktree bootstrap),
 * validate the shape, then atomically persist the SPARSE merged object (never
 * the DEFAULTS-filled validation output). Returns a discriminated result; the
 * route maps it to a status code. Writes nothing on a validation failure.
 */
export function applyConfigPatch(cwd: string, body: KbConfigPatch): PutResult {
  const path = projectConfigPath(cwd);
  let current: Partial<KbConfig> = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, "utf8")) as Partial<KbConfig>;
    } catch (e) {
      return { ok: false, code: 400, error: `existing config is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const merged: Partial<KbConfig> = { ...current };
  if (body.sources !== undefined) merged.sources = body.sources;
  if (body.include !== undefined) merged.include = body.include;
  if (body.exclude !== undefined) merged.exclude = body.exclude;
  if (body.dbPath !== undefined) merged.dbPath = body.dbPath;

  try {
    validateConfig(merged, "project");
  } catch (e) {
    return { ok: false, code: 400, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, projectPath: writeProjectConfig(cwd, merged) };
}

export function mountKbRoutes(fastify: FastifyInstance, deps: KbRouteDeps): void {
  const { knownCwds, registry } = deps;

  // ── GET stats ──────────────────────────────────────────────────
  fastify.get<{ Querystring: { cwd?: string } }>("/api/kb/stats", async (req, reply) => {
    const { cwd } = req.query;
    if (rejectCwd(reply, cwd, knownCwds)) return;
    const { store } = openStore(cwd);
    let counts: { files: number; chunks: number };
    try {
      counts = store.counts();
    } finally {
      store.close();
    }
    const job = registry.get(cwd);
    const running = registry.isRunning(cwd);
    const stats: KbStats = {
      files: counts.files,
      chunks: counts.chunks,
      indexed: counts.chunks > 0,
      staleCount: countStale(cwd),
      indexing: running,
      jobStatus: registry.statusFor(cwd),
      ...(!running && job?.status === "error" && job.error ? { lastError: job.error } : {}),
    };
    return stats;
  });

  // ── POST reindex ───────────────────────────────────────────────
  // NON-BLOCKING: register the job and respond `202 { status:"running" }`
  // immediately. The walk runs to completion in-process; the row polls `/stats`
  // for `indexing` + completion. A blocking `await` here hid the entire walk
  // behind one request, so the client never observed `indexing:true` → no
  // spinner. A failed walk is retained by the registry and surfaces via `/stats`
  // (`jobStatus:"error"`, `lastError`), never a `500` body. See change:
  // fix-kb-index-feedback.
  fastify.post<{ Querystring: { cwd?: string } }>("/api/kb/reindex", async (req, reply) => {
    const { cwd } = req.query;
    if (rejectCwd(reply, cwd, knownCwds)) return;
    if (!registry.isRunning(cwd)) {
      const { promise } = registry.start(cwd, async () => reindexAll(cwd));
      // Attach the catch SYNCHRONOUSLY so the detached tail promise is never an
      // unhandled rejection. Use `fastify.log` (not `req.log`): the request is
      // already finalized by the time the walk settles.
      promise.catch((err) =>
        fastify.log.error(`[kb-plugin] reindex failed for ${cwd}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    reply.code(202);
    return { status: "running" as const, jobId: registry.jobId(cwd) ?? "kb" };
  });

  // ── GET config ─────────────────────────────────────────────────
  fastify.get<{ Querystring: { cwd?: string } }>("/api/kb/config", async (req, reply) => {
    const { cwd } = req.query;
    if (rejectCwd(reply, cwd, knownCwds)) return;
    const cfg = loadConfig(cwd);
    return { config: cfg as KbConfig, origin: cfg.origin, projectPath: projectConfigPath(cwd) };
  });

  // ── PUT config ─────────────────────────────────────────────────
  fastify.put<{ Querystring: { cwd?: string }; Body: KbConfigPatch }>("/api/kb/config", async (req, reply) => {
    const { cwd } = req.query;
    if (rejectCwd(reply, cwd, knownCwds)) return;
    const body = (req.body ?? {}) as KbConfigPatch;

    const result = applyConfigPatch(cwd, body);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    if (body.reindex && !registry.isRunning(cwd)) {
      // Fire-and-forget: the row polls `/stats` for completion.
      registry.start(cwd, async () => reindexAll(cwd)).promise.catch(() => {});
    }
    const cfg = loadConfig(cwd);
    return { config: cfg as KbConfig, origin: cfg.origin, projectPath: result.projectPath };
  });
}
