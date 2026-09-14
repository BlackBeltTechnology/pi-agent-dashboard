import { type ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection.js";

/**
 * Real-timer, out-of-process regression test for the poll-phase force-close.
 *
 * Fake timers CANNOT express this bug. It is an event-loop ORDERING defect:
 * when the loop is blocked inside an I/O callback (the poll phase), it wraps to
 * the TIMERS phase before it can re-enter poll, so the watchdog reads a
 * `lastMessageAt` that is stale only because the frames refreshing it are still
 * sitting unread in the socket buffer. Under `vi.advanceTimersByTime` there are
 * no real socket reads to lose that race, so the bug is invisible.
 *
 * The peer therefore runs in its OWN process: blocking this one must not stop
 * it sending, otherwise the silence is genuine and the test proves nothing.
 * (An earlier in-process version of this spike reported the opposite result
 * for exactly that reason.)
 */

// Real timers mean real waiting; keep every interval small.
const CHECK_INTERVAL = 200;
const WATCHDOG_TIMEOUT = 1_000;
const ACK_EVERY = 100;
const BLOCK_MS = 1_500; // > WATCHDOG_TIMEOUT, so a stale read must trip it

const PEER_SRC = `
const { WebSocketServer } = require("ws");
const wss = new WebSocketServer({ port: Number(process.argv[1]) });
wss.on("connection", (ws) => {
  process.stdout.write("conn\\n");
  const t = setInterval(() => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: "heartbeat_ack" }));
  }, ${ACK_EVERY});
  ws.on("close", () => clearInterval(t));
});
process.stdout.write("ready\\n");
`;

describe("watchdog under a poll-phase block", () => {
  let peer: ChildProcess | undefined;
  let cm: ConnectionManager | undefined;
  let originalInterval: number;

  afterEach(() => {
    cm?.disconnect();
    peer?.kill("SIGKILL");
    (ConnectionManager as any).WATCHDOG_CHECK_INTERVAL = originalInterval;
  });

  it("does not force-close a peer that is still sending", async () => {
    originalInterval = (ConnectionManager as any).WATCHDOG_CHECK_INTERVAL;
    (ConnectionManager as any).WATCHDOG_CHECK_INTERVAL = CHECK_INTERVAL;

    const port = 45_000 + Math.floor(Math.random() * 2_000);
    peer = spawn(process.execPath, ["-e", PEER_SRC, String(port)], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let connections = 0;
    let peerReady = false;
    peer.stdout?.on("data", (b: Buffer) => {
      for (const line of b.toString().split("\n")) {
        if (line === "ready") peerReady = true;
        if (line === "conn") connections++;
      }
    });
    await vi.waitFor(() => expect(peerReady).toBe(true), { timeout: 5_000 });

    const fires: unknown[] = [];
    let received = 0;
    cm = new ConnectionManager({
      url: `ws://127.0.0.1:${port}`,
      watchdogTimeout: WATCHDOG_TIMEOUT,
      onWatchdogFire: (info) => fires.push(info),
      onMessage: () => {
        received++;
        // Block INSIDE the I/O callback, exactly where the bridge blocks
        // (tool handlers, git scans). The peer keeps sending throughout.
        if (received === 3) {
          const until = Date.now() + BLOCK_MS;
          while (Date.now() < until) {
            /* starve the loop */
          }
        }
      },
    });
    cm.connect();

    // Long enough to cover the block plus several post-unblock check ticks.
    await new Promise((r) => setTimeout(r, BLOCK_MS + 1_500));

    // The peer never stopped sending, so the silence was an artifact of our own
    // starvation: closing here would drop a healthy connection and lose every
    // event emitted during the reconnect window.
    expect(fires).toHaveLength(0);
    expect(connections).toBe(1);
    expect(received).toBeGreaterThan(3);
  }, 20_000);
});
