import { act, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatImage, createInitialState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const defaultToolContext: ToolContext = {};

// 1×1 transparent PNG.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function img(): ChatImage {
  return { data: PNG_1x1, mimeType: "image/png" };
}

function stateWithUserImages(images: ChatImage[]) {
  const state = createInitialState();
  state.messages.push({
    id: "u-img",
    role: "user",
    content: "here is an image",
    images,
    timestamp: Date.now(),
  });
  return state;
}

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

describe("ChatView image-row re-measure", () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Deferred rAF: capture callbacks so we control flush timing and can count
    // how many measure passes were scheduled.
    rafSpy = vi.spyOn(window, "requestAnimationFrame");
  });

  afterEach(() => {
    rafSpy.mockRestore();
  });

  it("requests a virtual-row re-measure when an attached image finishes decoding", () => {
    const state = stateWithUserImages([img()]);
    const { container } = render(
      <ThemeProvider>
        <ChatView sessionId="s1" state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const image = container.querySelector("img");
    expect(image).not.toBeNull();

    rafSpy.mockClear();
    act(() => {
      image?.dispatchEvent(new Event("load"));
    });

    // The onLoad handler must schedule exactly one coalesced re-measure frame.
    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it("coalesces multiple images in one row to a single re-measure per frame", () => {
    const state = stateWithUserImages([img(), img(), img()]);
    const { container } = render(
      <ThemeProvider>
        <ChatView sessionId="s1" state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const images = container.querySelectorAll("img");
    expect(images.length).toBe(3);

    rafSpy.mockClear();
    act(() => {
      for (const el of images) el.dispatchEvent(new Event("load"));
    });

    // Three decodes in the same frame → at most one scheduled measure pass.
    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a re-measure when an image fails to decode (onError)", () => {
    // Only onLoad drives the re-measure; a broken data-URL fires onError and
    // must NOT schedule a measure pass (the reserved loading box keeps the row
    // bounded, so nothing collapses). Guards against wiring onError by mistake.
    const state = stateWithUserImages([img()]);
    const { container } = render(
      <ThemeProvider>
        <ChatView sessionId="s1" state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const image = container.querySelector("img");
    expect(image).not.toBeNull();

    rafSpy.mockClear();
    act(() => {
      image?.dispatchEvent(new Event("error"));
    });

    expect(rafSpy).not.toHaveBeenCalled();
  });
});
