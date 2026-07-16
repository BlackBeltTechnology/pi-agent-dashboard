import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { FilePreviewHost, FilePreviewProvider } from "../../FilePreviewContext.js";
import { ThemeProvider } from "../../ThemeProvider.js";
import { OpenFileButton } from "../OpenFileButton.js";
import type { ToolContext } from "../types.js";

/** Render the button inside a controllable wouter router. */
function renderBtn(ui: React.ReactElement, startPath = "/session/s1") {
  const { hook, history } = memoryLocation({ path: startPath, record: true });
  const result = render(
    <Router hook={hook}>
      <ThemeProvider>
        <FilePreviewProvider>
          {ui}
          <FilePreviewHost />
        </FilePreviewProvider>
      </ThemeProvider>
    </Router>,
  );
  return { ...result, history };
}

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

const ctx: ToolContext = { cwd: "/Users/me/repo", sessionId: "s1" };

describe("OpenFileButton", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("body click navigates to the internal editor route", () => {
    const { getByTitle, history } = renderBtn(<OpenFileButton filePath="src/foo.ts" line={3} context={ctx} />);
    fireEvent.click(getByTitle("Open src/foo.ts"));
    expect(history.at(-1)).toBe("/session/s1/editor?file=src%2Ffoo.ts&line=3");
  });

  it("renders a plain Open button with no native-editor dropdown caret", () => {
    const { queryByLabelText, getByText } = renderBtn(<OpenFileButton filePath="src/foo.ts" context={ctx} />);
    expect(queryByLabelText("More open options")).toBeNull();
    expect(getByText("Open")).toBeTruthy();
  });

  it("no cwd → renders nothing", () => {
    const noCwd: ToolContext = { cwd: undefined, sessionId: "s1" };
    const { container } = renderBtn(<OpenFileButton filePath="src/foo.ts" context={noCwd} />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("no filePath → renders nothing", () => {
    const { container } = renderBtn(<OpenFileButton context={ctx} />);
    expect(container.querySelector("button")).toBeNull();
  });
});
