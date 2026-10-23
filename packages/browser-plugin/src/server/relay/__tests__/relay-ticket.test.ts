/**
 * Single-use relay tickets.
 * See change: close-container-loopback-impersonation (D10; test-plan #E19, #X6).
 */
import { describe, expect, it } from "vitest";
import { RELAY_TICKET_TTL_MS, RelayTicketStore } from "../relay-ticket.js";

const GUID = "a".repeat(32);
const OTHER = "b".repeat(32);

function clocked() {
  let now = 5_000_000;
  const store = new RelayTicketStore({ now: () => now });
  return { store, advance: (ms: number) => void (now += ms) };
}

describe("RelayTicketStore", () => {
  it("mints 32 random bytes as base64url (43 chars), different every time", () => {
    const { store } = clocked();
    const a = store.mint(GUID, "cdp");
    const b = store.mint(OTHER, "cdp");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("is consumed by the first presenting attempt: true once, then false", () => {
    const { store } = clocked();
    const t = store.mint(GUID, "cdp");
    expect(store.consume(GUID, "cdp", t)).toBe(true);
    expect(store.consume(GUID, "cdp", t)).toBe(false);
  });

  it("is bound to (guid, role)", () => {
    const { store } = clocked();
    const t = store.mint(GUID, "cdp");
    expect(store.consume(GUID, "ext", t)).toBe(false);
    expect(store.consume(OTHER, "cdp", t)).toBe(false);
    expect(store.consume(GUID, "cdp", t)).toBe(true); // the wrong-role / wrong-guid tries did not burn it
  });

  it("a wrong value never burns the legitimate ticket (a guesser cannot lock the real client out)", () => {
    const { store } = clocked();
    const t = store.mint(GUID, "ext");
    for (const bad of ["", "x", t.slice(0, -1), `${t}x`, "A".repeat(43), null, undefined]) {
      expect(store.consume(GUID, "ext", bad as string), String(bad)).toBe(false);
    }
    expect(store.consume(GUID, "ext", t)).toBe(true);
  });

  it("expires after 60 s (boundary: valid at 59.999 s, dead at 60 s)", () => {
    const { store, advance } = clocked();
    const t1 = store.mint(GUID, "cdp");
    advance(RELAY_TICKET_TTL_MS - 1);
    expect(store.consume(GUID, "cdp", t1)).toBe(true);
    const t2 = store.mint(GUID, "cdp");
    advance(RELAY_TICKET_TTL_MS);
    expect(store.consume(GUID, "cdp", t2)).toBe(false);
  });

  it("a re-mint for the same (guid, role) replaces the earlier unconsumed ticket", () => {
    const { store } = clocked();
    const first = store.mint(GUID, "cdp");
    const second = store.mint(GUID, "cdp");
    expect(store.consume(GUID, "cdp", first)).toBe(false);
    expect(store.consume(GUID, "cdp", second)).toBe(true);
  });

  it("revoke(guid) kills both roles; expired entries are swept so the store stays bounded", () => {
    const { store, advance } = clocked();
    const e = store.mint(GUID, "ext");
    const c = store.mint(GUID, "cdp");
    store.revoke(GUID);
    expect(store.consume(GUID, "ext", e)).toBe(false);
    expect(store.consume(GUID, "cdp", c)).toBe(false);
    for (let i = 0; i < 50; i++) store.mint(`g${i}`, "cdp");
    advance(RELAY_TICKET_TTL_MS + 1);
    expect(store.size()).toBe(0);
  });

  it("holds only a digest: the plaintext ticket is not retained anywhere in the store", () => {
    const { store } = clocked();
    const t = store.mint(GUID, "cdp");
    expect(JSON.stringify([...(store as unknown as { entries: Map<string, unknown> }).entries.entries()], (_k, v) => (v && v.type === "Buffer" ? Buffer.from(v.data).toString("base64url") : v))).not.toContain(t);
  });
});
