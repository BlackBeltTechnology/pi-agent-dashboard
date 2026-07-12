import { act, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/event-reducer.js";
import { ChatView } from "../ChatView.js";
import { ThemeProvider } from "../ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const defaultToolContext: ToolContext = { editors: [] };

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

function getScrollContainer(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-testid='chat-scroll-container']")!;
}

/** Dispatch a copy event with a stub clipboardData; return what was written. */
function dispatchCopy(scrollEl: HTMLElement): { text: string | null; prevented: boolean } {
  let written: string | null = null;
  const clipboardData = { setData: (_type: string, value: string) => (written = value) };
  const evt = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "clipboardData", { value: clipboardData });
  act(() => {
    scrollEl.dispatchEvent(evt);
  });
  return { text: written, prevented: evt.defaultPrevented };
}

describe("ChatView copy fidelity", () => {
  it("rebuilds clipboard text from a partial-node transcript selection", () => {
    const state = createInitialState();
    state.messages.push({ id: "0", role: "user", content: "the quick brown fox", timestamp: Date.now() });
    const { container } = render(
      <ThemeProvider>
        <ChatView state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const scrollEl = getScrollContainer(container);
    const textNode = scrollEl.querySelector("[data-index] p")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 15);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const { text, prevented } = dispatchCopy(scrollEl);
    expect(text).toBe("quick brown");
    expect(prevented).toBe(true);
  });

  it("ignores a collapsed selection (native copy owns it)", () => {
    const state = createInitialState();
    state.messages.push({ id: "0", role: "user", content: "hello world", timestamp: Date.now() });
    const { container } = render(
      <ThemeProvider>
        <ChatView state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const scrollEl = getScrollContainer(container);
    window.getSelection()!.removeAllRanges();

    const { text, prevented } = dispatchCopy(scrollEl);
    expect(text).toBeNull();
    expect(prevented).toBe(false);
  });
});
