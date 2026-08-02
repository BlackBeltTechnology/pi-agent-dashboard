import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GrammarPanel } from "../GrammarPanel.js";
import type { ActiveSuggestion } from "../useGrammarCheck.js";

const SUGGESTIONS: ActiveSuggestion[] = [
  { id: "a", offset: 2, length: 3, original: "has", replacement: "have", kind: "grammar", message: "Agreement", stale: false },
  { id: "b", offset: 8, length: 7, original: "a apple", replacement: "an apple", kind: "grammar", message: "Article", stale: true },
];

function baseProps() {
  return {
    status: "done" as const,
    error: null,
    suggestions: SUGGESTIONS,
    summary: "2 grammar",
    truncated: false,
    onApplyAll: vi.fn(),
    onAccept: vi.fn(),
    onDismiss: vi.fn(),
    onDismissPanel: vi.fn(),
  };
}

describe("GrammarPanel", () => {
  it("renders nothing when idle", () => {
    const { container } = render(<GrammarPanel {...baseProps()} status="idle" suggestions={[]} summary={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a checking state", () => {
    render(<GrammarPanel {...baseProps()} status="checking" suggestions={[]} summary={null} />);
    expect(screen.getByText(/checking grammar/i)).toBeTruthy();
  });

  it("shows an error message and dismisses", () => {
    const props = { ...baseProps(), status: "error" as const, error: "backend_unreachable" as const, suggestions: [], summary: null };
    render(<GrammarPanel {...props} />);
    expect(screen.getByText(/unreachable/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId("grammar-panel-close"));
    expect(props.onDismissPanel).toHaveBeenCalled();
  });

  it("shows a no-issues state when done with zero suggestions", () => {
    render(<GrammarPanel {...baseProps()} suggestions={[]} summary={"No issues found"} />);
    expect(screen.getByText(/no issues found/i)).toBeTruthy();
  });

  it("gives Apply-all a darkened accent background so white text clears WCAG-AA", () => {
    render(<GrammarPanel {...baseProps()} />);
    const btn = screen.getByTestId("grammar-apply-all");
    // Raw --accent-primary is only 3.68:1 against white in the default theme;
    // the darkened mix lifts it over 4.5:1.
    expect(btn.getAttribute("style") ?? "").toContain("color-mix");
    expect(btn.className).not.toContain("bg-[var(--accent-primary)]");
  });

  it("renders the summary and both suggestions", () => {
    render(<GrammarPanel {...baseProps()} />);
    expect(screen.getByTestId("grammar-summary").textContent).toBe("2 grammar");
    expect(screen.getAllByTestId("grammar-suggestion")).toHaveLength(2);
    expect(screen.getByText("has")).toBeTruthy();
    expect(screen.getByText("have")).toBeTruthy();
  });

  it("renders each suggestion as before → after with a kind pill and message (L2)", () => {
    render(<GrammarPanel {...baseProps()} />);
    const before = screen.getByText("has");
    expect(before.className).toContain("line-through");
    expect(before.className).toContain("accent-red");
    const after = screen.getByText("have");
    expect(after.className).toContain("accent-green");
    // kind pill (both suggestions are `grammar`) + per-suggestion message.
    expect(screen.getAllByText("grammar")).toHaveLength(2);
    expect(screen.getByText("Agreement")).toBeTruthy();
    expect(screen.getByText("Article")).toBeTruthy();
  });

  it("apply-all triggers the callback", () => {
    const props = baseProps();
    render(<GrammarPanel {...props} />);
    fireEvent.click(screen.getByTestId("grammar-apply-all"));
    expect(props.onApplyAll).toHaveBeenCalled();
  });

  it("accept fires only for non-stale suggestions", () => {
    const props = baseProps();
    render(<GrammarPanel {...props} />);
    const acceptButtons = screen.getAllByTestId("grammar-accept");
    // first suggestion is live → enabled; second is stale → disabled
    expect((acceptButtons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((acceptButtons[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(acceptButtons[0]);
    expect(props.onAccept).toHaveBeenCalledWith("a");
  });

  it("dismiss fires per suggestion", () => {
    const props = baseProps();
    render(<GrammarPanel {...props} />);
    fireEvent.click(screen.getAllByTestId("grammar-dismiss")[0]);
    expect(props.onDismiss).toHaveBeenCalledWith("a");
  });

  it("shows a truncation note when truncated", () => {
    render(<GrammarPanel {...baseProps()} truncated={true} />);
    expect(screen.getByText(/only the first part/i)).toBeTruthy();
  });
});
