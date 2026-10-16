/**
 * ChatViewMenu redesign: pinned footer (Reset / Set as global), open toward
 * the side with more room, phone bottom sheet.
 * See change: os-add-set-global-view.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatViewMenu } from "../chat/ChatViewMenu.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 600, right: 700, width: 100, height: bottom - top, x: 600, y: top, toJSON: () => ({}) } as DOMRect;
}

function open(override: Record<string, unknown> | undefined = { reasoning: false }) {
  const send = vi.fn();
  render(<ChatViewMenu sessionId="s1" send={send} currentOverride={override as never} />);
  fireEvent.click(screen.getByText("View"));
  return { send };
}

describe("ChatViewMenu footer", () => {
  it("pins the footer outside the scrolling list", () => {
    open();
    const list = screen.getByTestId("chat-view-list");
    const footer = screen.getByTestId("chat-view-footer");
    expect(list.className).toContain("overflow-y-auto");
    expect(list.contains(footer)).toBe(false);
    expect(screen.getByTestId("chat-view-popover").contains(footer)).toBe(true);
  });

  it("Reset clears the session override", () => {
    const { send } = open();
    fireEvent.click(screen.getByTestId("chat-view-reset"));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "setSessionDisplayPrefs", override: null }));
  });

  it("disables Reset and Set as global without an override", () => {
    open({});
    expect((screen.getByTestId("chat-view-reset") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("chat-view-set-global") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Set as global PATCHes the effective prefs then clears the override", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const { send } = open({ reasoning: false });
    fireEvent.click(screen.getByTestId("chat-view-set-global"));
    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ override: null })));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/preferences/display");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body).reasoning).toBe(false);
  });

  it("keeps the override when the global PATCH fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { send } = open({ reasoning: false });
    fireEvent.click(screen.getByTestId("chat-view-set-global"));
    await waitFor(() => expect(screen.getByTestId("chat-view-set-global-error")).toBeTruthy());
    expect(send).not.toHaveBeenCalled();
  });
});

describe("ChatViewMenu placement", () => {
  it("opens upward when more room is above, even with >200px below", () => {
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true, writable: true });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(rect(700, 730));
    open();
    expect(screen.getByTestId("chat-view-popover").className).toContain("bottom-full");
  });

  it("never scrolls sideways: the list clips x and the notify select can shrink", () => {
    open();
    expect(screen.getByTestId("chat-view-list").className).toContain("overflow-x-hidden");
    expect(screen.getByTestId("notify-min-level").className).toMatch(/(^| )min-w-0( |$)/);
  });

  it("renders as a bottom sheet with a scrim on phones", () => {
    open();
    expect(screen.getByTestId("chat-view-popover").className).toContain("max-sm:fixed");
    expect(screen.getByTestId("chat-view-scrim").className).toContain("sm:hidden");
  });
});
