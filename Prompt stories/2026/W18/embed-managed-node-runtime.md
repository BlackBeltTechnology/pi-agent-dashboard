---
session: 019deee6
week: 2026/W18
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [embed-managed-node-runtime, manage-node-runtime-updates, spawn-failure-diagnostics, fix-stale-sessions-on-reconnect]
proposal_excerpt: "Today the Electron app bundles Node.js into `<app>/resources/node/` (`bundled-node-runtime` spec) and `bootstrapInstall` populates `~/.pi-dashboard/` with `pi-coding-agent`, `openspec`, and `tsx` against whatever Node…"
---

# How we did it: Embed a managed Node runtime — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was just **`commit proposal`** — two words. The *real* objective
only became clear as the session unfolded: **land the entire `embed-managed-node-runtime`
OpenSpec change end-to-end** — persist a managed Node copy at `~/.pi-dashboard/node/`,
wire it through the shared bootstrap, the ToolRegistry resolution chains, the Electron
installer, every server spawn site, `pi-core-updater`, and the doctor, with unit tests
per section, then run the full suite, archive the change, and commit. In practice this
was a 34-task spec-driven implementation where the human drove it forward with terse
control prompts (`give me commands to test`, `I've executed`, pasted test output) and
let the AI carry the design and code.

## 2. TL;DR playbook

1. **Commit the proposals first**, before touching code: `git add openspec/changes/<name> && git commit`. Get the spec artifacts on disk so the apply loop has a stable base.
2. **Kick the apply loop** with the `/opsx:apply <change>` skill. Let the AI announce `Using change: <name>`, read `openspec status --json` + `openspec instructions apply --json`, and confirm scope (34 tasks, which are deferred) before writing a line.
3. **Explore before editing.** Have the AI `grep`/`read` the real call sites (`bootstrap-install.ts`, `tool-registry/definitions.ts`, `process-manager.ts`, `doctor.ts`) so new code matches existing patterns.
4. **Implement section-by-section, one commit per section.** Pure helpers → registry wire-up → bootstrap chain → spawn-site PATH injection → updater refactor → doctor → docs. Each section = code + its unit test + a scoped commit message.
5. **When local test infra is broken, typecheck instead.** `npx tsc --noEmit` proves the new code compiles; hand the human the exact `npm test` commands to run on their working Node.
6. **Delegate all `docs/` writes to subagents** in caveman style (AGENTS.md protocol) — run the 8.x doc tasks in parallel.
7. **Triage the human's pasted failures into "mine vs pre-existing."** Fix the one snapshot your change legitimately broke; identify the rest (missing `remark-math`/`rehype-katex`) as unrelated and give the `npm install` fix.
8. **Archive cleanly** with `/opsx:archive` — but scope the archive commit to ONLY the change's own files; reset and redo if unrelated working-tree edits got swept in.
9. **Commit the remaining working-tree changes separately** at the end so each proposal lands as its own commit.

## 3. How the collaboration unfolded

**Phase 1 — Commit the base (Prompt 1).** `commit proposal` → the AI committed both
`embed-managed-node-runtime` and `manage-node-runtime-updates` proposals as separate
commits. *Effective because* it froze the spec before any code churn.

**Phase 2 — Apply-loop kickoff & scope confirmation (Prompt 2).** The `/opsx:apply`
skill body was pasted in. The AI announced the change, parsed `openspec status --json`
(0/34 tasks, spec-driven), and **paused to confirm scope** — flagging that 4 doc tasks
and 7 manual VM QA steps existed and would be deferred. *Decision point:* deferring the
VM QA to keep the session focused on code.

**Phase 3 — Section-by-section implementation.** The AI worked eight sections, each a
read→edit→test→commit micro-cycle:
- **§1 docker-make.sh** — bundle `npm.cmd`/`npx.cmd` (Windows precondition) + a script-text test.
- **§2 pure helpers** — `installManagedNode`, `prependManagedNodeToPath`, `managedRuntimeStrategy` + unit tests.
- **§3 ToolRegistry** — prepend the managed strategy to `node`/`npm` chains + a chain-order test.
- **§4 bootstrap** — wire `installManagedNode` into `installStandalone` + an ordering test.
- **§5–6 spawn sites + updater** — PATH prepend at every spawn; `defaultRunNpmUpdate` resolves via ToolRegistry and refuses a bare `spawn("npm")`.
- **§7 doctor** — idempotent repair of `~/.pi-dashboard/node/` + a new status row; made `runDoctor` async, removed a busy-wait.
- **§8 docs** — delegated to subagents.
*Effective because* each section committed independently, so a broken section never
blocked the others and the git history reads as a reviewable sequence.

**Phase 4 — Verify around broken local infra (Prompts 3–6).** Local vitest was blocked
(Node 25 + macOS DirectoryService made `os.userInfo()` throw in any `node -e`). The AI
pivoted to `npx tsc --noEmit`, then **handed the human copy-paste test commands** and
consumed the pasted results. The human ran them (`I've executed`) and pasted
`417 passed / 4262 tests` — green. *Decision point:* trust typecheck + human-run suite
instead of fighting the local Node.

**Phase 5 — Failure triage.** The human pasted 21 failed suites. The AI split them:
one snapshot mismatch **caused by** the new `managed` resolution row (fixed by editing
the `.snap`), the rest a **pre-existing** missing-dependency issue (`remark-math`), fixed
with `npm install`. *Effective because* it refused to "fix" failures its change didn't own.

**Phase 6 — Archive & final commits (Prompts 7–8).** `/opsx:archive` skill run. The AI
first swept in unrelated working-tree edits, **caught itself**, did `git reset HEAD~1`,
and re-committed scoped to only the archive renames + spec sync. Then `commit to git`
landed the two remaining proposals as clean separate commits.

## 4. Prompts that worked

- **Goal prompt — `commit proposal`.** Terse but fine here because the conversation
  context already named the change. *Stronger version for a cold start:* "Commit the
  `embed-managed-node-runtime` + `manage-node-runtime-updates` proposals as separate
  commits, then apply `embed-managed-node-runtime` section by section."
- **`give me commands to test`** — high-leverage. Instead of the AI thrashing against
  broken local infra, it produced a clean, labelled command block the human could run on
  a working Node. Delegating execution to the human is the right move when the agent's
  environment is the thing that's broken.
- **`I've executed` + pasting the summary line** — the tightest possible feedback loop.
  The human became the test runner; the AI stayed the analyst.
- **Pasting raw failure output** (Prompt 4) — gave the AI exact errors to triage rather
  than guesses. *Reusable pattern:* paste the failure tail, let the AI classify mine-vs-theirs.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| assume its local `npm test` would run | pasting real test output from their own shell | state up front "local Node is broken — I'll run tests, you give me commands + analyze paste" |
| sweep unrelated working-tree edits into the archive commit | (AI self-caught, but this is the risk) | say "commit ONLY this change's files; leave my in-progress proposals untouched" |
| treat every red suite as its own bug | pasting the full failure list so it could triage | ask explicitly "which failures are from MY change vs pre-existing?" |
| want to implement all 34 tasks | proposal scope defined manual VM QA as deferred | name the deferred tasks (1.3, 9–10 VM QA) in the kickoff |

The dominant guardrail: **when the agent's own runtime is broken, split roles** — human
runs, AI analyzes. Half the session was this loop and it worked smoothly once established.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session. Two **subagents** were spawned
(`general-purpose`): one to add 4 doc entries for the change, one to sync delta specs —
both isolating mechanical/doc work out of the main context per the AGENTS.md docs protocol.

*Recommended skill to create:* a **"typecheck-when-vitest-blocked"** project skill —
capturing the exact fallback (`npx tsc --noEmit`, filter known pre-existing errors, hand
the human a labelled `npm test` block) so the next Node-25/DirectoryService breakage
doesn't re-derive the workaround from scratch.

## 7. Pitfalls & dead ends

- **Node 25 + macOS DirectoryService** → `os.userInfo()` throws in ANY `node -e`, not
  just tests. Don't chase it as a test bug. **Fix:** typecheck locally, run the suite on
  a working Node (or delegate to the human).
- **Stale `.js`/`.d.ts`/`.js.map` next to a `.ts`** (`home-lock.*`) got accidentally
  staged. **Fix:** `git reset HEAD~1`, `rm` the compiled artifacts, re-stage only source.
- **Archive commit scope creep** — `/opsx:archive` picked up unrelated working-tree edits.
  **Fix:** `git reset HEAD~1`, re-add only the archive renames + spec sync.
- **Missing `remark-math`/`rehype-katex`** — surfaced as 25 client/flows failures AND two
  `tsc` errors. NOT your change. **Fix:** `npm install` (deps were in `package.json` but
  not on disk from a prior PR).
- **Adding a resolution strategy breaks bootstrap snapshots** — a new `managed` row lands
  in the resolution trail. **Fix:** update the affected `.snap` files (manually if update
  mode is blocked).

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; a working Node (or a human who'll run
tests); the `/opsx:apply` and `/opsx:archive` skill bodies.

1. `git add openspec/changes/<name> && git commit` — freeze the proposal.
2. `/opsx:apply <name>` → let the AI parse `openspec status/instructions --json`, confirm scope, name deferred tasks.
3. Explore real call sites before editing.
4. Implement one section at a time: code + unit test + scoped commit.
5. Verify: `npx tsc --noEmit` (filter known pre-existing errors); hand the human a labelled `npm test` block.
6. Delegate `docs/` writes to subagents (caveman style).
7. On pasted failures: fix only yours (snapshots), classify the rest as pre-existing (`npm install`).
8. `/opsx:archive <name>` → scope the commit to ONLY the change's files; `git reset` + redo if it sweeps extras.
9. Commit remaining working-tree changes as separate commits.

**Final artifacts:** 21 code files (helpers in `packages/shared/src/`, wired into
`tool-registry`, `process-manager`, `pi-core-updater`, `doctor`, `docker-make.sh`) + 11
new test files; change archived to
`openspec/changes/archive/2026-05-03-embed-managed-node-runtime/`; 4 delta specs synced;
`develop` 15 commits ahead of `origin/develop` (unpushed).

---

_Generated from session `019deee6` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-03. Source extract: `/tmp/session_facts.5377.1784862808.md`._
