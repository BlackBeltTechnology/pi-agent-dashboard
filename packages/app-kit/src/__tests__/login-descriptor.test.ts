import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureDashboard, resetAppConfig } from "../config.js";
import { getIdentityMode, resetIdentityState, setAccessToken } from "../identity-state.js";
import { fetchLoginDescriptor, initIdentity } from "../login-descriptor.js";
import { authedFetch, NoCredentialError } from "../transport.js";

// Ported from InvoiceBot `src/__tests__/auth-login-descriptor.test.ts`; the
// "inactive → unavailable" case is deliberately rewritten to "inactive → none"
// (change: extract-standalone-app-kit, design D3).

afterEach(() => {
  resetIdentityState();
  resetAppConfig();
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("fetchLoginDescriptor", () => {
  it("reads the component kind (issuer + clientId) from the dashboard's descriptor, without a bearer", async () => {
    configureDashboard({ dashboardUrl: "https://dash.example.com" });
    setAccessToken("must-not-leak");
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ active: true, issuer: "https://kc.example/realms/r", clientId: "team-web", loginUrl: "/sso/login", label: "Keycloak" }),
    );
    const res = await fetchLoginDescriptor({ fetchImpl });
    expect(res).toEqual({
      ok: true,
      mode: "oidc",
      descriptor: { issuer: "https://kc.example/realms/r", clientId: "team-web", loginUrl: "/sso/login", label: "Keycloak" },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://dash.example.com/api/identity/login-config");
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("treats a separate-view-only descriptor as unavailable (no fallback)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ active: true, pluginId: "p", loginUrl: "/sso/login" }));
    expect(await fetchLoginDescriptor({ fetchImpl })).toEqual({ ok: false, mode: "unavailable", reason: "unavailable" });
  });

  it("treats an inactive descriptor as identity mode none (NOT unavailable)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ active: false }));
    expect(await fetchLoginDescriptor({ fetchImpl })).toEqual({ ok: false, mode: "none", reason: "inactive" });
  });

  it("never throws on a transport error, non-2xx, or malformed body", async () => {
    const unavailable = { ok: false, mode: "unavailable", reason: "unavailable" };
    const boom = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(await fetchLoginDescriptor({ fetchImpl: boom })).toEqual(unavailable);
    expect(await fetchLoginDescriptor({ fetchImpl: vi.fn(async () => jsonResponse({}, 500)) })).toEqual(unavailable);
    const junk = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("not json");
          },
        }) as unknown as Response,
    );
    expect(await fetchLoginDescriptor({ fetchImpl: junk })).toEqual(unavailable);
    expect(await fetchLoginDescriptor({ fetchImpl: vi.fn(async () => jsonResponse(null)) })).toEqual(unavailable);
    expect(await fetchLoginDescriptor({ fetchImpl: vi.fn(async () => jsonResponse([])) })).toEqual(unavailable);
  });
});

describe("initIdentity — E6 mode decision table", () => {
  it("is unknown before the descriptor is read", () => {
    expect(getIdentityMode()).toBe("unknown");
  });

  const cases: Array<[string, () => Promise<Response>, string]> = [
    ["{active:false}", async () => jsonResponse({ active: false }), "none"],
    ["{active:true,issuer,clientId}", async () => jsonResponse({ active: true, issuer: "https://kc/realms/r", clientId: "c" }), "oidc"],
    ["{active:true,loginUrl}", async () => jsonResponse({ active: true, loginUrl: "/login" }), "unavailable"],
    [
      "malformed JSON",
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("bad");
          },
        }) as unknown as Response,
      "unavailable",
    ],
    ["500", async () => jsonResponse({}, 500), "unavailable"],
  ];
  it.each(cases)("%s → %s", async (_name, respond, mode) => {
    await initIdentity({ fetchImpl: vi.fn(respond) });
    expect(getIdentityMode()).toBe(mode);
  });

  it("X1: a network failure fails closed — unavailable, and authedFetch sends nothing", async () => {
    await initIdentity({
      fetchImpl: vi.fn(async () => {
        throw new TypeError("failed to fetch");
      }),
    });
    expect(getIdentityMode()).toBe("unavailable");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(authedFetch("/api/x")).rejects.toBeInstanceOf(NoCredentialError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// The authority + client id must come from the descriptor at boot.
describe("no identity configuration is hard-coded in the kit's sources", () => {
  const SRC = join(__dirname, "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return name === "__tests__" ? [] : walk(p);
      return /\.(ts|tsx)$/.test(name) ? [p] : [];
    });

  it("no source assigns a literal issuer / client id / authority", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, "utf8");
      for (const re of [/authority\s*:\s*["'`]/, /client_id\s*:\s*["'`]/, /clientId\s*:\s*["'`]/, /issuer\s*:\s*["'`]/]) {
        if (re.test(src)) offenders.push(`${relative(SRC, file)} :: ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
