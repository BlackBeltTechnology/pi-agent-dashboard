/**
 * Process-wide default `ToolRegistry` singleton.
 *
 * Lives in its OWN module (not index.ts) so low-level consumers (ensure.ts)
 * can import `getDefaultRegistry` without cycling index.js ⇄ back — index
 * re-exports ensure.js, so anything index.ts imports is in its upstream
 * closure and Biome noImportCycles rejects the round trip.
 * See change: add-skill-tool-provisioning (CodeRabbit/CI round 2).
 *
 * The registry is also published on `globalThis` under a symbol so that
 * `platform/runner.ts` can pick it up synchronously without a module
 * import (which would create a load-order cycle through `platform/npm.ts`).
 */
import { ToolRegistry } from "./registry.js";
import { registerDefaultTools } from "./definitions.js";

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
