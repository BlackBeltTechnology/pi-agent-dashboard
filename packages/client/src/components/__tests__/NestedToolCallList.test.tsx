/**
 * Tool card renders its nested calls (pi codemode / `ctx.executeTool`).
 * Test-plan F1. See change: render-nested-tool-calls (D1).
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { NestedCallState } from "../../lib/chat/nested-tool-calls.js";
import { ToolCallStep } from "../chat/ToolCallStep.js";

vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: () => false,
}));

beforeAll(() => {
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

afterEach(cleanup);

const NESTED: NestedCallState[] = [
  { id: "call_1/1", parentId: "call_1", name: "codemode", status: "complete", result: "ok" },
  { id: "call_1/1/1", parentId: "call_1/1", name: "bash", status: "error", error: "exit 1", args: { command: "false" } },
  { id: "call_1/2", parentId: "call_1", name: "write", status: "unfinished", argumentsBytes: 9000 },
];

function renderCard(nested: NestedCallState[] = NESTED, nestedComplete: boolean | undefined = false) {
  return render(
    <ToolCallStep
      toolName="codemode"
      toolCallId="call_1"
      status="complete"
      result="done"
      context={{ sessionId: "s1" }}
      nested={nested}
      nestedComplete={nestedComplete}
    />,
  );
}

describe("ToolCallStep nested list (F1)", () => {
  it("is collapsed by default, showing the count", () => {
    const { getByTestId, queryAllByTestId } = renderCard();
    expect(getByTestId("nested-call-count").textContent).toContain("3");
    expect(queryAllByTestId("nested-call")).toHaveLength(0);
  });

  it("expanded: indents the grandchild, renders unfinished neutral, shows the incomplete notice", () => {
    const { getByTestId, getAllByTestId } = renderCard();
    fireEvent.click(getByTestId("nested-call-toggle"));
    const rows = getAllByTestId("nested-call");
    expect(rows).toHaveLength(3);

    const byId = (id: string) => rows.find((r) => r.getAttribute("data-nested-id") === id)!;
    expect(byId("call_1/1").getAttribute("data-nested-depth")).toBe("1");
    expect(byId("call_1/1/1").getAttribute("data-nested-depth")).toBe("2");
    expect(byId("call_1/1/1").style.paddingLeft).not.toBe(byId("call_1/1").style.paddingLeft);

    const unfinished = byId("call_1/2");
    const status = unfinished.querySelector('[data-testid="nested-call-status"]')!;
    expect(status.className).not.toContain("severity-error");
    expect(status.className).not.toContain("yellow");
    expect(status.querySelector("svg")?.getAttribute("style") ?? "").not.toContain("spin");
    expect(unfinished.textContent).toContain("arguments omitted (9000 bytes)");

    expect(getByTestId("nested-call-incomplete").textContent).toContain("nested-call record incomplete");
  });

  it("no incomplete notice when the record is complete", () => {
    const { getByTestId, queryByTestId } = renderCard(NESTED, true);
    fireEvent.click(getByTestId("nested-call-toggle"));
    expect(queryByTestId("nested-call-incomplete")).toBeNull();
  });

  it("renders no list when there are no nested calls", () => {
    const { queryByTestId } = renderCard([], undefined);
    expect(queryByTestId("nested-call-list")).toBeNull();
  });
});
