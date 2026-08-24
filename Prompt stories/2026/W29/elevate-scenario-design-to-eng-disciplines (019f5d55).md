---
session: 019f5d55
week: 2026/W29
type: planning
model: "@fast"
premium: true
premium_reason: "yes — created 0 skill(s) / 2 memory(ies)"
upgrade_status: pending
openspec_changes: [remove-scenario-design-orphan-sidecars, elevate-scenario-design-to-eng-disciplines]
proposal_excerpt: "The merged change `elevate-scenario-design-to-eng-disciplines` (PR #310) moved `scenario-design` into `packages/eng-disciplines/` and wrote **full inline DOX rows** for its 3 files into `packages/eng-disciplines/AGENT…"
---

# How we did it: Applying an OpenSpec change that was already merged — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a single skill invocation:

```
/skill:openspec-apply-change elevate-scenario-design-to-eng-disciplines
```

The stated objective was to implement the OpenSpec change that decouples the
`scenario-design` skill from dashboard-specific assumptions and moves it into the
publishable `packages/eng-disciplines/` package. The **real** objective — which only
surfaced deep into the session — was subtler: **do not re-ship work that has already
landed.** The change had already been merged as PR #310 before this session began,
but the session was launched inside a *stale worktree* cut before that merge. So the
true task became: apply → discover the duplication → salvage the one genuine
improvement → ship only that → clean up the stale worktree.

## 2. TL;DR playbook

1. **Before** running `openspec-apply-change`/`ship-it` in a worktree, check the change
   isn't already merged: `gh pr list --head os/<change> --state all --json number,state`.
2. If clear, run `/skill:openspec-apply-change <change>` and work the tasks: decouple
   the skill body in place, `git mv` it into the package, wire the manifest, update docs.
3. For box-drawing/whitespace-heavy edits the `edit` tool chokes on, fall back to a
   line-boundary **script** (`ctx_execute`/`sed`) instead of fighting exact-byte matches.
4. Run the **doubt-driven-review** checkpoint: `git diff` the old routing table vs the
   new example callout to prove behaviour is byte-identical in intent before shipping.
5. On `ship-it`, at the push step, **inspect a non-fast-forward rejection before doing
   anything destructive** — `git fetch` + `git ls-tree origin/develop` to see if develop
   already contains the change.
6. If already merged: **STOP**. Do not force-push, do not open a duplicate PR. Quantify
   your local duplicate vs merged state (`git diff --stat origin/develop`).
7. Extract only the *genuine* delta into a new lean follow-up change (here: delete 3
   orphan `*.AGENTS.md` sidecars), off a **fresh** worktree from `origin/develop`.
8. Validate (`openspec validate`, `npm pack --dry-run`), archive, commit, PR, watch CI;
   treat green-tests-but-exit-1 as a flake and re-run the job, not a code fix.
9. Clean up the stale worktree **from the parent checkout** — never from inside the
   directory being deleted.

## 3. How the collaboration unfolded

**Phase 1 — Apply (Discovery → Implement).** The AI selected the change, read context
files, decoupled the skill body: Phase 4 rewritten to route to *"your project's test
levels"* with the dashboard table demoted to an example callout; frontmatter and
guardrails de-hardcoded so the skill no longer asserts a `qa/` or `:18000` harness
exists. Then `git mv` into `packages/eng-disciplines/`, manifest + README + AGENTS.md
wiring. *Why it worked:* the AI preserved the portable core (the Triple, ISTQB
cheatsheet, "scenario ≠ smoke" rule, STOP-and-ask gate) verbatim and only
parameterized the repo-specific bits.

**Phase 2 — Verify.** `openspec validate` passed; `npm test` showed 19 failures. The AI
correctly diagnosed them as **pre-existing environmental noise** (jimp constructor API
mismatch, fs listing, a timing flake) by proving the diff touched *zero source* — only
markdown + `package.json` metadata. It then confirmed skill discovery live via a
headless `pi -p` session that loaded the new parameterized description.

**Phase 3 — ship-it detour (the pivot).** At the push step, the remote branch existed
and had diverged. Instead of forcing, the AI investigated: **PR #310 for this exact
change was already MERGED.** The earlier apply had run against a stale worktree and
re-implemented everything as a duplicate. Decision point: the user chose to extract the
genuine improvement rather than discard everything.

**Phase 4 — Follow-up change.** The one real delta: develop carried 3 orphan
`*.AGENTS.md` sidecars (inline DOX already existed; sidecars duplicated the kb index and
shipped redundantly in the tarball). The AI scaffolded `remove-scenario-design-orphan-sidecars`
off a fresh `origin/develop` worktree, added a proper spec delta, deleted the sidecars,
shipped via **PR #312 → merged** (`f2ba3ec83`). A green-tests-but-exit-1 CI failure
(react-virtual `window is not defined` after jsdom teardown) was correctly re-run, not
"fixed".

**Phase 5 — Cleanup.** The stale `elevate-...` worktree + branch were removed **from the
parent checkout** — which stranded the session (its cwd no longer existed), an expected
and clearly-explained consequence.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change elevate-scenario-design-to-eng-disciplines`.
  Clean and specific. *What would have made it better:* prepend a merged-state check.
  A stronger kickoff: *"Apply elevate-scenario-design-to-eng-disciplines, but first
  confirm it isn't already merged — the worktree may be stale."*
- **`ship-it`** — one word, high leverage. It drove the entire archive → commit → push →
  PR → CI-watch → merge → cleanup pipeline, and crucially exposed the duplication at the
  push gate rather than silently force-pushing.
- **`clenup`** (typo for cleanup) — still unambiguous; triggered stale-worktree removal.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Start applying a change without checking if it's already merged | Implicitly (the `ship-it` push rejection surfaced it) | Add a `gh pr list --head os/<change> --state all` merged-check as step 0 of apply/ship |
| Consider force-pushing / opening a duplicate PR on non-fast-forward | The AI self-corrected: "Stop — this change is already shipped" | State up front: never force-push a diverged branch; investigate first |
| Want to discard the whole duplicate | User chose to salvage the genuine delta | Ask "is any part of this a real improvement over develop?" before scrapping |
| Treat green-tests-but-exit-1 CI as a code bug | Re-ran the flaky job | Recognize `Test Files N passed` + exit 1 = unhandled-error/teardown flake, re-run |

## 6. Skills, tools & memory created — and why they're effective

No skills were created, but **two failure memories** were saved capturing the core
lesson:

> Before running `openspec-apply-change` or `ship-it` inside a worktree, FIRST check
> whether the change is already merged: `gh pr list --head os/<change> --state all
> --json number,state`. A stale worktree makes apply re-implement an already-merged
> change from scratch, producing a duplicate commit.

*Why effective:* it removes the single most expensive failure mode in this session —
hours of re-implementing shipped work — with one cheap pre-flight command.

**Recommended skill to create:** a `worktree-merged-guard` pre-check that any
apply/ship skill runs automatically, aborting with the merged PR number if
`origin/develop` already contains the change. The memory encodes the *what*; a skill
would encode the *automatic when*.

## 7. Pitfalls & dead ends

- **Stale worktree → duplicate work.** The whole detour. *If your push is rejected
  non-fast-forward on an OpenSpec branch, check `git ls-tree origin/develop` for the
  change before anything else.*
- **`edit` tool choking on box-drawing characters.** Whitespace in box-drawn tables
  differs invisibly. *Fall back to a line-boundary script (`ctx_execute`/`sed -n`) rather
  than retrying exact-byte edits.* (3 edit errors in the session.)
- **`git rm` of already-moved sidecars failing.** *Use `git rm -f` or delete after the
  `git mv` carried them along.* (Several failed `git rm` commands.)
- **19 "failing" tests that aren't yours.** *Prove your diff touches zero source
  (`git diff --name-only HEAD`), then treat jimp/fs/timing failures as baseline.*
- **CI green tests, exit 1.** react-virtual `setTimeout` firing after jsdom teardown →
  `window is not defined`. *Re-run the job; don't chase a nonexistent regression.*
- **Deleting the worktree you're standing in.** Runs the cleanup, then the session's cwd
  vanishes and Bash can't execute. *Run worktree removal from the parent checkout and
  expect the session to strand afterward.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:** `gh` authenticated; the OpenSpec change name; parent checkout
path (`pi-agent-dashboard`); knowledge that worktrees may be stale.

- [ ] `gh pr list --head os/<change> --state all --json number,state` — merged? If yes, STOP.
- [ ] `git fetch origin && git ls-tree -r --name-only origin/develop | grep <change-path>` — already on develop?
- [ ] Only if clean: `/skill:openspec-apply-change <change>`; work tasks; use scripts for box-char edits.
- [ ] doubt-driven-review: `git diff` old vs new to prove byte-identical intent.
- [ ] Prove diff touches zero source before dismissing test failures.
- [ ] `ship-it`; investigate any non-fast-forward before acting.
- [ ] Extract only genuine deltas into a fresh follow-up change off `origin/develop`.
- [ ] `openspec validate` + `npm pack --dry-run`; archive; commit; PR; re-run flaky CI.
- [ ] Remove stale worktree from the parent checkout; expect session to strand.

**Final artifacts produced:** PR #312 (`remove-scenario-design-orphan-sidecars`,
merged `f2ba3ec83`) — 3 orphan `*.AGENTS.md` sidecars deleted from
`packages/eng-disciplines/.pi/skills/scenario-design/`. Two failure memories saved.
Stale `os-elevate-scenario-design-to-eng-disciplines` worktree + branch removed.

---

_Generated from session `019f5d55-1581-7ee9-a7c1-2982a148eb3a` · `pi-agent-dashboard` · 2026-07-14. Source extract: `/tmp/facts-40964-1784849640.md`._
