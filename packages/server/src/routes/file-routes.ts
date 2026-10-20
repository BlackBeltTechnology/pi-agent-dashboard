/**
 * File and directory browse REST API routes (localhost-only).
 */

import { createHash, randomBytes } from "node:crypto";
import { createReadStream, constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { DIGEST_CEILING_BYTES, fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { repairAsciiDoc } from "@blackbelt-technology/pi-dashboard-shared/markup-repair/asciidoc.js";
import { realpathAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import { type DenialRemedy, evaluateContainment } from "../access/containment-gate.js";
import { resolveCwdVerdict } from "../access/cwd-verdict.js";
import { type HoldTarget, holdDenial } from "../access/denial-hold.js";
import {
  assertRegularFile,
  openVerifiedRegularFile,
  readFileVerified,
  readFileVerifiedUtf8,
  VerifiedReadRefused,
} from "../access/verified-read.js";
import type { LocalTrustContext } from "../auth/local-proof.js";
import { canDiscloseAccessPosture, isLocallyTrusted } from "../auth/localhost-guard.js";
import {
  CreateProjectError,
  type CreateProjectReason,
  classifyPaths,
  createDirectory,
  createProjectDirectory,
  listDirectories,
  parseFlagsQuery,
} from "../browse.js";
import { isImageUnderArtifactRoot } from "../lib/artifact-roots.js";
import {
  BROWSE_OUTSIDE_ROOTS_ERROR,
  type BrowseRootSources,
  type BrowseRoots,
  buildBrowseRootSources,
  isWithinBrowseRoots,
  resolveBrowseRoots,
} from "../lib/browse-roots.js";
import { decodeFileUri } from "../lib/decode-file-uri.js";
import { renderDiagram } from "../lib/diagram-render.js";
import { createDigestGate, type DigestGate, type DigestLane } from "../lib/digest-gate.js";
import { EML_SIZE_CAP, loadParsedEml, toParseResult } from "../lib/eml.js";
import { enumerateMdCandidates } from "../lib/md-candidates.js";
import { extToContentType } from "../lib/mime-types.js";
import {
  createDefaultDocxPdfEngine,
  type DocxPdfEngine,
  type DocxRenderMode,
  OFFICE_CAPS,
  type OfficeCaps,
  parseSheet,
  pdfCachePath,
  renderDocx,
  renderPptx,
  resolveRowLimit,
} from "../lib/office-preview.js";
import { isAllowed, safeRealpath } from "../lib/path-containment.js";
import { loadPurify } from "../lib/purify.js";

/**
 * A gate failure. `error` is byte-identical to what the site returned before
 * this change; `reason`/`hint`/`subject`/`denialId` are ADDITIVE (design D7) so
 * the denial can name its remedy and bind a later grant to this refusal (D15).
 * `{ code, error }` stays INTERNAL — callers convert via `denialBody`.
 */
type GateFailure = { code: number; error: string } & Partial<DenialRemedy>;

/**
 * The single conversion from a gate failure to the wire body. Every containment
 * caller uses this so the additive fields cannot drift between sites, and so
 * pre-existing fields stay byte-identical (task 3.2).
 */
function denialBody(gate: GateFailure): ApiResponse {
  const body: Record<string, unknown> = { success: false, error: gate.error };
  if (gate.reason !== undefined) body.reason = gate.reason;
  if (gate.hint !== undefined) body.hint = gate.hint;
  if (gate.subject !== undefined) body.subject = gate.subject;
  if (gate.denialId !== undefined) body.denialId = gate.denialId;
  if (gate.ancestors !== undefined) body.ancestors = gate.ancestors;
  // Present only when the gate was told it may disclose (design D5).
  if (gate.promptOutcome !== undefined) body.promptOutcome = gate.promptOutcome;
  return body as unknown as ApiResponse;
}

import { serializeWrite } from "../lib/file-write-lock.js";
import { resolveFileMention } from "../lib/resolve-file-mention.js";
import { isWritableMdTarget } from "../lib/writable-md-target.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import {
  buildOpenCommand,
  buildRevealCommand,
  type OpenerCommand,
  runOpener,
  systemOpenCapability,
} from "../system-open-capability.js";
import { type FileHandlerDeps, registerFileWriteBinaryRoute } from "./file-write-binary-routes.js";
import type { NetworkGuard } from "./route-deps.js";

// Per-target write serialization. The optimistic mtime check + atomic rename
// must run as one critical section per file, else two concurrent writes can
// both read the same mtime, both pass, and the later rename clobbers the earlier
// write instead of returning 409. Keyed by resolved path; the chain swallows
// errors so one failed write does not poison the next. See change:
// directory-settings-page-and-scoped-md-editing.
// Fixed, server-derived `~/.pi` containment anchor shared by the resolve
// endpoint and the open/preview routes, so a resolved `~/.pi/…` path the
// resolve endpoint accepts also opens/previews without a 403 (design D7).
// Read at call time so it tracks the process HOME (fake-HOME safe in tests);
// never derived from request input. See change: server-side-file-mention-resolution.
function homePiAnchor(): string {
  return path.join(os.homedir(), ".pi");
}

/**
 * SHA-1 of an open handle, streamed in 1 MiB chunks (abortable between chunks).
 * Returns `null` when the file grew past the digest ceiling while being read, so
 * a hash of an unbounded stream is never reported. SHA-1 is a change detector
 * here, not a security primitive. See change: gate-changed-on-disk-by-content.
 */
async function hashHandle(fh: import("node:fs/promises").FileHandle, signal: AbortSignal): Promise<string | null> {
  const hash = createHash("sha1");
  const buf = Buffer.allocUnsafe(1024 * 1024);
  let total = 0;
  for (;;) {
    if (signal.aborted) {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }
    const { bytesRead } = await fh.read(buf, 0, buf.length, total);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > DIGEST_CEILING_BYTES) return null;
    hash.update(buf.subarray(0, bytesRead));
  }
  return hash.digest("hex");
}

// Resolve + scope-validate a markdown target shared by the write + md-read
// endpoints. Directory scope (cwd present) requires a known session; global
// scope requires an absolute path. Returns the resolved abs path, or {code,error}
// to map to a reply. Authorization (`isWritableMdTarget`) is applied by callers.
// See change: directory-settings-page-and-scoped-md-editing.
function resolveScopedMdPath(
  cwd: string | undefined,
  rawPath: string,
  sessionManager: SessionManager,
): { resolved: string } | { code: number; error: string } {
  if (cwd && !sessionManager.listAll().some((s) => s.cwd === cwd)) {
    return { code: 403, error: "unknown session path" };
  }
  const decoded = decodeFileUri(rawPath);
  if (!cwd && !path.isAbsolute(decoded)) {
    return { code: 400, error: "global scope requires an absolute path" };
  }
  return { resolved: cwd ? path.resolve(cwd, decoded) : path.resolve(decoded) };
}

/** Discriminated outcome of an atomic markdown write. */
type MdWriteOutcome =
  | { code: 200; mtime: number; size: number; sha1?: string }
  | { code: 404 | 409 | 413 | 500; error: string };

/** Parsed + authorized write request, or a {code,error} reply mapping. */
type MdWritePrep = { resolved: string; content: string; mtime: number } | { code: number; error: string };

// Parse, scope-validate, and authorize a `POST /api/file/write` body. Keeps the
// route handler trivial. Authorization is the `isWritableMdTarget` security
// boundary. See change: directory-settings-page-and-scoped-md-editing.
async function prepareMdWrite(
  body: { cwd?: unknown; path?: unknown; content?: unknown; mtime?: unknown },
  sessionManager: SessionManager,
): Promise<MdWritePrep> {
  const cwd = typeof body.cwd === "string" && body.cwd ? body.cwd : undefined;
  const rawPath = typeof body.path === "string" ? body.path : "";
  const content = typeof body.content === "string" ? body.content : undefined;
  const mtime = typeof body.mtime === "number" ? body.mtime : undefined;
  if (!rawPath || content === undefined || mtime === undefined) {
    return { code: 400, error: "path, content and mtime are required" };
  }
  const target = resolveScopedMdPath(cwd, rawPath, sessionManager);
  if ("code" in target) return target;
  if (!(await isWritableMdTarget(target.resolved, { cwd }))) {
    return { code: 403, error: "target is not a writable markdown file in scope" };
  }
  return { resolved: target.resolved, content, mtime };
}

// Atomic markdown write with optimistic-concurrency. Caller MUST run this inside
// `serializeWrite(resolved, …)` so the stat→write→rename is a per-target critical
// section. The tmp name is unpredictable and opened O_EXCL (`wx`), so a planted
// symlink at the tmp path cannot redirect the write outside the allowlist before
// rename. See change: directory-settings-page-and-scoped-md-editing.
async function performAtomicMdWrite(
  resolved: string,
  content: string,
  mtime: number,
): Promise<MdWriteOutcome> {
  // Canonicalize to the realpath target: an in-scope symlink to an allowed
  // markdown file is authorized by `isWritableMdTarget` on its realpath, so we
  // persist to the real file and leave the symlink intact (rename does not
  // follow symlinks). Missing file → 404.
  let real: string;
  let current: import("node:fs").Stats;
  try {
    real = await fs.realpath(resolved);
    current = await fs.stat(real);
  } catch {
    return { code: 404, error: "file not found" };
  }
  // Full-precision mtime token: rounding could collapse two fast saves into one
  // token and let a stale write pass the 409 check.
  if (current.mtimeMs !== mtime) {
    return { code: 409, error: "file changed on disk since it was loaded" };
  }
  const tmpPath = path.join(
    path.dirname(real),
    `.${path.basename(real)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  // Encode ONCE: the bytes written and the bytes hashed are the same buffer, so
  // the returned `sha1` is exactly what a later `/api/file/digest` reports (the
  // editor pane rebaselines from it so its own Save never raises the
  // changed-on-disk banner). See change: gate-changed-on-disk-by-content (D3).
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > DIGEST_CEILING_BYTES) return { code: 413, error: "content too large" };
  try {
    await fs.writeFile(tmpPath, bytes, { flag: "wx" });
    // Preserve the original file mode so a private (e.g. 0600) instruction file
    // is not widened to the umask default on replace.
    await fs.chmod(tmpPath, current.mode & 0o777);
    await fs.rename(tmpPath, real);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    return { code: 500, error: err instanceof Error ? err.message : "write failed" };
  }
  const after = await fs.stat(real);
  return {
    code: 200,
    mtime: after.mtimeMs,
    size: bytes.length,
    sha1: createHash("sha1").update(bytes).digest("hex"),
  };
}

// Lazy asciidoctor singleton. First call cost ~Opal init; the server is
// long-running so we eat it once. See change: render-file-previews.
// `createRequire`, not a bare `require`: the native TS loader runs this file as
// ESM, where `require` is undefined (jiti used to inject it). Same pattern as
// lib/purify.ts. See change: fix-appimage-cold-boot-latency.
const nativeRequire = createRequire(import.meta.url);
let asciidoctorInstance: any | null = null;
function getAsciidoctor(): any {
  if (!asciidoctorInstance) {
    const factory = nativeRequire("asciidoctor");
    asciidoctorInstance = factory();
  }
  return asciidoctorInstance;
}

interface AdocWarning {
  text: string;
  line: number | null;
}

/**
 * One synchronous convert with asciidoctor's global logger swapped for an in-memory
 * one, restored in `finally`. Synchronous ⇒ no cross-request interleaving.
 * See change: add-md-adoc-markup-repair (design D3).
 */
function convertAdocCapturingWarnings(source: string): { html: string; warnings: AdocWarning[] } {
  const adoc = getAsciidoctor();
  const { LoggerManager, MemoryLogger } = adoc;
  const prev = LoggerManager.getLogger();
  const memory = MemoryLogger.create();
  LoggerManager.setLogger(memory);
  try {
    // `showtitle`: embedded output otherwise drops the `= Title` doctitle.
    const html = adoc.convert(source, { safe: "secure", standalone: false, attributes: { showtitle: "" } });
    const warnings: AdocWarning[] = memory.getMessages().map((m: any) => {
      const loc = m.getSourceLocation?.();
      const line = loc?.getLineNumber?.();
      return { text: String(m.getText?.() ?? ""), line: typeof line === "number" ? line : null };
    });
    return { html: String(html), warnings };
  } finally {
    LoggerManager.setLogger(prev);
  }
}

// asciidoctor `safe:"secure"` still passes raw HTML through (`+++…+++`,
// `pass:[…]`), so the converted HTML is sanitized with DOMPurify before it is
// returned. `style` survives only as asciidoctor's own `<col style="width: N%;">`
// column widths. A module-scope hook function so `removeHook` matches by
// identity. See change: sanitize-untrusted-rendered-content.
const COL_WIDTH_STYLE_RE = /^\s*width:\s*[\d.]+%?;?\s*$/;
function keepColWidthStyleOnly(
  node: { nodeName: string },
  data: { attrName: string; attrValue: string; keepAttr: boolean },
): void {
  if (data.attrName !== "style") return;
  const tag = node.nodeName.toLowerCase();
  if ((tag !== "col" && tag !== "colgroup") || !COL_WIDTH_STYLE_RE.test(data.attrValue)) data.keepAttr = false;
}

async function sanitizeAdocHtml(html: string): Promise<string> {
  const purify = await loadPurify();
  // Defense in depth: `loadPurify` already refuses a DOM-less instance, but a
  // pass-through DOMPurify must never be able to return raw HTML here.
  if (purify.isSupported !== true) throw new Error("DOMPurify unavailable: cannot sanitize AsciiDoc");
  // Hooks are global to the shared instance; add → sanitize → remove contains
  // no `await`, so it cannot interleave with another sanitize call.
  purify.addHook("uponSanitizeAttribute", keepColWidthStyleOnly);
  try {
    return purify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"],
    });
  } finally {
    purify.removeHook("uponSanitizeAttribute", keepColWidthStyleOnly);
  }
}

// Shared anti-traversal gate for the EML routes — the SAME check as
// `/api/file/raw` (known session + `isAllowed` against the cwd anchor), factored
// so both new routes CALL it rather than re-implementing the containment logic
// (design D5). Returns the resolved abs path or a {code,error} reply mapping.
async function gateFilePath(
  cwd: string | undefined,
  relPath: string | undefined,
  sessionManager: SessionManager,
  /** `disclosure`: the caller may see `promptOutcome` (`canDiscloseAccessPosture`). */
  opts: { allowGrant?: boolean; disclosure?: boolean } = {},
): Promise<{ resolved: string; viaGrant: boolean } | GateFailure> {
  if (!cwd || !relPath) return { code: 400, error: "cwd and path parameters required" };
  if (!sessionManager.listAll().some((s) => s.cwd === cwd)) {
    return { code: 403, error: "unknown session path" };
  }
  const resolved = path.resolve(cwd, relPath);
  const decision = await evaluateContainment(resolved, [cwd], {
    site: "file-routes:gateFilePath",
    allowGrant: opts.allowGrant,
    disclosure: opts.disclosure,
  });
  if (!decision.allowed) {
    return { code: 403, error: "path outside working directory", ...decision.remedy };
  }
  // `viaGrant` MUST be propagated: `assertRegularFile` and the handle-verified
  // read are documented as grant-only (verified-read.ts), because they use
  // `lstat` and therefore refuse an in-scope final-component SYMLINK that
  // layers ①/② admit. Dropping it turned "apply only on a grant" into
  // "apply always".
  return { resolved, viaGrant: decision.viaGrant };
}

/**
 * The `GET /api/file` read gate, factored so `GET /api/file/digest` calls the
 * SAME code rather than a copy (spec: file-read-containment). decode → known
 * session → containment against `[cwd, ~/.pi]` (with the live request so an
 * eligible miss may be held for the operator) → `{ resolved, viaGrant }` or a
 * `GateFailure` whose `code`/`error`/remedy are exactly what `/api/file` has
 * always answered. `quiet` is the digest's background mode (no denial recorded,
 * never held). See change: gate-changed-on-disk-by-content (D4).
 */
async function gateReadPath(
  cwd: string | undefined,
  rawPath: string | undefined,
  req: {
    sessionManager: SessionManager;
    request: import("fastify").FastifyRequest;
    reply: import("fastify").FastifyReply;
    quiet?: boolean;
  },
): Promise<{ resolved: string; viaGrant: boolean; relPath: string } | GateFailure> {
  const relPath = rawPath ? decodeFileUri(rawPath) : rawPath;
  if (!cwd || !relPath) return { code: 400, error: "cwd and path parameters required" };
  if (!req.sessionManager.listAll().some((s) => s.cwd === cwd)) {
    return { code: 403, error: "unknown session path" };
  }
  const resolved = path.resolve(cwd, relPath);
  // Anchors include the fixed `~/.pi` allowlist so a resolved `~/.pi/…`
  // mention (from `/api/file/resolve-mention`) previews without a 403 (D7).
  const readDecision = await evaluateContainment(resolved, [cwd, homePiAnchor()], {
    site: "file-routes:read",
    ...(req.quiet ? { quiet: true } : { hold: { request: req.request, reply: req.reply } }),
    disclosure: canDiscloseAccessPosture(req.request),
    session: cwd,
    // Polymorphic: this route serves files AND directories, so the remedy
    // must name whichever the target is (task 4.5 round 2, B1).
    subjectKind: "auto",
  });
  if (!readDecision.allowed) {
    return { code: 403, error: "path outside working directory", ...readDecision.remedy };
  }
  return { resolved, viaGrant: readDecision.viaGrant, relPath };
}

const CREATE_PROJECT_STATUS: Record<CreateProjectReason, number> = {
  invalid_name: 400,
  reserved_name: 400,
  too_long: 400,
  outside_root: 400,
  not_a_directory: 409,
  root_not_a_directory: 409,
  home_missing: 500,
  fs_error: 500,
};

export function registerFileRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    preferencesStore: PreferencesStore;
    networkGuard: NetworkGuard;
    // Office-preview seams (change: render-office-previews). Injectable for
    // tests; production uses the document-converter-backed default + fixed caps.
    docxPdfEngine?: DocxPdfEngine;
    officeCaps?: OfficeCaps;
    docxRenderMode?: DocxRenderMode;
    // System-open seam (change: open-view-command-in-editor-pane, D9/D10).
    // Injectable so tests assert argv without spawning a real opener.
    systemOpen?: {
      capable?: () => boolean;
      run?: (cmd: string, args: string[]) => void;
      platform?: NodeJS.Platform;
    };
    // Hash-concurrency gate for `GET /api/file/digest` (change:
    // gate-changed-on-disk-by-content, D4). Injectable so tests observe slots.
    digestGate?: DigestGate;
    // Plugin file-handler registry/validator seams for `POST /api/file/write-binary`
    // (change: add-editor-pane-file-handlers). Absent → every handler save is refused (403).
    fileHandlers?: FileHandlerDeps;
    // Browse confinement (change: harden-server-capability-bounds, D1/D2).
    // `localTrust`: strict-mode context for `isLocallyTrusted`. `browseRootSources`:
    // the two root sources only server.ts can read (worktree-init trust roots and
    // project-scope access grants); pinned dirs, session cwds and workspace
    // folders come from `preferencesStore` / `sessionManager`.
    localTrust?: LocalTrustContext;
    browseRootSources?: Pick<BrowseRootSources, "worktreeRoots" | "projectGrants">;
    /** `browse.confineRemote` (default true). `false` = a remote caller browses like a local one. */
    browseConfineRemote?: boolean;
  },
) {
  const { sessionManager, preferencesStore, networkGuard } = deps;
  registerFileWriteBinaryRoute(fastify, { sessionManager, networkGuard, fileHandlers: deps.fileHandlers });
  const systemOpenCapable = deps.systemOpen?.capable ?? systemOpenCapability;
  const systemOpenRun = deps.systemOpen?.run ?? runOpener;
  const systemOpenPlatform = deps.systemOpen?.platform ?? process.platform;
  const officeCaps = deps.officeCaps ?? OFFICE_CAPS;
  const docxRenderMode = deps.docxRenderMode ?? "auto";
  const docxPdfEngine = deps.docxPdfEngine ?? createDefaultDocxPdfEngine();
  const digestGate = deps.digestGate ?? createDigestGate(2);

  // Shared office-file gate (change: render-office-previews). Reuses the
  // `/api/file/raw` anti-traversal posture (known cwd + containment) and adds
  // an extension allowlist (else 400) plus a `stat.size` cap (>cap → 413
  // BEFORE any read). Returns the resolved path + stat, or a {code,error}.
  async function gateOfficeFile(
    cwd: string | undefined,
    relPath: string | undefined,
    allowedExts: string[],
    sizeCap: number,
    /** The caller may see `promptOutcome` (`canDiscloseAccessPosture`). */
    disclosure: boolean,
  ): Promise<
    | { resolved: string; ext: string; stat: import("node:fs").Stats; viaGrant: boolean }
    | GateFailure
  > {
    if (!cwd || !relPath) return { code: 400, error: "cwd and path parameters required" };
    const ext = path.extname(relPath).toLowerCase();
    if (!allowedExts.includes(ext)) return { code: 400, error: "renderer not supported for extension" };
    if (!sessionManager.listAll().some((s) => s.cwd === cwd)) {
      return { code: 403, error: "unknown session path" };
    }
    const resolved = path.resolve(cwd, relPath);
    const decision = await evaluateContainment(resolved, [cwd], { site: "file-routes:gateOfficeFile", disclosure });
    if (!decision.allowed) {
      return { code: 403, error: "path outside working directory", ...decision.remedy };
    }
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(resolved);
    } catch {
      return { code: 404, error: "not found" };
    }
    if (stat.size > sizeCap) return { code: 413, error: "file too large to preview" };
    // A grant-admitted office/EML file is refused unless it is a regular file
    // (design D14, task 2.8). This gate hands a PATH to an out-of-process
    // renderer, so it closes the blocking hazard (a granted FIFO would otherwise
    // be opened and hang the request) but not the inode bind — see
    // `assertRegularFile`.
    if (decision.viaGrant) {
      try {
        await assertRegularFile(resolved);
      } catch (err) {
        if (err instanceof VerifiedReadRefused) {
          return { code: 403, error: "path outside working directory" };
        }
        throw err;
      }
    }
    return { resolved, ext, stat, viaGrant: decision.viaGrant };
  }

  // Browse confinement applies ONLY to requests that are not genuinely local
  // (tunnel, LAN, relayed loopback). Returns the shared-root set to enforce, or
  // `null` for a local request (unrestricted picker). Roots are recomputed per
  // request so a pin / unpin / grant applies immediately.
  // See change: harden-server-capability-bounds (D1, D2).
  const browseRootSources = buildBrowseRootSources({
    preferencesStore,
    sessionManager,
    worktreeRoots: deps.browseRootSources?.worktreeRoots,
    projectGrants: deps.browseRootSources?.projectGrants,
  });
  async function confinedRoots(request: { ip: string; headers: Record<string, unknown> }): Promise<BrowseRoots | null> {
    if (deps.browseConfineRemote === false) return null;
    if (isLocallyTrusted({ ip: request.ip, headers: request.headers }, deps.localTrust)) return null;
    return resolveBrowseRoots(browseRootSources);
  }
  const refuseOutsideRoots = (reply: { code(n: number): unknown }, route: string, requested: string) => {
    // JSON.stringify: the path is caller-controlled, so a newline must not forge a log line.
    console.warn(`[browse] refused ${route}: ${JSON.stringify(requested)} is outside the shared roots`);
    reply.code(403);
    return { success: false, error: BROWSE_OUTSIDE_ROOTS_ERROR } satisfies ApiResponse;
  };

  // Directory browse endpoint.
  // `detect=1` opts into eager `.git` / `.pi` classification on every entry
  // (anything other than the literal string `"1"` is treated as falsy).
  // Without `detect`, this is a single-readdir enumeration with no filesystem
  // probes — use `GET /api/browse/flags` to classify lazily.
  // See change: split-browse-flags.
  fastify.get<{ Querystring: { path?: string; q?: string; detect?: string } }>(
    "/api/browse",
    { preHandler: networkGuard },
    async (request, reply) => {
      const roots = await confinedRoots(request);
      const requested = request.query.path || undefined;
      if (roots && requested && !(await isWithinBrowseRoots(requested, roots))) {
        return refuseOutsideRoots(reply, "GET /api/browse", requested);
      }
      try {
        const result = await listDirectories(
          requested,
          request.query.q || undefined,
          { detect: request.query.detect === "1" },
        );
        if (roots) {
          result.confined = true;
          // Never offer a `..` row that leads to a refused directory.
          if (result.parent && !(await isWithinBrowseRoots(result.parent, roots))) result.parent = null;
        }
        return { success: true, data: result } satisfies ApiResponse;
      } catch {
        return { success: false, error: "directory not found" } satisfies ApiResponse;
      }
    },
  );

  // Bulk directory flag classifier. Accepts `paths=<json-array>` (URL-encoded
  // JSON array of absolute path strings, length ≤ 100). Returns
  // `{ flags: { [path]: { isGit, isPi } } }`. Per-path probe failures map to
  // `{ isGit: false, isPi: false }` — only malformed input or over-cap
  // requests produce a top-level error (HTTP 400).
  // See change: split-browse-flags.
  fastify.get<{ Querystring: { paths?: string } }>(
    "/api/browse/flags",
    { preHandler: networkGuard },
    async (request, reply) => {
      const parsed = parseFlagsQuery(request.query.paths);
      if (!parsed.ok) {
        reply.code(400);
        return { success: false, error: parsed.error } satisfies ApiResponse;
      }
      const roots = await confinedRoots(request);
      if (roots) {
        for (const p of parsed.paths) {
          if (!(await isWithinBrowseRoots(p, roots))) return refuseOutsideRoots(reply, "GET /api/browse/flags", p);
        }
      }
      const flags = await classifyPaths(parsed.paths);
      return { success: true, data: { flags } } satisfies ApiResponse;
    },
  );

  // Directory create endpoint
  fastify.post<{ Body: { parent?: unknown; name?: unknown } }>(
    "/api/browse/mkdir",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const parent = typeof body.parent === "string" ? body.parent : "";
      const name = typeof body.name === "string" ? body.name : "";
      // A remote caller may create only inside the shared roots; checked before any fs write.
      const roots = await confinedRoots(request);
      if (roots && parent && !(await isWithinBrowseRoots(parent, roots))) {
        return refuseOutsideRoots(reply, "POST /api/browse/mkdir", parent);
      }
      try {
        const newPath = await createDirectory(parent, name);
        return { success: true, data: { path: newPath } } satisfies ApiResponse;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "mkdir failed";
        // Map known errors to status codes; unknown → 500
        if (msg === "invalid name") reply.code(400);
        else if (msg === "parent not found") reply.code(404);
        else if (msg === "parent is not a directory") reply.code(400);
        else if (msg === "already exists") reply.code(409);
        else reply.code(500);
        return { success: false, error: msg } satisfies ApiResponse;
      }
    },
  );

  // First-run project create: `<home>/Projects/<name>`, create-or-reuse, realpath-contained.
  // Server-side validation only; `reason` is a stable machine code for the client.
  // See change: streamline-first-run (design D4).
  fastify.post<{ Body: { name?: unknown } }>(
    "/api/browse/create-project",
    { preHandler: networkGuard },
    async (request, reply) => {
      const name = (request.body ?? {}).name;
      const nameForLog =
        typeof name === "string" ? JSON.stringify(name.slice(0, 64)) : "<non-string>";
      const bytes = typeof name === "string" ? Buffer.byteLength(name, "utf8") : 0;
      try {
        const result = await createProjectDirectory(name);
        console.log(
          `[create-project] ${result.existed ? "reused" : "created"} name=${nameForLog} bytes=${bytes}`,
        );
        return { success: true, data: result } satisfies ApiResponse;
      } catch (err) {
        const reason: CreateProjectReason = err instanceof CreateProjectError ? err.reason : "fs_error";
        const error = err instanceof Error ? err.message : "create-project failed";
        console.log(`[create-project] rejected:${reason} name=${nameForLog} bytes=${bytes}`);
        reply.code(CREATE_PROJECT_STATUS[reason]);
        return { success: false, error, reason };
      }
    },
  );

  // File read endpoint — read file content or list directory
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file",
    { preHandler: networkGuard },
    async (request, reply) => {
      const gate = await gateReadPath(request.query.cwd, request.query.path, { sessionManager, request, reply });
      if ("code" in gate) {
        reply.code(gate.code);
        return denialBody(gate);
      }
      const { resolved } = gate;

      try {
        const stat = await fs.stat(resolved);
        if (stat.isDirectory()) {
          const entries = await fs.readdir(resolved);
          entries.sort();
          return { success: true, data: { type: "directory", entries } } satisfies ApiResponse;
        }
        // Classify by extension + a bounded sniff (first 1024 bytes) so binary
        // files are not slurped whole just to discriminate. Content is returned
        // for text-renderable kinds (monaco / markdown viewers) AND any
        // `editable` kind (`.csv`, `.adoc`, so Monaco Edit can load the raw
        // text); image / pdf / binary / office tabs fetch their own bytes.
        // Binary spreadsheets (`.xlsx`/`.xls`) stay `editable:false` → no
        // `content` (no binary-bytes-in-JSON leak).
        // See change: add-internal-monaco-editor-pane,
        //             open-view-command-in-editor-pane (D4).
        // A grant-admitted read is verified against the OPEN HANDLE, not a
        // re-resolved path (design D14, task 2.8): containment and this open are
        // two syscalls, so without it the path could be swapped for a symlink or
        // a FIFO in the gap. Layer ①/② reads keep the pre-existing open.
        const fh = gate.viaGrant
          ? await openVerifiedRegularFile(resolved)
          : await fs.open(resolved, "r");
        let kindResult;
        let content: string | undefined;
        try {
          const sniffLen = Math.min(1024, stat.size);
          const sniff = Buffer.alloc(sniffLen);
          if (sniffLen > 0) await fh.read(sniff, 0, sniffLen, 0);
          kindResult = fileKind(resolved, sniff);
          if (
            kindResult.viewer === "monaco" ||
            kindResult.viewer === "markdown" ||
            kindResult.editable === true
          ) {
            content = await fh.readFile("utf-8");
          }
        } finally {
          await fh.close();
        }
        return {
          success: true,
          data: {
            type: "file",
            kind: kindResult.kind,
            mimeType: kindResult.mimeType,
            size: stat.size,
            // mtime drives the editor's optimistic-concurrency check on write.
            // Full precision: `/api/file/write` compares against raw `mtimeMs`,
            // so a rounded token 409s on every save on sub-ms filesystems.
            // See change: directory-settings-page-and-scoped-md-editing,
            // fix-editor-mtime-token-precision.
            mtime: stat.mtimeMs,
            ...(content !== undefined ? { content } : {}),
          },
        } satisfies ApiResponse;
      } catch (err) {
        if (err instanceof VerifiedReadRefused) {
          // A granted path whose file is not a regular file, or was swapped
          // between the check and the open. Refused in the site's existing
          // containment shape — deliberately no new user-facing string.
          reply.code(403);
          return { success: false, error: "path outside working directory" } satisfies ApiResponse;
        }
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
    },
  );

  // Content digest for the editor pane's changed-on-disk verification. Same
  // read gate as `/api/file` (`gateReadPath`) and the same open rule (verified
  // open only when grant-admitted, else a non-blocking open + `fstat`), but it
  // never returns content: `{ size, mtime, sha1 }`. Above the fixed 256 MiB
  // ceiling it returns `{ size, mtime }` without a hash. Hashing is bounded by
  // a 2-wide two-lane gate (baseline before verify) whose slot is released on
  // client abort. No cache (equal size+mtime across two writes would hide a
  // real change). See change: gate-changed-on-disk-by-content (D4).
  fastify.get<{ Querystring: { cwd?: string; path?: string; purpose?: string } }>(
    "/api/file/digest",
    { preHandler: networkGuard },
    async (request, reply) => {
      const gate = await gateReadPath(request.query.cwd, request.query.path, {
        sessionManager,
        request,
        reply,
        quiet: true,
      });
      reply.header("Cache-Control", "no-store");
      if ("code" in gate) {
        reply.code(gate.code);
        return denialBody(gate);
      }
      const lane: DigestLane = request.query.purpose === "baseline" ? "baseline" : "verify";
      const ac = new AbortController();
      const onClose = (): void => {
        if (!reply.raw.writableFinished) ac.abort();
      };
      reply.raw.once("close", onClose);
      let release: (() => void) | undefined;
      try {
        release = await digestGate.acquire(lane, ac.signal);
        const fh = gate.viaGrant
          ? await openVerifiedRegularFile(gate.resolved)
          : await fs.open(gate.resolved, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0));
        try {
          const stat = await fh.stat();
          if (!stat.isFile()) {
            reply.code(404);
            return { success: false, error: "not found" } satisfies ApiResponse;
          }
          const data: { size: number; mtime: number; sha1?: string } = { size: stat.size, mtime: stat.mtimeMs };
          if (stat.size <= DIGEST_CEILING_BYTES) {
            const sha1 = await hashHandle(fh, ac.signal);
            if (sha1 !== null) data.sha1 = sha1;
          }
          return { success: true, data } satisfies ApiResponse;
        } finally {
          await fh.close();
        }
      } catch (err) {
        if (err instanceof VerifiedReadRefused) {
          reply.code(403);
          return { success: false, error: "path outside working directory" } satisfies ApiResponse;
        }
        if ((err as Error)?.name === "AbortError") {
          // Client went away — nobody is reading the reply.
          reply.code(499);
          return { success: false, error: "aborted" } satisfies ApiResponse;
        }
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      } finally {
        release?.();
        reply.raw.off("close", onClose);
      }
    },
  );

  // System-open endpoints (change: open-view-command-in-editor-pane, D9/D10).
  // Spawn the OS opener on the SERVER host for the active tab's file. All of:
  //   - refuse when `capabilities.systemOpen` is false (headless/container),
  //   - reject a non-loopback OR absent request Origin (absent = don't-know =
  //     deny; the legit same-origin client sends Origin on a POST),
  //   - reuse the `/api/file` containment gate (path must sit under a known
  //     session cwd),
  //   - spawn via `execFile` with an argv ARRAY (no shell — a path with a
  //     comma/space/quote cannot inject).
  // They never read file content.
  const isLoopbackOrigin = (origin: string | undefined): boolean => {
    if (!origin) return false; // absent → treat as non-loopback (deny)
    try {
      const host = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    } catch {
      return false;
    }
  };

  const handleSystemOpen = async (
    request: import("fastify").FastifyRequest<{ Body: { cwd?: unknown; path?: unknown } }>,
    reply: import("fastify").FastifyReply,
    build: (platform: NodeJS.Platform, resolved: string) => OpenerCommand,
  ): Promise<ApiResponse> => {
    if (!systemOpenCapable()) {
      reply.code(403);
      return { success: false, error: "system open not available on this host" };
    }
    if (!isLoopbackOrigin(request.headers.origin as string | undefined)) {
      reply.code(403);
      return { success: false, error: "forbidden origin" };
    }
    const cwd = typeof request.body?.cwd === "string" ? request.body.cwd : undefined;
    const rawPath = typeof request.body?.path === "string" ? request.body.path : undefined;
    // `allowGrant: false` — a read grant must NOT authorize launching a local
    // application or revealing in the file manager. Those are a different
    // capability from reading, so the two spawn routes keep the pre-change
    // `isAllowed`-only decision (task 4.5 review gate, blocking #2).
    const gate = await gateFilePath(cwd, rawPath, sessionManager, {
      allowGrant: false,
      disclosure: canDiscloseAccessPosture(request),
    });
    if ("code" in gate) {
      reply.code(gate.code);
      return denialBody(gate);
    }
    const { cmd, args } = build(systemOpenPlatform, gate.resolved);
    systemOpenRun(cmd, args);
    return { success: true, data: { spawned: true } };
  };

  fastify.post<{ Body: { cwd?: unknown; path?: unknown } }>(
    "/api/open-in-system",
    { preHandler: networkGuard },
    (request, reply) => handleSystemOpen(request, reply, buildOpenCommand),
  );

  fastify.post<{ Body: { cwd?: unknown; path?: unknown } }>(
    "/api/reveal-in-file-manager",
    { preHandler: networkGuard },
    (request, reply) => handleSystemOpen(request, reply, buildRevealCommand),
  );

  // Tree-listing endpoint — single source of truth for the editor-pane file
  // rail. Returns `{ entries: {name,isDir}[] }` from ONE
  // `readdir(withFileTypes)`, hidden entries INCLUDED, behind the same gate as
  // `/api/file` (known-cwd + containment). Replaces the old
  // `/api/file`(names)+`/api/browse`(dirs, hidden-stripped) merge that
  // mislabelled hidden directories (`.git`, `.pi`) as files.
  // See change: improve-content-editor.
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file/tree",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      const relPath = request.query.path ? decodeFileUri(request.query.path) : request.query.path;
      if (!cwd || !relPath) {
        reply.code(400);
        return { success: false, error: "cwd and path parameters required" } satisfies ApiResponse;
      }

      if (!sessionManager.listAll().some((s) => s.cwd === cwd)) {
        reply.code(403);
        return { success: false, error: "unknown session path" } satisfies ApiResponse;
      }

      const resolved = path.resolve(cwd, relPath);
      const treeDecision = await evaluateContainment(resolved, [cwd], {
        site: "file-routes:tree",
        hold: { request, reply },
        disclosure: canDiscloseAccessPosture(request),
        session: cwd,
        // Directory-only site: the remedy must name THIS directory, not its
        // parent (task 4.5 review).
        subjectKind: "directory",
      });
      if (!treeDecision.allowed) {
        reply.code(403);
        return { success: false, error: "path outside working directory", ...treeDecision.remedy } as unknown as ApiResponse;
      }

      try {
        const dirents = await fs.readdir(resolved, { withFileTypes: true });
        // `Dirent.isDirectory()` reflects the entry itself, so a symlink → dir
        // reports `false` (isSymbolicLink true). Follow symlinks with a bounded
        // `stat` so symlinked directories still render + expand as folders. Only
        // symlink entries pay the extra stat; normal entries stay single-readdir.
        const entries = await Promise.all(
          dirents.map(async (d) => {
            let isDir = d.isDirectory();
            if (!isDir && d.isSymbolicLink()) {
              try {
                isDir = (await fs.stat(path.join(resolved, d.name))).isDirectory();
              } catch {
                isDir = false; // dangling symlink → treat as a (broken) file
              }
            }
            return { name: d.name, isDir };
          }),
        );
        entries.sort((a, b) =>
          a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
        );
        return { success: true, data: { entries } } satisfies ApiResponse;
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
    },
  );

  // Markdown write endpoint — the dashboard's first user-facing write surface.
  //
  // Body: { cwd?, path, content, mtime }.
  //   - cwd present  → directory scope: `path` resolves against cwd; the cwd
  //     must be a known session path (mirrors the read gate).
  //   - cwd absent   → global scope: `path` must be absolute under ~/.pi/agent.
  //
  // Authorization is delegated entirely to `isWritableMdTarget` (the security
  // boundary): realpath-normalized, markdown-only, scope-bounded. Failure → 403.
  // Optimistic concurrency: the on-disk mtime must equal the buffer's loaded
  // mtime, else 409 and the file is left untouched. Success writes atomically
  // (tmp + rename) and returns the new mtime.
  // See change: directory-settings-page-and-scoped-md-editing.
  fastify.post<{ Body: { cwd?: unknown; path?: unknown; content?: unknown; mtime?: unknown } }>(
    "/api/file/write",
    // 256 MiB of content plus JSON escaping headroom. Fastify's default 1 MiB
    // limit made any markdown save over ~1 MiB fail with 413 (pre-existing bug);
    // the handler still refuses content above the 256 MiB ceiling.
    { preHandler: networkGuard, bodyLimit: 600 * 1024 * 1024 },
    async (request, reply) => {
      const prep = await prepareMdWrite(request.body ?? {}, sessionManager);
      if ("code" in prep) {
        reply.code(prep.code);
        return { success: false, error: prep.error } satisfies ApiResponse;
      }
      // Critical section: stat → mtime check → write → rename runs serialized per
      // target so the optimistic check is atomic w.r.t. a concurrent write.
      // Keyed by REALPATH (shared with `/api/file/write-binary`) so a symlink alias
      // cannot run two writes to one file at once. See change: add-editor-pane-file-handlers (D4).
      const lockKey = await safeRealpath(prep.resolved);
      const outcome = await serializeWrite(lockKey, () =>
        performAtomicMdWrite(prep.resolved, prep.content, prep.mtime),
      );
      if (outcome.code !== 200) {
        reply.code(outcome.code);
        return { success: false, error: outcome.error } satisfies ApiResponse;
      }
      return {
        success: true,
        data: { mtime: outcome.mtime, size: outcome.size, sha1: outcome.sha1 },
      } satisfies ApiResponse;
    },
  );

  // Scoped markdown candidate list for the Instructions file picker.
  //   - `cwd` present → directory scope (must be a known session path).
  //   - `cwd` absent  → global scope (~/.pi/agent).
  // Every candidate passes `isWritableMdTarget`, so the picker is a strict
  // subset of what the write guard authorizes (picker ⊆ guard).
  // See change: directory-settings-page-and-scoped-md-editing.
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/file/md-candidates",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd || undefined;
      if (cwd) {
        const allSessions = sessionManager.listAll();
        if (!allSessions.some((s) => s.cwd === cwd)) {
          reply.code(403);
          return { success: false, error: "unknown session path" } satisfies ApiResponse;
        }
      }
      const candidates = await enumerateMdCandidates({ cwd });
      return { success: true, data: { candidates } } satisfies ApiResponse;
    },
  );

  // Scoped markdown read for the Instructions editor. Gated by the SAME
  // `isWritableMdTarget` guard as the write + candidate endpoints, so read /
  // write / list stay in lockstep (picker ⊆ guard). Unlike `/api/file`, this
  // serves the global scope (no session cwd) for `~/.pi/agent/**/*.md`.
  //   - `cwd` present → directory scope (must be a known session path).
  //   - `cwd` absent  → global scope; `path` must be absolute.
  // Returns `{ content, mtime }`. See change: directory-settings-page-and-scoped-md-editing.
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file/md-read",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd || undefined;
      const rawPath = request.query.path;
      if (!rawPath) {
        reply.code(400);
        return { success: false, error: "path parameter required" } satisfies ApiResponse;
      }
      const target = resolveScopedMdPath(cwd, rawPath, sessionManager);
      if ("code" in target) {
        reply.code(target.code);
        return { success: false, error: target.error } satisfies ApiResponse;
      }
      const resolved = target.resolved;
      if (!(await isWritableMdTarget(resolved, { cwd }))) {
        reply.code(403);
        return { success: false, error: "target is not a readable markdown file in scope" } satisfies ApiResponse;
      }
      try {
        const stat = await fs.stat(resolved);
        const content = await fs.readFile(resolved, "utf-8");
        // Full-precision mtime token (matches the write-side conflict check).
        return {
          success: true,
          data: { content, mtime: stat.mtimeMs },
        } satisfies ApiResponse;
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
    },
  );

  // Lightweight path-existence probe (change: openspec-worktree-spawn-button).
  //
  // Returns 200 when the absolute `path` query param exists on disk
  // (file or directory), 404 otherwise. Used by WorktreeSpawnDialog to
  // detect orphan-path collisions before submit. Gated on `cwd` being a
  // known session or pinned directory to avoid arbitrary filesystem
  // probes from an authenticated browser.
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file/exists",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      const probePath = request.query.path;
      if (!cwd || !probePath) {
        reply.code(400);
        return { success: false, error: "cwd and path parameters required" } satisfies ApiResponse;
      }
      const allSessions = sessionManager.listAll();
      const knownCwds = new Set(allSessions.map((s) => s.cwd));
      for (const dir of preferencesStore.getPinnedDirectories()) knownCwds.add(dir);
      // The unknown-cwd denial may ask the operator (add-access-grant-dialog,
      // task 6.2). An allow verdict authorises a RE-RUN of this same guard, never
      // a skip: `allow-always` pinned the directory, so the live pinned set must
      // now contain it; `allow-once` admits exactly the named directory, for this
      // request only. Every other outcome returns the unchanged denial below.
      const cwdAdmitted =
        knownCwds.has(cwd) ||
        (await unknownCwdVerdictAdmits(cwd, { request, reply }, () => [
          ...sessionManager.listAll().map((s) => s.cwd),
          ...preferencesStore.getPinnedDirectories(),
        ]));
      if (!cwdAdmitted) {
        reply.code(403);
        // Additive remedy fields beside the unchanged `"unknown cwd"` string
        // (design D7/D18); the known-cwd set already includes pinned
        // directories, so pinning the refused directory is the offered remedy.
        // The `"path outside cwd"` refusals below are a different site and keep
        // their shape (the relative-probe guard carries no remedy). See change:
        // add-access-grants-and-review.
        return {
          success: false,
          error: "unknown cwd",
          reason: "cwd is not a known session or pinned directory.",
          hint: "Pin this directory to allow it, or open a session rooted in it.",
        } as unknown as ApiResponse;
      }
      // Anti-traversal: probePath MUST be inside cwd (or a pinned dir / repo
      // git root). Pinned-dir anchor is exists-only; not folded onto read/raw/render.
      // Reject relative probes up front: `path.resolve(relative)` would anchor
      // on the SERVER process cwd, not the request cwd — with git-root widening
      // that could turn a malformed probe into an existence check under the
      // server's launch repo. The endpoint contract takes an absolute path.
      if (!path.isAbsolute(probePath)) {
        reply.code(403);
        return { success: false, error: "path outside cwd" } satisfies ApiResponse;
      }
      const resolved = path.resolve(probePath);
      const anchors = [cwd, ...preferencesStore.getPinnedDirectories()];
      const existsDecision = await evaluateContainment(resolved, anchors, {
        site: "file-routes:exists",
        hold: { request, reply },
        disclosure: canDiscloseAccessPosture(request),
        session: cwd,
        // `fs.access` accepts files AND directories — polymorphic, see above.
        subjectKind: "auto",
      });
      if (!existsDecision.allowed) {
        reply.code(403);
        return { success: false, error: "path outside cwd", ...existsDecision.remedy } as unknown as ApiResponse;
      }
      try {
        await fs.access(resolved);
        return { success: true, data: { exists: true } } satisfies ApiResponse;
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
    },
  );

  // Lazy file-mention resolver (change: server-side-file-mention-resolution).
  //
  // Body `{ cwd, mention }` → `{ resolved, kind }` or `{ resolved: null }`.
  // `cwd` is UNTRUSTED request input and is gated against the known-session set
  // (mirrors `/api/file`, NOT the wider exists-only pinned set — design D2/F6/F7,
  // so a resolve never succeeds on a path the open route would 403) BEFORE any
  // resolution. `resolveFileMention` then expands `~/`, runs containment
  // (cwd + git-root + `~/.pi`) BEFORE `fs.stat`, and returns null for a
  // non-existent in-scope mention (never an error).
  fastify.post<{ Body: { cwd?: unknown; mention?: unknown } }>(
    "/api/file/resolve-mention",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const cwd = typeof body.cwd === "string" ? body.cwd : "";
      const mention = typeof body.mention === "string" ? body.mention : "";
      if (!cwd || !mention) {
        reply.code(400);
        return { success: false, error: "cwd and mention are required" } satisfies ApiResponse;
      }
      if (!sessionManager.listAll().some((s) => s.cwd === cwd)) {
        reply.code(403);
        return { success: false, error: "unknown session path" } satisfies ApiResponse;
      }
      const result = await resolveFileMention(mention, { cwd });
      return {
        success: true,
        data: result ? { resolved: result.resolved, kind: result.kind } : { resolved: null },
      } satisfies ApiResponse;
    },
  );

  // Pinned directories endpoint
  fastify.get("/api/pinned-dirs", async () => {
    return { success: true, data: preferencesStore.getPinnedDirectories() } satisfies ApiResponse;
  });

  // Favorite models endpoint (cold-load for the selector).
  // See change: enrich-model-selector-capabilities-favorites.
  fastify.get("/api/favorite-models", async () => {
    return { success: true, data: { labels: preferencesStore.getFavoriteModels() } } satisfies ApiResponse;
  });

  // Binary-safe file streaming endpoint (change: render-file-previews).
  // Streams the file bytes with `Content-Type` from extension, supports
  // HTTP Range so `<video>` seek works. Same cwd-allowlist + anti-traversal
  // gate as `/api/file`. Sets `Content-Disposition: inline` and a short
  // private cache.
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file/raw",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      const relPath = request.query.path;
      if (!cwd || !relPath) {
        reply.code(400);
        return { success: false, error: "cwd and path parameters required" } satisfies ApiResponse;
      }

      const allSessions = sessionManager.listAll();
      if (!allSessions.some((s) => s.cwd === cwd)) {
        reply.code(403);
        return { success: false, error: "unknown session path" } satisfies ApiResponse;
      }

      const resolved = path.resolve(cwd, relPath);
      // Layers ①/② (cwd + git common root) serve any type. Layer ③ — artifact
      // roots — is image-only and real-path contained; it covers agent
      // screenshots that live outside every cwd and git root.
      // See change: serve-agent-artifact-previews.
      // Ordering is load-bearing (design D1): the image-only artifact-root
      // admission at this site ("Layer ③" in source) runs BEFORE the grant
      // layer, and the grant layer is never consulted when it admits.
      // True only when the GRANT layer admitted this read — layers ①/② and the
      // artifact root do NOT get handle verification (task 2.8 scope).
      let viaGrant = false;
      if (!(await isAllowed(resolved, { anchors: [cwd, homePiAnchor()] }))) {
        if (!(await isImageUnderArtifactRoot(resolved))) {
          const rawDecision = await evaluateContainment(resolved, [cwd, homePiAnchor()], {
            site: "file-routes:raw",
            hold: { request, reply },
            disclosure: canDiscloseAccessPosture(request),
            session: cwd,
          });
          if (!rawDecision.allowed) {
            reply.code(403);
            return { success: false, error: "path outside working directory", ...rawDecision.remedy } as unknown as ApiResponse;
          }
          viaGrant = rawDecision.viaGrant;
        }
      }

      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
      if (!stat.isFile()) {
        // Already refuses a FIFO/dir before any open, and so before it could
        // block. Unchanged for every admission path.
        reply.code(404);
        return { success: false, error: "not a file" } satisfies ApiResponse;
      }

      const ext = path.extname(resolved);
      const contentType = extToContentType(ext);
      const size = stat.size;

      reply.header("Content-Type", contentType);
      reply.header("Content-Disposition", "inline");
      reply.header("Cache-Control", "private, max-age=60");
      reply.header("Accept-Ranges", "bytes");

      // Range support — required for video seek. Parse a single
      // `bytes=start-end` range; reject multipart/syntax errors with 416.
      //
      // Parsed BEFORE the verified handle is opened below. The 416 paths return
      // early, so opening first leaked one descriptor per malformed range —
      // `Range: bytes=abc` repeated against any grant-admitted file drove the
      // process to EMFILE. Keeping the open after this block makes the leak
      // impossible by construction rather than by remembering to close.
      const rangeHeader = request.headers.range;
      let range: { start: number; end: number } | undefined;
      if (rangeHeader && /^bytes=/.test(rangeHeader)) {
        const spec = rangeHeader.slice("bytes=".length).trim();
        const m = /^(\d*)-(\d*)$/.exec(spec);
        if (!m) {
          reply.code(416);
          reply.header("Content-Range", `bytes */${size}`);
          return reply.send();
        }
        const startStr = m[1];
        const endStr = m[2];
        let start: number;
        let end: number;
        if (startStr === "" && endStr === "") {
          reply.code(416);
          reply.header("Content-Range", `bytes */${size}`);
          return reply.send();
        } else if (startStr === "") {
          // Suffix range: last N bytes
          const suffix = parseInt(endStr, 10);
          if (suffix <= 0) {
            reply.code(416);
            reply.header("Content-Range", `bytes */${size}`);
            return reply.send();
          }
          start = Math.max(0, size - suffix);
          end = size - 1;
        } else {
          start = parseInt(startStr, 10);
          end = endStr === "" ? size - 1 : parseInt(endStr, 10);
        }
        if (start > end || start >= size || end >= size) {
          reply.code(416);
          reply.header("Content-Range", `bytes */${size}`);
          return reply.send();
        }
        range = { start, end };
      }

      // A grant-admitted read additionally binds the bytes served to the inode
      // that was checked (design D14, task 2.8).
      let grantedHandle: Awaited<ReturnType<typeof openVerifiedRegularFile>> | undefined;
      if (viaGrant) {
        try {
          grantedHandle = await openVerifiedRegularFile(resolved);
        } catch (err) {
          if (err instanceof VerifiedReadRefused) {
            reply.code(403);
            return { success: false, error: "path outside working directory" } satisfies ApiResponse;
          }
          reply.code(404);
          return { success: false, error: "not found" } satisfies ApiResponse;
        }
      }

      if (range) {
        reply.code(206);
        reply.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
        reply.header("Content-Length", String(range.end - range.start + 1));
        return reply.send(
          grantedHandle
            ? grantedHandle.createReadStream({ start: range.start, end: range.end })
            : createReadStream(resolved, { start: range.start, end: range.end }),
        );
      }

      reply.header("Content-Length", String(size));
      return reply.send(grantedHandle ? grantedHandle.createReadStream() : createReadStream(resolved));
    },
  );

  // Server-side render endpoint (change: render-file-previews;
  // render-office-previews). `.adoc`/`.asciidoc` → asciidoctor `safe:"secure"`
  // HTML. `.docx` → two-tier (design D8): a document-converter PDF render when
  // the engine is available (`{mode:"pdf"}` + companion `/api/file/rendered-pdf`),
  // else an in-process mammoth HTML baseline with the hyperlink-guard (D2),
  // DOMPurify sanitize, and bounded-preview image cap (D3). `.pptx` →
  // engine-only PDF render (`{mode:"pdf"}`; no in-process fallback — engine
  // absent → {success:false}; change: render-pptx-preview). Non-supported
  // extensions → 400. Same anti-traversal gate as `/api/file/raw`.
  fastify.get<{ Querystring: { cwd?: string; path?: string; repair?: string } }>(
    "/api/file/render",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      const relPath = request.query.path;
      if (!cwd || !relPath) {
        reply.code(400);
        return { success: false, error: "cwd and path parameters required" } satisfies ApiResponse;
      }

      const ext = path.extname(relPath).toLowerCase();
      const isAdoc = ext === ".adoc" || ext === ".asciidoc";
      const isDocx = ext === ".docx";
      const isPptx = ext === ".pptx";
      if (!isAdoc && !isDocx && !isPptx) {
        reply.code(400);
        return { success: false, error: "renderer not supported for extension" } satisfies ApiResponse;
      }

      // pptx: gate (incl. size cap → 413 before convert) then engine-only PDF
      // render (design P1/P4). No in-process fallback — engine absent →
      // {success:false} so the client maps to FallbackPreview (download).
      if (isPptx) {
        const gate = await gateOfficeFile(
          cwd,
          relPath,
          [".pptx"],
          officeCaps.pptxSizeCap,
          canDiscloseAccessPosture(request),
        );
        if ("code" in gate) {
          reply.code(gate.code);
          return denialBody(gate);
        }
        const result = await renderPptx(
          gate.resolved,
          { mtimeMs: gate.stat.mtimeMs, size: gate.stat.size },
          { engine: docxPdfEngine },
        );
        if (!result.success) {
          return { success: false, error: result.error } satisfies ApiResponse;
        }
        const { success: _s, ...data } = result;
        return { success: true, data } satisfies ApiResponse;
      }

      // docx: gate (incl. size cap → 413 before read) then two-tier render.
      if (isDocx) {
        const gate = await gateOfficeFile(
          cwd,
          relPath,
          [".docx"],
          officeCaps.docxSizeCap,
          canDiscloseAccessPosture(request),
        );
        if ("code" in gate) {
          reply.code(gate.code);
          return denialBody(gate);
        }
        const result = await renderDocx(
          gate.resolved,
          { mtimeMs: gate.stat.mtimeMs, size: gate.stat.size },
          { mode: docxRenderMode, engine: docxPdfEngine, caps: officeCaps },
        );
        if (!result.success) {
          // Unrenderable tail (corrupt/password/library bug) → 200 + success:false
          // so the client maps it to FallbackPreview (design D5).
          return { success: false, error: result.error } satisfies ApiResponse;
        }
        const { success: _s, ...data } = result;
        return { success: true, data } satisfies ApiResponse;
      }

      const allSessions = sessionManager.listAll();
      if (!allSessions.some((s) => s.cwd === cwd)) {
        reply.code(403);
        return { success: false, error: "unknown session path" } satisfies ApiResponse;
      }

      const resolved = path.resolve(cwd, relPath);
      const renderDecision = await evaluateContainment(resolved, [cwd, homePiAnchor()], {
        site: "file-routes:render",
        hold: { request, reply },
        disclosure: canDiscloseAccessPosture(request),
        session: cwd,
      });
      if (!renderDecision.allowed) {
        reply.code(403);
        return { success: false, error: "path outside working directory", ...renderDecision.remedy } as unknown as ApiResponse;
      }

      // Modification token, taken BEFORE the read: a concurrent write can only make it
      // older than the content, so the apply-side verify fails safe ("file changed").
      let mtime = 0;
      try {
        mtime = (await fs.stat(resolved)).mtimeMs;
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }

      let source: string;
      if (renderDecision.viaGrant) {
        // Verified against the open handle (design D14, task 2.8) — a granted
        // FIFO would otherwise block this read indefinitely.
        try {
          source = await readFileVerifiedUtf8(resolved);
        } catch (err) {
          if (err instanceof VerifiedReadRefused) {
            reply.code(403);
            return { success: false, error: "path outside working directory" } satisfies ApiResponse;
          }
          reply.code(404);
          return { success: false, error: "not found" } satisfies ApiResponse;
        }
      } else {
        try {
          source = await fs.readFile(resolved, "utf-8");
        } catch {
          reply.code(404);
          return { success: false, error: "not found" } satisfies ApiResponse;
        }
      }

      try {
        // Markup repair is a pure source scan (shared with the client's apply path);
        // `repair=0` serves the "view original rendering" toggle.
        const repaired = request.query.repair === "0" ? { source, repairs: [] } : repairAsciiDoc(source);
        const { html, warnings } = convertAdocCapturingWarnings(repaired.source);
        return {
          success: true,
          data: { html: await sanitizeAdocHtml(html), repairs: repaired.repairs, warnings, mtime },
        } satisfies ApiResponse;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "render failed";
        reply.code(500);
        return { success: false, error: msg } satisfies ApiResponse;
      }
    },
  );

  // Cached docx→PDF byte stream (change: render-office-previews, design D8).
  // Companion to `/api/file/render` `mode:"pdf"`. Serves the cached PDF
  // (path+mtime+size key); regenerates via the engine on cache miss/stale.
  // `.docx` + `.pptx` (change: render-pptx-preview); same gate + per-ext size
  // cap as the render route.
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file/rendered-pdf",
    { preHandler: networkGuard },
    async (request, reply) => {
      // Widened to `.pptx` (change: render-pptx-preview) — the pptx render path
      // reuses this same cached PDF stream. Size cap selected by extension.
      const pdfExt = path.extname(request.query.path ?? "").toLowerCase();
      const pdfSizeCap = pdfExt === ".pptx" ? officeCaps.pptxSizeCap : officeCaps.docxSizeCap;
      const gate = await gateOfficeFile(
        request.query.cwd,
        request.query.path,
        [".docx", ".pptx"],
        pdfSizeCap,
        canDiscloseAccessPosture(request),
      );
      if ("code" in gate) {
        reply.code(gate.code);
        return denialBody(gate);
      }
      const out = pdfCachePath(gate.resolved, gate.stat.mtimeMs, gate.stat.size);
      try {
        await fs.access(out);
      } catch {
        try {
          await fs.mkdir(path.dirname(out), { recursive: true });
          await docxPdfEngine.toPdf(gate.resolved, out);
        } catch (err) {
          reply.code(500);
          return {
            success: false,
            error: err instanceof Error ? err.message : "failed to render pdf",
          } satisfies ApiResponse;
        }
      }
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", "inline");
      reply.header("Cache-Control", "private, max-age=60");
      return reply.send(createReadStream(out));
    },
  );

  // Spreadsheet parse endpoint (change: render-office-previews). Parses
  // `.xlsx`/`.csv` to bounded structured JSON with SheetJS (no Docker). `.csv`
  // encoding is detected (chardet) + decoded (iconv-lite) so CP1250 renders
  // correctly (design D6). `.xlsx`/`.csv`-only → 400; size cap → 413 before read;
  // corrupt/password-protected → 200 + success:false (design D5).
  fastify.get<{ Querystring: { cwd?: string; path?: string; limit?: string } }>(
    "/api/file/sheet",
    { preHandler: networkGuard },
    async (request, reply) => {
      const gate = await gateOfficeFile(
        request.query.cwd,
        request.query.path,
        [".xlsx", ".csv"],
        officeCaps.sheetSizeCap,
        canDiscloseAccessPosture(request),
      );
      if ("code" in gate) {
        reply.code(gate.code);
        return denialBody(gate);
      }
      let buffer: Buffer;
      if (gate.viaGrant) {
        // Read from the VERIFIED handle, so the bytes parsed are the bytes
        // checked (design D14, task 2.8) — not a third resolution of the path.
        try {
          buffer = await readFileVerified(gate.resolved);
        } catch (err) {
          if (err instanceof VerifiedReadRefused) {
            reply.code(403);
            return { success: false, error: "path outside working directory" } satisfies ApiResponse;
          }
          reply.code(404);
          return { success: false, error: "not found" } satisfies ApiResponse;
        }
      } else {
        try {
          buffer = await fs.readFile(gate.resolved);
        } catch {
          reply.code(404);
          return { success: false, error: "not found" } satisfies ApiResponse;
        }
      }
      const limit = request.query.limit ? Number(request.query.limit) : undefined;
      const rowLimit = resolveRowLimit(limit, officeCaps);
      const result = await parseSheet(buffer, gate.ext, { rowLimit, colCap: officeCaps.colCap });
      if (!result.success) {
        return { success: false, error: result.error } satisfies ApiResponse;
      }
      const { success: _s, ...data } = result;
      return { success: true, data } satisfies ApiResponse;
    },
  );

  // Server-side EML (message/rfc822) parse (change: add-eml-preview).
  // Parses with `mailparser`, sanitizes the HTML body with DOMPurify, and
  // returns metadata-only JSON (headers, sanitized html, text, attachment
  // metadata) — the raw ~15 MB base64 never reaches the client. Non-`.eml` →
  // 400; over the size cap → 413 BEFORE read; malformed MIME → 400 (no crash).
  // `allowRemote=1` preserves remote resource refs (the browser fetches them,
  // never the server — no SSRF). Shares the `/api/file/raw` anti-traversal gate.
  fastify.get<{ Querystring: { cwd?: string; path?: string; allowRemote?: string } }>(
    "/api/file/eml",
    { preHandler: networkGuard },
    async (request, reply) => {
      const gate = await gateFilePath(request.query.cwd, request.query.path, sessionManager, {
        disclosure: canDiscloseAccessPosture(request),
      });
      if ("code" in gate) {
        reply.code(gate.code);
        return denialBody(gate);
      }
      const ext = path.extname(request.query.path ?? "").toLowerCase();
      if (ext !== ".eml") {
        reply.code(400);
        return { success: false, error: "renderer not supported for extension" } satisfies ApiResponse;
      }
      let stat;
      try {
        stat = await fs.stat(gate.resolved);
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
      if (!stat.isFile()) {
        reply.code(404);
        return { success: false, error: "not a file" } satisfies ApiResponse;
      }
      if (stat.size > EML_SIZE_CAP) {
        reply.code(413);
        return { success: false, error: "file too large" } satisfies ApiResponse;
      }
      try {
        // D14: the handle-verified read is GRANT-ONLY (verified-read.ts states
        // the precondition). Applying the regular-file assertion to every
        // admission regressed layers ①/②: `assertRegularFile` uses `lstat`, so an
        // in-scope final-component SYMLINK — which `fs.stat` plus this read
        // previously followed — started failing 400. For a grant admission the
        // bytes now come from the VERIFIED handle, so the path is not resolved a
        // third time to race. (Found by the task 4.5 review gate.)
        const parsed = gate.viaGrant
          ? await loadParsedEml(gate.resolved, stat, await readFileVerified(gate.resolved))
          : await loadParsedEml(gate.resolved, stat);
        const data = await toParseResult(parsed, { allowRemote: request.query.allowRemote === "1" });
        return { success: true, data } satisfies ApiResponse;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "failed to parse EML";
        reply.code(400);
        return { success: false, error: msg } satisfies ApiResponse;
      }
    },
  );

  // EML attachment streaming (change: add-eml-preview).
  // Streams ONE decoded attachment part by 0-based `index`. ALWAYS sends
  // `Content-Disposition: attachment` (never inline) + `X-Content-Type-Options:
  // nosniff`, so an attacker-declared `text/html`/SVG part cannot execute in the
  // dashboard origin — inline previews consume the bytes as a `blob:` URL, not by
  // navigating to this route. Non-integer/negative index → 400; out-of-range →
  // 404. Shares the `/api/file/raw` anti-traversal gate + the parse cache.
  fastify.get<{ Querystring: { cwd?: string; path?: string; index?: string } }>(
    "/api/file/eml-attachment",
    { preHandler: networkGuard },
    async (request, reply) => {
      const gate = await gateFilePath(request.query.cwd, request.query.path, sessionManager, {
        disclosure: canDiscloseAccessPosture(request),
      });
      if ("code" in gate) {
        reply.code(gate.code);
        return denialBody(gate);
      }
      if (path.extname(request.query.path ?? "").toLowerCase() !== ".eml") {
        reply.code(400);
        return { success: false, error: "renderer not supported for extension" } satisfies ApiResponse;
      }
      const rawIndex = request.query.index ?? "";
      const index = Number(rawIndex);
      if (rawIndex === "" || !Number.isInteger(index) || index < 0) {
        reply.code(400);
        return { success: false, error: "index must be a non-negative integer" } satisfies ApiResponse;
      }
      let stat;
      try {
        stat = await fs.stat(gate.resolved);
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
      if (stat.size > EML_SIZE_CAP) {
        reply.code(413);
        return { success: false, error: "file too large" } satisfies ApiResponse;
      }
      let parsed;
      try {
        // Same grant-only rule as the EML parse site above (task 4.5 review).
        parsed = gate.viaGrant
          ? await loadParsedEml(gate.resolved, stat, await readFileVerified(gate.resolved))
          : await loadParsedEml(gate.resolved, stat);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "failed to parse EML";
        reply.code(400);
        return { success: false, error: msg } satisfies ApiResponse;
      }
      const att = parsed.attachments?.[index];
      if (!att) {
        reply.code(404);
        return { success: false, error: "attachment index out of range" } satisfies ApiResponse;
      }
      // Header-safe filename: strip CR/LF/quote (anti-injection), fold non-ASCII
      // to `_` for the legacy `filename=`, and carry the exact name via RFC 5987
      // `filename*` so UTF-8 names (e.g. Hungarian) survive.
      const rawName = (att.filename || `attachment-${index}`).replace(/["\r\n]/g, "");
      const asciiName = rawName.replace(/[^\x20-\x7e]/g, "_");
      reply.header("Content-Type", att.contentType || "application/octet-stream");
      reply.header(
        "Content-Disposition",
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(rawName)}`,
      );
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cache-Control", "private, max-age=60");
      reply.header("Content-Length", String(att.content.length));
      return reply.send(att.content);
    },
  );

  // Diagram render endpoint (change: diagram-rendering).
  // Accepts POST with JSON body { type, source }. Type must be 'plantuml' in v1.
  // Encodes source with deflate+base64url, fetches from Kroki, sanitizes SVG,
  // caches responses.
  fastify.post<{ Body: { type?: unknown; source?: unknown; [key: string]: unknown } }>(
    "/api/diagram/render",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const type = typeof body.type === "string" ? body.type : "";
      const source = typeof body.source === "string" ? body.source.trim() : "";

      if (!type || !source) {
        reply.code(400);
        return { success: false, error: "type and non-empty source are required" } satisfies ApiResponse;
      }

      const cfg = loadConfig();
      const result = await renderDiagram(type, source, { krokiConfig: cfg.kroki });
      if (!result.success) {
        reply.code(result.statusCode);
        return {
          success: false,
          code: result.code,
          error: result.error,
        } satisfies ApiResponse;
      }

      return {
        success: true,
        data: { svg: result.svg },
      } satisfies ApiResponse;
    },
  );
}

/**
 * Ask about an unknown-cwd denial and re-run the known-cwd guard on an allow
 * verdict (add-access-grant-dialog, task 6.2). Resolves `false` for anything but
 * an explicit allow that the re-run confirms. The re-run is the shared
 * `resolveCwdVerdict` (canonical compare against sessions ∪ pins, allow-once
 * real-path re-resolution) — the same rules plugin holds use.
 * See change: harden-plugin-cwd-admission.
 */
async function unknownCwdVerdictAdmits(
  cwd: string,
  target: HoldTarget,
  known: () => string[],
): Promise<boolean> {
  // The subject is the REAL path, so an allow-once can later be compared strictly against
  // what the path means at release time. A cwd that does not resolve is never asked about:
  // the post-verdict re-run refuses it whatever the operator answers (and a pin for a
  // directory that is not there is meaningless) — the same rule the plugin seam applies.
  const real = await realpathAsync(path.resolve(cwd));
  if (real.kind !== "ok") return false;
  const resolution = await holdDenial({ plane: "cwd", rawSubject: real.path, origin: "file-routes:exists" }, target);
  return (await resolveCwdVerdict(cwd, resolution, { known })).kind === "admit";
}
