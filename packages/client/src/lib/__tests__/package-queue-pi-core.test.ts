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

  // ── Failure-shape taxonomy of POST /api/pi-core/update ──────────────
  //
  // The route distinguishes four failure shapes. Only ONE of them is a
  // 409, so a package-manager-level failure must never be flattened into
  // the generic busy message. See change:
  // unify-pi-core-into-package-queue (reconciliation with cf18e682 +
  // pi 0.82 pnpm `pi update` cache behaviour).

  it("surfaces a pnpm cache-prune failure verbatim, not as a 409, and does not retry", async () => {
    // pi 0.82: `pi update` on a pnpm install can point at a removed cached
    // version and require `pnpm store prune` / a pnpm self-update. The
    // server catches this PER PACKAGE, so it arrives as HTTP 200 +
    // results[0].success === false — never a 409.
    const pnpmErr =
      "ERR_PNPM_NO_OFFLINE_TARBALL  Could not find cached tarball for " +
      "@earendil-works/pi-coding-agent@0.82.0 — run `pnpm store prune` and retry";
    const fetchMock = makeFetchMock(() =>
      jsonResponse({
        success: true,
        data: { results: [{ name: PI, success: false, error: pnpmErr }], sessionsReloaded: 0 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();
    // Give the 409 retry window a chance to fire — it must not.
    await vi.advanceTimersByTimeAsync(600);
    await flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(packageQueue.getStateForSource(PI_SRC)).toBe("error");
    const msg = packageQueue.getMessageForSource(PI_SRC);
    expect(msg).toBe(pnpmErr);
    expect(msg).toContain("pnpm store prune");
    expect(msg).not.toMatch(/server busy/i);
    expect(msg).not.toBe("Update failed");
  });

  it("surfaces an unknown-package 400 verbatim and does not retry", async () => {
    // Reachable via the @mariozechner -> @earendil-works core rename: a
    // stale client can POST a name the server no longer resolves.
    const fetchMock = makeFetchMock(() =>
      jsonResponse({ success: false, error: `Unknown package(s): ${PI}` }, 400),
    );
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();
    await vi.advanceTimersByTimeAsync(600);
    await flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(packageQueue.getStateForSource(PI_SRC)).toBe("error");
    expect(packageQueue.getMessageForSource(PI_SRC)).toBe(`Unknown package(s): ${PI}`);
  });

  it("treats an empty results array as a no-op success, not a failure", async () => {
    // The route returns {results: [], sessionsReloaded: 0} when nothing
    // resolved as updatable (e.g. updateAvailable flipped false between
    // render and click). That is 'nothing to do', not a failure.
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() =>
        jsonResponse({ success: true, data: { results: [], sessionsReloaded: 0 } }),
      ),
    );

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    expect(packageQueue.getStateForSource(PI_SRC)).not.toBe("error");
    expect(packageQueue.getRunning()).toBeNull();
  });

  it("names the package when a failed result carries no error text", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() =>
        jsonResponse({ success: true, data: { results: [{ name: PI, success: false }] } }),
      ),
    );

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    expect(packageQueue.getStateForSource(PI_SRC)).toBe("error");
    expect(packageQueue.getMessageForSource(PI_SRC)).toContain(PI);
  });

  it("sends no package-manager hint — the server owns that decision", async () => {
    // cf18e682 made the server pick the repo's own package manager. The
    // queue must stay agnostic: request body carries ONLY the package name.
    const fetchMock = makeFetchMock(() =>
      jsonResponse({ success: true, data: { results: [{ name: PI, success: true }] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(Object.keys(sent)).toEqual(["packages"]);
    expect(sent).toEqual({ packages: [PI] });
  });

  // ── Visible-queue contract (D9 rewritten) ───────────────────────
  //
  // Goal 6 is "no enabled click is silently lost", NOT "disable every
  // control while busy". A click during a running op must enqueue and
  // become visible as `queued`.

  it("dedupes on (source, action), not on source alone", async () => {
    const { fetchMock } = makeDeferredFetchMock({ success: true, data: { results: [] } });
    vi.stubGlobal("fetch", fetchMock);

    // Hold the slot with an unrelated running op so everything else queues.
    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    packageQueue.enqueue({ source: "npm:foo", action: "update", scope: "global" });
    packageQueue.enqueue({ source: "npm:foo", action: "update", scope: "global" }); // exact dup → dropped
    expect(packageQueue.getQueueDepth()).toBe(1);

    // Same source, DIFFERENT action → distinct work, must be accepted.
    packageQueue.enqueue({ source: "npm:foo", action: "remove", scope: "global" });
    expect(packageQueue.getQueueDepth()).toBe(2);

    // Dup of the second action → dropped.
    packageQueue.enqueue({ source: "npm:foo", action: "remove", scope: "global" });
    expect(packageQueue.getQueueDepth()).toBe(2);
  });

  it("a duplicate of the RUNNING (source, action) is dropped", async () => {
    const { fetchMock } = makeDeferredFetchMock({ success: true, data: { results: [] } });
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();
    expect(packageQueue.getStateForSource(PI_SRC)).toBe("running");

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    expect(packageQueue.getQueueDepth()).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("renders queued for every op enqueued while one is running, across kinds", async () => {
    const { fetchMock } = makeDeferredFetchMock({ success: true, data: { results: [] } });
    vi.stubGlobal("fetch", fetchMock);

    packageQueue.enqueue({ source: PI_SRC, kind: "pi-core", action: "update", scope: "global" });
    await flush();

    const DASH = "pi-core:@blackbelt-technology/pi-agent-dashboard";
    packageQueue.enqueue({ source: DASH, kind: "pi-core", action: "update", scope: "global" });
    packageQueue.enqueue({ source: "npm:pi-flows", action: "install", scope: "global" });

    // The click was NOT lost and NOT 409'd — it is visibly queued.
    expect(packageQueue.getStateForSource(PI_SRC)).toBe("running");
    expect(packageQueue.getStateForSource(DASH)).toBe("queued");
    expect(packageQueue.getStateForSource("npm:pi-flows")).toBe("queued");
    // Only the running op has been POSTed.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("drains strictly FIFO in enqueue order", async () => {
    const posted: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      posted.push(body.packages ? `core:${body.packages[0]}` : `ext:${body.source}`);
      return url.endsWith("/api/pi-core/update")
        ? jsonResponse({ success: true, data: { results: [{ name: body.packages[0], success: true }] } })
        : jsonResponse({ success: true, data: { operationId: `op-${posted.length}` } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const A = "pi-core:a";
    const B = "pi-core:b";
    const C = "pi-core:c";
    packageQueue.enqueue({ source: A, kind: "pi-core", action: "update", scope: "global" });
    packageQueue.enqueue({ source: B, kind: "pi-core", action: "update", scope: "global" });
    packageQueue.enqueue({ source: C, kind: "pi-core", action: "update", scope: "global" });

    expect(packageQueue.getQueueDepth()).toBe(2);
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(posted).toEqual(["core:a", "core:b", "core:c"]);
    expect(packageQueue.getQueueDepth()).toBe(0);
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
