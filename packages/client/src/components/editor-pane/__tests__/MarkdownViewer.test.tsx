/**
 * Markdown Preview/Edit toggle + save (#4).
 *
 * - `.md`/`.mdx` (editable) show a Preview/Edit toggle; Edit mounts
 *   MarkdownEditor. `.markdown` stays read-only (no Edit affordance).
 * - Save → POST /api/file/write with the loaded mtime; 200 clears dirty,
 *   409 surfaces the changed-on-disk banner.
 *
 * See change: improve-content-editor (tasks §5).
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../monaco-setup.js", () => ({}));
vi.mock("../../../lib/theme/monaco-theme.js", () => ({
  buildMonacoTheme: () => ({ name: "t", data: {} }),
}));
// Controllable Monaco editor stub → a textarea wired to onChange.
vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="monaco-textarea"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));
// Keep MarkdownContent light.
const imageBases: unknown[] = [];
const mermaidSources: unknown[] = [];
vi.mock("../../preview/MarkdownContent.js", () => ({
  MarkdownContent: ({ content, imageBase, mermaidSource }: { content: string; imageBase?: unknown; mermaidSource?: unknown }) => {
    imageBases.push(imageBase);
    mermaidSources.push(mermaidSource);
    return <div data-testid="md-preview">{content}</div>;
  },
}));

import { LiveSessionCwdsProvider } from "../../../lib/preview/use-mermaid-source.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import MarkdownViewer from "../MarkdownViewer.js";
import { unsavedKey, unsavedStore } from "../unsaved-store.js";

const originalFetch = globalThis.fetch;

/** Programmable write-response for the POST leg. */
let writeResponse: { status: number; body: unknown };
/** When set, the POST leg is answered by this instead (pending / rejecting writes). */
let writeHook: ((init: RequestInit) => Promise<unknown>) | null = null;

function mockFetch(content = "# hi", mtime = 123) {
  globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (writeHook) return writeHook(init);
      return Promise.resolve({
        status: writeResponse.status,
        json: () => Promise.resolve(writeResponse.body),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { type: "file", content, mtime } }),
    });
  }) as unknown as typeof fetch;
}

function renderViewer(path: string) {
  return render(
    <ThemeProvider>
      <MarkdownViewer cwd="/proj" path={path} kind="markdown" mimeType="text/markdown" size={0} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null,
  })) as unknown as typeof window.matchMedia;
  writeResponse = { status: 200, body: { success: true, data: { mtime: 456 } } };
  writeHook = null;
  mockFetch();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("MarkdownViewer — Preview/Edit (#4)", () => {
  it("shows a Preview/Edit toggle for .md and switches to the editor", async () => {
    renderViewer("notes.md");
    await screen.findByTestId("md-preview");
    const editBtn = screen.getByTestId("md-edit-toggle");
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn);
    expect(await screen.findByTestId("monaco-textarea")).toBeTruthy();
  });

  it("does not offer edit for read-only .markdown", async () => {
    renderViewer("notes.markdown");
    await screen.findByTestId("md-preview");
    expect(screen.queryByTestId("md-edit-toggle")).toBeNull();
  });

  it("save success clears dirty", async () => {
    renderViewer("notes.md");
    await screen.findByTestId("md-preview");
    fireEvent.click(screen.getByTestId("md-edit-toggle"));
    const ta = await screen.findByTestId("monaco-textarea");
    fireEvent.change(ta, { target: { value: "# edited" } });
    // Dirty → Save enabled.
    const saveBtn = screen.getByTestId("md-save-btn");
    expect(saveBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(saveBtn);
    await waitFor(() => expect(screen.getByTestId("md-save-btn").hasAttribute("disabled")).toBe(true));
  });

  it("mtime conflict (409) shows the changed-on-disk banner", async () => {
    writeResponse = { status: 409, body: { success: false, error: "changed" } };
    renderViewer("notes.md");
    await screen.findByTestId("md-preview");
    fireEvent.click(screen.getByTestId("md-edit-toggle"));
    const ta = await screen.findByTestId("monaco-textarea");
    fireEvent.change(ta, { target: { value: "# edited" } });
    fireEvent.click(screen.getByTestId("md-save-btn"));
    expect(await screen.findByTestId("changed-on-disk-banner")).toBeTruthy();
  });
});

// fix-file-link-editor-routing S75 (cross-version compat): a server that predates write-mode grants answers an
// out-of-cwd save with the flat pre-change 403 — the viewer shows the existing error and does not crash.
describe("MarkdownViewer — pre-change flat 403 on save (S75)", () => {
  it("surfaces the server error text and does not crash", async () => {
    writeResponse = { status: 403, body: { success: false, error: "path outside working directory" } };
    renderViewer("/Users/u/Downloads/x.md");
    await screen.findByTestId("md-preview");
    fireEvent.click(screen.getByTestId("md-edit-toggle"));
    const ta = await screen.findByTestId("monaco-textarea");
    fireEvent.change(ta, { target: { value: "# edited" } });
    fireEvent.click(screen.getByTestId("md-save-btn"));
    expect(await screen.findByText("path outside working directory")).toBeTruthy();
    // The refusal does not discard the edit: still in the editor, still dirty.
    expect((screen.getByTestId("monaco-textarea") as HTMLTextAreaElement).value).toBe("# edited");
    expect(screen.getByTestId("md-dirty-dot")).toBeTruthy();
    // The save really went out (no client-side gate swallowed it).
    const posts = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(posts).toHaveLength(1);
  });
});

const postCalls = () =>
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST",
  );

async function editOutside(text = "# edited") {
  renderViewer("/Users/u/Downloads/x.md");
  await screen.findByTestId("md-preview");
  fireEvent.click(screen.getByTestId("md-edit-toggle"));
  fireEvent.change(await screen.findByTestId("monaco-textarea"), { target: { value: text } });
}

// fix-file-link-editor-routing S50: while the write prompt is pending the POST is unresolved; Save must lock.
describe("MarkdownViewer — Save double activation (S50)", () => {
  it("disables Save, shows Saving…, and sends exactly one POST for two clicks", async () => {
    let release: (v: unknown) => void = () => {};
    writeHook = () => new Promise((r) => { release = r; });
    await editOutside();
    const btn = screen.getByTestId("md-save-btn");
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("md-save-btn").hasAttribute("disabled")).toBe(true));
    expect(screen.getByTestId("md-save-btn").textContent).toContain("Saving…");
    expect(postCalls()).toHaveLength(1);
    release({ status: 200, json: () => Promise.resolve({ success: true, data: { mtime: 456 } }) });
    await waitFor(() => expect(screen.getByTestId("md-save-btn").textContent).not.toContain("Saving…"));
  });
});

// fix-file-link-editor-routing S72: a refused/failed save keeps the buffer; 409 → banner; 200 → clean + new mtime.
describe("MarkdownViewer — save refused keeps the buffer (S72)", () => {
  const refusals: Array<[string, () => void, string]> = [
    ["403", () => { writeResponse = { status: 403, body: { success: false, error: "path outside working directory — write not granted" } }; }, "write not granted"],
    ["500", () => { writeResponse = { status: 500, body: { success: false, error: "disk exploded" } }; }, "disk exploded"],
    ["500 without an error body", () => { writeResponse = { status: 500, body: { success: false } }; }, "Save failed (500)"],
    ["rejected fetch", () => { writeHook = () => Promise.reject(new Error("socket hang up")); }, "socket hang up"],
  ];

  it.each(refusals)("%s: error shown, tab stays dirty, buffer and editor intact", async (_n, arrange, message) => {
    arrange();
    await editOutside("# my unsaved work");
    fireEvent.click(screen.getByTestId("md-save-btn"));
    expect(await screen.findByText((c) => c.includes(message))).toBeTruthy();
    // Nothing was cleared: editor still mounted with the typed text, dirty dot up, Save re-enabled.
    expect((screen.getByTestId("monaco-textarea") as HTMLTextAreaElement).value).toBe("# my unsaved work");
    expect(screen.getByTestId("md-dirty-dot")).toBeTruthy();
    expect(screen.getByTestId("md-save-btn").hasAttribute("disabled")).toBe(false);
  });

  it("a later successful save clears the error", async () => {
    writeResponse = { status: 403, body: { success: false, error: "write not granted" } };
    await editOutside();
    fireEvent.click(screen.getByTestId("md-save-btn"));
    await screen.findByText(/write not granted/);
    writeResponse = { status: 200, body: { success: true, data: { mtime: 456 } } };
    fireEvent.click(screen.getByTestId("md-save-btn"));
    await waitFor(() => expect(screen.queryByText(/write not granted/)).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("md-dirty-dot")).toBeNull());
  });

  it("409: ChangedOnDiskBanner shown and the buffer is kept", async () => {
    writeResponse = { status: 409, body: { success: false, error: "changed" } };
    await editOutside("# mine");
    fireEvent.click(screen.getByTestId("md-save-btn"));
    expect(await screen.findByTestId("changed-on-disk-banner")).toBeTruthy();
    expect((screen.getByTestId("monaco-textarea") as HTMLTextAreaElement).value).toBe("# mine");
    expect(screen.getByTestId("md-dirty-dot")).toBeTruthy();
  });

  it("200: dirty clears and the next save carries the updated mtime", async () => {
    await editOutside("# one");
    fireEvent.click(screen.getByTestId("md-save-btn"));
    await waitFor(() => expect(screen.queryByTestId("md-dirty-dot")).toBeNull());
    fireEvent.change(screen.getByTestId("monaco-textarea"), { target: { value: "# two" } });
    fireEvent.click(screen.getByTestId("md-save-btn"));
    await waitFor(() => expect(postCalls()).toHaveLength(2));
    const sent = postCalls().map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(sent[0].mtime).toBe(123);
    expect(sent[1].mtime).toBe(456);
  });
});

// fix-file-link-editor-routing S73: an ungranted outside load shows the denial flow and no content bytes.
describe("MarkdownViewer — ungranted outside load (S73)", () => {
  it("renders DenialNotice for a 403 with a denial payload and no file text", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({
            success: false,
            error: "path outside working directory — read not granted",
            reason: "outside-cwd",
            hint: "grant access",
            subject: "/Users/u/Downloads/secret.md",
            denialId: "d-1",
            ancestors: ["/Users/u"],
            promptOutcome: "declined",
          }),
      }),
    ) as unknown as typeof fetch;
    renderViewer("/Users/u/Downloads/secret.md");
    expect(await screen.findByTestId("denial-notice")).toBeTruthy();
    expect(screen.queryByTestId("md-preview")).toBeNull();
    expect(screen.queryByTestId("md-edit-toggle")).toBeNull();
    expect(document.body.textContent).not.toContain("TOP-SECRET-BODY");
  });
});

// See change: fix-markdown-remount-storm (D3; test-plan F6, F7)
describe("MarkdownViewer imageBase identity", () => {
  const el = (path: string) => (
    <ThemeProvider>
      <MarkdownViewer cwd="/proj" path={path} kind="markdown" mimeType="text/markdown" size={0} />
    </ThemeProvider>
  );

  it("passes a stable imageBase across re-renders and a new one when path changes", async () => {
    imageBases.length = 0;
    const { rerender } = render(el("docs/a.md"));
    await screen.findByTestId("md-preview");
    rerender(el("docs/a.md"));
    const seen = imageBases.filter(Boolean);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1);

    imageBases.length = 0;
    rerender(el("other/b.md"));
    await waitFor(() => expect(imageBases.some((b) => b && (b as { dir: string }).dir.endsWith("other"))).toBe(true));
  });
});

// Review B1: the imageBase hook must be declared before the `loadFailure` early
// return, else a refused load followed by a successful one changes hook order.
describe("MarkdownViewer hook order across a refused load", () => {
  it("recovers from a 404 target to a loadable one without a hook-order crash", async () => {
    globalThis.fetch = vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes("gone.md")
          ? { ok: false, status: 404, json: () => Promise.resolve({}) }
          : { ok: true, status: 200, json: () => Promise.resolve({ success: true, data: { type: "file", content: "# ok", mtime: 1 } }) },
      ),
    ) as unknown as typeof fetch;
    const el = (path: string) => (
      <ThemeProvider>
        <MarkdownViewer cwd="/proj" path={path} kind="markdown" mimeType="text/markdown" size={0} />
      </ThemeProvider>
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const winErrors: string[] = [];
    const onErr = (e: ErrorEvent) => { winErrors.push(e.message); e.preventDefault(); };
    window.addEventListener("error", onErr);
    const { rerender } = render(el("gone.md"));
    await waitFor(() => expect(screen.queryByTestId("md-preview")).toBeNull());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {}); // flush the 404 into loadFailure
    rerender(el("fine.md"));
    expect(await screen.findByTestId("md-preview")).toBeTruthy();
    const hookErrors = errSpy.mock.calls.filter((c) => /hooks/i.test(String(c[0]) + String(c[1] ?? "")));
    window.removeEventListener("error", onErr);
    expect(hookErrors).toEqual([]);
    expect(winErrors.filter((m) => /hooks/i.test(m))).toEqual([]);
  });
});

// See change: add-preview-apply-fix-to-file (design D6; test-plan F8, F9)
describe("MarkdownViewer mermaidSource", () => {
  const el = (cwd: string, live: string) => (
    <ThemeProvider>
      <LiveSessionCwdsProvider cwdKey={live}>
        <MarkdownViewer cwd={cwd} path="docs/a.md" kind="markdown" mimeType="text/markdown" size={0} />
      </LiveSessionCwdsProvider>
    </ThemeProvider>
  );
  const lastSource = () => mermaidSources[mermaidSources.length - 1] as Record<string, unknown> | null;

  it("is stable across re-renders and is null for a non-live cwd", async () => {
    mermaidSources.length = 0;
    const { rerender } = render(el("/proj", "/proj"));
    await screen.findByTestId("md-preview");
    const first = lastSource();
    expect(first).toMatchObject({ cwd: "/proj", path: "docs/a.md", kind: "md", isDirty: false });
    rerender(el("/proj", "/proj"));
    expect(Object.is(lastSource(), first)).toBe(true);
    cleanup();
    mermaidSources.length = 0;
    render(el("/proj", "/other"));
    await screen.findByTestId("md-preview");
    expect(lastSource()).toBeNull();
  });

  it("flags unsaved edits as isDirty", async () => {
    mermaidSources.length = 0;
    render(el("/proj", "/proj"));
    await screen.findByTestId("md-preview");
    fireEvent.click(screen.getByTestId("md-edit-toggle"));
    fireEvent.change(await screen.findByTestId("monaco-textarea"), { target: { value: "# edited" } });
    fireEvent.click(screen.getByTestId("md-preview-toggle"));
    await screen.findByTestId("md-preview");
    expect(lastSource()).toMatchObject({ isDirty: true });
  });
});

// fix-file-link-editor-routing 4.1 / 4.3 / 4.10 (S42 / S44 / S64): the viewer publishes {dirty, save} to the unsaved store.
describe("MarkdownViewer — unsaved store (S42, S44, S64)", () => {
  const key = unsavedKey("", "notes.md");
  async function editNotes(text: string) {
    const view = renderViewer("notes.md");
    await screen.findByTestId("md-preview");
    fireEvent.click(screen.getByTestId("md-edit-toggle"));
    fireEvent.change(await screen.findByTestId("monaco-textarea"), { target: { value: text } });
    return view;
  }
  const type = (v: string) => fireEvent.change(screen.getByTestId("monaco-textarea"), { target: { value: v } });

  it("S42: dirty is true only while the buffer differs from the loaded content", async () => {
    await editNotes("# hi");
    expect(unsavedStore.hasUnsaved([key])).toBe(false);
    type("# hi!");
    await waitFor(() => expect(unsavedStore.hasUnsaved([key])).toBe(true));
    type("# hi");
    await waitFor(() => expect(unsavedStore.hasUnsaved([key])).toBe(false));
    type("# hi again");
    await waitFor(() => expect(unsavedStore.hasUnsaved([key])).toBe(true));
    fireEvent.click(screen.getByTestId("md-save-btn"));
    await waitFor(() => expect(unsavedStore.hasUnsaved([key])).toBe(false));
  });

  it("S44: dialog Save ok resolves true and writes the buffer", async () => {
    await editNotes("# mine");
    const p = unsavedStore.confirmLeave([key]);
    unsavedStore.resolveDialog("save");
    await expect(p).resolves.toBe(true);
    expect(postCalls()).toHaveLength(1);
  });

  it.each([
    ["409", () => { writeResponse = { status: 409, body: { success: false } }; }, "changed-on-disk-banner"],
    ["403", () => { writeResponse = { status: 403, body: { success: false, error: "write not granted" } }; }, "md-save-error"],
    ["network error", () => { writeHook = () => Promise.reject(new Error("down")); }, "md-save-error"],
  ])("S44: dialog Save → %s resolves false, buffer intact, error/banner shown", async (_n, arrange, testId) => {
    arrange();
    await editNotes("# mine");
    const p = unsavedStore.confirmLeave([key]);
    unsavedStore.resolveDialog("save");
    await expect(p).resolves.toBe(false);
    expect(await screen.findByTestId(testId)).toBeTruthy();
    expect((screen.getByTestId("monaco-textarea") as HTMLTextAreaElement).value).toBe("# mine");
    expect(unsavedStore.hasUnsaved([key])).toBe(true);
  });

  it("S44: dialog Discard drops the buffer without a write; Cancel keeps it", async () => {
    await editNotes("# mine");
    let p = unsavedStore.confirmLeave([key]);
    unsavedStore.resolveDialog("cancel");
    await expect(p).resolves.toBe(false);
    expect((screen.getByTestId("monaco-textarea") as HTMLTextAreaElement).value).toBe("# mine");
    p = unsavedStore.confirmLeave([key]);
    unsavedStore.resolveDialog("discard");
    await expect(p).resolves.toBe(true);
    await waitFor(() => expect((screen.getByTestId("monaco-textarea") as HTMLTextAreaElement).value).toBe("# hi"));
    expect(postCalls()).toHaveLength(0);
    expect(unsavedStore.hasUnsaved([key])).toBe(false);
  });

  it("S64: unmounting a dirty viewer removes its entry", async () => {
    const { unmount } = await editNotes("# mine");
    expect(unsavedStore.hasUnsaved([key])).toBe(true);
    unmount();
    expect(unsavedStore.hasUnsaved([key])).toBe(false);
    await expect(unsavedStore.confirmLeave()).resolves.toBe(true);
  });
});
