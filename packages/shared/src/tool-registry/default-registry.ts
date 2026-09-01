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
import type { Resolution } from "./types.js";
import { ToolRegistry } from "./registry.js";
import { registerDefaultTools } from "./definitions.js";
import type { StrategyDeps } from "./strategies.js";

/**
 * Bind the peer-resolution seam to a registry's `resolve`, with the
 * re-entrancy guard at the binding (design D2): a lookup that would
 * re-enter a tool already in flight (or itself) is REFUSED (null) — the
 * strategy then falls back to its `execPath` seam. The guard must live
 * here, not in the registry: the cache is written only AFTER the
 * strategy loop, so a cache check alone cannot stop recursion.
 *
 * Lives in THIS module (not index.ts) for the same no-import-cycle
 * reason as the singleton itself. Re-exported from index.ts for tests.
 *
 * See change: add-node-runtime-family-selection (section 3b).
 */
export function bindPeerResolution(
  resolve: (name: string) => Resolution,
): NonNullable<StrategyDeps["resolvePeer"]> {
  const inFlight = new Set<string>();
  return (name: string, forTool: string): string | null => {
    if (name === forTool) return null;
    if (inFlight.has(name)) return null;
    inFlight.add(name);
    try {
      const r = resolve(name);
      return r.ok && r.path ? r.path : null;
    } finally {
      inFlight.delete(name);
    }
  };
}

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
