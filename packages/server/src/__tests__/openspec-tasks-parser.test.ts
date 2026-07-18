import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseTasksMarkdown,
  readTasks,
  toggleTask,
  NotFoundError,
  LineMismatchError,
  NotACheckboxError,
} from "../openspec/openspec-tasks.js";

describe("parseTasksMarkdown", () => {
  it("parses ticked + unticked mix and tracks groups", () => {
    const md = [
      "## 1. Setup",
      "",
      "- [ ] 1.1 Create module",
      "- [x] 1.2 Add dep",
      "",
      "## 2. Tests",
      "- [x] 2.1 Write vitest",
      "- [ ] 2.2 Write e2e",
    ].join("\n");
    const tasks = parseTasksMarkdown(md);
    expect(tasks).toEqual([
      { id: "1.1", text: "Create module", done: false, line: 3, group: "1. Setup" },
      { id: "1.2", text: "Add dep", done: true, line: 4, group: "1. Setup" },
      { id: "2.1", text: "Write vitest", done: true, line: 7, group: "2. Tests" },
      { id: "2.2", text: "Write e2e", done: false, line: 8, group: "2. Tests" },
    ]);
  });

  it("ignores unparseable lines without failing", () => {
    const md = [
      "## Misc",
      "- foo bar",
      "- [ ] 1.1 Valid task",
      "random text",
      "  - [ ] 1.2 Indented, not top-level",
      "- [x] 1.3 Another valid",
    ].join("\n");
    const tasks = parseTasksMarkdown(md);
    expect(tasks.map((t) => t.id)).toEqual(["1.1", "1.3"]);
    expect(tasks.map((t) => t.done)).toEqual([false, true]);
  });

  it("handles capital X as done", () => {
    const tasks = parseTasksMarkdown("## G\n- [X] 1.1 Done-uppercase");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].done).toBe(true);
  });

  it("handles CRLF line endings", () => {
    const md = "## 1. G\r\n- [ ] 1.1 Test\r\n- [x] 1.2 Done\r\n";
    const tasks = parseTasksMarkdown(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].group).toBe("1. G");
    expect(tasks[0].line).toBe(2);
    expect(tasks[1].done).toBe(true);
  });

  it("returns empty list for no tasks", () => {
    expect(parseTasksMarkdown("# Title\n\nJust prose.\n")).toEqual([]);
  });

  it("handles tasks without a preceding heading (empty group)", () => {
    const tasks = parseTasksMarkdown("- [ ] 1.1 Loose task");
    expect(tasks[0].group).toBe("");
  });

  // ─── relax-tasks-parser-id-optional ───────────────────────────────────────
  // The parser MUST accept top-level checkboxes with or without a `1.1`-style
  // numeric id prefix. Id-less lines get a synthesized `L<line>` id.

  it("parses id-less checkboxes with synthesized L<line> ids", () => {
    const md = [
      "## 1. Workflow matrix", // line 1
      "",                       // line 2
      "- [ ] Verify runner image",  // line 3
      "- [x] Add matrix row",       // line 4
    ].join("\n");
    const tasks = parseTasksMarkdown(md);
    expect(tasks).toEqual([
      { id: "L3", text: "Verify runner image", done: false, line: 3, group: "1. Workflow matrix" },
      { id: "L4", text: "Add matrix row", done: true, line: 4, group: "1. Workflow matrix" },
    ]);
  });

  it("parses files mixing id-ed and id-less checkboxes", () => {
    const md = [
      "## 1. Mix",          // 1
      "",                    // 2
      "- [ ] 1.1 Has id",   // 3
      "- [x] No id here",   // 4
      "- [ ] 1.3 Skipped 1.2 on purpose", // 5
    ].join("\n");
    const tasks = parseTasksMarkdown(md);
    expect(tasks).toEqual([
      { id: "1.1", text: "Has id", done: false, line: 3, group: "1. Mix" },
      { id: "L4", text: "No id here", done: true, line: 4, group: "1. Mix" },
      { id: "1.3", text: "Skipped 1.2 on purpose", done: false, line: 5, group: "1. Mix" },
    ]);
  });

  it("still ignores indented checkboxes (id-less or id-ed)", () => {
    const md = [
      "## G",
      "  - [ ] indented id-less",
      "  - [ ] 1.1 indented id-ed",
      "- [ ] top-level id-less",
    ].join("\n");
    const tasks = parseTasksMarkdown(md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("L4");
    expect(tasks[0].text).toBe("top-level id-less");
  });
});

describe("readTasks + toggleTask (writer)", () => {
  let tmpDir: string;
  let changeDir: string;
  let tasksFile: string;
  const CWD_CHANGE = ["my-cwd-placeholder", "demo-change"] as const;

  const initialMd = [
    "## 1. Setup",
    "",
    "- [ ] 1.1 First task",
    "- [x] 1.2 Second task",
    "",
    "## 2. Docs",
    "- [ ] 2.1 Third task",
    "",
  ].join("\n");

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openspec-tasks-test-"));
    changeDir = path.join(tmpDir, "openspec", "changes", CWD_CHANGE[1]);
    fs.mkdirSync(changeDir, { recursive: true });
    tasksFile = path.join(changeDir, "tasks.md");
    fs.writeFileSync(tasksFile, initialMd, "utf-8");
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("readTasks returns parsed entries", async () => {
    const tasks = await readTasks(tmpDir, CWD_CHANGE[1]);
    expect(tasks.map((t) => t.id)).toEqual(["1.1", "1.2", "2.1"]);
  });

  it("readTasks throws NotFoundError when file is missing", async () => {
    await expect(readTasks(tmpDir, "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("toggle ticks an unticked task and preserves other lines", async () => {
    const result = await toggleTask(tmpDir, CWD_CHANGE[1], "1.1", true, 3);
    expect(result.done).toBe(true);
    expect(result.id).toBe("1.1");
    expect(result.line).toBe(3);
    expect(result.group).toBe("1. Setup");

    const after = fs.readFileSync(tasksFile, "utf-8");
    const expected = initialMd.replace("- [ ] 1.1 First task", "- [x] 1.1 First task");
    expect(after).toBe(expected);
  });

  it("toggle unticks a ticked task", async () => {
    const result = await toggleTask(tmpDir, CWD_CHANGE[1], "1.2", false, 4);
    expect(result.done).toBe(false);
    const after = fs.readFileSync(tasksFile, "utf-8");
    expect(after).toBe(initialMd.replace("- [x] 1.2 Second task", "- [ ] 1.2 Second task"));
  });

  it("toggle raises LineMismatchError when line is already in the target state", async () => {
    // Line 4 is already done=true; requesting done=true again → mismatch
    await expect(toggleTask(tmpDir, CWD_CHANGE[1], "1.2", true, 4)).rejects.toBeInstanceOf(
      LineMismatchError,
    );
    // File untouched
    expect(fs.readFileSync(tasksFile, "utf-8")).toBe(initialMd);
  });

  it("toggle raises LineMismatchError when id does not match target line", async () => {
    await expect(toggleTask(tmpDir, CWD_CHANGE[1], "9.9", true, 3)).rejects.toBeInstanceOf(
      LineMismatchError,
    );
  });

  it("toggle raises LineMismatchError for out-of-range line", async () => {
    await expect(toggleTask(tmpDir, CWD_CHANGE[1], "1.1", true, 9999)).rejects.toBeInstanceOf(
      LineMismatchError,
    );
  });

  it("toggle raises NotACheckboxError when target line is a heading", async () => {
    // Line 1 is "## 1. Setup"
    await expect(toggleTask(tmpDir, CWD_CHANGE[1], "1.1", true, 1)).rejects.toBeInstanceOf(
      NotACheckboxError,
    );
  });

  it("toggle raises NotFoundError when file is absent", async () => {
    await expect(toggleTask(tmpDir, "missing", "1.1", true, 3)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("toggle writes atomically (no .tmp left behind)", async () => {
    await toggleTask(tmpDir, CWD_CHANGE[1], "1.1", true, 3);
    const files = fs.readdirSync(changeDir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("toggle preserves byte-for-byte all other lines", async () => {
    const weirdMd =
      "# Title line\n\n## 1. Group\n- [ ] 1.1 Task one\n> quote line\n\n    indented code\n- [x] 1.2 Task two\n";
    fs.writeFileSync(tasksFile, weirdMd, "utf-8");
    await toggleTask(tmpDir, CWD_CHANGE[1], "1.1", true, 4);
    const after = fs.readFileSync(tasksFile, "utf-8");
    expect(after).toBe(weirdMd.replace("- [ ] 1.1 Task one", "- [x] 1.1 Task one"));
  });

  // ─── relax-tasks-parser-id-optional ───────────────────────────────────────

  describe("id-less round-trip", () => {
    const idlessMd = [
      "## 1. Workflow matrix",     // 1
      "",                            // 2
      "- [ ] Verify runner image",  // 3
      "- [x] Add matrix row",       // 4
      "",                            // 5
      "## 2. Verify rename behavior", // 6
      "- [ ] Inspect releases",      // 7
    ].join("\n");

    beforeEach(() => {
      fs.writeFileSync(tasksFile, idlessMd, "utf-8");
    });

    it("toggle ticks an id-less task addressed by L<line>, no synthetic id leaks into the file", async () => {
      const result = await toggleTask(tmpDir, CWD_CHANGE[1], "L3", true, 3);
      expect(result).toEqual({
        id: "L3",
        text: "Verify runner image",
        done: true,
        line: 3,
        group: "1. Workflow matrix",
      });
      const after = fs.readFileSync(tasksFile, "utf-8");
      // CRITICAL: line shape preserved — no "L3" appears in the file body
      expect(after).toBe(idlessMd.replace("- [ ] Verify runner image", "- [x] Verify runner image"));
      expect(after).not.toContain("L3");
    });

    it("toggle unticks an id-less task addressed by L<line>", async () => {
      const result = await toggleTask(tmpDir, CWD_CHANGE[1], "L4", false, 4);
      expect(result.done).toBe(false);
      const after = fs.readFileSync(tasksFile, "utf-8");
      expect(after).toBe(idlessMd.replace("- [x] Add matrix row", "- [ ] Add matrix row"));
      expect(after).not.toContain("L4");
    });

    it("toggle of id-less line with wrong synthesized id throws LineMismatchError", async () => {
      // Line 3 is id-less; passing L99 (or any other L<n>) must reject
      await expect(toggleTask(tmpDir, CWD_CHANGE[1], "L99", true, 3)).rejects.toBeInstanceOf(
        LineMismatchError,
      );
      expect(fs.readFileSync(tasksFile, "utf-8")).toBe(idlessMd);
    });

    it("toggle of id-less line with a numeric-style id throws LineMismatchError", async () => {
      // Line 3 has no numeric id; passing "1.1" must reject
      await expect(toggleTask(tmpDir, CWD_CHANGE[1], "1.1", true, 3)).rejects.toBeInstanceOf(
        LineMismatchError,
      );
      expect(fs.readFileSync(tasksFile, "utf-8")).toBe(idlessMd);
    });

    it("toggle of id-ed line addressed by L<n> throws LineMismatchError", async () => {
      // Switch fixture to id-ed for this case
      fs.writeFileSync(tasksFile, initialMd, "utf-8");
      // Line 3 has id "1.1"; addressing it as "L3" must reject
      await expect(toggleTask(tmpDir, CWD_CHANGE[1], "L3", true, 3)).rejects.toBeInstanceOf(
        LineMismatchError,
      );
      expect(fs.readFileSync(tasksFile, "utf-8")).toBe(initialMd);
    });
  });
});
