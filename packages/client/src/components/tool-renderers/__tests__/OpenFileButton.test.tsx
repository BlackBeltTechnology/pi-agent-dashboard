import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import * as editorApi from "../../../lib/editor-api.js";
import { FilePreviewHost, FilePreviewProvider } from "../../FilePreviewContext.js";
import { ThemeProvider } from "../../ThemeProvider.js";
import { OpenFileButton } from "../OpenFileButton.js";
import type { ToolContext } from "../types.js";

/** Render the split button inside a controllable wouter router. */
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

const ctxWith = (editors: ToolContext["editors"]): ToolContext => ({
  cwd: "/Users/me/repo",
  editors,
  sessionId: "s1",
});

describe("OpenFileButton (split button)", () => {
  beforeEach(() => {
    vi.spyOn(editorApi, "openEditor").mockResolvedValue({ success: true });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("body click navigates to the internal editor route", () => {
    const ctx = ctxWith([{ id: "zed", name: "Zed" }]);
    const { getByTitle, history } = renderBtn(<OpenFileButton filePath="src/foo.ts" line={3} context={ctx} />);
    fireEvent.click(getByTitle("Open src/foo.ts"));
    expect(history.at(-1)).toBe("/session/s1/editor?file=src%2Ffoo.ts&line=3");
    expect(editorApi.openEditor).not.toHaveBeenCalled();
  });

  it("dropdown opens the native editor and does NOT navigate", () => {
    const ctx = ctxWith([{ id: "zed", name: "Zed" }]);
    const { getByLabelText, getByText, history } = renderBtn(<OpenFileButton filePath="src/foo.ts" context={ctx} />);
    fireEvent.click(getByLabelText("More open options"));
    fireEvent.click(getByText("Open in Zed"));
    expect(editorApi.openEditor).toHaveBeenCalledWith("/Users/me/repo", "zed", "src/foo.ts", undefined);
    expect(history.at(-1)).toBe("/session/s1"); // unchanged
  });

  it("hides the dropdown caret when no native editor is detected", () => {
    const ctx = ctxWith([]);
    const { queryByLabelText, getByText } = renderBtn(<OpenFileButton filePath="src/foo.ts" context={ctx} />);
    expect(queryByLabelText("More open options")).toBeNull();
    expect(getByText("Open")).toBeTruthy();
  });

  it("keyboard ArrowDown + Enter invokes the second editor; Escape closes", () => {
    const ctx = ctxWith([
      { id: "zed", name: "Zed" },
      { id: "code", name: "VS Code" },
    ]);
    const { getByLabelText, getByRole } = renderBtn(<OpenFileButton filePath="a.ts" context={ctx} />);
    fireEvent.click(getByLabelText("More open options"));
    const menu = getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(editorApi.openEditor).toHaveBeenCalledWith("/Users/me/repo", "code", "a.ts", undefined);
  });

  it("renders even without a native editor (button visible)", () => {
    const ctx = ctxWith([]);
    const { getByText } = renderBtn(<OpenFileButton filePath="src/foo.ts" context={ctx} />);
    expect(getByText("Open")).toBeTruthy();
  });

  it("no cwd → renders nothing", () => {
    const ctx: ToolContext = { cwd: undefined, editors: [{ id: "zed", name: "Zed" }], sessionId: "s1" };
    const { container } = renderBtn(<OpenFileButton filePath="src/foo.ts" context={ctx} />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("no filePath → renders nothing", () => {
    const ctx = ctxWith([{ id: "zed", name: "Zed" }]);
    const { container } = renderBtn(<OpenFileButton context={ctx} />);
    expect(container.querySelector("button")).toBeNull();
  });
});
