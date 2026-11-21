/**
 * F5 (test-plan, mcp-legacy-clients-and-token-issuance): the create-token API
 * helper POSTs the label to `/api/paired-devices` and unwraps the
 * `{ device, token }` payload from the standard `data` envelope.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPairedDevice, getBridgeTokenContext } from "../paired-devices-api.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DEVICE = {
  id: "dev-1",
  label: "cli",
  createdAt: "2026-08-20T00:00:00.000Z",
  lastSeen: null,
  source: "manual",
};
const TOKEN = "tok_abcdef0123456789abcdef0123456789";

function mockFetch(success = true) {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/paired-devices") && init?.method === "POST") {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          Promise.resolve(
            success
              ? { success: true, data: { device: DEVICE, token: TOKEN } }
              : { success: false, error: "operator credential required" },
          ),
      };
    }
    return {
      ok: false,
      status: 404,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(null),
    };
  });
}

describe("createPairedDevice", () => {
  it("POSTs the label once and unwraps { device, token } from data", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPairedDevice("cli", "observe");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/paired-devices$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ label: "cli", tier: "observe" });
    expect(result).toEqual({ device: DEVICE, token: TOKEN });
  });

  it("throws on a non-success envelope", async () => {
    vi.stubGlobal("fetch", mockFetch(false));
    await expect(createPairedDevice("cli", "observe")).rejects.toThrow("operator credential required");
  });
});

describe("createPairedDevice — bridge purpose (prove-vault-bridge-tls D9)", () => {
  const json = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
  });

  it("sends the purpose only when asked, and accepts a pi_tls_ token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { success: true, data: { device: DEVICE, token: "pi_tls_abc" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createPairedDevice("laptop", "operate", "bridge");
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ label: "laptop", tier: "operate", purpose: "bridge" });
    expect(result.token).toBe("pi_tls_abc");
  });

  it("surfaces a 403 bridge_token_requires_https with the HTTPS address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(403, { success: false, error: "bridge_token_requires_https", httpsUrl: "https://dash.example.ts.net:8443" })),
    );
    await expect(createPairedDevice("laptop", "operate", "bridge")).rejects.toMatchObject({
      code: "bridge_token_requires_https",
      httpsUrl: "https://dash.example.ts.net:8443",
    });
  });
});

describe("getBridgeTokenContext", () => {
  it("reads tlsEndpoints and tls.acceptBridges; an unreadable source degrades to none / off", async () => {
    const url = (u: string) => u;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (u: string) => {
        const body = url(u).endsWith("/api/tunnel/endpoints")
          ? { success: true, data: { endpoints: [], tlsEndpoints: [{ kind: "magicdns", url: "https://dash.example.ts.net:8443", tls: true }] } }
          : { success: true, data: { tls: { acceptBridges: true } } };
        return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: () => Promise.resolve(body) };
      }),
    );
    expect(await getBridgeTokenContext()).toEqual({ httpsChannel: false, tlsListenerUrls: ["https://dash.example.ts.net:8443"], acceptBridges: true });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await getBridgeTokenContext()).toEqual({ httpsChannel: false, tlsListenerUrls: [], acceptBridges: false });
  });
});

// See change: device-key-mutual-check (task 4.6, D6): revoked list, restore, delete now, companion remove.
import {
  daysUntilPurge,
  deleteRevokedDevice,
  listRevokedDevices,
  REVOKED_RETENTION_DAYS,
  removeCompanion,
  restorePairedDevice,
} from "../paired-devices-api.js";

const jsonRes = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
  }) as unknown as Response;

describe("revoked-device API", () => {
  it("listRevokedDevices: operator → devices + unreadable flag", async () => {
    const row = { ...DEVICE, tier: "operate", revokedAt: 5, revokedBy: "local" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(200, { success: true, data: [row], warning: "unreadable" })));
    expect(await listRevokedDevices()).toEqual({ operator: true, devices: [row], unreadable: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(200, { success: true, data: [] })));
    expect(await listRevokedDevices()).toEqual({ operator: true, devices: [], unreadable: false });
  });

  it.each([401, 403])("listRevokedDevices: %i ⇒ not an operator (no throw)", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(status, { success: false, error: "operator credential required" })));
    expect(await listRevokedDevices()).toEqual({ operator: false });
  });

  it("listRevokedDevices: any other failure throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(500, { success: false, error: "boom" })));
    await expect(listRevokedDevices()).rejects.toThrow("boom");
  });

  it("restorePairedDevice: POSTs /restore; 404 and 409 ⇒ unavailable; other errors throw", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { success: true }));
    vi.stubGlobal("fetch", f);
    expect(await restorePairedDevice("a/b")).toBe("restored");
    expect(f.mock.calls[0][0]).toBe("/api/paired-devices/a%2Fb/restore");
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("POST");
    for (const status of [404, 409]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(status, { success: false, error: "x" })));
      expect(await restorePairedDevice("d")).toBe("unavailable");
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(500, { success: false, error: "boom" })));
    await expect(restorePairedDevice("d")).rejects.toThrow("boom");
  });

  it("deleteRevokedDevice: DELETEs /revoked/:id with the same mapping", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { success: true }));
    vi.stubGlobal("fetch", f);
    expect(await deleteRevokedDevice("d1")).toBe("deleted");
    expect(f.mock.calls[0][0]).toBe("/api/paired-devices/revoked/d1");
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(409, { success: false })));
    expect(await deleteRevokedDevice("d1")).toBe("unavailable");
  });

  it("removeCompanion: DELETEs /:id/companions/:companionId", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { success: true }));
    vi.stubGlobal("fetch", f);
    await removeCompanion("d1", "dk:AAAAAAAAAAAA");
    expect(f.mock.calls[0][0]).toBe(`/api/paired-devices/d1/companions/${encodeURIComponent("dk:AAAAAAAAAAAA")}`);
    expect(String(f.mock.calls[0][0])).toContain("dk%3A");
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });
});

describe("daysUntilPurge (retention 90 d from revokedAt, rounded up, never below 1)", () => {
  const DAY = 86_400_000;
  const NOW = 1_800_000_000_000;
  it("just revoked → 90; 89 d 12 h left → 90; exactly 89 d left → 89", () => {
    expect(REVOKED_RETENTION_DAYS).toBe(90);
    expect(daysUntilPurge(NOW, NOW)).toBe(90);
    expect(daysUntilPurge(NOW - DAY / 2, NOW)).toBe(90);
    expect(daysUntilPurge(NOW - DAY, NOW)).toBe(89);
  });
  it("under 24 h left → 1; the last millisecond → 1", () => {
    expect(daysUntilPurge(NOW - 89.5 * DAY, NOW)).toBe(1);
    expect(daysUntilPurge(NOW - 90 * DAY + 1, NOW)).toBe(1);
  });
  it("already past retention (a purge is due) still reads 1", () => {
    expect(daysUntilPurge(NOW - 91 * DAY, NOW)).toBe(1);
  });
});
