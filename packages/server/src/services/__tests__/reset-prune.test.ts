/**
 * reset-data, remove-with-purge, prune, owner-scoped stop
 * (add-services-settings-ui). Test-plan: E21–E27, E30, X6–X9.
 */
import fs from "node:fs";
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, DIGEST, FakeDriver, makeManager, ociDef, tmpRoot, writeDefinitions } from "./helpers.js";
import { cleanup, nativeDefOf, nativeHarness, ociHarness } from "./logs-helpers.js";

const roots: string[] = [];
afterEach(() => cleanup(roots));

const volDef = (id = "docling", volumes: Record<string, string> = { "docling-cache": "/cache" }): ServiceDefinition =>
  ociDef({ id, oci: { image: DIGEST, ports: { http: { container: 5001, protocol: "http" } }, volumes } } as never);

const lab = (service: string, owner = "iid-1") => ({ "pi.service": service, "pi.owner": owner });
const ctr = (Id: string, service = "docling", owner = "iid-1", running = false) => ({ Id, Config: { Labels: lab(service, owner) }, State: { Running: running } });

/** A scripted docker world: owned containers, per-volume users, per-command failures. */
function world(o: {
  owned?: ReturnType<typeof ctr>[];
  users?: Record<string, ReturnType<typeof ctr>[]>;
  fail?: (args: string[]) => boolean;
  volumeStillThere?: Set<string>;
}) {
  const all = new Map<string, ReturnType<typeof ctr>>();
  for (const c of [...(o.owned ?? []), ...Object.values(o.users ?? {}).flat()]) all.set(c.Id, c);
  const ps = (args: string[]) => {
    const vol = args.find((a) => a.startsWith("volume="))?.slice("volume=".length);
    const rows = vol ? (o.users?.[vol] ?? []) : (o.owned ?? []);
    return { stdout: rows.map((c) => c.Id).join("\n") };
  };
  const volumeInspect = (name: string) => (o.volumeStillThere?.has(name) ? { stdout: "[{}]" } : { code: 1, stderr: `Error: No such volume: ${name}` });
  return (args: string[]) => {
    if (o.fail?.(args)) return { code: 1, stderr: "boom" };
    if (args[0] === "ps") return ps(args);
    if (args[0] === "inspect") return { stdout: JSON.stringify(args.slice(1).flatMap((id) => (all.get(id) ? [all.get(id)] : []))) };
    if (args[0] === "volume" && args[1] === "inspect") return volumeInspect(args[2]);
    return undefined;
  };
}
const called = (h: { runner: { calls: Array<{ args: string[] }> } }, ...prefix: string[]) =>
  h.runner.calls.filter((c) => prefix.every((p, i) => c.args[i] === p));

describe("E21 — reset-data state gate", () => {
  async function gated(prepare: (d: FakeDriver) => void, act?: (m: ReturnType<typeof makeManager>["manager"]) => Promise<unknown>) {
    const root = tmpRoot("svc-gate-");
    roots.push(root);
    writeDefinitions(root, [volDef()]);
    const d = new FakeDriver("oci:docker");
    prepare(d);
    const reset = vi.fn(async () => ({ kind: "ok" as const, volumes: [{ name: "docling-cache", removed: true }] }));
    (d as unknown as { resetData: typeof reset }).resetData = reset;
    const h = makeManager(root, { drivers: { "oci:docker": d } });
    await act?.(h.manager);
    return { h, reset };
  }
  const ensure = (m: { ensure: (id: string) => Promise<unknown> }) => m.ensure("docling");

  it("stopped proceeds", async () => {
    const { h, reset } = await gated(() => {});
    await expect(h.manager.resetData("docling")).resolves.toEqual({ volumes: [{ name: "docling-cache", removed: true }] });
    expect(reset).toHaveBeenCalledOnce();
  });

  it("healthy is refused with no runtime call", async () => {
    const { h, reset } = await gated(() => {}, ensure);
    await expect(h.manager.resetData("docling")).rejects.toMatchObject({ status: 409, code: "not-resettable" });
    expect(reset).not.toHaveBeenCalled();
  });

  it.each([
    ["runtime-unreachable", true],
    ["adoption-uncertain", false],
    ["duplicate-instances", false],
    ["owner-conflict", false],
  ] as const)("unavailable (%s) → proceeds: %s", async (reason, proceeds) => {
    const { h, reset } = await gated((d) => {
      if (reason === "runtime-unreachable") d.presenceResult = { ok: false, reason: "runtime-unreachable" };
      else d.adoptResult = { kind: "unavailable", reason, hint: "x" };
    }, ensure);
    if (proceeds) await expect(h.manager.resetData("docling")).resolves.toBeDefined();
    else {
      await expect(h.manager.resetData("docling")).rejects.toMatchObject({ status: 409, code: "not-resettable" });
      expect(reset).not.toHaveBeenCalled();
    }
  });

  it("stopped but an owned container runs → not-resettable (real driver)", async () => {
    const h = ociHarness(volDef(), world({ owned: [ctr("c1", "docling", "iid-1", true)] }));
    roots.push(...h.roots);
    await expect(h.manager.resetData("docling")).rejects.toMatchObject({ status: 409, code: "not-resettable" });
    expect(called(h, "rm")).toHaveLength(0);
    expect(called(h, "volume")).toHaveLength(0);
  });
});

describe("E22 — shared volume guard", () => {
  const def = volDef("docling", { "docling-cache": "/c", "ext-db": "/e", "free-vol": "/f" });
  const other = volDef("other", { "docling-cache": "/x" });

  it("reports shared / in-use / removed; volume rm never gets -f; owned container removed plainly", async () => {
    const h = ociHarness(
      def,
      world({ owned: [ctr("own1")], users: { "ext-db": [ctr("foreign1", "elsewhere", "someone")] } }),
      [other],
    );
    roots.push(...h.roots);
    const r = await h.manager.resetData("docling");
    expect(r.volumes).toEqual([
      { name: "docling-cache", removed: false, reason: "volume-shared" },
      { name: "ext-db", removed: false, reason: "volume-in-use" },
      { name: "free-vol", removed: true },
    ]);
    const vrm = called(h, "volume", "rm");
    expect(vrm.map((c) => c.args)).toEqual([["volume", "rm", "free-vol"]]);
    expect(h.runner.calls.some((c) => c.args.includes("-f") && c.args[0] === "volume")).toBe(false);
    expect(called(h, "rm").map((c) => c.args)).toEqual([["rm", "own1"]]);
    expect(h.logs.some((l) => l.includes("docling data reset (3 volumes)"))).toBe(true);
    // definition untouched
    expect((await h.manager.list()).services.map((s) => s.id)).toContain("docling");
  });

  it("E24 remove with purgeData uses the same guard and lists every volume", async () => {
    const h = ociHarness(def, world({ users: { "ext-db": [ctr("foreign1", "elsewhere", "someone")] } }), [other]);
    roots.push(...h.roots);
    const r = await h.manager.remove("docling", { purgeData: true });
    expect(r.ok).toBe(true);
    expect(r.volumes).toEqual([
      { name: "docling-cache", removed: false, reason: "volume-shared" },
      { name: "ext-db", removed: false, reason: "volume-in-use" },
      { name: "free-vol", removed: true },
    ]);
    expect((await h.manager.list()).services.map((s) => s.id)).not.toContain("docling");
    // without purge no volume is touched and no list is returned
    const h2 = ociHarness(def, world({}));
    roots.push(...h2.roots);
    const r2 = await h2.manager.remove("docling");
    expect(r2.volumes).toBeUndefined();
    expect(called(h2, "volume")).toHaveLength(0);
  });
});

describe("E23 — no volumes", () => {
  it("a stopped native service → 409 no-data (route)", async () => {
    const h = nativeHarness(nativeDefOf());
    roots.push(...h.roots);
    const app = await buildApp(h.manager);
    const res = await app.inject({ method: "POST", url: "/api/services/docling/reset-data", remoteAddress: "127.0.0.1" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "no-data" });
    await app.close();
  });
});

describe("X6–X8 — reset-data runtime failures", () => {
  it("X6 ps fails → runtime-unreachable, nothing removed", async () => {
    const h = ociHarness(volDef(), world({ fail: (a) => a[0] === "ps" }));
    roots.push(...h.roots);
    await expect(h.manager.resetData("docling")).rejects.toMatchObject({ status: 409, code: "runtime-unreachable" });
    expect(called(h, "rm")).toHaveLength(0);
    expect(called(h, "volume")).toHaveLength(0);
  });

  it("X6 inspect fails (propagates as null, not 'no containers') → runtime-unreachable", async () => {
    const h = ociHarness(volDef(), (a) => (a[0] === "ps" ? { stdout: "c1" } : a[0] === "inspect" ? { code: 1, stdout: "", stderr: "Cannot connect" } : undefined));
    roots.push(...h.roots);
    await expect(h.manager.resetData("docling")).rejects.toMatchObject({ status: 409, code: "runtime-unreachable" });
    expect(called(h, "rm")).toHaveLength(0);
    expect(called(h, "volume")).toHaveLength(0);
  });

  it("X7 plain rm of the owned container fails → not-resettable, no volume rm", async () => {
    const h = ociHarness(volDef(), world({ owned: [ctr("own1")], fail: (a) => a[0] === "rm" }));
    roots.push(...h.roots);
    await expect(h.manager.resetData("docling")).rejects.toMatchObject({ status: 409, code: "not-resettable" });
    expect(called(h, "volume")).toHaveLength(0);
  });

  it("X8 volume rm refused (came into use) → kept volume-in-use; the others are processed", async () => {
    const def = volDef("docling", { "busy-vol": "/b", "ok-vol": "/o" });
    const h = ociHarness(def, world({ fail: (a) => a[0] === "volume" && a[1] === "rm" && a[2] === "busy-vol", volumeStillThere: new Set(["busy-vol"]) }));
    roots.push(...h.roots);
    expect((await h.manager.resetData("docling")).volumes).toEqual([
      { name: "busy-vol", removed: false, reason: "volume-in-use" },
      { name: "ok-vol", removed: true },
    ]);
  });
});

describe("volume inspect failure is not read as absence", () => {
  it("a runtime error after a refused `volume rm` keeps the volume (fail closed)", async () => {
    const h = ociHarness(volDef("docling", { "flaky-vol": "/f" }), (args) => {
      if (args[0] === "volume" && args[1] === "rm") return { code: 1, stderr: "volume is in use" };
      if (args[0] === "volume" && args[1] === "inspect") return { code: 1, stderr: "Cannot connect to the Docker daemon" };
      return world({})(args);
    });
    roots.push(...h.roots);
    expect((await h.manager.resetData("docling")).volumes).toEqual([{ name: "flaky-vol", removed: false, reason: "volume-in-use" }]);
  });
});

describe("prune", () => {
  const ESRCH = Object.assign(new Error("no such process"), { code: "ESRCH" });
  const EPERM = Object.assign(new Error("not permitted"), { code: "EPERM" });
  /** pid → liveness of its GROUP (kill(-pid, 0)). */
  const kill = (pid: number) => {
    const group = Math.abs(pid);
    if (group === 111) throw ESRCH;
    if (group === 222) return;
    if (group === 333) throw EPERM;
    throw ESRCH;
  };
  const instanceFile = (h: { paths: { instanceFile(id: string): string } }, id: string, pid: number) => {
    fs.mkdirSync(h.paths.instanceFile(id).replace(/\/instance\.json$/, ""), { recursive: true });
    fs.writeFileSync(h.paths.instanceFile(id), JSON.stringify({ pid }));
  };
  const orphans = [ctr("orphan-stopped", "ghost", "iid-1", false), ctr("orphan-running", "runner", "iid-1", true), ctr("foreign", "x", "someone-else", false)];
  const dockerOnly = (n: string) => (n === "podman" ? null : `/usr/bin/${n}`);
  const mk = () => {
    const h = ociHarness(
      volDef(),
      (args) => {
        if (args[0] === "ps") return { stdout: orphans.map((c) => c.Id).join("\n") };
        if (args[0] === "inspect") return { stdout: JSON.stringify(orphans.filter((c) => args.includes(c.Id))) };
        return undefined;
      },
      [],
      { resolveBinary: dockerOnly, kill },
    );
    roots.push(...h.roots);
    fs.mkdirSync(h.paths.runRoot, { recursive: true });
    for (const d of [".docker-config", "docling", "Bad_Name"]) fs.mkdirSync(`${h.paths.runRoot}/${d}`, { recursive: true });
    instanceFile(h, "tika", 111);
    instanceFile(h, "old", 222);
    instanceFile(h, "perm", 333);
    return h;
  };

  it("E25 candidates: dead orphans only; EPERM and live groups protect; shared config / defined / foreign never listed; nothing removed", async () => {
    const h = mk();
    const r = await h.manager.prune({ dryRun: true });
    expect(r).toEqual({
      dryRun: true,
      candidates: [
        { kind: "container", id: "ghost", containerId: "orphan-stopped", runtime: "docker" },
        { kind: "run-dir", id: "tika" },
      ],
      skipped: [{ id: "runner", kind: "container", reason: "running" }],
      unreachableRuntimes: [],
    });
    expect(called(h, "rm")).toHaveLength(0);
    for (const d of [".docker-config", "docling", "Bad_Name", "tika", "old", "perm"]) expect(fs.existsSync(`${h.paths.runRoot}/${d}`)).toBe(true);
  });

  it("E26 confirm: only previewed ids; an id defined since the preview is skipped, an unknown id is ignored", async () => {
    const h = mk();
    fs.mkdirSync(`${h.paths.runRoot}/zed`, { recursive: true });
    const preview = await h.manager.prune({ dryRun: true });
    expect((preview as { candidates: Array<{ id: string }> }).candidates.map((c) => c.id)).toEqual(expect.arrayContaining(["tika", "zed"]));
    // `tika` is added between the preview and the confirm
    writeDefinitions(h.root, [volDef(), { ...volDef("tika"), oci: { image: DIGEST, ports: { http: { container: 1, protocol: "http" } } } } as ServiceDefinition]);
    const r = await h.manager.prune({ dryRun: false, ids: ["tika", "zed", "extra"] });
    expect(r).toMatchObject({ dryRun: false, removed: ["zed"] });
    expect((r as { skipped: Array<{ id: string }> }).skipped.map((s) => s.id)).toEqual(["tika"]);
    expect(fs.existsSync(`${h.paths.runRoot}/tika`)).toBe(true);
    expect(fs.existsSync(`${h.paths.runRoot}/zed`)).toBe(false);
    expect(fs.existsSync(`${h.paths.runRoot}/extra`)).toBe(false);
  });

  it("confirm removes a previewed orphan container with a plain rm and its run dir", async () => {
    const h = mk();
    const r = await h.manager.prune({ dryRun: false, ids: ["ghost", "tika"] });
    expect(r).toMatchObject({ removed: expect.arrayContaining(["ghost", "tika"]) });
    expect(called(h, "rm").map((c) => c.args)).toEqual([["rm", "orphan-stopped"]]);
    expect(fs.existsSync(`${h.paths.runRoot}/tika`)).toBe(false);
  });

  it("B1 a previewed orphan container does not take a live run dir with it", async () => {
    const h = mk();
    instanceFile(h, "ghost", 222); // the container's service also has a run dir whose process GROUP is alive
    const preview = (await h.manager.prune({ dryRun: true })) as { candidates: Array<{ kind: string; id: string }> };
    expect(preview.candidates.filter((c) => c.id === "ghost")).toEqual([{ kind: "container", id: "ghost", containerId: "orphan-stopped", runtime: "docker" }]);
    const r = await h.manager.prune({ dryRun: false, ids: ["ghost"] });
    expect(r).toMatchObject({ removed: ["ghost"], skipped: [] });
    expect(called(h, "rm").map((c) => c.args)).toEqual([["rm", "orphan-stopped"]]);
    expect(fs.existsSync(h.paths.instanceFile("ghost"))).toBe(true); // the live run dir survives
  });

  it("B1 a previewed container-only id that gets defined is reported as a container, and no empty run dir is left behind", async () => {
    const h = mk();
    await h.manager.prune({ dryRun: true });
    writeDefinitions(h.root, [volDef(), volDef("ghost")]);
    const r = (await h.manager.prune({ dryRun: false, ids: ["ghost"] })) as { skipped: Array<{ id: string; kind: string }> };
    expect(r.skipped).toEqual([{ id: "ghost", kind: "container", reason: expect.any(String) }]);
    expect(called(h, "rm")).toHaveLength(0);
    // a container-only confirm that DOES remove leaves no stray lock-created directory
    writeDefinitions(h.root, [volDef()]);
    await h.manager.prune({ dryRun: false, ids: ["ghost"] });
    expect(fs.existsSync(h.paths.runDir("ghost"))).toBe(false);
  });

  it("E27 services.json missing → 409 definitions-missing; corrupt → 409; nothing removed", async () => {
    const h = mk();
    fs.rmSync(`${h.root}/services.json`);
    await expect(h.manager.prune({ dryRun: false, ids: ["ghost"] })).rejects.toMatchObject({ status: 409, code: "definitions-missing" });
    fs.writeFileSync(`${h.root}/services.json`, "{ not json");
    await expect(h.manager.prune({ dryRun: true })).rejects.toMatchObject({ status: 409, code: "definitions-corrupt" });
    expect(called(h, "rm")).toHaveLength(0);
  });

  it("X9 an unreachable runtime is listed; the reachable one's orphans still are", async () => {
    const h = ociHarness(
      volDef(),
      (args, file) => {
        if (file.endsWith("podman") && args[0] === "ps") return { code: 125, stderr: "cannot connect" };
        if (args[0] === "ps") return { stdout: "orphan-stopped" };
        if (args[0] === "inspect") return { stdout: JSON.stringify([orphans[0]]) };
        return undefined;
      },
      [],
      { kill },
    );
    roots.push(...h.roots);
    const r = (await h.manager.prune({ dryRun: true })) as { candidates: Array<{ id: string }>; unreachableRuntimes: string[] };
    expect(r.unreachableRuntimes).toEqual(["podman"]);
    expect(r.candidates.map((c) => c.id)).toContain("ghost");
  });
});

describe("E30 — owner-scoped stop", () => {
  it("without a recorded instance only containers of THIS installation are stopped", async () => {
    const own = ctr("own1", "docling", "iid-1", true);
    const foreign = ctr("foreign1", "docling", "someone-else", true);
    const h = ociHarness(volDef(), (args) => {
      if (args[0] === "ps") return { stdout: "own1\nforeign1" };
      if (args[0] === "inspect") return { stdout: JSON.stringify([own, foreign].filter((c) => args.includes(c.Id)).map((c) => ({ ...c, State: { Running: args[0] === "inspect" && false } }))) };
      return undefined;
    });
    roots.push(...h.roots);
    await h.manager.boot(); // foreign owner present → owner-conflict (sticky); stop is the way out
    await h.manager.stop("docling");
    const stop = called(h, "stop")[0];
    expect(stop?.args).toEqual(["stop", "-t", "15", "own1"]);
  });
});
