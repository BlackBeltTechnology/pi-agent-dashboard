/**
 * fix-connect-snapshot-frame-loss client reconciliation hook (D7): every
 * rendered cwd that has no settled OpenSpec entry and no in-flight request
 * pulls one via `openspec_get`; at most one request per cwd; the in-flight
 * mark releases on the 15 s timeout or when the socket (re)opens.
 *
 * `renderedCwds` is caller-computed (non-ended session cards ∪ pinned folder
 * cards ∪ the selected session's cwd) — E37 feeds a caller-shaped set.
 * Scenarios: test-plan E37, E38, E39, E40, X5.
 */

import type { DashboardSession, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeRenderedCwds } from "../../lib/openspec/rendered-cwds.js";
import { type OpenSpecGetInflight, type UseOpenSpecReconcileArgs, useOpenSpecReconcile } from "../useOpenSpecReconcile.js";

const SETTLED: OpenSpecData = { initialized: true, changes: [] };
const PENDING_PLACEHOLDER: OpenSpecData = { initialized: false, pending: true, hasOpenspecDir: true, changes: [] };

interface HarnessProps extends Omit<UseOpenSpecReconcileArgs, "send"> {
  send: ReturnType<typeof vi.fn>;
}

function makeProps(overrides: Partial<HarnessProps> = {}): HarnessProps {
  return {
    renderedCwds: ["/a"],
    openspecMap: new Map(),
    send: vi.fn(),
    status: "connected",
    snapshotGeneration: 0,
    inflightRef: { current: new Map() } as HarnessProps["inflightRef"],
    ...overrides,
  };
}

function sentCwds(send: ReturnType<typeof vi.fn>): string[] {
  return send.mock.calls.map((c) => (c[0] as { cwd: string }).cwd);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useOpenSpecReconcile", () => {
  it("E37: pulls only for rendered cwds without a settled entry (pending ≠ settled)", () => {
    const props = makeProps({
      // Caller-computed set: non-ended cards /a + /b, pinned (none), selected
      // ended session in /e. Ended-only /c and stub /d never enter the set.
      renderedCwds: ["/a", "/b", "/e"],
      openspecMap: new Map([
        ["/a", SETTLED],
        ["/b", PENDING_PLACEHOLDER],
      ]),
    });
    renderHook((p: HarnessProps) => useOpenSpecReconcile(p as unknown as UseOpenSpecReconcileArgs), { initialProps: props });

    expect(sentCwds(props.send).sort()).toEqual(["/b", "/e"]);
    for (const call of props.send.mock.calls) {
      expect(call[0].type).toBe("openspec_get");
      expect(typeof call[0].requestId).toBe("string");
    }
  });

  it("E38: one in-flight request per cwd across repeated effect runs", () => {
    const props = makeProps({ renderedCwds: ["/a"] });
    const { rerender } = renderHook((p: HarnessProps) => useOpenSpecReconcile(p as unknown as UseOpenSpecReconcileArgs), { initialProps: props });
    rerender({ ...props, renderedCwds: ["/a"] });
    rerender({ ...props, renderedCwds: ["/a"] });

    expect(props.send).toHaveBeenCalledTimes(1);
    expect(props.send.mock.calls[0][0].cwd).toBe("/a");
  });

  it("E39: the in-flight mark releases at 15 s (not 14.999 s); the next run sends a fresh requestId", () => {
    vi.useFakeTimers();
    const props = makeProps({ renderedCwds: ["/a"] });
    const { rerender } = renderHook((p: HarnessProps) => useOpenSpecReconcile(p as unknown as UseOpenSpecReconcileArgs), { initialProps: props });
    expect(props.send).toHaveBeenCalledTimes(1);
    const firstId = props.send.mock.calls[0][0].requestId;

    act(() => {
      vi.advanceTimersByTime(14_999);
    });
    rerender({ ...props, renderedCwds: ["/a"] });
    expect(props.send).toHaveBeenCalledTimes(1); // still in flight

    act(() => {
      vi.advanceTimersByTime(1); // 15 s total — timeout releases the mark
    });
    rerender({ ...props, renderedCwds: ["/a"] });
    expect(props.send).toHaveBeenCalledTimes(2);
    expect(props.send.mock.calls[1][0].requestId).not.toBe(firstId);
  });

  it("E40: reconnect clears in-flight and re-requests an unsettled cwd", () => {
    const props = makeProps({ renderedCwds: ["/a"] });
    const { rerender } = renderHook((p: HarnessProps) => useOpenSpecReconcile(p as unknown as UseOpenSpecReconcileArgs), { initialProps: props });
    expect(props.send).toHaveBeenCalledTimes(1);

    rerender({ ...props, status: "offline" });
    rerender({ ...props, status: "connected", snapshotGeneration: 1 });
    expect(props.send).toHaveBeenCalledTimes(2);
    expect(props.send.mock.calls[1][0].cwd).toBe("/a");
    expect(props.send.mock.calls[1][0].requestId).not.toBe(props.send.mock.calls[0][0].requestId);
  });

  it("X5: a final:false placeholder never settles — a lost final reply is re-requested after 15 s", () => {
    vi.useFakeTimers();
    const props = makeProps({ renderedCwds: ["/w"] });
    const { rerender } = renderHook((p: HarnessProps) => useOpenSpecReconcile(p as unknown as UseOpenSpecReconcileArgs), { initialProps: props });
    expect(props.send).toHaveBeenCalledTimes(1);

    // The placeholder reply (final:false) lands in the map — not settled.
    rerender({ ...props, openspecMap: new Map([["/w", PENDING_PLACEHOLDER]]) });
    expect(props.send).toHaveBeenCalledTimes(1);

    // Final reply dropped; after 15 s the mark releases and the placeholder
    // still counts as unsettled, so the re-run pulls again.
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    rerender({ ...props, openspecMap: new Map([["/w", PENDING_PLACEHOLDER]]) });
    expect(props.send).toHaveBeenCalledTimes(2);

    // The second attempt's final reply settles the entry — no further pull.
    rerender({ ...props, openspecMap: new Map([["/w", SETTLED]]) });
    expect(props.send).toHaveBeenCalledTimes(2);
  });
});

const sess = (o: Partial<DashboardSession> & { id: string; cwd: string }): DashboardSession =>
  ({ status: "ended", startedAt: 0, ...o }) as DashboardSession;

describe("computeRenderedCwds — attachment folders (resolve-archived-attached-proposal)", () => {
  it("E19: ended attached session pulls its unpinned folder, once", () => {
    const cwds = computeRenderedCwds({
      sessions: [sess({ id: "a", cwd: "/proj", attachedProposal: "add-auth" })],
      pinnedDirectories: [],
      routeCwds: [],
    });
    expect(cwds).toEqual(["/proj"]);
    const props = makeProps({ renderedCwds: cwds });
    renderHook((p: HarnessProps) => useOpenSpecReconcile(p as unknown as UseOpenSpecReconcileArgs), { initialProps: props });
    expect(sentCwds(props.send)).toEqual(["/proj"]);
  });

  it("E20: removed-worktree session pulls cwd and mainPath, deduped with a sibling session", () => {
    const cwds = computeRenderedCwds({
      sessions: [
        sess({ id: "a", cwd: "/repo/.worktrees/os-x", attachedProposal: "x", gitWorktree: { mainPath: "/repo" } as never }),
        sess({ id: "b", cwd: "/repo", status: "idle" }),
      ],
      pinnedDirectories: [],
      routeCwds: [],
    });
    expect([...cwds].sort()).toEqual(["/repo", "/repo/.worktrees/os-x"]);
  });

  it("E21: archive route adds the folder and non-rendered candidate sessions", () => {
    const cwds = computeRenderedCwds({
      sessions: [sess({ id: "a", cwd: "/repo/.worktrees/os-x", hidden: true, attachedProposal: "x", gitWorktree: { mainPath: "/repo" } as never })],
      pinnedDirectories: [],
      routeCwds: [],
      archive: { cwd: "/repo", entries: [{ name: "2026-09-30-x", date: "2026-09-30", artifacts: [] }] },
    });
    expect([...cwds].sort()).toEqual(["/repo", "/repo/.worktrees/os-x"]);
  });

  it("a hidden attached session is not pulled outside the archive route", () => {
    expect(
      computeRenderedCwds({
        sessions: [sess({ id: "a", cwd: "/gone", hidden: true, attachedProposal: "x" })],
        pinnedDirectories: [],
        routeCwds: [],
      }),
    ).toEqual([]);
  });

  it("X2: openspec_get lost reply never settles the attachment; next pass re-sends", () => {
    vi.useFakeTimers();
    const props = makeProps({ renderedCwds: ["/proj"] });
    const { rerender } = renderHook((p: HarnessProps) => useOpenSpecReconcile(p as unknown as UseOpenSpecReconcileArgs), { initialProps: props });
    act(() => { vi.advanceTimersByTime(15_000); });
    rerender({ ...props });
    expect(sentCwds(props.send)).toEqual(["/proj", "/proj"]);
  });
});
