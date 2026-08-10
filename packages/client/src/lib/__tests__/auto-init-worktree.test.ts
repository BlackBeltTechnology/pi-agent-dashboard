/**
 * Tests for the post-spawn worktree auto-init trigger.
 *
 * Pins the TOFU-safe contract:
 *  - preference OFF → never probes, never runs
 *  - trusted + needsInit → runs (no confirmHash forged)
 *  - untrusted → never runs
 *  - needsInit false → no-op
 *
 * See change: auto-init-worktree-on-spawn.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { maybeAutoInitWorktreeOnSpawn } from "../git/auto-init-worktree.js";
import { initStore } from "../git/worktree-init-store.js";
import { __resetInitBusForTests } from "../git/worktree-init-bus.js";

const { fetchAutoInitWorktreePref, fetchWorktreeInitStatus, runWorktreeInit } = vi.hoisted(() => ({
  fetchAutoInitWorktreePref: vi.fn(),
  fetchWorktreeInitStatus: vi.fn(),
  runWorktreeInit: vi.fn(),
}));

vi.mock("../git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../git/git-api.js")>("../git/git-api.js");
  return { ...actual, fetchAutoInitWorktreePref, fetchWorktreeInitStatus, runWorktreeInit };
});

afterEach(() => { vi.clearAllMocks(); initStore.__resetForTests(); __resetInitBusForTests(); });

describe("maybeAutoInitWorktreeOnSpawn", () => {
  it("no-ops and never probes when the preference is OFF", async () => {
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    const ran = await maybeAutoInitWorktreeOnSpawn("/repo/.worktrees/feat");
    expect(ran).toBe(false);
    expect(fetchWorktreeInitStatus).not.toHaveBeenCalled();
    expect(runWorktreeInit).not.toHaveBeenCalled();
  });

  it("auto-runs when trusted + needsInit", async () => {
    fetchAutoInitWorktreePref.mockResolvedValue(true);
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: true });
    runWorktreeInit.mockResolvedValue({ ok: true, ran: true });
    const ran = await maybeAutoInitWorktreeOnSpawn("/repo/.worktrees/feat");
    expect(ran).toBe(true);
    expect(fetchWorktreeInitStatus).toHaveBeenCalledWith("/repo/.worktrees/feat");
    expect(runWorktreeInit).toHaveBeenCalledTimes(1);
  });

  it("never forges a confirmHash on the auto-run path", async () => {
    fetchAutoInitWorktreePref.mockResolvedValue(true);
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: true });
    runWorktreeInit.mockResolvedValue({ ok: true, ran: true });
    await maybeAutoInitWorktreeOnSpawn("/repo/.worktrees/feat");
    const arg = runWorktreeInit.mock.calls[0][0];
    expect(arg.cwd).toBe("/repo/.worktrees/feat");
    expect(arg.confirmHash).toBeUndefined();
  });

  it("does NOT auto-run when the hook is untrusted", async () => {
    fetchAutoInitWorktreePref.mockResolvedValue(true);
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: false });
    const ran = await maybeAutoInitWorktreeOnSpawn("/repo/.worktrees/feat");
    expect(ran).toBe(false);
    expect(runWorktreeInit).not.toHaveBeenCalled();
  });

  it("no-ops when needsInit is false", async () => {
    fetchAutoInitWorktreePref.mockResolvedValue(true);
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: false, trusted: true });
    const ran = await maybeAutoInitWorktreeOnSpawn("/repo/.worktrees/feat");
    expect(ran).toBe(false);
    expect(runWorktreeInit).not.toHaveBeenCalled();
  });

  it("no-ops when there is no hook", async () => {
    fetchAutoInitWorktreePref.mockResolvedValue(true);
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: false });
    const ran = await maybeAutoInitWorktreeOnSpawn("/repo/.worktrees/feat");
    expect(ran).toBe(false);
    expect(runWorktreeInit).not.toHaveBeenCalled();
  });

  // change: friendlier-worktree-init — the auto path is no longer silent.
  it("registers a running entry in the store while auto-init runs", async () => {
    fetchAutoInitWorktreePref.mockResolvedValue(true);
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: true });
    runWorktreeInit.mockReturnValue(new Promise(() => {})); // stays in flight
    void maybeAutoInitWorktreeOnSpawn("/repo/.worktrees/feat");
    await vi.waitFor(() => expect(initStore.getRun("/repo/.worktrees/feat")?.phase).toBe("running"));
  });

  it("surfaces a failed auto-init as a visible, retryable entry (previously silent)", async () => {
    fetchAutoInitWorktreePref.mockResolvedValue(true);
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: true });
    runWorktreeInit.mockResolvedValue({ ok: false, code: "init_failed", error: "boom", stderr: "trace" });
    await maybeAutoInitWorktreeOnSpawn("/repo/.worktrees/feat");
    const run = initStore.getRun("/repo/.worktrees/feat");
    expect(run?.phase).toBe("failed");
    expect(run?.stderr).toBe("trace");
  });
});
