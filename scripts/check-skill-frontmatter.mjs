#!/usr/bin/env node
/**
 * Skill frontmatter guard.
 *
 * Severities mirror pi's own behaviour, and each finding names where its rule
 * comes from:
 *
 *   error   · `description` missing or empty after trimming   · pi drops the skill
 *   warning · `description` over 1024 chars                   · pi MAX_DESCRIPTION_LENGTH
 *   warning · `name` over 64 chars                            · pi MAX_NAME_LENGTH
 *   warning · `name` not matching ^[a-z0-9-]+$                · pi validateName
 *   warning · `name` with leading/trailing/double hyphens     · pi validateName
 *   warning · `description` over 400 chars                    · repository budget
 *
 * The 400-char budget is a repository context-cost policy, never an error, and
 * never applied to the wording-locked skills. A house rule wearing pi's badge
 * would invite a future reader to "fix" it in the wrong direction, so the
 * source label is part of every finding.
 *
 * Exit code: non-zero iff at least one error. Warnings never fail the run.
 *
 * See change: fix-skill-discovery-parity, fix-skill-frontmatter-yaml.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export const REPO_ROOT = resolve(import.meta.dirname, "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "out",
  "worktrees",
  ".worktrees",
]);

/** pi's own limits (core/skills.ts). */
export const PI_MAX_DESCRIPTION_LENGTH = 1024;
export const PI_MAX_NAME_LENGTH = 64;
/** Repository context-cost budget. Warning only, never an error. */
export const REPO_DESCRIPTION_BUDGET = 400;

/**
 * Skills whose description wording is locked by the shipped
 * `skill-frontmatter-validity` requirement "The three previously-broken skills
 * load". The budget yields to that requirement rather than silently overriding it.
 *
 * The four entries after the original three carry deliberately trigger-rich
 * descriptions — that phrasing IS their discovery surface, so trimming them to
 * the budget would change which prompts auto-load them. Exempted rather than
 * reworded, which is the honest trade: the budget exists to bound context cost,
 * not to break skill discovery. Revisit if the exempt set keeps growing.
 */
export const BUDGET_EXEMPT_SKILLS = new Set([
  "ship-change",
  "frontend-mockup-loop",
  "anti-slop-frontend",
  "manage-flows",
  "software-cost-estimator",
  "bpmn-package-explorer",
  "openforms-mui",
]);

/** Recursively collect every SKILL.md path under `root`, skipping heavy dirs. */
export function collectSkillManifests(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.name === "SKILL.md") {
        found.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return found;
}

/** Extract the leading `---`-fenced frontmatter block. Returns null if absent. */
function extractFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

function finding(severity, source, rule, file, message) {
  return { severity, source, rule, file, message };
}

/** `description` rules: missing is fatal to pi; the two length caps only warn. */
function checkDescription(file, skillId, parsed) {
  const description = typeof parsed?.description === "string" ? parsed.description : undefined;
  if (!description || description.trim().length === 0) {
    return [finding("error", "pi", "description-missing", file, "`description` must be a non-empty string")];
  }

  const findings = [];
  if (description.length > PI_MAX_DESCRIPTION_LENGTH) {
    findings.push(
      finding("warning", "pi", "description-too-long", file, `description is ${description.length} chars (pi limit ${PI_MAX_DESCRIPTION_LENGTH})`),
    );
  }
  if (description.length > REPO_DESCRIPTION_BUDGET && !BUDGET_EXEMPT_SKILLS.has(skillId)) {
    findings.push(
      finding("warning", "repository", "description-over-budget", file, `description is ${description.length} chars (repository budget ${REPO_DESCRIPTION_BUDGET})`),
    );
  }
  return findings;
}

/** `name` rules: all of pi's, all warnings (pi warns and loads). */
function checkName(file, parsed) {
  const name = typeof parsed?.name === "string" ? parsed.name : undefined;
  if (!name) return [];

  const findings = [];
  if (name.length > PI_MAX_NAME_LENGTH) {
    findings.push(finding("warning", "pi", "name-too-long", file, `name is ${name.length} chars (pi limit ${PI_MAX_NAME_LENGTH})`));
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    findings.push(finding("warning", "pi", "name-charset", file, "name must match ^[a-z0-9-]+$"));
  } else if (/^-|-$|--/.test(name)) {
    findings.push(finding("warning", "pi", "name-hyphens", file, "name must not have leading, trailing, or consecutive hyphens"));
  }
  return findings;
}

/**
 * Analyse one `SKILL.md`. Returns findings; the caller decides how to report.
 * `file` is used verbatim in findings, and its containing directory basename
 * is the skill identity used for the budget exemption.
 */
export function analyzeSkillFile(file, text) {
  const fm = extractFrontmatter(text);
  if (fm === null) {
    return [finding("error", "pi", "frontmatter-missing", file, "missing `---`-fenced frontmatter block")];
  }

  let parsed;
  try {
    parsed = parseYaml(fm);
  } catch (err) {
    return [finding("error", "pi", "frontmatter-unparseable", file, `frontmatter is not valid YAML: ${err.message}`)];
  }

  return [...checkDescription(file, basename(dirname(file)), parsed), ...checkName(file, parsed)];
}

/** Analyse every `SKILL.md` under `root`. */
export function analyzeRepository(root = REPO_ROOT) {
  const findings = [];
  const files = collectSkillManifests(root);
  for (const file of files) {
    findings.push(...analyzeSkillFile(relative(root, file), readFileSync(file, "utf8")));
  }
  return { files, findings };
}

export function formatFinding(f) {
  return `${f.severity === "error" ? "ERROR" : "warn "} [${f.source}/${f.rule}] ${f.file}: ${f.message}`;
}

function main() {
  const { files, findings } = analyzeRepository();
  for (const f of findings) console.log(formatFinding(f));
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  console.log(`\n${files.length} SKILL.md checked · ${errors.length} error(s) · ${warnings.length} warning(s)`);
  process.exit(errors.length > 0 ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
