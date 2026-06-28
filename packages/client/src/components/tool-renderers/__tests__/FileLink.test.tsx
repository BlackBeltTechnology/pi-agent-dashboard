import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as editorApi from "../../../lib/editor-api.js";
import { FilePreviewHost, FilePreviewProvider } from "../../FilePreviewContext.js";
import { ThemeProvider } from "../../ThemeProvider.js";
import { FileLink } from "../FileLink.js";
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

// FilePreviewOverlay (rendered on the no-editor path) reads ThemeProvider for
// syntax highlighting, so every render is wrapped.
function renderFL(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <FilePreviewProvider>
        {ui}
        <FilePreviewHost />
      </FilePreviewProvider>
    </ThemeProvider>,
  );
}

// No-provider render: exercises FileLink's leaf-local fallback overlay (the
// path used on non-chat surfaces like README dialogs / markdown preview, where
// no FilePreviewProvider is mounted). renderFL above always goes through the
// hosted path, so this keeps the fallback branch covered.
function renderFLNoProvider(ui: React.ReactElement) {
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

describe("FileLink — click routing", () => {
  beforeEach(() => {
    vi.spyOn(editorApi, "openEditor").mockResolvedValue({ success: true });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreHost();
  });

  it("localhost + editor → calls openEditor with cwd/editor/file/line", async () => {
    setHost("localhost");
    const ctx: ToolContext = {
      cwd: "/Users/me/repo",
      editors: [{ id: "code", name: "VS Code" }],
    };
    const { getByRole } = renderFL(
      <FileLink path="src/foo.ts" line={42} context={ctx}>
        src/foo.ts:42
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await Promise.resolve();
    expect(editorApi.openEditor).toHaveBeenCalledWith(
      "/Users/me/repo",
      "code",
      "src/foo.ts",
      42,
    );
  });

  it("remote → does NOT call openEditor; opens the preview overlay", async () => {
    setHost("dashboard.example.com");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { type: "file", content: "" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as any,
    );
    const ctx: ToolContext = {
      cwd: "/Users/me/repo",
      editors: [{ id: "code", name: "VS Code" }],
    };
    const { getByRole, findByTestId } = renderFL(
      <FileLink path="src/foo.ts" line={5} context={ctx}>
        src/foo.ts:5
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    expect(editorApi.openEditor).not.toHaveBeenCalled();
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
    fetchSpy.mockRestore();
  });

  it("localhost without editors → opens preview overlay (no openEditor call)", async () => {
    setHost("localhost");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { type: "file", content: "" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as any,
    );
    const ctx: ToolContext = { cwd: "/Users/me/repo", editors: [] };
    const { getByRole, findByTestId } = renderFL(
      <FileLink path="src/bar.ts" context={ctx}>
        src/bar.ts
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    expect(editorApi.openEditor).not.toHaveBeenCalled();
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
  });

  it("button is non-draggable and user-select:text so drag-select works", () => {
    setHost("localhost");
    const ctx: ToolContext = {
      cwd: "/Users/me/repo",
      editors: [{ id: "code", name: "VS Code" }],
    };
    const { getByRole } = renderFL(
      <FileLink path="src/foo.ts" context={ctx}>
        src/foo.ts
      </FileLink>,
    );
    const button = getByRole("button") as HTMLButtonElement;
    expect(button.getAttribute("draggable")).toBe("false");
    expect(button.style.userSelect).toBe("text");
    // A plain click still opens (calls openEditor on localhost+editor).
    fireEvent.click(button);
    expect(editorApi.openEditor).toHaveBeenCalled();
  });

  it("no provider → FileLink renders its own fallback preview overlay", async () => {
    setHost("dashboard.example.com");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { type: "file", content: "" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as any,
    );
    const ctx: ToolContext = { cwd: "/Users/me/repo", editors: [] };
    const { getByRole, findByTestId } = renderFLNoProvider(
      <FileLink path="src/foo.ts" context={ctx}>
        src/foo.ts
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
    fetchSpy.mockRestore();
  });

  it("title exposes resolved absolute path on hover", () => {
    setHost("localhost");
    const ctx: ToolContext = {
      cwd: "/Users/me/repo",
      editors: [{ id: "code", name: "VS Code" }],
    };
    const { getByRole } = renderFL(
      <FileLink path="src/foo.ts" line={42} context={ctx}>
        src/foo.ts:42
      </FileLink>,
    );
    const title = getByRole("button").getAttribute("title") ?? "";
    expect(title).toContain("/Users/me/repo/src/foo.ts");
    expect(title).toContain(":42");
  });
});

describe("FileLink — absolute paths skip the cwd join", () => {
  beforeEach(() => {
    vi.spyOn(editorApi, "openEditor").mockResolvedValue({ success: true });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreHost();
  });

  it("absolute path title is the path verbatim (not re-rooted under cwd)", () => {
    setHost("localhost");
    const ctx: ToolContext = {
      cwd: "/Users/me/repo",
      editors: [{ id: "code", name: "VS Code" }],
    };
    const { getByRole } = renderFL(
      <FileLink path="/Users/other/app.ts" absolute context={ctx}>
        /Users/other/app.ts
      </FileLink>,
    );
    const title = getByRole("button").getAttribute("title") ?? "";
    expect(title).toContain("/Users/other/app.ts");
    expect(title).not.toContain("/Users/me/repo/Users");
  });

  it("absolute click opens editor with the absolute path verbatim", async () => {
    setHost("localhost");
    const ctx: ToolContext = {
      cwd: "/Users/me/repo",
      editors: [{ id: "code", name: "VS Code" }],
    };
    const { getByRole } = renderFL(
      <FileLink path="/Users/other/app.ts" line={9} absolute context={ctx}>
        /Users/other/app.ts:9
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await Promise.resolve();
    expect(editorApi.openEditor).toHaveBeenCalledWith(
      "/Users/me/repo",
      "code",
      "/Users/other/app.ts",
      9,
    );
  });

  it("absolute path preview overlay uses the absolute path", async () => {
    setHost("dashboard.example.com");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { type: "file", content: "" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as any,
    );
    const ctx: ToolContext = { cwd: "/Users/me/repo", editors: [] };
    const { getByRole, findByTestId } = renderFL(
      <FileLink path="/Users/other/app.ts" absolute context={ctx}>
        /Users/other/app.ts
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    const overlay = await findByTestId("file-preview-overlay");
    expect(overlay.textContent).toContain("/Users/other/app.ts");
    fetchSpy.mockRestore();
  });
});

describe("FileLink — worktree link-origin re-rooting", () => {
  const worktreeCtx: ToolContext = {
    cwd: "/repo/.worktrees/x",
    editors: [{ id: "code", name: "VS Code" }],
  };

  beforeEach(() => {
    vi.spyOn(editorApi, "openEditor").mockResolvedValue({ success: true });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreHost();
  });

  it("opens the worktree copy for a parent-rooted absolute path", async () => {
    setHost("localhost");
    const { getByRole } = renderFL(
      <FileLink path="/repo/node_modules/vitest/package.json" absolute context={worktreeCtx}>
        /repo/node_modules/vitest/package.json
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await Promise.resolve();
    expect(editorApi.openEditor).toHaveBeenCalledWith(
      "/repo/.worktrees/x",
      "code",
      "/repo/.worktrees/x/node_modules/vitest/package.json",
      undefined,
    );
  });

  it("tooltip shows the re-rooted worktree path", () => {
    setHost("localhost");
    const { getByRole } = renderFL(
      <FileLink path="/repo/vitest.config.ts" line={3} absolute context={worktreeCtx}>
        /repo/vitest.config.ts:3
      </FileLink>,
    );
    const title = getByRole("button").getAttribute("title") ?? "";
    expect(title).toContain("/repo/.worktrees/x/vitest.config.ts");
  });

  it("leaves a foreign absolute path verbatim in a worktree session", async () => {
    setHost("localhost");
    const { getByRole } = renderFL(
      <FileLink path="/etc/hosts" absolute context={worktreeCtx}>
        /etc/hosts
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await Promise.resolve();
    expect(editorApi.openEditor).toHaveBeenCalledWith(
      "/repo/.worktrees/x",
      "code",
      "/etc/hosts",
      undefined,
    );
  });
});
