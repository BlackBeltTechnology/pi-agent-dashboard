/**
 * Audit ring (change: add-browser-relay) — test-plan #E15 (ring BVA) + #E16
 * (detail content) + the secret-freedom invariant from spec F2.
 */
import { describe, expect, it } from "vitest";
import { AUDIT_CAPACITY, AuditRing, stripUrlQueryAndFragment } from "../audit.js";

const GUID = "0123456789abcdef0123456789abcdef";
const TOKEN = "s3cr3t-pairing-token";

function entry(i: number) {
  return { profileDirectory: "Default", instanceId: "inst-a", kind: "denied" as const, detail: `Network.getCookies#${i}` };
}

describe("AuditRing (E15)", () => {
  it("caps at 500 and drops the OLDEST first", () => {
    const ring = new AuditRing();
    expect(AUDIT_CAPACITY).toBe(500);

    for (let i = 0; i < 499; i++) ring.append(entry(i));
    expect(ring.size).toBe(499);

    ring.append(entry(499));
    expect(ring.size).toBe(500);

    ring.append(entry(500));
    expect(ring.size).toBe(500);
    // Oldest (#0) gone, newest present.
    expect(ring.list().some((e) => e.detail.endsWith("#0"))).toBe(false);
    expect(ring.list()[0].detail).toBe("Network.getCookies#500");

    for (let i = 501; i < 600; i++) ring.append(entry(i));
    expect(ring.size).toBe(500);
    expect(ring.list()[0].detail).toBe("Network.getCookies#599");
    expect(ring.list().some((e) => e.detail.endsWith("#99"))).toBe(false);
  });

  it("auditSeq is strictly increasing across 600 appends (never entries.length)", () => {
    const ring = new AuditRing();
    const seqs: number[] = [];
    for (let i = 0; i < 600; i++) {
      ring.append(entry(i));
      seqs.push(ring.auditSeq);
    }
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    // Past the cap the seq must NOT collapse back to the ring size.
    expect(ring.auditSeq).toBe(600);
    expect(ring.size).toBe(500);
  });

  it("lists newest-first, optionally narrowed by profile", () => {
    const ring = new AuditRing();
    ring.append({ profileDirectory: "A", instanceId: "i1", kind: "attach", detail: "a1" });
    ring.append({ profileDirectory: "B", instanceId: "i2", kind: "attach", detail: "b1" });
    ring.append({ profileDirectory: "A", instanceId: "i1", kind: "denied", detail: "a2" });
    expect(ring.list().map((e) => e.detail)).toEqual(["a2", "b1", "a1"]);
    expect(ring.list("A").map((e) => e.detail)).toEqual(["a2", "a1"]);
    expect(ring.list("B").map((e) => e.detail)).toEqual(["b1"]);
  });

  it("a serialized entry never contains the guid or the token", () => {
    const ring = new AuditRing();
    ring.append({ profileDirectory: "Default", instanceId: "inst-a", kind: "denied", detail: "Network.getAllCookies" });
    const json = JSON.stringify(ring.list());
    expect(json).not.toContain(GUID);
    expect(json).not.toContain(TOKEN);
  });
});

describe("AuditRing detail content (E16)", () => {
  it("detail is a URL string / method name / input kind — never a payload object", () => {
    const ring = new AuditRing();
    const nav = ring.append({ profileDirectory: "D", instanceId: "i", kind: "navigate", detail: "https://a/b?q=1" });
    const denied = ring.append({ profileDirectory: "D", instanceId: "i", kind: "denied", detail: "Runtime.x" });
    const input = ring.append({ profileDirectory: "D", instanceId: "i", kind: "viewer-input", detail: "mouse" });

    // Query + fragment are stripped for every profile (change: add-dedicated-agent-browser D9;
    // this assertion was `https://a/b?q=1` before).
    expect(nav.detail).toBe("https://a/b");
    expect(denied.detail).toBe("Runtime.x");
    expect(input.detail).toBe("mouse");
    for (const e of [nav, denied, input]) expect(typeof e.detail).toBe("string");
  });

  it("coerces a non-string detail rather than storing a payload object", () => {
    const ring = new AuditRing();
    // Simulates a caller bug: the entry must still be a string, not the object.
    const e = ring.append({
      profileDirectory: "D",
      instanceId: "i",
      kind: "denied",
      detail: { cookies: ["secret"] } as unknown as string,
    });
    expect(typeof e.detail).toBe("string");
    expect(JSON.stringify(e)).not.toContain("secret");
  });
});

describe("audit URL query stripping (E13)", () => {
  it("navigate detail loses ?code=…#state=… for relay and dedicated profiles alike", () => {
    const ring = new AuditRing();
    for (const profileDirectory of ["Default", "@dedicated"]) {
      const e = ring.append({
        profileDirectory,
        instanceId: "i",
        kind: "navigate",
        detail: "https://example.com/cb?code=abc#state=x",
      });
      expect(e.detail).toBe("https://example.com/cb");
    }
    expect(JSON.stringify(ring.list())).not.toMatch(/code=|state=/);
  });

  it("strips a fragment-only URL and about: URLs", () => {
    expect(stripUrlQueryAndFragment("https://a.test/p#frag")).toBe("https://a.test/p");
    expect(stripUrlQueryAndFragment("about:blank?x=1")).toBe("about:blank");
  });

  it("still redacts chrome-extension URLs", () => {
    const ring = new AuditRing();
    const e = ring.append({
      profileDirectory: "D",
      instanceId: "i",
      kind: "navigate",
      detail: "chrome-extension://abc/connect.html?token=SECRET#x",
    });
    expect(e.detail).toBe("chrome-extension://abc/connect.html");
  });

  it("leaves non-URL details untouched (method names, causes, tab notes)", () => {
    for (const d of ["Page.navigate", "closed:All controlled tabs detached", "extension:some_reason", "tab:7 reason:no-session", "devtools", "auto"]) {
      expect(stripUrlQueryAndFragment(d)).toBe(d);
    }
  });
});
