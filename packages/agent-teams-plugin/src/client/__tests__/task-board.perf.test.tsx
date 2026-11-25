// @vitest-environment jsdom
/**
 * Render-count and size gates of the Team view (test-plan S78, design D9/D10, A12):
 * structural only — wall-clock is recorded elsewhere, never gated. Stress fixture:
 * 50 tasks × 2 000-char text, 10 members, 100 mails. An unchanged snapshot (the 304 path)
 * causes 0 re-renders; a refetch that replaces every object re-renders only the
 * changed member row / task card / mail row; the snapshot stays ≤ 384 KiB.
 * See change: add-agent-teams-ui.
 */
import { cleanup } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SNAPSHOT_MAIL_LIMIT, SNAPSHOT_MAIL_TEXT_MAX } from "../../shared/constants.js";
import type { TeamUiSnapshot } from "../../shared/ui-protocol.js";
import { sameMemberRow } from "../MembersGrid.js";
import { sameMailRow } from "../MessageLog.js";
import { sameTaskCard } from "../TaskBoard.js";
import { flush, type Mounted, mountView } from "./team-view-harness.js";
import { mail, member, snap, task } from "./view-fixtures.js";

const calls = vi.hoisted(() => new Map<string, number>());
vi.mock("../format-cwd.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../format-cwd.js")>();
  return {
    ...actual,
    formatCwd: (cwd: string, lead: string) => {
      calls.set(cwd, (calls.get(cwd) ?? 0) + 1);
      return actual.formatCwd(cwd, lead);
    },
  };
});

/** The real clock (fake timers also freeze `performance.now`). */
const realNow = performance.now.bind(performance);
const BIG = "x".repeat(2000);
function stress(rev: number, busy = 0): TeamUiSnapshot {
  return snap({
    rev,
    members: Array.from({ length: 10 }, (_, i) => member(`m${i}`, i === busy ? "busy" : "idle", { cwd: `/ws/lead/m${i}`, sessionId: `S-${i}` })),
    tasks: Array.from({ length: 50 }, (_, i) => task(String(i + 1), i % 3 === 0 ? "pending" : i % 3 === 1 ? "in_progress" : "completed", { description: BIG, result: "done", owner: `m${i % 10}` })),
    mail: Array.from({ length: SNAPSHOT_MAIL_LIMIT }, (_, i) => mail(i + 1, { text: BIG.slice(0, SNAPSHOT_MAIL_TEXT_MAX) })),
    mailTotal: 5000,
  });
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let m: Mounted | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  calls.clear();
});
afterEach(() => {
  m?.unmount();
  m = undefined;
  cleanup();
  vi.useRealTimers();
});

describe("render counts (S78)", () => {
  it("unchanged snapshot (304 path) → 0 re-renders and 0 DOM mutations", async () => {
    m = await mountView(stress(1));
    const root = document.body;
    const mutations: number[] = [];
    const observer = new MutationObserver((r) => mutations.push(r.length));
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    const before = [...calls.values()].reduce((a, b) => a + b, 0);
    const gets = m.server.gets().length;
    m.store.signalReconnect();
    await flush(600);
    expect(m.server.gets().length).toBeGreaterThan(gets); // it did ask…
    expect([...calls.values()].reduce((a, b) => a + b, 0)).toBe(before); // …and no row re-rendered
    expect(mutations).toEqual([]);
    observer.disconnect();
  });

  it("one member status change (every object replaced) → only that member's row re-renders", async () => {
    m = await mountView(stress(1, 0));
    expect(calls.get("/ws/lead/m3")).toBe(1);
    calls.clear();
    m.server.snapshot = clone(stress(2, 3));
    m.store.signalReconnect();
    await flush(600);
    expect(m.store.getTeam("t1")?.snapshot?.rev).toBe(2);
    // m0 (busy → idle) and m3 (idle → busy) changed; the other eight rows were skipped.
    expect([...calls.keys()].sort()).toEqual(["/ws/lead/m0", "/ws/lead/m3"]);
    for (const n of calls.values()) expect(n).toBe(1);
  });

  it("whole-tree commits: a 304 adds none", async () => {
    let commits = 0;
    m = await mountView(stress(1));
    m.unmount();
    cleanup();
    // Profiler around the same tree: count commits across a 304 refetch.
    const { PluginContextProvider } = await import("@blackbelt-technology/dashboard-plugin-runtime/host");
    const { TeamViewClaim } = await import("../TeamView.js");
    const { createServer } = await import("./team-view-harness.js");
    const { createTeamsStore } = await import("../teams-store.js");
    const { renderHost } = await import("./view-fixtures.js");
    const { server, fetch } = createServer(stress(1));
    const store = createTeamsStore({ fetch });
    const view = renderHost(
      <Profiler id="t" onRender={() => commits++}>
        <PluginContextProvider connectionStatus="connected">
          <TeamViewClaim params={{ sessionId: "S-lead" }} store={store} />
        </PluginContextProvider>
      </Profiler>,
    );
    await flush();
    const settled = commits;
    store.signalReconnect();
    await flush(600);
    expect(server.gets().length).toBeGreaterThan(2);
    expect(commits).toBe(settled);
    view.unmount();
    store.dispose();
    m = undefined;
  });
});

describe("wall-clock (recorded, NOT gated — task 10.3)", () => {
  it("initial mount and one member-status refetch of the stress fixture", async () => {
    const t0 = realNow();
    m = await mountView(stress(1, 0));
    const mount = realNow() - t0;
    m.server.snapshot = clone(stress(2, 3));
    const t1 = realNow();
    m.store.signalReconnect();
    await flush(600);
    const refetch = realNow() - t1;
    console.info(`[view-perf] stress mount=${mount.toFixed(1)}ms refetch+rerender=${refetch.toFixed(1)}ms (jsdom, fake timers; informational)`);
    expect(m.store.getTeam("t1")?.snapshot?.rev).toBe(2);
  });
});

describe("memo gates compare by value", () => {
  const base = stress(1);
  const fresh = clone(base);
  const noop = () => undefined;

  it("a task card is skipped for an equal clone and re-rendered when its own data changes", () => {
    const t0 = base.tasks[0] as (typeof base.tasks)[number];
    const props = { task: t0, deps: [], depsDone: true, open: false, onToggle: noop };
    expect(sameTaskCard(props, { ...props, task: clone(t0) })).toBe(true);
    expect(sameTaskCard(props, { ...props, task: { ...clone(t0), status: "completed" } })).toBe(false);
    expect(sameTaskCard(props, { ...props, open: true })).toBe(false);
    expect(sameTaskCard(props, { ...props, deps: [{ text: "waits for #2 — pending", open: true }] })).toBe(false);
    expect(fresh.tasks.every((t, i) => sameTaskCard({ ...props, task: base.tasks[i] as never }, { ...props, task: t }))).toBe(true);
  });

  it("a mail row is skipped for an equal clone and re-rendered when acked", () => {
    const m0 = base.mail[0] as (typeof base.mail)[number];
    const props = { m: m0, open: false, onToggle: noop };
    expect(sameMailRow(props, { ...props, m: clone(m0) })).toBe(true);
    expect(sameMailRow(props, { ...props, m: { ...clone(m0), ackedAt: undefined } })).toBe(false);
  });

  it("a member row is skipped for an equal clone and re-rendered on a status change", () => {
    const m0 = base.members[0] as (typeof base.members)[number];
    const props = { m: m0, leadCwd: "/ws/lead", firstId: undefined, firstTitle: undefined, more: 0, canStop: false, note: undefined, stopping: false, onStop: noop, onFocusTask: noop, onShowMemberTasks: noop };
    expect(sameMemberRow(props, { ...props, m: clone(m0) })).toBe(true);
    expect(sameMemberRow(props, { ...props, m: { ...clone(m0), status: "failed" } })).toBe(false);
    expect(sameMemberRow(props, { ...props, note: "forbidden" })).toBe(false);
  });
});

describe("snapshot size gate (A12)", () => {
  it("the stress snapshot stays ≤ 384 KiB", () => {
    expect(JSON.stringify(stress(1)).length).toBeLessThanOrEqual(384 * 1024);
  });
});
