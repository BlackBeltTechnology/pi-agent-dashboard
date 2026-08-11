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
 * One-time migration + legacy-key prune. Two cases:
 *
 * 1. No `plugins.grammar` yet but a legacy core `config.grammar` block exists →
 *    copy it into the plugin namespace (through `parseGrammarConfig`, which
 *    drops the removed `backend`/`languagetool` keys) so existing users keep
 *    their settings.
 * 2. `plugins.grammar` already exists AND still carries a `backend` or
 *    `languagetool` key from the LanguageTool era → re-write it through
 *    `parseGrammarConfig` to strip them. The plugin config schema is
 *    `additionalProperties:false`, so leaving the stale keys on disk both
 *    re-persists them forever and risks an Ajv throw if that config is ever
 *    validated directly. Idempotent: once pruned, `already` has no legacy key
 *    and the block is skipped.
 *
 * See changes: make-grammar-fully-plugin-contained, grammar-llm-only-with-explore.
 */
async function migrateLegacyConfig(ctx: ServerPluginContext): Promise<void> {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as {
      plugins?: Record<string, unknown>;
      grammar?: unknown;
    };
    const already = raw?.plugins?.grammar as Record<string, unknown> | undefined;
    const legacy = raw?.grammar;
    if (!already && legacy && typeof legacy === "object") {
      await ctx.updatePluginConfig(parseGrammarConfig(legacy));
      ctx.logger.info?.("migrated legacy config.grammar → plugins.grammar");
    } else if (already && ("backend" in already || "languagetool" in already)) {
      // `updatePluginConfig` shallow-merges (`{...current, ...partial}`), so a
      // clean partial cannot REMOVE an on-disk key. Set the two legacy keys to
      // `undefined` in the partial — JSON.stringify drops them on write.
      await ctx.updatePluginConfig({
        ...parseGrammarConfig(already),
        backend: undefined,
        languagetool: undefined,
      } as Record<string, unknown>);
      ctx.logger.info?.("pruned legacy backend/languagetool keys from plugins.grammar");
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
