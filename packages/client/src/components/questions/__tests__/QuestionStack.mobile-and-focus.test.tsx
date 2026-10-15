/**
 * Mobile tier (bottom sheet, full-screen dialog, 44×44 pill) and dialog focus
 * return (test-plan #F6 dialog half, #F7 component half).
 * See change: add-pending-question-stack.
 */
import { MobileProvider } from "@blackbelt-technology/pi-dashboard-client-utils/useMobile";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QuestionStackStore } from "../../../lib/questions/question-store.js";
import { QuestionStack } from "../QuestionStack.js";
import { detail, row, rows, session } from "./question-fixtures.js";

function mockMedia(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("max-width") ? mobile : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
}

let store: QuestionStackStore;
beforeEach(() => {
  store = new QuestionStackStore();
  vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: detail({ id: "q1" }) }) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(sessions = [session("s-q1"), session("s-q2")], onOpenSession = vi.fn()) {
  const loc = memoryLocation({ path: "/", record: true });
  render(
    <Router hook={loc.hook}>
      <MobileProvider>
        <QuestionStack sessions={sessions} onOpenSession={onOpenSession} store={store} />
      </MobileProvider>
    </Router>,
  );
}

describe("mobile tier", () => {
  it("pill keeps a ≥44×44 touch target and the list opens as a bottom sheet", () => {
    mockMedia(true);
    mount();
    act(() => store.set(rows(2)));
    const pill = screen.getByTestId("question-pill");
    expect(pill.className).toContain("min-h-[44px]");
    expect(pill.className).toContain("min-w-[44px]");
    fireEvent.click(pill);
    const panel = screen.getByTestId("question-panel");
    expect(panel.getAttribute("data-variant")).toBe("sheet");
    expect(panel.style.maxHeight).toBe("80vh");
    expect(panel.className).toContain("bottom-0");
    expect(screen.getAllByTestId(/^question-row-/)).toHaveLength(2);
    for (const r of screen.getAllByTestId(/^question-row-/)) expect(r.className).toContain("min-h-[44px]");
  });

  it("closed state renders nothing over the composer (no scrim, no panel)", () => {
    mockMedia(true);
    mount();
    act(() => store.set(rows(2)));
    expect(screen.queryByTestId("question-panel")).toBeNull();
    expect(screen.queryByTestId("question-sheet-scrim")).toBeNull();
  });

  it("the dialog is full screen (no centred card, no scrim)", async () => {
    mockMedia(true);
    mount([]);
    act(() => store.set([row({ id: "q1", sessionId: "headless" })]));
    fireEvent.click(screen.getByTestId("question-pill"));
    fireEvent.click(screen.getByTestId("question-row-q1"));
    // The dialog is a lazy chunk (kept off the entry bundle): wait for it.
    await screen.findByTestId("question-dialog");
    const dlg = screen.getByTestId("question-dialog");
    expect(dlg.className).toContain("h-full");
    expect(dlg.className).toContain("w-full");
    expect(screen.queryByTestId("question-dialog-overlay")).toBeNull();
  });

  it("desktop: dropdown variant, no scrim", () => {
    mockMedia(false);
    mount();
    act(() => store.set(rows(2)));
    fireEvent.click(screen.getByTestId("question-pill"));
    expect(screen.getByTestId("question-panel").getAttribute("data-variant")).toBe("dropdown");
    expect(screen.queryByTestId("question-sheet-scrim")).toBeNull();
  });
});

describe("dialog focus return (F6)", () => {
  it("Esc closes the dialog and focus lands on the pill", async () => {
    mockMedia(false);
    mount([]);
    act(() => store.set([row({ id: "q1", sessionId: "headless" }), row({ id: "q2", sessionId: "headless" })]));
    fireEvent.click(screen.getByTestId("question-pill"));
    fireEvent.click(screen.getByTestId("question-row-q1"));
    // The dialog is a lazy chunk (kept off the entry bundle): wait for it.
    await screen.findByTestId("question-dialog");
    expect(screen.getByTestId("question-dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("question-dialog"), { key: "Escape" });
    expect(screen.queryByTestId("question-dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("question-pill"));
  });

  it("'Later' also returns focus to the pill", async () => {
    mockMedia(false);
    mount([]);
    act(() => store.set([row({ id: "q1", sessionId: "headless" }), row({ id: "q2", sessionId: "headless" })]));
    fireEvent.click(screen.getByTestId("question-pill"));
    fireEvent.click(screen.getByTestId("question-row-q1"));
    // The dialog is a lazy chunk (kept off the entry bundle): wait for it.
    await screen.findByTestId("question-dialog");
    fireEvent.click(screen.getByTestId("question-later"));
    expect(document.activeElement).toBe(screen.getByTestId("question-pill"));
  });

  it("the dialog turns into 'already answered' when its row leaves the stack", async () => {
    mockMedia(false);
    mount([]);
    act(() => store.set([row({ id: "q1", sessionId: "headless" }), row({ id: "q2", sessionId: "headless" })]));
    fireEvent.click(screen.getByTestId("question-pill"));
    fireEvent.click(screen.getByTestId("question-row-q1"));
    // The dialog is a lazy chunk (kept off the entry bundle): wait for it.
    await screen.findByTestId("question-dialog");
    act(() => store.set([row({ id: "q2", sessionId: "headless" })]));
    expect(screen.getByTestId("question-answered")).toBeTruthy();
  });

  it("the dialog survives the LAST question leaving (shows already answered, stays closable)", async () => {
    mockMedia(false);
    mount([]);
    act(() => store.set([row({ id: "q1", sessionId: "headless" })]));
    fireEvent.click(screen.getByTestId("question-pill"));
    fireEvent.click(screen.getByTestId("question-row-q1"));
    // The dialog is a lazy chunk (kept off the entry bundle): wait for it.
    await screen.findByTestId("question-dialog");
    act(() => store.set([]));
    expect(screen.getByTestId("question-answered")).toBeTruthy();
    fireEvent.click(screen.getByTestId("question-later"));
    expect(screen.queryByTestId("question-dialog")).toBeNull();
  });
});
