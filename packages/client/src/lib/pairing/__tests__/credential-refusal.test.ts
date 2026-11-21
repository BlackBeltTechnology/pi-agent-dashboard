/** X4 / X19 helper level: never discard on an answer; unknown + credential → verify with the next call. */
import { describe, expect, it, vi } from "vitest";
import { discardRefusedCredential, resolveUnknownWithCredential } from "../credential-refusal.js";
import type { IdentityProof } from "../pair-protocol.js";

const FP = "sha256:F";
const proof = (fingerprint = FP): IdentityProof => ({ fingerprint, publicKey: "pk", verified: true, deviceNonce: "n".repeat(43) });
const setup = () => ({ clearCredential: vi.fn(), discardKeyFn: vi.fn(async () => {}) });

describe("discardRefusedCredential", () => {
  it("proven route: credential and key F discarded together", async () => {
    const d = setup();
    expect(await discardRefusedCredential({ route: "https://r", fingerprint: FP, prove: async () => proof(), ...d })).toBe("discarded");
    expect(d.clearCredential).toHaveBeenCalledTimes(1);
    expect(d.discardKeyFn).toHaveBeenCalledWith(FP);
  });
  it.each([
    ["other fingerprint", async () => proof("sha256:other")],
    ["challenge failure", async () => { throw new Error("timeout"); }],
    ["unverified signature", async () => ({ ...proof(), verified: false })],
  ])("unproven route (%s): nothing discarded", async (_n, prove) => {
    const d = setup();
    expect(await discardRefusedCredential({ route: "https://r", fingerprint: FP, prove, ...d })).toBe("kept");
    expect(d.clearCredential).not.toHaveBeenCalled();
    expect(d.discardKeyFn).not.toHaveBeenCalled();
  });
});

describe("resolveUnknownWithCredential (X4)", () => {
  const base = () => ({ route: "https://r", fingerprint: FP, credential: { bearer: "C" }, prove: async () => proof(), ...setup() });

  it("refused at a proven route → credential + key discarded, no bind", async () => {
    const o = { ...base(), authenticatedCall: async () => "refused" as const, bind: vi.fn() };
    expect(await resolveUnknownWithCredential(o)).toEqual({ kind: "discarded" });
    expect(o.clearCredential).toHaveBeenCalled();
    expect(o.discardKeyFn).toHaveBeenCalledWith(FP);
    expect(o.bind).not.toHaveBeenCalled();
  });

  it("refused at an unproven route → nothing discarded", async () => {
    const o = { ...base(), prove: async () => proof("sha256:other"), authenticatedCall: async () => "refused" as const };
    expect(await resolveUnknownWithCredential(o)).toEqual({ kind: "kept" });
    expect(o.clearCredential).not.toHaveBeenCalled();
    expect(o.discardKeyFn).not.toHaveBeenCalled();
  });

  it("accepted → key pending and exactly one bind; nothing discarded", async () => {
    const bind = vi.fn(async (_o: Record<string, unknown>) => "bound" as const);
    const o = { ...base(), authenticatedCall: async () => "accepted" as const, bind: bind as never };
    expect(await resolveUnknownWithCredential(o)).toEqual({ kind: "key-pending", bind: "bound" });
    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind.mock.calls[0][0]).toMatchObject({ route: "https://r", credential: { bearer: "C" }, fingerprint: FP });
    expect(o.clearCredential).not.toHaveBeenCalled();
  });

  it("transport error → inconclusive, nothing changes", async () => {
    const bind = vi.fn();
    const o = { ...base(), authenticatedCall: async () => "error" as const, bind };
    expect(await resolveUnknownWithCredential(o)).toEqual({ kind: "inconclusive" });
    expect(o.clearCredential).not.toHaveBeenCalled();
    expect(o.discardKeyFn).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
  });
});
