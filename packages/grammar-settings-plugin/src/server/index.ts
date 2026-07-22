/**
 * Grammar plugin — server entry.
 *
 * Registers `POST /api/grammar/check` + `GET /api/grammar/health` via
 * `ctx.fastify`, running the `llm` backend through the in-process model
 * runtime (`ctx.modelRuntime`) so completions resolve credentials server-side
 * with no model-proxy loopback (and keep the Google→OpenAI-compat reroute).
 *
 * Config is read per request from the core `config.grammar` block for now;
 * migration to the `plugins.grammar.*` namespace is a later increment.
 * See change: make-grammar-fully-plugin-contained.
 */
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { LlmModelRegistry, LlmStreamFn } from "./backends/llm.js";
import { mountGrammarRoutes } from "./routes.js";

export default function registerPlugin(ctx: ServerPluginContext): void {
  const runtime = ctx.modelRuntime;
  mountGrammarRoutes(ctx.fastify, {
    getGrammarConfig: () => loadConfig().grammar,
    getModelRegistry: runtime
      ? () => runtime.getModelRegistry() as Promise<LlmModelRegistry | null>
      : undefined,
    streamSimple: runtime ? (runtime.streamSimple as LlmStreamFn) : undefined,
  });
  ctx.logger.info?.("grammar routes mounted (/api/grammar/check, /api/grammar/health)");
}
