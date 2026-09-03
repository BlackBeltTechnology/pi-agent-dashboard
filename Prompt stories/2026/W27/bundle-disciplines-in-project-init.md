---
session: 019f2ad7
week: 2026/W27
type: planning
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (12 user prompts); large facts sheet (~15394 tok)"
upgrade_status: pending
openspec_changes: [bundle-disciplines-in-project-init, add-debugging-skills, wire-discipline-skills-into-openspec]
proposal_excerpt: "`wire-discipline-skills-into-openspec` teaches *this* repo to invoke the `eng-disciplines` skills during openspec implementation. But every *new* project scaffolded by the `project-init` skill starts blank: its `codin…"
---

# How we did it: Bundle discipline doctrine into project-init — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a two-word prompt: **`doubt review`**. The real objective was
to stress-test an OpenSpec design (`bundle-disciplines-in-project-init`) *before*
implementing it — the design scaffolds discipline-checkpoint doctrine (referencing 7
named `eng-disciplines` skills) into every newly-scaffolded coding project, and ensures
those skills exist via an opt-in global `pi install`. Over the next 11 steering turns
the goal grew into a full **plan → implement → publish → rebase → ship** run: land a
3-change dependency sequence (`add-debugging-skills` → `wire-discipline-skills-into-openspec`
→ `bundle-disciplines-in-project-init`), publish the `eng-disciplines` package so its
new debug skills resolve, rebase onto `develop`, and merge via the ship-change skill.
The through-line: **don't ship doctrine with dead references** — if a scaffolded
project points at skills that aren't in the published package, every new project
carries pointers that look wired but aren't.

## 2. TL;DR playbook

1. **`doubt review`** — run the doubt-driven-review skill on the design *before* touching code. Verify load-bearing facts first, then doubt.
2. Let the AI escalate to a **cross-model adversarial review** (Claude + a different architecture like GLM). Converging defects across architectures are the real ones.
3. **Reconcile** findings into `design.md` + `tasks.md`; upgrade soft "SHOULD land first" notes into **hard predecessor gates**. Commit only the artifact files.
4. `/skill:openspec-apply-change <name>` — the pre-flight gate catches unsatisfied predecessors and *pauses* rather than shipping dead references.
5. Implement the dependency chain **in order**, committing each change as a checkpoint. Pause before any **irreversible external action** (npm publish) for explicit sign-off.
6. When a publish goes wrong, **read the raw registry record** (`curl registry.npmjs.org/<pkg>`) — don't trust the CLI's cached view.
7. Rebase onto `develop`; predict overlap by **patch-id** before running — git auto-drops commits already upstream. Leave a `backup-pre-rebase` ref.
8. **`Use ship-change skill`** — push, PR against `develop`, watch CI, wait out CodeRabbit rate-limits, apply safe fixes, loop until green, squash-merge, clean up the worktree from the *parent* repo.

## 3. How the collaboration unfolded

**Phase 1 — Doubt review (verify, then doubt).** The AI first verified the design's
load-bearing claims (`npm view` version, config flags, DOX-gating precedent) and
immediately found one broken: the published `0.5.4` shipped only **6** skills, but the
design's table named **7**. It then ran a single-model adversarial review, escalated to
a **cross-model** review (probed Gemini — not SDK-invocable, a known failure mode — then
GLM, which was), and both architectures converged on the same core defects plus one each
the other missed. *Why it worked:* verifying facts before doubting them turned an
abstract review into a concrete contract-breach finding; cross-model convergence
separated real defects from single-model noise.

**Phase 2 — Reconcile (gates, not suggestions).** Findings folded into `design.md` and
`tasks.md`. The decisive move: renaming Section 1 to **"Predecessor gates (blocking)"** —
the two dependency gates (row-resolution + doctrine-source) became *hard blocks*, and the
"pending footnote" fallback (which *was* the dead-reference state) was removed. Committed
as artifact-only.

**Phase 3 — Apply, blocked by its own gates.** `openspec-apply-change` immediately paused:
both predecessors were ACTIVE-not-applied, so the 7-row table would ship 2 dead references.
The AI drew the ordered 3-change plan (+ the irreversible npm publish node) and got sign-off.

**Phase 4 — Implement the chain.** Ported the two debug skills (`systematic-debugging`,
`node-inspect-debugger`) + a dependency-free `cdp-inspect.ts` CDP helper (using Node 24's
global `WebSocket`), carrying the repo's real jiti-register resolution recipe. Bumped the
package, wired the AGENTS.md checkpoint table (wire-discipline), then the project-init
template + gated ensure-skills step (bundle). Each change committed as a checkpoint;
Biome kept clean; `tsc`/tests deferred (no `node_modules` in the worktree).

**Phase 5 — The publish saga (the human-in-the-loop reversal).** The human published,
then asked to revert / re-version repeatedly (`0.5.4` → `0.5.5` → full unpublish → `0.5.6`).
The AI held firm on npm's immutability rules, then diagnosed a **full-package unpublish**
(`versions: []`) that name-locked the package for 24h — caught only by pulling the **raw
registry JSON**, not the CLI. A version-scoped `0.5.6` publish finally slipped through.

**Phase 6 — Verify, rebase, ship.** Ran the runtime dry-runs against a temp dir + the real
global install (all 7 rows resolve). Rebased onto `develop` — 3 redundant base commits
auto-dropped by patch-id, 9 discipline commits replayed conflict-free. `ship-change`
pushed PR #229, waited out a CodeRabbit rate-limit, applied 8 safe review fixes, looped to
green, squash-merged, and removed the worktree from the parent repo.

## 4. Prompts that worked

- **`doubt review` (goal).** Terse but high-leverage — it invokes a named skill with a
  built-in verify-then-doubt discipline, so the two words expand into a rigorous process.
  *Stronger version for a cold start:* "Run doubt-driven-review on `<change>`; verify the
  load-bearing facts before doubting, and escalate to a second architecture."
- **`yes` / `commit`.** Short unlocks that let the AI proceed through the reconcile→commit
  loop without re-litigating each step.
- **`/skill:openspec-apply-change bundle-disciplines-in-project-init`.** Named the exact
  change; the skill's pre-flight gate did the rest.
- **`Is there another way? For example release 0.5.6?`.** A cheap "try it anyway" probe that
  discovered the name-lock was version-scoped after all — worth one attempt at zero cost.
- **`rebase to develop` / `Use ship-change skill`.** Delegated whole multi-step workflows to
  named skills instead of hand-driving git/PR mechanics.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat dependency ordering as a soft "SHOULD" | `yes` (approve upgrading to hard gates) | State up front: "unsatisfied predecessors must HARD-block apply, no fallback path" |
| Pause before the irreversible publish (correct instinct) | Explicit `published` / sign-off | Keep the pause — surface irreversible external actions and wait for go-ahead |
| Want to reuse a burned version number | `I would like to release as 0.5.4` → corrected to `0.5.5` | Remember npm versions are immutable; never target an existing/unpublished number |
| Assume the publish succeeded from CLI output | `published` (but registry disagreed) | Verify from the raw registry record, not the CLI's cached view |
| Bump minor for two added skills | `Publish as 0.5.5` (patch, not minor) | Classify added-skills as a patch unless there's a breaking change |

## 6. Skills, tools & memory created — and why they're effective

- **Memory (tool-quirk) saved:** *a FULL-package unpublish (`npm unpublish <pkg> --force`)
  locks that exact package NAME from republishing for 24 hours — you cannot publish ANY
  version, even a new number.* **Why effective:** this exact trap cost hours in this session
  (the `0.5.5` publish was silently rejected); the memory turns a multi-hour diagnosis into
  a one-line recall next time. **Invoke when:** any unpublish/republish decision on a scoped
  npm package.
- **`node-inspect-debugger` skill + `cdp-inspect.ts` (shipped in `eng-disciplines@0.5.6`).**
  Captures the repo's verified jiti-register CDP recipe (Node 24 global `WebSocket`,
  dependency-free). **Why effective:** makes runtime breakpoint inspection reproducible for
  jiti/TypeScript targets where `console.log` can't reach closure state.
- **`systematic-debugging` skill.** Phased evidence-first debugging, now globally installable.
- **Recommended if repeating:** a small skill capturing the **verify-registry-not-CLI** move
  (`curl registry.npmjs.org/<pkg>` → inspect `versions`/`time.unpublished`) — it was the
  single diagnostic that unblocked the publish saga.

## 7. Pitfalls & dead ends

- **npm full-unpublish name-lock.** `npm unpublish --force` emptied `versions: []` and locked
  the name for 24h; the `0.5.5` publish was rejected with a `403`. *If you hit this:* try a
  **new version number** anyway (the lock turned out version-scoped — `0.5.6` published), and
  read the raw registry JSON to confirm the true state.
- **Trusting the npm CLI's view.** `npm view` reported the package "not in this registry"
  while the raw record showed the real unpublish timestamp. *Do:* `curl` the registry
  endpoint directly when state looks wrong.
- **Immutable version numbers.** You cannot republish `0.5.4` with new content, nor reuse an
  unpublished number for 24h. *Do:* always bump forward.
- **Worktree branch-collision on merge.** `gh pr merge --delete-branch` failed *after* a
  successful merge because `develop` was checked out in the parent. *Do:* verify MERGED state,
  then delete the remote branch and `git worktree remove --force` from the parent repo.
- **Local-only test false-negative.** `node-electron-resolution.test.ts` failed on macOS (real
  filesystem probe) but was green in develop's CI. *Do:* check whether develop's CI is green
  before treating an unrelated local failure as a blocker.
- **Gemini not SDK-invocable.** Cross-model probe returned empty for Gemini; fall back to
  another architecture (GLM) rather than blocking.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name(s), npm publish credentials for the scoped
package, `develop` up to date, `gh` authenticated.

- [ ] `doubt review` the design; verify load-bearing facts, then run cross-model adversarial review.
- [ ] Reconcile findings → `design.md` + `tasks.md`; convert soft ordering into **hard predecessor gates**; commit artifacts only.
- [ ] `/skill:openspec-apply-change <name>`; honor the pre-flight pause on unsatisfied predecessors.
- [ ] Implement the dependency chain in order; checkpoint-commit each; **pause before npm publish**.
- [ ] Publish; **verify from the raw registry record** (`curl registry.npmjs.org/<pkg>`); bump forward on any version conflict.
- [ ] Run runtime dry-runs (temp dir + real global install) — confirm every scaffolded row resolves.
- [ ] Rebase onto `develop` (patch-id predicts auto-drops); leave a `backup-pre-rebase` ref.
- [ ] `Use ship-change skill`; loop CI + CodeRabbit to green; squash-merge; remove the worktree from the parent.

**Final artifacts:** `@blackbelt-technology/pi-dashboard-eng-disciplines@0.5.6` (8 skills +
`cdp-inspect.ts`); AGENTS.md discipline-checkpoint table; project-init coding profile 7-row
doctrine + gated install step; 3 changes archived under `openspec/changes/archive/2026-07-04-*`;
merged via PR #229.

---

_Generated from session `019f2ad7` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-bundle-disciplines-in-project-init` · 2026-07-04. Source extract: session facts sheet (deterministic)._
