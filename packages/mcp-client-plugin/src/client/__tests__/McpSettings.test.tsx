/**
 * Global settings section (change migrate-mcp-to-pi-builtin): Pi-global rows
 * with description / transport / exposure / auth mode / provenance badge,
 * live state from `/live` (state unknown when absent), the needs-auth sign-in
 * hint, parse-error rows, the adapter-leftover flag + one-click convert, and
 * the row enable toggle (persist + revert-on-failure).
 * Test-plan: E21 (description + auth modes), E28 (row enable toggle).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidateEffective } from "../hooks.js";
import { McpSettings } from "../McpSettings.js";

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({
  useT: () => (_key: string, _params?: unknown, fallback?: string) => fallback ?? _key,
}));

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function jsonErr(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

/** No jest-dom in this project's vitest setup — read the DOM property. */
function isDisabled(testid: string): boolean {
  return (screen.getByTestId(testid) as HTMLInputElement).disabled;
}
function isChecked(testid: string): boolean {
  return (screen.getByTestId(testid) as HTMLInputElement).checked;
}

function server(
  name: string,
  entry: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    provenance: "pi-global",
    entry,
    transport: typeof entry.url === "string" ? "http" : "stdio",
    enabled: entry.enabled !== false,
    exposure: "codemode",
    active: entry.enabled !== false,
    ignoredKeys: [],
    adapterLeftovers: [],
    ...extra,
  };
}

interface ViewShape {
  scope: "global";
  servers: Array<Record<string, unknown>>;
  layers: Array<Record<string, unknown>>;
}

function view(over: Partial<ViewShape> = {}): ViewShape {
  return { scope: "global", servers: [], layers: [], ...over };
}

const LIVE_OK = { ok: true, servers: {}, errors: [] };

/**
 * Serves GET /effective (`current`), GET /live (`live`), GET /schema; the
 * enabled PUT flips the row in `current` so the refetch converges; records
 * every mutating call.
 */
function makeFetch(current: ViewShape, live: unknown = LIVE_OK) {
  let state = current;
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test fetch router, one branch per route
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const record = (body: Record<string, unknown> = {}): void => {
      calls.push({ url: u, method, body });
    };
    if (method === "GET" && u.includes("/effective")) return jsonOk(state);
    if (method === "GET" && u.includes("/live")) return jsonOk(live);
    if (method === "GET" && u.includes("/schema")) return jsonOk({});
    if (method === "PUT" && u.includes("/enabled")) {
      record(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const name = decodeURIComponent(u.split("/servers/")[1]?.split("/enabled")[0] ?? "");
      const enabled = (JSON.parse(String(init?.body)) as { enabled: boolean }).enabled;
      state = {
        ...state,
        servers: state.servers.map((s) => (s.name === name ? { ...s, entry: { ...(s.entry as object), enabled }, enabled } : s)),
      };
      return jsonOk({ ok: true, action: "written" });
    }
    if (method === "POST" && u.includes("/convert")) {
      record(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const name = decodeURIComponent(u.split("/servers/")[1]?.split("/convert")[0] ?? "");
      state = {
        ...state,
        servers: state.servers.map((s) =>
          s.name === name
            ? {
                ...s,
                entry: { url: "https://x/mcp", enabled: false },
                enabled: false,
                adapterLeftovers: [],
                ignoredKeys: [],
              }
            : s,
        ),
      };
      return jsonOk({ ok: true });
    }
    throw new Error(`unexpected request: ${method} ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  invalidateEffective();
});

describe("rows: description, auth modes, badges (test-plan E21)", () => {
  it("shows description and provider/header/OAuth auth modes; provider has no sign-in hint", async () => {
    makeFetch(
      view({
        servers: [
          server("radius", { url: "https://r/mcp", auth: { provider: "radius" }, description: "Radius docs" }),
          server("hdr", { url: "https://h/mcp", headers: { Authorization: "Bearer t" } }),
          server("apikey", { url: "https://k/mcp", headers: { "X-Api-Key": "k" } }),
        ],
      }),
    );
    render(<McpSettings />);
    await screen.findByTestId("mcp-server-row-radius");

    // description shown on the row that carries one
    expect(screen.getByTestId("mcp-server-description-radius").textContent).toBe("Radius docs");

    // auth modes
    expect(screen.getByTestId("mcp-authmode-radius").textContent).toBe("auth: radius");
    expect(screen.getByTestId("mcp-authmode-hdr").textContent).toBe("header");
    expect(screen.getByTestId("mcp-authmode-apikey").textContent).toBe("OAuth");

    // provider auth: NO sign-in hint anywhere
    expect(screen.queryByTestId("mcp-signin-hint-radius")).toBeNull();

    // provenance badge
    expect(screen.getByTestId("mcp-badge-radius-Pi global")).toBeTruthy();
    // transport + exposure render
    expect(screen.getByTestId("mcp-transport-radius").textContent).toBe("url");
    expect(screen.getByTestId("mcp-exposure-radius").textContent).toBe("codemode");
  });
});

describe("rows: live state (from /live)", () => {
  it("shows pi state + tool count, 'state unknown' when absent, and the needs-auth hint for OAuth rows", async () => {
    makeFetch(
      view({
        servers: [
          server("conn", { command: "/bin/c" }),
          server("ghost", { command: "/bin/g" }),
          server("oauth", { url: "https://o/mcp" }),
        ],
      }),
      {
        ok: true,
        servers: {
          conn: { state: "connected", tools: 3 },
          oauth: { state: "needs-auth", tools: 0 },
        },
        errors: [],
      },
    );
    render(<McpSettings />);
    await screen.findByTestId("mcp-server-row-conn");

    expect(screen.getByTestId("mcp-live-conn").textContent).toContain("connected");
    expect(screen.getByTestId("mcp-live-conn").textContent).toContain("3");
    // absent from /live → state unknown
    expect(screen.getByTestId("mcp-live-ghost").textContent).toContain("state unknown");

    // needs-auth on an OAuth (no header/auth) row → sign-in hint naming /mcp login
    expect(screen.getByTestId("mcp-signin-hint-oauth").textContent).toContain("/mcp login oauth");
    // the connected stdio row has no hint
    expect(screen.queryByTestId("mcp-signin-hint-conn")).toBeNull();
  });

  it("live ok:false renders every row as state unknown", async () => {
    makeFetch(view({ servers: [server("srv", { command: "/bin/s" })] }), {
      ok: false,
      reason: "timeout",
      message: "timed out",
    });
    render(<McpSettings />);
    expect((await screen.findByTestId("mcp-live-srv")).textContent).toContain("state unknown");
  });
});

describe("parse-error row", () => {
  it("names the path + message and states that pi skips the file", async () => {
    makeFetch(
      view({
        layers: [
          { layer: "pi-global", path: "/h/.pi/agent/mcp.json", exists: true, ok: false, message: "Unexpected token }" },
        ],
      }),
    );
    render(<McpSettings />);
    const row = await screen.findByTestId("mcp-layer-error");
    expect(row.textContent).toContain("/h/.pi/agent/mcp.json");
    expect(row.textContent).toContain("Unexpected token");
    expect(row.textContent).toContain("skips");
  });
});

describe("adapter leftovers: ignored-by-pi flag + convert", () => {
  it("flags the ignored keys and converts on one click", async () => {
    const { calls } = makeFetch(
      view({
        servers: [
          server("legacy", { url: "https://x/mcp", disabled: true, directTools: ["a"], lifecycle: "lazy" }, {
            adapterLeftovers: ["disabled", "directTools", "lifecycle"],
            ignoredKeys: ["disabled", "directTools", "lifecycle"],
          }),
        ],
      }),
    );
    render(<McpSettings />);
    const flag = await screen.findByTestId("mcp-leftovers-legacy");
    expect(flag.textContent).toContain("ignored by pi");
    expect(flag.textContent).toContain("directTools");

    fireEvent.click(screen.getByTestId("mcp-convert-legacy"));
    await waitFor(() =>
      expect(screen.queryByTestId("mcp-leftovers-legacy")).toBeNull(),
    );
    const convert = calls.find((c) => c.method === "POST");
    expect(convert?.url).toContain("/servers/legacy/convert");
    expect(convert?.body).toEqual({ scope: "global" });
  });
});

describe("row enable toggle (test-plan E28)", () => {
  it("writes enabled:false at global scope, pending until the write, then disabled", async () => {
    let releaseWrite: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test fetch router, one branch per route
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "GET" && u.includes("/effective")) {
        return jsonOk(
          view({ servers: [server("srv", { command: "/bin/s" })] }),
        );
      }
      if (method === "GET" && u.includes("/live")) return jsonOk(LIVE_OK);
      if (method === "GET" && u.includes("/schema")) return jsonOk({});
      if (method === "PUT" && u.includes("/enabled")) {
        await gate;
        return jsonOk({ ok: true, action: "written" });
      }
      throw new Error(`unexpected request: ${method} ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<McpSettings />);
    const toggle = await screen.findByTestId("mcp-server-toggle-srv");
    expect(isChecked("mcp-server-toggle-srv")).toBe(true);

    fireEvent.click(toggle);
    // pending: the switch is disabled until the write completes
    expect(isDisabled("mcp-server-toggle-srv")).toBe(true);
    expect(toggle.getAttribute("aria-busy")).toBe("true");

    releaseWrite(undefined);
    await waitFor(() => expect(isChecked("mcp-server-toggle-srv")).toBe(false));
    const put = fetchMock.mock.calls.find(
      ([u, init]) => String(u).includes("/enabled") && (init as RequestInit | undefined)?.method === "PUT",
    );
    if (!put) throw new Error("no enabled PUT was issued");
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({
      scope: "global",
      enabled: false,
    });
  });

  it("reverts with an inline error when the write fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/effective")) {
          return jsonOk(view({ servers: [server("srv", { command: "/bin/s" })] }));
        }
        if (u.includes("/live")) return jsonOk(LIVE_OK);
        if (u.includes("/schema")) return jsonOk({});
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

describe("section chrome", () => {
  it("renders skeleton rows until the effective view arrives", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<McpSettings />);
    expect(screen.getByTestId("mcp-list-skeleton")).toBeTruthy();
  });

  it("Add server is enabled and a generic load error renders", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/effective")) return jsonErr(500, { error: "boom", message: "boom" });
        throw new Error(`unexpected request: ${u}`);
      }),
    );
    render(<McpSettings />);
    expect(await screen.findByTestId("mcp-error")).toBeTruthy();
    expect(isDisabled("mcp-add-server")).toBe(false);
  });
});
