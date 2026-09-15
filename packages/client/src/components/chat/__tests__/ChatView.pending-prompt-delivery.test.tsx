/**
 * Render suite for the honest-undelivered failed arm of the pending-prompt
 * card. See change: stop-discarding-known-session-state (tasks 2.3 / 2.3a).
 *
 * The failed arm keeps its text, names the CAUSE, and offers a way out
 * (Nielsen #3). Error colour comes from `--severity-error-*`, never colour
 * alone (WCAG 1.4.1). Harness glue copied from
 * `ChatView.pending-prompt-status.test.tsx`.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState, type PendingPrompt, type SessionState } from "../../../lib/chat/event-reducer.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import type { ToolContext } from "../../tool-renderers/index.js";
import { ChatView } from "../ChatView.js";

const defaultToolContext: ToolContext = {};

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

afterEach(() => cleanup());

function renderWithPending(pendingPrompt: PendingPrompt, extraProps: Record<string, unknown> = {}) {
  const state: SessionState = { ...createInitialState(), pendingPrompt };
  return render(
    <ThemeProvider>
      <ChatView sessionId="s1" state={state} toolContext={defaultToolContext} {...(extraProps as any)} />
    </ThemeProvider>,
  );
}

describe("ChatView — honest no-bridge failure", () => {
  it("F5: a connection-attributed failure names the cause, not the session", () => {
    renderWithPending({ text: "run the tests", status: "failed", failureCause: "connection" });

    expect(
      screen.getByText("Dashboard is offline — your prompt never left this browser."),
    ).toBeTruthy();
    // The prompt text is preserved.
    expect(screen.getByText("run the tests")).toBeTruthy();
  });

  it("2.3a: the failed arm offers a Retry exit", () => {
    const onRetryPendingPrompt = vi.fn();
    renderWithPending(
      { text: "run the tests", status: "failed", failureCause: "connection" },
      { onRetryPendingPrompt },
    );

    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetryPendingPrompt).toHaveBeenCalledOnce();
  });

  it("2.3a: the no-session-file failed arm offers Fork instead (not Retry)", () => {
    const onForkPendingPrompt = vi.fn();
    const onRetryPendingPrompt = vi.fn();
    renderWithPending(
      { text: "continue where you left off", status: "failed", failureCause: "no_session_file" },
      { onForkPendingPrompt, onRetryPendingPrompt },
    );

    expect(
      screen.getByText("This session has no saved transcript, so it can't be resumed."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /fork instead/i }));
    expect(onForkPendingPrompt).toHaveBeenCalledOnce();
    expect(onRetryPendingPrompt).not.toHaveBeenCalled();
  });

  it("a legacy failed prompt with no cause keeps the plain 'not sent' arm (no fabricated cause)", () => {
    renderWithPending({ text: "run the tests", status: "failed" });

    expect(screen.queryByText(/never left this browser/)).toBeNull();
  });
});
