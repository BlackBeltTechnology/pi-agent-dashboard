/**
 * Provisional registration — the protocol mode an explicit move needs (D11,
 * task 9.3a), and the reason B4 says a move cannot be built without it.
 *
 * A second registration for one `sessionId` is NOT inert today:
 *   - `decideClaim` fast-accepts a same-pid newcomer with no probe
 *     (`bridge-contention.ts`, `reason: "same-pid"`), and a move is same-pid by
 *     definition — the SAME pi process registering with a second dashboard;
 *   - `connections.set(msg.sessionId, ws)` (`pi-gateway.ts`) hands over routing
 *     the instant the register lands, after which the origin's sends are
 *     dropped by the ownership gate.
 *
 * So a naive move silently severs the origin BEFORE the target has proven it
 * can serve. Provisional registration announces intent and claims nothing:
 * no routing entry, no contention slot. Routing transfers only on commit.
 *
 * Tasks 9.3a, 9.3a-i, 9.3a-iii, 9.3a-iv, 9.3a-v; test-plan #E20, #X9, #X10.
 * See change: add-pi-gateway-transport-identity.
 */
import { describe, expect, it } from "vitest";
import { decideClaim } from "../bridge-contention.js";
import { createProvisionalRegistry, PROVISIONAL_TTL } from "../provisional-registration.js";

const WS_OPEN = 1;
const sock = (readyState = WS_OPEN) => ({ readyState }) as never;

describe("decideClaim bypasses contention for a provisional register (task 9.3a-v)", () => {
  it("never returns same-pid for a provisional claim", () => {
    // The trap: a move is the same pi process, so the same-pid fast-accept
    // would take the routing entry with no probe at all.
    const incumbent = sock();
    const live = decideClaim({
      incumbent,
      newcomer: sock(),
      incumbentSource: "tui",
      incumbentPid: 4242,
      newcomerPid: 4242,
    });
    expect(live.outcome).toBe("accept");
    expect(live.outcome === "accept" && live.reason).toBe("same-pid");

    const provisional = decideClaim({
      incumbent,
      newcomer: sock(),
      incumbentSource: "tui",
      incumbentPid: 4242,
      newcomerPid: 4242,
      provisional: true,
    });
    expect(provisional.outcome).toBe("provisional");
  });

  it("is provisional even when the id is unheld", () => {
    // "Unheld" would otherwise accept outright and claim the entry. A
    // provisional register must claim nothing in EVERY case, or the mode is
    // only safe for the paths someone remembered.
    const v = decideClaim({ incumbent: undefined, newcomer: sock(), provisional: true });
    expect(v.outcome).toBe("provisional");
  });

  it("is provisional against a live incumbent, without probing it", () => {
    const v = decideClaim({
      incumbent: sock(),
      newcomer: sock(),
      incumbentSource: "tui",
      provisional: true,
    });
    expect(v.outcome).toBe("provisional");
  });
});

describe("createProvisionalRegistry", () => {
  const setup = () => {
    let clock = 1_000_000;
    const reg = createProvisionalRegistry({ now: () => clock });
    return { reg, tick: (ms: number) => (clock += ms) };
  };

  it("opens a provisional and returns the target's instance id, claiming nothing", () => {
    const { reg } = setup();
    const opened = reg.open({ sessionId: "s1", instanceId: "instance-target" });
    expect(opened.instanceId).toBe("instance-target");
    expect(opened.token).toBeTruthy();
    // The registry is intent only — it exposes no socket and no routing claim.
    expect(reg.isCommitted(opened.token)).toBe(false);
  });

  it("commits within the TTL (#E20: 29s accepted)", () => {
    const { reg, tick } = setup();
    const { token } = reg.open({ sessionId: "s1", instanceId: "i" });
    tick(29_000);
    expect(reg.commit(token).ok).toBe(true);
    expect(reg.isCommitted(token)).toBe(true);
  });

  it("refuses a commit after the TTL, the provisional already discarded (#E20: 31s)", () => {
    const { reg, tick } = setup();
    const { token } = reg.open({ sessionId: "s1", instanceId: "i" });
    tick(31_000);
    const v = reg.commit(token);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.cause).toBe("expired");
  });

  it("uses a 30s TTL, the boundary the scenarios are written against", () => {
    expect(PROVISIONAL_TTL).toBe(30_000);
  });

  it("discards on expiry exactly as on failure, so state cannot accumulate (9.3a-iii)", () => {
    const { reg, tick } = setup();
    for (let i = 0; i < 50; i++) reg.open({ sessionId: `s${i}`, instanceId: "i" });
    expect(reg.size()).toBe(50);
    tick(31_000);
    // Reading is enough to sweep — no unclaimed provisional survives its TTL,
    // and nothing depends on a caller remembering to clean up.
    reg.commit("nonexistent");
    expect(reg.size()).toBe(0);
  });

  it("abandons a provisional explicitly, and is idempotent about it", () => {
    const { reg } = setup();
    const { token } = reg.open({ sessionId: "s1", instanceId: "i" });
    reg.abandon(token);
    expect(reg.commit(token).ok).toBe(false);
    expect(() => reg.abandon(token)).not.toThrow();
  });

  it("refuses a commit for an unknown token", () => {
    const { reg } = setup();
    expect(reg.commit("never-minted").ok).toBe(false);
  });

  it("cannot commit the same provisional twice", () => {
    // A replayed commit must not re-transfer routing after the origin has
    // already been released.
    const { reg } = setup();
    const { token } = reg.open({ sessionId: "s1", instanceId: "i" });
    expect(reg.commit(token).ok).toBe(true);
    expect(reg.commit(token).ok).toBe(false);
  });
});

/**
 * #X10 / task 9.3a-iv — a provisional refusal must not be an enumeration
 * oracle. Without this, anyone able to open a provisional could ask "does
 * session X exist on this dashboard" and read the answer off the refusal.
 *
 * The precedent is already in this change: the bridge upgrade gate names its
 * cause in the SERVER log and tells the client nothing beyond 401.
 */
describe("provisional refusals are indistinguishable to the caller (#X10)", () => {
  it("returns the same wire response for an existing and a non-existent session", () => {
    const reg = createProvisionalRegistry({});
    const existing = reg.refuseForWire({ sessionId: "s-exists", cause: "session-live-elsewhere" });
    const absent = reg.refuseForWire({ sessionId: "s-absent", cause: "no-such-session" });
    expect(existing).toEqual(absent);
  });

  it("still records the true cause server-side", () => {
    const logged: string[] = [];
    const reg = createProvisionalRegistry({ log: (m) => logged.push(m) });
    reg.refuseForWire({ sessionId: "s-absent", cause: "no-such-session" });
    expect(logged.join("\n")).toMatch(/no-such-session/);
    expect(logged.join("\n")).toMatch(/s-absent/);
  });

  it("marks the refusal as provisional, so the origin never treats it as terminal (9.3a-i)", () => {
    // `connection.ts` treats `register_rejected` as terminal for the session
    // and sets `intentionalClose`. A provisional refusal reaching that path
    // would kill the very session the move was trying to preserve.
    const reg = createProvisionalRegistry({});
    const wire = reg.refuseForWire({ sessionId: "s", cause: "no-such-session" });
    expect(wire.type).toBe("provisional_rejected");
    expect(wire.type).not.toBe("register_rejected");
  });
});
