/**
 * Viewport-flip coverage for the mobile action sheet. See change:
 * fix-popover-viewport-flip.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorktreeActionsMenu, __resetGhAvailableCache } from "../worktree/WorktreeActionsMenu.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => true }));
vi.mock("../../lib/git/git-api.js", () => ({
  pushWorktreeBranch: vi.fn(async () => ({ ok: true })),
  createWorktreePR: vi.fn(async () => ({ ok: true, data: { url: "https://gh/pr/1", pushed: false } })),
  fetchWorktreeDiffStat: vi.fn(async () => ({ ok: true, data: {} })),
  mergeWorktree: vi.fn(async () => ({ ok: true, data: {} })),
  removeWorktree: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../lib/api/tools-api.js", () => ({
  fetchTool: vi.fn(async (name: string) => ({ name, kind: "binary", ok: true, source: "system", path: "/usr/bin/" + name })),
}));

function setViewportHeight(h: number) {
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true, writable: true });
}

beforeEach(() => setViewportHeight(1000));
afterEach(() => {
  cleanup();
  __resetGhAvailableCache();
  vi.restoreAllMocks();
});

function makeSession(): DashboardSession {
  return {
    id: "s1",
    cwd: "/repo/.worktrees/feat-x",
    source: "dashboard",
    status: "active",
    startedAt: 1,
    gitWorktree: { mainPath: "/repo", name: "feat-x", base: "main" },
  } as DashboardSession;
}

describe("WorktreeActionsMenu mobile sheet viewport flip", () => {
  it("flips the action sheet upward near the viewport bottom", () => {
    setViewportHeight(950);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 900,
      bottom: 930,
      left: 0,
      right: 0,
      width: 0,
      height: 30,
      x: 0,
      y: 900,
      toJSON: () => ({}),
    } as DOMRect);

    render(<WorktreeActionsMenu session={makeSession()} allSessions={[]} onShutdownSession={() => {}} />);
    fireEvent.click(screen.getByTestId("worktree-actions-mobile-trigger"));

    const sheet = screen.getByTestId("worktree-actions-mobile-sheet");
    expect(sheet.className).toContain("bottom-full");
    expect(sheet.className).not.toContain("top-full");
    expect(sheet.style.maxHeight).toBe("892px");
  });
});
