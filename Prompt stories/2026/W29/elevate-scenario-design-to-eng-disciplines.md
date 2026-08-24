---
session: 019f5ccb
week: 2026/W29
type: documentation
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [elevate-scenario-design-to-eng-disciplines]
proposal_excerpt: "`scenario-design` is a genuine, portable engineering discipline — ISTQB test-scenario design with an `input · trigger · observable` testability probe and a spec-gap clarification gate. It fills the one hole in the `@b…"
---

# How we did it: Elevate scenario-design into eng-disciplines — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator wanted to **promote a repo-local skill into a shared, published package** and
land it cleanly. The first prompt was a single command:

> `/skill:openspec-apply-change elevate-scenario-design-to-eng-disciplines`

The real objective, unpacked by the change proposal, was: take `scenario-design` — a
genuinely portable ISTQB test-scenario-design discipline (the `input · trigger · observable`
testability triple + a spec-gap STOP-and-ask gate) — **decouple it from pi-agent-dashboard
specifics**, move it from the root `.pi/skills/` into the `packages/eng-disciplines/`
published skill bundle, wire the manifest and docs, and ship the whole thing through CI to
`develop`. The second prompt (`ship-it`) then drove it from implemented-in-worktree to
merged-and-cleaned-up.

## 2. TL;DR playbook

1. **Kick off the apply loop:** `/skill:openspec-apply-change <change-name>` — it reads the
   proposal + tasks.md and works the 15 tasks in order.
2. **Decouple before you move.** Rewrite the skill body so project-specific bits (test
   levels, output paths, "OpenSpec required") become *parameters*; demote the concrete
   pi-agent-dashboard table into an explicitly-marked **"Example — …"** callout that
   reproduces the old behaviour *verbatim*.
3. **Move with `git mv`**, not copy+delete — `git mv .pi/skills/scenario-design
   packages/eng-disciplines/.pi/skills/scenario-design` keeps SKILL.md + sidecars +
   references as tracked renames and guarantees a single source.
4. **Wire the manifest + docs:** add the skill row to `packages/eng-disciplines/package.json`
   `pi.skills[]`, the README skills table, and the AGENTS.md DOX rows. Validate the JSON.
5. **Hunt stale references** by *path* (`grep -rn ".pi/skills/scenario-design"`). Remove the
   3 stale rows in root `.pi/skills/AGENTS.md`; leave name-based references (path-independent)
   alone.
6. **Run the gates:** `openspec validate <change>`, then `npm test`. Prove any failures are
   pre-existing/environmental (green on `develop`, green in CI's fresh `npm ci`) — don't
   assume, reproduce on the base branch.
7. **Ship it:** `ship-it` → archive + sync specs → commit → push → PR against `develop` →
   watch CI → verify CodeRabbit → squash-merge + delete branch + remove worktree.
8. **When CI fails, diagnose from the parent repo** (`gh run view <id> --log-failed`), classify
   flaky-vs-real, and **re-run** rather than patch when it's a known teardown race.

## 3. How the collaboration unfolded

**Phase A — Load context & plan (apply kickoff).** The AI resolved the change, read the
context files, the current skill, and the eng-disciplines package, and confirmed *15 tasks,
0 done*. Effective because it front-loaded the full picture before touching a file.

**Phase B — Decouple the skill body.** It rewrote Phase 4 of SKILL.md to route scenarios to
"your project's actual test levels" (generic table), demoting the concrete
`unit / qa VM smoke / Playwright e2e` routing into a marked example callout that reproduces
the old rules verbatim (including the AGENTS.md rendered-UI-vs-smoke hard rule and the
dynamic `.pi-test-harness.json` port note). It generalized the output location, softened
`compatibility` to *"Optional: OpenSpec change spec as input"*, and left the portable core
(the Triple, ISTQB cheatsheet, "scenario ≠ smoke", STOP gate) untouched. **Decision point:**
preserve old behaviour *exactly* as an example rather than deleting it.

**Phase C — Move & wire.** `git mv` into `packages/eng-disciplines/.pi/skills/`, added the
manifest entry (validated JSON → 9 skills), the README row, and accurate AGENTS.md DOX rows.

**Phase D — Reference hygiene & review checkpoint.** Grepped for the old path, removed 3
stale AGENTS.md tree rows, confirmed no `docs/` files referenced it (so no caveman-style
delegation needed). Ran a doubt-driven-review checkpoint verifying the example callout
reproduces old routing verbatim.

**Phase E — Gate & ship.** `openspec validate` passed; `npm test` showed 18 failures — all
in unrelated packages. The AI **reproduced them on `develop`** to prove they were
worktree-local (`jimp@0.16.13` `JimpMime` undefined) and environmental, not caused by the
docs-only change. Then `ship-it`: archive+sync specs, commit, push, PR #310. CI failed once
(flaky react-virtual unhandled error post-teardown, all 1021 files passed) → re-ran → green.
CodeRabbit had 0 actionable threads → squash-merged (SHA `6daa3d4`) → worktree removed.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change <change-name>`. High-leverage because
  the change proposal + tasks.md already encoded the plan; the skill just executes it in
  order. The upstream work (a well-specified OpenSpec change) is what made this one-liner
  enough.
- **The unlock follow-up** — `ship-it`. One word drove the entire land sequence (gate →
  archive → PR → CI watch → merge → cleanup). Effective *because* the implementation was
  already complete and the change was docs-only; the skill's legacy (no-scenario) path
  correctly skipped apply/harness/fix-loop.

A future operator can compress this to two prompts only when the OpenSpec change is
already fully specified. If it isn't, the stronger kickoff is: *"apply
`<change>`; it moves skill X into package Y — decouple project-specifics into an example
callout, git mv, wire the manifest, then ship-it."*

## 5. Steering & corrections (what to watch for)

Only two human turns, both forward-driving — the AI needed almost no redirection because it
ran two well-scoped skills. The guardrails below come from the *judgment calls the AI made
on its own* that a future operator should bake in as explicit instructions:

| The AI tended to… | Steer / bake in by… | Next time |
|---|---|---|
| Want to delete project-specific content when "decoupling" | Preserve it *verbatim* as a marked **"Example — <project>"** callout | State "decouple by parameterizing + demoting to an example, never by deleting" up front |
| Treat any `npm test` failure as a blocker | Reproduce the failing suites on `develop` before concluding | Say "prove failures are pre-existing on the base branch, don't assume" |
| Assume a red CI is a real failure | Read `--log-failed`, classify flaky-vs-real, re-run known races | Bake in "diagnose CI from the parent repo, re-run flaky teardown errors" |
| Run scripts from inside the worktree | Fall back to the parent repo when `scripts/` isn't in the worktree | Note that `show-failed-run.ts` and CI scripts live in the parent checkout |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was *created* this session — the value was **elevating an existing
skill into a publishable package**. The reusable assets exercised:

- **`openspec-apply-change`** — turns a spec'd change into ordered task execution with
  built-in review checkpoints (doubt-driven-review). Invoke when a change has a `tasks.md`.
- **`ship-it` / `ship-change`** — the land pipeline: archive+sync → commit → PR → CI watch →
  CodeRabbit → squash-merge → worktree removal. Its **legacy path** (no `test-plan.md`)
  correctly no-ops the harness/fix-loop for docs-only changes. Invoke to land a completed
  worktree change.
- **Pattern worth capturing as a skill:** *"elevate a repo-local skill into eng-disciplines"*
  — the decouple(parameterize + example callout) → `git mv` → manifest+README+AGENTS rows →
  path-grep for stale refs sequence recurs whenever a portable discipline is promoted. (A
  `elevate-skill-to-eng-disciplines` project skill already exists for the decision + move.)

## 7. Pitfalls & dead ends

- **Box-drawing chars break exact-match edits.** The Phase 4 rewrite's first edit failed
  because table border glyphs differed; the AI re-read the exact section and retried. → When
  an `edit` on a table/box fails, re-Read the precise bytes first.
- **Worktree `node_modules` resolves the wrong dependency version.** `resize.ts` imports
  `JimpMime` (jimp v1), but the near-empty worktree resolved root `jimp@0.16.13` (no
  `JimpMime`) → 18 phantom test failures. Green on `develop`, green in CI's `npm ci`. → Trust
  the base branch + CI's fresh install over a worktree-local test run.
- **Flaky CI on a docs-only change.** First run exited 1 from a single `@tanstack/react-virtual`
  timer firing after `ChatView.test.tsx` teardown (all 1021 files passed). → Classify as flaky,
  re-run (`gh run rerun <id> --failed`), don't patch client code you didn't touch.
- **`gh pr merge --delete-branch` fails when cwd is the worktree.** Post-merge `gh` tried to
  check out `develop` locally and hit the worktree collision; the remote merge already
  succeeded. The remote branch delete was interrupted, needing an explicit
  `git push origin --delete`. → Run the final merge/cleanup from the **parent** repo, not from
  inside the worktree being removed (the session's shell dies with its cwd).

## 8. Reproduce it faster — checklist

- [ ] Change is fully specified in `openspec/changes/<name>/` (proposal + tasks.md).
- [ ] `/skill:openspec-apply-change <name>` — work all tasks in order.
- [ ] Decouple: parameterize project-specifics; demote concrete config into a marked
      **"Example — <project>"** callout reproducing old behaviour verbatim.
- [ ] `git mv .pi/skills/<skill> packages/eng-disciplines/.pi/skills/<skill>`.
- [ ] Wire `package.json` `pi.skills[]` + README table + AGENTS.md DOX rows; validate JSON.
- [ ] `grep -rn ".pi/skills/<skill>"` — remove stale *path* rows; leave name-based refs.
- [ ] `openspec validate <name>`; `npm test`; prove any failures reproduce on `develop`.
- [ ] `ship-it` → archive+sync → PR against `develop` → watch CI → re-run flakes →
      verify CodeRabbit → squash-merge from the **parent** repo → remove worktree.

**Key inputs:** a well-specified OpenSpec change; `gh` authenticated; a git worktree for the
branch. **Artifacts produced:** relocated `packages/eng-disciplines/.pi/skills/scenario-design/`
(SKILL.md + sidecars + references), updated `package.json` / `README.md` / `AGENTS.md`, synced
spec `openspec/specs/scenario-design-discipline/spec.md`, archived change, merged **PR #310**
(SHA `6daa3d4`).

---

_Generated from session `019f5ccb` · `pi-agent-dashboard` · 2026-07-13. Source extract: `/tmp/facts-1784849621N.md`._
