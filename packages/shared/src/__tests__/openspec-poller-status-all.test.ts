/**
 * `buildOpenSpecDataFromStatusAll` against a real tmp tree: partial failure
 * (#E1), task counting + tracked-file selection (#E7/#E8), canonical order
 * (#E9) and newest-first change order (#E10).
 * See change: use-openspec-status-all.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildOpenSpecDataFromStatusAll, resolveApplyTracks } from "../openspec-poller.js";
import type { StatusAllEntry } from "../openspec-status-all.js";

let root: string;
let openspecDir: string;
let userDir: string;

function write(rel: string, content: string) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** A healthy `--all` entry for `name` whose existing outputs are listed from disk. */
function entry(name: string, opts: { schema?: string; outputs?: Record<string, string>; order?: string[] } = {}): StatusAllEntry {
  const outputs = opts.outputs ?? { proposal: "proposal.md", design: "design.md", specs: "specs/**/*.md", tasks: "tasks.md" };
  const changeRoot = path.join(root, "openspec", "changes", name);
  const artifactPaths: NonNullable<StatusAllEntry["artifactPaths"]> = {};
  const artifacts: NonNullable<StatusAllEntry["artifacts"]> = [];
  for (const id of opts.order ?? Object.keys(outputs)) {
    const out = outputs[id];
    const existing: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else existing.push(p);
      }
    };
    if (out.includes("*")) {
      const prefix = out.split("/")[0];
      walk(path.join(changeRoot, prefix));
    } else if (fs.existsSync(path.join(changeRoot, out))) {
      existing.push(path.join(changeRoot, out));
    }
    artifactPaths[id] = { outputPath: out, resolvedOutputPath: path.join(changeRoot, out), existingOutputPaths: existing };
    artifacts.push({ id, outputPath: out, status: existing.length > 0 ? "done" : "ready" });
  }
  return { changeName: name, schemaName: opts.schema ?? "spec-driven", changeRoot, artifactPaths, artifacts, isComplete: false };
}

const build = (entries: StatusAllEntry[], orderMtimes: Record<string, number | undefined> = {}) =>
  buildOpenSpecDataFromStatusAll({
    cwd: root,
    openspecDir,
    rootPath: root,
    entries,
    orderMtimes,
    userSchemasDir: userDir,
  });

beforeEach(() => {
  // realpath: macOS tmpdir is a symlink and the CLI emits canonical paths.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "poller-all-")));
  openspecDir = path.join(root, "openspec");
  userDir = path.join(root, "user-schemas");
  fs.mkdirSync(path.join(openspecDir, "changes"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("buildOpenSpecDataFromStatusAll", () => {
  it("#E1 a broken change keeps the directory populated and carries a capped error", async () => {
    write("openspec/changes/good/proposal.md", "# p");
    write("openspec/changes/good/tasks.md", "- [x] a\n- [ ] b\n");
    write("openspec/changes/bad/tasks.md", "- [ ] 1\n".repeat(9));
    const bad: StatusAllEntry = {
      changeName: "bad",
      status: [{ severity: "error", code: "change_error", message: `Invalid YAML\n${"x".repeat(600)}` }],
    };
    const { data } = await build([entry("good"), bad], { good: 2, bad: 1 });
    expect(data.initialized).toBe(true);
    expect(data.changes.map((c) => c.name)).toEqual(["good", "bad"]);
    const b = data.changes.find((c) => c.name === "bad")!;
    expect(b.error?.code).toBe("change_error");
    expect(b.error?.message.length).toBeLessThanOrEqual(500);
    expect(b.error?.message).not.toContain("\n");
    expect(b.artifacts).toEqual([]);
    // Broken change still counts its top-level tasks.md (matches `openspec list`).
    expect(b.totalTasks).toBe(9);
    const g = data.changes.find((c) => c.name === "good")!;
    expect(g.error).toBeUndefined();
    expect(g.artifacts.length).toBe(4);
    expect([g.completedTasks, g.totalTasks, g.status]).toEqual([1, 2, "in-progress"]);
  });

  it("#E6 an entry with neither artifacts nor status maps to unknown-entry", async () => {
    const { data } = await build([{ changeName: "odd" }]);
    expect(data.changes[0].error?.code).toBe("unknown-entry");
    expect(data.changes[0].artifacts).toEqual([]);
  });

  describe("#E8 tracked-file selection", () => {
    const planOutputs = { proposal: "proposal.md", plan: "plan.md", tasks: "tasks.md" };

    beforeEach(() => {
      write("openspec/changes/c/plan.md", "- [x] p1\n- [ ] p2\n- [ ] p3\n");
      write("openspec/changes/c/tasks.md", "- [x] t1\n");
      write("openspec/changes/c/proposal.md", "# p");
    });

    it("(a) project schema apply.tracks: plan.md counts plan.md, ignores tasks.md", async () => {
      write("openspec/schemas/custom/schema.yaml", "name: custom\napply:\n  tracks: plan.md\n");
      const { data } = await build([entry("c", { schema: "custom", outputs: planOutputs })]);
      expect([data.changes[0].completedTasks, data.changes[0].totalTasks]).toEqual([1, 3]);
    });

    it("(b) project schema without apply.tracks counts artifact `tasks`", async () => {
      write("openspec/schemas/custom/schema.yaml", "name: custom\n");
      const { data } = await build([entry("c", { schema: "custom", outputs: planOutputs })]);
      expect([data.changes[0].completedTasks, data.changes[0].totalTasks]).toEqual([1, 1]);
    });

    it("(c) unmatched apply.tracks falls back to the top-level tasks.md", async () => {
      write("openspec/schemas/custom/schema.yaml", "name: custom\napply:\n  tracks: nothing-matches.md\n");
      const { data } = await build([entry("c", { schema: "custom", outputs: planOutputs })]);
      expect([data.changes[0].completedTasks, data.changes[0].totalTasks]).toEqual([1, 1]);
    });

    it("(d) a user-dir `spec-driven` shadow wins over the built-in", async () => {
      fs.mkdirSync(path.join(userDir, "spec-driven"), { recursive: true });
      fs.writeFileSync(path.join(userDir, "spec-driven", "schema.yaml"), "name: spec-driven\napply:\n  tracks: other.md\n");
      write("openspec/changes/c/other.md", "- [ ] o1\n- [ ] o2\n");
      const { data } = await build([
        entry("c", {
          schema: "spec-driven",
          outputs: { proposal: "proposal.md", other: "other.md", tasks: "tasks.md" },
        }),
      ]);
      expect([data.changes[0].completedTasks, data.changes[0].totalTasks]).toEqual([0, 2]);
    });

    it("(d') a project-local schema beats the user dir", async () => {
      write("openspec/schemas/spec-driven/schema.yaml", "name: spec-driven\napply:\n  tracks: plan.md\n");
      fs.mkdirSync(path.join(userDir, "spec-driven"), { recursive: true });
      fs.writeFileSync(path.join(userDir, "spec-driven", "schema.yaml"), "apply:\n  tracks: other.md\n");
      expect(await resolveApplyTracks("spec-driven", openspecDir, userDir)).toBe("plan.md");
    });

    it("(e) a broken change counts its top-level tasks.md", async () => {
      write("openspec/changes/broken/tasks.md", "- [ ] 1\n".repeat(9));
      const { data } = await build([{ changeName: "broken", status: [{ severity: "error", code: "change_error", message: "x" }] }]);
      expect(data.changes[0].totalTasks).toBe(9);
    });

    it("an unparsable schema file means apply.tracks is absent", async () => {
      write("openspec/schemas/custom/schema.yaml", "apply: [unclosed\n");
      expect(await resolveApplyTracks("custom", openspecDir, userDir)).toBeUndefined();
    });

    it("rejects path-like schema names", async () => {
      expect(await resolveApplyTracks("../evil", openspecDir, userDir)).toBeUndefined();
    });
  });

  it("no tracked output and no tasks.md → 0/0 and no-tasks", async () => {
    write("openspec/changes/empty/proposal.md", "# p");
    const { data } = await build([entry("empty")]);
    expect([data.changes[0].totalTasks, data.changes[0].completedTasks, data.changes[0].status]).toEqual([0, 0, "no-tasks"]);
  });

  it("#E9 artifacts come out in canonical order, extras last in CLI order", async () => {
    write("openspec/changes/a/proposal.md", "# p");
    const e = entry("a", {
      outputs: {
        proposal: "proposal.md",
        specs: "specs/**/*.md",
        dependencies: "dependencies.yaml",
        design: "design.md",
        tasks: "tasks.md",
      },
    });
    const { data } = await build([e]);
    expect(data.changes[0].artifacts.map((a) => a.id)).toEqual(["proposal", "design", "specs", "tasks", "dependencies"]);
  });

  it("#E10 changes are ordered newest-first by probe mtime, ties by name", async () => {
    for (const n of ["a", "b", "c"]) write(`openspec/changes/${n}/proposal.md`, "# p");
    const { data } = await build([entry("a"), entry("b"), entry("c")], { a: 1000, b: 2000, c: 2000 });
    expect(data.changes.map((c) => c.name)).toEqual(["b", "c", "a"]);
  });

  it("exposes mapped tracked extras per change", async () => {
    write("openspec/changes/a/proposal.md", "# p");
    const { extras } = await build([entry("a", { outputs: { proposal: "proposal.md", dependencies: "dependencies.yaml" } })]);
    expect(extras.a.files).toContain(path.join(openspecDir, "changes", "a", "dependencies.yaml"));
  });
});
