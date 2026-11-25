/**
 * Connect / consent / products / disconnect through the real login flow against a fake Google
 * (test-plan A5–A13, A65–A111, B10–B20, B23, B35–B84; scenario-gate A8/A9/A12/A15, B4/B6/B8/B17).
 * See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { account, LOCAL, makeHarness, OWN_BB, OWN_SEMMI, ownClient, REMOTE } from "../../__tests__/fakes.js";
import { DISCLOSURE_VERSION, RETURN_PAGE_URL } from "../../shared/default-clients.js";
import { SCOPE } from "../../shared/products.js";
import { acctKey, clientKey } from "../store.js";

const gmailScopes = [SCOPE.gmailReadonly];
const cal = [SCOPE.calendarReadonly];

async function accepted(h: ReturnType<typeof makeHarness>) {
  await h.connect.acceptDisclosure();
  return h;
}

describe("starting a connect (D5, D8; A8, B17)", () => {
  it("no products → 400 no_products; unknown product/level → 400 bad_request; bad email → 400 invalid_email", async () => {
    const h = await accepted(makeHarness());
    expect(await h.connect.startConnect({ products: {}, browser: "local" })).toMatchObject({ ok: false, status: 400, error: "no_products" });
    expect(await h.connect.startConnect({ products: { photos: "read" }, browser: "local" })).toMatchObject({ error: "bad_request" });
    expect(await h.connect.startConnect({ products: { calendar: "root" }, browser: "local" })).toMatchObject({ error: "bad_request" });
    expect(await h.connect.startConnect({ products: { calendar: "read" }, email: "nope", browser: "local" })).toMatchObject({ error: "invalid_email" });
    expect(h.started).toHaveLength(0);
  });

  it("an empty email string means not given (B16)", async () => {
    const h = await accepted(makeHarness());
    expect(await h.connect.startConnect({ products: { calendar: "read" }, email: "", browser: "local" })).toMatchObject({ ok: true });
  });

  it("nothing available and no own client → 400 client_required (10.1)", async () => {
    const h = makeHarness({ builtIn: { local: null, remote: null } });
    expect(await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" })).toMatchObject({ ok: false, status: 400, error: "client_required", clients: [] });
  });

  it("an unknown explicit client → 404 client_not_found (A7)", async () => {
    const h = makeHarness();
    expect(await h.connect.startConnect({ products: { calendar: "read" }, client: "own:ghost", browser: "local" })).toMatchObject({ status: 404, error: "client_not_found" });
  });

  it("a full store is refused BEFORE Google opens (B17)", async () => {
    const filler = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`acct:f${i}`, account(`f${i}`, `f${i}@x.com`)]));
    const h = makeHarness({ initial: { ...filler, [clientKey("bb")]: ownClient("bb", "BB") } as never });
    expect(await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "local" })).toMatchObject({ status: 409, error: "too_many_keys" });
    expect(h.started).toHaveLength(0);
  });
});

describe("built-in disclosure gate (D8; B8)", () => {
  it("built-in connect without acceptance → 409 disclosure_required; own clients are not gated (B7)", async () => {
    const h = makeHarness({ initial: { [clientKey("bb")]: ownClient("bb", "BB", OWN_BB, { type: "web" }) as never } });
    expect(await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" })).toMatchObject({ status: 409, error: "disclosure_required" });
    expect(await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "local" })).toMatchObject({ ok: true });
    expect((await h.store.getDisclosure())).toBeUndefined();
  });
  it("accepting records the server's version; a newer stored version counts as accepted; an older one does not", async () => {
    const h = makeHarness();
    expect(await h.connect.disclosureAccepted()).toBe(false);
    await h.connect.acceptDisclosure();
    expect(await h.store.getDisclosure()).toMatchObject({ version: DISCLOSURE_VERSION });
    expect(await h.connect.disclosureAccepted()).toBe(true);
    await h.store.acceptDisclosure(DISCLOSURE_VERSION + 5);
    expect(await h.connect.disclosureAccepted()).toBe(true);
    await h.store.acceptDisclosure(DISCLOSURE_VERSION - 1);
    expect(await h.connect.disclosureAccepted()).toBe(false);
  });
  it("the gate also covers consent and sign-in-again on a built-in account", async () => {
    const h = makeHarness({ initial: { [acctKey("s1")]: account("s1", "a@x.com", { scopes: gmailScopes }) as never } });
    expect(await h.connect.signInAgain("s1", "local")).toMatchObject({ status: 409, error: "disclosure_required" });
  });
});

describe("built-in rules enforced server-side (A2, B6)", () => {
  it("#GC7 full Drive on the built-in app → 400 own_client_required, for both refs", async () => {
    const h = await accepted(makeHarness());
    for (const level of ["read", "write"]) {
      expect(await h.connect.startConnect({ products: { drive: level }, browser: "local" })).toMatchObject({ status: 400, error: "own_client_required" });
      expect(await h.connect.startConnect({ products: { drive: level }, browser: "remote" })).toMatchObject({ status: 400, error: "own_client_required" });
    }
    expect(await h.connect.startConnect({ products: { drive: "files" }, browser: "local" })).toMatchObject({ ok: true });
  });
  it("a restricted product on the return-page path → 400 restricted_scope_remote (no Google call)", async () => {
    const h = await accepted(makeHarness());
    expect(await h.connect.startConnect({ products: { gmail: "readonly", calendar: "read" }, browser: "remote" })).toMatchObject({ status: 400, error: "restricted_scope_remote" });
    expect(h.started).toHaveLength(0);
  });
  it("an OWN client has no such limits: full Drive and Gmail are fine", async () => {
    const h = makeHarness({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never } });
    expect(await h.connect.startConnect({ products: { drive: "write", gmail: "send" }, client: "own:bb", browser: "local" })).toMatchObject({ ok: true });
  });
});

describe("local sign-in (D12a)", () => {
  it("asks Google for the union scopes with an account chooser, PKCE and offline access — never include_granted_scopes (A9, D6)", async () => {
    const h = await accepted(makeHarness({ google: { scope: [...gmailScopes, ...cal] } }));
    const r = await h.connect.startConnect({ products: { gmail: "readonly", calendar: "read" }, email: "Me@X.com", browser: "local" });
    expect(r).toMatchObject({ ok: true, flowId: "flow-1", path: "local", client: "builtin" });
    expect(h.started[0]?.key).toBe("add-uuid1");
    const { url } = await h.runFlow();
    const q = url.searchParams;
    expect(q.get("client_id")).toBe(LOCAL.clientId);
    expect(q.get("scope")).toBe(`openid email ${SCOPE.gmailReadonly} ${SCOPE.calendarReadonly}`);
    expect(q.get("prompt")).toBe("select_account consent");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("login_hint")).toBe("me@x.com");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.has("include_granted_scopes")).toBe(false);
    expect(q.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it("stores the account bound to the built-in client with the exact client id that minted the token (D3)", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal, sub: "s9", email: "z@x.com" } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await h.runFlow();
    const acct = await h.store.get("s9");
    expect(acct).toMatchObject({ email: "z@x.com", client: "builtin", products: { calendar: { level: "read" } } });
    expect(acct?.grant).toMatchObject({ clientId: LOCAL.clientId, refresh: "REFRESH-new", status: "ok", scopes: cal });
    expect(acct?.missing).toBeUndefined();
  });

  it("a remote browser with a Desktop client falls back to paste (D12a)", async () => {
    const h = makeHarness({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never }, google: { scope: cal } });
    const r = await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "remote" });
    expect(r).toMatchObject({ ok: true, path: "paste" });
    await h.runFlow(0, { deliver: "paste" });
    expect((await h.store.list())).toHaveLength(1);
  });
});

describe("partial grants on a new connect (D6)", () => {
  it("products Google did not grant stay off and are recorded as scope_missing; the account is kept", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    await h.connect.startConnect({ products: { gmail: "readonly", calendar: "read" }, browser: "local" });
    await h.runFlow();
    const acct = await h.store.get("s1");
    expect(Object.keys(acct?.products ?? {})).toEqual(["calendar"]);
    expect(acct?.missing).toEqual(["gmail"]);
  });
  it("no requested product granted → scope_missing, nothing stored", async () => {
    const h = await accepted(makeHarness({ google: { scope: [] } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await expect(h.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
    expect(await h.store.list()).toEqual([]);
    expect(h.logger.warns).toContain("[google] signin client=builtin path=local products=calendar result=scope_missing");
  });
  it("a reply without a refresh token for a NEW account → missing_refresh, nothing stored", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal, refresh: null } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await expect(h.runFlow()).rejects.toMatchObject({ code: "missing_refresh" });
    expect(await h.store.list()).toEqual([]);
  });
});

describe("accounts are bound to one client (D3; A65–A78)", () => {
  const existing = (over = {}) => ({ [acctKey("s1")]: account("s1", "a@x.com", { scopes: cal, products: { calendar: { level: "read" } }, alias: "work", ...over }) as never });

  it("the same Google account through a different client → client_mismatch; nothing changes", async () => {
    const h = makeHarness({ initial: { ...existing(), [clientKey("bb")]: ownClient("bb", "BB") as never }, google: { scope: cal } });
    await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "local" });
    await expect(h.runFlow()).rejects.toMatchObject({ code: "client_mismatch" });
    expect(await h.store.get("s1")).toMatchObject({ client: "builtin", alias: "work" });
    expect(h.logger.warns.at(-1)).toContain("result=client_mismatch");
  });
  it("builtin ↔ builtin-remote are different clients too", async () => {
    const h = await accepted(makeHarness({ initial: existing(), google: { scope: cal } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    await expect(h.runFlow()).rejects.toMatchObject({ code: "client_mismatch" });
    expect((await h.store.get("s1"))?.client).toBe("builtin");
  });
  it("connecting the same account again through the SAME client keeps alias and adds products", async () => {
    const h = await accepted(makeHarness({ initial: existing(), google: { scope: [...cal, SCOPE.tasksReadonly] } }));
    // The reply must still cover what the account relies on, so the request carries it too.
    await h.connect.startConnect({ products: { calendar: "read", tasks: "read" }, browser: "local" });
    await h.runFlow();
    expect(await h.store.get("s1")).toMatchObject({ alias: "work", products: { calendar: { level: "read" }, tasks: { level: "read" } } });
    expect((await h.store.list())).toHaveLength(1);
  });
});

describe("consent for an existing account (D6; A84–A111)", () => {
  const acctWith = (over = {}) => ({
    [acctKey("s1")]: account("s1", "a@x.com", { scopes: gmailScopes, products: { gmail: { level: "readonly" } }, ...over }) as never,
  });

  it("a product the grant already covers applies at once — no Google flow", async () => {
    const h = await accepted(makeHarness({ initial: acctWith({ scopes: [...gmailScopes, ...cal] }) }));
    const r = await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    expect(r).toMatchObject({ ok: true, applied: true });
    expect(h.started).toHaveLength(0);
    expect((await h.store.get("s1"))?.products).toEqual({ gmail: { level: "readonly" }, calendar: { level: "read" } });
  });

  it("a new product asks Google for the UNION of granted + required with login_hint and prompt=consent", async () => {
    const h = await accepted(makeHarness({ initial: acctWith(), google: { scope: [...gmailScopes, ...cal] } }));
    const r = await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    expect(r).toMatchObject({ ok: true, flowId: "flow-1" });
    expect(h.started[0]?.key).toBe("consent-s1");
    const { url } = await h.runFlow();
    expect(url.searchParams.get("scope")).toBe(`openid email ${SCOPE.gmailReadonly} ${SCOPE.calendarReadonly}`);
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("login_hint")).toBe("a@x.com");
    expect(url.searchParams.has("include_granted_scopes")).toBe(false);
    const acct = await h.store.get("s1");
    expect(acct?.products).toEqual({ gmail: { level: "readonly" }, calendar: { level: "read" } });
    expect(acct?.grant.scopes).toEqual([...gmailScopes, ...cal]);
    expect(acct?.grant.clientId).toBe(LOCAL.clientId);
  });

  it("a reply that drops a scope the account relied on changes NOTHING (narrower reply)", async () => {
    const h = await accepted(makeHarness({ initial: acctWith(), google: { scope: cal } })); // gmail untick
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    const before = JSON.stringify(await h.store.get("s1"));
    await expect(h.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
    expect(JSON.stringify(await h.store.get("s1"))).toBe(before);
  });

  it("the new level not granted: the grant is updated, the previous level stays, scope_missing is reported", async () => {
    const h = await accepted(makeHarness({ initial: acctWith(), google: { scope: gmailScopes } })); // calendar unticked
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    await expect(h.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
    const acct = await h.store.get("s1");
    expect(acct?.products).toEqual({ gmail: { level: "readonly" } });
    expect(acct?.missing).toEqual(["calendar"]);
    expect(acct?.grant.refresh).toBe("REFRESH-new");
  });

  it("a different Google account in the consent window → account_mismatch; nothing changes (A5)", async () => {
    const h = await accepted(makeHarness({ initial: acctWith(), google: { scope: [...gmailScopes, ...cal], sub: "OTHER", email: "o@x.com" } }));
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    const before = JSON.stringify(await h.store.get("s1"));
    await expect(h.runFlow()).rejects.toMatchObject({ code: "account_mismatch" });
    expect(JSON.stringify(await h.store.get("s1"))).toBe(before);
    expect(await h.store.get("OTHER")).toBeUndefined();
  });

  it("lowering a level or turning a product off never re-consents, even for a signed-out grant", async () => {
    const h = await accepted(makeHarness({ initial: acctWith({ scopes: [SCOPE.gmailModify, ...cal], status: "reauth_required", products: { gmail: { level: "send" }, calendar: { level: "read" } } }) }));
    const r = await h.connect.changeProducts("s1", { gmail: { level: "readonly" }, calendar: null }, "local");
    expect(r).toMatchObject({ ok: true, applied: true });
    expect(h.started).toHaveLength(0);
    expect((await h.store.get("s1"))?.products).toEqual({ gmail: { level: "readonly" } });
  });

  it("raising a level on a reauth_required grant goes through consent even when the scopes would cover it", async () => {
    const h = await accepted(makeHarness({ initial: acctWith({ scopes: [SCOPE.gmailModify], status: "reauth_required" }) }));
    expect(await h.connect.changeProducts("s1", { gmail: { level: "send" } }, "local")).toMatchObject({ ok: true, flowId: "flow-1" });
  });

  it("Gmail filters survive a level raise: options are carried over when the request omits them", async () => {
    const h = await accepted(
      makeHarness({
        initial: acctWith({ scopes: [SCOPE.gmailReadonly, SCOPE.gmailSettingsBasic], products: { gmail: { level: "readonly", options: { filters: true } } } }),
        google: { scope: [SCOPE.gmailModify, SCOPE.gmailSettingsBasic] },
      }),
    );
    await h.connect.changeProducts("s1", { gmail: { level: "send" } }, "local");
    const { url } = await h.runFlow();
    expect(url.searchParams.get("scope")).toContain(SCOPE.gmailSettingsBasic);
    expect((await h.store.get("s1"))?.products.gmail).toEqual({ level: "send", options: { filters: true } });
  });

  it("two consents for the same account → 409 consent_in_progress; released once the first ends (A15)", async () => {
    const h = await accepted(makeHarness({ initial: acctWith(), google: { scope: [...gmailScopes, ...cal] } }));
    expect(await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local")).toMatchObject({ ok: true });
    expect(await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local")).toMatchObject({ status: 409, error: "consent_in_progress" });
    expect(await h.connect.signInAgain("s1", "local")).toMatchObject({ status: 409, error: "consent_in_progress" });
    await h.runFlow();
    expect(await h.connect.changeProducts("s1", { tasks: { level: "read" } }, "local")).toMatchObject({ ok: true });
  });

  it("a failed consent releases the account too", async () => {
    const h = await accepted(makeHarness({ initial: acctWith(), google: { scope: [] } }));
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    await expect(h.runFlow()).rejects.toBeTruthy();
    expect(await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local")).toMatchObject({ ok: true });
  });

  it("unknown account → 404; bad bodies → 400", async () => {
    const h = await accepted(makeHarness({ initial: acctWith() }));
    expect(await h.connect.changeProducts("nope", { calendar: { level: "read" } }, "local")).toMatchObject({ status: 404, error: "not_found" });
    expect(await h.connect.changeProducts("s1", { photos: null }, "local")).toMatchObject({ status: 400, error: "bad_request" });
    expect(await h.connect.changeProducts("s1", { calendar: { level: "root" } }, "local")).toMatchObject({ status: 400, error: "bad_request" });
    expect(await h.connect.changeProducts("s1", {}, "local")).toMatchObject({ status: 400, error: "no_products" });
    expect(await h.connect.signInAgain("nope", "local")).toMatchObject({ status: 404 });
  });

  it("full Drive on a built-in account is refused server-side (A2)", async () => {
    const h = await accepted(makeHarness({ initial: acctWith() }));
    expect(await h.connect.changeProducts("s1", { drive: { level: "write" } }, "local")).toMatchObject({ status: 400, error: "own_client_required" });
  });

  it("consent on a LOCAL built-in account needs the local browser (11.116); builtin-remote works from any browser", async () => {
    const h = await accepted(makeHarness({ initial: { ...acctWith(), [acctKey("s2")]: account("s2", "b@x.com", { client: "builtin-remote", clientId: REMOTE.clientId, scopes: cal, products: { calendar: { level: "read" } } }) as never } }));
    expect(await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "remote")).toMatchObject({ status: 409, error: "local_browser_required" });
    expect(await h.connect.signInAgain("s2", "remote")).toMatchObject({ ok: true, path: "return" });
    expect(await h.connect.signInAgain("s2", "local")).toMatchObject({ ok: false, error: "consent_in_progress" });
  });

  it("consent uses the account's OWN client, never a domain-linked or built-in one", async () => {
    const h = makeHarness({
      initial: {
        [clientKey("bb")]: ownClient("bb", "BB", OWN_BB, { domains: ["x.com"] }) as never,
        [clientKey("semmi")]: ownClient("semmi", "Semmi", OWN_SEMMI) as never,
        [acctKey("s1")]: account("s1", "a@x.com", { client: "own:semmi", clientId: OWN_SEMMI.clientId, scopes: gmailScopes }) as never,
      },
      google: { scope: [...gmailScopes, ...cal] },
    });
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    const { url } = await h.runFlow();
    expect(url.searchParams.get("client_id")).toBe(OWN_SEMMI.clientId);
  });
});

describe("return paths (D12b/D12c; B10–B23)", () => {
  it("built-in remote: redirect to the return page, state = flow id + origin only, delivered once (B19, B23)", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    const r = await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    expect(r).toMatchObject({ ok: true, path: "return", client: "builtin-remote" });
    const { url } = await h.runFlow();
    expect(url.searchParams.get("client_id")).toBe(REMOTE.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(RETURN_PAGE_URL);
    const state = url.searchParams.get("state") as string;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}~https:\/\/dash\.example\.com$/);
    for (const secret of [url.searchParams.get("nonce"), url.searchParams.get("code_challenge"), "a@x.com"]) expect(state).not.toContain(secret as string);
    expect(h.connect.deliver(state, { code: "CODE" })).toMatchObject({ ok: false, error: "invalid_state" }); // already consumed
    expect(await h.store.list()).toHaveLength(1);
    expect(h.google.calls.filter((c) => c.grant === "authorization_code")).toHaveLength(1);
    expect((await h.store.get("s1"))?.client).toBe("builtin-remote");
    expect(h.logger.lines).toContain("[google] signin client=builtin-remote path=return products=calendar result=ok");
  });

  it("an origin the return page would refuse (plain http on a LAN address) → 409 remote_origin_unsupported", async () => {
    const h = await accepted(makeHarness({ base: "http://192.168.1.5:8000" }));
    expect(await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" })).toMatchObject({ status: 409, error: "remote_origin_unsupported" });
    expect(h.started).toHaveLength(0);
  });

  it("an unknown dashboard address → 409 dashboard_address_unknown", async () => {
    const h = await accepted(makeHarness({ base: undefined }));
    expect(await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" })).toMatchObject({ status: 409, error: "dashboard_address_unknown" });
  });

  it("own Web client: Google returns straight to the dashboard callback; no disclosure gate; code delivered once (D12c)", async () => {
    const h = makeHarness({
      initial: { [clientKey("bb")]: ownClient("bb", "BB", OWN_BB, { type: "web" }) as never },
      google: { scope: cal },
      base: "https://pi.blackbelt.hu/",
    });
    const r = await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "remote" });
    expect(r).toMatchObject({ ok: true, path: "web" });
    const { url } = await h.runFlow();
    expect(url.searchParams.get("redirect_uri")).toBe("https://pi.blackbelt.hu/api/plugins/google/oauth/callback");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await h.store.get("s1"))?.client).toBe("own:bb");
  });

  it("a delivered Google error ends the flow with that fixed code (B9)", async () => {
    const h = makeHarness({ initial: { [clientKey("bb")]: ownClient("bb", "BB", OWN_BB, { type: "web" }) as never } });
    await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "remote" });
    const s = h.started[0]!;
    const events: Array<{ type: string; url?: string }> = [];
    const login = s.loginFlow.login({ signal: new AbortController().signal, prompt: () => new Promise(() => {}), notify: (e) => events.push(e as never) });
    login.catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    const state = new URL(events[0]?.url as string).searchParams.get("state") as string;
    expect(h.connect.deliver(state, { error: "access_denied" }).ok).toBe(true);
    await expect(login).rejects.toMatchObject({ code: "access_denied" });
    expect(h.logger.warns.at(-1)).toBe("[google] signin client=own:bb path=web products=calendar result=access_denied");
  });

  it("a forged or unknown state is refused with no effect (B34)", async () => {
    const h = await accepted(makeHarness());
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    expect(h.connect.deliver("forged", { code: "C" })).toMatchObject({ ok: false, status: 400, error: "invalid_state" });
    expect(h.connect.deliver(undefined, { code: "C" })).toMatchObject({ ok: false, error: "invalid_state" });
    expect(await h.store.list()).toEqual([]);
  });
});

describe("pasted redirects (E9)", () => {
  it("a pasted URL with the right state completes the flow; a wrong state fails with a fixed code that never echoes the input", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await h.runFlow(0, { deliver: "paste" });
    expect(await h.store.list()).toHaveLength(1);

    const h2 = await accepted(makeHarness());
    await h2.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    const events: Array<{ url?: string }> = [];
    let resolvePaste!: (v: string) => void;
    const login = h2.started[0]!.loginFlow.login({
      signal: new AbortController().signal,
      prompt: () => new Promise<string>((r) => { resolvePaste = r; }),
      notify: (e) => events.push(e as never),
    });
    login.catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    resolvePaste("http://127.0.0.1:5555/?code=SECRETCODE&state=WRONG");
    const failure = await login.then(() => null, (e: Error & { code: string }) => e);
    expect(failure).toMatchObject({ code: "state_mismatch" });
    expect(String(failure?.message)).not.toContain("SECRETCODE");
  });
});

describe("disconnect (D3; B68–B74)", () => {
  const init = { [acctKey("s1")]: account("s1", "a@x.com") as never };
  it("deletes locally by default and never calls Google", async () => {
    const h = makeHarness({ initial: init });
    expect(await h.connect.disconnect("s1", { revoke: false })).toEqual({ ok: true, removed: true, remoteRevoked: null });
    expect(await h.store.list()).toEqual([]);
    expect(h.google.revokes).toEqual([]);
  });
  it("the explicit option also revokes at Google; a Google outage still removes locally", async () => {
    const h = makeHarness({ initial: init });
    expect(await h.connect.disconnect("s1", { revoke: true })).toMatchObject({ removed: true, remoteRevoked: true });
    expect(h.google.revokes).toEqual(["REFRESH-s1"]);
    const down = makeHarness({ initial: init, google: { revokeStatus: 503 } });
    expect(await down.connect.disconnect("s1", { revoke: true })).toMatchObject({ ok: true, removed: true, remoteRevoked: false });
    expect(await down.store.list()).toEqual([]);
    expect(down.logger.lines).toEqual(["[google] disconnect client=builtin revoke=failed"]);
  });
  it("an unknown account → 404 not_found", async () => {
    const h = makeHarness();
    expect(await h.connect.disconnect("ghost", { revoke: false })).toMatchObject({ status: 404, error: "not_found" });
  });
  it("a disconnected account stays disconnected: a later lease cannot find it (11.120)", async () => {
    const h = makeHarness({ initial: init });
    await h.connect.disconnect("s1", { revoke: false });
    await expect(h.store.resolve("a@x.com")).rejects.toMatchObject({ code: "not_found" });
  });
  it("logs the client ref and revoke outcome — no email, no token", async () => {
    const h = makeHarness({ initial: init });
    await h.connect.disconnect("s1", { revoke: true });
    expect(h.logger.lines).toEqual(["[google] disconnect client=builtin revoke=ok"]);
  });
});

describe("secrets never logged (B80–B83)", () => {
  it("a full sign-in + consent + failure leaves no token, code, secret or email in any log line", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal, email: "private@x.com" } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await h.runFlow();
    h.reply.scope = [];
    await h.connect.changeProducts("s1", { tasks: { level: "read" } }, "local");
    await h.runFlow().catch(() => {});
    const logs = h.logger.lines.join("\n");
    for (const forbidden of ["ACCESS-new", "REFRESH-new", "CODE", LOCAL.clientSecret, "private@x.com"]) expect(logs).not.toContain(forbidden);
    expect(logs).toMatch(/\[google\] signin client=builtin path=local products=calendar result=ok/);
  });
});

void OWN_SEMMI;
