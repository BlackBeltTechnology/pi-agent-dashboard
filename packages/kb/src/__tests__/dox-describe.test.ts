// `kb dox describe --list` enumeration (change: inject-dox-doctrine-and-describe,
// test-plan #E24–#E28, #X3). Pure read-only walk over the directory `AGENTS.md`
// tree: reports every `| File | Purpose |` row whose Purpose cell is empty.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listEmptyPurposeRows } from "../dox.js";

const tmps: string[] = [];
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "dox-desc-"));
  tmps.push(dir);
  for (const [p, body] of Object.entries(files)) {
    const abs = join(dir, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const DOX = (rows: string) => `# DOX\n\n| File | Purpose |\n|---|---|\n${rows}`;

describe("listEmptyPurposeRows (E24–E28, X3)", () => {
  it("E24: groups empty rows by AGENTS.md, reporting the row subject path", () => {
    const dir = project({
      "a/AGENTS.md": DOX("| `a/x.ts` |  |\n"),
      "b/AGENTS.md": DOX("| `b/y.ts` |  |\n| `b/z.ts` | does z |\n"),
    });
    const { groups, total } = listEmptyPurposeRows({ cwd: dir });
    expect(total).toBe(2);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.agentsPath === "a/AGENTS.md")?.subjects).toEqual(["a/x.ts"]);
    expect(groups.find((g) => g.agentsPath === "b/AGENTS.md")?.subjects).toEqual(["b/y.ts"]);
  });

  it("E25: output is enumerable as {agentsPath, subjects[]} with a total", () => {
    const dir = project({ "a/AGENTS.md": DOX("| `a/x.ts` |  |\n"), "b/AGENTS.md": DOX("| `b/y.ts` |  |\n") });
    const out = listEmptyPurposeRows({ cwd: dir });
    const json = JSON.parse(JSON.stringify(out)) as typeof out;
    expect(json.total).toBe(2);
    for (const g of json.groups) {
      expect(typeof g.agentsPath).toBe("string");
      expect(Array.isArray(g.subjects)).toBe(true);
    }
  });

  it("E26: --dir restricts the walk to one subtree", () => {
    const dir = project({ "a/AGENTS.md": DOX("| `a/x.ts` |  |\n"), "b/AGENTS.md": DOX("| `b/y.ts` |  |\n") });
    const out = listEmptyPurposeRows({ cwd: dir, dir: "a" });
    expect(out.total).toBe(1);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].agentsPath).toBe("a/AGENTS.md");
  });

  it("rejects a --dir outside cwd, or an excluded/__tests__ dir", () => {
    const dir = project({
      "a/AGENTS.md": DOX("| `a/x.ts` |  |\n"),
      "a/__tests__/AGENTS.md": DOX("| `a/__tests__/x.test.ts` |  |\n"),
    });
    expect(listEmptyPurposeRows({ cwd: dir, dir: "../outside" })).toEqual({ groups: [], total: 0 });
    expect(listEmptyPurposeRows({ cwd: dir, dir: "a/__tests__" })).toEqual({ groups: [], total: 0 });
  });

  it("treats a non-string --dir (flag without a value) as no restriction", () => {
    const dir = project({ "a/AGENTS.md": DOX("| `a/x.ts` |  |\n") });
    // `--dir` with no value parses to boolean true; must not throw in path.resolve.
    const out = listEmptyPurposeRows({ cwd: dir, dir: true as unknown as string });
    expect(out.total).toBe(1);
  });

  it("E27: nothing to describe → empty groups, total 0", () => {
    const dir = project({ "a/AGENTS.md": DOX("| `a/x.ts` | has a purpose |\n") });
    const out = listEmptyPurposeRows({ cwd: dir });
    expect(out.groups).toEqual([]);
    expect(out.total).toBe(0);
  });

  it("E28: whitespace-only purpose counts as empty", () => {
    const dir = project({ "a/AGENTS.md": DOX("| `a/x.ts` |   |\n") });
    const out = listEmptyPurposeRows({ cwd: dir });
    expect(out.total).toBe(1);
    expect(out.groups[0].subjects).toEqual(["a/x.ts"]);
  });

  it("X3: an AGENTS.md without a file table is skipped, no throw", () => {
    const dir = project({
      "a/AGENTS.md": DOX("| `a/x.ts` |  |\n"),
      "c/AGENTS.md": "# Prose only\n\nJust some words with a `c/thing.ts` mention in a sentence.\n",
    });
    const out = listEmptyPurposeRows({ cwd: dir });
    expect(out.groups.map((g) => g.agentsPath)).toEqual(["a/AGENTS.md"]);
  });

  it("skips __tests__ trees like the `dox init` source walk", () => {
    const dir = project({
      "a/AGENTS.md": DOX("| `a/x.ts` |  |\n"),
      "a/__tests__/AGENTS.md": DOX("| `a/__tests__/x.test.ts` |  |\n"),
    });
    const out = listEmptyPurposeRows({ cwd: dir });
    expect(out.groups.map((g) => g.agentsPath)).toEqual(["a/AGENTS.md"]);
  });

  it("reads only — never writes an AGENTS.md", () => {
    const dir = project({ "a/AGENTS.md": DOX("| `a/x.ts` |  |\n") });
    const before = readFileSync(join(dir, "a", "AGENTS.md"), "utf8");
    listEmptyPurposeRows({ cwd: dir });
    expect(readFileSync(join(dir, "a", "AGENTS.md"), "utf8")).toBe(before);
  });
});
