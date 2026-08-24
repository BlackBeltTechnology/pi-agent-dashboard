---
session: 019f2ac8
week: 2026/W27
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [attribute-openspec-poll-eventloop-stalls]
proposal_excerpt: "Users report the dashboard \"sometimes seems stuck\" — chatlog loading and other interactions freeze for a fraction of a second, intermittently. Live measurement against a running production server (`/api/health`) repro…"
---

# How we did it: Doubt-reviewing the poll-stall attribution proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with two words: **"doubt review proposal"**. The real objective, once
the run unfolded: subject the OpenSpec change `attribute-openspec-poll-eventloop-stalls`
— a plan to *attribute* intermittent event-loop stalls in the dashboard's OpenSpec
polling loop — to a rigorous, code-grounded adversarial review, then **revise every
artifact** (proposal, design, tasks, two spec deltas) so the plan stops describing a
mechanism that the actual `directory-service.ts` code can't support. Success = all five
change files realigned to a truthful execution model and validating `--strict`, then
committed.

## 2. TL;DR playbook

1. Load the `doubt-driven-review` skill; read all change artifacts **and** the source
   files whose behavior the proposal asserts (`directory-service.ts`, `hydration-metrics.ts`,
   `server.ts`).
2. **Ground the proposal's factual claims against code first** — quote line numbers
   (`TICK_SLOW_WARN_MS=5000`, histogram `.reset()` on `/api/health`, `tickFolderHeads()`
   ungated). This separates "true about the system" from "the mechanism this plan proposes."
3. Spawn a **fresh-context `Explore` subagent** for the adversarial pass — it re-reads
   from disk without your priors.
4. Offer the human a **cross-model second opinion** (per the skill). Probe SDK-invocability
   with a trivial prompt *before* committing to a reviewer model; drop dead models (Gemini
   returned empty), keep the live one (GLM).
5. Reconcile: classify each finding as **actionable / noise**, verifying load-bearing ones
   directly against source before trusting them.
6. Revise all artifacts to the corrected model; re-validate `npx openspec validate <change> --strict`.
7. Run a **second adversarial pass on the revised text** — but treat findings that quote
   *pre-revision* wording as stale (the `inheritContext` hazard), and re-verify only the
   code-grounded ones.
8. Apply the second-cycle fixes; validate `--strict` again; `git commit` the five files.

## 3. How the collaboration unfolded

**Phase A — Ground before doubt (Discovery).** Rather than immediately spawning a critic,
the AI read the artifacts, then grepped and `cat`'d the real tick loop. It verified each
concrete claim with a line number and surfaced the load-bearing observation *itself*: the
per-dir poll and its broadcast run inside **separate `setTimeout` callbacks** (distinct
event-loop turns), while `tickFolderHeads` runs in the `setInterval` turn. *Why it worked:*
grounding first meant the reviewer was pointed at a real seam, not sent fishing.

**Phase B — Single-model adversarial pass.** A fresh-context `Explore` subagent probed the
design against the code and independently reached the core defect: **the "three segments
summed" attribution model is false** — only `folderHeads` is a single-turn segment; the
rest are spread across ~4.6s of separate turns.

**Phase C — Cross-model second opinion (decision point).** The skill mandates offering a
cross-architecture reviewer. The human chose it ("yes"). The AI probed **Gemini** (returned
empty → not invocable at that id) and **GLM** (invocable) with trivial prompts *first*,
then ran GLM. Both architectures converged on the same defect independently — "not doubt
theater."

**Phase D — Revise + re-review (the loop).** The AI rewrote all five artifacts to a
**per-turn** model, re-validated `--strict`, then ran a *second* adversarial pass on the
revised text. Crucially it caught that several new findings **quoted stale pre-revision
text** the subagent inherited via compressed context — flagged them as noise, and
re-verified the genuinely code-grounded finding (`pollOne`'s internal `await` splits the
turn) against lines 427–451 before trusting it.

**Phase E — Second-cycle fixes + commit.** Applied V1–V7 (finer three-turn model
`tickOpen`/`dirPollPre`/`dirPollPost`, two-feed self-record buffer, label fix, retained-plus-added
alarm, guard tests, spec relocation), validated `--strict`, and committed `23f2a65ce` on
`os/attribute-openspec-poll-eventloop-stalls`.

## 4. Prompts that worked

- **The goal prompt — "doubt review proposal."** Terse but sufficient *because* the
  `doubt-driven-review` skill + an existing OpenSpec change gave it all the structure.
  A stronger version for a colder start: *"Run doubt-driven-review on the OpenSpec change
  `<name>`; ground every claim against the referenced source before spawning a reviewer, and
  offer me a cross-model pass."*
- **"revise"** — a one-word green light that unlocked a full multi-file rewrite because the
  reconciliation had already enumerated exactly what to change.
- **"yes"** — accepted the cross-model second opinion; high leverage because it activated the
  independent-architecture convergence that made the finding trustworthy.
- **"commit"** — clean close-out; the AI had already staged the mental model of "all five
  files, one message."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to spawn a critic immediately | (implicit) the skill's ground-first rule | Always grep/read the asserted source *before* the adversarial pass |
| Trust subagent findings wholesale | — (AI self-corrected) | Treat any finding quoting pre-revision text as stale `inheritContext`; re-verify against disk |
| Leave a stray `path`/field on edits (6 edit errors) | retry the same edit cleanly | Re-read the exact current block before an `edit`; keep `oldText` minimal |
| Pick a reviewer model blind | — (AI self-corrected) | Probe SDK-invocability with a trivial prompt before the real review |

The human's quality bar was implicit but firm: **no doubt theater** — findings must be
substantive, code-grounded, and reconciled, not just listed.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created. The session is a textbook execution of the existing
**`doubt-driven-review`** skill plus the `Explore` subagent. The reusable pattern worth
promoting:

- **Ground-then-doubt-then-cross-model.** Verify factual claims against source (line
  numbers) → single-model adversarial pass → cross-architecture second opinion → reconcile
  actionable/noise → revise → re-review the *changed* artifact. This is exactly what
  `doubt-driven-review` prescribes; this run is a strong reference example.
- If anything should be captured: a short project note that **`Explore` subagents inherit a
  compressed parent snapshot that can hold pre-revision file text**, so their post-revision
  findings must be re-checked against disk. (AGENTS.md already warns about this
  `inheritContext` hazard — the session confirms it live.)

## 7. Pitfalls & dead ends

- **Gemini not SDK-invocable at the tried id** — returned empty. *If a probe returns empty,
  drop that model and try the next architecture (GLM worked).* Probe with a trivial prompt
  before the real task.
- **Stale-context subagent findings** — the re-review quoted text that had already been
  fixed. *If a finding quotes wording you changed, it's the inherited snapshot, not the disk —
  discard it and re-verify only code-grounded findings.*
- **6 failed `edit` calls** — repeatedly leaving a stray field/`path` on an edit. *Re-read the
  current block, keep `oldText` tight and unique, don't carry keys across edits.*
- **Intentional "old-label" mentions look like misses** — after the rewrite, lingering
  `gateStat`/`segment` strings were the text *explaining why the old model was wrong*, not
  leftovers. *Don't blind-replace every occurrence; check whether it's explanatory.*

## 8. Reproduce it faster — checklist

Inputs to have ready:
- An OpenSpec change with proposal/design/tasks/specs (`openspec/changes/<name>/`).
- The source files the proposal makes claims about.
- At least one live cross-architecture reviewer model (GLM confirmed invocable).

Steps:
1. `doubt-driven-review` skill loaded.
2. Read artifacts + assert-referenced source; verify each claim with a line number.
3. Fresh-context `Explore` adversarial pass.
4. Probe a cross-model reviewer's invocability (trivial prompt) → run it.
5. Reconcile actionable vs noise; verify load-bearing findings against code.
6. Revise all artifacts → `npx openspec validate <name> --strict`.
7. Second adversarial pass on revised text; discard stale-quote findings.
8. Apply fixes → `--strict` → `git commit` all files, one message.

Final artifacts (this run): 5 edited/created change files under
`openspec/changes/attribute-openspec-poll-eventloop-stalls/`, committed as `23f2a65ce`.

---

_Generated from session `019f2ac8` · `pi-agent-dashboard` · 2026-07-04. Source extract: deterministic facts sheet._
