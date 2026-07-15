/**
 * DiffPanel file-preview control in the split diff tab
 * (change: fix-session-diff-open-nongit-and-preview, Decision 3).
 *
 * The Diff / File toggle is a persistent, labeled control in the DiffPanel
 * header (which DiffViewer renders in the split tab). Default = Diff; clicking
 * File fetches `/api/session-file` and shows the whole file via
 * SyntaxHighlighter; clicking Diff returns to the diff.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock("react-syntax-highlighter", () => ({
  Prism: (props: Record<string, unknown>) => (
    <div data-testid="syntax-highlighter">{props.children as React.ReactNode}</div>
  ),
}));

vi.mock("@git-diff-view/react", () => ({
  DiffView: () => <div data-testid="diff-view" />,
  DiffModeEnum: { Split: "split", Unified: "unified" },
}));
vi.mock("@git-diff-view/lowlight", () => ({ highlighter: {} }));

// RichDiff renders the change-derived (Path A/C) diff; probe it so we can tell
// "diff view" apart from "file view".
vi.mock("../RichDiff.js", () => ({
  RichDiff: () => <div data-testid="rich-diff" />,
  getLang: () => "typescript",
}));

vi.mock("../ThemeProvider.js", async () => {
  const actual = await import("react");
  const ThemeContext = actual.createContext<{ resolved: "light" | "dark"; themeName: string } | null>(
    null,
  );
  return {
    ThemeProvider: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: { resolved: "light" | "dark"; themeName: string };
    }) => actual.createElement(ThemeContext.Provider, { value }, children),
    useThemeContext: () => ({ resolved: "dark", themeName: "base" }),
  };
});

import { DiffPanel } from "../DiffPanel.js";
import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";

const file: FileDiffEntry = {
  path: "src/a.ts",
  changes: [{ type: "write", timestamp: 0, content: "const a = 1;\n" }],
};

describe("DiffPanel file preview", () => {
  it("toggles Diff → File (whole file) → Diff", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { content: "WHOLE FILE CONTENTS" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiffPanel file={file} selection={{ filePath: "src/a.ts", changeIndex: null }} sessionId="s1" />);

    // Default = Diff.
    expect(screen.getByTestId("rich-diff")).toBeTruthy();

    // Click File → fetches /api/session-file and shows the whole file.
    fireEvent.click(screen.getByText("File"));
    await waitFor(() => expect(screen.getByTestId("syntax-highlighter")).toBeTruthy());
    expect(screen.getByText("WHOLE FILE CONTENTS")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toContain("/api/session-file");

    // Click Diff → back to the diff.
    fireEvent.click(screen.getByText("Diff"));
    expect(screen.getByTestId("rich-diff")).toBeTruthy();
  });
});
