/**
 * Generation of the `pi-spec-driven` schema (stubbed CLI, temp-dir fs):
 * #E3 non-package base, #E4 patch anchor, #E9 fingerprint recheck.
 * See change: add-pi-spec-driven-schema.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fingerprintDir,
  generateWorkflowSchema,
  runWorkflowSchemaAction,
} from "../openspec/workflow-schema.js";
import { listDirNames, makeFakeCli, mkRepo, snapshotTree, stubDeps } from "./helpers/workflow-schema-fixtures.js";

const roots: string[] = [];
const repo = (...a: Parameters<typeof mkRepo>): string => {
  const r = mkRepo(...a);
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const schemasOf = (root: string): string[] => listDirNames(path.join(root, "openspec", "schemas"));

describe("generateWorkflowSchema", () => {
  it("#E3 aborts and leaves the repository byte-identical when `schema which` is not the package", async () => {
    const root = repo();
    const before = snapshotTree(root);
    const fake = makeFakeCli({ whichBase: { source: "project", shadows: [] } });
    const res = await generateWorkflowSchema({ root, previousDefault: "spec-driven" }, stubDeps(fake));
    expect(res.ok).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
    expect(fake.count("fork")).toBe(0);
  });

  it("#E3 aborts when the package base reports shadows", async () => {
    const root = repo();
    const before = snapshotTree(root);
    const fake = makeFakeCli({ whichBase: { source: "package", shadows: [{ source: "user" }] } });
    const res = await generateWorkflowSchema({ root, previousDefault: "spec-driven" }, stubDeps(fake));
    expect(res.ok).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("#E3 runs every CLI call in the scratch root with an empty XDG_DATA_HOME", async () => {
    const root = repo();
    const fake = makeFakeCli();
    const res = await generateWorkflowSchema({ root, previousDefault: "spec-driven" }, stubDeps(fake));
    expect(res.ok).toBe(true);
    expect(fake.calls.length).toBeGreaterThanOrEqual(4);
    for (const { ctx } of fake.calls) {
      expect(ctx.cwd.startsWith(root)).toBe(false);
      expect(ctx.xdgDataHome).toBeTruthy();
      expect(fs.existsSync(ctx.cwd)).toBe(false); // scratch removed afterwards
    }
  });

  it("#E4 aborts with an anchor error: no stamp, no staging dir", async () => {
    const root = repo();
    const before = snapshotTree(root);
    const baseYaml = "name: spec-driven\nversion: 1\nartifacts:\n  - id: design\n    generates: design.md\n    instruction: |\n      No anchor here.\n";
    const fake = makeFakeCli({ baseYaml });
    const res = await generateWorkflowSchema({ root, previousDefault: "spec-driven" }, stubDeps(fake));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/anchor/i);
    expect(schemasOf(root).filter((n) => n.startsWith(".fork-staging"))).toEqual([]);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("#E9 aborts before the swap when the existing directory changed after its status was read", async () => {
    const root = repo();
    const fake = makeFakeCli();
    expect((await generateWorkflowSchema({ root, previousDefault: "spec-driven" }, stubDeps(fake))).ok).toBe(true);
    const dir = path.join(root, "openspec", "schemas", "pi-spec-driven");
    const stale = await fingerprintDir(dir);
    fs.writeFileSync(path.join(dir, "templates", "design.md"), "# hand edit\n");
    const before = snapshotTree(root);

    const res = await generateWorkflowSchema(
      { root, previousDefault: "spec-driven", expectedFingerprint: stale },
      stubDeps(fake),
    );
    expect(res.ok).toBe(false);
    expect(fs.readFileSync(path.join(dir, "templates", "design.md"), "utf8")).toBe("# hand edit\n");
    expect(snapshotTree(root)).toEqual(before); // no staging, no backup
  });

  it("#E9 update aborts when a template is edited between the status read and the swap", async () => {
    const root = repo();
    const fake = makeFakeCli();
    await generateWorkflowSchema({ root, previousDefault: "spec-driven" }, stubDeps(fake));
    const tpl = path.join(root, "openspec", "schemas", "pi-spec-driven", "templates", "design.md");
    fake.options.onFork = () => fs.writeFileSync(tpl, "# edited mid-flight\n");
    const res = await runWorkflowSchemaAction({ cwd: root, action: "update" }, stubDeps(fake));
    expect(res.ok).toBe(false);
    expect(fs.readFileSync(tpl, "utf8")).toBe("# edited mid-flight\n");
    expect(schemasOf(root)).toEqual(["pi-spec-driven"]);
  });
});
