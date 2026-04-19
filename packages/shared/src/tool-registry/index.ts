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
export * from "./strategies.js";

import { ToolRegistry } from "./registry.js";
import { registerDefaultTools } from "./definitions.js";

/**
 * Lazily-constructed process-wide registry. Most callers should use this
 * instead of constructing their own. Tests should pass a fresh
 * `new ToolRegistry({...})` with injected deps.
 *
 * The registry is also published on `globalThis` under a symbol so that
 * `platform/runner.ts` can pick it up synchronously without a module
 * import (which would create a load-order cycle through `platform/npm.ts`).
 */
const GLOBAL_KEY = Symbol.for("pi-dashboard.tool-registry");
type GlobalSlot = { [GLOBAL_KEY]?: ToolRegistry };

let defaultRegistry: ToolRegistry | null = null;
export function getDefaultRegistry(): ToolRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ToolRegistry();
    registerDefaultTools(defaultRegistry);
    (globalThis as unknown as GlobalSlot)[GLOBAL_KEY] = defaultRegistry;
  }
  return defaultRegistry;
}

/**
 * Global accessor for consumers that cannot import this module at the
 * top level (i.e. `platform/runner.ts`, which is part of a load-order
 * cycle). Returns `null` if `getDefaultRegistry()` hasn't been called
 * yet anywhere in the process.
 */
export function peekGlobalRegistry(): ToolRegistry | null {
  return (globalThis as unknown as GlobalSlot)[GLOBAL_KEY] ?? null;
}

/** Test-only: drop the process-wide registry so the next call rebuilds. */
export function _resetDefaultRegistry(): void {
  defaultRegistry = null;
  (globalThis as unknown as GlobalSlot)[GLOBAL_KEY] = undefined;
}
