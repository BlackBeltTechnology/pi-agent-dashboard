/**
 * Manifest `emits` enforced by the REAL server wiring (status-store liveness,
 * manifest capture at context creation, per-plugin provider attribution):
 * a trusted plugin emits only declared types, an undeclared type / untrusted
 * plugin / raw lane is refused with nothing reaching the bridge, and a spoofed
 * `automation.action.<source>` provide is refused.
 * See change: harden-git-terminal-plugin-boundaries (D16; test-plan #SE24, #SE20 against the real host).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createServer, type DashboardServer } from "../server.js";
import { resetEmitWarnings } from "../plugin-event-seam.js";
import { installFakePlugin, pluginCtx, resetPluginHostHarness } from "./helpers/plugin-host-harness.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

describe("plugin emits allowlist — real server wiring", () => {
  let server: DashboardServer;
  let bridge: WebSocket;
  let cwd: string;
  const received: Array<{ type?: string; eventType?: string }> = [];

  beforeAll(async () => {
    resetPluginHostHarness();
    resetEmitWarnings();
    installFakePlugin({ id: "emit-declared", priority: 50, emits: ["flow:run"] });
    installFakePlugin({ id: "emit-undeclared", priority: 50 });
    installFakePlugin({ id: "emit-untrusted", priority: 500, emits: ["flow:run"] });
    server = await createServer({ port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false });
    await server.start();
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-emit-allowlist-"));
    bridge = new WebSocket(`ws://127.0.0.1:${server.piPort()!}`);
    await waitForOpen(bridge);
    bridge.on("message", (raw) => {
      try {
        received.push(JSON.parse(String(raw)));
      } catch { /* non-JSON */ }
    });
    bridge.send(JSON.stringify({ type: "session_register", sessionId: "s1", cwd, source: "cli" }));
    await delay(250);
  });

  afterAll(async () => {
    bridge?.close();
    await server?.stop();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const emitted = () => received.filter((m) => m.type === "plugin_emit_event").map((m) => m.eventType);

  it("delivers a declared type and refuses everything else with nothing sent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = emitted().length;

    expect(pluginCtx("emit-declared").emitEventToSession("s1", "flow:run", { flowName: "x" })).toBe(true);
    expect(pluginCtx("emit-declared").emitEventToSession("s1", "custom:thing")).toBe(false);
    expect(pluginCtx("emit-declared").emitEventToSession("s1", "roles:set")).toBe(false);
    expect(pluginCtx("emit-declared").emitEventToSession("s1", "flow:run2")).toBe(false);
    expect(pluginCtx("emit-undeclared").emitEventToSession("s1", "flow:run")).toBe(false);
    expect(pluginCtx("emit-untrusted").emitEventToSession("s1", "flow:run")).toBe(false);
    expect(
      pluginCtx("emit-declared").sendExtensionMessage("s1", { type: "plugin_emit_event", eventType: "roles:set" }),
    ).toBe(false);

    await delay(150);
    expect(emitted().slice(before)).toEqual(["flow:run"]);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('"emit-undeclared"') && l.includes("emits"))).toBe(true);
    warn.mockRestore();
  });

  it("refuses a spoofed automation.action.<source> provide and keeps the owner's value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pluginCtx("emit-declared").provide("automation.action.emit-declared", { id: "emit-declared.run" });
    pluginCtx("emit-undeclared").provide("automation.action.emit-declared", { id: "evil.run" });
    const entries = pluginCtx("emit-declared").consumeAll("automation.action.emit-declared");
    expect(entries).toEqual([
      { key: "automation.action.emit-declared", value: { id: "emit-declared.run" }, provider: "emit-declared" },
    ]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("emit-undeclared"))).toBe(true);
    warn.mockRestore();
  });
});
