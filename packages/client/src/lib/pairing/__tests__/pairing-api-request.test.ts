/**
 * `requestAccess()` — same-origin `POST /api/pair/request`.
 * See change: add-lan-knock-pairing (test-plan #F6, #X3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePairWithCode } from "../pair-with-code.js";
import { requestAccess } from "../pairing-api.js";
import { encodePayloadString } from "../pairing-qr.js";

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

/**
 * Browser "Pair with code…" — the local half (`resolvePairWithCode`): refuse text for another server,
 * choose the first valid https origin of the payload, send nothing.
 * See change: group-servers-by-identity (test-plan #F8, G6).
 */
describe("resolvePairWithCode (#F8)", () => {
  const F = `sha256:${"F".repeat(43)}`;
  const G = `sha256:${"G".repeat(43)}`;
  const textFor = (id: string, urls: string[]) => encodePayloadString({ v: 1, id, code: "one-time", urls });

  it("refuses text whose fingerprint is not the card's, opens nothing, fetches nothing", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(resolvePairWithCode(textFor(G, ["https://b0x7.share.zrok.io"]), F)).toEqual({ ok: false, reason: "wrong-server" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens `<origin>/pair#<payload>` at the payload's own https origin (copy-string and deep link both accepted)", () => {
    const text = textFor(F, ["wss://b0x7.share.zrok.io", "https://b0x7.share.zrok.io"]);
    const r = resolvePairWithCode(text, F);
    expect(r).toEqual({ ok: true, origin: "https://b0x7.share.zrok.io", url: `https://b0x7.share.zrok.io/pair#${text}` });
    expect(resolvePairWithCode(`https://elsewhere.example/pair#${text}`, F)).toEqual(r); // the link's host is never trusted
  });

  it.each([
    ["only wss urls", ["wss://b0x7.share.zrok.io"]],
    ["userinfo", ["https://user:pw@b0x7.share.zrok.io"]],
    ["a path", ["https://b0x7.share.zrok.io/pair"]],
    ["an IP literal", ["https://10.0.0.5"]],
    ["localhost / .local", ["https://localhost", "https://studio.local"]],
    ["no urls", []],
  ])("refuses a payload with no valid https origin (%s)", (_n, urls) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(resolvePairWithCode(textFor(F, urls), F)).toEqual({ ok: false, reason: "no-https-origin" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips an invalid first https url and opens the second valid origin", () => {
    const r = resolvePairWithCode(textFor(F, ["https://10.0.0.5", "https://b0x7.share.zrok.io"]), F);
    expect(r.ok && r.origin).toBe("https://b0x7.share.zrok.io");
  });

  it.each(["", "not a payload", "pi:pair:v1.@@@", '{"id":1}'])("refuses text that is not a pairing payload (%j)", (text) => {
    expect(resolvePairWithCode(text, F)).toEqual({ ok: false, reason: "malformed" });
  });
});
