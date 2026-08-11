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
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { IB_DOMAIN_EVENT_MESSAGE } from "../shared/ib-events.js";
import { createCanonicalSessionStore, defaultCanonicalStorePath } from "./canonical-session-store.js";
import { selectEngine } from "./engine/select.js";
import { mountInvoiceBotRoutes } from "./routes.js";
import { createSessionLink, recordedSessionIdsFromDetails } from "./session-link.js";
import { resolveSpawnModel } from "./spawn-model.js";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("invoicebot-plugin server entry activated");

  const { engine, binding } = await selectEngine((m) => ctx.logger.info(m));

  // Model pinned on EVERY invoicebot-owned spawn. Read per spawn (not snapshotted
  // at boot) so a config edit applies to the next spawn. Precedence: this
  // plugin's own trusted config → dashboard `config.json#defaultModel` →
  // `IB_MODEL` → host default. Config values only — never a credential.
  // See change: pin-invoicebot-spawn-model.
  const spawnModel = (): string | undefined => {
    const cfg = ctx.getPluginConfig<{ model?: unknown; defaultModel?: unknown }>() ?? {};
    let dashboardDefaultModel: unknown;
    try {
      dashboardDefaultModel = loadConfig().defaultModel;
    } catch {
      dashboardDefaultModel = undefined; // unreadable config must never block a spawn
    }
    return resolveSpawnModel(
      {
        pluginConfigModel: cfg.model,
        pluginConfigDefaultModel: cfg.defaultModel,
        dashboardDefaultModel,
        envModel: process.env.IB_MODEL,
      },
      { warn: (m) => ctx.logger.warn(m) },
    );
  };

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
    // Durable canonical invoice→session link (Decision 1, Option B) — survives a
    // dashboard restart and follows a resume successor. See change:
    // make-invoice-session-canonical.
    canonicalStore: createCanonicalSessionStore(defaultCanonicalStorePath()),
    logger: { info: (m) => ctx.logger.info(m), warn: (m) => ctx.logger.warn(m) },
    resolveSpawnModel: spawnModel,
  });

  ctx.logger.info(`invoicebot spawn model: ${spawnModel() ?? "(host default — none configured)"}`);

  // §5.4: expose the reverse sessionId → { IB_TOOLSET, IB_INVOICE_ID } lookup so
  // the host's auto-resume re-applies the bound scope on a continue-spawn (a
  // resumed scoped session must not boot on the full "ask" surface). Consumed by
  // the server via pluginServiceRegistry. See change: make-invoice-session-canonical.
  ctx.provide("invoicebot:resumeScopeEnv", sessionLink.resumeScopeEnv);

  // App-level InvoiceBot domain-event rebroadcast. The plugin BRIDGE entry
  // observes the declared `ib:*` bus channels in-session and forwards each as
  // a generic `plugin_pi_message` with messageType "ib_domain_event"; this
  // handler pushes the UNCHANGED wire frame
  // `{ type:"ib_domain_event", sessionId, event:{ eventType, data } }` to
  // every connected browser (broadcastToSubscribers fans out to all browser
  // sockets), independent of per-session subscription. Malformed frames
  // (missing sessionId / eventType, null-ish data) are skipped with a
  // rate-limited warn, never fatal. Live-delta only — no replay.
  // See change: relocate-ib-domain-events-to-plugin.
  let ibSkipped = 0;
  ctx.registerPiHandler(IB_DOMAIN_EVENT_MESSAGE, (msg) => {
    const m = msg as {
      sessionId?: unknown;
      payload?: { eventType?: unknown; data?: unknown } | null;
    };
    const eventType = m.payload?.eventType;
    const data = m.payload?.data;
    if (typeof m.sessionId !== "string" || typeof eventType !== "string" || data === undefined || data === null) {
      ibSkipped++;
      if (ibSkipped % 100 === 1) {
        ctx.logger.warn(`skipped ${ibSkipped} malformed ib domain event frame(s) (last type=${String(eventType)})`);
      }
      return;
    }
    ctx.broadcastToSubscribers({
      type: "ib_domain_event",
      sessionId: m.sessionId,
      event: { eventType, data },
    });
  });

  mountInvoiceBotRoutes(ctx.fastify, {
    engine,
    dispatchFlow: sessionLink.dispatchFlow,
    ensureScopedSession: sessionLink.ensureScopedSession,
  });

  ctx.logger.info(`invoicebot-plugin routes mounted (engine binding: ${binding})`);
}

export default registerPlugin;
