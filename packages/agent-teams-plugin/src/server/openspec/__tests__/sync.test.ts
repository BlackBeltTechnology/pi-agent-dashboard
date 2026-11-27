/**
 * The checkbox sync, sole writer of tasks.md (tasks 9.1 #X11, 9.2 #R7, 9.3 #R8, 9.4 #D9, 9.5 #D10, 9.6 #P4 and the
 * guard end-to-end of 5.5): toggle faults and backoff on a fake clock, serial queue and an external writer,
 * team close vs a pending sync, restart recovery, id + text-hash matching, a 48-completion burst, and the
 * injected toggle through the REAL network guard and route-tier gate of the dashboard server.
 * The dashboard routes are stood in by the real parser/writer (`openspec-tasks.ts`); see `apply-env.ts`.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Team } from "../../../shared/types.js";
import { applySyncOf } from "../apply.js";
import { createInject, createLoopbackInject } from "../inject.js";
import { createApplySync, RECONCILE_DELAY_MS, SYNC_BACKOFF_MS } from "../sync.js";
import { createTasksSource } from "../tasks-source.js";
import { type ApplyEnv, createApplyEnv, type Fault, ok, wideTasks } from "./apply-env.js";
import { APPLY } from "./env.js";
import { listenGuardedApp } from "./live-guarded-app.js";
import { loadServer } from "./server-src.js";

const OPEN = "## 1. A\n- [ ] 1.1 first\n- [ ] 1.2 second\n\n## 2. B\n- [ ] 2.1 third\n";
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** Let real promise chains run until `cond` holds (bounded). */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await tick();
  expect(cond()).toBe(true);
}

async function started(md: string, over: Parameters<typeof createApplyEnv>[0] = {}) {
  const e = await createApplyEnv({ tasksMd: md, ...over });
  expect((await e.start({ template: APPLY, goal: "x" })).ok).toBe(true);
  await e.flush();
  const team = e.rt.store.list()[0] as Team;
  const sync = applySyncOf(e.api) as NonNullable<ReturnType<typeof applySyncOf>>;
  const teamNow = (): Team => e.rt.store.get(team.id) as Team;
  const idOf = (title: string): string => (teamNow().tasks.find((t) => t.title.startsWith(title)) as Team["tasks"][number]).id;
  /** Complete a task the way core does after the gates: the lead actor needs it `in_progress` first. */
  const complete = (title: string): string => {
    const id = idOf(title);
    e.rt.store.patchTask(team.id, id, { status: "in_progress", owner: "dev-1" });
    const res = e.rt.ops.updateTask(teamNow(), { id, status: "completed" }, { actor: "lead" });
    if (!res.ok) throw new Error(res.error);
    return id;
  };
  /** Run the queue to idle, moving the fake clock in `step` ms slices (backoff, call timeouts, drain). */
  const settle = async (maxMs = 120_000, step = 50): Promise<void> => {
    let idle = false;
    void sync.whenIdle().then(() => void (idle = true));
    for (let t = 0; !idle && t <= maxMs; t += step) {
      for (let i = 0; i < 8 && !idle; i++) await tick(); // let the promise chain reach its next timer before time moves
      if (!idle) e.clock.advance(step);
    }
    await tick();
  };
  const notices = () => e.rt.store.mailLog(team.id).filter((m) => m.to === "lead" && m.kind === "notice" && /OpenSpec checkbox sync/.test(m.text));
  const synced = (id: string): boolean | undefined => e.api.sidecar.get(team.id)?.synced[id];
  return { e, team, teamNow, sync, complete, settle, notices, synced, idOf };
}

const posts = (e: ApplyEnv) => e.calls.filter((c) => c.method === "POST");
const gets = (e: ApplyEnv) => e.calls.filter((c) => c.method === "GET");
const marker = (e: ApplyEnv): string => e.tasksOf().map((t) => (t.done ? "x" : " ")).join("");
/** Fault: the first `n` POSTs answer `status`; the rest fall through to the real route. */
const failPosts = (n: number, answer: () => Parameters<typeof ok>[0] | Promise<never> | Error | { statusCode: number }): Fault => {
  let seen = 0;
  return (req) => {
    if (req.method !== "POST" || seen++ >= n) return undefined;
    const a = answer();
    if (a instanceof Error) throw a;
    return a as never;
  };
};
const status = (statusCode: number) => () => ({ statusCode, body: { success: false } });

describe("toggle faults (9.1 #X11)", () => {
  it("409 once ⇒ refetch and tick; the commit stands", async () => {
    const s = await started(OPEN);
    s.e.faults.push(failPosts(1, status(409)));
    const id = s.complete("1.1");
    await s.settle();
    expect(marker(s.e)).toBe("x  ");
    expect(posts(s.e)).toHaveLength(2);
    expect(gets(s.e)).toHaveLength(1 + 2); // the seed's one GET + the sync's two (refetch after the 409)
    expect(s.synced(id)).toBe(true);
    expect(s.notices()).toEqual([]);
    expect(s.teamNow().tasks.find((t) => t.id === id)?.status).toBe("completed");
  });

  it("409 ×3 ⇒ one waking notice naming the ids, synced false, boxes untouched, task still completed", async () => {
    const s = await started(OPEN);
    s.e.faults.push(failPosts(99, status(409)));
    const id = s.complete("1.1");
    await s.settle();
    expect(posts(s.e)).toHaveLength(3);
    expect(marker(s.e)).toBe("   ");
    expect(s.synced(id)).not.toBe(true);
    const n = s.notices();
    expect(n).toHaveLength(1);
    expect(n[0]?.wake).toBe(true);
    expect(n[0]?.text).toMatch(/1\.1/);
    expect(n[0]?.text).not.toMatch(/first/); // ids and codes only: no task text
    expect(s.teamNow().tasks.find((t) => t.id === id)?.status).toBe("completed");
    expect(s.e.rt.counters.get("openspec_sync_failed", s.team.id)).toBe(1);
  });

  it.each([401, 403])("%i ⇒ NO retry and a sync_forbidden notice", async (code) => {
    const s = await started(OPEN);
    s.e.faults.push(failPosts(99, status(code)));
    s.complete("1.1");
    await s.settle();
    expect(posts(s.e)).toHaveLength(1);
    expect(s.notices().map((n) => n.text).join("\n")).toMatch(/sync_forbidden/);
    expect(marker(s.e)).toBe("   ");
  });

  it("a forbidden GET is not retried either", async () => {
    const s = await started(OPEN);
    s.e.faults.push((req) => (req.method === "GET" ? { statusCode: 403, body: {} } : undefined));
    const base = gets(s.e).length;
    s.complete("1.1");
    await s.settle();
    expect(gets(s.e).length - base).toBe(1);
    expect(s.notices().map((n) => n.text).join("\n")).toMatch(/sync_forbidden/);
  });

  it.each([
    ["500", failPosts(99, status(500))],
    ["network reset", failPosts(99, () => new Error("ECONNRESET"))],
  ])("%s ⇒ 3 attempts with 250 ms and 1 s backoff, then a notice", async (_n, fault) => {
    const s = await started(OPEN);
    const times: number[] = [];
    s.e.faults.push((req) => (req.method === "POST" ? void times.push(s.e.clock.now()) : undefined));
    s.e.faults.push(fault);
    s.complete("1.1");
    await s.settle();
    expect(times).toHaveLength(3);
    expect([times[1] - times[0], times[2] - times[1]]).toEqual([SYNC_BACKOFF_MS[0], SYNC_BACKOFF_MS[1]]);
    expect(s.notices()).toHaveLength(1);
  });

  it("a call that hangs is cut after 10 s and counts as a failed attempt", async () => {
    const s = await started(OPEN);
    const times: number[] = [];
    s.e.faults.push((req) => {
      if (req.method !== "POST") return undefined;
      times.push(s.e.clock.now());
      return new Promise<never>(() => undefined);
    });
    s.complete("1.1");
    await s.settle(120_000, 250);
    expect(times).toHaveLength(3);
    expect([times[1] - times[0], times[2] - times[1]]).toEqual([10_000 + 250, 10_000 + 1000]);
    expect(s.notices()).toHaveLength(1);
  });

  it.each([
    ["5xx", () => ({ statusCode: 503, body: {} })],
    ["invalid JSON", () => ok("<html>")],
    ["wrong shape", () => ok({ success: true, data: { tasks: [{ id: 1 }] } })],
  ])("GET %s ⇒ retried like any transient failure, then a notice; nothing is written", async (_n, answer) => {
    const s = await started(OPEN);
    s.e.faults.push((req) => (req.method === "GET" ? answer() : undefined));
    const base = gets(s.e).length;
    s.complete("1.1");
    await s.settle();
    expect(gets(s.e).length - base).toBe(3);
    expect(posts(s.e)).toHaveLength(0);
    expect(s.notices()).toHaveLength(1);
  });

  it("tasks.md deleted or renamed ⇒ every ref ref_missing, synced, a lead notice, no toggle", async () => {
    for (const how of ["delete", "rename"] as const) {
      const s = await started(OPEN);
      if (how === "delete") fs.rmSync(s.e.tasksFile);
      else fs.renameSync(s.e.tasksFile, `${s.e.tasksFile}.bak`);
      const id = s.complete("1.1");
      await s.settle();
      expect(s.synced(id), how).toBe(true);
      expect(posts(s.e), how).toHaveLength(0);
      expect(s.notices().map((n) => n.text).join("\n"), how).toMatch(/tasks\.md is gone/);
    }
  });

  it("a 404 from the toggle itself (file vanished between GET and POST) is the same outcome", async () => {
    const s = await started(OPEN);
    s.e.faults.push(failPosts(1, status(404)));
    const id = s.complete("1.1");
    await s.settle();
    expect(s.synced(id)).toBe(true);
    expect(s.notices()).toHaveLength(1);
  });

  it("completing a task that is not a seeded unit (Review) writes nothing", async () => {
    const s = await started(OPEN);
    s.complete("1.1");
    s.complete("1.2");
    s.complete("2.1");
    await s.settle();
    const before = posts(s.e).length;
    s.complete("Review");
    await s.settle();
    expect(posts(s.e)).toHaveLength(before);
  });
});

describe("serial queue and an external writer (9.2 #R7)", () => {
  it("1.1 and 1.2 completed in the same tick are ticked one at a time", async () => {
    const s = await started(OPEN);
    let inflight = 0;
    let max = 0;
    s.e.faults.push(async () => {
      inflight++;
      max = Math.max(max, inflight);
      await tick();
      inflight--;
      return undefined;
    });
    s.complete("1.1");
    s.complete("1.2");
    await s.settle();
    expect(max).toBe(1);
    expect(marker(s.e)).toBe("xx ");
    expect(s.notices()).toEqual([]);
  });

  it("a human edit between the sync's GET and its toggle: the right line is ticked, the human edit survives", async () => {
    const s = await started(OPEN);
    let edited = false;
    s.e.faults.push((req) => {
      if (req.method === "POST" && !edited) {
        edited = true;
        // The human adds a line above and ticks another box before the toggle lands.
        fs.writeFileSync(s.e.tasksFile, s.e.read().replace("## 1. A\n", "## 1. A\nHuman note\n").replace("- [ ] 2.1 third", "- [x] 2.1 third"));
      }
      return undefined;
    });
    s.complete("1.2");
    await s.settle();
    expect(s.e.read()).toBe("## 1. A\nHuman note\n- [ ] 1.1 first\n- [x] 1.2 second\n\n## 2. B\n- [x] 2.1 third\n");
    expect(s.notices()).toEqual([]);
  });

  it("many boxes in a CRLF + BOM file: only the marker characters change, every other byte is identical", async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `- [ ] 1.${i + 1} box ${i + 1}`);
    const original = `\uFEFF## 1. A\r\n${lines.join("\r\n")}\r\n\r\ntrailing prose\r\n`;
    const s = await started(original);
    s.complete("1.3");
    s.complete("1.9");
    await s.settle();
    const expected = original.replace("- [ ] 1.3 ", "- [x] 1.3 ").replace("- [ ] 1.9 ", "- [x] 1.9 ");
    expect(s.e.read()).toBe(expected);
    expect(Buffer.from(s.e.read()).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});

describe("team close vs a pending sync (9.3 #R8, 5.9)", () => {
  it("a toggle that finishes within 5 s of the close still ticks the box and nothing is reported", async () => {
    const s = await started(OPEN);
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    let inFlight = false;
    s.e.faults.push(async (req) => {
      if (req.method !== "POST") return undefined;
      inFlight = true;
      await held;
      return undefined;
    });
    const id = s.complete("1.1");
    await until(() => inFlight);
    expect(s.e.rt.ops.teamDelete(s.teamNow(), { actor: "lead" }).ok).toBe(true);
    expect(s.teamNow().status).toBe("closed");
    s.e.clock.advance(4_000);
    release();
    await s.settle(10_000);
    expect(marker(s.e)).toBe("x  ");
    expect(s.synced(id)).toBe(true);
    expect(s.e.rt.counters.get("openspec_sync_failed", s.team.id)).toBe(0);
  });

  it("a toggle still pending 5 s after the close is abandoned: synced:false is persisted and the failure is counted", async () => {
    const s = await started(OPEN);
    let inFlight = false;
    let hits = 0;
    s.e.faults.push((req) => {
      if (req.method !== "POST") return undefined;
      inFlight = true;
      hits++;
      return new Promise<never>(() => undefined);
    });
    const id = s.complete("1.1");
    await until(() => inFlight);
    s.e.rt.ops.teamDelete(s.teamNow(), { actor: "lead" });
    s.e.clock.advance(4_999);
    expect(s.e.rt.counters.get("openspec_sync_failed", s.team.id)).toBe(0);
    s.e.clock.advance(1);
    expect(s.e.rt.counters.get("openspec_sync_failed", s.team.id)).toBe(1);
    expect(s.e.api.sidecar.get(s.team.id)?.synced[id]).toBe(false);
    await s.settle(20_000);
    expect(hits).toBe(1); // no retry after the deadline
    expect(marker(s.e)).toBe("   ");
  });

  it("a team that is not active starts no sync", async () => {
    const s = await started(OPEN);
    s.e.rt.ops.teamDelete(s.teamNow(), { actor: "lead" });
    s.sync.schedule(s.teamNow(), s.idOf("1.1"));
    await s.settle();
    expect(posts(s.e)).toHaveLength(0);
  });
});

describe("restart recovery (9.4 #D9)", () => {
  /** A fresh env over the same data dir would need persistence; instead the fault is lifted and the startup pass is run. */
  it("an active team's unsynced completed task is retried at the startup pass (after the route is up), once", async () => {
    const s = await started(OPEN);
    s.e.faults.push(failPosts(99, status(500)));
    const id = s.complete("1.1");
    await s.settle();
    expect(marker(s.e)).toBe("   ");
    s.e.faults.length = 0; // the route works again, "server restarted"
    const before = posts(s.e).length;
    s.sync.reconcile();
    await s.settle();
    expect(marker(s.e)).toBe("x  ");
    expect(s.synced(id)).toBe(true);
    expect(posts(s.e).length - before).toBe(1);
    s.sync.reconcile(); // idempotent: nothing left to do
    await s.settle();
    expect(posts(s.e).length - before).toBe(1);
  });

  it("with unsynced work at init the pass fires RECONCILE_DELAY_MS later (when the host routes are up), not inside plugin registration", async () => {
    const s = await started(OPEN);
    s.e.faults.push(failPosts(99, status(500)));
    s.complete("1.1");
    await s.settle(2_000);
    s.e.faults.length = 0;
    const before = posts(s.e).length;
    const timers = s.e.clock.pendingCount;
    createApplySync(s.e.api); // "restart": the module initialises again over the persisted state
    expect(s.e.clock.pendingCount).toBe(timers + 1); // armed because there is unsynced work
    const armedAt = s.e.clock.now();
    s.e.clock.advance(RECONCILE_DELAY_MS - 1);
    await tick();
    expect(posts(s.e).length).toBe(before);
    s.e.clock.advance(1);
    await until(() => posts(s.e).length - before === 1); // the new instance owns this job: wait on its effect
    expect(marker(s.e)).toBe("x  ");
    expect(s.e.clock.now() - armedAt).toBeGreaterThanOrEqual(RECONCILE_DELAY_MS);
  });

  it.each([
    ["ticked by a human ⇒ idempotent no-op", (md: string) => md.replace("- [ ] 1.1 first", "- [x] 1.1 first"), "x  ", 0],
    ["moved down ⇒ found by text", (md: string) => md.replace("## 1. A\n", "## 1. A\nnote\nnote\n"), "x  ", 1],
    ["removed ⇒ ref_missing, synced", (md: string) => md.replace("- [ ] 1.1 first\n", ""), "  ", 0],
  ])("tasks.md edited meanwhile: %s", async (_n, edit, expectedMarkers, expectedPosts) => {
    const s = await started(OPEN);
    s.e.faults.push(failPosts(99, status(500)));
    const id = s.complete("1.1");
    await s.settle();
    s.e.faults.length = 0;
    s.e.write(edit(s.e.read()));
    const before = posts(s.e).length;
    s.sync.reconcile();
    await s.settle();
    expect(posts(s.e).length - before).toBe(expectedPosts);
    expect(marker(s.e).slice(0, expectedMarkers.length)).toBe(expectedMarkers);
    expect(s.synced(id)).toBe(true);
  });

  it("a closed team is not retried", async () => {
    const s = await started(OPEN);
    s.e.faults.push(failPosts(99, status(500)));
    s.complete("1.1");
    await s.settle();
    s.e.faults.length = 0;
    s.e.rt.ops.teamDelete(s.teamNow(), { actor: "lead" });
    const before = posts(s.e).length;
    s.sync.reconcile();
    await s.settle();
    expect(posts(s.e).length).toBe(before);
  });
});

describe("refs match by id and text hash (9.5 #D10)", () => {
  it("an id-less box whose line moved is found by its text, and the right line is ticked", async () => {
    const s = await started("## 1. A\n- [ ] Verify the thing\n- [ ] Other thing\n");
    s.e.write(`## 1. A\n\nHuman paragraph\n\n- [ ] Verify the thing\n- [ ] Other thing\n`);
    s.complete("L2 Verify");
    await s.settle();
    expect(s.e.read()).toBe("## 1. A\n\nHuman paragraph\n\n- [x] Verify the thing\n- [ ] Other thing\n");
  });

  it("a box ticked by a human, a trailing hint added or removed, whitespace and CRLF changes: still the same box", async () => {
    for (const edit of [(m: string) => m.replace("- [ ] 1.1 first", "- [x] 1.1 first"), (m: string) => m.replace("first", "first <!-- after: -->"), (m: string) => m.replace("first", "first  "), (m: string) => m.replace(/\n/g, "\r\n")]) {
      const s = await started(OPEN);
      s.e.write(edit(s.e.read()));
      s.complete("1.1");
      await s.settle();
      expect(s.e.tasksOf()[0]?.done).toBe(true);
      expect(s.synced(s.idOf("1.1"))).toBe(true);
    }
  });

  it("two boxes with the same text ⇒ nothing ticked, a notice, no retry; edited text ⇒ ref_missing and synced", async () => {
    const dup = await started("## 1. A\n- [ ] same text\n- [ ] same text\n");
    dup.e.write("## 1. A\nintro\n- [ ] same text\n- [ ] same text\n"); // ids (L-lines) no longer disambiguate
    dup.complete("L2");
    await dup.settle();
    expect(marker(dup.e)).toBe("  ");
    expect(dup.notices().map((n) => n.text).join("\n")).toMatch(/sync_ambiguous/);
    expect(posts(dup.e)).toHaveLength(0);

    const edited = await started(OPEN);
    edited.e.write(edited.e.read().replace("first", "first, reworded"));
    const id = edited.complete("1.1");
    await edited.settle();
    expect(marker(edited.e)).toBe("   ");
    expect(edited.synced(id)).toBe(true); // ref_missing counts as synced
    expect(posts(edited.e)).toHaveLength(0);
  });

  it("a section task ticks every recorded id (granularity: section)", async () => {
    const s = await started(wideTasks(60, 3));
    const id = s.complete("Section 2");
    await s.settle();
    const done = s.e.tasksOf().filter((t) => t.done).map((t) => t.id);
    expect(done).toHaveLength(20);
    expect(s.synced(id)).toBe(true);
    expect(posts(s.e)).toHaveLength(20);
  });
});

describe("sync burst (9.6 #P4)", () => {
  it("48 completions with 20 ms toggle latency: all ticked, file well-formed, serial, ≤ 2×48 calls", async () => {
    const md = `## 1. All\n${Array.from({ length: 48 }, (_, i) => `- [ ] 1.${i + 1} item ${i + 1}`).join("\n")}\n`;
    const s = await started(md);
    s.e.faults.push(async (req) => {
      if (req.method === "POST") {
        await new Promise<void>((r) => s.e.clock.setTimeout(r, 20));
      }
      return undefined;
    });
    for (let i = 1; i <= 48; i++) s.complete(`1.${i} `);
    await s.settle(60_000, 10);
    expect(s.e.tasksOf().every((t) => t.done)).toBe(true);
    expect(s.e.read()).toBe(md.replace(/\[ \]/g, "[x]"));
    expect(posts(s.e)).toHaveLength(48);
    expect(gets(s.e).length - 1).toBeLessThanOrEqual(48); // minus the seed's one GET
    expect(posts(s.e).map((c) => (c.body as { id: string }).id)).toEqual(Array.from({ length: 48 }, (_, i) => `1.${i + 1}`));
  });
});

describe("the injected toggle through the real route guards (5.5)", () => {
  /** The dashboard's real `registerOpenSpecRoutes` + `createNetworkGuard` (+ the real tier gate) on a Fastify app. */
  async function realApp(strict: boolean) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-os-guard-")));
    const dir = path.join(root, "openspec", "changes", "demo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks.md"), "## 1. A\n- [ ] 1.1 first\n- [ ] 1.2 second\n");
    const [{ registerOpenSpecRoutes }, guard, tierGate, proof] = await Promise.all([
      loadServer<{ registerOpenSpecRoutes(app: unknown, deps: unknown): void }>("routes/openspec-routes.ts"),
      loadServer<{ createNetworkGuard(trusted: string[], opts: { localTrust: unknown }): unknown }>("auth/localhost-guard.ts"),
      loadServer<{ createRouteTierGate(deps: { getTrustedNetworks: () => string[]; localTrust: unknown }): never }>("auth/route-tier-gate.ts"),
      loadServer<{ createLocalTrustContext(token: string, strict: () => boolean): unknown }>("auth/local-proof.ts"),
    ]);
    const localTrust = proof.createLocalTrustContext("a-local-token", () => strict);
    const app = Fastify();
    app.addHook("onRequest", tierGate.createRouteTierGate({ getTrustedNetworks: () => [], localTrust }));
    registerOpenSpecRoutes(app, {
      sessionManager: { listAll: () => [] } as never,
      preferencesStore: { getPinnedDirectories: () => [root] } as never,
      directoryService: { refreshOpenSpec: vi.fn(async () => ({ initialized: true, changes: [] })), getOpenSpecData: vi.fn() } as never,
      networkGuard: guard.createNetworkGuard([], { localTrust }),
      onOpenSpecChanged: () => undefined,
    } as never);
    await app.ready();
    return { app, root, file: path.join(dir, "tasks.md"), inject: createInject(app) };
  }

  it("default posture: GET tasks and the toggle pass as loopback (no credential) and write the box", async () => {
    const r = await realApp(false);
    const get = await r.inject({ method: "GET", url: `/api/openspec/tasks?cwd=${encodeURIComponent(r.root)}&change=demo` });
    expect(get.statusCode).toBe(200);
    const first = (get.body as { data: { tasks: Array<{ id: string; line: number }> } }).data.tasks[0] as { id: string; line: number };
    const toggle = await r.inject({ method: "POST", url: "/api/openspec/tasks/toggle", payload: { cwd: r.root, change: "demo", id: first.id, done: true, line: first.line } });
    expect(toggle.statusCode).toBe(200);
    expect(fs.readFileSync(r.file, "utf8")).toBe("## 1. A\n- [x] 1.1 first\n- [ ] 1.2 second\n");
    const stale = await r.inject({ method: "POST", url: "/api/openspec/tasks/toggle", payload: { cwd: r.root, change: "demo", id: "1.2", done: true, line: 99 } });
    expect(stale.statusCode).toBe(409);
    await r.app.close();
  });

  it("the guard is real: a request carrying a proxy-forwarding header (a tunnel hop) is refused", async () => {
    const r = await realApp(false);
    const res = await r.app.inject({ method: "POST", url: "/api/openspec/tasks/toggle", remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.9" }, payload: { cwd: r.root, change: "demo", id: "1.1", done: true, line: 2 } });
    expect(res.statusCode).toBe(403);
    expect(fs.readFileSync(r.file, "utf8")).toContain("- [ ] 1.1");
    await r.app.close();
  });

  it("requireLocalProof (strict) refuses the credential-less toggle with 403, which the sync reports as sync_forbidden and never retries", async () => {
    const r = await realApp(true);
    const res = await r.inject({ method: "POST", url: "/api/openspec/tasks/toggle", payload: { cwd: r.root, change: "demo", id: "1.1", done: true, line: 2 } });
    expect(res.statusCode).toBe(403);
    expect(fs.readFileSync(r.file, "utf8")).toContain("- [ ] 1.1");
    await r.app.close();
  });

  it("requireLocalProof (strict) + host.localRequest on a REAL listener: the read and the toggle succeed and write the box; service absent → forbidden (sync_forbidden path)", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-os-live-")));
    const dir = path.join(root, "openspec", "changes", "demo");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "tasks.md");
    fs.writeFileSync(file, "## 1. A\n- [ ] 1.1 first\n- [ ] 1.2 second\n");
    const { registerOpenSpecRoutes } = await loadServer<{ registerOpenSpecRoutes(app: unknown, deps: unknown): void }>("routes/openspec-routes.ts");
    const live = await listenGuardedApp(true, (app, { networkGuard }) =>
      registerOpenSpecRoutes(app, {
        sessionManager: { listAll: () => [] } as never,
        preferencesStore: { getPinnedDirectories: () => [root] } as never,
        directoryService: { refreshOpenSpec: vi.fn(async () => ({ initialized: true, changes: [] })), getOpenSpecData: vi.fn() } as never,
        networkGuard,
        onOpenSpecChanged: () => undefined,
      } as never),
    );
    try {
      const clock = { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (t: unknown) => clearTimeout(t as NodeJS.Timeout) };
      const consume = <T,>(n: string): T | undefined => (n === "host.localRequest" ? (live.service as T) : undefined);
      const source = createTasksSource(createLoopbackInject(live.app, consume), clock);
      const read = await source.read(root, "demo");
      expect(read.ok).toBe(true);
      const first = (read as { tasks: Array<{ id: string; line: number }> }).tasks[0] as { id: string; line: number };
      expect(await source.toggle(root, "demo", first)).toEqual({ ok: true });
      expect(fs.readFileSync(file, "utf8")).toBe("## 1. A\n- [x] 1.1 first\n- [ ] 1.2 second\n");

      // service absent on an older host: the credential-less write is refused 403 and maps to `forbidden` (never retried)
      const old = createTasksSource(createLoopbackInject(live.app, () => undefined), clock);
      expect(await old.toggle(root, "demo", { id: "1.2", line: 3 })).toMatchObject({ ok: false, code: "forbidden", status: 403 });
      expect(fs.readFileSync(file, "utf8")).toContain("- [ ] 1.2");
    } finally {
      await live.close();
    }
  });
});

describe("an idle module holds no timer", () => {
  it("init over a runtime with nothing to retry arms no reconcile timer", async () => {
    const s = await started(OPEN);
    const timers = s.e.clock.pendingCount;
    createApplySync(s.e.api);
    expect(s.e.clock.pendingCount).toBe(timers);
  });
});
