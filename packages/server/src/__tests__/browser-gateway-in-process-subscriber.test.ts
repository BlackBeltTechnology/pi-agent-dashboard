/**
 * Tests for the in-process session-frame subscriber seam — the headless-client
 * lane a plugin (chat-gateway) uses to consume the browser protocol WITHOUT a
 * WebSocket.
 *
 * Covers the four load-bearing invariants:
 *   - `sendToSubscribers` and `broadcastEvent` both fan out to in-process
 *     subscribers (the two live-frame choke points);
 *   - per-session isolation;
 *   - one throwing subscriber never breaks the others;
 *   - unsubscribe is idempotent, and pending-prompt replay reaches a new
 *     subscriber.
 *
 * See change: add-chat-gateway.
 */
import { describe, expect, it, vi } from "vitest";
import { createBrowserGateway } from "../pairing/browser-gateway.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGateway(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionManager = {} as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventStore = {} as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const piGateway = {} as any;
  return createBrowserGateway(sessionManager, eventStore, piGateway);
}

describe("browserGateway in-process subscribers", () => {
  it("delivers sendToSubscribers frames to the session's in-process subscriber", () => {
    const gateway = makeGateway();
    const seen: unknown[] = [];
    gateway.addInProcessSubscriber("s1", (m: unknown) => seen.push(m));

    gateway.sendToSubscribers("s1", { type: "prompt_dismiss", sessionId: "s1", promptId: "p1" });

    expect(seen).toEqual([{ type: "prompt_dismiss", sessionId: "s1", promptId: "p1" }]);
  });

  it("delivers live broadcastEvent frames to the session's in-process subscriber", () => {
    const gateway = makeGateway();
    const seen: Array<{ type: string; seq: number }> = [];
    gateway.addInProcessSubscriber("s1", (m: { type: string; seq: number }) => seen.push(m));

    gateway.broadcastEvent("s1", 7, { eventType: "message_update" });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "event", sessionId: "s1", seq: 7 });
  });

  it("isolates subscribers per session", () => {
    const gateway = makeGateway();
    const a = vi.fn();
    const b = vi.fn();
    gateway.addInProcessSubscriber("s1", a);
    gateway.addInProcessSubscriber("s2", b);

    gateway.broadcastEvent("s1", 1, { eventType: "x" });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("a throwing subscriber never breaks its siblings", () => {
    const gateway = makeGateway();
    const bad = vi.fn(() => {
      throw new Error("subscriber blew up");
    });
    const good = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    gateway.addInProcessSubscriber("s1", bad);
    gateway.addInProcessSubscriber("s1", good);

    expect(() => gateway.broadcastEvent("s1", 1, { eventType: "x" })).not.toThrow();

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("unsubscribe is idempotent and stops delivery", () => {
    const gateway = makeGateway();
    const handler = vi.fn();
    const off = gateway.addInProcessSubscriber("s1", handler);

    off();
    off(); // second call must be a no-op, not an error

    gateway.broadcastEvent("s1", 1, { eventType: "x" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("replays a pending PromptBus request to a new in-process subscriber", () => {
    const gateway = makeGateway();
    gateway.trackPromptRequest("s1", { type: "prompt_request", sessionId: "s1", promptId: "p1" });

    const seen: unknown[] = [];
    gateway.addInProcessSubscriber("s1", (m: unknown) => seen.push(m));
    gateway.replayPendingPromptsTo("s1", (m: unknown) => seen.push(m));

    expect(seen).toEqual([{ type: "prompt_request", sessionId: "s1", promptId: "p1" }]);
  });
});
