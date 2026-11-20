/**
 * Electron loads /auth/local-proof?code=… (T-X16). See change: harden-trust-and-credential-boundaries.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import {
  deriveKey,
  httpPurpose,
  parseProof,
  verifyProofMac,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDefaultSessionPermissions } from "../permissions.js";
import {
  allowedOrigins,
  loadWithLocalProof,
  localApiBase,
  localProofHeaders,
  mainWindowAllowedOrigin,
  mintLocalProofUrl,
  navigateToServer,
  originOf,
  sanitizeNextPath,
} from "../local-proof-bootstrap.js";

const fetchOk = (code: string) =>
  vi.fn(async () => new Response(JSON.stringify({ success: true, data: { code } }), { status: 200 })) as unknown as typeof fetch;

describe("local-proof bootstrap", () => {
  it("X16: loadURL gets the one-time-code URL and a PROOF (never the raw token) is sent", async () => {
    const fetchImpl = fetchOk("C");
    const win = { loadURL: vi.fn(async () => {}) };
    expect(await loadWithLocalProof(win, "http://localhost:8000", { fetchImpl, token: "tok" })).toBe(true);
    // The window keeps loading `localhost`; the API call dials the address literal.
    expect(win.loadURL).toHaveBeenCalledWith("http://localhost:8000/auth/local-proof?code=C");
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/api/local-proof");
    expect(JSON.stringify(init.headers).toLowerCase()).not.toContain("x-pi-local-token");
    const proof = parseProof(init.headers["X-Pi-Local-Proof"])!;
    expect(verifyProofMac(deriveKey("tok"), proof, "127.0.0.1:8000", httpPurpose("POST", "/api/local-proof"))).toBe(true);
  });
  it("E22: localProofHeaders mints a fresh nonce per request, bound to the literal dialled", () => {
    const url = `${localApiBase({ port: 8000, host: "0.0.0.0" })}/api/shutdown`;
    expect(url).toBe("http://127.0.0.1:8000/api/shutdown");
    const a = localProofHeaders("POST", url, "tok");
    const b = localProofHeaders("POST", url, "tok");
    expect(a["X-Pi-Local-Proof"]).not.toBe(b["X-Pi-Local-Proof"]);
    expect(localProofHeaders("POST", url, null)).toEqual({});
    expect(localApiBase({ port: 1, host: "::1" })).toBe("http://[::1]:1");
  });
  it("never presents a local credential to a host that is not this one", async () => {
    const fetchImpl = fetchOk("C");
    expect(await mintLocalProofUrl("https://dash.example.com", { fetchImpl, token: "tok" })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("falls back to the plain URL with no token / on failure", async () => {
    const win = { loadURL: vi.fn(async () => {}) };
    expect(await loadWithLocalProof(win, "http://localhost:8000", { token: null })).toBe(false);
    expect(win.loadURL).toHaveBeenLastCalledWith("http://localhost:8000");
    const bad = vi.fn(async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    expect(await mintLocalProofUrl("http://localhost:8000", { fetchImpl: bad, token: "t" })).toBeNull();
    const boom = vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch;
    expect(await mintLocalProofUrl("http://localhost:8000", { fetchImpl: boom, token: "t" })).toBeNull();
  });
  it("main.ts routes its window loads through loadWithLocalProof", () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../main.ts"), "utf-8");
    expect(src).toContain("loadWithLocalProof(");
  });
});

// ── navigateToServer (main-process handoff) ─────────────────────────────────────
// See change: fix-pairing-approval-credential (D4; test-plan E58–E64, X11–X14).

const config = { port: 8000, knownServers: [] as { host: string; port: number }[] };
const mkWin = () => ({ loadURL: vi.fn(async (_u: string) => {}) });
const fetchCalls = (f: unknown) => (f as { mock: { calls: unknown[][] } }).mock.calls;

describe("navigateToServer — target allowlist and scheme (E58, E59)", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "https://evil.example/",
    "http://localhost:8000.evil.com",
    "http://127.0.0.1:8000@evil.example/",
    "http://localhost:8000@evil.example",
    "http://evil.example:8000",
  ])("E58 refuses %j with target-not-allowed; no load, no mint", async (target) => {
    const win = mkWin();
    const fetchImpl = fetchOk("C");
    const res = await navigateToServer(win, target, { config, windowServerUrl: "http://localhost:8000", fetchImpl, token: "tok" });
    expect(res).toEqual({ navigated: false, reason: "target-not-allowed" });
    expect(win.loadURL).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "pi-dashboard://approve"])(
    "E59 refuses non-web scheme %j; no load, no mint, no openExternal",
    async (target) => {
      const win = mkWin();
      const fetchImpl = fetchOk("C");
      const res = await navigateToServer(win, target, { config, windowServerUrl: "http://localhost:8000", fetchImpl, token: "tok" });
      expect(res.navigated).toBe(false);
      expect(res.reason).toBeTruthy();
      expect(win.loadURL).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("refuses non-string / empty targets", async () => {
    const win = mkWin();
    for (const t of [undefined, null, 42, {}, "", "   "] as unknown[]) {
      expect((await navigateToServer(win, t as string, { config, token: "tok" })).navigated).toBe(false);
    }
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  it("an allowed target with a non-http scheme in a known-server look-alike form is still refused", async () => {
    const win = mkWin();
    const res = await navigateToServer(win, "ftp://localhost:8000", { config, token: "tok", fetchImpl: fetchOk("C") });
    expect(res.navigated).toBe(false);
    expect(win.loadURL).not.toHaveBeenCalled();
  });
});

describe("navigateToServer — mint only for the configured local server (E60–E62, E64)", () => {
  it("E60 configured local target: loadURL once with the bootstrap URL; return value carries no URL", async () => {
    const win = mkWin();
    const fetchImpl = fetchOk("CODE1");
    const res = await navigateToServer(win, "http://localhost:8000", { config, windowServerUrl: "http://localhost:8000", fetchImpl, token: "tok" });
    expect(res).toEqual({ navigated: true });
    expect(win.loadURL).toHaveBeenCalledTimes(1);
    const loaded = new URL(win.loadURL.mock.calls[0][0]);
    expect(loaded.origin).toBe("http://localhost:8000");
    expect(loaded.pathname).toBe("/auth/local-proof");
    expect(loaded.searchParams.get("code")).toBe("CODE1");
    expect(loaded.searchParams.get("next")).toBe("/");
    expect(JSON.stringify(res)).not.toContain("code=");
    // The mint dials the pinned literal, never the renderer-supplied host spelling.
    expect(fetchCalls(fetchImpl)[0][0]).toBe("http://127.0.0.1:8000/api/local-proof");
  });

  it.each(["http://127.0.0.1:8000", "http://[::1]:8000"])("E60 accepts the other loopback spellings %s", async (target) => {
    const win = mkWin();
    expect(await navigateToServer(win, target, { config, fetchImpl: fetchOk("C"), token: "tok" })).toEqual({ navigated: true });
    expect(win.loadURL.mock.calls[0][0]).toContain("/auth/local-proof?code=C");
  });

  it("E60 carries a same-origin path as next=", async () => {
    const win = mkWin();
    await navigateToServer(win, "http://localhost:8000/settings/gateway?x=1", { config, fetchImpl: fetchOk("C"), token: "tok" });
    expect(new URL(win.loadURL.mock.calls[0][0]).searchParams.get("next")).toBe("/settings/gateway?x=1");
  });

  it("E61 known server on another local port loads unchanged; mint 0", async () => {
    const win = mkWin();
    const fetchImpl = fetchOk("C");
    const res = await navigateToServer(win, "http://127.0.0.1:9999", {
      config: { ...config, knownServers: [{ host: "127.0.0.1", port: 9999 }] },
      fetchImpl,
      token: "tok",
    });
    expect(res).toEqual({ navigated: true });
    expect(win.loadURL).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:9999");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("E62 remote known server loads unchanged; mint 0", async () => {
    const win = mkWin();
    const fetchImpl = fetchOk("C");
    const res = await navigateToServer(win, "http://192.168.16.242:8000", {
      config: { ...config, knownServers: [{ host: "192.168.16.242", port: 8000 }] },
      fetchImpl,
      token: "tok",
    });
    expect(res).toEqual({ navigated: true });
    expect(win.loadURL).toHaveBeenCalledExactlyOnceWith("http://192.168.16.242:8000");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("E63 the window's own remote serverUrl is allowed and loads unchanged; mint 0", async () => {
    const win = mkWin();
    const fetchImpl = fetchOk("C");
    const res = await navigateToServer(win, "http://192.168.16.242:8000", { config, windowServerUrl: "http://192.168.16.242:8000", fetchImpl, token: "tok" });
    expect(res).toEqual({ navigated: true });
    expect(win.loadURL).toHaveBeenCalledExactlyOnceWith("http://192.168.16.242:8000");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a remote known server on the configured port number is still never credentialed", async () => {
    const win = mkWin();
    const fetchImpl = fetchOk("C");
    await navigateToServer(win, "http://192.168.16.242:8000", { config: { ...config, knownServers: [{ host: "192.168.16.242", port: 8000 }] }, fetchImpl, token: "tok" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("an https local target on the configured port is loaded unchanged (the mint is http-only)", async () => {
    const win = mkWin();
    const fetchImpl = fetchOk("C");
    const res = await navigateToServer(win, "https://localhost:8000", { config, windowServerUrl: "https://localhost:8000", fetchImpl, token: "tok" });
    expect(res).toEqual({ navigated: true });
    expect(win.loadURL).toHaveBeenCalledExactlyOnceWith("https://localhost:8000");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("known-server entry with a bare IPv6 host is allowlisted", async () => {
    const win = mkWin();
    const res = await navigateToServer(win, "http://[fd00::5]:8000", {
      config: { ...config, knownServers: [{ host: "fd00::5", port: 8000 }] },
      fetchImpl: fetchOk("C"),
      token: "tok",
    });
    expect(res).toEqual({ navigated: true });
  });

  it("E64 next= is emitted only in a sanitizeReturnUrl-acceptable shape, else /", async () => {
    for (const target of ["http://localhost:8000//evil.example", "http://localhost:8000/\\evil.example", "http://localhost:8000/a\r\nSet-Cookie: x=y", "http://localhost:8000/a\u0001b"]) {
      const win = mkWin();
      await navigateToServer(win, target, { config, fetchImpl: fetchOk("C"), token: "tok" });
      const next = new URL(win.loadURL.mock.calls[0][0]).searchParams.get("next")!;
      expect(next, target).toBe(sanitizeNextPath(next));
      expect(next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\"), target).toBe(true);
      expect(/[\u0000-\u001f\u007f]/.test(next), target).toBe(false);
      expect(win.loadURL.mock.calls[0][0]).not.toMatch(/[\r\n]/);
    }
  });
});

describe("sanitizeNextPath — same semantics as the server's sanitizeReturnUrl (E64)", () => {
  // Vectors copied from packages/server/src/__tests__/auth-plugin-oauth-state.test.ts (E20–E23).
  it.each(["/settings/gateway", "/a?b=c#d", "/%2F%2Fevil.example", "/..//evil", "/a\u0020", "/a\u0080", "/sessions?x=1", "/"])(
    "keeps same-origin %j unchanged",
    (v) => expect(sanitizeNextPath(v)).toBe(v),
  );
  it.each<unknown>([
    "https://evil.example/steal", "//evil.example", "/\\evil.example", "evil", "", undefined, 123, ["/a"], "HTTPS://evil", "/\\/evil",
    "javascript:alert(1)", "/a\nb", "%252F%252Fevil.example",
    "/\t/evil.example", "/\r\n/evil.example", "/\r\nSet-Cookie: x=y", "/a\u0000", "/a\u001f", "/a\u007f",
  ])("off-origin / non-string / control char %j → /", (v) => expect(sanitizeNextPath(v)).toBe("/"));
});

describe("navigateToServer — mint faults degrade to the plain target (X11–X14)", () => {
  afterEach(() => vi.restoreAllMocks());
  const run = async (deps: { fetchImpl?: typeof fetch; token?: string | null }) => {
    const win = mkWin();
    const res = await navigateToServer(win, "http://localhost:8000", { config, windowServerUrl: "http://localhost:8000", ...deps });
    return { win, res };
  };

  it("X11 server down (ECONNREFUSED): plain target, {navigated:true}, no throw", async () => {
    const fetchImpl = vi.fn(async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); }) as unknown as typeof fetch;
    const { win, res } = await run({ fetchImpl, token: "tok" });
    expect(res).toEqual({ navigated: true });
    expect(win.loadURL).toHaveBeenCalledExactlyOnceWith("http://localhost:8000");
  });

  it("X12 token unreadable: plain target, no mint request, no token file or directory created", async () => {
    const localDir = path.join(getDashboardConfigDir(), "local");
    const fetchImpl = vi.fn(async () => { throw new Error("mint attempted without a token"); }) as unknown as typeof fetch;
    // `token: null` = unreadable token, independent of whatever HOME the run uses.
    const { win, res } = await run({ token: null, fetchImpl });
    expect(res).toEqual({ navigated: true });
    expect(win.loadURL).toHaveBeenCalledExactlyOnceWith("http://localhost:8000");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(existsSync(path.join(localDir, "token"))).toBe(false);
    expect(existsSync(localDir)).toBe(false);
  });

  it.each([401, 500])("X13 mint answers %i: plain target", async (status) => {
    const fetchImpl = vi.fn(async () => new Response("no", { status })) as unknown as typeof fetch;
    const { win, res } = await run({ fetchImpl, token: "tok" });
    expect(res).toEqual({ navigated: true });
    expect(win.loadURL).toHaveBeenCalledExactlyOnceWith("http://localhost:8000");
  });

  it("X14 mint never answers: the existing 3000 ms AbortSignal.timeout bounds it, then plain target", async () => {
    const ac = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(ac.signal);
    const fetchImpl = vi.fn((_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
    ) as unknown as typeof fetch;
    const pending = run({ fetchImpl, token: "tok" });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(timeoutSpy).toHaveBeenCalledWith(3000);
    ac.abort();
    const { win, res } = await pending;
    expect(res).toEqual({ navigated: true });
    expect(win.loadURL).toHaveBeenCalledExactlyOnceWith("http://localhost:8000");
  });

  it("a loadURL rejection does not throw out of navigateToServer; reports failure", async () => {
    const win = { loadURL: vi.fn(async () => { throw new Error("ERR_ABORTED"); }) };
    const res = await navigateToServer(win, "http://localhost:8000", { config, fetchImpl: fetchOk("C"), token: "tok" });
    expect(res.navigated).toBe(false);
  });
});

describe("main-window allowed origin (ELEC-01)", () => {
  const config = { port: 8000, host: "localhost", knownServers: [{ host: "10.0.0.5", port: 9000 }] } as any;
  const deps = (windowServerUrl?: string) => ({ config, windowServerUrl });

  it("originOf / allowedOrigins are exported and normalise", () => {
    expect(originOf("HTTP://LOCALHOST:8000/x")).toBe("http://localhost:8000");
    expect(originOf("not a url")).toBeNull();
    expect(allowedOrigins(deps()).has("http://127.0.0.1:8000")).toBe(true);
  });

  it("E78: file:// and unlisted URLs yield undefined; a known server is accepted", () => {
    expect(mainWindowAllowedOrigin(() => "file:///x/doctor.html", deps("http://localhost:8000"))).toBeUndefined();
    expect(mainWindowAllowedOrigin(() => "http://unlisted.example:8000/", deps("http://localhost:8000"))).toBeUndefined();
    expect(mainWindowAllowedOrigin(() => "http://10.0.0.5:9000/x", deps("http://localhost:8000"))).toBe("http://10.0.0.5:9000");
  });

  it("E77: empty URL, no URL, a throwing getURL (destroyed window) → undefined", () => {
    expect(mainWindowAllowedOrigin(() => "", deps("http://localhost:8000"))).toBeUndefined();
    expect(mainWindowAllowedOrigin(undefined, deps("http://localhost:8000"))).toBeUndefined();
    expect(
      mainWindowAllowedOrigin(() => {
        throw new Error("Object has been destroyed");
      }, deps("http://localhost:8000")),
    ).toBeUndefined();
  });

  it("E80: follows navigation (A → loopback variant B → known server C → unlisted D → A)", () => {
    let url = "http://localhost:8000/";
    const get = () => mainWindowAllowedOrigin(() => url, deps("http://localhost:8000"));
    expect(get()).toBe("http://localhost:8000");
    url = "http://127.0.0.1:8000/";
    expect(get()).toBe("http://127.0.0.1:8000");
    url = "http://10.0.0.5:9000/";
    expect(get()).toBe("http://10.0.0.5:9000");
    url = "http://evil.example:1/";
    expect(get()).toBeUndefined();
    url = "http://localhost:8000/";
    expect(get()).toBe("http://localhost:8000");
  });

  it("the window's own server (remote mode) is accepted even when not configured", () => {
    expect(mainWindowAllowedOrigin(() => "https://dash.example.com/", deps("https://dash.example.com"))).toBe("https://dash.example.com");
  });
});

describe("default-session handlers fail closed when the origin source breaks (T.171 X40, T.172 X41)", () => {
  type Req = (wc: unknown, perm: string, cb: (g: boolean) => void, d: Record<string, unknown>) => void;
  type Chk = (wc: unknown, perm: string, origin: string, d: Record<string, unknown>) => boolean;
  const ORIGIN = "http://localhost:8000";

  /** Wire the handlers exactly like main.ts: origin = mainWindowAllowedOrigin(getURL, { config: loadMinimalConfig() }). */
  function wire(getURL: () => string, loadMinimalConfig: () => unknown) {
    let request!: Req;
    let check!: Chk;
    installDefaultSessionPermissions(
      {
        setPermissionRequestHandler: (h) => void (request = h as unknown as Req),
        setPermissionCheckHandler: (h) => void (check = h as unknown as Chk),
      },
      () => mainWindowAllowedOrigin(getURL, { config: loadMinimalConfig() as any, windowServerUrl: ORIGIN }),
      () => {},
    );
    const ask = (perm: string) => {
      const cb = vi.fn();
      request({}, perm, cb, { isMainFrame: true, requestingUrl: `${ORIGIN}/` });
      return cb;
    };
    const chk = (perm: string) => check({}, perm, ORIGIN, { isMainFrame: true, requestingUrl: `${ORIGIN}/` });
    return { ask, chk };
  }
  const goodConfig = () => ({ port: 8000, host: "localhost", knownServers: [] });

  it("sanity: healthy getURL + config grants notifications", () => {
    const w = wire(() => `${ORIGIN}/`, goodConfig);
    expect(w.chk("notifications")).toBe(true);
    expect(w.ask("notifications")).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("T.171: getURL throws (destroyed webContents) -> request and check handlers deny, nothing thrown", () => {
    const w = wire(() => {
      throw new Error("Object has been destroyed");
    }, goodConfig);
    for (const p of ["notifications", "fullscreen", "clipboard-sanitized-write", "media"]) {
      expect(() => w.chk(p)).not.toThrow();
      expect(w.chk(p), p).toBe(false);
      const cb = w.ask(p);
      expect(cb).toHaveBeenCalledExactlyOnceWith(false);
    }
  });

  it("T.172: loadMinimalConfig throws -> denied, no origin trusted, no crash", () => {
    const w = wire(() => `${ORIGIN}/`, () => {
      throw new Error("ENOENT config");
    });
    expect(() => w.chk("notifications")).not.toThrow();
    expect(w.chk("notifications")).toBe(false);
    expect(w.ask("notifications")).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each([
    ["null", null],
    ["a string", "garbage"],
    ["an empty object (no knownServers)", {}],
    ["knownServers not an array", { port: 8000, knownServers: 5 }],
    ["knownServers with junk entries", { port: 8000, knownServers: [null, 7] }],
  ])("T.172: corrupt config (%s) -> denied, no crash", (_n, cfg) => {
    const w = wire(() => `${ORIGIN}/`, () => cfg);
    expect(() => w.chk("notifications")).not.toThrow();
    expect(w.chk("notifications")).toBe(false);
    expect(w.ask("notifications")).toHaveBeenCalledExactlyOnceWith(false);
  });
});
