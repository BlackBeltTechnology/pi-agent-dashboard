/**
 * Source add UX, trust consent, per-source status, refresh points and the
 * test-search panel. See change: improve-kb-settings-sources-and-search
 * (test-plan E5–E9, E33, F1–F9).
 */
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { UiPrimitiveMap } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KbConfigResponse,
  KbSearchHit,
  KbSearchResponse,
  KbSourceStatus,
  KbStats,
  SourceConfig,
} from "../../shared/kb-plugin-types.js";
import { KbSettingsPanel } from "../KbSettingsPanel.js";
import { KbTestSearch } from "../KbTestSearch.js";
import { resetKbStatsStores } from "../useKbStats.js";

beforeEach(() => resetKbStatsStores());
afterEach(() => {
  cleanup();
  resetKbStatsStores();
  vi.restoreAllMocks();
});

// ── fixtures ────────────────────────────────────────────────────
const G = "https://github.com/o/r";
const jsonOk = (body: unknown): Response =>
  ({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => body }) as unknown as Response;
const jsonFail = (body: unknown, status = 500): Response =>
  ({ ok: false, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body }) as unknown as Response;
const statsBody = (over: Partial<KbStats> = {}): KbStats => ({ files: 1, chunks: 5, indexed: true, staleCount: 0, indexing: false, jobStatus: "idle", ...over });

function cfg(specs: SourceConfig[], formSources: SourceConfig[] = specs): KbConfigResponse {
  return {
    origin: "project",
    projectPath: "/repo/.pi/dashboard/knowledge_base.json",
    config: { sources: formSources, allSourceSpecs: specs, resolvedSources: [], include: [], exclude: [], dbPath: "db" } as unknown as KbConfigResponse["config"],
  };
}

interface Routes {
  config?: KbConfigResponse;
  sources?: () => KbSourceStatus[];
  put?: (body: Record<string, unknown>) => Response;
  trustPost?: () => Response;
  stats?: () => Response;
}
function panelFetch(o: Routes = {}): ReturnType<typeof vi.fn> {
  const config = o.config ?? cfg([{ kind: "filesystem", ref: "docs" }]);
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat endpoint router for one fetch mock — splitting it would only scatter the route table.
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/kb/stats")) return (o.stats ?? (() => jsonOk(statsBody())))();
    if (u.includes("/api/kb/sources")) return jsonOk({ sources: o.sources?.() ?? [] });
    if (u.includes("/api/kb/source-trust")) return (o.trustPost ?? (() => jsonOk({ hash: "h", subject: "s" })))();
    if (u.includes("/api/kb/reindex")) return jsonOk({ status: "running", jobId: "kb-1" });
    if (u.includes("/api/kb/config") && init?.method === "PUT") return o.put ? o.put(JSON.parse(String(init.body))) : jsonOk(config);
    return jsonOk(config);
  });
}
const calls = (m: ReturnType<typeof vi.fn>, needle: string, method?: string) =>
  m.mock.calls.filter((c) => String(c[0]).includes(needle) && (method ? (c[1] as RequestInit | undefined)?.method === method : true));
const putBodies = (m: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> =>
  calls(m, "/api/kb/config", "PUT").map((c) => JSON.parse(String((c[1] as RequestInit).body)));

const MockDialog = Object.assign(
  ({ open, title, children, testId }: { open: boolean; title?: string; children: React.ReactNode; testId?: string }) =>
    open ? (
      <div data-testid={testId}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  { Footer: () => null, Cancel: () => null, Action: () => null },
) as unknown as UiPrimitiveMap["ui:dialog"];
const MockPicker: UiPrimitiveMap["ui:path-picker"] = ({ open, onSelect, onCancel }) =>
  open ? (
    <div data-testid="mock-picker">
      <button type="button" data-testid="mock-pick" onClick={() => onSelect("/repo/docs/api")}>pick</button>
      <button type="button" data-testid="mock-cancel" onClick={onCancel}>cancel</button>
    </div>
  ) : null;

type Prims = Partial<UiPrimitiveMap>;
function mountPanel(fetchMock: ReturnType<typeof vi.fn>, prims: Prims = { "ui:dialog": MockDialog, "ui:path-picker": MockPicker }) {
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  return render(withUiPrimitiveProvider(prims, <KbSettingsPanel cwd="/repo" onBack={() => {}} />));
}
type Q = ReturnType<typeof render>;
const ready = async (r: Q) => waitFor(() => expect(r.getByTestId("kb-source-input")).toBeTruthy());
const typeRef = (r: Q, v: string) => fireEvent.change(r.getByTestId("kb-source-input"), { target: { value: v } });
const rows = (r: Q) => r.queryAllByTestId("kb-source-row").length;
const pressed = (r: Q, k: string) => r.getByTestId(`kb-source-kind-${k}`).getAttribute("aria-pressed");

// ── add UX ──────────────────────────────────────────────────────
describe("KbSourceAdd", () => {
  it("E5 Folder mode refuses URL-shaped input with a hint; a plain folder is added as filesystem", async () => {
    const r = mountPanel(panelFetch());
    await ready(r);
    expect(rows(r)).toBe(1);
    for (const bad of ["https://x/y", "ssh://h/r"]) {
      typeRef(r, bad);
      fireEvent.click(r.getByTestId("kb-source-add"));
      expect(rows(r), bad).toBe(1);
      expect(r.getByTestId("kb-source-hint").textContent).toMatch(/remote source/i);
    }
    typeRef(r, "npm:pkg");
    fireEvent.click(r.getByTestId("kb-source-add"));
    expect(rows(r)).toBe(1);
    expect(r.getByTestId("kb-source-hint").textContent).toMatch(/npm/i);
    typeRef(r, "notes");
    fireEvent.click(r.getByTestId("kb-source-add"));
    expect(rows(r)).toBe(2);
    expect(r.queryByTestId("kb-trust-dialog")).toBeNull(); // folders need no trust
  });

  it("E6 git host URLs auto-select Git; an arbitrary https URL stays Folder", async () => {
    const r = mountPanel(panelFetch());
    await ready(r);
    for (const v of ["https://github.com/o/r", "https://gitlab.com/o/r", "git:h/r", "git@h:r"]) {
      fireEvent.click(r.getByTestId("kb-source-kind-filesystem"));
      typeRef(r, v);
      expect(pressed(r, "git"), v).toBe("true");
    }
    fireEvent.click(r.getByTestId("kb-source-kind-filesystem"));
    typeRef(r, "https://example.org/x.md");
    expect(pressed(r, "filesystem")).toBe("true");
  });

  it("E7 kind selector sets the source kind: git keeps pin/refresh (no empty subdir), URL is https", async () => {
    const fetchMock = panelFetch();
    const r = mountPanel(fetchMock);
    await ready(r);
    fireEvent.click(r.getByTestId("kb-source-kind-git"));
    typeRef(r, "https://h/r.git");
    fireEvent.change(r.getByTestId("kb-source-pin"), { target: { value: "main" } });
    fireEvent.click(r.getByTestId("kb-source-add"));
    fireEvent.click(r.getByTestId("kb-trust-add-untrusted"));
    fireEvent.click(r.getByTestId("kb-source-kind-https"));
    typeRef(r, "https://h/a.tgz");
    fireEvent.click(r.getByTestId("kb-source-add"));
    fireEvent.click(r.getByTestId("kb-trust-add-untrusted"));
    fireEvent.click(r.getByTestId("kb-save"));
    await waitFor(() => expect(putBodies(fetchMock)).toHaveLength(1));
    const sources = putBodies(fetchMock)[0].sources as SourceConfig[];
    const git = sources.find((s) => s.ref === "https://h/r.git");
    expect(git).toMatchObject({ kind: "git", pin: "main", refresh: "manual" });
    expect(git).not.toHaveProperty("subdir");
    expect(sources.find((s) => s.ref === "https://h/a.tgz")).toMatchObject({ kind: "https" });
    expect(putBodies(fetchMock)[0]).not.toHaveProperty("trustRefs");
  });

  it("E8 one source per ref: a second source with an existing ref is refused with a hint", async () => {
    const saved: SourceConfig[] = [{ kind: "git", ref: "https://h/r.git", pin: "main" }];
    const r = mountPanel(panelFetch({ config: cfg(saved) }));
    await ready(r);
    fireEvent.click(r.getByTestId("kb-source-kind-git"));
    typeRef(r, "https://h/r.git");
    fireEvent.change(r.getByTestId("kb-source-pin"), { target: { value: "dev" } });
    fireEvent.click(r.getByTestId("kb-source-add"));
    expect(rows(r)).toBe(1);
    expect(r.getByTestId("kb-source-hint").textContent).toMatch(/one ref is one index root/i);
    expect(r.queryByTestId("kb-trust-dialog")).toBeNull();
  });

  it("E9 without ui:path-picker there is no Browse…, and typing + Add still works", async () => {
    const r = mountPanel(panelFetch(), { "ui:dialog": MockDialog });
    await ready(r);
    expect(r.queryByTestId("kb-source-browse")).toBeNull();
    typeRef(r, "notes");
    fireEvent.click(r.getByTestId("kb-source-add"));
    expect(rows(r)).toBe(2);
  });

  it("Browse… stores an inside folder relative and shows no outside badge", async () => {
    const r = mountPanel(panelFetch());
    await ready(r);
    fireEvent.click(r.getByTestId("kb-source-browse"));
    fireEvent.click(r.getByTestId("mock-pick"));
    await waitFor(() => expect(rows(r)).toBe(2));
    expect(r.getAllByTestId("kb-source-row")[1].textContent).toContain("docs/api");
    expect(r.queryByTestId("kb-source-outside")).toBeNull();
  });
});

// ── gate ────────────────────────────────────────────────────────
describe("rebuild gate follows every saved spec (E33)", () => {
  const enabled = (r: Q) => !(r.getByTestId("kb-reindex-now") as HTMLButtonElement).disabled;
  it("(a) remote-only saved config → enabled", async () => {
    const r = mountPanel(panelFetch({ config: cfg([{ kind: "git", ref: G }]) }));
    await waitFor(() => expect(enabled(r)).toBe(true));
  });
  it("(b) nothing saved + a typed source → disabled with a visible reason", async () => {
    const r = mountPanel(panelFetch({ config: cfg([]) }));
    await ready(r);
    typeRef(r, "notes");
    fireEvent.click(r.getByTestId("kb-source-add"));
    expect((r.getByTestId("kb-reindex-now") as HTMLButtonElement).disabled).toBe(true);
    expect(r.getByTestId("kb-reindex-unavailable").textContent).toBeTruthy();
  });
  it("(c) filesystem saved + form emptied → still enabled", async () => {
    const r = mountPanel(panelFetch());
    await ready(r);
    fireEvent.click(r.getByTestId("kb-source-remove"));
    expect(rows(r)).toBe(0);
    await waitFor(() => expect(enabled(r)).toBe(true));
  });
});

// ── trust consent ───────────────────────────────────────────────
describe("trust dialog + grants", () => {
  const addGit = (r: Q) => {
    typeRef(r, G); // auto-selects Git
    fireEvent.click(r.getByTestId("kb-source-add"));
  };

  it("F1 a remote add opens the dialog with the required facts; Cancel adds nothing", async () => {
    const r = mountPanel(panelFetch());
    await ready(r);
    addGit(r);
    const d = r.getByTestId("kb-trust-dialog");
    expect(d.textContent).toContain(G);
    expect(d.textContent).toContain("git");
    expect(r.getByTestId("kb-trust-agent-warning").textContent).toMatch(/agents/i);
    expect(r.getByTestId("kb-trust-global-note").textContent).toMatch(/every folder/i);
    expect(d.textContent).not.toMatch(/cache|ssrf/i);
    fireEvent.click(r.getByTestId("kb-trust-cancel"));
    expect(r.queryByTestId("kb-trust-dialog")).toBeNull();
    expect(rows(r)).toBe(1);
  });

  it("F2 Trust & add sends trustRefs; a response without untrustedRefs shows the trusted badge", async () => {
    let trusted = false;
    const fetchMock = panelFetch({
      config: cfg([{ kind: "filesystem", ref: "docs" }]),
      sources: () => [{ ref: G, kind: "git", files: 0, trusted, outside: false }],
      put: (body) => {
        trusted = true;
        return jsonOk(cfg(body.sources as SourceConfig[]));
      },
    });
    const r = mountPanel(fetchMock);
    await ready(r);
    addGit(r);
    fireEvent.click(r.getByTestId("kb-trust-confirm"));
    fireEvent.click(r.getByTestId("kb-save"));
    await waitFor(() => expect(putBodies(fetchMock)).toHaveLength(1));
    expect(putBodies(fetchMock)[0].trustRefs).toEqual([G]);
    await waitFor(() => expect(r.getByTestId("kb-source-trusted")).toBeTruthy());
    expect(r.queryByTestId("kb-untrusted-note")).toBeNull();
  });

  it("F2 a response with untrustedRefs shows the not-trusted badge and a message (never claims success)", async () => {
    const fetchMock = panelFetch({
      sources: () => [{ ref: G, kind: "git", files: 0, trusted: false, outside: false }],
      put: (body) => jsonOk({ ...cfg(body.sources as SourceConfig[]), untrustedRefs: [G] }),
    });
    const r = mountPanel(fetchMock);
    await ready(r);
    addGit(r);
    fireEvent.click(r.getByTestId("kb-trust-confirm"));
    fireEvent.click(r.getByTestId("kb-save"));
    await waitFor(() => expect(r.getByTestId("kb-untrusted-note").textContent).toContain(G));
    await waitFor(() => expect(r.getByTestId("kb-source-untrusted")).toBeTruthy());
  });

  it("F3 Add without trusting → no trustRefs; the saved row offers Trust… which POSTs source-trust and refetches", async () => {
    let trusted = false;
    const fetchMock = panelFetch({
      sources: () => [{ ref: G, kind: "git", files: 0, trusted, outside: false }],
      put: (body) => jsonOk(cfg(body.sources as SourceConfig[])),
      trustPost: () => {
        trusted = true;
        return jsonOk({ hash: "h", subject: "s" });
      },
    });
    const r = mountPanel(fetchMock);
    await ready(r);
    addGit(r);
    fireEvent.click(r.getByTestId("kb-trust-add-untrusted"));
    fireEvent.click(r.getByTestId("kb-save"));
    await waitFor(() => expect(putBodies(fetchMock)).toHaveLength(1));
    expect(putBodies(fetchMock)[0]).not.toHaveProperty("trustRefs");
    await waitFor(() => expect(r.getByTestId("kb-source-untrusted")).toBeTruthy());
    const before = calls(fetchMock, "/api/kb/sources").length;
    fireEvent.click(r.getByTestId("kb-source-trust"));
    expect(r.queryByTestId("kb-trust-add-untrusted")).toBeNull(); // existing row: trust only
    fireEvent.click(r.getByTestId("kb-trust-confirm"));
    await waitFor(() => expect(calls(fetchMock, "/api/kb/source-trust", "POST")).toHaveLength(1));
    expect(JSON.parse(String((calls(fetchMock, "/api/kb/source-trust", "POST")[0][1] as RequestInit).body))).toEqual({ ref: G });
    await waitFor(() => expect(calls(fetchMock, "/api/kb/sources").length).toBeGreaterThan(before));
    await waitFor(() => expect(r.getByTestId("kb-source-trusted")).toBeTruthy());
  });
});

// ── status + refresh points ─────────────────────────────────────
describe("per-source status", () => {
  it("F5 badges: outside folder, error tooltip, file counts", async () => {
    const specs: SourceConfig[] = [{ kind: "filesystem", ref: "/elsewhere/docs" }, { kind: "git", ref: G }];
    const sources: KbSourceStatus[] = [
      { ref: "/elsewhere/docs", kind: "filesystem", files: 12, trusted: null, outside: true },
      { ref: G, kind: "git", files: 3, trusted: true, outside: false, lastStatus: "error", lastError: "clone failed" },
    ];
    const r = mountPanel(panelFetch({ config: cfg(specs), sources: () => sources }));
    await waitFor(() => expect(r.getByTestId("kb-source-outside").textContent).toMatch(/outside folder/i));
    expect(r.getByTestId("kb-source-error").getAttribute("title")).toContain("clone failed");
    const counts = r.getAllByTestId("kb-source-files").map((e) => e.textContent);
    expect(counts.join(" ")).toContain("12");
    expect(counts.join(" ")).toContain("3");
  });

  it("F4 /api/kb/sources refetches at mount and after save — never on an idle timer", async () => {
    const fetchMock = panelFetch({ put: (body) => jsonOk(cfg(body.sources as SourceConfig[])) });
    const r = mountPanel(fetchMock);
    await ready(r);
    await waitFor(() => expect(calls(fetchMock, "/api/kb/sources")).toHaveLength(1));
    await new Promise((res) => setTimeout(res, 1500)); // idle: longer than any stats poll tick
    expect(calls(fetchMock, "/api/kb/sources")).toHaveLength(1);
    typeRef(r, "notes");
    fireEvent.click(r.getByTestId("kb-source-add"));
    fireEvent.click(r.getByTestId("kb-save"));
    await waitFor(() => expect(calls(fetchMock, "/api/kb/sources")).toHaveLength(2));
  });

  it("F4 /api/kb/sources refetches once when a running job settles", async () => {
    let n = 0;
    const seq = [statsBody(), statsBody({ indexing: true, jobStatus: "running" }), statsBody()];
    const fetchMock = panelFetch({ stats: () => jsonOk(seq[Math.min(n++, seq.length - 1)]) });
    const r = mountPanel(fetchMock);
    await ready(r);
    await waitFor(() => expect(calls(fetchMock, "/api/kb/sources")).toHaveLength(1));
    await waitFor(() => expect((r.getByTestId("kb-reindex-now") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(r.getByTestId("kb-reindex-now"));
    await waitFor(() => expect(calls(fetchMock, "/api/kb/sources").length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
  }, 15_000);
});

// ── test search ─────────────────────────────────────────────────
describe("KbTestSearch", () => {
  const hit = (over: Partial<KbSearchHit> = {}): KbSearchHit => ({
    root: "docs",
    path: "docs/a.md",
    headingPath: "A > B",
    chunkId: "c1",
    snippet: "see [bridge] here",
    score: 1.5,
    docType: "doc" as const,
    ...over,
  });
  const searchFetch = (res: () => Response) => {
    const m = vi.fn(async (_url: string) => res());
    (globalThis as { fetch?: unknown }).fetch = m;
    return m;
  };
  const run = (r: Q, q = "bridge") => {
    fireEvent.change(r.getByTestId("kb-search-input"), { target: { value: q } });
    fireEvent.click(r.getByTestId("kb-search-submit"));
  };

  it("F6 match markers render as <mark> text; hostile snippet markup stays inert text", async () => {
    searchFetch(() => jsonOk({ hits: [hit({ snippet: "<img src=x onerror=alert(1)> [bridge]" })], tookMs: 3 } satisfies KbSearchResponse));
    const r = render(<KbTestSearch cwd="/repo" dirty={false} />);
    run(r);
    await waitFor(() => expect(r.getByTestId("kb-search-snippet")).toBeTruthy());
    const snip = r.getByTestId("kb-search-snippet");
    expect(snip.querySelector("img")).toBeNull();
    expect(snip.textContent).toContain("<img");
    expect(snip.querySelector("mark")?.textContent).toBe("bridge");
  });

  it("F7 dirty notice / needsReindex / empty / error (query input keeps its value)", async () => {
    const dirty = render(<KbTestSearch cwd="/repo" dirty />);
    expect(dirty.getByTestId("kb-search-dirty")).toBeTruthy();
    cleanup();

    searchFetch(() => jsonOk({ hits: [], tookMs: 1, needsReindex: true }));
    let r = render(<KbTestSearch cwd="/repo" dirty={false} />);
    run(r);
    await waitFor(() => expect(r.getByTestId("kb-search-needs-reindex")).toBeTruthy());
    cleanup();

    searchFetch(() => jsonOk({ hits: [], tookMs: 1 }));
    r = render(<KbTestSearch cwd="/repo" dirty={false} />);
    run(r);
    await waitFor(() => expect(r.getByTestId("kb-search-empty")).toBeTruthy());
    cleanup();

    searchFetch(() => jsonFail({ error: "boom" }, 500));
    r = render(<KbTestSearch cwd="/repo" dirty={false} />);
    run(r, "keep me");
    await waitFor(() => expect(r.getByTestId("kb-search-error").textContent).toContain("boom"));
    expect((r.getByTestId("kb-search-input") as HTMLInputElement).value).toBe("keep me");
  });

  it("F8 request carries q, limit and docType — never verdicts; summary shows count and ms", async () => {
    const m = searchFetch(() => jsonOk({ hits: [hit(), hit({ chunkId: "c2", path: "docs/b.md" })], tookMs: 7 }));
    const r = render(<KbTestSearch cwd="/repo" dirty={false} />);
    fireEvent.change(r.getByTestId("kb-search-lane"), { target: { value: "agents" } });
    fireEvent.change(r.getByTestId("kb-search-limit"), { target: { value: "20" } });
    run(r);
    await waitFor(() => expect(r.getByTestId("kb-search-summary").textContent).toMatch(/2.*7/));
    const url = String((m.mock.calls as unknown as string[][])[0][0]);
    expect(url).toContain("q=bridge&limit=20&docType=agents");
    expect(url).not.toContain("verdicts");
  });

  it("F9 activating a hit copies its path and confirms transiently", async () => {
    searchFetch(() => jsonOk({ hits: [hit({ path: "docs/a.md" })], tookMs: 1 }));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const r = render(<KbTestSearch cwd="/repo" dirty={false} />);
    run(r);
    await waitFor(() => expect(r.getByTestId("kb-search-hit")).toBeTruthy());
    fireEvent.click(r.getByTestId("kb-search-hit"));
    expect(writeText).toHaveBeenCalledWith("docs/a.md");
    expect(r.getByTestId("kb-search-copied")).toBeTruthy();
  });
});
