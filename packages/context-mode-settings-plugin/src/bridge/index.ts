/**
 * context-mode-settings-plugin · BRIDGE entry (pi extension).
 *
 * At extension load, synchronously reads `~/.pi/context-mode/settings.json` and
 * sets the mapped RUNTIME-scope env vars on `process.env` when not already set,
 * before context-mode lazily spawns its MCP child. Storage-scope settings are
 * never projected here (context-mode opens its stores at its own load; late
 * delivery would split the stores). Records projected names in
 * `PI_CONTEXT_MODE_SETTINGS_PROJECTED` so a dashboard server this process
 * auto-starts can tell them from operator exports. Never throws.
 *
 * See change: add-context-mode-settings-plugin (D4).
 */

import { readSettingsFile, resolveSettingsPath } from "../server/settings-io.js";
import { PROJECTED_MARKER_ENV, projectEnv, RUNTIME_ENV_NAMES } from "../shared/settings-descriptors.js";

export function applyRuntimeSettings(env: NodeJS.ProcessEnv = process.env, filePath: string = resolveSettingsPath()): string[] {
  try {
    const r = readSettingsFile(filePath);
    if (r.state === "corrupt") return [];
    // An ancestor bridge's projection is not an operator export: treat the
    // names it listed as absent so this session re-reads the current file.
    const inherited = (env[PROJECTED_MARKER_ENV] ?? "").split(",").map((s) => s.trim());
    const supersedable = new Set(inherited.filter((n) => RUNTIME_ENV_NAMES.includes(n)));
    const projected = r.state === "ok" ? projectEnv(r.settings, { scopes: ["runtime"] }) : {};
    // Names an ancestor projected that the current file no longer yields are stale.
    for (const name of supersedable) if (!(name in projected)) delete env[name];
    const applied: string[] = [];
    for (const [name, value] of Object.entries(projected)) {
      if (env[name] !== undefined && !supersedable.has(name)) continue;
      env[name] = value;
      applied.push(name);
    }
    if (applied.length > 0) env[PROJECTED_MARKER_ENV] = applied.join(",");
    else delete env[PROJECTED_MARKER_ENV];
    return applied;
  } catch {
    return [];
  }
}

export default function activate(_pi?: unknown): void {
  applyRuntimeSettings();
}
