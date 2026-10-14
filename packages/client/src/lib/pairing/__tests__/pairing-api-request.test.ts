/**
 * `requestAccess()` — same-origin `POST /api/pair/request`.
 * See change: add-lan-knock-pairing (test-plan #F6, #X3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestAccess } from "../pairing-api.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("requestAccess", () => {
  it("posts JSON same-origin with the trimmed name and returns the knock", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) =>
      json(200, { success: true, data: { pendingId: "p1", confirmCode: "48217730", expiresAt: 123, fingerprint: "sha256:x" } }),
    );
    vi.stubGlobal("fetch", f);
    expect(await requestAccess("  Laptop ")).toEqual({
      ok: true,
      pendingId: "p1",
      confirmCode: "48217730",
      expiresAt: 123,
      fingerprint: "sha256:x",
    });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/pair/request");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Laptop" });
  });

  it("omits an empty name", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json(200, { success: true, data: { pendingId: "p", confirmCode: "1", expiresAt: 1, fingerprint: "f" } }));
    vi.stubGlobal("fetch", f);
    await requestAccess("   ");
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({});
  });

  it.each([
    [403, { success: false, error: "knock_disabled" }, { ok: false, error: "knock_disabled" }],
    [429, { success: false, error: "knock_rate_limited", retryAfter: 420 }, { ok: false, error: "knock_rate_limited", retryAfter: 420 }],
    [403, { error: "untrusted origin" }, { ok: false, error: "untrusted origin" }],
    [415, { success: false, error: "unsupported_media_type" }, { ok: false, error: "unsupported_media_type" }],
  ])("refusal %i maps to a typed result", async (status, body, want) => {
    vi.stubGlobal("fetch", vi.fn(async () => json(status, body)));
    expect(await requestAccess()).toEqual(want);
  });

  it("a transport failure rejects (the caller shows a retryable error)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    await expect(requestAccess()).rejects.toThrow("network down");
  });
});
