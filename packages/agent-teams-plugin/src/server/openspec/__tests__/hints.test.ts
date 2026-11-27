/**
 * `<!-- after: … -->` hints of tasks.md (tasks 7.32 #E18, 7.33 #E19, 7.34 #E21): grammar and leniency, placement,
 * target validity, first-hint-wins, linear scan, and "hints do not disturb the existing parsers" (the dashboard
 * parser and, when installed, `openspec instructions apply --json` list the same checkboxes with or without them).
 * See change: add-agent-teams-openspec.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeHintReport, type HintBox, MAX_HINT_ENTRIES, resolveHints, scanHints, stripTrailingHint } from "../hints.js";
import { tmp } from "./env.js";
import { serverTasks } from "./server-src.js";

const { parseTasksMarkdown } = serverTasks;

const boxesOf = (md: string): HintBox[] => parseTasksMarkdown(md).map((t) => ({ id: t.id, line: t.line, done: t.done }));
/** Resolve hints of `md`: blockers as `id → ids`, plus the reports. */
function run(md: string): { blockers: Record<string, string[]>; reports: ReturnType<typeof resolveHints>["reports"] } {
  const boxes = boxesOf(md);
  const out = resolveHints(scanHints(md), boxes);
  const idOf = (line: number): string => (boxes.find((b) => b.line === line) as HintBox).id;
  return { blockers: Object.fromEntries([...out.blockers].map(([line, set]) => [idOf(line), [...set].map(idOf)])), reports: out.reports };
}
const lines = (...l: string[]): string => `${l.join("\n")}\n`;

describe("hint grammar (7.32 #E18)", () => {
  const base = (hint: string): string => lines("## 1. A", "- [ ] 1.1 one", "- [ ] 1.2 two", "", "## 2. B", `- [ ] 2.1 three ${hint}`);

  it.each([
    ["<!-- after: 1.1 -->", ["1.1"]],
    ["<!--after:1.1-->", ["1.1"]],
    ["<!-- after: 1.1,§1 -->", ["1.1", "1.2"]],
    ["<!--  After : 1.1 -->", ["1.1"]],
    ["<!-- AFTER:1.1 -->", ["1.1"]],
    ["<!-- after: 1.1, -->", ["1.1"]],
    ["<!-- after: -->", []],
    ["<!--after:   -->", []],
  ])("%s applies as %j (keyword case-insensitive, whitespace-tolerant, trailing comma and empty list ok)", (hint, ids) => {
    const r = run(base(hint));
    expect(r.blockers["2.1"], hint).toEqual(ids.length === 0 ? [] : expect.arrayContaining(ids));
    expect(r.blockers["2.1"]).toHaveLength(ids.length);
    expect(r.reports).toEqual([]);
  });

  it("a bare number is a checkbox id first, then a section; §n forces the section", () => {
    const md = lines("## 1. A", "- [ ] 2 weird id", "- [ ] 1.2 two", "", "## 2. B", "- [ ] 2.1 three <!-- after: 2 -->", "- [ ] 2.2 four <!-- after: §1 -->", "", "## 3. C", "- [ ] 3.1 five <!-- after: 2 -->", "- [ ] 3.2 six <!-- after: §2 -->");
    const r = run(md);
    expect(r.blockers["2.1"]).toEqual(["2"]); // id `2` exists
    expect(r.blockers["2.2"]).toEqual(["2", "1.2"]); // §1 = the whole first section
    expect(r.blockers["3.1"]).toEqual(["2"]);
    expect(r.blockers["3.2"]).toEqual(["2.1", "2.2"]); // §2 forces the section
    const noId = run(lines("## 1. A", "- [ ] 1.1 one", "", "## 2. B", "- [ ] 2.1 two", "", "## 3. C", "- [ ] 3.1 x <!-- after: 2 -->"));
    expect(noId.blockers["3.1"]).toEqual(["2.1"]); // no checkbox `2`: the section
  });

  it("unknown entries (§0, §99, 9.9) are ignored and reported once each; duplicates are deduped and reported", () => {
    const r = run(base("<!-- after: §0, §99, 9.9, 9.9, 1.1, 1.1 -->"));
    expect(r.blockers["2.1"]).toEqual(["1.1"]);
    expect(r.reports.filter((x) => x.kind === "unknown").map((x) => x.entry)).toEqual(["§0", "§99", "9.9", "9.9"].slice(0, 4));
    expect(r.reports.filter((x) => x.kind === "duplicate")).toHaveLength(1);
  });

  it("more than 64 entries: the first 64 count, the rest are dropped and reported", () => {
    const many = Array.from({ length: 1000 }, (_, i) => `1.${i}`).join(", ");
    const r = run(base(`<!-- after: ${many} -->`));
    expect(r.reports.filter((x) => x.kind === "overflow")).toEqual([expect.objectContaining({ count: 1000 - MAX_HINT_ENTRIES })]);
    expect(r.reports.filter((x) => x.kind === "unknown")).toHaveLength(MAX_HINT_ENTRIES - 2); // 1.1 and 1.2 are real
  });

  it("a hint text containing --> or a nested <!-- ends at the first -->; its entry is unknown", () => {
    expect(run(base("<!-- after: 1.1 <!-- x -->")).reports.map((x) => x.kind)).toEqual(["unknown"]);
    expect(run(base("<!-- after: 1.1 <!-- x --> -->")).blockers).toEqual({}); // text after the first `-->`: not a trailing hint at all
    expect(run(lines("## 1. A", "- [ ] 1.1 a <!-- note --> text", "- [ ] 1.2 b <!-- after: 1.1 --> not trailing")).blockers).toEqual({});
  });

  it("the scan is linear in the file size (a 900 KB file of unterminated hint starts, and 20000 boxes)", () => {
    const start = Date.now();
    scanHints(`- [ ] 1.1 x ${"<!-- after: ".repeat(80_000)}\n`);
    const many = lines("## 1. A", ...Array.from({ length: 20_000 }, (_, i) => `- [ ] ${i + 1} box <!-- after: ${i} -->`));
    resolveHints(scanHints(many), boxesOf(many));
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("stripTrailingHint removes one trailing hint only", () => {
    expect(stripTrailingHint("text <!-- after: 1.1 -->")).toBe("text");
    expect(stripTrailingHint("text <!--  After:1.1-->  ")).toBe("text");
    expect(stripTrailingHint("text <!-- note -->")).toBe("text <!-- note -->");
    expect(stripTrailingHint("<!-- after: 1.1 --> tail")).toBe("<!-- after: 1.1 --> tail");
  });
});

describe("hint placement and semantics (7.33 #E19)", () => {
  it("recognises own-line-below-box, trailing and under-heading placements", () => {
    const md = lines("## 1. A", "- [ ] 1.1 one", "- [ ] 1.2 two", "<!-- after: 1.1 -->", "- [ ] 1.3 three <!-- after: 1.1 -->", "", "## 2. B", "<!-- after: §1 -->", "- [ ] 2.1 x", "- [ ] 2.2 y <!-- after: 1.1 -->");
    const r = run(md);
    expect(r.blockers["1.2"]).toEqual(["1.1"]);
    expect(r.blockers["1.3"]).toEqual(["1.1"]);
    expect(r.blockers["2.1"]).toEqual(["1.1", "1.2", "1.3"]); // section hint
    expect(r.blockers["2.2"]).toEqual(["1.1"]); // box hint wins over the section hint
    expect(r.reports).toEqual([]);
  });

  it("a blank line between box and hint, fenced hints and hints on indented sub-bullets are ignored", () => {
    const md = lines("## 1. A", "- [ ] 1.1 one", "- [ ] 1.2 two", "", "<!-- after: 1.1 -->", "- [ ] 1.3 three", "  - sub <!-- after: 1.1 -->", "- [ ] 1.4 four", "```", "<!-- after: 1.1 -->", "```", "- [ ] 1.5 five", "```md", "- [ ] 9.9 in fence <!-- after: 1.1 -->", "```");
    expect(run(md).blockers).toEqual({});
  });

  it("two hints on one box: the first wins, the second is reported; same for a section", () => {
    const md = lines("## 1. A", "<!-- after: -->", "<!-- after: §3 -->", "- [ ] 1.1 one <!-- after: -->", "<!-- after: 1.1 -->", "", "## 2. B", "- [ ] 2.1 x");
    const r = run(md);
    expect(r.blockers["1.1"]).toEqual([]); // trailing wins over the own-line one
    expect(r.reports.filter((x) => x.kind === "second_hint").map((x) => x.line)).toEqual([3, 5]);
    expect(r.blockers["2.1"]).toBeUndefined();
  });

  it("forward, self and later-section targets are dropped and reported; ticked targets are satisfied", () => {
    const md = lines("## 1. A", "- [x] 1.1 done", "- [ ] 1.2 a <!-- after: 1.3 -->", "- [ ] 1.3 b <!-- after: 1.3, 1.1 -->", "- [ ] 1.4 c <!-- after: §1, §2, 2.1 -->", "", "## 2. B", "- [ ] 2.1 d <!-- after: §2 -->", "", "## 3. C", "<!-- after: §1 -->", "- [ ] 3.1 e");
    const r = run(md);
    expect(r.blockers["1.2"]).toEqual([]); // forward 1.3 dropped
    expect(r.blockers["1.3"]).toEqual([]); // self dropped, ticked 1.1 satisfied
    expect(r.blockers["1.4"]).toEqual([]); // §1 is its own section: self; §2 and 2.1 are forward
    expect(r.reports.filter((x) => x.line === 5).map((x) => x.kind).sort()).toEqual(["forward", "forward", "self"]);
    expect(r.blockers["2.1"]).toEqual([]); // §2 is its own section: self
    expect(r.blockers["3.1"]).toEqual(["1.2", "1.3", "1.4"]); // ticked 1.1 contributes nothing
  });

  it("a fully ticked section as target means no blocker; edges only ever point backward, so hints alone cannot form a cycle", () => {
    const md = lines("## 1. A", "- [x] 1.1 done", "", "## 2. B", "- [ ] 2.1 a <!-- after: §1 -->", "- [ ] 2.2 b <!-- after: 2.3 -->", "- [ ] 2.3 c <!-- after: 2.2 -->");
    const r = run(md);
    expect(r.blockers["2.1"]).toEqual([]);
    expect(r.blockers["2.2"]).toEqual([]); // forward: dropped, so 2.3 -> 2.2 closes no cycle
    expect(r.blockers["2.3"]).toEqual(["2.2"]);
    expect(r.reports.map((x) => x.kind)).toEqual(["forward"]);
  });

  it("report lines carry ids and codes only, never task text", () => {
    const r = run(lines("## 1. A", "- [ ] 1.1 SECRET-TOKEN-123 text <!-- after: 9.9 -->"));
    expect(r.reports.map(describeHintReport).join("\n")).not.toContain("SECRET");
    expect(describeHintReport({ kind: "unknown", line: 2, entry: "x\n<script>" })).not.toContain("<");
  });

  it("CRLF files scan like LF files", () => {
    const md = lines("## 1. A", "- [ ] 1.1 one", "<!-- after: -->", "- [ ] 1.2 two <!-- after: 1.1 -->").replace(/\n/g, "\r\n");
    expect(run(md).blockers).toEqual({ "1.1": [], "1.2": ["1.1"] });
  });
});

describe("hints do not disturb the existing parsers (7.34 #E21)", () => {
  const plain = lines("## 1. Setup", "", "- [ ] 1.1 First", "- [x] 1.2 Second", "- [ ] Id-less", "", "## 2. Docs", "- [ ] 2.1 Third");
  const standalone = lines("## 1. Setup", "<!-- after: -->", "", "- [ ] 1.1 First", "<!-- after: -->", "- [x] 1.2 Second", "- [ ] Id-less", "", "## 2. Docs", "<!-- after: §1 -->", "- [ ] 2.1 Third");
  const trailing = lines("## 1. Setup", "", "- [ ] 1.1 First <!-- after: -->", "- [x] 1.2 Second <!-- after: 1.1 -->", "- [ ] Id-less <!-- after: 1.1 -->", "", "## 2. Docs", "- [ ] 2.1 Third <!-- after: §1 -->");

  it("the dashboard parser lists the same ids, lines and states with standalone, trailing and no hints", () => {
    // An id-less box gets the synthesized `L<line>`: its line shifts with the extra comment lines, so compare the shape.
    const strip = (md: string) => parseTasksMarkdown(md).map(({ id, done, group }) => ({ id: id.startsWith("L") ? "L" : id, done, group }));
    expect(strip(standalone)).toEqual(strip(plain));
    expect(strip(trailing)).toEqual(strip(plain));
    expect(parseTasksMarkdown(standalone).map((t) => t.text)).toEqual(parseTasksMarkdown(plain).map((t) => t.text)); // standalone lines never leak into text
  });

  it("the plugin never rewrites hints: scanning and resolving leave the text untouched", () => {
    const before = trailing;
    resolveHints(scanHints(trailing), boxesOf(trailing));
    expect(trailing).toBe(before);
  });

  let cli = true;
  try {
    execFileSync("openspec", ["--version"], { stdio: "ignore", timeout: 15_000 });
  } catch {
    cli = false;
  }
  it.skipIf(!cli)("`openspec instructions apply --json` reports the same task count with and without a standalone hint line", () => {
    const count = (md: string): number => {
      const root = tmp("at-os-cli-");
      const dir = path.join(root, "openspec", "changes", "demo");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "tasks.md"), md);
      fs.writeFileSync(path.join(dir, "proposal.md"), "# p\n");
      fs.writeFileSync(path.join(dir, ".openspec.yaml"), "schema: spec-driven\n");
      const out = execFileSync("openspec", ["instructions", "apply", "--change", "demo", "--json"], { cwd: root, encoding: "utf8", timeout: 30_000 });
      return (JSON.parse(out) as { tasks: unknown[] }).tasks.length;
    };
    expect(count(standalone)).toBe(count(plain));
  });
});
