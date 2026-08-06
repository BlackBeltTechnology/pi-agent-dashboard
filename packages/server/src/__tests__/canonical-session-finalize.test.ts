/**
 * §4 — honest lifecycle: an invoicebot spawned session (kind="automation", stamped
 * `invoicebot*`) is finalized to `ended` on a genuine bridge close, never left
 * `active` with no bridge (the phantom-active state that makes handleSendPrompt
 * take the live-send branch and silently drop the prompt).
 *
 * The finalize itself is provided by `finalize-automation-run-on-session-death`
 * (the gateway ws-close path treats kind="automation" as terminal, no grace).
 * Invoicebot dispatch + scoped spawns are stamped kind="automation", so they
 * inherit it. This test LOCKS that invariant for this change and asserts the
 * ended session is KEPT (getSession still returns it, status "ended", so the
 * durable store can resume it) rather than deleted.
 *
 * See change: make-invoice-session-canonical (§4).
 */
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi-gateway.js";
import { createMemorySessionManager } from "../memory-session-manager.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", resolve);
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

// Long heartbeat so a status change in-window can only come from the
// automation close-is-terminal path, never a heartbeat timeout.
const LONG_HB = 5000;
let portCounter = 19640;

describe("invoicebot spawned session finalize-on-close (§4)", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  afterEach(() => gateway?.stop());

  it("finalizes a scoped invoicebot session to ended on bridge close, and KEEPS it resumable", async () => {
    const sm = createMemorySessionManager();
    const ended: string[] = [];
    sm.onUnregister = (sid) => ended.push(sid);
    gateway = createPiGateway(sm, { heartbeatTimeout: LONG_HB });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "ib-scoped-1",
        cwd: "/work/acme",
        source: "dashboard",
        sessionFile: "/work/acme/.session.jsonl",
      }),
    );
    await delay(100);
    // The host stamps kind="automation" + the invoicebot automationRun on
    // register (event-wiring ← pendingAutomationRunRegistry). Emulate it.
    sm.update("ib-scoped-1", {
      kind: "automation",
      automationRun: { name: "invoicebot-scoped:INV-1", runId: "r1", visibility: "shown" },
    });
    expect(sm.get("ib-scoped-1")!.status).toBe("active");

    ws.close();
    await delay(200); // well under LONG_HB — only the close-is-terminal path can fire

    const after = sm.get("ib-scoped-1");
    expect(after).toBeDefined(); // KEPT, not deleted
    expect(after!.status).toBe("ended"); // honest lifecycle — no phantom-active
    expect(after!.sessionFile).toBe("/work/acme/.session.jsonl"); // still resumable
    expect(ended).toContain("ib-scoped-1"); // onUnregister → plugin onSessionEnded → engine finalize
  }, 10000);
});
