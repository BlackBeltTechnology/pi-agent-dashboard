/**
 * Enable flow (stubbed CLI, temp-dir fs): #E14 idempotent, #E15 no regeneration,
 * #E17 config variants, #E22 enumeration, #X6 partial failure, worktree info.
 * See change: add-pi-spec-driven-schema.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateWorkflowSchema,
  resolveDeps,
  runWorkflowSchemaAction,
  type WorkflowSchemaResult,
} from "../openspec/workflow-schema.js";
import {
  type FakeCli,
  makeFakeCli,
  mkRepo,
  mkTmp,
  snapshotTree,
  stubDeps,
  write,
  writeSchemaDir,
} from "./helpers/workflow-schema-fixtures.js";

const roots: string[] = [];
const repo = (...a: Parameters<typeof mkRepo>): string => {
  const r = mkRepo(...a);
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const enable = (root: string, fake: FakeCli = makeFakeCli(), over: Parameters<typeof stubDeps>[1] = {}): Promise<WorkflowSchemaResult> =>
  runWorkflowSchemaAction({ cwd: root, action: "enable" }, stubDeps(fake, over));
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
const stampOf = (root: string): string => read(root, "openspec/schemas/pi-spec-driven/schema.yaml");

describe("enable", () => {
  it("pins file-less changes to the previous default, generates the schema, then switches the config", async () => {
    const root = repo({ config: "# keep me\nschema: spec-driven\n" });
    write(root, "openspec/changes/a/proposal.md", "x");
    write(root, "openspec/changes/b/.openspec.yaml", "schema: spec-driven\ncreated: 2025-01-01\n");
    const res = await enable(root);
    expect(res.ok).toBe(true);
    expect(res.status).toBe("current");
    expect(res.configured).toBe("pi-spec-driven");
    expect(res.written).toEqual([
      "openspec/schemas/pi-spec-driven",
      "openspec/changes/a/.openspec.yaml",
      "openspec/config.yaml",
    ]);
    expect(read(root, "openspec/changes/a/.openspec.yaml")).toBe("schema: spec-driven\n");
    expect(read(root, "openspec/changes/b/.openspec.yaml")).toBe("schema: spec-driven\ncreated: 2025-01-01\n");
    expect(read(root, "openspec/config.yaml")).toBe("# keep me\nschema: pi-spec-driven\n");
    expect(stampOf(root)).toMatch(/previousDefault: spec-driven/);
    expect(stampOf(root)).toMatch(/derivedFrom: spec-driven@1\.11\.0/);
  });

  it("#E14 enabling an enabled project with a current schema changes nothing", async () => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    write(root, "openspec/changes/a/proposal.md", "x"); // unpinned: handled by Pin, not Enable
    expect((await generateWorkflowSchema({ root, previousDefault: "spec-driven" }, stubDeps(makeFakeCli()))).ok).toBe(true);
    const before = snapshotTree(root);
    const res = await enable(root);
    expect(res.ok).toBe(true);
    expect(res.written).toEqual([]);
    expect(res.status).toBe("current");
    expect(snapshotTree(root)).toEqual(before);
  });

  it("#E15 never regenerates an outdated schema and reports it as outdated", async () => {
    const root = repo();
    writeSchemaDir(root, { base: "1.11.0", patch: 0, previousDefault: "spec-driven" });
    write(root, "openspec/changes/foo/.openspec.yaml", "schema: pi-spec-driven\n");
    const schemaBefore = snapshotTree(path.join(root, "openspec", "schemas"));
    const fake = makeFakeCli();
    const res = await enable(root, fake);
    expect(res.ok).toBe(true);
    expect(res.status).toBe("outdated");
    expect(snapshotTree(path.join(root, "openspec", "schemas"))).toEqual(schemaBefore);
    expect(fake.count("fork")).toBe(0);
    expect(read(root, "openspec/config.yaml")).toContain("schema: pi-spec-driven");
  });

  describe("#E17 config variants", () => {
    it("a config without `schema:` records spec-driven", async () => {
      const root = repo({ config: "# only a comment\n" });
      const res = await enable(root);
      expect(res.ok).toBe(true);
      expect(stampOf(root)).toMatch(/previousDefault: spec-driven/);
      const cfg = read(root, "openspec/config.yaml");
      expect(cfg).toContain("# only a comment");
      expect(cfg).toContain("schema: pi-spec-driven");
    });

    it("config.yaml wins over config.yml; config.yml stays untouched", async () => {
      const root = repo({ config: "schema: team-flow\n" });
      write(root, "openspec/config.yml", "schema: other\n");
      const res = await enable(root, makeFakeCli({ resolvable: ["team-flow", "other", "spec-driven"] }));
      expect(res.ok).toBe(true);
      expect(stampOf(root)).toMatch(/previousDefault: team-flow/);
      expect(read(root, "openspec/config.yaml")).toContain("schema: pi-spec-driven");
      expect(read(root, "openspec/config.yml")).toBe("schema: other\n");
    });

    it("only config.yml → config.yml is edited", async () => {
      const root = repo({ config: "schema: team-flow\n", configFile: "config.yml" });
      const res = await enable(root);
      expect(res.ok).toBe(true);
      expect(read(root, "openspec/config.yml")).toContain("schema: pi-spec-driven");
      expect(fs.existsSync(path.join(root, "openspec", "config.yaml"))).toBe(false);
    });

    it("no config file → refused, nothing written", async () => {
      const root = repo({ config: null });
      const before = snapshotTree(root);
      const res = await enable(root);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/config/);
      expect(snapshotTree(root)).toEqual(before);
    });
  });

  it("#E22 enumerates active changes only: no archive/, dot-dirs or symlinks", async () => {
    const root = repo();
    const outside = mkTmp("wfs-outside");
    roots.push(outside);
    write(root, "openspec/changes/archive/x/proposal.md", "x");
    write(root, "openspec/changes/.hidden/proposal.md", "x");
    write(root, "openspec/changes/ok/proposal.md", "x");
    fs.symlinkSync(outside, path.join(root, "openspec", "changes", "evil"));
    const res = await enable(root);
    expect(res.ok).toBe(true);
    expect(res.written.filter((p) => p.endsWith(".openspec.yaml"))).toEqual(["openspec/changes/ok/.openspec.yaml"]);
    expect(fs.existsSync(path.join(outside, ".openspec.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(root, "openspec/changes/archive/x/.openspec.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(root, "openspec/changes/.hidden/.openspec.yaml"))).toBe(false);
  });

  it("#X6 a pin write failure leaves schema + earlier pins, reports partial, and a re-run completes", async () => {
    const root = repo();
    for (const n of ["a", "b", "c"]) write(root, `openspec/changes/${n}/proposal.md`, "x");
    const realFs = resolveDeps().fs;
    let writes = 0;
    const failing = {
      fs: {
        ...realFs,
        writeExclusive: async (file: string, data: string) => {
          if (++writes === 2) throw new Error("disk full");
          return realFs.writeExclusive(file, data);
        },
      },
    };
    const first = await enable(root, makeFakeCli(), failing);
    expect(first.ok).toBe(false);
    expect(first.partial).toBe(true);
    expect(first.error).toMatch(/disk full/);
    expect(fs.existsSync(path.join(root, "openspec/schemas/pi-spec-driven/schema.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "openspec/changes/a/.openspec.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "openspec/changes/b/.openspec.yaml"))).toBe(false);
    expect(read(root, "openspec/config.yaml")).toContain("schema: spec-driven");

    const second = await enable(root);
    expect(second.ok).toBe(true);
    for (const n of ["a", "b", "c"]) expect(read(root, `openspec/changes/${n}/.openspec.yaml`)).toBe("schema: spec-driven\n");
    expect(read(root, "openspec/config.yaml")).toContain("schema: pi-spec-driven");
  });

  it("reports worktree info and calls the forced refresh hook after writing", async () => {
    const root = repo();
    const main = mkTmp("wfs-main");
    roots.push(main);
    fs.mkdirSync(path.join(main, ".git", "worktrees", "wt"), { recursive: true });
    fs.writeFileSync(path.join(main, ".git", "worktrees", "wt", "HEAD"), "ref: refs/heads/wt-1\n");
    fs.writeFileSync(path.join(root, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt")}\n`);
    const refreshed: string[] = [];
    const res = await enable(root, makeFakeCli(), { refresh: async (cwd) => void refreshed.push(cwd) });
    expect(res.worktree).toEqual({ isWorktree: true, branch: "wt-1" });
    expect(refreshed).toEqual([root]);
  });

  it("a plain checkout is not a worktree", async () => {
    const root = repo();
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    expect((await enable(root)).worktree).toEqual({ isWorktree: false, branch: "main" });
  });
});
