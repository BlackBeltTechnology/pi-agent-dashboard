/**
 * Tests for the per-turn change summary block (change: add-change-summary-table).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChangeSummaryBlock } from "../ChangeSummaryBlock.js";
import type { TurnSummary } from "../../lib/lineDelta.js";

afterEach(cleanup);

const summary: TurnSummary = {
  turn: 0,
  files: [
    { path: "src/a.ts", additions: 3, deletions: 1, status: "modified" },
    { path: "src/new.ts", additions: 5, deletions: 0, status: "added" },
  ],
  totalAdditions: 8,
  totalDeletions: 1,
  boundaryUserMessageId: null,
};

describe("ChangeSummaryBlock", () => {
  it("renders one row per changed file with counts and file count header", () => {
    render(<ChangeSummaryBlock summary={summary} />);
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(screen.getByText("src/new.ts")).toBeTruthy();
    expect(screen.getByText("2 files")).toBeTruthy();
  });

  it("renders nothing when the turn changed no files", () => {
    const empty: TurnSummary = { ...summary, files: [], totalAdditions: 0, totalDeletions: 0 };
    const { container } = render(<ChangeSummaryBlock summary={empty} />);
    expect(container.firstChild).toBeNull();
  });

  it("collapses to the one-line summary when the header is toggled", () => {
    render(<ChangeSummaryBlock summary={summary} />);
    // expanded by default → rows visible
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("src/a.ts")).toBeNull();
    expect(screen.getByText("Changed this turn")).toBeTruthy();
  });

  it("invokes onOpenFile with the file path when a row is activated", () => {
    const onOpenFile = vi.fn();
    render(<ChangeSummaryBlock summary={summary} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText("src/new.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("src/new.ts");
  });
});
