/**
 * Tests for the `show-debug-tools` localStorage migration.
 *
 * The actual migration logic lives inline in App.tsx's mount effect. To
 * keep this unit-test focused, we extract the migration into a small
 * helper here that mirrors the App.tsx code path exactly. Any future
 * change MUST keep these two implementations in sync.
 *
 * See change: configurable-chat-display.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

async function runMigration(): Promise<void> {
  try {
    const legacy = localStorage.getItem("show-debug-tools");
    if (legacy !== null) {
      await fetch("/api/preferences/display", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debugTools: legacy === "true" }),
        credentials: "include",
      });
      localStorage.removeItem("show-debug-tools");
    }
  } catch { /* ignore */ }
}

describe("show-debug-tools migration", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).fetch = fetchMock;
  });

  it("PATCHes true and clears the key", async () => {
    localStorage.setItem("show-debug-tools", "true");
    await runMigration();
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({ debugTools: true });
    expect(localStorage.getItem("show-debug-tools")).toBeNull();
  });

  it("PATCHes false and clears the key", async () => {
    localStorage.setItem("show-debug-tools", "false");
    await runMigration();
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({ debugTools: false });
    expect(localStorage.getItem("show-debug-tools")).toBeNull();
  });

  it("is idempotent — no PATCH when the key is absent", async () => {
    await runMigration();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("subsequent runs do not re-PATCH", async () => {
    localStorage.setItem("show-debug-tools", "true");
    await runMigration();
    await runMigration();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
