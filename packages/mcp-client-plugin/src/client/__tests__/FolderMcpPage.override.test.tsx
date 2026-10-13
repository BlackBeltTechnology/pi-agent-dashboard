/**
 * Folder page: project overrides (mcp-client-project-overrides test-plan
 * F1–F10, F12): badges, switch, Reset/Remove/Convert with exact undo, the
 * Project settings panel, the untrusted pending note, shadowed global rows.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderMcpPage } from "../FolderMcpPage.js";
import { __resetNotTrackedCache, invalidateEffective } from "../hooks.js";

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({
  useT: () => (_key: string, _params?: unknown, fallback?: string) => fallback ?? _key,
}));

const CWD = "/repo/override-wt";

const jsonOk = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const jsonErr = (status: number, body: unknown): Response => ({ ok: false, status, json: async () => body }) as unknown as Response;

interface Row extends Record<string, unknown> {
  name: string;
}

function globalRow(name: string, over: Record<string, unknown> = {}, override?: Record<string, unknown>, inherited = { enabled: true, exposure: "codemode" }): Row {
  const enabled = over.enabled !== false;
  return {
    name,
    provenance: "pi-global",
    entry: { url: "https://x.example/mcp", ...over },
    transport: "http",
    enabled,
    exposure: "codemode",
    active: enabled,
    ignoredKeys: [],
    adapterLeftovers: [],
    ...(override ? { projectOverride: { path: `${CWD}/.pi/mcp.json`, keys: Object.keys(override), raw: override, inherited } } : {}),
  };
}

function folderRow(name: string, entry: Record<string, unknown>, extra: Record<string, unknown> = {}): Row {
  return {
    name,
    provenance: "pi-folder",
    entry,
    transport: "http",
    enabled: entry.enabled !== false,
    exposure: "codemode",
    active: true,
    ignoredKeys: [],
    adapterLeftovers: [],
    ...extra,
  };
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function setup(servers: Row[], opts: { trusted?: boolean; removed?: Record<string, unknown>; enabled?: () => Promise<Response>; previous?: Record<string, unknown> } = {}) {
  const calls: Call[] = [];
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test fetch router, one branch per route
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (method === "GET" && u.includes("/effective")) {
      return jsonOk({ scope: "project", cwd: CWD, trusted: opts.trusted ?? true, servers, layers: [] });
    }
    if (method === "GET" && u.includes("/schema")) return jsonOk({ $defs: {} });
    calls.push({ url: u, method, body });
    if (method === "PUT" && u.endsWith("/enabled")) return opts.enabled ? opts.enabled() : jsonOk({ ok: true, action: "written" });
    if (method === "DELETE") return jsonOk({ ok: true, removed: opts.removed ?? {} });
    if (method === "PUT" && u.endsWith("/project-override")) return jsonOk({ ok: true, override: {} });
    if (method === "POST" && u.endsWith("/convert-to-override")) return jsonOk({ ok: true, previous: opts.previous ?? {} });
    if (method === "PUT") return jsonOk({ ok: true });
    throw new Error(`unexpected ${method} ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function renderPage() {
  return render(<FolderMcpPage params={{ encodedCwd: encodeURIComponent(CWD) }} onBack={vi.fn()} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetNotTrackedCache();
  invalidateEffective(CWD);
});

describe("F1: override badges and Reset", () => {
  it("shows text badges and one Reset to global per overridden row", async () => {
    setup([
      globalRow("a", { enabled: false }, { enabled: false }),
      globalRow("b", {}, { enabled: true }),
      globalRow("c", { exposure: "direct" }, { exposure: "direct" }),
      globalRow("plain"),
    ]);
    renderPage();
    expect((await screen.findByTestId("mcp-override-badge-pi-global:a-enabled")).textContent).toBe("Off in this folder");
    expect(screen.getByTestId("mcp-override-badge-pi-global:b-enabled").textContent).toBe("On in this folder");
    expect(screen.getByTestId("mcp-override-badge-pi-global:c-exposure").textContent).toBe("Exposure: direct in this folder");
    for (const k of ["a", "b", "c"]) expect(screen.getByTestId(`mcp-folder-reset-pi-global:${k}`).textContent).toBe("Reset to global");
    expect(screen.queryByTestId("mcp-folder-reset-pi-global:plain")).toBeNull();
    expect(screen.queryByTestId("mcp-override-badge-pi-global:plain-enabled")).toBeNull();
  });
});

describe("F2: the switch calls setEnabled at project scope", () => {
  it("is pending until the write resolves", async () => {
    let release: (r: Response) => void = () => {};
    const calls = setup([globalRow("docs")], { enabled: () => new Promise<Response>((r) => (release = r)) });
    renderPage();
    const sw = (await screen.findByTestId("mcp-server-toggle-pi-global:docs")) as HTMLInputElement;
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute("aria-busy")).toBe("true"));
    expect(calls.filter((c) => c.url.endsWith("/enabled"))).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ scope: "project", cwd: CWD, enabled: false });
    release(jsonOk({ ok: true, action: "written" }));
    await waitFor(() => expect(sw.getAttribute("aria-busy")).toBe("false"));
  });

  it("reverts with an inline error when the write is refused", async () => {
    setup([globalRow("docs")], { enabled: async () => jsonErr(409, { error: "no-global-server", message: "boom" }) });
    renderPage();
    const sw = (await screen.findByTestId("mcp-server-toggle-pi-global:docs")) as HTMLInputElement;
    fireEvent.click(sw);
    expect((await screen.findByTestId("mcp-server-error-pi-global:docs")).textContent).toContain("boom");
    expect(sw.checked).toBe(true);
  });
});

describe("F3: Reset with exact undo", () => {
  it("DELETEs the override, then restores its raw keys via the override route", async () => {
    const raw = { enabled: false, toolExposure: { search: "direct" } };
    const calls = setup([globalRow("docs", { enabled: false }, raw)], { removed: raw });
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-reset-pi-global:docs"));
    await screen.findByTestId("mcp-folder-undo-toast");
    expect(calls[0]).toMatchObject({ method: "DELETE" });
    fireEvent.click(screen.getByTestId("mcp-folder-undo"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/project-override"))).toBe(true));
    const put = calls.find((c) => c.url.endsWith("/project-override")) as Call;
    expect(put.method).toBe("PUT");
    expect(put.body).toMatchObject({ scope: "project", cwd: CWD, enabled: false, exposure: null, toolExposure: { search: "direct" } });
    expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/servers/docs"))).toBe(false);
  });
});

describe("F4–F5: Remove undo routes", () => {
  const orphan = (): Row =>
    folderRow("ghost", { enabled: false }, { active: false, inactiveReason: "invalid-entry", piError: 'server "ghost" needs "command" or "url", or a global server to override', overrideIssue: "orphan" });

  it("F4: an orphan row has a disabled switch and its undo uses the override route", async () => {
    const calls = setup([orphan()], { removed: { enabled: false } });
    renderPage();
    const sw = (await screen.findByTestId("mcp-server-toggle-pi-folder:ghost")) as HTMLInputElement;
    expect(sw.disabled).toBe(true);
    expect(screen.getByTestId("mcp-pi-error-pi-folder:ghost").textContent).toContain("global server to override");
    expect(screen.getByTestId("mcp-folder-action-pi-folder:ghost").textContent).toBe("Remove");
    fireEvent.click(screen.getByTestId("mcp-folder-action-pi-folder:ghost"));
    await screen.findByTestId("mcp-folder-undo-toast");
    fireEvent.click(screen.getByTestId("mcp-folder-undo"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/ghost/project-override"))).toBe(true));
    expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/servers/ghost"))).toBe(false);
    const put = calls.find((c) => c.url.endsWith("/ghost/project-override")) as Call;
    expect(put.body).toMatchObject({ enabled: false, exposure: null, toolExposure: null });
  });

  it("F5: a whole-entry row keeps today's undo (PUT /servers/:name with the raw entry)", async () => {
    const entry = { command: "/bin/f", args: ["x"] };
    const calls = setup([folderRow("fsrv", entry, { transport: "stdio" })], { removed: entry });
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-chip-remove-pi-folder:fsrv"));
    await screen.findByTestId("mcp-folder-undo-toast");
    fireEvent.click(screen.getByTestId("mcp-folder-undo"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT") as Call;
    expect(put.url).toContain("/servers/fsrv");
    expect(put.url).not.toContain("project-override");
    expect(put.body.entry).toEqual(entry);
  });
});

describe("F6: legacy copy strip and Convert", () => {
  it("converts, then Undo re-PUTs the previous copy", async () => {
    const copy = { url: "https://docs.example/mcp", enabled: false };
    const calls = setup([globalRow("docs"), folderRow("docs", copy, { overridesGlobal: true, legacyCopy: true, enabled: false, active: false })], { previous: copy });
    renderPage();
    expect((await screen.findByTestId("mcp-legacy-strip-pi-folder:docs")).textContent).toContain("without credentials");
    fireEvent.click(screen.getByTestId("mcp-folder-convert-pi-folder:docs"));
    await screen.findByTestId("mcp-folder-undo-toast");
    expect(calls[0]).toMatchObject({ method: "POST" });
    expect(calls[0].url).toContain("/servers/docs/convert-to-override");
    fireEvent.click(screen.getByTestId("mcp-folder-undo"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT") as Call;
    expect(put.url).toContain("/servers/docs");
    expect(put.url).not.toContain("project-override");
    expect(put.body.entry).toEqual(copy);
  });
});

describe("F7–F8: Project settings panel", () => {
  it("F7: shows the override's state, focuses the checked radio, lists Inherit (<global>), toolExposure read-only", async () => {
    setup([globalRow("docs", { enabled: false }, { enabled: false, toolExposure: { search: "direct" } }, { enabled: true, exposure: "direct" })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-menu-pi-global:docs"));
    fireEvent.click(screen.getByTestId("mcp-folder-project-settings-pi-global:docs"));
    const panel = await screen.findByTestId("mcp-folder-project-panel");
    const off = within(panel).getByTestId("mcp-project-enabled-off") as HTMLInputElement;
    expect(off.checked).toBe(true);
    expect(document.activeElement).toBe(off);
    expect(within(panel).getByRole("radiogroup", { name: "Enabled in this folder" })).toBeTruthy();
    expect(within(panel).getByTestId("mcp-project-enabled-inherit").closest("label")?.textContent).toBe("Inherit (on)");
    const select = within(panel).getByTestId("mcp-project-exposure") as HTMLSelectElement;
    expect(select.options[0].textContent).toBe("Inherit (direct)");
    expect(within(panel).getByTestId("mcp-project-tool-exposure").textContent).toContain("search");
    expect(within(panel).getByTestId("mcp-project-tool-exposure").textContent).toContain("read-only");
  });

  it.each([
    ["inherit", "inherit", null, null],
    ["on", "hidden", true, "hidden"],
    ["off", "inherit", false, null],
  ])("F8: enabled=%s exposure=%s saves exactly the choice", async (en, exp, wantEnabled, wantExposure) => {
    const calls = setup([globalRow("docs", {}, { enabled: false }, { enabled: true, exposure: "codemode" })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-menu-pi-global:docs"));
    fireEvent.click(screen.getByTestId("mcp-folder-project-settings-pi-global:docs"));
    fireEvent.click(await screen.findByTestId(`mcp-project-enabled-${en}`));
    fireEvent.change(screen.getByTestId("mcp-project-exposure"), { target: { value: exp } });
    fireEvent.click(screen.getByTestId("mcp-project-save"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/project-override"))).toBe(true));
    const put = calls.find((c) => c.url.endsWith("/project-override")) as Call;
    expect(put.body.enabled).toBe(wantEnabled);
    expect(put.body.exposure).toBe(wantExposure);
    expect("toolExposure" in put.body).toBe(false);
    expect(put.body).toMatchObject({ scope: "project", cwd: CWD });
  });

  it("an untouched exposure keeps the file's alias literal", async () => {
    const calls = setup([globalRow("docs", {}, { exposure: "codemode-deferred" })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-folder-menu-pi-global:docs"));
    fireEvent.click(screen.getByTestId("mcp-folder-project-settings-pi-global:docs"));
    fireEvent.click(await screen.findByTestId("mcp-project-enabled-off"));
    fireEvent.click(screen.getByTestId("mcp-project-save"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/project-override"))).toBe(true));
    expect((calls.find((c) => c.url.endsWith("/project-override")) as Call).body.exposure).toBe("codemode-deferred");
  });
});

describe("F9: untrusted project", () => {
  it("writes, then states the change applies once trusted while the switch shows the global state", async () => {
    const calls = setup([globalRow("docs")], { trusted: false });
    renderPage();
    const sw = (await screen.findByTestId("mcp-server-toggle-pi-global:docs")) as HTMLInputElement;
    fireEvent.click(sw);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/enabled"))).toBe(true));
    expect((await screen.findByTestId("mcp-folder-pending-pi-global:docs")).textContent).toContain("applies once the project is trusted");
    await waitFor(() => expect(sw.checked).toBe(true));
  });

  it("an existing untrusted override shows on the global row, not as a second row", async () => {
    setup([globalRow("docs"), folderRow("docs", { enabled: false }, { active: false, inactiveReason: "project-not-trusted", enabled: false })], { trusted: false });
    renderPage();
    expect((await screen.findByTestId("mcp-override-badge-pi-global:docs-enabled")).textContent).toBe("Off in this folder");
    expect(screen.getByTestId("mcp-folder-pending-pi-global:docs")).toBeTruthy();
    expect(screen.queryByTestId("mcp-folder-row-pi-folder:docs")).toBeNull();
  });
});

describe("F10: shadowed global row", () => {
  it("has no switch, Reset or Project settings once a whole folder entry shadows it", async () => {
    setup([globalRow("docs", {}, { enabled: false }), folderRow("docs", { command: "/bin/docs" }, { overridesGlobal: true, transport: "stdio" })]);
    renderPage();
    expect(((await screen.findByTestId("mcp-server-toggle-pi-global:docs")) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("mcp-folder-menu-pi-global:docs") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("mcp-folder-reset-pi-global:docs") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("F12: the omitted note UI is gone", () => {
  it("renders no mcp-folder-omitted-* node after a disable", async () => {
    const calls = setup([globalRow("docs", { headers: { redacted: true, keys: [{ name: "Authorization", secret: true }] } })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("mcp-server-toggle-pi-global:docs"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/enabled"))).toBe(true));
    expect(document.querySelector('[data-testid^="mcp-folder-omitted-"]')).toBeNull();
  });
});
