/**
 * FolderMcpPage (change extract-mcp-client-plugin, tasks 8.2-8.4):
 * 403 → not-allowed with nothing rendered; malformed cwd; 504 → retry issues
 * exactly one request; provenance + inherited hints; folder-scope overrides
 * (single-key write, inherited secret excluded, atomic override note),
 * override removal → DELETE + undo toast (byte-equivalent restore), folder
 * enable/disable, the adapter read-only rule, Back, and mobile chips.
 * See spec mcp-client-folder-section (test-plan #F16, #F17, #F19, #F20, #F22, #F35).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import schemaDoc from "../../../schema/mcp-config.schema.json";
import type { AdapterVerdict } from "../../core/types.js";
import { FolderMcpPage } from "../FolderMcpPage.js";
import { __resetNotTrackedCache, invalidateEffective } from "../hooks.js";

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({
  useT: () => (_key: string, _params?: unknown, fallback?: string) => fallback ?? _key,
}));

const SCHEMA = schemaDoc as unknown as Record<string, unknown>;
const OK: AdapterVerdict = { kind: "ok", installed: "2.21.0", floor: "2.20.0" };
const BELOW: AdapterVerdict = { kind: "below-floor", installed: "2.19.0", floor: "2.20.0" };
const GLOBAL_PROV = [
  { layer: "pi-global", path: "/h/.pi/agent/mcp.json", label: "Pi global", writable: true },
];
const FOLDER_PROV = [
  { layer: "pi-folder", path: "/repo/wt/.pi/mcp.json", label: "Pi folder", writable: true },
  ...GLOBAL_PROV,
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

interface Recorded {
  url: string;
  body: Record<string, unknown>;
}
interface FetchHarness {
  fetchMock: ReturnType<typeof vi.fn>;
  puts: Recorded[];
  deletes: string[];
}

/** Serve the effective view + schema; record server PUT/DELETE. `current` may mutate. */
function makeFetch(current: ViewShape, removed: Record<string, unknown> = {}): FetchHarness {
  const puts: Recorded[] = [];
  const deletes: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (u.includes("/effective")) return jsonOk(current);
    if (u.includes("/schema")) return jsonOk(SCHEMA);
    if (method === "DELETE" && u.includes("/servers/")) {
      deletes.push(u);
      return jsonOk({ ok: true, removed });
    }
    if (method === "PUT" && u.includes("/servers/")) {
      puts.push({ url: u, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return jsonOk({ ok: true });
    }
    throw new Error(`unexpected request: ${method} ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, puts, deletes };
}

const CWD = "/repo/wt";

function renderPage(cwd = CWD, onBack: () => void = vi.fn()) {
  return { onBack, ...render(<FolderMcpPage params={{ encodedCwd: encodeURIComponent(cwd) }} onBack={onBack} />) };
}

function lastPutBody(puts: Recorded[]): Record<string, unknown> {
  const body = puts[puts.length - 1]?.body;
  if (body === undefined) throw new Error("no PUT recorded");
  return body;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetNotTrackedCache();
  invalidateEffective(CWD);
});

describe("cwd guard (test-plan #F17)", () => {
  it("403 renders the not-allowed empty state with no retry and no data", async () => {
    const { fetchMock } = makeFetch(view("/unknown"));
    fetchMock.mockImplementation(async () => jsonErr(403, { error: "not-allowed", message: "nope" }));
    renderPage("/unknown");

    await screen.findByTestId("mcp-folder-not-allowed");
    expect(screen.queryAllByTestId(/^mcp-folder-row-/)).toHaveLength(0);
    expect(screen.queryByTestId("mcp-server-list")).toBeNull();
    expect(screen.queryByTestId("mcp-folder-timeout-retry")).toBeNull();
    expect(screen.queryByTestId("mcp-folder-total")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a malformed encode is refused without any request", async () => {
    const fetchMock = vi.fn(async () => jsonOk(view(CWD)));
    vi.stubGlobal("fetch", fetchMock);
    render(<FolderMcpPage params={{ encodedCwd: "%E0%A4%A" }} onBack={vi.fn()} />);
    await screen.findByTestId("mcp-folder-not-allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("adapter timeout (test-plan #F35)", () => {
  it("504 renders the timeout state; retry issues exactly one new request", async () => {
    const { fetchMock } = makeFetch(view(CWD));
    fetchMock.mockImplementation(async () => jsonErr(504, { error: "adapter-timeout", timeoutMs: 1000 }));
    renderPage();

    const retry = await screen.findByTestId("mcp-folder-timeout-retry");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryAllByTestId(/^mcp-folder-row-/)).toHaveLength(0);
  });
});

describe("navigation", () => {
  it("Back invokes onBack", async () => {
    makeFetch(view(CWD));
    const onBack = vi.fn();
    renderPage(CWD, onBack);
    fireEvent.click(await screen.findByTestId("mcp-folder-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("provenance + inherited hints (test-plan #F20)", () => {
  it("an inherited server's fields all carry the inherited-from hint", async () => {
    makeFetch(
      view(CWD, {
        servers: [{ name: "srv", entry: { command: "/bin/a", cwd: "/x" }, provenance: GLOBAL_PROV }],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-action-srv"));
    const hint = await screen.findByTestId("mcp-folder-inherited-srv.command");
    expect(hint.textContent).toContain("inherited from Pi global");
    expect(screen.getByTestId("mcp-folder-inherited-srv.cwd")).toBeTruthy();
  });

  it("a folder override row lists exactly its own field names in the chip", async () => {
    makeFetch(
      view(CWD, {
        servers: [
          {
            name: "ovr",
            entry: { command: "/bin/a", disabled: true, args: ["--x"] },
            provenance: FOLDER_PROV,
            own: { disabled: true, args: ["--x"] },
          },
        ],
      }),
    );
    renderPage();
    const chip = await screen.findByTestId("mcp-folder-override-chip-ovr");
    expect(chip.textContent).toContain("disabled, args");
    expect(screen.getByTestId("mcp-badge-ovr-Pi folder")).toBeTruthy();
  });
});

describe("folder overrides (test-plan #F16, #F19)", () => {
  it("override writes a single key at project scope and never at global scope", async () => {
    const { puts } = makeFetch(
      view(CWD, {
        servers: [{ name: "srv", entry: { command: "/bin/a" }, provenance: GLOBAL_PROV }],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-action-srv"));
    fireEvent.click(await screen.findByTestId("mcp-field-input-disabled"));
    fireEvent.click(screen.getByTestId("mcp-save"));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(lastPutBody(puts)).toEqual({
      scope: "project",
      cwd: CWD,
      set: { disabled: true },
      unset: [],
    });
    expect(puts.every((p) => p.body.scope === "project")).toBe(true);
  });

  it("an inherited secret never reaches the patch", async () => {
    const { puts } = makeFetch(
      view(CWD, {
        servers: [
          {
            name: "srv",
            entry: { command: "/bin/a", bearerToken: { redacted: true } },
            provenance: GLOBAL_PROV,
          },
        ],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-action-srv"));
    fireEvent.click(await screen.findByTestId("mcp-save"));

    await waitFor(() => expect(puts.length).toBe(1));
    const set = lastPutBody(puts).set as Record<string, unknown>;
    expect("bearerToken" in set).toBe(false);
    expect(set).toEqual({});
  });

  it("an atomic override starts empty and states the inherited key/secret count", async () => {
    const { puts } = makeFetch(
      view(CWD, {
        servers: [
          {
            name: "srv",
            entry: {
              command: "/bin/a",
              env: {
                redacted: true,
                keys: [
                  { name: "API_KEY", secret: true },
                  { name: "PATH", secret: false },
                  { name: "HOME", secret: false },
                ],
              },
            },
            provenance: GLOBAL_PROV,
          },
        ],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-action-srv"));
    fireEvent.click(await screen.findByTestId("mcp-override-env"));

    const note = await screen.findByTestId("mcp-override-note-env");
    expect(note.textContent).toContain("3 inherited keys incl. 1 secrets will no longer apply");
    expect(screen.getByTestId("mcp-record-add-env")).toBeTruthy();

    fireEvent.click(screen.getByTestId("mcp-save"));
    await waitFor(() => expect(puts.length).toBe(1));
    expect((lastPutBody(puts).set as Record<string, unknown>).env).toEqual({});
  });

  it("removing an override DELETEs the folder key and Undo restores it byte-equivalently", async () => {
    const own = { disabled: true, unknownKey: { n: [1] }, "weird key": true };
    const { puts, deletes } = makeFetch(
      view(CWD, {
        servers: [
          {
            name: "srv",
            entry: { command: "/bin/a", ...own },
            provenance: FOLDER_PROV,
            own,
          },
        ],
      }),
      own,
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-chip-remove-srv"));

    await waitFor(() => expect(deletes.length).toBe(1));
    const url = new URL(deletes[0] as string, "http://localhost");
    expect(url.searchParams.get("scope")).toBe("project");
    expect(url.searchParams.get("cwd")).toBe(CWD);

    const toast = await screen.findByTestId("mcp-folder-undo-toast");
    expect(toast.textContent).toContain("srv");
    fireEvent.click(screen.getByTestId("mcp-folder-undo"));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(lastPutBody(puts).set).toEqual(own);
    expect(lastPutBody(puts).cwd).toBe(CWD);
  });

  it("folder-scope disable writes disabled:true", async () => {
    const { puts } = makeFetch(
      view(CWD, {
        servers: [{ name: "srv", entry: { command: "/bin/a" }, provenance: GLOBAL_PROV }],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-server-toggle-srv"));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(lastPutBody(puts)).toMatchObject({ scope: "project", cwd: CWD, disabled: true });
  });

  it("enabling over a lower-layer disable writes disabled:false at folder scope", async () => {
    const { puts } = makeFetch(
      view(CWD, {
        servers: [
          { name: "srv", entry: { command: "/bin/a", disabled: true }, provenance: GLOBAL_PROV },
        ],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-server-toggle-srv"));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(lastPutBody(puts)).toMatchObject({ scope: "project", cwd: CWD, disabled: false });
  });
});

describe("adapter read-only rule (spec: adapter status applies to the folder page)", () => {
  it("below-floor disables switches, Override, and Save", async () => {
    const current = view(CWD, {
      servers: [{ name: "srv", entry: { command: "/bin/a" }, provenance: GLOBAL_PROV }],
    });
    const { puts } = makeFetch(current);
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-action-srv"));
    await screen.findByTestId("mcp-field-input-disabled");

    // Flip the verdict and force a refetch by toggling the row (its write
    // triggers onChanged → reload), keeping the editor open.
    current.adapter = BELOW;
    current.servers = [
      { name: "srv", entry: { command: "/bin/a", disabled: true }, provenance: GLOBAL_PROV },
    ];
    fireEvent.click(screen.getByTestId("mcp-server-toggle-srv"));
    await waitFor(() => expect(puts.length).toBe(1));

    await screen.findByTestId("mcp-folder-readonly-banner");
    await waitFor(() => expect((screen.getByTestId("mcp-save") as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByTestId("mcp-server-toggle-srv") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("mcp-folder-action-srv") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("mobile presentation (test-plan #F22)", () => {
  it("chips have no inline remove and the editor sheet offers Remove override", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    makeFetch(
      view(CWD, {
        servers: [
          {
            name: "srv",
            entry: { command: "/bin/a", disabled: true },
            provenance: FOLDER_PROV,
            own: { disabled: true },
          },
        ],
      }),
      { disabled: true },
    );
    renderPage();
    await screen.findByTestId("mcp-folder-override-chip-srv");
    expect(screen.queryByTestId("mcp-folder-chip-remove-srv")).toBeNull();

    const action = screen.getByTestId("mcp-folder-action-srv") as HTMLButtonElement;
    expect(action.className).toContain("min-h-11");
    fireEvent.click(action);
    expect(await screen.findByTestId("mcp-folder-remove-override")).toBeTruthy();
  });
});
