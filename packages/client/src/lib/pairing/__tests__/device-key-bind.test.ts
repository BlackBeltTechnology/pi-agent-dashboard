/** X5 browser parts: `bindDeviceKeyOnce` with injected key store + challenge. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindDeviceKeyOnce, resetDeviceKeyBindForTests } from "../device-key-bind.js";
import type { IdentityProof } from "../pair-protocol.js";

const FP = "sha256:F";
const proof = (over: Partial<IdentityProof> = {}): IdentityProof => ({ fingerprint: FP, publicKey: "pk", verified: true, deviceNonce: "n".repeat(43), ...over });
const mkKeys = (over: { supported?: boolean; held?: boolean } = {}) => {
  const held = new Set<string>(over.held ? [FP] : []);
  return {
    held,
    detect: vi.fn(async () => over.supported ?? true),
    hasKey: vi.fn(async (fp: string) => held.has(fp)),
    ensureKey: vi.fn(async (fp: string) => (held.add(fp), "P".repeat(43))),
    discardKey: vi.fn(async (fp: string) => void held.delete(fp)),
    signDevbind: vi.fn(async (fp: string, n: string) => (held.has(fp) ? { deviceNonce: n, pub: "P".repeat(43), sig: "S".repeat(86) } : null)),
  };
};
const ok = () => vi.fn(async () => new Response("{}", { status: 200 }));
beforeEach(() => resetDeviceKeyBindForTests());

describe("bindDeviceKeyOnce", () => {
  it("cookie credential: one POST with credentials same-origin and no Authorization", async () => {
    const keys = mkKeys();
    const fetchImpl = ok();
    const out = await bindDeviceKeyOnce({ route: "https://r/", credential: { cookie: true }, fingerprint: FP, fetchImpl: fetchImpl as never, prove: async () => proof(), keys });
    expect(out).toBe("bound");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://r/api/pair/device-key");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    expect(keys.signDevbind).toHaveBeenCalledWith(FP, "n".repeat(43));
  });

  it("unsupported page: zero challenge, zero requests, no key", async () => {
    const keys = mkKeys({ supported: false });
    const prove = vi.fn();
    const fetchImpl = ok();
    expect(await bindDeviceKeyOnce({ route: "https://r", credential: { bearer: "C" }, fetchImpl: fetchImpl as never, prove, keys })).toBe("unsupported");
    expect(prove).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(keys.ensureKey).not.toHaveBeenCalled();
  });

  it("older server (no deviceNonce) or unproven route: no key, no POST", async () => {
    for (const p of [proof({ deviceNonce: undefined }), proof({ fingerprint: "sha256:other" })]) {
      resetDeviceKeyBindForTests();
      const keys = mkKeys();
      const fetchImpl = ok();
      expect(await bindDeviceKeyOnce({ route: "https://r", credential: { bearer: "C" }, fingerprint: FP, fetchImpl: fetchImpl as never, prove: async () => p, keys })).toBe("failed");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(keys.ensureKey).not.toHaveBeenCalled();
    }
  });

  it("at most one attempt per route per start; another route is independent", async () => {
    const fetchImpl = ok();
    const args = { credential: { bearer: "C" }, fetchImpl: fetchImpl as never, prove: async () => proof() };
    expect(await bindDeviceKeyOnce({ ...args, route: "https://r1", keys: mkKeys() })).toBe("bound");
    expect(await bindDeviceKeyOnce({ ...args, route: "https://r1", keys: mkKeys() })).toBe("already-attempted");
    expect(await bindDeviceKeyOnce({ ...args, route: "https://r2", keys: mkKeys() })).toBe("bound");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([[400], [401], [409], [500]])("HTTP %i → failed and the freshly created key is dropped", async (status) => {
    const keys = mkKeys();
    const fetchImpl = vi.fn(async () => new Response("{}", { status }));
    expect(await bindDeviceKeyOnce({ route: "https://r", credential: { bearer: "C" }, fetchImpl: fetchImpl as never, prove: async () => proof(), keys })).toBe("failed");
    expect(keys.held.has(FP)).toBe(false);
  });

  it("a key already held is never touched", async () => {
    const keys = mkKeys({ held: true });
    const fetchImpl = ok();
    expect(await bindDeviceKeyOnce({ route: "https://r", credential: { bearer: "C" }, fetchImpl: fetchImpl as never, prove: async () => proof(), keys })).toBe("key-held");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(keys.discardKey).not.toHaveBeenCalled();
  });
});
