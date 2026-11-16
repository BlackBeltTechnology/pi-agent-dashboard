/**
 * Held steers across bridge boundaries: a session change drops both buffers
 * (with their image bytes), and every (re-)register re-announces the bridge's
 * queues so the server cache never keeps a previous bridge's steers.
 *
 * Covers test-plan rows E23 (behavioural, real `registerSessionStart`) and E24.
 *
 * @structural-pin bridge.ts / lifecycle.ts cannot be instantiated in a test up to the register send; the re-announce after each `session_register` is pinned in their text (same approach as bridge-replay-live-tail.test.ts), with emitQueueUpdate's empty-buffer payload covered by bridge-steer-handoff.test.ts
 * See change: bridge-owned-cancellable-steer (D7).
 */
import { describe, expect, it, vi } from "vitest";
import { createFollowupBuffer } from "../followup-buffer.js";
import { createSteerBuffer } from "../steer-buffer.js";
import { makeStubInstance } from "./helpers/bridge-instance-stub.js";
import { readBridgeSource } from "./helpers/bridge-source.js";

const IMG = { type: "image" as const, data: "QUJDRA==", mimeType: "image/png" };

function region(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start, `start marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start + startMarker.length);
  expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(-1);
  return src.slice(start, end);
}

describe("E23: a session change drops both buffers", () => {
  it("resume to another session empties steer + follow-up buffers, releases bytes, announces empty queues", async () => {
    vi.resetModules();
    vi.doMock("../session-sync.js", async (orig) => ({
      ...(await orig<typeof import("../session-sync.js")>()),
      handleSessionChange: vi.fn(),
    }));
    const { registerSessionStart } = await import("../bridge-handlers/lifecycle.js");
    const steer = createSteerBuffer("n");
    const followUp = createFollowupBuffer();
    steer.push({ text: "s", images: [IMG] });
    followUp.push({ text: "f", images: [IMG] });
    const snapshots: unknown[] = [];
    const { inst, pi } = makeStubInstance({
      sessionId: "OLD",
      pathGate: { onSessionStart: vi.fn() } as never,
      mcpRegistrar: { onSessionStart: vi.fn() } as never,
      usageDrain: { baseline: vi.fn(() => undefined) } as never,
      abortLatch: { clear: vi.fn() } as never,
      subagentFrameBuffer: { reset: vi.fn() } as never,
      subagentTickThrottle: { reset: vi.fn() } as never,
      coalescer: { clear: vi.fn() } as never,
      bridgeSteer: steer,
      bridgeFollowUp: followUp,
      emitQueueUpdate: vi.fn(() => snapshots.push({ steering: steer.views(), followUp: followUp.views() })),
      renewGitTracker: vi.fn() as never,
      syncBc: vi.fn(() => ({})) as never,
      applyBc: vi.fn(),
      sendPiVersionIfChanged: vi.fn(),
      gitPollTimer: null,
      polling: { setGitPollTimer: vi.fn() } as never,
    });
    registerSessionStart(inst);
    const ctx = { sessionManager: { getSessionId: () => "NEW" }, hasUI: false };
    // Registration past the reset is not exercised here and may throw on an unstubbed field.
    await pi.handlers.get("session_start")![0]({ reason: "resume" }, ctx).catch(() => {});
    vi.doUnmock("../session-sync.js");

    expect(steer.length).toBe(0);
    expect(steer.totalBytes()).toBe(0);
    expect(followUp.length).toBe(0);
    expect(followUp.totalBytes()).toBe(0);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    for (const snap of snapshots) expect(snap).toEqual({ steering: [], followUp: [] });
  });
});

describe("E24: every register re-announces the bridge's queues", () => {
  it("session_start: queue_update follows the register and the sessionReady flip", () => {
    const src = readBridgeSource("bridge-handlers/lifecycle.ts");
    const afterRegister = region(src, 'type: "session_register"', "D3: mint-on-registration");
    expect(afterRegister).toMatch(/sessionReady = true;[\s\S]*emitQueueUpdate\(\);/);
  });

  it("reconnect: queue_update follows sendStateSync (the re-register)", () => {
    const reconnect = region(readBridgeSource("bridge.ts"), "onReconnect: safe(() => {", "refreshUiModules(");
    expect(reconnect).toMatch(/sendStateSync\(\{\s*liveTailOpen\s*\}\);[\s\S]*emitQueueUpdate\(\);/);
  });

  it("emitQueueUpdate sends current buffers unconditionally (empty included)", () => {
    const src = readBridgeSource("bridge.ts");
    const fn = region(src, "function emitQueueUpdate(): void {", "emitQueueUpdate = emitQueueUpdate;");
    expect(fn).toMatch(/steering: bridgeSteer\.views\(\)/);
    expect(fn).not.toMatch(/length\s*[>=]/);
  });
});
