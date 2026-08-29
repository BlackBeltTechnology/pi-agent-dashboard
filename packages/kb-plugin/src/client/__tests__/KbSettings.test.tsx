/**
 * useKbConfig round-trip + KbSettingsPanel sources editing / worktree bootstrap
 * affordances. See change: add-kb-folder-slot.
 *
 * Extended by fix-kb-settings-reindex-gate: the standalone `Reindex now` footer
 * action gated on `resolvedSources` (the list the server's reindex job actually
 * walks), the four-channel error region, and the two sources-notice variants.
 * Optimistic-state glue (F-series) follows the FolderKbSection.test.tsx
 * exemplar, applied to the panel.
 */

import { mdiDatabaseRefreshOutline, mdiRefresh } from "@mdi/js";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KbConfigResponse, KbStats, SourceConfig } from "../../shared/kb-plugin-types.js";
import { KbSettingsPanel, parentRepoOf } from "../KbSettingsPanel.js";
import { useKbConfig } from "../useKbConfig.js";
import { REINDEX_GUARD_MS } from "../useKbStats.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function configResponse(over: Partial<KbConfigResponse> = {}): KbConfigResponse {
  return {
    origin: "project",
    projectPath: "/repo/.pi/dashboard/knowledge_base.json",
    // Faithful server shape: GET /api/kb/config returns loadConfig(cwd) — a
    // ResolvedConfig carrying `resolvedSources` (filesystem-only, includes
    // legacy roots[]). The pre-fix mock omitted it, which read as empty and
    // let an inverted banner assertion pass (test-plan #E12).
    config: { sources: [{ kind: "filesystem", ref: "docs" }], include: ["**/*.md"], exclude: ["**/node_modules/**"], dbPath: ".pi/dashboard/kb/index.db", resolvedSources: [{ id: "docs", dir: "/repo/docs", priority: 0 }] } as KbConfigResponse["config"],
    ...over,
  };
}

/** Gate-test config with independent control of the form-seeding `sources[]`
 *  and the server-resolved list the reindex job walks. */
function cfgResponse(o: { origin?: KbConfigResponse["origin"]; sources?: number; resolved?: number } = {}): KbConfigResponse {
  return {
    origin: o.origin ?? "project",
    projectPath: "/repo/.pi/dashboard/knowledge_base.json",
    config: { sources: refs(o.sources ?? 1), resolvedSources: resolvedEntries(o.resolved ?? 1) } as KbConfigResponse["config"],
  };
}
function refs(n: number): SourceConfig[] {
  return Array.from({ length: n }, (_, i) => ({ kind: "filesystem" as const, ref: `src-${i}` }));
}
function resolvedEntries(n: number): Array<{ id: string; dir: string; priority: number }> {
  return Array.from({ length: n }, (_, i) => ({ id: `src-${i}`, dir: `/repo/src-${i}`, priority: 0 }));
}

function statsBody(over: Partial<KbStats> = {}): KbStats {
  return { files: 1, chunks: 5, indexed: true, staleCount: 0, indexing: false, jobStatus: "idle", ...over };
}

function jsonOk(body: unknown): Response {
  return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as unknown as Response;
}
function jsonFail(body: unknown, status = 403): Response {
  return { ok: false, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as unknown as Response;
}
function jsonFailHtml(status = 500): Response {
  return { ok: false, status, headers: new Headers({ "content-type": "text/html" }), json: async () => ({}) } as unknown as Response;
}

/** Stats fetcher returning a fixed sequence; the last entry repeats forever.
 *  `"fail"` entries are HTTP 500 HTML (the proxy/SPA guard in kb-api). */
function seqStats(entries: Array<KbStats | "fail">): () => Response {
  let i = 0;
  return () => {
    const e = entries[Math.min(i++, entries.length - 1)];
    return e === "fail" ? jsonFailHtml() : jsonOk(e);
  };
}

/** Panel fetch mock: routes by endpoint, config/stats/post/put injectable. */
function fetchFor(
  config: KbConfigResponse,
  o: { stats?: () => Response; post?: () => Response; put?: () => Response | Promise<Response> } = {},
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/kb/stats")) return (o.stats ?? (() => jsonOk(statsBody())))();
    if (u.includes("/api/kb/reindex")) return (o.post ?? (() => jsonOk({ status: "running", jobId: "kb-1" })))();
    if (u.includes("/api/kb/config") && init?.method === "PUT") return (o.put ?? (() => jsonOk(config)))();
    return jsonOk(config);
  });
}

const btn = (get: (id: string) => HTMLElement): HTMLButtonElement => get("kb-reindex-now") as HTMLButtonElement;
const statsCalls = (m: ReturnType<typeof vi.fn>): number =>
  m.mock.calls.filter((c) => String(c[0]).includes("/api/kb/stats")).length;

describe("parentRepoOf", () => {
  it("derives the parent for a .worktrees checkout", () => {
    expect(parentRepoOf("/repo/.worktrees/feature-x")).toBe("/repo");
    expect(parentRepoOf("/repo/worktrees/feature-x")).toBe("/repo");
  });
  it("returns null when not under a worktree path", () => {
    expect(parentRepoOf("/repo/src")).toBeNull();
  });
});

describe("useKbConfig", () => {
  function Probe({ cwd }: { cwd: string }): React.ReactElement {
    const { data, save } = useKbConfig(cwd);
    return (
      <div>
        <span data-testid="origin">{data?.origin ?? ""}</span>
        <button data-testid="do-save" onClick={() => void save({ sources: [{ kind: "filesystem", ref: "openspec" }], reindex: false })} />
      </div>
    );
  }

  it("GETs then round-trips a save (PUT)", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? jsonOk(configResponse({ config: { sources: [{ kind: "filesystem", ref: "openspec" }] } as KbConfigResponse["config"] })) : jsonOk(configResponse()),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(<Probe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("origin").textContent).toBe("project"));
    fireEvent.click(getByTestId("do-save"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PUT")).toBe(true),
    );
  });
});

describe("KbSettingsPanel (existing behaviour preserved)", () => {
  it("lists sources and adds a new one, then Save + Reindex PUTs with reindex", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/kb/config") && init?.method === "PUT") return jsonOk(configResponse());
      if (String(url).includes("/api/kb/config")) return jsonOk(configResponse());
      return jsonOk(statsBody());
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId, getAllByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getAllByTestId("kb-source-row").length).toBe(1));

    fireEvent.change(getByTestId("kb-source-input"), { target: { value: "openspec" } });
    fireEvent.click(getByTestId("kb-source-add"));
    await waitFor(() => expect(getAllByTestId("kb-source-row").length).toBe(2));

    fireEvent.click(getByTestId("kb-save-reindex"));
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/kb/config") && (c[1] as RequestInit)?.method === "PUT");
      expect(putCall).toBeTruthy();
      const body = JSON.parse((putCall![1] as RequestInit).body as string);
      expect(body.reindex).toBe(true);
      expect(body.sources.map((s: { ref: string }) => s.ref)).toContain("openspec");
    });
  });

  // test-plan #E12 (fix-kb-settings-reindex-gate): REPLACES the inverted
  // assertion. The mock is now faithful — `origin:"global"` with non-empty
  // resolvedSources — so the "indexes nothing" bootstrap banner must be ABSENT.
  it("worktree (no project file): shows Create/Copy affordances, no false bootstrap banner", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/api/kb/config")
        ? jsonOk(configResponse({ origin: "global" }))
        : jsonOk(statsBody()),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId, queryByTestId } = render(<KbSettingsPanel cwd="/repo/.worktrees/x" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-copy-parent")).toBeTruthy());
    expect(getByTestId("kb-create-config")).toBeTruthy();
    expect(queryByTestId("kb-bootstrap-note")).toBeNull();
  });
});

describe("Reindex now — resolvedSources gate (test-plan #E1–#E11)", () => {
  it("#E1: enabled in the nominal case (project origin, 1 resolved source, pristine, no job)", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse());
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    expect(btn(getByTestId).disabled).toBe(false);
  });

  it("#E2: activating rebuilds without saving — POST /reindex exactly once, no PUT", async () => {
    const fetchMock = fetchFor(cfgResponse());
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-reindex-now"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/kb/reindex")).length).toBe(1),
    );
    expect(fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === "PUT")).toHaveLength(0);
  });

  it("#E3: zero resolved sources — present and disabled", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse({ sources: 0, resolved: 0 }));
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    expect(btn(getByTestId).disabled).toBe(true);
  });

  it("#E4: one resolved source — enabled, flipping exactly at the 0↔1 boundary", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse({ resolved: 1 }));
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    expect(btn(getByTestId).disabled).toBe(false);
  });

  it("#E5: global origin is not stranded — enabled alongside the bootstrap affordances", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse({ origin: "global" }));
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo/.worktrees/x" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    expect(btn(getByTestId).disabled).toBe(false);
    expect(getByTestId("kb-copy-parent")).toBeTruthy();
    expect(getByTestId("kb-create-config")).toBeTruthy();
  });

  it("#E6: defaults origin shows a disabled control", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse({ origin: "defaults", sources: 0, resolved: 0 }));
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    expect(btn(getByTestId).disabled).toBe(true);
  });

  it("#E7: clean form splits the two actions — Save+Reindex disabled, Reindex now enabled", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse());
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    expect((getByTestId("kb-save-reindex") as HTMLButtonElement).disabled).toBe(true);
    expect(btn(getByTestId).disabled).toBe(false);
  });

  it("#E8: dirty form offers both actions", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse());
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    fireEvent.change(getByTestId("kb-source-input"), { target: { value: "openspec" } });
    fireEvent.click(getByTestId("kb-source-add"));
    await waitFor(() => expect((getByTestId("kb-save-reindex") as HTMLButtonElement).disabled).toBe(false));
    expect(btn(getByTestId).disabled).toBe(false);
  });

  it("#E9: false-enable guard — typed-but-unsaved source does not enable the action", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse({ sources: 0, resolved: 0 }));
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    fireEvent.change(getByTestId("kb-source-input"), { target: { value: "openspec" } });
    fireEvent.click(getByTestId("kb-source-add"));
    await waitFor(() => expect((getByTestId("kb-source-row") as HTMLElement)).toBeTruthy());
    expect(btn(getByTestId).disabled).toBe(true);
  });

  it("#E10: false-disable guard — legacy roots[] (empty form list, resolved non-empty) stays enabled", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse({ sources: 0, resolved: 1 }));
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    expect(btn(getByTestId).disabled).toBe(false);
  });

  it("#E11: save-in-flight carve-out — disabled while a PUT is in flight", async () => {
    let resolvePut!: (r: Response) => void;
    const hangPut = new Promise<Response>((res) => { resolvePut = res; });
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse(), { put: () => hangPut });
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    fireEvent.change(getByTestId("kb-source-input"), { target: { value: "openspec" } });
    fireEvent.click(getByTestId("kb-source-add"));
    await waitFor(() => expect((getByTestId("kb-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-save"));
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(true));
    // Settle the hung PUT so no state update leaks past the test.
    resolvePut(jsonOk(cfgResponse()));
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
  });
});

describe("Bootstrap banner + sources notice variants (test-plan #E12–#E15)", () => {
  it("#E13: bootstrap banner kept when nothing resolves (defaults origin)", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse({ origin: "defaults", sources: 0, resolved: 0 }));
    const { getByTestId, queryByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    expect(queryByTestId("kb-bootstrap-note")).toBeTruthy();
  });

  it("#E14: notice drops the false prediction when the form list is empty but sources resolve", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse({ sources: 0, resolved: 1 }));
    const { getByTestId, getByText } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    const notice = getByText("(no sources defined)");
    expect(notice.textContent).not.toContain("nothing will be indexed");
  });

  it("#E15: notice keeps the true warning when nothing resolves at all", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse({ sources: 0, resolved: 0 }));
    const { getByTestId, getByText } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    expect(getByText(/nothing will be indexed/)).toBeTruthy();
  });
});

describe("Rebuild refusal reason (test-plan #E16)", () => {
  it("#E16: the reason is visible rendered text, not a title tooltip", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse({ sources: 0, resolved: 0 }));
    const { getByTestId, getByText } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    // getByText matches TEXT NODES — an assertion satisfiable by a `title`
    // attribute alone would not pass here.
    const reason = getByText(/define at least one source/i);
    expect(reason).toBeTruthy();
    expect((reason as HTMLElement).getAttribute("title")).toBeNull();
  });
});

describe("Existing save path (test-plan #E17)", () => {
  it("#E17: Save + Reindex PUTs reindex:true then refetchStats() after the 300ms hand-off", async () => {
    const config = cfgResponse();
    const fetchMock = fetchFor(config);
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    const before = statsCalls(fetchMock);
    fireEvent.change(getByTestId("kb-source-input"), { target: { value: "openspec" } });
    fireEvent.click(getByTestId("kb-source-add"));
    fireEvent.click(getByTestId("kb-save-reindex"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => {
        const init = c[1] as RequestInit | undefined;
        return String(c[0]).includes("/api/kb/config") && init?.method === "PUT" && (JSON.parse(String(init.body)) as { reindex?: boolean }).reindex === true;
      })).toBe(true),
    );
    await waitFor(() => expect(statsCalls(fetchMock)).toBeGreaterThan(before), { timeout: 2000 });
  });
});

describe("Footer glyph audit (test-plan #E18)", () => {
  it("#E18: save-reindex uses mdiRefresh, reindex-now uses mdiDatabaseRefreshOutline — never one glyph for both", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse());
    const { getByTestId, container } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-reindex-now")).toBeTruthy());
    const glyph = (tid: string): string | undefined =>
      container.querySelector(`[data-testid="${tid}"] svg path`)?.getAttribute("d") ?? undefined;
    expect(glyph("kb-save-reindex")).toBe(mdiRefresh);
    expect(glyph("kb-reindex-now")).toBe(mdiDatabaseRefreshOutline);
    expect(glyph("kb-save-reindex")).not.toBe(glyph("kb-reindex-now"));
  });
});

describe("KbConfigResponse type contract (test-plan #E19)", () => {
  // The compile-time half is enforced by `tsc --noEmit` (npm run lint), which
  // covers packages/*/src including this file. Runtime assertions below only
  // pin the value-level behaviour.
  it("#E19: response type is the narrow shape — resolvedSources carries no `identity`", () => {
    const res = {} as KbConfigResponse;
    const len: number | undefined = res.config?.resolvedSources?.length;
    expect(len).toBeUndefined();
    // @ts-expect-error — resolvedSources composes the NARROW config.ts
    // ResolvedSource (id/dir/priority). If the client ever reverts to the wide
    // sources.ts shape (identity/revision) this directive goes unused and
    // `tsc --noEmit` fails, which is the fail-closed negative arm.
    expect(res.config?.resolvedSources?.[0]?.identity).toBeUndefined();
  });
});

describe("Reindex now — optimistic state machine (test-plan #F1–#F6, #X1–#X6)", () => {
  it("#F1: optimistic disable on click — synchronously, before any server response", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse());
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-reindex-now"));
    // Same commit as the activation: the optimistic `pending` flag is set
    // synchronously inside reindex() before the POST resolves.
    expect(btn(getByTestId).disabled).toBe(true);
  });

  it("#F2: no double POST inside the pending window", async () => {
    const fetchMock = fetchFor(cfgResponse());
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-reindex-now"));
    fireEvent.click(getByTestId("kb-reindex-now")); // inside the pending window → button already disabled
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/kb/reindex")).length).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/kb/reindex")).length).toBe(1);
  });

  it("#F3: pending→indexing hand-off has no gap — the action never renders enabled mid-flight", async () => {
    const fetchMock = fetchFor(cfgResponse(), {
      stats: seqStats([statsBody(), statsBody({ indexing: true, jobStatus: "running" }), statsBody({ indexing: true, jobStatus: "running" }), statsBody({ chunks: 512 })]),
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    const el = btn(getByTestId);
    // Every `disabled` attribute FLIP must be to true until the job settles.
    const flips: boolean[] = [];
    const mo = new MutationObserver(() => flips.push(el.disabled));
    mo.observe(el, { attributes: true, attributeFilter: ["disabled"] });
    fireEvent.click(el);
    await waitFor(() => expect(el.disabled).toBe(true));
    // Handoff observed: the poll has seen indexing:true (mount + refetch + ≥1 poll tick).
    await waitFor(() => expect(statsCalls(fetchMock)).toBeGreaterThanOrEqual(3), { timeout: 5000 });
    expect(el.disabled).toBe(true);
    await waitFor(() => expect(el.disabled).toBe(false), { timeout: 5000 });
    mo.disconnect();
    const falseIdx = flips.indexOf(false);
    expect(falseIdx === -1 || falseIdx === flips.length - 1).toBe(true);
  });

  it("#F4: settles to enabled once a poll observes indexing:false", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse(), {
      stats: seqStats([statsBody(), statsBody({ indexing: true, jobStatus: "running" }), statsBody({ chunks: 9, indexed: true })]),
    });
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-reindex-now"));
    expect(btn(getByTestId).disabled).toBe(true);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false), { timeout: 5000 });
  });

  it("#F5: fast job does not wedge — REINDEX_GUARD_MS elapses, the action converges to enabled", async () => {
    // 202 ack but /stats never reports indexing (job settled before the first poll).
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse(), {
      stats: () => jsonOk(statsBody({ chunks: 9, indexed: true })),
    });
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-reindex-now"));
    expect(btn(getByTestId).disabled).toBe(true);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false), { timeout: REINDEX_GUARD_MS + 3000 });
  }, REINDEX_GUARD_MS + 6000);

  it("#F6: state does not leak across folders — cwd B renders enabled with no error from cwd A", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse());
    const { getByTestId, queryByTestId, rerender } = render(<KbSettingsPanel cwd="/repo/a" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-reindex-now"));
    expect(btn(getByTestId).disabled).toBe(true); // pending on A
    rerender(<KbSettingsPanel cwd="/repo/b" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    expect(queryByTestId("kb-settings-error")).toBeNull();
  });

  it("#X1: trigger rejection is surfaced in kb-settings-error", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse(), { post: () => jsonFail({ error: "cwd not allowed" }) });
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-reindex-now"));
    await waitFor(() => expect(getByTestId("kb-settings-error").textContent).toContain("cwd not allowed"));
  });

  it("#X2: retry is possible after rejection — the action returns to enabled", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse(), { post: () => jsonFail({ error: "cwd not allowed" }) });
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-reindex-now"));
    await waitFor(() => expect(getByTestId("kb-settings-error").textContent).toContain("cwd not allowed"));
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
  });

  it("#X3: one poll blip is tolerated — no error rendered, busy persists", async () => {
    const fetchMock = fetchFor(cfgResponse(), {
      stats: seqStats([statsBody({ indexing: true, jobStatus: "running" }), "fail", statsBody({ indexing: true, jobStatus: "running" })]),
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId, queryByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(true)); // busy from stats.indexing
    // The blip is one missed poll; polling continues and the error must never surface.
    await waitFor(() => expect(statsCalls(fetchMock)).toBeGreaterThanOrEqual(3), { timeout: 6000 });
    expect(queryByTestId("kb-settings-error")).toBeNull();
    expect(btn(getByTestId).disabled).toBe(true);
  }, 9000);

  it("#X4: sustained outage is surfaced rather than an unexplained idle action", async () => {
    // POST accepted (job registered) but every /stats poll fails → MAX_POLL_MISSES.
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse(), { stats: () => jsonFailHtml() });
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-reindex-now"));
    await waitFor(() => expect(getByTestId("kb-settings-error").textContent).toMatch(/HTTP 500/), { timeout: 8000 });
  }, 10000);

  it("#X5: trigger error outranks the poll outage", async () => {
    const fetchMock = fetchFor(cfgResponse(), { stats: () => jsonFailHtml(), post: () => jsonFail({ error: "cwd not allowed" }) });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-reindex-now"));
    await waitFor(() => expect(getByTestId("kb-settings-error").textContent).toContain("cwd not allowed"));
    // Let the sustained outage surface too (3 consecutive misses), then re-check:
    // the user-initiated trigger error must still win.
    await waitFor(() => expect(statsCalls(fetchMock)).toBeGreaterThanOrEqual(3), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 150));
    expect(getByTestId("kb-settings-error").textContent).toContain("cwd not allowed");
  }, 10000);

  it("#X6: bootstrap error outranks the trigger error", async () => {
    // cwd is NOT a worktree → Copy from parent fails immediately ("Parent repo
    // not detected"); the reindex trigger is rejected too.
    (globalThis as { fetch?: unknown }).fetch = fetchFor(cfgResponse({ origin: "global" }), { post: () => jsonFail({ error: "cwd not allowed" }) });
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(btn(getByTestId).disabled).toBe(false));
    fireEvent.click(getByTestId("kb-reindex-now"));
    await waitFor(() => expect(getByTestId("kb-settings-error").textContent).toContain("cwd not allowed"));
    fireEvent.click(getByTestId("kb-copy-parent"));
    await waitFor(() => expect(getByTestId("kb-settings-error").textContent).toContain("Parent repo not detected"));
  });
});
