/**
 * `gmail/lease` request handler (design D4/D5). Authorizes on the ACCOUNT LEVEL
 * only (the request lane is private but unauthenticated — any session of this
 * user may lease within the level). Returns exactly
 * `{accessToken, expiresAt, email, tier}` — the refresh token never leaves.
 *
 * - tier check (`tierAllows`) then granted-scope check (implication table);
 * - refresh when `expires − now ≤ 60 s`, single-flight per `sub`, written via
 *   `update()` and ONLY if the record still holds the refresh token used (a
 *   concurrent re-auth wins);
 * - `invalid_grant` → `status = reauth_required`, reply `reauth_required`;
 *   later leases refuse without touching the network.
 * - Logs: email, op, outcome. Never a token.
 *
 * Failures THROW `LeaseError` whose message starts with `<code>:` — the host
 * replies `{ok:false,error:message}` and the bridge parses the code.
 * See change: add-gmail-plugin.
 */
import * as oauth from "oauth4webapi";
import type { GoogleEndpoints } from "../shared/endpoints.js";
import type { LeaseReply } from "../shared/protocol.js";
import { isOp, type Op, scopesCover, tierAllows } from "../shared/scopes.js";
import { AccountError, type AccountRecord, type AccountStore } from "./accounts.js";
import { oauthClient, oauthServer, requestOptions } from "./google-oauth.js";

const REFRESH_WINDOW_MS = 60_000;

type LeaseErrorCode =
  | "bad_request"
  | "not_found"
  | "ambiguous"
  | "no_client"
  | "tier_denied"
  | "scope_missing"
  | "reauth_required"
  | "refresh_failed";

class LeaseError extends Error {
  constructor(
    readonly code: LeaseErrorCode,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "LeaseError";
  }
}


interface LeaseLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface LeaseDeps {
  store: AccountStore;
  endpoints: GoogleEndpoints;
  logger: LeaseLogger;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createLeaseHandler(deps: LeaseDeps) {
  const now = deps.now ?? Date.now;
  const inflight = new Map<string, Promise<{ access: string; expires: number }>>();

  async function refresh(acct: AccountRecord): Promise<{ access: string; expires: number }> {
    const client = await deps.store.getClient();
    if (!client) throw new LeaseError("no_client", "the Gmail OAuth client is not configured");
    const as = oauthServer(deps.endpoints);
    const c = oauthClient(client);
    let tokens: oauth.TokenEndpointResponse;
    try {
      const res = await oauth.refreshTokenGrantRequest(
        as,
        c,
        oauth.ClientSecretPost(client.clientSecret),
        acct.refresh,
        requestOptions(deps.endpoints, deps.fetchImpl),
      );
      tokens = await oauth.processRefreshTokenResponse(as, c, res);
    } catch (err) {
      if (err instanceof oauth.ResponseBodyError && err.error === "invalid_grant") {
        await deps.store.markReauthIf(acct.sub, acct.refresh);
        deps.logger.warn(`[gmail] refresh ${acct.email}: invalid_grant → reauth_required`);
        throw new LeaseError("reauth_required", `${acct.email} needs re-authentication in the Gmail panel`);
      }
      deps.logger.warn(`[gmail] refresh ${acct.email}: failed`);
      throw new LeaseError("refresh_failed", `could not refresh the token for ${acct.email}; try again later`);
    }
    const expires = now() + (typeof tokens.expires_in === "number" ? tokens.expires_in : 3600) * 1000;
    const usedRefresh = acct.refresh;
    const rotated = typeof tokens.refresh_token === "string" ? tokens.refresh_token : undefined;
    // Merge only while the record still holds the grant we refreshed: a
    // concurrent re-auth (new refresh token) must win and is never clobbered.
    await deps.store.storeTokensIf(acct.sub, usedRefresh, { access: tokens.access_token, expires, refresh: rotated });
    deps.logger.info(`[gmail] refresh ${acct.email}: ok`);
    return { access: tokens.access_token, expires };
  }

  function refreshOnce(acct: AccountRecord): Promise<{ access: string; expires: number }> {
    const existing = inflight.get(acct.sub);
    if (existing) return existing;
    const p = refresh(acct).finally(() => inflight.delete(acct.sub));
    inflight.set(acct.sub, p);
    return p;
  }

  async function resolveAccount(payload: unknown): Promise<{ acct: AccountRecord; op: Op }> {
    const p = (payload ?? {}) as { account?: unknown; op?: unknown };
    if (typeof p.account !== "string" || !p.account.trim() || !isOp(p.op)) {
      throw new LeaseError("bad_request", "expected {account, op}");
    }
    try {
      return { acct: await deps.store.resolve(p.account), op: p.op };
    } catch (err) {
      if (err instanceof AccountError && (err.code === "not_found" || err.code === "ambiguous")) {
        throw new LeaseError(err.code, err.message);
      }
      throw err;
    }
  }

  /** Level + granted-scope + status gate. Returns the refusal, or null when allowed. */
  function refusal(acct: AccountRecord, op: Op): LeaseError | null {
    if (!tierAllows(acct.tier, op)) {
      return new LeaseError("tier_denied", `${acct.email} is at level "${acct.tier}", which does not allow "${op}"`);
    }
    if (!scopesCover(acct.scopes, op)) {
      return new LeaseError("scope_missing", `Google did not grant the scope "${op}" needs for ${acct.email}; re-authenticate`);
    }
    if (acct.status === "reauth_required") {
      return new LeaseError("reauth_required", `${acct.email} needs re-authentication in the Gmail panel`);
    }
    return null;
  }

  return async function handleLease(payload: unknown): Promise<LeaseReply> {
    const { acct, op } = await resolveAccount(payload);
    const outcome = (o: string) => deps.logger.info(`[gmail] lease ${acct.email} op=${op}: ${o}`);
    const refused = refusal(acct, op);
    if (refused) {
      outcome(refused.code);
      throw refused;
    }
    if (acct.access && acct.expires - now() > REFRESH_WINDOW_MS) {
      outcome("ok");
      return { accessToken: acct.access, expiresAt: acct.expires, email: acct.email, tier: acct.tier };
    }
    let fresh: { access: string; expires: number };
    try {
      fresh = await refreshOnce(acct);
    } catch (err) {
      outcome(err instanceof LeaseError ? err.code : "refresh_failed");
      throw err;
    }
    // The refresh awaited the network: a downgrade / revoke / re-auth may have
    // landed meanwhile. Re-read and re-gate before handing out a token.
    const latest = await deps.store.get(acct.sub);
    const late = latest ? refusal(latest, op) : new LeaseError("not_found", `${acct.email} was removed`);
    if (late) {
      outcome(late.code);
      throw late;
    }
    const cur = latest as AccountRecord;
    outcome("ok");
    return { accessToken: fresh.access, expiresAt: fresh.expires, email: cur.email, tier: cur.tier };
  };
}
