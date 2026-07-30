import type { ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AbortLatch } from "../abort-latch.js";
import { AbortWatchdog } from "../abort-watchdog.js";
import { createCommandHandler } from "../command-handler.js";

const child = { pid: 201, pgid: 200, command: "sleep 600", elapsedMs: 12_000 };

function createBoundary() {
  const latch = new AbortLatch();
  const killGroup = vi.fn();
  const watchdog = new AbortWatchdog({
    delayMs: 100,
    killGraceMs: 50,
    isLatchActive: (sessionId) => latch.isActive(sessionId),
    isStreaming: () => true,
    scanChildren: () => [child],
    killGroup,
  });
  const handler = createCommandHandler({} as Parameters<typeof createCommandHandler>[0], "s1", {
    abort: () => {
      latch.request("s1");
      watchdog.arm("s1");
    },
    isIdle: () => false,
    isStreaming: () => false,
  });
  return { handler, killGroup, latch, watchdog };
}

afterEach(() => vi.useRealTimers());

describe("explicit abort watchdog bridge boundary", () => {
  it("arms only after an explicit dashboard abort", async () => {
    vi.useFakeTimers();
    const boundary = createBoundary();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(boundary.killGroup).not.toHaveBeenCalled();

    await boundary.handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);
    await vi.advanceTimersByTimeAsync(100);
    expect(boundary.killGroup).toHaveBeenCalledWith(200, "SIGTERM");
  });

  it("turn settlement disarms before any signal", async () => {
    vi.useFakeTimers();
    const boundary = createBoundary();

    await boundary.handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);
    boundary.watchdog.disarm("s1");
    boundary.latch.clear("s1");
    await vi.advanceTimersByTimeAsync(200);

    expect(boundary.killGroup).not.toHaveBeenCalled();
  });

  it("provider failure without dashboard abort never arms", async () => {
    vi.useFakeTimers();
    const boundary = createBoundary();

    boundary.latch.clear("s1");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(boundary.killGroup).not.toHaveBeenCalled();
  });
});
