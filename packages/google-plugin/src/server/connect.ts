/**
 * Connect / consent / product changes / disconnect (design D3, D5, D6, D8, D12). Pure orchestration over
 * the store, the client registry and `ctx.oauth.startFlow`; the routes only translate HTTP. Every method
 * returns `{ok:true,…}` or `{ok:false,status,error,…}` so the routes never throw for a refusal.
 *
 * Rules enforced here (server-side, not only in the UI):
 *  - client selection order (D5); `own_client_required` for full Drive on the built-in app (A2);
 *    `restricted_scope_remote` for a restricted product on the return-page path (B6);
 *  - `disclosure_required` before any built-in sign-in / consent (D8);
 *  - `account_mismatch` / `client_mismatch` change nothing (D3); a reply narrower than what the account
 *    already relies on changes nothing (D6); partial grants on a NEW connect leave products off (D6);
 *  - one consent per account at a time (`consent_in_progress`, A15); store pre-check before Google opens (B17);
 *  - one log line per sign-in: `[google] signin client=<ref> path=<path> products=<list> result=<code>`.
 * See change: add-google-connect.
 */
import type { PluginOAuth } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { DISCLOSURE_VERSION, RETURN_PAGE_URL } from "../shared/default-clients.js";
import type { GoogleEndpoints } from "../shared/endpoints.js";
import { knownFlowCode } from "../shared/flow-codes.js";
import {
  builtinRefused,
  coversProduct,
  coversSelection,
  levelRank,
  PRODUCTS,
  type Product,
  type ProductSelection,
  parseSelection,
  requiredScopes,
  restrictedProducts,
  type Selection,
  unionScopes,
} from "../shared/products.js";
import { allowedReturnOrigin } from "../shared/return-origin.js";
import { isEmail, normalizeEmail } from "../shared/setup.js";
import { type Browser, type ClientDeps, type ResolvedClient, selectClient } from "./clients.js";
import {
  createGoogleLoginFlow,
  GoogleFlowError,
  type GoogleLoginOptions,
  type GoogleSignInResult,
  revokeToken,
  type SignInPath,
} from "./google-oauth.js";
import type { DeliveredCode, PendingFlows } from "./pending-flows.js";
import { type Account, type AccountSummary, type ClientRef, type GoogleStore, summarize } from "./store.js";

export type Refusal = { ok: false; status: number; error: string; [k: string]: unknown };
export type Started = { ok: true; flowId: string; path: SignInPath; client: ClientRef };
export type Applied = { ok: true; applied: true; account: AccountSummary };

export interface ConnectDeps {
  store: GoogleStore;
  clients: ClientDeps;
  endpoints: GoogleEndpoints;
  oauth: PluginOAuth | undefined;
  logger: { info(m: string): void; warn(m: string): void };
  pending: PendingFlows;
  /** Dashboard public base URL (`auth.redirectBaseUrl` → tunnel → localhost), or undefined when unknown. */
  dashboardBase: () => string | undefined;
  fetchImpl?: typeof fetch;
  createCallback?: GoogleLoginOptions["createCallback"];
  newId?: () => string;
  now?: () => number;
}

const isRefusal = (v: object): v is Refusal => "ok" in v && (v as { ok: unknown }).ok === false;

const refuse = (status: number, error: string, extra: Record<string, unknown> = {}): Refusal => ({
  ok: false,
  status,
  error,
  ...extra,
});

/** Codes the sign-in log line may carry: the flow allow-list plus the store codes a persist can raise. */
function logCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return knownFlowCode(code) ?? "sign_in_failed";
}

function productList(sel: Selection): string {
  return PRODUCTS.filter((p) => sel[p]).join(",") || "-";
}

interface Wish {
  off: Product[];
  set: Selection;
}

/** Split an untrusted `{product: null | level | {level, options}}` body into products to turn off / set. */
function parseWish(wish: Record<string, unknown>): Wish | Refusal {
  const off: Product[] = [];
  const set: Selection = {};
  for (const [k, v] of Object.entries(wish)) {
    if (v === null) {
      if (!(PRODUCTS as readonly string[]).includes(k)) return refuse(400, "bad_request");
      off.push(k as Product);
      continue;
    }
    const sel = parseSelection({ [k]: v })?.[k as Product];
    if (!sel) return refuse(400, "bad_request");
    set[k as Product] = sel;
  }
  if (off.length === 0 && Object.keys(set).length === 0) return refuse(400, "no_products");
  return { off, set };
}

/** The product map after the wish, and whether any raise needs Google (lowering never does). */
function mergeWish(acct: Account, wish: Wish): { merged: Selection; needsConsent: boolean } {
  const merged: Selection = { ...acct.products };
  for (const p of wish.off) delete merged[p];
  let needsConsent = false;
  for (const p of PRODUCTS) {
    const sel = wish.set[p];
    if (!sel) continue;
    const prev = acct.products[p];
    const lowering = !!prev && levelRank(p, sel.level) < levelRank(p, prev.level);
    const withOpts: ProductSelection = sel.options || !prev?.options ? sel : { ...sel, options: prev.options };
    merged[p] = withOpts;
    if (!lowering && (acct.grant.status !== "ok" || !coversProduct(acct.grant.scopes, p, withOpts))) needsConsent = true;
  }
  return { merged, needsConsent };
}

/** Fold what Google granted into the product map: covered products turn on, the rest are `missing`. */
function applyGranted(granted: readonly string[], wanted: Selection, base: Account["products"]): { products: Account["products"]; missing: Product[] } {
  const products: Account["products"] = { ...base };
  const missing: Product[] = [];
  for (const p of PRODUCTS) {
    const sel = wanted[p];
    if (!sel) continue;
    if (coversProduct(granted, p, sel)) products[p] = sel;
    else missing.push(p);
  }
  return { products, missing };
}

export class ConnectService {
  private readonly consents = new Set<string>();
  private readonly newId: () => string;

  private readonly deps: ConnectDeps;

  constructor(deps: ConnectDeps) {
    this.deps = deps;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  // ── disclosure (D8) ───────────────────────────────────────────────────────

  async disclosureAccepted(): Promise<boolean> {
    const d = await this.deps.store.getDisclosure();
    // A stored version newer than the shipped one counts as accepted (scenario-gate B8).
    return !!d && d.version >= DISCLOSURE_VERSION;
  }

  /** Body-less accept: the server records ITS current version. */
  async acceptDisclosure(): Promise<void> {
    await this.deps.store.acceptDisclosure(DISCLOSURE_VERSION, this.deps.now?.());
    this.deps.logger.info("[google] disclosure accepted");
  }

  // ── connect a NEW account ─────────────────────────────────────────────────

  async startConnect(input: {
    products: unknown;
    client?: unknown;
    email?: unknown;
    browser: Browser;
  }): Promise<Started | Refusal> {
    const sel = parseSelection(input.products);
    if (!sel) return refuse(400, "bad_request");
    if (Object.keys(sel).length === 0) return refuse(400, "no_products");
    let email: string | undefined;
    if (input.email !== undefined && input.email !== null && input.email !== "") {
      const e = typeof input.email === "string" ? normalizeEmail(input.email) : "";
      if (!isEmail(e)) return refuse(400, "invalid_email");
      email = e;
    }
    if (input.client !== undefined && typeof input.client !== "string") return refuse(400, "bad_request");
    const picked = await selectClient(this.deps.clients, { client: input.client, email, browser: input.browser });
    if (!picked.ok) return refuse(picked.status, picked.error, { clients: picked.clients });
    const client = picked.client;
    const gate = await this.gateClient(client, sel);
    if (gate) return gate;
    // Only a NEW account needs a free key: reconnecting an existing one updates it in place (scenario-gate B17).
    const known = email !== undefined && (await this.deps.store.list()).some((x) => x.email.toLowerCase() === email);
    if (!known && !(await this.deps.store.hasRoomForAccount())) return refuse(409, "too_many_keys");
    return this.start({
      key: `add-${this.newId()}`,
      client,
      wanted: sel,
      grantedScopes: [],
      prompt: "select_account consent",
      loginHint: email,
      browser: input.browser,
      mode: "connect",
    });
  }

  // ── product changes / sign in again for an existing account ───────────────

  /**
   * Apply a product map change. `wish[product] = null` turns a product off; a selection sets it. Lowering and
   * turning off never re-consent; a raise (or a new product) applies at once when the grant already covers it,
   * else one consent on the account's own client for the UNION of granted + required scopes.
   */
  async changeProducts(
    sub: string,
    wish: Record<string, unknown>,
    browser: Browser,
  ): Promise<Started | Applied | Refusal> {
    const acct = await this.deps.store.get(sub);
    if (!acct) return refuse(404, "not_found");
    const parsed = parseWish(wish);
    if ("error" in parsed) return parsed;
    const { merged, needsConsent } = mergeWish(acct, parsed);
    if (needsConsent) return this.consent(acct, merged, browser);
    let next = acct;
    for (const p of parsed.off) next = await this.deps.store.setProduct(sub, p, undefined);
    for (const p of PRODUCTS) if (parsed.set[p]) next = await this.deps.store.setProduct(sub, p, merged[p] as ProductSelection);
    this.deps.logger.info(`[google] products applied products=${productList(merged)}`);
    return { ok: true, applied: true, account: summarize(next) };
  }

  /** Sign in again for an account whose grant needs it (or to refresh its consent). */
  async signInAgain(sub: string, browser: Browser): Promise<Started | Refusal> {
    const acct = await this.deps.store.get(sub);
    if (!acct) return refuse(404, "not_found");
    return this.consent(acct, acct.products, browser);
  }

  private async consent(acct: Account, wanted: Selection, browser: Browser): Promise<Started | Refusal> {
    if (this.consents.has(acct.sub)) return refuse(409, "consent_in_progress");
    const client = await this.clientOf(acct, browser);
    if (isRefusal(client)) return client;
    const gate = await this.gateClient(client, wanted);
    if (gate) return gate;
    return this.start({
      key: `consent-${acct.sub}`,
      client,
      wanted,
      grantedScopes: acct.grant.scopes,
      prompt: "consent",
      loginHint: acct.email,
      browser,
      mode: "consent",
      expect: acct,
    });
  }

  /** The client an existing account consents on (D3): its own, never silently another. */
  private async clientOf(acct: Account, browser: Browser): Promise<ResolvedClient | Refusal> {
    const { clients } = this.deps;
    if (acct.client === "builtin") {
      if (browser !== "local") return refuse(409, "local_browser_required");
      const picked = await selectClient(clients, { client: "builtin", browser });
      return picked.ok ? picked.client : refuse(picked.status, picked.error);
    }
    if (acct.client === "builtin-remote") {
      const picked = await selectClient(clients, { client: "builtin-remote", browser: "remote" });
      return picked.ok ? picked.client : refuse(picked.status, picked.error);
    }
    const picked = await selectClient(clients, { client: acct.client, browser });
    return picked.ok ? picked.client : refuse(picked.status, picked.error === "client_not_found" ? "no_client" : picked.error);
  }

  // ── shared gate + start ───────────────────────────────────────────────────

  /** Product rules of the built-in app + the disclosure gate (null = allowed). */
  private async gateClient(client: ResolvedClient, wanted: Selection): Promise<Refusal | null> {
    if (client.ref !== "builtin" && client.ref !== "builtin-remote") return null; // own clients are not gated (B7)
    if (builtinRefused(wanted).length > 0) return refuse(400, "own_client_required");
    if (client.ref === "builtin-remote" && restrictedProducts(wanted).length > 0) {
      return refuse(400, "restricted_scope_remote");
    }
    if (!(await this.disclosureAccepted())) return refuse(409, "disclosure_required");
    return null;
  }

  private pathFor(client: ResolvedClient, browser: Browser): SignInPath {
    if (client.ref === "builtin-remote") return "return";
    if (client.type === "web") return "web";
    return browser === "local" ? "local" : "paste";
  }

  /** Where Google sends the browser back to, for the web / return paths (none for loopback/paste). */
  private returnTarget(path: SignInPath): { redirectBase?: string; returnOrigin?: string } | Refusal {
    if (path !== "web" && path !== "return") return {};
    const redirectBase = this.deps.dashboardBase();
    if (!redirectBase) return refuse(409, "dashboard_address_unknown");
    if (path === "web") return { redirectBase };
    const returnOrigin = allowedReturnOrigin(redirectBase);
    return returnOrigin ? { redirectBase, returnOrigin } : refuse(409, "remote_origin_unsupported", { returnPage: RETURN_PAGE_URL });
  }

  private async start(o: {
    key: string;
    client: ResolvedClient;
    wanted: Selection;
    grantedScopes: readonly string[];
    prompt: string;
    loginHint?: string;
    browser: Browser;
    mode: "connect" | "consent";
    expect?: Account;
  }): Promise<Started | Refusal> {
    const { deps } = this;
    if (!deps.oauth) return refuse(501, "oauth_unavailable");
    const path = this.pathFor(o.client, o.browser);
    const target = this.returnTarget(path);
    if (isRefusal(target)) return target;
    const tag = `client=${o.client.ref} path=${path} products=${productList(o.wanted)}`;
    let logged = false;
    const finish = (result: string, level: "info" | "warn") => {
      if (logged) return;
      logged = true;
      if (o.expect) this.consents.delete(o.expect.sub);
      deps.logger[level](`[google] signin ${tag} result=${result}`);
    };
    if (o.expect) this.consents.add(o.expect.sub);
    const flow = createGoogleLoginFlow({
      client: o.client,
      endpoints: deps.endpoints,
      scopes: unionScopes(o.grantedScopes, requiredScopes(o.wanted)),
      prompt: o.prompt,
      path,
      loginHint: o.loginHint,
      pending: deps.pending,
      redirectBase: target.redirectBase,
      returnOrigin: target.returnOrigin,
      fetchImpl: deps.fetchImpl,
      createCallback: deps.createCallback,
      now: deps.now,
    });
    const loginFlow = {
      ...flow,
      login: async (ix: Parameters<typeof flow.login>[0]) => {
        try {
          return await flow.login(ix);
        } catch (err) {
          finish(logCode(err), "warn");
          throw err;
        }
      },
    };
    try {
      const { flowId } = await deps.oauth.startFlow({
        key: o.key,
        loginFlow,
        persist: async (credential) => {
          try {
            await this.persist(credential as GoogleSignInResult, o);
            finish("ok", "info");
          } catch (err) {
            finish(logCode(err), "warn");
            throw err;
          }
        },
      });
      return { ok: true, flowId, path, client: o.client.ref };
    } catch (err) {
      finish(logCode(err), "warn");
      const code = (err as { code?: unknown } | null)?.code;
      return refuse(502, typeof code === "string" && /^[a-z_]{1,64}$/.test(code) ? code : "internal_error");
    }
  }

  /** Store the result of a sign-in (D3/D6). Throws a fixed-code error: nothing is written on a refusal. */
  private async persist(
    c: GoogleSignInResult,
    o: { client: ResolvedClient; wanted: Selection; mode: "connect" | "consent"; expect?: Account },
  ): Promise<void> {
    const { store } = this.deps;
    if (o.expect && c.sub !== o.expect.sub) throw new GoogleFlowError("account_mismatch");
    const existing = await store.get(c.sub);
    if (existing && existing.client !== o.client.ref) throw new GoogleFlowError("client_mismatch");
    // A reply narrower than what the account already relies on counts as not granted: nothing changes. A product the
    // user is moving to a level the reply DOES cover relies on the new level (Drive files → read), not the old one.
    if (existing) {
      const relied: Selection = { ...existing.products };
      for (const p of PRODUCTS) {
        const next = o.wanted[p];
        if (relied[p] && next && coversProduct(c.grantedScopes, p, next)) relied[p] = next;
      }
      if (!coversSelection(c.grantedScopes, relied)) throw new GoogleFlowError("scope_missing");
    }

    const { products, missing } = applyGranted(c.grantedScopes, o.wanted, existing?.products ?? {});
    if (!existing && Object.keys(products).length === 0) throw new GoogleFlowError("scope_missing");
    await store.upsertFromSignIn({
      sub: c.sub,
      email: c.email,
      client: o.client.ref,
      clientId: o.client.clientId,
      scopes: c.grantedScopes,
      access: c.access,
      refresh: c.refresh || undefined,
      expires: c.expires,
      testingHint: c.testingHint,
      products,
      missing,
      now: this.deps.now?.(),
    });
    // A consent whose new level Google did not grant: the grant is updated, the previous level stays.
    if (o.mode === "consent" && missing.length > 0) throw new GoogleFlowError("scope_missing");
  }

  // ── callbacks ─────────────────────────────────────────────────────────────

  /** A code (or Google error) returned to the dashboard for a state IT issued; one-shot. */
  deliver(state: string | undefined, payload: DeliveredCode): { ok: true } | Refusal {
    if (!state) return refuse(400, "invalid_state");
    const r = this.deps.pending.deliver(state, payload);
    return r.ok ? r : refuse(r.status, r.error);
  }

  // ── disconnect ────────────────────────────────────────────────────────────

  /** Delete locally (default); optionally also revoke at Google (explicit, may affect other installs). */
  async disconnect(sub: string, opts: { revoke: boolean }): Promise<{ ok: true; removed: true; remoteRevoked: boolean | null } | Refusal> {
    const acct = await this.deps.store.get(sub);
    if (!acct) return refuse(404, "not_found");
    let remoteRevoked: boolean | null = null;
    if (opts.revoke) remoteRevoked = await revokeToken(this.deps.endpoints, acct.grant.refresh, this.deps.fetchImpl);
    await this.deps.store.remove(acct.sub);
    this.deps.logger.info(`[google] disconnect client=${acct.client} revoke=${opts.revoke ? (remoteRevoked ? "ok" : "failed") : "no"}`);
    return { ok: true, removed: true, remoteRevoked };
  }
}
