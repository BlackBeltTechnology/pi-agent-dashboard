/**
 * Writing actions (stubbed CLI, temp-dir fs): #E16 re-stamp, #E18 write guard,
 * #E19 name validation, #E21 pin, #E23 disable, #E24 remove, adopt/update states.
 * See change: add-pi-spec-driven-schema.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkActionState,
  resolveDeps,
  runWorkflowSchemaAction,
  type WorkflowSchemaAction,
  type WorkflowSchemaRequest,
  type WorkflowSchemaResult,
} from "../openspec/workflow-schema.js";
import {
  makeFakeCli,
  mkRepo,
  mkTmp,
  snapshotTree,
  stubDeps,
  write,
  writeSchemaDir,
  type FakeCli,
  type FakeCliOptions,
} from "./helpers/workflow-schema-fixtures.js";

const roots: string[] = [];
const track = (r: string): string => (roots.push(r), r);
const repo = (...a: Parameters<typeof mkRepo>): string => track(mkRepo(...a));
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const run = (
  root: string,
  req: Omit<WorkflowSchemaRequest, "cwd">,
  fake: FakeCli = makeFakeCli(),
  over: Parameters<typeof stubDeps>[1] = {},
): Promise<WorkflowSchemaResult> => runWorkflowSchemaAction({ cwd: root, ...req }, stubDeps(fake, over));
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
const schemaDirNames = (root: string): string[] => fs.readdirSync(path.join(root, "openspec", "schemas"));

/** Enabled project: config names pi-spec-driven, schema stamped with `prev`. */
function enabledRepo(prev = "spec-driven"): string {
  const root = repo({ config: "schema: pi-spec-driven\n" });
  writeSchemaDir(root, { base: "1.11.0", patch: 1, previousDefault: prev });
  return root;
}

describe("#E18 every writing action verifies the root first", () => {
  const ACTIONS: Array<Omit<WorkflowSchemaRequest, "cwd">> = [
    { action: "enable" },
    { action: "disable" },
    { action: "update", previousDefault: "spec-driven" },
    { action: "adopt", confirm: true, previousDefault: "spec-driven" },
    { action: "pin", pinTo: "spec-driven" },
    { action: "remove", confirm: true },
  ];
  type Row = { name: string; setup: (root: string, outside: string) => FakeCliOptions };
  const ROWS: Row[] = [
    { name: "root.source declared", setup: () => ({ statusRoot: { source: "declared" } }) },
    { name: "root.source store", setup: () => ({ statusRoot: { source: "store" } }) },
    { name: "root.path ≠ cwd", setup: (_r, outside) => ({ statusRoot: { path: outside } }) },
    { name: "no root in status", setup: () => ({ statusRoot: null }) },
    {
      name: "symlinked openspec/",
      setup: (root, outside) => {
        fs.rmSync(path.join(root, "openspec"), { recursive: true });
        fs.mkdirSync(path.join(outside, "openspec", "changes"), { recursive: true });
        fs.symlinkSync(path.join(outside, "openspec"), path.join(root, "openspec"));
        return {};
      },
    },
    {
      name: "symlinked changes/",
      setup: (root, outside) => {
        fs.rmSync(path.join(root, "openspec", "changes"), { recursive: true });
        fs.symlinkSync(outside, path.join(root, "openspec", "changes"));
        return {};
      },
    },
    {
      name: "symlinked schemas/",
      setup: (root, outside) => {
        fs.symlinkSync(outside, path.join(root, "openspec", "schemas"));
        return {};
      },
    },
    {
      name: "symlinked config file",
      setup: (root, outside) => {
        fs.writeFileSync(path.join(outside, "cfg.yaml"), "schema: pi-spec-driven\n");
        fs.rmSync(path.join(root, "openspec", "config.yaml"));
        fs.symlinkSync(path.join(outside, "cfg.yaml"), path.join(root, "openspec", "config.yaml"));
        return {};
      },
    },
  ];

  for (const row of ROWS) {
    it.each(ACTIONS)(`${row.name}: $action is refused with zero writes`, async (req) => {
      const root = repo({ config: "schema: pi-spec-driven\n" });
      const outside = track(mkTmp("wfs-outside"));
      write(root, "openspec/changes/foo/proposal.md", "x");
      const fakeOpts = row.setup(root, outside);
      const beforeRoot = snapshotTree(root);
      const beforeOutside = snapshotTree(outside);
      const res = await run(root, req, makeFakeCli(fakeOpts));
      expect(res.ok).toBe(false);
      expect(res.written).toEqual([]);
      expect(snapshotTree(root)).toEqual(beforeRoot);
      expect(snapshotTree(outside)).toEqual(beforeOutside);
    });
  }
});

describe("#E19 schema names are validated before use", () => {
  it("rejects an injected pinTo", async () => {
    const root = enabledRepo();
    write(root, "openspec/changes/foo/proposal.md", "x");
    const before = snapshotTree(root);
    const res = await run(root, { action: "pin", pinTo: "spec-driven\nretire_capabilities: true" });
    expect(res.ok).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("rejects previousDefault pi-spec-driven on update", async () => {
    const root = enabledRepo();
    const before = snapshotTree(root);
    const res = await run(root, { action: "update", previousDefault: "pi-spec-driven" });
    expect(res.ok).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("refuses enable and pin for a schema that exists only at user level", async () => {
    const userOnly = makeFakeCli({ resolvable: ["spec-driven", "pi-spec-driven"] }); // team-flow unresolvable
    const a = repo({ config: "schema: team-flow\n" });
    write(a, "openspec/changes/x/proposal.md", "x");
    const beforeA = snapshotTree(a);
    const enable = await run(a, { action: "enable" }, userOnly);
    expect(enable.ok).toBe(false);
    expect(snapshotTree(a)).toEqual(beforeA);

    const b = enabledRepo("team-flow");
    write(b, "openspec/changes/x/proposal.md", "x");
    const beforeB = snapshotTree(b);
    const pin = await run(b, { action: "pin", pinTo: "team-flow" }, userOnly);
    expect(pin.ok).toBe(false);
    expect(snapshotTree(b)).toEqual(beforeB);
  });

  it("treats a stamp previousDefault naming a deleted schema as unusable: disable refuses, pin refuses", async () => {
    const gone = makeFakeCli({ resolvable: ["spec-driven", "pi-spec-driven"] });
    const root = enabledRepo("gone-flow");
    write(root, "openspec/changes/x/proposal.md", "x");
    const before = snapshotTree(root);
    expect((await run(root, { action: "disable" }, gone)).ok).toBe(false);
    expect((await run(root, { action: "pin", pinTo: "gone-flow" }, gone)).ok).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("resolves names with an empty XDG_DATA_HOME (user-level schemas never count)", async () => {
    const fake = makeFakeCli();
    await run(repo({ config: "schema: team-flow\n" }), { action: "enable" }, fake, {
      resolveSchema: undefined,
    });
    // the default resolver ran `which team-flow` with an xdg override
    const which = fake.calls.filter((c) => c.call.op === "which" && c.call.name === "team-flow");
    expect(which.length).toBeGreaterThan(0);
    for (const w of which) expect(w.ctx.xdgDataHome).toBeTruthy();
  });
});

describe("pin", () => {
  it("#E21 leaves a pinned change alone, creates a missing one, never overwrites a racing writer", async () => {
    const root = enabledRepo("spec-driven");
    write(root, "openspec/changes/foo/.openspec.yaml", "schema: spec-driven\n");
    write(root, "openspec/changes/bar/proposal.md", "x");
    write(root, "openspec/changes/baz/proposal.md", "x");
    const realFs = resolveDeps().fs;
    const res = await run(root, { action: "pin", pinTo: "spec-driven", changes: ["foo", "bar", "baz"] }, makeFakeCli(), {
      fs: {
        ...realFs,
        writeExclusive: async (file, data) => {
          if (file.includes(`${path.sep}baz${path.sep}`)) fs.writeFileSync(file, "schema: racer\n");
          return realFs.writeExclusive(file, data);
        },
      },
    });
    expect(res.ok).toBe(true);
    expect(res.written).toEqual(["openspec/changes/bar/.openspec.yaml"]);
    expect(res.skipped?.sort()).toEqual(["baz", "foo"]);
    expect(read(root, "openspec/changes/foo/.openspec.yaml")).toBe("schema: spec-driven\n");
    expect(read(root, "openspec/changes/bar/.openspec.yaml")).toBe("schema: spec-driven\n");
    expect(read(root, "openspec/changes/baz/.openspec.yaml")).toBe("schema: racer\n");
  });

  it("refuses unknown change names and a disabled project", async () => {
    const root = enabledRepo();
    write(root, "openspec/changes/foo/proposal.md", "x");
    const unknown = await run(root, { action: "pin", pinTo: "spec-driven", changes: ["../etc"] });
    expect(unknown.ok).toBe(false);
    const off = repo();
    writeSchemaDir(off, { base: "1.11.0", patch: 1 });
    expect((await run(off, { action: "pin", pinTo: "spec-driven" })).ok).toBe(false);
  });

  it("pins every file-less change when `changes` is omitted", async () => {
    const root = enabledRepo();
    write(root, "openspec/changes/bar/proposal.md", "x");
    const res = await run(root, { action: "pin", pinTo: "pi-spec-driven" });
    expect(res.ok).toBe(true);
    expect(read(root, "openspec/changes/bar/.openspec.yaml")).toBe("schema: pi-spec-driven\n");
  });
});

describe("#E16 update re-stamps the previous default", () => {
  it("enable refused naming Update → update re-stamps → enable succeeds", async () => {
    const root = repo({ config: "schema: team-flow\n" });
    writeSchemaDir(root, { base: "1.11.0", patch: 1, previousDefault: "spec-driven" });
    const fake = makeFakeCli();
    const first = await run(root, { action: "enable" }, fake);
    expect(first.ok).toBe(false);
    expect(first.error).toMatch(/Update/);
    expect(first.error).toContain("team-flow");

    const upd = await run(root, { action: "update", previousDefault: "team-flow" }, fake);
    expect(upd.ok).toBe(true);
    expect(read(root, "openspec/schemas/pi-spec-driven/schema.yaml")).toMatch(/previousDefault: team-flow/);

    const second = await run(root, { action: "enable" }, fake);
    expect(second.ok).toBe(true);
    expect(read(root, "openspec/config.yaml")).toContain("schema: pi-spec-driven");
  });

  it("update keeps the existing stamp previousDefault when the request gives none", async () => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    writeSchemaDir(root, { base: "1.11.0", patch: 0, previousDefault: "team-flow" });
    const res = await run(root, { action: "update" });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("current");
    expect(read(root, "openspec/schemas/pi-spec-driven/schema.yaml")).toMatch(/previousDefault: team-flow/);
  });

  it("update is refused on a conflict and the schema is unchanged", async () => {
    const root = repo();
    writeSchemaDir(root, { base: "1.12.0", patch: 0 });
    const before = snapshotTree(root);
    const res = await run(root, { action: "update" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(snapshotTree(root)).toEqual(before);
  });
});

describe("disable", () => {
  it("#E23 restores the stamp's previous default and keeps the schema dir", async () => {
    const root = enabledRepo("spec-driven");
    write(root, "openspec/changes/foo/.openspec.yaml", "schema: pi-spec-driven\n");
    const res = await run(root, { action: "disable" });
    expect(res.ok).toBe(true);
    expect(read(root, "openspec/config.yaml")).toContain("schema: spec-driven");
    expect(schemaDirNames(root)).toEqual(["pi-spec-driven"]);
    expect(res.configured).toBe("spec-driven");
  });

  it("#E23 is a no-op when the user already switched the default", async () => {
    const root = repo({ config: "schema: team-flow\n" });
    writeSchemaDir(root, { base: "1.11.0", patch: 1 });
    const before = snapshotTree(root);
    const res = await run(root, { action: "disable" });
    expect(res.ok).toBe(true);
    expect(res.written).toEqual([]);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("#E23 a stamp-less schema needs previousDefault + confirm", async () => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    writeSchemaDir(root, null);
    const before = snapshotTree(root);
    expect((await run(root, { action: "disable" })).ok).toBe(false);
    expect((await run(root, { action: "disable", previousDefault: "spec-driven" })).ok).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
    const ok = await run(root, { action: "disable", previousDefault: "spec-driven", confirm: true });
    expect(ok.ok).toBe(true);
    expect(read(root, "openspec/config.yaml")).toContain("schema: spec-driven");
  });

  it("#E23 a stamp previousDefault naming a deleted schema refuses", async () => {
    const root = enabledRepo("gone-flow");
    const before = snapshotTree(root);
    const res = await run(root, { action: "disable" }, makeFakeCli({ resolvable: ["spec-driven", "pi-spec-driven"] }));
    expect(res.ok).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
  });
});

describe("remove", () => {
  const disabled = (): string => {
    const root = repo({ config: "schema: spec-driven\n" });
    writeSchemaDir(root, { base: "1.11.0", patch: 1 });
    return root;
  };

  it("#E24 refused while the config names the schema", async () => {
    const root = enabledRepo();
    const res = await run(root, { action: "remove" });
    expect(res.ok).toBe(false);
    expect(schemaDirNames(root)).toEqual(["pi-spec-driven"]);
  });

  it("#E24 refused naming an active change that pins it", async () => {
    const root = disabled();
    write(root, "openspec/changes/foo/.openspec.yaml", "schema: pi-spec-driven\n");
    const res = await run(root, { action: "remove" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("foo");
    expect(schemaDirNames(root)).toEqual(["pi-spec-driven"]);
  });

  it("#E24 archived-only references warn and need confirm", async () => {
    const root = disabled();
    write(root, "openspec/changes/archive/2025-01-01-old/.openspec.yaml", "schema: pi-spec-driven\n");
    const no = await run(root, { action: "remove" });
    expect(no.ok).toBe(false);
    expect(no.warnings?.join(" ")).toContain("2025-01-01-old");
    expect(schemaDirNames(root)).toEqual(["pi-spec-driven"]);
    const yes = await run(root, { action: "remove", confirm: true });
    expect(yes.ok).toBe(true);
    expect(yes.warnings?.join(" ")).toContain("2025-01-01-old");
    expect(schemaDirNames(root)).toEqual([]);
  });

  it("#E24 refused for unmanaged and for none", async () => {
    const un = repo();
    writeSchemaDir(un, null);
    expect((await run(un, { action: "remove" })).ok).toBe(false);
    expect(schemaDirNames(un)).toEqual(["pi-spec-driven"]);
    expect((await run(repo(), { action: "remove" })).ok).toBe(false);
  });

  it("#E24 an unreferenced current schema is renamed to a backup, then deleted, with an unmerged-branches warning", async () => {
    const root = disabled();
    const realFs = resolveDeps().fs;
    const order: string[] = [];
    const res = await run(root, { action: "remove" }, makeFakeCli(), {
      fs: {
        ...realFs,
        rename: async (from, to) => {
          order.push(`rename:${path.basename(to)}`);
          return realFs.rename(from, to);
        },
        rm: async (target) => {
          order.push(`rm:${path.basename(target)}`);
          return realFs.rm(target);
        },
      },
    });
    expect(res.ok).toBe(true);
    expect(order).toHaveLength(2);
    expect(order[0]).toMatch(/^rename:pi-spec-driven\.fork-backup-/);
    expect(order[1]).toMatch(/^rm:pi-spec-driven\.fork-backup-/);
    expect(schemaDirNames(root)).toEqual([]);
    expect(res.warnings?.join(" ")).toMatch(/Unmerged branches/);
    expect(res.status).toBe("none");
  });
});

describe("adopt", () => {
  it("regenerates over an unmanaged dir with confirm + previousDefault", async () => {
    const root = repo();
    writeSchemaDir(root, null, { "templates/custom.md": "mine\n" });
    const res = await run(root, { action: "adopt", confirm: true, previousDefault: "spec-driven" });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("current");
    expect(fs.existsSync(path.join(root, "openspec/schemas/pi-spec-driven/templates/custom.md"))).toBe(false);
    expect(schemaDirNames(root)).toEqual(["pi-spec-driven"]);
  });

  it("is refused without confirm, without previousDefault, for a symlink, and for a managed schema", async () => {
    const root = repo();
    writeSchemaDir(root, null);
    expect((await run(root, { action: "adopt", previousDefault: "spec-driven" })).ok).toBe(false);
    expect((await run(root, { action: "adopt", confirm: true })).ok).toBe(false);

    const link = repo();
    const elsewhere = track(mkTmp("wfs-elsewhere"));
    fs.mkdirSync(path.join(link, "openspec", "schemas"), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(link, "openspec", "schemas", "pi-spec-driven"));
    expect((await run(link, { action: "adopt", confirm: true, previousDefault: "spec-driven" })).ok).toBe(false);

    const managed = repo();
    writeSchemaDir(managed, { base: "1.11.0", patch: 1 });
    expect((await run(managed, { action: "adopt", confirm: true, previousDefault: "spec-driven" })).ok).toBe(false);
  });
});

describe("checkActionState (allowed-state table)", () => {
  const A: WorkflowSchemaAction[] = ["enable", "disable", "update", "adopt", "pin", "remove"];
  it("matches the requirement table", () => {
    const allowed = (a: WorkflowSchemaAction, c: string, g: Parameters<typeof checkActionState>[2]) =>
      checkActionState(a, c, g).verdict === "run";
    expect(A.map((a) => allowed(a, "spec-driven", "none"))).toEqual([true, false, false, false, false, false]);
    expect(A.map((a) => allowed(a, "pi-spec-driven", "none"))).toEqual([false, true, true, false, true, false]);
    expect(A.map((a) => allowed(a, "spec-driven", "outdated"))).toEqual([true, false, true, false, false, true]);
    expect(A.map((a) => allowed(a, "spec-driven", "conflict"))).toEqual([true, false, false, false, false, true]);
    expect(A.map((a) => allowed(a, "spec-driven", "incompatible"))).toEqual([false, false, false, false, false, true]);
    expect(A.map((a) => allowed(a, "spec-driven", "unmanaged"))).toEqual([false, false, false, true, false, false]);
  });
});
