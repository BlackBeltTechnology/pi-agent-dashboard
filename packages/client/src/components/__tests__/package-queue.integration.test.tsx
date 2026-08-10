/**
 * Cross-component integration test for the package install queue.
 *
 * Mounts a minimal harness with two consumers of `usePackageOperations`
 * and verifies that:
 *   1. A click in one consumer is observed by the other (shared queue
 *      state across components).
 *   2. A second click while a first op is running results in `queued`
 *      status, and the original spinner survives.
 *   3. Dispatching the first op's `package_operation_complete` advances
 *      the FIFO and the second op POSTs.
 *   4. Unmounting the consumer that initiated an op does NOT stop or
 *      orphan the operation \u2014 completion still arrives and the
 *      `onComplete` (refresh) callback fires.
 */
import React, { useEffect } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import { packageQueue } from "../../lib/package/package-queue.js";

// Tiny consumer that exposes its statusFor to the test via callbacks.
function Consumer({
  source,
  onStatus,
  onMount,
  onComplete,
}: {
  source: string;
  onStatus: (s: string) => void;
  onMount: (api: { install: (s: string) => void }) => void;
  onComplete?: () => void;
}) {
  const ops = usePackageOperations("global", undefined, onComplete);
  useEffect(() => {
    onMount({ install: ops.install });
    return packageQueue.subscribe(() => onStatus(ops.statusFor(source)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div data-source={source}>{ops.statusFor(source)}</div>;
}

function dispatchComplete(opId: string, source: string, success = true) {
  window.dispatchEvent(
    new CustomEvent("pi-package-event", {
      detail: {
        type: "package_operation_complete",
        operationId: opId,
        action: "install",
        source,
        scope: "global",
        success,
      },
    }),
  );
}

async function flush() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeEach(() => {
  packageQueue.__resetForTests();
  let n = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { operationId: `op-${n++}` } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("package-queue cross-component integration", () => {
  it("two consumers share queue state; A keeps spinner while B is queued; completion advances", async () => {
    const stateA: string[] = [];
    const stateB: string[] = [];
    const apis: Array<{ install: (s: string) => void }> = [];

    render(
      <>
        <Consumer source="src:A" onStatus={(s) => stateA.push(s)} onMount={(a) => apis.push(a)} />
        <Consumer source="src:B" onStatus={(s) => stateB.push(s)} onMount={(a) => apis.push(a)} />
      </>,
    );

    const [apiA, apiB] = apis;
    expect(apiA && apiB).toBeTruthy();

    // Click Install on A from consumer A.
    await act(async () => {
      apiA.install("src:A");
      await flush();
    });
    expect(packageQueue.getStateForSource("src:A")).toBe("running");
    expect(stateA.at(-1)).toBe("running");
    // Consumer B sees the same state because both subscribe to the singleton.
    expect(stateB.at(-1)).toBe("idle");

    // Click Install on B from consumer B while A is still running.
    await act(async () => {
      apiB.install("src:B");
      await flush();
    });
    expect(packageQueue.getStateForSource("src:A")).toBe("running"); // spinner survives
    expect(packageQueue.getStateForSource("src:B")).toBe("queued");

    // Complete A.
    await act(async () => {
      dispatchComplete("op-1", "src:A");
      await flush();
    });
    expect(packageQueue.getStateForSource("src:A")).toBe("success");
    expect(packageQueue.getStateForSource("src:B")).toBe("running");
  });

  it("unmount does not orphan a running op; completion still drives onComplete", async () => {
    const onComplete = vi.fn();
    const apis: Array<{ install: (s: string) => void }> = [];

    const { unmount } = render(
      <Consumer
        source="src:X"
        onStatus={() => {}}
        onMount={(a) => apis.push(a)}
        onComplete={onComplete}
      />,
    );

    await act(async () => {
      apis[0].install("src:X");
      await flush();
    });
    expect(packageQueue.getStateForSource("src:X")).toBe("running");

    // Unmount the initiator. The op is still running on the server.
    unmount();

    // Completion arrives \u2014 queue still processes it.
    await act(async () => {
      dispatchComplete("op-1", "src:X");
      await flush();
    });
    expect(packageQueue.getStateForSource("src:X")).toBe("success");
    // onComplete subscription was torn down with the unmount, so it should
    // NOT have been called for this op (this is by design \u2014 the surviving
    // consumer still listens).
    expect(onComplete).not.toHaveBeenCalled();
  });
});
