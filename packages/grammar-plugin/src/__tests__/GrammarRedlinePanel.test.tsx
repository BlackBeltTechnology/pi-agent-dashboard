import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GrammarRedlinePanel } from "../GrammarRedlinePanel.js";
import type { ActiveSuggestion } from "../useGrammarCheck.js";

const DRAFT = "i beleive their are ok.";

function makeSuggestions(): ActiveSuggestion[] {
  const specs: Array<[string, string, ActiveSuggestion["kind"]]> = [
    ["i", "I", "grammar"],
    ["beleive", "believe", "spelling"],
    ["their", "there", "punctuation"],
  ];
  return specs.map(([original, replacement, kind], i) => ({
    id: `s${i}`,
    offset: DRAFT.indexOf(original),
    length: original.length,
    original,
    replacement,
    kind,
    message: `${kind} fix`,
    stale: false,
  }));
}

function baseProps() {
  return {
    draft: DRAFT,
    status: "done" as const,
    error: null,
    suggestions: makeSuggestions(),
    summary: "3 issues",
    truncated: false,
    onApplyAll: vi.fn(),
    onAccept: vi.fn(),
    onDismiss: vi.fn(),
    onDismissPanel: vi.fn(),
  };
}

describe("GrammarRedlinePanel", () => {
  beforeEach(() => localStorage.clear());

  it("renders nothing when idle", () => {
    const { container } = render(<GrammarRedlinePanel {...baseProps()} status="idle" suggestions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("defaults to redline mode: ghost per change + click applies only that one", () => {
    const props = baseProps();
    render(<GrammarRedlinePanel {...props} />);
    expect(screen.getByTestId("grammar-mode-redline").getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId("grammar-change")).toHaveLength(3);
    expect(screen.getAllByTestId("grammar-ghost")).toHaveLength(3);
    fireEvent.click(screen.getAllByTestId("grammar-change")[0]);
    expect(props.onAccept).toHaveBeenCalledWith("s0");
  });

  it("maps kind to a colour on the redline original", () => {
    render(<GrammarRedlinePanel {...baseProps()} />);
    // s0 = grammar → --accent-blue
    expect(screen.getByText("i").style.color).toBe("var(--accent-blue)");
    // s1 = spelling → --accent-red
    expect(screen.getByText("beleive").style.color).toBe("var(--accent-red)");
  });

  it("compact mode reveals Apply / Ignore per change", () => {
    const props = baseProps();
    render(<GrammarRedlinePanel {...props} />);
    fireEvent.click(screen.getByTestId("grammar-mode-compact"));
    expect(screen.queryAllByTestId("grammar-ghost")).toHaveLength(0);
    fireEvent.click(screen.getAllByTestId("grammar-apply")[1]);
    expect(props.onAccept).toHaveBeenCalledWith("s1");
    fireEvent.click(screen.getAllByTestId("grammar-ignore")[0]);
    expect(props.onDismiss).toHaveBeenCalledWith("s0");
  });

  it("original mode is a read-only before preview", () => {
    const props = baseProps();
    render(<GrammarRedlinePanel {...props} />);
    fireEvent.click(screen.getByTestId("grammar-mode-original"));
    expect(screen.getByText("beleive")).toBeTruthy(); // original word shown
    fireEvent.click(screen.getAllByTestId("grammar-change")[0]);
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it("corrected mode is a read-only after preview", () => {
    render(<GrammarRedlinePanel {...baseProps()} />);
    fireEvent.click(screen.getByTestId("grammar-mode-corrected"));
    expect(screen.getByText("believe")).toBeTruthy(); // replacement word shown
    expect(screen.queryByText("beleive")).toBeNull();
  });

  it("Apply all fires the bulk callback", () => {
    const props = baseProps();
    render(<GrammarRedlinePanel {...props} />);
    fireEvent.click(screen.getByTestId("grammar-apply-all"));
    expect(props.onApplyAll).toHaveBeenCalled();
  });

  it("remembers the chosen mode across remounts", () => {
    const { unmount } = render(<GrammarRedlinePanel {...baseProps()} />);
    fireEvent.click(screen.getByTestId("grammar-mode-compact"));
    expect(localStorage.getItem("grammar.correctionMode")).toBe("compact");
    unmount();
    render(<GrammarRedlinePanel {...baseProps()} />);
    expect(screen.getByTestId("grammar-mode-compact").getAttribute("aria-selected")).toBe("true");
  });

  it("falls back to redline for an unrecognised stored mode", () => {
    localStorage.setItem("grammar.correctionMode", "bogus");
    render(<GrammarRedlinePanel {...baseProps()} />);
    expect(screen.getByTestId("grammar-mode-redline").getAttribute("aria-selected")).toBe("true");
  });

  it("applies a change from the keyboard (Enter) with an accessible label", () => {
    const props = baseProps();
    render(<GrammarRedlinePanel {...props} />);
    const change = screen.getAllByTestId("grammar-change")[2];
    expect(change.getAttribute("aria-label")).toContain("punctuation");
    expect(change.getAttribute("aria-label")).toContain("their");
    fireEvent.keyDown(change, { key: "Enter" });
    expect(props.onAccept).toHaveBeenCalledWith("s2");
  });

  it("shows checking / error / no-issues states", () => {
    const { rerender } = render(<GrammarRedlinePanel {...baseProps()} status="checking" suggestions={[]} />);
    expect(screen.getByText(/checking grammar/i)).toBeTruthy();
    rerender(<GrammarRedlinePanel {...baseProps()} status="error" error="backend_unreachable" suggestions={[]} />);
    expect(screen.getByText(/unreachable/i)).toBeTruthy();
    rerender(<GrammarRedlinePanel {...baseProps()} status="done" suggestions={[]} summary={null} />);
    expect(screen.getByText(/no issues found/i)).toBeTruthy();
  });
});
