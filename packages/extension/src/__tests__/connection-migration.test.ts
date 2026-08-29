import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection.js";
import {
  POISONED_ADVERTISEMENT,
  POISONED_CANDIDATE_URL,
} from "./fixtures/poisoned-advertisement.js";

/**
 * Migration scenarios for the bridge's connection (change:
 * fix-bridge-mdns-migration-hijack).
 *
 * The spec's "the bridge" is this connection: the admission gate, localhost
 * preference and reversal are invariants ON the connection, and bridge.ts
 * delegates every discovery re-target to `retargetTo()`. The candidate in
 * every scenario is the real poisoned-advertisement shape (see the fixture),
 * so the tests exercise the failure as it occurred.
 *
 * Mock WebSocket pattern follows connection.test.ts.
 */

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sentMessages: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  /** The shape of a refused dial: error without ever opening. */
  simulateDialFailure() {
    this.readyState = 3;
    this.onerror?.(new Error("connect ECONNREFUSED"));
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }
}

/** Dials whose opens always fail — the unreachable `.local` endpoint. */
function failEveryDial(): void {
  for (const ws of MockWebSocket.instances) {
    if (ws.url === POISONED_CANDIDATE_URL && ws.readyState !== 3) {
      ws.simulateDialFailure();
    }
  }
}

type MigrationRecord = {
  from: string;
  to: string;
  accepted: boolean;
  trigger: string;
  reason: string;
};

function makeManager(opts: Partial<ConstructorParameters<typeof ConnectionManager>[0]> = {}) {
  const records: MigrationRecord[] = [];
  const cm = new ConnectionManager({
    url: "ws://localhost:9999",
    WebSocketImpl: MockWebSocket as any,
    watchdogTimeout: 0,
    onMigrationEvent: (r) => records.push(r),
    migrationAttemptsBound: 4,
    migrationCooldownMs: 60_000,
    ...opts,
  });
  return { cm, records };
}

/** Connect, open the incumbent socket, and mark it registered. */
function establishRegistered(cm: ConnectionManager): MockWebSocket {
  cm.connect();
  const incumbent = MockWebSocket.instances[0];
  incumbent.simulateOpen();
  cm.noteRegistered();
  return incumbent;
}

describe("ConnectionManager migration (fix-bridge-mdns-migration-hijack)", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  describe("admission gate (established + registered)", () => {
    it("1.2 refuses a candidate whose health check does not return ok, and keeps the established connection", async () => {
      const { cm, records } = makeManager();
      const incumbent = establishRegistered(cm);
      const dialsBefore = MockWebSocket.instances.length;

      const accepted = await cm.retargetTo(POISONED_CANDIDATE_URL, {
        trigger: "mdns discovery",
        verify: async () => false,
      });

      expect(accepted).toBe(false);
      // No new dial, incumbent socket untouched.
      expect(MockWebSocket.instances.length).toBe(dialsBefore);
      expect(incumbent.readyState).toBe(1);
      // The rejection is recorded with both endpoints and the reason.
      expect(records).toContainEqual(
        expect.objectContaining({
          from: "ws://localhost:9999",
          to: POISONED_CANDIDATE_URL,
          accepted: false,
          trigger: "mdns discovery",
        }),
      );
      const refusal = records.find((r) => !r.accepted);
      expect(refusal?.reason).toMatch(/health/i);
      cm.disconnect();
    });

    it("refuses a candidate when no health check could be performed", async () => {
      const { cm, records } = makeManager();
      establishRegistered(cm);

      const accepted = await cm.retargetTo(POISONED_CANDIDATE_URL, {
        trigger: "mdns discovery",
        // verify omitted: the probe timed out / was not run
      });

      expect(accepted).toBe(false);
      const refusal = records.find((r) => !r.accepted);
      expect(refusal?.reason).toMatch(/health|verif/i);
      cm.disconnect();
    });

    it("1.3 refuses a remote candidate that would displace an established localhost connection", async () => {
      const { cm, records } = makeManager();
      const incumbent = establishRegistered(cm);
      const dialsBefore = MockWebSocket.instances.length;

      // Health check PASSES — the candidate is reachable — but it is not
      // localhost, and the incumbent is. Localhost preference wins.
      const accepted = await cm.retargetTo(POISONED_CANDIDATE_URL, {
        trigger: "mdns discovery",
        verify: async () => true,
      });

      expect(accepted).toBe(false);
      expect(MockWebSocket.instances.length).toBe(dialsBefore);
      expect(incumbent.readyState).toBe(1);
      const refusal = records.find((r) => !r.accepted);
      expect(refusal?.reason).toMatch(/localhost|loopback/i);
      cm.disconnect();
    });

    it("a DEAD loopback incumbent no longer blocks a reachable remote candidate (round-1 review #1)", async () => {
      const { cm } = makeManager();
      const incumbent = establishRegistered(cm);

      // The localhost dashboard DIES. Preference protects an ESTABLISHED
      // connection — a dead one protects nothing, and refusing a reachable
      // remote candidate for it would strand the bridge forever.
      incumbent.simulateClose();

      const accepted = await cm.retargetTo(POISONED_CANDIDATE_URL, {
        trigger: "mdns discovery",
        verify: async () => true, // the remote candidate IS reachable
      });

      expect(accepted).toBe(true);
      // The stale reconnect timer for the dead incumbent must not race the
      // adoption: the next dial is the candidate, and nothing re-dials the
      // dead loopback endpoint afterwards.
      vi.advanceTimersByTime(60_000);
      const last = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      expect(last.url).toBe(POISONED_CANDIDATE_URL);
      const loopbackRedials = MockWebSocket.instances.filter(
        (ws) => ws.url === "ws://localhost:9999" && ws !== incumbent,
      );
      expect(loopbackRedials).toHaveLength(0);
      cm.disconnect();
    });

    it("adopts a reachable localhost candidate over an established remote connection (legitimate migration)", async () => {
      const { cm } = makeManager({ url: "ws://192.168.1.10:9594" });
      cm.connect();
      MockWebSocket.instances[0].simulateOpen();
      cm.noteRegistered();

      const accepted = await cm.retargetTo("ws://localhost:9999", {
        trigger: "mdns discovery",
        verify: async () => true,
      });

      expect(accepted).toBe(true);
      const last = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      expect(last.url).toBe("ws://localhost:9999");
      cm.disconnect();
    });

    it("migrates freely before the connection is established and registered (cold-start attach)", async () => {
      const { cm } = makeManager();
      // Dialling but never opened, never registered: the init window. The
      // incumbent is only protected while it is established AND registered.
      cm.connect();

      const accepted = await cm.retargetTo(POISONED_CANDIDATE_URL, {
        trigger: "mdns discovery",
        // No health check needed: nothing established is being abandoned.
      });

      expect(accepted).toBe(true);
      const last = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      expect(last.url).toBe(POISONED_CANDIDATE_URL);
      cm.disconnect();
    });

    it("is a no-op for the current URL", async () => {
      const { cm, records } = makeManager();
      establishRegistered(cm);
      const dialsBefore = MockWebSocket.instances.length;

      const accepted = await cm.retargetTo("ws://localhost:9999", {
        trigger: "mdns discovery",
      });

      expect(accepted).toBe(true);
      expect(MockWebSocket.instances.length).toBe(dialsBefore);
      expect(records).toHaveLength(0);
      cm.disconnect();
    });
  });

  describe("reversibility (bounded migration attempts)", () => {
    it("1.1 returns to the last registered endpoint after the bound of failed opens, and cooldowns the rejected one", async () => {
      // Incumbent is a REMOTE dashboard so the poisoned `.local` candidate is
      // not blocked by the localhost-preference rule (1.3 covers that gate):
      // here the candidate ANSWERS the health probe — a stale instance
      // mid-shutdown — and only dies on the WebSocket opens afterwards. That
      // is D2's own scenario: an endpoint that fails AFTER admission.
      const { cm, records } = makeManager({ url: "ws://192.168.1.10:7000" });
      const incumbent = establishRegistered(cm); // registered on the remote dashboard

      const accepted = await cm.retargetTo(POISONED_CANDIDATE_URL, {
        trigger: "mdns discovery",
        verify: async () => true,
      });
      expect(accepted).toBe(true);
      expect(incumbent.readyState).not.toBe(1);

      // …but its opens fail forever after.
      vi.advanceTimersByTime(0);
      failEveryDial(); // candidate dial #1 (immediate) fails
      vi.advanceTimersByTime(1_000);
      failEveryDial(); // #2
      vi.advanceTimersByTime(2_000);
      failEveryDial(); // #3
      vi.advanceTimersByTime(4_000);
      failEveryDial(); // #4 — bound reached
      // Backoff must not keep growing against the dead candidate: by now the
      // bridge has returned to the last registered endpoint.
      vi.advanceTimersByTime(1_000);

      const last = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      expect(last.url).toBe("ws://192.168.1.10:7000");

      const fallback = records.find((r) => r.accepted && r.trigger !== "mdns discovery");
      expect(fallback).toBeDefined();
      expect(fallback?.to).toBe("ws://192.168.1.10:7000");
      expect(fallback?.from).toBe(POISONED_CANDIDATE_URL);

      // Cooldown: the rejected endpoint cannot be re-adopted immediately.
      const dialsBefore = MockWebSocket.instances.length;
      const again = await cm.retargetTo(POISONED_CANDIDATE_URL, {
        trigger: "mdns discovery",
        verify: async () => true,
      });
      expect(again).toBe(false);
      expect(MockWebSocket.instances.length).toBe(dialsBefore);
      const refusal = records.at(-1);
      expect(refusal?.accepted).toBe(false);
      expect(refusal?.reason).toMatch(/cooldown/i);

      cm.disconnect();
    });

    it("counts nothing against the original endpoint: a plain reconnect never reverses", () => {
      const { cm } = makeManager();
      const incumbent = establishRegistered(cm);

      // The incumbent itself drops and reconnects repeatedly (server restart).
      for (let i = 0; i < 10; i++) {
        incumbent.simulateClose();
        vi.advanceTimersByTime(60_000);
        const reconnected = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        expect(reconnected.url).toBe("ws://localhost:9999");
        reconnected.simulateOpen();
      }

      cm.disconnect();
    });

    it("updates the last registered endpoint when the migrated connection registers", async () => {
      const { cm } = makeManager();
      establishRegistered(cm);

      await cm.retargetTo("ws://localhost:8888", {
        trigger: "server moved",
        verify: async () => true,
      });
      vi.advanceTimersByTime(0);
      const migrated = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      expect(migrated.url).toBe("ws://localhost:8888");
      migrated.simulateOpen();
      cm.noteRegistered();

      // Now the moved endpoint IS the registered one: its own drops must not
      // reverse anywhere, and the OLD endpoint must not be dialled again.
      const dialsBefore = MockWebSocket.instances.length;
      migrated.simulateClose();
      vi.advanceTimersByTime(60_000);
      const reconnected = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      expect(reconnected.url).toBe("ws://localhost:8888");
      expect(MockWebSocket.instances.length - dialsBefore).toBe(1);

      cm.disconnect();
    });
  });

  describe("observability (every re-target is recorded)", () => {
    it("5.4 records every ACCEPTED re-target with both endpoints and the trigger", async () => {
      const { cm, records } = makeManager();
      establishRegistered(cm);

      await cm.retargetTo("ws://localhost:8888", {
        trigger: "server moved",
        verify: async () => true,
      });

      expect(records).toContainEqual({
        from: "ws://localhost:9999",
        to: "ws://localhost:8888",
        accepted: true,
        trigger: "server moved",
        reason: expect.stringMatching(/./),
      });
      cm.disconnect();
    });

    it("records every REFUSED re-target with the reason (no silent refusal)", async () => {
      const { cm, records } = makeManager();
      establishRegistered(cm);

      await cm.retargetTo(POISONED_CANDIDATE_URL, {
        trigger: "mdns discovery",
        verify: async () => false,
      });

      expect(records.filter((r) => !r.accepted)).toHaveLength(1);
      cm.disconnect();
    });

    it("noteRegistered while still connecting is promoted on open", async () => {
      const { cm, records } = makeManager();
      cm.connect(); // dialling, not yet open
      cm.noteRegistered();
      MockWebSocket.instances[0].simulateOpen();

      // The promotion must count: an unreachable candidate is now refused.
      const dialsBefore = MockWebSocket.instances.length;
      const accepted = await cm.retargetTo(POISONED_CANDIDATE_URL, {
        trigger: "mdns discovery",
        verify: async () => false,
      });
      expect(accepted).toBe(false);
      expect(MockWebSocket.instances.length).toBe(dialsBefore);
      expect(records.some((r) => !r.accepted)).toBe(true);
      cm.disconnect();
    });
  });
});
