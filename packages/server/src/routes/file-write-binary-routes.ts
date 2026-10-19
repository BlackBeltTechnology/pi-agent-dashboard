/**
 * `POST /api/file/write-binary` — the save road for `editor-pane-file-handler`
 * edit claims (change: add-editor-pane-file-handlers, design D4).
 *
 * Registered as an ENCAPSULATED Fastify plugin holding only this route, so its
 * `application/octet-stream` Buffer parser and 128 MiB `bodyLimit` never reach
 * another route (the rest keep Fastify's 1 MiB default).
 *
 * Query: `cwd`, `path`, `mode=overwrite|copy`, `claim=<pluginId>/<claimId>`,
 * `expectSha1` (REQUIRED for overwrite — absent is a 400, never "skip the check").
 * Body: the raw bytes. Success: `{ success:true, data:{ mtime, sha1, path } }`
 * (`path` = absolute; for a copy the new file's path).
 *
 * Refusals (nothing is written): 400 bad query · 403 unknown cwd / unknown,
 * disabled or non-edit claim / outside cwd / extension not claimed / validator
 * `enabled()` false · 409 content changed since the snapshot (`sha1?`, `mtime?`
 * top-level; none when the file is gone) or no free copy name · 413 over the
 * claim's `maxBytes` (or the 128 MiB body limit) · 422 validator rejected / timed
 * out · 503 validator pool busy (retryable) or the claim's `validator: true`
 * plugin server entry is not loaded/registered (fail closed).
 *
 * Order: authorize → size → validator (BEFORE the lock, so a slow validator never
 * stalls other saves) → per-realpath lock shared with `/api/file/write` →
 * content-hash check → tmp + rename keeping the file mode. Copy: exclusive create
 * (`wx`), `<stem>.<copySuffix>[-n].<ext>`, never overwrites.
 */
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { HANDLER_MAX_BYTES } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import type { FastifyInstance } from "fastify";
import { decodeFileUri } from "../lib/decode-file-uri.js";
import { sha1OfHandle } from "../lib/file-digest.js";
import { FileValidatorBusyError, type FileValidatorPool } from "../lib/file-validator-pool.js";
import { lockKeyFor, serializeWrite } from "../lib/file-write-lock.js";
import { within } from "../lib/path-containment.js";
import {
  copyBasename,
  type HandlerClaimInfo,
  type HandlerTarget,
  isWritableHandlerTarget,
  MAX_COPY_ATTEMPTS,
} from "../lib/writable-handler-target.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { NetworkGuard } from "./route-deps.js";

/** A registered validator, as the route needs it (`FileValidatorRegistration` structurally). */
export interface RegisteredValidator {
  modulePath: string;
  enabled?: () => boolean;
}

export interface FileWriteBinaryDeps {
  sessionManager: Pick<SessionManager, "listAll">;
  networkGuard: NetworkGuard;
  /** Claim from the server-loaded plugin registry + the plugin's enabled state, read per request. */
  resolveClaim: (pluginId: string, claimId: string) => HandlerClaimInfo | null;
  /** `getPluginStatusStore().getStatus(id)?.loaded === true`. */
  isPluginServerLoaded: (pluginId: string) => boolean;
  getValidator: (pluginId: string, claimId: string) => RegisteredValidator | undefined;
  pool: FileValidatorPool;
  /** Observability sink; defaults to `console.info`. */
  log?: (line: string) => void;
}

const CLAIM_RE = /^([^/\s]+)\/([a-z][a-z0-9-]{0,31})$/;
const SHA1_RE = /^[0-9a-f]{40}$/;

const sha1Hex = (bytes: Buffer): string => createHash("sha1").update(bytes).digest("hex");

type Fail = { code: number; error: string; extra?: Record<string, unknown>; outcome: string };

type Query = { cwd?: string; path?: string; mode?: string; claim?: string; expectSha1?: string };
type ValidatorVerdict = Awaited<ReturnType<FileValidatorPool["validate"]>>;

/** Parse + shape-check the query (400s). `relForLog` is filled in later by `authorize`. */
function parseQuery(
  q: Query,
):
  | Fail
  | { cwd: string; rawPath: string; mode: "overwrite" | "copy"; pluginId: string; claimId: string; expectSha1?: string } {
  const mode = q.mode === "overwrite" || q.mode === "copy" ? q.mode : undefined;
  const claimMatch = typeof q.claim === "string" ? CLAIM_RE.exec(q.claim) : null;
  const cwd = typeof q.cwd === "string" && q.cwd ? q.cwd : undefined;
  if (!cwd || typeof q.path !== "string" || !q.path || !mode || !claimMatch) {
    return {
      code: 400,
      error: "cwd, path, mode (overwrite|copy) and claim (<pluginId>/<claimId>) are required",
      outcome: "bad-request",
    };
  }
  const expectSha1 = typeof q.expectSha1 === "string" ? q.expectSha1.toLowerCase() : undefined;
  if (mode === "overwrite" && (!expectSha1 || !SHA1_RE.test(expectSha1))) {
    return { code: 400, error: "expectSha1 (hex sha1 of the snapshot) is required for overwrite", outcome: "bad-request" };
  }
  return { cwd, rawPath: q.path, mode, pluginId: claimMatch[1], claimId: claimMatch[2], expectSha1 };
}

/** Run the pool; a saturated pool is a retryable 503 `Fail`, any other throw propagates. */
async function runPool(
  pool: FileValidatorPool,
  modulePath: string,
  body: Buffer,
  ext: string,
): Promise<ValidatorVerdict | Fail> {
  try {
    return await pool.validate(modulePath, body, ext);
  } catch (err) {
    if (err instanceof FileValidatorBusyError) {
      return { code: 503, error: "validator is busy; retry shortly", extra: { retryable: true }, outcome: "busy" };
    }
    throw err;
  }
}

/** One observability line: claim, mode, byte count, outcome, cwd-relative path only. */
function outcomeLine(q: Query, bytes: number, outcome: string, relPath: string): string {
  const mode = q.mode === "copy" || q.mode === "overwrite" ? q.mode : "?";
  return `[file-write-binary] claim=${JSON.stringify(q.claim ?? "")} mode=${mode} bytes=${bytes} outcome=${outcome} path=${JSON.stringify(relPath)}`;
}

const forbidden = (error: string): Fail => ({ code: 403, error, outcome: "forbidden" });

export function registerFileWriteBinaryRoutes(fastify: FastifyInstance, deps: FileWriteBinaryDeps): void {
  const log = deps.log ?? ((line: string) => console.info(line));

  /** 403 authorization: claim, plugin switch, known cwd, target. Nothing is read or written. */
  async function authorize(
    p: { cwd: string; rawPath: string; mode: "overwrite" | "copy"; pluginId: string; claimId: string },
    onPath: (relForLog: string) => void,
  ): Promise<
    | Fail
    | { claim: HandlerClaimInfo; validator?: RegisteredValidator; target: Extract<HandlerTarget, { ok: true }>; requested: string }
  > {
    const claim = deps.resolveClaim(p.pluginId, p.claimId);
    if (!claim) return forbidden("unknown file-handler claim");
    const validator = deps.getValidator(p.pluginId, p.claimId);
    // The plugin's own switch is evaluated before anything else for the claim.
    if (validator?.enabled && !safeEnabled(validator.enabled)) {
      return forbidden("saves through this claim are disabled by its plugin");
    }
    if (!deps.sessionManager.listAll().some((s) => s.cwd === p.cwd)) return forbidden("unknown session path");
    const requested = path.resolve(p.cwd, decodeFileUri(p.rawPath));
    onPath(within(requested, path.resolve(p.cwd)) ? path.relative(p.cwd, requested) || "." : "<outside-cwd>");
    const target = await isWritableHandlerTarget(requested, { cwd: p.cwd, claim, mode: p.mode });
    if (!target.ok) return forbidden("target is not a writable file for this handler claim");
    if (p.mode === "copy" && !claim.copySuffix) return forbidden("claim declares no copySuffix");
    return { claim, validator, target, requested };
  }

  /** The validator gate (before the lock): fail closed when declared-but-absent, then run it in the pool. */
  async function validate(
    a: { claim: HandlerClaimInfo; validator?: RegisteredValidator; target: { ext: string } },
    pluginId: string,
    claimRef: string,
    body: Buffer,
  ): Promise<Fail | null> {
    if (a.claim.validator && (!deps.isPluginServerLoaded(pluginId) || !a.validator)) {
      return { code: 503, error: "the claim's validator is not available; try again after the plugin is loaded", outcome: "unavailable" };
    }
    if (!a.validator) return null;
    const verdict = await runPool(deps.pool, a.validator.modulePath, body, a.target.ext);
    if ("code" in verdict) return verdict;
    if (verdict.ok) return null;
    const outcome = verdict.kind === "reject" ? "rejected" : verdict.kind;
    log(`[file-write-binary] validator claim=${JSON.stringify(claimRef)} bytes=${body.length} outcome=${outcome}`);
    return {
      code: 422,
      error: verdict.kind === "timeout" ? "validator timed out" : `validator rejected the content: ${verdict.reason}`,
      outcome,
    };
  }

  void fastify.register(async (scope) => {
    scope.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: HANDLER_MAX_BYTES },
      (_request, body, done) => done(null, body),
    );

    scope.post<{ Querystring: Query }>(
      "/api/file/write-binary",
      { preHandler: deps.networkGuard, bodyLimit: HANDLER_MAX_BYTES },
      async (request, reply) => {
        const q = request.query;
        const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        let relForLog = "-";
        const done = (outcome: string): void => log(outcomeLine(q, body.length, outcome, relForLog));
        const refuse = (f: Fail) => {
          done(f.outcome);
          reply.code(f.code);
          return { success: false, error: f.error, ...(f.extra ?? {}) };
        };

        const parsed = parseQuery(q);
        if ("code" in parsed) return refuse(parsed);
        const auth = await authorize(parsed, (r) => {
          relForLog = r;
        });
        if ("code" in auth) return refuse(auth);
        const { claim, target, requested } = auth;

        if (body.length > claim.maxBytes) {
          return refuse({ code: 413, error: `body exceeds the claim limit of ${claim.maxBytes} bytes`, outcome: "too-large" });
        }
        const invalid = await validate(auth, parsed.pluginId, q.claim as string, body);
        if (invalid) return refuse(invalid);

        const written = await performWrite(target, requested, body, claim, parsed.expectSha1);
        if ("code" in written) return refuse(written);
        done("ok");
        return { success: true, data: written };
      },
    );
  });
}

type Written = { mtime: number; sha1: string; path: string };

/** Overwrite (under the realpath lock) or exclusive-create copy; returns the response data. */
async function performWrite(
  target: Extract<HandlerTarget, { ok: true }>,
  requested: string,
  body: Buffer,
  claim: HandlerClaimInfo,
  expectSha1: string | undefined,
): Promise<Written | Fail> {
  if (target.kind === "overwrite") {
    const result = await serializeWrite(await lockKeyFor(target.real), () =>
      overwriteUnderLock(target.real, body, expectSha1 as string),
    );
    return "code" in result ? result : { mtime: result.mtime, sha1: result.sha1, path: requested };
  }
  const result = await createCopy(target.realDir, requested, claim.copySuffix as string, body);
  if ("code" in result) return result;
  return { mtime: result.mtime, sha1: result.sha1, path: path.join(path.dirname(requested), result.name) };
}

function safeEnabled(fn: () => boolean): boolean {
  try {
    return fn() !== false;
  } catch {
    return false; // a throwing predicate refuses (fail closed)
  }
}

async function overwriteUnderLock(
  real: string,
  body: Buffer,
  expectSha1: string,
): Promise<{ mtime: number; sha1: string } | Fail> {
  let current: import("node:fs").Stats;
  let currentSha1: string;
  try {
    // Non-blocking open + fstat: a FIFO planted at the path cannot hang the lock.
    const fh = await fs.open(real, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0));
    try {
      current = await fh.stat();
      if (!current.isFile()) {
        return { code: 403, error: "target is not a regular file", outcome: "forbidden" };
      }
      currentSha1 = await sha1OfHandle(fh, new AbortController().signal);
    } finally {
      await fh.close().catch(() => {});
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { code: 409, error: "file no longer exists", outcome: "conflict" };
    }
    return { code: 500, error: err instanceof Error ? err.message : "write failed", outcome: "error" };
  }
  // Content comparison, not mtime: a timestamp-preserving rewrite is still a conflict.
  if (currentSha1 !== expectSha1) {
    return {
      code: 409,
      error: "file changed on disk since it was loaded",
      extra: { sha1: currentSha1, mtime: current.mtimeMs },
      outcome: "conflict",
    };
  }
  const tmpPath = path.join(path.dirname(real), `.${path.basename(real)}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await fs.writeFile(tmpPath, body, { flag: "wx" });
    await fs.chmod(tmpPath, current.mode & 0o777); // keep the original permissions
    await fs.rename(tmpPath, real);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    return { code: 500, error: err instanceof Error ? err.message : "write failed", outcome: "error" };
  }
  return { mtime: (await fs.stat(real)).mtimeMs, sha1: sha1Hex(body) };
}

/** Write `body` into the freshly created exclusive handle; remove the file on failure. */
async function fillCopy(
  fh: import("node:fs/promises").FileHandle,
  dest: string,
  body: Buffer,
  srcMode: number | undefined,
): Promise<Fail | null> {
  try {
    await fh.writeFile(body);
    if (srcMode !== undefined) await fh.chmod(srcMode);
    await fh.close();
    return null;
  } catch (err) {
    await fh.close().catch(() => {});
    await fs.rm(dest, { force: true }).catch(() => {});
    return { code: 500, error: err instanceof Error ? err.message : "write failed", outcome: "error" };
  }
}

async function createCopy(
  realDir: string,
  requested: string,
  suffix: string,
  body: Buffer,
): Promise<{ name: string; mtime: number; sha1: string } | Fail> {
  // Source permissions, or `0644 & ~umask` (the kernel applies the umask to the
  // open mode) when the source no longer exists.
  const srcMode = await fs.stat(requested).then(
    (st) => st.mode & 0o777,
    () => undefined,
  );
  for (let attempt = 1; attempt <= MAX_COPY_ATTEMPTS; attempt++) {
    const name = copyBasename(requested, suffix, attempt);
    const dest = path.join(realDir, name);
    let fh: import("node:fs/promises").FileHandle;
    try {
      fh = await fs.open(dest, "wx", srcMode ?? 0o644);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      return { code: 500, error: err instanceof Error ? err.message : "write failed", outcome: "error" };
    }
    const failed = await fillCopy(fh, dest, body, srcMode);
    if (failed) return failed;
    return { name, mtime: (await fs.stat(dest)).mtimeMs, sha1: sha1Hex(body) };
  }
  return { code: 409, error: "no free name for the copy", outcome: "no-free-name" };
}
