/**
 * `POST /api/file/write-binary` — the save road for `editor-pane-file-handler`
 * plugins. Registered in an ENCAPSULATED Fastify plugin so the
 * `application/octet-stream` Buffer parser (and its 128 MiB body limit) never
 * leaks to other routes (their 1 MiB default stays).
 *
 * Query: `cwd`, `path`, `mode=overwrite|copy`, `claim=<pluginId>/<claimId>`,
 * `expectSha1` (REQUIRED for overwrite; absent → 400). Body: raw bytes.
 * 200 `{success:true, data:{path, mtime, sha1}}` (path is cwd-relative);
 * 409 `{success:false, error, sha1?, mtime?}` on content conflict (no
 * sha1/mtime when the file is gone) or "no free name"; 400/403/413/422/503
 * per `file-write-binary` order documented in the handler.
 *
 * Sibling copy (`mode=copy&siblingExt=<.ext>`, no `expectSha1`): `<.ext>` must be one of the claim's
 * `siblingExtensions` (403 otherwise; `mode=overwrite` with `siblingExt` → 400); the tab file must resolve
 * inside the cwd under a claimed extension; the target is the first free `<stem><.ext>`, then
 * `<stem>-<n><.ext>` (n ≤ 99, 409 after) via `wx`; the validator runs with `<.ext>`.
 * See change: extend-craft-web-to-all-apps (D6).
 *
 * Order: query → claim (enabled edit claim; validator `enabled()`) → known cwd
 * → target authz (`isWritableHandlerTarget`) → fail-closed validator check →
 * size cap → validator (worker pool, BEFORE the lock) → under the realpath
 * lock: content-hash conflict check → tmp+rename (mode preserved) | copy via `wx`.
 *
 * See change: add-editor-pane-file-handlers (D4).
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  FILE_HANDLER_COPY_SUFFIX_RE,
  FILE_HANDLER_EXT_RE,
  HANDLER_MAX_BYTES,
  parseFileHandlerClaimKey,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/file-handler.js";
import type { PluginClaim } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import { DIGEST_CEILING_BYTES, extOf } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import type { FastifyInstance } from "fastify";
import { admitFileCwd } from "../lib/file-cwd-admission.js";
import { serializeWrite } from "../lib/file-write-lock.js";
import { within } from "../lib/path-containment.js";
import type { RouteAdmissionDeps } from "../lib/route-admission.js";
import {
  type HandlerTarget,
  isWritableHandlerTarget,
} from "../lib/writable-handler-target.js";
import type { NetworkGuard } from "./route-deps.js";

/** A claim as resolved from the server-side plugin registry at request time. */
export interface HandlerClaimInfo {
  pluginId: string;
  claim: PluginClaim;
  /** Plugin enabled right now (config resolution read at request time). */
  enabled: boolean;
  /** Plugin's server entry is loaded (`getPluginStatusStore().getStatus(id)?.loaded`). */
  serverLoaded: boolean;
}

/** Structural view of a registered validator (see `FileValidatorRegistration`). */
export interface HandlerValidatorRef {
  moduleUrl: string;
  enabled?: () => boolean;
}

/** Structural view of the worker pool (see `FileValidatorPool`). */
interface HandlerValidatorPool {
  run(job: {
    moduleUrl: string;
    bytes: Buffer;
    ext: string;
  }): Promise<
    | { kind: "ok"; bytes: Buffer }
    | { kind: "rejected"; reason: string }
    | { kind: "error"; reason: string }
    | { kind: "timeout" }
    | { kind: "busy" }
  >;
}

export interface FileHandlerDeps {
  /** `claim` query value (`<pluginId>/<claimId>`) → live claim info, or `undefined` when unknown. */
  resolveClaim(claimKey: string): HandlerClaimInfo | undefined;
  getValidator(
    pluginId: string,
    claimId: string,
  ): HandlerValidatorRef | undefined;
  validatorPool: HandlerValidatorPool;
  /** One structured line per outcome (counts only, cwd-relative path). Default `console.info`. */
  log?: (line: string) => void;
}

export interface FileWriteBinaryRouteDeps {
  sessionManager: { listAll(): ReadonlyArray<{ cwd: string }> };
  networkGuard: NetworkGuard;
  fileHandlers?: FileHandlerDeps;
  /**
   * Shared cwd admission (change: core-file-cwd-admission). Absent → the known set is the
   * `sessionManager`'s session cwds only.
   */
  routeAdmission?: RouteAdmissionDeps;
}

interface Query {
  cwd?: string;
  path?: string;
  mode?: string;
  claim?: string;
  expectSha1?: string;
  siblingExt?: string;
}

const SHA1_RE = /^[0-9a-f]{40}$/;
const MAX_COPY_ATTEMPTS = 99;

async function sha1OfFile(file: string): Promise<string> {
  const hash = createHash("sha1");
  for await (const chunk of createReadStream(file))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const NO_HANDLERS: FileHandlerDeps = {
  resolveClaim: () => undefined,
  getValidator: () => undefined,
  validatorPool: {
    run: async () => ({ kind: "error", reason: "no validator pool" }),
  },
};

type Outcome = { code: number; body: Record<string, unknown>; headers?: Record<string, string> };
const fail = (
  code: number,
  error: string,
  extra: Record<string, unknown> = {},
): Outcome => ({
  code,
  body: { success: false, error, ...extra },
});

interface WriteCtx {
  target: HandlerTarget;
  bytes: Buffer;
  sha1: string;
  rel: (p: string) => string;
}

/** Overwrite under the realpath lock: content-hash check, then tmp + rename keeping the file mode. */
async function overwrite(
  ctx: WriteCtx,
  expectSha1: string,
  reauthorize: () => Promise<HandlerTarget | null>,
): Promise<Outcome> {
  const again = await reauthorize();
  if (!again || again.real !== ctx.target.real)
    return fail(403, "target is not a writable handler file in scope");
  const real = again.real;
  let current: import("node:fs").Stats;
  try {
    current = await fs.stat(real);
  } catch {
    return fail(409, "file no longer exists"); // gone → no sha1 (client hides Reload)
  }
  if (!current.isFile()) return fail(403, "target is not a regular file");
  if (current.size > DIGEST_CEILING_BYTES)
    return fail(409, "file too large to verify", { mtime: current.mtimeMs });
  const currentSha1 = await sha1OfFile(real).catch(() => null);
  if (currentSha1 === null) return fail(409, "file no longer exists");
  if (currentSha1 !== expectSha1) {
    return fail(409, "file changed on disk since it was loaded", {
      sha1: currentSha1,
      mtime: current.mtimeMs,
    });
  }
  const tmp = path.join(
    path.dirname(real),
    `.${path.basename(real)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let mtimeMs: number;
  try {
    await fs.writeFile(tmp, ctx.bytes, { flag: "wx" });
    await fs.chmod(tmp, current.mode & 0o777);
    // Stat BEFORE the rename (it keeps the inode): a stat failure then still hits the tmp cleanup below.
    mtimeMs = (await fs.stat(tmp)).mtimeMs;
    await fs.rename(tmp, real);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => {});
    return fail(500, "write failed");
  }
  return {
    code: 200,
    body: {
      success: true,
      data: {
        path: ctx.rel(ctx.target.requested),
        mtime: mtimeMs,
        sha1: ctx.sha1,
      },
    },
  };
}

/**
 * Copy via exclusive create (never overwrites). Default: `<stem>.<suffix>.<ext>`, then `-2`…`-99`.
 * Sibling (`siblingExt`): `<stem><siblingExt>`, then `<stem>-2<siblingExt>`…`-99`.
 */
async function copy(ctx: WriteCtx, suffix: string, siblingExt?: string): Promise<Outcome> {
  const { target, bytes } = ctx;
  const base = path.basename(target.requested);
  const dot = base.lastIndexOf(".");
  const stem = base.slice(0, dot);
  const extRaw = base.slice(dot);
  const nameAt = (n: number): string => {
    if (siblingExt) return n === 1 ? `${stem}${siblingExt}` : `${stem}-${n}${siblingExt}`;
    return n === 1 ? `${stem}.${suffix}${extRaw}` : `${stem}.${suffix}-${n}${extRaw}`;
  };
  // Source mode: the source file's (only when it exists inside the cwd), else 0644 (umask applies at create).
  let mode = 0o644;
  let explicitMode = false;
  try {
    if (within(target.real, target.root)) {
      const st = await fs.stat(target.real);
      if (st.isFile()) {
        mode = st.mode & 0o777;
        explicitMode = true;
      }
    }
  } catch {
    /* source gone → default mode */
  }
  for (let n = 1; n <= MAX_COPY_ATTEMPTS; n++) {
    const name = nameAt(n);
    const dest = path.join(target.dir, name);
    let fh: import("node:fs/promises").FileHandle;
    try {
      fh = await fs.open(dest, "wx", mode);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      return fail(500, "write failed");
    }
    let mtimeMs: number;
    try {
      await fh.writeFile(bytes);
      if (explicitMode) await fh.chmod(mode);
      mtimeMs = (await fh.stat()).mtimeMs;
      await fh.close();
    } catch {
      await fh.close().catch(() => {});
      await fs.rm(dest, { force: true }).catch(() => {});
      return fail(500, "write failed");
    }
    return {
      code: 200,
      body: {
        success: true,
        data: {
          path: ctx.rel(path.join(path.dirname(target.requested), name)),
          mtime: mtimeMs,
          sha1: ctx.sha1,
        },
      },
    };
  }
  return fail(409, "no free name for the copy");
}

export function registerFileWriteBinaryRoute(
  fastify: FastifyInstance,
  deps: FileWriteBinaryRouteDeps,
): void {
  const { sessionManager, networkGuard } = deps;
  const routeAdmission: RouteAdmissionDeps = deps.routeAdmission ?? {
    knownCwds: () => sessionManager.listAll().map((s) => s.cwd),
  };
  const handlers = deps.fileHandlers ?? NO_HANDLERS;
  const log = handlers.log ?? ((line: string) => console.info(line));

  fastify.register(async (scope) => {
    // Octet-stream only: the default JSON/text parsers are removed in THIS scope, so any
    // other content type is a 415 (and the 128 MiB limit applies to nothing else).
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: HANDLER_MAX_BYTES },
      (_req, body, done) => done(null, body),
    );

    scope.post<{ Querystring: Query; Body: Buffer }>(
      "/api/file/write-binary",
      { preHandler: networkGuard, bodyLimit: HANDLER_MAX_BYTES },
      async (request, reply) => {
        const q = request.query ?? {};
        const bytesIn = Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.alloc(0);
        const send = (
          o: Outcome,
          logCtx: { relPath?: string; note?: string },
        ): Record<string, unknown> => {
          reply.code(o.code);
          for (const [name, value] of Object.entries(o.headers ?? {})) reply.header(name, value);
          log(
            `[file-write-binary] outcome=${o.code === 200 ? "ok" : o.code === 409 ? "conflict" : `refused-${o.code}`} claim=${q.claim ?? "-"} mode=${q.mode ?? "-"} bytes=${bytesIn.length}` +
              (logCtx.relPath ? ` path=${logCtx.relPath}` : "") +
              (logCtx.note ? ` ${logCtx.note}` : ""),
          );
          return o.body;
        };
        return handle(q, bytesIn, send);
      },
    );
  });

  type Send = (
    o: Outcome,
    c: { relPath?: string; note?: string },
  ) => Record<string, unknown>;
  const isOutcome = (x: unknown): x is Outcome =>
    typeof x === "object" && x !== null && "code" in x && "body" in x;

  interface Parsed {
    cwd: string;
    path: string;
    mode: "overwrite" | "copy";
    claimKey: { pluginId: string; claimId: string };
    expectSha1?: string;
    siblingExt?: string;
  }

  /** Phase 1 — query + body shape (400s). */
  function parseRequest(q: Query, bytesIn: Buffer): Parsed | Outcome {
    if (bytesIn.length === 0) return fail(400, "empty body");
    const claimKey =
      typeof q.claim === "string" ? parseFileHandlerClaimKey(q.claim) : null;
    if (
      !q.cwd ||
      !q.path ||
      (q.mode !== "overwrite" && q.mode !== "copy") ||
      !claimKey
    ) {
      return fail(
        400,
        "cwd, path, mode (overwrite|copy) and claim (<plugin>/<claim>) are required",
      );
    }
    if (q.siblingExt !== undefined) {
      if (q.mode !== "copy") return fail(400, "siblingExt is only allowed with mode=copy");
      if (typeof q.siblingExt !== "string" || !FILE_HANDLER_EXT_RE.test(q.siblingExt)) return fail(400, "siblingExt must be a lower-case extension with a leading dot");
    }
    if (
      q.mode === "overwrite" &&
      !(typeof q.expectSha1 === "string" && SHA1_RE.test(q.expectSha1))
    ) {
      return fail(400, "expectSha1 is required for overwrite");
    }
    return {
      cwd: q.cwd,
      path: q.path,
      mode: q.mode,
      claimKey,
      expectSha1: q.expectSha1,
      ...(q.siblingExt !== undefined ? { siblingExt: q.siblingExt } : {}),
    };
  }

  interface Resolved {
    /** The GUARDED request cwd (admitted by the shared guard). */
    cwd: string;
    info: HandlerClaimInfo;
    claim: PluginClaim;
    validator: HandlerValidatorRef | undefined;
  }

  /**
   * Phase 2 — enabled edit claim, validator `enabled()` switch, admitted cwd (403s / 503). The cwd is
   * admitted through the shared guard (change: core-file-cwd-admission): a refusal keeps the
   * `"unknown session path"` error plus `code: "cwd_unknown"`; an undecidable admission answers the
   * shared 503 body with `Retry-After: 1` and writes nothing.
   */
  async function resolveHandler(p: Parsed, claimParam: string): Promise<Resolved | Outcome> {
    const info = handlers.resolveClaim(claimParam);
    const claim = info?.claim;
    if (
      !info ||
      !claim ||
      claim.slot !== "editor-pane-file-handler" ||
      !info.enabled ||
      claim.mode !== "edit"
    ) {
      return fail(403, "no enabled edit claim for this handler");
    }
    if (p.siblingExt !== undefined && !(claim.siblingExtensions ?? []).includes(p.siblingExt)) {
      return fail(403, "siblingExt is not a sibling extension of this claim");
    }
    const validator = handlers.getValidator(info.pluginId, p.claimKey.claimId);
    if (validator?.enabled && !safeEnabled(validator.enabled))
      return fail(403, "saves for this handler are switched off");
    const admitted = await admitFileCwd(p.cwd, routeAdmission);
    if (!admitted.ok) {
      const { failure } = admitted;
      return {
        code: failure.code,
        body: {
          success: false,
          ...(failure.code === 503 ? { code: failure.wire.code, error: failure.error, message: failure.wire.message, retryAfterMs: failure.wire.retryAfterMs } : { error: failure.error, code: failure.wire.code }),
        },
        ...(failure.code === 503 ? { headers: { "Retry-After": "1" } } : {}),
      };
    }
    // The cwd is decided; the token is released now (a live token does not re-check membership).
    admitted.release();
    return { cwd: admitted.cwd, info, claim, validator };
  }

  /** Phase 4 — run the plugin validator off-thread; the body comes back re-attached. */
  async function runValidator(
    r: Resolved,
    bytesIn: Buffer,
    ext: string,
  ): Promise<{ bytes: Buffer } | { out: Outcome; note: string }> {
    if (!r.validator) return { bytes: bytesIn };
    const out = await handlers.validatorPool.run({
      moduleUrl: r.validator.moduleUrl,
      bytes: bytesIn,
      ext,
    });
    if (out.kind === "ok") return { bytes: out.bytes };
    if (out.kind === "busy")
      return {
        out: fail(503, "validator busy; retry"),
        note: "validator=busy",
      };
    const msg =
      out.kind === "timeout"
        ? "validator timed out"
        : out.kind === "rejected"
          ? `rejected: ${out.reason}`
          : "validator failed";
    return { out: fail(422, msg), note: `validator=${out.kind}` };
  }

  async function handle(
    q: Query,
    bytesIn: Buffer,
    send: Send,
  ): Promise<Record<string, unknown>> {
    const parsed = parseRequest(q, bytesIn);
    if (isOutcome(parsed)) return send(parsed, {});
    const resolved = await resolveHandler(parsed, q.claim as string);
    if (isOutcome(resolved)) return send(resolved, {});
    const { cwd, info, claim, validator } = resolved;
    const authz = (): Promise<HandlerTarget | null> =>
      isWritableHandlerTarget(parsed.path, {
        cwd,
        claim: {
          extensions: claim.extensions ?? [],
          mode: claim.mode ?? "preview",
        },
        mode: parsed.mode,
      });
    const target = await authz();
    if (!target)
      return send(
        fail(403, "target is not a writable handler file in scope"),
        {},
      );
    const rel = (p: string): string =>
      path.relative(path.resolve(cwd), p).split(path.sep).join("/");
    const relPath = rel(target.requested);
    // A sibling is created next to the tab's OWN file: the source must resolve inside the cwd under a
    // claimed extension (a symlink escaping the cwd is refused, like an overwrite target).
    if (parsed.siblingExt !== undefined && (!within(target.real, target.root) || !(claim.extensions ?? []).includes(extOf(target.real)))) {
      return send(fail(403, "target is not a writable handler file in scope"), { relPath });
    }
    if (claim.validator === true && (!info.serverLoaded || !validator)) {
      return send(
        fail(
          503,
          "required validator is not loaded; retry after the plugin restarts",
        ),
        { relPath },
      );
    }
    if (
      parsed.mode === "copy" &&
      !(
        typeof claim.copySuffix === "string" &&
        FILE_HANDLER_COPY_SUFFIX_RE.test(claim.copySuffix)
      )
    ) {
      return send(fail(403, "claim has no copySuffix"), { relPath });
    }
    if (bytesIn.length > (claim.maxBytes ?? HANDLER_MAX_BYTES))
      return send(fail(413, "body exceeds the handler size limit"), {
        relPath,
      });

    const validated = await runValidator(resolved, bytesIn, parsed.siblingExt ?? target.ext);
    if ("out" in validated)
      return send(validated.out, { relPath, note: validated.note });
    const bytes = validated.bytes;
    const wctx: WriteCtx = {
      target,
      bytes,
      sha1: createHash("sha1").update(bytes).digest("hex"),
      rel,
    };
    const outcome =
      parsed.mode === "copy"
        ? await copy(wctx, claim.copySuffix as string, parsed.siblingExt)
        : await serializeWrite(target.real, () =>
            overwrite(wctx, parsed.expectSha1 as string, authz),
          );
    const conflict =
      parsed.mode === "overwrite" && outcome.code === 409
        ? `conflict=${outcome.body.sha1 ? "changed" : "missing"}`
        : undefined;
    const note = [conflict, parsed.siblingExt ? `sibling=${parsed.siblingExt}` : undefined].filter(Boolean).join(" ") || undefined;
    return send(outcome, { relPath, note });
  }
}

/** Evaluate a plugin's main-thread `enabled()` predicate; a throw counts as off. */
function safeEnabled(fn: () => boolean): boolean {
  try {
    return fn() === true;
  } catch {
    return false;
  }
}
