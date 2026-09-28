/**
 * Repo-level wiring guard for explore-mode mockup adoption
 * (change: adopt-explore-mockups-into-changes, test-plan W1–W9).
 *
 * Static wiring only: the `openspec/config.yaml` rules, the plan-proposal and
 * frontend-mockup-loop-dashboard skill text, the `Pending change:` row format
 * in `mockups/AGENTS.md`, and the DOX closeout rows. Whether an agent OBEYS
 * the rules is LLM behaviour and lives in the manual QA tasks.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf-8");

const CONFIG = "openspec/config.yaml";
const PLAN_PROPOSAL = ".pi/skills/plan-proposal/SKILL.md";
const MOCKUP_ADAPTER = ".pi/skills/frontend-mockup-loop-dashboard/SKILL.md";
const MOCKUPS_DOX = "mockups/AGENTS.md";
const SKILLS_DOX = ".pi/skills/AGENTS.md";
const CHANGE = "adopt-explore-mockups-into-changes";

type Rules = Record<string, unknown>;
const configRules = (): Rules => (parseYaml(read(CONFIG)) as { rules?: Rules }).rules ?? {};

/** A rule is a one-element list holding a single string (openspec's rules shape). */
function singleRule(rules: Rules, key: string): string {
  const value = rules[key];
  expect(Array.isArray(value), `rules.${key} must be a list`).toBe(true);
  expect(value as unknown[]).toHaveLength(1);
  const [text] = value as unknown[];
  expect(typeof text).toBe("string");
  return text as string;
}

// ── Pending-change row check (W6 / W7) ─────────────────────────────────────

interface RowViolation {
  row: string;
  reason: string;
}

/** Split a markdown table row into trimmed cells, honouring `\|` escapes. */
function cells(row: string): string[] {
  const inner = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.trim());
}

/**
 * Validate every table row that mentions the pending-change marker (any
 * casing, so drift is caught). `entryExists(name)` answers whether
 * `mockups/<name>` exists.
 */
function checkPendingRows(
  markdown: string,
  entryExists: (name: string) => boolean,
): RowViolation[] {
  const out: RowViolation[] = [];
  for (const row of markdown.split(/\r?\n/)) {
    if (!row.trim().startsWith("|") || !/pending change:/i.test(row)) continue;
    const cs = cells(row);
    const fail = (reason: string) => out.push({ row, reason });
    if (cs.length !== 2) {
      fail("marker not at the end of the Purpose cell (row must have exactly File | Purpose)");
      continue;
    }
    const [fileCell, purpose] = cs;
    const m = /(?:^|\s)(Pending change): (.*)$/.exec(purpose);
    if (!m) {
      fail("marker must be spelled exactly `Pending change:` and end the Purpose cell");
      continue;
    }
    const intent = m[2].trim();
    if (intent === "") fail("empty intent");
    else if (intent.includes("`")) fail("intent contains a backtick");
    else if (intent.includes("|")) fail("intent contains a pipe");
    else if (/pending change:/i.test(intent)) fail("marker repeated");
    else if (/See change:/.test(purpose)) fail("marker row also carries See change: (owned rows are never marked)");
    const fm = /^`([^`]+)`$/.exec(fileCell);
    if (!fm) {
      fail("File cell must be a single backticked entry name");
      continue;
    }
    const name = fm[1].replace(/\/$/, "");
    if (name === "" || name.includes("/") || name === "." || name === "..") {
      fail(`File cell ${fm[1]} is not an entry directly under mockups/`);
    } else if (!entryExists(name)) {
      fail(`File cell ${fm[1]} does not exist under mockups/`);
    }
  }
  return out;
}

/** Text of a `### <prefix>` section up to the next `###`/`##` heading. */
function section(md: string, headingPrefix: RegExp): string {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => headingPrefix.test(l));
  expect(start, `heading ${headingPrefix} not found`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{2,3} /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

describe("explore-mockup adoption wiring", () => {
  it("W1: config.yaml carries exactly rules.proposal + rules.tasks with the required tokens", () => {
    const rules = configRules();
    expect(Object.keys(rules).sort()).toEqual(["proposal", "tasks"]);
    const proposal = singleRule(rules, "proposal");
    for (const token of [
      "Pending change",
      "ask_user",
      "multiselect",
      "mockups/AGENTS.md",
      "git mv",
      "already exists",
      "(in this change)",
      "See change:",
    ]) {
      expect(proposal, `rules.proposal missing ${token}`).toContain(token);
    }
    const tasks = singleRule(rules, "tasks");
    for (const token of ["plan-proposal is driving", "/opsx-apply", "/opsx:apply", "confirm"]) {
      expect(tasks, `rules.tasks missing ${token}`).toContain(token);
    }
  });

  describe("W2: openspec instructions injects each rule into its artifact only", () => {
    const bin = path.join(repoRoot, "node_modules", ".bin", "openspec");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "os-mockup-rules-"));
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const run = (args: string[]) =>
      execFileSync(bin, args, { cwd: tmp, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    let ready = false;
    const setup = () => {
      if (ready) return;
      fs.mkdirSync(path.join(tmp, "openspec"), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, CONFIG), path.join(tmp, CONFIG));
      run(["new", "change", "probe"]);
      ready = true;
    };
    const injected = (artifact: string): unknown => {
      setup();
      return (JSON.parse(run(["instructions", artifact, "--change", "probe", "--json"])) as { rules?: unknown }).rules;
    };

    it.each(["proposal", "tasks"])("%s gets exactly its own rule", (artifact) => {
      expect(injected(artifact)).toEqual(configRules()[artifact]);
    }, 30_000);

    it.each(["design", "specs"])("%s gets no rule", (artifact) => {
      const rules = injected(artifact);
      expect(rules === undefined || (Array.isArray(rules) && rules.length === 0)).toBe(true);
    }, 30_000);
  });

  it("W3: plan-proposal orders Step 1 → 1b → 2 with the driving statement and adoption step", () => {
    const md = read(PLAN_PROPOSAL);
    const steps = md
      .split(/\r?\n/)
      .filter((l) => /^### \d+[a-z]?\. /.test(l))
      .map((l) => /^### (\d+[a-z]?)\./.exec(l)?.[1]);
    const i1 = steps.indexOf("1");
    const i1b = steps.indexOf("1b");
    const i2 = steps.indexOf("2");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i1b).toBe(i1 + 1);
    expect(i2).toBe(i1b + 1);
    expect(section(md, /^### 1\. /)).toContain("plan-proposal is driving this change");
    const step1b = section(md, /^### 1b\. /);
    for (const token of ["Pending change", "ask_user", "declined"]) expect(step1b).toContain(token);
  });

  it("W4: plan-proposal Step 4 commits test-plan.md and the change mockups", () => {
    const step4 = section(read(PLAN_PROPOSAL), /^### 4\. /);
    for (const token of ["test-plan.md", "mockups/**", "mockups/AGENTS.md"]) expect(step4).toContain(token);
  });

  it("W5: the dashboard mockup adapter binds the Pending change marker", () => {
    const binding = read(MOCKUP_ADAPTER)
      .split(/\r?\n/)
      .find((l) => /MOCKUP binding:/.test(l));
    expect(binding).toBeDefined();
    expect(binding).toContain("Pending change:");
    expect(binding).toContain("openspec/changes/<name>/mockups/");
    expect(binding).toMatch(/no \|/);
    expect(binding).toMatch(/no backticks?/);
  });

  it("W6: every Pending change row in mockups/AGENTS.md is well-formed; no 'No change yet'", () => {
    const md = read(MOCKUPS_DOX);
    const exists = (name: string) => fs.existsSync(path.join(repoRoot, "mockups", name));
    expect(checkPendingRows(md, exists)).toEqual([]);
    expect(md).not.toContain("No change yet");
  });

  it("W7: the row check rejects marker drift", () => {
    const exists = (name: string) => name === "x";
    const valid = "| `x/` | Explore mockup. Pending change: compact openspec bar |";
    expect(checkPendingRows(valid, exists)).toEqual([]);
    const invalid: Record<string, string> = {
      casing: "| `x/` | Explore mockup. Pending Change: compact bar |",
      midCell: "| `x/` | Explore mockup. Pending change: compact bar | trailing text |",
      backtick: "| `x/` | Explore mockup. Pending change: the `bar` |",
      escapedPipe: "| `x/` | Explore mockup. Pending change: a \\| b |",
      owned: "| `x/` | Explore mockup. See change: foo. Pending change: bar |",
      escapes: "| `../x` | Explore mockup. Pending change: compact bar |",
      missing: "| `gone/` | Explore mockup. Pending change: compact bar |",
    };
    for (const [label, row] of Object.entries(invalid)) {
      const v = checkPendingRows(row, exists);
      expect(v, label).toHaveLength(1);
      expect(v[0].row, label).toBe(row);
      expect(v[0].reason, label).not.toBe("");
    }
  });

  it("W8: mockups/AGENTS.md header documents the Pending change convention", () => {
    const md = read(MOCKUPS_DOX);
    const header = md.slice(0, md.indexOf("| File |"));
    expect(header).toContain("Pending change:");
    expect(header).toContain("See change:");
    expect(header).toMatch(/never adopted/);
  });

  it("W9: DOX rows for the touched skills carry this change", () => {
    const md = read(SKILLS_DOX);
    const row = (file: string) => md.split(/\r?\n/).find((l) => l.startsWith(`| \`${file}\``)) ?? "";
    const plan = row("plan-proposal/SKILL.md");
    const adapter = row("frontend-mockup-loop-dashboard/SKILL.md");
    expect(plan).toContain(`See change: ${CHANGE}`);
    expect(plan).toContain("See change: add-openspec-pipeline-orchestrators");
    expect(adapter).toContain(`See change: ${CHANGE}`);
  });
});
