/**
 * Gmail plugin REST routes (design D3/D4/D7/D9). All under
 * `/api/plugins/gmail/`, all behind `networkGuard`, in an encapsulated scope
 * with `@fastify/rate-limit` (loopback allow-listed). Tiers: `operate`
 * (`packages/shared/src/route-tiers.ts`). Responses NEVER carry tokens or the
 * client secret. See change: add-gmail-plugin.
 */

import type {
  PluginNetworkGuard,
  PluginOAuth,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply } from "fastify";
import { validateClientJson } from "../shared/client-json.js";
import type { GoogleEndpoints } from "../shared/endpoints.js";
import { isTier, scopesCoverTier, type Tier } from "../shared/scopes.js";
import { AccountError, type AccountStore, summarize } from "./accounts.js";
import { revokeToken } from "./gmail-rest.js";
import {
  createGoogleLoginFlow,
  GmailFlowError,
  type GoogleLoginOptions, type GoogleSignInResult,
} from "./google-oauth.js";

export interface GmailRouteDeps {
  store: AccountStore;
  oauth: PluginOAuth | undefined;
  endpoints: GoogleEndpoints;
  networkGuard: PluginNetworkGuard;
  logger: { info(m: string): void; warn(m: string): void };
  fetchImpl?: typeof fetch;
  createCallback?: GoogleLoginOptions["createCallback"];
  newId?: () => string;
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
  ) {
    if (!deps.oauth) return reply.code(501).send({ error: "oauth_unavailable" });
    const client = await store.getClient();
    if (!client) return reply.code(409).send({ error: "no_client" });
    const loginFlow = createGoogleLoginFlow({
      client,
      endpoints,
      tier,
      loginHint: expect?.email,
      fetchImpl: deps.fetchImpl,
      createCallback: deps.createCallback,
    });
    try {
      return await deps.oauth.startFlow({
        key: expect ? `reauth-${expect.sub}` : `add-${newId()}`,
        loginFlow,
        persist: async (credential) => {
          const c = credential as GoogleSignInResult;
          if (expect && c.sub !== expect.sub) throw new GmailFlowError("account_mismatch");
          const acct = await store.upsertFromSignIn({
            sub: c.sub,
            email: c.email,
            tier: c.tier,
            scopes: c.grantedScopes,
            access: c.access,
            refresh: c.refresh || undefined,
            expires: c.expires,
            testingHint: c.testingHint,
          });
          logger.info(`[gmail] sign-in ${acct.email} tier=${acct.tier}: ok`);
        },
      });
    } catch (err) {
      return sendError(reply, err);
    }
  }

  await fastify.register(async (scope) => {
    await scope.register(rateLimit, {
      global: true,
      max: 600,
      timeWindow: "1 minute",
      allowList: ["127.0.0.1", "::1"],
    });
    const guarded = { preHandler: deps.networkGuard };

    scope.get(`${PREFIX}/state`, guarded, async () => {
      const client = await store.getClient();
      return {
        client: client ? { configured: true, clientId: client.clientId, projectId: client.projectId } : { configured: false },
        accounts: (await store.list()).map(summarize),
      };
    });

    scope.put(`${PREFIX}/client`, guarded, async (request, reply) => {
      const result = validateClientJson((request.body as { json?: unknown } | null)?.json ?? request.body);
      if (!result.ok) return reply.code(400).send({ error: result.error.code, step: result.error.step });
      await store.setClient(result.client);
      logger.info("[gmail] oauth client configured");
      return { ok: true, clientId: result.client.clientId, projectId: result.client.projectId };
    });

    scope.post(`${PREFIX}/accounts`, guarded, async (request, reply) => {
      const tier = (request.body as { tier?: unknown } | null)?.tier ?? "readonly";
      if (!isTier(tier)) return reply.code(400).send({ error: "invalid_tier" });
      return startSignIn(reply, tier);
    });

    scope.post<{ Params: { sub: string } }>(`${PREFIX}/accounts/:sub/level`, guarded, async (request, reply) => {
      const tier = (request.body as { tier?: unknown } | null)?.tier;
      if (!isTier(tier)) return reply.code(400).send({ error: "invalid_tier" });
      const acct = await store.get(request.params.sub);
      if (!acct) return reply.code(404).send({ error: "not_found" });
      // Lowering (or a level the existing grant already covers) applies at once;
      // raising re-consents with the FULL scope set of the new level.
      if (acct.status === "ok" && scopesCoverTier(acct.scopes, tier)) {
        const next = await store.setTier(acct.sub, tier);
        logger.info(`[gmail] level ${next.email} → ${tier}`);
        return { applied: true, account: summarize(next) };
      }
      return startSignIn(reply, tier, { sub: acct.sub, email: acct.email });
    });

    scope.post<{ Params: { sub: string } }>(`${PREFIX}/accounts/:sub/reauth`, guarded, async (request, reply) => {
      const acct = await store.get(request.params.sub);
      if (!acct) return reply.code(404).send({ error: "not_found" });
      return startSignIn(reply, acct.tier, { sub: acct.sub, email: acct.email });
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
