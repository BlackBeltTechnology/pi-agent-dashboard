import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { type Concrete, createRoleBindings, type Projector } from "../role-bindings.js";
import { hashRoles, startRoleWatcher } from "../role-watcher.js";
import { mountRolesRoutes } from "../roles-routes.js";

const A: Concrete = { provider: "anthropic", id: "claude-haiku-4-5" };
const B: Concrete = { provider: "openai", id: "gpt-5-mini" };
const C: Concrete = { provider: "x", id: "edited" };

function setup(initialRoles: Record<string, string> = { fast: "anthropic/claude-haiku-4-5" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rb-"));
  const storePath = path.join(dir, "role-bindings.json");
  const roles = { ...initialRoles };
  const logs: string[] = [];
  const logger = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
  const make = () => createRoleBindings({ storePath, readRoleConfig: () => ({ roles }), logger });
  return { dir, storePath, roles, logs, make };
}

function fakeProjector(owner: string, initial: Record<string, Concrete> = {}) {
  const target: Record<string, Concrete> = { ...initial };
  const write = vi.fn(async (f: string, r: Concrete) => {
    target[f] = r;
  });
  const p: Projector = {
    owner,
    acceptsField: (f) => /^(observerModel|reflectorModel|slot\d+)$/.test(f),
    read: (f) => target[f],
    write,
  };
  return { p, target, write };
}

describe("service surface", () => {
  it("version 1; E8 rejects undeclared field, store unchanged, 0 writes", async () => {
    const s = setup();
    const e = s.make();
    const { p, write } = fakeProjector("blackhole");
    e.service.registerProjector(p);
    await e.idle();
    expect(e.service.version).toBe(1);
    expect(() => e.service.replaceBindings("blackhole", [{ field: "notAField", ref: "@fast", projected: A }])).toThrow();
    expect(e.service.getBindings("blackhole")).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  it("replaceBindings replaces owner set and forces ok", async () => {
    const s = setup();
    const e = s.make();
    const { p } = fakeProjector("blackhole");
    e.service.registerProjector(p);
    e.service.replaceBindings("blackhole", [{ field: "observerModel", ref: "@fast", projected: A }]);
    e.service.replaceBindings("blackhole", [{ field: "reflectorModel", ref: "@fast", projected: A }]);
    expect(e.service.getBindings("blackhole").map((b) => [b.field, b.status])).toEqual([["reflectorModel", "ok"]]);
  });

  it("registerUsage dispose removes reporter (E36)", () => {
    const e = setup().make();
    const reporter = vi.fn(() => [{ label: "g", ref: "@fast" }]);
    const dispose = e.service.registerUsage("grammar", reporter);
    expect(e.service.getUsedBy().fast).toHaveLength(1);
    dispose();
    reporter.mockClear();
    expect(e.service.getUsedBy().fast).toBeUndefined();
    expect(reporter).not.toHaveBeenCalled();
  });

  it("E35 used-by lists bindings with status and Kind A usages", async () => {
    const e = setup().make();
    const { p } = fakeProjector("blackhole");
    e.service.registerProjector(p);
    e.service.replaceBindings("blackhole", [{ field: "observerModel", ref: "@fast", projected: A }]);
    e.service.registerUsage("grammar", () => [{ label: "grammar model", ref: "@fast" }]);
    e.service.registerUsage("automation", () => [
      { label: "global:a", ref: "@fast" },
      { label: "folder:b", ref: "@fast" },
      { label: "direct", ref: "anthropic/x" },
    ]);
    const used = e.service.getUsedBy().fast!;
    expect(used).toHaveLength(4);
    expect(used.find((u) => u.kind === "binding")).toMatchObject({ owner: "blackhole", status: "ok" });
  });
});

describe("projection engine", () => {
  async function bound(initial = A) {
    const s = setup();
    const e = s.make();
    const pr = fakeProjector("blackhole", { observerModel: initial });
    e.service.registerProjector(pr.p);
    await e.idle();
    e.service.replaceBindings("blackhole", [{ field: "observerModel", ref: "@fast", projected: initial }]);
    return { s, e, ...pr };
  }

  it("re-projects on role change", async () => {
    const { s, e, target, write } = await bound();
    s.roles.fast = "openai/gpt-5-mini";
    const sum = await e.runPass("change");
    expect(target.observerModel).toEqual(B);
    expect(write).toHaveBeenCalledTimes(1);
    expect(sum.written).toBe(1);
  });

  it("E10 unchanged resolution → 0 writes, log unchanged:1", async () => {
    const { e, write, s } = await bound();
    const sum = await e.runPass("change");
    expect(write).not.toHaveBeenCalled();
    expect(sum.unchanged).toBe(1);
    expect(s.logs.at(-1)).toContain("unchanged=1");
  });

  it("E11 unassigned role → dangling, target kept, 0 writes", async () => {
    const { s, e, target, write } = await bound();
    delete s.roles.fast;
    await e.runPass("change");
    expect(e.service.getBindings("blackhole")[0]!.status).toBe("dangling");
    expect(target.observerModel).toEqual(A);
    expect(write).not.toHaveBeenCalled();
  });

  it("dangling recovers when role is reassigned", async () => {
    const { s, e, target } = await bound();
    delete s.roles.fast;
    await e.runPass("change");
    s.roles.fast = "openai/gpt-5-mini";
    await e.runPass("change");
    expect(target.observerModel).toEqual(B);
    expect(e.service.getBindings("blackhole")[0]!.status).toBe("ok");
  });

  it("E12 external edit → detached, no write; reattach writes and resets ok", async () => {
    const { s, e, target, write } = await bound();
    target.observerModel = C;
    s.roles.fast = "openai/gpt-5-mini";
    await e.runPass("change");
    expect(e.service.getBindings("blackhole")[0]!.status).toBe("detached");
    expect(write).not.toHaveBeenCalled();
    await e.service.reattach("blackhole", "observerModel");
    expect(write).toHaveBeenCalledTimes(1);
    expect(target.observerModel).toEqual(B);
    expect(e.service.getBindings("blackhole")[0]!.status).toBe("ok");
  });

  it("E13 unbinding keeps the concrete value", async () => {
    const { e, target } = await bound();
    e.service.replaceBindings("blackhole", []);
    expect(e.service.getBindings("blackhole")).toEqual([]);
    expect(target.observerModel).toEqual(A);
  });

  it("level change alone re-projects", async () => {
    const { s, e, target } = await bound();
    s.roles.fast = "anthropic/claude-haiku-4-5:low";
    await e.runPass("change");
    expect(target.observerModel).toEqual({ ...A, level: "low" });
  });

  it("X2 failing projector does not block another owner; retried next pass", async () => {
    const s = setup();
    const e = s.make();
    const bad = fakeProjector("bad", { slot1: A });
    const good = fakeProjector("good", { slot1: A });
    bad.write.mockRejectedValueOnce(new Error("disk full"));
    e.service.registerProjector(bad.p);
    e.service.registerProjector(good.p);
    await e.idle();
    e.service.replaceBindings("bad", [{ field: "slot1", ref: "@fast", projected: A }]);
    e.service.replaceBindings("good", [{ field: "slot1", ref: "@fast", projected: A }]);
    s.roles.fast = "openai/gpt-5-mini";
    const sum = await e.runPass("change");
    expect(good.target.slot1).toEqual(B);
    expect(sum.failed).toBe(1);
    expect(s.logs.some((l) => l.includes("owner=bad") && l.includes("field=slot1"))).toBe(true);
    await e.runPass("change");
    expect(bad.target.slot1).toEqual(B);
  });

  it("X3 absent owner → skipped, not failed, kept", async () => {
    const s = setup();
    // seed a store written by a previous run
    const first = s.make();
    const pr = fakeProjector("blackhole", { observerModel: A });
    first.service.registerProjector(pr.p);
    first.service.replaceBindings("blackhole", [{ field: "observerModel", ref: "@fast", projected: A }]);
    const before = fs.readFileSync(s.storePath, "utf-8");
    const e = s.make();
    const sum = await e.runPass("boot");
    expect(sum).toMatchObject({ skipped: 1, failed: 0 });
    expect(fs.readFileSync(s.storePath, "utf-8")).toBe(before);
  });

  it("X4 projector registered after boot gets a targeted pass", async () => {
    const s = setup();
    const first = s.make();
    const seed = fakeProjector("blackhole", { observerModel: A });
    first.service.registerProjector(seed.p);
    first.service.replaceBindings("blackhole", [{ field: "observerModel", ref: "@fast", projected: A }]);
    s.roles.fast = "openai/gpt-5-mini";
    const e = s.make();
    await e.runPass("boot"); // owner absent
    const late = fakeProjector("blackhole", { observerModel: A });
    e.service.registerProjector(late.p);
    await e.idle();
    expect(late.target.observerModel).toEqual(B);
  });

  it("X5 change while down → boot pass projects", async () => {
    const s = setup();
    const first = s.make();
    const pr = fakeProjector("blackhole", { observerModel: A });
    first.service.registerProjector(pr.p);
    first.service.replaceBindings("blackhole", [{ field: "observerModel", ref: "@fast", projected: A }]);
    s.roles.fast = "openai/gpt-5-mini";
    const e = s.make();
    e.service.registerProjector(pr.p);
    await e.idle();
    await e.runPass("boot");
    expect(pr.target.observerModel).toEqual(B);
  });

  it("X11 returning service finds drifted file → detached, file untouched", async () => {
    const s = setup();
    const first = s.make();
    const seed = fakeProjector("blackhole", { observerModel: A });
    first.service.registerProjector(seed.p);
    first.service.replaceBindings("blackhole", [{ field: "observerModel", ref: "@fast", projected: A }]);
    const drifted = fakeProjector("blackhole", { observerModel: C });
    const e = s.make();
    e.service.registerProjector(drifted.p);
    await e.idle();
    expect(e.service.getBindings("blackhole")[0]!.status).toBe("detached");
    expect(drifted.target.observerModel).toEqual(C);
  });

  it("X7 pass waits for owner lock; just-saved binding is not detached", async () => {
    const s = setup();
    const e = s.make();
    const pr = fakeProjector("blackhole", { observerModel: A });
    e.service.registerProjector(pr.p);
    await e.idle();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const save = e.service.withOwnerLock("blackhole", async () => {
      await gate; // slow save
      pr.target.observerModel = B;
      e.service.replaceBindings("blackhole", [{ field: "observerModel", ref: "@fast", projected: B }]);
    });
    s.roles.fast = "openai/gpt-5-mini";
    const pass = e.runPass("change", "blackhole");
    release();
    await save;
    await pass;
    expect(e.service.getBindings("blackhole")[0]!.status).toBe("ok");
  });

  it("P2 1000 bindings across 3 projectors converge", async () => {
    const s = setup();
    const e = s.make();
    const prs = ["a", "b", "c"].map((o) => fakeProjector(o));
    const proj = prs.map((x, i) => {
      const owner = ["a", "b", "c"][i]!;
      return { ...x, owner };
    });
    for (const x of proj) {
      x.p.acceptsField = () => true;
      e.service.registerProjector(x.p);
    }
    await e.idle();
    let n = 0;
    for (const x of proj) {
      const entries = [];
      for (let i = 0; i < 333 + (x.owner === "a" ? 1 : 0); i++) {
        x.target[`f${i}`] = A;
        entries.push({ field: `f${i}`, ref: "@fast", projected: A });
        n++;
      }
      e.service.replaceBindings(x.owner, entries);
    }
    expect(n).toBe(1000);
    s.roles.fast = "openai/gpt-5-mini";
    const t0 = Date.now();
    await e.runPass("change");
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(proj.every((x) => Object.values(x.target).every((v) => v.id === "gpt-5-mini"))).toBe(true);
  });
});

describe("store", () => {
  it("X1 corrupt store → 0 bindings, one log line naming the file, no writes", async () => {
    const s = setup();
    fs.writeFileSync(s.storePath, "{not json");
    const e = s.make();
    const pr = fakeProjector("blackhole", { observerModel: A });
    e.service.registerProjector(pr.p);
    await e.idle();
    expect(e.service.getBindings("blackhole")).toEqual([]);
    expect(s.logs.filter((l) => l.includes(s.storePath))).toHaveLength(1);
    expect(pr.write).not.toHaveBeenCalled();
  });

  it("round-trips across instances; missing file ok", () => {
    const s = setup();
    const e1 = s.make();
    const pr = fakeProjector("blackhole");
    e1.service.registerProjector(pr.p);
    e1.service.replaceBindings("blackhole", [{ field: "observerModel", ref: "@fast:low", projected: A }]);
    expect(s.make().service.getBindings("blackhole")).toMatchObject([{ field: "observerModel", ref: "@fast:low", status: "ok" }]);
  });
});

describe("watcher", () => {
  function wsetup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-"));
    const file = path.join(dir, "providers.json");
    fs.writeFileSync(file, JSON.stringify({ roles: { fast: "a/A" } }));
    const read = () => {
      try {
        return JSON.parse(fs.readFileSync(file, "utf-8")).roles as Record<string, string>;
      } catch {
        return {};
      }
    };
    return { dir, file, read };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("hashRoles ignores key order", () => {
    expect(hashRoles({ a: "1", b: "2" })).toBe(hashRoles({ b: "2", a: "1" }));
  });

  it("P3/E-burst: 5 writes within 100ms → one pass; tmp+rename triggers (X6); semantic no-op none", async () => {
    const w = wsetup();
    const onChange = vi.fn();
    const watcher = startRoleWatcher({ dir: w.dir, debounceMs: 60, readRoles: w.read, onChange });
    for (let i = 0; i < 5; i++) {
      const tmp = path.join(w.dir, `.providers.json.${i}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify({ roles: { fast: `a/B${i}` } }));
      fs.renameSync(tmp, w.file);
    }
    await sleep(500);
    expect(onChange).toHaveBeenCalledTimes(1);
    // semantically-equal rewrite (key order / whitespace)
    fs.writeFileSync(w.file, JSON.stringify({ x: 1, roles: { fast: "a/B4" } }, null, 4));
    await sleep(400);
    expect(onChange).toHaveBeenCalledTimes(1);
    watcher.close();
  });

  it("P1 latency: tmp+rename write reaches onChange well under 5s", async () => {
    const w = wsetup();
    let t1 = 0;
    const done = new Promise<void>((r) => {
      const watcher = startRoleWatcher({
        dir: w.dir,
        readRoles: w.read,
        onChange: () => {
          t1 = Date.now();
          watcher.close();
          r();
        },
      });
    });
    const t0 = Date.now();
    fs.writeFileSync(`${w.file}.tmp`, JSON.stringify({ roles: { fast: "a/Z" } }));
    fs.renameSync(`${w.file}.tmp`, w.file);
    await done;
    expect(t1 - t0).toBeLessThan(5000);
  });
});


describe("used-by route (7.1)", () => {
  it("returns blackhole binding status + grammar usage for @fast", async () => {
    const e = setup().make();
    const { p } = fakeProjector("blackhole", { observerModel: A });
    e.service.registerProjector(p);
    await e.idle();
    e.service.replaceBindings("blackhole", [{ field: "observerModel", ref: "@fast", projected: A }]);
    e.service.registerUsage("grammar", () => [{ label: "grammar model", ref: "@fast" }]);
    const app = Fastify();
    mountRolesRoutes(app, { getUsedBy: () => e.service.getUsedBy() });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/roles/used-by" });
    expect(res.statusCode).toBe(200);
    const fast = res.json().usedBy.fast;
    expect(fast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "binding", owner: "blackhole", label: "observerModel", status: "ok" }),
        expect.objectContaining({ kind: "usage", owner: "grammar", label: "grammar model" }),
      ]),
    );
    await app.close();
  });

  it("is an empty map without the service", async () => {
    const app = Fastify();
    mountRolesRoutes(app, {});
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/api/roles/used-by" })).json()).toEqual({ usedBy: {} });
    await app.close();
  });
});
