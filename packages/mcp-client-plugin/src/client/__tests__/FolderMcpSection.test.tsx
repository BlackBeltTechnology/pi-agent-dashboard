/**
 * FolderMcpSection tests (change migrate-mcp-to-pi-builtin): the pill counts
 * from `/effective` (active count; off = disabled OR inactive), the untrusted
 * inactive state, the parse-error marker (layer ok:false), the cached 403
 * "not tracked" state with the session-list retry, navigation, and surfaces.
 * See spec mcp-client-folder-section.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { FolderMcpSection, folderMcpUrl } from "../FolderMcpSection.js";
import { __resetNotTrackedCache, invalidateEffective } from "../hooks.js";

const hoisted = vi.hoisted(() => ({ sessions: [] as Array<{ id: string }> }));

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@blackbelt-technology/dashboard-plugin-runtime")>();
  return {
    ...actual,
    // The list pill's copy is asserted through its interpolated fallback.
    useT: () => (_key: string, _params?: unknown, fallback?: string) => fallback ?? _key,
    // The 403 cache invalidates on a session-list change; tests own the list.
    useAllSessions: () => hoisted.sessions,
  };
});

function row(name: string, entry: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    provenance: "pi-global",
    entry,
    transport: "stdio",
    enabled: entry.enabled !== false,
    exposure: "codemode",
    active: entry.enabled !== false,
    ignoredKeys: [],
    adapterLeftovers: [],
    ...extra,
  };
}

interface ViewShape {
  scope: "project";
  cwd: string;
  trusted?: boolean;
  servers: Array<Record<string, unknown>>;
  layers: Array<Record<string, unknown>>;
}

function view(cwd: string, over: Partial<ViewShape> = {}): ViewShape {
  return { scope: "project", cwd, trusted: true, servers: [], layers: [], ...over };
}

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function jsonErr(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}
function serve(body: ViewShape) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonOk(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let counter = 100;
function nextCwd(): string {
  counter += 1;
  return `/repo/wt-${counter}`;
}

function renderPill(cwd: string, placement?: "sidebar" | "card") {
  const { hook, history } = memoryLocation({ path: "/", record: true });
  const utils = render(
    <Router hook={hook as never}>
      <FolderMcpSection folder={{ cwd }} placement={placement} />
    </Router>,
  );
  return { ...utils, history };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetNotTrackedCache();
  hoisted.sessions = [];
  invalidateEffective();
});

describe("pill summary", () => {
  it("counts active servers; off counts disabled OR inactive rows", async () => {
    const cwd = nextCwd();
    serve(
      view(cwd, {
        servers: [
          row("a", { command: "a" }),
          row("b", { command: "b", enabled: false }, { active: false, inactiveReason: "disabled" }),
          row("c", { command: "c" }, { active: false, inactiveReason: "project-not-trusted" }),
          row("d", { command: "d" }),
        ],
      }),
    );
    const { findByTestId } = renderPill(cwd);
    const pill = await findByTestId("mcp-folder-pill");
    await findByTestId("mcp-folder-pill-off");
    expect(pill.textContent).toContain("4 servers");
    expect(pill.textContent).toContain("2 off");
  });

  it("an untrusted folder shows the inactive state instead of counts", async () => {
    const cwd = nextCwd();
    serve(view(cwd, { trusted: false, servers: [row("a", { command: "a" })] }));
    const { findByTestId, queryByTestId } = renderPill(cwd);
    await findByTestId("mcp-folder-pill-untrusted");
    expect(queryByTestId("mcp-folder-pill-count")).toBeNull();
    expect(queryByTestId("mcp-folder-pill-off")).toBeNull();
  });

  it("shows the error marker naming the failing layer path (layer ok:false)", async () => {
    const cwd = nextCwd();
    serve(
      view(cwd, {
        servers: [row("keep", { command: "k" })],
        layers: [{ layer: "pi-folder", path: "/repo/wt/.pi/mcp.json", exists: true, ok: false, message: "Unexpected token }" }],
      }),
    );
    const { findByTestId } = renderPill(cwd);
    const marker = await findByTestId("mcp-folder-pill-error");
    expect(marker.getAttribute("aria-label")).toContain("/repo/wt/.pi/mcp.json");
  });
});

describe("loading + not-tracked", () => {
  it("renders a muted placeholder of the same height while loading", () => {
    const cwd = nextCwd();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const { getByTestId } = renderPill(cwd);
    const placeholder = getByTestId("mcp-folder-pill-loading");
    expect(placeholder.className).toContain("h-[15px]");
    expect(getByTestId("mcp-folder-pill")).toBeTruthy();
  });

  it("a 403 renders 'not tracked' and never re-asks for that cwd", async () => {
    const cwd = nextCwd();
    const fetchMock = vi.fn(async () => jsonErr(403, { error: "not-allowed", message: "cwd not allowed" }));
    vi.stubGlobal("fetch", fetchMock);

    const first = renderPill(cwd);
    await first.findByTestId("mcp-folder-pill-not-tracked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    first.unmount();
    cleanup();

    const second = renderPill(cwd);
    await second.findByTestId("mcp-folder-pill-not-tracked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a session-list change drops the cached 403 and retries once", async () => {
    const cwd = nextCwd();
    const fetchMock = vi.fn(async () => jsonErr(403, { error: "not-allowed", message: "nope" }));
    vi.stubGlobal("fetch", fetchMock);
    hoisted.sessions = [{ id: "s1" }];
    const { hook } = memoryLocation({ path: "/" });

    const { findByTestId, rerender } = render(
      <Router hook={hook as never}>
        <FolderMcpSection folder={{ cwd }} />
      </Router>,
    );
    await findByTestId("mcp-folder-pill-not-tracked");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    hoisted.sessions = [{ id: "s1" }, { id: "s2" }];
    rerender(
      <Router hook={hook as never}>
        <FolderMcpSection folder={{ cwd }} />
      </Router>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("navigation + placement", () => {
  it("activates to /folder/<encodedCwd>/mcp", async () => {
    const cwd = nextCwd();
    serve(view(cwd));
    const { findByTestId, history } = renderPill(cwd);
    const pill = await findByTestId("mcp-folder-pill");
    fireEvent.click(pill);
    expect(history[history.length - 1]).toBe(folderMcpUrl(cwd));
    expect(folderMcpUrl(cwd)).toBe(`/folder/${encodeURIComponent(cwd)}/mcp`);
  });

  it("a worktree card requests its OWN cwd, never the parent folder's", async () => {
    const parent = nextCwd();
    const worktree = `${parent}/.worktrees/wt`;
    const fetchMock = serve(view(worktree));
    const { findByTestId } = renderPill(worktree, "card");
    await findByTestId("mcp-folder-pill-count");
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(url.searchParams.get("cwd")).toBe(worktree);
    expect(url.searchParams.get("cwd")).not.toBe(parent);
  });

  it("card placement uses the flat surface, sidebar the raised one", async () => {
    const card = nextCwd();
    serve(view(card));
    const first = renderPill(card, "card");
    const flat = await first.findByTestId("mcp-folder-pill");
    expect(flat.className).not.toContain("bg-[var(--bg-secondary)]");
    first.unmount();

    const side = nextCwd();
    serve(view(side));
    const second = renderPill(side);
    const raised = await second.findByTestId("mcp-folder-pill");
    expect(raised.className).toContain("bg-[var(--bg-secondary)]");
  });
});
