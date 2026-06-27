import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as editorApi from "../../../lib/editor-api.js";
import { FilePreviewHost, FilePreviewProvider } from "../../FilePreviewContext.js";
import { ThemeProvider } from "../../ThemeProvider.js";
import { OpenFileButton } from "../OpenFileButton.js";
import type { ToolContext } from "../types.js";

const originalLocation = window.location;
function setHost(host: string) {
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, hostname: host },
    writable: true,
  });
}
function restoreHost() {
  Object.defineProperty(window, "location", { value: originalLocation, writable: true });
}

function renderBtn(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <FilePreviewProvider>
        {ui}
        <FilePreviewHost />
      </FilePreviewProvider>
    </ThemeProvider>,
  );
}

// No-provider render: exercises OpenFileButton's leaf-local fallback overlay
// (README/markdown/plugin surfaces with no FilePreviewProvider mounted).
function renderBtnNoProvider(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
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

describe("OpenFileButton", () => {
  beforeEach(() => {
    vi.spyOn(editorApi, "openEditor").mockResolvedValue({ success: true });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreHost();
  });

  it("localhost + editor → opens in editor", async () => {
    setHost("localhost");
    const ctx: ToolContext = { cwd: "/Users/me/repo", editors: [{ id: "code", name: "VS Code" }] };
    const { getByRole } = renderBtn(<OpenFileButton filePath="src/foo.ts" line={3} context={ctx} />);
    fireEvent.click(getByRole("button"));
    await Promise.resolve();
    expect(editorApi.openEditor).toHaveBeenCalledWith("/Users/me/repo", "code", "src/foo.ts", 3);
  });

  it("no editor → opens preview overlay (no openEditor)", async () => {
    setHost("localhost");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { type: "file", content: "" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as any,
    );
    const ctx: ToolContext = { cwd: "/Users/me/repo", editors: [] };
    const { getByRole, findByTestId } = renderBtn(<OpenFileButton filePath="src/foo.ts" context={ctx} />);
    fireEvent.click(getByRole("button"));
    expect(editorApi.openEditor).not.toHaveBeenCalled();
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
  });

  it("no provider → renders its own fallback preview overlay", async () => {
    setHost("localhost");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { type: "file", content: "" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as any,
    );
    const ctx: ToolContext = { cwd: "/Users/me/repo", editors: [] };
    const { getByRole, findByTestId } = renderBtnNoProvider(
      <OpenFileButton filePath="src/foo.ts" context={ctx} />,
    );
    fireEvent.click(getByRole("button"));
    expect(editorApi.openEditor).not.toHaveBeenCalled();
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
  });

  it("no cwd → renders nothing", () => {
    setHost("localhost");
    const ctx: ToolContext = { cwd: undefined, editors: [{ id: "code", name: "VS Code" }] };
    const { container } = renderBtn(<OpenFileButton filePath="src/foo.ts" context={ctx} />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("no filePath → renders nothing", () => {
    setHost("localhost");
    const ctx: ToolContext = { cwd: "/Users/me/repo", editors: [{ id: "code", name: "VS Code" }] };
    const { container } = renderBtn(<OpenFileButton context={ctx} />);
    expect(container.querySelector("button")).toBeNull();
  });
});
