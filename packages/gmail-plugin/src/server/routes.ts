/**
 * Gmail plugin REST routes (design D3/D4/D7/D9). All under
 * `/api/plugins/gmail/`, all behind `networkGuard`, in an encapsulated scope
 * with `@fastify/rate-limit` (loopback allow-listed). Tiers: `operate`
 * (`packages/shared/src/route-tiers.ts`). Responses NEVER carry tokens or the
 * client secret. See change: add-gmail-plugin.
 * A failed sign-in logs ONE `[gmail] sign-in failed: <code>` warn, code from
 * `KNOWN_FLOW_CODES` or `sign_in_failed`. See change: improve-gmail-settings-ux.
 */

import type {
  PluginNetworkGuard,
  PluginOAuth,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { GoogleEndpoints } from "../shared/endpoints.js";
import { knownFlowCode } from "../shared/flow-codes.js";
import { isTier, scopesCoverFilters, scopesCoverTier, TIERS, type Tier } from "../shared/scopes.js";
import { classifyProjectId, isEmail, normalizeEmail, normalizeProjectId } from "../shared/setup.js";
import { AccountError, type AccountStore, summarize } from "./accounts.js";
import { revokeToken } from "./gmail-rest.js";
import {
  createGoogleLoginFlow,
  GmailFlowError,
  type GoogleLoginOptions, type GoogleSignInResult,
} from "./google-oauth.js";
import type { DedicatedBrowserService } from "./setup/browser-service.js";
import { type RunDeps, SetupRunManager } from "./setup/run.js";
import { autoSetupState, registerSetupRoutes } from "./setup/setup-routes.js";
import { storeClient } from "./store-client.js";

export interface GmailRouteDeps {
  store: AccountStore;
  oauth: PluginOAuth | undefined;
  endpoints: GoogleEndpoints;
  networkGuard: PluginNetworkGuard;
  logger: { info(m: string): void; warn(m: string): void };
  fetchImpl?: typeof fetch;
  createCallback?: GoogleLoginOptions["createCallback"];
  newId?: () => string;
  /** Plugin config seam (`ctx.getPluginConfig` / `ctx.updatePluginConfig`) for the saved setup fields. */
  config?: {
    get(): Record<string, unknown>;
    update(partial: Record<string, unknown>): Promise<void>;
  };
  /** Lazy lookup of the browser plugin's `browser.dedicated` service (`ctx.consume`), per request. */
  getBrowserService?: () => DedicatedBrowserService | undefined;
  /** Test seams for the automatic setup run. */
  setup?: Pick<RunDeps, "timing" | "wsFactory" | "newId">;
}

const PREFIX = "/api/plugins/gmail";

function accountErrorStatus(err: AccountError): number {
  if (err.code === "not_found") return 404;
  if (err.code === "alias_taken" || err.code === "ambiguous") return 409;
  return 400;
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof AccountError) {
    return reply.code(accountErrorStatus(err)).send({ error: err.code, message: err.message });
  }
  const code = (err as { code?: unknown })?.code;
  return reply
    .code(502)
    .send({ error: typeof code === "string" && /^[a-z_]{1,64}$/.test(code) ? code : "internal_error" });
}

export async function mountGmailRoutes(fastify: FastifyInstance, deps: GmailRouteDeps): Promise<void> {
  const { store, endpoints, logger } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  /** Start a sign-in flow for `tier`; `expectSub` set for re-auth / level raise. */
  async function startSignIn(
    reply: FastifyReply,
    tier: Tier,
    expect?: { sub: string; email: string },
    /** `filters` set (level / re-auth / toggle) → request + require `gmail.settings.basic` iff true; unset (Add account) → leave the account's flag alone. */
    opts?: { filters?: boolean; loginHint?: string },
  ) {
    if (!deps.oauth) return reply.code(501).send({ error: "oauth_unavailable" });
    const client = await store.getClient();
    if (!client) return reply.code(409).send({ error: "no_client" });
    // One failure, one warn line: a login throwing before its first event also
    // rejects startFlow (login_failed), so whichever site logs first wins.
    // The line carries an allow-listed code only (improve-gmail-settings-ux D3).
    let logged = false;
    const logFailure = (err: unknown) => {
      if (logged) return;
      logged = true;
      logger.warn(`[gmail] sign-in failed: ${knownFlowCode((err as { code?: unknown } | null)?.code) ?? "sign_in_failed"}`);
    };
    const googleFlow = createGoogleLoginFlow({
      client,
      endpoints,
      tier,
      filters: opts?.filters === true,
      loginHint: expect?.email ?? opts?.loginHint,
      fetchImpl: deps.fetchImpl,
      createCallback: deps.createCallback,
    });
    const loginFlow = {
      ...googleFlow,
      login: async (ix: Parameters<typeof googleFlow.login>[0]) => {
        try {
          return await googleFlow.login(ix);
        } catch (err) {
          logFailure(err);
          throw err;
        }
      },
    };
    try {
      return await deps.oauth.startFlow({
        key: expect ? `reauth-${expect.sub}` : `add-${newId()}`,
        loginFlow,
        persist: async (credential) => {
          try {
            const c = credential as GoogleSignInResult;
            if (expect && c.sub !== expect.sub) throw new GmailFlowError("account_mismatch");
            // Consent-screen checkboxes can be cleared: never store a level the grant cannot serve.
            // The filter scope is required whenever the flow asked for it (partial grant → nothing stored).
            if (!scopesCoverTier(c.grantedScopes, c.tier) || (opts?.filters === true && !scopesCoverFilters(c.grantedScopes))) {
              throw new GmailFlowError("scope_missing");
            }
            const acct = await store.upsertFromSignIn({
              sub: c.sub,
              email: c.email,
              tier: c.tier,
              scopes: c.grantedScopes,
              access: c.access,
              refresh: c.refresh || undefined,
              expires: c.expires,
              testingHint: c.testingHint,
              filters: opts?.filters,
            });
            logger.info(`[gmail] sign-in ${acct.email} tier=${acct.tier}: ok`);
          } catch (err) {
            logFailure(err);
            throw err;
          }
        },
      });
    } catch (err) {
      logFailure(err);
      return sendError(reply, err);
    }
  }

  /** Saved setup fields from plugin config (non-secret operator settings). */
  function readSetup(): { projectId?: string; ownerAccount?: string } {
    const cfg = deps.config?.get() ?? {};
    const out: { projectId?: string; ownerAccount?: string } = {};
    if (typeof cfg.projectId === "string" && cfg.projectId) out.projectId = cfg.projectId;
    if (typeof cfg.ownerAccount === "string" && cfg.ownerAccount) out.ownerAccount = cfg.ownerAccount;
    return out;
  }

  // The host's updatePluginConfig merges a snapshot taken before its awaits, so
  // interleaved partial writes could drop a key: serialize them.
  let setupQueue: Promise<unknown> = Promise.resolve();
  function queueSetupWrite(fn: () => Promise<void> | undefined): Promise<void | undefined> {
    const run = setupQueue.then(fn, fn);
    setupQueue = run.catch(() => undefined);
    return run;
  }

  const setupManager = new SetupRunManager({
    getService: () => deps.getBrowserService?.(),
    store,
    logger,
    saveSetup: async (partial) => {
      await queueSetupWrite(() => deps.config?.update(partial));
    },
    ...deps.setup,
  });
  const setupRoutes = { prefix: PREFIX, guard: deps.networkGuard, store, manager: setupManager, getService: () => deps.getBrowserService?.() };

  await fastify.register(async (scope) => {
    await scope.register(rateLimit, {
      global: true,
      max: 600,
      timeWindow: "1 minute",
      allowList: ["127.0.0.1", "::1"],
    });
    const guarded = { preHandler: deps.networkGuard };

    scope.get(`${PREFIX}/state`, guarded, async (request) => {
      const client = await store.getClient();
      return {
        client: client ? { configured: true, clientId: client.clientId, projectId: client.projectId } : { configured: false },
        accounts: (await store.list()).map(summarize),
        setup: readSetup(),
        autoSetup: await autoSetupState(request, setupRoutes),
      };
    });

    registerSetupRoutes(scope, setupRoutes);

    scope.put(`${PREFIX}/setup`, guarded, async (request, reply) => {
      if (!deps.config) return reply.code(501).send({ error: "config_unavailable" });
      const body = (request.body ?? {}) as { projectId?: unknown; ownerAccount?: unknown };
      const partial: Record<string, unknown> = {};
      // Validate every provided key before any write; project id is reported first.
      if (body.projectId !== undefined) {
        if (typeof body.projectId !== "string") return reply.code(400).send({ error: "invalid_project_id" });
        const id = normalizeProjectId(body.projectId);
        if (id && classifyProjectId(id) !== "ok") return reply.code(400).send({ error: "invalid_project_id" });
        partial.projectId = id || undefined;
      }
      if (body.ownerAccount !== undefined) {
        if (typeof body.ownerAccount !== "string") return reply.code(400).send({ error: "invalid_owner_account" });
        const email = normalizeEmail(body.ownerAccount);
        if (email && !isEmail(email)) return reply.code(400).send({ error: "invalid_owner_account" });
        partial.ownerAccount = email || undefined;
      }
      await queueSetupWrite(() => deps.config?.update(partial));
      logger.info("[gmail] setup saved");
      return { ok: true, setup: readSetup() };
    });

    scope.put(`${PREFIX}/client`, guarded, async (request, reply) => {
      const result = await storeClient(store, (request.body as { json?: unknown } | null)?.json ?? request.body, logger);
      if (!result.ok) return reply.code(result.status).send({ error: result.error, step: result.step });
      return { ok: true, clientId: result.client.clientId, projectId: result.client.projectId };
    });

    scope.post(`${PREFIX}/accounts`, guarded, async (request, reply) => {
      const body = (request.body ?? {}) as { tier?: unknown; email?: unknown };
      const tier = body.tier ?? "readonly";
      if (!isTier(tier)) return reply.code(400).send({ error: "invalid_tier" });
      // Optional email → `login_hint` so Google skips the account chooser.
      let loginHint: string | undefined;
      if (body.email !== undefined && body.email !== null && body.email !== "") {
        const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
        if (!isEmail(email)) return reply.code(400).send({ error: "invalid_email" });
        loginHint = email;
      }
      return startSignIn(reply, tier, undefined, { loginHint });
    });

    scope.post<{ Params: { sub: string } }>(`${PREFIX}/accounts/:sub/level`, guarded, async (request, reply) => {
      const tier = (request.body as { tier?: unknown } | null)?.tier;
      if (!isTier(tier)) return reply.code(400).send({ error: "invalid_tier" });
      const acct = await store.get(request.params.sub);
      if (!acct) return reply.code(404).send({ error: "not_found" });
      // Lowering applies at once whatever the status or filters option (every
      // lease is refused while `reauth_required`). A raise applies at once only
      // when the account is `ok` and the stored grant covers the new level (and
      // the filter scope when filters are on); else it re-consents with the FULL
      // scope set of the new level plus `gmail.settings.basic` iff filters are on.
      const lowering = TIERS.indexOf(tier) < TIERS.indexOf(acct.tier);
      const covered =
        acct.status === "ok" &&
        scopesCoverTier(acct.scopes, tier) &&
        (!acct.filters || scopesCoverFilters(acct.scopes));
      if (lowering || covered) {
        const next = await store.setTier(acct.sub, tier);
        logger.info(`[gmail] level ${next.email} → ${tier}`);
        return { applied: true, account: summarize(next) };
      }
      return startSignIn(reply, tier, { sub: acct.sub, email: acct.email }, { filters: acct.filters === true });
    });

    scope.post<{ Params: { sub: string } }>(`${PREFIX}/accounts/:sub/reauth`, guarded, async (request, reply) => {
      const acct = await store.get(request.params.sub);
      if (!acct) return reply.code(404).send({ error: "not_found" });
      return startSignIn(reply, acct.tier, { sub: acct.sub, email: acct.email }, { filters: acct.filters === true });
    });

    scope.post<{ Params: { sub: string } }>(`${PREFIX}/accounts/:sub/filters`, guarded, async (request, reply) => {
      const enabled = (request.body as { enabled?: unknown } | null)?.enabled;
      if (typeof enabled !== "boolean") return reply.code(400).send({ error: "invalid_enabled" });
      const acct = await store.get(request.params.sub);
      if (!acct) return reply.code(404).send({ error: "not_found" });
      // Off is immediate; on is immediate only when the stored grant already covers tier + filters.
      if (!enabled || (acct.status === "ok" && scopesCoverTier(acct.scopes, acct.tier) && scopesCoverFilters(acct.scopes))) {
        const next = await store.setFilters(acct.sub, enabled);
        logger.info(`[gmail] filters ${next.email} → ${enabled ? "on" : "off"}`);
        return { applied: true, account: summarize(next) };
      }
      return startSignIn(reply, acct.tier, { sub: acct.sub, email: acct.email }, { filters: true });
    });

    scope.patch<{ Params: { sub: string } }>(`${PREFIX}/accounts/:sub`, guarded, async (request, reply) => {
      const body = (request.body ?? {}) as { alias?: unknown };
      if (body.alias !== null && body.alias !== undefined && typeof body.alias !== "string") {
        return reply.code(400).send({ error: "invalid_alias" });
      }
      try {
        const next = await store.setAlias(request.params.sub, (body.alias as string | null) ?? undefined);
        return { account: summarize(next) };
      } catch (err) {
        return sendError(reply, err);
      }
    });

    scope.delete<{ Params: { sub: string } }>(`${PREFIX}/accounts/:sub`, guarded, async (request, reply) => {
      const acct = await store.get(request.params.sub);
      if (!acct) return reply.code(404).send({ error: "not_found" });
      const remoteRevoked = await revokeToken(endpoints, acct.refresh, deps.fetchImpl);
      await store.remove(acct.sub);
      logger.info(`[gmail] revoke ${acct.email}: local ok, remote ${remoteRevoked ? "ok" : "failed"}`);
      return { removed: true, remoteRevoked };
    });
  });
}
