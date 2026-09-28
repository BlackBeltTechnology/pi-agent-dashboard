/**
 * ChatView waiting / failed / unchanged branches + render-count isolation of
 * the slow-load notice. See change: show-session-history-load-state
 * (test-plan #F4, #F5, #F6, #P1).
 *
 * Harness glue copied from `ChatView.replay-in-flight-pill.test.tsx`.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { Profiler } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState } from "../../../lib/chat/event-reducer.js";
import type { HistoryLoadPhase } from "../../../lib/replay/history-load-phase.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import type { ToolContext } from "../../tool-renderers/index.js";
import { ChatView } from "../ChatView.js";

const defaultToolContext: ToolContext = {};

// ChatView-render probe for #P1: `useFxVisibility` is called once per ChatView
// render (top-level hook); nothing else in an EMPTY chat subtree calls it.
const fxCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../../hooks/useFxVisibility.js", async (orig) => {
  const mod = await orig<typeof import("../../../hooks/useFxVisibility.js")>();
  return {
    ...mod,
    useFxVisibility: (...a: Parameters<typeof mod.useFxVisibility>) => {
      fxCalls.n++;
      return mod.useFxVisibility(...a);
    },
  };
});

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

function stateWithMessages(): SessionState {
  const s = createInitialState();
  s.messages.push({ id: "m1", role: "user", content: "hello there", timestamp: 100 } as SessionState["messages"][number]);
  return s;
}

interface P {
  state?: SessionState;
  loadingHistory?: boolean;
  historyPhase?: HistoryLoadPhase;
  historyStartedAt?: number;
  onRetryHistory?: () => void;
}
const EMPTY = createInitialState();
function chat(p: P) {
  return (
    <ChatView
      sessionId="s1"
      state={p.state ?? EMPTY}
      toolContext={defaultToolContext}
      loadingHistory={p.loadingHistory}
      historyPhase={p.historyPhase}
      historyStartedAt={p.historyStartedAt}
      onRetryHistory={p.onRetryHistory}
    />
  );
}
const renderChat = (p: P) => render(<ThemeProvider>{chat(p)}</ThemeProvider>);

describe("ChatView history-load phase branches", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("#F4 waiting: status region, no skeleton, no 'No messages yet'", () => {
    renderChat({ historyPhase: "waiting", loadingHistory: true });
    const region = screen.getByTestId("chat-history-waiting");
    expect(region.getAttribute("role")).toBe("status");
    expect(within(region).getByText("Waiting for connection")).toBeTruthy();
    expect(screen.queryByTestId("chat-history-skeleton")).toBeNull();
    expect(screen.queryByText("No messages yet")).toBeNull();
  });

  it("#F5 failed: alert region + Retry calls onRetryHistory once", () => {
    const onRetry = vi.fn();
    renderChat({ historyPhase: "failed", onRetryHistory: onRetry });
    const region = screen.getByTestId("chat-history-failed");
    expect(region.getAttribute("role")).toBe("alert");
    expect(within(region).getByText("Couldn't load history")).toBeTruthy();
    expect(screen.queryByText("No messages yet")).toBeNull();
    fireEvent.click(screen.getByTestId("chat-history-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("#F6a idle + loadingHistory → skeleton", () => {
    renderChat({ historyPhase: "idle", loadingHistory: true });
    expect(screen.getByTestId("chat-history-skeleton")).toBeTruthy();
    expect(screen.queryByText("No messages yet")).toBeNull();
  });

  it("#F6b idle / undefined, not loading → 'No messages yet'", () => {
    renderChat({ historyPhase: "idle", loadingHistory: false });
    expect(screen.getByText("No messages yet")).toBeTruthy();
    cleanup();
    renderChat({ loadingHistory: false });
    expect(screen.getByText("No messages yet")).toBeTruthy();
  });

  it("#F6c messages present (disconnected ⇒ phase idle) → bubbles, no waiting state", () => {
    renderChat({ state: stateWithMessages(), historyPhase: "idle" });
    expect(screen.getByText("hello there")).toBeTruthy();
    expect(screen.queryByTestId("chat-history-waiting")).toBeNull();
    expect(screen.queryByText("Waiting for connection")).toBeNull();
  });

  it("#P1 slow notice ticks without re-rendering ChatView", () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    let commits = 0;
    render(
      <ThemeProvider>
        <Profiler id="chat" onRender={() => { commits++; }}>
          {chat({ historyPhase: "loading", loadingHistory: true, historyStartedAt: 1_000_000 - 12_000 })}
        </Profiler>
      </ThemeProvider>,
    );
    const seconds = () => screen.getByTestId("chat-history-slow-notice").querySelector("[aria-hidden='true']")?.textContent ?? "";
    expect(seconds()).toBe("· 12s");
    const chatBefore = fxCalls.n;
    expect(chatBefore).toBeGreaterThan(0); // probe is live
    const commitsBefore = commits;
    for (let i = 0; i < 5; i++) {
      React.act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(seconds()).toBe("· 17s");
    expect(commits - commitsBefore).toBe(5); // the notice's own commits
    expect(fxCalls.n - chatBefore).toBe(0); // ChatView never re-rendered
  });
});
