#!/usr/bin/env node
/**
 * Seed the plugin-backed folder surfaces: Automations and Goals.
 *
 * Both routes are plugin `shell-overlay-route` contributions that render an
 * overlay ON TOP of the folder home — they were never broken, they were empty
 * ("No automations in this folder." / "No goals yet.").
 *
 * Two different write paths, because the two plugins store state differently:
 *
 *   Automations — plain files at `<cwd>/.pi/automation/<name>/automation.yaml`
 *     (plus a sibling `prompt.md` when the action is a prompt). A watcher on
 *     `<cwd>/.pi/automation` picks them up live, so no restart is needed.
 *
 *   Goals — NOT in the repo. They live in the dashboard data dir keyed by a
 *     hash of the cwd (`goal-store.ts:165`). Rather than reimplement
 *     `folderHash`, seed them through the REST API the UI itself uses.
 *
 *   node design-scratch/shots/plugins.mjs [--port 18916]
 */

import { execFileSync } from "node:child_process";

const portArg = process.argv.indexOf("--port");
const PORT = portArg === -1 ? (process.env.PW_E2E_PORT ?? "18916") : process.argv[portArg + 1];
const CWD = "/fixtures/sample-git";
const BASE = `http://127.0.0.1:${PORT}`;

const C = execFileSync("docker",
  ["ps", "--filter", `publish=${PORT}`, "--format", "{{.Names}}"], { encoding: "utf8" }).trim().split("\n")[0];
if (!C) throw new Error(`no container publishing port ${PORT}`);

// ── Automations ──────────────────────────────────────────────────

const AUTOMATIONS = [
  {
    name: "nightly-test-sweep",
    yaml: `on:
  kind: schedule
  cron: "0 3 * * *"
action:
  kind: prompt
  prompt: ./prompt.md
model: anthropic/claude-opus-4-7
mode: worktree
sandbox: workspace-write
concurrency: skip
visibility: shown
`,
    prompt: "Run the full test suite. If anything fails, open a change describing the\nsmallest fix and stop before implementing it.\n",
  },
  {
    name: "triage-new-issues",
    yaml: `on:
  kind: schedule
  cron: "*/30 * * * *"
action:
  kind: prompt
  prompt: ./prompt.md
model: anthropic/claude-sonnet-4-6
mode: local
sandbox: read-only
concurrency: queue
visibility: shown
`,
    prompt: "Read newly opened issues. Label each one, and flag anything that looks\nlike a regression against the last release.\n",
  },
  {
    name: "weekly-dependency-audit",
    yaml: `on:
  kind: schedule
  cron: "0 9 * * 1"
action:
  kind: prompt
  prompt: ./prompt.md
model: anthropic/claude-sonnet-4-6
mode: worktree
sandbox: workspace-write
concurrency: skip
visibility: shown
disabled: true
`,
    prompt: "Check every workspace for outdated or vulnerable dependencies and\nsummarise what is safe to bump.\n",
  },
];

// Heredoc-free: pipe each file in on stdin so YAML quoting survives intact.
for (const a of AUTOMATIONS) {
  const dir = `${CWD}/.pi/automation/${a.name}`;
  execFileSync("docker", ["exec", C, "sh", "-lc", `mkdir -p ${dir}`]);
  execFileSync("docker", ["exec", "-i", C, "sh", "-lc", `cat > ${dir}/automation.yaml`], { input: a.yaml });
  execFileSync("docker", ["exec", "-i", C, "sh", "-lc", `cat > ${dir}/prompt.md`], { input: a.prompt });
}
console.log(`${AUTOMATIONS.length} automations → ${CWD}/.pi/automation/`);

// ── Goals ────────────────────────────────────────────────────────

const GOALS = [
  {
    objective: "Cut cold-start time below 400 ms on a 200-session store",
    criteria: [
      { text: "Session scan is incremental, not a full re-read", done: true },
      { text: "First paint under 400 ms with 200 sessions", done: false },
      { text: "No regression in the reconnect path", done: false },
    ],
    budget: { maxTurns: 40, maxSpendUsd: 25 },
  },
  {
    objective: "Every folder surface reachable without a mouse",
    criteria: [
      { text: "Keymap covers all folder sub-routes", done: true },
      { text: "Shortcut overlay generated from the keymap", done: true },
      { text: "Focus ring visible on every interactive element", done: false },
    ],
    budget: { maxTurns: 25, maxSpendUsd: 15 },
  },
  {
    objective: "Ship the OpenSpec board redesign",
    criteria: [
      { text: "Groups persist per repo", done: true },
      { text: "Cards drag between columns", done: true },
      { text: "Column order survives reload", done: true },
    ],
    budget: { maxTurns: 60, maxSpendUsd: 40 },
  },
];

const q = `?cwd=${encodeURIComponent(CWD)}`;
let created = 0;
for (const g of GOALS) {
  const res = await fetch(`${BASE}/api/folders/goals${q}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(g),
  });
  const body = await res.json().catch(() => ({}));
  if (body?.success) created++;
  else console.warn(`  ! goal rejected: ${body?.error ?? res.status}`);
}
console.log(`${created}/${GOALS.length} goals → dashboard data dir (via REST)`);
