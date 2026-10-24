/**
 * Device bearer → httpOnly cookie exchange on the client.
 * See change: harden-trust-and-credential-boundaries (D5; T-E36, F1, F2, F5).
 */

import { clearAccessToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../../api/api-context.js";
import { getInitialWsUrl, LAST_SERVER_KEY } from "../../api/server-switch.js";
import {
  browserHolderBody,
  finishDevicePairing,
  getDeviceBearer,
  installDeviceAuthFetch,
  isDevicePaired,
  migrateLegacyDeviceBearer,
  mintWsTicket,
  resetDeviceAuthRuntimeForTests,
  startDeviceBearerRotation,
  storeDeviceBearer,
} from "../device-auth.js";

const LEGACY = "pi-dashboard:device-bearer";
const SLOT = (origin: string) => `${LEGACY}:${origin}`;
/** Every per-origin slot key currently in storage. */
const slotKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(`${LEGACY}:`));
const MARKER = "pi-dashboard:device-paired";
const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  resetDeviceAuthRuntimeForTests();
  clearAccessToken();
  localStorage.clear();
  setGlobalApiBase("");
  (window as unknown as { __piDeviceAuthFetch?: boolean }).__piDeviceAuthFetch = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setGlobalApiBase("");
  localStorage.clear();
});

describe("finishDevicePairing", () => {
  it("F1 same-origin: exchanges, stores only the marker", async () => {
    const f = vi.fn(async () => res(200, { success: true }));
    vi.stubGlobal("fetch", f);
    await finishDevicePairing("T");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/device-session");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer T");
    expect(localStorage.getItem(MARKER)).toBe("1");
    expect(localStorage.getItem(LEGACY)).toBeNull();
  });
  it("a failed exchange keeps the bearer (no lock-out)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(500)));
    await finishDevicePairing("T");
    expect(getDeviceBearer()).toBe("T");
    expect(isDevicePaired()).toBe(false);
  });
  it("E36 cross-origin: no exchange, bearer stays (per-origin slot)", async () => {
    setGlobalApiBase("https://other.example");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await finishDevicePairing("T");
    expect(f).not.toHaveBeenCalled();
    expect(getDeviceBearer()).toBe("T");
  });
});

describe("F8 bearer kept until the cookie is proven", () => {
  /** Routes: exchange 200; the cookie-only check answers `check`. */
  function stub(check: () => Response) {
    const f = vi.fn(async (url: string, _init?: RequestInit) =>
      String(url).endsWith("/api/device-session") ? res(200, { success: true }) : check(),
    );
    vi.stubGlobal("fetch", f);
    return f;
  }
  const checkCall = (f: ReturnType<typeof stub>) =>
    f.mock.calls.find((c) => !String(c[0]).endsWith("/api/device-session")) as unknown as [string, RequestInit];

  it("exchange 200 + cookie-only check 200: marker set, bearer cleared, check carried no Authorization", async () => {
    const f = stub(() => res(200, { success: true }));
    expect(await finishDevicePairing("T")).toEqual({ keepFailed: false });
    expect(localStorage.getItem(MARKER)).toBe("1");
    expect(getDeviceBearer()).toBeNull();
    const [url, init] = checkCall(f);
    expect(url).toMatch(/^\/api\//);
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });

  it("exchange 200 but cookie-only check 401 (cookie dropped): bearer kept, no marker, next call carries Authorization, message flag set", async () => {
    const f = stub(() => res(401, { success: false }));
    expect(await finishDevicePairing("T")).toEqual({ keepFailed: true });
    expect(getDeviceBearer()).toBe("T");
    expect(isDevicePaired()).toBe(false);
    // The shared fetch wrapper now authenticates with the kept bearer.
    installDeviceAuthFetch();
    await window.fetch("/api/anything");
    const last = f.mock.calls[f.mock.calls.length - 1] as unknown as [RequestInfo, RequestInit];
    expect(new Headers(last[1].headers).get("Authorization")).toBe("Bearer T");
  });

  it("a cookie check that throws counts as unproven", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/device-session")) return res(200, { success: true });
      throw new Error("offline");
    }));
    expect(await finishDevicePairing("T")).toEqual({ keepFailed: true });
    expect(getDeviceBearer()).toBe("T");
  });

  it("a failed exchange also reports keepFailed (same-origin cookie not established)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(500)));
    expect(await finishDevicePairing("T")).toEqual({ keepFailed: true });
    expect(getDeviceBearer()).toBe("T");
  });

  it("cross-origin: bearer kept by design, no message", async () => {
    setGlobalApiBase("https://other.example");
    vi.stubGlobal("fetch", vi.fn());
    expect(await finishDevicePairing("T")).toEqual({ keepFailed: false });
    expect(getDeviceBearer()).toBe("T");
  });
});

describe("AE56 legacy global slot is discarded on every path (replaces F2 migration)", () => {
  /** Run client start (migrate + first fetches) and assert nothing legacy was exchanged, sent or copied. */
  async function startAndAssertDiscarded(): Promise<void> {
    localStorage.setItem(LEGACY, "old-tok");
    const f = vi.fn(async () => res(200, { success: true }));
    vi.stubGlobal("fetch", f);
    installDeviceAuthFetch();
    await migrateLegacyDeviceBearer();
    await window.fetch("/api/sessions");
    await window.fetch("https://b.example/api/sessions");
    expect(localStorage.getItem(LEGACY)).toBeNull();
    const calls = f.mock.calls as unknown as [RequestInfo, RequestInit | undefined][];
    for (const [input, init] of calls) {
      expect(new Headers(init?.headers).get("Authorization") ?? "").not.toContain("old-tok");
      expect(String(input)).not.toContain("/api/device-session");
    }
    expect(slotKeys()).toEqual([]);
    expect(isDevicePaired()).toBe(false);
  }

  it("AE56 same-origin base", async () => {
    await startAndAssertDiscarded();
  });
  it("AE56 cross-origin via the saved server (LAST_SERVER_KEY)", async () => {
    localStorage.setItem(LAST_SERVER_KEY, "b.example:443");
    setGlobalApiBase(new URL(getInitialWsUrl().replace(/^ws/, "http")).origin);
    expect(getDeviceBearer()).toBeNull();
    await startAndAssertDiscarded();
  });
  it("AE56 cross-origin via the VITE_API_URL early fallback", async () => {
    vi.resetModules();
    vi.doMock("../../api/api-context.js", async (orig) => ({
      ...(await orig<typeof import("../../api/api-context.js")>()),
      VITE_API_URL: "https://b.example",
    }));
    try {
      const fresh = await import("../device-auth.js");
      localStorage.setItem(LEGACY, "old-tok");
      const f = vi.fn(async () => res(200, { success: true }));
      vi.stubGlobal("fetch", f);
      fresh.installDeviceAuthFetch();
      await fresh.migrateLegacyDeviceBearer();
      await window.fetch("https://b.example/api/sessions");
      expect(localStorage.getItem(LEGACY)).toBeNull();
      expect(f).toHaveBeenCalledTimes(1);
      expect(new Headers((f.mock.calls[0] as unknown as [string, RequestInit])[1]?.headers).get("Authorization")).toBeNull();
      expect(slotKeys()).toEqual([]);
    } finally {
      vi.doUnmock("../../api/api-context.js");
      vi.resetModules();
    }
  });
});

describe("AE58 same-origin keep-failed bearer lives in the per-origin slot", () => {
  it("AE58 stores the bearer in the page-origin slot, never the legacy key, and the next /api/ fetch carries it", async () => {
    const f = vi.fn(async (url: string) =>
      String(url).endsWith("/api/device-session") ? res(200, { success: true }) : String(url).endsWith("/api/favorite-models") ? res(401, {}) : res(200, {}),
    );
    vi.stubGlobal("fetch", f);
    const result = await finishDevicePairing("T");
    expect(result).toEqual({ keepFailed: true }); // the landing renders the user notice from this flag
    expect(JSON.parse(localStorage.getItem(SLOT(window.location.origin)) ?? "null")).toEqual({ token: "T" });
    expect(localStorage.getItem(LEGACY)).toBeNull();
    installDeviceAuthFetch();
    await window.fetch("/api/anything");
    const last = f.mock.calls.at(-1) as unknown as [RequestInfo, RequestInit];
    expect(new Headers(last[1].headers).get("Authorization")).toBe("Bearer T");
  });
});

describe("AE54 holder:\"browser\" is declared only for a cross-origin API", () => {
  const bodies = (f: ReturnType<typeof vi.fn>) =>
    (f.mock.calls as unknown as [RequestInfo, RequestInit | undefined][]).map(([, init]) => String(init?.body ?? ""));

  it("AE54 same-origin, cookie proven: no holder on any request", async () => {
    const f = vi.fn(async () => res(200, { success: true }));
    vi.stubGlobal("fetch", f);
    expect(browserHolderBody()).toEqual({});
    await finishDevicePairing("T");
    expect(bodies(f).some((b) => b.includes("holder"))).toBe(false);
  });
  it("AE54 same-origin, cookie-only check fails (keep-failed): no holder, and rotation never runs", async () => {
    const f = vi.fn(async (url: string) => (String(url).endsWith("/api/device-session") ? res(200, {}) : res(401, {})));
    vi.stubGlobal("fetch", f);
    expect(browserHolderBody()).toEqual({});
    expect(await finishDevicePairing("T")).toEqual({ keepFailed: true });
    await startDeviceBearerRotation();
    expect(bodies(f).some((b) => b.includes("holder"))).toBe(false);
    expect(f.mock.calls.some((c) => String(c[0]).includes("/rotate"))).toBe(false);
  });
  it("AE54 cross-origin pairing: the declaration is added to the pairing request body", () => {
    setGlobalApiBase("https://other.example");
    expect(browserHolderBody()).toEqual({ holder: "browser" });
    expect({ pendingId: "p1", ...browserHolderBody() }).toEqual({ pendingId: "p1", holder: "browser" });
  });
  it("AE54 cross-origin rotation: the rotate body declares holder:browser", async () => {
    setGlobalApiBase("https://other.example");
    storeDeviceBearer("T1", Date.now() + 7 * 86_400_000);
    const f = vi.fn(async () => res(200, { token: "T2", expiresAt: Date.now() + 7 * 86_400_000 }));
    vi.stubGlobal("fetch", f);
    await startDeviceBearerRotation();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://other.example/api/paired-devices/rotate");
    expect(JSON.parse(String(init.body))).toEqual({ holder: "browser" });
  });
});

describe("mintWsTicket via cookie (F3 / F5 / E36)", () => {
  it("F3 marker set, no bearer: same-origin credentials, no Authorization", async () => {
    localStorage.setItem(MARKER, "1");
    const f = vi.fn(async () => res(200, { success: true, data: { ticket: "TK" } }));
    vi.stubGlobal("fetch", f);
    expect(await mintWsTicket()).toBe("TK");
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });
  it("F5 a 401 clears the stale marker", async () => {
    localStorage.setItem(MARKER, "1");
    vi.stubGlobal("fetch", vi.fn(async () => res(401, { success: false })));
    expect(await mintWsTicket()).toBeNull();
    expect(isDevicePaired()).toBe(false);
  });
  it("E36 a stored bearer is still sent as Authorization", async () => {
    storeDeviceBearer("B");
    const f = vi.fn(async () => res(200, { success: true, data: { ticket: "TK" } }));
    vi.stubGlobal("fetch", f);
    await mintWsTicket();
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer B");
  });
  it("unpaired mints nothing", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await mintWsTicket()).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("probeCookie: an unmarked browser tries the cookie once and marks itself on success", async () => {
    const f = vi.fn(async () => res(200, { success: true, data: { ticket: "PROBE-TK" } }));
    vi.stubGlobal("fetch", f);
    expect(await mintWsTicket("browser", { probeCookie: true })).toBe("PROBE-TK");
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    expect(isDevicePaired()).toBe(true);
  });

  it("probeCookie: a refused probe returns null and leaves the browser unmarked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(401, { success: false })));
    expect(await mintWsTicket("browser", { probeCookie: true })).toBeNull();
    expect(isDevicePaired()).toBe(false);
  });
});
