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
import { homedir } from "node:os";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { IB_DOMAIN_EVENT_MESSAGE } from "../shared/ib-events.js";
import { migrateIntakeAutomation, QUEUED_INVOICE_SOURCE_ID } from "./automation-migrate.js";
import { createCanonicalSessionStore, defaultCanonicalStorePath } from "./canonical-session-store.js";
import type { InvoiceEngine } from "./engine/port.js";
import { createQueuedInvoiceWorkSource } from "./queued-invoice-work-source.js";
import { selectEngine } from "./engine/select.js";
import { mountInvoiceBotRoutes } from "./routes.js";
import { auditRoleModels, describeRoleAudit, readRoleMap } from "./role-models.js";
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

  // Role plane: the in-session agents resolve their model through role aliases,
  // NOT through the spawn option, so a role can point at a different provider
  // than the pin. Audit and report (never rewrite — the role map is
  // operator-owned). Defensive: cannot throw, cannot block activation.
  // See change: pin-invoicebot-role-models.
  try {
    const pin = spawnModel();
    const audit = auditRoleModels(readRoleMap(homedir()), pin);
    const line = describeRoleAudit(audit, pin);
    if (audit.ok) ctx.logger.info(line);
    else ctx.logger.warn(line);
  } catch (err) {
    ctx.logger.warn(`invoicebot role audit failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // §5.4: expose the reverse sessionId → { IB_TOOLSET, IB_INVOICE_ID } lookup so
  // the host's auto-resume re-applies the bound scope on a continue-spawn (a
  // resumed scoped session must not boot on the full "ask" surface). Consumed by
  // the server via pluginServiceRegistry. See change: make-invoice-session-canonical.
  ctx.provide("invoicebot:resumeScopeEnv", sessionLink.resumeScopeEnv);

  // Per-invoice automation fan-out enumerator. The automation plugin consumes
  // this lazily at fire time (cross-plugin service seam) to expand a `scope:
  // per-invoice` action into one scoped run per queued invoice. Reads the
  // engine's `list` view filtered to the `queued` state and projects the ids.
  // Never throws — an unreadable query yields an empty list (no fan-out).
  // See change: wire-per-invoice-automation-drain.
  const listQueued = async (cwd: string): Promise<string[]> => {
    try {
      const result = await engine.query(cwd, { view: "list", state: "queued" });
      const items = (result.details as { items?: Array<{ id?: unknown }> }).items;
      if (!Array.isArray(items)) return [];
      return items.map((i) => i.id).filter((id): id is string => typeof id === "string" && id.length > 0);
    } catch (err) {
      ctx.logger.warn(`invoicebot queued-invoice enumerate failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  };
  ctx.provide("invoicebot:queuedInvoices", listQueued);

  // Register the queued-invoice WORK SOURCE through the automation plugin's
  // generic cross-plugin seam. The instance is created ONCE here and owned here
  // (it carries the lease state that makes "one distinct invoice per child" and
  // "one run per invoice" true); the automation plugin collects the published
  // descriptor lazily, so load order between the two plugins is irrelevant.
  // An automation names this id in `on: { kind: schedule.batch, source }`.
  // See change: relocate-fanout-to-work-source.
  const queuedInvoiceSource = createQueuedInvoiceWorkSource({
    listQueued,
    log: (m) => ctx.logger.info(m),
  });
  ctx.provide("automation.worksource.invoicebot", {
    id: QUEUED_INVOICE_SOURCE_ID,
    source: queuedInvoiceSource,
  });

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

  // Start ONE scoped run for a single queued invoice through the automation
  // plugin's per-invoice fan-out core. Consumed LAZILY per request (mirrors how
  // automation consumes `invoicebot:queuedInvoices`) so plugin load order is
  // irrelevant — the automation plugin may publish the service after this one
  // activates. Absent service ⇒ the route returns 503.
  // See change: serve-and-start-queued-invoice.
  const runInvoice = (cwd: string, invoiceId: string) => {
    const fn = ctx.consume<
      (cwd: string, key: string) => Promise<{ ok: boolean; runId?: string; reason?: string; error?: string }>
    >("automation:runWorkItem");
    return fn ? fn(cwd, invoiceId) : Promise.resolve(undefined);
  };

  // Migrate a DEPLOYED intake automation onto the work-source contract on the
  // same first-touch choke point that ensures it exists (decision D-YAML).
  // Wrapping here — rather than inside the routes — keeps the route layer
  // unchanged while covering every workspace-touching endpoint, and also fixes
  // YAML the engine writes fresh. Idempotent + non-fatal.
  // See change: relocate-fanout-to-work-source.
  // Explicit per-method delegation (never a spread — the bindings are class
  // instances whose methods live on the prototype and would not be copied).
  const engineWithMigration: InvoiceEngine = {
    query: (cwd, args) => engine.query(cwd, args),
    review: (cwd, args) => engine.review(cwd, args),
    setup: (cwd, args) => engine.setup(cwd, args),
    rules: (cwd, args) => engine.rules(cwd, args),
    ingest: (cwd, files) => engine.ingest(cwd, files),
    ensureAutomation: async (cwd: string) => {
      const res = await engine.ensureAutomation(cwd);
      try {
        const m = migrateIntakeAutomation(cwd);
        if (m.migrated) ctx.logger.info(`invoicebot: migrated intake automation to schedule.batch (${m.path})`);
      } catch (err) {
        ctx.logger.warn(
          `invoicebot intake automation migration failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return res;
    },
  };

  mountInvoiceBotRoutes(ctx.fastify, {
    engine: engineWithMigration,
    dispatchFlow: sessionLink.dispatchFlow,
    ensureScopedSession: sessionLink.ensureScopedSession,
    runInvoice,
  });

  ctx.logger.info(`invoicebot-plugin routes mounted (engine binding: ${binding})`);
}

export default registerPlugin;
