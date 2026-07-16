import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FilePreviewHost, FilePreviewProvider } from "../../FilePreviewContext.js";
import { ThemeProvider } from "../../ThemeProvider.js";
import { FileLink } from "../FileLink.js";
import type { ToolContext } from "../types.js";

// FilePreviewOverlay reads ThemeProvider for syntax highlighting, so every
// render is wrapped.
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
// no FilePreviewProvider is mounted).
function renderFLNoProvider(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function mockFileFetch() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: { type: "file", content: "" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }) as any,
  );
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
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("click opens the in-dashboard preview overlay", async () => {
    const fetchSpy = mockFileFetch();
    const ctx: ToolContext = { cwd: "/Users/me/repo" };
    const { getByRole, findByTestId } = renderFL(
      <FileLink path="src/foo.ts" line={5} context={ctx}>
        src/foo.ts:5
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
    fetchSpy.mockRestore();
  });

  it("button is non-draggable and user-select:text so drag-select works", () => {
    const ctx: ToolContext = { cwd: "/Users/me/repo" };
    const { getByRole } = renderFL(
      <FileLink path="src/foo.ts" context={ctx}>
        src/foo.ts
      </FileLink>,
    );
    const button = getByRole("button") as HTMLButtonElement;
    expect(button.getAttribute("draggable")).toBe("false");
    expect(button.style.userSelect).toBe("text");
  });

  it("no provider → FileLink renders its own fallback preview overlay", async () => {
    const fetchSpy = mockFileFetch();
    const ctx: ToolContext = { cwd: "/Users/me/repo" };
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
    const ctx: ToolContext = { cwd: "/Users/me/repo" };
    const { getByRole } = renderFL(
      <FileLink path="src/foo.ts" line={42} context={ctx}>
        src/foo.ts:42
      </FileLink>,
    );
    const title = getByRole("button").getAttribute("title") ?? "";
    expect(title).toContain("Preview");
    expect(title).toContain("/Users/me/repo/src/foo.ts");
    expect(title).toContain(":42");
  });
});

describe("FileLink — absolute paths skip the cwd join", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("absolute path title is the path verbatim (not re-rooted under cwd)", () => {
    const ctx: ToolContext = { cwd: "/Users/me/repo" };
    const { getByRole } = renderFL(
      <FileLink path="/Users/other/app.ts" absolute context={ctx}>
        /Users/other/app.ts
      </FileLink>,
    );
    const title = getByRole("button").getAttribute("title") ?? "";
    expect(title).toContain("/Users/other/app.ts");
    expect(title).not.toContain("/Users/me/repo/Users");
  });

  it("absolute path preview overlay uses the absolute path", async () => {
    const fetchSpy = mockFileFetch();
    const ctx: ToolContext = { cwd: "/Users/me/repo" };
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
  const worktreeCtx: ToolContext = { cwd: "/repo/.worktrees/x" };

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("tooltip shows the re-rooted worktree path for a parent-rooted absolute path", () => {
    const { getByRole } = renderFL(
      <FileLink path="/repo/vitest.config.ts" line={3} absolute context={worktreeCtx}>
        /repo/vitest.config.ts:3
      </FileLink>,
    );
    const title = getByRole("button").getAttribute("title") ?? "";
    expect(title).toContain("/repo/.worktrees/x/vitest.config.ts");
  });

  it("leaves a foreign absolute path verbatim in a worktree session", () => {
    const { getByRole } = renderFL(
      <FileLink path="/etc/hosts" absolute context={worktreeCtx}>
        /etc/hosts
      </FileLink>,
    );
    const title = getByRole("button").getAttribute("title") ?? "";
    expect(title).toContain("/etc/hosts");
    expect(title).not.toContain("/repo/.worktrees/x/etc/hosts");
  });
});
