/**
 * Routing by visibility (test-plan #F1). See change: add-pending-question-stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { row, session } from "../../../components/questions/__tests__/question-fixtures.js";
import { decideQuestionRoute, routeQuestion } from "../route-question.js";

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function deps(s: ReturnType<typeof session> | undefined) {
  return { session: s, openSession: vi.fn(), openDialog: vi.fn() };
}

describe("decideQuestionRoute", () => {
  it("visible chat prompt → chat; visible widget-bar → slot", () => {
    expect(decideQuestionRoute(row({ id: "a" }), session("s-a"))).toBe("chat");
    expect(decideQuestionRoute(row({ id: "a", origin: "widget-bar" }), session("s-a"))).toBe("slot");
  });

  it("hidden, automation-hidden and unknown sessions → dialog", () => {
    expect(decideQuestionRoute(row({ id: "a" }), session("s-a", { hidden: true }))).toBe("dialog");
    expect(
      decideQuestionRoute(row({ id: "a" }), session("s-a", { kind: "automation", automationRun: { name: "n", runId: "r", visibility: "hidden" } })),
    ).toBe("dialog");
    expect(decideQuestionRoute(row({ id: "a" }), undefined)).toBe("dialog");
  });

  it("an automation run shown on the board is visible", () => {
    expect(
      decideQuestionRoute(row({ id: "a" }), session("s-a", { kind: "automation", automationRun: { name: "n", runId: "r", visibility: "shown" } })),
    ).toBe("chat");
  });
});

describe("routeQuestion", () => {
  it("chat prompt: selects the session, scrolls the pending ask into view, no dialog", () => {
    const ask = document.createElement("div");
    ask.setAttribute("data-pending-ask", "");
    ask.scrollIntoView = vi.fn();
    document.body.append(ask);
    const d = deps(session("s-a"));
    expect(routeQuestion(row({ id: "a" }), d)).toBe("chat");
    expect(d.openSession).toHaveBeenCalledWith("s-a");
    expect(d.openDialog).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(ask.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(ask);
  });

  it("waits for the chat to mount before scrolling", () => {
    const d = deps(session("s-a"));
    routeQuestion(row({ id: "a" }), d);
    vi.advanceTimersByTime(500);
    const panel = document.createElement("div");
    panel.setAttribute("data-testid", "multi-ask-panel");
    panel.scrollIntoView = vi.fn();
    document.body.append(panel);
    vi.advanceTimersByTime(150);
    expect(panel.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("widget-bar prompt: focuses the owning slot, never the chat prompt", () => {
    const slot = document.createElement("div");
    slot.setAttribute("data-widget-bar-slot", "");
    slot.scrollIntoView = vi.fn();
    const ask = document.createElement("div");
    ask.setAttribute("data-pending-ask", "");
    ask.scrollIntoView = vi.fn();
    document.body.append(slot, ask);
    const d = deps(session("s-a"));
    expect(routeQuestion(row({ id: "a", origin: "widget-bar" }), d)).toBe("slot");
    vi.advanceTimersByTime(150);
    expect(d.openSession).toHaveBeenCalledWith("s-a");
    expect(slot.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(slot);
    expect(ask.scrollIntoView).not.toHaveBeenCalled();
  });

  it("hidden automation: opens the dialog, does not select", () => {
    const d = deps(session("s-a", { kind: "automation", automationRun: { name: "n", runId: "r" } }));
    const r = row({ id: "a" });
    expect(routeQuestion(r, d)).toBe("dialog");
    expect(d.openDialog).toHaveBeenCalledWith(r);
    expect(d.openSession).not.toHaveBeenCalled();
  });
});
