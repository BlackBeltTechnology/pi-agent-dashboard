#!/usr/bin/env node
/**
 * Affected-test selector CLI (change: speed-up-ci-affected-tests).
 *
 *   node scripts/select-affected-tests.mjs --base <ref> [--merge-base] [--head <ref>] --out selection.json
 *   node scripts/select-affected-tests.mjs --full [--reason <text>] --out selection.json
 *
 * Writes the selection JSON (mode, reason, per-file layer, shard assignment,
 * real-process + packaging-scenario sets, audit lists) and, when
 * $GITHUB_STEP_SUMMARY is set, a Markdown summary. Every failure path yields
 * `mode: "full"` and exit 0 — the selector must never let CI run fewer tests
 * because it broke. If even test enumeration fails, `enumerated: false` tells
 * the workflow to fall back to `vitest --shard` over everything.
 *
 * Test hook: SELECT_AFFECTED_TEST_THROW=1 throws before enumeration (test-plan X2).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decide, SHARD_COUNT } from "./test-selection/decide.mjs";
import { resolveDiff } from "./test-selection/git-diff.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, "test-selection");

function parseArgs(argv) {
  const args = { full: false, mergeBase: false, head: "HEAD", out: "selection.json", cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--full") args.full = true;
    else if (a === "--merge-base") args.mergeBase = true;
    else if (a === "--base") args.base = argv[++i];
    else if (a === "--head") args.head = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--reason") args.reason = argv[++i];
    else if (a === "--cwd") args.cwd = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function loadData() {
  return {
    triggers: readJson(path.join(DATA_DIR, "triggers.json"), {}),
    coveredElsewhere: readJson(path.join(DATA_DIR, "covered-elsewhere.json"), []),
    slowTier: readJson(path.join(DATA_DIR, "slow-tier.json"), []),
  };
}

/** Selection for when nothing could be enumerated: the workflow shards everything itself. */
export function unenumeratedFull(reason) {
  return {
    mode: "full",
    reason,
    enumerated: false,
    changed: [],
    selected: {},
    shards: Array.from({ length: SHARD_COUNT }, () => []),
    shardLoads: Array(SHARD_COUNT).fill(0),
    realProcess: [],
    ciScenarios: true,
    ciScenariosFiles: [],
    counts: {},
    unmapped: [],
    leafErrors: [],
    openEdges: [],
    slowTierDeselected: [],
    unknownTimingShare: 0,
  };
}

const list = (xs, max = 50) =>
  xs.length ? `${xs.slice(0, max).map((x) => `- \`${Array.isArray(x) ? `${x[0]}\` — ${x[1]}` : `${x}\``}`).join("\n")}${xs.length > max ? `\n- … ${xs.length - max} more` : ""}` : "_none_";

/** Markdown job summary: mode, reason, per-layer counts, audit lists. */
export function renderSummary(sel) {
  const c = sel.counts ?? {};
  const rows = [
    ["global", c.global ?? 0],
    ["graph", c.graph ?? 0],
    ["open edge", c.openEdge ?? 0],
    ["always-run", c.always ?? 0],
    ["path literal", c.pathLiteral ?? 0],
    ["package fallback", c.packageFallback ?? 0],
    ["trigger map", c.triggerMap ?? 0],
    ["slow-tier deselections", c.slowTierDeselected ?? 0],
  ];
  const selectedCount = Object.keys(sel.selected ?? {}).length;
  return [
    "## Test selection",
    "",
    `**Mode:** \`${sel.mode}\`${sel.enumerated === false ? " (tests NOT enumerated — shards fall back to `vitest --shard`)" : ""}`,
    "",
    `**Reason:** ${sel.reason}`,
    "",
    `Selected ${selectedCount} test file(s) · real-process ${sel.realProcess.length} · packaging scenarios ${sel.ciScenarios ? `on (${sel.ciScenariosFiles.length})` : "off"} · shard files ${sel.shards.map((s) => s.length).join("/")} · shard load (s) ${sel.shardLoads.join("/")}`,
    "",
    "| layer | files |",
    "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    "",
    `Share of selected files with no timing data: ${(sel.unknownTimingShare * 100).toFixed(1)}%`,
    "",
    "### Unmapped files",
    list(sel.unmapped),
    "",
    "### Leaf errors (modules that failed to transform)",
    list(sel.leafErrors),
    "",
    "### Open edges (computed dynamic import)",
    list(sel.openEdges),
    "",
    "### Slow-tier deselections",
    list(sel.slowTierDeselected),
    "",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  let selection;
  try {
    args = parseArgs(argv);
  } catch (e) {
    args = { out: "selection.json", cwd: process.cwd() };
    selection = unenumeratedFull(`selector error: ${e.message}`);
  }
  if (!selection) {
    try {
      const diff = args.full ? { full: args.reason || "--full requested" } : resolveDiff({ base: args.base, head: args.head, cwd: args.cwd, mergeBase: args.mergeBase });
      if (process.env.SELECT_AFFECTED_TEST_THROW === "1") throw new Error("forced by SELECT_AFFECTED_TEST_THROW");
      const { buildTestIndex } = await import("./test-selection/graph.mjs");
      let index;
      let graphError = null;
      try {
        index = await buildTestIndex({ root: args.cwd, withGraph: !diff.full });
      } catch (e) {
        graphError = `selector error: graph build failed: ${String(e?.message ?? e).split("\n")[0]}`;
        index = await buildTestIndex({ root: args.cwd, withGraph: false });
      }
      selection = decide({
        changed: diff.changed ?? [],
        forceFull: graphError ?? diff.full ?? null,
        index,
        data: loadData(),
        timings: readJson(path.join(DATA_DIR, "timings.json"), {}),
      });
      selection.enumerated = true;
      selection.base = diff.base ?? null;
      selection.graphMs = index.ms;
    } catch (e) {
      selection = unenumeratedFull(`selector error: ${String(e?.message ?? e).split("\n")[0]}`);
    }
  }
  fs.writeFileSync(path.resolve(args.cwd, args.out), `${JSON.stringify(selection, null, 1)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderSummary(selection));
  if (process.env.GITHUB_OUTPUT) {
    const hasRp = selection.enumerated === false || selection.realProcess.length > 0;
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `mode=${selection.mode}\nhas_real_process=${hasRp}\nci_scenarios=${selection.ciScenarios}\n`,
    );
  }
  console.log(`[select-affected-tests] mode=${selection.mode} selected=${Object.keys(selection.selected).length} reason=${selection.reason}`);
  return selection;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      // Last resort: still exit 0 with a full selection on disk.
      try {
        fs.writeFileSync("selection.json", `${JSON.stringify(unenumeratedFull(`selector crash: ${e?.message ?? e}`), null, 1)}\n`);
      } catch {
        /* nothing more to do */
      }
      process.exit(0);
    },
  );
}
