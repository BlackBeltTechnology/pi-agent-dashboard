import { repairAsciiDoc } from "@blackbelt-technology/pi-dashboard-shared/markup-repair/asciidoc.js";
import type { MarkupRepairResult } from "@blackbelt-technology/pi-dashboard-shared/markup-repair/types.js";
import { describe, expect, it } from "vitest";
import { repairMarkdown } from "../preview/markup-repair-md.js";

const MD: string[] = [
  "```js\na\n~~~\ntext\n",
  "````\na\n```\ntext\n",
  "```\na\n~~\n\n# H\n",
  "```sh\necho\n\n# Heading\nbody\n",
  "```sh\n# comment\necho\n",
  "````md\n```\n````\n",
  "---\nx: |\n  ```\n---\n# T\n",
  "> ```sh\n> echo\n\n# Heading\n",
  "```a\nx\n\n# One\n\ntext\n```b\ny\n\n# Two\n",
  "```sh\r\necho\r\n\r\n# Heading\r\nbody\r\n",
  "```sh\r\necho\n\n# Heading\nbody\n",
  "text\n```mermaid",
  "# plain\n\nno fences\n",
];

const ADOC: string[] = [
  "[mermaid]\n----\ng\n----\n",
  "[mermaid]\n....\ng\n....\n",
  "[mermaid,format=svg]\n----\ng\n----\n",
  ".Title\n[mermaid]\n----\ng\n----\n",
  "[mermaid]\nparagraph\n",
  "----\ncode\n-----\nafter\n",
  "----\ncode\n\n== Next\n",
  "----\ncode\n",
  "====\n----\ncode\n\n== Next\n====\n",
  "* item\n+\n----\ncode\n\n== Next\n",
  "----\na\n\n== One\n\n....\nb\n\n== Two\n",
  "----\r\ncode\r\n\r\n== Next\r\n",
];

const CASES: Array<[string, string, (s: string) => MarkupRepairResult]> = [
  ...MD.map((s): [string, string, (s: string) => MarkupRepairResult] => ["md", s, repairMarkdown]),
  ...ADOC.map((s): [string, string, (s: string) => MarkupRepairResult] => ["adoc", s, repairAsciiDoc]),
];

/** Split keeping terminators, so a CR/LF-only difference counts as a changed line. */
const splitKeep = (s: string): string[] => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

describe("markup repair — properties over every fixture", () => {
  it.each(CASES)("E11 idempotent (%s) %j", (_kind, src, repair) => {
    const r = repair(src);
    const again = repair(r.source);
    expect(again.repairs).toEqual([]);
    expect(again.source).toBe(r.source);
  });

  it.each(CASES)("E25 only repaired lines change (%s) %j", (_kind, src, repair) => {
    const r = repair(src);
    const before = splitKeep(src);
    const after = splitKeep(r.source);
    // Lines in common (LCS-free check): every original line survives in order, except replaced ones.
    let bi = 0;
    let replaced = 0;
    let inserted = 0;
    let ai = 0;
    while (ai < after.length) {
      if (bi < before.length && after[ai] === before[bi]) {
        ai++;
        bi++;
      } else if (bi < before.length && after.length - ai === before.length - bi) {
        replaced++; // same remaining length → positional replacement
        ai++;
        bi++;
      } else {
        inserted++;
        ai++;
      }
    }
    // Each repair is exactly one replaced-or-inserted line. A1 is a replacement; M2/A2 may be either.
    expect(replaced + inserted).toBe(r.repairs.length);
    expect(after.length - before.length).toBe(inserted);
  });
});
