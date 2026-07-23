/**
 * invoicebot-plugin SERVER entry.
 *
 * Selects the engine binding (Real over the invoice-bot `file:` link, else Fake
 * for CI / worktree / release), builds the flow-dispatch + session-linkage seam
 * from the host context, and mounts the four `/api/plugins/invoicebot/*` routes.
 *
 * Wired by the dashboard plugin loader via the `server` field in the manifest.
 * `loadServerEntries` awaits this before `fastify.listen`, so awaiting the
 * (cheap, single dynamic-import) engine selection before mounting is safe — the
 * routes are registered before the server listens. See change:
 * add-invoicebot-rest-plugin.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { selectEngine } from "./engine/select.js";
import { mountInvoiceBotRoutes } from "./routes.js";
import { createSessionLink, recordedSessionIdsFromDetails } from "./session-link.js";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("invoicebot-plugin server entry activated");

  const { engine, binding } = await selectEngine((m) => ctx.logger.info(m));

  // Flow-dispatch + invoice_id ↔ sessionId linkage. `spawnSession` /
  // `emitEventToSession` are trust-gated to first-party plugins (untrusted get
  // no-op hooks) — the invoicebot plugin is first-party, mirroring automation-plugin.
  const sessionLink = createSessionLink({
    spawnSession: (opts) => ctx.spawnSession(opts),
    emitEventToSession: (sid, type, data) => ctx.emitEventToSession(sid, type, data),
    getSession: (id) => ctx.sessionManager.getSession(id),
    listAll: () => ctx.sessionManager.listAll(),
    onEvent: (handler) => ctx.onEvent(handler),
    resolveRecordedSessionIds: async (cwd, invoiceId) => {
      const result = await engine.query(cwd, { view: "runs", invoice_id: invoiceId });
      return recordedSessionIdsFromDetails(result.details);
    },
    logger: { info: (m) => ctx.logger.info(m), warn: (m) => ctx.logger.warn(m) },
  });

  mountInvoiceBotRoutes(ctx.fastify, {
    engine,
    dispatchFlow: sessionLink.dispatchFlow,
    ensureScopedSession: sessionLink.ensureScopedSession,
  });

  ctx.logger.info(`invoicebot-plugin routes mounted (engine binding: ${binding})`);
}

export default registerPlugin;
