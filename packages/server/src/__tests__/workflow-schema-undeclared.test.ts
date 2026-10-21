/**
 * #E23 `workflowSchema.undeclaredChanges`: the affected changes with no regular
 * `dependencies.yaml` (lstat only, so a symlink or a directory does not count).
 * Drives the worker-safe `computeSchemaStatus` the poll worker runs every tick.
 * See change: add-openspec-change-dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeSchemaStatus } from "../openspec/workflow-schema-status.js";
import { mkRepo, write } from "./helpers/workflow-schema-fixtures.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});
const repo = (config = "schema: pi-spec-driven\n"): string => {
  const r = mkRepo({ config });
  roots.push(r);
  return r;
};
const change = (root: string, name: string, pin?: string): string => {
  const dir = path.join(root, "openspec", "changes", name);
  fs.mkdirSync(dir, { recursive: true });
  if (pin) write(root, `openspec/changes/${name}/.openspec.yaml`, `schema: ${pin}\n`);
  return dir;
};
const status = async (root: string) =>
  (await computeSchemaStatus(root, { localVersion: "1.11.0", packageSchemasDir: "/pkg", userSchemasDirPath: "/nonexistent-user-schemas" })).status;

describe("#E23 undeclaredChanges", () => {
  it("affected [a,b,c], only b has a regular file, c's is a symlink → [a, c]", async () => {
    const root = repo();
    change(root, "a");
    const b = change(root, "b");
    const c = change(root, "c");
    fs.writeFileSync(path.join(b, "dependencies.yaml"), "blocked_by: []\n");
    fs.writeFileSync(path.join(root, "elsewhere.yaml"), "blocked_by: []\n");
    fs.symlinkSync(path.join(root, "elsewhere.yaml"), path.join(c, "dependencies.yaml"));
    const s = await status(root);
    expect(s.affectedChanges).toEqual(["a", "b", "c"]);
    expect(s.undeclaredChanges).toEqual(["a", "c"]);
  });

  it("a directory named dependencies.yaml is not a declaration", async () => {
    const root = repo();
    fs.mkdirSync(path.join(change(root, "a"), "dependencies.yaml"));
    expect((await status(root)).undeclaredChanges).toEqual(["a"]);
  });

  it("only affected changes count: a change pinned to spec-driven is never listed", async () => {
    const root = repo();
    change(root, "a", "pi-spec-driven");
    change(root, "b", "spec-driven");
    const s = await status(root);
    expect(s.affectedChanges).toEqual(["a"]);
    expect(s.undeclaredChanges).toEqual(["a"]);
  });

  it("no affected changes (schema not configured) → empty list, field present", async () => {
    const root = repo("schema: spec-driven\n");
    change(root, "a");
    const s = await status(root);
    expect(s.affectedChanges).toEqual([]);
    expect(s.undeclaredChanges).toEqual([]);
  });

  it("is a subset of affectedChanges and sorted, for many changes", async () => {
    const root = repo();
    for (let i = 0; i < 40; i++) {
      const d = change(root, `c${String(i).padStart(2, "0")}`);
      if (i % 3 === 0) fs.writeFileSync(path.join(d, "dependencies.yaml"), "blocked_by: []\n");
    }
    const s = await status(root);
    expect(s.undeclaredChanges).toEqual(s.affectedChanges.filter((_, i) => i % 3 !== 0));
  });
});
