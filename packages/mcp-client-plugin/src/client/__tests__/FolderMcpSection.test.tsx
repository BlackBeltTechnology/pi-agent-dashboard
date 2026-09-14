/**
 * FolderMcpSection (change extract-mcp-client-plugin, tasks 8.1 + 8.3):
 * count · off · error marker (naming path / timeout), the loading placeholder,
 * the cached 403 "not tracked" state (one request per cwd until the session
 * list changes), navigation to `/folder/<encodedCwd>/mcp`, the worktree cwd,
 * and the sidebar/card surface variants.
 * See spec mcp-client-folder-section (test-plan #E44, #F15, #F18, #F35).
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AdapterVerdict } from "../../core/types.js";
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

const OK: AdapterVerdict = { kind: "ok", installed: "2.21.0", floor: "2.20.0" };
const GLOBAL_PROV = [
  { layer: "pi-global", path: "/h/.pi/agent/mcp.json", label: "Pi global", writable: true },
];

interface Server {
  name: string;
  entry: Record<string, unknown>;
  provenance: Array<Record<string, unknown>>;
  own?: Record<string, unknown>;
}
interface ViewShape {
  cwd: string;
  servers: Server[];
  settings: Record<string, unknown>;
  layerErrors: Array<{ path: string; message: string }>;
  adapter: AdapterVerdict;
}

function view(cwd: string, over: Partial<ViewShape> = {}): ViewShape {
  return { cwd, servers: [], settings: {}, layerErrors: [], adapter: OK, ...over };
}

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function jsonErr(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}
function serve(viewBody: ViewShape) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonOk(viewBody));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let counter = 0;
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

describe("pill summary (test-plan #E44)", () => {
  it("reads '4 servers · 1 off' and omits the off segment at zero", async () => {
    const cwd = nextCwd();
    serve(
      view(cwd, {
        servers: [
          { name: "a", entry: { command: "a" }, provenance: GLOBAL_PROV },
          { name: "b", entry: { command: "b", disabled: true }, provenance: GLOBAL_PROV },
          { name: "c", entry: { command: "c" }, provenance: GLOBAL_PROV },
          { name: "d", entry: { command: "d" }, provenance: GLOBAL_PROV },
        ],
      }),
    );
    const { findByTestId } = renderPill(cwd);
    const pill = await findByTestId("mcp-folder-pill");
    await findByTestId("mcp-folder-pill-off");
    expect(pill.textContent).toContain("4 servers");
    expect(pill.textContent).toContain("1 off");
    expect(pill.textContent).toContain("·");
  });

  it("a single server reads '1 server'; none reads '0 servers'", async () => {
    const one = nextCwd();
    serve(view(one, { servers: [{ name: "a", entry: { command: "a" }, provenance: GLOBAL_PROV }] }));
    const first = renderPill(one);
    await waitFor(() => expect(first.getByTestId("mcp-folder-pill-count").textContent).toContain("1 server"));
    first.unmount();

    const none = nextCwd();
    serve(view(none));
    const second = renderPill(none);
    await waitFor(() => expect(second.getByTestId("mcp-folder-pill-count").textContent).toContain("0 servers"));
  });

  it("shows the error marker naming the failing layer path", async () => {
    const cwd = nextCwd();
    serve(
      view(cwd, {
        servers: [{ name: "keep", entry: { command: "k" }, provenance: GLOBAL_PROV }],
        layerErrors: [{ path: "/broken/mcp.json", message: "Unexpected token }" }],
      }),
    );
    const { findByTestId } = renderPill(cwd);
    const marker = await findByTestId("mcp-folder-pill-error");
    expect(marker.getAttribute("aria-label")).toContain("/broken/mcp.json");
  });

  it("a 504 marker names the timeout and never renders stale data", async () => {
    const cwd = nextCwd();
    vi.stubGlobal("fetch", vi.fn(async () => jsonErr(504, { error: "adapter-timeout", timeoutMs: 1000 })));
    const { findByTestId, queryByTestId } = renderPill(cwd);
    const marker = await findByTestId("mcp-folder-pill-error");
    expect(marker.getAttribute("aria-label")).toContain("1000");
    expect(queryByTestId("mcp-folder-pill-count")).toBeNull();
  });
});

describe("loading + not-tracked (test-plan #F15)", () => {
  it("renders a muted placeholder of the same height while loading", () => {
    const cwd = nextCwd();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const { getByTestId } = renderPill(cwd);
    const placeholder = getByTestId("mcp-folder-pill-loading");
    // Same element/height as the loaded pill: the placeholder fills the pill's
    // count line instead of leaving an empty slot.
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

    // A new session can make the folder known → one fresh request.
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
