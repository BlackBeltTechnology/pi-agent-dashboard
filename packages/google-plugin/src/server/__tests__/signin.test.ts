/**
 * Sign-in security and shape through the real login flow against a fake Google (test-plan A53, A58, A68, A69,
 * A75–A78, B10–B13, B17–B20, B23, B38, B40, B46; ports gmail E10 `POST /accounts {email}` → `login_hint`).
 * See change: add-google-connect.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { account, LOCAL, makeHarness, OWN_BB, ownClient, REMOTE } from "../../__tests__/fakes.js";
import { RETURN_PAGE_URL } from "../../shared/default-clients.js";
import { knownFlowCode } from "../../shared/flow-codes.js";
import { SCOPE } from "../../shared/products.js";
import { acctKey, clientKey } from "../store.js";

const cal = [SCOPE.calendarReadonly];
const gmail = [SCOPE.gmailReadonly];
const hit = (h: ReturnType<typeof makeHarness>, grant: string) => h.google.calls.filter((c) => c.grant === grant);

async function accepted(h: ReturnType<typeof makeHarness>) {
  await h.connect.acceptDisclosure();
  return h;
}

const okFlow = (r: unknown) => expect(r).toMatchObject({ ok: true });

describe("A53 — no email known: Google's chooser selects the account", () => {
  it("built-in, no own client, no email → no login_hint and the account chooser is in the prompt", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    okFlow(await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" }));
    const { url } = await h.runFlow();
    expect(url.searchParams.has("login_hint")).toBe(false);
    expect(url.searchParams.get("prompt")).toBe("select_account consent");
  });
});

describe("E10 (ported from the gmail plugin) — an email in the connect request becomes login_hint", () => {
  it("a valid email is sent as login_hint (URL-encoded) and still starts an ADD flow", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    okFlow(await h.connect.startConnect({ products: { calendar: "read" }, email: "robson@semmi.se", browser: "local" }));
    const { url } = await h.runFlow();
    expect(url.searchParams.get("login_hint")).toBe("robson@semmi.se");
    expect(url.search).toContain("login_hint=robson%40semmi.se");
    expect(h.started[0]?.key).toMatch(/^add-/);
  });
  it("the email is normalized (trim + lower-case) before it is sent", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    await h.connect.startConnect({ products: { calendar: "read" }, email: "  Robson@Semmi.SE ", browser: "local" });
    expect((await h.runFlow()).url.searchParams.get("login_hint")).toBe("robson@semmi.se");
  });
  it.each([[undefined], [""], [null]])("no email (%s) → no login_hint", async (email) => {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    okFlow(await h.connect.startConnect({ products: { calendar: "read" }, email, browser: "local" }));
    expect((await h.runFlow()).url.searchParams.has("login_hint")).toBe(false);
  });
  it.each([
    ["not an email", "not-an-email"],
    ["255 characters", `${"a".repeat(243)}@example.com`],
    ["not a string", 42],
  ])("%s → 400 invalid_email and no sign-in starts", async (_n, email) => {
    const h = await accepted(makeHarness());
    if (typeof email === "string" && email.endsWith("@example.com")) expect(email).toHaveLength(255);
    expect(await h.connect.startConnect({ products: { calendar: "read" }, email, browser: "local" })).toMatchObject({ ok: false, status: 400, error: "invalid_email" });
    expect(h.started).toHaveLength(0);
  });
  it("a 254-character address is accepted", async () => {
    const h = await accepted(makeHarness());
    const email = `${"a".repeat(242)}@example.com`;
    expect(email).toHaveLength(254);
    okFlow(await h.connect.startConnect({ products: { calendar: "read" }, email, browser: "local" }));
    expect(h.started).toHaveLength(1);
  });
});

describe("A58 — Google fails the code exchange: error code, no partial account, flow consumed", () => {
  const web = () => makeHarness({ initial: { [clientKey("w")]: ownClient("w", "Web", OWN_BB, { type: "web" }) as never } });

  it.each([
    ["5xx", () => ({ status: 503, body: { error: "backend_error" } }), (c: unknown) => expect(knownFlowCode(c)).not.toBeNull()],
    ["invalid_grant", () => ({ status: 400, body: { error: "invalid_grant" } }), (c: unknown) => expect(c).toBe("invalid_grant")],
  ])("%s → a fixed error code; nothing stored; the same state cannot be replayed", async (_n, token, codeIs) => {
    const h = web();
    h.reply.token = token;
    okFlow(await h.connect.startConnect({ products: { calendar: "read" }, client: "own:w", browser: "remote" }));
    const err = await h.runFlow().then(
      () => null,
      (e: { code?: unknown }) => e,
    );
    expect(err).not.toBeNull();
    codeIs(err?.code);
    expect(await h.store.list()).toEqual([]);
    const state = h.lastAuthUrl?.searchParams.get("state") as string;
    expect(h.connect.deliver(state, { code: "CODE" })).toMatchObject({ ok: false, error: "invalid_state" });
    expect(hit(h, "authorization_code")).toHaveLength(1);
  });

  it("a token endpoint that never answers: aborting the sign-in rejects it, nothing is stored", async () => {
    const h = web();
    h.reply.token = () => new Promise(() => {});
    okFlow(await h.connect.startConnect({ products: { calendar: "read" }, client: "own:w", browser: "remote" }));
    await expect(h.runFlow(undefined, { abortAfterMs: 20 })).rejects.toBeTruthy();
    expect(await h.store.list()).toEqual([]);
    expect(h.connect.deliver(h.lastAuthUrl?.searchParams.get("state") as string, { code: "CODE" })).toMatchObject({ ok: false, error: "invalid_state" });
  });
});

describe("A68 — an account is matched by Google's subject, not its email", () => {
  it("same sub, renamed address → one record, email updated from the id token (A12)", async () => {
    const h = await accepted(
      makeHarness({ initial: { [acctKey("S1")]: account("S1", "old@x.com", { scopes: cal, products: { calendar: { level: "read" } }, alias: "work" }) as never }, google: { sub: "S1", email: "new@x.com", scope: cal } }),
    );
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await h.runFlow();
    expect(await h.store.list()).toHaveLength(1);
    expect(await h.store.get("S1")).toMatchObject({ email: "new@x.com", alias: "work" });
  });
  it("same email, different sub → a second, distinct record", async () => {
    const h = await accepted(makeHarness({ initial: { [acctKey("S1")]: account("S1", "a@x.com", { scopes: cal, products: { calendar: { level: "read" } } }) as never }, google: { sub: "S2", email: "a@x.com", scope: cal } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await h.runFlow();
    expect((await h.store.list()).map((a) => a.sub).sort()).toEqual(["S1", "S2"]);
  });
});

describe("A69 / B13 — the subject must be verified", () => {
  it.each([
    ["email_verified=false", { email_verified: false }],
    ["email_verified as the string 'false'", { email_verified: "false" }],
    ["email_verified claim absent", { email_verified: undefined }],
  ])("%s → email_unverified, nothing stored", async (_n, claims) => {
    const h = await accepted(makeHarness({ google: { scope: cal, claims } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await expect(h.runFlow()).rejects.toMatchObject({ code: "email_unverified" });
    expect(h.creds.data.size).toBe(1); // the disclosure record only
    expect(await h.store.list()).toEqual([]);
  });
  it("email_verified=true is the only value that stores an account (B13)", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal, claims: { email_verified: true } } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await h.runFlow();
    expect(await h.store.list()).toHaveLength(1);
  });
  it("an id_token without `sub` → id_token_invalid, nothing stored", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal, claims: { sub: undefined } } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await expect(h.runFlow()).rejects.toMatchObject({ code: "id_token_invalid" });
    expect(await h.store.list()).toEqual([]);
  });
});

describe("A75–A78 — accounts do not switch clients silently", () => {
  const bbAccount = (client = "own:bb", clientId = OWN_BB.clientId) => ({
    [acctKey("s1")]: account("s1", "a@x.com", { client, clientId, scopes: gmail, products: { gmail: { level: "readonly" } } }) as never,
    [clientKey("bb")]: ownClient("bb", "BlackBelt") as never,
  });

  it("A75: consent on an own `installed` account from a remote browser starts on BlackBelt's client with the email as login_hint — never on the built-in", async () => {
    const h = await accepted(makeHarness({ initial: bbAccount() }));
    okFlow(await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "remote"));
    const { url } = await h.runFlow(0, { deliver: "paste" }).catch(() => ({ url: h.lastAuthUrl as URL }));
    expect(url.searchParams.get("client_id")).toBe(OWN_BB.clientId);
    expect(url.searchParams.get("login_hint")).toBe("a@x.com");
    expect(url.searchParams.get("client_id")).not.toBe(LOCAL.clientId);
  });

  it("A76: a built-in (local) account asked for consent from a remote browser → refused, no flow created", async () => {
    const h = await accepted(makeHarness({ initial: { [acctKey("s1")]: account("s1", "a@x.com", { scopes: gmail, products: { gmail: { level: "readonly" } } }) as never } }));
    const r = await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "remote");
    expect(r).toMatchObject({ ok: false, status: 409, error: "local_browser_required" });
    expect(h.started).toHaveLength(0);
  });

  it("A77: a builtin-remote account's consent goes through the remote project's Web client + return page from BOTH browsers", async () => {
    const initial = { [acctKey("s1")]: account("s1", "a@x.com", { client: "builtin-remote", clientId: REMOTE.clientId, scopes: cal, products: { calendar: { level: "read" } } }) as never };
    for (const browser of ["local", "remote"] as const) {
      const h = await accepted(makeHarness({ initial, google: { scope: [...cal, SCOPE.tasksReadonly] } }));
      okFlow(await h.connect.changeProducts("s1", { tasks: { level: "read" } }, browser));
      const { url } = await h.runFlow();
      expect(url.searchParams.get("client_id"), browser).toBe(REMOTE.clientId);
      expect(url.searchParams.get("redirect_uri"), browser).toBe(RETURN_PAGE_URL);
    }
  });

  it("A78: after a disconnect the same Google account can connect through another client as a NEW account", async () => {
    const h = makeHarness({ initial: bbAccount(), google: { scope: gmail, sub: "s1", email: "a@x.com" } });
    await h.connect.disconnect("s1", { revoke: false });
    await h.connect.acceptDisclosure();
    okFlow(await h.connect.startConnect({ products: { gmail: "readonly" }, browser: "local" }));
    await h.runFlow();
    expect(await h.store.get("s1")).toMatchObject({ client: "builtin", grant: { clientId: LOCAL.clientId } });
  });
});

describe("B10 — PKCE, state and nonce on every path; the verifier never leaves the dashboard", () => {
  const paths: Array<[string, () => ReturnType<typeof makeHarness>, Record<string, unknown>]> = [
    ["local", () => makeHarness({ google: { scope: cal } }), { browser: "local" }],
    ["return", () => makeHarness({ google: { scope: cal } }), { browser: "remote" }],
    ["web", () => makeHarness({ initial: { [clientKey("w")]: ownClient("w", "W", OWN_BB, { type: "web" }) as never }, google: { scope: cal } }), { browser: "remote", client: "own:w" }],
    ["paste", () => makeHarness({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never }, google: { scope: cal } }), { browser: "remote", client: "own:bb" }],
  ];
  it.each(paths)("%s path: S256 challenge, state, nonce; the verifier is only in the token request", async (path, mk, input) => {
    const h = mk();
    await h.connect.acceptDisclosure();
    expect(await h.connect.startConnect({ products: { calendar: "read" }, ...input } as never)).toMatchObject({ ok: true, path });
    const { url } = await h.runFlow();
    const q = url.searchParams;
    expect(q.get("code_challenge_method")).toBe("S256");
    for (const k of ["code_challenge", "state", "nonce"]) expect(q.get(k), k).toBeTruthy();
    expect(q.has("code_verifier")).toBe(false);
    const verifier = hit(h, "authorization_code")[0]?.body.get("code_verifier") as string;
    expect(verifier).toBeTruthy();
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(q.get("code_challenge"));
    expect(url.toString()).not.toContain(verifier);
  });
  it("two flows get different nonce and challenge (and, on a callback path, state)", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    const seen: URL[] = [];
    for (let i = 0; i < 2; i++) {
      await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
      seen.push((await h.runFlow()).url);
    }
    for (const k of ["state", "nonce", "code_challenge"]) expect(seen[0]?.searchParams.get(k), k).not.toBe(seen[1]?.searchParams.get(k));
  });
});

describe("B11 — a callback is accepted only for the state of a pending flow", () => {
  async function pendingReturnFlow() {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    return h;
  }
  it("another flow's state / absent state / a replay → refused; no account, no token request", async () => {
    const h = await pendingReturnFlow();
    expect(h.connect.deliver("another-flow-state", { code: "C" })).toMatchObject({ ok: false, error: "invalid_state" });
    expect(h.connect.deliver(undefined, { code: "C" })).toMatchObject({ ok: false, error: "invalid_state" });
    expect(await h.store.list()).toEqual([]);
    expect(hit(h, "authorization_code")).toHaveLength(0);
    await h.runFlow();
    const used = h.lastAuthUrl?.searchParams.get("state") as string;
    const before = hit(h, "authorization_code").length;
    expect(h.connect.deliver(used, { code: "C" })).toMatchObject({ ok: false, error: "invalid_state" });
    expect(hit(h, "authorization_code")).toHaveLength(before);
    expect(await h.store.list()).toHaveLength(1);
  });
});

describe("B12 — the id_token nonce must be the flow's nonce", () => {
  it("a different nonce → the sign-in fails and nothing is stored", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal, claims: { nonce: "someone-elses-nonce" } } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await expect(h.runFlow()).rejects.toMatchObject({ code: "id_token_invalid" });
    expect(await h.store.list()).toEqual([]);
  });
});

describe("B17 — a pasted redirect is refused with a fixed code that never echoes it; nothing is stored", () => {
  const cases: Array<[string, (state: string) => string, string]> = [
    ["not a URL", () => "definitely not a url SECRET-paste", "invalid_redirect"],
    ["a URL without a code", (s) => `http://127.0.0.1:5555/?state=${s}`, "invalid_redirect"],
    ["a URL with a code but another flow's state", () => "http://127.0.0.1:5555/?code=CODE&state=other-flow", "state_mismatch"],
    ["error=access_denied", (s) => `http://127.0.0.1:5555/?error=access_denied&state=${s}`, "access_denied"],
  ];
  it.each(cases)("%s → %s", async (_n, text, code) => {
    const h = makeHarness({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never }, google: { scope: cal } });
    await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "remote" });
    const err = await h.runFlow(0, { deliver: "paste", pasteText: text }).then(
      () => null,
      (e: Error & { code?: string }) => e,
    );
    expect(err?.code).toBe(code);
    expect(String(err?.message)).not.toContain("SECRET-paste");
    expect(await h.store.list()).toEqual([]);
    expect(hit(h, "authorization_code")).toHaveLength(0);
  });
});

describe("B18 / B19 — remote built-in sign-in through the return page", () => {
  it("B18: redirect_uri is the return page, prompt=consent, the REMOTE client id, PKCE S256", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    const q = (await h.runFlow()).url.searchParams;
    expect(q.get("redirect_uri")).toBe(RETURN_PAGE_URL);
    expect(RETURN_PAGE_URL).toMatch(/^https:\/\/pi-dashboard\.dev\/oauth\/return/);
    expect(q.get("prompt")).toMatch(/\bconsent\b/);
    expect(q.get("client_id")).toBe(REMOTE.clientId);
    expect(q.get("client_id")).not.toBe(LOCAL.clientId);
    expect(q.get("code_challenge_method")).toBe("S256");
  });
  it("B19: the state carries only the flow id and the dashboard origin — no verifier, nonce, token or email", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal, email: "someone@x.com" } }));
    await h.connect.startConnect({ products: { calendar: "read" }, email: "someone@x.com", browser: "remote" });
    const { url } = await h.runFlow();
    const state = url.searchParams.get("state") as string;
    const [flow, origin, ...rest] = state.split("~");
    expect(rest).toEqual([]);
    expect(origin).toBe("https://dash.example.com");
    expect(flow).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const verifier = hit(h, "authorization_code")[0]?.body.get("code_verifier") as string;
    for (const secret of [verifier, url.searchParams.get("nonce"), "someone", "ACCESS", "REFRESH"]) expect(state).not.toContain(secret as string);
  });
});

describe("B20 — built-in availability matrix (browser × shipped remote × PI_GOOGLE_REMOTE_RETURN × PI_GOOGLE_DEFAULT_CLIENTS)", () => {
  type Cell = { browser: "local" | "remote"; shipped: boolean; remoteReturn: boolean; defaults: boolean };
  const cells: Cell[] = [];
  for (const browser of ["local", "remote"] as const)
    for (const shipped of [true, false])
      for (const remoteReturn of [true, false]) for (const defaults of [true, false]) cells.push({ browser, shipped, remoteReturn, defaults });

  it.each(cells)("%j", async (c) => {
    const h = makeHarness({ builtIn: { local: LOCAL, remote: c.shipped ? REMOTE : null }, switches: { remoteReturn: c.remoteReturn, defaultClients: c.defaults } });
    await h.connect.acceptDisclosure();
    const r = await h.connect.startConnect({ products: { calendar: "read" }, browser: c.browser });
    const viaReturn = c.browser === "remote" && c.shipped && c.remoteReturn && c.defaults;
    const viaLocal = c.browser === "local" && c.defaults;
    if (viaReturn) expect(r).toMatchObject({ ok: true, path: "return", client: "builtin-remote" });
    else if (viaLocal) expect(r).toMatchObject({ ok: true, client: "builtin" });
    else expect(r).toMatchObject({ ok: false, error: "client_required" });
  });
});

describe("B23 — a completed flow's code cannot be delivered twice", () => {
  it("the second delivery is refused; one account write, one token exchange", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    await h.runFlow();
    const state = h.lastAuthUrl?.searchParams.get("state") as string;
    expect(h.connect.deliver(state, { code: "CODE" })).toMatchObject({ ok: false, error: "invalid_state" });
    expect(await h.store.list()).toHaveLength(1);
    expect(hit(h, "authorization_code")).toHaveLength(1);
  });
});

describe("B38 — the return page carries no restricted access", () => {
  const refusal = (r: unknown) => expect(r).toMatchObject({ ok: false, status: 400 });
  it("gmail only → restricted_scope_remote; no flow started", async () => {
    const h = await accepted(makeHarness());
    const r = await h.connect.startConnect({ products: { gmail: "readonly" }, browser: "remote" });
    refusal(r);
    expect(r).toMatchObject({ error: "restricted_scope_remote" });
    expect(h.started).toHaveLength(0);
  });
  it.each(["read", "write"])("drive %s on the built-in app → refused (full Drive is own-client only)", async (level) => {
    const h = await accepted(makeHarness());
    refusal(await h.connect.startConnect({ products: { drive: level }, browser: "remote" }));
    expect(h.started).toHaveLength(0);
  });
  it("the allowed set asks for no gmail.*, drive or drive.readonly scope", async () => {
    const h = await accepted(makeHarness({ google: { scope: [] } }));
    const r = await h.connect.startConnect({
      products: { calendar: "read", drive: "files", docs: "read", sheets: "read", slides: "read", tasks: "read", contacts: "read" },
      browser: "remote",
    });
    okFlow(r);
    const scopes = ((await h.runFlow().catch(() => ({ url: h.lastAuthUrl as URL }))).url.searchParams.get("scope") ?? "").split(" ");
    expect(scopes.filter((s) => /gmail\.|\/drive$|drive\.readonly/.test(s))).toEqual([]);
    expect(scopes).toContain(SCOPE.driveFile);
  });
  it("a mixed request that contains Gmail is refused as a whole", async () => {
    const h = await accepted(makeHarness());
    refusal(await h.connect.startConnect({ products: { calendar: "read", gmail: "readonly" }, browser: "remote" }));
    expect(h.started).toHaveLength(0);
  });
});

describe("B40 — a builtin-remote account cannot add restricted products from any browser", () => {
  const remoteAcct = () => ({
    [acctKey("s1")]: account("s1", "a@x.com", { client: "builtin-remote", clientId: REMOTE.clientId, scopes: cal, products: { calendar: { level: "read" } } }) as never,
  });
  it.each(["local", "remote"] as const)("gmail / drive read from the %s browser → refused, no Google consent", async (browser) => {
    const h = await accepted(makeHarness({ initial: remoteAcct() }));
    expect(await h.connect.changeProducts("s1", { gmail: { level: "readonly" } }, browser)).toMatchObject({ ok: false, status: 400 });
    expect(await h.connect.changeProducts("s1", { drive: { level: "read" } }, browser)).toMatchObject({ ok: false, status: 400 });
    expect(h.started).toHaveLength(0);
  });
  it("an allowed product still works through consent", async () => {
    const h = await accepted(makeHarness({ initial: remoteAcct(), google: { scope: [...cal, SCOPE.tasksReadonly] } }));
    okFlow(await h.connect.changeProducts("s1", { tasks: { level: "read" } }, "remote"));
    await h.runFlow();
    expect((await h.store.get("s1"))?.products).toMatchObject({ calendar: { level: "read" }, tasks: { level: "read" } });
  });
});

describe("B46 — own Web client, remote browser: the callback route completes the flow, no paste, no pi-dashboard.dev", () => {
  it("account stored; the client secret goes only to the (fake) token endpoint", async () => {
    const h = makeHarness({ initial: { [clientKey("w")]: ownClient("w", "W", OWN_BB, { type: "web" }) as never }, google: { scope: cal } });
    expect(await h.connect.startConnect({ products: { calendar: "read" }, client: "own:w", browser: "remote" })).toMatchObject({ ok: true, path: "web" });
    const { url } = await h.runFlow();
    expect(url.searchParams.get("redirect_uri")).toBe("https://dash.example.com/api/plugins/google/oauth/callback");
    expect(url.toString()).not.toContain("pi-dashboard.dev");
    expect(url.toString()).not.toContain(OWN_BB.clientSecret);
    expect(await h.store.list()).toHaveLength(1);
    const exchange = hit(h, "authorization_code");
    expect(exchange).toHaveLength(1);
    expect(exchange[0]?.body.get("client_secret")).toBe(OWN_BB.clientSecret);
    expect(h.google.calls.every((c) => c.grant === "authorization_code")).toBe(true);
  });
});
