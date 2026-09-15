/**
 * Render suite for the ended-session reason pill (test-plan F7).
 * See change: stop-discarding-known-session-state (task 5.5).
 *
 * `SessionCard`'s subtitle row used to `return null` for every ended session —
 * the card deliberately had nothing to say about why it died. It now carries
 * `session.closedReason`, mirrored on the existing `moved` micro-pill. Every
 * state carries a glyph as well as a colour (WCAG 1.4.1).
 *
 * Harness glue copied from ChatView.pending-prompt-status.test.tsx.
 */

import type { ClosedReason, DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { SessionCard } from "../SessionCard.js";

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
    id: "ended-1",
    cwd: "/home/user/project",
    source: "tui",
    status: "ended",
    startedAt: Date.now() - 60_000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...overrides,
  };
}

const defaultProps = {
  selectedId: undefined,
  onSelect: () => {},
  now: Date.now(),
  showGitInfo: false,
  isHidden: false,
  onArchive: () => {},
};

function renderCard(session: DashboardSession) {
  return render(
    <ThemeProvider>
      <SessionCard session={session} {...defaultProps} />
    </ThemeProvider>,
  );
}

describe("SessionCard ended reason (F7)", () => {
  const cases: Array<[ClosedReason, string, string | undefined]> = [
    ["manual", "closed", undefined],
    ["process_gone", "process gone", "✕"],
    ["spawn_failed", "restart failed", "✕"],
    ["unknown", "ended — reason unknown", "?"],
  ];

  it.each(cases)("F7: closedReason=%s renders %s", (reason, label, glyph) => {
    const session = makeSession({ closedReason: reason });
    renderCard(session);

    const pill = screen.getByTestId(`session-ended-reason-${session.id}`);
    expect(pill.getAttribute("data-closed-reason")).toBe(reason);
    expect(pill.textContent).toContain(label);
    if (glyph) expect(pill.textContent).toContain(glyph);
    else expect(pill.textContent?.trim()).toBe(label);
  });

  it("an out-of-vocabulary closedReason falls back to `unknown` without crashing", () => {
    // Wire frames are unvalidated. `"constructor"`/`"toString"` are inherited
    // `Object.prototype` keys: an `in` check accepts them and resolves the map to
    // an Object member, crashing the `.key` read. `Object.hasOwn` rejects them.
    for (const bogus of ["constructor", "toString", "crashed-somehow"]) {
      const session = makeSession({ closedReason: bogus as unknown as ClosedReason });
      const { unmount } = renderCard(session);
      const pill = screen.getByTestId(`session-ended-reason-${session.id}`);
      expect(pill.getAttribute("data-closed-reason")).toBe("unknown");
      expect(pill.textContent).toContain("ended — reason unknown");
      unmount();
    }
  });

  it("F7: unknown is rendered, not hidden — it never implies a clean exit", () => {
    const session = makeSession({ closedReason: "unknown" });
    renderCard(session);
    expect(screen.getByTestId(`session-ended-reason-${session.id}`)).toBeTruthy();
    expect(screen.getByText(/reason unknown/)).toBeTruthy();
  });

  it("an ended session with no closedReason renders no reason pill (do not invent)", () => {
    const session = makeSession();
    const { container } = renderCard(session);
    expect(container.querySelector("[data-closed-reason]")).toBeNull();
  });

  it("a MOVED session keeps the moved badge and does NOT also render a reason pill", () => {
    const session = makeSession({
      closedReason: "process_gone",
      movedTo: { instanceId: "other-instance", at: Date.now() },
    });
    renderCard(session);
    expect(screen.getByTestId(`session-moved-badge-${session.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`session-ended-reason-${session.id}`)).toBeNull();
  });

  it("a live session renders no reason pill even when closedReason is present", () => {
    const session = makeSession({ status: "streaming", closedReason: "unknown" });
    const { container } = renderCard(session);
    expect(container.querySelector("[data-closed-reason]")).toBeNull();
  });
});
