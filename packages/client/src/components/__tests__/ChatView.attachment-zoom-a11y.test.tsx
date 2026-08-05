/**
 * Keyboard + assistive-tech path to the attachment zoom.
 *
 * The thumbnail carried `onClick` on a bare `<img>`, which is reachable by
 * mouse only: no tab stop, no Enter/Space, nothing for a screen reader to
 * announce as actionable. Click-to-zoom is the ONLY way to reach the
 * full-resolution original, so keyboard users had no path to it at all.
 *
 * The fix is a real `<button>` rather than `tabIndex` + an `onKeyDown` that
 * re-implements activation. These tests therefore assert the ELEMENT, not
 * synthesized key events: Enter/Space activation is the browser's contract for
 * a native button, and jsdom does not synthesize it — a `fireEvent.keyDown`
 * assertion here would pass on a div with a hand-rolled handler and prove
 * nothing about real AT behaviour.
 *
 * See change: fit-attachments-for-display (CodeRabbit round 2, a11y).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type ChatImage, createInitialState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function stateWithImages(images: ChatImage[]) {
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

function renderChat(images: ChatImage[]) {
  return render(
    <ThemeProvider>
      <ChatView sessionId="s1" state={stateWithImages(images)} toolContext={{} as ToolContext} />
    </ThemeProvider>,
  );
}

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe("attachment zoom accessibility", () => {
  it("exposes the thumbnail as a NATIVE button, so Enter/Space work for free", () => {
    renderChat([{ data: PNG_1x1, mimeType: "image/png" }]);

    const trigger = screen.getByRole("button", { name: /zoom attachment 1/i });
    // A real <button>: focusable in tab order and activated by Enter/Space by
    // the user agent. `role="button"` on a div would satisfy the query above
    // while still being dead to the keyboard, so assert the tag itself.
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("type")).toBe("button"); // never submits a form
  });

  it("keeps the image inside the control and out of the a11y tree", () => {
    renderChat([{ data: PNG_1x1, mimeType: "image/png" }]);

    const trigger = screen.getByRole("button", { name: /zoom attachment 1/i });
    const image = trigger.querySelector("[data-testid='attachment-image']");
    expect(image).not.toBeNull();
    // The button carries the accessible name; the img must not announce a
    // second, competing one. AT should hear one actionable thing, not two.
    expect(image?.getAttribute("alt")).toBe("");
  });

  it("is reachable by keyboard focus", () => {
    renderChat([{ data: PNG_1x1, mimeType: "image/png" }]);

    const trigger = screen.getByRole("button", { name: /zoom attachment 1/i });
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);
  });

  it("still opens the lightbox on click", () => {
    renderChat([{ data: PNG_1x1, mimeType: "image/png" }]);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /zoom attachment 1/i }));
    });
    expect(screen.getByTestId("lightbox-image")).toBeTruthy();
  });

  it("gives each attachment in a row its own distinguishable control", () => {
    renderChat([
      { data: PNG_1x1, mimeType: "image/png" },
      { data: PNG_1x1, mimeType: "image/png" },
    ]);

    // Names must differ, or a screen-reader user hears "zoom attachment"
    // twice with no way to tell which is which.
    expect(screen.getByRole("button", { name: /zoom attachment 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /zoom attachment 2/i })).toBeTruthy();
  });
});
