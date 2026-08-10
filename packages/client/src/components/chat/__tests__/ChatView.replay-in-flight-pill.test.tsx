/**
 * Render-level suite for change: show-replay-in-flight-indicator.
 *
 * Pins the pill's contract (handle + a11y), its show-delay
 * (`REPLAY_PILL_DELAY_MS`, referenced as a constant — never the literal 300),
 * its exclusivity with the loading skeleton and the "No messages yet"
 * placeholder, and the session-switch reset (`<ChatView>` is `React.memo`'d and
 * rendered without a `key`, so the instance is reused).
 *
 * Harness glue copied from `components/__tests__/ChatView.streaming-text-flush.test.tsx`.
 */

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState } from "../../../lib/chat/event-reducer.js";
import { REPLAY_PILL_DELAY_MS } from "../../../lib/replay/loading-history.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import type { ToolContext } from "../../tool-renderers/index.js";
import { ChatView } from "../ChatView.js";

const defaultToolContext: ToolContext = {};
const PILL = "replay-in-flight-pill";

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

/** A state with one painted message — the "partial history already visible" case. */
function stateWithMessages(text = "hello"): SessionState {
  const s = createInitialState();
  s.messages.push({ id: "m1", role: "user", content: text, timestamp: 100 } as SessionState["messages"][number]);
  return s;
}

function renderChat(props: { sessionId?: string; state?: SessionState; replayInFlight?: boolean; loadingHistory?: boolean }) {
  return render(
    <ThemeProvider>
      <ChatView
        sessionId={props.sessionId ?? "s1"}
        state={props.state ?? stateWithMessages()}
        toolContext={defaultToolContext}
        replayInFlight={props.replayInFlight}
        loadingHistory={props.loadingHistory}
      />
    </ThemeProvider>,
  );
}

describe("ChatView replay-in-flight pill", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("F1 renders with its handle and a11y contract once the delay elapses", () => {
    renderChat({ replayInFlight: true });
    expect(screen.queryByTestId(PILL)).toBeNull();

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });

    const pill = screen.getByTestId(PILL);
    expect(pill.getAttribute("role")).toBe("status");
    expect(pill.getAttribute("aria-busy")).toBe("true");
    expect(pill.getAttribute("aria-label")).toBeTruthy();
  });

  it("F2 disappears when the terminal batch clears the flag", () => {
    const { rerender } = renderChat({ replayInFlight: true });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.getByTestId(PILL)).toBeTruthy();

    // Terminal `event_replay { isLast: true }` → App clears the flag.
    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="s1" state={stateWithMessages()} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
    });

    expect(screen.queryByTestId(PILL)).toBeNull();
  });

  it("F3 skeleton and pill are never both present", () => {
    // Messages empty + loadingHistory → skeleton branch; pill suppressed.
    const { rerender } = renderChat({ state: createInitialState(), loadingHistory: true, replayInFlight: true });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.getByTestId("chat-history-skeleton")).toBeTruthy();
    expect(screen.queryByTestId(PILL)).toBeNull();

    // First content batch lands: loadingHistory clears, messages present.
    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="s1" state={stateWithMessages()} toolContext={defaultToolContext} loadingHistory={false} replayInFlight={true} />
        </ThemeProvider>,
      );
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.queryByTestId("chat-history-skeleton")).toBeNull();
    expect(screen.getByTestId(PILL)).toBeTruthy();
  });

  it("F4 an empty session shows the placeholder and never the pill", () => {
    // Only `event_replay { events: [], isLast: true }` → both flags false, no messages.
    renderChat({ state: createInitialState(), loadingHistory: false, replayInFlight: false });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS * 10);
    });

    expect(screen.getByText("No messages yet")).toBeTruthy();
    expect(screen.queryByTestId(PILL)).toBeNull();
  });

  it("F5 a replay resolving just under the threshold never paints", () => {
    const { rerender } = renderChat({ replayInFlight: true });

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS - 1);
    });
    expect(screen.queryByTestId(PILL)).toBeNull();

    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="s1" state={stateWithMessages()} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
    });

    // Sample across the rest of the timeline, not just the end state.
    for (const step of [1, 1, REPLAY_PILL_DELAY_MS, REPLAY_PILL_DELAY_MS * 10]) {
      React.act(() => {
        vi.advanceTimersByTime(step);
      });
      expect(screen.queryByTestId(PILL)).toBeNull();
    }
  });

  it("F6 a slow replay paints at the threshold and stays until the flag clears", () => {
    const { rerender } = renderChat({ replayInFlight: true });

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.getByTestId(PILL)).toBeTruthy();

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS * 20);
    });
    expect(screen.getByTestId(PILL)).toBeTruthy();

    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="s1" state={stateWithMessages()} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
    });
    expect(screen.queryByTestId(PILL)).toBeNull();
  });

  it("F7 a pending delay timer is cancelled when the flag clears before the threshold", () => {
    const { rerender } = renderChat({ replayInFlight: true });

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS - 50);
    });
    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="s1" state={stateWithMessages()} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
    });

    // At and after the threshold instant the pill must stay absent, and no
    // timer may remain armed for this session.
    React.act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId(PILL)).toBeNull();
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS * 10);
    });
    expect(screen.queryByTestId(PILL)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("F8 delay state does not leak across a session switch on the reused instance", () => {
    // Session A: delay pending (and then also the visible case below).
    const { rerender } = renderChat({ sessionId: "A", replayInFlight: true });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.getByTestId(PILL)).toBeTruthy();

    // Switch to session B (no `key` → same ChatView instance), replay NOT in flight.
    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="B" state={stateWithMessages("other")} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS * 10);
    });

    // No A-armed timer may resurrect it at any point on B's timeline.
    for (const step of [1, REPLAY_PILL_DELAY_MS, REPLAY_PILL_DELAY_MS * 10]) {
      React.act(() => {
        vi.advanceTimersByTime(step);
      });
      expect(screen.queryByTestId(PILL)).toBeNull();
    }
  });
});
