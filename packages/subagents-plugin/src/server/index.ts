/**
 * Plugin server entry for @blackbelt-technology/pi-dashboard-subagents-plugin.
 *
 * Minimal — only two responsibilities, both via the canonical plugin-settings
 * flow (no custom REST routes):
 *
 * 1. Startup reconcile (producer file → plugin config).
 *    Producer file is source of truth at startup. Read it; if it has a
 *    defined `inheritContext`, push it into the dashboard plugin config via
 *    `ctx.updatePluginConfig`. This ensures the settings toggle reflects what
 *    the producer is actually doing on first load — even if the user has been
 *    editing the producer file by hand.
 *
 * 2. Write-through mirror (dashboard config → producer file).
 *    Install a Fastify onResponse hook that fires when
 *    `POST /api/config/plugins/subagents` returns 200. Read the just-persisted
 *    plugin config via `ctx.getPluginConfig`, merge with existing producer-file
 *    contents (preserving unexposed keys), write atomically.
 *
 * See change: add-subagent-inspector §16, design.md Decisions 9 + 10.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { FastifyRequest, FastifyReply } from "fastify";
import {
	mergeIntoProducerSettings,
	readProducerFile,
	writeProducerFile,
} from "./producer-file.js";

const ROUTE_URL = "/api/config/plugins/subagents";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
	// ── 1. Startup reconcile ─────────────────────────────────────────────
	try {
		const producer = readProducerFile();
		if (typeof producer.inheritContext === "boolean") {
			await ctx.updatePluginConfig({ inheritContext: producer.inheritContext });
			ctx.logger.info(
				`reconciled producer file → plugin config: inheritContext=${producer.inheritContext}`,
			);
		}
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
				const cfg = ctx.getPluginConfig<{ inheritContext?: boolean }>();
				const existing = readProducerFile();
				const merged = mergeIntoProducerSettings(existing, {
					inheritContext: cfg.inheritContext,
				});
				writeProducerFile(merged);
				ctx.logger.info(
					`mirrored plugin config → producer file: inheritContext=${cfg.inheritContext}`,
				);
			}
		} catch (err) {
			ctx.logger.warn(
				"write-through mirror failed:",
				err instanceof Error ? err.message : err,
			);
		}
		done();
	});
}
