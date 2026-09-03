/**
 * Grouped multi-ask panel: concurrently-pending free-floating asks render as
 * one stack of independently-answerable cards; tool-paired asks stay inline;
 * a `method:"batch"` entry renders as its wizard in one slot.
 *
 * Panel rendering (C1, C2, C4, C5, C6) is exercised against `MultiAskPanel`
 * directly. The free-floating derivation that decides panel-vs-inline placement
 * (C3) is exercised against `derivePendingFreeFloating`, the pure helper
 * ChatView feeds the panel.
 *
 * Covers test-plan C1–C6 (surface-concurrent-ask-user-prompts) and the
 * characterisation rows E1–E8 + F1–F4 of harden-multi-ask-panel, which pin the
 * placement decision table (¬tcid×¬wb / tcid×¬wb / ¬tcid×wb / tcid×wb), the
 * always-panel rule, and pending-set placement stability.
 *
 * See change: surface-concurrent-ask-user-prompts, harden-multi-ask-panel.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MultiAskPanel } from "../components/chat/MultiAskPanel.js";
import { ThemeProvider } from "../components/settings/ThemeProvider.js";
import type { ChatMessage, InteractiveUiRequest } from "../lib/chat/event-reducer.js";
import { derivePendingFreeFloating } from "../lib/chat/pending-free-floating.js";

afterEach(() => cleanup());

beforeEach(() => {
  // jsdom lacks matchMedia; ThemeProvider reads it on mount.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

function renderPanel(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function confirmReq(id: string, title: string, message: string): InteractiveUiRequest {
  return { requestId: id, method: "confirm", params: { title, message }, status: "pending" };
}

function uiRow(id: string, toolCallId?: string, method = "confirm"): ChatMessage {
  return {
    id: `ui-${id}`,
    role: "interactiveUi",
    content: method,
    timestamp: 0,
    ...(toolCallId ? { toolCallId } : {}),
    args: { requestId: id, method, params: {}, status: "pending" },
  } as ChatMessage;
}

function inputReq(id: string, title: string): InteractiveUiRequest {
  return { requestId: id, method: "input", params: { title }, status: "pending" };
}

describe("MultiAskPanel — grouped concurrent asks", () => {
  it("C1 two free-floating confirms group into one panel with two cards", () => {
    const { getAllByTestId, getByTestId } = renderPanel(
      <MultiAskPanel
        requests={[confirmReq("p1", "Update global roles?", "Set A"), confirmReq("p2", "Update global roles?", "Set B")]}
        onRespondToUi={vi.fn()}
      />,
    );
    expect(getByTestId("multi-ask-panel")).toBeTruthy();
    expect(getByTestId("multi-ask-card-p1")).toBeTruthy();
    expect(getByTestId("multi-ask-card-p2")).toBeTruthy();
    // Both cards render (one per pending ask).
    expect(getAllByTestId(/^multi-ask-card-/)).toHaveLength(2);
  });

  it("C2 answering a card resolves its own requestId only", () => {
    const onRespond = vi.fn();
    const { getByTestId } = renderPanel(
      <MultiAskPanel
        requests={[confirmReq("p1", "Q1", "A"), confirmReq("p2", "Q2", "B")]}
        onRespondToUi={onRespond}
      />,
    );
    const p2Card = getByTestId("multi-ask-card-p2");
    const yes = p2Card.querySelector("button")!;
    fireEvent.click(yes);
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond.mock.calls[0][0]).toBe("p2");
    // Covers test-plan #F4 (harden-multi-ask-panel): answering one card
    // resolves only its own id.
  });

  it("C2b cancelling a card resolves its own requestId with cancelled=true only", () => {
    const onRespond = vi.fn();
    const { getByTestId } = renderPanel(
      <MultiAskPanel
        requests={[confirmReq("p1", "Q1", "A"), confirmReq("p2", "Q2", "B")]}
        onRespondToUi={onRespond}
      />,
    );
    // ConfirmRenderer buttons: [Yes, No, Cancel] — Cancel is the third.
    const p2Buttons = getByTestId("multi-ask-card-p2").querySelectorAll("button");
    fireEvent.click(p2Buttons[p2Buttons.length - 1]);
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond.mock.calls[0]).toEqual(["p2", undefined, true]);
  });

  it("C4 late arrival appends a card to the stack", () => {
    const { rerender, getAllByTestId, getByTestId } = renderPanel(
      <MultiAskPanel requests={[confirmReq("p1", "Q1", "A")]} onRespondToUi={vi.fn()} />,
    );
    expect(getAllByTestId(/^multi-ask-card-/)).toHaveLength(1);
    rerender(
      <ThemeProvider>
        <MultiAskPanel
          requests={[confirmReq("p1", "Q1", "A"), confirmReq("p2", "Q2", "B")]}
          onRespondToUi={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(getAllByTestId(/^multi-ask-card-/)).toHaveLength(2);
    // Covers test-plan #F1 (harden-multi-ask-panel): the incumbent p1 is still
    // present — the late arrival appended without disturbing it.
    expect(getByTestId("multi-ask-card-p1")).toBeTruthy();
  });

  // Covers test-plan #E7 (harden-multi-ask-panel): the n=0 always-panel
  // boundary.
  it("C5 empty set hides the panel", () => {
    const { queryByTestId } = renderPanel(<MultiAskPanel requests={[]} onRespondToUi={vi.fn()} />);
    expect(queryByTestId("multi-ask-panel")).toBeNull();
  });

  it("C6 a batch entry renders as its wizard alongside a confirm card", () => {
    const batch: InteractiveUiRequest = {
      requestId: "pb",
      method: "batch",
      params: { title: "Batch", questions: [{ type: "confirm", question: "Go?" }] },
      status: "pending",
    };
    const { getByTestId, getByText } = renderPanel(
      <MultiAskPanel requests={[batch, confirmReq("p1", "Plain", "A")]} onRespondToUi={vi.fn()} />,
    );
    // Batch wizard slot + plain confirm slot coexist.
    expect(getByTestId("multi-ask-card-pb")).toBeTruthy();
    expect(getByTestId("multi-ask-card-p1")).toBeTruthy();
    // BatchRenderer shows its stepper header ("Question 1 of 1").
    expect(getByText(/Question 1 of 1/)).toBeTruthy();
  });

  // Covers test-plan #E6 (harden-multi-ask-panel): the n=1 always-panel
  // boundary — a single pending ask is a one-card panel, not inline.
  it("E6 a single pending ask renders a one-card panel", () => {
    const { getByTestId, getAllByTestId } = renderPanel(
      <MultiAskPanel requests={[confirmReq("p1", "Q1", "A")]} onRespondToUi={vi.fn()} />,
    );
    expect(getByTestId("multi-ask-panel")).toBeTruthy();
    expect(getAllByTestId(/^multi-ask-card-/)).toHaveLength(1);
    expect(getByTestId("multi-ask-card-p1")).toBeTruthy();
  });

  // Covers test-plan #F2 (harden-multi-ask-panel): drain 2→0 hides the panel.
  it("F2 draining to empty hides the panel", () => {
    const { rerender, queryByTestId } = renderPanel(
      <MultiAskPanel
        requests={[confirmReq("p1", "Q1", "A"), confirmReq("p2", "Q2", "B")]}
        onRespondToUi={vi.fn()}
      />,
    );
    rerender(<ThemeProvider><MultiAskPanel requests={[]} onRespondToUi={vi.fn()} /></ThemeProvider>);
    expect(queryByTestId("multi-ask-panel")).toBeNull();
  });

  // Covers test-plan #F3 (harden-multi-ask-panel): placement is stable with
  // respect to the pending set — a sibling arrival must NOT remount the card,
  // which would discard the typed value. Falsifies any future "panel only
  // when 2+" grouping rule.
  it("F3 a sibling ask arriving does not remount the incumbent card", () => {
    const { rerender, getByTestId } = renderPanel(
      <MultiAskPanel requests={[inputReq("p1", "Your name?")]} onRespondToUi={vi.fn()} />,
    );
    const typeInto = () => getByTestId("multi-ask-card-p1").querySelector("textarea")!;
    fireEvent.change(typeInto(), { target: { value: "hello" } });
    rerender(
      <ThemeProvider>
        <MultiAskPanel
          requests={[inputReq("p1", "Your name?"), confirmReq("p2", "Q2", "B")]}
          onRespondToUi={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect((typeInto() as HTMLTextAreaElement).value).toBe("hello");
  });
});

describe("derivePendingFreeFloating — panel-vs-inline placement", () => {
  // Covers test-plan #E1 (harden-multi-ask-panel): the (¬tcid, ¬wb) base cell.
  it("E1 a free-floating ask enters the panel", () => {
    const messages: ChatMessage[] = [uiRow("p1")];
    const requests = [confirmReq("p1", "Free ask", "y")];
    expect(derivePendingFreeFloating(messages, requests).map((r) => r.requestId)).toEqual(["p1"]);
  });

  // Covers test-plan #E3 (harden-multi-ask-panel): the (¬tcid, wb) cell — the
  // assertion whose absence let the spec drift.
  it("E3 a widget-bar ask never enters the panel", () => {
    const wb = {
      ...confirmReq("pw", "Architect", "plan"),
      params: { title: "Architect", _promptBusComponent: { type: "architect-prompt" } },
    };
    const messages: ChatMessage[] = [uiRow("pw"), uiRow("p1")];
    const requests = [wb, confirmReq("p1", "Free ask", "y")];
    expect(derivePendingFreeFloating(messages, requests).map((r) => r.requestId)).toEqual(["p1"]);
  });

  // Covers test-plan #E4 (harden-multi-ask-panel): the (tcid, wb) cell —
  // widget-bar ownership beats tool-pairing.
  it("E4 widget-bar precedence beats tool-pairing", () => {
    const wb = {
      ...confirmReq("pw", "Architect", "plan"),
      params: { title: "Architect", _promptBusComponent: { type: "architect-prompt" } },
    };
    const messages: ChatMessage[] = [uiRow("pw", "tool-call-9"), uiRow("p1")];
    const requests = [wb, confirmReq("p1", "Free ask", "y")];
    expect(derivePendingFreeFloating(messages, requests).map((r) => r.requestId)).toEqual(["p1"]);
  });

  // Covers test-plan #E5 (harden-multi-ask-panel): the registry, not the
  // producer's claim, decides — an unregistered type is not widget-bar and
  // falls back to free-floating.
  it("E5 an unregistered component type is not widget-bar", () => {
    const unregistered = {
      ...confirmReq("pu", "Plugin ask", "x"),
      params: { title: "Plugin ask", _promptBusComponent: { type: "definitely-not-registered" } },
    };
    const messages: ChatMessage[] = [uiRow("pu")];
    expect(derivePendingFreeFloating(messages, [unregistered]).map((r) => r.requestId)).toEqual([
      "pu",
    ]);
  });

  // Covers test-plan #E8 (harden-multi-ask-panel): the batch clause is scoped
  // to asks that BELONG to the panel — a tool-paired batch ask does not enter
  // the stack.
  it("E8 a tool-paired batch ask does not enter the stack", () => {
    const batch: InteractiveUiRequest = {
      requestId: "pb",
      method: "batch",
      params: { title: "Batch", questions: [{ type: "confirm", question: "Go?" }] },
      status: "pending",
    };
    const messages: ChatMessage[] = [uiRow("pb", "tool-call-2", "batch"), uiRow("p1")];
    const requests = [batch, confirmReq("p1", "Free ask", "y")];
    expect(derivePendingFreeFloating(messages, requests).map((r) => r.requestId)).toEqual(["p1"]);
  });
  // Covers test-plan #E2 (harden-multi-ask-panel): the (tcid, ¬wb)
  // decision-table cell.
  it("C3 a tool-paired ask stays inline; only free-floating enters the panel", () => {
    const messages: ChatMessage[] = [uiRow("p3", "tool-call-1"), uiRow("p1")];
    const requests = [confirmReq("p3", "Tool ask", "x"), confirmReq("p1", "Free ask", "y")];
    const panel = derivePendingFreeFloating(messages, requests);
    expect(panel.map((r) => r.requestId)).toEqual(["p1"]);
  });

  it("excludes non-pending and keeps concurrent free-floating pair", () => {
    const messages: ChatMessage[] = [uiRow("p1"), uiRow("p2")];
    const requests = [
      confirmReq("p1", "Q1", "A"),
      { ...confirmReq("p2", "Q2", "B"), status: "resolved" as const },
    ];
    const panel = derivePendingFreeFloating(messages, requests);
    expect(panel.map((r) => r.requestId)).toEqual(["p1"]);
  });
});
