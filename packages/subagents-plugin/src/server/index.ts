/**
 * Plugin server entry for @blackbelt-technology/pi-dashboard-subagents-plugin.
 *
 * Responsibilities:
 *
 * 1. Startup reconcile (producer file → plugin config).
 *    Producer file is source of truth at startup. A boolean `inheritContext`
 *    and a numeric `maxConcurrent` (clamped to 0–64, as producer 0.6.0 runs
 *    it) are pushed into the dashboard plugin config via
 *    `ctx.updatePluginConfig`. The file itself is never rewritten here.
 *
 * 2. Write-through mirror (dashboard config → producer file).
 *    A Fastify onResponse hook fires when `POST /api/config/plugins/subagents`
 *    returns 200, merges the persisted plugin config into the producer file
 *    (preserving unexposed keys) and writes atomically. `maxConcurrent` is
 *    mirrored only when explicit in the plugin config AND different from what
 *    the producer already runs, so an unrelated save never overwrites a
 *    hand-set value (e.g. a file `100` shown as `64`).
 *
 * 3. `POST /api/plugins/subagents/stop {sessionId, agentId}` — per-subagent
 *    stop. Operate authority (absent seam ⇒ refuse), id validation, known
 *    session, then a FIXED `subagents:stop {agentId}` emit through the
 *    manifest `emits` allowlist; `false` ⇒ 503. Every request is logged.
 *
 * 4. `GET /api/plugins/subagents/limits` — read-only `{ heapCeilingMb }` for
 *    the "Max parallel subagents" heap warning.
 *
 * See change: add-subagent-inspector §16; subagent-queue-visibility (D3, D5).
 */
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
	clampMaxConcurrent,
	mergeIntoProducerSettings,
	readProducerFile,
	writeProducerFile,
} from "./producer-file.js";

const ROUTE_URL = "/api/config/plugins/subagents";
const STOP_URL = "/api/plugins/subagents/stop";
const LIMITS_URL = "/api/plugins/subagents/limits";
/** Fixed event type relayed into the session; never taken from the request. */
export const STOP_EVENT = "subagents:stop";
const MAX_ID_LEN = 128;

interface MirroredConfig {
	inheritContext?: boolean;
	maxConcurrent?: number;
}

/** Non-empty, ≤ 128 chars, no C0/C1 control characters. */
export function isValidId(v: unknown): v is string {
	return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LEN && !/[\u0000-\u001f\u007f-\u009f]/.test(v);
}

function reconcile(ctx: ServerPluginContext): Promise<void> | void {
	const producer = readProducerFile();
	const patch: MirroredConfig = {};
	if (typeof producer.inheritContext === "boolean") patch.inheritContext = producer.inheritContext;
	const max = clampMaxConcurrent(producer.maxConcurrent);
	if (max !== undefined) patch.maxConcurrent = max;
	if (Object.keys(patch).length === 0) return;
	ctx.logger.info(`reconciled producer file → plugin config: ${JSON.stringify(patch)}`);
	return ctx.updatePluginConfig(patch);
}

function registerStopRoute(ctx: ServerPluginContext): void {
	ctx.fastify.post(STOP_URL, { preHandler: ctx.networkGuard }, async (request: FastifyRequest, reply: FastifyReply) => {
		const log = (outcome: string, ids?: { sessionId: string; agentId: string }) =>
			ctx.logger.info(
				`stop request${ids ? ` session=${ids.sessionId} agent=${ids.agentId}` : ""} outcome=${outcome}`,
			);
		if (ctx.identity?.hasOperateAuthority?.(request) !== true) {
			log("forbidden");
			return reply.code(403).send({ error: "operate authority required" });
		}
		const body = (request.body ?? {}) as Record<string, unknown>;
		const { sessionId, agentId } = body;
		if (!isValidId(sessionId) || !isValidId(agentId)) {
			log("invalid-id");
			return reply.code(400).send({ error: "sessionId and agentId must be 1–128 characters without control characters" });
		}
		const ids = { sessionId, agentId };
		if (!ctx.sessionManager.getSession(sessionId)) {
			log("unknown-session", ids);
			return reply.code(404).send({ error: "unknown session" });
		}
		// Fixed type, only `agentId` forwarded: the body cannot choose the event or its payload.
		if (!ctx.emitEventToSession(sessionId, STOP_EVENT, { agentId })) {
			log("not-delivered", ids);
			return reply.code(503).send({ error: "session not reachable" });
		}
		log("requested", ids);
		return reply.send({ ok: true });
	});
}

function registerLimitsRoute(ctx: ServerPluginContext): void {
	ctx.fastify.get(LIMITS_URL, { preHandler: ctx.networkGuard }, async () => {
		const mb = loadConfig().sessionHeap?.maxOldSpaceMb;
		return { heapCeilingMb: typeof mb === "number" && Number.isFinite(mb) ? mb : null };
	});
}

/**
 * Merge the persisted plugin config into the producer file. An explicit limit is
 * mirrored only when it changes what the producer runs, so an unrelated save
 * never overwrites a hand-set value (a file `100` shown as `64`).
 */
function mirrorToProducer(ctx: ServerPluginContext): void {
	const cfg = ctx.getPluginConfig<MirroredConfig>();
	const existing = readProducerFile();
	const explicitMax = clampMaxConcurrent(cfg.maxConcurrent);
	const maxConcurrent =
		explicitMax !== undefined && explicitMax !== clampMaxConcurrent(existing.maxConcurrent) ? explicitMax : undefined;
	writeProducerFile(mergeIntoProducerSettings(existing, { inheritContext: cfg.inheritContext, maxConcurrent }));
	ctx.logger.info(
		`mirrored plugin config → producer file: inheritContext=${cfg.inheritContext}` +
			(maxConcurrent !== undefined ? ` maxConcurrent=${maxConcurrent}` : ""),
	);
}

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
	// ── 1. Startup reconcile ─────────────────────────────────────────────
	try {
		await reconcile(ctx);
	} catch (err) {
		ctx.logger.warn(
			"startup reconcile failed:",
			err instanceof Error ? err.message : err,
		);
	}

	// ── 2. Write-through mirror via Fastify onResponse hook ──────────────
	ctx.fastify.addHook("onResponse", (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
		try {
			if (
				request.method === "POST" &&
				request.url === ROUTE_URL &&
				reply.statusCode === 200
			) {
				mirrorToProducer(ctx);
			}
		} catch (err) {
			ctx.logger.warn(
				"write-through mirror failed:",
				err instanceof Error ? err.message : err,
			);
		}
		done();
	});

	// ── 3./4. Plugin routes ──────────────────────────────────────────────
	registerStopRoute(ctx);
	registerLimitsRoute(ctx);
}
