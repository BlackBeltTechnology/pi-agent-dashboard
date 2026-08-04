/**
 * Pi-core dispatch arm of the package queue.
 *
 * Pi-core ops differ from extension ops in exactly one respect that
 * matters to the queue: completion is carried by the POST response, not
 * by a WebSocket event. The server broadcasts `pi_core_update_complete`
 * BEFORE returning the HTTP response, so the WS frame nearly always
 * reaches the client first — the queue must ignore it.
 *
 * See change: unify-pi-core-into-package-queue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { packageQueue } from "../package/package-queue.js";

const PI = "@mariozechner/pi-coding-agent";
const PI_SRC = `pi-core:${PI}`;

function jsonResponse(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetchMock(
  responder: (req: { url: string; body: any }, callIndex: number) => Promise<Response> | Response,
) {
  let calls = 0;
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    return responder({ url, body }, calls++);
  });
}

/** Fetch mock whose response resolution is deferred to the test body. */
function makeDeferredFetchMock(payload: any, status = 200) {
  let resolveBody!: (r: Response) => void;
  const bodyPromise = new Promise<Response>((res) => {
    resolveBody = res;
  });
  const fetchMock = vi.fn(async () => bodyPromise);
  return { fetchMock, settle: () => resolveBody(jsonResponse(payload, status)) };
}

function dispatchCoreProgress(name: string, phase: string, message?: string) {
  window.dispatchEvent(
    new CustomEvent("pi-core-event", {
      detail: { type: "pi_core_update_progress", name, phase, message },
    }),
  );
}

function dispatchCoreComplete(results: Array<{ name: string; success: boolean; error?: string }>) {
  window.dispatchEvent(
    new CustomEvent("pi-core-event", {
      detail: { type: "pi_core_update_complete", results },
    }),
  );
}

async function flush() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe("package-queue pi-core dispatch", () => {
  beforeEach(() => {
    packageQueue.__resetForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // 2.1
  it("POSTs /api/pi-core/update with a single-name batch", async () => {
    const fetchMock = makeFetchMock(() =>
      jsonResponse({ success: true, data: { results: [{ name: PI, success: true }] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/pi-core/update");
    expect(JSON.parse(init.body as string)).toEqual({ packages: [PI] });
  });

  // 2.2
  it("transitions to success and clears running on a successful result", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() =>
        jsonResponse({ success: true, data: { results: [{ name: PI, success: true }] } }),
      ),
    );

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    expect(packageQueue.getStateForSource(PI_SRC)).toBe("success");
    expect(packageQueue.getRunning()).toBeNull();
  });

  // 2.3
  it("records a per-source error when the result reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() =>
        jsonResponse({
          success: true,
          data: { results: [{ name: PI, success: false, error: "boom" }] },
        }),
      ),
    );

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    expect(packageQueue.getStateForSource(PI_SRC)).toBe("error");
    expect(packageQueue.getMessageForSource(PI_SRC)).toBe("boom");
  });

  // 2.4
  it("retries once on 409 then succeeds", async () => {
    const fetchMock = makeFetchMock((_, idx) =>
      idx === 0
        ? jsonResponse({ success: false, error: "busy" }, 409)
        : jsonResponse({ success: true, data: { results: [{ name: PI, success: true }] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();
    expect(packageQueue.getStateForSource(PI_SRC)).toBe("queued");

    await vi.advanceTimersByTimeAsync(600);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(packageQueue.getStateForSource(PI_SRC)).toBe("success");
  });

  // 2.5
  it("surfaces the server busy message after a second consecutive 409", async () => {
    const fetchMock = makeFetchMock(() => jsonResponse({ success: false, error: "busy" }, 409));
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();
    await vi.advanceTimersByTimeAsync(600);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(packageQueue.getStateForSource(PI_SRC)).toBe("error");
    expect(packageQueue.getMessageForSource(PI_SRC)).toBe("busy");
  });

  // 2.6
  it("pi_core_update_progress for the running op updates running.message", async () => {
    const { fetchMock } = makeDeferredFetchMock({ success: true, data: { results: [] } });
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    dispatchCoreProgress(PI, "output", "added 12 packages");
    await flush();

    expect(packageQueue.getRunning()?.message).toBe("added 12 packages");
  });

  it("pi_core_update_progress without a message falls back to `<name>: <phase>`", async () => {
    const { fetchMock } = makeDeferredFetchMock({ success: true, data: { results: [] } });
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    dispatchCoreProgress(PI, "start");
    await flush();

    expect(packageQueue.getRunning()?.message).toBe(`${PI}: start`);
  });

  // 2.7
  it("pi_core_update_progress for a different name is a no-op", async () => {
    const { fetchMock } = makeDeferredFetchMock({ success: true, data: { results: [] } });
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();
    const before = packageQueue.getRunning()?.message;

    dispatchCoreProgress("@blackbelt-technology/pi-agent-dashboard", "output", "other");
    await flush();

    expect(packageQueue.getRunning()?.message).toBe(before);
  });

  // 2.8
  it("pi_core_update_complete does NOT complete the running op (POST response owns it)", async () => {
    const { fetchMock, settle } = makeDeferredFetchMock({
      success: true,
      data: { results: [{ name: PI, success: true }] },
    });
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    // Common case: the WS frame lands BEFORE the HTTP response.
    dispatchCoreComplete([{ name: PI, success: true }]);
    await flush();

    expect(packageQueue.getStateForSource(PI_SRC)).toBe("running");
    expect(packageQueue.getRunning()?.source).toBe(PI_SRC);

    settle();
    await flush();

    expect(packageQueue.getStateForSource(PI_SRC)).toBe("success");
  });

  // 2.9
  it("dispatches by kind, not by source, when kinds are interleaved", async () => {
    const fetchMock = makeFetchMock(({ url }) =>
      url.endsWith("/api/pi-core/update")
        ? jsonResponse({ success: true, data: { results: [{ name: PI, success: true }] } })
        : jsonResponse({ success: true, data: { operationId: "op-1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: "npm:foo", kind: "extension", action: "install", scope: "global" });
    await flush();
    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    // Extension op is running; pi-core is queued behind it.
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("/api/packages/install");
    expect(packageQueue.getStateForSource(PI_SRC)).toBe("queued");

    window.dispatchEvent(
      new CustomEvent("pi-package-event", {
        detail: {
          type: "package_operation_complete",
          operationId: "op-1",
          action: "install",
          source: "npm:foo",
          scope: "global",
          success: true,
        },
      }),
    );
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe("/api/pi-core/update");
    expect(packageQueue.getStateForSource(PI_SRC)).toBe("success");
  });

  // 1.8 — extension progress matching must not latch onto a running pi-core op.
  it("extension package_progress does not match a running pi-core op", async () => {
    const { fetchMock } = makeDeferredFetchMock({ success: true, data: { results: [] } });
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();
    const before = packageQueue.getRunning()?.message;

    window.dispatchEvent(
      new CustomEvent("pi-package-event", {
        detail: {
          type: "package_progress",
          operationId: undefined,
          event: { type: "progress", action: "install", source: "npm:foo", message: "Cloning…" },
        },
      }),
    );
    await flush();

    expect(packageQueue.getRunning()?.message).toBe(before);
  });

  // 2.10
  it("isAnyRunning() reflects a running op of either kind", async () => {
    const { fetchMock, settle } = makeDeferredFetchMock({
      success: true,
      data: { results: [{ name: PI, success: true }] },
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(packageQueue.isAnyRunning()).toBe(false);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();
    expect(packageQueue.isAnyRunning()).toBe(true);

    settle();
    await flush();
    expect(packageQueue.isAnyRunning()).toBe(false);

    vi.stubGlobal(
      "fetch",
      makeFetchMock(() => jsonResponse({ success: true, data: { operationId: "op-1" } })),
    );
    packageQueue.enqueue({ source: "npm:foo", action: "install", scope: "global" });
    await flush();
    expect(packageQueue.isAnyRunning()).toBe(true);
  });

  it("defaults kind to `extension` when unspecified", async () => {
    const fetchMock = makeFetchMock(() =>
      jsonResponse({ success: true, data: { operationId: "op-1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: "npm:foo", action: "install", scope: "global" });
    await flush();

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("/api/packages/install");
    expect(packageQueue.getRunning()?.kind).toBe("extension");
  });
});
