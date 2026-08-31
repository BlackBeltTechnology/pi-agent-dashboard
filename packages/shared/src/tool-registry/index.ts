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
    // THE production peer-seam binding (design D2): the only non-test
    // construction in the repo binds resolvePeer to THIS registry, so
    // npm's win32 anchoring follows the resolved node here — not just in
    // tests. Self-review of the registry is impossible here because the
    // seam is absent in any registry built without it (tests inject
    // their own).
    // See change: add-node-runtime-family-selection (section 3b).
    registerDefaultTools(defaultRegistry, {
      resolvePeer: bindPeerResolution(defaultRegistry.resolve.bind(defaultRegistry)),
    });
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
