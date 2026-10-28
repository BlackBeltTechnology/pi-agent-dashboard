/**
 * E10: a session spawned with an initial prompt receives the current
 * preferences snapshot BEFORE its first `send_prompt`, so its first agent run
 * already uses the Claude subscription compat switch value.
 *
 * Drives the real server: a fake bridge registers over the pi WebSocket and
 * the test records the order of inbound control messages.
 * See change: retire-anthropic-messages-bridge (design D3, test-plan #E10).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";
import { proofFetch } from "../test-support/local-credential-stamp.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("preferences snapshot precedes the initial prompt (E10)", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;

  beforeEach(async () => {
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    piPort = server.piPort()!;
    browserPort = server.httpPort()!;
  });

  afterEach(async () => {
    await server.stop();
  });

  it("sends preferences_update with the compat value before send_prompt", async () => {
    const patch = await proofFetch(`http://127.0.0.1:${browserPort}/api/preferences/claude-subscription-compat`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: true }),
    });
    expect(patch.ok).toBe(true);

    const cwd = "/tmp/e10-initial-prompt";
    expect(server.pendingInitialPromptRegistry.enqueue(cwd, "/skill:project-init")).toBe(true);

    const inbound: Array<{ type: string; [k: string]: unknown }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    ws.on("message", (raw) => {
      try { inbound.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.send(JSON.stringify({ type: "session_register", sessionId: "e10", cwd, source: "cli" }));
    ws.send(JSON.stringify({ type: "replay_complete", sessionId: "e10" }));
    await wait(150);
    ws.close();

    const promptIdx = inbound.findIndex((m) => m.type === "send_prompt");
    expect(promptIdx, "initial prompt must be dispatched").toBeGreaterThan(-1);
    const prefsIdx = inbound.findIndex(
      (m) => m.type === "preferences_update" && m.claudeSubscriptionCompat === true,
    );
    expect(prefsIdx, "compat snapshot must be pushed").toBeGreaterThan(-1);
    expect(prefsIdx).toBeLessThan(promptIdx);
  });
});
