/**
 * Patch v2 of the `pi-spec-driven` schema: the `dependencies` artifact.
 * #E20 real CLI, #E21 anchor abort, #E22 patch-1 stamp stays `outdated`.
 * See change: add-openspec-change-dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  CURRENT_PATCH,
  computeWorkflowSchemaStatus,
  generateWorkflowSchema,
  runWorkflowSchemaAction,
} from "../openspec/workflow-schema.js";
import {
  makeFakeCli,
  mkRepo,
  mkTmp,
  openspecSync,
  realCliAvailable,
  snapshotTree,
  stubDeps,
  write,
  writeSchemaDir,
} from "./helpers/workflow-schema-fixtures.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});
const repo = (...a: Parameters<typeof mkRepo>): string => {
  const r = mkRepo(...a);
  roots.push(r);
  return r;
};

const realSuite = realCliAvailable() ? describe : describe.skip;

realSuite("patch v2 with the real OpenSpec CLI", () => {
  it("#E20 dependencies precedes tasks; tasks require it; template exists; a new change is blocked on it", async () => {
    const root = mkTmp("wfs-deps");
    roots.push(root);
    openspecSync(["init", root, "--tools", "none", "--force"], root);
    fs.writeFileSync(path.join(root, "openspec", "config.yaml"), "schema: spec-driven\n");

    expect((await generateWorkflowSchema({ root, previousDefault: "spec-driven" })).ok).toBe(true);
    const schemaDir = path.join(root, "openspec/schemas/pi-spec-driven");
    const doc = YAML.parse(fs.readFileSync(path.join(schemaDir, "schema.yaml"), "utf8")) as Record<string, any>;
    const ids = doc.artifacts.map((a: { id: string }) => a.id);
    expect(ids.indexOf("dependencies")).toBe(ids.indexOf("tasks") - 1);
    const dependencies = doc.artifacts.find((a: { id: string }) => a.id === "dependencies");
    expect(dependencies).toMatchObject({
      generates: "dependencies.yaml",
      template: "dependencies.yaml",
      requires: ["proposal", "specs"],
    });
    expect(dependencies.instruction).toContain("blocked_by");
    expect(doc.artifacts.find((a: { id: string }) => a.id === "tasks").requires).toEqual(["specs", "design", "dependencies"]);
    expect(doc["x-pi-dashboard"].patch).toBe(2);
    expect(fs.readFileSync(path.join(schemaDir, "templates/dependencies.yaml"), "utf8")).toMatch(/blocked_by: \[\]/);
    expect(JSON.parse(openspecSync(["schema", "validate", "pi-spec-driven", "--json"], root)).valid).toBe(true);

    expect((await runWorkflowSchemaAction({ cwd: root, action: "enable" })).ok).toBe(true);
    openspecSync(["new", "change", "foo"], root);
    write(root, "openspec/changes/foo/proposal.md", "# foo\n");
    write(root, "openspec/changes/foo/design.md", "Not needed: tiny\n");
    write(root, "openspec/changes/foo/specs/cap/spec.md", "## ADDED Requirements\n");
    const status = JSON.parse(openspecSync(["status", "--change", "foo", "--json"], root)) as {
      artifacts: Array<{ id: string; status: string }>;
    };
    const st = (id: string) => status.artifacts.find((a) => a.id === id)?.status;
    expect(st("dependencies")).toBe("ready");
    expect(st("tasks")).toBe("blocked");

    write(root, "openspec/changes/foo/dependencies.yaml", "blocked_by: []\nnot_blocked_by: []\nrelated: []\n");
    const after = JSON.parse(openspecSync(["status", "--change", "foo", "--json"], root)) as typeof status;
    expect(after.artifacts.find((a) => a.id === "dependencies")?.status).toBe("done");
    expect(after.artifacts.find((a) => a.id === "tasks")?.status).toBe("ready");
  }, 120_000);
});

describe("patch v2 anchors", () => {
  it("#E21 aborts and leaves the repository byte-identical when tasks.requires is not exactly [specs, design]", async () => {
    const root = repo();
    const before = snapshotTree(root);
    const baseYaml = [
      "name: spec-driven",
      "version: 1",
      "artifacts:",
      "  - id: design",
      "    generates: design.md",
      "    instruction: |",
      "      When to include design.md (create only if any apply):",
      "    requires: [proposal]",
      "  - id: tasks",
      "    generates: tasks.md",
      "    instruction: x",
      "    requires: [specs, design, extra]",
      "",
    ].join("\n");
    const res = await generateWorkflowSchema({ root, previousDefault: "spec-driven" }, stubDeps(makeFakeCli({ baseYaml })));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/anchor.*tasks\.requires/i);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("#E21 aborts when there is no tasks artifact", async () => {
    const root = repo();
    const baseYaml = "name: spec-driven\nversion: 1\nartifacts:\n  - id: design\n    generates: design.md\n    instruction: |\n      When to include design.md (create only if any apply):\n";
    const res = await generateWorkflowSchema({ root, previousDefault: "spec-driven" }, stubDeps(makeFakeCli({ baseYaml })));
    expect(res.ok).toBe(false);
  });

  it("generation with the stub CLI writes the template and the patched artifact order", async () => {
    const root = repo();
    const res = await generateWorkflowSchema({ root, previousDefault: "spec-driven" }, stubDeps(makeFakeCli()));
    expect(res.ok).toBe(true);
    const dir = path.join(root, "openspec/schemas/pi-spec-driven");
    expect(fs.existsSync(path.join(dir, "templates/dependencies.yaml"))).toBe(true);
    const doc = YAML.parse(fs.readFileSync(path.join(dir, "schema.yaml"), "utf8")) as { artifacts: Array<{ id: string }> };
    expect(doc.artifacts.map((a) => a.id)).toEqual(["design", "dependencies", "tasks"]);
  });
});

describe("patch-1 stamp", () => {
  it("#E22 reports outdated and enable never regenerates it", async () => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    writeSchemaDir(root, { base: "1.11.0", patch: CURRENT_PATCH - 1 });
    const status = await computeWorkflowSchemaStatus(root, {
      localVersion: "1.11.0",
      packageSchemasDir: "/pkg",
      userSchemasDirPath: "/nonexistent-user-schemas",
    });
    expect(status.generated).toBe("outdated");
    const before = snapshotTree(path.join(root, "openspec/schemas"));
    await runWorkflowSchemaAction({ cwd: root, action: "enable" }, stubDeps(makeFakeCli()));
    expect(snapshotTree(path.join(root, "openspec/schemas"))).toEqual(before);
  });
});
