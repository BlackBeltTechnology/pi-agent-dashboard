/**
 * REST routes for the invoicebot-plugin, mounted under
 * `/api/plugins/invoicebot/*`. Four POST endpoints, each wrapping one `ib_*`
 * selector, keyed by `cwd` (the per-request workspace key). Auth is inherited
 * from the dashboard's `onRequest` hook on `fastify`.
 *
 *   POST /api/plugins/invoicebot/query   → ib_query  (view)
 *   POST /api/plugins/invoicebot/review  → ib_review (action)
 *   POST /api/plugins/invoicebot/setup   → ib_setup  (action)
 *   POST /api/plugins/invoicebot/rules   → ib_rules  (action)
 *   GET  /api/plugins/invoicebot/blob    → stream a retained original document
 *                                          (?handle= processed, ?invoice_id= queued)
 *   POST /api/plugins/invoicebot/run-invoice → start ONE scoped run for a queued invoice
 *   POST /api/plugins/invoicebot/upload  → multipart ingest of raw invoice bytes
 *   POST /api/plugins/invoicebot/automation → enable/disable a schedule automation
 *   GET  /api/plugins/invoicebot/automation → list schedule automations + state
 *   POST /api/plugins/invoicebot/scoped-session → ensure a usable invoice-scoped chat session
 *
 * The plugin forwards `{ selector, ...args }` to the matching `InvoiceEngine`
 * port method and normalizes the tool result to `{ ok, text, data, sessionId?,
 * consequential? }`. For the five flow-triggering ops (the engine returns a
 * `flow` spec) the route dispatches `flow:run` into the workspace session and
 * attaches the resulting `sessionId`. See change: add-invoicebot-rest-plugin.
 *
 * The two `/automation` routes are the exception: they do a direct filesystem
 * flip of the `disabled` field on an on-disk `automation.yaml` (no engine port,
 * no `ib_*` tool touches `disabled`). NOTE: a second, independent gate
 * (`intake_paused`, engine soft-loop STOP) can still swallow processing even
 * after a schedule automation is enabled here; the two switches can contradict.
 * Reconciling them is deferred to an optional engine change. See change:
 * surface-automation-enable.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import fastifyMultipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import {
  AutomationNotFoundError,
  badAutomationName,
  flipAutomationDisabled,
  listInvoicebotAutomations,
} from "./automation-toggle.js";
import { contentDispositionFor, contentTypeFor, resolveBlobPath, resolveInvoiceOriginalPath } from "./blob.js";
import type { EngineResult, FlowRunSpec, IngestFile, IngestOutcome, InvoiceEngine } from "./engine/port.js";

/** Per-file cap (bytes) enforced at the multipart boundary — matches the engine's 20 MB cap. */
const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
/** Max file parts per upload request. */
const UPLOAD_MAX_FILES = 20;

/** Parse a single-range `Range: bytes=start-end` header against a known size. */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "none" | "unsatisfiable" {
  if (!header) return "none";
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "unsatisfiable";
  const [, startRaw, endRaw] = m;
  let start: number;
  let end: number;
  if (startRaw === "") {
    // suffix range: last N bytes
    if (endRaw === "") return "unsatisfiable";
    const n = Number(endRaw);
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? size - 1 : Number(endRaw);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(end, size - 1) };
}

export interface InvoiceBotRouteDeps {
  engine: InvoiceEngine;
  /** Dispatch a flow into the workspace session; returns the sessionId/token. */
  dispatchFlow: (args: { cwd: string; flow: FlowRunSpec; sessionId?: string; invoiceId?: string }) => Promise<string | undefined>;
  /** Bootstrap a usable invoice-scoped chat session. */
  ensureScopedSession?: (cwd: string, invoiceId: string) => Promise<string | undefined>;
  /**
   * Start ONE scoped run for exactly one queued invoice through the automation
   * plugin's per-invoice fan-out core (cross-plugin `automation:runInvoice`
   * service). Resolved lazily so plugin load order is irrelevant; `undefined`
   * when the automation plugin has not published the service.
   * See change: serve-and-start-queued-invoice.
   */
  runInvoice?: (cwd: string, invoiceId: string) => Promise<{ ok: boolean; runId?: string; reason?: string; error?: string } | undefined>;
}

/** Consequential ops the client MUST confirm first (api-contract §10). */
function isConsequential(endpoint: string, body: Record<string, unknown>): boolean {
  const a = body.action;
  if (endpoint === "review") return a === "approve" || a === "reject" || a === "repair" || (a === "handoff" && body.confirm === true);
  if (endpoint === "rules") return a === "approve" || a === "archive" || (a === "request" && body.consent === true);
  if (endpoint === "setup") return a === "config" && body.consent === true;
  return false;
}

/** Validate `cwd`: a non-empty absolute string, an existing directory, no NUL. */
function badCwd(cwd: unknown): string | null {
  if (typeof cwd !== "string" || cwd.trim() === "") return "cwd is required";
  if (cwd.includes("\0")) return "cwd is invalid";
  try {
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return "cwd is not an existing directory";
  } catch {
    return "cwd is not an existing directory";
  }
  return null;
}

function normalize(
  result: EngineResult,
  extra: { sessionId?: string; consequential?: boolean } = {},
): Record<string, unknown> {
  const ok = result.details?.ok !== false;
  const text = result.content?.[0]?.text ?? "";
  return {
    ok,
    text,
    data: result.details,
    ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
    ...(extra.consequential ? { consequential: true } : {}),
  };
}

export function mountInvoiceBotRoutes(fastify: FastifyInstance, deps: InvoiceBotRouteDeps): void {
  const { engine, dispatchFlow } = deps;

  // Register multipart for the upload route. throwFileSizeLimit:false makes an
  // oversize part set `file.truncated` (per-file reject) instead of failing the
  // whole request; auth runs in the global onRequest hook, before body parsing.
  fastify.register(fastifyMultipart, {
    throwFileSizeLimit: false,
    limits: { fileSize: UPLOAD_MAX_BYTES, files: UPLOAD_MAX_FILES },
  });

  // Ensure the disabled `invoicebot-intake` drain automation exists for this
  // workspace on first touch. Idempotent + non-fatal in the engine. Single
  // choke point so the covered-route set (every workspace-touching handler,
  // NOT /blob) cannot drift. See change: ensure-intake-automation.
  async function ensureIntake(cwd: string): Promise<void> {
    await engine.ensureAutomation(cwd);
  }

  /** Dispatch the captured flow (if any) into the workspace session; returns the sessionId. */
  async function dispatchIfFlow(body: Record<string, unknown>, result: EngineResult): Promise<string | undefined> {
    if (!result.flow) return undefined;
    const args: { cwd: string; flow: FlowRunSpec; sessionId?: string; invoiceId?: string } = {
      cwd: body.cwd as string,
      flow: result.flow,
    };
    if (typeof body.sessionId === "string") args.sessionId = body.sessionId;
    if (typeof body.invoice_id === "string") args.invoiceId = body.invoice_id;
    return dispatchFlow(args);
  }

  // ── /scoped-session — trusted chat bootstrap; conversation stays on /ws ──
  fastify.post("/api/plugins/invoicebot/scoped-session", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cwdErr = badCwd(body.cwd);
    if (cwdErr) { reply.code(400); return { error: cwdErr }; }
    if (typeof body.invoice_id !== "string" || body.invoice_id.trim() === "") {
      reply.code(400);
      return { error: "invoice_id is required" };
    }
    const cwd = body.cwd as string;
    try {
      await ensureIntake(cwd);
      const sessionId = await deps.ensureScopedSession?.(cwd, body.invoice_id);
      if (sessionId) return { sessionId };
    } catch (err) {
      req.log.warn({ err }, "invoicebot scoped session bootstrap failed");
    }
    reply.code(503);
    return { error: "scoped session unavailable" };
  });

  // ── /query — reads (view) ──────────────────────────────────────────────────
  fastify.post("/api/plugins/invoicebot/query", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cwdErr = badCwd(body.cwd);
    if (cwdErr) { reply.code(400); return { error: cwdErr }; }
    await ensureIntake(body.cwd as string);
    if (typeof body.view !== "string" || body.view.trim() === "") { reply.code(400); return { error: "view is required" }; }
    const result = await engine.query(body.cwd as string, body as { view: string });
    return normalize(result);
  });

  // ── /review — operational writes (action); some flow-triggering ────────────
  fastify.post("/api/plugins/invoicebot/review", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cwdErr = badCwd(body.cwd);
    if (cwdErr) { reply.code(400); return { error: cwdErr }; }
    await ensureIntake(body.cwd as string);
    if (typeof body.action !== "string" || body.action.trim() === "") { reply.code(400); return { error: "action is required" }; }
    const result = await engine.review(body.cwd as string, body as { action: string });
    const sessionId = await dispatchIfFlow(body, result);
    return normalize(result, { ...(sessionId ? { sessionId } : {}), consequential: isConsequential("review", body) });
  });

  // ── /setup — editor config (action); pure ──────────────────────────────────
  fastify.post("/api/plugins/invoicebot/setup", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cwdErr = badCwd(body.cwd);
    if (cwdErr) { reply.code(400); return { error: cwdErr }; }
    await ensureIntake(body.cwd as string);
    if (typeof body.action !== "string" || body.action.trim() === "") { reply.code(400); return { error: "action is required" }; }
    const result = await engine.setup(body.cwd as string, body as { action: string });
    return normalize(result, { consequential: isConsequential("setup", body) });
  });

  // ── /blob — GET byte delivery of a retained original (design D1) ───────────
  // Breaks the POST-envelope convention deliberately: the browser's native
  // PDF/image viewer needs a plain GET URL it can put in <iframe src>/<img src>
  // and issue Range against. Path-traversal-guarded via resolveBlobPath.
  //
  // Two resolution forms: `handle` serves a processed invoice's retained blob
  // (unchanged); `invoice_id` serves a QUEUED invoice's landed original from the
  // drop folder (it has no blob yet), confined to the engine state dir. `handle`
  // wins when both are present. See change: serve-and-start-queued-invoice.
  fastify.get("/api/plugins/invoicebot/blob", async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const resolved =
      q.handle !== undefined ? resolveBlobPath(q.cwd, q.handle) : resolveInvoiceOriginalPath(q.cwd, q.invoice_id);
    if (!resolved.ok) {
      const code = resolved.reason === "invalid-input" ? 400 : resolved.reason === "traversal" ? 403 : 404;
      req.log.info({ reason: resolved.reason, code }, "invoicebot blob rejected");
      reply.code(code);
      return { error: resolved.reason };
    }

    const { abs } = resolved;
    const size = statSync(abs).size;
    const name = basename(abs);
    reply
      .header("Content-Type", contentTypeFor(abs))
      // Header-safe: a non-Latin-1 filename (e.g. Hungarian `ő`) used to make
      // Node reject the response with ERR_INVALID_CHAR → 500. See change:
      // fix-blob-content-disposition-encoding.
      .header("Content-Disposition", contentDispositionFor(name))
      .header("Accept-Ranges", "bytes")
      .header("X-Content-Type-Options", "nosniff");

    const range = parseRange(req.headers.range, size);
    if (range === "unsatisfiable") {
      req.log.info({ handle: name, code: 416 }, "invoicebot blob range unsatisfiable");
      reply.code(416).header("Content-Range", `bytes */${size}`);
      return reply.send();
    }
    if (range === "none") {
      req.log.info({ handle: name, code: 200 }, "invoicebot blob served");
      reply.code(200).header("Content-Length", String(size));
      return reply.send(createReadStream(abs));
    }
    const { start, end } = range;
    req.log.info({ handle: name, code: 206, start, end }, "invoicebot blob partial");
    reply
      .code(206)
      .header("Content-Range", `bytes ${start}-${end}/${size}`)
      .header("Content-Length", String(end - start + 1));
    return reply.send(createReadStream(abs, { start, end }));
  });

  // ── /run-invoice — start ONE scoped run for exactly one queued invoice ─────
  // Reuses the SAME fan-out child path the scheduled batch drain uses (via the
  // automation plugin's generic `automation:runWorkItem` service, which leases
  // exactly this invoice from the queued-invoice work source), so the
  // run carries IB_TOOLSET=scoped-invoice + IB_INVOICE_ID and gets its own scoped
  // session. Never a global/folder-level run, never a fan-out over other
  // invoices. Refuses (409 / {ok:false,reason:"in_flight"}) when the invoice
  // already has a run in flight. See change: serve-and-start-queued-invoice.
  fastify.post("/api/plugins/invoicebot/run-invoice", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cwdErr = badCwd(body.cwd);
    if (cwdErr) { reply.code(400); return { error: cwdErr }; }
    if (typeof body.invoice_id !== "string" || body.invoice_id.trim() === "") {
      reply.code(400);
      return { error: "invoice_id is required" };
    }
    if (!deps.runInvoice) {
      req.log.warn("invoicebot run-invoice: automation:runWorkItem service unavailable");
      reply.code(503);
      return { error: "run service unavailable" };
    }
    await ensureIntake(body.cwd as string);
    const res = await deps.runInvoice(body.cwd as string, body.invoice_id);
    if (!res) {
      reply.code(503);
      return { error: "run service unavailable" };
    }
    if (!res.ok) {
      if (res.reason === "in_flight") {
        req.log.info({ invoice_id: body.invoice_id, code: 409 }, "invoicebot run-invoice refused: in flight");
        reply.code(409);
        return { ok: false, reason: "in_flight" };
      }
      reply.code(400);
      return { ok: false, error: res.error ?? "run not started" };
    }
    req.log.info({ invoice_id: body.invoice_id, runId: res.runId }, "invoicebot run-invoice started");
    return { ok: true, ...(res.runId ? { runId: res.runId } : {}) };
  });

  // ── /automation (POST) — enable/disable a schedule automation in place ─────
  // First invoicebot route that writes the filesystem directly (flips ONLY the
  // `disabled` field); no engine port. The automation-plugin watcher re-arms
  // the scheduler live. Response makes the resulting per-automation state
  // plainly visible (the arm/disarm happens async in another module).
  fastify.post("/api/plugins/invoicebot/automation", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cwdErr = badCwd(body.cwd);
    if (cwdErr) { reply.code(400); return { error: cwdErr }; }
    await ensureIntake(body.cwd as string);
    const nameErr = badAutomationName(body.name);
    if (nameErr) { reply.code(400); return { error: nameErr }; }
    if (typeof body.enabled !== "boolean") { reply.code(400); return { error: "enabled must be a boolean" }; }
    try {
      const { enabled } = flipAutomationDisabled(body.cwd as string, body.name as string, body.enabled);
      req.log.info({ name: body.name, enabled }, "invoicebot automation flipped");
      return { ok: true, name: body.name, enabled };
    } catch (err) {
      if (err instanceof AutomationNotFoundError) {
        req.log.info({ name: body.name, code: 404 }, "invoicebot automation flip rejected: not found");
        reply.code(404);
        return { error: "automation not found" };
      }
      req.log.error({ err, name: body.name }, "invoicebot automation flip failed");
      reply.code(500);
      return { error: "flip failed" };
    }
  });

  // ── /automation (GET) — discover automations + per-automation state ────────
  fastify.get("/api/plugins/invoicebot/automation", async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const cwdErr = badCwd(q.cwd);
    if (cwdErr) { reply.code(400); return { error: cwdErr }; }
    await ensureIntake(q.cwd as string);
    const automations = listInvoicebotAutomations(q.cwd as string);
    return { automations };
  });

  // ── /upload — POST multipart ingest of raw invoice bytes (design D1–D9) ────
  // Breaks the POST-JSON-envelope convention deliberately: binary file content
  // does not fit `{ selector, ...args }`. The write-side twin of GET /blob.
  // Streams each file part to a Buffer, forwards to engine.ingest(cwd, files),
  // and returns the per-file outcome verbatim. Dispatches NO flow (D9): the
  // engine's own `file` trigger drains the drop folder. 400 only on bad cwd /
  // no file parts (D6); a fully-rejected batch is still 200.
  fastify.post("/api/plugins/invoicebot/upload", async (req, reply) => {
    const files: IngestFile[] = [];
    const boundaryRejected: IngestOutcome[] = [];
    let cwd: string | undefined;
    let sawFilePart = false;

    for await (const part of req.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "cwd" && typeof part.value === "string") cwd = part.value;
        continue;
      }
      sawFilePart = true;
      const filename = part.filename || "unnamed";
      try {
        const bytes = await part.toBuffer();
        // Oversize part: never forward partial bytes; reject just this file.
        if (part.file.truncated) {
          boundaryRejected.push({ filename, hash: "", status: "rejected", reason: "too large" });
        } else {
          files.push({ filename, bytes });
        }
      } catch {
        boundaryRejected.push({ filename, hash: "", status: "rejected", reason: "too large" });
      }
    }

    const cwdErr = badCwd(cwd);
    if (cwdErr) { reply.code(400); return { error: cwdErr }; }
    if (!sawFilePart) { reply.code(400); return { error: "no file parts" }; }

    await ensureIntake(cwd as string);
    const ingest = await engine.ingest(cwd as string, files);
    const merged = {
      results: [...ingest.results, ...boundaryRejected],
      landed: ingest.landed,
      skipped: ingest.skipped,
      rejected: ingest.rejected + boundaryRejected.length,
    };
    req.log.info(
      { landed: merged.landed, skipped: merged.skipped, rejected: merged.rejected, code: 200 },
      "invoicebot upload processed",
    );
    return merged;
  });

  // ── /rules — rule authoring (action); request is flow-triggering ───────────
  fastify.post("/api/plugins/invoicebot/rules", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cwdErr = badCwd(body.cwd);
    if (cwdErr) { reply.code(400); return { error: cwdErr }; }
    await ensureIntake(body.cwd as string);
    if (typeof body.action !== "string" || body.action.trim() === "") { reply.code(400); return { error: "action is required" }; }
    const result = await engine.rules(body.cwd as string, body as { action: string });
    const sessionId = await dispatchIfFlow(body, result);
    return normalize(result, { ...(sessionId ? { sessionId } : {}), consequential: isConsequential("rules", body) });
  });
}
