/**
 * Tests for the per-turn change summary block (change: add-change-summary-table).
 */

import { mdiLanguageTypescript } from "@mdi/js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TurnSummary } from "../../lib/util/lineDelta.js";
import { ChangeSummaryBlock } from "../diff/ChangeSummaryBlock.js";

afterEach(cleanup);

/** Build a TurnSummary with `n` modified `.ts` files. */
function summaryWith(n: number): TurnSummary {
  return {
    turn: 0,
    files: Array.from({ length: n }, (_, i) => ({
      path: `src/f${i}.ts`,
      additions: 1,
      deletions: 0,
      status: "modified" as const,
    })),
    totalAdditions: n,
    totalDeletions: 0,
    boundaryUserMessageId: null,
  };
}

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

  it("leads each row with a mime icon (not a +/● status glyph)", () => {
    const { container } = render(<ChangeSummaryBlock summary={summary} />);
    // No status-glyph text remains.
    expect(screen.queryByText("+")).toBeNull();
    expect(screen.queryByText("●")).toBeNull();
    // A TypeScript mime glyph renders (both rows are .ts).
    const paths = Array.from(container.querySelectorAll("svg path")).map((p) =>
      p.getAttribute("d"),
    );
    expect(paths).toContain(mdiLanguageTypescript);
  });

  it("stays expanded on mount when fewer than 8 files", () => {
    render(<ChangeSummaryBlock summary={summaryWith(7)} />);
    expect(screen.getByText("src/f0.ts")).toBeTruthy();
  });

  it("mounts collapsed when 8 or more files", () => {
    render(<ChangeSummaryBlock summary={summaryWith(8)} />);
    expect(screen.queryByText("src/f0.ts")).toBeNull();
    expect(screen.getByText("8 files")).toBeTruthy();
  });

  it("auto-collapses when a streaming turn crosses 7→8 files", () => {
    const { rerender } = render(<ChangeSummaryBlock summary={summaryWith(7)} />);
    expect(screen.getByText("src/f0.ts")).toBeTruthy();
    rerender(<ChangeSummaryBlock summary={summaryWith(8)} />);
    expect(screen.queryByText("src/f0.ts")).toBeNull();
  });

  it("keeps a manually-expanded ≥8 block expanded as more files stream in (sticky)", () => {
    const { rerender } = render(<ChangeSummaryBlock summary={summaryWith(8)} />);
    // Collapsed on mount; user expands.
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("src/f0.ts")).toBeTruthy();
    // More files stream in — stays expanded.
    rerender(<ChangeSummaryBlock summary={summaryWith(10)} />);
    expect(screen.getByText("src/f0.ts")).toBeTruthy();
  });

  it("keeps a manually-collapsed <8 block collapsed (sticky)", () => {
    const { rerender } = render(<ChangeSummaryBlock summary={summaryWith(3)} />);
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("src/f0.ts")).toBeNull();
    // Even as it grows (but stays <8), stays collapsed.
    rerender(<ChangeSummaryBlock summary={summaryWith(5)} />);
    expect(screen.queryByText("src/f0.ts")).toBeNull();
  });
});
