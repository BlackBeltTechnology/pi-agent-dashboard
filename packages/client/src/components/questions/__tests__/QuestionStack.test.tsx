/**
 * QuestionStack: header pill + panel (test-plan #E16, #E17 component half,
 * #F1 dialog half, #F6 panel half, #F9). See change: add-pending-question-stack.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QuestionStackStore } from "../../../lib/questions/question-store.js";
import { QuestionStack } from "../QuestionStack.js";
import { detail, mockReducedMotion, NOW, row, rows, session } from "./question-fixtures.js";

let store: QuestionStackStore;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  store = new QuestionStackStore();
  mockReducedMotion(false);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: detail({ id: "q1" }) }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderStack(sessions = [session("s-q1")], onOpenSession = vi.fn()) {
  const loc = memoryLocation({ path: "/", record: true });
  render(
    <Router hook={loc.hook}>
      <QuestionStack sessions={sessions} onOpenSession={onOpenSession} store={store} />
    </Router>,
  );
  return { onOpenSession };
}

const publish = (r: ReturnType<typeof rows>) => act(() => store.set(r));
const openPanel = () => fireEvent.click(screen.getByTestId("question-pill"));

describe("pill (E17)", () => {
  it("renders nothing with no open questions", () => {
    renderStack();
    publish([]);
    expect(screen.queryByTestId("question-pill")).toBeNull();
  });

  it.each([
    [1, "1 open question"],
    [3, "3 open questions"],
  ])("%i open → accessible name %s, count shown", (n, name) => {
    renderStack();
    publish(rows(n));
    const pill = screen.getByTestId("question-pill");
    expect(pill.getAttribute("aria-label")).toBe(name);
    expect(pill.textContent).toContain(String(n));
    expect(pill.getAttribute("aria-expanded")).toBe("false");
  });

  it("disappears immediately when the last question is removed", () => {
    renderStack();
    publish(rows(2));
    openPanel();
    expect(screen.getByTestId("question-panel")).toBeTruthy();
    publish([]);
    expect(screen.queryByTestId("question-pill")).toBeNull();
    expect(screen.queryByTestId("question-panel")).toBeNull();
  });

  it("uses theme tokens only (no raw colours)", () => {
    renderStack();
    publish(rows(1));
    const cls = screen.getByTestId("question-pill").className;
    expect(cls).toContain("--tint-purple-");
    expect(cls).not.toMatch(/#[0-9a-f]{3,6}|rgb\(|text-(red|blue|purple)-\d/i);
  });
});

describe("panel list (E16)", () => {
  it.each([
    [5, 5, null],
    [6, 5, "+1 more"],
    [8, 5, "+3 more"],
  ])("%i open → %i rows, more-row %s", (n, shown, more) => {
    renderStack();
    publish(rows(n));
    openPanel();
    expect(screen.getAllByTestId(/^question-row-/)).toHaveLength(shown);
    if (more) expect(screen.getByTestId("question-more").textContent).toContain(more);
    else expect(screen.queryByTestId("question-more")).toBeNull();
  });

  it("expanding shows all rows in a list capped at 60vh", () => {
    renderStack();
    publish(rows(8));
    openPanel();
    expect(screen.getByTestId("question-list").style.maxHeight).toBe("");
    fireEvent.click(screen.getByTestId("question-more"));
    expect(screen.getAllByTestId(/^question-row-/)).toHaveLength(8);
    expect(screen.getByTestId("question-list").style.maxHeight).toBe("60vh");
    expect(screen.queryByTestId("question-more")).toBeNull();
  });

  it("lists newest first", () => {
    renderStack();
    publish(rows(3));
    openPanel();
    const ids = screen.getAllByTestId(/^question-row-/).map((e) => e.getAttribute("data-testid"));
    expect(ids).toEqual(["question-row-q3", "question-row-q2", "question-row-q1"]);
  });

  it("row shows label, change, preview ≤140, age and origin marker", () => {
    renderStack();
    publish([
      row({ id: "a", sessionLabel: "Alpha", changeName: "add-thing", preview: "x".repeat(200), askedAt: NOW - 180_000 }),
      row({ id: "b", origin: "file", askedAt: NOW - 240_000 }),
      row({ id: "c", origin: "chat-gateway", askedAt: NOW - 300_000 }),
      row({ id: "d", origin: "widget-bar", askedAt: NOW - 360_000 }),
    ]);
    openPanel();
    const a = screen.getByTestId("question-row-a");
    expect(a.textContent).toContain("Alpha");
    expect(a.textContent).toContain("add-thing");
    expect(a.textContent).toContain("3m");
    expect(within(a).getByTestId("question-preview").textContent?.length).toBeLessThanOrEqual(140);
    expect(screen.getByTestId("question-row-b").textContent).toContain("File access");
    expect(screen.getByTestId("question-row-c").textContent).toContain("Chat gateway");
    expect(screen.getByTestId("question-row-d").textContent).toContain("Flow slot");
    expect(a.textContent).not.toContain("File access");
  });

  it("shows the route hint per visibility: Go to session vs Answer here", () => {
    renderStack([session("s-vis"), session("s-hid", { hidden: true })]);
    publish([row({ id: "v", sessionId: "s-vis" }), row({ id: "h", sessionId: "s-hid" })]);
    openPanel();
    expect(screen.getByTestId("question-row-v").textContent).toContain("Go to session");
    expect(screen.getByTestId("question-row-h").textContent).toContain("Answer here");
  });

  it("flags a row whose brief is still being generated", () => {
    renderStack();
    publish([row({ id: "p", briefStatus: "pending" })]);
    openPanel();
    expect(screen.getByTestId("question-row-p").textContent).toContain("Summarizing");
  });
});

describe("activation (F1)", () => {
  it("visible session: opens the session, closes the panel, no dialog", () => {
    const { onOpenSession } = renderStack([session("s-a")]);
    publish([row({ id: "a", sessionId: "s-a" })]);
    openPanel();
    fireEvent.click(screen.getByTestId("question-row-a"));
    expect(onOpenSession).toHaveBeenCalledWith("s-a");
    expect(screen.queryByTestId("question-dialog")).toBeNull();
    expect(screen.queryByTestId("question-panel")).toBeNull();
  });

  it("hidden automation session: opens the dialog, does not navigate", async () => {
    const hidden = session("s-a", { kind: "automation", automationRun: { name: "n", runId: "r", visibility: "hidden" } });
    const { onOpenSession } = renderStack([hidden]);
    publish([row({ id: "q1", sessionId: "s-a", sessionLabel: "Nightly run" })]);
    openPanel();
    fireEvent.click(screen.getByTestId("question-row-q1"));
    // Lazy chunk + fake timers: preload the module so Suspense resolves inside act.
    await act(async () => {
      await import("../QuestionDialog.js");
    });
    expect(screen.getByTestId("question-dialog")).toBeTruthy();
    expect(onOpenSession).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it("a session missing from the board (headless) opens the dialog", async () => {
    renderStack([]);
    publish([row({ id: "q1", sessionId: "gone" })]);
    openPanel();
    fireEvent.click(screen.getByTestId("question-row-q1"));
    // Lazy chunk + fake timers: preload the module so Suspense resolves inside act.
    await act(async () => {
      await import("../QuestionDialog.js");
    });
    expect(screen.getByTestId("question-dialog")).toBeTruthy();
    await act(async () => {});
  });
});

describe("keyboard (F6, panel half)", () => {
  it("Esc closes the panel and returns focus to the pill", () => {
    renderStack();
    publish(rows(2));
    openPanel();
    expect(screen.getByTestId("question-pill").getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("question-panel")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("question-pill"));
  });

  it("pill is controlled-disclosure wired: aria-controls → panel id", () => {
    renderStack();
    publish(rows(1));
    openPanel();
    const panel = screen.getByTestId("question-panel");
    expect(screen.getByTestId("question-pill").getAttribute("aria-controls")).toBe(panel.id);
  });
});

describe("new-arrival ring (F9)", () => {
  it("applies `arrive` once on a new question; the next unrelated update does not re-apply it", () => {
    renderStack();
    publish([]);
    publish([row({ id: "a" })]);
    expect(screen.getByTestId("question-pill").className).toContain("arrive");
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.getByTestId("question-pill").className).not.toContain("arrive");
    publish([row({ id: "a", briefStatus: "ready" })]);
    expect(screen.getByTestId("question-pill").className).not.toContain("arrive");
  });

  it("does not animate questions that were already open on the first frame", () => {
    renderStack();
    publish([row({ id: "a" })]);
    expect(screen.getByTestId("question-pill").className).not.toContain("arrive");
  });

  it("prefers-reduced-motion: reduce → never applied", () => {
    mockReducedMotion(true);
    renderStack();
    publish([]);
    publish([row({ id: "a" })]);
    expect(screen.getByTestId("question-pill").className).not.toContain("arrive");
  });
});
