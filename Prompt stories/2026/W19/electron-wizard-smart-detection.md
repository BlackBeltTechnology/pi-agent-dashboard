---
session: 019dfa91
week: 2026/W19
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (19 user prompts)"
upgrade_status: pending
openspec_changes: [unify-server-launch-ts-loader, replace-tsx-with-jiti, electron-wizard-smart-detection, simplify-electron-bootstrap-derived-state]
proposal_excerpt: "The dashboard server is launched from **five** call sites that each rederive loader resolution, argv shape, env, stdio, log paths, and readiness policy:"
---

# How we did it: retiring `tsx` and unifying the TS-loader launch path — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was three words: **"There was refactors. Check this proposal"** — pointed at
the stalled `electron-wizard-smart-detection` change. The *real* objective, which only
crystallized across 19 steering turns, was: **reconcile a pile of half-landed OpenSpec
proposals against the code that had drifted underneath them, then actually finish the
`tsx → jiti` runtime migration.** By the end that meant (a) pruning a dead Phase 3 out
of an archived proposal, (b) scaffolding a new `unify-server-launch-ts-loader` change to
consolidate 5 server-launch spawn sites and 3 jiti resolvers, (c) rewriting the
`replace-tsx-with-jiti` proposal until it was factually true against `develop`, and
(d) implementing it in a risk-gated order, then building and deploying.

The through-line: **the specs were fiction; the code was truth.** Most of the work was
teaching the AI to verify every claim in a proposal against the current tree before
touching anything.

## 2. TL;DR playbook

1. **Anchor on reality first.** Ask the AI to check an existing proposal against current
   code: *"Verify every factual claim in this proposal against the tree — list confirmed
   vs wrong."* Do this before any edit.
2. **Split obsolete from live.** Have it separate what a superseder already replaced from
   what's still real today, and prune dead phases out of archived proposals (leave a
   "DROPPED — out of scope" pointer, not orphan `[ ]` checkboxes).
3. **Scaffold the new change** with `openspec` and gate it on `openspec validate --strict`
   before committing.
4. **Re-verify after every gap.** Each time you say *"what's missing?"* the AI re-reads
   the code and finds more (call-site count off by one, wrong timeout constants, a 5th
   spawn site). Loop until the proposal matches the tree exactly.
5. **Commit in small, described chunks** — one commit per corrected proposal, each with a
   "verified on develop" rationale.
6. **Implement in a risk-gated subset.** When two changes are coupled, do the safe subset
   now and explicitly **defer** anything that would break dev runs until the sister change
   lands. State the defer reason in the commit.
7. **Resume when unblocked.** After the sister change archives, confirm the deferral reason
   is resolved *in code*, then finish the deferred tasks.
8. **Full rebuild per the FAQ**: `npm run build` + `POST /api/restart` + `npm run reload`.

## 3. How the collaboration unfolded

**Phase 1 — Audit the stalled change (Discovery).**
The AI read `electron-wizard-smart-detection/ARCHIVED.md`, found Phases 1–2 landed but
Phase 3 (tasks 17–19) never did and wasn't picked up by its superseder
(`simplify-electron-bootstrap-derived-state`). It grepped the tree for `resolveJiti`,
`launchDashboardServer`, `ToolResolver` and mapped what was genuinely obsolete vs still
real. **Why it worked:** the AI didn't trust the proposal's file paths — it located
`ToolResolver` at the *actual* `packages/shared/src/platform/binary-lookup.ts`, not the
path the doc claimed.

**Phase 2 — Prune + scaffold (Design).**
On the human's "1 2 3", the AI (1) fixed a stale `AGENTS.md` row, (2) replaced dead Phase 3
with a DROPPED note, and (3) scaffolded a new `unify-server-launch-ts-loader` change
(proposal + tasks + spec), passing `openspec validate --strict`. Committed as `1f2e553`,
leaving unrelated working-tree changes untouched after asking.

**Phase 3 — Correct the proposal against code (Verify loop).**
"is this make sense? Check the current state of code" triggered the highest-value pattern
of the session: the AI verified the proposal line-by-line and found it wrong — "3 separate
jiti resolvers" was really one shared module with two entry points plus 2 duplicate electron
wrappers; a cited `buildNodeImportArgv` helper didn't exist (the real one was
`spawnNodeScript`). It reframed the proposal to match reality, committed `f947960`.

**Phase 4 — Re-verify after drift (repeat).**
Days later: "Is this proposal valid still? There was lot of changes." Two commits had landed
(`647c0d6d` upstream jiti, `c52fdb2f` @earendil-works migration). The AI re-derived: core
premise still valid, but managed-pi package path was now wrong. Then "What is missing?"
surfaced *more* hard errors — call-site count was 5 not 4 (found `restart-helper.ts`),
timeouts were `30_000` not `5000`. Each round = read code → correct spec → commit.

**Phase 5 — Confirm tsx is really gone (research question).**
"Is tsx fully extruded from runtime?" → **"No. tsx is alive."** The AI found 4 install lists
still shipping tsx and 2 runtime-callable fallbacks, and split ownership cleanly between the
two coordinated proposals.

**Phase 6 — Risk-gated implementation.**
Applied `replace-tsx-with-jiti`: did the **safe subset** (bin wrapper → jiti-only + test,
package.json repoint) and **deferred** install-list/Doctor/devDep cleanup because the in-body
`cmdStart` tsx fallback still referenced tsx. Committed `bb089b8a` with the defer reason.
Once `unify-server-launch-ts-loader` archived, verified the fallback was gone *in code*, then
finished §4–§6 (`6009afc9`). Full rebuild + restart + reload to deploy.

## 4. Prompts that worked

- **The goal prompt** — "Check this proposal" was minimal but fine *because* the operator
  immediately let the AI audit-first. A stronger kickoff bakes the discipline in:
  *"Verify this proposal against current code before changing anything — list every claim
  as confirmed / wrong / stale."*
- **High-leverage follow-ups:**
  - *"is this make sense? Check the current state of code"* — the single most valuable
    prompt; it forced code-vs-spec reconciliation and caught fictitious helpers.
  - *"What is missing from this proposal?"* — repeatable gap-finder; each call surfaced
    real off-by-one and wrong-constant errors.
  - *"Is tsx fully extruded from runtime?"* — a yes/no verification question that produced
    an exhaustive install-list + fallback audit.
  - *"1 2 3"* and *"yes"* — terse unlocks after the AI had laid out clear options.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust proposal file paths / symbol names verbatim | "Check the current state of code" | State up front: *verify every path/symbol against the tree before editing* |
| Undercount call sites (said 4, was 5) | "What is missing from this proposal?" | Ask for an exhaustive grep-backed inventory, not a summary |
| Carry stale constants (5000ms) from the draft | Re-verify against code | Require every numeric/const to cite its current source line |
| Assume tsx was already gone | "Is tsx fully extruded from runtime?" | Demand a `git grep tsx` proof, not an assertion |
| Want to commit everything in the dirty tree | "commit" (only its own work) | Say *commit only this session's changes* explicitly |
| Risk implementing coupled changes at once | Accept a safe subset + defer | State coupling boundaries and let it defer with a reason |

The recurring lesson: **proposals rot as code moves.** Every "is this still valid?" was
justified — two of them caught real regressions between drafting and implementation.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was saved this session. But the workflow is highly repeatable and
**should** be captured as a skill — call it **`reconcile-openspec-proposal-with-code`**:

- **What it captures:** the audit-first loop — for each factual claim in a proposal
  (paths, symbol names, call-site counts, constants), grep the tree, mark confirmed / wrong
  / stale, rewrite the proposal to match, `openspec validate --strict`, commit with a
  "verified on develop" rationale.
- **Why it's effective:** it removes the single biggest failure mode here — implementing a
  spec that describes code that no longer exists. It converts vague "is this still valid?"
  turns into a mechanical checklist.
- **When to invoke it:** any time you pick up an OpenSpec change that was drafted more than
  a few commits ago, or whenever a superseder may have absorbed part of a proposal.

The load-bearing existing tools were `openspec validate --strict` (the gate) and disciplined
per-change commits.

## 7. Pitfalls & dead ends

- **Fictitious helpers in the draft.** The proposal referenced `buildNodeImportArgv`; the
  real helper was `spawnNodeScript` in `node-spawn.ts`. *If a proposal names a helper, grep
  for it before relying on it.*
- **Off-by-one call sites.** "4 raw spawn sites" was wrong — `restart-helper.ts` was a 5th,
  and `cli.ts cmdStart` already used `spawnNodeScript` (not raw argv). *Enumerate, don't
  estimate.*
- **Wrong timeout constants** (2s/5s/15s) copied from the draft; real value was
  `READINESS_TIMEOUT_MS = 30_000`. *Re-derive every number from current code.*
- **Coupling trap.** Removing tsx from devDeps while the in-body `cmdStart` fallback still
  referenced it would break dev runs. *Defer the removal until the sister change deletes the
  fallback; state the reason in the commit.*
- **Dirty tree at commit time.** Unrelated changes were in the working tree; the AI asked
  before committing. *Always scope `git add` to this session's files.*
- **8 failed commands** were mostly speculative greps against paths that didn't exist —
  cheap, self-correcting, but a reminder that the tree map in your head is stale.

## 8. Reproduce it faster — checklist

- [ ] Pick the stalled OpenSpec change; read its `ARCHIVED.md` / superseder note first.
- [ ] Audit the proposal against code: grep every path, symbol, count, and constant; mark
      confirmed / wrong / stale.
- [ ] Prune dead phases from archived proposals (DROPPED note, no orphan `[ ]`).
- [ ] Scaffold/repair the change; `openspec validate --strict` must pass.
- [ ] Commit one corrected change per commit with a "verified on develop" rationale.
- [ ] Prove the migration target really needs doing (`git grep tsx packages/{server,electron,extension}/src/`).
- [ ] Implement the safe subset; **defer** coupled tasks with an explicit reason.
- [ ] After the sister change archives, verify the defer reason is resolved in code, then
      finish the deferred tasks.
- [ ] Full rebuild: `npm run build` → `POST /api/restart` → `npm run reload`.

**Inputs to have ready:** the OpenSpec change name, a clean-ish working tree (or discipline
to scope `git add`), and `openspec` on PATH.

**Artifacts produced:** `unify-server-launch-ts-loader/` (proposal + tasks + spec),
corrected `replace-tsx-with-jiti/` proposal + specs, `bin/pi-dashboard.mjs` (jiti-only) +
`pi-dashboard-bin-wrapper.test.ts`, tsx removed from 5 install lists + devDeps + Doctor,
plus `CHANGELOG.md` and `AGENTS.md` edits. Commits: `1f2e553`, `f947960`, `211a96da`,
`3b4e1bfb`, `6009afc9`, `bb089b8a`.

---

_Generated from session `019dfa91` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-09. Source extract: `/tmp/session_facts.v2Vhxd.md`._
