import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/event-reducer.js";
import { ChatView } from "../ChatView.js";
import { ThemeProvider } from "../ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const toolContext: ToolContext = { editors: [] };

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function scrollEl(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-testid='chat-scroll-container']")!;
}

function atTop(el: HTMLElement): void {
  Object.defineProperty(el, "scrollTop", { value: 0, writable: true, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: 1000, writable: true, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 400, writable: true, configurable: true });
  fireEvent.scroll(el);
}

function view(props: Partial<React.ComponentProps<typeof ChatView>> = {}) {
  return (
    <ThemeProvider>
      <ChatView sessionId="s1" state={createInitialState()} toolContext={toolContext} {...props} />
    </ThemeProvider>
  );
}

describe("ChatView tail-first history pagination", () => {
  it("requests older history near the top only while available and not in flight", () => {
    const onLoadOlder = vi.fn();
    const rendered = render(view({ hasOlder: true, loadingOlder: false, onLoadOlder }));
    atTop(scrollEl(rendered.container));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    expect(onLoadOlder).toHaveBeenCalledWith("s1");

    rendered.rerender(view({ hasOlder: true, loadingOlder: true, onLoadOlder }));
    atTop(scrollEl(rendered.container));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    rendered.rerender(view({ hasOlder: false, loadingOlder: false, onLoadOlder }));
    atTop(scrollEl(rendered.container));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("renders the slim loading-older row only while a page is in flight", () => {
    const rendered = render(view({ hasOlder: true, loadingOlder: true }));
    expect(rendered.container.querySelector("[data-testid='chat-loading-older']")).not.toBeNull();

    rendered.rerender(view({ hasOlder: true, loadingOlder: false }));
    expect(rendered.container.querySelector("[data-testid='chat-loading-older']")).toBeNull();
  });
});
