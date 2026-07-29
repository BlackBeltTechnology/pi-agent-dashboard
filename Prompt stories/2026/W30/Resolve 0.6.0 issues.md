---
session: 019f817c
week: 2026/W30
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-pi-install-node26-and-omit-dev-build]
proposal_excerpt: "`pi install git:github.com/BlackBeltTechnology/pi-agent-dashboard` (issue #357) fails at two independent points, and neither is fixed as of the released `0.6.1`:"
---

# How we did it: Triage the 0.6.0 milestone & plan the last open fix — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a simple maintenance ask:

> "There is issues tagged with 0.6.0 milestone. Check them, if delivered comment the issue and close."

The *real* objective, which surfaced almost immediately, was two-sided: **(a)** verify
each open 0.6.0-milestone issue against the actual shipped code — not against its title —
and mechanically comment + close the ones already delivered; and **(b)** for the one issue
that turned out *not* delivered (#357, `pi install git:` fails), pivot from triage into a
full OpenSpec **planning** pass that produces a validated, ready-to-implement change. The
session ends at the git-worktree boundary — planning done, implementation deliberately left
to `ship-it`.

## 2. TL;DR playbook

1. **List the milestone's open issues** with `gh issue list --milestone "0.6.0" --state open --json number,title,body,labels`.
2. **Verify each against the code, not the title** — grep the actual source/paths named in each issue and cross-check the release tags (`git log --oneline vX..HEAD -- <path>`, `git merge-base --is-ancestor <commit> vX`) to confirm the fix is *in a released tag*.
3. **Comment + close the delivered ones** with a specific `gh issue comment` citing the file/symbol and the version it shipped in; leave the undelivered one open with a one-line "why".
4. **For the undelivered issue, investigate the technical constraints first** — separate independent blockers by *scope* (which install paths each one hits) before proposing anything.
5. **Run the `plan-proposal` workflow** → `openspec new change` → proposal.md → design.md → spec deltas.
6. **Do a `doubt-driven-review` pass on the riskiest claim** in the proposal before finalizing (here: the `tsx` dependency relocation) and correct it with evidence.
7. **Run `scenario-design` → `test-plan.md`, then fold** the automated rows into `tasks.md` (manual-only rows tagged), and `openspec validate` until `isComplete: true`.
8. **Commit the planning artifacts surgically** to `develop` (only the change dir), then **stop** — implementation is a separate worktree job.

## 3. How the collaboration unfolded

**Phase 1 — Triage against reality (not titles).** The AI listed the four open
0.6.0 issues, then for each one grepped the exact code path the issue named
(`binary-lookup.ts::whichViaLoginShell`, the roles handlers, `isGenuinelyLocal()`) and
checked whether the fixing commits were ancestors of the released tags `v0.6.0`/`v0.6.1`.
*Why it worked:* delivery was proven from the codebase + tag graph, so the "delivered"
verdict was defensible, not a guess. Three issues (#261, #101, #268) were confirmed shipped;
#357 was confirmed **not** shipped (`engines.node` still `<26`, client `prepare` still runs
`vite build`, no fix commits in range).

**Phase 2 — Close what's done.** The AI posted a specific `gh issue comment` on each of the
three, naming the file/symbol and the version, then closed them. Decision point: the human's
single steering turn — **"yes"** — greenlit both the close-the-three action *and* the pivot
into planning #357.

**Phase 3 — Constraint discovery on #357.** Before proposing anything, the AI mapped the two
blockers and — crucially — separated them by **scope**: the Node 26 `EBADENGINE` hits *every*
install path, while the `--omit=dev` `prepare` build fails *only* on `pi install git:` (the
published npm tarball ships a prebuilt `packages/dist/client`; a git clone has none). This
scope split is what let one change carry two independent fixes cleanly.

**Phase 4 — Plan via `plan-proposal`/`openspec`.** `openspec new change fix-pi-install-node26-and-omit-dev-build`,
then proposal → design → two spec deltas (one **modified**: `server-startup-node-version-guard`;
one **new**: `git-install-omit-dev-build`).

**Phase 5 — Doubt-review + correction.** A focused `doubt-driven-review` pass on the proposal's
riskiest claim ("relocate `tsx` out of root devDeps") found it *wrong*: `tsx` is already a
runtime `dependency` of `packages/server` (survives `--omit=dev` via hoisting) and root still
needs its `tsx` devDep for `npx tsx` scripts. Corrected to: *add* `tsx` explicitly to the
client's `dependencies`. Decision point: verify-before-finalize caught a factual error that
would have shipped into implementation.

**Phase 6 — Test plan, fold, validate, commit.** `scenario-design` → `test-plan.md`,
then folded 10 automated rows (E1–E8, X1, X2) → tasks 4.1–4.10 and 1 manual-only (M1) → task
5.1; fold-completeness gate passed (10↔10, 1↔1); `openspec validate` returned `isComplete: true`.
Committed only the change dir to `develop` (`380ab1e77`) and stopped at the worktree boundary.

## 4. Prompts that worked

- **The goal prompt** ("check them, if delivered comment the issue and close") was effective
  because it bundled a *verification criterion* ("if delivered") with the *action* — it told
  the AI to prove delivery, not assume it. A stronger version bakes in the standard of proof:
  *"For each open 0.6.0 issue, verify the fix is in a released tag by grepping the named code
  path and checking `git merge-base`; comment + close the delivered ones citing file+version;
  for any not-delivered, leave open and tell me why, then plan the fix via OpenSpec."*
- **High-leverage follow-up: "yes."** One word unlocked the entire second half — closing the
  three delivered issues *and* pivoting into a full planning pass on #357. Short confirmations
  work when the AI has already laid out a precise, single-branch plan to confirm.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Risk trusting issue *titles* for "delivered" status | Implicit "if delivered" bar in the goal prompt | State up front: prove delivery from code + release-tag ancestry, never from the title |
| Draft a plausible-but-wrong dependency move (`relocate tsx out of root`) | Nothing — the AI's own `doubt-driven-review` caught it | Always run a doubt-review pass on the single riskiest claim before finalizing a proposal |
| Want to keep going past planning into implementation | The `plan-proposal` workflow's hard stop at the worktree boundary | Treat planning and implementation as separate sessions; end planning at the commit |

The only *human* steering turn was "yes" — the substantive correction (the `tsx` fix) was
self-caught by the doubt-review discipline, which is the real lesson here: build the
skepticism into the workflow so you don't need a human to catch every factual slip.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created. The session's power came from *chaining existing
disciplines* in the right order:

- **`plan-proposal`** — the orchestrator that sequences openspec artifact creation →
  doubt-review → scenario-design → fold, and enforces the worktree stop. Invoke it whenever a
  triage turns up an undelivered issue that needs a real change.
- **`doubt-driven-review`** — run it on the *single riskiest actionable claim* in a proposal
  before you finalize. Here it converted a wrong dependency move into a correct one with a
  10-second `node -e` check. This is the highest-ROI habit in the session.
- **`scenario-design` + tasks fold** — turns spec deltas into a checkable test manifest and
  folds automated rows into `tasks.md` with a completeness gate, so implementation starts from
  a validated plan.

*Recommended skill to create:* a small **"triage a milestone"** procedure — list open issues,
verify each against code + release tags, comment/close delivered, route undelivered into
`plan-proposal` — since this exact sequence is repeatable every release.

## 7. Pitfalls & dead ends

- **Don't equate "issue closed upstream" or a good title with "delivered."** Confirm the fix
  commit is an *ancestor of a released tag* (`git merge-base --is-ancestor <commit> vX.Y.Z`).
- **Don't relocate a dep without checking hoisting.** `tsx` looked like a root-only devDep but
  was already a runtime dep of `packages/server`; the correct fix was to *add* it explicitly to
  the client, not move it. A one-line `node -e "require('./packages/server/package.json')"` check
  settled it.
- **Two blockers, one issue — separate them by scope before proposing.** Node 26 hits all
  install paths; `--omit=dev` hits only `git:`. Conflating them would have produced an
  over-broad or wrong fix.
- **Don't overshoot the planning boundary.** `plan-proposal` intentionally stops at the
  worktree; implementation belongs to `ship-it`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** `gh` authenticated to the repo; the milestone name; a clean
`develop` checkout; `openspec` CLI (≥1.6.0) on PATH.

- [ ] `gh issue list --milestone "<M>" --state open --json number,title,body,labels`
- [ ] For each: grep the named code path + `git merge-base --is-ancestor <fix-commit> v<released>` to prove delivery
- [ ] `gh issue comment <n> --body "…cites file+symbol+version…"` then close — delivered ones only
- [ ] For any undelivered issue: map the blockers, **separate by scope**, verify constraints in code
- [ ] `openspec new change <name>` → proposal.md → design.md → spec deltas (mark modified vs new)
- [ ] `doubt-driven-review` the riskiest claim; correct with an evidence command
- [ ] `scenario-design` → `test-plan.md`; fold rows into `tasks.md`; `openspec validate` → `isComplete: true`
- [ ] Commit only the change dir to `develop`; **stop** at the worktree boundary

**Artifacts produced:** the `fix-pi-install-node26-and-omit-dev-build` change dir
(`proposal.md`, `design.md`, `specs/server-startup-node-version-guard/spec.md`,
`specs/git-install-omit-dev-build/spec.md`, `test-plan.md`, `tasks.md`), committed as
`380ab1e77` on `develop`; three closed issues (#261, #101, #268) with delivery comments.

---

_Generated from session `019f817c` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-20. Source extract: `/tmp/facts-85758-26758.md`._
