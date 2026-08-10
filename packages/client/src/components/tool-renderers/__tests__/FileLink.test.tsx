import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FilePreviewHost, FilePreviewProvider } from "../../preview/FilePreviewContext.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
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

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as any;
}

// Route `fetch`: the `/api/file/resolve-mention` POST is answered by `resolve`
// (defaulting to echoing the mention back as the resolved path); every other
// call (the preview overlay's `/api/file` GET) returns empty file content.
function mockFetchRouting(
  resolve: (mention: string) => Response = (m) =>
    jsonResponse({ success: true, data: { resolved: m, kind: "relative" } }),
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("/api/file/resolve-mention")) {
      const mention = init?.body ? JSON.parse(init.body).mention : "";
      return resolve(mention);
    }
    return jsonResponse({ success: true, data: { type: "file", content: "" } });
  });
}

// Back-compat alias for the existing overlay-open tests.
function mockFileFetch() {
  return mockFetchRouting();
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

describe("FileLink — lazy resolve-on-click", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("click resolves the mention and opens the server-resolved path (S13)", async () => {
    const serverPath = "/Users/me/.pi/agent/settings.json";
    const fetchSpy = mockFetchRouting(() =>
      jsonResponse({ success: true, data: { resolved: serverPath, kind: "tilde" } }),
    );
    const ctx: ToolContext = { cwd: "/Users/me/repo" };
    const { getByRole, findByTestId } = renderFL(
      <FileLink path="~/.pi/agent/settings.json" absolute context={ctx}>
        ~/.pi/agent/settings.json
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    const overlay = await findByTestId("file-preview-overlay");
    // Opened the SERVER-resolved path, not a `/`-rooted or verbatim `~/` path.
    expect(overlay.textContent).toContain(serverPath);
    // The resolve endpoint was actually consulted.
    expect(
      fetchSpy.mock.calls.some(([u]) => String(u).includes("/api/file/resolve-mention")),
    ).toBe(true);
  });

  it("null resolution shows an inline not-found affordance and makes NO open call (S14)", async () => {
    const fetchSpy = mockFetchRouting(() =>
      jsonResponse({ success: true, data: { resolved: null } }),
    );
    const ctx: ToolContext = { cwd: "/Users/me/repo" };
    const { getByRole, queryByTestId } = renderFL(
      <FileLink path="ghost.ts" context={ctx}>
        ghost.ts
      </FileLink>,
    );
    const button = getByRole("button");
    fireEvent.click(button);
    // Let the async resolve settle.
    await vi.waitFor(() => expect(button.getAttribute("data-not-found")).toBe("true"));
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.className).toContain("line-through");
    // No preview overlay opened (no open call).
    expect(queryByTestId("file-preview-overlay")).toBeNull();
    // Exactly one fetch — the resolve — and never an `/api/file` open.
    expect(fetchSpy.mock.calls.every(([u]) => String(u).includes("/api/file/resolve-mention"))).toBe(
      true,
    );
  });

  it("a resolve request FAILURE falls back to client-side open, not treated as null (S15)", async () => {
    // 5xx with a non-JSON body → fetchJson throws (transport failure).
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes("/api/file/resolve-mention")) {
        return new Response("gateway boom", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }) as any;
      }
      return jsonResponse({ success: true, data: { type: "file", content: "" } });
    });
    const ctx: ToolContext = { cwd: "/Users/me/repo" };
    const { getByRole, findByTestId } = renderFL(
      <FileLink path="src/foo.ts" context={ctx}>
        src/foo.ts
      </FileLink>,
    );
    const button = getByRole("button");
    fireEvent.click(button);
    // Fallback opened the preview overlay (client-side path), NOT a not-found.
    const overlay = await findByTestId("file-preview-overlay");
    expect(overlay.textContent).toContain("src/foo.ts");
    expect(button.getAttribute("data-not-found")).toBeNull();
    fetchSpy.mockRestore();
  });

  it("opens the server path exactly — no double resolveLinkOrigin re-root (S16)", async () => {
    const serverPath = "/repo/.worktrees/x/vitest.config.ts";
    const fetchSpy = mockFetchRouting(() =>
      jsonResponse({ success: true, data: { resolved: serverPath, kind: "abs" } }),
    );
    // Worktree session + a parent-rooted absolute token: the client must NOT
    // re-root the server path a second time.
    const ctx: ToolContext = { cwd: "/repo/.worktrees/x" };
    const { getByRole, findByTestId } = renderFL(
      <FileLink path="/repo/vitest.config.ts" absolute context={ctx}>
        /repo/vitest.config.ts
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    const overlay = await findByTestId("file-preview-overlay");
    expect(overlay.textContent).toContain(serverPath);
    // Not re-rooted twice into `/repo/.worktrees/x/repo/...`.
    expect(overlay.textContent).not.toContain("/x/repo/vitest.config.ts");
    fetchSpy.mockRestore();
  });

  it("fires zero resolve calls until a click (lazy render invariant, S18)", () => {
    const fetchSpy = mockFetchRouting();
    const ctx: ToolContext = { cwd: "/Users/me/repo" };
    renderFL(
      <div>
        <FileLink path="a.ts" context={ctx}>a.ts</FileLink>
        <FileLink path="b.ts" context={ctx}>b.ts</FileLink>
        <FileLink path="c.ts" context={ctx}>c.ts</FileLink>
      </div>,
    );
    // Mount alone must not touch the network.
    expect(fetchSpy).not.toHaveBeenCalled();
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
