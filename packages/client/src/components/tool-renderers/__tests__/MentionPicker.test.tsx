/**
 * Ambiguous mentions offer a picker (change: rich-chat-links, test-plan #E40; design D3).
 * Pattern: FileLink.test.tsx — the picker is driven through a transcript `FileLink`.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkResolutionStore } from "../../../lib/chat/link-resolution-store.js";
import { loadEditorPaneState } from "../../../lib/layout/editor-pane-state.js";
import { LinkResolutionProvider } from "../../chat/LinkResolutionProvider.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { SplitWorkspaceProvider } from "../../split/SplitWorkspaceContext.js";
import { FileLink } from "../FileLink.js";
import type { ToolContext } from "../types.js";

class NeverVisibleIO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const FOUR = ["/repo/a/tasks.md", "/repo/b/tasks.md", "/repo/c/tasks.md", "/repo/d/tasks.md"];
let candidates: string[] = FOUR;
let singleCalls = 0;

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});
beforeEach(() => {
  localStorage.clear();
  candidates = FOUR;
  singleCalls = 0;
  vi.stubGlobal("IntersectionObserver", NeverVisibleIO);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(input).endsWith("/api/file/resolve-mention")) {
      singleCalls++;
      return ok({ state: "ambiguous", resolved: null, candidates });
    }
    return ok({ type: "file", content: "" });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ctx: ToolContext = { cwd: "/repo", sessionId: "S" };
function renderLink() {
  return render(
    <ThemeProvider>
      <SplitWorkspaceProvider sessionId="S" cwd="/repo" orientation="h">
        <LinkResolutionProvider store={new LinkResolutionStore()} sessionId="S">
          <FileLink path="tasks.md" context={ctx}>
            tasks.md
          </FileLink>
        </LinkResolutionProvider>
      </SplitWorkspaceProvider>
    </ThemeProvider>,
  );
}
const opened = () => loadEditorPaneState("S").openFiles.map((f) => f.path);
async function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: "tasks.md" }));
  return screen.findByRole("listbox");
}

describe("MentionPicker (E40)", () => {
  it("lists the candidates in server order and opens nothing until one is picked", async () => {
    renderLink();
    const list = await openPicker();
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["a/tasks.md", "b/tasks.md", "c/tasks.md", "d/tasks.md"]);
    expect(opened()).toEqual([]);
  });

  it("picking the 2nd opens exactly that file once and closes the picker", async () => {
    renderLink();
    const list = await openPicker();
    fireEvent.click(within(list).getAllByRole("option")[1]);
    await waitFor(() => expect(opened()).toEqual(["b/tasks.md"]));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes the picker without opening anything", async () => {
    renderLink();
    const list = await openPicker();
    fireEvent.keyDown(list, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(opened()).toEqual([]);
  });

  it("a backdrop click closes it without opening anything; the link can be reopened", async () => {
    renderLink();
    await openPicker();
    fireEvent.click(screen.getByTestId("mention-picker-backdrop"));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(opened()).toEqual([]);
    expect(await openPicker()).toBeTruthy();
    expect(singleCalls).toBe(2); // a click always resolves anew
  });

  it("↓ ↓ Enter picks the third candidate", async () => {
    renderLink();
    const list = await openPicker();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    await waitFor(() => expect(opened()).toEqual(["c/tasks.md"]));
  });

  it("a single candidate is still offered, never opened without the user's choice", async () => {
    candidates = ["/repo/only/tasks.md"];
    renderLink();
    const list = await openPicker();
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    expect(opened()).toEqual([]);
    fireEvent.click(within(list).getByRole("option"));
    await waitFor(() => expect(opened()).toEqual(["only/tasks.md"]));
  });

  it("is a labelled dialog and returns focus to the link when closed", async () => {
    renderLink();
    const link = screen.getByRole("button", { name: "tasks.md" });
    const list = await openPicker();
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBeTruthy();
    expect(document.activeElement).toBe(list);
    fireEvent.keyDown(list, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(link));
  });
});
