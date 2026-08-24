#!/usr/bin/env node
/**
 * Structural repair for corrupted OpenSpec main specs.
 *
 * `MarkdownParser.parseSpec` requires an h2 titled exactly `Purpose` and an h2
 * titled exactly `Requirements`, and throws otherwise. A change's delta spec
 * legitimately uses `## ADDED Requirements`; when the archive path copies one to
 * `openspec/specs/<cap>/spec.md` verbatim, every `### Requirement:` beneath it
 * becomes invisible to validate/list/show/archive.
 *
 * Three rules exist because their failure mode is SILENT:
 *   1. The FIRST delta header is promoted, every subsequent one is DELETED.
 *      `findSection` returns the first match, so renaming the second yields a
 *      `## Requirements` nobody reads — validate green, requirements still gone.
 *   2. `## REMOVED Requirements` is refused, never promoted. Those requirements
 *      were deliberately retired; promoting them republishes dead behaviour as
 *      current spec.
 *   3. Validation runs AGAIN after the write. The missing-Purpose throw
 *      short-circuits before the delta check, so a spec can report one error
 *      before repair and a different one after.
 *
 * Kept in scripts/ rather than deleted after use: the upstream archive defect is
 * unfixed, so drift will recur.
 *
 * Usage:
 *   node scripts/repair-main-specs.mjs [--dry-run] [--specs-dir <path>]
 *
 * See change: repair-corrupted-main-specs.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DELTA_HEADER = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\b.*$/i;
const REMOVED_HEADER = /^##\s+REMOVED\s+Requirements\b.*$/i;
const PLAIN_REQUIREMENTS = /^##\s+Requirements\s*$/i;
const PURPOSE_HEADER = /^##\s+Purpose\s*$/i;
const H1 = /^#\s+/;

export const PLACEHOLDER =
  "TODO(repair): describe what this capability is for, derived from its own requirement text.";

/**
 * Structural facts about a main spec, computed without the openspec parser so
 * the tool can classify files the parser refuses to read.
 */
export function classifySpec(text) {
  const lines = text.split("\n");
  const deltaHeaders = lines.filter((l) => DELTA_HEADER.test(l));
  const hasPurpose = lines.some((l) => PURPOSE_HEADER.test(l));
  const hasRequirements = lines.some((l) => PLAIN_REQUIREMENTS.test(l));
  const hasRemoved = lines.some((l) => REMOVED_HEADER.test(l));
  const hasH1 = lines.some((l) => H1.test(l));
  return {
    hasPurpose,
    hasRequirements,
    hasRemoved,
    hasH1,
    deltaHeaderCount: deltaHeaders.length,
    requirementCount: lines.filter((l) => /^###\s+Requirement:/.test(l)).length,
    conforming: hasPurpose && hasRequirements && deltaHeaders.length === 0,
  };
}

/**
 * Pure repair. Returns { text, changed, refused, reason }.
 *
 * Refuses (leaving `text` byte-identical) when a REMOVED block is present —
 * deciding between deletion, restoration, and tombstoning needs a human.
 */
export function repairSpecText(original, capabilityName) {
  const info = classifySpec(original);

  if (info.hasRemoved) {
    return {
      text: original,
      changed: false,
      refused: true,
      reason:
        "contains `## REMOVED Requirements` — retired requirements must not be promoted; handle manually (delete, tombstone, or restore)",
    };
  }
  if (info.conforming) return { text: original, changed: false, refused: false };

  const lines = original.split("\n");
  const out = [];
  // A plain `## Requirements` already present means EVERY delta header in this
  // file is a duplicate section (cohort E) and must be deleted, not promoted.
  let requirementsSeen = info.hasRequirements;

  for (const line of lines) {
    if (DELTA_HEADER.test(line)) {
      if (requirementsSeen) continue; // drop: requirements re-parent upward
      requirementsSeen = true;
      out.push("## Requirements");
      continue;
    }
    out.push(line);
  }

  let text = out.join("\n");

  // Cohort B: bare `### Requirement:` blocks with no enclosing h2 at all. No
  // delta header existed to promote, so the section has to be created. Guarded
  // on there being a requirement to enclose — a spec with none is a retired
  // capability needing a human (tombstone or delete), not an empty section.
  if (!requirementsSeen && info.requirementCount > 0) text = insertRequirements(text);

  if (!info.hasPurpose) text = insertPurpose(text);
  if (!info.hasH1) text = `# ${capabilityName} Specification\n\n${text.replace(/^\n+/, "")}`;

  text = collapseBlankRuns(text);
  return { text, changed: text !== original, refused: false };
}

/**
 * Collapse runs of blank lines left behind by a deleted header — but never
 * inside a fenced code block, where blank lines are content. A naive global
 * /\n{3,}/ silently rewrites example blocks, which would breach this change's
 * "no requirement text is edited" boundary.
 */
function collapseBlankRuns(text) {
  const lines = text.split("\n");
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "" && out.length > 0 && out[out.length - 1].trim() === "") {
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Wrap orphaned `### Requirement:` blocks in the section the parser needs. */
function insertRequirements(text) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^###\s+Requirement:/.test(l));
  return [...lines.slice(0, at), "## Requirements", "", ...lines.slice(at)].join("\n");
}

/** Insert a marked `## Purpose` immediately before the Requirements section. */
function insertPurpose(text) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => PLAIN_REQUIREMENTS.test(l));
  const block = ["## Purpose", "", PLACEHOLDER, ""];
  if (at === -1) return [...block, ...lines].join("\n");
  return [...lines.slice(0, at), ...block, ...lines.slice(at)].join("\n");
}

/** `openspec validate <cap> --type spec` → true when the spec parses cleanly. */
function validates(capability, cwd) {
  try {
    execFileSync("openspec", ["validate", capability, "--type", "spec", "--no-interactive"], {
      cwd,
      stdio: "pipe",
    });
    return { ok: true };
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    return { ok: false, output: out.trim() };
  }
}

function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const dirFlag = argv.indexOf("--specs-dir");
  const specsDir =
    dirFlag === -1 ? path.join(process.cwd(), "openspec/specs") : path.resolve(argv[dirFlag + 1]);
  // `openspec validate` resolves the nearest openspec/ root from its cwd, so it
  // must run beside the tree being repaired — not beside process.cwd(), or a
  // --specs-dir run would validate a different tree than it just wrote.
  const repoRoot = path.resolve(specsDir, "../..");

  const capabilities = fs
    .readdirSync(specsDir)
    .filter((d) => fs.existsSync(path.join(specsDir, d, "spec.md")))
    .sort();

  const repaired = [];
  const refused = [];

  for (const cap of capabilities) {
    const file = path.join(specsDir, cap, "spec.md");
    const original = fs.readFileSync(file, "utf8");
    const res = repairSpecText(original, cap);

    if (res.refused) {
      refused.push({ cap, file, reason: res.reason });
      continue;
    }
    if (!res.changed) continue;

    if (!dryRun) fs.writeFileSync(file, res.text);
    repaired.push({ cap, file });
  }

  for (const { cap, reason } of refused) console.error(`REFUSED  ${cap}: ${reason}`);
  for (const { cap } of repaired) console.log(`${dryRun ? "would repair" : "repaired"}  ${cap}`);

  if (dryRun) {
    console.log(`\n${repaired.length} would be repaired, ${refused.length} refused (dry run).`);
    return refused.length > 0 ? 1 : 0;
  }

  // Phase two. The missing-Purpose throw masks every later check, so a spec that
  // reported one error before the write can report a different one after it.
  const stillFailing = [];
  for (const { cap } of repaired) {
    const v = validates(cap, repoRoot);
    if (!v.ok) stillFailing.push({ cap, output: v.output });
  }

  console.log(`\n${repaired.length} repaired, ${refused.length} refused.`);
  if (stillFailing.length > 0) {
    console.error(`\n${stillFailing.length} spec(s) still fail AFTER repair (phase-two errors):`);
    for (const { cap, output } of stillFailing) console.error(`\n--- ${cap}\n${output}`);
  }
  return refused.length + stillFailing.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
