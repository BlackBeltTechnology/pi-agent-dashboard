import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkResolutionStore, makeLinkKey } from "../../../lib/chat/link-resolution-store.js";
import { loadEditorPaneState } from "../../../lib/layout/editor-pane-state.js";
import { fileIcon } from "../../../lib/preview/file-icon.js";
import { LinkResolutionProvider } from "../../chat/LinkResolutionProvider.js";
import { FilePreviewHost, FilePreviewProvider } from "../../preview/FilePreviewContext.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { SplitWorkspaceProvider } from "../../split/SplitWorkspaceContext.js";
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

  // fix-file-link-editor-routing S67: an absolute / `~/` link keeps the offline fallback on a resolve failure.
  it.each([
    { name: "network rejection", path: "/Users/other/app.ts", fail: "reject" },
    { name: "5xx", path: "~/notes/todo.md", fail: "500" },
  ])("absolute/tilde link: resolve $name → client-side open runs, NOT not-found (S67)", async ({ path, fail }) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      if (String(input).includes("/api/file/resolve-mention")) {
        if (fail === "reject") throw new TypeError("network down");
        return new Response("gateway boom", { status: 500, headers: { "Content-Type": "text/html" } }) as any;
      }
      return jsonResponse({ success: true, data: { type: "file", content: "" } });
    });
    const ctx: ToolContext = { cwd: "/Users/me/repo" };
    const { getByRole, findByTestId } = renderFL(
      <FileLink path={path} absolute context={ctx}>
        {path}
      </FileLink>,
    );
    const button = getByRole("button");
    fireEvent.click(button);
    const overlay = await findByTestId("file-preview-overlay");
    expect(overlay.textContent).toContain(path);
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

// ---------------------------------------------------------------------------------------------------------------
// Transcript link states (change: rich-chat-links). Everything below runs under `LinkResolutionProvider`, i.e. the
// dashboard transcript; "other surfaces" cases render without it.
// ---------------------------------------------------------------------------------------------------------------
class NeverVisibleIO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const LEGACY_HTML =
  '<button type="button" title="Preview /repo/src/foo.ts:3" aria-disabled="false" draggable="false" class="bg-transparent border-0 p-0 m-0 font-inherit text-[var(--link)] hover:underline cursor-pointer" style="font: inherit; user-select: text;">src/foo.ts:3</button>';

describe("FileLink — transcript link states", () => {
  const ctx: ToolContext = { cwd: "/repo", sessionId: "S" };
  let singleCalls: Record<string, unknown>[] = [];
  let singleReply: (b: Record<string, unknown>) => Response;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", NeverVisibleIO);
    localStorage.clear();
    singleCalls = [];
    singleReply = (b) => jsonResponse({ success: true, data: { resolved: `/repo/${String(b.mention)}`, kind: "relative" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      if (String(input).endsWith("/api/file/resolve-mention")) {
        const body = JSON.parse(init.body);
        singleCalls.push(body);
        return singleReply(body);
      }
      return jsonResponse({ success: true, data: { type: "file", content: "" } });
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function inProvider(store: LinkResolutionStore, ui: React.ReactElement) {
    return render(
      <ThemeProvider>
        <SplitWorkspaceProvider sessionId="S" cwd="/repo" orientation="h">
          <LinkResolutionProvider store={store} sessionId="S">
            {ui}
          </LinkResolutionProvider>
        </SplitWorkspaceProvider>
      </ThemeProvider>,
    );
  }
  const slotOf = (btn: Element) => btn.querySelector("[data-link-icon]") as HTMLElement;
  const glyphOf = (btn: Element) => slotOf(btn).querySelector("path")?.getAttribute("d");

  it.each([
    ["src/app.ts:12", "src/app.ts"],
    ["a/b.json", "a/b.json"],
    ["build/out.xyz1", "build/out.xyz1"],
    ["docs/x.MD", "docs/x.MD"],
  ])("carries the file-type icon of %s in a fixed, aria-hidden, text-free slot (E5)", (label, path) => {
    const { getByRole } = inProvider(
      new LinkResolutionStore(),
      <FileLink path={path} context={ctx}>
        {label}
      </FileLink>,
    );
    const btn = getByRole("button");
    const slot = slotOf(btn);
    expect(slot).toBeTruthy();
    expect(glyphOf(btn)).toBe(fileIcon(path).iconPath);
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(slot.getAttribute("width")).toBe("1em");
    expect(slot.getAttribute("height")).toBe("1em");
    expect(slot.textContent).toBe("");
    expect(btn.textContent).toBe(label);
    expect(slot.compareDocumentPosition(btn.lastChild as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // icon precedes the text
  });

  it("(a) under the provider: icon slot + data-link-state; (b) without it: DOM identical to before (E6)", () => {
    const link = (
      <FileLink path="src/foo.ts" line={3} context={ctx}>
        src/foo.ts:3
      </FileLink>
    );
    const a = inProvider(new LinkResolutionStore(), link);
    expect(slotOf(a.getByRole("button"))).toBeTruthy();
    expect(a.getByRole("button").getAttribute("data-link-state")).toBe("unknown");
    a.unmount();
    const b = render(<ThemeProvider>{link}</ThemeProvider>);
    expect(b.container.innerHTML).toBe(LEGACY_HTML);
  });

  it("renders every pre-confirmed state without replacing the element or changing its text or box (E39)", () => {
    const store = new LinkResolutionStore();
    const key = makeLinkKey("S", undefined, "src/a.ts");
    const { getByRole } = inProvider(
      store,
      <FileLink path="src/a.ts" context={ctx}>
        src/a.ts
      </FileLink>,
    );
    const btn = getByRole("button");
    const baseGlyph = glyphOf(btn);
    const baseBox = btn.getBoundingClientRect();
    const baseSlot = { w: slotOf(btn).getAttribute("width"), h: slotOf(btn).getAttribute("height") };
    const apply = (r: Parameters<LinkResolutionStore["apply"]>[1]) => act(() => store.apply(key, r));
    const invariants = () => {
      expect(getByRole("button")).toBe(btn);
      expect(btn.textContent).toBe("src/a.ts");
      const box = btn.getBoundingClientRect();
      expect([box.width, box.height]).toEqual([baseBox.width, baseBox.height]);
      expect({ w: slotOf(btn).getAttribute("width"), h: slotOf(btn).getAttribute("height") }).toEqual(baseSlot);
    };

    expect(btn.getAttribute("data-link-state")).toBe("unknown");
    apply({ state: "found", resolved: "/repo/src/a.ts", kind: "relative" });
    expect(btn.getAttribute("data-link-state")).toBe("found");
    expect(glyphOf(btn)).toBe(baseGlyph);
    invariants();

    apply({ state: "recovered", resolved: "/repo/packages/client/src/a.ts", kind: "fuzzy", via: "fuzzy" });
    expect(btn.getAttribute("data-link-state")).toBe("recovered");
    expect(btn.getAttribute("title")).toContain("packages/client/src/a.ts");
    invariants();

    apply({ state: "ambiguous", candidates: ["/repo/a/a.ts", "/repo/b/a.ts"] });
    expect(btn.getAttribute("data-link-state")).toBe("ambiguous");
    expect(glyphOf(btn)).not.toBe(baseGlyph);
    expect(btn.className).not.toContain("line-through");
    invariants();

    apply({ state: "gated" });
    expect(btn.getAttribute("data-link-state")).toBe("gated");
    expect(glyphOf(btn)).not.toBe(baseGlyph);
    expect(btn.className).not.toContain("line-through");
    invariants();

    apply({ state: "missing" });
    expect(btn.getAttribute("data-link-state")).toBe("missing");
    expect(btn.className).toContain("line-through");
    expect(glyphOf(btn)).toBe(baseGlyph);
    invariants();
  });

  it("a tool-directory hit shows the real path it opens (D4)", () => {
    const store = new LinkResolutionStore();
    const { getByRole } = inProvider(
      store,
      <FileLink path="src/a.ts" context={{ ...ctx, toolCwd: "packages/client" }}>
        src/a.ts
      </FileLink>,
    );
    act(() => store.apply(makeLinkKey("S", "packages/client", "src/a.ts"), { state: "found", resolved: "/repo/packages/client/src/a.ts", kind: "relative", via: "tool-dir" }));
    expect(getByRole("button").getAttribute("title")).toContain("packages/client/src/a.ts");
  });

  it("a result never swaps the link or collapses a selection across it (F1)", () => {
    const store = new LinkResolutionStore();
    const key = makeLinkKey("S", undefined, "src/foo.ts");
    const message = (
      <p data-testid="msg">
        error in{" "}
        <FileLink path="src/foo.ts" line={42} context={ctx}>
          src/foo.ts:42
        </FileLink>{" "}
        line
      </p>
    );
    const { getByTestId, getByRole } = inProvider(store, message);
    const p = getByTestId("msg");
    const first = p.firstChild as Text;
    const last = p.lastChild as Text;
    const link = getByRole("button");
    const sel = window.getSelection() as Selection;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.length);
    sel.removeAllRanges();
    sel.addRange(range);
    const snap = () => ({ a: sel.anchorNode, ao: sel.anchorOffset, f: sel.focusNode, fo: sel.focusOffset, link: p.querySelector("button"), text: link.textContent });
    const before = snap();

    act(() => store.apply(key, { state: "missing" }));

    expect(snap()).toEqual(before);
    expect(snap().link).toBe(link);
    expect(sel.toString()).toContain("error in");
    expect(sel.toString()).toContain("line");
  });

  it("mutation guard: the identity check in F1 does fail when the element is swapped", () => {
    const store = new LinkResolutionStore();
    const key = makeLinkKey("S", undefined, "src/foo.ts");
    // A deliberately broken link that remounts when its state changes.
    function Swapping() {
      const [n, setN] = useState(0);
      (globalThis as { __bump?: () => void }).__bump = () => setN((v) => v + 1);
      return (
        <p>
          <button key={n} type="button">
            src/foo.ts:42
          </button>
        </p>
      );
    }
    const { container } = inProvider(store, <Swapping />);
    const before = container.querySelector("button");
    act(() => {
      store.apply(key, { state: "missing" });
      (globalThis as { __bump?: () => void }).__bump?.();
    });
    expect(container.querySelector("button")).not.toBe(before);
  });

  it("a click re-resolves anew (recover + toolCwd) and wins over a cached missing (X2)", async () => {
    const store = new LinkResolutionStore();
    const { getByRole } = inProvider(
      store,
      <FileLink path="src/new.ts" context={{ ...ctx, toolCwd: "packages/client" }}>
        src/new.ts
      </FileLink>,
    );
    act(() => store.apply(makeLinkKey("S", "packages/client", "src/new.ts"), { state: "missing" }));
    expect(getByRole("button").getAttribute("data-link-state")).toBe("missing");

    fireEvent.click(getByRole("button")); // the file has been created since: the single resolve now finds it
    await waitFor(() => expect(loadEditorPaneState("S").openFiles.map((f) => f.path)).toEqual(["src/new.ts"]));
    expect(singleCalls[0]).toMatchObject({ cwd: "/repo", mention: "src/new.ts", recover: true, toolCwd: "packages/client" });
  });

  it("a click on a link that last resolved to nothing still asks again inside the transcript (X2)", async () => {
    singleReply = () => jsonResponse({ success: true, data: { resolved: null, state: "missing" } });
    const store = new LinkResolutionStore();
    const { getByRole } = inProvider(
      store,
      <FileLink path="src/x.ts" context={ctx}>
        src/x.ts
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(getByRole("button").getAttribute("data-not-found")).toBe("true"));
    singleReply = (b) => jsonResponse({ success: true, data: { resolved: `/repo/${String(b.mention)}`, kind: "relative" } });
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(singleCalls).toHaveLength(2));
    await waitFor(() => expect(loadEditorPaneState("S").openFiles.map((f) => f.path)).toEqual(["src/x.ts"]));
  });

  it("outside the provider a click sends the legacy request body (no recover / toolCwd)", async () => {
    const { getByRole } = render(
      <ThemeProvider>
        <FileLink path="src/foo.ts" context={{ ...ctx, toolCwd: "packages/client" }}>
          src/foo.ts
        </FileLink>
      </ThemeProvider>,
    );
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(singleCalls).toHaveLength(1));
    expect(singleCalls[0]).toEqual({ cwd: "/repo", mention: "src/foo.ts" });
  });
});

// HTML open-mode menu (change: rich-chat-links, test-plan #E26): a chevron next to an `.html` / `.htm` link, only in
// the same-session transcript. Observed through the real split workspace's persisted tab state.
describe("FileLink — HTML open-mode menu (E26)", () => {
  const ctx: ToolContext = { cwd: "/repo", sessionId: "S" };
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", NeverVisibleIO);
    localStorage.clear();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      if (String(input).endsWith("/api/file/resolve-mention")) {
        const body = JSON.parse(init.body);
        return jsonResponse({ success: true, data: { resolved: `/repo/${String(body.mention)}`, kind: "relative" } });
      }
      return jsonResponse({ success: true, data: { type: "file", content: "" } });
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  type Surface = "transcript" | "other-surface" | "other-session";
  function renderLink(path: string, surface: Surface) {
    const link = (
      <FileLink path={path} context={surface === "other-session" ? { ...ctx, sessionId: "OTHER" } : ctx}>
        {path}
      </FileLink>
    );
    return render(
      <ThemeProvider>
        <SplitWorkspaceProvider sessionId="S" cwd="/repo" orientation="h">
          {surface === "other-surface" ? link : <LinkResolutionProvider sessionId="S">{link}</LinkResolutionProvider>}
        </SplitWorkspaceProvider>
      </ThemeProvider>,
    );
  }
  const chevron = (r: ReturnType<typeof render>) => r.queryByTestId("link-html-menu-trigger");
  const tabs = () => loadEditorPaneState("S").openFiles;

  it.each([
    ["m/board.html", "transcript", true],
    ["m/x.htm", "transcript", true],
    ["m/a.ts", "transcript", false],
    ["m/board.html", "other-surface", false],
    ["m/x.htm", "other-surface", false],
    ["m/board.html", "other-session", false],
  ] as const)("%s in %s → chevron %s", (path, surface, shown) => {
    const r = renderLink(path, surface);
    expect(!!chevron(r)).toBe(shown);
    if (shown) {
      const c = chevron(r) as HTMLElement;
      expect(c.getAttribute("aria-label")).toBeTruthy();
      expect(c.getAttribute("draggable")).toBe("false");
      expect(c.textContent).toBe(""); // icon only: no text node
      expect(c.getAttribute("aria-haspopup")).toBe("menu");
      expect(c.parentElement?.closest("button")).toBeNull(); // sibling of the link button, never nested
      expect(r.container.querySelectorAll("button")).toHaveLength(2);
    }
  });

  it("a plain click on the link routes like any other file (no mode)", async () => {
    const r = renderLink("m/board.html", "transcript");
    fireEvent.click(r.getByText("m/board.html"));
    await waitFor(() => expect(tabs().map((f) => f.path)).toEqual(["m/board.html"]));
    expect(tabs()[0].htmlMode).toBeUndefined();
  });

  it("menu: Rendered opens the file as a plain click does", async () => {
    const r = renderLink("m/board.html", "transcript");
    fireEvent.click(chevron(r) as HTMLElement);
    fireEvent.click(await r.findByRole("menuitem", { name: /rendered/i }));
    await waitFor(() => expect(tabs().map((f) => f.path)).toEqual(["m/board.html"]));
    expect(tabs()[0].htmlMode).toBeUndefined();
  });

  it("menu: Static opens the file with htmlMode static", async () => {
    const r = renderLink("m/board.html", "transcript");
    fireEvent.click(chevron(r) as HTMLElement);
    fireEvent.click(await r.findByRole("menuitem", { name: /static/i }));
    await waitFor(() => expect(tabs().map((f) => f.path)).toEqual(["m/board.html"]));
    expect(tabs()[0].htmlMode).toBe("static");
  });

  it("menu: Source opens the read-only source tab under the absolute path", async () => {
    const r = renderLink("m/board.html", "transcript");
    fireEvent.click(chevron(r) as HTMLElement);
    fireEvent.click(await r.findByRole("menuitem", { name: /source/i }));
    await waitFor(() => expect(tabs().map((f) => f.path)).toEqual(["source:/repo/m/board.html"]));
    expect(tabs()[0].viewer).toBe("monaco");
  });

  it("a menu mode asks the server first: a missing file opens nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) =>
      String(input).endsWith("/api/file/resolve-mention")
        ? jsonResponse({ success: true, data: { resolved: null, state: "missing" } })
        : jsonResponse({ success: true, data: { type: "file", content: "" } }),
    );
    const r = renderLink("m/board.html", "transcript");
    fireEvent.click(chevron(r) as HTMLElement);
    fireEvent.click(await r.findByRole("menuitem", { name: /source/i }));
    await waitFor(() => expect(r.getByText("m/board.html").closest("button")?.getAttribute("data-not-found")).toBe("true"));
    expect(tabs()).toHaveLength(0);
  });
});

describe("FileLink — transcript pill (render-file-links-as-pill)", () => {
  const ctx: ToolContext = { cwd: "/repo", sessionId: "S" };
  function inProvider(store: LinkResolutionStore, ui: React.ReactElement) {
    return render(
      <ThemeProvider>
        <SplitWorkspaceProvider sessionId="S" cwd="/repo" orientation="h">
          <LinkResolutionProvider store={store} sessionId="S">
            {ui}
          </LinkResolutionProvider>
        </SplitWorkspaceProvider>
      </ThemeProvider>,
    );
  }
  const pillOf = (r: ReturnType<typeof render>) => r.container.querySelector("[data-file-link-pill]") as HTMLElement | null;

  it("wraps glyph, name and the HTML chevron in one no-wrap pill", () => {
    const r = inProvider(new LinkResolutionStore(), <FileLink path="m/board.html" context={ctx}>m/board.html</FileLink>);
    const pill = pillOf(r);
    expect(pill).toBeTruthy();
    expect(pill?.className).toContain("whitespace-nowrap");
    expect(pill?.className).toContain("inline-flex");
    expect(pill?.querySelector("[data-link-icon]")).toBeTruthy();
    expect(pill?.contains(r.getByTestId("link-html-menu-trigger"))).toBe(true);
    expect(pill?.textContent).toBe("m/board.html");
  });

  it("truncates the name from the start but keeps the full path as text", () => {
    const path = "~/other-repo/secrets.ts";
    const r = inProvider(new LinkResolutionStore(), <FileLink path={path} context={ctx}>{path}</FileLink>);
    const name = r.container.querySelector("[data-file-link-name]") as HTMLElement;
    expect(name).toBeTruthy();
    expect(name.className).toContain("truncate");
    expect(name.style.direction).toBe("rtl");
    const bdi = name.querySelector("bdi");
    expect(bdi?.getAttribute("dir")).toBe("ltr");
    expect(bdi?.textContent).toBe(path);
    expect(r.getByRole("button").textContent).toBe(path);
  });

  it("styles the pill per link state and keeps state attributes on the link button", () => {
    const store = new LinkResolutionStore();
    const key = makeLinkKey("S", undefined, "src/a.ts");
    const r = inProvider(store, <FileLink path="src/a.ts" context={ctx}>src/a.ts</FileLink>);
    const btn = r.getByRole("button");
    const pill = () => pillOf(r) as HTMLElement;
    act(() => store.apply(key, { state: "found", resolved: "/repo/src/a.ts", kind: "relative" }));
    expect(pill().className).toContain("bg-[var(--bg-secondary)]");
    expect(pill().className).toContain("text-[var(--link)]");
    act(() => store.apply(key, { state: "gated" }));
    expect(pill().className).toContain("text-[var(--text-secondary)]");
    act(() => store.apply(key, { state: "missing" }));
    expect(pill().className).toContain("border-dashed");
    expect(pill().className).toContain("text-[var(--text-muted)]");
    expect(btn.className).toContain("line-through");
    expect(btn.getAttribute("data-link-state")).toBe("missing");
  });

  it("drops its own chrome inside inline code", () => {
    const r = inProvider(new LinkResolutionStore(), <FileLink path="src/a.ts" context={ctx}>src/a.ts</FileLink>);
    expect(pillOf(r)?.className).toContain("[code_&]:border-0");
    expect(pillOf(r)?.className).toContain("[code_&]:bg-transparent");
  });

  it("tool-output links (no provider) get no pill", () => {
    const r = render(<ThemeProvider><FileLink path="src/a.ts" context={ctx}>src/a.ts</FileLink></ThemeProvider>);
    expect(pillOf(r)).toBeNull();
    expect(r.container.querySelector("[data-file-link-name]")).toBeNull();
  });
});
