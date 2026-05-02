/**
 * Server entry for the jj-plugin.
 *
 * Phase-3 scaffold: registers the plugin context but exposes no routes
 * yet. Phase 5 adds:
 *   - POST /api/jj/workspace/add        (creates workspace + spawns session)
 *   - POST /api/jj/workspace/forget     (refuses on unfolded work; force escape hatch)
 *   - GET  /api/jj/workspace/list       (per-cwd workspace enumeration)
 *   - POST /api/jj/init-colocated       (gated on showInitColocatedSuggestion + clean index)
 *
 * Wired by the plugin loader via the `server` field in the manifest.
 * See change: add-jj-workspace-plugin.
 */

/**
 * Plugin server `registerPlugin` hook. The dashboard's plugin loader
 * invokes this with a `ServerPluginContext` (see
 * `packages/dashboard-plugin-runtime/src/server/server-context.ts`).
 *
 * For Phase 3 this is a no-op; the function exists so the manifest's
 * `server` path resolves to a valid module and the loader doesn't
 * complain about a missing entry.
 */
export function registerPlugin(_ctx: unknown): void {
  // Phase 5 will register routes here.
}

export default registerPlugin;
