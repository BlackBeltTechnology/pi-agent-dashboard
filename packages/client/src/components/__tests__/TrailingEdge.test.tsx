/**
 * Soft trailing edge (tasks 5.1, 5.3, 5.4; test-plan #E30, #E31). jsdom has no
 * layout, so `Range.getClientRects` is stubbed; the real overlay lifecycle is
 * the Playwright F9 scenario.
 * Harness glue copied from `MarkdownContent.test.tsx`.
 * See change: add-fluid-chat-motion (D5).
 */
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { DisplayPrefsProvider } from "../../lib/state/DisplayPrefsContext.js";
import { ChatView } from "../chat/ChatView.js";
import { TrailingEdge } from "../chat/TrailingEdge.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

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
beforeEach(() => {
  // jsdom implements neither Range.getClientRects nor layout.
  Range.prototype.getClientRects = (() => [{ left: 80, right: 120, top: 10, bottom: 24, width: 40, height: 14 }]) as never;
});
afterEach(() => cleanup());

function bubble(html: string, revealing = true, extraStyle = "") {
  return render(
    <div data-testid="host" style={{ position: "relative" }}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: fixed test markup */}
      <div style={{ direction: "ltr" }} dangerouslySetInnerHTML={{ __html: html }} />
      <TrailingEdge text={html} revealing={revealing} />
    </div>,
  );
}
const edge = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="trailing-edge"]')!;

describe("TrailingEdge skips (E30)", () => {
  it("shows for ltr prose", () => {
    const { container } = bubble("<p>hello world</p>");
    expect(edge(container).dataset.edge).toBe("visible");
    expect(edge(container).style.opacity).toBe("1");
    expect(edge(container).getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    ["fenced code", "<p>intro</p><pre><code>const x = 1;</code></pre>"],
    ["mermaid", '<p>intro</p><div class="mermaid">graph TD; A-->B</div>'],
    ["KaTeX", '<p>intro</p><span class="katex">x²</span>'],
    ["inline code", "<p>run <code>npm test</code></p>"],
    ["rtl prose", '<p style="direction: rtl">שלום עולם</p>'],
  ])("is hidden when the reveal point is in %s", (_name, html) => {
    const { container } = bubble(html);
    expect(edge(container).dataset.edge).toBe("hidden");
    expect(edge(container).style.opacity).toBe("0");
  });

  it("fades out (opacity 0) when the backlog is empty", () => {
    const { container, rerender } = bubble("<p>hello</p>", true);
    expect(edge(container).style.opacity).toBe("1");
    rerender(
      <div data-testid="host" style={{ position: "relative" }}>
        <div dangerouslySetInnerHTML={{ __html: "<p>hello</p>" }} />
        <TrailingEdge text="<p>hello</p>" revealing={false} />
      </div>,
    );
    expect(edge(container).style.opacity).toBe("0");
  });

  it("is pointer-transparent and positioned by transform at the reveal point", () => {
    const { container } = bubble("<p>hello</p>");
    expect(edge(container).style.pointerEvents).toBe("none");
    expect(edge(container).style.transform).toContain("translate(");
  });
});

describe("TrailingEdge leaves the markdown DOM untouched (E31)", () => {
  const toolContext: ToolContext = {};
  const TEXT = "See packages/client/src/index.css and https://example.com/docs for details";

  function renderStreaming(chatMotion: boolean) {
    const state = { ...createInitialState(), streamingText: TEXT };
    const global = { ...DISPLAY_PRESETS.standard, chatMotion };
    return render(
      <ThemeProvider>
        <DisplayPrefsProvider value={{ global, getSessionOverride: () => undefined }}>
          <ChatView sessionId="s1" state={state} toolContext={toolContext} replayInFlight={false} />
        </DisplayPrefsProvider>
      </ThemeProvider>,
    );
  }

  it("the markdown subtree innerHTML is identical with the overlay active vs motion off", async () => {
    const on = renderStreaming(true);
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    const bubbleOn = on.container.querySelector<HTMLElement>(".chat-stream-live")!;
    const withOverlay = bubbleOn.querySelector(".markdown-content")!.innerHTML;
    const linksOn = bubbleOn.querySelectorAll("a").length;
    cleanup();

    const off = renderStreaming(false);
    const bubbleOff = off.container.querySelector<HTMLElement>(".chat-stream-live")!;
    expect(bubbleOff.querySelector('[data-testid="trailing-edge"]')).toBeNull();
    expect(bubbleOff.querySelector(".markdown-content")!.innerHTML).toBe(withOverlay);
    expect(bubbleOff.querySelectorAll("a").length).toBe(linksOn);
    expect(linksOn).toBeGreaterThanOrEqual(1); // the URL still renders as a link
  });

  it("no overlay remains after the stream ends", () => {
    const streaming = { ...createInitialState(), streamingText: TEXT };
    const ended = { ...createInitialState(), messages: [{ id: "a1", role: "assistant" as const, content: TEXT, timestamp: 1 }] };
    const global = DISPLAY_PRESETS.standard;
    const tree = (state: typeof streaming) => (
      <ThemeProvider>
        <DisplayPrefsProvider value={{ global, getSessionOverride: () => undefined }}>
          <ChatView sessionId="s1" state={state} toolContext={toolContext} replayInFlight={false} />
        </DisplayPrefsProvider>
      </ThemeProvider>
    );
    const { container, rerender } = render(tree(streaming));
    expect(container.querySelector('[data-testid="trailing-edge"]')).not.toBeNull();
    rerender(tree(ended));
    expect(container.querySelector('[data-testid="trailing-edge"]')).toBeNull();
  });
});
