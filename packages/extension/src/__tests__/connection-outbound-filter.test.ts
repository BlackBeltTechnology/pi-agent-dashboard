/**
 * `outboundFilter`: rewritten frames are what gets serialized AND buffered, so
 * no plaintext value sits in the send buffer; a throwing filter fails closed for
 * forwarded events and open for everything else.
 * See change: add-credential-vault (D5.3).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection.js";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  url: string;
  constructor(url: string) { this.url = url; MockWebSocket.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}

const mk = (outboundFilter: (m: unknown) => unknown[]) => {
  const cm = new ConnectionManager({ url: "ws://localhost:9999", WebSocketImpl: MockWebSocket as never, outboundFilter });
  cm.connect();
  return { cm, ws: MockWebSocket.instances.at(-1) as MockWebSocket };
};
const ev = { type: "event_forward", sessionId: "s", event: { eventType: "x", timestamp: 1, data: { t: "SECRET" } } };

beforeEach(() => { MockWebSocket.instances = []; vi.useFakeTimers(); });

describe("outboundFilter", () => {
  it("sends the filtered frames in order, and buffers the filtered form while disconnected", () => {
    const { cm, ws } = mk((m) => [{ ...(m as object), t: 1 }, { type: "extra" }]);
    cm.send(ev); // not open yet: buffered after filtering
    ws.open();
    const wire = ws.sent.map((s) => JSON.parse(s).type);
    expect(wire).toContain("extra");
    cm.send({ type: "ping" });
    expect(ws.sent.slice(-2).map((s) => JSON.parse(s).type)).toEqual(["ping", "extra"]);
  });

  it("sendIfOpen applies the filter too", () => {
    const { cm, ws } = mk((m) => [m, { type: "tail" }]);
    ws.open();
    expect(cm.sendIfOpen({ type: "a" })).toBe(true);
    expect(ws.sent.slice(-2).map((s) => JSON.parse(s).type)).toEqual(["a", "tail"]);
  });

  it("fails closed for a forwarded event and open for anything else when the filter throws", () => {
    const { cm, ws } = mk(() => { throw new Error("boom"); });
    ws.open();
    const before = ws.sent.length;
    cm.send(ev);
    expect(ws.sent.length).toBe(before);
    cm.send({ type: "session_heartbeat" });
    expect(JSON.parse(ws.sent.at(-1) as string).type).toBe("session_heartbeat");
  });
});
