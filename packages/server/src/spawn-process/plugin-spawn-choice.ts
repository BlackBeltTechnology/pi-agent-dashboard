/**
 * Plugin `spawnSession` hook: map plugin options to session options and apply
 * the spawn-time model choice. Literal models keep the mapper's verbatim
 * pass-through (trusted first-party callers); only `@role` refs resolve, via the
 * shared resolver, and a thinking-only choice pairs with the default model.
 * Drops are reported in `warning` (lenient road). Never throws.
 *
 * See change: add-spawn-model-choice (design D1, D2).
 */
import { type MappedSpawnOptions, type PluginSpawnOptions, pluginSpawnToSessionOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { THINKING_LEVELS } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
import { type ResolveSpawnChoiceContext, resolveSpawnChoice, validateSpawnChoice } from "../browser-handlers/spawn-choice.js";

export interface PluginSpawnMapping {
  options: MappedSpawnOptions;
  warning?: string;
}

export function mapPluginSpawnOptions(opts: PluginSpawnOptions, ctx: ResolveSpawnChoiceContext = {}): PluginSpawnMapping {
  const options = pluginSpawnToSessionOptions(opts);
  const warnings: string[] = [];
  const level = (opts as { thinkingLevel?: unknown }).thinkingLevel;
  const hasLevel = level !== undefined && level !== null && level !== "";
  if (hasLevel && !(typeof level === "string" && (THINKING_LEVELS as readonly string[]).includes(level))) {
    console.warn("[plugin-hook] ignoring invalid thinkingLevel");
    warnings.push("invalid thinkingLevel ignored");
  }

  const model = (opts as { model?: unknown }).model;
  if (typeof model === "string" && model.trim().startsWith("@")) {
    const { choice, warnings: w } = resolveSpawnChoice(
      { model, ...(hasLevel ? { thinkingLevel: level } : {}) },
      ctx,
    );
    // The resolver already reported an invalid level; keep one warning per drop.
    warnings.push(...w.filter((x) => !warnings.includes(x)));
    delete options.model;
    delete options.thinking;
    if (choice.model) options.model = choice.model;
    if (choice.thinking) options.thinking = choice.thinking;
  } else if (options.thinking && !options.model && ctx.defaultModel) {
    const fallback = validateSpawnChoice({ model: ctx.defaultModel, thinkingLevel: options.thinking });
    if (fallback.model) options.model = fallback.model;
  }
  return warnings.length > 0 ? { options, warning: warnings.join("; ") } : { options };
}
