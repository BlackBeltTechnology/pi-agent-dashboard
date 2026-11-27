/**
 * Sidecar store (tasks 9.17–9.21; test-plan #X18 #R14 #D6 #D7 #D11): fail-closed writes, one file shared by
 * independent writers, atomic replace + schema handling, pruning only after hydration, rollback/format
 * stability.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { capturingLogger } from "../../../__tests__/harness/store-env.js";
import { createSidecarStore, nodeSidecarFs, SIDECAR_SCHEMA_VERSION, type SidecarFs, type SidecarInit } from "../sidecar.js";
import { APPLY, createOpenspecEnv, tmp } from "./env.js";

const init = (teamId = "t_1"): SidecarInit => ({ teamId, kind: "group", goal: "g", repo: "/repo" });
const store = (dir: string, fsx?: SidecarFs) => createSidecarStore({ dir, logger: capturingLogger().logger, ...(fsx ? { fs: fsx } : {}) });
const read = (dir: string, id = "t_1"): Record<string, any> => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8"));
/** An fs whose write path can be made to fail. */
function faulty(fail: { writeFile?: Error; rename?: Error; mid?: boolean } = {}): { fs: SidecarFs; fail: typeof fail } {
  const f = { fs: undefined as unknown as SidecarFs, fail };
  f.fs = {
    ...nodeSidecarFs,
    writeFile(file, data) {
      if (f.fail.mid) {
        fs.writeFileSync(file, data.slice(0, 10)); // killed mid temp-write
        throw new Error("killed");
      }
      if (f.fail.writeFile) throw f.fail.writeFile;
      nodeSidecarFs.writeFile(file, data);
    },
    rename(from, to) {
      if (f.fail.rename) throw f.fail.rename;
      nodeSidecarFs.rename(from, to);
    },
  };
  return f;
}

describe("write faults fail closed (9.17 #X18)", () => {
  it.each(["ENOSPC", "EACCES", "EROFS"])("%s: the update is refused sidecar_write_failed and neither memory nor disk advanced", (code) => {
    const dir = tmp();
    const f = faulty();
    const s = store(dir, f.fs);
    expect(s.create(init()).ok).toBe(true);
    expect(s.update("t_1", (d) => void (d.locks.harness = { holder: "a", grantedAt: 1, queue: [] })).ok).toBe(true);
    f.fail.writeFile = Object.assign(new Error(code), { code });
    const res = s.update("t_1", (d) => void (d.locks.harness = { holder: "b", grantedAt: 2, queue: ["c"] }));
    expect(res).toMatchObject({ ok: false, error: "sidecar_write_failed" });
    expect(s.get("t_1")?.locks.harness?.holder).toBe("a");
    expect(read(dir).locks.harness.holder).toBe("a");
    f.fail.writeFile = undefined;
    expect(s.update("t_1", (d) => void (d.locks.harness = { holder: "b", grantedAt: 2, queue: [] })).ok).toBe(true);
  });

  it("a failed rename leaves the old file and no temp file behind", () => {
    const dir = tmp();
    const f = faulty();
    const s = store(dir, f.fs);
    s.create(init());
    f.fail.rename = new Error("EIO");
    expect(s.update("t_1", (d) => void (d.synced["1"] = true))).toMatchObject({ ok: false, error: "sidecar_write_failed" });
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(read(dir).synced).toEqual({});
  });

  it("a failed create leaves no record", () => {
    const f = faulty({ writeFile: new Error("ENOSPC") });
    const s = store(tmp(), f.fs);
    expect(s.create(init())).toMatchObject({ ok: false, error: "sidecar_write_failed" });
    expect(s.has("t_1")).toBe(false);
  });

  it("regression: create on an existing record returns it unchanged — the mutator does not run and nothing is written", () => {
    const s = store(tmp());
    s.create(init(), (d) => void (d.seeded = true));
    const writes = s.writes;
    const mutate = vi.fn((d: { seedIncomplete?: { code: string } }) => void (d.seedIncomplete = { code: "plan_missing" }));
    const res = s.create(init(), mutate);
    expect(res.ok).toBe(true);
    expect(mutate).not.toHaveBeenCalled();
    expect(s.get("t_1")).toMatchObject({ seeded: true });
    expect(s.get("t_1")?.seedIncomplete).toBeUndefined();
    expect(s.writes).toBe(writes);
  });

  it("a team without a record answers sidecar_missing and is never created implicitly by update", () => {
    const s = store(tmp());
    expect(s.update("t_9", () => {})).toMatchObject({ ok: false, error: "sidecar_missing" });
    expect(s.has("t_9")).toBe(false);
  });

  it("an unsafe team id never reaches the file system", () => {
    const dir = tmp();
    const s = store(dir);
    expect(s.create({ ...init(), teamId: "../evil" })).toMatchObject({ ok: false });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("one file shared by seed, launcher, sync and lock (9.18 #R14)", () => {
  it("100 interleaved writes per module: the file holds every module's last write, and is valid JSON after every write", async () => {
    const dir = tmp();
    const s = store(dir);
    s.create(init());
    const snapshots: number[] = [];
    const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
    const writers: Array<(i: number) => void> = [
      (i) => s.update("t_1", (d) => void (d.refs[`r${i % 5}`] = i)),
      (i) => s.update("t_1", (d) => void (d.launched[`${i % 5}`] = { state: "launched", member: `m${i}`, change: "c", at: i })),
      (i) => s.update("t_1", (d) => void (d.synced[`${i % 5}`] = i % 2 === 0)),
      (i) => s.update("t_1", (d) => void (d.locks.harness = { holder: `h${i}`, grantedAt: i, queue: [`q${i}`] })),
    ];
    await Promise.all(
      writers.map(async (w) => {
        for (let i = 0; i < 100; i++) {
          w(i);
          snapshots.push(Object.keys(read(dir)).length); // throws when the file is ever partial
          if (i % 7 === 0) await tick();
        }
      }),
    );
    const f = read(dir);
    expect(f.refs.r4).toBe(99);
    expect(f.launched["4"].member).toBe("m99");
    expect(f.synced["3"]).toBe(true); // i = 98
    expect(f.synced["4"]).toBe(false); // i = 99
    expect(f.locks.harness).toMatchObject({ holder: "h99", queue: ["q99"] });
    expect(snapshots).toHaveLength(400);
  });

  it("the mutator edits a clone: a throwing mutator changes nothing", () => {
    const s = store(tmp());
    s.create(init());
    expect(() => s.update("t_1", (d) => { d.seeded = true; throw new Error("x"); })).toThrow();
    expect(s.get("t_1")?.seeded).toBeUndefined();
  });

  it("noticeOnce is true exactly once and persisted", () => {
    const dir = tmp();
    const s = store(dir);
    s.create(init());
    expect(s.noticeOnce("t_1", "k")).toBe(true);
    expect(s.noticeOnce("t_1", "k")).toBe(false);
    expect(read(dir).noticed).toEqual({ k: true });
  });
});

describe("atomic replace and schema handling (9.19 #D6)", () => {
  it("killed mid temp-write: the previous valid file stays, the .tmp is ignored at load and cleaned on the next write", () => {
    const dir = tmp();
    const f = faulty();
    const s = store(dir, f.fs);
    s.create(init());
    s.update("t_1", (d) => void (d.seeded = true));
    f.fail.mid = true;
    expect(s.update("t_1", (d) => void (d.synced["1"] = true)).ok).toBe(false);
    fs.writeFileSync(path.join(dir, "t_1.json.99999.tmp"), "{ truncated");
    const again = store(dir);
    expect(again.load()).toEqual({ loaded: ["t_1"], corrupt: [], future: [] });
    expect(again.get("t_1")).toMatchObject({ seeded: true, synced: {} });
  });

  it("truncated JSON → corrupt; schemaVersion 2 → future; neither is loaded", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "t_a.json"), '{"schemaVersion":1,"teamId":"t_a"');
    fs.writeFileSync(path.join(dir, "t_b.json"), JSON.stringify({ schemaVersion: 2, teamId: "t_b", kind: "group", goal: "g", repo: "/r" }));
    fs.writeFileSync(path.join(dir, "t_c.json"), JSON.stringify({ schemaVersion: 1, teamId: "other", kind: "group", goal: "g", repo: "/r" }));
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    const s = store(dir);
    expect(s.load()).toEqual({ loaded: [], corrupt: ["t_a", "t_c"], future: ["t_b"] });
    expect(s.ids()).toEqual([]);
  });

  it.each([
    ["group", "missing", undefined],
    ["apply", "missing", undefined],
    ["group", "corrupt", '{"schemaVersion":1,'],
    ["group", "future", JSON.stringify({ schemaVersion: 9, teamId: "T", kind: "group", goal: "g", repo: "/r" })],
  ] as const)("a seeded %s team whose sidecar is %s is marked sidecar_missing: machinery off, ONE waking notice, never rebuilt from empty state", async (kind, reason, body) => {
    const e = await createOpenspecEnv();
    const t = e.team(kind, "x", { seeded: true });
    if (body !== undefined) fs.mkdirSync(path.join(e.dataDir, "openspec"), { recursive: true }), fs.writeFileSync(path.join(e.dataDir, "openspec", `${t.id}.json`), body.replace("\"T\"", JSON.stringify(t.id)));
    e.rt.persistence.flushSync();
    await new Promise((r) => setTimeout(r, 60));
    let cur = await createOpenspecEnv({ dataDir: e.dataDir });
    for (let round = 0; round < 3; round++) {
      const tr = cur.rt.store.get(t.id) as typeof t;
      expect(cur.api.teamState(tr), `restart ${round}`).toBe("sidecar_missing");
      expect(cur.api.sidecar.get(t.id)).toMatchObject({ lost: { reason }, launched: {}, locks: {}, refs: {}, noticed: { sidecar_missing: true } });
      expect(cur.rt.store.mailLog(t.id).filter((m) => m.kind === "notice" && m.wake)).toHaveLength(1);
      cur.rt.persistence.flushSync();
      await new Promise((r) => setTimeout(r, 60));
      cur = await createOpenspecEnv({ dataDir: e.dataDir });
    }
    if (reason !== "missing") expect(fs.existsSync(path.join(e.dataDir, "openspec", `${t.id}.json.${reason}`))).toBe(true);
  });

  it("a profile team that never seeded and restarts without its preflight snapshot is seed_incomplete plan_missing: nothing is read or created blind", async () => {
    const e = await createOpenspecEnv();
    const t = e.team("apply", "x");
    expect(e.api.teamState(t)).toBe("pending");
    e.rt.persistence.flushSync();
    const e2 = await createOpenspecEnv({ dataDir: e.dataDir });
    await e2.flush();
    const t2 = e2.rt.store.get(t.id) as typeof t;
    expect(e2.api.teamState(t2)).toBe("seed_incomplete");
    expect(e2.api.sidecar.get(t.id)).toMatchObject({ seedIncomplete: { code: "plan_missing" } });
    expect(t2.tasks).toEqual([]);
    expect(e2.rt.store.mailLog(t.id).filter((m) => m.kind === "notice" && m.wake)).toHaveLength(1);
  });
});

describe("prune (9.20 #D7)", () => {
  it("never before hydration; afterwards closed and unknown teams only", () => {
    const dir = tmp();
    const s = store(dir);
    for (const id of ["t_live", "t_closed", "t_unknown"]) s.create(init(id));
    const live = (id: string): boolean => id === "t_live";
    expect(s.prune(live, false)).toBe(0);
    expect(s.ids().sort()).toEqual(["t_closed", "t_live", "t_unknown"]);
    expect(s.prune(live, true)).toBe(2);
    expect(s.ids()).toEqual(["t_live"]);
    expect(fs.readdirSync(dir)).toEqual(["t_live.json"]);
  });

  it("also removes an unreadable file of a team that no longer exists, but keeps one of a live team", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "t_gone.json"), "garbage");
    fs.writeFileSync(path.join(dir, "t_live.json"), "garbage");
    const s = store(dir);
    s.load();
    s.prune((id) => id === "t_live", true);
    expect(fs.readdirSync(dir)).toEqual(["t_live.json"]);
  });

  it("a runtime start prunes sidecars of unknown and closed teams but keeps the live team's, in either order", async () => {
    const e = await createOpenspecEnv();
    const live = e.team("apply", "x", { seeded: true });
    e.api.sidecar.create({ teamId: live.id, kind: "apply", goal: "x", repo: e.cwd }, (d) => void (d.seeded = true));
    e.api.sidecar.create({ teamId: "t_unknown", kind: "apply", goal: "x", repo: e.cwd });
    const closed = e.team("apply", "y", { seeded: true });
    e.api.sidecar.create({ teamId: closed.id, kind: "apply", goal: "y", repo: e.cwd });
    e.rt.ops.teamDelete(closed, { actor: "server", force: true });
    e.rt.persistence.flushSync();
    await new Promise((r) => setTimeout(r, 60));
    const e2 = await createOpenspecEnv({ dataDir: e.dataDir });
    expect(e2.api.sidecar.ids()).toEqual([live.id]);
  });

  it("an un-hydrated start keeps every sidecar (prune deferred)", async () => {
    const e = await createOpenspecEnv();
    e.api.sidecar.create({ teamId: "t_unknown", kind: "apply", goal: "x", repo: e.cwd });
    const e2 = await createOpenspecEnv({ dataDir: e.dataDir, openspec: { storeHydrated: false } });
    expect(e2.api.sidecar.ids()).toEqual(["t_unknown"]);
  });
});

describe("rollback and compatibility (9.21 #D11)", () => {
  const golden = JSON.stringify({
    schemaVersion: 1,
    teamId: "t_gold",
    kind: "group",
    goal: "agent-teams",
    repo: "/repo",
    seeding: { startedAt: 1700000000000 },
    seeded: true,
    refs: { "1": "add-a", "2": "add-b" },
    launched: { "1": { state: "launched", member: "os-add-a", change: "add-a", at: 1700000001000 }, "2": { state: "launch_failed", member: "os-add-b", change: "add-b", code: "git_failed", at: 1700000002000, noticed: true } },
    synced: { "1": true },
    locks: { harness: { holder: "os-add-a", grantedAt: 1700000003000, grantMailed: true, queue: ["os-add-b"] } },
    names: { "os-add-a": "add-a" },
    noticed: { "launch_failed:2": true },
    ext: {},
  });

  it("the golden schemaVersion:1 fixture still loads field by field (format stability)", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "t_gold.json"), golden);
    const s = store(dir);
    expect(s.load().loaded).toEqual(["t_gold"]);
    expect(s.get("t_gold")).toEqual(JSON.parse(golden));
    expect(SIDECAR_SCHEMA_VERSION).toBe(1);
  });

  it("a bundled-template team keeps running as a plain team with the module disabled, and resumes when re-enabled", async () => {
    const e = await createOpenspecEnv();
    const t = e.team("apply", "x", { seeded: true });
    e.api.sidecar.create({ teamId: t.id, kind: "apply", goal: "x", repo: e.cwd }, (d) => void ((d.seeded = true), (d.refs["1"] = "x")));
    e.rt.persistence.flushSync();
    await new Promise((r) => setTimeout(r, 60));
    const before = fs.readFileSync(path.join(e.dataDir, "openspec", `${t.id}.json`), "utf8");

    const off = await createOpenspecEnv({ dataDir: e.dataDir, runtime: { openspec: false } });
    expect(off.rt.openspec).toBeUndefined();
    const tOff = off.rt.store.get(t.id);
    expect(tOff?.status).toBe("active");
    expect(fs.readFileSync(path.join(e.dataDir, "openspec", `${t.id}.json`), "utf8")).toBe(before); // sidecar ignored, untouched
    expect(await off.call("lead", "TeamStatus", {}).catch(() => ({}))).toBeDefined();

    const on = await createOpenspecEnv({ dataDir: e.dataDir });
    expect(on.api.teamState(on.rt.store.get(t.id) as typeof t)).toBe("active");
    expect(on.api.sidecar.get(t.id)?.refs).toEqual({ "1": "x" });
    void APPLY;
  });
});
