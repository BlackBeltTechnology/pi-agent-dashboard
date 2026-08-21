/**
 * Tests for the `queue_update` extension-to-server message handling.
 * Validates that the server caches Session.pendingQueues wholesale and
 * broadcasts session_updated to subscribers.
 * See change: add-followup-edit-and-steer-cancel.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer, type DashboardServer } from "../server.js";
import { AUTO_NAME_OUTCOMES, AutoNameOutcomeStore } from "../auto-name-outcome-store.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("event-wiring: queue_update caches Session.pendingQueues and broadcasts", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;

  beforeEach(async () => {
    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterEach(async () => {
    await server.stop();
  });

  it("wholesale replaces Session.pendingQueues on each queue_update event", async () => {
    const { sessionManager } = server;
    const SID = "queue-test-sess";
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-queue-test-"));
    const sessionFile = path.join(tmpDir, "s.jsonl");
    writeFileSync(sessionFile, "");

    const bridgeWs = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve, reject) => {
      bridgeWs.on("error", reject);
      bridgeWs.on("open", () => {
        bridgeWs.send(JSON.stringify({
          type: "session_register",
          sessionId: SID,
          cwd: tmpDir,
          source: "cli",
          sessionFile,
        }));
        bridgeWs.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        resolve();
      });
    });
    await wait(80);

    // Initial state: queues start empty after register.
    expect(sessionManager.get(SID)?.pendingQueues).toEqual({ steering: [], followUp: [] });

    // 1. Bridge emits queue_update with steering only
    bridgeWs.send(JSON.stringify({
      type: "queue_update",
      sessionId: SID,
      steering: ["first"],
      followUp: [],
    }));
    await wait(60);
    expect(sessionManager.get(SID)?.pendingQueues).toEqual({ steering: ["first"], followUp: [] });

    // 2. Bridge emits queue_update with both queues populated — wholesale replace
    bridgeWs.send(JSON.stringify({
      type: "queue_update",
      sessionId: SID,
      steering: ["alpha", "beta"],
      followUp: ["wrap up"],
    }));
    await wait(60);
    expect(sessionManager.get(SID)?.pendingQueues).toEqual({
      steering: ["alpha", "beta"],
      followUp: ["wrap up"],
    });

    // 3. Bridge emits empty snapshot (drain finished or clear ran)
    bridgeWs.send(JSON.stringify({
      type: "queue_update",
      sessionId: SID,
      steering: [],
      followUp: [],
    }));
    await wait(60);
    expect(sessionManager.get(SID)?.pendingQueues).toEqual({ steering: [], followUp: [] });

    bridgeWs.close();
  });

  it("resets Session.pendingQueues to empty on session re-register", async () => {
    const { sessionManager } = server;
    const SID = "queue-rereg-sess";
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-queue-rereg-"));
    const sessionFile = path.join(tmpDir, "s.jsonl");
    writeFileSync(sessionFile, "");

    // First bridge connects and populates the queues.
    const ws1 = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => {
      ws1.on("open", () => {
        ws1.send(JSON.stringify({
          type: "session_register",
          sessionId: SID,
          cwd: tmpDir,
          source: "cli",
          sessionFile,
        }));
        ws1.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        ws1.send(JSON.stringify({
          type: "queue_update",
          sessionId: SID,
          steering: ["a", "b"],
          followUp: ["c"],
        }));
        setTimeout(resolve, 100);
      });
    });
    expect(sessionManager.get(SID)?.pendingQueues?.steering).toHaveLength(2);
    expect(sessionManager.get(SID)?.pendingQueues?.followUp).toHaveLength(1);
    ws1.close();
    await wait(80);

    // Second bridge re-registers same sessionId — pendingQueues MUST reset.
    const ws2 = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => {
      ws2.on("open", () => {
        ws2.send(JSON.stringify({
          type: "session_register",
          sessionId: SID,
          cwd: tmpDir,
          source: "cli",
          sessionFile,
        }));
        ws2.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        setTimeout(resolve, 100);
      });
    });
    expect(sessionManager.get(SID)?.pendingQueues).toEqual({ steering: [], followUp: [] });
    ws2.close();
  });
});

/**
 * Bounded, `stopped`-protecting retention of the last auto-naming outcome per
 * session (`auto_name_outcome` handling).
 *
 * A stop can happen with nobody subscribed — the toast only reaches a connected
 * client — so without retention the operator's only recourse is `server.log`.
 * Retention is in-memory by design: a diagnostic readout of what THIS process
 * observed, never a new persisted file.
 *
 * See change: fix-auto-naming-reasoning-model (design D9, test-plan #E28–#E32, #P4).
 */
describe("auto-naming outcome retention", () => {
  const entry = (sessionId: string, outcome: any = "waiting", at = 0) => ({
    sessionId, outcome, reason: `r-${sessionId}`, at,
  });

  it("E28: the bound is ABSOLUTE — 501 sessions retain at most 500", () => {
    const store = new AutoNameOutcomeStore(500);
    for (let i = 0; i < 501; i++) store.record(entry(`s${i}`));
    expect(store.size).toBe(500);
  });

  it("E29: a `stopped` entry is protected — routine churn is evicted first", () => {
    // Plain LRU would evict the stop from an idle session before an operator
    // ever looked at it, which is the one entry worth keeping.
    const store = new AutoNameOutcomeStore(500);
    store.record(entry("stopped-one", "stopped"));
    for (let i = 0; i < 500; i++) store.record(entry(`s${i}`, "waiting"));
    expect(store.size).toBe(500);
    expect(store.get("stopped-one")).toMatchObject({ outcome: "stopped" });
  });

  it("E30: when `stopped` entries ALONE overflow, the OLDEST stopped goes", () => {
    // "Bounded" and "protected" collide exactly here — a misconfigured naming
    // model stops every session. The bound wins; protection is only an order.
    const store = new AutoNameOutcomeStore(500);
    for (let i = 0; i < 501; i++) store.record(entry(`s${i}`, "stopped", i));
    expect(store.size).toBe(500);
    expect(store.get("s0")).toBeUndefined();
    expect(store.get("s500")).toBeDefined();
  });

  it("E31: a second report REPLACES the first — only the latest is retained", () => {
    const store = new AutoNameOutcomeStore(500);
    store.record(entry("s1", "waiting"));
    store.record(entry("s1", "starved"));
    expect(store.size).toBe(1);
    expect(store.get("s1")).toMatchObject({ outcome: "starved" });
  });

  it("E32: retention writes no file — it is in-memory only", () => {
    const store = new AutoNameOutcomeStore(500);
    const dir = mkdtempSync(path.join(os.tmpdir(), "auto-name-outcomes-"));
    const before = readdirSync(dir);
    for (let i = 0; i < 50; i++) store.record(entry(`s${i}`));
    expect(readdirSync(dir)).toEqual(before);
  });

  it("P4: 5000 reporting sessions never exceed the bound", () => {
    const store = new AutoNameOutcomeStore(500);
    for (let i = 0; i < 5000; i++) {
      store.record(entry(`s${i}`, i % 7 === 0 ? "stopped" : "waiting"));
      expect(store.size).toBeLessThanOrEqual(500);
    }
    expect(store.size).toBe(500);
  });
});

/**
 * CodeRabbit: the gateway casts raw JSON, so an `auto_name_outcome` frame is
 * unvalidated by the time `event-wiring` sees it. An unknown outcome VALUE
 * would render as a raw string in Diagnostics and defeat the starved/waiting
 * distinction the readout exists to make.
 * See change: fix-auto-naming-reasoning-model.
 */
describe("auto-naming outcome taxonomy", () => {
  it("covers every outcome the bridge can report", () => {
    // Kept in lockstep with the AutoNameOutcome union in shared/protocol.ts.
    for (const o of ["applied", "waiting", "starved", "skipped-prefilter", "locked-out",
                     "disabled", "already-named", "not-ready", "retrying", "stopped"]) {
      expect(AUTO_NAME_OUTCOMES.has(o)).toBe(true);
    }
    expect(AUTO_NAME_OUTCOMES.size).toBe(10);
  });

  it("rejects an unknown outcome value", () => {
    expect(AUTO_NAME_OUTCOMES.has("nonsense")).toBe(false);
    expect(AUTO_NAME_OUTCOMES.has("")).toBe(false);
  });
});
