/**
 * `google/lease` request handler (design D7). Authorizes on the ACCOUNT LEVEL only; WHO may call is the
 * host lane's job — the handler registers `hubLocalOnly`, so a remote-origin or deprecated-admission
 * session is refused (`origin_denied`) before it runs. Returns exactly `{accessToken, expiresAt, email,
 * level}`; the refresh token never leaves.
 *
 * Refusal order (scenario-gate A13/A14): `bad_request` → `not_found`/`ambiguous` → `product_disabled`
 * (no token needed, before anything else) → `level_insufficient` → `default_client_unavailable`/`no_client`
 * → `reauth_required` (no network) → `scope_missing` → refresh when `expires − now ≤ 60 s`, single-flight
 * per `sub`, written only if the record still holds the refresh token used (a concurrent re-auth wins).
 *
 * Failures THROW `LeaseError` whose message starts with `<code>:` — the host replies
 * `{ok:false,error:message}` and the bridge parses the code. Logs: product, op, code. Never a token or
 * an email at info level. See change: add-google-connect.
 */
import * as oauth from "oauth4webapi";
import type { GoogleEndpoints } from "../shared/endpoints.js";
import { coversProduct, isLevel, isProduct, levelAtLeast, type Product, type ProductSelection } from "../shared/products.js";
import type { LeaseRefusal, LeaseReply } from "../shared/protocol.js";
import { type ClientDeps, clientForGrant, type ResolvedClient } from "./clients.js";
import { oauthClient, oauthServer, requestOptions } from "./google-oauth.js";
import { type Account, type GoogleStore, StoreError } from "./store.js";

const REFRESH_WINDOW_MS = 60_000;
/** > the 15 s lane timeout, so a slow-but-alive refresh still lands and is stored. */
const REFRESH_TIMEOUT_MS = 30_000;

class LeaseError extends Error {
  readonly code: LeaseRefusal;

  constructor(code: LeaseRefusal, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.name = "LeaseError";
  }
}

/** The grant was replaced (re-auth) while a refresh of the old one was in flight. */
class GrantChanged extends Error {}

interface LeaseLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface LeaseDeps {
  store: GoogleStore;
  clients: ClientDeps;
  endpoints: GoogleEndpoints;
  logger: LeaseLogger;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createLeaseHandler(deps: LeaseDeps) {
  const now = deps.now ?? Date.now;
  const inflight = new Map<string, Promise<{ access: string; expires: number }>>();

  async function tokenRequest(acct: Account, client: ResolvedClient): Promise<oauth.TokenEndpointResponse> {
    const as = oauthServer(deps.endpoints);
    const c = oauthClient(client);
    const res = await oauth.refreshTokenGrantRequest(
      as,
      c,
      oauth.ClientSecretPost(client.clientSecret),
      acct.grant.refresh,
      // Bounded: a hung token endpoint must not pin the single-flight slot.
      requestOptions(deps.endpoints, deps.fetchImpl, AbortSignal.timeout(REFRESH_TIMEOUT_MS)),
    );
    return oauth.processRefreshTokenResponse(as, c, res);
  }

  /** Map a refresh failure: `invalid_grant` marks (or detects a replaced grant); else `refresh_failed`. */
  async function refreshError(acct: Account, err: unknown): Promise<Error> {
    if (err instanceof oauth.ResponseBodyError && err.error === "invalid_grant") {
      if (!(await deps.store.markReauthIf(acct.sub, acct.grant.refresh))) return new GrantChanged();
      deps.logger.warn(`[google] refresh client=${acct.client} result=reauth_required`);
      return new LeaseError("reauth_required", "this Google account needs to sign in again in Settings → Google accounts");
    }
    deps.logger.warn(`[google] refresh client=${acct.client} result=refresh_failed`);
    return new LeaseError("refresh_failed", "could not refresh the Google token; try again later");
  }

  async function refresh(acct: Account, client: ResolvedClient): Promise<{ access: string; expires: number }> {
    let tokens: oauth.TokenEndpointResponse;
    try {
      tokens = await tokenRequest(acct, client);
    } catch (err) {
      throw await refreshError(acct, err);
    }
    const expires = now() + (typeof tokens.expires_in === "number" ? tokens.expires_in : 3600) * 1000;
    const rotated = typeof tokens.refresh_token === "string" && tokens.refresh_token ? tokens.refresh_token : undefined;
    await deps.store.storeTokensIf(acct.sub, acct.grant.refresh, { access: tokens.access_token, expires, refresh: rotated });
    deps.logger.info(`[google] refresh client=${acct.client} result=ok`);
    return { access: tokens.access_token, expires };
  }

  /** Single-flight per sub; the shared promise is dropped on settle. */
  function singleFlight(acct: Account, client: ResolvedClient) {
    let p = inflight.get(acct.sub);
    if (!p) {
      p = refresh(acct, client).finally(() => inflight.delete(acct.sub));
      inflight.set(acct.sub, p);
    }
    return p;
  }

  async function loadAccount(ref: string): Promise<Account> {
    try {
      return await deps.store.resolve(ref);
    } catch (err) {
      if (err instanceof StoreError && (err.code === "not_found" || err.code === "ambiguous")) throw new LeaseError(err.code, err.message);
      throw err;
    }
  }

  /** Product on (and high enough) — checked FIRST, before any token or client is needed (scenario-gate A13). */
  function enabledSelection(acct: Account, product: Product, level: unknown): ProductSelection {
    const sel = acct.products[product];
    if (!sel) throw new LeaseError("product_disabled", `${product} is off for ${acct.email} in Settings → Google accounts`);
    if (typeof level === "string" && !levelAtLeast(product, sel.level, level)) {
      throw new LeaseError("level_insufficient", `${product} is set to "${sel.level}" for ${acct.email}; raise it in Settings → Google accounts`);
    }
    return sel;
  }

  async function usableClient(acct: Account): Promise<ResolvedClient> {
    const resolved = await clientForGrant(deps.clients, acct.client, acct.grant.clientId);
    if (resolved.ok) return resolved.client;
    throw new LeaseError(
      resolved.error,
      resolved.error === "default_client_unavailable"
        ? "the built-in Google connection is unavailable; add your own organisation sign-in"
        : "the Google client for this account is no longer configured",
    );
  }

  function assertGrantUsable(acct: Account, product: Product, sel: ProductSelection): void {
    if (acct.grant.status !== "ok") throw new LeaseError("reauth_required", `${acct.email} needs to sign in again in Settings → Google accounts`);
    if (!coversProduct(acct.grant.scopes, product, sel)) {
      throw new LeaseError("scope_missing", `Google has not granted ${product} access for ${acct.email}; turn it on again in Settings → Google accounts`);
    }
  }

  /** The stored access token, or a (single-flight) refreshed one when it is inside the 60 s window. */
  async function freshToken(acct: Account, client: ResolvedClient): Promise<{ access: string; expires: number }> {
    if (acct.grant.access && acct.grant.expires - now() > REFRESH_WINDOW_MS) return { access: acct.grant.access, expires: acct.grant.expires };
    try {
      return await singleFlight(acct, client);
    } catch (err) {
      if (!(err instanceof GrantChanged)) throw err;
      // A re-auth replaced the grant mid-refresh: serve the new one (re-read, no network).
      const fresh = await deps.store.get(acct.sub);
      if (fresh?.grant.status !== "ok") throw new LeaseError("reauth_required", "sign in again in Settings → Google accounts");
      return { access: fresh.grant.access, expires: fresh.grant.expires };
    }
  }

  async function lease(payload: unknown): Promise<LeaseReply> {
    const req = (payload ?? {}) as { account?: unknown; product?: unknown; level?: unknown };
    if (typeof req.account !== "string" || !req.account.trim() || !isProduct(req.product)) {
      throw new LeaseError("bad_request", "account and a known product are required");
    }
    const product = req.product;
    if (req.level !== undefined && !isLevel(product, req.level)) throw new LeaseError("bad_request", "unknown level");
    const acct = await loadAccount(req.account);
    const sel = enabledSelection(acct, product, req.level);
    const client = await usableClient(acct);
    assertGrantUsable(acct, product, sel);
    const token = await freshToken(acct, client);
    return { accessToken: token.access, expiresAt: token.expires, email: acct.email, level: sel.level };
  }

  return async (payload: unknown): Promise<LeaseReply> => {
    const product = (payload as { product?: unknown } | null)?.product;
    const op = (payload as { level?: unknown } | null)?.level;
    const tag = `product=${isProduct(product) ? product : "?"} op=${typeof op === "string" ? op : "-"}`;
    try {
      const out = await lease(payload);
      deps.logger.info(`[google] lease ${tag} result=ok`);
      return out;
    } catch (err) {
      if (err instanceof LeaseError) deps.logger.warn(`[google] lease ${tag} result=${err.code}`);
      throw err;
    }
  };
}
