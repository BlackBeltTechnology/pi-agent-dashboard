/**
 * Below-floor warning (test-plan #F1): a session whose bridge-reported pi is
 * below the dashboard's lockstep floor shows a warning naming BOTH the running
 * and the required version, on the session card and in the chat view header.
 * Absent when the flag is cleared (`null`) or was never set.
 *
 * SessionCard harness glue copied from SessionCard-status-shape.test.tsx.
 * See change: update-pi-core-1-0-adopt-apis (task 3.3 / 6.15).
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useMobile } from "../../../hooks/useMobile.js";
import { createInitialState } from "../../../lib/chat/event-reducer.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { PiBelowFloorWarning } from "../PiBelowFloorWarning.js";
import { SessionCard } from "../SessionCard.js";
import { SessionHeader } from "../SessionHeader.js";

vi.mock("../../../hooks/useMobile.js", () => ({
  useMobile: vi.fn(() => false),
}));

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => cleanup());

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "floor-1",
    cwd: "/home/user/project",
    source: "tui",
    status: "idle",
    startedAt: Date.now() - 60_000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...overrides,
  };
}

const FLAGGED: Partial<DashboardSession> = { piVersion: "0.87.1", piBelowFloor: { minimum: "1.0.0" } };

const cardProps = {
  selectedId: undefined,
  onSelect: () => {},
  now: Date.now(),
  showGitInfo: false,
  isHidden: false,
  onArchive: () => {},
};

function expectNamesBoth(el: HTMLElement) {
  expect(el.textContent).toContain("0.87.1");
  expect(el.textContent).toContain("1.0.0");
}

describe("PiBelowFloorWarning (F1)", () => {
  it("names the running and the required version, announced as a status", () => {
    render(<PiBelowFloorWarning session={makeSession(FLAGGED)} />);
    const el = screen.getByTestId("pi-below-floor-warning");
    expectNamesBoth(el);
    expect(el.getAttribute("role")).toBe("status");
  });

  it("renders nothing when the flag is cleared or absent", () => {
    const { unmount } = render(<PiBelowFloorWarning session={makeSession({ piVersion: "1.0.0", piBelowFloor: null })} />);
    expect(screen.queryByTestId("pi-below-floor-warning")).toBeNull();
    unmount();
    render(<PiBelowFloorWarning session={makeSession({ piVersion: "1.0.0" })} />);
    expect(screen.queryByTestId("pi-below-floor-warning")).toBeNull();
  });

  it("shows on the session card when flagged, and not when unflagged", () => {
    const { unmount } = render(
      <ThemeProvider>
        <SessionCard session={makeSession(FLAGGED)} {...cardProps} />
      </ThemeProvider>,
    );
    expectNamesBoth(screen.getByTestId("pi-below-floor-warning"));
    unmount();

    render(
      <ThemeProvider>
        <SessionCard session={makeSession({ piVersion: "1.0.0", piBelowFloor: null })} {...cardProps} />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId("pi-below-floor-warning")).toBeNull();
  });

  it("shows in the chat view header when flagged, and not when unflagged", () => {
    const { unmount } = render(<SessionHeader session={makeSession(FLAGGED)} state={createInitialState()} />);
    expectNamesBoth(screen.getByTestId("pi-below-floor-warning"));
    unmount();

    render(<SessionHeader session={makeSession({ piVersion: "1.0.0" })} state={createInitialState()} />);
    expect(screen.queryByTestId("pi-below-floor-warning")).toBeNull();
  });

  describe("mobile layouts", () => {
    afterEach(() => vi.mocked(useMobile).mockReturnValue(false));

    it("shows on the mobile card and mobile header when flagged, not when unflagged", () => {
      vi.mocked(useMobile).mockReturnValue(true);
      const card = render(
        <ThemeProvider>
          <SessionCard session={makeSession(FLAGGED)} {...cardProps} />
        </ThemeProvider>,
      );
      expectNamesBoth(screen.getByTestId("pi-below-floor-warning"));
      card.unmount();

      const header = render(<SessionHeader session={makeSession(FLAGGED)} state={createInitialState()} />);
      expectNamesBoth(screen.getByTestId("pi-below-floor-warning"));
      header.unmount();

      render(
        <ThemeProvider>
          <SessionCard session={makeSession({ piVersion: "1.0.0", piBelowFloor: null })} {...cardProps} />
        </ThemeProvider>,
      );
      render(<SessionHeader session={makeSession({ piVersion: "1.0.0" })} state={createInitialState()} />);
      expect(screen.queryByTestId("pi-below-floor-warning")).toBeNull();
    });
  });
});
