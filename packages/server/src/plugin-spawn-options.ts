/**
 * Map a plugin `spawnSession` hook's `PluginSpawnOptions` to the
 * `spawnPiSession` options object. Extracted from the inline host hook so the
 * option forwarding (model / guard / env) is unit-testable. Each optional field
 * is forwarded only when present, so an absent field is byte-identical to today.
 * See change: scope-session-toolset-by-profile.
 */
import type { PluginSpawnOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { SessionOptions } from "./process-manager.js";

export function pluginSpawnToSessionOptions(
  opts: PluginSpawnOptions,
): SessionOptions & { strategy: "headless" } {
  return {
    strategy: "headless",
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.guard ? { guard: true } : {}),
    ...(opts.env ? { env: opts.env } : {}),
  };
}
