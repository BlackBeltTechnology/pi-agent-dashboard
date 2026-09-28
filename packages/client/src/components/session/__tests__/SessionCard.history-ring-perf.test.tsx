/**
 * Only `SessionStatusChip` ticks per second, never `SessionCard`.
 * See change: show-session-history-load-state (test-plan #P2).
 *
 * Harness glue copied from `SessionCard.host-pressure.test.tsx`.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { REPLAY_PILL_DELAY_MS } from "../../../lib/replay/loading-history.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { SessionCard } from "../SessionCard.js";

vi.mock("../../../hooks/useMobile.js", () => ({
  useMobile: vi.fn(() => false),
}));

// SessionCard-render probe: `useSessionCardDragHandle` is a top-level hook of
// SessionCard, called exactly once per SessionCard render.
const cardRenders = vi.hoisted(() => ({ n: 0 }));
vi.mock("../SortableSessionCard.js", async (orig) => {
  const mod = await orig<typeof import("../SortableSessionCard.js")>();
  return {
    ...mod,
    useSessionCardDragHandle: () => {
      cardRenders.n++;
      return mod.useSessionCardDragHandle();
    },
  };
});

// Offscreen-pause probe: record which nodes the card hands to the
// IntersectionObserver-backed `observeFx` (it toggles `.fx-offscreen`).
const observed = vi.hoisted(() => ({ nodes: [] as Element[] }));
vi.mock("../../../lib/util/fx-visibility.js", async (orig) => {
  const mod = await orig<typeof import("../../../lib/util/fx-visibility.js")>();
  return {
    ...mod,
    observeFx: (node: Element) => {
      observed.nodes.push(node);
      return () => {};
    },
  };
});

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

describe("SessionCard history ring perf (#P2)", () => {
  it("SessionCard commits +0 while the chip title changes 5 times over 5 s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const session: DashboardSession = {
      id: "perf-1", cwd: "/home/user/project", source: "tui", status: "ended",
      startedAt: Date.now() - 60_000, tokensIn: 0, tokensOut: 0, cost: 0,
    };
    let commits = 0;
    render(
      <ThemeProvider>
        <Profiler id="card" onRender={() => { commits++; }}>
          <SessionCard
            session={session}
            selectedId={undefined}
            onSelect={() => {}}
            now={Date.now()}
            showGitInfo={false}
            isHidden={false}
            onArchive={() => {}}
            historyPhase="loading"
            historyStartedAt={Date.now() - 12_000}
          />
        </Profiler>
      </ThemeProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    const title = () => screen.getByTestId("session-status-icon").getAttribute("title");
    const cardBefore = cardRenders.n;
    expect(cardBefore).toBeGreaterThan(0); // probe is live
    const commitsBefore = commits;
    const titles = new Set<string | null>([title()]);
    const changes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const prev = title();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      if (title() !== prev) changes.push(i);
      titles.add(title());
    }
    expect(changes).toHaveLength(5);
    expect(commits - commitsBefore).toBeGreaterThanOrEqual(5); // chip's own commits
    expect(cardRenders.n - cardBefore).toBe(0);
  });
});

// CodeRabbit PR #753: an unselected, stripe-less card must still be observed
// while its ring spins, so `.fx-offscreen` can pause the arc offscreen (D7).
describe("SessionCard history ring offscreen pause", () => {
  function renderCard(historyPhase?: "loading" | "failed") {
    const session: DashboardSession = {
      id: "off-1", cwd: "/home/user/project", source: "tui", status: "ended",
      startedAt: Date.now() - 60_000, tokensIn: 0, tokensOut: 0, cost: 0,
    };
    return render(
      <ThemeProvider>
        <SessionCard
          session={session}
          selectedId={undefined}
          onSelect={() => {}}
          now={Date.now()}
          showGitInfo={false}
          isHidden={false}
          onArchive={() => {}}
          historyPhase={historyPhase}
          historyStartedAt={historyPhase === "loading" ? Date.now() : undefined}
        />
      </ThemeProvider>,
    );
  }
  const cardObserved = () => observed.nodes.some((n) => n.getAttribute("data-session-id") === "off-1");

  it("observes the card while its history ring is loading", () => {
    observed.nodes = [];
    renderCard("loading");
    expect(cardObserved()).toBe(true);
  });

  it("does not observe an idle, unselected, stripe-less card (no animated fx)", () => {
    observed.nodes = [];
    renderCard(undefined);
    expect(cardObserved()).toBe(false);
  });
});
