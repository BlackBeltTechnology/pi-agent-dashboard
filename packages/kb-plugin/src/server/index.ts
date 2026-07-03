/**
 * kb-plugin · SERVER entry.
 *
 * Mounts the `/api/kb/*` REST routes (stats / reindex / config) synchronously
 * (must register before `fastify.listen`). Reindex + config writes run here in
 * the dashboard-server process — no pi session required — so a session-less
 * worktree is both indexable and configurable (design §1b, §2).
 *
 * cwd validation consumes the host-provided `host.knownFolderCwds` service
 * (session cwds ∪ pinned dirs). Falls back to session cwds alone when the host
 * predates that seam. See change: add-kb-folder-slot.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { KbJobRegistry } from "./job-registry.js";
import { mountKbRoutes } from "./kb-routes.js";

const HOST_KNOWN_FOLDERS = "host.knownFolderCwds";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("kb-plugin server entry activated");
  const registry = new KbJobRegistry();

  const hostKnown = ctx.consume<() => string[]>(HOST_KNOWN_FOLDERS);
  const knownCwds = (): string[] => {
    if (hostKnown) return hostKnown();
    // Fallback: session cwds only (host lacks the pinned-dir seam). A
    // session-less worktree is unreachable in this mode — the host provide
    // is the supported path.
    return (ctx.sessionManager.listAll() as Array<{ cwd?: string }>)
      .map((s) => s.cwd)
      .filter((c): c is string => typeof c === "string" && c.length > 0);
  };

  mountKbRoutes(ctx.fastify, { knownCwds, registry });
}

export default registerPlugin;
