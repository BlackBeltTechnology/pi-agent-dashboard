/**
 * Local credential verifier: window, floor, binding, replay, caps, header
 * shapes, legacy limiter (test-plan E1-E11).
 *
 * See change: loopback-credential-proof (tasks 2.1-2.11).
 */
import crypto from "node:crypto";
import {
  BRIDGE_PURPOSE,
  canonicalBinding,
  mintProof,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CredentialListener,
  createLocalCredentialVerifier,
  credentialVerdict,
  hasLocalCredential,
  listenWithProofFloor,
  type StampableRequest,
} from "../auth/local-credential.js";

const TOKEN = "unit-token-0123456789abcdefghijklmnopqrstuvwxyz";
const P = 41000;
const T = 1_760_000_000_000;

function setup(over: { now?: () => number; acceptLegacyToken?: boolean; maxNonces?: number; log?: (l: string) => void } = {}) {
  let clock = T;
  const v = createLocalCredentialVerifier({
    token: TOKEN,
    now: over.now ?? (() => clock),
    acceptLegacyToken: over.acceptLegacyToken ?? true,
    maxNonces: over.maxNonces,
    log: over.log ?? (() => {}),
  });
  return { v, setClock: (n: number) => (clock = n), clock: () => clock };
}

const listener = (boundAt = T - 3_600_000, kind: "bridge" | "http" = "bridge"): CredentialListener => ({
  kind,
  boundAt,
  port: P,
});

function req(
  headers: Record<string, unknown>,
  socket: { localAddress?: string; localPort?: number } = { localAddress: "127.0.0.1", localPort: P },
  extra: { method?: string; url?: string } = {},
): StampableRequest {
  return { headers: { host: `127.0.0.1:${P}`, ...headers }, socket, ...extra };
}

function proofHeader(ts: number, over: { binding?: string; purpose?: string; nonce?: string } = {}) {
  return mintProof({
    token: TOKEN,
    binding: over.binding ?? canonicalBinding("127.0.0.1", P),
    purpose: over.purpose ?? BRIDGE_PURPOSE,
    now: ts,
    nonce: over.nonce,
  }).header;
}

afterEach(() => vi.restoreAllMocks());

describe("E1 malformed input rejected before any HMAC", () => {
  it.each([
    "v1.123456789012.AAAAAAAAAAAAAAAAAAAAAA." + "B".repeat(43),
    "v1.1760000000000.AAAAAAAAAAAAAAAAAAAAA." + "B".repeat(43),
    "v1.1760000000000.AAAAAAAAAAAAAAAAAAAAA+." + "B".repeat(43),
    `v1.1760000000000.AAAAAAAAAAAAAAAAAAAAAA.${"B".repeat(42)}`,
    `v2.1760000000000.AAAAAAAAAAAAAAAAAAAAAA.${"B".repeat(43)}`,
  ])("malformed %#", (h) => {
    const { v } = setup();
    const spy = vi.spyOn(crypto, "createHmac");
    const verdict = v.stamp(req({ "x-pi-local-proof": h }), listener());
    expect(verdict).toEqual({ kind: "invalid", cause: "malformed" });
    expect(spy).toHaveBeenCalledTimes(0);
  });
});

describe("E2 freshness window", () => {
  it.each([
    [-30_000, "proof"],
    [30_000, "proof"],
    [-30_001, "stale"],
    [30_001, "stale"],
  ])("ts offset %d → %s", (off, expected) => {
    const { v } = setup();
    const verdict = v.stamp(req({ "x-pi-local-proof": proofHeader(T + off) }), listener());
    expect(verdict.kind === "proof" ? "proof" : (verdict as { cause: string }).cause).toBe(expected);
  });
});

describe("E3 before-start floor", () => {
  it("ts == boundAt passes, boundAt-1 fails", () => {
    const B = T - 1000;
    const { v } = setup();
    expect(v.stamp(req({ "x-pi-local-proof": proofHeader(B) }), listener(B)).kind).toBe("proof");
    expect(v.stamp(req({ "x-pi-local-proof": proofHeader(B - 1) }), listener(B)).kind).toBe("invalid");
    expect(v.stamp(req({ "x-pi-local-proof": proofHeader(B - 1) }), listener(B))).toEqual({
      kind: "invalid",
      cause: "before-start",
    });
  });

  it("a proof accepted by one verifier is before-start on a restarted listener", () => {
    const h = proofHeader(T - 10_000);
    const a = setup();
    expect(a.v.stamp(req({ "x-pi-local-proof": h }), listener(T - 20_000)).kind).toBe("proof");
    const b = setup(); // empty replay cache, later boundAt
    expect(b.v.stamp(req({ "x-pi-local-proof": h }), listener(T - 5_000))).toEqual({
      kind: "invalid",
      cause: "before-start",
    });
  });
});

describe("E4 binding vs the arriving socket", () => {
  it.each([
    ["127.0.0.1", P, "proof"],
    ["::ffff:127.0.0.1", P, "proof"],
    ["::1", P, "binding-mismatch"],
    ["127.0.0.2", P, "binding-mismatch"],
    ["127.0.0.1", P + 1, "binding-mismatch"],
  ])("arrives at %s:%d → %s", (addr, port, expected) => {
    const { v } = setup();
    const verdict = v.stamp(
      req({ "x-pi-local-proof": proofHeader(T) }, { localAddress: addr, localPort: port }),
      listener(),
    );
    expect(verdict.kind === "proof" ? "proof" : (verdict as { cause: string }).cause).toBe(expected);
  });
});

describe("E5 replay", () => {
  it("rejects a second presentation; stale after the window", () => {
    const { v, setClock } = setup();
    const h = proofHeader(T);
    expect(v.stamp(req({ "x-pi-local-proof": h }), listener()).kind).toBe("proof");
    setClock(T + 1000);
    expect(v.stamp(req({ "x-pi-local-proof": h }), listener())).toEqual({ kind: "invalid", cause: "replayed" });
    setClock(T + 61_000);
    expect(v.stamp(req({ "x-pi-local-proof": h }), listener())).toEqual({ kind: "invalid", cause: "stale" });
  });
});

describe("E6 insert after MAC", () => {
  it("a bad-MAC nonce does not burn the nonce", () => {
    const { v } = setup();
    const nonce = "CCCCCCCCCCCCCCCCCCCCCC";
    const bad = `v1.${T}.${nonce}.${"D".repeat(43)}`;
    expect(v.stamp(req({ "x-pi-local-proof": bad }), listener())).toEqual({ kind: "invalid", cause: "bad-mac" });
    expect(v.stamp(req({ "x-pi-local-proof": proofHeader(T, { nonce }) }), listener()).kind).toBe("proof");
  });
});

describe("E7 replay cache cap fails closed", () => {
  it("rejects the 10 001st, then recovers after expiry", () => {
    const { v, setClock } = setup();
    for (let i = 0; i < 10_000; i++) {
      const nonce = crypto.randomBytes(16).toString("base64url");
      expect(v.stamp(req({ "x-pi-local-proof": proofHeader(T, { nonce }) }), listener()).kind).toBe("proof");
    }
    expect(v.stamp(req({ "x-pi-local-proof": proofHeader(T) }), listener())).toEqual({
      kind: "invalid",
      cause: "replay-cache-full",
    });
    setClock(T + 61_000);
    expect(v.stamp(req({ "x-pi-local-proof": proofHeader(T + 61_000) }), listener()).kind).toBe("proof");
  });
});

describe("E8 one verdict per request", () => {
  it("is stamped once and read many times", () => {
    const { v } = setup();
    const r = req({ "x-pi-local-proof": proofHeader(T) });
    v.stamp(r, listener());
    expect([1, 2, 3].map(() => hasLocalCredential(r.headers))).toEqual([true, true, true]);
    // re-stamping the same request does not re-verify (no replayed verdict)
    expect(v.stamp(r, listener()).kind).toBe("proof");
  });
});

describe("the recorded verdict is immutable (harden-credential-proof-binding 1.1)", () => {
  it("cannot be redefined or overwritten by later code that holds the Symbol", () => {
    const { v } = setup();
    const r = req({ "x-pi-local-proof": "garbage" });
    v.stamp(r, listener());
    expect(credentialVerdict(r.headers).kind).toBe("invalid");
    const [sym] = Object.getOwnPropertySymbols(r.headers);
    const forged = { kind: "proof", binding: "127.0.0.1:1", nonce: "n", mac: "m" };
    expect(() => Object.defineProperty(r.headers, sym, { value: forged })).toThrow(TypeError);
    expect(() => {
      "use strict";
      (r.headers as Record<symbol, unknown>)[sym] = forged;
    }).toThrow(TypeError);
    expect(credentialVerdict(r.headers).kind).toBe("invalid");
    expect(hasLocalCredential(r.headers)).toBe(false);
  });

  it("the recorded verdict object itself is frozen (a mutation cannot upgrade invalid to proof)", () => {
    const { v } = setup();
    const r = req({ "x-pi-local-proof": "garbage" });
    v.stamp(r, listener());
    const verdict = credentialVerdict(r.headers) as { kind: string };
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(() => {
      "use strict";
      verdict.kind = "proof";
    }).toThrow(TypeError);
    expect(hasLocalCredential(r.headers)).toBe(false);
  });
});

describe("the proof floor follows readiness (harden-credential-proof-binding 2.1)", () => {
  it("takes the floor after ready() resolves and immediately before listen()", async () => {
    const order: string[] = [];
    let readyDone = 0;
    let t = 1_000;
    const app = {
      ready: async () => {
        order.push("ready:start");
        t += 5_000; // plugin boot takes seconds
        readyDone = t;
        order.push("ready:end");
      },
      listen: async (o: { port: number; host: string }) => {
        order.push(`listen:${o.host}:${o.port}`);
      },
    };
    let floor = 0;
    await listenWithProofFloor(app, (at) => (floor = at), { port: 8000, host: "0.0.0.0" }, () => t);
    expect(order).toEqual(["ready:start", "ready:end", "listen:0.0.0.0:8000"]);
    expect(floor).toBeGreaterThanOrEqual(readyDone);
    expect(floor).toBe(6_000);
  });

  it("a failing ready() never sets the floor and never listens", async () => {
    const app = {
      ready: async () => {
        throw new Error("plugin boot failed");
      },
      listen: vi.fn(async () => {}),
    };
    const setFloor = vi.fn();
    await expect(listenWithProofFloor(app, setFloor, { port: 1, host: "h" })).rejects.toThrow(/plugin boot failed/);
    expect(setFloor).not.toHaveBeenCalled();
    expect(app.listen).not.toHaveBeenCalled();
  });
});

describe("E9 multi-valued headers: first value only", () => {
  it.each([
    ["proof", "x-pi-local-proof"],
    ["raw", "x-pi-local-token"],
  ])("%s header", (_n, name) => {
    const good = name === "x-pi-local-proof" ? proofHeader(T) : TOKEN;
    const { v } = setup();
    const bad = v.stamp(req({ [name]: ["garbage", good] }), listener());
    expect(hasLocalCredential(req({}, undefined).headers)).toBe(false);
    expect(bad.kind === "proof" || bad.kind === "legacy").toBe(false);
    const { v: v2 } = setup();
    const ok = v2.stamp(req({ [name]: [good, "garbage"] }), listener());
    expect(ok.kind === "proof" || ok.kind === "legacy").toBe(true);
  });
});

describe("E10 proof judged alone", () => {
  it("invalid proof + matching raw token → invalid, no credential", () => {
    const { v } = setup();
    const r = req({ "x-pi-local-proof": "nonsense", "x-pi-local-token": TOKEN });
    expect(v.stamp(r, listener()).kind).toBe("invalid");
    expect(hasLocalCredential(r.headers)).toBe(false);
  });
});

describe("legacy switch", () => {
  it("rejects the raw token when acceptLegacyToken is off", () => {
    const { v } = setup({ acceptLegacyToken: false });
    expect(v.stamp(req({ "x-pi-local-token": TOKEN }), listener()).kind).toBe("absent");
  });
  it("mismatched raw token is absent", () => {
    const { v } = setup();
    expect(v.stamp(req({ "x-pi-local-token": "nope" }), listener()).kind).toBe("absent");
  });
  it("unstamped headers are absent", () => {
    expect(credentialVerdict({}).kind).toBe("absent");
    expect(hasLocalCredential(undefined)).toBe(false);
  });
});

describe("E11 legacy deprecation log limiter", () => {
  it("one line per caller kind per 60 s with a suppressed count", () => {
    const lines: string[] = [];
    let now = T;
    const { v } = setup({ now: () => now, log: (l) => lines.push(l) });
    const legacy = () => v.stamp(req({ "x-pi-local-token": TOKEN }), listener(T - 1000, "bridge"));
    for (const t of [0, 10_000, 20_000, 40_000, 59_000]) {
      now = T + t;
      legacy();
    }
    now = T + 60_000;
    legacy();
    now = T + 10_000;
    v.stamp(req({ "x-pi-local-token": TOKEN }), listener(T - 1000, "http"));
    const bridge = lines.filter((l) => l.includes("bridge caller"));
    const http = lines.filter((l) => l.includes("http caller"));
    expect(bridge).toHaveLength(2);
    expect(bridge[1]).toContain("suppressed=4");
    expect(http).toHaveLength(1);
  });
});
