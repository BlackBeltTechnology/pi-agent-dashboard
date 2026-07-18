import { act, render } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

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

// Production-faithful harness: ThemeProvider mounts ONCE above the state owner,
// so a state change (a streamed chunk / message_end) re-renders ChatView but
// NOT ThemeProvider. This mirrors the real app tree (ThemeProvider is at the
// root); re-wrapping ChatView in a fresh ThemeProvider per rerender would push
// a new theme context value and force every MarkdownContent consumer to
// re-render, defeating the React.memo the tail freeze relies on.
let pushState: (s: SessionState) => void = () => {};
function Inner({ initial }: { initial: SessionState }) {
  const [st, setSt] = useState(initial);
  pushState = setSt;
  return <ChatView state={st} toolContext={defaultToolContext} />;
}
function renderChat(initial: SessionState) {
  return render(
    <ThemeProvider>
      <Inner initial={initial} />
    </ThemeProvider>,
  );
}

function getScrollContainer(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-testid='chat-scroll-container']")!;
}

function getTail(container: HTMLElement): HTMLElement | null {
  return container.querySelector(".chat-stream-live");
}

/** Count non-overlapping occurrences of `needle` in an element's textContent. */
function countText(el: HTMLElement | null, needle: string): number {
  const hay = el?.textContent ?? "";
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

async function flushRaf() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** The streaming tail's first rendered text node, or null. */
function tailTextNode(container: HTMLElement): Text | null {
  const tail = getTail(container);
  const p = tail?.querySelector("p") ?? tail;
  return (p?.firstChild as Text | null) ?? null;
}

/** Select the given text node inside the tail and announce a selectionchange. */
function selectNode(textNode: Text): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(textNode);
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

function collapseSelection() {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event("selectionchange"));
}

function userState(streamingText: string): SessionState {
  const s = createInitialState();
  s.messages.push({ id: "u0", role: "user", content: "ask", timestamp: Date.now() });
  s.streamingText = streamingText;
  return s;
}

const PREFIX = "UNIQZPREFIX";

describe("ChatView streaming-tail selection preservation", () => {
  it("2.1 keeps the committed tail nodes stable across a chunk append (buffer + flush)", async () => {
    const { container } = renderChat(userState(`${PREFIX} streaming answer`));
    await flushRaf();

    const textNode = tailTextNode(container);
    expect(textNode).not.toBeNull();
    await act(async () => {
      selectNode(textNode!);
    });
    await flushMicrotasks();

    // A new chunk arrives while the tail selection is held.
    await act(async () => {
      pushState(userState(`${PREFIX} streaming answer with MORE text appended`));
    });
    await flushMicrotasks();

    // Buffered: the tail still shows the frozen snapshot, not the new chunk.
    const tail = getTail(container);
    expect(tail?.textContent).toContain(`${PREFIX} streaming answer`);
    expect(tail?.textContent).not.toContain("MORE text appended");
    // The originally-selected Text node was never replaced, so the selection
    // is still intact (non-collapsed).
    expect(textNode?.isConnected).toBe(true);
    expect(window.getSelection()?.isCollapsed).toBe(false);

    // Collapse → flush to the latest streamed text.
    await act(async () => collapseSelection());
    await flushMicrotasks();
    expect(getTail(container)?.textContent).toContain("MORE text appended");
  });

  it("2.2 preserves a tail selection across turn completion, then reveals the committed twin on collapse", async () => {
    const { container } = renderChat(userState(`${PREFIX} final answer body`));
    await flushRaf();

    const textNode = tailTextNode(container);
    expect(textNode).not.toBeNull();
    await act(async () => {
      selectNode(textNode!);
    });
    await flushMicrotasks();

    // message_end: streamingText cleared, committed assistant twin appended.
    const done = createInitialState();
    done.messages.push({ id: "u0", role: "user", content: "ask", timestamp: Date.now() });
    done.messages.push({
      id: "msg-1",
      role: "assistant",
      content: `${PREFIX} final answer body`,
      timestamp: Date.now(),
    });
    done.streamingText = "";
    await act(async () => {
      pushState(done);
    });
    await flushMicrotasks();
    await flushRaf();

    const scroll = getScrollContainer(container);
    // Frozen tail still mounted; committed twin hidden → text appears exactly
    // once, and the anchored node survived the streaming→committed swap.
    expect(getTail(container)).not.toBeNull();
    expect(textNode?.isConnected).toBe(true);
    expect(countText(scroll, PREFIX)).toBe(1);
    expect(window.getSelection()?.isCollapsed).toBe(false);

    // Collapse: tail unmounts, committed twin is revealed (never dropped).
    await act(async () => collapseSelection());
    await flushMicrotasks();
    await flushRaf();
    expect(getTail(container)).toBeNull();
    expect(countText(getScrollContainer(container), PREFIX)).toBe(1);
  });
});
