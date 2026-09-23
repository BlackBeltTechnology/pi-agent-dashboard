/**
 * Browser socket close diagnostics: one line per close carrying code, reason,
 * lifetime, inbound frames and cause (test-plan #E8, #E9, #X3, #X4).
 *
 * See change: harden-ios-safari-memory-and-ws-diagnostics (design D3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket as WsSocket } from "ws";
import { type RealBrowserWsHarness, startRealBrowserWs, until } from "./helpers/real-browser-ws.js";
import { attachCapturedWs, buildDebtGateway } from "./helpers/status-debt-fixtures.js";

const PREFIX = "[browser-gw] browser client disconnected (remaining:";

let errorSpy: ReturnType<typeof vi.spyOn>;
let harness: RealBrowserWsHarness | undefined;

const closeLines = (): string[] =>
  errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.startsWith(PREFIX));

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  errorSpy.mockRestore();
});

describe("browser close line (test-plan #E8)", () => {
  it("logs code, reason, lifetime, frames and cause=peer on a normal close", async () => {
    harness = await startRealBrowserWs();
    const ws = await harness.connect();
    for (let i = 0; i < 3; i++) ws.send("not-json");
    ws.close(1000, "bye");
    await until(() => closeLines().length > 0);
    await new Promise((r) => setTimeout(r, 20));
    const lines = closeLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ code=1000 reason="bye" lifetime=\d+(\.\d+)?s frames=3 cause=peer$/);
  });
});

describe("close reason cannot break the line (test-plan #E9)", () => {
  it("JSON-escapes quotes and newlines", async () => {
    harness = await startRealBrowserWs();
    const ws = await harness.connect();
    ws.close(4000, 'a"b\nc');
    await until(() => closeLines().length > 0);
    const [line] = closeLines();
    expect(line).not.toContain("\n");
    expect(line).toContain(`reason=${JSON.stringify('a"b\nc')}`);
  });
});

describe("abrupt peer drop (test-plan #X3)", () => {
  it("logs code=1006 with an empty reason and cause=peer", async () => {
    harness = await startRealBrowserWs();
    const ws = await harness.connect();
    (ws as WsSocket & { _socket: { destroy(): void } })._socket.destroy();
    await until(() => closeLines().length > 0);
    const lines = closeLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ code=1006 reason="" lifetime=\d+(\.\d+)?s frames=0 cause=peer$/);
  });
});

describe("stalled byte-ceiling terminate (test-plan #X4)", () => {
  it("logs cause=stalled for a socket terminated over the pending-state ceiling", () => {
    const { gateway } = buildDebtGateway([], 1000);
    const client = attachCapturedWs(gateway, 1000);
    client.saturate();
    // Distinct keys accumulate pending state until the byte ceiling trips.
    for (let i = 0; i < 20 && client.ws.terminatedCount() === 0; i++) {
      gateway.broadcastOpenSpecUpdate(`/k${i}`, JSON.stringify({ pad: "x".repeat(200) }));
    }
    expect(client.ws.terminatedCount()).toBe(1);
    // A real `terminate()` surfaces as close(1006, <empty>).
    client.ws.emit("close", 1006, Buffer.alloc(0));
    const lines = closeLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ code=1006 reason="" .* cause=stalled$/);
  });
});
