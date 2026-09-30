/**
 * Tests for expandable per-agent rows in FlowSummary.
 * Collapsed rows show a truncated peek; expanding reveals full summary
 * (markdown), typed-output chips, and the file list. Failed steps
 * auto-expand. Rows without detail are not interactive. Per-row state
 * is independent. See change: expandable-flow-summary-rows.
 */

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

// jsdom does not implement scrollIntoView; the selection effect calls it.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { FlowAgentState, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { FlowSummary } from "../client/FlowSummary.js";

const registry = createUiPrimitiveRegistry();
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.markdownContent,
  (({ content }: { content: string }) => <div data-testid="md">{content}</div>) as never,
);
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.formatDuration,
  (((ms: number) => `${ms}ms`) as never),
);
// FlowGraph (rendered inside FlowSummary) consumes the zoom-controls primitive.
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.zoomControls,
  ((() => null) as never),
);
// FlowAgentCard (frozen cards) primitives. See change: show-flow-cards-in-summary.
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.agentCard,
  (({ children, selected, onClick }: { children?: React.ReactNode; selected?: boolean; onClick?: () => void }) => (
    <div data-testid="agent-card" data-selected={selected ? "true" : "false"} onClick={onClick}>{children}</div>
  )) as never,
);
// ui:dialog is required by FlowAgentCard (detail) + FlowSummary (graph expand).
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.dialog,
  (({ open, children, title, size }: { open: boolean; children?: React.ReactNode; title?: string; size?: string }) =>
    open ? <div data-testid="dialog" data-size={size}>{title}{children}</div> : null) as never,
);
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.formatTokens,
  (((n: number) => `${n}`) as never),
);
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.popover,
  (({ children }: { children?: React.ReactNode }) => <>{children}</>) as never,
);

function agent(over: Partial<FlowAgentState>): FlowAgentState {
  return {
    agentName: over.stepId ?? "a",
    stepId: over.stepId ?? "a",
    status: "complete",
    blockedBy: [],
    recentTools: [],
    detailHistory: [],
    ...over,
  };
}

function makeState(agents: FlowAgentState[]): FlowState {
  return {
    flowName: "demo-flow",
    task: "t",
    status: "success",
    autonomousMode: false,
    agents: new Map(agents.map((a) => [a.stepId, a])),
  };
}

function renderSummary(state: FlowState) {
  return render(
    <UiPrimitiveProvider value={registry}>
      <FlowSummary flowState={state} onDismiss={() => {}} sessionId="s1" />
    </UiPrimitiveProvider>,
  );
}

afterEach(() => cleanup());

describe("FlowSummary frozen cards (show-flow-cards-in-summary)", () => {
  it("renders one frozen agent card per agent, above the collapsible summary section", () => {
    const state = makeState([
      agent({ stepId: "one", label: "step-one", status: "complete", summary: "S1" }),
      agent({ stepId: "two", label: "step-two", status: "complete", summary: "S2" }),
    ]);
    const { getAllByTestId, getByTestId } = renderSummary(state);
    const cards = getAllByTestId("agent-card");
    expect(cards).toHaveLength(2);
    // Cards precede the collapsible summaries section in DOM order.
    const section = getByTestId("flow-summaries");
    expect(cards[0].compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("collapsing the summary section keeps the cards visible", () => {
    const state = makeState([
      agent({ stepId: "one", label: "step-one", status: "complete", summary: "S1" }),
    ]);
    const { getByTestId, getAllByTestId, queryByTestId } = renderSummary(state);
    expect(getByTestId("flow-summaries")).toBeTruthy();
    fireEvent.click(getByTestId("flow-summary-toggle"));
    // Collapsing removes the summaries rows; cards stay visible.
    expect(queryByTestId("flow-summaries")).toBeNull();
    expect(getAllByTestId("agent-card")).toHaveLength(1);
  });
});

describe("FlowSummary fit-window scroll box (improve-flow-graph-fidelity)", () => {
  it("wraps cards + summaries in one bounded, scrollable box so the panel fits the viewport", () => {
    const state = makeState([
      agent({ stepId: "one", label: "step-one", status: "complete", summary: "S1" }),
    ]);
    const { getByTestId } = renderSummary(state);
    const box = getByTestId("flow-summary-scrollbox");
    expect(box.style.maxHeight).toBe("48vh");
    expect(box.className).toMatch(/overflow-y-auto/);
    // cards + summaries live INSIDE the scroll box
    expect(box.querySelector("[data-testid='flow-summaries']")).toBeTruthy();
    expect(box.querySelector("[data-testid='agent-card']")).toBeTruthy();
  });
});

describe("FlowSummary whole-panel collapse (improve-flow-graph-fidelity)", () => {
  it("collapses the whole panel to its header bar, hiding the body but keeping the name", () => {
    const state = makeState([
      agent({ stepId: "one", label: "step-one", status: "complete", summary: "S1" }),
    ]);
    const { getByTestId, queryByTestId, queryAllByTestId, getByText } = renderSummary(state);
    // Body present initially (cards + summaries footer).
    expect(queryAllByTestId("agent-card")).toHaveLength(1);
    expect(queryByTestId("flow-summaries")).toBeTruthy();
    // Collapse the whole panel.
    fireEvent.click(getByTestId("flow-summary-panel-toggle"));
    // Body gone; header (flow name) still shown — shrink-to-header, not dismiss.
    expect(queryAllByTestId("agent-card")).toHaveLength(0);
    expect(queryByTestId("flow-summaries")).toBeNull();
    expect(getByText(/demo-flow/)).toBeTruthy();
    // Toggling back restores the body.
    fireEvent.click(getByTestId("flow-summary-panel-toggle"));
    expect(queryAllByTestId("agent-card")).toHaveLength(1);
  });
});

describe("FlowSummary graph⇄card selection (improve-flow-graph-dialog-and-card-interaction)", () => {
  function selectionState() {
    return makeState([
      agent({ stepId: "one", label: "step-one", status: "complete", summary: "S1" }),
      agent({ stepId: "two", label: "step-two", status: "complete", summary: "S2" }),
    ]);
  }

  it("clicking a graph node selects the matching card", () => {
    const { container } = renderSummary(selectionState());
    const node = container.querySelector("[data-node='one']") as SVGGElement;
    expect(node).toBeTruthy();
    fireEvent.click(node);
    const card = container.querySelector("[data-step='one'] [data-testid='agent-card']");
    expect(card?.getAttribute("data-selected")).toBe("true");
  });

  it("clicking a card selects the matching graph node", () => {
    const { container } = renderSummary(selectionState());
    const card = container.querySelector("[data-step='two'] [data-testid='agent-card']") as HTMLElement;
    fireEvent.click(card);
    const node = container.querySelector("[data-node='two']");
    expect(node?.getAttribute("class") ?? "").toContain("flow-node-selected");
  });

  it("re-clicking the selected node clears selection", () => {
    const { container } = renderSummary(selectionState());
    const node = container.querySelector("[data-node='one']") as SVGGElement;
    fireEvent.click(node);
    fireEvent.click(node);
    const card = container.querySelector("[data-step='one'] [data-testid='agent-card']");
    expect(card?.getAttribute("data-selected")).toBe("false");
  });

  it("Esc clears selection", () => {
    const { container } = renderSummary(selectionState());
    fireEvent.click(container.querySelector("[data-node='one']") as SVGGElement);
    expect(container.querySelector("[data-step='one'] [data-testid='agent-card']")?.getAttribute("data-selected")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("[data-step='one'] [data-testid='agent-card']")?.getAttribute("data-selected")).toBe("false");
  });
});

describe("FlowSummary graph expand dialog (full size)", () => {
  it("⤢ Expand opens the graph dialog at size=full", () => {
    const state = makeState([agent({ stepId: "one", label: "step-one", status: "complete" })]);
    const { container, getByText, queryByTestId } = renderSummary(state);
    expect(queryByTestId("dialog")).toBeNull();
    fireEvent.click(getByText(/Expand/));
    const dialog = container.querySelector("[data-testid='dialog']");
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("data-size")).toBe("full");
  });
});

describe("FlowAgentCard detail dialog (replaces popover)", () => {
  it("clicking Details opens a dialog and there is no Popout button", () => {
    const state = makeState([agent({ stepId: "one", label: "step-one", status: "complete" })]);
    const { queryByText, queryByTestId, getAllByText } = renderSummary(state);
    expect(queryByText("Popout")).toBeNull();
    expect(queryByTestId("dialog")).toBeNull();
    // "Details" appears once per card; click the card's detail button.
    fireEvent.click(getAllByText("Details")[0]);
    const dialog = queryByTestId("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain("step-one"); // dialog title = displayName
  });
});

describe("FlowSummary expandable rows", () => {
  it("collapsed complete row shows truncated peek; clicking reveals full summary, chips, files", () => {
    const state = makeState([
      agent({
        stepId: "classify",
        label: "classify-intent",
        status: "complete",
        summary: "Decided the request was a refactor of the reducer module.",
        files: ["flow-reducer.ts", "flow-reducer.test.ts"],
        typedOutputs: { intent: "refactor", branch: "refactor" },
      }),
    ]);
    const { container } = renderSummary(state);
    // Scope row assertions to the collapsible summary section (the frozen cards
    // above also surface summary/outputs, so global queries are ambiguous now).
    const section = within(container.querySelector("[data-testid='flow-summaries']") as HTMLElement);

    // Collapsed: full summary not yet rendered through markdown primitive.
    expect(section.queryByTestId("md")).toBeNull();

    fireEvent.click(section.getByText("classify-intent", { selector: "span" }));

    // Expanded: full summary via markdown primitive.
    expect(section.getByTestId("md").textContent).toContain("refactor of the reducer module");
    // Typed-output chip (branch filtered out, intent shown).
    expect(section.getByText("intent")).toBeTruthy();
    // File list rendered.
    expect(section.getByText(/flow-reducer\.test\.ts/)).toBeTruthy();
  });

  it("failed step renders expanded on mount", () => {
    const state = makeState([
      agent({
        stepId: "verify",
        label: "verify-change",
        status: "error",
        outcome: "hard",
        summary: "Coverage gate failed on the new branch path.",
      }),
    ]);
    const { getByTestId } = renderSummary(state);
    // Auto-expanded → markdown primitive rendered without any click.
    expect(getByTestId("md").textContent).toContain("Coverage gate failed");
  });

  it("row without summary text is omitted from the list; section hidden when it is the only agent", () => {
    const state = makeState([
      agent({ stepId: "bare", label: "bare-step", status: "complete" }),
    ]);
    const { queryByText, queryByTestId, getAllByTestId } = renderSummary(state);
    // The bare step has no summary text → not listed, and as the only agent the
    // whole Summaries subsection is hidden.
    expect(queryByTestId("flow-summaries")).toBeNull();
    expect(queryByTestId("flow-summary-toggle")).toBeNull();
    expect(queryByText("bare-step", { selector: "span" })).toBeNull();
    // Frozen agent card still present (the filter only affects the Summaries list).
    expect(getAllByTestId("agent-card")).toHaveLength(1);
  });

  it("Summaries count reflects only summary-bearing agents", () => {
    const state = makeState([
      agent({ stepId: "one", label: "step-one", status: "complete", summary: "S1" }),
      agent({ stepId: "two", label: "step-two", status: "complete" }),
      agent({ stepId: "three", label: "step-three", status: "complete", summary: "S3" }),
    ]);
    const { getByText, queryByText } = renderSummary(state);
    expect(getByText("Summaries (2)")).toBeTruthy();
    // The summary-less middle step is not rendered as a row.
    expect(queryByText("step-two", { selector: "span" })).toBeNull();
  });

  it("hides the whole Summaries section when no agent has summary text", () => {
    const state = makeState([
      agent({ stepId: "a", label: "a", status: "complete", typedOutputs: { verdict: "pass" } }),
      agent({ stepId: "b", label: "b", status: "complete" }),
    ]);
    const { queryByTestId, getAllByTestId } = renderSummary(state);
    expect(queryByTestId("flow-summaries")).toBeNull();
    expect(queryByTestId("flow-summary-toggle")).toBeNull();
    // Both still appear as frozen cards.
    expect(getAllByTestId("agent-card")).toHaveLength(2);
  });

  it("expanding one row leaves siblings collapsed", () => {
    const state = makeState([
      agent({ stepId: "one", label: "step-one", status: "complete", summary: "Summary one." }),
      agent({ stepId: "two", label: "step-two", status: "complete", summary: "Summary two." }),
    ]);
    const { getByText, getAllByTestId, queryAllByTestId } = renderSummary(state);

    expect(queryAllByTestId("md")).toHaveLength(0);
    fireEvent.click(getByText("step-one", { selector: "span" }));

    const mds = getAllByTestId("md");
    expect(mds).toHaveLength(1);
    expect(mds[0].textContent).toContain("Summary one.");
  });
});

// L1 — the card's preserved interactions (change: consolidate-flow-agent-cards,
// test-plan #E14): the `data-step` wrapper still carries the step id and still
// selects, and the Details dialog still opens without changing the selection.
describe("FlowAgentCard preserved interactions (#E14)", () => {
  it("data-step selection and the Details dialog still work", () => {
    const state = makeState([
      agent({ stepId: "one", label: "step-one", status: "complete", summary: "S1" }),
      agent({ stepId: "two", label: "step-two", status: "complete", summary: "S2" }),
    ]);
    const { container, queryByTestId } = renderSummary(state);

    const wrapA = container.querySelector("[data-step='one']") as HTMLElement;
    expect(wrapA).toBeTruthy();
    const cardA = wrapA.querySelector("[data-testid='agent-card']") as HTMLElement;
    const cardB = container.querySelector("[data-step='two'] [data-testid='agent-card']") as HTMLElement;

    fireEvent.click(cardA);
    expect(cardA.getAttribute("data-selected")).toBe("true");
    expect(cardB.getAttribute("data-selected")).toBe("false");

    fireEvent.click(within(wrapA).getAllByText("Details")[0]);
    const dialog = queryByTestId("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain("step-one");
    // The Details click must not change the selection.
    expect(cardA.getAttribute("data-selected")).toBe("true");
    expect(cardB.getAttribute("data-selected")).toBe("false");
  });
});
