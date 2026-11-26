/**
 * L1 Tasks tools (test-plan #C102–#C108; tasks 12.101–12.107; scenario-gate C1–C6 as they apply to Tasks) against the
 * REAL lease handler and a fake Google Tasks. See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { createFakeGoogle, type FakeGoogle, googleError, jsonOf, makeToolHost, NO_UI, uiCtx } from "./fake-google.js";

const WORK = { sub: "s1", email: "a@x.com", alias: "work", products: { tasks: "write" } } as const;

interface T {
  id: string;
  title: string;
  status: "needsAction" | "completed";
  notes?: string;
  due?: string;
  parent?: string;
  completed?: string;
}
const task = (id: string, over: Partial<T> = {}): T => ({ id, title: `Task ${id}`, status: "needsAction", ...over });
const SEED = (): T[] => [
  task("t1", { title: "Buy milk", notes: "2 litres", due: "2026-06-01T00:00:00.000Z" }),
  task("t2", { title: "Call Anna" }),
  task("t3", { title: "Old thing", status: "completed", completed: "2026-05-01T08:00:00.000Z" }),
  task("t4", { title: "Sub step", parent: "t1" }),
];
const TASKS_PATH = /^\/lists\/[^/]+\/tasks$/;
const TASK_PATH = /^\/lists\/[^/]+\/tasks\/[^/]+$/;

/** A tiny stateful Tasks service behind the fake: one list `L`, tasks keyed by id. */
function service(google: FakeGoogle, initial: T[] = SEED()) {
  const store = new Map<string, T>(initial.map((t) => [t.id, t]));
  const last = (p: string) => decodeURIComponent(p.split("/").pop() ?? "");
  google
    .on("GET", /^\/users\/@me\/lists\/[^/]+$/, { json: { id: "L", title: "Groceries" } })
    .on("GET", TASKS_PATH, (req) => {
      const showCompleted = req.query.showCompleted === "true";
      return { json: { items: [...store.values()].filter((t) => showCompleted || t.status === "needsAction") } };
    })
    .on("GET", TASK_PATH, (req) => {
      const t = store.get(last(req.path));
      return t ? { json: t } : googleError(404, "notFound", undefined, "Not Found");
    })
    .on("POST", TASKS_PATH, (req) => {
      const t = { id: `n${store.size + 1}`, status: "needsAction", ...(req.body as object) } as T;
      store.set(t.id, t);
      return { json: t };
    })
    .on("PATCH", TASK_PATH, (req) => {
      const t = { ...(store.get(last(req.path)) as T), ...(req.body as object) };
      store.set(t.id, t);
      return { json: t };
    })
    .on("DELETE", TASK_PATH, (req) => {
      store.delete(last(req.path));
      return { status: 204 };
    });
  return store;
}

type HostRuntime = NonNullable<NonNullable<Parameters<typeof makeToolHost>[0]>["runtime"]>;
function host(over: { account?: Record<string, unknown>; tasks?: T[]; runtime?: HostRuntime } = {}) {
  const google = createFakeGoogle();
  const store = service(google, over.tasks);
  const h = makeToolHost({ accounts: [{ ...WORK, ...over.account } as never], google, ...(over.runtime ? { runtime: over.runtime } : {}) });
  return { ...h, store };
}
const err = (p: Promise<unknown>) => p.then(() => undefined, (e: Error & { code?: string; status?: number }) => e);
const confirmText = (c: ReturnType<typeof uiCtx>) => (c.confirm.mock.calls[0] as [string, string]).slice(0, 2).join("\n");

describe("read tools", () => {
  it("#C102 gtasks_list returns only open tasks (incl. an open subtask) with id, title, notes, due, status, parent", async () => {
    const h = host();
    const r = jsonOf<{ tasks: Array<Record<string, unknown>> }>(await h.run("gtasks_list", { account: "work", listId: "L" }));
    expect(r.tasks.map((t) => t.id)).toEqual(["t1", "t2", "t4"]);
    expect(r.tasks[0]).toEqual({ id: "t1", title: "Buy milk", notes: "2 litres", due: "2026-06-01T00:00:00.000Z", status: "needsAction", parent: null });
    expect(r.tasks[2]).toMatchObject({ id: "t4", parent: "t1", status: "needsAction" });
    expect(h.google.calls[0]?.path).toBe("/lists/L/tasks");
  });

  it("#C102 a completed task the service returns anyway is still filtered out of the default view", async () => {
    const h = host();
    h.google.on("GET", TASKS_PATH, { json: { items: SEED() } });
    const r = jsonOf<{ tasks: Array<{ id: string }> }>(await h.run("gtasks_list", { account: "work" }));
    expect(r.tasks.map((t) => t.id)).toEqual(["t1", "t2", "t4"]);
    expect(h.google.calls[0]?.path).toBe("/lists/%40default/tasks");
  });

  it("#C103 include_completed asks for completed + hidden tasks; the completed one has status `completed`", async () => {
    const h = host();
    const r = jsonOf<{ tasks: Array<{ id: string; status: string; completed?: string }> }>(await h.run("gtasks_list", { account: "work", listId: "L", include_completed: true }));
    expect(h.google.calls[0]?.query).toMatchObject({ showCompleted: "true", showHidden: "true" });
    expect(r.tasks.map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(r.tasks.find((t) => t.id === "t3")).toMatchObject({ status: "completed", completed: "2026-05-01T08:00:00.000Z" });
  });

  it("#C103 the default view asks Google for open tasks only", async () => {
    const h = host();
    await h.run("gtasks_list", { account: "work" });
    expect(h.google.calls[0]?.query).toMatchObject({ showCompleted: "false", showHidden: "false" });
  });

  it("#C104 0 lists and a list with 0 tasks give empty arrays", async () => {
    const h = host({ tasks: [] });
    h.google.on("GET", "/users/@me/lists", { json: {} });
    expect(jsonOf(await h.run("gtasks_lists", { account: "work" }))).toEqual({ lists: [] });
    expect(jsonOf(await h.run("gtasks_list", { account: "work", listId: "L" }))).toEqual({ listId: "L", tasks: [] });
  });

  it("#C104/#GC6 lists are 50 per page with nextPageToken; following it loses and duplicates nothing", async () => {
    const h = host();
    const all = Array.from({ length: 120 }, (_, i) => task(`p${i}`));
    h.google.on("GET", TASKS_PATH, (req) => {
      const from = Number(req.query.pageToken ?? 0);
      const size = Number(req.query.maxResults);
      const next = from + size;
      return { json: { items: all.slice(from, next), ...(next < all.length ? { nextPageToken: String(next) } : {}) } };
    });
    const seen: string[] = [];
    let token: string | undefined;
    do {
      const r = jsonOf<{ tasks: Array<{ id: string }>; nextPageToken?: string }>(await h.run("gtasks_list", { account: "work", listId: "L", ...(token ? { pageToken: token } : {}) }));
      seen.push(...r.tasks.map((t) => t.id));
      token = r.nextPageToken;
    } while (token);
    expect(h.google.calls.map((c) => c.query.maxResults)).toEqual(["50", "50", "50"]);
    expect(seen).toEqual(all.map((t) => t.id));
  });

  it("#C104 gtasks_lists returns id + title and a continuation token", async () => {
    const h = host();
    h.google.on("GET", "/users/@me/lists", { json: { items: [{ id: "L", title: "Groceries", etag: "x" }, { id: "M", title: "Work" }], nextPageToken: "NEXT" } });
    expect(jsonOf(await h.run("gtasks_lists", { account: "work" }))).toEqual({
      lists: [{ id: "L", title: "Groceries" }, { id: "M", title: "Work" }],
      nextPageToken: "NEXT",
    });
  });
});

describe("write tools", () => {
  it("#C105 create: dialog shows account, list title, task title and due date; one insert with the due as a date-time", async () => {
    const h = host();
    const ui = uiCtx(true);
    const r = jsonOf<{ created: boolean; id: string }>(await h.run("gtasks_create", { account: "work", listId: "L", title: "Buy bread", due: "2026-07-01", notes: "sourdough" }, ui.ctx));
    const text = confirmText(ui);
    for (const part of ["Account: a@x.com", "List: Groceries [L]", "Title: Buy bread", "Due: 2026-07-01", "Notes: sourdough"]) expect(text).toContain(part);
    expect(h.google.writes()).toHaveLength(1);
    expect(h.google.writes()[0]).toMatchObject({ method: "POST", path: "/lists/L/tasks", body: { title: "Buy bread", due: "2026-07-01T00:00:00.000Z", notes: "sourdough" } });
    expect(r).toMatchObject({ created: true, id: "n5" });
    expect(h.store.get("n5")?.title).toBe("Buy bread");
  });

  it("#C105 update: dialog shows list, task and the changed fields old → new; one PATCH carrying only those", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gtasks_update", { account: "work", listId: "L", taskId: "t1", title: "Buy oat milk", due: "2026-07-02" }, ui.ctx);
    const text = confirmText(ui);
    for (const part of ["Account: a@x.com", "List: Groceries [L]", "Task: Buy milk", "Change title: Buy milk \u2192 Buy oat milk", "Change due: 2026-06-01 \u2192 2026-07-02"]) expect(text).toContain(part);
    expect(text).not.toContain("Change notes");
    expect(h.google.writes()).toHaveLength(1);
    expect(h.google.writes()[0]).toMatchObject({ method: "PATCH", path: "/lists/L/tasks/t1", body: { title: "Buy oat milk", due: "2026-07-02T00:00:00.000Z" } });
    expect(Object.keys(h.google.writes()[0]?.body as object).sort()).toEqual(["due", "title"]);
  });

  it("#C105 complete: dialog shows the task and its due date; PATCH status=completed with a completed timestamp", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gtasks_complete", { account: "work", listId: "L", taskId: "t1" }, ui.ctx);
    const text = confirmText(ui);
    for (const part of ["Account: a@x.com", "List: Groceries [L]", "Task: Buy milk", "Due: 2026-06-01"]) expect(text).toContain(part);
    const w = h.google.writes()[0];
    expect(w).toMatchObject({ method: "PATCH", path: "/lists/L/tasks/t1", body: { status: "completed" } });
    expect((w?.body as { completed?: string } | undefined)?.completed).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(h.store.get("t1")?.status).toBe("completed");
  });

  it("#C105 delete: dialog names the task; one DELETE; the task is gone", async () => {
    const h = host();
    const ui = uiCtx(true);
    expect(jsonOf(await h.run("gtasks_delete", { account: "work", listId: "L", taskId: "t2" }, ui.ctx))).toEqual({ deleted: true, listId: "L", taskId: "t2" });
    expect(confirmText(ui)).toContain("Task: Call Anna");
    expect(h.google.writes().map((w) => `${w.method} ${w.path}`)).toEqual(["DELETE /lists/L/tasks/t2"]);
    expect(h.store.has("t2")).toBe(false);
  });

  const WRITES = ["gtasks_create", "gtasks_update", "gtasks_complete", "gtasks_delete"] as const;
  const ARGS: Record<(typeof WRITES)[number], Record<string, unknown>> = {
    gtasks_create: { title: "New" },
    gtasks_update: { taskId: "t1", title: "Changed" },
    gtasks_complete: { taskId: "t1" },
    gtasks_delete: { taskId: "t1" },
  };

  it("#C106 deny, dismiss and timeout on every write leave the fake store untouched with 0 write requests", async () => {
    for (const tool of WRITES) {
      for (const answer of [false, "throw", "never"] as const) {
        const h = host({ runtime: { confirmTimeoutMs: 20 } });
        const before = JSON.stringify([...h.store]);
        const e = await err(h.run(tool, { account: "work", ...ARGS[tool] }, uiCtx(answer).ctx));
        expect(e?.code, `${tool}/${answer}`).toBe("denied");
        expect(h.google.writes(), `${tool}/${answer}`).toHaveLength(0);
        expect(JSON.stringify([...h.store]), `${tool}/${answer}`).toBe(before);
      }
    }
  });

  it("#C106 with no UI every write is blocked before any HTTP call", async () => {
    for (const tool of WRITES) {
      const h = host();
      expect((await err(h.run(tool, { account: "work", ...ARGS[tool] }, NO_UI)))?.code, tool).toBe("blocked");
      expect(h.google.calls, tool).toHaveLength(0);
    }
  });

  it("#C107 invalid arguments are rejected before the dialog and before any HTTP call", async () => {
    const bad: Array<[(typeof WRITES)[number], Record<string, unknown>]> = [
      ["gtasks_create", { title: "x", due: "2026-02-30" }],
      ["gtasks_create", { title: "x", due: "07/01/2026" }],
      ["gtasks_create", { title: "" }],
      ["gtasks_create", { title: "   " }],
      ["gtasks_create", { title: "x".repeat(1025) }],
      ["gtasks_update", { taskId: "t1", due: "2026-13-01" }],
      ["gtasks_update", { taskId: "t1", title: "  " }],
      ["gtasks_update", { taskId: "../t1" }],
      ["gtasks_delete", {}],
    ];
    for (const [tool, args] of bad) {
      const h = host();
      const ui = uiCtx(true);
      const e = await err(h.run(tool, { account: "work", ...args }, ui.ctx));
      expect(e?.code, `${tool} ${JSON.stringify(args).slice(0, 40)}`).toBe("invalid_params");
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(h.google.calls).toHaveLength(0);
    }
    // the longest title Google accepts goes through
    const h = host();
    await h.run("gtasks_create", { account: "work", title: "y".repeat(1024) }, uiCtx(true).ctx);
    expect(h.google.writes()).toHaveLength(1);
  });

  it("#C107 deleting an already-deleted task is `tasks_error` (404), asked once, never retried, no dialog", async () => {
    const h = host();
    const ui = uiCtx(true);
    const e = await err(h.run("gtasks_delete", { account: "work", listId: "L", taskId: "gone" }, ui.ctx));
    expect(e?.code).toBe("tasks_error");
    expect(e?.status).toBe(404);
    expect(h.google.to("GET", "/lists/L/tasks/gone")).toHaveLength(1);
    expect(h.google.writes()).toHaveLength(0);
    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it("#C108/#GC21 completing an already completed task succeeds as `unchanged` with no dialog and no write", async () => {
    const h = host();
    const ui = uiCtx(true);
    expect(jsonOf(await h.run("gtasks_complete", { account: "work", listId: "L", taskId: "t3" }, ui.ctx))).toEqual({ unchanged: true, taskId: "t3", status: "completed" });
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(h.google.writes()).toHaveLength(0);
  });

  it("#C108/#GC21 an update that changes nothing (no fields, or the same values) is `unchanged`: one read, no dialog, no write", async () => {
    for (const args of [{}, { title: "Buy milk", notes: "2 litres", due: "2026-06-01" }]) {
      const h = host();
      const ui = uiCtx(true);
      expect(jsonOf(await h.run("gtasks_update", { account: "work", listId: "L", taskId: "t1", ...args }, ui.ctx))).toEqual({ unchanged: true, taskId: "t1" });
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(h.google.writes()).toHaveLength(0);
    }
  });
});

describe("scenario-gate decisions (Tasks)", () => {
  it("#GC1 Retry-After: 86400 fails at once with rate_limited (1 attempt); without it a 429 is retried with a bounded backoff", async () => {
    const h = host();
    h.google.on("GET", "/users/@me/lists", { status: 429, headers: { "retry-after": "86400" }, json: {} });
    const e = await err(h.run("gtasks_lists", { account: "work" }));
    expect(e?.code).toBe("rate_limited");
    expect(h.google.calls).toHaveLength(1);

    const waits: number[] = [];
    const g = host({ runtime: { sleep: async (ms: number) => void waits.push(ms), random: () => 0 } });
    g.google.on("GET", "/users/@me/lists", [{ status: 429, json: {} }, { status: 429, json: {} }, { json: { items: [] } }]);
    await g.run("gtasks_lists", { account: "work" });
    expect(g.google.calls).toHaveLength(3);
    expect(waits).toHaveLength(2);
    for (const w of waits) expect(w).toBeLessThanOrEqual(30_000);
  });

  it("#GC2 a Tasks write that gets 503: POST (create) is not retried, DELETE is", async () => {
    const c = host();
    c.google.on("POST", TASKS_PATH, [{ status: 503, json: {} }, { json: { id: "n9", title: "x" } }]);
    expect((await err(c.run("gtasks_create", { account: "work", title: "x" }, uiCtx(true).ctx)))?.status).toBe(503);
    expect(c.google.to("POST")).toHaveLength(1);

    const d = host();
    d.google.on("DELETE", TASK_PATH, [{ status: 503, json: {} }, { status: 204 }]);
    await d.run("gtasks_delete", { account: "work", taskId: "t1" }, uiCtx(true).ctx);
    expect(d.google.to("DELETE")).toHaveLength(2);
  });

  it("#GC3 the confirm text is ≤ 500 chars per field: a long title/notes is clipped", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gtasks_create", { account: "work", title: "T".repeat(1000), notes: "N".repeat(8000) }, ui.ctx);
    const text = confirmText(ui);
    expect(text).not.toContain("T".repeat(300));
    expect(text).not.toContain("N".repeat(501));
    expect(text.length).toBeLessThan(1500);
  });

  it("#GC4 an unclassified 403 is `tasks_error`", async () => {
    const h = host();
    h.google.on("GET", "/users/@me/lists", googleError(403, "forbidden", undefined, "nope"));
    expect((await err(h.run("gtasks_lists", { account: "work" })))?.code).toBe("tasks_error");
  });

  it("#GC5 every write tool with Tasks at `read` is `level_insufficient` naming Settings → Google accounts, before any HTTP call", async () => {
    for (const [tool, args] of [["gtasks_create", { title: "x" }], ["gtasks_update", { taskId: "t1", title: "y" }], ["gtasks_complete", { taskId: "t1" }], ["gtasks_delete", { taskId: "t1" }]] as const) {
      const h = host({ account: { products: { tasks: "read" } } });
      const ui = uiCtx(true);
      const e = await err(h.run(tool, { account: "work", ...args }, ui.ctx));
      expect(e?.code, tool).toBe("level_insufficient");
      expect(e?.message, tool).toContain("Settings \u2192 Google accounts");
      expect(h.google.calls, tool).toHaveLength(0);
      expect(ui.confirm).not.toHaveBeenCalled();
    }
  });

  it("registered tools: reads + four writes, none for another product", async () => {
    const h = host();
    const names = h.tools.map((t) => t.name).filter((n) => n.startsWith("gtasks_")).sort();
    expect(names).toEqual(["gtasks_complete", "gtasks_create", "gtasks_delete", "gtasks_list", "gtasks_lists", "gtasks_update"]);
  });
});
