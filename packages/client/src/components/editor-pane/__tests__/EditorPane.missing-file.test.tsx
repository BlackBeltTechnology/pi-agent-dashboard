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
import { EDITOR_PANE_KEY_PREFIX } from "../../../lib/layout/editor-pane-state.js";
import { __resetArchiveCache } from "../../../lib/openspec/archive-cache.js";
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
    // Microtask flush (mocked fetch + state), deterministic under load.
    for (let i = 0; i < 20; i++) await Promise.resolve();
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
  __resetArchiveCache();
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

// ── Archived copy of a moved change artifact ─────────────────────────────────
// See change: fix-archived-session-view-header-and-stale-artifact-tab (D2, D3).
const STALE = "openspec/changes/add-x/proposal.md";
const ARCHIVED = "openspec/changes/archive/2026-10-22-add-x/proposal.md";
const entry = (name: string) => ({ name, date: name.slice(0, 10), artifacts: [] });

type ArchiveReply = { kind: "ok"; entries: ReturnType<typeof entry>[] } | { kind: "fail" } | { kind: "reject" } | { kind: "held" };
let releaseArchive: (() => void) | null = null;

function stubArchiveFetch(missing: readonly string[], archive: ArchiveReply) {
  calls.length = 0;
  releaseArchive = null;
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.includes("/api/openspec-archive")) {
      if (archive.kind === "reject") return Promise.reject(new Error("network"));
      if (archive.kind === "fail") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: false, error: "boom" }) });
      }
      const entries = archive.kind === "ok" ? archive.entries : [entry("2026-10-22-add-x")];
      const reply = { ok: true, status: 200, json: () => Promise.resolve({ success: true, data: entries }) };
      if (archive.kind === "held") {
        return new Promise((resolve) => {
          releaseArchive = () => resolve(reply);
        });
      }
      return Promise.resolve(reply);
    }
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

const archiveCalls = () => calls.filter((c) => c.url.includes("/api/openspec-archive"));
const persisted = () => {
  const raw = JSON.parse(localStorage.getItem(`${EDITOR_PANE_KEY_PREFIX}s1`) ?? "{}");
  return { paths: (raw.openFiles ?? []).map((f: { path: string }) => f.path) as string[], active: raw.activeIndex as number };
};

function renderArchivePane(paths: readonly string[]) {
  function Open() {
    const { openInSplit } = useSplitWorkspace();
    return (
      <>
        {paths.map((p) => (
          <button key={p} type="button" data-testid={`open-${p}`} onClick={() => openInSplit(p)}>
            {p}
          </button>
        ))}
      </>
    );
  }
  return render(
    <SessionDiffContext.Provider value={diffValue}>
      <SplitWorkspaceProvider sessionId="s1" cwd="/proj" orientation="h">
        <EditorPane />
        <Open />
      </SplitWorkspaceProvider>
    </SessionDiffContext.Provider>,
  );
}

describe("EditorPane archived artifact copy", () => {
  it("F5: a stale change tab keeps the missing line, offers the archived copy, and swaps on click", async () => {
    stubArchiveFetch([STALE], { kind: "ok", entries: [entry("2026-10-22-add-x")] });
    renderArchivePane([STALE]);
    fireEvent.click(screen.getByTestId(`open-${STALE}`));
    await flush();
    const notice = screen.getByTestId("editor-file-missing").textContent ?? "";
    expect(notice).toContain(`File no longer exists: ${STALE}`);
    expect(notice).toContain("2026-10-22-add-x");
    fireEvent.click(await screen.findByTestId("editor-open-archived"));
    await flush();
    expect(persisted().paths).toEqual([ARCHIVED]);
    expect(screen.getByTestId("viewer-markdown")).toBeTruthy();
  });

  it("F6: the archived copy already open → focus it, close the stale tab, no duplicate", async () => {
    stubArchiveFetch([STALE], { kind: "ok", entries: [entry("2026-10-22-add-x")] });
    renderArchivePane([ARCHIVED, STALE]);
    fireEvent.click(screen.getByTestId(`open-${ARCHIVED}`));
    fireEvent.click(screen.getByTestId(`open-${STALE}`));
    await flush();
    fireEvent.click(await screen.findByTestId("editor-open-archived"));
    await flush();
    expect(persisted()).toEqual({ paths: [ARCHIVED], active: 0 });
  });

  it("F7: the archived copy itself missing → plain message only, no further offer", async () => {
    stubArchiveFetch([STALE, ARCHIVED], { kind: "ok", entries: [entry("2026-10-22-add-x")] });
    renderArchivePane([STALE]);
    fireEvent.click(screen.getByTestId(`open-${STALE}`));
    await flush();
    fireEvent.click(await screen.findByTestId("editor-open-archived"));
    await flush();
    expect(persisted().paths).toEqual([ARCHIVED]);
    expect(screen.getByTestId("editor-file-missing").textContent).toBe(`File no longer exists: ${ARCHIVED}`);
    expect(screen.queryByTestId("editor-open-archived")).toBeNull();
  });

  it("F8: listing pending shows only the plain message, then gains the archived line", async () => {
    stubArchiveFetch([STALE], { kind: "held" });
    renderArchivePane([STALE]);
    fireEvent.click(screen.getByTestId(`open-${STALE}`));
    await flush();
    expect(screen.getByTestId("editor-file-missing").textContent).toBe(`File no longer exists: ${STALE}`);
    expect(screen.queryByTestId("editor-open-archived")).toBeNull();
    await act(async () => {
      releaseArchive?.();
    });
    await flush();
    expect(screen.getByTestId("editor-open-archived")).toBeTruthy();
    expect(screen.getByTestId("editor-file-missing").textContent).toContain(STALE);
  });

  it("F9: other missing files never read the archive", async () => {
    const inArchive = "openspec/changes/archive/2026-01-01-add-x/proposal.md";
    stubArchiveFetch(["src/gone.ts", inArchive], { kind: "ok", entries: [entry("2026-10-22-add-x")] });
    renderArchivePane(["src/gone.ts", inArchive]);
    for (const p of ["src/gone.ts", inArchive]) {
      fireEvent.click(screen.getByTestId(`open-${p}`));
      await flush();
      expect(screen.getByTestId("editor-file-missing").textContent).toBe(`File no longer exists: ${p}`);
    }
    expect(archiveCalls().length).toBe(0);
  });

  it("F10: an existing file never reads the archive", async () => {
    stubArchiveFetch([], { kind: "ok", entries: [] });
    renderArchivePane(["src/ok.ts"]);
    fireEvent.click(screen.getByTestId("open-src/ok.ts"));
    await flush();
    expect(screen.getByTestId("viewer-monaco")).toBeTruthy();
    expect(screen.queryByTestId("editor-file-missing")).toBeNull();
    expect(screen.queryByTestId("editor-open-archived")).toBeNull();
    expect(archiveCalls().length).toBe(0);
  });

  it("X1: no matching archive entry keeps the plain message", async () => {
    stubArchiveFetch([STALE], { kind: "ok", entries: [entry("2026-10-22-other")] });
    renderArchivePane([STALE]);
    fireEvent.click(screen.getByTestId(`open-${STALE}`));
    await flush();
    expect(screen.getByTestId("editor-file-missing").textContent).toBe(`File no longer exists: ${STALE}`);
    expect(screen.queryByTestId("editor-open-archived")).toBeNull();
  });

  it.each([["success:false", { kind: "fail" }], ["network reject", { kind: "reject" }]] as const)(
    "X2: archive listing failure (%s) keeps the plain message",
    async (_label, reply) => {
      stubArchiveFetch([STALE], reply);
      renderArchivePane([STALE]);
      fireEvent.click(screen.getByTestId(`open-${STALE}`));
      await flush();
      expect(screen.getByTestId("editor-file-missing").textContent).toBe(`File no longer exists: ${STALE}`);
      expect(screen.queryByTestId("editor-open-archived")).toBeNull();
    },
  );
});

// ── Empty cwd (archived view still resolving its session) ───────────────────
describe("EditorPane with an empty cwd", () => {
  it("mounts no file viewer and issues no /api/file request", async () => {
    stubFetch([]);
    localStorage.setItem(
      `${EDITOR_PANE_KEY_PREFIX}s1`,
      JSON.stringify({ openFiles: [{ path: STALE, viewer: "markdown" }], activeIndex: 0, treeOpenRoots: [] }),
    );
    render(
      <SplitWorkspaceProvider sessionId="s1" cwd="" orientation="h">
        <EditorPane />
      </SplitWorkspaceProvider>,
    );
    await flush();
    expect(calls.filter((c) => c.url.includes("/api/file?")).length).toBe(0);
    expect(screen.queryByTestId("viewer-markdown")).toBeNull();
    expect(screen.getByTestId("editor-pane-cwd-pending")).toBeTruthy();
  });
});
