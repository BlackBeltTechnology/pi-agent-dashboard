/**
 * Gmail plugin server entry (design D1). Wires the legacy account store over `ctx.credentials` (namespace
 * `gmail`), the `gmail/lease` + `gmail/accounts` request handlers and the moved-route stubs. Gmail links to
 * Google Connect softly (`google-link.ts`): while it owns the accounts both lanes answer
 * `{delegate:"google"}` and the bridge leases from `google/lease`; otherwise Gmail leases from its own data
 * as before. Degrades to inactive when the host lacks the credential seam. See change: add-google-connect.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { resolveGoogleEndpoints } from "../shared/endpoints.js";
import { ACCOUNTS_TYPE, type DelegateReply, GOOGLE_PLUGIN_ID, LEASE_TYPE } from "../shared/protocol.js";
import { isOp } from "../shared/scopes.js";
import { AccountStore, summarize } from "./accounts.js";
import { createGoogleLink } from "./google-link.js";
import { createLeaseHandler } from "./lease.js";
import { mountGmailRoutes } from "./routes.js";

const DELEGATE: DelegateReply = { delegate: GOOGLE_PLUGIN_ID };

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  if (!ctx.credentials) {
    ctx.logger.warn("[gmail] host has no plugin credential store; plugin inactive");
    return;
  }
  const endpoints = resolveGoogleEndpoints(process.env, (m) => ctx.logger.warn(m));
  const store = new AccountStore(ctx.credentials);
  const link = createGoogleLink({ consumeAll: ctx.consumeAll, store, logger: ctx.logger });
  const legacyLease = createLeaseHandler({ store, endpoints, logger: ctx.logger });
  // Both handlers are hub-local-only: `gmail/lease` returns a live OAuth access token (or the delegation to the
  // lane that does) and `gmail/accounts` lists mailbox identities. The host refuses them (`origin_denied`) for a
  // remote-origin session or a deprecated admission. See change: harden-bridge-session-claim (D3).
  ctx.registerPiRequestHandler?.(
    LEASE_TYPE,
    async (payload: unknown) => {
      if (!(await link.ensure()).delegating) return legacyLease(payload);
      const p = (payload ?? {}) as { account?: unknown; op?: unknown };
      if (typeof p.account !== "string" || !p.account.trim() || !isOp(p.op)) throw new Error("bad_request: expected {account, op}");
      return DELEGATE;
    },
    { hubLocalOnly: true },
  );
  // Secret-free account list for `gmail_accounts` and account-required errors.
  ctx.registerPiRequestHandler?.(
    ACCOUNTS_TYPE,
    async () => ((await link.ensure()).delegating ? DELEGATE : (await store.list()).map(summarize)),
    { hubLocalOnly: true },
  );
  await mountGmailRoutes(ctx.fastify, { networkGuard: ctx.networkGuard, link });
}
