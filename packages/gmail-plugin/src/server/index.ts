/**
 * Gmail plugin server entry (design D1). Wires the account store over
 * `ctx.credentials` (namespace `gmail`), the REST routes and the
 * `gmail/lease` request handler. Degrades to a 501 route set when the host
 * lacks the credential/OAuth seams. See change: add-gmail-plugin.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { resolveGoogleEndpoints } from "../shared/endpoints.js";
import { ACCOUNTS_TYPE, LEASE_TYPE } from "../shared/protocol.js";
import { AccountStore, summarize } from "./accounts.js";
import { createLeaseHandler } from "./lease.js";
import { mountGmailRoutes } from "./routes.js";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  if (!ctx.credentials) {
    ctx.logger.warn("[gmail] host has no plugin credential store; plugin inactive");
    return;
  }
  const endpoints = resolveGoogleEndpoints(process.env, (m) => ctx.logger.warn(m));
  const store = new AccountStore(ctx.credentials);
  ctx.registerPiRequestHandler?.(LEASE_TYPE, createLeaseHandler({ store, endpoints, logger: ctx.logger }));
  // Secret-free account list for `gmail_accounts` and account-required errors.
  ctx.registerPiRequestHandler?.(ACCOUNTS_TYPE, async () => (await store.list()).map(summarize));
  await mountGmailRoutes(ctx.fastify, {
    store,
    oauth: ctx.oauth,
    endpoints,
    networkGuard: ctx.networkGuard,
    logger: ctx.logger,
  });
}
