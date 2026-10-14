/**
 * DOX row matcher: differential tests against the previous regex
 * implementations (embedded verbatim as oracles) + linear-time budgets.
 * See change: fix-codeql-small-findings (test-plan #E1 #E2 #P1 #P2).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchRow, matchRowLoose } from "../dox-row.js";
import { parseRows, replaceRowPurpose } from "../dox-triage.js";
import { parseFileIndex } from "../migrate-file-index.js";
import { parseAuthoredBatch } from "../migrate-runner.js";

// ---- oracles: the pre-change implementations, verbatim ----
const OLD_ROW = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*$/;
const OLD_LOOSE = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*$/;

function oldParseRows(md: string) {
  const rows: Array<{ line: number; path: string; purpose: string }> = [];
  md.split("\n").forEach((line, i) => {
    const m = line.match(OLD_ROW);
    if (!m) return;
    if (/^-+$/.test(m[1])) return;
    rows.push({ line: i, path: m[1], purpose: m[2] });
  });
  return rows;
}
function oldReplaceRowPurpose(md: string, rowPath: string, newPurpose: string): string {
  let hit = false;
  const out = md.split("\n").map((line) => {
    if (hit) return line;
    const m = line.match(OLD_ROW);
    if (!m || m[1] !== rowPath) return line;
    hit = true;
    return `| \`${m[1]}\` | ${newPurpose} |`;
  });
  return hit ? out.join("\n") : md;
}
function oldParseFileIndex(text: string) {
  const out = new Map<string, { purpose: string; seeChange: string[] }>();
  for (const line of text.split("\n")) {
    const m = line.match(OLD_ROW);
    if (!m) continue;
    const p = m[1].trim();
    const purpose = m[2].trim();
    if (!purpose || p === "File") continue;
    const seeChange = [...purpose.matchAll(/See change:\s*([A-Za-z0-9_-]+)/g)].map((mm) => mm[1]);
    out.set(p, { purpose, seeChange });
  }
  return out;
}
function oldParseAuthoredBatch(text: string) {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = line.match(OLD_LOOSE);
    if (!m) continue;
    const purpose = m[2].replace(/\s*\|\s*$/, "").trim();
    if (purpose) out.set(m[1].trim(), purpose);
  }
  return out;
}

// ---- fixtures ----
const FIXTURE_R = [
  "| `a` |  |",
  "| `a` | x | y |",
  "| `a` | x \\| y |",
  "| `a` | x || y |",
  "| `a` | `code` text |",
  "| `a` | x\t\t|\t",
  "| `a` | x |\r",
  "| `a` | x\r|",
  "| `a` | x\u2028|",
  "| `a` | x",
  "| `a` | x\ry |",
  "| `a` | x\u2028y |",
  "| `---` | x |",
  "| `File` | x |",
  "|`a`|x|",
  "| `a` x |",
  "not a row",
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

function trackedAgentsFiles(): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "*AGENTS.md"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function compareAll(md: string, label: string) {
  expect(parseRows(md), `parseRows ${label}`).toEqual(oldParseRows(md));
  for (const r of oldParseRows(md).slice(0, 5)) {
    expect(replaceRowPurpose(md, r.path, "NEW"), `replace ${label} ${r.path}`).toBe(oldReplaceRowPurpose(md, r.path, "NEW"));
  }
  expect(replaceRowPurpose(md, "__absent__", "NEW")).toBe(oldReplaceRowPurpose(md, "__absent__", "NEW"));
  expect(parseFileIndex(md), `parseFileIndex ${label}`).toEqual(oldParseFileIndex(md));
  expect(parseAuthoredBatch(md), `parseAuthoredBatch ${label}`).toEqual(oldParseAuthoredBatch(md));
}

describe("dox-row: parity with the previous regexes", () => {
  it("E1: fixture R rows and every tracked AGENTS.md", () => {
    for (const line of FIXTURE_R) compareAll(line, JSON.stringify(line));
    compareAll(FIXTURE_R.join("\n"), "fixture R joined");
    const files = trackedAgentsFiles();
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) compareAll(readFileSync(path.join(repoRoot, f), "utf8"), f);
  });

  it("E2: 50 000 seeded random lines (strict + loose)", () => {
    const rnd = mulberry32(0xd0c5);
    const alphabet = ["|", " ", "\t", "\r", "\u2028", "\u2029", "`", "a", "b", "\\"];
    let diffs = 0;
    for (let n = 0; n < 50_000; n++) {
      const len = Math.floor(rnd() * 14);
      let s = rnd() < 0.7 ? "| `a` |" : "";
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const strictOld = s.match(OLD_ROW);
      const strictNew = matchRow(s);
      if (strictOld ? !strictNew || strictNew.path !== strictOld[1] || strictNew.purpose !== strictOld[2] : strictNew !== null) diffs++;
      const looseOld = s.match(OLD_LOOSE);
      const looseNew = matchRowLoose(s);
      const oldPurpose = looseOld ? looseOld[2].replace(/\s*\|\s*$/, "").trim() : null;
      if (looseOld ? !looseNew || looseNew.path !== looseOld[1] || looseNew.purpose !== oldPurpose : looseNew !== null) diffs++;
    }
    expect(diffs).toBe(0);
  });
});

describe("dox-row: linear time on a long whitespace run", () => {
  const BUDGET_MS = 100;
  const time = (fn: () => void) => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };

  it("P1: strict parsers stay under 100 ms", () => {
    const line = `| \`a\` |${" ".repeat(100_000)}x`;
    expect(time(() => expect(parseRows(line)).toEqual([]))).toBeLessThan(BUDGET_MS);
    expect(time(() => expect(replaceRowPurpose(line, "a", "NEW")).toBe(line))).toBeLessThan(BUDGET_MS);
    expect(time(() => expect(parseFileIndex(line).size).toBe(0))).toBeLessThan(BUDGET_MS);
  });

  it("P2: authored batch (loose) stays under 100 ms", () => {
    const tail = `x${" ".repeat(100_000)}y`;
    const line = `| \`a\` | ${tail}`;
    let result = new Map<string, string>();
    expect(time(() => { result = parseAuthoredBatch(line); })).toBeLessThan(BUDGET_MS);
    expect([...result.entries()]).toEqual([["a", tail]]);
  });
});
