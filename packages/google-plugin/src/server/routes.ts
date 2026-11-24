/**
 * Google accounts REST routes. All under `/api/plugins/google/`, in an encapsulated scope with
 * `@fastify/rate-limit` (loopback allow-listed). Management routes are behind `networkGuard` (tier
 * `operate`, `packages/shared/src/route-tiers.ts`). The two OAuth callbacks are the only routes without
 * it: they accept a code for a pending flow whose unguessable `state` this dashboard issued (the host's
 * login gate exempts `remote-callback`). Responses NEVER carry tokens or a client secret.
 * See change: add-google-connect.
 */
import type { PluginNetworkGuard } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { validateClientJson } from "../shared/client-json.js";
import { DISCLOSURE_VERSION } from "../shared/default-clients.js";
import { CATALOGUE } from "../shared/products.js";
import { projectMismatch } from "../shared/setup.js";
import { availability, type Browser, type ClientDeps } from "./clients.js";
import type { ConnectService } from "./connect.js";
import { OAUTH_CALLBACK_PATH } from "./google-oauth.js";
import { isLocal } from "./local-request.js";
import type { DedicatedBrowserService } from "./setup/browser-service.js";
import { type RunDeps, SetupRunManager } from "./setup/run.js";
import { autoSetupState, registerSetupRoutes, type SetupRouteDeps } from "./setup/setup-routes.js";
import { type GoogleStore, StoreError, summarize } from "./store.js";

export interface GoogleRouteDeps {
  store: GoogleStore;
  clients: ClientDeps;
  connect: ConnectService;
  networkGuard: PluginNetworkGuard;
  logger: { info(m: string): void; warn(m: string): void };
  dashboardBase: () => string | undefined;
  /** Picker token source: a lease for `drive` (hub-local only). Optional until the Picker task lands. */
  leaseToken?: (account: string) => Promise<{ accessToken: string; expiresAt: number }>;
  /** Lazy lookup of the browser plugin's `browser.dedicated` service (`ctx.consume`), per request — no `dependsOn`. */
  getBrowserService?: () => DedicatedBrowserService | undefined;
  /** Test seams for the automatic setup run. */
  setup?: Pick<RunDeps, "timing" | "wsFactory" | "newId">;
}

const PREFIX = "/api/plugins/google";

const STATUS: Record<string, number> = {
  not_found: 404,
  client_not_found: 404,
  ambiguous: 409,
  alias_taken: 409,
  domain_taken: 409,
  client_in_use: 409,
  too_many_keys: 409,
  invalid_alias: 400,
  invalid_domain: 400,
  missing_refresh: 400,
};

function sendStoreError(reply: FastifyReply, err: unknown) {
  if (err instanceof StoreError) {
    return reply.code(STATUS[err.code] ?? 400).send({ error: err.code, message: err.message, ...(err.detail ? { detail: err.detail } : {}) });
  }
  const code = (err as { code?: unknown })?.code;
  return reply.code(502).send({ error: typeof code === "string" && /^[a-z_]{1,64}$/.test(code) ? code : "internal_error" });
}

const DONE_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">' +
  "<title>Google sign-in</title></head><body><p>Google sign-in complete. You can close this window and return to the dashboard.</p>" +
  // The window the dialog opened closes itself (#B21); a window that cannot be script-closed keeps the sentence above.
  "<script>window.close()</script></body></html>";
function browserOf(request: FastifyRequest): Browser {
  return isLocal(request) ? "local" : "remote";
}

type Scope = FastifyInstance;
type Guarded = { preHandler: PluginNetworkGuard };

/** Translate a service result to HTTP: success is returned as-is, a refusal becomes `{error,…}` + status. */
function respond(reply: FastifyReply, r: { ok: boolean; status?: number; error?: string; [k: string]: unknown }) {
  if (r.ok) return r;
  const { ok: _ok, status, ...rest } = r;
  return reply.code(status ?? 400).send(rest);
}

function mountState(scope: Scope, deps: GoogleRouteDeps, guarded: Guarded, setup: SetupRouteDeps): void {
  const { store, connect, clients } = deps;
  scope.get(`${PREFIX}/state`, guarded, async (request) => {
    const base = deps.dashboardBase();
    return {
      ...(await availability(clients, browserOf(request))),
      accounts: (await store.list()).map(summarize),
      autoSetup: await autoSetupState(request, setup),
      disclosure: { version: DISCLOSURE_VERSION, accepted: await connect.disclosureAccepted() },
      products: CATALOGUE.map((p) => ({ id: p.id, levels: p.levels.map((l) => ({ id: l.id, builtin: l.builtin })) })),
      ...(base ? { webRedirectUri: `${base.replace(/\/+$/, "")}${OAUTH_CALLBACK_PATH}` } : {}),
    };
  });

  // Body-less: the server records ITS current version. Hub-local only (a remote tab cannot accept for the host).
  scope.put(`${PREFIX}/disclosure`, guarded, async (request, reply) => {
    if (!isLocal(request)) return reply.code(403).send({ error: "origin_denied" });
    await connect.acceptDisclosure();
    return { ok: true, version: DISCLOSURE_VERSION };
  });
}

interface UploadBody {
  json?: unknown;
  label?: unknown;
  domains?: unknown;
  ownerAccount?: unknown;
  /** The project the wizard is setting up; only used to warn when the uploaded JSON belongs to another one (A6). */
  expectedProjectId?: unknown;
}

/** The error code for a malformed non-JSON upload field, or `null` when they are all fine. */
function badUploadField(body: UploadBody): "invalid_domain" | "bad_request" | null {
  if (body.domains !== undefined && !Array.isArray(body.domains)) return "invalid_domain";
  if (body.label !== undefined && typeof body.label !== "string") return "bad_request";
  return null;
}

function mountClients(scope: Scope, deps: GoogleRouteDeps, guarded: Guarded): void {
  const { store, logger } = deps;
  scope.put(`${PREFIX}/clients`, guarded, async (request, reply) => {
    const body = (request.body ?? {}) as UploadBody;
    const parsed = validateClientJson(body.json ?? request.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const bad = badUploadField(body);
    if (bad) return reply.code(400).send({ error: bad });
    try {
      const { client, created } = await store.upsertClient(parsed.client, {
        label: body.label as string | undefined,
        domains: body.domains as string[] | undefined,
        ownerAccount: typeof body.ownerAccount === "string" ? body.ownerAccount : undefined,
      });
      logger.info(`[google] client ${created ? "added" : "updated"} type=${client.type}`);
      const mismatch = projectMismatch(body.expectedProjectId, parsed.client.projectId);
      return { ok: true, created, client: (await store.summarizeClients()).find((c) => c.id === client.id), ...(mismatch ? { projectMismatch: mismatch } : {}) };
    } catch (err) {
      return sendStoreError(reply, err);
    }
  });

  scope.patch<{ Params: { id: string } }>(`${PREFIX}/clients/:id`, guarded, async (request, reply) => {
    const body = (request.body ?? {}) as { label?: unknown; domains?: unknown; projectId?: unknown; ownerAccount?: unknown };
    if (body.label !== undefined && typeof body.label !== "string") return reply.code(400).send({ error: "bad_request" });
    if (body.domains !== undefined && !Array.isArray(body.domains)) return reply.code(400).send({ error: "invalid_domain" });
    try {
      await store.patchClient(request.params.id, {
        label: body.label as string | undefined,
        domains: body.domains as string[] | undefined,
        projectId: body.projectId as string | null | undefined,
        ownerAccount: body.ownerAccount as string | null | undefined,
      });
      return { ok: true, client: (await store.summarizeClients()).find((c) => c.id === request.params.id) };
    } catch (err) {
      return sendStoreError(reply, err);
    }
  });

  scope.delete<{ Params: { id: string } }>(`${PREFIX}/clients/:id`, guarded, async (request, reply) => {
    try {
      await store.removeClient(request.params.id);
      logger.info("[google] client removed");
      return { removed: true };
    } catch (err) {
      return sendStoreError(reply, err);
    }
  });
}

function mountAccounts(scope: Scope, deps: GoogleRouteDeps, guarded: Guarded): void {
  const { store, connect } = deps;
  scope.post(`${PREFIX}/accounts`, guarded, async (request, reply) => {
    const body = (request.body ?? {}) as { products?: unknown; client?: unknown; email?: unknown };
    return respond(reply, await connect.startConnect({ products: body.products, client: body.client, email: body.email, browser: browserOf(request) }));
  });

  scope.post<{ Params: { sub: string } }>(`${PREFIX}/accounts/:sub/products`, guarded, async (request, reply) => {
    const products = (request.body as { products?: unknown } | null)?.products;
    if (!products || typeof products !== "object" || Array.isArray(products)) return reply.code(400).send({ error: "bad_request" });
    return respond(reply, await connect.changeProducts(request.params.sub, products as Record<string, unknown>, browserOf(request)));
  });

  scope.post<{ Params: { sub: string } }>(`${PREFIX}/accounts/:sub/reauth`, guarded, async (request, reply) =>
    respond(reply, await connect.signInAgain(request.params.sub, browserOf(request))),
  );

  scope.patch<{ Params: { sub: string } }>(`${PREFIX}/accounts/:sub`, guarded, async (request, reply) => {
    const alias = (request.body as { alias?: unknown } | null)?.alias;
    if (alias !== null && alias !== undefined && typeof alias !== "string") return reply.code(400).send({ error: "invalid_alias" });
    try {
      return { account: summarize(await store.setAlias(request.params.sub, (alias as string | null) ?? undefined)) };
    } catch (err) {
      return sendStoreError(reply, err);
    }
  });

  scope.delete<{ Params: { sub: string }; Querystring: { revoke?: string } }>(`${PREFIX}/accounts/:sub`, guarded, async (request, reply) =>
    respond(reply, await connect.disconnect(request.params.sub, { revoke: request.query.revoke === "true" || request.query.revoke === "1" })),
  );

  // Picker token (Drive Picker in the built-in LOCAL mode, design D9): local browser + built-in account only.
  scope.post(`${PREFIX}/picker-token`, guarded, async (request, reply) => {
    if (!isLocal(request) || !deps.leaseToken) return reply.code(403).send({ error: "picker_unavailable" });
    const account = (request.body as { account?: unknown } | null)?.account;
    if (typeof account !== "string" || !account) return reply.code(400).send({ error: "bad_request" });
    try {
      const acct = await store.resolve(account);
      if (acct.client !== "builtin" || !acct.products.drive) return reply.code(403).send({ error: "picker_unavailable" });
      const t = await deps.leaseToken(acct.sub);
      return { accessToken: t.accessToken, expiresAt: t.expiresAt };
    } catch (err) {
      return sendStoreError(reply, err);
    }
  });
}

/** OAuth callbacks — no networkGuard: a pending flow's unguessable `state` is the credential. */
function mountCallbacks(scope: Scope, deps: GoogleRouteDeps): void {
  const limit = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };
  const callback = async (request: FastifyRequest, reply: FastifyReply) => {
    const q = (request.query ?? {}) as { code?: string; state?: string; error?: string };
    const r = deps.connect.deliver(q.state, {
      code: typeof q.code === "string" ? q.code : undefined,
      error: typeof q.error === "string" ? q.error : undefined,
    });
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer");
    if (!r.ok) return reply.code(r.status).type("application/json").send({ error: r.error });
    return reply.type("text/html; charset=utf-8").send(DONE_PAGE);
  };
  scope.get(`${PREFIX}/oauth/callback`, limit, callback);
  scope.get(`${PREFIX}/oauth/remote-callback`, limit, callback);
}

export async function mountGoogleRoutes(fastify: FastifyInstance, deps: GoogleRouteDeps): Promise<void> {
  await fastify.register(async (scope) => {
    await scope.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute", allowList: ["127.0.0.1", "::1"] });
    const guarded: Guarded = { preHandler: deps.networkGuard };
    // Run routes live under `/api/plugins/google/setup/` (the paths Gmail used to serve), same scope, limit and guard.
    const manager = new SetupRunManager({
      getService: () => deps.getBrowserService?.(),
      store: deps.store,
      logger: deps.logger,
      ...deps.setup,
    });
    const setup: SetupRouteDeps = { prefix: PREFIX, guard: deps.networkGuard, store: deps.store, manager, getService: () => deps.getBrowserService?.() };
    mountState(scope, deps, guarded, setup);
    registerSetupRoutes(scope, setup);
    mountClients(scope, deps, guarded);
    mountAccounts(scope, deps, guarded);
    mountCallbacks(scope, deps);
  });
}
