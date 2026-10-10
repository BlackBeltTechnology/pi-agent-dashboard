/**
 * Leaf units: `[passkey]` log line shape, requester sanitiser, challenge
 * store, sign-in-with-phone state machine.
 * See change: add-passkey-user-auth (D5, D7; passkey-user-auth › Sign in with
 * phone, › Passkey events are logged without secrets; task 5.1).
 */
import { describe, expect, it } from "vitest";
import { SignedChallenges } from "../challenge-store.js";
import { PASSKEY_EVENTS, passkeyLogLine } from "../passkey-log.js";
import { PhoneSigninManager } from "../phone-signin.js";
import { describeRequester, rateKeyOf } from "../requester.js";

const LINE = /^\[passkey\] [a-z_]+ id=[0-9a-f]{8}$/;

describe("passkeyLogLine", () => {
  it.each(PASSKEY_EVENTS)("%s matches the spec line shape", (event) => {
    expect(passkeyLogLine(event, "0123456789abcdef")).toMatch(LINE);
  });
  it("never echoes a non-hex id (hashes it instead)", () => {
    const secretish = "code=ABCD-1234\r\nINJECT";
    const line = passkeyLogLine("login", secretish);
    expect(line).toMatch(LINE);
    expect(line).not.toContain("ABCD");
    expect(line).not.toMatch(/[\r\n]/);
  });
  it("truncates a hex id to 8 chars", () => {
    expect(passkeyLogLine("enrolled", "deadbeefcafebabe")).toBe("[passkey] enrolled id=deadbeef");
  });
});

describe("describeRequester", () => {
  it("bounds and sanitises a hostile User-Agent", () => {
    const ua = `Evil\u0000\u001b[31m${"A".repeat(400)}\nX`;
    const d = describeRequester({ userAgent: ua, host: "h\u0007ost.example", ip: "203.0.113.9" });
    for (const v of Object.values(d)) {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting their absence
      expect(v).not.toMatch(/[\u0000-\u001f\u007f]/);
      expect(v.length).toBeLessThanOrEqual(256);
    }
    expect(d.host).toBe("host.example");
  });
  it("parses common browsers/OSes", () => {
    const d = describeRequester({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ip: "198.51.100.1",
    });
    expect(d).toMatchObject({ browser: "Safari", os: "macOS", ip: "198.51.100.1" });
    expect(describeRequester({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0" })).toMatchObject({ browser: "Edge", os: "Windows" });
    expect(describeRequester({ userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0" })).toMatchObject({ browser: "Firefox", os: "Linux" });
  });
  it("prefers a valid first X-Forwarded-For hop and rejects junk IPs", () => {
    expect(describeRequester({ ip: "127.0.0.1", forwardedFor: "198.51.100.7, 10.0.0.1" }).ip).toBe("198.51.100.7");
    expect(describeRequester({ ip: "127.0.0.1", forwardedFor: "<script>" }).ip).toBe("127.0.0.1");
    expect(describeRequester({ ip: "nonsense" }).ip).toBe("unknown");
  });
});

describe("SignedChallenges", () => {
  it("opens only for its kind; consume is single-use", () => {
    let t = 0;
    const s = new SignedChallenges<{ c: string }>(() => t);
    const id = s.issue("auth", { c: "x" });
    expect(s.open(id, "register")).toBeNull();
    expect(s.open(id, "auth")).toEqual({ c: "x" });
    expect(s.consume(id)).toBe(true);
    expect(s.consume(id)).toBe(false);
    expect(s.open(id, "auth")).toBeNull();
  });
  it("expires after its TTL", () => {
    let t = 0;
    const s = new SignedChallenges<number>(() => t, 1000);
    const id = s.issue("auth", 1);
    t = 1001;
    expect(s.open(id, "auth")).toBeNull();
  });
  it("rejects a tampered or foreign-key id", () => {
    const s = new SignedChallenges<{ c: string }>(() => 0);
    const id = s.issue("auth", { c: "x" });
    const [body, mac] = id.split(".");
    const forged = `${Buffer.from(JSON.stringify({ k: "auth", d: { c: "y" }, e: 9e15 })).toString("base64url")}.${mac}`;
    expect(s.open(forged, "auth")).toBeNull();
    expect(new SignedChallenges(() => 0).open(id, "auth")).toBeNull();
    expect(s.open(`${body}.`, "auth")).toBeNull();
    expect(s.open(42, "auth")).toBeNull();
  });
  it("an anonymous flood of issues keeps no state and evicts nothing (DoS)", () => {
    const s = new SignedChallenges<number>(() => 0);
    const early = s.issue("auth", 1);
    for (let i = 0; i < 20_000; i++) s.issue("auth", i);
    expect(s.open(early, "auth")).toBe(1);
    expect(s.usedCount()).toBe(0);
  });
});

describe("rateKeyOf", () => {
  it("prefers the LAST (proxy-appended) forwarded hop, else the socket ip", () => {
    expect(rateKeyOf({ ip: "127.0.0.1", forwardedFor: "1.1.1.1, 198.51.100.7" })).toBe("198.51.100.7");
    expect(rateKeyOf({ ip: "127.0.0.1", forwardedFor: "junk" })).toBe("127.0.0.1");
    expect(rateKeyOf({ ip: "203.0.113.5" })).toBe("203.0.113.5");
  });
});

describe("PhoneSigninManager", () => {
  const who = { browser: "Chrome", os: "Windows", host: "h", ip: "198.51.100.1" };
  const mk = () => {
    const clock = { t: 0 };
    const logs: string[] = [];
    const m = new PhoneSigninManager({ now: () => clock.t, log: (l) => logs.push(l) });
    return { m, clock, logs };
  };

  it("approve → desktop poll gets the user once (single-use)", () => {
    const { m, logs } = mk();
    const r = m.start(who, "k1")!;
    expect(r.shortCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(m.poll(r.requestId)).toEqual({ status: "pending" });
    expect(m.view(r.approvalToken)).toMatchObject({ requester: who });
    expect(m.approve(r.approvalToken, "user1")).toEqual({ ok: true });
    expect(m.poll(r.requestId)).toEqual({ status: "approved", sub: "user1" });
    expect(m.poll(r.requestId)).toEqual({ status: "unknown" });
    expect(m.approve(r.approvalToken, "user2")).toEqual({ ok: false, error: "invalid" });
    expect(logs.some((l) => l.startsWith("[passkey] phone_pending "))).toBe(true);
    expect(logs.some((l) => l.startsWith("[passkey] phone_approved "))).toBe(true);
  });

  it("deny → declined, no approval possible", () => {
    const { m } = mk();
    const r = m.start(who, "k1")!;
    expect(m.deny(r.approvalToken)).toEqual({ ok: true });
    expect(m.poll(r.requestId)).toEqual({ status: "rejected" });
    expect(m.approve(r.approvalToken, "u")).toEqual({ ok: false, error: "invalid" });
  });

  it("expires after 5 minutes; a later approval is refused", () => {
    const { m, clock, logs } = mk();
    const r = m.start(who, "k1")!;
    clock.t = 5 * 60_000 + 1;
    expect(m.approve(r.approvalToken, "u")).toEqual({ ok: false, error: "expired" });
    expect(m.poll(r.requestId)).toEqual({ status: "expired" });
    expect(logs.some((l) => l.startsWith("[passkey] phone_expired "))).toBe(true);
  });

  it("short code resolves to the approval token; case/format tolerant", () => {
    const { m } = mk();
    const r = m.start(who, "k1")!;
    const loose = r.shortCode.replace("-", "").toLowerCase();
    expect(m.lookupCode(loose, "k")).toEqual({ ok: true, approvalToken: r.approvalToken });
  });

  it("short-code guessing is rate-limited per client and globally", () => {
    const { m, clock } = mk();
    const r = m.start(who, "k1")!;
    for (let i = 0; i < 5; i++) expect(m.lookupCode("ZZZZ-ZZZZ", "attacker")).toEqual({ ok: false, error: "invalid" });
    expect(m.lookupCode(r.shortCode, "attacker")).toEqual({ ok: false, error: "rate_limited" });
    // another client still works
    expect(m.lookupCode(r.shortCode, "phone")).toMatchObject({ ok: true });
    clock.t += 60_001;
    expect(m.lookupCode(r.shortCode, "attacker")).toMatchObject({ ok: true });
  });

  it("bounds outstanding requests globally", () => {
    const m = new PhoneSigninManager({ now: () => 0, log: () => {}, maxPending: 2 });
    expect(m.start(who, "a")).toMatchObject({ requestId: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(m.start(who, "b")).toMatchObject({ requestId: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(m.start(who, "c")).toBeNull();
  });

  it("caps pending requests per client so one flooder cannot lock everyone out (DoS)", () => {
    const m = new PhoneSigninManager({ now: () => 0, log: () => {} });
    for (let i = 0; i < 3; i++) expect(m.start(who, "flooder")).toMatchObject({ requestId: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(m.start(who, "flooder")).toBeNull();
    expect(m.start(who, "legit-desktop")).toMatchObject({ requestId: expect.stringMatching(/^[0-9a-f]{32}$/) });
  });

  it("request id and approval token are distinct and unguessable", () => {
    const { m } = mk();
    const r = m.start(who, "k1")!;
    expect(r.requestId).not.toBe(r.approvalToken);
    expect(r.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(r.approvalToken.length).toBeGreaterThanOrEqual(32);
    expect(m.view(r.requestId)).toBeNull();
  });
});
