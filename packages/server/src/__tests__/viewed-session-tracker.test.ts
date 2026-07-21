import { describe, it, expect } from "vitest";
import type { WebSocket } from "ws";
import { createViewedSessionTracker } from "../session/viewed-session-tracker.js";

/**
 * Server-side viewed-session tracker. Mirrors mail/Slack global read state.
 * See change: session-card-unread-stripes.
 */

// Lightweight stand-ins for `ws.WebSocket`. The tracker only uses the
// references for identity in `Set<WebSocket>`, so we don't need real sockets.
function fakeWs(label: string): WebSocket {
  return { __label: label } as unknown as WebSocket;
}

describe("createViewedSessionTracker", () => {
  it("starts empty: no session is viewed", () => {
    const t = createViewedSessionTracker();
    expect(t.isViewedByAnyone("abc")).toBe(false);
    expect(t.viewerCount("abc")).toBe(0);
  });

  it("view() makes a session viewed", () => {
    const t = createViewedSessionTracker();
    const ws = fakeWs("a");
    t.view("abc", ws);
    expect(t.isViewedByAnyone("abc")).toBe(true);
    expect(t.viewerCount("abc")).toBe(1);
  });

  it("view() is idempotent for the same ws", () => {
    const t = createViewedSessionTracker();
    const ws = fakeWs("a");
    t.view("abc", ws);
    t.view("abc", ws);
    expect(t.viewerCount("abc")).toBe(1);
  });

  it("two viewers, one disconnects → still viewed", () => {
    const t = createViewedSessionTracker();
    const a = fakeWs("a");
    const b = fakeWs("b");
    t.view("abc", a);
    t.view("abc", b);
    expect(t.viewerCount("abc")).toBe(2);
    t.unview("abc", a);
    expect(t.isViewedByAnyone("abc")).toBe(true);
    expect(t.viewerCount("abc")).toBe(1);
  });

  it("last viewer unviews → no longer viewed", () => {
    const t = createViewedSessionTracker();
    const ws = fakeWs("a");
    t.view("abc", ws);
    t.unview("abc", ws);
    expect(t.isViewedByAnyone("abc")).toBe(false);
    expect(t.viewerCount("abc")).toBe(0);
  });

  it("unview() of an unknown session is a no-op", () => {
    const t = createViewedSessionTracker();
    const ws = fakeWs("a");
    expect(() => t.unview("never-seen", ws)).not.toThrow();
    expect(t.isViewedByAnyone("never-seen")).toBe(false);
  });

  it("unviewAll() removes a ws from every session", () => {
    const t = createViewedSessionTracker();
    const a = fakeWs("a");
    const b = fakeWs("b");
    t.view("s1", a);
    t.view("s2", a);
    t.view("s2", b);
    t.unviewAll(a);
    expect(t.isViewedByAnyone("s1")).toBe(false);
    expect(t.isViewedByAnyone("s2")).toBe(true); // b still views s2
    expect(t.viewerCount("s2")).toBe(1);
  });

  it("unviewAll() with no viewing sessions is a no-op", () => {
    const t = createViewedSessionTracker();
    const ws = fakeWs("a");
    expect(() => t.unviewAll(ws)).not.toThrow();
  });

  it("multiple sessions are tracked independently", () => {
    const t = createViewedSessionTracker();
    const ws = fakeWs("a");
    t.view("s1", ws);
    expect(t.isViewedByAnyone("s1")).toBe(true);
    expect(t.isViewedByAnyone("s2")).toBe(false);
  });
});
