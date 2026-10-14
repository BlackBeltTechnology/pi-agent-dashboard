import { describe, expect, it } from "vitest";
import { admitKnock, type KnockAdmissionInput, type KnockAdmissionState, KnockLimiter } from "../knock-admission.js";

/**
 * Knock admission gates + limiter (test-plan #E5–#E13, #E15).
 * See change: add-lan-knock-pairing (design D2, D3, D5, D12).
 */

const IFACES = [{ address: "192.168.16.204", netmask: "255.255.255.0" }];
const HOST = "192.168.16.204:8000";
const MIN = 60_000;

function mk(over: Partial<KnockAdmissionState> & { t?: { now: number } } = {}) {
  const t = over.t ?? { now: 1_000_000 };
  const limiter = over.limiter ?? new KnockLimiter({ now: () => t.now });
  const state: KnockAdmissionState = {
    hostAdmission: {},
    acceptLanRequests: true,
    interfaces: IFACES,
    liveKnocks: [],
    limiter,
    ...over,
  };
  return { t, limiter, state };
}

function input(over: Partial<KnockAdmissionInput> = {}): KnockAdmissionInput {
  return { peer: "192.168.16.31", headers: {}, host: HOST, ...over };
}

describe("#E5 Host admission gate", () => {
  it("refuses a rebound host name even for a LAN peer with the switch on", () => {
    const { state } = mk();
    const r = admitKnock(input({ host: "evil.test" }), state);
    expect(r).toMatchObject({ ok: false, error: "host_not_admitted", status: 403 });
  });
});

describe("#E6 forwarding headers and loopback", () => {
  it.each([
    ["LAN reverse proxy", "192.168.16.5", { "x-forwarded-for": "203.0.113.9" }, false],
    ["relayed loopback", "127.0.0.1", { "x-forwarded-for": "192.168.16.31" }, false],
    ["bare loopback", "127.0.0.1", {}, false],
    ["plain LAN peer", "192.168.16.31", {}, true],
  ])("%s", (_n, peer, headers, ok) => {
    const { state } = mk();
    const r = admitKnock(input({ peer, headers }), state);
    expect(r.ok).toBe(ok);
    if (!r.ok) expect(r.error).toBe("knock_not_lan");
  });

  it("a missing socket address fails closed", () => {
    const { state } = mk();
    expect(admitKnock(input({ peer: undefined }), state)).toMatchObject({ error: "knock_not_lan" });
  });
});

describe("#E7 disabled by default / #E8 off-link learns nothing", () => {
  it("LAN peer with the switch off → knock_disabled", () => {
    const { state } = mk({ acceptLanRequests: false });
    expect(admitKnock(input(), state)).toMatchObject({ ok: false, error: "knock_disabled", status: 403 });
  });
  it("off-link peer with the switch off → knock_not_lan, never knock_disabled", () => {
    const { state } = mk({ acceptLanRequests: false });
    expect(admitKnock(input({ peer: "203.0.113.9" }), state)).toMatchObject({ error: "knock_not_lan" });
  });
});

describe("#E9 per-source window", () => {
  it("admits 5, refuses the 6th with retryAfter", () => {
    const { state, t } = mk();
    for (let i = 0; i < 5; i++) {
      t.now += 1000;
      expect(admitKnock(input({ peer: "192.168.16.31" }), { ...state, liveKnocks: [] }).ok).toBe(true);
    }
    // 5 admitted from one source; a 6th source-wide cap hit — but global cap is 10 so this is the per-source gate
    const r = admitKnock(input(), state);
    expect(r).toMatchObject({ ok: false, error: "knock_rate_limited", status: 429 });
    expect((r as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  });
  it("4 admitted knocks leave the 5th admissible", () => {
    const { state } = mk();
    for (let i = 0; i < 4; i++) expect(admitKnock(input(), state).ok).toBe(true);
    expect(admitKnock(input(), state).ok).toBe(true);
  });
  it("refusals are not counted", () => {
    const { state } = mk({ acceptLanRequests: false });
    for (let i = 0; i < 10; i++) expect(admitKnock(input(), state)).toMatchObject({ error: "knock_disabled" });
    expect(admitKnock(input(), { ...state, acceptLanRequests: true }).ok).toBe(true);
  });
  it("the window slides after 10 minutes", () => {
    const { state, t } = mk();
    for (let i = 0; i < 5; i++) admitKnock(input(), state);
    expect(admitKnock(input(), state).ok).toBe(false);
    t.now += 10 * MIN + 1;
    expect(admitKnock(input(), state).ok).toBe(true);
  });
});

describe("#E10 cooldown paths", () => {
  const src = "192.168.16.31";
  it("deny → 429 (not 409), even while still pollable", () => {
    const { state, limiter, t } = mk();
    expect(admitKnock(input(), state).ok).toBe(true);
    t.now += 5000;
    limiter.onResolved(src, "denied");
    const r = admitKnock(input(), { ...state, liveKnocks: [] });
    expect(r).toMatchObject({ ok: false, error: "knock_rate_limited", status: 429 });
    expect((r as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  });
  it("lockout → 429", () => {
    const { state, limiter } = mk();
    admitKnock(input(), state);
    limiter.onResolved(src, "locked_out");
    expect(admitKnock(input(), state)).toMatchObject({ error: "knock_rate_limited" });
  });
  it("approve and expiry start no cooldown", () => {
    const { state, limiter } = mk();
    admitKnock(input(), state);
    limiter.onResolved(src, "approved");
    expect(admitKnock(input(), state).ok).toBe(true);
    limiter.onResolved(src, "expired");
    expect(admitKnock(input(), state).ok).toBe(true);
  });
  it("cooldown ends after 10 minutes", () => {
    const { state, limiter, t } = mk();
    admitKnock(input(), state);
    limiter.onResolved(src, "denied");
    t.now += 10 * MIN + 1;
    expect(admitKnock(input(), state).ok).toBe(true);
  });
});

describe("#E11 live definition (read from the manager)", () => {
  it("a live knock from the same source → 409", () => {
    const { state } = mk({ liveKnocks: [{ sourceKey: "192.168.16.31" }] });
    expect(admitKnock(input(), state)).toMatchObject({ ok: false, error: "knock_pending", status: 409 });
  });
  it("a non-live list (resolved / expired) → admitted", () => {
    const { state } = mk({ liveKnocks: [] });
    expect(admitKnock(input(), state).ok).toBe(true);
  });
  it("rate gate precedes pending gate (re-knock after deny says rate_limited)", () => {
    const { state, limiter } = mk({ liveKnocks: [{ sourceKey: "192.168.16.31" }] });
    limiter.onResolved("192.168.16.31", "denied");
    expect(admitKnock(input(), state)).toMatchObject({ error: "knock_rate_limited" });
  });
});

describe("#E12 global caps", () => {
  it("3 live knocks from 3 sources → 4th is knock_busy with retryAfter", () => {
    const { state } = mk({
      liveKnocks: [{ sourceKey: "192.168.16.41" }, { sourceKey: "192.168.16.42" }, { sourceKey: "192.168.16.43" }],
    });
    const r = admitKnock(input(), state);
    expect(r).toMatchObject({ ok: false, error: "knock_busy", status: 503 });
    expect((r as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  });
  it("10 admitted-then-denied from 10 sources → 11th is knock_busy", () => {
    const { state, limiter } = mk();
    for (let i = 1; i <= 10; i++) {
      const peer = `192.168.16.${100 + i}`;
      expect(admitKnock(input({ peer }), state).ok).toBe(true);
      limiter.onResolved(peer, "denied");
    }
    const r = admitKnock(input({ peer: "192.168.16.111" }), state);
    expect(r).toMatchObject({ ok: false, error: "knock_busy", status: 503 });
    expect((r as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  });
});

describe("#E13 IPv6 neighbours do not collide", () => {
  it("a live knock from ::10 does not block ::22", () => {
    const ifaces = [{ address: "fd12:3456:789a:1::1", netmask: "ffff:ffff:ffff:ffff::" }];
    const { state } = mk({ interfaces: ifaces, liveKnocks: [{ sourceKey: "fd12:3456:789a:1::10" }] });
    const r = admitKnock(input({ peer: "fd12:3456:789a:1::22", host: "[fd12:3456:789a:1::1]:8000" }), state);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sourceKey).toBe("fd12:3456:789a:1::22");
  });
});

describe("#E15 the requester name never authorizes", () => {
  it("admission has no name input; identical state → identical result", () => {
    const a = mk();
    const b = mk();
    const ra = admitKnock(input(), a.state);
    const rb = admitKnock({ ...input(), name: "home-imac (this computer)" } as KnockAdmissionInput, b.state);
    expect(rb).toEqual(ra);
  });
});

describe("KnockLimiter bounds", () => {
  it("evicts the least-recently-used source beyond maxSources", () => {
    const l = new KnockLimiter({ now: () => 0, maxSources: 3 });
    for (const k of ["a", "b", "c", "d"]) l.recordAdmitted(k);
    expect(l.size()).toBe(3);
  });
});
