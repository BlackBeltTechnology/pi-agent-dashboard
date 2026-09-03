#!/usr/bin/env node
/**
 * Populate the fixture's OpenSpec board with groups and changes.
 *
 * The harness fixture ships exactly ONE active change (`e2e-artifact-demo`)
 * and no groups file at all, so the board screenshots as a single card in an
 * "Ungrouped" column — structurally empty.
 *
 * Two independent inputs drive the board:
 *
 *   1. CHANGES  — directories under `openspec/changes/<name>/`. Status is
 *      derived from `tasks.md` checkbox tallies: no `- [ ]` lines at all →
 *      "no-tasks", some checked → "in-progress", all checked → "complete".
 *      The P/D/S/T badges are literally "does proposal.md / design.md /
 *      specs/ / tasks.md exist", so varying the artifact set per change is
 *      what makes the badge row interesting.
 *
 *   2. GROUPS   — `openspec/groups/groups.json`, shape
 *      `{ schemaVersion, groups[], assignments{}, changeOrder{} }` per
 *      OpenSpecGroupsFile. `assignments` maps changeName → groupId; a change
 *      with no entry lands in the implicit Ungrouped column
 *      (OPENSPEC_UNGROUPED_KEY = "__ungrouped__").
 *
 * `e2e-artifact-demo` is left untouched — other e2e specs assert on it.
 *
 * TWO fixtures are seeded. `/fixtures/sample-git` backs the folder card's
 * "N changes" pill; `/fixtures/openspec-board` is what the board, Specs and
 * Archive scenarios actually navigate to, and it shipped with nothing but a
 * `config.yaml` — which is why the board screenshotted as "0 changes".
 * The board fixture also gets main specs (`openspec/specs/<cap>/spec.md`) and
 * dated archive entries, since the Specs and Archive browsers read those and
 * not `changes/`.
 *
 *   node design-scratch/shots/board.mjs [--port 18916]
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGE = join(HERE, "fixture-openspec");
const TARGETS = ["/fixtures/sample-git", "/fixtures/openspec-board"];
const SCHEMA_VERSION = 1;
const UNGROUPED = "__ungrouped__";

const portArg = process.argv.indexOf("--port");
const PORT = portArg === -1 ? (process.env.PW_E2E_PORT ?? "18916") : process.argv[portArg + 1];

// ── Board content ────────────────────────────────────────────────
// Names and copy follow this repo's own idiom so the board reads like real
// work in flight rather than Lorem/Acme filler.

const GROUPS = [
  { id: "now-shipping", name: "Now — shipping", color: "#2563eb", order: 0 },
  { id: "next-up", name: "Next up", color: "#7e22ce", order: 1 },
  { id: "investigating", name: "Investigating", color: "#a16207", order: 2 },
  { id: "blocked", name: "Blocked", color: "#b91c1c", order: 3 },
];

/**
 * done/total drives the status pill and the progress bar.
 * `design` / `spec` toggle the D and S badges.
 */
const CHANGES = [
  {
    name: "redesign-openspec-board",
    group: "now-shipping",
    why: "The board sorts changes by name only, so a reader cannot tell what is actually moving. Grouping exists in the data model but has no UI.",
    what: ["Add per-repo groups with colour and order.", "Persist manual change ordering per column.", "Join `groupId` server-side so clients never recompute it."],
    done: 7, total: 7, design: true, spec: true,
  },
  {
    name: "speed-up-diff-rendering",
    group: "now-shipping",
    why: "A 4k-line diff blocks the event loop for ~1.2s and the whole shell stops painting mid-scroll.",
    what: ["Move hunk parsing off the main thread.", "Virtualise the hunk list.", "Cache highlight runs per file revision."],
    done: 5, total: 5, design: true, spec: false,
  },
  {
    name: "add-session-cost-rollup",
    group: "now-shipping",
    why: "Per-session cost is visible on a card but there is no folder or workspace total, so spend is impossible to reason about.",
    what: ["Sum cost per folder and per workspace.", "Surface a rollup pill on the folder header.", "Break the total down by model in a popover."],
    done: 4, total: 9, design: true, spec: true,
  },
  {
    name: "add-worktree-auto-cleanup",
    group: "next-up",
    why: "Shipped worktrees linger on disk until someone notices. A stale worktree still shows a folder card.",
    what: ["Detect merged branches with no live session.", "Offer a batch cleanup with a dry-run preview."],
    done: 1, total: 8, design: false, spec: true,
  },
  {
    name: "add-mobile-swipe-actions",
    group: "next-up",
    why: "Every session action needs the overflow menu on a phone, which is three taps for a resume.",
    what: ["Swipe right to resume, left to hide.", "Respect prefers-reduced-motion.", "Keep a 44px minimum touch target."],
    done: 3, total: 5, design: true, spec: false,
  },
  {
    name: "add-model-usage-charts",
    group: "next-up",
    why: "Token and cost history is recorded but never shown, so nobody can see which model is eating the budget.",
    what: ["Chart tokens and cost over time.", "Break down by provider and model.", "Export the window as CSV."],
    done: 2, total: 7, design: false, spec: false,
  },
  {
    name: "harden-gateway-auth",
    group: "investigating",
    why: "The gateway trusts any caller on a trusted network. That is fine on a laptop and wrong the moment a tunnel is open.",
    what: ["Threat-model the tunnel path.", "Decide between per-device tokens and mTLS."],
    done: 0, total: 0, design: true, spec: false,
  },
  {
    name: "migrate-plugin-registry",
    group: "investigating",
    why: "Plugin metadata is split across three files that drift. A plugin can be installed, listed and still not load.",
    what: ["Collapse to a single manifest.", "Validate on load with a clear error.", "Keep a back-compat read path for one release."],
    done: 6, total: 11, design: true, spec: true,
  },
  {
    name: "fix-terminal-resize-flicker",
    group: "blocked",
    why: "Resizing the inline terminal reflows twice and the cursor jumps a line. Blocked on an upstream xterm fix.",
    what: ["Debounce the fit call.", "Pin the viewport row during reflow."],
    done: 2, total: 6, design: false, spec: false,
  },
  {
    name: "fix-flow-retry-storm",
    group: "blocked",
    why: "A failing flow step retries without backoff and can issue hundreds of calls a minute. Needs a repro before any fix.",
    what: ["Reproduce deterministically.", "Add exponential backoff with a cap."],
    done: 0, total: 0, design: false, spec: false,
  },
  {
    // Deliberately unassigned — proves the implicit Ungrouped column renders.
    name: "add-keyboard-shortcut-help",
    group: null,
    why: "Shortcuts exist but are undiscoverable; there is no overlay listing them.",
    what: ["Add a `?` overlay.", "Generate it from the keymap so it cannot drift."],
    done: 0, total: 4, design: false, spec: false,
  },
];

// ── Artifact writers ─────────────────────────────────────────────

const title = (name) => name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

function proposalMd(c) {
  return `# Proposal — ${title(c.name)}

## Why

${c.why}

## What Changes

${c.what.map((w) => `- ${w}`).join("\n")}

## Discipline Skills

${c.name.startsWith("harden") ? "- `security-hardening` — the auth surface is the whole point of this change."
  : c.name.startsWith("speed-up") ? "- `performance-optimization` — measure before touching the render path."
  : c.name.startsWith("fix-") ? "- `systematic-debugging` — reproduce before proposing a fix."
  : "None apply: this change adds UI surface with no new external call, auth path or latency budget."}
`;
}

function designMd(c) {
  return `# Design — ${title(c.name)}

## Context

${c.why}

## Decision

${c.what[0]} The alternative — deferring this to the client — was rejected
because every client would have to reimplement the same join and they would
drift.

## Risks

- Back-compat: existing on-disk state must keep loading unchanged.
- Rollback: the change is additive, so reverting the commit is sufficient.
`;
}

function tasksMd(c) {
  if (c.total === 0) return null; // no tasks.md at all → status "no-tasks"
  const lines = [`# Tasks — ${title(c.name)}`, "", "## 1. Implementation", ""];
  for (let i = 1; i <= c.total; i++) {
    const box = i <= c.done ? "x" : " ";
    lines.push(`- [${box}] 1.${i} ${c.what[(i - 1) % c.what.length]}`);
  }
  return `${lines.join("\n")}\n`;
}

function specMd(c) {
  const cap = c.name.replace(/^(add|fix|speed-up|harden|migrate|redesign)-/, "");
  return `# ${cap}

## ADDED Requirements

### Requirement: ${title(cap)}

The dashboard SHALL ${c.what[0].replace(/^./, (ch) => ch.toLowerCase()).replace(/\.$/, "")}.

#### Scenario: ${cap} applies

- **WHEN** a user opens the affected surface
- **THEN** the new behaviour is visible without a reload
`;
}

/** Main (already-shipped) capability specs — what the Specs browser lists. */
const SPECS = [
  { cap: "session-monitoring", req: "Session state is visible at a glance",
    text: "The dashboard SHALL show every known session with its state, model and elapsed time",
    when: "a session changes state", then: "its card reflects the new state within one broadcast" },
  { cap: "git-worktrees", req: "Worktrees are first-class",
    text: "The dashboard SHALL allow spawning a session in a new git worktree from the folder card",
    when: "a user picks New Worktree", then: "a branch is created and a session starts in it" },
  { cap: "openspec-board", req: "Changes are groupable",
    text: "The board SHALL persist per-repo groups and change assignments on disk",
    when: "a card is dragged between columns", then: "the assignment survives a reload" },
  { cap: "remote-access", req: "Access from anywhere",
    text: "The dashboard SHALL expose a tunnel with a scannable QR code",
    when: "a tunnel is enabled", then: "a QR code encoding the public URL is shown" },
];

/** Already-archived changes — what the Archive browser lists. */
const ARCHIVED = [
  { date: "2026-08-14", name: "add-openspec-change-grouping", total: 17 },
  { date: "2026-07-28", name: "fix-session-diff-eventloop-block", total: 6 },
  { date: "2026-07-15", name: "add-auto-session-naming", total: 12 },
];

function mainSpecMd(s) {
  return `# ${s.cap}

## Purpose

${s.text}.

## Requirements

### Requirement: ${s.req}

${s.text}.

#### Scenario: ${s.req.toLowerCase()}

- **WHEN** ${s.when}
- **THEN** ${s.then}
`;
}

// ── Generate ─────────────────────────────────────────────────────

rmSync(STAGE, { recursive: true, force: true });
const changesDir = join(STAGE, "changes");

for (const c of CHANGES) {
  const dir = join(changesDir, c.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "proposal.md"), proposalMd(c));
  if (c.design) writeFileSync(join(dir, "design.md"), designMd(c));
  const tasks = tasksMd(c);
  if (tasks) writeFileSync(join(dir, "tasks.md"), tasks);
  if (c.spec) {
    const cap = c.name.replace(/^(add|fix|speed-up|harden|migrate|redesign)-/, "");
    mkdirSync(join(dir, "specs", cap), { recursive: true });
    writeFileSync(join(dir, "specs", cap, "spec.md"), specMd(c));
  }
}

// groups.json — groups + assignments + per-column manual ordering.
const assignments = {};
const changeOrder = { [UNGROUPED]: [] };
for (const g of GROUPS) changeOrder[g.id] = [];
for (const c of CHANGES) {
  if (c.group) {
    assignments[c.name] = c.group;
    changeOrder[c.group].push(c.name);
  } else {
    changeOrder[UNGROUPED].push(c.name);
  }
}
changeOrder[UNGROUPED].push("e2e-artifact-demo");

mkdirSync(join(STAGE, "groups"), { recursive: true });
writeFileSync(
  join(STAGE, "groups", "groups.json"),
  `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, groups: GROUPS, assignments, changeOrder }, null, 2)}\n`,
);

// Main specs — read by the Specs browser, NOT by the board.
for (const s of SPECS) {
  mkdirSync(join(STAGE, "specs", s.cap), { recursive: true });
  writeFileSync(join(STAGE, "specs", s.cap, "spec.md"), mainSpecMd(s));
}

// Archive — dated directories, all tasks checked (an archived change is done).
for (const a of ARCHIVED) {
  const dir = join(changesDir, "archive", `${a.date}-${a.name}`);
  mkdirSync(join(dir, "specs", a.name), { recursive: true });
  const c = {
    name: a.name, done: a.total, total: a.total,
    why: `Shipped ${a.date}. Retained as immutable history.`,
    what: ["Land the change behind its spec delta.", "Sync delta specs into the main specs tree."],
  };
  writeFileSync(join(dir, "proposal.md"), proposalMd(c));
  writeFileSync(join(dir, "tasks.md"), tasksMd(c));
  writeFileSync(join(dir, "specs", a.name, "spec.md"), specMd(c));
}

// ── Ship into the running container ──────────────────────────────

const C = execFileSync("docker",
  ["ps", "--filter", `publish=${PORT}`, "--format", "{{.Names}}"], { encoding: "utf8" }).trim().split("\n")[0];
if (!C) throw new Error(`no container publishing port ${PORT}`);

// docker cp cannot write these paths (writable layer, not a bind) — stream a tar.
const tar = execFileSync("tar", ["-cf", "-", "-C", STAGE, "changes", "groups", "specs"], {
  maxBuffer: 64 * 1024 * 1024, encoding: "buffer",
});
for (const fix of TARGETS) {
  execFileSync("docker", ["exec", C, "sh", "-lc", `mkdir -p ${fix}/openspec`]);
  execFileSync("docker", ["exec", "-i", C, "tar", "-xf", "-", "-C", `${fix}/openspec`], { input: tar });
}

const counts = CHANGES.reduce((a, c) => {
  const s = c.total === 0 ? "no-tasks" : c.done === c.total ? "complete" : "in-progress";
  a[s] = (a[s] ?? 0) + 1;
  return a;
}, {});
console.log(`${CHANGES.length} changes → ${TARGETS.join(" + ")}`);
console.log(`  ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
console.log(`${GROUPS.length} groups + ${Object.keys(assignments).length} assignments → openspec/groups/groups.json`);
console.log(`${SPECS.length} main specs, ${ARCHIVED.length} archived changes`);
