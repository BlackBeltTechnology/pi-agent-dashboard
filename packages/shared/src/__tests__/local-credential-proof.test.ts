/**
 * Pure proof primitive: grammar bounds (E1), dial-host mapping (E20), one mint
 * everywhere vector (E21), counter-proof round trip.
 *
 * See change: loopback-credential-proof (tasks 1.1-1.4).
 */
import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalBinding,
  deriveKey,
  httpProofHeaders,
  httpPurpose,
  isLoopbackLiteral,
  localDialHost,
  mintProof,
  parseProof,
  serverCounterProof,
  verifyCounterProof,
  verifyProofMac,
} from "../local-credential-proof.js";

const TOKEN = "tok-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const NONCE = "AAAAAAAAAAAAAAAAAAAAAA"; // 22
const MAC = "B".repeat(43);
const TS = "1760000000000"; // 13

afterEach(() => vi.restoreAllMocks());

describe("E1 grammar bounds", () => {
  const ok = `v1.${TS}.${NONCE}.${MAC}`;

  it("parses only the 13/22/43 v1 form", () => {
    expect(parseProof(ok)).toEqual({ ts: TS, nonce: NONCE, mac: MAC });
  });

  it.each([
    ["ts 12 digits", `v1.${TS.slice(1)}.${NONCE}.${MAC}`],
    ["ts 14 digits", `v1.${TS}0.${NONCE}.${MAC}`],
    ["nonce 21", `v1.${TS}.${NONCE.slice(1)}.${MAC}`],
    ["nonce 23", `v1.${TS}.${NONCE}A.${MAC}`],
    ["nonce with +", `v1.${TS}.${"A".repeat(21)}+.${MAC}`],
    ["mac 42", `v1.${TS}.${NONCE}.${MAC.slice(1)}`],
    ["mac 44", `v1.${TS}.${NONCE}.${MAC}B`],
    ["v2 prefix", `v2.${TS}.${NONCE}.${MAC}`],
    ["empty", ""],
  ])("rejects %s", (_n, v) => {
    const spy = vi.spyOn(crypto, "createHmac");
    expect(parseProof(v)).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("rejects non-strings", () => {
    expect(parseProof(undefined)).toBeUndefined();
    expect(parseProof(["x"])).toBeUndefined();
  });
});

describe("canonicalBinding", () => {
  it("canonicalises address literals", () => {
    expect(canonicalBinding("127.0.0.1", 9)).toBe("127.0.0.1:9");
    expect(canonicalBinding("::ffff:127.0.0.1", 9)).toBe("127.0.0.1:9");
    expect(canonicalBinding("::1", 9)).toBe("[::1]:9");
    expect(canonicalBinding("[::1]", 9)).toBe("[::1]:9");
    expect(canonicalBinding("FE80::1", 9)).toBe("[fe80::1]:9");
  });

  it("rejects host names", () => {
    expect(() => canonicalBinding("localhost", 9)).toThrow();
  });
});

describe("E20 localDialHost / isLoopbackLiteral", () => {
  it.each([
    ["0.0.0.0", "127.0.0.1", true],
    ["::", "127.0.0.1", true],
    ["localhost", "127.0.0.1", true],
    ["::1", "[::1]", true],
    ["127.0.0.5", "127.0.0.5", true],
    ["192.168.1.5", "192.168.1.5", false],
  ])("%s → %s (loopback %s)", (bind, dial, loop) => {
    expect(localDialHost(bind)).toBe(dial);
    expect(isLoopbackLiteral(localDialHost(bind))).toBe(loop);
  });
});

describe("a DNS-name bind host still yields an IP-literal dial (harden-credential-proof-binding 3.1)", () => {
  it("maps a name to 127.0.0.1 so the binding never throws", () => {
    expect(localDialHost("myhost.example")).toBe("127.0.0.1");
    expect(localDialHost("MyHost.Local")).toBe("127.0.0.1");
    expect(() => canonicalBinding(localDialHost("myhost.example"), 8000)).not.toThrow();
    expect(isLoopbackLiteral(localDialHost("myhost.example"))).toBe(true);
  });

  it("an IP literal is left alone", () => {
    expect(localDialHost("192.168.1.5")).toBe("192.168.1.5");
    expect(localDialHost("fe80::1")).toBe("[fe80::1]");
    expect(localDialHost("[fe80::1]")).toBe("[fe80::1]");
    expect(localDialHost(" [::1] ")).toBe("[::1]");
  });

  it("httpProofHeaders for the dial host of a name bind mints a proof", () => {
    const url = `http://${localDialHost("myhost.example")}:8000/api/x`;
    expect(() => httpProofHeaders("tok", url, "GET")).not.toThrow();
  });
});

describe("mint / verify / counter-proof", () => {
  const binding = "127.0.0.1:9999";

  it("round-trips a proof and a counter-proof", () => {
    const p = mintProof({ token: TOKEN, binding, purpose: "bridge" });
    const parsed = parseProof(p.header);
    expect(parsed).toBeDefined();
    const key = deriveKey(TOKEN);
    expect(verifyProofMac(key, parsed!, binding, "bridge")).toBe(true);
    expect(verifyProofMac(key, parsed!, "127.0.0.1:9998", "bridge")).toBe(false);
    expect(verifyProofMac(key, parsed!, binding, httpPurpose("GET", "/x"))).toBe(false);
    const header = serverCounterProof({ token: TOKEN, binding, nonce: p.nonce, mac: p.mac });
    expect(verifyCounterProof({ token: TOKEN, binding, nonce: p.nonce, mac: p.mac, header })).toBe(true);
    expect(verifyCounterProof({ token: TOKEN, binding: "127.0.0.1:1", nonce: p.nonce, mac: p.mac, header })).toBe(false);
    expect(verifyCounterProof({ token: TOKEN, binding, nonce: p.nonce, mac: p.mac, header: `v1.${"x".repeat(43)}` })).toBe(false);
    expect(verifyCounterProof({ token: TOKEN, binding, nonce: p.nonce, mac: p.mac, header: undefined })).toBe(false);
  });

  it("uses a fresh nonce per mint", () => {
    const a = mintProof({ token: TOKEN, binding, purpose: "bridge" });
    const b = mintProof({ token: TOKEN, binding, purpose: "bridge" });
    expect(a.nonce).not.toBe(b.nonce);
  });
});

describe("E21 fixed vector", () => {
  it("mints a stable header (pinned so reload-all.sh inline copy can match)", () => {
    const p = mintProof({
      token: "vector-token",
      binding: "127.0.0.1:8000",
      purpose: httpPurpose("get", "/api/sessions?a=1"),
      now: 1760000000000,
      nonce: "AAAAAAAAAAAAAAAAAAAAAA",
    });
    expect(p.header).toBe(VECTOR_HEADER);
  });
});

// Computed once from the reference implementation; re-pin ONLY on a deliberate
// wire-format change (and update scripts/reload-all.sh in the same commit).
const VECTOR_HEADER =
  "v1.1760000000000.AAAAAAAAAAAAAAAAAAAAAA.Up8ranWviPNpooRhD_OQ0bmm91V27wk-lxCb07z_HKk";
