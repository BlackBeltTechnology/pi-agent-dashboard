/**
 * Global settings section (change extract-mcp-client-plugin, tasks 7.2 + 7.3):
 * provenance badges, sorted rows, parse-error + empty + skeleton states, the
 * adapter pill/banner/read-only agreement, and the row enable/disable write
 * (persist + revert-on-failure).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterVerdict } from "../../core/types.js";
import { invalidateEffective } from "../hooks.js";
import { McpSettings } from "../McpSettings.js";

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({
  useT: () => (_key: string, _params?: unknown, fallback?: string) => fallback ?? _key,
  // The global settings form (task 7.6) is a host draft source; these list
  // tests only exercise the section, so its hooks are inert stubs here.
  usePluginConfig: () => ({}),
  usePluginSend: () => () => Promise.resolve(),
  useSettingsDraftSource: () => {},
}));

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function jsonErr(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

const PI_PROV = [{ layer: "pi-global", path: "/h/.pi/agent/mcp.json", label: "Pi global", writable: true }];
const SHARED_PROV = [
  {
    layer: "shared",
    path: "/team/shared.json",
    label: "team-shared",
    importKind: "file",
    writable: false,
  },
];

const OK: AdapterVerdict = { kind: "ok", installed: "2.21.0", floor: "2.20.0" };

/** No jest-dom in this project's vitest setup — read the DOM property. */
function isDisabled(testid: string): boolean {
  return (screen.getByTestId(testid) as HTMLInputElement).disabled;
}
function isChecked(testid: string): boolean {
  return (screen.getByTestId(testid) as HTMLInputElement).checked;
}

type Server = { name: string; entry: Record<string, unknown>; provenance: Array<Record<string, unknown>> };

interface ViewShape {
  cwd: string;
  servers: Server[];
  settings: Record<string, unknown>;
  layerErrors: Array<{ path: string; message: string }>;
  adapter: AdapterVerdict;
}

function view(over: Partial<ViewShape> = {}): ViewShape {
  return { cwd: "", servers: [], settings: {}, layerErrors: [], adapter: OK, ...over };
}

/** GET /effective → `current`; PUT .../disabled flips it so the refetch converges. */
function makeFetch(current: ViewShape) {
  let state = current;
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/effective")) return jsonOk(state);
    if (u.includes("/disabled")) {
      const body = JSON.parse(String(init?.body)) as { disabled: boolean };
      const raw = u.split("/servers/")[1]?.split("/disabled")[0] ?? "";
      const name = decodeURIComponent(raw);
      state = {
        ...state,
        servers: state.servers.map((s: Server) =>
          s.name === name ? { ...s, entry: { ...s.entry, disabled: body.disabled } } : s,
        ),
      };
      return jsonOk({ ok: true });
    }
    throw new Error(`unexpected request: ${u}`);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  invalidateEffective();
});

describe("adapter status drives pill + banner + read-only", () => {
  it("below-floor: pill and banner name the same installed version and floor", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(
        view({ adapter: { kind: "below-floor", installed: "2.19.0", floor: "2.20.0" } }),
      ),
    );
    render(<McpSettings />);
    const pill = await screen.findByTestId("mcp-adapter-pill");
    const banner = screen.getByTestId("mcp-adapter-banner");
    for (const el of [pill, banner]) {
      expect(el.textContent).toContain("2.19.0");
      expect(el.textContent).toContain("2.20.0");
    }
    expect(screen.getByTestId("mcp-adapter-upgrade")).toBeTruthy();
    expect(isDisabled("mcp-add-server")).toBe(true);
  });

  it("absent: banner offers install and existing servers still render read-only", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(
        view({
          adapter: { kind: "absent", floor: "2.20.0" },
          servers: [{ name: "iMCP", entry: { command: "/bin/imcp" }, provenance: PI_PROV }],
        }),
      ),
    );
    render(<McpSettings />);
    expect(await screen.findByTestId("mcp-adapter-install")).toBeTruthy();
    expect(screen.getByTestId("mcp-server-row-iMCP")).toBeTruthy();
    expect(isDisabled("mcp-server-toggle-iMCP")).toBe(true);
  });
});

describe("server list (task 7.2)", () => {
  it("renders pi-global as editable, shared as locked View-only, sorted by name", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(
        view({
          servers: [
            { name: "zeta", entry: { url: "https://z/mcp" }, provenance: SHARED_PROV },
            { name: "alpha", entry: { command: "/bin/a", disabled: true }, provenance: PI_PROV },
          ],
        }),
      ),
    );
    render(<McpSettings />);
    await screen.findByTestId("mcp-server-row-alpha");

    const list = screen.getByTestId("mcp-server-list");
    const rows = list.querySelectorAll("li[data-testid^='mcp-server-row-']");
    expect((rows[0] as HTMLElement).dataset.testid).toBe("mcp-server-row-alpha");

    expect(screen.getByTestId("mcp-badge-alpha-Pi global")).toBeTruthy();
    expect(screen.getByTestId("mcp-server-action-alpha").textContent).toBe("Edit");
    expect(isDisabled("mcp-server-toggle-alpha")).toBe(false);

    const sharedBadge = screen.getByTestId("mcp-badge-zeta-Shared");
    expect(sharedBadge.querySelector("svg")).toBeTruthy(); // lock icon
    expect(screen.getByTestId("mcp-server-action-zeta").textContent).toBe("View");
    expect(isDisabled("mcp-server-toggle-zeta")).toBe(true);
  });

  it("shows a parse-error row while other layers still render", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(
        view({
          servers: [{ name: "keep", entry: { command: "/bin/k" }, provenance: PI_PROV }],
          layerErrors: [{ path: "/broken/mcp.json", message: "Unexpected token }" }],
        }),
      ),
    );
    render(<McpSettings />);
    const err = await screen.findByTestId("mcp-layer-error");
    expect(err.textContent).toContain("/broken/mcp.json");
    expect(err.textContent).toContain("Unexpected token");
    expect(screen.getByTestId("mcp-server-row-keep")).toBeTruthy();
  });

  it("shows the empty state with Add + docs when no layer defines a server", async () => {
    vi.stubGlobal("fetch", makeFetch(view()));
    render(<McpSettings />);
    await screen.findByTestId("mcp-empty");
    expect(screen.getByTestId("mcp-empty-add")).toBeTruthy();
    expect(screen.getByTestId("mcp-docs-link")).toBeTruthy();
  });

  it("renders skeleton rows until the effective view arrives", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<McpSettings />);
    expect(screen.getByTestId("mcp-list-skeleton")).toBeTruthy();
  });

  it("504 adapter-timeout names the timeout and offers retry + a link to the field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonErr(504, { error: "adapter-timeout", timeoutMs: 10000 })),
    );
    render(<McpSettings />);
    const notice = await screen.findByTestId("mcp-timeout");
    expect(notice.textContent).toContain("10000");
    expect(screen.getByTestId("mcp-timeout-retry")).toBeTruthy();
    expect(screen.getByTestId("mcp-timeout-link").getAttribute("href")).toBe("#mcp-adapter-timeout");
  });
});

describe("row enable/disable (task 7.3)", () => {
  it("persists the disabled flag at global scope and converges", async () => {
    const fetchMock = makeFetch(
      view({
        servers: [{ name: "srv", entry: { command: "/bin/s" }, provenance: PI_PROV }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettings />);
    const toggle = await screen.findByTestId("mcp-server-toggle-srv");
    expect(isChecked("mcp-server-toggle-srv")).toBe(true);

    fireEvent.click(toggle);
    await waitFor(() => expect(isChecked("mcp-server-toggle-srv")).toBe(false));

    const put = fetchMock.mock.calls.find(([u]) => String(u).includes("/disabled"));
    if (!put) throw new Error("no disabled PUT was issued");
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({
      scope: "global",
      disabled: true,
    });
  });

  it("reverts with an inline error when the write fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/effective")) {
          return jsonOk(
            view({ servers: [{ name: "srv", entry: { command: "/bin/s" }, provenance: PI_PROV }] }),
          );
        }
        return jsonErr(500, { error: "write-failed", message: "disk full" });
      }),
    );
    render(<McpSettings />);
    const toggle = await screen.findByTestId("mcp-server-toggle-srv");
    fireEvent.click(toggle);

    const error = await screen.findByTestId("mcp-server-error-srv");
    expect(error.textContent).toContain("disk full");
    expect(isChecked("mcp-server-toggle-srv")).toBe(true); // reverted
    expect(isDisabled("mcp-server-toggle-srv")).toBe(false);
  });
});
