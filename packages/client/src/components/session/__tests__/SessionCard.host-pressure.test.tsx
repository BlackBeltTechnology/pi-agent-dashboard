/**
 * Render suite for the host-pressure indicator (test-plan F1–F4).
 * See changes: stop-discarding-known-session-state (tasks 5.2–5.8),
 * fix-false-unresponsive-badge.
 *
 * The freeze signal is OUT-OF-BAND silence since the last received frame, not
 * the self-reported `eventLoopMaxMs` — a blocked event loop cannot fire its own
 * heartbeat, so it can only ever describe a stall already recovered from. The
 * verdict is the SERVER's (`session.hostPressure`), never re-derived from
 * `processMetrics.updatedAt`, which is pushed once at connect and then freezes.
 * Healthy sessions render nothing (zero added pixels). Every rendered state
 * carries a glyph as well as a colour (WCAG 1.4.1).
 *
 * Harness glue copied from ChatView.pending-prompt-status.test.tsx.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import {
  deriveHostPressure,
  formatEventLoopCorroboration,
  HOST_PRESSURE_DEGRADED_MS,
  HOST_PRESSURE_UNRESPONSIVE_MS,
  SessionCard,
} from "../SessionCard.js";

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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "press-1",
    cwd: "/home/user/project",
    source: "tui",
    status: "active",
    startedAt: Date.now() - 60_000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...overrides,
  };
}

function metrics(updatedAt: number, eventLoopMaxMs?: number) {
  return {
    rss: 100,
    heapUsed: 50,
    heapTotal: 80,
    cpuPercent: 1,
    loadAvg1m: 0.5,
    updatedAt,
    ...(eventLoopMaxMs != null ? { eventLoopMaxMs } : {}),
  };
}

/** The server's verdict, stamped with its receipt time of the last frame. */
function pressure(since: number, state: "degraded" | "unresponsive" = "degraded") {
  return { state, since };
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

describe("SessionCard host-pressure indicator", () => {
  it("F1: no server verdict yields UNKNOWN, never healthy", () => {
    const session = makeSession({ status: "streaming" });
    const d = deriveHostPressure(session, Date.now());
    expect(d.state).toBe("unknown");
    expect(d.state).not.toBe("healthy");

    const { container } = renderCard(session);
    expect(container.querySelector("[data-host-pressure]")).toBeNull();
  });

  it("a healthy (server cleared) session renders nothing — zero added pixels", () => {
    const session = makeSession({ status: "streaming", hostPressure: null });
    expect(deriveHostPressure(session, Date.now()).state).toBe("healthy");
    const { container } = renderCard(session);
    expect(container.querySelector("[data-host-pressure]")).toBeNull();
  });

  it("REGRESSION: a stale processMetrics timestamp alone never raises a badge", () => {
    // The snapshot-only `processMetrics` freezes in the browser, so hours of
    // apparent silence there mean nothing. Only the server's verdict counts.
    const session = makeSession({
      status: "streaming",
      processMetrics: metrics(Date.now() - 60 * 60_000),
    });
    expect(deriveHostPressure(session, Date.now()).state).toBe("unknown");
    const { container } = renderCard(session);
    expect(container.querySelector("[data-host-pressure]")).toBeNull();
  });

  it("F2: an ongoing stall is visible from the server verdict, with no heartbeat arriving", () => {
    const now = Date.now();
    const session = makeSession({
      status: "streaming",
      hostPressure: pressure(now - HOST_PRESSURE_UNRESPONSIVE_MS - 1_000, "unresponsive"),
    });
    renderCard(session);

    const pill = screen.getByTestId(`session-host-pressure-${session.id}`);
    expect(pill.getAttribute("data-host-pressure")).toBe("unresponsive");
    expect(pill.textContent).toMatch(/unresponsive/);
  });

  it("F2: the card self-ticks — a degraded session escalates as wall-clock advances", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00.000Z"));
    const base = Date.now();
    const session = makeSession({
      status: "streaming",
      hostPressure: pressure(base - HOST_PRESSURE_DEGRADED_MS - 1_000, "degraded"),
    });
    renderCard(session);
    expect(
      screen.getByTestId(`session-host-pressure-${session.id}`).getAttribute("data-host-pressure"),
    ).toBe("degraded");

    // No new verdict arrives — only time passes.
    act(() => {
      vi.advanceTimersByTime(HOST_PRESSURE_UNRESPONSIVE_MS);
    });

    const pill = screen.getByTestId(`session-host-pressure-${session.id}`);
    expect(pill.getAttribute("data-host-pressure")).toBe("unresponsive");
  });

  it("F2 boundary: the local tick escalates past the boundary but never falls below the server verdict", () => {
    const now = 1_000_000_000;
    expect(
      deriveHostPressure(
        makeSession({ hostPressure: pressure(now - HOST_PRESSURE_UNRESPONSIVE_MS, "degraded") }),
        now,
      ).state,
    ).toBe("unresponsive");
    expect(
      deriveHostPressure(
        makeSession({ hostPressure: pressure(now - HOST_PRESSURE_DEGRADED_MS - 1, "degraded") }),
        now,
      ).state,
    ).toBe("degraded");
    // Browser clock behind the server's: the badge the server raised stands.
    expect(
      deriveHostPressure(makeSession({ hostPressure: pressure(now, "degraded") }), now).state,
    ).toBe("degraded");
  });

  it("F3: a recovered stall is labelled past tense, never as currently frozen", () => {
    const now = Date.now();
    const session = makeSession({
      status: "streaming",
      hostPressure: null,
      processMetrics: metrics(now - 1_000, 12_000),
    });
    // Server cleared the verdict → healthy → nothing rendered → never current.
    expect(deriveHostPressure(session, now).state).toBe("healthy");
    const { container } = renderCard(session);
    expect(container.querySelector("[data-host-pressure]")).toBeNull();

    const corroboration = formatEventLoopCorroboration(12_000);
    expect(corroboration).toMatch(/earlier/);
    expect(corroboration).not.toMatch(/currently|right now|is frozen/);
  });

  it("F3: when corroboration is shown it reads as an already-recovered stall", () => {
    const session = makeSession({
      status: "streaming",
      hostPressure: pressure(Date.now() - 40_000),
      processMetrics: metrics(Date.now() - 40_000, 12_000),
    });
    renderCard(session);
    const pill = screen.getByTestId(`session-host-pressure-${session.id}`);
    expect(pill.getAttribute("title")).toMatch(/earlier/);
    expect(pill.getAttribute("title")).not.toMatch(/currently/);
  });

  it("F4: eventLoopMaxMs absent — indicator still works from silence and renders no corroboration", () => {
    const now = Date.now();
    const session = makeSession({
      status: "streaming",
      hostPressure: pressure(now - HOST_PRESSURE_UNRESPONSIVE_MS - 1_000, "unresponsive"),
    });
    const d = deriveHostPressure(session, now);
    expect(d.state).toBe("unresponsive");
    expect(d.eventLoopMaxMs).toBeUndefined();

    renderCard(session);
    const pill = screen.getByTestId(`session-host-pressure-${session.id}`);
    expect(pill.textContent).toMatch(/unresponsive/);
    expect(pill.getAttribute("title") ?? "").not.toMatch(/stalled|earlier/);
  });

  it("every rendered pressure state carries a glyph as well as colour (§1.4.1)", () => {
    const session = makeSession({
      status: "streaming",
      hostPressure: pressure(Date.now() - 40_000),
    });
    renderCard(session);
    const pill = screen.getByTestId(`session-host-pressure-${session.id}`);
    expect(pill.textContent).toContain("◐");
  });

  it("an ended session never shows a host-pressure indicator", () => {
    const session = makeSession({
      status: "ended",
      endedAt: Date.now(),
      hostPressure: pressure(Date.now() - 5 * 60_000, "unresponsive"),
    });
    const { container } = renderCard(session);
    expect(container.querySelector("[data-host-pressure]")).toBeNull();
  });
});
