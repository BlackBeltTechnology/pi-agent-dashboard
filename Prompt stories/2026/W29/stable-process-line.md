---
session: 019f6256
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [stable-process-line]
proposal_excerpt: "During a run the session card's PROCESS subcard changes height constantly. It mounts when the first bash tool starts, grows a row per concurrent tool, shrinks as tools finish, and unmounts entirely when the session goes idle."
---

# How we did it: Ship the `stable-process-line` change end-to-end — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was the entire **`ship-it`** skill body — an instruction to run the
implementation-phase orchestrator for an OpenSpec change inside its git worktree
(`.worktrees/os-stable-process-line`, branch `os/stable-process-line`). No prose goal
was typed; the skill *was* the goal.

The real objective, once the change's proposal was read: **fold the session card's two
independently-fluctuating PROCESS surfaces** (the in-flight `bash` activity bar and the
background-process drawer) **into one fixed-height collapsible summary line**, so tool
start/stop no longer reflows the card grid. Then take it all the way: implement TDD,
run the full suite + Biome gate, archive the OpenSpec change, commit, push, open a PR
against `develop`, get CI green, and squash-merge with worktree cleanup.

## 2. TL;DR playbook

1. **Invoke `ship-it` inside the worktree.** It orients (branch, tasks.md, test-plan
   manifest, discipline skills) before touching code.
2. **Judge the isolation call.** For a cohesive, well-specified *client-only* change,
   implement **directly with TDD** — don't spawn an isolated `apply` subagent that
   re-reads everything.
3. **TDD each task in order.** Write the failing test first, then the minimal impl.
   Set `HOME=$(mktemp -d)` before vitest so it doesn't touch the real prefs store.
4. **Verify the worktree actually resolves *its own* edits** — run tsc early; if shared
   changes are invisible, the worktree `node_modules` is empty and deps walk up to the
   main repo. Reinstall the worktree (`rmdir node_modules && npm install`).
5. **Run the full suite to a file** (`npm test 2>&1 | tee /tmp/spl-test.log | tail`),
   then the **Biome changed-files gate** (`quality:changed`, `--error-on-warnings`).
6. **Separate your failures from pre-existing drift** — a failing test that also fails
   on `develop` is not yours; note it, don't fix it (surgical-changes rule).
7. **Archive the OpenSpec change BEFORE commit** (steered) — fix any `MODIFIED` spec
   delta header that doesn't match an existing main-spec requirement.
8. **Commit → push → `gh pr create` against `develop`** — write the PR body from a
   file, never a backtick-laden heredoc (command substitution mangles it).
9. **Merge `develop` in, re-run tests, watch CI.** CI runs a repo-wide tsc that will
   catch literals you never type-checked locally (e.g. server `preferences-store.ts`).
10. **Squash-merge + clean up** (remote branch, worktree, local branch). Expect the
    shell to be anchored to the now-deleted worktree — re-establish a cwd afterward.

## 3. How the collaboration unfolded

**Phase 1 — Orient (ship-it preflight).** The AI read `tasks.md`, checked for a
`.pi-test-harness.json` manifest and the proposal's `## Discipline Skills`, and
classified the change: client-only React (`packages/client` + `packages/shared`), no
test-plan manifest (legacy defer), vitest unit tests (not Playwright). All tasks
unchecked → fresh implementation. *Why it worked:* the orientation decided the whole
strategy (direct TDD vs. isolated apply) before a single edit.

**Phase 2 — TDD the change, task by task.** DisplayPrefs field → settings surfaces +
i18n → a shared `collapse-summary.tsx` (`splitOverflow` pure helper + `CollapseSummary`
primitive, DRY) → refactor `SessionActivityBar` and `ProcessList` to rows-only
contributors → build the unified line in `SessionCard.ProcessSubcard`. Each step:
failing test first, minimal impl, green. *Decision point:* the human's proposal carried
a `doubt-driven-review` checkpoint on the idle-default; the AI kept the default off for
`simple`/`standard`, on for `everything`.

**Phase 3 — The worktree-isolation trap.** tsc showed the shared `DisplayPrefs` field
missing. Investigation: the worktree resolved `pi-dashboard-shared` **up to the main
repo's unedited `packages/shared`** because the worktree's `node_modules` was an
**empty directory** (0 entries) — the `worktreeInit` install had been gated off.
Fix: `rmdir node_modules && npm install` in the worktree; tsc then resolved the
worktree's edited shared and passed.

**Phase 4 — Full verify + separating drift.** Full suite: 10230 passed, one failure
(`publish-allowlist-complete.test.ts`). The AI proved it **fails on `develop` itself**
(base at develop's tip; `publish.yml` omits `nano-banana` + `video-production`) → pre-
existing infra drift, out of scope. Biome: Tier-A (errors) cleared via safe
import-sort fixes; Tier-B/C warnings left as pre-existing debt.

**Phase 5 — Archive, commit, PR.** *Human steered "archive first."* Archive failed on
a spec-delta header mismatch: three `MODIFIED` requirements used **renamed** headers
that don't exist in the main specs (OpenSpec `MODIFIED` matches by exact header).
Realigned each header to the existing requirement, archived, committed, pushed, opened
**PR #322**. First PR body was mangled by a backtick heredoc → rewritten from a file.

**Phase 6 — The gate-root-cause detour.** *Human asked: "the worktreeInit install had
been gated off — why?"* The AI read the hook gate verbatim:
`test ! -d node_modules || …`. An **empty** `node_modules` *is* a directory, so
`! -d node_modules` was false → install skipped. *Human: "Fix."* Changed the gate to
key on `node_modules/.package-lock.json` (npm writes it only on a completed install),
committed to `develop` in the main repo (worktrees inherit it), staging **only** that
file to avoid two unrelated uncommitted changes.

**Phase 7 — Merge develop, CI catches a real gap, merge.** *Human: "merge develop and
continue shipping."* After merging, CI's **repo-wide** tsc caught a genuine gap the
local client+shared tsc missed: `packages/server/src/preferences-store.ts` built
`DisplayPrefs` literals **without** the new field. Fixed both literals + a legacy
migration block + 2 tests. CI green, 0 actionable review threads (CodeRabbit rate-
limited → warn-and-continue). Squash-merged PR #322 (`97857454b`), deleted remote
branch + worktree + local branch. The shell was anchored to the deleted worktree and
had to be re-established.

## 4. Prompts that worked

- **The goal prompt = the whole `ship-it` skill.** Effective because the skill carries
  the entire orchestration contract (preconditions, phases, escape hatch). *Stronger
  kickoff:* pair it with one line naming the change and its worktree so orientation is
  instant: *"Run ship-it for `stable-process-line` in `.worktrees/os-stable-process-line`."*
- **"archive first."** A 2-word high-leverage redirect that fixed ordering (archive
  before commit) and surfaced the spec-delta header bug early.
- **"the worktreeInit install had been gated off - why?"** Turned a one-off fix into a
  root-cause investigation that produced a durable gate fix on `develop`.
- **"Fix"** — a one-word unlock authorizing the gate change once the cause was clear.
- **"merge develop and continue shipping."** Kept the ship flow moving and pulled in
  the gate fix, letting CI catch the server-literal gap.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Move toward commit before archiving the OpenSpec change | "archive first." | Make ship-it archive the change **before** the commit step by default |
| Treat the empty-`node_modules` skip as incidental | "the worktreeInit install had been gated off - why?" | Root-cause runtime surprises, not just patch them |
| Leave the flawed gate as a local workaround | "Fix" | Fix the gate at source (`.pi/settings.json` on `develop`) so all worktrees inherit it |
| Verify tsc only on the packages it edited (client+shared) | CI (repo-wide tsc) caught the server literals | Run **repo-wide** `npm run lint` before pushing, not per-package tsc |
| Risk clobbering unrelated main-repo working-tree changes | (implicit discipline) | Stage **only** your files (`git add <path>`), never `git add -A` in the shared main repo |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — it was an *application* of `ship-it`.
Two durable, reusable assets came out of it anyway:

- **The `worktreeInit.gate` fix (`.pi/settings.json`).** Keys the install-skip decision
  on `node_modules/.package-lock.json` instead of `-d node_modules`. *Effective because*
  an empty `node_modules` no longer masquerades as "installed" — every future worktree
  gets a correct install and its own edits resolve. This is the reusable lesson worth a
  memory: *"worktree deps invisible / shared edits ignored → empty `node_modules`; the
  gate must test the `.package-lock.json` marker, not the directory."*
- **The spec-delta realignment recipe.** OpenSpec `MODIFIED` matches by **exact existing
  header**; renamed headers fail archive. *Effective because* it converts an opaque
  archive error into a mechanical fix: align each `MODIFIED` header to the requirement it
  evolves, keep the body/scenarios.

If this pattern recurs, the skill worth creating is *"fix-openspec-archive-header-mismatch."*

## 7. Pitfalls & dead ends

- **Empty worktree `node_modules`** → shared-package edits are invisible (deps resolve up
  to the main repo). Fix: `rmdir node_modules && npm install` in the worktree; re-run tsc.
- **vitest touching the real prefs store** → prefix with `HOME=$(mktemp -d)`.
- **Per-package tsc misses literals elsewhere** — the server's `DisplayPrefs` literals
  broke CI. Run repo-wide `npm run lint` before pushing.
- **Backtick heredoc for the PR body** → bash command-substitution mangles it. Write the
  body to a file and pass `--body-file`.
- **OpenSpec archive fails on `MODIFIED` header mismatch** → the delta header must exactly
  match an existing main-spec requirement; realign, don't rename.
- **A failing test that also fails on `develop` is not yours** — prove it at the base
  commit, note it, and don't fix out-of-scope infra drift.
- **Cleanup deletes the cwd** — after removing the worktree the shell is anchored to a
  dead directory; re-establish a valid cwd (or operate with an explicit cwd) before
  continuing.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the change name + its worktree path, `develop` fetched, gh
authenticated.

- [ ] Run `ship-it` inside `.worktrees/os-<change>`; let it orient before editing.
- [ ] For a cohesive client-only change, implement **directly with TDD** (skip isolated apply).
- [ ] `HOME=$(mktemp -d) npx vitest run <suite>` per task; failing test first.
- [ ] Early tsc; if shared edits are invisible → `rmdir node_modules && npm install` in the worktree.
- [ ] `npm test 2>&1 | tee /tmp/<change>-test.log | tail`; then `quality:changed`.
- [ ] Prove any stray failure also fails on `develop`; leave pre-existing drift alone.
- [ ] **Archive first**; fix any `MODIFIED` spec-delta header to match an existing requirement.
- [ ] Commit **only your files**; push; `gh pr create --base develop` with `--body-file`.
- [ ] Merge `develop`; re-run tests; **watch CI (repo-wide tsc catches missed literals)**.
- [ ] Squash-merge; delete remote branch + worktree + local branch; re-establish a cwd.

**Artifacts produced:** `packages/client/src/components/collapse-summary.tsx` (+ test),
edits to `SessionCard.tsx` / `ProcessList.tsx` / `SessionActivityBar.tsx` /
`SettingsPanel.tsx` / `ChatViewMenu.tsx` / `preferences-store.ts` / `display-prefs.ts` /
`i18n-en-source.json` / `CHANGELOG.md`, the archived `stable-process-line` OpenSpec
change, the `.pi/settings.json` gate fix on `develop`, and **merged PR #322**
(`97857454b`).

---

_Generated from session `019f6256` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-14. Source extract: facts sheet (mktemp)._
