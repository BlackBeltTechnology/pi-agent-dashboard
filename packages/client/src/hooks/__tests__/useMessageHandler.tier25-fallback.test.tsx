/**
 * Regression suite for change: fix-worktree-spawn-placeholder-and-ordering
 * (Defect A — client Tier 2.5 placeholder clear fallback).
 *
 * When `session_added` carries NO matching `spawnRequestId` AND the session's
 * own cwd is not in `spawningCwds` (always true for worktree spawns, whose
 * placeholder is keyed by the PARENT cwd), the handler scans pending spawns
 * for a `kind: "spawn"` entry whose tracked cwd equals the session cwd and
 * clears that entry's `placeholderCwd`. Without this, a worktree placeholder
 * orphans whenever Tier 1 (spawnRequestId) misses.
 */

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageHandler } from "../useMessageHandler.js";

function makeSession(id: string, cwd: string): DashboardSession {
  return { id, cwd, source: "tui", status: "active", startedAt: 1 } as DashboardSession;
}

function setup(
  pending: Map<string, { cwd: string; kind: "spawn" | "resume"; placeholderCwd?: string }>,
  spawningCwds = new Set<string>(),
) {
  const clearSpawningCwd = vi.fn();
  const navigate = vi.fn();
  const setters: any = {
    setSessions: vi.fn(), setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
    setFileResults: vi.fn(), setOpenspecMap: vi.fn(), setOpenspecGroupsMap: vi.fn(),
    setModelsMap: vi.fn(), setRolesMap: vi.fn(), setSpawnResult: vi.fn(),
    setSessionOrderMap: vi.fn(), setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(),
    setWorkspaces: vi.fn(), setTerminals: vi.fn(), setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
    setDisplayPrefs: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(),
    navigate,
    clearSpawningCwd,
    spawningCwdsRef: { current: spawningCwds },
    subscribedRef: { current: new Set<string>() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: pending },
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (m: ServerToBrowserMessage) => result.current(m), clearSpawningCwd, navigate, pending };
}

describe("useMessageHandler — Tier 2.5 worktree fallback", () => {
  it("clears parent placeholder when no spawnRequestId matches (worktree spawn)", () => {
    const pending = new Map([
      ["rq-1", { cwd: "/repo/.worktrees/feat-x", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd, navigate } = setup(pending);

    dispatch({
      type: "session_added",
      session: makeSession("new-s", "/repo/.worktrees/feat-x"),
      // NO spawnRequestId.
    } as ServerToBrowserMessage);

    expect(clearSpawningCwd).toHaveBeenCalledWith("/repo");
    expect(navigate).toHaveBeenCalledWith("/session/new-s");
    expect(pending.has("rq-1")).toBe(false);
  });

  it("does NOT run for a plain spawn already cleared by Tier 2 (cwd match)", () => {
    // Plain spawn: placeholderCwd === cwd, and session.cwd is in spawningCwds.
    const pending = new Map([
      ["rq-2", { cwd: "/repo", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd } = setup(pending, new Set(["/repo"]));

    dispatch({
      type: "session_added",
      session: makeSession("new-s2", "/repo"),
      // NO spawnRequestId → Tier 2 (spawningCwds) handles it.
    } as ServerToBrowserMessage);

    // Tier 2 cleared exactly once with the cwd; Tier 2.5 did not double-handle.
    expect(clearSpawningCwd).toHaveBeenCalledTimes(1);
    expect(clearSpawningCwd).toHaveBeenCalledWith("/repo");
    // Tier 2 does not consume the pending entry (only Tier 1 / 2.5 do).
    expect(pending.has("rq-2")).toBe(true);
  });

  it("ignores resume entries sharing the session cwd", () => {
    const pending = new Map([
      ["rq-3", { cwd: "/repo/.worktrees/feat-z", kind: "resume" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd, navigate } = setup(pending);

    dispatch({
      type: "session_added",
      session: makeSession("new-s3", "/repo/.worktrees/feat-z"),
    } as ServerToBrowserMessage);

    expect(clearSpawningCwd).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(pending.has("rq-3")).toBe(true);
  });

  it("normalizes trailing slash when comparing cwds", () => {
    const pending = new Map([
      ["rq-4", { cwd: "/repo/.worktrees/feat-x/", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd } = setup(pending);

    dispatch({
      type: "session_added",
      session: makeSession("new-s4", "/repo/.worktrees/feat-x"),
    } as ServerToBrowserMessage);

    expect(clearSpawningCwd).toHaveBeenCalledWith("/repo");
    expect(pending.has("rq-4")).toBe(false);
  });
});

/**
 * close-registry-frame-shed-gaps (D2, test-plan F3/F4): a reconciled
 * `session_added` is a LATE repair. It must never navigate on ANY
 * spawn-correlation tier, and it may consume a pending spawn / clear a
 * placeholder ONLY on an exact `spawnRequestId` match.
 */
describe("useMessageHandler — reconciled add never steals navigation", () => {
  it("F3a: exact spawnRequestId match never navigates but consumes the pending spawn", () => {
    const pending = new Map([
      ["r2", { cwd: "/repoA", kind: "spawn" as const, placeholderCwd: "/repoA" }],
    ]);
    const { dispatch, clearSpawningCwd, navigate, pending: p } = setup(pending, new Set(["/repoA"]));

    dispatch({
      type: "session_added",
      session: makeSession("recon-exact", "/repoA"),
      spawnRequestId: "r2",
      reconciled: true,
    } as ServerToBrowserMessage);

    // Displayed session stays put.
    expect(navigate).not.toHaveBeenCalled();
    // ...but the placeholder stops spinning.
    expect(p.has("r2")).toBe(false);
    expect(clearSpawningCwd).toHaveBeenCalledWith("/repoA");
  });

  it("F3b: cwd-only match never navigates and touches no spawn state", () => {
    const pending = new Map([
      ["rq-cwd", { cwd: "/repoA", kind: "spawn" as const, placeholderCwd: "/repoA" }],
    ]);
    const { dispatch, clearSpawningCwd, navigate, pending: p } = setup(pending, new Set(["/repoA"]));

    dispatch({
      type: "session_added",
      session: makeSession("recon-cwd", "/repoA"),
      reconciled: true,
    } as ServerToBrowserMessage);

    expect(navigate).not.toHaveBeenCalled();
    expect(clearSpawningCwd).not.toHaveBeenCalled();
    expect(p.has("rq-cwd")).toBe(true);
  });

  it("F3c: worktree-only match never navigates and keeps the pending spawn", () => {
    const pending = new Map([
      ["rq-wt", { cwd: "/repo/.worktrees/wt", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd, navigate, pending: p } = setup(pending);

    dispatch({
      type: "session_added",
      session: makeSession("recon-wt", "/repo/.worktrees/wt"),
      reconciled: true,
    } as ServerToBrowserMessage);

    expect(navigate).not.toHaveBeenCalled();
    expect(clearSpawningCwd).not.toHaveBeenCalled();
    expect(p.has("rq-wt")).toBe(true);
  });

  it("F4: no request id leaves an unrelated spawn pending and its auto-navigation intact", () => {
    const pending = new Map([
      ["r9", { cwd: "/repoA", kind: "spawn" as const, placeholderCwd: "/repoA" }],
    ]);
    const { dispatch, clearSpawningCwd, navigate, pending: p } = setup(pending, new Set(["/repoA"]));

    // Reconciled add for a DIFFERENT /repoA session, no spawnRequestId.
    dispatch({
      type: "session_added",
      session: makeSession("other", "/repoA"),
      reconciled: true,
    } as ServerToBrowserMessage);

    expect(navigate).not.toHaveBeenCalled();
    expect(clearSpawningCwd).not.toHaveBeenCalled();
    expect(p.has("r9")).toBe(true);

    // The unrelated spawn's OWN add still auto-navigates.
    dispatch({
      type: "session_added",
      session: makeSession("r9-session", "/repoA"),
      spawnRequestId: "r9",
    } as ServerToBrowserMessage);

    expect(navigate).toHaveBeenCalledWith("/session/r9-session");
    expect(p.has("r9")).toBe(false);
  });
});
