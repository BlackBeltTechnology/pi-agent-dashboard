/**
 * File-missing state of the editor pane: a tab whose file is gone shows `File no longer exists: <path>`
 * for every viewer kind; the Diff tab of the same file still renders from the session diff; the probe
 * is prompt-ineligible and leaves existing files untouched. Test-plan #X1–#X5.
 * See change: composer-dock-collapse-and-file-open (task 4.4, 4.15–4.19).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
// The registry is stubbed: these tests pin the existence probe, not the renderers.
vi.mock("../viewer-registry.js", () => ({
  viewerRegistry: new Proxy(
    {},
    { get: (_t, kind: string) => () => <div data-testid={`viewer-${kind}`} /> },
  ),
}));
vi.mock("../../diff/DiffPanel.js", () => ({
  DiffPanel: ({ file }: { file: { path: string; changes: unknown[] } }) => (
    <div data-testid="diff-panel" data-path={file.path} data-changes={file.changes.length} />
  ),
}));

import type { SessionDiffResponse } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { GRANT_CHANNEL_HEADER } from "../../../lib/access-grants/grant-channel.js";
import { __resetEditorLimitsConfig, hydrateEditorLimitsConfig } from "../../../lib/preview/editor-limits-config.js";
import { SessionDiffContext, type SessionDiffContextValue } from "../../diff/SessionDiffContext.js";
import { SplitWorkspaceProvider, useSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
import { EditorPane } from "../EditorPane.js";

const originalFetch = globalThis.fetch;
const calls: Array<{ url: string; headers: Headers }> = [];

function stubFetch(missing: readonly string[]) {
  calls.length = 0;
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.includes("/api/file?")) {
      const path = decodeURIComponent(new URL(url, "http://x").searchParams.get("path") ?? "");
      if (missing.includes(path)) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ success: false, error: "not found" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: { type: "file", size: 12 } }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: { entries: [] } }) });
  }) as unknown as typeof fetch;
}

const diffData: SessionDiffResponse = {
  isGitRepo: true,
  files: [{ path: "src/gone.ts", changes: [{ type: "write", timestamp: 0, content: "x" }] }],
} as unknown as SessionDiffResponse;
const diffValue: SessionDiffContextValue = { sessionId: "s1", data: diffData, isLoading: false, error: null, refresh: () => {} };

function Openers() {
  const { openInSplit, openDiffTab } = useSplitWorkspace();
  return (
    <>
      {["src/gone.ts", "docs/logo.png", "src/ok.ts"].map((p) => (
        <button key={p} type="button" data-testid={`open-${p}`} onClick={() => openInSplit(p)}>
          {p}
        </button>
      ))}
      <button type="button" data-testid="diff-gone" onClick={() => openDiffTab("src/gone.ts")}>
        diff
      </button>
    </>
  );
}

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });

function renderPane() {
  return render(
    <SessionDiffContext.Provider value={diffValue}>
      <SplitWorkspaceProvider sessionId="s1" cwd="/proj" orientation="h">
        <EditorPane />
        <Openers />
      </SplitWorkspaceProvider>
    </SessionDiffContext.Provider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  __resetEditorLimitsConfig();
  hydrateEditorLimitsConfig({ success: true, data: { editor: { largeFileLimitMb: 10 } } });
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  __resetEditorLimitsConfig();
});

describe("EditorPane file-missing state", () => {
  it("X1: a missing text file shows the message and mounts no viewer", async () => {
    stubFetch(["src/gone.ts"]);
    renderPane();
    fireEvent.click(screen.getByTestId("open-src/gone.ts"));
    await flush();
    expect(screen.getByTestId("editor-file-missing").textContent).toBe("File no longer exists: src/gone.ts");
    expect(screen.queryByTestId("viewer-monaco")).toBeNull();
  });

  it("X2: a missing image shows the same message naming its path, with no image viewer", async () => {
    stubFetch(["docs/logo.png"]);
    renderPane();
    fireEvent.click(screen.getByTestId("open-docs/logo.png"));
    await flush();
    expect(screen.getByTestId("editor-file-missing").textContent).toBe("File no longer exists: docs/logo.png");
    expect(screen.queryByTestId("viewer-image")).toBeNull();
  });

  it("X3: the missing file's Diff tab still renders from the session diff, without reading the disk", async () => {
    stubFetch(["src/gone.ts"]);
    renderPane();
    fireEvent.click(screen.getByTestId("diff-gone"));
    await flush();
    const panel = await screen.findByTestId("diff-panel"); // the diff viewer is lazy
    expect(panel.getAttribute("data-path")).toBe("src/gone.ts");
    expect(screen.queryByTestId("editor-file-missing")).toBeNull();
    expect(calls.filter((c) => c.url.includes("/api/file?")).length).toBe(0);
  });

  it("X4: the existence probe is declared prompt-ineligible (empty grant-channel header)", async () => {
    stubFetch([]);
    renderPane();
    fireEvent.click(screen.getByTestId("open-src/ok.ts"));
    await flush();
    const probe = calls.find((c) => c.url.includes("/api/file?") && c.url.includes("ok.ts"));
    expect(probe).toBeTruthy();
    expect(probe?.headers.has(GRANT_CHANNEL_HEADER)).toBe(true);
    expect(probe?.headers.get(GRANT_CHANNEL_HEADER)).toBe("");
  });

  it("X5: an existing file mounts its viewer as before, with no missing message", async () => {
    stubFetch([]);
    renderPane();
    fireEvent.click(screen.getByTestId("open-src/ok.ts"));
    await flush();
    expect(screen.getByTestId("viewer-monaco")).toBeTruthy();
    expect(screen.queryByTestId("editor-file-missing")).toBeNull();
  });
});
