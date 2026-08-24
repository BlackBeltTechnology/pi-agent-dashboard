---
session: 019ec401
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "yes — heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [fix-spawn-token-env-leak]
proposal_excerpt: "When a user spawns a worktree/OpenSpec session, the real session card appears but the placeholder loading card never clears (it lingers ~30 s until the safety timeout). Root cause: the single-use spawn-correlation…"
---

# How we did it: fix-spawn-token-env-leak — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: **`/skill:openspec-apply-change fix-spawn-token-env-leak`**. No prose — the intent lives entirely in the change's own `proposal.md`/`tasks.md`. The *real* objective: when a user spawns a worktree/OpenSpec session, the live session card appears but the **placeholder loading card never clears** — it lingers ~30 s until a safety timeout. The root cause is that the single-use `PI_DASHBOARD_SPAWN_TOKEN` env var gets read more than once (and re-injected on keeper respawn), so the spawn-correlation that would clear the placeholder never fires cleanly. The fix: make the token **truly single-use** — captured exactly once, scrubbed at both the **bridge** and **keeper** boundaries — so placeholder cards clear instantly.

## 2. TL;DR playbook

1. **Launch the apply skill against the change**: `/skill:openspec-apply-change fix-spawn-token-env-leak`. Let it read `proposal.md`, `design.md`, `spec.md`, and `tasks.md` first — don't feed it the design yourself.
2. **Approve the plan** with a terse **"go on"** once the model states its 3-part plan (bridge capture-once → keeper `buildPiEnv` → validation/tests). Don't over-specify; the change artifacts already carry the design.
3. **Let it implement in task order**, capturing the token **once at bridge activation** onto `BridgeState` (survives reload), exposing it as `BridgeContext.dashboardSpawned`, and replacing every live `process.env.PI_DASHBOARD_SPAWN_TOKEN` read.
4. **Extract a pure, testable env helper** on the keeper side: `buildPiEnv(baseEnv, isFirstLaunch)` in a new `keeper-env.cjs`, with a unit test — so the "scrub on respawn" logic is verifiable without a live PTY.
5. **Ask it to "check the tasks done"** — force a task-by-task verification pass against the *actual code state*, not the checkboxes. This is where it caught the `MODULE_NOT_FOUND` packaging risk and confirmed the runtime `require`.
6. **Archive** with `openspec archive <change> --yes` (accepting the 3 deferred manual live-system checks), which syncs the delta spec into `openspec/specs/spawn-correlation/spec.md`.
7. **Commit, open the PR, monitor CI** — write the PR body to a file (`gh pr create --body-file`) to dodge heredoc/apostrophe breakage; poll `gh pr checks` on a loop.
8. **Triage CodeRabbit** each comment individually against the real files: fix the true issue (escape the MD056 pipe), and for false-positive/no-op flags, clarify the **spec + design** so they're self-consistent and reply with the rationale rather than making a no-op code change.
9. **Merge, then clean up from the main repo** — you can't `git worktree remove` while inside it; switch to the main checkout, force-remove the worktree, delete local + remote branch.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read before edit).** The AI resolved the openspec-apply skill, then read the change's proposal/design/spec/tasks and the source files it would touch (`session-sync.ts`, `bridge.ts`, `bridge-context.ts`, the keeper). It grep-walked `bridge.ts` (a ~2000-line file) in windowed `awk`/`grep` passes to locate the register path and the env reads. *Why it worked:* it built a map of every `dashboardSpawned`/`PI_DASHBOARD_SPAWN_TOKEN` read **before** touching anything, so the "capture once, replace all reads" refactor was surgical.

**Phase 2 — Plan + implement.** It surfaced a 3-point plan (bridge capture-once persisted on `BridgeState`; keeper `buildPiEnv` helper; validation/spec/tests) and the human approved with **"go on"**. It then implemented in `tasks.md` order: capture `dashboardSpawned = !!process.env.PI_DASHBOARD_SPAWN_TOKEN` once at activation before any scrub, added it to `BridgeContext`, replaced the 3 live env reads, and scrubbed the token in the first-register branch. On the server it extracted the **pure** `buildPiEnv(baseEnv, isFirstLaunch)` into a new `keeper-env.cjs` and wired `piLaunchCount` into `keeper.cjs`. *Decision point:* making the env logic a pure function was the leverage move — it made "scrub only on respawn" unit-testable.

**Phase 3 — Verify against reality.** Prompted with **"check the tasks done"**, the AI re-verified each task against the actual code rather than trusting checkboxes. This caught the critical packaging question — *does the new `keeper-env.cjs` ship next to `keeper.cjs`?* — which it answered by confirming the server ships `src/` and runs via jiti, then did a live `node -e` require to prove no `MODULE_NOT_FOUND`. It produced a task→status→evidence table.

**Phase 4 — Archive + PR + CI.** On **"later, archive"** it ran `openspec archive --yes` (syncing the delta spec into the main spec) despite 3 unchecked manual-live checkboxes. On **"commit, create PR and monitor CI"** it committed the feature (excluding a local `.pi/settings.json` path artifact), pushed, created PR #114 via `--body-file`, and polled `gh pr checks` until green (~7 min).

**Phase 5 — CodeRabbit triage.** On **"fix coderabbit issues"** it evaluated all three comments individually: fixed the real one (unescaped `|` → `\|`, MD056), and for the two flagged as Major/Minor it traced the mechanism, concluded the *implementation* was correct but the *spec/design were ambiguous*, and fixed the docs to be self-consistent — then replied on the threads with the reasoning. *Decision point:* it did **not** blindly make no-op code changes to satisfy a bot.

**Phase 6 — Merge + cleanup.** On **"merge PR, delete branch, delete worktree"** it squash-merged, and when `--delete-branch` failed (can't switch checkout from inside the worktree) it switched to the main repo to force-remove the worktree and delete the local branch.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change fix-spawn-token-env-leak`.** Effective because the design already lived in the change artifacts; the skill invocation is the whole brief. *Stronger version for a future operator:* same command — but confirm `tasks.md` has crisp, checkable tasks before launching, since the apply loop only ever moves as fast as its task list is precise.
- **"go on"** — a one-word approval that unlocked the entire implementation once the plan was sound. High-leverage: trust-and-proceed when the plan is correct.
- **"check the tasks done"** — the highest-leverage steer in the session. It forced a code-vs-checkbox reconciliation that surfaced the packaging/`MODULE_NOT_FOUND` risk. *Bake this in:* always demand a "verify each task against actual code, with evidence" pass before archiving.
- **"commit, create PR and monitor CI"** — bundled three actions; the AI sequenced them and self-recovered from a heredoc failure.
- **"fix coderabbit issues"** — short, but the model correctly interpreted "fix" as "evaluate then fix the real ones / justify the rest," not "make every change the bot suggests."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Mark tasks done and move on | "check the tasks done" → forced a per-task code re-verification | Make a verify-against-code pass a standing step before archive; demand a task→evidence table |
| Treat a green test suite as "ready to archive" | Implicitly, via the verify pass that caught the unshipped-`require` risk | Always ask "does the new file ship where the requirer runs?" for any new `.cjs`/runtime module |
| Risk breaking on nested-heredoc apostrophes in `gh pr create` | (self-corrected) wrote PR body to `/tmp/pr-body.md`, used `--body-file` | Default to `gh pr create --body-file <file>` for any non-trivial body |
| Consider making a no-op code change to appease CodeRabbit | Verify each bot comment against the real files first | Triage bot comments 1-by-1: fix real issues, clarify docs for ambiguity, reply-with-rationale for no-ops |
| Try `git worktree remove` from inside the worktree | Switch to the main repo checkout first | Remember worktree cleanup runs from the **main** repo, never from inside the worktree |
| Commit stray local artifacts (`.pi/settings.json` abs-path edit) | Excluded it explicitly from the commit | Scan `git status` for local-only path artifacts and exclude them from feature commits |

## 6. Skills, tools & memory created — and why they're effective

No new pi *skill* or persistent memory was created in this session — the work was a disciplined run of the existing `openspec-apply-change` → archive → PR → merge pipeline. Two subagents were spawned for docs hygiene (both `general-purpose`): *"Update server file-index for keeper-env.cjs"* and *"Escape literal pipe in file-index-server row"* — delegating the `docs/`/file-index edits per the Documentation Update Protocol so the main agent stayed on the implementation.

The genuinely reusable artifact is a **code pattern worth remembering**: extract single-use / launch-sensitive env logic into a **pure `buildPiEnv(baseEnv, isFirstLaunch)` helper** in its own `.cjs`, so "scrub-on-respawn" is unit-testable without a live PTY. If this recurs, a `keeper-env-testing` note is warranted. The other reusable move — *"a single-use spawn token must be captured exactly once at activation and scrubbed at every boundary; never derive it from an inherited flag (`PI_DASHBOARD_SPAWNED`) that descendants keep un-scrubbed"* — is the core insight future spawn-correlation work should carry.

## 7. Pitfalls & dead ends

- **`MODULE_NOT_FOUND` on a new `require`.** Adding `require("./keeper-env.cjs")` to `keeper.cjs` risks a runtime crash if the file isn't packaged where the keeper runs. *If you hit this, do:* confirm the server ships `src/` and runs via jiti (so sibling `.cjs` ships automatically), then prove it with a live `node -e 'require("./keeper-env.cjs")'`.
- **Heredoc/apostrophe breakage in `gh pr create`.** The nested heredoc broke on apostrophes in the PR body. *Fix:* write the body to `/tmp/pr-body.md` and use `--body-file`.
- **`git worktree remove` from inside the worktree.** `--delete-branch` and worktree removal fail while your checkout *is* the worktree. *Fix:* switch to the main repo checkout, then `git worktree remove --force` + delete the branch.
- **CodeRabbit false positives / no-ops.** One "Major" flag claimed the spec lacked capture-once + respawn requirements (they were present); a "Minor" flag ("always serialize `dashboardSpawned`") had zero behavioral effect because `decideDashboardSource` treats `false` and `undefined` identically. *Do:* trace each against real code; fix ambiguity in the **spec/design**, reply with rationale, don't make no-op changes.
- **Pre-existing unrelated test failures.** 18 failures (17 `pi-image-fit` Jimp import + 1 `doctor-route` flake) were noise. *Do:* confirm your touched suites are green (here 32/32) and don't chase unrelated red.
- **Vitest needs an isolated HOME.** Some suites required `HOME=$(mktemp -d) npx vitest run …` to pass cleanly.
- **Deferred manual checks.** Tasks 5.1–5.3 (live-dashboard verifications) were never run — they need a running dashboard. Archived with `--yes`; verify the placeholder clears + check `~/.pi/dashboard/server.log` on your next real worktree spawn.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change dir (`openspec/changes/fix-spawn-token-env-leak/` with a crisp `tasks.md`); a worktree on branch `os/fix-spawn-token-env-leak`; `gh` authenticated; the docker/vitest toolchain.

- [ ] `/skill:openspec-apply-change fix-spawn-token-env-leak` — let it read all change artifacts + source first.
- [ ] Approve the 3-part plan with **"go on"**; implement in `tasks.md` order.
- [ ] Capture the token **once** at bridge activation onto `BridgeState`; expose via `BridgeContext.dashboardSpawned`; replace all live env reads; scrub in the first-register branch.
- [ ] Extract pure `buildPiEnv(baseEnv, isFirstLaunch)` into `packages/server/src/rpc-keeper/keeper-env.cjs` + a unit test; wire `piLaunchCount` in `keeper.cjs`.
- [ ] Run touched suites with `HOME=$(mktemp -d) npx vitest run …`; ignore the pre-existing `pi-image-fit`/`doctor-route` failures.
- [ ] **"check the tasks done"** — verify each task against real code, produce a task→evidence table; prove the new `require` resolves at runtime.
- [ ] `openspec archive fix-spawn-token-env-leak --yes` (syncs delta spec into `spawn-correlation/spec.md`); accept the 3 deferred live-checks.
- [ ] Commit (exclude local `.pi/settings.json` artifact), push, `gh pr create --body-file /tmp/pr-body.md`, poll `gh pr checks`.
- [ ] Triage CodeRabbit per-comment: fix MD056 pipe, clarify spec/design ambiguity, reply-with-rationale for no-ops.
- [ ] Squash-merge, then from the **main** repo: `git worktree remove --force` + delete local/remote branch.

**Artifacts produced:** `packages/server/src/rpc-keeper/keeper-env.cjs` (+ test), edits to `bridge.ts` / `bridge-context.ts` / `session-sync.ts` (+ test) / `keeper.cjs` / `protocol.ts`, updated `tasks.md` + synced `openspec/specs/spawn-correlation/spec.md`, and merged **PR #114** on `develop` (`56344c00f`).

---

_Generated from session `019ec401-9e2e-77c5-9106-326c4752620d` · `pi-agent-dashboard` · 2026-06-14. Source extract: `/tmp/facts-1784847167N.md`._
