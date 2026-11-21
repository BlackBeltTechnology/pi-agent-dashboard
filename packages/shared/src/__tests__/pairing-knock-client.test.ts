/**
 * Shared knock client: injectable prove hook, split prove/knock, refusal copy,
 * device-name body. See change: add-electron-server-windows (test-plan E41–E43).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeDisplayName } from "../display-name.js";
import { KNOCK_REFUSAL_GENERIC, knockRefusalCopy } from "../pairing-knock.js";
import { knockRequestBody, knockServerWith, proveExpected, redeemPairingCode, sendKnock } from "../pairing-knock-client.js";

const BASE = "http://192.168.16.204:8000";
const F = "sha256:F";
const G = "sha256:G";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const knockOk = (fingerprint = F) =>
  json(200, { success: true, data: { pendingId: "p1", confirmCode: "12345678", expiresAt: 1_000_000, fingerprint } });
const hooks = () => ({ now: () => 0, sleep: vi.fn(async () => {}) });

function stubFetch(request: () => Response, polls: unknown[] = [{ status: "approved", token: "T" }]) {
  const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/pair/request")) return request();
    if (u.endsWith("/api/pair/poll")) return json(200, { success: true, data: polls.shift() ?? { status: "pending" } });
    return json(404, {});
  });
  vi.stubGlobal("fetch", f);
  return f;
}
afterEach(() => vi.unstubAllGlobals());

describe("knockServerWith (E41 — injected prover)", () => {
  it("uses the injected prover; approved path unchanged", async () => {
    const prove = vi.fn(async () => ({ proven: F }));
    stubFetch(() => knockOk());
    expect(await knockServerWith(prove, BASE, F, "Laptop", hooks())).toEqual({ status: "approved", token: "T", fingerprint: F });
    expect(prove).toHaveBeenCalledWith(BASE);
  });

  it("a refusing prover is an identity mismatch with proven null; no knock", async () => {
    const f = stubFetch(() => knockOk());
    const out = await knockServerWith(async () => ({ refused: "challenge answered 404" }), BASE, F, "x", hooks());
    expect(out).toEqual({ status: "identity_mismatch", expected: F, proven: null, stage: "challenge" });
    expect(f).not.toHaveBeenCalled();
  });

  it("proveExpected: proven ≠ expected ⇒ mismatch naming both; equal ⇒ fingerprint", async () => {
    expect(await proveExpected(BASE, F, async () => ({ proven: G }))).toMatchObject({ status: "identity_mismatch", expected: F, proven: G });
    expect(await proveExpected(BASE, F, async () => ({ proven: F }))).toEqual({ fingerprint: F });
  });

  it("sendKnock: response fingerprint G after proving F ⇒ mismatch(response), poll never called (E4)", async () => {
    const f = stubFetch(() => knockOk(G));
    expect(await sendKnock(BASE, F, "x", hooks())).toMatchObject({ status: "identity_mismatch", stage: "response", expected: F, proven: G });
    expect(f.mock.calls.some(([u]) => String(u).endsWith("/api/pair/poll"))).toBe(false);
  });

  it("redirect hook is forwarded to every request", async () => {
    const f = stubFetch(() => knockOk());
    await sendKnock(BASE, F, "x", { ...hooks(), redirect: "manual" });
    for (const [, init] of f.mock.calls) expect((init as RequestInit).redirect).toBe("manual");
  });
});

describe("refusal wording (E42)", () => {
  it("known codes share the landing copy; unknown/host_not_admitted ⇒ generic", () => {
    expect(knockRefusalCopy("knock_not_lan").fallback).toMatch(/same local network/);
    expect(knockRefusalCopy("knock_rate_limited").fallback).toContain("{time}");
    for (const r of ["host_not_admitted", "unknown", undefined, "http_404"]) expect(knockRefusalCopy(r)).toBe(KNOCK_REFUSAL_GENERIC);
  });

  it("HTTP 404 on /api/pair/request ⇒ refused unknown", async () => {
    stubFetch(() => json(404, {}));
    expect(await sendKnock(BASE, F, "x", hooks())).toMatchObject({ status: "refused", reason: "unknown", httpStatus: 404 });
  });
});

describe("browser compatibility (CodeRabbit)", () => {
  it("knockRequestBody / sanitizeDisplayName work without a global Buffer", () => {
    vi.stubGlobal("Buffer", undefined);
    try {
      expect(knockRequestBody("é".repeat(40)).name).toBe("é".repeat(32));
      expect(sanitizeDisplayName("a".repeat(100), "h")).toHaveLength(64);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("device name (E43)", () => {
  it("empty / whitespace ⇒ {}", () => {
    expect(knockRequestBody("")).toEqual({});
    expect(knockRequestBody("   ")).toEqual({});
  });
  it("200 chars ⇒ ≤ 64 bytes", () => {
    const body = knockRequestBody("a".repeat(200));
    expect(Buffer.byteLength(body.name ?? "")).toBeLessThanOrEqual(64);
    expect(body.name).toHaveLength(64);
  });
  it("sanitizeDisplayName is a char-boundary truncation", () => {
    const s = sanitizeDisplayName("é".repeat(40), "fb"); // 80 bytes
    expect(Buffer.byteLength(s)).toBeLessThanOrEqual(64);
    expect(s).toBe("é".repeat(32));
  });
});

describe("hostile peer bounds (audit)", () => {
  const big = () => new Response(JSON.stringify({ success: true, data: { pad: "x".repeat(20_000) } }), { status: 200 });

  it("an oversize knock answer is a refusal, not an unbounded read", async () => {
    stubFetch(() => big());
    expect(await sendKnock(BASE, F, "x", hooks())).toMatchObject({ status: "refused", reason: "unknown" });
  });

  it("a malformed confirm code / expiry is a refusal; nothing is polled", async () => {
    for (const data of [
      { pendingId: "p", confirmCode: "12ab5678", expiresAt: 1_000_000, fingerprint: F },
      { pendingId: "p", confirmCode: "12345678", expiresAt: "soon", fingerprint: F },
      { confirmCode: "12345678", expiresAt: 1_000_000, fingerprint: F },
    ]) {
      const f = stubFetch(() => json(200, { success: true, data }));
      expect(await sendKnock(BASE, F, "x", hooks())).toMatchObject({ status: "refused" });
      expect(f.mock.calls.some(([u]) => String(u).endsWith("/api/pair/poll"))).toBe(false);
    }
  });

  it("a far-future expiresAt is clamped so a peer cannot keep the poll loop alive indefinitely", async () => {
    stubFetch(() => json(200, { success: true, data: { pendingId: "p", confirmCode: "12345678", expiresAt: 9e15, fingerprint: F } }), []);
    const onWaiting = vi.fn();
    // always pending; once "now" passes the clamped expiry the loop ends as expired
    let t = 0;
    const out = await sendKnock(BASE, F, "x", { onWaiting, now: () => t, sleep: async () => { t += 10 * 60_000; } });
    expect(out).toEqual({ status: "expired" });
    expect(onWaiting.mock.calls[0]![0].expiresAt).toBeLessThanOrEqual(30 * 60_000);
  });

  it("a non-string or oversize bearer is never accepted as approval", async () => {
    stubFetch(() => knockOk(), [{ status: "approved", token: 12345 }]);
    expect(await sendKnock(BASE, F, "x", hooks())).toEqual({ status: "expired" });
    stubFetch(() => knockOk(), [{ status: "approved", token: "t".repeat(5000) }]);
    expect(await sendKnock(BASE, F, "x", hooks())).toEqual({ status: "expired" });
  });
});

describe("approved poll carries validated routes (D7, #E6)", () => {
  const approvedWith = (routes: unknown) => [{ status: "approved", token: "T", ...(routes === undefined ? {} : { routes }) }];
  const run = async (routes: unknown) => {
    stubFetch(() => knockOk(), approvedWith(routes));
    return knockServerWith(async () => ({ proven: F }), BASE, F, "Laptop", hooks());
  };

  it("#E6 carries the valid https origins, normalised, in delivery order", async () => {
    expect(await run(["https://k3x9p2.share.zrok.io/", "https://lab.example.org"])).toEqual({
      status: "approved",
      token: "T",
      fingerprint: F,
      routes: ["https://k3x9p2.share.zrok.io", "https://lab.example.org"],
    });
  });

  it("#E6 hostile entries are dropped, the valid one kept", async () => {
    const out = await run([
      "https://10.0.0.5",
      "https://[fd12::4]",
      "https://localhost",
      "https://printer.local",
      "https://user:pw@host.example",
      "https://host.example/path",
      "https://host.example?a=1",
      "https://host.example#x",
      "http://host.example",
      "wss://host.example",
      "https://k3x9p2.share.zrok.io",
    ]);
    expect(out).toMatchObject({ status: "approved", routes: ["https://k3x9p2.share.zrok.io"] });
  });

  it("#E6 9 valid routes → the first 8", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `https://h${i}.example`);
    const out = await run(nine);
    expect(out).toMatchObject({ status: "approved", routes: nine.slice(0, 8) });
  });

  it.each([[undefined], [[]], ["https://a.example"], [{ 0: "https://a.example" }], [42], [["http://only.example"]]])(
    "no usable routes (%j) → approved without a routes key",
    async (routes) => {
      expect(await run(routes)).toEqual({ status: "approved", token: "T", fingerprint: F });
    },
  );
});

// See change: device-key-mutual-check (task 4.3, D3): the knock/redeem carries a device key bound to a fresh challenge.
describe("device key on knock and redeem (4.3)", () => {
  const NONCE = "N".repeat(43);
  const NONCE2 = "M".repeat(43);
  const SIGNED = { pub: "P".repeat(43), sig: "S".repeat(86) };
  const bodyOf = (f: ReturnType<typeof stubFetch>, path: string) => {
    const call = f.mock.calls.find(([u]) => String(u).endsWith(path));
    return JSON.parse(String(((call as unknown[])[1] as RequestInit).body));
  };
  const redeemFetch = () => {
    const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/pair/redeem")) return json(200, { success: true, data: { pendingId: "p1", confirmCode: "12345678" } });
      if (u.endsWith("/api/pair/poll")) return json(200, { success: true, data: { status: "approved", token: "T" } });
      return json(404, {});
    });
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("knockServerWith: reuses the fresh proving challenge, signs over its deviceNonce, sends deviceKey", async () => {
    const f = stubFetch(() => knockOk());
    const prove = vi.fn(async () => ({ proven: F, deviceNonce: NONCE }));
    const sign = vi.fn(async () => SIGNED);
    await knockServerWith(prove, BASE, F, "Laptop", { ...hooks(), deviceKey: { sign } });
    expect(prove).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledWith(F, NONCE);
    expect(bodyOf(f, "/api/pair/request")).toEqual({ name: "Laptop", deviceKey: { deviceNonce: NONCE, ...SIGNED } });
  });

  it("no provider ⇒ body byte-identical to before (no deviceKey member)", async () => {
    const f = stubFetch(() => knockOk());
    await knockServerWith(async () => ({ proven: F, deviceNonce: NONCE }), BASE, F, "Laptop", hooks());
    expect(bodyOf(f, "/api/pair/request")).toEqual({ name: "Laptop" });
    expect(JSON.stringify(bodyOf(f, "/api/pair/request"))).not.toContain("deviceKey");
  });

  it("challenge without deviceNonce (older server) ⇒ no key, sign never called", async () => {
    const f = stubFetch(() => knockOk());
    const sign = vi.fn(async () => SIGNED);
    await knockServerWith(async () => ({ proven: F }), BASE, F, "x", { ...hooks(), deviceKey: { sign } });
    expect(sign).not.toHaveBeenCalled();
    expect(bodyOf(f, "/api/pair/request")).toEqual({ name: "x" });
  });

  it("provider that holds no key (sign → null) ⇒ knock without deviceKey", async () => {
    const f = stubFetch(() => knockOk());
    await knockServerWith(async () => ({ proven: F, deviceNonce: NONCE }), BASE, F, "x", { ...hooks(), deviceKey: { sign: async () => null } });
    expect(bodyOf(f, "/api/pair/request")).toEqual({ name: "x" });
  });

  it("a throwing signer never blocks the knock", async () => {
    const f = stubFetch(() => knockOk());
    await knockServerWith(async () => ({ proven: F, deviceNonce: NONCE }), BASE, F, "x", {
      ...hooks(),
      deviceKey: {
        sign: async () => {
          throw new Error("boom");
        },
      },
    });
    expect(bodyOf(f, "/api/pair/request")).toEqual({ name: "x" });
  });

  it("sendKnock after a pause: a challenge older than 30 s is re-run and the new nonce is signed", async () => {
    const f = stubFetch(() => knockOk());
    const t = 100_000;
    const prove = vi.fn(async () => ({ proven: F, deviceNonce: NONCE2 }));
    const sign = vi.fn(async () => SIGNED);
    await sendKnock(BASE, F, "x", {
      now: () => t,
      sleep: vi.fn(async () => {}),
      deviceKey: { sign, prove, challenge: { deviceNonce: NONCE, at: t - 30_001 } },
    });
    expect(prove).toHaveBeenCalledWith(BASE);
    expect(sign).toHaveBeenCalledWith(F, NONCE2);
    expect(bodyOf(f, "/api/pair/request").deviceKey.deviceNonce).toBe(NONCE2);
  });

  it("sendKnock: a challenge exactly inside 30 s is reused (no second challenge)", async () => {
    const f = stubFetch(() => knockOk());
    const t = 100_000;
    const prove = vi.fn(async () => ({ proven: F, deviceNonce: NONCE2 }));
    const sign = vi.fn(async () => SIGNED);
    await sendKnock(BASE, F, "x", {
      now: () => t,
      sleep: vi.fn(async () => {}),
      deviceKey: { sign, prove, challenge: { deviceNonce: NONCE, at: t - 29_999 } },
    });
    expect(prove).not.toHaveBeenCalled();
    expect(bodyOf(f, "/api/pair/request").deviceKey.deviceNonce).toBe(NONCE);
  });

  it("re-challenge that proves a different fingerprint ⇒ identity_mismatch, nothing is sent", async () => {
    const f = stubFetch(() => knockOk());
    const out = await sendKnock(BASE, F, "x", {
      ...hooks(),
      deviceKey: { sign: async () => SIGNED, prove: async () => ({ proven: G, deviceNonce: NONCE }) },
    });
    expect(out).toMatchObject({ status: "identity_mismatch", expected: F, proven: G, stage: "challenge" });
    expect(f).not.toHaveBeenCalled();
  });

  it("re-challenge that fails (refused or throws) ⇒ knock proceeds without a key", async () => {
    for (const prove of [async () => ({ refused: "no" }), async () => { throw new Error("net"); }]) {
      const f = stubFetch(() => knockOk());
      await sendKnock(BASE, F, "x", { ...hooks(), deviceKey: { sign: async () => SIGNED, prove } });
      expect(bodyOf(f, "/api/pair/request")).toEqual({ name: "x" });
    }
  });

  it("sendKnock with a provider but neither a challenge nor a prover ⇒ no key", async () => {
    const f = stubFetch(() => knockOk());
    await sendKnock(BASE, F, "x", { ...hooks(), deviceKey: { sign: async () => SIGNED } });
    expect(bodyOf(f, "/api/pair/request")).toEqual({ name: "x" });
  });

  it("redeemPairingCode: re-challenges and sends deviceKey beside the code", async () => {
    const f = redeemFetch();
    const prove = vi.fn(async () => ({ proven: F, deviceNonce: NONCE }));
    const sign = vi.fn(async () => SIGNED);
    await redeemPairingCode(BASE, F, "482913", { ...hooks(), deviceKey: { sign, prove } });
    expect(bodyOf(f as never, "/api/pair/redeem")).toEqual({ code: "482913", deviceKey: { deviceNonce: NONCE, ...SIGNED } });
  });

  it("redeemPairingCode without a provider keeps the body {code}", async () => {
    const f = redeemFetch();
    await redeemPairingCode(BASE, F, "482913", hooks());
    expect(bodyOf(f as never, "/api/pair/redeem")).toEqual({ code: "482913" });
  });
});
