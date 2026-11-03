/**
 * MCP `spawn_session` → plugin `spawnSession` hook. Forwards the full input
 * (cwd, agent, model, thinkingLevel, initialPrompt); the hook resolves `@role`
 * refs and reports a dropped choice in `warning`, which rides in the JSON tool
 * result text. Absent / non-string optional args are not forwarded.
 *
 * See change: add-spawn-model-choice (design D4).
 */
import type { PluginSpawnOptions, PluginSpawnResult } from "@blackbelt-technology/dashboard-plugin-runtime/server";

const OPTIONAL = ["agent", "model", "thinkingLevel", "initialPrompt"] as const;

function spawnSessionToolOptions(args: Record<string, unknown>): PluginSpawnOptions {
  const opts: PluginSpawnOptions = { cwd: args.cwd as string };
  for (const key of OPTIONAL) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0) opts[key] = v;
  }
  return opts;
}

export function runSpawnSessionTool(
  spawnSession: (opts: PluginSpawnOptions) => Promise<PluginSpawnResult>,
  args: Record<string, unknown>,
): Promise<PluginSpawnResult> {
  return spawnSession(spawnSessionToolOptions(args));
}
