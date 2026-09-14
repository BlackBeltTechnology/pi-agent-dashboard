/**
 * F5 (test-plan, mcp-legacy-clients-and-token-issuance): the create-token API
 * helper POSTs the label to `/api/paired-devices` and unwraps the
 * `{ device, token }` payload from the standard `data` envelope.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPairedDevice } from "../paired-devices-api.js";

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

    const result = await createPairedDevice("cli");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/paired-devices$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ label: "cli" });
    expect(result).toEqual({ device: DEVICE, token: TOKEN });
  });

  it("throws on a non-success envelope", async () => {
    vi.stubGlobal("fetch", mockFetch(false));
    await expect(createPairedDevice("cli")).rejects.toThrow("operator credential required");
  });
});
