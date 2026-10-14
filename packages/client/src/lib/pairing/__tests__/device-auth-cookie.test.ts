/**
 * Device bearer → httpOnly cookie exchange on the client.
 * See change: harden-trust-and-credential-boundaries (D5; T-E36, F1, F2, F5).
 */

import { clearAccessToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../../api/api-context.js";
import {
  clearDeviceBearer,
  finishDevicePairing,
  getDeviceBearer,
  installDeviceAuthFetch,
  isDevicePaired,
  migrateLegacyDeviceBearer,
  mintWsTicket,
  storeDeviceBearer,
} from "../device-auth.js";

const LEGACY = "pi-dashboard:device-bearer";
const MARKER = "pi-dashboard:device-paired";
const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  clearAccessToken();
  clearDeviceBearer();
  localStorage.removeItem(MARKER);
  setGlobalApiBase("");
});
afterEach(() => {
  vi.unstubAllGlobals();
  setGlobalApiBase("");
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
  it("E36 cross-origin: no exchange, bearer stays", async () => {
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

describe("F2 legacy migration", () => {
  it.each([
    [() => res(200), { bearer: null, marker: "1" }],
    [() => res(401), { bearer: null, marker: null }],
    [() => { throw new Error("offline"); }, { bearer: "OLD", marker: null }],
  ])("outcome %#", async (respond, want) => {
    storeDeviceBearer("OLD");
    vi.stubGlobal("fetch", vi.fn(async () => (respond as () => Response)()));
    await migrateLegacyDeviceBearer();
    expect(getDeviceBearer()).toBe(want.bearer);
    expect(localStorage.getItem(MARKER)).toBe(want.marker);
  });
  it("E36 cross-origin leaves the legacy bearer alone", async () => {
    setGlobalApiBase("https://other.example");
    storeDeviceBearer("OLD");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await migrateLegacyDeviceBearer();
    expect(f).not.toHaveBeenCalled();
    expect(getDeviceBearer()).toBe("OLD");
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
});
