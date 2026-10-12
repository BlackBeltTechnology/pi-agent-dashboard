/**
 * Host-level `/api/` fetch rewrite (change: fix-remote-relative-api-fetch).
 *
 * Un-prefixed root-relative `/api/...` string requests (plugin clients get no
 * API base) must reach the selected server. The wrapper is installed OUTERMOST
 * so the same-origin credential wrappers see the rewritten cross-origin URL and
 * never attach the local device bearer / grant capability to a remote.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAccessToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";
import { clearGrantChannel, GRANT_CHANNEL_HEADER, setGrantChannel } from "../../access-grants/grant-channel.js";
import { clearDeviceBearer, storeDeviceBearer } from "../../pairing/device-auth.js";
import { getApiBase, setGlobalApiBase } from "../api-context.js";
import { installApiBaseFetch } from "../api-base-fetch.js";
import { installFetchWrappers } from "../install-fetch-wrappers.js";

interface Seen {
  input: RequestInfo | URL;
  url: string;
  authorization: string | null;
  grant: string | null;
  method: string | undefined;
}
const seen: Seen[] = [];
const REMOTE = "http://remote:8000";
let installedFetch: typeof fetch;

beforeAll(() => {
  // Network stub at the bottom of the chain. Wrappers go on via the SAME installer
  // main.tsx calls, so an order regression there fails these tests.
  window.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    seen.push({ input, url, authorization: headers.get("Authorization"), grant: headers.get(GRANT_CHANNEL_HEADER), method: init?.method });
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  installFetchWrappers();
  installedFetch = window.fetch;
  // Idempotent: a second install must not double-wrap.
  installFetchWrappers();
  installApiBaseFetch();
});

beforeEach(() => {
  seen.length = 0;
  clearAccessToken();
  clearDeviceBearer();
  clearGrantChannel();
  setGlobalApiBase("");
});

afterEach(() => {
  setGlobalApiBase("");
  localStorage.clear();
  sessionStorage.clear();
});

describe("installApiBaseFetch rewrite", () => {
  it("rewrites a relative /api/ fetch to the remote base (plugin quota case)", async () => {
    setGlobalApiBase(REMOTE);
    await fetch("/api/quota");
    expect(seen.map((s) => s.url)).toEqual([`${REMOTE}/api/quota`]);
  });

  it("leaves a relative fetch untouched in same-origin mode", async () => {
    await fetch("/api/sessions");
    expect(seen.map((s) => s.input)).toEqual(["/api/sessions"]);
  });

  it("honours a server switch without reinstall", async () => {
    await fetch("/api/health");
    setGlobalApiBase(REMOTE);
    await fetch("/api/health");
    setGlobalApiBase("");
    await fetch("/api/health");
    expect(seen.map((s) => s.url)).toEqual(["/api/health", `${REMOTE}/api/health`, "/api/health"]);
  });

  it("preserves query and hash verbatim", async () => {
    setGlobalApiBase(REMOTE);
    await fetch("/api/files?path=a%20b#x");
    expect(seen[0].url).toBe(`${REMOTE}/api/files?path=a%20b#x`);
  });

  it("does not rewrite explicit absolute URLs, URL objects, Request objects or non-/api paths", async () => {
    setGlobalApiBase(REMOTE);
    const explicit = "http://localhost:8000/api/health";
    const urlObj = new URL("http://localhost:8000/api/health");
    const req = new Request("http://localhost:8000/api/health");
    await fetch(explicit);
    await fetch(urlObj);
    await fetch(req);
    await fetch("/assets/x.js");
    expect(seen.map((s) => s.url)).toEqual([explicit, urlObj.href, req.url, "/assets/x.js"]);
  });

  it("does not rewrite protocol-relative or look-alike prefixes", async () => {
    setGlobalApiBase(REMOTE);
    await fetch("//evil.example.com/api/x");
    await fetch("/apix/y");
    await fetch("/api");
    expect(seen.map((s) => s.url)).toEqual(["//evil.example.com/api/x", "/apix/y", "/api"]);
  });

  it("passes init through to the underlying fetch", async () => {
    setGlobalApiBase(REMOTE);
    await fetch("/api/quota", { method: "POST", body: "x" });
    expect(seen[0].url).toBe(`${REMOTE}/api/quota`);
    expect(seen[0].method).toBe("POST");
  });

  it("is idempotent: re-installing neither re-wraps fetch nor changes the result", async () => {
    expect(window.fetch).toBe(installedFetch);
    setGlobalApiBase(REMOTE);
    await fetch("/api/quota");
    expect(seen.map((s) => s.url)).toEqual([`${REMOTE}/api/quota`]);
    expect(getApiBase()).toBe(REMOTE);
  });
});

describe("credential isolation (installFetchWrappers order, as used by main.tsx)", () => {
  it("attaches no local bearer to a rewritten remote request", async () => {
    storeDeviceBearer("local-device-token");
    setGlobalApiBase(REMOTE);
    await fetch("/api/quota");
    expect(seen[0].url).toBe(`${REMOTE}/api/quota`);
    expect(seen[0].authorization).toBeNull();
  });

  it("attaches no grant-channel capability to a rewritten remote request", async () => {
    setGrantChannel("cap-1");
    setGlobalApiBase(REMOTE);
    await fetch("/api/quota");
    expect(seen[0].url).toBe(`${REMOTE}/api/quota`);
    expect(seen[0].grant).toBeNull();
  });

  it("still attaches the bearer and grant capability in same-origin mode", async () => {
    storeDeviceBearer("local-device-token");
    setGrantChannel("cap-1");
    await fetch("/api/quota");
    expect(seen[0].input).toBe("/api/quota");
    expect(seen[0].authorization).toBe("Bearer local-device-token");
    expect(seen[0].grant).toBe("cap-1");
  });
});
