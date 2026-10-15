/**
 * DOM contract for the question stack's "Go to session": a PENDING inline ask is
 * wrapped in `[data-pending-ask]` (focusable, tabindex -1); a resolved one is
 * not. See change: add-pending-question-stack.
 */
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type ChatMessage, createInitialState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

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

const ui = (status: string): ChatMessage => ({
  id: "ui-r1",
  role: "interactiveUi",
  content: "confirm",
  timestamp: Date.now(),
  args: { requestId: "r1", method: "confirm", params: { title: "Ship it?" }, status } as Record<string, unknown>,
});

function renderChat(m: ChatMessage) {
  const state = createInitialState();
  state.messages.push(m);
  return render(
    <ThemeProvider>
      <ChatView state={state} toolContext={{}} />
    </ThemeProvider>,
  );
}

describe("ChatView pending-ask marker", () => {
  it("wraps a pending ask in a focusable [data-pending-ask]", () => {
    const { container } = renderChat(ui("pending"));
    const el = container.querySelector("[data-pending-ask]");
    expect(el).toBeTruthy();
    expect(el?.getAttribute("tabindex")).toBe("-1");
    expect(el?.textContent).toContain("Ship it?");
  });

  it("does not mark a resolved ask", () => {
    const { container } = renderChat(ui("resolved"));
    expect(container.querySelector("[data-pending-ask]")).toBeNull();
  });
});
