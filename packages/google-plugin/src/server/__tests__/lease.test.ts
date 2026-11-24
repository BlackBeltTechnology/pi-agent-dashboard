/**
 * `google/lease` (test-plan B1–B9, A3–A5, A11, GA13/GA14; scenario-gate A13/A14/B18): refusal order,
 * single-flight refresh bound to the recorded client, invalid_grant, secret-free logs.
 * See change: add-google-connect.
 */
import { describe, expect, it, vi } from "vitest";
import {
  account,
  capturingLogger,
  fakeGoogleFetch,
  LOCAL,
  memoryCredentials,
  OWN_BB,
  ownClient,
  REMOTE,
  TEST_ENDPOINTS,
} from "../../__tests__/fakes.js";
import type { BuiltInClients, Switches } from "../../shared/default-clients.js";
import { SCOPE } from "../../shared/products.js";
import { createLeaseHandler } from "../lease.js";
import { acctKey, clientKey, GoogleStore } from "../store.js";

const NOW = 1_700_000_000_000;

function setup(
  initial: Record<string, unknown>,
  o: { sw?: Partial<Switches>; builtIn?: BuiltInClients; refresh?: Parameters<typeof fakeGoogleFetch>[0]["refresh"] } = {},
) {
  const creds = memoryCredentials(initial as never);
  const store = new GoogleStore(creds);
  const sw: Switches = { defaultClients: true, remoteReturn: true, ...o.sw };
  const logger = capturingLogger();
  const google = fakeGoogleFetch({ refresh: o.refresh ?? (() => ({ access_token: "NEW-ACCESS", expires_in: 3600, token_type: "Bearer" })) });
  const lease = createLeaseHandler({
    store,
    clients: { store, builtIn: o.builtIn ?? { local: LOCAL, remote: REMOTE }, switches: () => sw },
    endpoints: TEST_ENDPOINTS,
    logger,
    fetchImpl: google.fetchImpl,
    now: () => NOW,
  });
  return { creds, store, lease, google, logger };
}

const fresh = { expires: NOW + 3_600_000 };
const err = async (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

describe("successful lease", () => {
  it("returns exactly accessToken/expiresAt/email/level — never the refresh token", async () => {
    const { lease } = setup({ [acctKey("s1")]: account("s1", "a@x.com", { ...fresh, products: { gmail: { level: "send" } }, scopes: [SCOPE.gmailModify] }) });
    const r = await lease({ account: "a@x.com", product: "gmail", level: "draft" });
    expect(r).toEqual({ accessToken: "ACCESS-s1", expiresAt: NOW + 3_600_000, email: "a@x.com", level: "send" });
    expect(JSON.stringify(r)).not.toContain("REFRESH");
  });
  it("resolves the account by sub, alias or email", async () => {
    const { lease } = setup({ [acctKey("s1")]: account("s1", "a@x.com", { ...fresh, alias: "work" }) });
    for (const ref of ["s1", "work", "A@X.COM"]) expect((await lease({ account: ref, product: "gmail" })).email).toBe("a@x.com");
  });
});

describe("refusals", () => {
  const acct = (over = {}) => account("s1", "a@x.com", { ...fresh, ...over });
  it("bad_request for a missing account, an unknown/missing product or an unknown level (A14)", async () => {
    const { lease } = setup({ [acctKey("s1")]: acct() });
    for (const p of [{}, { account: "s1" }, { account: "s1", product: "photos" }, { account: "", product: "gmail" }, { account: "s1", product: "gmail", level: "admin" }, null]) {
      expect(await err(lease(p))).toMatch(/^bad_request:/);
    }
  });
  it("not_found / ambiguous", async () => {
    const { lease } = setup({ [acctKey("s1")]: acct(), [acctKey("s2")]: account("s2", "a@x.com", fresh) });
    expect(await err(lease({ account: "a@x.com", product: "gmail" }))).toMatch(/^ambiguous:/);
    expect(await err(lease({ account: "zed@x.com", product: "gmail" }))).toMatch(/^not_found:.*a@x.com/);
  });
  it("product_disabled names where to turn it on", async () => {
    const { lease } = setup({ [acctKey("s1")]: acct() });
    expect(await err(lease({ account: "s1", product: "calendar" }))).toMatch(/^product_disabled: calendar is off for a@x.com in Settings → Google accounts/);
  });
  it("level_insufficient when the op needs more than the enabled level", async () => {
    const { lease } = setup({ [acctKey("s1")]: acct({ products: { calendar: { level: "read" } }, scopes: [SCOPE.calendarReadonly] }) });
    expect(await err(lease({ account: "s1", product: "calendar", level: "write" }))).toMatch(/^level_insufficient:/);
    expect((await lease({ account: "s1", product: "calendar", level: "read" })).level).toBe("read");
  });
  it("product_disabled wins over reauth_required — no token is needed to say it (A13)", async () => {
    const { lease } = setup({ [acctKey("s1")]: acct({ status: "reauth_required" }) });
    expect(await err(lease({ account: "s1", product: "calendar" }))).toMatch(/^product_disabled:/);
    expect(await err(lease({ account: "s1", product: "gmail" }))).toMatch(/^reauth_required:/);
  });
  it("scope_missing when the stored grant does not cover the enabled level", async () => {
    const { lease } = setup({ [acctKey("s1")]: acct({ products: { gmail: { level: "send" } }, scopes: [SCOPE.gmailReadonly] }) });
    expect(await err(lease({ account: "s1", product: "gmail" }))).toMatch(/^scope_missing:/);
  });
});

describe("built-in client switches (A3–A5, A11)", () => {
  it("PI_GOOGLE_DEFAULT_CLIENTS=off → default_client_unavailable for builtin AND builtin-remote, even with a live token", async () => {
    const init = {
      [acctKey("s1")]: account("s1", "a@x.com", { ...fresh }),
      [acctKey("s2")]: account("s2", "b@x.com", { ...fresh, client: "builtin-remote", clientId: REMOTE.clientId }),
    };
    const { lease, google } = setup(init, { sw: { defaultClients: false } });
    expect(await err(lease({ account: "s1", product: "gmail" }))).toMatch(/^default_client_unavailable:/);
    expect(await err(lease({ account: "s2", product: "gmail" }))).toMatch(/^default_client_unavailable:/);
    expect(google.calls).toHaveLength(0);
  });
  it("an own client is unaffected by the off switch (A5)", async () => {
    const { lease } = setup(
      { [clientKey("bb")]: ownClient("bb", "BB"), [acctKey("s1")]: account("s1", "a@x.com", { ...fresh, client: "own:bb", clientId: OWN_BB.clientId }) },
      { sw: { defaultClients: false } },
    );
    expect((await lease({ account: "s1", product: "gmail" })).accessToken).toBe("ACCESS-s1");
  });
  it("an own client that was removed → no_client", async () => {
    const { lease } = setup({ [acctKey("s1")]: account("s1", "a@x.com", { ...fresh, client: "own:ghost", clientId: OWN_BB.clientId }) });
    expect(await err(lease({ account: "s1", product: "gmail" }))).toMatch(/^no_client:/);
  });
  it("REMOTE_RETURN=off does NOT stop refresh of a builtin-remote grant (A11)", async () => {
    const { lease, google } = setup(
      { [acctKey("s1")]: account("s1", "a@x.com", { client: "builtin-remote", clientId: REMOTE.clientId, expires: NOW - 1 }) },
      { sw: { remoteReturn: false } },
    );
    expect((await lease({ account: "s1", product: "gmail" })).accessToken).toBe("NEW-ACCESS");
    expect(google.calls[0]?.body.get("client_id")).toBe(REMOTE.clientId);
  });
});

describe("refresh", () => {
  const expired = { expires: NOW + 59_000 };
  it("refreshes inside the 60 s window with the recorded client id and secret, and stores the result", async () => {
    const { lease, google, store } = setup({ [acctKey("s1")]: account("s1", "a@x.com", expired) });
    const r = await lease({ account: "s1", product: "gmail" });
    expect(r).toMatchObject({ accessToken: "NEW-ACCESS", expiresAt: NOW + 3_600_000 });
    expect(google.calls[0]?.body.get("client_id")).toBe(LOCAL.clientId);
    expect(google.calls[0]?.body.get("client_secret")).toBe(LOCAL.clientSecret);
    expect((await store.get("s1"))?.grant.access).toBe("NEW-ACCESS");
  });
  it("does not refresh with 61 s left", async () => {
    const { lease, google } = setup({ [acctKey("s1")]: account("s1", "a@x.com", { expires: NOW + 61_000 }) });
    await lease({ account: "s1", product: "gmail" });
    expect(google.calls).toHaveLength(0);
  });
  it("single-flight: ten concurrent leases → one refresh", async () => {
    const { lease, google } = setup({ [acctKey("s1")]: account("s1", "a@x.com", expired) }, { refresh: async () => { await new Promise((r) => setTimeout(r, 5)); return { access_token: "NEW", expires_in: 3600, token_type: "Bearer" }; } });
    const all = await Promise.all(Array.from({ length: 10 }, () => lease({ account: "s1", product: "gmail" })));
    expect(all.every((r) => r.accessToken === "NEW")).toBe(true);
    expect(google.calls).toHaveLength(1);
  });
  it("a rotated refresh token is stored", async () => {
    const { lease, store } = setup({ [acctKey("s1")]: account("s1", "a@x.com", expired) }, { refresh: () => ({ access_token: "N", refresh_token: "ROT", expires_in: 3600, token_type: "Bearer" }) });
    await lease({ account: "s1", product: "gmail" });
    expect((await store.get("s1"))?.grant.refresh).toBe("ROT");
  });
  it("invalid_grant marks reauth_required; later leases refuse without touching the network (X1)", async () => {
    const { lease, google, store } = setup({ [acctKey("s1")]: account("s1", "a@x.com", expired) }, { refresh: () => ({ status: 400, body: { error: "invalid_grant" } }) });
    expect(await err(lease({ account: "s1", product: "gmail" }))).toMatch(/^reauth_required:/);
    expect((await store.get("s1"))?.grant.status).toBe("reauth_required");
    expect(await err(lease({ account: "s1", product: "gmail" }))).toMatch(/^reauth_required:/);
    expect(google.calls).toHaveLength(1);
  });
  it("any other refresh failure → refresh_failed, status untouched (X2)", async () => {
    const { lease, store } = setup({ [acctKey("s1")]: account("s1", "a@x.com", expired) }, { refresh: () => ({ status: 503, body: { error: "backend_error" } }) });
    expect(await err(lease({ account: "s1", product: "gmail" }))).toMatch(/^refresh_failed:/);
    expect((await store.get("s1"))?.grant.status).toBe("ok");
  });
  it("a re-auth that lands during a refresh wins: the new grant is served, not marked (X4)", async () => {
    const { lease, store } = setup({ [acctKey("s1")]: account("s1", "a@x.com", expired) }, {
      refresh: async () => {
        await store.upsertFromSignIn({ sub: "s1", email: "a@x.com", client: "builtin", clientId: LOCAL.clientId, scopes: [SCOPE.gmailReadonly], access: "REAUTH-ACCESS", refresh: "REAUTH-REFRESH", expires: NOW + 3_600_000, products: { gmail: { level: "readonly" } } });
        return { status: 400, body: { error: "invalid_grant" } };
      },
    });
    expect((await lease({ account: "s1", product: "gmail" })).accessToken).toBe("REAUTH-ACCESS");
    expect((await store.get("s1"))?.grant.status).toBe("ok");
  });
});

describe("logs (D13)", () => {
  it("one line per lease: product, op, code — no tokens, no emails", async () => {
    const { lease, logger } = setup({ [acctKey("s1")]: account("s1", "a@x.com", { ...fresh }) });
    await lease({ account: "s1", product: "gmail", level: "readonly" });
    await lease({ account: "s1", product: "calendar" }).catch(() => {});
    expect(logger.lines).toEqual(["[google] lease product=gmail op=readonly result=ok", "[google] lease product=calendar op=- result=product_disabled"]);
    expect(logger.lines.join("\n")).not.toMatch(/ACCESS|REFRESH|a@x\.com/);
  });
  it("refresh lines carry the client ref and result only", async () => {
    const { lease, logger } = setup({ [acctKey("s1")]: account("s1", "a@x.com", { expires: NOW }) });
    await lease({ account: "s1", product: "gmail" });
    expect(logger.lines).toContain("[google] refresh client=builtin result=ok");
    expect(logger.lines.join("\n")).not.toMatch(/NEW-ACCESS|REFRESH|a@x\.com/);
  });
});

void vi;
