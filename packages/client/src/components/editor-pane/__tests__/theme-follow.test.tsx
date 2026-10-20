/**
 * Regression: editor-pane editors follow the dashboard theme live (#7).
 *
 * MonacoBuffer + MarkdownEditor must consume the shared `useThemeContext()`
 * (ThemeProvider), NOT the raw `useTheme()` hook (isolated per-instance
 * state). When the provider's `setThemeName` fires, the editor's recolor
 * effect must re-run `defineTheme` + `setTheme`. With the raw hook the
 * editor's private state never changes, so `setTheme` is never re-called.
 *
 * See change: improve-content-editor (tasks §1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";
import React from "react";
import { ThemeProvider, useThemeContext } from "../../settings/ThemeProvider.js";

// Shared fake Monaco captured across a test; reset per test.
const defineTheme = vi.fn();
const setTheme = vi.fn();
const fakeMonaco = {
  languages: {
    typescript: {
      typescriptDefaults: { setDiagnosticsOptions: vi.fn() },
      javascriptDefaults: { setDiagnosticsOptions: vi.fn() },
    },
  },
  editor: { defineTheme, setTheme },
};

// Mock @monaco-editor/react: synchronously invoke beforeMount + onMount with
// the fake monaco so the recolor effect has a live monacoRef.
vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({
    beforeMount,
    onMount,
  }: {
    beforeMount?: (m: unknown) => void;
    onMount?: (editor: unknown, m: unknown) => void;
  }) => {
    React.useEffect(() => {
      beforeMount?.(fakeMonaco);
      onMount?.(
        { revealLineInCenter: vi.fn(), setPosition: vi.fn() },
        fakeMonaco,
      );
    }, []);
    return <div data-testid="monaco" />;
  },
}));

// Side-effect worker wiring — stub out in jsdom.
vi.mock("../monaco-setup.js", () => ({}));
// Deterministic theme build.
vi.mock("../../../lib/theme/monaco-theme.js", () => ({
  buildMonacoTheme: (themeName: string, resolved: string) => ({
    name: `pi-monaco-${themeName}-${resolved}`,
    data: { base: "vs-dark", inherit: true, rules: [], colors: {} },
  }),
}));
vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import MonacoBuffer from "../MonacoBuffer.js";
import { MarkdownEditor } from "../MarkdownEditor.js";

/** Harness exposing the provider's setThemeName to the test. */
let switchTheme: (name: string) => void;
function ThemeControl() {
  const { setThemeName } = useThemeContext();
  switchTheme = setThemeName;
  return null;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  defineTheme.mockClear();
  setTheme.mockClear();
  // jsdom lacks matchMedia; provide a dark-mode stub so resolved === "dark".
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      json: () =>
        Promise.resolve({
          success: true,
          data: { type: "file", content: "hello" },
        }),
    }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("editor-pane theme follow (#7)", () => {
  it("MonacoBuffer re-applies theme when provider setThemeName fires", async () => {
    await act(async () => {
      render(
        <ThemeProvider>
          <ThemeControl />
          <MonacoBuffer cwd="/x" path="/x/a.ts" kind="text" mimeType="text/plain" size={0} />
        </ThemeProvider>,
      );
    });
    expect(screen.getByTestId("monaco")).toBeTruthy();
    setTheme.mockClear();

    await act(async () => {
      switchTheme("dracula");
    });

    expect(setTheme).toHaveBeenCalled();
    expect(defineTheme).toHaveBeenCalledWith(
      "pi-monaco-dracula-dark",
      expect.anything(),
    );
  });

  it("MarkdownEditor re-applies theme when provider setThemeName fires", async () => {
    await act(async () => {
      render(
        <ThemeProvider>
          <ThemeControl />
          <MarkdownEditor value="# hi" onChange={() => {}} />
        </ThemeProvider>,
      );
    });
    setTheme.mockClear();

    await act(async () => {
      switchTheme("nord");
    });

    expect(setTheme).toHaveBeenCalled();
    expect(defineTheme).toHaveBeenCalledWith(
      "pi-monaco-nord-dark",
      expect.anything(),
    );
  });
});
