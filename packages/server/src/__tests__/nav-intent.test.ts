/**
 * Signed navigation intents (change: harden-client-sinks, design D10,
 * test-plan #E19, #E20). Pattern: `SignedChallenges` (auth/passkey).
 */
import { describe, expect, it } from "vitest";
import { NAV_INTENT_TTL_S, NavIntents } from "../auth/nav-intent.js";

const A = "identity:https://kc.example\u0000alice-1234";
const B = "identity:https://kc.example\u0000bob-5678";
const TARGET = { cwd: "/home/op/secret-project", path: "notes.md" };

describe("intent verification (#E19)", () => {
  it("tampering, another target, another principal or a new process key all fail", () => {
    const t0 = 1_700_000_000_000;
    const intents = new NavIntents(() => t0);
    const ni = intents.mint(A, "file-view", TARGET);
    expect(intents.verify(ni, A, "file-view", TARGET)).toBe(true);

    const flipped = ni.slice(0, -2) + (ni.at(-2) === "A" ? "B" : "A") + ni.at(-1);
    expect(intents.verify(flipped, A, "file-view", TARGET)).toBe(false);
    expect(intents.verify(ni, A, "file-view", { ...TARGET, path: "secrets.env" })).toBe(false);
    expect(intents.verify(ni, B, "file-view", TARGET)).toBe(false);
    expect(new NavIntents(() => t0).verify(ni, A, "file-view", TARGET)).toBe(false);
    expect(intents.verify(ni, A, "url-view", { url: "https://x.example/" })).toBe(false);
  });

  it("the value reveals nothing in clear: only the expiry and the MAC", () => {
    const intents = new NavIntents(() => 1_700_000_000_000);
    const ni = intents.mint(A, "file-view", TARGET);
    const decoded = ni
      .split(".")
      .map((p) => Buffer.from(p, "base64url").toString("latin1"))
      .join(".");
    for (const secret of ["secret-project", "notes.md", "alice-1234", "kc.example"]) {
      expect(decoded).not.toContain(secret);
      expect(ni).not.toContain(secret);
    }
    expect(ni.split(".")).toHaveLength(2);
  });

  it("malformed values never verify and never throw", () => {
    const intents = new NavIntents();
    for (const bad of [undefined, null, 1, "", ".", "abc", "a.b.c", "x".repeat(5000)]) {
      expect(intents.verify(bad, A, "file-view", TARGET)).toBe(false);
    }
  });
});

describe("intent lifetime (#E20)", () => {
  it("verifies at t0+599 s, fails at t0+601 s", () => {
    let now = 1_700_000_000_123;
    const intents = new NavIntents(() => now);
    const ni = intents.mint(A, "url-view", { url: "https://example.com/page" });
    expect(NAV_INTENT_TTL_S).toBe(600);
    now += 599_000;
    expect(intents.verify(ni, A, "url-view", { url: "https://example.com/page" })).toBe(true);
    now += 2_000;
    expect(intents.verify(ni, A, "url-view", { url: "https://example.com/page" })).toBe(false);
  });
});
