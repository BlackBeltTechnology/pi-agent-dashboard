/**
 * GrammarComposerPanel picks the presentation from `correctionView`: the inline
 * GrammarRedlinePanel (redline) or the stacked GrammarPanel (list).
 * See change: add-grammar-compact-view.
 */

import type { GrammarCorrectionView } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrammarComposerPanel } from "../GrammarComposerPanel.js";

vi.mock("../useGrammarCheck.js", () => ({ useGrammarCheck: vi.fn() }));

import { useGrammarCheck } from "../useGrammarCheck.js";

function mockHook(correctionView: GrammarCorrectionView) {
  (useGrammarCheck as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    enabled: true,
    correctionView,
    status: "done",
    error: null,
    suggestions: [
      { id: "a", offset: 0, length: 1, original: "i", replacement: "I", kind: "grammar", message: "", stale: false },
    ],
    summary: "1 grammar",
    truncated: false,
    checkNow: vi.fn(),
    applyAll: vi.fn(),
    accept: vi.fn(),
    dismiss: vi.fn(),
    dismissPanel: vi.fn(),
  });
}

describe("GrammarComposerPanel presentation switch", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders the inline redline panel when correctionView is redline", () => {
    mockHook("redline");
    render(<GrammarComposerPanel draft="i beleive" onApplyText={() => {}} />);
    expect(screen.getByTestId("grammar-redline-panel")).toBeTruthy();
    expect(screen.queryByTestId("grammar-panel")).toBeNull();
  });

  it("renders the stacked list panel when correctionView is list", () => {
    mockHook("list");
    render(<GrammarComposerPanel draft="i beleive" onApplyText={() => {}} />);
    expect(screen.getByTestId("grammar-panel")).toBeTruthy();
    expect(screen.queryByTestId("grammar-redline-panel")).toBeNull();
  });
});
