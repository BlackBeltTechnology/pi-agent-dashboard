/**
 * Grammar plugin — server entry.
 *
 * Registers `POST /api/grammar/check` + `GET /api/grammar/health` via
 * `ctx.fastify`, running the `llm` backend through the in-process model
 * runtime (`ctx.modelRuntime`) so completions resolve credentials server-side
 * with no model-proxy loopback (and keep the Google→OpenAI-compat reroute).
 *
 * Config lives in the plugin namespace `plugins.grammar.*` (validated by
 * `configSchema.json`); read per request via `ctx.getPluginConfig()` so a
 * settings change needs no restart. On first load a legacy core
 * `config.grammar` block is migrated in once (read-through).
 * See change: make-grammar-fully-plugin-contained.
 */
import { readFileSync } from "node:fs";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { CONFIG_FILE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { parseGrammarConfig } from "../grammar-config.js";
import type { LlmModelRegistry, LlmStreamFn } from "./backends/llm.js";
import { mountGrammarRoutes } from "./routes.js";

/**
 * One-time migration: if the plugin has no `plugins.grammar` config yet but a
 * legacy core `config.grammar` block exists, copy it into the plugin namespace
 * so existing users keep their settings. Idempotent (skips once migrated).
 */
async function migrateLegacyConfig(ctx: ServerPluginContext): Promise<void> {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as {
      plugins?: Record<string, unknown>;
      grammar?: unknown;
    };
    const already = raw?.plugins?.grammar;
    const legacy = raw?.grammar;
    if (!already && legacy && typeof legacy === "object") {
      await ctx.updatePluginConfig(parseGrammarConfig(legacy));
      ctx.logger.info?.("migrated legacy config.grammar → plugins.grammar");
    }
  } catch {
    /* no config file yet — nothing to migrate */
  }
}

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  await migrateLegacyConfig(ctx);
  const runtime = ctx.modelRuntime;
  mountGrammarRoutes(ctx.fastify, {
    getGrammarConfig: () => parseGrammarConfig(ctx.getPluginConfig()),
    getModelRegistry: runtime
      ? () => runtime.getModelRegistry() as Promise<LlmModelRegistry | null>
      : undefined,
    streamSimple: runtime ? (runtime.streamSimple as LlmStreamFn) : undefined,
  });
  ctx.logger.info?.("grammar routes mounted (/api/grammar/check, /api/grammar/health)");
}
