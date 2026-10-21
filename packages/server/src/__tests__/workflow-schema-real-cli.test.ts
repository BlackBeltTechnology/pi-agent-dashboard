/**
 * Real-CLI suites for the `pi-spec-driven` schema (temp repos initialised by the
 * real `openspec` CLI; skipped ONLY when the CLI is absent):
 * #E1 fresh generation, #E2 user shadow ignored, #E12 104/33 enable, #E13 custom
 * default, #E23 disable keeps pinned changes working, #E25 new change, #E26 design skip.
 * See change: add-pi-spec-driven-schema.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { generateWorkflowSchema, runWorkflowSchemaAction } from "../openspec/workflow-schema.js";
import { mkTmp, openspecSync, realCliAvailable, snapshotTree, write } from "./helpers/workflow-schema-fixtures.js";

const HAVE_CLI = realCliAvailable();
const suite = HAVE_CLI ? describe : describe.skip;

const roots: string[] = [];
let savedXdg: string | undefined;
beforeEach(() => {
  savedXdg = process.env.XDG_DATA_HOME;
});
afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = savedXdg;
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function initRepo(config?: string): string {
  const root = mkTmp("wfs-real");
  roots.push(root);
  openspecSync(["init", root, "--tools", "none", "--force"], root);
  if (config !== undefined) fs.writeFileSync(path.join(root, "openspec", "config.yaml"), config);
  return root;
}
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
interface StatusEntry { changeName: string; schemaName?: string; error?: unknown; artifacts?: Array<{ id: string; status: string }> }
const statusAll = (root: string): StatusEntry[] =>
  (JSON.parse(openspecSync(["status", "--all", "--json"], root)) as { changes: StatusEntry[] }).changes;

suite("pi-spec-driven with the real OpenSpec CLI", () => {
  it("#E1 fresh generation: stamp, replaced design line, valid schema", async () => {
    const root = initRepo();
    const res = await generateWorkflowSchema({ root, previousDefault: "spec-driven" });
    expect(res.ok).toBe(true);
    const text = read(root, "openspec/schemas/pi-spec-driven/schema.yaml");
    const doc = YAML.parse(text) as Record<string, any>;
    const version = openspecSync(["--version"], root).trim();
    expect(doc["x-pi-dashboard"]).toEqual({ derivedFrom: `spec-driven@${version}`, patch: 1, previousDefault: "spec-driven" });
    const design = doc.artifacts.find((a: { id: string }) => a.id === "design");
    expect(design.instruction).toContain('When a full design.md is warranted (otherwise still create design.md containing one line "Not needed: <reason>"):');
    expect(design.instruction).not.toContain("When to include design.md (create only if any apply):");
    expect(fs.readdirSync(path.join(root, "openspec/schemas/pi-spec-driven/templates")).length).toBeGreaterThan(0);
    const validate = JSON.parse(openspecSync(["schema", "validate", "pi-spec-driven", "--json"], root));
    expect(validate.valid).toBe(true);
    expect(fs.readdirSync(path.join(root, "openspec/schemas"))).toEqual(["pi-spec-driven"]);
  }, 60_000);

  it("#E2 a user-level spec-driven shadow is ignored", async () => {
    const root = initRepo();
    const xdg = mkTmp("wfs-xdg");
    roots.push(xdg);
    // build the shadow from a real fork so it is a valid schema
    const seed = initRepo();
    openspecSync(["schema", "fork", "spec-driven", "spec-driven", "--force"], seed);
    const shadowDir = path.join(xdg, "openspec", "schemas", "spec-driven");
    fs.mkdirSync(path.dirname(shadowDir), { recursive: true });
    fs.cpSync(path.join(seed, "openspec/schemas/spec-driven"), shadowDir, { recursive: true });
    const sy = path.join(shadowDir, "schema.yaml");
    fs.writeFileSync(sy, fs.readFileSync(sy, "utf8").replace(/^description: .*$/m, "description: SHADOW"));
    process.env.XDG_DATA_HOME = xdg;
    // precondition: without the scratch override the shadow WOULD win
    const which = JSON.parse(openspecSync(["schema", "which", "spec-driven", "--json"], root, { XDG_DATA_HOME: xdg }));
    expect(which.source).toBe("user");

    const res = await generateWorkflowSchema({ root, previousDefault: "spec-driven" });
    expect(res.ok).toBe(true);
    expect(read(root, "openspec/schemas/pi-spec-driven/schema.yaml")).not.toContain("SHADOW");
  }, 60_000);

  it("#E12 enabling 104 changes (33 file-less) creates exactly 33 pins; every change keeps its schema", async () => {
    const root = initRepo("schema: spec-driven\n");
    const fileless: string[] = [];
    for (let i = 0; i < 104; i++) {
      const name = `c${String(i).padStart(3, "0")}`;
      write(root, `openspec/changes/${name}/proposal.md`, "# p\n");
      if (i % 3 === 0 && fileless.length < 33) fileless.push(name);
      else write(root, `openspec/changes/${name}/.openspec.yaml`, "schema: spec-driven\n");
    }
    expect(fileless).toHaveLength(33);
    const res = await runWorkflowSchemaAction({ cwd: root, action: "enable" });
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    const pins = res.written.filter((p) => p.endsWith(".openspec.yaml"));
    expect(pins).toHaveLength(33);
    for (const n of fileless) expect(read(root, `openspec/changes/${n}/.openspec.yaml`)).toBe("schema: spec-driven\n");
    expect(read(root, "openspec/config.yaml")).toMatch(/^schema: pi-spec-driven$/m);
    const entries = statusAll(root);
    expect(entries).toHaveLength(104);
    expect(entries.every((e) => e.schemaName === "spec-driven")).toBe(true);
  }, 120_000);

  it("#E13 a project-level custom default is preserved as previousDefault and in the pins", async () => {
    const root = initRepo();
    openspecSync(["schema", "fork", "spec-driven", "team-flow"], root);
    fs.writeFileSync(path.join(root, "openspec", "config.yaml"), "schema: team-flow\n");
    write(root, "openspec/changes/x/proposal.md", "# p\n");
    const res = await runWorkflowSchemaAction({ cwd: root, action: "enable" });
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(read(root, "openspec/changes/x/.openspec.yaml")).toBe("schema: team-flow\n");
    expect(read(root, "openspec/schemas/pi-spec-driven/schema.yaml")).toMatch(/previousDefault: team-flow/);
    expect(statusAll(root).find((e) => e.changeName === "x")?.schemaName).toBe("team-flow");
  }, 90_000);

  it("#E25 a new change in an enabled project is created on pi-spec-driven", async () => {
    const root = initRepo("schema: spec-driven\n");
    expect((await runWorkflowSchemaAction({ cwd: root, action: "enable" })).ok).toBe(true);
    openspecSync(["new", "change", "foo"], root);
    expect(read(root, "openspec/changes/foo/.openspec.yaml")).toContain("schema: pi-spec-driven");
  }, 90_000);

  it("#E26 a design.md containing only `Not needed: …` counts as done", async () => {
    const root = initRepo("schema: spec-driven\n");
    expect((await runWorkflowSchemaAction({ cwd: root, action: "enable" })).ok).toBe(true);
    openspecSync(["new", "change", "foo"], root);
    write(root, "openspec/changes/foo/design.md", "Not needed: single-file fix\n");
    const foo = statusAll(root).find((e) => e.changeName === "foo");
    expect(foo?.schemaName).toBe("pi-spec-driven");
    expect(foo?.artifacts?.find((a) => a.id === "design")?.status).toBe("done");
  }, 90_000);

  it("#E23 disable restores the previous default; a change pinned to pi-spec-driven still reports status", async () => {
    const root = initRepo("schema: spec-driven\n");
    expect((await runWorkflowSchemaAction({ cwd: root, action: "enable" })).ok).toBe(true);
    openspecSync(["new", "change", "foo"], root);
    const res = await runWorkflowSchemaAction({ cwd: root, action: "disable" });
    expect(res.ok).toBe(true);
    expect(read(root, "openspec/config.yaml")).toMatch(/^schema: spec-driven$/m);
    expect(fs.existsSync(path.join(root, "openspec/schemas/pi-spec-driven/schema.yaml"))).toBe(true);
    const foo = statusAll(root).find((e) => e.changeName === "foo");
    expect(foo?.schemaName).toBe("pi-spec-driven");
    expect(foo?.error).toBeUndefined();
  }, 90_000);

  it("a second enable on an enabled project writes nothing (real CLI)", async () => {
    const root = initRepo("schema: spec-driven\n");
    expect((await runWorkflowSchemaAction({ cwd: root, action: "enable" })).ok).toBe(true);
    const before = snapshotTree(root);
    const again = await runWorkflowSchemaAction({ cwd: root, action: "enable" });
    expect(again.ok).toBe(true);
    expect(again.written).toEqual([]);
    expect(again.status).toBe("current");
    expect(snapshotTree(root)).toEqual(before);
  }, 90_000);
});
