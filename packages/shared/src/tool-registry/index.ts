/**
 * Tool registry — single-source resolver for every external binary/module
 * the dashboard depends on. See change: consolidate-tool-resolution.
 *
 * Quick start:
 *
 *   import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry";
 *   const r = getDefaultRegistry().resolve("pi");
 *   if (r.ok) spawn(r.path!, args);
 */
export * from "./types.js";
export { OverridesStore, defaultOverridesPath } from "./overrides.js";
export { ToolRegistry } from "./registry.js";
export { registerDefaultTools } from "./definitions.js";
export { parseSkillTools, ingestSkillTools, discoverSkillManifests, ingestInstalledSkillTools, resolveInstallRoot } from "./pi-tools.js";
export type { DiscoveredSkillManifest, IngestionRecord, ParseSkillToolsResult } from "./pi-tools.js";
export { ensureTools } from "./ensure.js";
export type {
  EnsureAction,
  EnsureOptions,
  EnsureReport,
  EnsureToolEntry,
  EnsureToolSpec,
} from "./ensure.js";
export * from "./strategies.js";

export { bindPeerResolution } from "./default-registry.js";
export {
  getDefaultRegistry,
  peekGlobalRegistry,
  _resetDefaultRegistry,
} from "./default-registry.js";
