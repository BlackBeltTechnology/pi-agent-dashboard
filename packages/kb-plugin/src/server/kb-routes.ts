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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  classifyRef,
  indexSource,
  type KbConfig,
  KbUntrustedSourceError,
  listTrustedSources,
  loadConfig,
  readStaleness,
  recordTrust,
  resolverFor,
  revokeTrustByHash,
  type SourceConfig,
  SqliteFtsStore,
  searchOptsFromConfig,
  sourceHash,
  sourceSubject,
  validateConfig,
} from "@blackbelt-technology/pi-dashboard-kb";
import { isAllowedCwd } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { isOutside } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  KbConfigPatch,
  KbReindexResult,
  KbSearchDocType,
  KbSearchResponse,
  KbSourceOutcome,
  KbSourceStatus,
  KbStats,
} from "../shared/kb-plugin-types.js";
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

/** cwd admission is owned by the shared module so kb-plugin and mcp-client
 *  share ONE implementation. Re-exported here for the existing kb tests and the
 *  plugin_action handler that import it from this module.
 *  See change: extract-mcp-client-plugin. */
export { isAllowedCwd };

/** Reject a cwd that is missing or not a known folder. Returns true when handled. */
function rejectCwd(reply: FastifyReply, cwd: string | undefined, known: () => string[]): cwd is undefined {
  if (!cwd) {
    reply.code(400).send({ error: "Missing cwd" });
    return true;
  }
  if (isAllowedCwd(cwd, known)) return false;
  // Bare `{ error }` shape preserved; `reason`/`hint` are additive (design
  // D7/D18). Pin the refused directory to admit it on retry. See change:
  // add-access-grants-and-review.
  reply.code(403).send({
    error: "cwd not allowed",
    reason: "cwd is not a known session or pinned directory.",
    hint: "Pin this directory to allow it, or open a session rooted in it.",
  });
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
 *  Reads the extension-written `dox-staleness.json` via kb's tolerant
 *  `readStaleness` (v1 sha-only strings and v2 `{version, files}` records with
 *  stat baselines both read; a future version reads as empty — never a false
 *  zero). Source-file drift ONLY — markdown drift is out of scope (design §6). */
function countStale(cwd: string): number {
  const sf = join(cwd, ".pi", "dashboard", "kb", "dox-staleness.json");
  const records = readStaleness(sf);
  let stale = 0;
  for (const [rowPath, ack] of Object.entries(records)) {
    const abs = isAbsolute(rowPath) ? rowPath : resolve(cwd, rowPath);
    if (!existsSync(abs)) continue;
    let sha: string;
    try {
      sha = createHash("sha256").update(readFileSync(abs)).digest("hex");
    } catch {
      continue;
    }
    if (sha !== ack.sha256) stale++;
  }
  return stale;
}

type SourceKind = "filesystem" | "npm" | "git" | "https";

/** Classify a saved spec (resolver choice, remote vs filesystem) without rewriting it before hashing. */
function kindOf(spec: SourceConfig): SourceKind {
  return (spec.kind ?? classifyRef(spec.ref)) as SourceKind;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Index every saved source spec (`cfg.allSourceSpecs`), each resolved on its own
 * so one failing source never aborts the others (`resolveAll` aborts on the
 * first throw). Untrusted remote sources are skipped, not fatal; a failed or
 * skipped source keeps its previously indexed chunks (`indexSource` only sweeps
 * a root it actually walked). `promptTrust` is trust-store only: the server can
 * never grant trust during a walk.
 */
export async function reindexAll(cwd: string, log?: { info(m: string): void; warn(m: string): void }): Promise<KbReindexResult> {
  const { store, cfg } = openStore(cwd);
  try {
    let changed = 0;
    const outcomes: KbSourceOutcome[] = [];
    for (const spec of cfg.allSourceSpecs) {
      const started = Date.now();
      try {
        const src = await resolverFor(kindOf(spec)).resolve(spec, {
          cwd,
          cacheDir: cfg.cacheDirAbs,
          promptTrust: async () => false,
        });
        const stats = await indexSource(
          store,
          { root: src.id, dir: src.dir },
          {
            include: cfg.include,
            exclude: cfg.exclude,
            extensions: cfg.extensions,
            indexAgentsFiles: cfg.indexAgentsFiles,
            includeSourceMarkdown: cfg.includeSourceMarkdown,
            respectGitignore: cfg.respectGitignore,
            cwd,
          },
        );
        changed += stats.changed;
        outcomes.push({ ref: spec.ref, status: "ok", ...(src.revision ? { revision: src.revision } : {}), at: Date.now() });
        log?.info(`[kb-plugin] source ok ref=${spec.ref} kind=${kindOf(spec)} ms=${Date.now() - started}`);
      } catch (e) {
        const untrusted = e instanceof KbUntrustedSourceError;
        outcomes.push({ ref: spec.ref, status: untrusted ? "untrusted" : "error", error: errMsg(e), at: Date.now() });
        if (untrusted) log?.info(`[kb-plugin] source skipped (not trusted) ref=${spec.ref} ms=${Date.now() - started}`);
        else log?.warn(`[kb-plugin] source failed ref=${spec.ref} ms=${Date.now() - started}: ${errMsg(e)}`);
      }
    }
    return { changed, chunks: store.counts().chunks, outcomes };
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
function applyConfigPatch(cwd: string, body: KbConfigPatch): PutResult {
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

type GrantResult =
  | { ok: true; hash: string; subject: string }
  | { ok: false; code: 400 | 404 | 409 | 500; error: string };

/**
 * Grant TOFU trust to ONE saved remote source, identified by exact `ref` in the
 * folder's EFFECTIVE saved config (project merged over global — the list reindex
 * walks). The recorded spec is the saved object, never request data, so grant and
 * reindex hash identically. Trust is global; the cwd guard only limits which
 * folder's config may be granted from.
 */
function grantSourceTrust(cwd: string, ref: string): GrantResult {
  const matches = loadConfig(cwd).allSourceSpecs.filter((s) => s.ref === ref);
  if (matches.length === 0) return { ok: false, code: 404, error: `no saved source with ref ${ref}` };
  if (matches.length > 1) return { ok: false, code: 409, error: `more than one saved source has ref ${ref}; resolve the duplicate first` };
  const spec = matches[0];
  if (kindOf(spec) === "filesystem") return { ok: false, code: 400, error: "filesystem sources do not need trust" };
  if (!recordTrust(spec)) return { ok: false, code: 500, error: "could not persist the trust record" };
  return { ok: true, hash: sourceHash(spec), subject: sourceSubject(spec) };
}

type PatchTrustResult =
  | { ok: true; projectPath: string; untrustedRefs: string[] }
  | { ok: false; code: number; error: string };

/**
 * Shared core of `PUT /api/kb/config` and the `config.set` plugin action: apply
 * the patch, and only after a VALID write grant `trustRefs`. Refs that cannot be
 * granted (unmatched, ambiguous, filesystem, persist failure) are returned as
 * `untrustedRefs` so no surface ever claims a grant that did not happen.
 */
export function applyConfigPatchAndTrust(cwd: string, body: KbConfigPatch): PatchTrustResult {
  const result = applyConfigPatch(cwd, body);
  if (!result.ok) return result;
  const refs = Array.isArray(body.trustRefs) ? body.trustRefs.filter((r): r is string => typeof r === "string") : [];
  const untrustedRefs = refs.filter((ref) => !grantSourceTrust(cwd, ref).ok);
  return { ok: true, projectPath: result.projectPath, untrustedRefs };
}

const SEARCH_DOC_TYPES: readonly KbSearchDocType[] = ["doc", "agents", "source-md"];
const MAX_QUERY_CHARS = 512;

type SearchQuery = { q: string; docType?: KbSearchDocType; limit: number } | { error: string };

/** Validate `GET /api/kb/search` inputs: q 1-512 chars, docType in the lane set, limit clamped to [1,50] (default 10). */
function parseSearchQuery(query: { q?: string; limit?: string; docType?: string }): SearchQuery {
  const q = (query.q ?? "").trim();
  if (q.length < 1 || q.length > MAX_QUERY_CHARS) return { error: `q must be 1-${MAX_QUERY_CHARS} characters` };
  const docType = query.docType === "" ? undefined : query.docType; // an empty lane means "all lanes"
  if (docType !== undefined && !SEARCH_DOC_TYPES.includes(docType as KbSearchDocType)) {
    return { error: `docType must be one of ${SEARCH_DOC_TYPES.join(", ")}` };
  }
  // Whole-string integer only: "1junk" / "abc" fall back to the default rather than being half-parsed.
  const limit = /^\d+$/.test(query.limit ?? "") ? Math.min(50, Math.max(1, Number(query.limit))) : 10;
  return { q, limit, ...(docType ? { docType: docType as KbSearchDocType } : {}) };
}

/** Lexical `outside` label for a filesystem ref (same shared helper the client uses). */
function refIsOutside(cwd: string, ref: string): boolean {
  return isOutside(cwd, isAbsolute(ref) ? ref : resolve(cwd, ref));
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
      const { promise } = registry.start(cwd, async () => reindexAll(cwd, fastify.log));
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

  // ── DELETE /api/kb/source-trust ────────────────────────────────
  // Revoke a remote KB source's TOFU trust. Lives in the kb-plugin, not the
  // dashboard server, because this package owns the kb trust module and its
  // store format — the Access surface revokes a store through its OWNER's write
  // path rather than rewriting the file behind it (design D6).
  // See change: add-access-grants-and-review (tasks 6.2, 7.5).
  fastify.delete<{ Body: { hash?: string } }>("/api/kb/source-trust", async (req, reply) => {
    const { hash } = (req.body ?? {}) as { hash?: string };
    if (!hash || typeof hash !== "string") {
      reply.code(400);
      return { error: "hash is required" };
    }
    const removed = revokeTrustByHash(hash);
    if (!removed) {
      reply.code(404);
      return { success: false, error: "no such source trust entry" };
    }
    return { success: true };
  });

  // ── GET search ─────────────────────────────────────────────────
  // Read-only test search over the SAVED index. Existing-only store open (no
  // init/migrate/mkdir), never reindexes, no verdict enrichment (sync fs/git on
  // the event loop). `store.search` is sync but user-initiated, bounded by q/limit.
  fastify.get<{ Querystring: { cwd?: string; q?: string; limit?: string; docType?: string } }>("/api/kb/search", async (req, reply) => {
    const { cwd } = req.query;
    if (rejectCwd(reply, cwd, knownCwds)) return;
    const parsed = parseSearchQuery(req.query);
    if ("error" in parsed) {
      reply.code(400);
      return { error: parsed.error };
    }
    const { q, docType, limit } = parsed;

    const started = Date.now();
    const cfg = loadConfig(cwd);
    let store: SqliteFtsStore | null = null;
    try {
      store = SqliteFtsStore.openExisting(cfg.dbAbsPath);
      if (!store) return { hits: [], tookMs: Date.now() - started } satisfies KbSearchResponse;
      const schema = store.hasCurrentSchema();
      if (!schema.table) return { hits: [], tookMs: Date.now() - started } satisfies KbSearchResponse;
      if (!schema.current) return { hits: [], tookMs: Date.now() - started, needsReindex: true as const } satisfies KbSearchResponse;
      // Every saved spec feeds rootPriority (narrow config ResolvedSource: id+priority only).
      const sources = cfg.allSourceSpecs.map((s) => ({ id: s.ref, dir: "", priority: s.priority ?? 0 }));
      const opts = { ...searchOptsFromConfig(cfg, { sources }), limit, ...(docType ? { docType } : {}) };
      const hits = store.search(q, opts).map((h) => ({
        root: h.root,
        path: h.path,
        headingPath: h.headingPath,
        chunkId: h.chunkId,
        snippet: h.snippet,
        score: h.score,
        docType: h.docType,
        ...(h.suppressedSections ? { suppressedSections: h.suppressedSections } : {}),
      }));
      return { hits, tookMs: Date.now() - started } satisfies KbSearchResponse;
    } catch (e) {
      fastify.log.error(`[kb-plugin] search failed for ${cwd}: ${errMsg(e)}`);
      reply.code(500);
      return { error: errMsg(e) };
    } finally {
      store?.close();
    }
  });

  // ── GET sources ────────────────────────────────────────────────
  // Per-source status. NOT folded into /stats (polled every second, shared with
  // the sidebar row). Never creates the db; `files` is a cheap GROUP BY on the
  // (root,path) PK — no per-root FTS scan.
  fastify.get<{ Querystring: { cwd?: string } }>("/api/kb/sources", async (req, reply) => {
    const { cwd } = req.query;
    if (rejectCwd(reply, cwd, knownCwds)) return;
    const cfg = loadConfig(cwd);
    let files: Record<string, number> = {};
    let store: SqliteFtsStore | null = null;
    try {
      store = SqliteFtsStore.openExisting(cfg.dbAbsPath);
      if (store) files = store.filesByRoot();
    } catch (e) {
      fastify.log.warn(`[kb-plugin] sources count failed for ${cwd}: ${errMsg(e)}`);
    } finally {
      store?.close();
    }
    const trustedHashes = new Set(listTrustedSources().map((t) => t.hash));
    const outcomes = new Map(registry.outcomesFor(cwd).map((o) => [o.ref, o]));
    const sources: KbSourceStatus[] = cfg.allSourceSpecs.map((spec) => {
      const kind = kindOf(spec);
      const o = outcomes.get(spec.ref);
      return {
        ref: spec.ref,
        kind,
        files: files[spec.ref] ?? 0,
        trusted: kind === "filesystem" ? null : trustedHashes.has(sourceHash(spec)),
        outside: kind === "filesystem" && refIsOutside(cwd, spec.ref),
        ...(o ? { lastStatus: o.status, lastAt: o.at } : {}),
        ...(o?.error ? { lastError: o.error } : {}),
        ...(o?.revision ? { revision: o.revision } : {}),
      };
    });
    return { sources };
  });

  // ── POST /api/kb/source-trust ──────────────────────────────────
  // Grant (consent made in the dashboard dialog). Keyed by `ref` against the
  // SAVED effective config only; see grantSourceTrust.
  fastify.post<{ Querystring: { cwd?: string }; Body: { ref?: string } }>("/api/kb/source-trust", async (req, reply) => {
    const { cwd } = req.query;
    if (rejectCwd(reply, cwd, knownCwds)) return;
    const ref = req.body?.ref;
    if (typeof ref !== "string" || ref.length === 0) {
      reply.code(400);
      return { error: "ref is required" };
    }
    const g = grantSourceTrust(cwd, ref);
    if (!g.ok) {
      reply.code(g.code);
      return { error: g.error };
    }
    return { hash: g.hash, subject: g.subject };
  });

  // ── PUT config ─────────────────────────────────────────────────
  fastify.put<{ Querystring: { cwd?: string }; Body: KbConfigPatch }>("/api/kb/config", async (req, reply) => {
    const { cwd } = req.query;
    if (rejectCwd(reply, cwd, knownCwds)) return;
    const body = (req.body ?? {}) as KbConfigPatch;

    const result = applyConfigPatchAndTrust(cwd, body);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    if (body.reindex && !registry.isRunning(cwd)) {
      // Fire-and-forget: the row polls `/stats` for completion.
      registry.start(cwd, async () => reindexAll(cwd, fastify.log)).promise.catch(() => {});
    }
    const cfg = loadConfig(cwd);
    return {
      config: cfg as KbConfig,
      origin: cfg.origin,
      projectPath: result.projectPath,
      ...(result.untrustedRefs.length > 0 ? { untrustedRefs: result.untrustedRefs } : {}),
    };
  });
}
