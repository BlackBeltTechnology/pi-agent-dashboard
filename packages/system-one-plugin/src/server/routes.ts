/**
 * `/api/system-one/*` routes (spec: system-one-settings-ui, system-one-config).
 *
 *   GET  /api/system-one/config          → { revision, exists, config, backends, catalog }
 *   PUT  /api/system-one/config          { config, baseRevision } → { revision } | 409
 *   GET  /api/system-one/keys            → { keys: { [keyRef]: { set, source } } }
 *   POST /api/system-one/keys/:keyRef    { value } → { status }
 *   GET  /api/system-one/consumers       → { consumers }
 *   POST /api/system-one/eval            { consumerId, backendId } → EvalReport
 *   POST /api/system-one/calibration     { backendId, consumerId, mode, thresholds, model, baseRevision, confirm? }
 *   GET  /api/system-one/managed         → { platform, uv, backends }
 *   POST /api/system-one/managed/:id/(start|stop)
 *   GET  /api/system-one/managed/:id/log → { lines }
 *
 * Every mutating route runs behind the host `networkGuard`. No route returns a
 * key or key prefix. Errors are lowercase machine codes; the client owns copy.
 * See change: add-system-one-registry.
 */
import {
  type Backend,
  CATALOG,
  catalogEntry,
  effectiveCapabilities,
  effectiveKeyRef,
  isObj,
  isOffMachine,
  isValidKeyRef,
  keyStatus,
  loadConfig,
  normalizeUser,
  parseBackendUrl,
  type SystemOneConfig,
  userConfigPath,
  writeKey,
} from "@blackbelt-technology/pi-system-one";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mergeWrite, readRaw, StaleRevisionError } from "./config-io.js";
import { listConsumers, loadFixtures } from "./consumers.js";
import { runEval } from "./eval.js";
import type { ServerLlmCaller } from "./llm-caller.js";
import { seedConfig } from "./seed.js";
import type { ManagedControl } from "./supervisor.js";

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface SystemOneRouteDeps {
  networkGuard: Guard;
  llmCaller?: ServerLlmCaller;
  managed?: ManagedControl;
}

const BACKEND_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type EgressLabel = "hosted" | "remote" | "loopback" | "loopback (user-declared)" | "local model" | "cloud model";

function egressLabel(b: Backend, off: boolean): EgressLabel {
  if (b.kind === "managed") return "loopback";
  if (b.kind === "llm") return off ? "cloud model" : "local model";
  if (!off) return "loopback (user-declared)";
  return catalogEntry(b)?.hosted ? "hosted" : "remote";
}

async function backendViews(cfg: SystemOneConfig, deps: SystemOneRouteDeps) {
  const roles = Object.values(cfg.backends).flatMap((b) => (b.kind === "llm" ? [b.role] : []));
  if (roles.length) await deps.llmCaller?.prepare(roles).catch(() => {});
  const out: Record<string, unknown> = {};
  for (const [id, b] of Object.entries(cfg.backends)) {
    const off = isOffMachine(b, deps.llmCaller);
    const entry = catalogEntry(b);
    out[id] = {
      capabilities: effectiveCapabilities(b),
      offMachine: off,
      egress: egressLabel(b, off),
      keyRef: effectiveKeyRef(b) ?? null,
      languageLabel: entry?.languageLabel ?? null,
      priceUsdPerMTok: entry?.priceUsdPerMTok ?? null,
      managed: b.kind === "managed" ? (deps.managed?.status(id) ?? null) : null,
    };
  }
  return out;
}

/** Validate + normalize a client-sent config. Returns an error code on reject. */
function validateIncoming(v: unknown): { ok: true; cfg: SystemOneConfig } | { ok: false; error: string; backendId?: string } {
  if (!isObj(v)) return { ok: false, error: "invalid-config" };
  const backends = isObj(v.backends) ? v.backends : {};
  for (const [id, b] of Object.entries(backends)) {
    if (!BACKEND_ID.test(id)) return { ok: false, error: "invalid-backend-id", backendId: id };
    if (isObj(b) && b.kind === "http" && (typeof b.url !== "string" || !parseBackendUrl(b.url)))
      return { ok: false, error: "invalid-url", backendId: id };
  }
  const cfg = normalizeUser({ ...v, version: 1 } as never, "PUT /api/system-one/config");
  for (const id of Object.keys(backends))
    if (!Object.hasOwn(cfg.backends, id)) return { ok: false, error: "invalid-backend", backendId: id };
  if (!Object.hasOwn(cfg.presets, cfg.activePreset)) return { ok: false, error: "unknown-preset" };
  return { ok: true, cfg };
}

/** Plain JSON (drop null prototypes) for serialization into the file. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function mountSystemOneRoutes(app: FastifyInstance, deps: SystemOneRouteDeps): void {
  const guard = { preHandler: deps.networkGuard };

  app.get("/api/system-one/config", async () => {
    const raw = readRaw();
    const exists = raw.text !== null;
    const cfg = exists ? loadConfig() : seedConfig();
    return {
      revision: raw.revision,
      exists,
      path: userConfigPath(),
      config: plain({
        allowOffMachine: cfg.allowOffMachine,
        backends: cfg.backends,
        presets: cfg.presets,
        activePreset: cfg.activePreset,
        calibration: cfg.calibration,
      }),
      backends: await backendViews(cfg, deps),
      catalog: CATALOG,
    };
  });

  app.put("/api/system-one/config", guard, async (req, reply) => {
    const body = req.body as { config?: unknown; baseRevision?: unknown } | undefined;
    if (typeof body?.baseRevision !== "string") return reply.code(400).send({ error: "base-revision-required" });
    const v = validateIncoming(body.config);
    if (!v.ok) return reply.code(400).send({ error: v.error, backendId: v.backendId });
    try {
      const revision = mergeWrite((doc) => {
        doc.allowOffMachine = v.cfg.allowOffMachine;
        doc.backends = plain(v.cfg.backends);
        doc.presets = plain(v.cfg.presets);
        doc.activePreset = v.cfg.activePreset;
      }, body.baseRevision);
      return { revision };
    } catch (err) {
      if (err instanceof StaleRevisionError) return reply.code(409).send({ error: "stale-revision", revision: err.current });
      throw err;
    }
  });

  app.get("/api/system-one/keys", async () => {
    const cfg = loadConfig();
    const refs = new Set<string>(CATALOG.flatMap((e) => (e.keyRef ? [e.keyRef] : [])));
    for (const b of Object.values(cfg.backends)) {
      const r = effectiveKeyRef(b);
      if (r) refs.add(r);
    }
    return { keys: Object.fromEntries([...refs].filter(isValidKeyRef).map((r) => [r, keyStatus(r)])) };
  });

  app.post("/api/system-one/keys/:keyRef", guard, async (req, reply) => {
    const { keyRef } = req.params as { keyRef: string };
    const value = (req.body as { value?: unknown } | undefined)?.value;
    if (!isValidKeyRef(keyRef)) return reply.code(400).send({ error: "invalid-key-ref" });
    if (typeof value !== "string" || value.length > 4096) return reply.code(400).send({ error: "invalid-value" });
    if (keyStatus(keyRef).source === "env") return reply.code(409).send({ error: "env-key" });
    writeKey(keyRef, value.trim());
    return { status: keyStatus(keyRef) };
  });

  app.get("/api/system-one/consumers", async () => ({ consumers: listConsumers() }));

  app.post("/api/system-one/eval", guard, async (req, reply) => {
    const { consumerId, backendId } = (req.body ?? {}) as { consumerId?: unknown; backendId?: unknown };
    const consumer = listConsumers().find((c) => c.id === consumerId);
    if (!consumer) return reply.code(404).send({ error: "unknown-consumer" });
    const fx = loadFixtures(consumer.fixtures);
    if (!fx.ok) return reply.code(409).send({ error: fx.reason });
    const cfg = loadConfig();
    if (typeof backendId !== "string" || !Object.hasOwn(cfg.backends, backendId))
      return reply.code(404).send({ error: "unknown-backend" });
    const b = cfg.backends[backendId];
    if (b.kind === "llm") await deps.llmCaller?.prepare([b.role]).catch(() => {});
    if (!cfg.allowOffMachine && isOffMachine(b, deps.llmCaller)) return reply.code(409).send({ error: "off-machine" });
    if (b.kind === "managed" && deps.managed?.status(backendId).state !== "ready")
      return reply.code(409).send({ error: "not-running" });

    const ac = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) ac.abort();
    });
    const { test: _t, lastSeen: _l, ...decl } = consumer;
    return runEval({
      consumer: decl,
      backendId,
      cases: fx.cases,
      priceUsdPerMTok: catalogEntry(b)?.priceUsdPerMTok,
      llmCaller: deps.llmCaller,
      signal: ac.signal,
    });
  });

  app.post("/api/system-one/calibration", guard, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { backendId, consumerId, mode, model, baseRevision, confirm } = body;
    if (typeof backendId !== "string" || !BACKEND_ID.test(backendId)) return reply.code(400).send({ error: "invalid-backend-id" });
    if (typeof consumerId !== "string" || !listConsumers().some((c) => c.id === consumerId))
      return reply.code(400).send({ error: "unknown-consumer" });
    if (mode !== "shadow" && mode !== "enforce") return reply.code(400).send({ error: "invalid-mode" });
    if (typeof model !== "string" || !model) return reply.code(400).send({ error: "model-required" });
    if (typeof baseRevision !== "string") return reply.code(400).send({ error: "base-revision-required" });
    if (mode === "enforce" && confirm !== true) return reply.code(400).send({ error: "confirm-required" });
    const thresholds: Record<string, number> = {};
    if (isObj(body.thresholds))
      for (const [k, v] of Object.entries(body.thresholds)) if (typeof v === "number" && Number.isFinite(v)) thresholds[k] = v;
    try {
      const revision = mergeWrite((doc) => {
        const cal = isObj(doc.calibration) ? { ...doc.calibration } : {};
        cal[`${backendId}::${consumerId}`] = { mode, thresholds, model, measuredAt: new Date().toISOString() };
        doc.calibration = cal;
      }, baseRevision);
      return { revision };
    } catch (err) {
      if (err instanceof StaleRevisionError) return reply.code(409).send({ error: "stale-revision", revision: err.current });
      throw err;
    }
  });

  app.get("/api/system-one/managed", async () => {
    const cfg = loadConfig();
    const backends: Record<string, unknown> = {};
    for (const [id, b] of Object.entries(cfg.backends)) if (b.kind === "managed") backends[id] = deps.managed?.status(id) ?? null;
    return { platform: deps.managed?.platform() ?? null, uv: deps.managed?.hasLauncher() ?? false, backends };
  });

  app.post("/api/system-one/managed/:id/:action", guard, async (req, reply) => {
    const { id, action } = req.params as { id: string; action: string };
    if (!deps.managed) return reply.code(503).send({ error: "no-supervisor" });
    const b = Object.hasOwn(loadConfig().backends, id) ? loadConfig().backends[id] : undefined;
    if (!b || b.kind !== "managed") return reply.code(404).send({ error: "unknown-backend" });
    if (action === "start") return deps.managed.start(id);
    if (action === "stop") return deps.managed.stop(id);
    return reply.code(404).send({ error: "unknown-action" });
  });

  app.get("/api/system-one/managed/:id/log", async (req) => {
    const { id } = req.params as { id: string };
    return { lines: deps.managed?.log(id) ?? [] };
  });
}
