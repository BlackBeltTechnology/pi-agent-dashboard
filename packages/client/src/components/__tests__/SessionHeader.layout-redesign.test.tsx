/**
 * Header redesign (change: redesign-split-layout-controls).
 *
 * F4 (test-plan): the desktop SessionHeader renders the layout-mode switch
 * after name+rename and immediately before the Seek button, drops the `model`
 * and `thinkingLevel` segments (both already live on the session card), and
 * KEEPS the `pi <version>` segment (the only per-session pi surface).
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/event-reducer.js";
import { SplitWorkspaceProvider } from "../SplitWorkspaceContext.js";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("../../hooks/useMobile.js");
});
beforeEach(() => localStorage.clear());

function makeSession(overrides?: Partial<DashboardSession>): DashboardSession {
  return {
    id: "s1",
    status: "idle",
    cwd: "/tmp",
    startedAt: Date.now() - 60_000,
    model: "claude-opus-4",
    thinkingLevel: "high",
    piVersion: "0.9.9",
    ...overrides,
  } as DashboardSession;
}

async function loadDesktopHeader() {
  vi.doMock("../../hooks/useMobile.js", () => ({ useMobile: () => false }));
  const mod = await import("../SessionHeader.js");
  return mod.SessionHeader;
}

function renderInProvider(node: React.ReactElement) {
  return render(
    <SplitWorkspaceProvider sessionId="s1" cwd="/tmp" orientation="h">
      {node}
    </SplitWorkspaceProvider>,
  );
}

const FOLLOWS = Node.DOCUMENT_POSITION_FOLLOWING;

describe("SessionHeader layout redesign (F4)", () => {
  it("orders back → name → mode-switch → Seek, before the flex spacer", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(
      <SessionHeader session={makeSession()} state={createInitialState()} onRename={() => {}} showBack onBack={() => {}} onSeekToCard={() => {}} />,
    );
    const back = screen.getByTestId("back-button");
    const sw = screen.getByTestId("layout-mode-switch");
    const seek = screen.getByTestId("session-header-seek-card");
    // back precedes the switch; the switch precedes Seek.
    expect(back.compareDocumentPosition(sw) & FOLLOWS).toBeTruthy();
    expect(sw.compareDocumentPosition(seek) & FOLLOWS).toBeTruthy();
  });

  it("drops model + thinkingLevel, keeps the pi version segment", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(
      <SessionHeader session={makeSession()} state={createInitialState()} onRename={() => {}} onSeekToCard={() => {}} />,
    );
    expect(screen.queryByText("claude-opus-4")).toBeNull();
    expect(screen.queryByText("high")).toBeNull();
    expect(screen.getByText(/pi 0\.9\.9/)).toBeTruthy();
  });
});
