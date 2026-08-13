/**
 * Scenario E21 — a failed startup must not leave a live gateway timer holding
 * the event loop. The captured zombie (PID 78379) survived precisely because
 * closing a socket does not end a process whose loop an interval holds.
 *
 * Asserted on the source rather than by binding a real WebSocketServer: a
 * bound gateway leaves a socket handle in the vitest worker, and an unclosed
 * handle stalls the worker's exit rather than failing a test. The teardown
 * ORDER (gateway first) is pinned by `start-teardown-wiring.test.ts`, and the
 * teardown-then-rethrow behaviour by `bounded-startup.test.ts`.
 *
 * See change: fix-worktree-server-autostart-leak.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GATEWAY_TS = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "pi", "pi-gateway.ts"),
  "utf8",
);

describe("piGateway.stop() releases everything that holds the loop", () => {
  const stopBody = GATEWAY_TS.slice(
    GATEWAY_TS.indexOf("    stop() {"),
    GATEWAY_TS.indexOf("    sendToSession("),
  );

  it("the ping interval installed by start() is cleared", () => {
    expect(GATEWAY_TS).toMatch(/pingTimer = setInterval\(/);
    expect(stopBody).toContain("clearInterval(pingTimer)");
    expect(stopBody).toContain("pingTimer = null");
  });

  it("every heartbeat timer is cleared", () => {
    expect(stopBody).toContain("clearTimeout(timer)");
    expect(stopBody).toContain("heartbeatTimers.clear()");
  });

  it("the listening socket is closed and the handle dropped", () => {
    expect(stopBody).toContain("wss?.close()");
    expect(stopBody).toContain("wss = null");
  });
});
