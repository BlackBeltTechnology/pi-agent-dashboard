/**
 * Seek-to-card button in the desktop SessionHeader toolbar.
 * See change: add-seek-to-session-card.
 *
 * Covers test-plan #E1 (desktop-only gate): the `session-header-seek-card`
 * button renders on desktop when `onSeekToCard` is provided and is ABSENT on
 * mobile. Click invokes the callback.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/event-reducer.js";

function makeSession(overrides?: Partial<DashboardSession>): DashboardSession {
  return {
    id: "s1",
    status: "idle",
    cwd: "/tmp",
    startedAt: Date.now() - 60_000,
    ...overrides,
  } as DashboardSession;
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("../../hooks/useMobile.js");
});

async function loadHeader(mobile: boolean) {
  vi.doMock("../../hooks/useMobile.js", () => ({ useMobile: () => mobile }));
  const mod = await import("../SessionHeader.js");
  return mod.SessionHeader;
}

describe("SessionHeader Seek-to-card button", () => {
  it("renders the seek button on desktop when onSeekToCard is provided", async () => {
    const SessionHeader = await loadHeader(false);
    render(
      <SessionHeader
        session={makeSession()}
        state={createInitialState()}
        onSeekToCard={() => {}}
      />,
    );
    expect(screen.getByTestId("session-header-seek-card")).toBeTruthy();
  });

  it("does NOT render the seek button when onSeekToCard is omitted", async () => {
    const SessionHeader = await loadHeader(false);
    render(<SessionHeader session={makeSession()} state={createInitialState()} />);
    expect(screen.queryByTestId("session-header-seek-card")).toBeNull();
  });

  it("does NOT render the seek button on mobile (E1: desktop-only)", async () => {
    const SessionHeader = await loadHeader(true);
    render(
      <SessionHeader
        session={makeSession()}
        state={createInitialState()}
        onSeekToCard={() => {}}
      />,
    );
    expect(screen.queryByTestId("session-header-seek-card")).toBeNull();
  });

  it("invokes onSeekToCard on click", async () => {
    const SessionHeader = await loadHeader(false);
    const onSeekToCard = vi.fn();
    render(
      <SessionHeader
        session={makeSession()}
        state={createInitialState()}
        onSeekToCard={onSeekToCard}
      />,
    );
    fireEvent.click(screen.getByTestId("session-header-seek-card"));
    expect(onSeekToCard).toHaveBeenCalledTimes(1);
  });
});
