/**
 * FolderKbSection — five-state render + reindex/navigation (tasks 3.1–3.3).
 *
 * The pill is STATE-ONLY: the three former controls (`retry` / `index now` /
 * `reindex`) are ONE declarative folder-actions-menu item whose label, badge and
 * disabled state vary by KB state, so the state assertions below read the
 * contribution registry rather than pill buttons.
 * See change: add-kb-folder-slot; move-slot-actions-to-menu
 * (test-plan #E10, #E11, #E19, #F4).
 */

import {
  CurrentPluginLayer,
  createFolderMenuStore,
  FolderMenuProvider,
  type FolderMenuStore,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiPinOutline } from "@mdi/js";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { KbStats } from "../../shared/kb-plugin-types.js";
import { deriveKbRowState, FolderKbSection } from "../FolderKbSection.js";
import { kbSettingsUrl } from "../kb-api.js";
import { getKbStatsStore, type KbStatsSnapshot } from "../kb-stats-store.js";
import { PIN_GUARD_MS, resetKbStatsStores } from "../useKbStats.js";

const cwd = "/repo/alpha";

function stats(over: Partial<KbStats> = {}): KbStats {
  return { files: 10, chunks: 100, indexed: true, staleCount: 0, indexing: false, jobStatus: "idle", ...over };
}

function jsonResp(body: unknown, ok = true, status = 200): Response {
  return { ok, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as unknown as Response;
}
function mockStats(s: KbStats) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    // Reindex is non-blocking: POST returns 202 { status:"running" }.
    if (init?.method === "POST") return jsonResp({ status: "running", jobId: "kb-1" });
    return jsonResp(s);
  });
}

// The per-cwd stats store is a module singleton — reset it so no snapshot,
// poll or armed guard leaks between tests. See change: fix-kb-card-refresh-and-shared-stats.
beforeEach(() => { resetKbStatsStores(); });
afterEach(() => { cleanup(); resetKbStatsStores(); vi.restoreAllMocks(); });

// Stub shell context: `usePluginSend` throws outside a PluginContextProvider, so
// every render site wraps the section in one supplying `send`, a stub `ws`
// (EventTarget) and the connection status. See change: kb-denied-folder-pin-state.
let send: ReturnType<typeof vi.fn<(message: unknown) => void>>;
let ws: EventTarget;
let connection: "connected" | "disconnected";
beforeEach(() => {
  send = vi.fn<(message: unknown) => void>();
  ws = new EventTarget();
  connection = "connected";
});
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PluginContextProvider send={send} ws={ws as unknown as WebSocket} connectionStatus={connection}>
      {children}
    </PluginContextProvider>
  );
}

function renderSlot(hook?: unknown, store: FolderMenuStore = createFolderMenuStore()) {
  const utils = render(
    <Shell>
      <Router hook={hook as never}>
        <FolderMenuProvider store={store}>
          <CurrentPluginLayer pluginId="kb-plugin">
            <FolderKbSection folder={{ cwd }} />
          </CurrentPluginLayer>
        </FolderMenuProvider>
      </Router>
    </Shell>,
  );
  return { ...utils, store };
}

function renderSlotPlacement(placement?: "sidebar" | "card", store: FolderMenuStore = createFolderMenuStore()) {
  const utils = render(
    <Shell>
      <Router>
        <FolderMenuProvider store={store}>
          <CurrentPluginLayer pluginId="kb-plugin">
            <FolderKbSection folder={{ cwd }} placement={placement} />
          </CurrentPluginLayer>
        </FolderMenuProvider>
      </Router>
    </Shell>,
  );
  return { ...utils, store };
}

/** The folder's single KB menu item, or `undefined` when it has not registered. */
function kbItem(store: FolderMenuStore) {
  const items = store.getItems(cwd).filter((i) => i.id === "kb-reindex");
  expect(items.length).toBeLessThanOrEqual(1);
  return items[0];
}

describe("deriveKbRowState (ordered)", () => {
  it("error wins over not-indexed even when chunks:0", () => {
    expect(deriveKbRowState(stats({ chunks: 0, indexed: false, jobStatus: "error" }))).toBe("error");
  });
  it("indexing outranks the count states", () => {
    expect(deriveKbRowState(stats({ indexing: true }))).toBe("indexing");
  });
  it("not-indexed for a fresh folder", () => {
    expect(deriveKbRowState(stats({ chunks: 0, indexed: false }))).toBe("not-indexed");
  });
  it("stale when drift present", () => {
    expect(deriveKbRowState(stats({ staleCount: 3 }))).toBe("stale");
  });
  it("populated otherwise", () => {
    expect(deriveKbRowState(stats())).toBe("populated");
  });
});

describe("FolderKbSection render", () => {
  it("populated: shows the chunk count and contributes ONE enabled Reindex item", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 1247 }));
    const { getByTestId, store } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-count").textContent).toContain("1,247"));
    await waitFor(() => expect(kbItem(store)?.label).toContain("Reindex"));
    const item = kbItem(store)!;
    expect(item.group).toBe("maintenance");
    expect(item.disabled).toBe(false);
    expect(item.badge).toBeUndefined();
  });

  it("the pill ROOT exposes no action control of its own (test-plan #E1, #E2)", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 1247 }));
    const { getByTestId, queryByTestId } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-count").textContent).toContain("1,247"));
    for (const id of ["folder-kb-reindex", "folder-kb-index-now", "folder-kb-retry"]) {
      expect(queryByTestId(id)).toBeNull();
    }
    const section = getByTestId("folder-kb-section");
    const pill = getByTestId("folder-kb-open-settings");
    // The state-only rule binds the PILL ROOT: nothing interactive may nest
    // inside it. The card placement's sanctioned sibling control lives outside
    // it (asserted separately); the sidebar placement rendered here has none.
    expect(pill.querySelectorAll("button, a, [role='button'], [tabindex]:not([tabindex='-1'])")).toHaveLength(0);
    expect(
      Array.from(section.querySelectorAll("button, a, [role='button'], [tabindex]:not([tabindex='-1'])")),
    ).toEqual([pill]);
  });

  it("F4: the worktree-card placement registers nothing — its scope has no menu", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats());
    const { getByTestId, store } = renderSlotPlacement("card");
    await waitFor(() => expect(getByTestId("folder-kb-open-settings")).toBeTruthy());
    expect(store.getItems(cwd)).toHaveLength(0);
  });

  it("not-indexed: the ONE item reads Index now AND settings stay reachable", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 0, indexed: false }));
    const { getByTestId, store } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("not-indexed"));
    await waitFor(() => expect(kbItem(store)?.label).toContain("Index now"));
    // Settings MUST be reachable so a fresh worktree can define sources.
    expect(getByTestId("folder-kb-open-settings")).toBeTruthy();
  });

  it("E10: error state folds to a single Retry item — no extra index-now or reindex item", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 0, indexed: false, jobStatus: "error", lastError: "boom" }));
    const { getByTestId, store } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("error"));
    // The registration is a passive effect, so it lands a tick after the commit
    // the DOM assertion above observes.
    await waitFor(() => expect(kbItem(store)?.label).toContain("Retry"));
    expect(store.getItems(cwd)).toHaveLength(1);
    expect(getByTestId("folder-kb-open-settings")).toBeTruthy();
  });

  it("E11: stale shows the inline pill marker AND puts the stale badge on the menu item", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 88, staleCount: 3 }));
    const { findByTestId, store } = renderSlot();
    const flag = await findByTestId("folder-kb-stale");
    expect(flag.textContent).toContain("3 stale");
    await waitFor(() => expect(kbItem(store)?.badge).toContain("3 stale"));
    // Distinct from the folder's plain refresh: it is the KB's own reindex item.
    expect(kbItem(store)!.id).toBe("kb-reindex");
  });

  it("indexing: shows the spinner state", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ indexing: true }));
    const { findByTestId } = renderSlot();
    const row = await findByTestId("folder-kb-section");
    await waitFor(() => expect(row.getAttribute("data-state")).toBe("indexing"));
  });

  it("activating the menu item POSTs to /api/kb/reindex", async () => {
    const fetchMock = mockStats(stats());
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { store } = renderSlot();
    await waitFor(() => expect(kbItem(store)).toBeTruthy());
    act(() => kbItem(store)!.onSelect());
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/kb/reindex") && (c[1] as RequestInit)?.method === "POST")).toBe(true),
    );
  });

  it("Index now → spinner while indexing, then the populated count (task 2.1)", async () => {
    // 202 on POST; GET returns not-indexed → indexing → settled, so the poll
    // observes indexing:true (unreachable under the old blocking route).
    const seq: KbStats[] = [
      stats({ chunks: 0, indexed: false }),
      stats({ chunks: 0, indexed: false, indexing: true, jobStatus: "running" }),
      stats({ chunks: 0, indexed: false, indexing: true, jobStatus: "running" }),
      stats({ chunks: 512, indexed: true }),
    ];
    let gi = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResp({ status: "running", jobId: "kb-1" });
      return jsonResp(seq[Math.min(gi++, seq.length - 1)]);
    });
    const { getByTestId, store } = renderSlot();
    await waitFor(() => expect(kbItem(store)?.label).toContain("Index now"));
    act(() => kbItem(store)!.onSelect());
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("indexing"), { timeout: 3000 });
    await waitFor(() => expect(getByTestId("folder-kb-count").textContent).toContain("512"), { timeout: 5000 });
  });

  it("rejected trigger (500) → failed + Retry, and Retry re-fires (task 2.2)", async () => {
    // A cwd-refusal 403 now drives `denied` (kb-denied-folder-pin-state E8); an
    // ordinary rejection keeps the failed + Retry path.
    let posts = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++;
        return jsonResp({ error: "boom" }, false, 500);
      }
      return jsonResp(stats({ chunks: 0, indexed: false }));
    });
    const { store } = renderSlot();
    await waitFor(() => expect(kbItem(store)?.label).toContain("Index now"));
    act(() => kbItem(store)!.onSelect());
    // Trigger reject surfaces the failed state (was silently swallowed before).
    await waitFor(() => expect(kbItem(store)?.label).toContain("Retry"));
    expect(store.getItems(cwd)).toHaveLength(1);
    act(() => kbItem(store)!.onSelect());
    await waitFor(() => expect(posts).toBeGreaterThanOrEqual(2));
  });

  it("Index now → the indexing branch renders synchronously on activation (task 2.1)", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 0, indexed: false }));
    const { getByTestId, store } = renderSlot();
    await waitFor(() => expect(kbItem(store)?.label).toContain("Index now"));
    act(() => kbItem(store)!.onSelect());
    // Optimistic: the indexing state renders in the SAME commit as the activation.
    expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("indexing");
    expect(getByTestId("folder-kb-count").textContent).toContain("indexing");
  });

  it("E19: the disabled window covers the optimistic `pending` span, not only polled indexing (task 2.2)", async () => {
    const fetchMock = mockStats(stats({ chunks: 0, indexed: false }));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { store } = renderSlot();
    await waitFor(() => expect(kbItem(store)?.label).toContain("Index now"));
    expect(kbItem(store)!.disabled).toBe(false);
    act(() => kbItem(store)!.onSelect());
    const posts = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST").length;
    expect(posts()).toBe(1);
    // `pending` is true while `stats.indexing` is still false — the item must
    // already be disabled, or the double-submit guard has a hole.
    await waitFor(() => expect(kbItem(store)?.disabled).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(posts()).toBe(1);
  });

  it("no-flicker handoff: spinner is continuous through 202 → indexing:true → populated (task 2.3)", async () => {
    const seq: KbStats[] = [
      stats({ chunks: 0, indexed: false }),
      stats({ chunks: 0, indexed: false, indexing: true, jobStatus: "running" }),
      stats({ chunks: 777, indexed: true }),
    ];
    let gi = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? jsonResp({ status: "running", jobId: "kb-1" }, true, 202) : jsonResp(seq[Math.min(gi++, seq.length - 1)]),
    );
    const { getByTestId, store } = renderSlot();
    await waitFor(() => expect(kbItem(store)?.label).toContain("Index now"));
    const seen = new Set<string>();
    const rec = () => {
      const s = getByTestId("folder-kb-section").getAttribute("data-state");
      if (s) seen.add(s);
    };
    act(() => kbItem(store)!.onSelect());
    rec();
    // Continuous: state stays "indexing" across the handoff and lands on the chunk count.
    await waitFor(() => {
      rec();
      expect(getByTestId("folder-kb-count").textContent).toContain("777");
    }, { timeout: 5000 });
    // The row NEVER reverts to "not-indexed" (Index now) between click and settle.
    expect(seen.has("not-indexed")).toBe(false);
    expect(seen.has("indexing")).toBe(true);
  });

  it("placement=card forwards the flat surface to SlotPill", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats());
    const { getByTestId } = renderSlotPlacement("card");
    await waitFor(() => expect(getByTestId("folder-kb-open-settings")).toBeTruthy());
    const pill = getByTestId("folder-kb-open-settings");
    expect(pill.className).not.toContain("bg-[");
    expect(pill.className).not.toMatch(/shadow-/);
  });

  it("default placement (sidebar) forwards the raised surface", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats());
    const { getByTestId } = renderSlotPlacement();
    await waitFor(() => expect(getByTestId("folder-kb-open-settings")).toBeTruthy());
    const pill = getByTestId("folder-kb-open-settings");
    expect(pill.className).toContain("bg-[var(--bg-secondary)]");
    expect(pill.className).toContain("shadow-[0_1px_2px_var(--shadow-card)]");
  });

  // ── Card-placement sibling reindex control ──────────────────────
  // The card scope has no folder actions menu, so the section renders ONE
  // compact control as a SIBLING of the pill. See change:
  // fix-kb-card-refresh-and-shared-stats (test-plan #E1, #E2, #F3).

  const cardControl = (get: (id: string) => HTMLElement) => get("folder-kb-card-reindex") as HTMLButtonElement;

  it("E1: the sibling control's accessible name follows the KB state", async () => {
    const cases: Array<[Partial<KbStats>, string, boolean]> = [
      [{ chunks: 0, indexed: false, jobStatus: "error", lastError: "boom" }, "Retry", false],
      [{ indexing: true, jobStatus: "running" }, "indexing", true],
      [{ chunks: 0, indexed: false }, "Index now", false],
      [{ chunks: 88, staleCount: 3 }, "Reindex now", false],
      [{ chunks: 88 }, "Reindex now", false],
    ];
    for (const [over, label, disabled] of cases) {
      (globalThis as { fetch?: unknown }).fetch = mockStats(stats(over));
      const { getByTestId, unmount } = renderSlotPlacement("card");
      await waitFor(() => expect(getByTestId("folder-kb-card-reindex").getAttribute("aria-label")).toContain(label));
      const control = cardControl(getByTestId);
      expect(control.disabled).toBe(disabled);
      // Perceivable while disabled: a disabled button swallows the mouse events
      // its own `title` needs, so the wrapper carries the label too.
      expect(control.parentElement?.getAttribute("title")).toContain(label);
      unmount();
      cleanup();
      resetKbStatsStores();
    }
  });

  it("E2: card renders exactly one control OUTSIDE the pill root; sidebar renders none", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 12 }));
    const card = renderSlotPlacement("card");
    await waitFor(() => expect(card.getByTestId("folder-kb-card-reindex")).toBeTruthy());
    const section = card.getByTestId("folder-kb-section");
    const pill = card.getByTestId("folder-kb-open-settings");
    const control = card.getByTestId("folder-kb-card-reindex");
    expect(section.querySelectorAll("[data-testid='folder-kb-card-reindex']")).toHaveLength(1);
    // Sibling: outside the pill root, and its wrapper is a direct child of the section.
    expect(pill.contains(control)).toBe(false);
    expect(control.parentElement?.parentElement).toBe(section);
    expect(pill.querySelectorAll("button, a, [role='button'], [tabindex]:not([tabindex='-1'])")).toHaveLength(0);
    card.unmount();
    cleanup();
    resetKbStatsStores();

    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 12 }));
    const sidebar = renderSlotPlacement();
    await waitFor(() => expect(sidebar.getByTestId("folder-kb-open-settings")).toBeTruthy());
    expect(sidebar.queryByTestId("folder-kb-card-reindex")).toBeNull();
  });

  it("F3: activating the sibling control reindexes and never opens settings", async () => {
    const fetchMock = mockStats(stats({ chunks: 12 }));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { hook, history } = memoryLocation({ path: "/", record: true });
    const { getByTestId } = render(
      <Shell>
        <Router hook={hook as never}>
          <FolderMenuProvider store={createFolderMenuStore()}>
            <CurrentPluginLayer pluginId="kb-plugin">
              <FolderKbSection folder={{ cwd }} placement="card" />
            </CurrentPluginLayer>
          </FolderMenuProvider>
        </Router>
      </Shell>,
    );
    await waitFor(() => expect(getByTestId("folder-kb-card-reindex")).toBeTruthy());
    const before = history.length;
    const control = getByTestId("folder-kb-card-reindex");
    const posts = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST").length;

    // Keyboard first: the pill root's Enter/Space `onKeyDown` must never see
    // these (the control is a sibling, so nothing bubbles into it). jsdom does
    // not synthesize the native button click from keyDown, so the activation
    // itself is asserted through the click a real Enter/Space would produce.
    fireEvent.keyDown(control, { key: "Enter" });
    fireEvent.keyDown(control, { key: " " });
    expect(history.length).toBe(before);
    fireEvent.click(control);
    await waitFor(() => expect(posts()).toBe(1));
    expect(history.length).toBe(before);
    expect(history[history.length - 1]).not.toBe(kbSettingsUrl(cwd));
  });

  it("count opens the KB settings overlay on click", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats());
    const { hook, history } = memoryLocation({ path: "/", record: true });
    const { getByTestId } = renderSlot(hook);
    await waitFor(() => expect(getByTestId("folder-kb-open-settings")).toBeTruthy());
    fireEvent.click(getByTestId("folder-kb-open-settings"));
    expect(history[history.length - 1]).toBe(kbSettingsUrl(cwd));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Denied / pinning / missing / no-sources. See change: kb-denied-folder-pin-state
// (design D3–D6, D11; test-plan #E7–#E12, #E25–#E30, #F5–#F7, #X1, #X2).
// ─────────────────────────────────────────────────────────────────────────────
const DENIED = { error: "cwd not allowed", reason: "server reason", hint: "h" };
const statsGets = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method !== "POST" && String(c[0]).includes("/api/kb/stats")).length;
const postCount = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST").length;
/** GET answers from `gets` (last repeats); POST → 202. */
function mockSeq(gets: Array<() => Response>) {
  let i = 0;
  const m = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST" ? jsonResp({ status: "running", jobId: "kb-1" }, true, 202) : gets[Math.min(i++, gets.length - 1)](),
  );
  (globalThis as { fetch?: unknown }).fetch = m;
  return m;
}
const denied403 = () => jsonResp(DENIED, false, 403);
const ok = (over: Partial<KbStats>) => () => jsonResp(stats(over));
const pinMsg = (paths: string[]) => new MessageEvent("message", { data: JSON.stringify({ type: "pinned_dirs_updated", paths }) });
const SNAP: KbStatsSnapshot = { stats: null, loading: false, error: null, reindexError: null, pending: false, denied: false, deniedReason: null, pinPending: false };

describe("FolderKbSection — denied, pinning, missing, no-sources", () => {
  it("E7/E30: precedence — denied outranks everything; pinning is its sub-state; missing outranks a client error", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(() => new Promise<Response>(() => {}));
    const cases: Array<[Partial<KbStatsSnapshot>, string]> = [
      [{ denied: true, reindexError: "boom" }, "denied"],
      [{ denied: true, pending: true }, "denied"],
      [{ denied: true, stats: null }, "denied"],
      [{ denied: true, pinPending: true }, "pinning"],
      [{ reindexError: "boom", stats: stats({ folderMissing: true }) }, "missing"],
    ];
    for (const [over, expected] of cases) {
      vi.spyOn(getKbStatsStore(cwd), "getSnapshot").mockReturnValue({ ...SNAP, ...over });
      const { getByTestId, unmount } = renderSlot();
      expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe(expected);
      unmount();
      resetKbStatsStores();
    }
  });

  it("E8: a cwd refusal shows a neutral 'not allowed' with a localized tooltip, never 'index failed'", async () => {
    mockSeq([denied403]);
    const { getByTestId } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("denied"));
    const count = getByTestId("folder-kb-count");
    expect(count.textContent).toContain("not allowed");
    expect(count.textContent).not.toContain("index failed");
    expect(count.querySelector(".text-red-400")).toBeNull();
    const title = getByTestId("folder-kb-open-settings").getAttribute("title");
    expect(title).toBe("Folder not admitted — pin it to enable the knowledge base");
    expect(title).not.toContain("server reason");
  });

  it("E9: denied contributes ONE enabled 'Pin folder' item that sends pin_directory, no reindex", async () => {
    const m = mockSeq([denied403]);
    const { store } = renderSlot();
    await waitFor(() => expect(kbItem(store)?.label).toBe("Pin folder"));
    const item = kbItem(store)!;
    expect(store.getItems(cwd)).toHaveLength(1);
    expect(item.icon).toBe(mdiPinOutline);
    expect(item.disabled).toBe(false);
    act(() => item.onSelect());
    expect(send).toHaveBeenCalledWith({ type: "pin_directory", path: cwd });
    expect(postCount(m)).toBe(0);
  });

  it("E10: card control pins — no reindex, no navigation, no menu registration", async () => {
    const m = mockSeq([denied403]);
    const { hook, history } = memoryLocation({ path: "/", record: true });
    const store = createFolderMenuStore();
    const { getByTestId } = render(
      <Shell>
        <Router hook={hook as never}>
          <FolderMenuProvider store={store}>
            <CurrentPluginLayer pluginId="kb-plugin">
              <FolderKbSection folder={{ cwd }} placement="card" />
            </CurrentPluginLayer>
          </FolderMenuProvider>
        </Router>
      </Shell>,
    );
    await waitFor(() => expect(getByTestId("folder-kb-card-reindex").getAttribute("aria-label")).toBe("Pin folder"));
    const before = history.length;
    fireEvent.click(getByTestId("folder-kb-card-reindex"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: "pin_directory", path: cwd });
    expect(postCount(m)).toBe(0);
    expect(history.length).toBe(before);
    expect(store.getItems(cwd)).toHaveLength(0);
  });

  it("E11: offline — pin disabled in both placements with an offline indication; nothing sent", async () => {
    connection = "disconnected";
    mockSeq([denied403]);
    const card = renderSlotPlacement("card");
    await waitFor(() => expect(card.getByTestId("folder-kb-section").getAttribute("data-state")).toBe("denied"));
    const control = card.getByTestId("folder-kb-card-reindex") as HTMLButtonElement;
    expect(control.disabled).toBe(true);
    expect(control.parentElement?.getAttribute("title")).toBe("Pin folder — offline");
    fireEvent.click(control);
    card.unmount();
    const { store } = renderSlot();
    await waitFor(() => expect(kbItem(store)?.label).toBe("Pin folder"));
    expect(kbItem(store)!.disabled).toBe(true);
    expect(kbItem(store)!.badge).toBe("offline");
    act(() => kbItem(store)!.onSelect());
    expect(send).not.toHaveBeenCalled();
  });

  it("E12: settings stay reachable from the pill while denied", async () => {
    mockSeq([denied403]);
    const { hook, history } = memoryLocation({ path: "/", record: true });
    const { getByTestId } = renderSlot(hook);
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("denied"));
    fireEvent.click(getByTestId("folder-kb-open-settings"));
    expect(history[history.length - 1]).toBe(kbSettingsUrl(cwd));
  });

  it("F5/X1: pinning disables the control, sends once, elapses back to denied with ONE refetch", async () => {
    const m = mockSeq([denied403]);
    const card = renderSlotPlacement("card");
    const section = () => card.getByTestId("folder-kb-section").getAttribute("data-state");
    await waitFor(() => expect(section()).toBe("denied"));
    const control = () => card.getByTestId("folder-kb-card-reindex") as HTMLButtonElement;
    fireEvent.click(control());
    expect(section()).toBe("pinning");
    expect(card.getByTestId("folder-kb-count").textContent).toContain("pinning");
    expect(control().disabled).toBe(true);
    fireEvent.click(control());
    act(() => getKbStatsStore(cwd).beginPinWait()); // second wait is a no-op
    expect(send).toHaveBeenCalledTimes(1);
    const gets = statsGets(m);
    await waitFor(() => expect(section()).toBe("denied"), { timeout: PIN_GUARD_MS + 2000 });
    expect(statsGets(m)).toBe(gets + 1);
    expect(control().disabled).toBe(false);
  }, PIN_GUARD_MS + 5000);

  it("F6: any pinned_dirs_updated while denied refetches once (no path matching) and leaves denied", async () => {
    const m = mockSeq([denied403, ok({ chunks: 0, indexed: false })]);
    const { getByTestId } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("denied"));
    const gets = statsGets(m);
    act(() => { ws.dispatchEvent(pinMsg(["/other"])); });
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("not-indexed"));
    expect(statsGets(m)).toBe(gets + 1);
  });

  it("F7: an admitted section attaches no message listener and ignores pinned_dirs_updated", async () => {
    const add = vi.spyOn(ws, "addEventListener");
    const m = mockSeq([ok({ chunks: 5 })]);
    const { getByTestId } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("populated"));
    const gets = statsGets(m);
    act(() => { ws.dispatchEvent(pinMsg([cwd])); });
    await new Promise((r) => setTimeout(r, 50));
    expect(statsGets(m)).toBe(gets);
    // Exactly one `message` listener: the provider's own plugin_config_update one.
    expect(add.mock.calls.filter((c) => c[0] === "message")).toHaveLength(1);
  });

  it("X2: a transport failure on the trigger is an error with Retry, not denied", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new TypeError("Failed to fetch");
      return jsonResp(stats({ chunks: 0, indexed: false }));
    });
    const { getByTestId, store } = renderSlot();
    await waitFor(() => expect(kbItem(store)?.label).toBe("Index now"));
    act(() => kbItem(store)!.onSelect());
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("error"));
    await waitFor(() => expect(kbItem(store)?.label).toBe("Retry"));
    expect(getByTestId("folder-kb-count").textContent).not.toContain("not allowed");
  });

  it("E25: a removed folder shows 'folder missing' with a disabled action in both placements", async () => {
    const m = mockSeq([ok({ chunks: 0, indexed: false, folderMissing: true, sourceCount: 0 })]);
    const { getByTestId, store, unmount } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("missing"));
    expect(getByTestId("folder-kb-count").textContent).toContain("folder missing");
    expect(getByTestId("folder-kb-count").querySelector(".text-red-400")).toBeNull();
    await waitFor(() => expect(kbItem(store)?.label).toBe("Folder missing"));
    expect(kbItem(store)!.disabled).toBe(true);
    act(() => kbItem(store)!.onSelect());
    unmount();
    const card = renderSlotPlacement("card");
    await waitFor(() => expect(card.getByTestId("folder-kb-section").getAttribute("data-state")).toBe("missing"));
    const control = card.getByTestId("folder-kb-card-reindex") as HTMLButtonElement;
    expect(control.disabled).toBe(true);
    fireEvent.click(control);
    expect(postCount(m)).toBe(0);
  });

  it("E26: zero sources shows 'no sources' and Configure sources opens settings in both placements", async () => {
    const m = mockSeq([ok({ chunks: 0, indexed: false, sourceCount: 0 })]);
    const { hook, history } = memoryLocation({ path: "/", record: true });
    const { getByTestId, store, unmount } = renderSlot(hook);
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("no-sources"));
    expect(getByTestId("folder-kb-count").textContent).toContain("no sources");
    await waitFor(() => expect(kbItem(store)?.label).toBe("Configure sources"));
    act(() => kbItem(store)!.onSelect());
    expect(history[history.length - 1]).toBe(kbSettingsUrl(cwd));
    unmount();
    const card = memoryLocation({ path: "/", record: true });
    const r = render(
      <Shell>
        <Router hook={card.hook as never}>
          <FolderMenuProvider store={createFolderMenuStore()}>
            <CurrentPluginLayer pluginId="kb-plugin">
              <FolderKbSection folder={{ cwd }} placement="card" />
            </CurrentPluginLayer>
          </FolderMenuProvider>
        </Router>
      </Shell>,
    );
    await waitFor(() => expect(r.getByTestId("folder-kb-card-reindex").getAttribute("aria-label")).toBe("Configure sources"));
    fireEvent.click(r.getByTestId("folder-kb-card-reindex"));
    expect(card.history[card.history.length - 1]).toBe(kbSettingsUrl(cwd));
    expect(postCount(m)).toBe(0);
  });

  it("E27: a failed job on a zero-source folder keeps 'index failed' but offers Configure sources", async () => {
    mockSeq([ok({ chunks: 0, indexed: false, jobStatus: "error", lastError: "x", sourceCount: 0 })]);
    const { getByTestId, store } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("error"));
    expect(getByTestId("folder-kb-count").textContent).toContain("index failed");
    await waitFor(() => expect(kbItem(store)?.label).toBe("Configure sources"));
  });

  it("E28: zero sources with an existing index keeps the count and offers Configure sources", async () => {
    mockSeq([ok({ chunks: 120, indexed: true, sourceCount: 0 })]);
    const { getByTestId, store } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-count").textContent).toContain("120"));
    await waitFor(() => expect(kbItem(store)?.label).toBe("Configure sources"));
  });

  it("E29: an old server without the new fields keeps not-indexed + Index now", async () => {
    mockSeq([ok({ chunks: 0, indexed: false })]);
    const { getByTestId, store } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("not-indexed"));
    await waitFor(() => expect(kbItem(store)?.label).toBe("Index now"));
  });
});
