/**
 * The subagents plugin's per-subagent stop relay passes the REAL emit seam:
 * its manifest declares `emits: ["subagents:stop"]` at a trusted priority, and a
 * plugin carrying exactly that manifest gets `subagents:stop` delivered to the
 * bridge (and nothing it did not declare).
 *
 * Covers test-plan #E10. Modelled on `plugin-emit-allowlist-integration.test.ts`.
 * See change: subagent-queue-visibility (D3).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";
import { resetEmitWarnings } from "../plugin-event-seam.js";
import { createServer, type DashboardServer } from "../server.js";
import { installFakePlugin, pluginCtx, resetPluginHostHarness } from "./helpers/plugin-host-harness.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const manifestPath = path.resolve(__dirname, "../../../subagents-plugin/package.json");
const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, "utf-8"))["pi-dashboard-plugin"]);

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

describe("subagents stop relay vs the real emit seam (#E10)", () => {
  let server: DashboardServer;
  let bridge: WebSocket;
  let cwd: string;
  const received: Array<{ type?: string; eventType?: string; data?: unknown }> = [];
  const PROBE = "subagents-stop-probe";

  it("the shipped manifest declares the stop event at a trusted priority", () => {
    expect(manifest.emits).toContain("subagents:stop");
    expect(manifest.priority ?? 1000).toBeLessThanOrEqual(100);
  });

  beforeAll(async () => {
    resetPluginHostHarness();
    resetEmitWarnings();
    installFakePlugin({ id: PROBE, priority: manifest.priority ?? 1000, emits: manifest.emits });
    server = await createServer({ port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false });
    await server.start();
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "subagents-stop-emit-"));
    bridge = new WebSocket(`ws://127.0.0.1:${server.piPort()!}`);
    await waitForOpen(bridge);
    bridge.on("message", (raw) => {
      try {
        received.push(JSON.parse(String(raw)));
      } catch {
        /* non-JSON */
      }
    });
    bridge.send(JSON.stringify({ type: "session_register", sessionId: "s1", cwd, source: "cli" }));
    await delay(250);
  });

  afterAll(async () => {
    bridge?.close();
    await server?.stop();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("the seam accepts subagents:stop {agentId} and refuses an undeclared type", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(pluginCtx(PROBE).emitEventToSession("s1", "subagents:stop", { agentId: "ag-1" })).toBe(true);
    expect(pluginCtx(PROBE).emitEventToSession("s1", "subagents:spawn", { agentId: "ag-1" })).toBe(false);
    await delay(150);
    const emits = received.filter((m) => m.type === "plugin_emit_event");
    expect(emits.map((m) => m.eventType)).toEqual(["subagents:stop"]);
    expect(emits[0].data).toEqual({ agentId: "ag-1" });
    warn.mockRestore();
  });
});
