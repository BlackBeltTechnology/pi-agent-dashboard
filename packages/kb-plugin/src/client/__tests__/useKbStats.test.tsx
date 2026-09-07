/**
 * useKbStats — polls while indexing, stops on completion (task 2.1); surfaces
 * a malformed-response error (task 2.2). See change: add-kb-folder-slot.
 */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KbStats } from "../../shared/kb-plugin-types.js";
import { getKbStatsStore } from "../kb-stats-store.js";
import { REINDEX_GUARD_MS, resetKbStatsStores, type UseKbStatsResult, useKbStats } from "../useKbStats.js";

// The per-cwd stats store is a module singleton — reset it so no snapshot,
// poll or armed guard leaks between tests. See change: fix-kb-card-refresh-and-shared-stats.
beforeEach(() => { resetKbStatsStores(); });
afterEach(() => { cleanup(); resetKbStatsStores(); vi.restoreAllMocks(); });

function json(s: KbStats): Response {
  return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => s } as unknown as Response;
}
function jsonResp(body: unknown, ok = true, status = 200): Response {
  return { ok, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as unknown as Response;
}
/** Non-blocking reindex ack: POST → 202 { status:"running" }. */
function json202(): Response {
  return jsonResp({ status: "running", jobId: "kb-1" }, true, 202);
}
function base(over: Partial<KbStats> = {}): KbStats {
  return { files: 1, chunks: 0, indexed: false, staleCount: 0, indexing: false, jobStatus: "idle", ...over };
}

/** Probe that also exposes optimistic `pending` + a click-to-reindex button. */
function ReindexProbe({ cwd }: { cwd: string }): React.ReactElement {
  const { stats, reindexError, pending, reindex } = useKbStats(cwd);
  return (
    <div
      data-testid="probe"
      data-pending={String(pending)}
      data-indexing={String(stats?.indexing ?? "")}
      data-chunks={stats?.chunks ?? ""}
      data-reindex-error={reindexError ?? ""}
    >
      <button type="button" data-testid="go" onClick={() => reindex()}>go</button>
    </div>
  );
}
const getCount = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method !== "POST").length;

/** Probe that also surfaces the poll-outage `error` channel. */
function ReindexProbeErr({ cwd }: { cwd: string }): React.ReactElement {
  const { error, pending, reindex } = useKbStats(cwd);
  return (
    <div data-testid="probe" data-pending={String(pending)} data-error={error ?? ""}>
      <button type="button" data-testid="go" onClick={() => reindex()}>go</button>
    </div>
  );
}

function Probe({ cwd }: { cwd: string }): React.ReactElement {
  const { stats, error, reindexError } = useKbStats(cwd);
  return (
    <div
      data-testid="probe"
      data-chunks={stats?.chunks ?? ""}
      data-error={error ?? ""}
      data-reindex-error={reindexError ?? ""}
      data-indexing={String(stats?.indexing ?? "")}
    />
  );
}

describe("useKbStats", () => {
  it("polls while indexing then stops once the job completes", async () => {
    const responses = [
      base({ indexing: true, jobStatus: "running" }),
      base({ indexing: true, jobStatus: "running" }),
      base({ indexing: false, chunks: 42, indexed: true }),
    ];
    let i = 0;
    const fetchMock = vi.fn(async () => json(responses[Math.min(i++, responses.length - 1)]));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const { getByTestId } = render(<Probe cwd="/repo" />);
    // Eventually reaches the settled state with chunks populated.
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-chunks")).toBe("42"), { timeout: 5000 });
    const callsAtSettle = fetchMock.mock.calls.length;
    // No further polling after settle.
    await new Promise((r) => setTimeout(r, 1200));
    expect(fetchMock.mock.calls.length).toBe(callsAtSettle);
  });

  it("surfaces a typed error only after a bounded run of consecutive poll failures", async () => {
    // Resilient poll: MAX_POLL_MISSES=3 consecutive misses before giving up.
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () =>
      new Response("<html>oops</html>", { status: 500, headers: { "content-type": "text/html" } }),
    );
    const { getByTestId } = render(<Probe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-error")).toMatch(/HTTP 500/), { timeout: 5000 });
  });

  it("sets pending=true synchronously on reindex() before any promise resolves (task 1.1)", async () => {
    const seq = [base(), base({ indexing: true, jobStatus: "running" }), base({ indexing: false, chunks: 5, indexed: true })];
    let i = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json202() : json(seq[Math.min(i++, seq.length - 1)]),
    );
    const { getByTestId } = render(<ReindexProbe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    fireEvent.click(getByTestId("go"));
    // Synchronous: pending flips true in the SAME render as the click, before any fetch resolves.
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    // And it resolves cleanly into the real polled state (no permanent optimistic spinner).
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-chunks")).toBe("5"), { timeout: 5000 });
  });

  it("clears pending only when a /stats poll observes indexing:true — no false/false gap (task 1.2)", async () => {
    const seq = [base(), base({ indexing: true, jobStatus: "running" })];
    let i = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json202() : json(seq[Math.min(i++, seq.length - 1)]),
    );
    const { getByTestId } = render(<ReindexProbe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    fireEvent.click(getByTestId("go"));
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    // Handoff: pending clears exactly when indexing:true is observed — same commit, no gap.
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    expect(getByTestId("probe").getAttribute("data-indexing")).toBe("true");
  });

  it("clears pending and sets reindexError when the trigger POST is rejected (task 1.3)", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? jsonResp({ error: "cwd not allowed" }, false, 403) : json(base()),
    );
    const { getByTestId } = render(<ReindexProbe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    fireEvent.click(getByTestId("go"));
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-reindex-error")).toMatch(/cwd not allowed/));
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("false");
  });

  it("clears pending via the bounded timeout guard when indexing:true is never observed (task 1.4)", async () => {
    // 202 ack but /stats always reports settled (job finished before the first poll):
    // indexing:true is never seen, so only the guard can clear pending.
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json202() : json(base({ indexing: false, chunks: 9, indexed: true })),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(<ReindexProbe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    fireEvent.click(getByTestId("go"));
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    const getsBefore = getCount(fetchMock);
    // Neither reject nor indexing:true fires → the guard clears pending and refetches fresh stats.
    await waitFor(
      () => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"),
      { timeout: REINDEX_GUARD_MS + 3000 },
    );
    expect(getCount(fetchMock)).toBeGreaterThan(getsBefore);
  }, REINDEX_GUARD_MS + 6000);

  it("resets pending when cwd changes so it never leaks across folders (CodeRabbit)", async () => {
    // Hang ALL requests so pending stays true and no background fetch resolves after exit.
    (globalThis as { fetch?: unknown }).fetch = vi.fn(() => new Promise<Response>(() => {}));
    const { getByTestId, rerender } = render(<ReindexProbe cwd="/repo/a" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    fireEvent.click(getByTestId("go"));
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    rerender(<ReindexProbe cwd="/repo/b" />);
    // The new folder starts clean — no leaked optimistic spinner.
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("false");
  });

  it("reindex() clears a prior poll `error` so the optimistic spinner is not masked (CodeRabbit)", async () => {
    // First: a persistent poll outage surfaces `error`; then a reindex click must clear it.
    let allow202 = false;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { allow202 = true; return json202(); }
      return allow202 ? json(base({ indexing: true, jobStatus: "running" })) : new Response("<html/>", { status: 500, headers: { "content-type": "text/html" } });
    });
    const { getByTestId } = render(<ReindexProbeErr cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-error")).toMatch(/HTTP 500/), { timeout: 5000 });
    fireEvent.click(getByTestId("go"));
    // Optimistic pending fires AND the stale poll error is cleared in the same commit.
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    expect(getByTestId("probe").getAttribute("data-error")).toBe("");
    // Settle the reindex flow (202 → poll sees indexing:true → pending clears) before exit
    // so no background state update leaks past the test.
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"), { timeout: 5000 });
  });

  it("tolerates a lone transient poll miss during indexing without dropping the spinner (task 2.3)", async () => {
    let call = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error("network blip"); // one transient miss mid-walk
      if (call >= 4) return json(base({ indexing: false, chunks: 7, indexed: true }));
      return json(base({ indexing: true, jobStatus: "running" }));
    });
    const { getByTestId } = render(<Probe cwd="/repo" />);
    // The spinner (indexing:true) shows and survives the blip.
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-indexing")).toBe("true"));
    // Polling continues to the terminal state; error never surfaces.
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-chunks")).toBe("7"), { timeout: 5000 });
    expect(getByTestId("probe").getAttribute("data-error")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared per-cwd store — one state + one poll loop per folder, subscribed by
// every consumer. See change: fix-kb-card-refresh-and-shared-stats.
// ─────────────────────────────────────────────────────────────────────────────

/** Flush pending microtasks (the store defers its subscribe-time fetch). */
async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(0);
}
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
/** GET calls issued for one cwd (POSTs excluded). */
const getsFor = (m: ReturnType<typeof vi.fn>, cwd: string) =>
  m.mock.calls.filter(
    (c) => (c[1] as RequestInit | undefined)?.method !== "POST" && String(c[0]).includes(encodeURIComponent(cwd)),
  ).length;
const postsOf = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST").length;

/** A hook consumer that records every result it renders. */
const seen: Record<string, UseKbStatsResult[]> = {};
function Consumer({ id, cwd }: { id: string; cwd: string }): React.ReactElement {
  const r = useKbStats(cwd);
  (seen[id] ??= []).push(r);
  return (
    <div
      data-testid={id}
      data-pending={String(r.pending)}
      data-loading={String(r.loading)}
      data-indexing={String(r.stats?.indexing ?? "")}
      data-chunks={r.stats?.chunks ?? ""}
      data-error={r.error ?? ""}
      data-reindex-error={r.reindexError ?? ""}
    >
      <button type="button" data-testid={`${id}-go`} onClick={() => r.reindex()}>go</button>
    </div>
  );
}
const last = (id: string): UseKbStatsResult => {
  const list = seen[id];
  if (!list?.length) throw new Error(`consumer ${id} never rendered`);
  return list[list.length - 1];
};

describe("kb stats store — shared per folder", () => {
  beforeEach(() => { for (const k of Object.keys(seen)) delete seen[k]; });
  afterEach(() => { vi.useRealTimers(); });

  it("E3: distinct folders keep independent stores", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json202() : json(base({ chunks: 5, indexed: true })),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const a = getKbStatsStore("/repo/a");
    const b = getKbStatsStore("/repo/b");
    const unA = a.subscribe(() => {});
    const unB = b.subscribe(() => {});
    await settle();
    expect(a.getSnapshot().stats?.chunks).toBe(5);
    const bSnapshot = b.getSnapshot();
    const bGets = getsFor(fetchMock, "/repo/b");

    a.reindex();
    await settle(100);

    // B is untouched: same snapshot object, no pending, no request of its own.
    expect(b.getSnapshot()).toBe(bSnapshot);
    expect(b.getSnapshot().pending).toBe(false);
    expect(getsFor(fetchMock, "/repo/b")).toBe(bGets);
    expect(a.getSnapshot().pending).toBe(true);
    unA(); unB();
  });

  it("E4: the optimistic guard self-clears at zero subscribers WITHOUT fetching", async () => {
    vi.useFakeTimers();
    // 202 ack but /stats always settled → indexing:true is never observed, so
    // only the guard can clear `pending`.
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json202() : json(base({ chunks: 9, indexed: true })),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const store = getKbStatsStore("/repo/guard");
    const un = store.subscribe(() => {});
    await settle();
    store.reindex();
    expect(store.getSnapshot().pending).toBe(true);
    un(); // last consumer leaves while pending is still armed
    const getsAtZero = getsFor(fetchMock, "/repo/guard");

    await settle(REINDEX_GUARD_MS + 100);

    expect(store.getSnapshot().pending).toBe(false);
    expect(getsFor(fetchMock, "/repo/guard")).toBe(getsAtZero); // no fetch at zero subscribers
    // A consumer remounting afterwards sees a cleared (enabled) state.
    const un2 = store.subscribe(() => {});
    expect(store.getSnapshot().pending).toBe(false);
    un2();
  });

  it("E5: a later subscriber gets the retained snapshot + ONE background revalidate, coalesced while in flight", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => json(base({ chunks: 3, indexed: true })));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const settled = getKbStatsStore("/repo/settled");
    const un1 = settled.subscribe(() => {});
    await settle();
    const before = getsFor(fetchMock, "/repo/settled");
    const un2 = settled.subscribe(() => {});
    expect(settled.getSnapshot().stats?.chunks).toBe(3); // served synchronously
    await settle();
    expect(getsFor(fetchMock, "/repo/settled") - before).toBe(1);
    un1(); un2();

    // In-flight case: the join coalesces into the running request.
    const d = deferred<Response>();
    const inflightMock = vi.fn(() => d.promise);
    (globalThis as { fetch?: unknown }).fetch = inflightMock;
    const live = getKbStatsStore("/repo/live");
    const un3 = live.subscribe(() => {});
    await settle();
    expect(getsFor(inflightMock, "/repo/live")).toBe(1);
    const un4 = live.subscribe(() => {});
    await settle();
    expect(getsFor(inflightMock, "/repo/live")).toBe(1); // ZERO additional fetch
    d.resolve(json(base({ chunks: 1, indexed: true })));
    await settle();
    expect(live.getSnapshot().stats?.chunks).toBe(1);
    un3(); un4();
  });

  it("E6: two consumers on one folder share ONE poll loop", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => json(base({ indexing: true, jobStatus: "running" })));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const store = getKbStatsStore("/repo/poll");
    const un1 = store.subscribe(() => {});
    const un2 = store.subscribe(() => {});
    await settle();
    const before = getsFor(fetchMock, "/repo/poll");

    await settle(3 * 1000);

    // 1 tick/second for the FOLDER, not per consumer (which would be 6).
    expect(getsFor(fetchMock, "/repo/poll") - before).toBe(3);
    un1(); un2();
  });

  it("E6b: a poll tick never stacks on a request still in flight", async () => {
    vi.useFakeTimers();
    const hung = deferred<Response>();
    let call = 0;
    const fetchMock = vi.fn(() => {
      call += 1;
      return call === 1 ? Promise.resolve(json(base({ indexing: true, jobStatus: "running" }))) : hung.promise;
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const store = getKbStatsStore("/repo/hung");
    const un = store.subscribe(() => {});
    await settle();                       // initial fetch → indexing:true → poll armed
    await settle(1000);                   // first tick issues the hung request
    expect(getsFor(fetchMock, "/repo/hung")).toBe(2);

    await settle(5 * 1000);               // five more ticks while it never resolves
    expect(getsFor(fetchMock, "/repo/hung")).toBe(2); // no accumulation

    hung.resolve(json(base({ indexing: true, jobStatus: "running" })));
    await settle(1000);                   // the loop resumes once it settles
    expect(getsFor(fetchMock, "/repo/hung")).toBe(3);
    un();
  });

  it("F5: poll ticks never toggle `loading`", async () => {
    vi.useFakeTimers();
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => json(base({ indexing: true, jobStatus: "running" })));
    const store = getKbStatsStore("/repo/loadflap");
    const un = store.subscribe(() => {});
    await settle();
    expect(store.getSnapshot().loading).toBe(false);

    const observed: boolean[] = [];
    const un2 = store.subscribe(() => observed.push(store.getSnapshot().loading));
    await settle();
    observed.length = 0; // drop the revalidate epoch — poll ticks only from here
    await settle(3 * 1000);
    expect(observed.some((l) => l)).toBe(false);
    expect(store.getSnapshot().loading).toBe(false);
    un(); un2();
  });

  it("X2: a stale fetch epoch resolving late is discarded", async () => {
    vi.useFakeTimers();
    const first = deferred<Response>();
    const second = deferred<Response>();
    let call = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(() => (++call === 1 ? first.promise : second.promise));

    const store = getKbStatsStore("/repo/epoch");
    const un = store.subscribe(() => {});
    await settle();          // epoch 1 in flight
    store.refetch();         // epoch 2 supersedes it
    await settle();
    second.resolve(json(base({ chunks: 22, indexed: true })));
    await settle();
    expect(store.getSnapshot().stats?.chunks).toBe(22);

    first.resolve(json(base({ chunks: 11, indexed: true }))); // arrives out of order
    await settle();
    expect(store.getSnapshot().stats?.chunks).toBe(22); // newer epoch retained
    un();
  });

  it("X3: miss tolerance survives the shared store — both consumers see the same channels", async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      // 1 ok (starts the poll) → 2 misses → ok → then a run of 3 misses.
      if (call === 1 || call === 4) return json(base({ indexing: true, jobStatus: "running" }));
      throw new Error("network blip");
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const store = getKbStatsStore("/repo/miss");
    const a: string[] = [];
    const b: string[] = [];
    const un1 = store.subscribe(() => a.push(store.getSnapshot().error ?? ""));
    const un2 = store.subscribe(() => b.push(store.getSnapshot().error ?? ""));
    await settle();
    expect(store.getSnapshot().stats?.indexing).toBe(true);

    await settle(2 * 1000); // the two tolerated misses
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().stats?.indexing).toBe(true); // spinner retained

    await settle(4 * 1000); // success then the 3-miss run
    expect(store.getSnapshot().error).toMatch(/network blip/);
    const frozen = getsFor(fetchMock, "/repo/miss");
    await settle(3 * 1000);
    expect(getsFor(fetchMock, "/repo/miss")).toBe(frozen); // poll stopped
    // One shared channel: both subscribers were notified and read the same value.
    expect(a.at(-1)).toMatch(/network blip/);
    expect(b.at(-1)).toBe(a.at(-1));
    un1(); un2();
  });

  it("X3b: a deliberate refetch restarts the consecutive-miss run", async () => {
    vi.useFakeTimers();
    let call = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return json(base({ indexing: true, jobStatus: "running" }));
      throw new Error("network blip");
    });
    const store = getKbStatsStore("/repo/missreset");
    const un = store.subscribe(() => {});
    await settle();
    await settle(2 * 1000); // two tolerated misses — one short of the bound
    expect(store.getSnapshot().error).toBeNull();

    store.refetch(); // a deliberate epoch resets the run (parity with the old effect body)
    await settle();
    // Without the reset this failure would be the 3rd consecutive miss and error.
    expect(store.getSnapshot().error).toBeNull();
    await settle(2 * 1000);
    expect(store.getSnapshot().error).toMatch(/network blip/);
    un();
  });

  it("X4: subscribe → unsubscribe → resubscribe in one tick keeps the in-flight fetch", async () => {
    vi.useFakeTimers();
    const d = deferred<Response>();
    const fetchMock = vi.fn(() => d.promise);
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const errors: unknown[] = [];
    const onErr: EventListener = (e) => { errors.push(e); };
    globalThis.addEventListener("unhandledrejection", onErr);

    const store = getKbStatsStore("/repo/churn");
    const un1 = store.subscribe(() => {});
    un1();
    const un2 = store.subscribe(() => {});
    await settle();
    expect(getsFor(fetchMock, "/repo/churn")).toBe(1); // no duplicate fetch

    d.resolve(json(base({ chunks: 7, indexed: true })));
    await settle();
    expect(store.getSnapshot().stats?.chunks).toBe(7); // the result still lands
    expect(store.getSnapshot().error).toBeNull();      // no AbortError surfaced
    expect(errors).toHaveLength(0);
    globalThis.removeEventListener("unhandledrejection", onErr);
    un2();
  });
});

describe("useKbStats — consumers share one folder state", () => {
  beforeEach(() => { for (const k of Object.keys(seen)) delete seen[k]; });

  it("F1: a reindex in one consumer converges the other, on one identical snapshot", async () => {
    const seq = [
      base({ chunks: 4, indexed: true }),
      base({ indexing: true, jobStatus: "running", chunks: 4, indexed: true }),
      base({ chunks: 40, indexed: true }),
    ];
    let gi = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json202() : json(seq[Math.min(gi++, seq.length - 1)]),
    );
    const { getByTestId } = render(
      <>
        <Consumer id="panel" cwd="/repo/conv" />
        <Consumer id="section" cwd="/repo/conv" />
      </>,
    );
    await waitFor(() => expect(getByTestId("section").getAttribute("data-chunks")).toBe("4"));

    fireEvent.click(getByTestId("panel-go"));
    // The OTHER consumer sees the optimistic pending in the same commit.
    expect(getByTestId("section").getAttribute("data-pending")).toBe("true");
    await waitFor(() => expect(getByTestId("section").getAttribute("data-indexing")).toBe("true"), { timeout: 5000 });
    await waitFor(() => expect(getByTestId("section").getAttribute("data-chunks")).toBe("40"), { timeout: 5000 });
    // No remount happened, and both read the very same stats object.
    expect(last("section").stats).toBe(last("panel").stats);
  });

  it("F4: the busy window is shared — the second consumer cannot submit a second POST", async () => {
    // Start IDLE so consumer A's click genuinely issues the trigger POST; the
    // guard under test is what happens to consumer B during the pending window
    // that click opens (and afterwards, once the poll reports indexing).
    const seq = [
      base({ chunks: 4, indexed: true }),
      base({ indexing: true, jobStatus: "running", chunks: 4, indexed: true }),
    ];
    let gi = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json202() : json(seq[Math.min(gi++, seq.length - 1)]),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(
      <>
        <Consumer id="a" cwd="/repo/busy" />
        <Consumer id="b" cwd="/repo/busy" />
      </>,
    );
    await waitFor(() => expect(getByTestId("b").getAttribute("data-chunks")).toBe("4"));
    expect(postsOf(fetchMock)).toBe(0);

    fireEvent.click(getByTestId("a-go"));
    expect(postsOf(fetchMock)).toBe(1);
    // B is busy in the SAME commit — the optimistic pending is shared, so its
    // control is already disabled and its activation is a no-op.
    expect(getByTestId("b").getAttribute("data-pending")).toBe("true");
    fireEvent.click(getByTestId("b-go"));
    expect(postsOf(fetchMock)).toBe(1);

    // And it stays a no-op across the handoff into the polled indexing window.
    await waitFor(() => expect(getByTestId("b").getAttribute("data-indexing")).toBe("true"), { timeout: 5000 });
    fireEvent.click(getByTestId("b-go"));
    await new Promise((r) => setTimeout(r, 50));
    expect(postsOf(fetchMock)).toBe(1);
  });

  it("F7: a consumer mounting after the reindex settled renders the settled counts, then revalidates", async () => {
    const seq = [base({ chunks: 2, indexed: true }), base({ chunks: 99, indexed: true })];
    let gi = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json202() : json(seq[Math.min(gi++, seq.length - 1)]),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const first = render(<Consumer id="only" cwd="/repo/remount" />);
    await waitFor(() => expect(first.getByTestId("only").getAttribute("data-chunks")).toBe("2"));
    fireEvent.click(first.getByTestId("only-go"));
    await waitFor(() => expect(first.getByTestId("only").getAttribute("data-chunks")).toBe("99"), { timeout: 5000 });
    first.unmount();

    const gets = getsFor(fetchMock, "/repo/remount");
    const later = render(<Consumer id="later" cwd="/repo/remount" />);
    // FIRST render already carries the settled snapshot — no stale pre-reindex flash.
    expect(seen.later?.[0]?.stats?.chunks).toBe(99);
    expect(later.getByTestId("later").getAttribute("data-chunks")).toBe("99");
    await waitFor(() => expect(getsFor(fetchMock, "/repo/remount")).toBe(gets + 1)); // background revalidate
  });

  it("X1: a rejected trigger surfaces on BOTH consumers and any consumer can clear it", async () => {
    let posts = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts += 1;
        return posts === 1 ? jsonResp({ error: "reindex exploded" }, false, 500) : json202();
      }
      return json(base({ chunks: 1, indexed: true }));
    });
    const { getByTestId } = render(
      <>
        <Consumer id="panel" cwd="/repo/err" />
        <Consumer id="section" cwd="/repo/err" />
      </>,
    );
    await waitFor(() => expect(getByTestId("section").getAttribute("data-chunks")).toBe("1"));

    fireEvent.click(getByTestId("panel-go"));
    await waitFor(() => expect(getByTestId("panel").getAttribute("data-reindex-error")).toMatch(/reindex exploded/));
    // The failure is folder state — the OTHER consumer shows it too.
    expect(getByTestId("section").getAttribute("data-reindex-error")).toMatch(/reindex exploded/);

    fireEvent.click(getByTestId("section-go"));
    expect(getByTestId("panel").getAttribute("data-reindex-error")).toBe("");
    await waitFor(() => expect(getByTestId("section").getAttribute("data-pending")).toBe("false"), { timeout: 6000 });
  }, 12_000);
});
