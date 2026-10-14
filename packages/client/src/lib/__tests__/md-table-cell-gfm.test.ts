/**
 * `escapeMdTableCell` under a real GFM parser (remark-gfm), plus the helper's
 * escape-order cases. See change: fix-codeql-small-findings (test-plan #E8 #E10).
 */
import { escapeMdTableCell } from "@blackbelt-technology/pi-dashboard-shared/md-table-cell.js";
import type { Root, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

/** Fixture D checks: [name, message]. */
const CHECKS: Array<[string, string]> = [
  ["plain", "a\\|b"],
  ["path", "C:\\path\\"],
  ["ABI mismatch: a|b\\", "ok"],
  ["lf", "line1\nline2"],
  ["cr", "line1\rline2"],
];

function parseTables(md: string): Table[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(md) as Root;
  return tree.children.filter((n): n is Table => n.type === "table");
}

const build = (cell: (s: string) => string, nameCell: (s: string) => string) =>
  [
    "| Status | Check | Message | Detail |",
    "| --- | --- | --- | --- |",
    ...CHECKS.map(([n, m]) => `| ✅ | ${nameCell(n)} | ${cell(m)} | |`),
  ].join("\n");

describe("escapeMdTableCell: GFM contract", () => {
  it("E8: post-fix every check is one four-cell row; the pre-fix escape is not", () => {
    const [table, ...rest] = parseTables(build(escapeMdTableCell, escapeMdTableCell));
    expect(rest).toEqual([]);
    expect(table.children).toHaveLength(1 + CHECKS.length);
    for (const row of table.children) expect(row.children).toHaveLength(4);

    // Oracle: the escape this change replaces (no backslash step, CRLF/LF only, name raw).
    const oldCell = (s: string) => s.split("|").join("\\|").replace(/\r?\n/g, " ");
    const oldTables = parseTables(build(oldCell, (s) => s));
    const oldRows = oldTables.flatMap((t) => t.children);
    const intact = oldTables.length === 1 && oldRows.length === 1 + CHECKS.length && oldRows.every((r) => r.children.length === 4);
    expect(intact).toBe(false);
  });

  it("E10: escape order and line endings", () => {
    const cases: Array<[string, string]> = [
      ["\\", "\\\\"],
      ["|", "\\|"],
      ["\\|", "\\\\\\|"],
      ["a\r\nb", "a b"],
      ["a\rb", "a b"],
      ["a\nb", "a b"],
      ["plain", "plain"],
    ];
    for (const [input, expected] of cases) expect(escapeMdTableCell(input)).toBe(expected);
  });
});
