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
import { loadConfig } from "@blackbelt-technology/pi-dashboard-kb";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { KbJobRegistry } from "./job-registry.js";
import { applyConfigPatch, isAllowedCwd, mountKbRoutes, reindexAll } from "./kb-routes.js";

const HOST_KNOWN_FOLDERS = "host.knownFolderCwds";
const PLUGIN_ID = "kb";

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

  // plugin_action handler: reindex + config mutations reach the SAME cores the
  // REST routes call (no HTTP re-entry), guarded by the same cwd allow-list.
  // Fan-out routes this only for pluginId==="kb"; the guard is defense-in-depth.
  // See change: fix-plugin-action-fanout-and-handlers.
  ctx.registerBrowserHandler("plugin_action", (msg) => {
    const m = msg as { pluginId?: string; action?: string; payload?: Record<string, unknown> };
    if (m.pluginId !== PLUGIN_ID) return;
    const payload = m.payload ?? {};
    const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
    if (!isAllowedCwd(cwd, knownCwds)) {
      ctx.logger.warn(`kb ${m.action ?? "(no action)"}: cwd not allowed (${cwd ?? "missing"})`);
      return;
    }
    switch (m.action) {
      case "reindex": {
        if (!registry.isRunning(cwd)) {
          registry
            .start(cwd, async () => reindexAll(cwd))
            .promise.catch((err) =>
              ctx.logger.error(`kb reindex failed for ${cwd}: ${err instanceof Error ? err.message : String(err)}`),
            );
        }
        ctx.logger.info(`kb reindex started cwd=${cwd} jobId=${registry.jobId(cwd) ?? "kb"}`);
        break;
      }
      case "config.set": {
        // Require a plain-object patch (arrays pass a bare typeof check; a
        // missing patch must NOT silently fall back to the control payload).
        if (!payload.patch || typeof payload.patch !== "object" || Array.isArray(payload.patch)) {
          ctx.logger.warn(`kb config.set rejected cwd=${cwd}: invalid patch (expected object)`);
          return;
        }
        const patch = payload.patch as Parameters<typeof applyConfigPatch>[1];
        const result = applyConfigPatch(cwd, patch);
        if (!result.ok) {
          ctx.logger.warn(`kb config.set rejected cwd=${cwd}: ${result.error}`);
          return;
        }
        if (payload.reindex && !registry.isRunning(cwd)) {
          registry.start(cwd, async () => reindexAll(cwd)).promise.catch(() => {});
        }
        const cfg = loadConfig(cwd);
        ctx.logger.info(`kb config.set applied cwd=${cwd} origin=${cfg.origin}`);
        break;
      }
      default:
        ctx.logger.warn(`unknown kb action: ${m.action}`);
    }
  });
}

export default registerPlugin;
