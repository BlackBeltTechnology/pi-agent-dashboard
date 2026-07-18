import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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

// Mock SyntaxHighlighter (DiffPanel renders it for the "File" view path; we
// don't exercise that path here, but the import must succeed).
vi.mock("react-syntax-highlighter", () => ({
  Prism: (props: Record<string, unknown>) => (
    <div data-testid="syntax-highlighter">{props.children as React.ReactNode}</div>
  ),
}));

// Mock @git-diff-view/react's DiffView to capture the diffViewTheme prop.
vi.mock("@git-diff-view/react", () => ({
  DiffView: (props: Record<string, unknown>) => (
    <div data-testid="diff-view" data-diff-theme={String(props.diffViewTheme)} />
  ),
  DiffModeEnum: { Split: "split", Unified: "unified" },
}));

// Mock the lowlight highlighter (no behaviour needed in this test).
vi.mock("@git-diff-view/lowlight", () => ({ highlighter: {} }));

// Mock generateDiffFile so the useMemo in DiffPanel produces a stable diffFile
// for a synthetic edit change without requiring the full diff library.
vi.mock("@git-diff-view/file", () => ({
  generateDiffFile: () => ({
    init: () => {},
    buildSplitDiffLines: () => {},
    buildUnifiedDiffLines: () => {},
  }),
}));

// Mock ThemeProvider so we can drive `resolved` directly without depending on
// matchMedia / persistence. The DiffPanel only reads `resolved` and
// `themeName` from useThemeContext().
vi.mock("../settings/ThemeProvider.js", async () => {
  const actual = await import("react");
  const ThemeContext = actual.createContext<{ resolved: "light" | "dark"; themeName: string } | null>(null);
  return {
    ThemeProvider: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: { resolved: "light" | "dark"; themeName: string };
    }) => actual.createElement(ThemeContext.Provider, { value }, children),
    useThemeContext: () => {
      const ctx = actual.useContext(ThemeContext);
      if (!ctx) throw new Error("useThemeContext requires provider");
      return ctx;
    },
  };
});

import { ThemeProvider } from "../settings/ThemeProvider.js";
import { DiffPanel } from "../diff/DiffPanel.js";
import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";

const fileWithEdit: FileDiffEntry = {
  path: "src/example.ts",
  changes: [
    {
      type: "edit",
      timestamp: 0,
      edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }],
    } as unknown as FileDiffEntry["changes"][number],
  ],
} as unknown as FileDiffEntry;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Provider = ThemeProvider as any;

function renderWith(resolved: "light" | "dark") {
  return render(
    <Provider value={{ resolved, themeName: "base" }}>
      <DiffPanel
        file={fileWithEdit}
        selection={{ filePath: "src/example.ts", changeIndex: 0 }}
        sessionId="sess-test"
      />
    </Provider>,
  );
}

describe("DiffPanel binds diffViewTheme to active app theme", () => {
  afterEach(() => cleanup());

  it("passes diffViewTheme=\"dark\" when resolved theme is dark", () => {
    const { getByTestId } = renderWith("dark");
    const dv = getByTestId("diff-view");
    expect(dv.getAttribute("data-diff-theme")).toBe("dark");
  });

  it("passes diffViewTheme=\"light\" when resolved theme is light", () => {
    const { getByTestId } = renderWith("light");
    const dv = getByTestId("diff-view");
    expect(dv.getAttribute("data-diff-theme")).toBe("light");
  });
});
