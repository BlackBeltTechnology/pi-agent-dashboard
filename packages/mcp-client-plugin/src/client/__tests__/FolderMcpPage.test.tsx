/**
 * FolderMcpPage tests (change migrate-mcp-to-pi-builtin): provenance badges
 * with the whole-entry override marker, E12 (override pre-fill drops secrets
 * + auth and warns; the saved folder entry is complete without them and never
 * carries the server's redaction markers), the untrusted-folder notice with
 * inactive rows, needs-choice on folder enable, the omitted note after a
 * folder disable, override removal + undo (raw entry re-PUT), and 403.
 * Test-plan: E12; spec mcp-client-folder-section.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import schemaDoc from "../../../schema/mcp-config.schema.json";
import { FolderMcpPage } from "../FolderMcpPage.js";
import { __resetNotTrackedCache, invalidateEffective } from "../hooks.js";

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({
  useT: () => (_key: string, _params?: unknown, fallback?: string) => fallback ?? _key,
}));

const SCHEMA = schemaDoc as unknown as Record<string, unknown>;
const CWD = "/repo/wt";

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function jsonErr(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

/** A global-layer row as the server sends it in a PROJECT view (secrets redacted). */
function globalRow(name: string, entry: Record<string, unknown>): Record<string, unknown> {
  return { name, provenance: "pi-global", entry, transport: "http", enabled: true, exposure: "codemode", active: true, ignoredKeys: [], adapterLeftovers: [] };
}

function folderRow(name: string, entry: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    provenance: "pi-folder",
    entry,
    transport: "stdio",
    enabled: entry.enabled !== false,
    exposure: "codemode",
    active: true,
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

function view(over: Partial<ViewShape> = {}): ViewShape {
  return { scope: "project", cwd: CWD, trusted: true, servers: [], layers: [], ...over };
}

interface Recorded {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

/** Serves effective + schema; records PUT/DELETE; `enabledResult` gates /enabled replies. */
function makeFetch(current: ViewShape, opts: { removed?: Record<string, unknown>; enabledResult?: unknown } = {}) {
  const state = current;
  const calls: Recorded[] = [];
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test fetch router, one branch per route
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const record = (body: Record<string, unknown> = {}): void => {
      calls.push({ url: u, method, body });
    };
    if (method === "GET" && u.includes("/effective")) return jsonOk(state);
    if (method === "GET" && u.includes("/schema")) return jsonOk(SCHEMA);
    if (method === "PUT" && u.includes("/enabled")) {
      record(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonOk(opts.enabledResult ?? { ok: true, action: "written" });
    }
    if (method === "DELETE" && u.includes("/servers/")) {
      record();
      return jsonOk({ ok: true, removed: opts.removed ?? {} });
    }
    if (method === "PUT" && u.includes("/servers/")) {
      record(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonOk({ ok: true });
    }
    throw new Error(`unexpected request: ${method} ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function renderPage(cwd = CWD, onBack: () => void = vi.fn()) {
  return { onBack, ...render(<FolderMcpPage params={{ encodedCwd: encodeURIComponent(cwd) }} onBack={onBack} />) };
}

function lastCall(calls: Recorded[], method: string): Recorded {
  const found = calls.filter((c) => c.method === method).at(-1);
  if (!found) throw new Error(`no ${method} recorded`);
  return found;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetNotTrackedCache();
  invalidateEffective(CWD);
});

describe("override: whole entry, secrets not copied silently (test-plan E12)", () => {
  it("prefills without headers/auth, warns for both, and the PUT entry is complete except those", async () => {
    const { calls } = makeFetch(
      view({
        servers: [
          globalRow("docs", {
            url: "https://docs.example/mcp",
            description: "Docs server",
            exposure: "codemode",
            headers: { redacted: true, keys: [{ name: "Authorization", secret: true }] },
            auth: { provider: "radius" },
          }),
        ],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-action-pi-global:docs"));

    // warnings: headers dropped, auth dropped (and auth is global-only)
    expect((await screen.findByTestId("mcp-omitted-headers")).textContent).toContain("absent");
    expect(screen.getByTestId("mcp-omitted-auth").textContent).toContain("global-only");

    // change ONLY the exposure
    fireEvent.change(await screen.findByTestId("mcp-field-input-exposure"), { target: { value: "direct" } });
    fireEvent.click(screen.getByTestId("mcp-save"));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && !c.url.includes("/enabled"))).toBe(true));
    const put = lastCall(
      calls.filter((c) => !(c.method === "PUT" && c.url.includes("/enabled"))),
      "PUT",
    );
    expect(put.url).toContain("/servers/docs");
    expect(put.body.scope).toBe("project");
    expect(put.body.cwd).toBe(CWD);
    expect(put.body.entry).toEqual({
      url: "https://docs.example/mcp",
      description: "Docs server",
      exposure: "direct",
    });
    // the server's redaction markers must never be sent back
    expect(JSON.stringify(put.body)).not.toContain("redacted");
  });

  it("a folder row opens Edit on its own entry and a global row offers Override…", async () => {
    makeFetch(
      view({
        servers: [
          globalRow("g", { url: "https://g/mcp" }),
          { ...folderRow("f", { command: "/bin/f" }), overridesGlobal: true },
        ],
      }),
    );
    renderPage();
    await screen.findByTestId("mcp-folder-row-pi-folder:f");

    expect(screen.getByTestId("mcp-folder-action-pi-global:g").textContent).toBe("Override…");
    expect(screen.getByTestId("mcp-folder-action-pi-folder:f").textContent).toBe("Edit");
    // badge + override marker
    expect(screen.getByTestId("mcp-badge-pi-folder:f-Pi folder")).toBeTruthy();
    expect(screen.getByTestId("mcp-badge-pi-folder:f-overrides Pi global")).toBeTruthy();
  });
});

describe("untrusted folder", () => {
  it("shows the notice, renders folder rows inactive with the reason, and still allows editing", async () => {
    const { calls } = makeFetch(
      view({
        trusted: false,
        servers: [
          { ...folderRow("fsrv", { command: "/bin/f" }), active: false, inactiveReason: "project-not-trusted" },
          globalRow("g", { url: "https://g/mcp" }),
        ],
      }),
    );
    renderPage();

    expect(await screen.findByTestId("mcp-folder-untrusted").then((el) => el.textContent)).toContain("trusted");
    const reason = screen.getByTestId("mcp-inactive-pi-folder:fsrv");
    expect(reason.textContent).toContain("project not trusted");

    // editing <cwd>/.pi/mcp.json stays allowed
    fireEvent.click(screen.getByTestId("mcp-folder-action-pi-folder:fsrv"));
    fireEvent.change(await screen.findByTestId("mcp-field-input-command"), { target: { value: "/bin/g" } });
    fireEvent.click(screen.getByTestId("mcp-save"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(lastCall(calls, "PUT").body.scope).toBe("project");
  });
});

// review r1 B2: an untrusted folder can show a folder row AND a global row with
// the same name. Each row's actions must act on THAT row's entry.
describe("same-name rows keep their provenance", () => {
  it("Edit on the folder row pre-fills the folder entry; the global row's write actions are disabled", async () => {
    const { calls } = makeFetch(
      view({
        trusted: false,
        servers: [
          globalRow("docs", { url: "https://g.example/mcp", description: "global docs" }),
          { ...folderRow("docs", { command: "/bin/local-docs" }), active: false, inactiveReason: "project-not-trusted" },
        ],
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByTestId("mcp-folder-action-pi-folder:docs"));
    const command = (await screen.findByTestId("mcp-field-input-command")) as HTMLInputElement;
    expect(command.value).toBe("/bin/local-docs");
    fireEvent.click(screen.getByTestId("mcp-save"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = lastCall(calls, "PUT");
    expect(put.body.scope).toBe("project");
    expect((put.body.entry as Record<string, unknown>).command).toBe("/bin/local-docs");
    expect((put.body.entry as Record<string, unknown>).url).toBeUndefined();

    // A folder-scope write for "docs" lands on the folder entry, so the global
    // row's toggle must not pretend to act on the global entry.
    const globalToggle = screen.getByTestId("mcp-server-toggle-pi-global:docs") as HTMLInputElement;
    expect(globalToggle.disabled).toBe(true);
  });
});

describe("folder enable/disable writes", () => {
  it("a disable that omitted secrets shows a note naming them", async () => {
    makeFetch(
      view({
        servers: [
          globalRow("srv", {
            url: "https://s/mcp",
            headers: { redacted: true, keys: [{ name: "Authorization", secret: true }] },
          }),
        ],
      }),
      { enabledResult: { ok: true, action: "written", omitted: ["headers"] } },
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-server-toggle-pi-global:srv"));

    const note = await screen.findByTestId("mcp-folder-omitted-pi-global:srv");
    expect(note.textContent).toContain("headers");
  });

  it("needs-choice offers remove-folder-entry or re-enter; remove DELETEs at project scope", async () => {
    const { calls } = makeFetch(
      view({
        servers: [
          globalRow("srv", {
            url: "https://s/mcp",
            headers: { redacted: true, keys: [{ name: "Authorization", secret: true }] },
          }),
          folderRow("srv", { url: "https://s/mcp", enabled: false }, { overridesGlobal: true }),
        ],
      }),
      { enabledResult: { ok: true, action: "needs-choice", omitted: ["headers", "auth"] } },
    );
    renderPage();
    const toggle = await screen.findByTestId("mcp-server-toggle-pi-folder:srv");
    expect((toggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(toggle); // enable → needs-choice
    const panel = await screen.findByTestId("mcp-folder-needs-choice");
    expect(panel.textContent).toContain("headers");

    fireEvent.click(screen.getByTestId("mcp-choice-remove"));
    await waitFor(() => expect(screen.findByTestId("mcp-folder-undo-toast")).toBeTruthy());
    const del = lastCall(calls, "DELETE");
    expect(del.url).toContain("/servers/srv");
    const url = new URL(del.url, "http://localhost");
    expect(url.searchParams.get("scope")).toBe("project");
    expect(url.searchParams.get("cwd")).toBe(CWD);
  });

  it("needs-choice 'Re-enter omitted values' opens the editor on the folder entry", async () => {
    makeFetch(
      view({
        servers: [
          globalRow("srv", { url: "https://s/mcp" }),
          folderRow("srv", { url: "https://s/mcp", enabled: false }, { overridesGlobal: true }),
        ],
      }),
      { enabledResult: { ok: true, action: "needs-choice", omitted: ["headers"] } },
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-server-toggle-pi-folder:srv"));
    await screen.findByTestId("mcp-folder-needs-choice");

    fireEvent.click(screen.getByTestId("mcp-choice-reenter"));
    expect(await screen.findByTestId("mcp-folder-editor")).toBeTruthy();
  });
});

describe("override removal + undo", () => {
  it("DELETEs the folder key and Undo re-PUTs the removed raw entry", async () => {
    const removed = { command: "/bin/f", enabled: false, unknownKey: { n: [1] } };
    const { calls } = makeFetch(
      view({
        servers: [folderRow("f", removed, { overridesGlobal: true })],
      }),
      { removed },
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-chip-remove-pi-folder:f"));

    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    const del = lastCall(calls, "DELETE");
    expect(new URL(del.url, "http://localhost").searchParams.get("scope")).toBe("project");

    const toast = await screen.findByTestId("mcp-folder-undo-toast");
    expect(toast.textContent).toContain("f");
    fireEvent.click(screen.getByTestId("mcp-folder-undo"));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && !c.url.includes("/enabled"))).toBe(true));
    const put = lastCall(calls.filter((c) => !(c.method === "PUT" && c.url.includes("/enabled"))), "PUT");
    expect(put.url).toContain("/servers/f");
    expect(put.body.entry).toEqual(removed);
    expect(put.body.scope).toBe("project");
  });
});

describe("cwd guard", () => {
  it("403 renders the not-allowed state with no retry and no data", async () => {
    const { fetchMock } = makeFetch(view());
    fetchMock.mockImplementation(async () => jsonErr(403, { error: "not-allowed", message: "nope" }));
    renderPage("/unknown");

    await screen.findByTestId("mcp-folder-not-allowed");
    expect(screen.queryAllByTestId(/^mcp-folder-row-/)).toHaveLength(0);
    expect(screen.queryByTestId("mcp-server-list")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a malformed encode is refused without any request", async () => {
    const fetchMock = vi.fn(async () => jsonOk(view()));
    vi.stubGlobal("fetch", fetchMock);
    render(<FolderMcpPage params={{ encodedCwd: "%E0%A4%A" }} onBack={vi.fn()} />);
    await screen.findByTestId("mcp-folder-not-allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("navigation", () => {
  it("Back invokes onBack", async () => {
    makeFetch(view());
    const onBack = vi.fn();
    renderPage(CWD, onBack);
    fireEvent.click(await screen.findByTestId("mcp-folder-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
