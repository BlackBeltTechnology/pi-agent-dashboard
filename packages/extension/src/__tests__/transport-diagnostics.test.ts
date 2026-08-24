/**
 * Task 10.5 — the transport diagnostics of 10.1/10.2 must survive the DEFAULT
 * configuration, not just a debugging one.
 *
 * `keeperLog.capturePiOutput` is false by default, so every `console.log` the
 * bridge writes goes to /dev/null. A diagnostic that only exists there is not
 * observability; it is a comment. So the endpoint decision and every refusal to
 * re-target travel to the server as messages, the way `inbound_drop_report`
 * already does for dropped frames.
 *
 * The buffering is the load-bearing part: endpoint resolution happens BEFORE a
 * socket exists, so a live-socket-only report would lose exactly the diagnostic
 * that explains a connection to the wrong dashboard.
 *
 * See change: add-pi-gateway-transport-identity (tasks 10.1, 10.2, 10.5).
 */
import { describe, expect, it } from "vitest";
import { createTransportDiagnostics } from "../transport-diagnostics.js";

describe("createTransportDiagnostics", () => {
  it("buffers a diagnostic recorded before any socket exists, then flushes it", () => {
    const sent: unknown[] = [];
    const d = createTransportDiagnostics();
    d.record({ event: "endpoint_resolved", detail: "source=socket pinned=true" });
    expect(sent).toHaveLength(0);

    d.attach({ send: (m) => sent.push(m), getSessionId: () => "s1" });
    expect(sent).toEqual([
      {
        type: "bridge_diagnostic",
        sessionId: "s1",
        event: "endpoint_resolved",
        detail: "source=socket pinned=true",
      },
    ]);
  });

  it("sends straight through once attached", () => {
    const sent: any[] = [];
    const d = createTransportDiagnostics();
    d.attach({ send: (m) => sent.push(m), getSessionId: () => "s1" });
    d.record({ event: "retarget_refused", detail: "a -> b: pinned" });
    expect(sent).toHaveLength(1);
    expect(sent[0].event).toBe("retarget_refused");
  });

  it("holds the buffer while the session id is not yet known", () => {
    const sent: any[] = [];
    const d = createTransportDiagnostics();
    let id: string | undefined;
    d.attach({ send: (m) => sent.push(m), getSessionId: () => id });
    d.record({ event: "endpoint_resolved", detail: "x" });
    expect(sent).toHaveLength(0);

    // Registration completes and the id appears; the next record drains both.
    id = "s2";
    d.record({ event: "retarget_refused", detail: "y" });
    expect(sent.map((m) => m.event)).toEqual(["endpoint_resolved", "retarget_refused"]);
    expect(sent.every((m) => m.sessionId === "s2")).toBe(true);
  });

  it("bounds the buffer rather than growing without limit", () => {
    // A bridge that never registers must not accumulate diagnostics forever;
    // an unbounded buffer turns a connectivity failure into a memory leak.
    const d = createTransportDiagnostics({ maxBuffered: 3 });
    for (let i = 0; i < 10; i++) d.record({ event: "retarget_refused", detail: `r${i}` });
    const sent: any[] = [];
    d.attach({ send: (m) => sent.push(m), getSessionId: () => "s" });
    expect(sent).toHaveLength(3);
    // The OLDEST are dropped: the most recent refusals explain the current
    // state, and the first ones are the least likely to still be true.
    expect(sent.map((m) => m.detail)).toEqual(["r7", "r8", "r9"]);
  });

  it("survives a send that throws, without losing the rest of the buffer", () => {
    const d = createTransportDiagnostics();
    d.record({ event: "endpoint_resolved", detail: "a" });
    d.record({ event: "retarget_refused", detail: "b" });
    const seen: any[] = [];
    let first = true;
    d.attach({
      send: (m) => {
        if (first) {
          first = false;
          throw new Error("socket closed mid-flush");
        }
        seen.push(m);
      },
      getSessionId: () => "s",
    });
    expect(seen.map((m) => m.detail)).toEqual(["b"]);
  });
});
