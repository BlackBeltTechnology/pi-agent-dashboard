/**
 * Regression: the browser→server gateway MUST forward `role_remove` to the
 * target session bridge, exactly like its sibling role messages (`role_set`,
 * `role_preset_*`, `request_roles`). Without this case the custom-role remove
 * feature is dead end-to-end — the client dispatch is silently dropped at the
 * server and never reaches the bridge `roles:remove` handler.
 *
 * Caught by cross-model doubt-driven review. See change: add-custom-roles-ui.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";

function makeFakeWs() {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
    OPEN: number;
  };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.readyState = 1;
  ws.OPEN = 1;
  return ws;
}

function makeStubPiGateway(): PiGateway {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []),
    hasSession: vi.fn(() => false),
    onEvent: vi.fn(),
  } as unknown as PiGateway;
}

describe("browser-gateway role_remove forwarding", () => {
  it("forwards role_remove to the target session bridge", async () => {
    const piGateway = makeStubPiGateway();
    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      piGateway,
    );

    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});

    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({ type: "role_remove", sessionId: "sess-1", role: "review" }),
      ),
    );
    await new Promise((r) => setImmediate(r));

    expect(piGateway.sendToSession).toHaveBeenCalledWith("sess-1", {
      type: "role_remove",
      sessionId: "sess-1",
      role: "review",
    });
  });
});
