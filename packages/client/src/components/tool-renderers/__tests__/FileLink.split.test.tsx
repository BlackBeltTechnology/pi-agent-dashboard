import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { loadEditorPaneState } from "../../../lib/layout/editor-pane-state.js";
import { loadSplitState } from "../../../lib/layout/split-state.js";
import { buildEditorUrl } from "../../../lib/nav/route-builders.js";
import { FilePreviewHost, FilePreviewProvider } from "../../preview/FilePreviewContext.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { SplitWorkspaceProvider } from "../../split/SplitWorkspaceContext.js";
import { FileLink } from "../FileLink.js";
import type { ToolContext } from "../types.js";

// Hybrid mock: the editor-pane routing tests below drive `useOptionalSplitWorkspace` with a fake
// `{ sessionId, openInSplit }` (so `openInSplit` args are observable); every other test delegates to the
// real provider-backed hook.
const fakeWs: { current: { sessionId: string; openInSplit: ReturnType<typeof vi.fn> } | null } = { current: null };
vi.mock("../../split/SplitWorkspaceContext.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../split/SplitWorkspaceContext.js")>();
  return {
    ...actual,
    useOptionalSplitWorkspace: () => {
      const real = actual.useOptionalSplitWorkspace();
      return (fakeWs.current as unknown as typeof real) ?? real;
    },
  };
});

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  fakeWs.current = null;
});
beforeEach(() => localStorage.clear());

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as any;
}

// Route the resolve endpoint (echo the mention as resolved); the split pane's
// own `/api/file` fetches are irrelevant to these state assertions.
function mockResolve(
  resolve: (mention: string) => Response = (m) =>
    jsonResponse({ success: true, data: { resolved: `/Users/me/repo/${m}`, kind: "relative" } }),
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

function renderInSplit(ui: React.ReactElement, sessionId: string, cwd: string) {
  return render(
    <SplitWorkspaceProvider sessionId={sessionId} cwd={cwd} orientation="h">
      {ui}
    </SplitWorkspaceProvider>,
  );
}

describe("FileLink — split routing", () => {
  it("clicking a relative file-link auto-opens the split and adds the tab", async () => {
    const fetchSpy = mockResolve();
    const ctx: ToolContext = { cwd: "/Users/me/repo", sessionId: "sesh" };
    renderInSplit(
      <FileLink path="src/foo.ts" line={7} context={ctx}>
        src/foo.ts
      </FileLink>,
      "sesh",
      "/Users/me/repo",
    );

    expect(loadSplitState("sesh").mode).toBe("closed");
    fireEvent.click(screen.getByRole("button"));

    // Resolve is async — the split opens after the round-trip.
    await waitFor(() => expect(loadSplitState("sesh").mode).toBe("split"));
    // Pane opens the cwd-relative path (tab-key parity with tree clicks).
    expect(loadEditorPaneState("sesh").openFiles.map((f) => f.path)).toEqual(["src/foo.ts"]);
    fetchSpy.mockRestore();
  });

  it("split-open routes THROUGH the resolve endpoint, not a client short-circuit (G2, S17)", async () => {
    const fetchSpy = mockResolve();
    const ctx: ToolContext = { cwd: "/Users/me/repo", sessionId: "sesh" };
    renderInSplit(
      <FileLink path="src/foo.ts" line={7} context={ctx}>
        src/foo.ts
      </FileLink>,
      "sesh",
      "/Users/me/repo",
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([u]) => String(u).includes("/api/file/resolve-mention")),
      ).toBe(true),
    );
    // And it did open the split (not a no-op).
    await waitFor(() => expect(loadSplitState("sesh").mode).toBe("split"));
    fetchSpy.mockRestore();
  });

  it("a null resolution does NOT open the split (G1)", async () => {
    const fetchSpy = mockResolve(() => jsonResponse({ success: true, data: { resolved: null } }));
    const ctx: ToolContext = { cwd: "/Users/me/repo", sessionId: "sesh" };
    renderInSplit(
      <FileLink path="ghost.ts" context={ctx}>
        ghost.ts
      </FileLink>,
      "sesh",
      "/Users/me/repo",
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button").getAttribute("data-not-found")).toBe("true"),
    );
    expect(loadSplitState("sesh").mode).toBe("closed");
    fetchSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Editor-pane routing — change: fix-file-link-editor-routing (S8–S16, S67/S68 siblings, S75, S80).
//
// NOTE (scenario premise): the external-editor integration was removed in
// remove-external-editor-integration, so there is no `isLocalhost()` / `ToolContext.editors` /
// `openEditor` in the client today. "Localhost editor detected" is therefore never true here; the tests pin
// the observable contract instead — no live split + sessionId ⇒ deep link, no sessionId ⇒ overlay, and no
// `POST /api/open-editor` request is ever made.
// ─────────────────────────────────────────────────────────────────────────────

type Data = { resolved: string | null; kind?: string; outside?: boolean };

function resolveMentions(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls
    .filter(([u]: any[]) => String(u).includes("/api/file/resolve-mention"))
    .map(([, init]: any[]) => JSON.parse(init.body).mention);
}
function openEditorCalls(spy: ReturnType<typeof vi.spyOn>): number {
  return spy.mock.calls.filter(([u]: any[]) => String(u).includes("/api/open-editor")).length;
}

function renderRouted(ui: React.ReactElement) {
  const { hook, history } = memoryLocation({ path: "/session/s1", record: true });
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

function liveWs(sessionId = "s1") {
  const ws = { sessionId, openInSplit: vi.fn() };
  fakeWs.current = ws;
  return ws;
}

const CWD = "/work/repo";

describe("FileLink — opens in the editor pane (fix-file-link-editor-routing)", () => {
  // S8 — decision table: live split × resolve outcome × link kind.
  it.each([
    { name: "abs in-cwd", token: "/work/repo/src/a.ts", cwd: CWD, data: { resolved: "/work/repo/src/a.ts", kind: "abs" }, tab: "src/a.ts" },
    {
      name: "~/ outside",
      token: "~/Downloads/x.md",
      cwd: CWD,
      data: { resolved: "/Users/u/Downloads/x.md", kind: "tilde", outside: true },
      tab: "/Users/u/Downloads/x.md",
    },
    {
      name: "file:// (decoded abs) in-cwd",
      token: "/work/repo/src/a.ts",
      cwd: CWD,
      data: { resolved: "/work/repo/src/a.ts", kind: "abs" },
      tab: "src/a.ts",
    },
    {
      name: "Windows drive in-cwd",
      token: "C:\\Work\\repo\\a.md",
      cwd: "C:/Work/repo",
      data: { resolved: "C:\\Work\\repo\\a.md", kind: "abs" },
      tab: "a.md",
    },
    {
      name: "Windows drive other drive",
      token: "D:\\x\\y.md",
      cwd: "C:/Work/repo",
      data: { resolved: "D:\\x\\y.md", kind: "abs", outside: true },
      tab: "D:\\x\\y.md",
    },
  ] as { name: string; token: string; cwd: string; data: Data; tab: string }[])(
    "live split: $name → openInSplit($tab, 3), no overlay, no open-editor",
    async ({ token, cwd, data, tab }) => {
      const ws = liveWs();
      const spy = mockResolve(() => jsonResponse({ success: true, data }));
      const { getByRole, queryByTestId, history } = renderRouted(
        <FileLink path={token} line={3} absolute context={{ cwd, sessionId: "s1" }}>
          {token}
        </FileLink>,
      );
      fireEvent.click(getByRole("button"));
      await waitFor(() => expect(ws.openInSplit).toHaveBeenCalledTimes(1));
      expect(ws.openInSplit).toHaveBeenCalledWith(tab, 3);
      expect(queryByTestId("file-preview-overlay")).toBeNull();
      expect(openEditorCalls(spy)).toBe(0);
      expect(history).toEqual(["/session/s1"]); // no navigation
    },
  );

  it("no live split + sessionId → navigates to buildEditorUrl(sessionId, path, line); no overlay, no open-editor (S8, S80)", async () => {
    const spy = mockResolve(() =>
      jsonResponse({ success: true, data: { resolved: "/work/repo/src/a.ts", kind: "abs" } }),
    );
    const { getByRole, queryByTestId, history } = renderRouted(
      <FileLink path="/work/repo/src/a.ts" line={3} absolute context={{ cwd: CWD, sessionId: "s1" }}>
        a
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(history[history.length - 1]).toBe(buildEditorUrl("s1", "src/a.ts", 3)));
    expect(queryByTestId("file-preview-overlay")).toBeNull();
    expect(openEditorCalls(spy)).toBe(0);
  });

  it("no live split + outside + sessionId → deep link carries the absolute path (S8)", async () => {
    mockResolve(() =>
      jsonResponse({ success: true, data: { resolved: "/Users/u/Downloads/x.md", kind: "tilde", outside: true } }),
    );
    const { getByRole, history } = renderRouted(
      <FileLink path="~/Downloads/x.md" absolute context={{ cwd: CWD, sessionId: "s1" }}>
        x
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await waitFor(() =>
      expect(history[history.length - 1]).toBe(buildEditorUrl("s1", "/Users/u/Downloads/x.md", undefined)),
    );
  });

  it("no live split + no sessionId → FilePreviewOverlay mounts (S8)", async () => {
    mockResolve(() =>
      jsonResponse({ success: true, data: { resolved: "/work/repo/src/a.ts", kind: "abs" } }),
    );
    const { getByRole, findByTestId, history } = renderRouted(
      <FileLink path="/work/repo/src/a.ts" absolute context={{ cwd: CWD }}>
        a
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
    expect(history).toEqual(["/session/s1"]);
  });

  it("null resolution → not-found affordance and zero open calls (S8)", async () => {
    const ws = liveWs();
    const spy = mockResolve(() => jsonResponse({ success: true, data: { resolved: null } }));
    const { getByRole, queryByTestId, history } = renderRouted(
      <FileLink path="/work/repo/ghost.ts" absolute context={{ cwd: CWD, sessionId: "s1" }}>
        g
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(getByRole("button").getAttribute("data-not-found")).toBe("true"));
    expect(getByRole("button").className).toContain("line-through");
    expect(ws.openInSplit).not.toHaveBeenCalled();
    expect(queryByTestId("file-preview-overlay")).toBeNull();
    expect(openEditorCalls(spy)).toBe(0);
    expect(history).toEqual(["/session/s1"]);
  });

  // S9 — pane-first precedence: no editor call at all.
  it("a live split opens the pane once and never calls open-editor (S9)", async () => {
    const ws = liveWs();
    const spy = mockResolve(() =>
      jsonResponse({ success: true, data: { resolved: "/work/repo/src/a.ts", kind: "abs" } }),
    );
    const { getByRole } = renderRouted(
      <FileLink path="/work/repo/src/a.ts" absolute context={{ cwd: CWD, sessionId: "s1" }}>
        a
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(ws.openInSplit).toHaveBeenCalledTimes(1));
    expect(openEditorCalls(spy)).toBe(0);
  });

  // S10
  it("outside:true + missing file opens a tab and is NOT marked not-found (S10)", async () => {
    const ws = liveWs();
    mockResolve(() =>
      jsonResponse({
        success: true,
        data: { resolved: "/Users/u/Downloads/missing.md", kind: "tilde", outside: true },
      }),
    );
    const { getByRole } = renderRouted(
      <FileLink path="~/Downloads/missing.md" absolute context={{ cwd: CWD, sessionId: "s1" }}>
        m
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(ws.openInSplit).toHaveBeenCalledWith("/Users/u/Downloads/missing.md", undefined));
    const btn = getByRole("button");
    expect(btn.getAttribute("data-not-found")).toBeNull();
    expect(btn.className).not.toContain("line-through");
  });

  // S11 — line suffix survives routing.
  it.each([
    { token: "/work/repo/a.ts", line: undefined, resolved: "/work/repo/a.ts", tab: "a.ts" },
    { token: "/work/repo/a.ts", line: 1, resolved: "/work/repo/a.ts", tab: "a.ts" },
    { token: "~/x.md", line: 99999, resolved: "/Users/u/x.md", tab: "/Users/u/x.md" },
  ])("line $line survives routing for $token (S11)", async ({ token, line, resolved, tab }) => {
    const ws = liveWs();
    mockResolve(() => jsonResponse({ success: true, data: { resolved, kind: "abs" } }));
    const { getByRole, unmount } = renderRouted(
      <FileLink path={token} line={line} absolute context={{ cwd: CWD, sessionId: "s1" }}>
        t
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(ws.openInSplit).toHaveBeenCalledWith(tab, line));
    unmount();

    // Same `line` is forwarded in the deep-link branch.
    fakeWs.current = null;
    const r = renderRouted(
      <FileLink path={token} line={line} absolute context={{ cwd: CWD, sessionId: "s1" }}>
        t
      </FileLink>,
    );
    fireEvent.click(r.getByRole("button"));
    await waitFor(() => expect(r.history[r.history.length - 1]).toBe(buildEditorUrl("s1", tab, line)));
  });

  // S14 — worktree re-root, three-way.
  describe("worktree re-root (D4)", () => {
    const WT = "/repo/.worktrees/w1";
    const link = (extra?: Partial<React.ComponentProps<typeof FileLink>>) => (
      <FileLink path="/repo/src/a.ts" absolute context={{ cwd: WT, sessionId: "s1" }} {...extra}>
        a
      </FileLink>
    );

    it("(a) re-rooted copy exists → opens the cwd-relative worktree tab after 1 extra resolve", async () => {
      const ws = liveWs();
      const spy = mockResolve((m) =>
        m === "/repo/.worktrees/w1/src/a.ts"
          ? jsonResponse({ success: true, data: { resolved: m, kind: "abs" } })
          : jsonResponse({ success: true, data: { resolved: null } }),
      );
      const { getByRole } = renderRouted(link());
      fireEvent.click(getByRole("button"));
      await waitFor(() => expect(ws.openInSplit).toHaveBeenCalledWith("src/a.ts", undefined));
      expect(resolveMentions(spy)).toEqual(["/repo/.worktrees/w1/src/a.ts"]);
    });

    it("(b) re-rooted null, original resolves → 2 resolves in order, absolute parent tab, not not-found", async () => {
      const ws = liveWs();
      const spy = mockResolve((m) =>
        m === "/repo/src/a.ts"
          ? jsonResponse({ success: true, data: { resolved: "/repo/src/a.ts", kind: "abs" } })
          : jsonResponse({ success: true, data: { resolved: null } }),
      );
      const { getByRole } = renderRouted(link());
      fireEvent.click(getByRole("button"));
      await waitFor(() => expect(ws.openInSplit).toHaveBeenCalledWith("/repo/src/a.ts", undefined));
      expect(resolveMentions(spy)).toEqual(["/repo/.worktrees/w1/src/a.ts", "/repo/src/a.ts"]);
      expect(getByRole("button").getAttribute("data-not-found")).toBeNull();
    });

    it("(c) both null → not-found affordance, no open", async () => {
      const ws = liveWs();
      const spy = mockResolve(() => jsonResponse({ success: true, data: { resolved: null } }));
      const { getByRole } = renderRouted(link());
      fireEvent.click(getByRole("button"));
      await waitFor(() => expect(getByRole("button").getAttribute("data-not-found")).toBe("true"));
      expect(resolveMentions(spy)).toEqual(["/repo/.worktrees/w1/src/a.ts", "/repo/src/a.ts"]);
      expect(ws.openInSplit).not.toHaveBeenCalled();
    });

    // S16 — sibling worktree.
    it("sibling worktree link: re-rooted candidate null → falls back to the original absolute tab (S16)", async () => {
      const ws = liveWs();
      const spy = mockResolve((m) =>
        m === "/repo/.worktrees/w2/src/a.ts"
          ? jsonResponse({ success: true, data: { resolved: m, kind: "abs" } })
          : jsonResponse({ success: true, data: { resolved: null } }),
      );
      const { getByRole } = renderRouted(link({ path: "/repo/.worktrees/w2/src/a.ts" }));
      fireEvent.click(getByRole("button"));
      await waitFor(() => expect(ws.openInSplit).toHaveBeenCalledWith("/repo/.worktrees/w2/src/a.ts", undefined));
      expect(resolveMentions(spy)).toEqual([
        "/repo/.worktrees/w1/.worktrees/w2/src/a.ts",
        "/repo/.worktrees/w2/src/a.ts",
      ]);
    });

    // S15 — no extra round-trip when the re-root cannot apply.
    it.each([
      { cwd: WT, path: "/repo/.worktrees/w1/src/a.ts", absolute: true, why: "already worktree-rooted" },
      { cwd: WT, path: "/etc/hosts", absolute: true, why: "foreign" },
      { cwd: WT, path: "/repository/a.ts", absolute: true, why: "prefix collision" },
      { cwd: WT, path: "src/a.ts", absolute: false, why: "relative" },
      { cwd: "/repo", path: "/repo/src/a.ts", absolute: true, why: "non-worktree cwd" },
    ])("exactly one resolve per click: $why (S15)", async ({ cwd, path, absolute }) => {
      const ws = liveWs();
      const spy = mockResolve((m) => jsonResponse({ success: true, data: { resolved: m.startsWith("/") ? m : `${cwd}/${m}`, kind: "abs" } }));
      const { getByRole } = renderRouted(
        <FileLink path={path} absolute={absolute} context={{ cwd, sessionId: "s1" }}>
          x
        </FileLink>,
      );
      fireEvent.click(getByRole("button"));
      await waitFor(() => expect(ws.openInSplit).toHaveBeenCalledTimes(1));
      expect(resolveMentions(spy)).toEqual([path]);
    });

    // S68 — a failed probe is not "copy absent".
    it("probe request failure → offline fallback; parent path NOT opened, no not-found (S68)", async () => {
      const ws = liveWs();
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
        if (String(input).includes("/api/file/resolve-mention")) throw new TypeError("network down");
        return jsonResponse({ success: true, data: { type: "file", content: "" } });
      });
      const { getByRole, findByTestId } = renderRouted(link({ context: { cwd: WT } }));
      const btn = getByRole("button");
      fireEvent.click(btn);
      const overlay = await findByTestId("file-preview-overlay");
      expect(overlay.textContent).toContain("/repo/.worktrees/w1/src/a.ts"); // the client re-rooted fallback target
      expect(ws.openInSplit).not.toHaveBeenCalled();
      expect(btn.getAttribute("data-not-found")).toBeNull();
      expect(resolveMentions(spy)).toEqual(["/repo/.worktrees/w1/src/a.ts"]); // never advanced to the original
    });

    it("probe null then original-path resolve rejects → offline fallback, no not-found (S68)", async () => {
      const ws = liveWs();
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
        if (String(input).includes("/api/file/resolve-mention")) {
          const m = JSON.parse(init.body).mention;
          if (m === "/repo/.worktrees/w1/src/a.ts") return jsonResponse({ success: true, data: { resolved: null } });
          return new Response("boom", { status: 502, headers: { "Content-Type": "text/html" } }) as any;
        }
        return jsonResponse({ success: true, data: { type: "file", content: "" } });
      });
      const { getByRole, findByTestId } = renderRouted(link({ context: { cwd: WT } }));
      const btn = getByRole("button");
      fireEvent.click(btn);
      await findByTestId("file-preview-overlay");
      expect(ws.openInSplit).not.toHaveBeenCalledWith("/repo/src/a.ts", undefined);
      expect(btn.getAttribute("data-not-found")).toBeNull();
    });
  });

  // S75 — cross-version compat: an old server answers `null` for an outside path.
  it("old server (no outside, null) → not-found affordance, no crash (S75)", async () => {
    const ws = liveWs();
    mockResolve(() => jsonResponse({ success: true, data: { resolved: null } }));
    const { getByRole } = renderRouted(
      <FileLink path="~/Downloads/x.md" absolute context={{ cwd: CWD, sessionId: "s1" }}>
        x
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(getByRole("button").getAttribute("data-not-found")).toBe("true"));
    expect(ws.openInSplit).not.toHaveBeenCalled();
  });

  // S80 — no live split, no detected editor: deep link vs overlay (the "editor detected" variants have no
  // client surface any more — see the note above).
  it("no live split, session id present → deep link; never an open-editor request (S80)", async () => {
    const spy = mockResolve(() =>
      jsonResponse({ success: true, data: { resolved: "/work/repo/a.ts", kind: "abs" } }),
    );
    const { getByRole, history, queryByTestId } = renderRouted(
      <FileLink path="/work/repo/a.ts" line={9} absolute context={{ cwd: CWD, sessionId: "s1" }}>
        a
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(history[history.length - 1]).toBe(buildEditorUrl("s1", "a.ts", 9)));
    expect(openEditorCalls(spy)).toBe(0);
    expect(queryByTestId("file-preview-overlay")).toBeNull();
  });
});
