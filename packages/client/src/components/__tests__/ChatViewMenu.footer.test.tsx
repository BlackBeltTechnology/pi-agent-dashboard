/**
 * ChatViewMenu redesign: pinned footer (Reset / Set as global), open toward
 * the side with more room, phone bottom sheet.
 * See change: os-add-set-global-view.
 */

import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayPrefsProvider } from "../../lib/state/DisplayPrefsContext.js";
import { ChatViewMenu } from "../chat/ChatViewMenu.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 600, right: 700, width: 100, height: bottom - top, x: 600, y: top, toJSON: () => ({}) } as DOMRect;
}

const G = DISPLAY_PRESETS.standard;
/** An override that genuinely differs from the global baseline. */
const CHANGED = { reasoning: !G.reasoning };

function open(override: Record<string, unknown> | undefined = CHANGED) {
  const send = vi.fn();
  render(
    <DisplayPrefsProvider value={{ global: G, getSessionOverride: () => override as never }}>
      <ChatViewMenu sessionId="s1" send={send} currentOverride={override as never} />
    </DisplayPrefsProvider>,
  );
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
    const { send } = open(CHANGED);
    fireEvent.click(screen.getByTestId("chat-view-set-global"));
    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ override: null })));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/preferences/display");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body).reasoning).toBe(!G.reasoning);
  });

  it("locks rows and actions while Set as global is pending", async () => {
    let resolve!: (v: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
    vi.stubGlobal("fetch", fetchMock);
    const { send } = open(CHANGED);
    fireEvent.click(screen.getByTestId("chat-view-set-global"));
    const setGlobal = screen.getByTestId("chat-view-set-global") as HTMLButtonElement;
    await waitFor(() => expect(setGlobal.disabled).toBe(true));
    expect((screen.getByTestId("chat-view-reset") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("chat-view-rows") as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.click(setGlobal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve({ ok: true });
    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ override: null })));
  });

  it("keeps the override when the global PATCH fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { send } = open(CHANGED);
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

describe("ChatViewMenu changed count matches the row dots", () => {
  function openWithGlobal(override: Record<string, unknown>) {
    render(
      <DisplayPrefsProvider value={{ global: DISPLAY_PRESETS.standard, getSessionOverride: () => override as never }}>
        <ChatViewMenu sessionId="s1" send={vi.fn()} currentOverride={override as never} />
      </DisplayPrefsProvider>,
    );
    fireEvent.click(screen.getByText("View"));
  }

  it("does not count a value toggled back to the global value", () => {
    const g = DISPLAY_PRESETS.standard;
    openWithGlobal({ reasoning: g.reasoning, toolCalls: { bash: g.toolCalls.bash } });
    expect(screen.getByTestId("chat-view-footer").textContent).not.toMatch(/changed/);
    expect(screen.queryByTestId("chat-view-modified-pill")).toBeNull();
  });

  it("counts only values that differ from global", () => {
    const g = DISPLAY_PRESETS.standard;
    openWithGlobal({ reasoning: !g.reasoning, debugTools: g.debugTools, toolCalls: { bash: !g.toolCalls.bash } });
    expect(screen.getByTestId("chat-view-footer").textContent).toMatch(/2 changed/);
    expect(screen.getByTestId("chat-view-modified-pill")).toBeTruthy();
  });
});

describe("ChatViewMenu actions follow the changed count", () => {
  it("disables Reset and Set as global when every override equals global", () => {
    const g = DISPLAY_PRESETS.standard;
    const override = { reasoning: g.reasoning };
    render(
      <DisplayPrefsProvider value={{ global: g, getSessionOverride: () => override as never }}>
        <ChatViewMenu sessionId="s1" send={vi.fn()} currentOverride={override as never} />
      </DisplayPrefsProvider>,
    );
    fireEvent.click(screen.getByText("View"));
    expect((screen.getByTestId("chat-view-reset") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("chat-view-set-global") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("ChatViewMenu baseline before first launch", () => {
  it("compares against DISPLAY_PRESETS.standard when global is unset", () => {
    const override = { reasoning: !G.reasoning };
    render(
      <DisplayPrefsProvider value={{ global: undefined, getSessionOverride: () => override as never }}>
        <ChatViewMenu sessionId="s1" send={vi.fn()} currentOverride={override as never} />
      </DisplayPrefsProvider>,
    );
    fireEvent.click(screen.getByText("View"));
    expect(screen.getByTestId("chat-view-footer").textContent).toMatch(/1 changed/);
    expect((screen.getByTestId("chat-view-reset") as HTMLButtonElement).disabled).toBe(false);
  });
});
