import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DeviceCheckKeys, runDeviceCheck } from "../device-check.js";
import type { IdentityProof } from "../pair-protocol.js";

const FP = "sha256:serverB";
const NONCE = "n".repeat(43);
const R = (i: number) => `https://r${i}.example`;
const proven = (fingerprint = FP, deviceNonce: string | null = NONCE): IdentityProof => ({ fingerprint, publicKey: "pk", verified: true, ...(deviceNonce ? { deviceNonce } : {}) });
const keysHeld = (held = true): DeviceCheckKeys & { signs: ReturnType<typeof vi.fn> } => {
  const signs = vi.fn(async (_fp: string, n: string) => (held ? { deviceNonce: n, pub: "P".repeat(43), sig: "S".repeat(86) } : null));
  return { hasKey: async () => held, signDevcheck: signs, signs };
};
const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("X1 proof only after the route proved the server", () => {
  it("one POST to the proven route, none to R2–R5 (other fp / timeout / 500 / 403)", async () => {
    const fetchImpl = vi.fn(async () => reply(200, { status: "paired", scope: "full", tier: "control" }));
    const outcomes: Record<string, () => Promise<IdentityProof>> = {
      [R(1)]: async () => proven(),
      [R(2)]: async () => proven("sha256:other"),
      [R(3)]: async () => { throw new Error("aborted"); },
      [R(4)]: async () => { throw new Error("request failed (500)"); },
      [R(5)]: async () => { throw new Error("network_not_allowed"); },
    };
    const keys = keysHeld();
    const results = await Promise.all(
      Object.keys(outcomes).map((route) =>
        runDeviceCheck({ route, fingerprint: FP, fetchImpl: fetchImpl as unknown as typeof fetch, prove: (r) => outcomes[r](), keys }),
      ),
    );
    expect(results[0]).toEqual({ kind: "answer", status: "paired", scope: "full", tier: "control" });
    for (const r of results.slice(1)) expect(r).toEqual({ kind: "no-answer" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${R(1)}/api/pair/device-status`);
    expect(JSON.parse(String(init.body))).toEqual({ deviceNonce: NONCE, pub: "P".repeat(43), sig: "S".repeat(86) });
  });

  it("an unverified signature is not a proven route", async () => {
    const fetchImpl = vi.fn();
    const out = await runDeviceCheck({ route: R(1), fingerprint: FP, fetchImpl: fetchImpl as never, prove: async () => ({ ...proven(), verified: false }), keys: keysHeld() });
    expect(out).toEqual({ kind: "no-answer" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no key held → the challenge only, no proof request", async () => {
    const fetchImpl = vi.fn();
    const prove = vi.fn(async () => proven());
    const keys = keysHeld(false);
    const out = await runDeviceCheck({ route: R(1), fingerprint: FP, fetchImpl: fetchImpl as never, prove, keys });
    expect(prove).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(keys.signs).not.toHaveBeenCalled();
    expect(out.kind).not.toBe("answer");
  });
});

describe("X2 degraded replies", () => {
  const run = (fetchImpl: unknown, prove = async () => proven()) =>
    runDeviceCheck({ route: R(1), fingerprint: FP, fetchImpl: fetchImpl as typeof fetch, prove, keys: keysHeld() });

  it("challenge without deviceNonce → no-nonce, no proof sent", async () => {
    const fetchImpl = vi.fn();
    expect(await run(fetchImpl, async () => proven(FP, null))).toEqual({ kind: "no-nonce" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["connection reset", () => Promise.reject(new TypeError("reset")), { kind: "no-answer" }],
    ["500", async () => reply(500, { status: "paired", scope: "full", tier: "operate" }), { kind: "answer", status: "unverified" }],
    ["non-JSON", async () => reply(200, "<html>"), { kind: "answer", status: "unverified" }],
    ["unrecognised status", async () => reply(200, { status: "weird" }), { kind: "answer", status: "unverified" }],
    ["unverified", async () => reply(200, { status: "unverified" }), { kind: "answer", status: "unverified" }],
  ])("%s never reads as an answer that changes state", async (_n, impl, expected) => {
    expect(await run(vi.fn(impl))).toEqual(expected);
  });

  it("never touches the credential or key stores", async () => {
    const keys = { ...keysHeld(), discardKey: vi.fn() };
    await runDeviceCheck({ route: R(1), fingerprint: FP, fetchImpl: (async () => reply(200, { status: "unknown" })) as never, prove: async () => proven(), keys });
    expect(keys.discardKey).not.toHaveBeenCalled();
  });
});

describe("X3 check stalls (fake timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));

  it("device-status: pending at 1.9 s, aborted at 2.0 s → no-answer", async () => {
    let done = false;
    const p = runDeviceCheck({ route: R(1), fingerprint: FP, fetchImpl: hang as never, prove: async () => proven(), keys: keysHeld() }).then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(1_900);
    expect(done).toBe(false);
    expect((hang.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect((hang.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(await p).toEqual({ kind: "no-answer" });
  });

  it("challenge is handed the 2 s timeout; a stalled challenge sends nothing", async () => {
    const fetchImpl = vi.fn();
    const prove = vi.fn((_r: string, ms: number) => new Promise<IdentityProof>((_res, rej) => setTimeout(() => rej(new Error("timeout")), ms)));
    const p = runDeviceCheck({ route: R(1), fingerprint: FP, fetchImpl: fetchImpl as never, prove, keys: keysHeld() });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(prove.mock.calls[0][1]).toBe(2_000);
    expect(await p).toEqual({ kind: "no-answer" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the next check re-runs both steps", async () => {
    const prove = vi.fn(async () => proven());
    const fetchImpl = vi.fn(async () => reply(200, { status: "revoked" }));
    for (let i = 0; i < 2; i++) await runDeviceCheck({ route: R(1), fingerprint: FP, fetchImpl: fetchImpl as never, prove, keys: keysHeld() });
    expect(prove).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
