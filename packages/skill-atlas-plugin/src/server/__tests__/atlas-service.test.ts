/**
 * Skill-atlas server: membership, fingerprint memo, push path, route.
 * test-plan #E2 #E16–#E22 #F5 #X2–#X6. Harness: real tmp fs + a fake host
 * `getPiResources`. Exemplar: packages/kb-plugin/src/server/__tests__/kb-routes.test.ts.
 * See change: add-skill-atlas-screen.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PiResource, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillAtlasChangedMessage } from "../../shared/types.js";
import { createAtlasService, DEBOUNCE_MS, MEMO_CAPACITY, nodeFs } from "../atlas-service.js";
import { GRAPH_ROUTE, mountAtlasRoutes } from "../routes.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-"));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const emptyScope = () => ({ extensions: [], skills: [] as PiResource[], prompts: [], agents: [], themes: [] });

/** Write `<root>/<id>/SKILL.md` and return its resource row. */
function skill(root: string, id: string, body = "", extra: Partial<PiResource> = {}): PiResource {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  fs.writeFileSync(filePath, `---\nname: ${id}\ndescription: ${id} desc\n---\n${body}`);
  return { name: id, description: `${id} desc`, filePath, type: "skill", enabled: true, ...extra };
}

function host(result: () => PiResourcesResult) {
  const calls: Array<{ cwd?: string; fresh?: boolean }> = [];
  const getPiResources = vi.fn(async (cwd?: string, opts?: { fresh?: boolean }) => {
    calls.push({ cwd, fresh: opts?.fresh });
    return result();
  });
  return { getPiResources, calls };
}

function fixture() {
  const local = emptyScope();
  const global = emptyScope();
  const res: PiResourcesResult = { local, global, packages: [] };
  return { res, local, global };
}

describe("membership (#E2, #E17)", () => {
  it("project = local + global + packages; global excludes project and local-scope packages; disabled excluded", async () => {
    const { res, local, global } = fixture();
    local.skills.push(skill(tmp, "proj-skill", "uses glob-skill"), skill(tmp, "off-skill", "", { enabled: false }));
    global.skills.push(skill(tmp, "glob-skill", "names off-skill"));
    res.packages.push(
      { name: "@x/gpkg", source: "npm:@x/gpkg", scope: "global", resources: { ...emptyScope(), skills: [skill(tmp, "gpkg-a"), skill(tmp, "gpkg-b")] } },
      { name: "@x/lpkg", source: "npm:@x/lpkg", scope: "local", resources: { ...emptyScope(), skills: [skill(tmp, "lpkg-a")] } },
    );
    const svc = createAtlasService({ ...host(() => res), broadcast: () => {} });
    const project = await svc.getGraph("project", tmp);
    expect(project.skills.map((s) => [s.id, s.origin])).toEqual([
      ["glob-skill", "global"],
      ["gpkg-a", "package"],
      ["gpkg-b", "package"],
      ["lpkg-a", "package"],
      ["proj-skill", "project"],
    ]);
    expect(project.links.some((l) => l.source === "off-skill" || l.target === "off-skill")).toBe(false);
    const global2 = await svc.getGraph("global");
    expect(global2.skills.map((s) => s.id)).toEqual(["glob-skill", "gpkg-a", "gpkg-b"]);
  });
});

describe("route (#E16, #E18)", () => {
  async function app(service: ReturnType<typeof createAtlasService> | null) {
    const f = Fastify();
    await mountAtlasRoutes(f, service);
    await f.ready();
    return f;
  }
  it("400 without cwd / with relative cwd; global ignores cwd; 501 without host seam", async () => {
    const { res, global } = fixture();
    global.skills.push(skill(tmp, "glob-skill"));
    const f = await app(createAtlasService({ ...host(() => res), broadcast: () => {} }));
    expect((await f.inject({ url: `${GRAPH_ROUTE}?scope=project` })).statusCode).toBe(400);
    expect((await f.inject({ url: `${GRAPH_ROUTE}?scope=project&cwd=rel/path` })).statusCode).toBe(400);
    const g = await f.inject({ url: `${GRAPH_ROUTE}?scope=global&cwd=/x` });
    expect(g.statusCode).toBe(200);
    expect(g.json().data.cwd).toBeUndefined();
    await f.close();
    const bare = await app(null);
    expect((await bare.inject({ url: `${GRAPH_ROUTE}?scope=global` })).statusCode).toBe(501);
    await bare.close();
  });
  it("never returns SKILL.md bodies (#E18)", async () => {
    const { res, local } = fixture();
    local.skills.push(skill(tmp, "proj-skill", "BODY-ONLY-7f3a"));
    const f = await app(createAtlasService({ ...host(() => res), broadcast: () => {} }));
    const r = await f.inject({ url: `${GRAPH_ROUTE}?scope=project&cwd=${encodeURIComponent(tmp)}` });
    expect(r.body).not.toContain("BODY-ONLY-7f3a");
    expect(r.body).not.toContain('"body"');
    await f.close();
  });
});

describe("body limit (#E19)", () => {
  it("mentions beyond 256 KiB are ignored and a warning names the skill", async () => {
    const { res, local } = fixture();
    local.skills.push(skill(tmp, "review-code"), skill(tmp, "ship-it"));
    const big = skill(tmp, "big-skill");
    const head = "x".repeat(10 * 1024) + " review-code ";
    fs.writeFileSync(big.filePath, head + "y".repeat(280 * 1024 - head.length) + " ship-it " + "z".repeat(20 * 1024));
    local.skills.push(big);
    const g = await createAtlasService({ ...host(() => res), broadcast: () => {} }).getGraph("project", tmp);
    const out = g.links.filter((l) => l.source === "big-skill").map((l) => l.target);
    expect(out).toEqual(["review-code"]);
    expect(g.warnings.some((w) => w.includes("big-skill"))).toBe(true);
  });
});

describe("fingerprint (#E20, #F5)", () => {
  it("unchanged → memo without body reads; description / ctime / body changes move it", async () => {
    const { res, local } = fixture();
    const x = skill(tmp, "aaaa-x");
    local.skills.push(x, skill(tmp, "review-code"));
    const readHead = vi.fn(nodeFs.readHead);
    const svc = createAtlasService({ ...host(() => res), broadcast: () => {}, fs: { stat: nodeFs.stat, readHead } });
    const first = await svc.getGraph("project", tmp);
    readHead.mockClear();
    const again = await svc.getGraph("project", tmp);
    expect(again.fingerprint).toBe(first.fingerprint);
    expect(readHead).not.toHaveBeenCalled();

    x.description = "changed";
    const desc = await svc.getGraph("project", tmp);
    expect(desc.fingerprint).not.toBe(first.fingerprint);

    // ctime-only: same bytes, restore mtime
    const st = fs.statSync(x.filePath);
    await new Promise((r) => setTimeout(r, 15));
    fs.chmodSync(x.filePath, 0o600);
    fs.utimesSync(x.filePath, st.atime, st.mtime);
    const ctime = await svc.getGraph("project", tmp);
    expect(ctime.fingerprint).not.toBe(desc.fingerprint);

    // body edit with no watcher event (#F5)
    fs.appendFileSync(x.filePath, "\nnow run review-code\n");
    const edited = await svc.getGraph("project", tmp);
    expect(edited.links.map((l) => `${l.source}>${l.target}`)).toContain("aaaa-x>review-code");
    expect(edited.fingerprint).not.toBe(ctime.fingerprint);
  });
});

describe("memo key + affected keys (#E21, #E22)", () => {
  it("trailing separator is one entry; LRU evicts beyond capacity", async () => {
    const { res } = fixture();
    const svc = createAtlasService({ ...host(() => res), broadcast: () => {} });
    await svc.getGraph("project", "/repo");
    await svc.getGraph("project", "/repo/");
    expect(svc.memoKeys()).toEqual(["project:/repo"]);
    for (let i = 0; i < MEMO_CAPACITY; i++) await svc.getGraph("project", `/r${i}`);
    expect(svc.memoKeys()).toHaveLength(MEMO_CAPACITY);
    expect(svc.memoKeys()).not.toContain("project:/repo");
  });

  it("invalidation picks segment-related project keys plus global, never siblings", async () => {
    vi.useFakeTimers();
    const { res } = fixture();
    const h = host(() => res);
    const svc = createAtlasService({ ...h, broadcast: () => {} });
    for (const c of ["/repo", "/repo-2"]) await svc.getGraph("project", c);
    await svc.getGraph("global");
    const freshCwds = async (cwd: string | undefined) => {
      h.calls.length = 0;
      svc.onInvalidated(cwd);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
      await svc.whenIdle();
      return h.calls.filter((c) => c.fresh).map((c) => c.cwd ?? "GLOBAL").sort();
    };
    expect(await freshCwds("/repo/.worktrees/x")).toEqual(["/repo", "GLOBAL"]);
    expect(await freshCwds("/repo")).toEqual(["/repo", "GLOBAL"]);
    expect(await freshCwds(undefined)).toEqual(["/repo", "/repo-2", "GLOBAL"]);
  });
});

describe("push path (#X2–#X5)", () => {
  async function rig() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { res, local } = fixture();
    const x = skill(tmp, "aaaa-x");
    local.skills.push(x, skill(tmp, "review-code"));
    const h = host(() => res);
    const sent: SkillAtlasChangedMessage[] = [];
    const svc = createAtlasService({ ...h, broadcast: (m) => sent.push(m) });
    await svc.getGraph("project", tmp);
    const settle = async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
      await svc.whenIdle();
    };
    return { svc, sent, x, h, settle, res, local };
  }

  it("X2: a GET that rebuilt first does not swallow the notification", async () => {
    const r = await rig();
    fs.appendFileSync(r.x.filePath, "\nreview-code\n");
    await r.svc.getGraph("project", tmp);
    r.svc.onInvalidated(tmp);
    await r.settle();
    expect(r.sent).toEqual([{ type: "skill_atlas_changed", scope: "project", cwd: tmp }]);
  });

  it("X3: touch/chmod without content change is silent", async () => {
    const r = await rig();
    fs.chmodSync(r.x.filePath, 0o600);
    fs.utimesSync(r.x.filePath, new Date(), new Date());
    r.svc.onInvalidated(tmp);
    await r.settle();
    expect(r.sent).toEqual([]);
  });

  it("X4: the first reload after a GET with no change is silent", async () => {
    const r = await rig();
    r.svc.onInvalidated(tmp);
    await r.settle();
    expect(r.sent).toEqual([]);
  });

  it("X5: a burst coalesces into one fresh rescan and at most one broadcast", async () => {
    const r = await rig();
    r.local.skills.push(skill(tmp, "added-skill", "review-code"));
    r.h.calls.length = 0;
    for (let i = 0; i < 10; i++) {
      r.svc.onInvalidated(tmp);
      await vi.advanceTimersByTimeAsync(40);
    }
    await r.settle();
    expect(r.h.calls.filter((c) => c.fresh)).toHaveLength(1);
    expect(r.sent).toHaveLength(1);
  });
});

describe("file errors (#X6)", () => {
  it("vanished file excluded with warning; unreadable file kept without body links, with warning", async () => {
    const { res, local } = fixture();
    const gone = skill(tmp, "gone-skill");
    const locked = skill(tmp, "locked-skill", "review-code");
    local.skills.push(gone, locked, skill(tmp, "review-code"));
    fs.rmSync(gone.filePath);
    const svc = createAtlasService({
      ...host(() => res),
      broadcast: () => {},
      fs: {
        stat: nodeFs.stat,
        readHead: async (p, n) => {
          if (p === locked.filePath) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
          return nodeFs.readHead(p, n);
        },
      },
    });
    const g = await svc.getGraph("project", tmp);
    expect(g.skills.map((s) => s.id)).toEqual(["locked-skill", "review-code"]);
    expect(g.links).toEqual([]);
    expect(g.warnings.some((w) => w.includes("gone-skill"))).toBe(true);
    expect(g.warnings.some((w) => w.includes("locked-skill"))).toBe(true);
  });

  it("degraded scan is surfaced (#X9 server half)", async () => {
    const { res } = fixture();
    res.degraded = true;
    const g = await createAtlasService({ ...host(() => res), broadcast: () => {} }).getGraph("global");
    expect(g.degraded).toBe(true);
  });
});
