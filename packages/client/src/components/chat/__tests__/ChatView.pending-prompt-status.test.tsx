/**
 * Render-level suite for the optimistic pending-prompt bubble's status arms.
 *
 * A timed-out prompt keeps the user's text and must render a clearly-failed
 * affordance — never the emerald `sent` tick.
 * See change: fix-optimistic-prompt-stuck-sending, test-plan #F3.
 *
 * Harness glue copied from `ChatView.replay-in-flight-pill.test.tsx`.
 */

import { cleanup, render, screen } from "@testing-library/react";
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

function renderWithPending(pendingPrompt: PendingPrompt) {
  const state: SessionState = { ...createInitialState(), pendingPrompt };
  return render(
    <ThemeProvider>
      <ChatView sessionId="s1" state={state} toolContext={defaultToolContext} />
    </ThemeProvider>,
  );
}

describe("ChatView pending-prompt status arms", () => {
  it("#F3 a failed prompt renders the failed affordance, keeps its text, and shows no 'sent' tick", () => {
    renderWithPending({ text: "hi", status: "failed" });

    expect(screen.getByTestId("pending-prompt-failed")).toBeTruthy();
    expect(screen.getByText("hi")).toBeTruthy();
    expect(screen.queryByText("sent")).toBeNull();
    expect(screen.queryByText("sending")).toBeNull();
  });

  it("a sent prompt still renders the success tick (non-regression)", () => {
    renderWithPending({ text: "hi", status: "sent" });

    expect(screen.getByText("sent")).toBeTruthy();
    expect(screen.queryByTestId("pending-prompt-failed")).toBeNull();
  });

  it("a sending prompt still renders the sending spinner (non-regression)", () => {
    renderWithPending({ text: "hi", status: "sending" });

    expect(screen.getByText("sending")).toBeTruthy();
    expect(screen.queryByTestId("pending-prompt-failed")).toBeNull();
  });
});
