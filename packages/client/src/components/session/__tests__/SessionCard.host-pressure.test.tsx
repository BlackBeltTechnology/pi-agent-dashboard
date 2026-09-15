/**
 * Render suite for the host-pressure indicator (test-plan F1–F4).
 * See change: stop-discarding-known-session-state (tasks 5.2–5.8).
 *
 * The freeze signal is OUT-OF-BAND silence since the last received frame, not
 * the self-reported `eventLoopMaxMs` — a blocked event loop cannot fire its own
 * heartbeat, so it can only ever describe a stall already recovered from.
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
  it("F1: absent processMetrics yields UNKNOWN, never healthy", () => {
    const session = makeSession({ status: "streaming" });
    const d = deriveHostPressure(session, Date.now());
    expect(d.state).toBe("unknown");
    expect(d.state).not.toBe("healthy");

    const { container } = renderCard(session);
    expect(container.querySelector("[data-host-pressure]")).toBeNull();
  });

  it("a healthy (fresh beat) session renders nothing — zero added pixels", () => {
    const session = makeSession({
      status: "streaming",
      processMetrics: metrics(Date.now() - 1_000),
    });
    const { container } = renderCard(session);
    expect(container.querySelector("[data-host-pressure]")).toBeNull();
  });

  it("F2: an ongoing stall is visible from silence alone, with no heartbeat arriving", () => {
    const now = Date.now();
    const session = makeSession({
      status: "streaming",
      processMetrics: metrics(now - HOST_PRESSURE_UNRESPONSIVE_MS - 1_000),
    });
    renderCard(session);

    const pill = screen.getByTestId(`session-host-pressure-${session.id}`);
    expect(pill.getAttribute("data-host-pressure")).toBe("unresponsive");
    expect(pill.textContent).toMatch(/unresponsive/);
  });

  it("F2: the card self-ticks — a fresh session goes unresponsive as wall-clock advances with no new frame", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00.000Z"));
    const base = Date.now();
    const session = makeSession({
      status: "streaming",
      processMetrics: metrics(base - 10_000),
    });
    renderCard(session);
    expect(screen.queryByTestId(`session-host-pressure-${session.id}`)).toBeNull();

    // No new `processMetrics` arrives — only time passes.
    act(() => {
      vi.advanceTimersByTime(HOST_PRESSURE_UNRESPONSIVE_MS);
    });

    const pill = screen.getByTestId(`session-host-pressure-${session.id}`);
    expect(pill.getAttribute("data-host-pressure")).toBe("unresponsive");
  });

  it("F2 boundary: past the unresponsive boundary is unresponsive; at the degraded boundary is healthy", () => {
    const now = 1_000_000_000;
    expect(
      deriveHostPressure(
        makeSession({ processMetrics: metrics(now - HOST_PRESSURE_UNRESPONSIVE_MS) }),
        now,
      ).state,
    ).toBe("unresponsive");
    expect(
      deriveHostPressure(
        makeSession({ processMetrics: metrics(now - HOST_PRESSURE_DEGRADED_MS) }),
        now,
      ).state,
    ).toBe("healthy");
    expect(
      deriveHostPressure(
        makeSession({ processMetrics: metrics(now - HOST_PRESSURE_DEGRADED_MS - 1) }),
        now,
      ).state,
    ).toBe("degraded");
  });

  it("F3: a recovered stall is labelled past tense, never as currently frozen", () => {
    const now = Date.now();
    const session = makeSession({
      status: "streaming",
      processMetrics: metrics(now - 1_000, 12_000),
    });
    // Fresh heartbeat → healthy → nothing rendered → never presented as current.
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
      processMetrics: metrics(now - HOST_PRESSURE_UNRESPONSIVE_MS - 1_000),
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
      processMetrics: metrics(Date.now() - 40_000),
    });
    renderCard(session);
    const pill = screen.getByTestId(`session-host-pressure-${session.id}`);
    expect(pill.textContent).toContain("◐");
  });

  it("an ended session never shows a host-pressure indicator", () => {
    const session = makeSession({
      status: "ended",
      endedAt: Date.now(),
      processMetrics: metrics(Date.now() - 5 * 60_000),
    });
    const { container } = renderCard(session);
    expect(container.querySelector("[data-host-pressure]")).toBeNull();
  });
});
