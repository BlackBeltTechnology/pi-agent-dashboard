import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureDashboard, resetAppConfig } from "../config.js";
import {
  getAccessToken,
  type IdentityMode,
  notifySessionRefused,
  onSessionRefused,
  resetIdentityState,
  setAccessToken,
  setActingOperator,
  setIdentityMode,
} from "../identity-state.js";
import {
  appendWsTicket,
  authedFetch,
  mintWsTicket,
  NoCredentialError,
  NotAdmittedError,
  setTicketMinterForTests,
  ticketSocketUrl,
} from "../transport.js";

// Ported from InvoiceBot `src/__tests__/auth-transport.test.ts`, extended with
// identity modes, origin-bound credentials and `credentials:"omit"`
// (change: extract-standalone-app-kit, design D2/D4/D5).

const DASH = "https://dash.example.com";

type FetchSpy = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
function stubFetch(status = 200, body: unknown = {}): FetchSpy {
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}
const sentHeaders = (spy: FetchSpy, i = 0) => new Headers(spy.mock.calls[i]?.[1]?.headers);

beforeEach(() => {
  resetIdentityState();
  resetAppConfig();
  setTicketMinterForTests(null);
  configureDashboard({ dashboardUrl: DASH });
});
afterEach(() => {
  resetIdentityState();
  resetAppConfig();
  setTicketMinterForTests(null);
  vi.unstubAllGlobals();
});

describe("authedFetch — E7 mode × token × explicit header", () => {
  it("(oidc, t1) attaches Bearer t1 to a dashboard path", async () => {
    setIdentityMode("oidc");
    setAccessToken("t1");
    const spy = stubFetch();
    await authedFetch("/api/x", { method: "POST" });
    expect(String(spy.mock.calls[0]?.[0])).toBe(`${DASH}/api/x`);
    expect(sentHeaders(spy).get("Authorization")).toBe("Bearer t1");
  });

  it.each<[IdentityMode, string | null]>([
    ["oidc", null],
    ["unknown", "t1"],
    ["unknown", null],
    ["unavailable", "t1"],
    ["unavailable", null],
  ])("(%s, token=%s) throws NoCredentialError and sends nothing", async (mode, token) => {
    setIdentityMode(mode);
    setAccessToken(token);
    const spy = stubFetch();
    await expect(authedFetch("/api/x")).rejects.toBeInstanceOf(NoCredentialError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("(none) sends a plain request without Authorization", async () => {
    setIdentityMode("none");
    const spy = stubFetch();
    await authedFetch("/api/x");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sentHeaders(spy).has("Authorization")).toBe(false);
  });

  it("(oidc, t1, explicit Authorization) keeps the caller's header", async () => {
    setIdentityMode("oidc");
    setAccessToken("t1");
    const spy = stubFetch();
    await authedFetch("/api/x", { headers: { Authorization: "X" } });
    expect(sentHeaders(spy).get("Authorization")).toBe("X");
  });
});

describe("authedFetch — origin-bound credential, cookies, refusal", () => {
  it("E8: never sends the bearer to another origin", async () => {
    setIdentityMode("oidc");
    setAccessToken("t1");
    const spy = stubFetch();
    await authedFetch("https://evil.example/x");
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://evil.example/x");
    expect(sentHeaders(spy).has("Authorization")).toBe(false);
  });

  it("E8: a Request object for another origin carries no bearer either", async () => {
    setIdentityMode("oidc");
    setAccessToken("t1");
    const spy = stubFetch();
    await authedFetch(new Request("https://evil.example/x"));
    expect(sentHeaders(spy).has("Authorization")).toBe(false);
  });

  it.each<IdentityMode>(["oidc", "none"])("E9: (%s) always sets credentials: omit", async (mode) => {
    setIdentityMode(mode);
    setAccessToken("t1");
    const spy = stubFetch();
    await authedFetch("/api/x", { credentials: "include" });
    expect(spy.mock.calls[0]?.[1]?.credentials).toBe("omit");
  });

  it("X3: a 401 to Bearer t1 notifies the session-refused listener once, no retry", async () => {
    setIdentityMode("oidc");
    setAccessToken("t1");
    setActingOperator({ iss: "https://kc/realms/x", sub: "u1" });
    const onRefused = vi.fn();
    const off = onSessionRefused(onRefused);
    const spy = stubFetch(401);
    const res = await authedFetch("/api/x");
    expect(res.status).toBe(401);
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("a 401 from a foreign origin is not a refusal of the dashboard credential", async () => {
    setIdentityMode("oidc");
    setAccessToken("t1");
    const onRefused = vi.fn();
    onSessionRefused(onRefused);
    stubFetch(401);
    await authedFetch("https://other.example/x");
    expect(onRefused).not.toHaveBeenCalled();
  });

  it.each([401, 403])("X2: in none mode a %i surfaces as not_admitted, no sign-in", async (status) => {
    setIdentityMode("none");
    const onRefused = vi.fn();
    onSessionRefused(onRefused);
    const spy = stubFetch(status);
    const err = await authedFetch("/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotAdmittedError);
    expect((err as NotAdmittedError).code).toBe("not_admitted");
    expect((err as NotAdmittedError).status).toBe(status);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("mintWsTicket", () => {
  it("mints a browser-scope ticket at the dashboard with the access token", async () => {
    setIdentityMode("oidc");
    setAccessToken("tok-1");
    const spy = stubFetch(200, { success: true, data: { ticket: "T1" } });
    expect(await mintWsTicket("browser")).toBe("T1");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(`${DASH}/api/ws-ticket`);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok-1");
    expect(JSON.parse(String(init.body))).toEqual({ scope: "browser" });
  });

  it("returns null when there is no credential", async () => {
    setIdentityMode("oidc");
    const spy = stubFetch();
    expect(await mintWsTicket("browser")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null when the mint is refused", async () => {
    setIdentityMode("oidc");
    setAccessToken("t");
    stubFetch(403);
    expect(await mintWsTicket()).toBeNull();
  });
});

describe("ticketSocketUrl — E10 mode × mint result", () => {
  it("(oidc, k1) → <wsBase>/ws?ticket=k1, no token in the URL", () => {
    setIdentityMode("oidc");
    setAccessToken("secret-token");
    setTicketMinterForTests(() => "k1");
    const url = ticketSocketUrl("/ws");
    expect(url).toBe("wss://dash.example.com/ws?ticket=k1");
    expect(String(url)).not.toContain("secret-token");
  });

  it("(oidc, k1) via the real async mint", async () => {
    setIdentityMode("oidc");
    setAccessToken("secret-token");
    stubFetch(200, { success: true, data: { ticket: "k1" } });
    const url = await ticketSocketUrl("/ws");
    expect(url).toBe("wss://dash.example.com/ws?ticket=k1");
    expect(String(url)).not.toContain("secret-token");
  });

  it("(oidc, mint fails) → null", () => {
    setIdentityMode("oidc");
    setAccessToken("t");
    setTicketMinterForTests(() => null);
    expect(ticketSocketUrl("/ws")).toBeNull();
  });

  it("(oidc, no token) → null", () => {
    setIdentityMode("oidc");
    expect(ticketSocketUrl("/ws")).toBeNull();
  });

  it("(none) → plain <wsBase>/ws, no mint", () => {
    setIdentityMode("none");
    const mint = vi.fn(() => "k1");
    setTicketMinterForTests(mint);
    expect(ticketSocketUrl("/ws")).toBe("wss://dash.example.com/ws");
    expect(mint).not.toHaveBeenCalled();
  });

  it.each<IdentityMode>(["unknown", "unavailable"])("(%s) → null", (mode) => {
    setIdentityMode(mode);
    setAccessToken("t");
    setTicketMinterForTests(() => "k1");
    expect(ticketSocketUrl("/ws")).toBeNull();
  });

  it("E11: a foreign-origin socket gets no ticket and the mint is not called", () => {
    setIdentityMode("oidc");
    setAccessToken("t");
    const mint = vi.fn(() => "k1");
    setTicketMinterForTests(mint);
    const spy = stubFetch();
    expect(ticketSocketUrl("wss://other.example.com/ws")).toBe("wss://other.example.com/ws");
    expect(mint).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("appends to an existing query string", () => {
    setIdentityMode("oidc");
    setAccessToken("t");
    setTicketMinterForTests(() => "T2");
    expect(ticketSocketUrl("wss://dash.example.com/ws?x=1")).toBe("wss://dash.example.com/ws?x=1&ticket=T2");
  });

  it("appendWsTicket percent-encodes the ticket", () => {
    expect(appendWsTicket("ws://x/ws", "a b/c")).toBe("ws://x/ws?ticket=a%20b%2Fc");
  });
});

describe("identity-state", () => {
  it("holds the token and resets cleanly", () => {
    expect(getAccessToken()).toBeNull();
    setAccessToken("t");
    expect(getAccessToken()).toBe("t");
    resetIdentityState();
    expect(getAccessToken()).toBeNull();
  });

  it("notifies every refused listener once per signal", () => {
    const a = vi.fn();
    const b = vi.fn();
    onSessionRefused(a);
    onSessionRefused(b);
    notifySessionRefused();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
