/**
 * Rejection-owner assertions for the openspec directory handlers.
 *
 * `handleOpenSpecRefresh` and `handleOpenSpecBulkArchive` are fire-and-forget
 * from a synchronous WS dispatch handler: a rejected refresh / post-archive
 * poll must be logged and absorbed, never floated, and the gateway must stay
 * responsive to the next message.
 *
 * New test file (no sibling existed); harness idiom mirrors the sibling
 * `session-action-handler.test.ts` (build a minimal BrowserHandlerContext,
 * drive one handler, assert on spies).
 *
 * See change: cleanup-async-semantics-server-extension (test-plan #X6, #X7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `handleOpenSpecBulkArchive` calls the shared openspec tool (which would spawn
// the CLI). Stub it so the test exercises only the post-archive poll path.
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/openspec.js", () => ({
  archiveCompleted: vi.fn(),
}));

import type { BrowserHandlerContext } from "../handler-context.js";
import { handleOpenSpecBulkArchive, handleOpenSpecRefresh } from "../directory-handler.js";

async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

describe("openspec directory handlers — rejection is owned", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    warnSpy.mockRestore();
    vi.clearAllMocks();
  });

  function loggedWarn(fragment: string): boolean {
    return warnSpy.mock.calls.some((c: unknown[]) => typeof c[0] === "string" && c[0].includes(fragment));
  }

  it("X6 a rejected openspec_refresh is logged and absorbed; the gateway handles the next message", async () => {
    const refreshOpenSpec = vi
      .fn()
      .mockRejectedValueOnce(new Error("refresh boom"))
      .mockResolvedValueOnce({ initialized: true, changes: [] });
    const broadcast = vi.fn();
    const ctx = { directoryService: { refreshOpenSpec }, broadcast } as unknown as BrowserHandlerContext;

    handleOpenSpecRefresh({ type: "openspec_refresh", cwd: "/repo" } as any, ctx);
    await flush();

    expect(loggedWarn("[openspec] refresh failed")).toBe(true);
    expect(unhandled).toEqual([]);
    // No broadcast for the failed refresh.
    expect(broadcast).not.toHaveBeenCalled();

    // Subsequent message: the handler still works and broadcasts the update.
    handleOpenSpecRefresh({ type: "openspec_refresh", cwd: "/repo" } as any, ctx);
    await flush();
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "openspec_update", cwd: "/repo" }),
    );
  });

  it("X7 a rejected post-archive poll is logged and absorbed; the gateway handles the next message", async () => {
    const pollDirectoryGated = vi
      .fn()
      .mockRejectedValueOnce(new Error("poll boom"))
      .mockResolvedValueOnce({ initialized: true, changes: [] });
    const broadcast = vi.fn();
    const ctx = { directoryService: { pollDirectoryGated }, broadcast } as unknown as BrowserHandlerContext;

    handleOpenSpecBulkArchive({ type: "openspec_bulk_archive", cwd: "/repo" } as any, ctx);
    await flush();

    expect(loggedWarn("[openspec] post-archive poll failed")).toBe(true);
    expect(unhandled).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();

    // Subsequent bulk-archive: the poll resolves and the update broadcasts.
    handleOpenSpecBulkArchive({ type: "openspec_bulk_archive", cwd: "/repo" } as any, ctx);
    await flush();
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "openspec_update", cwd: "/repo" }),
    );
  });
});
