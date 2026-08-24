---
session: 019f28f1
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-automation-stop-zombie-runs]
proposal_excerpt: "The automation run lifecycle never terminates the session it spawns. Automation runs are `pi --mode rpc` — persistent, multi-turn sessions that do not self-exit when a turn ends. Nothing in the plugin closes them,…"
---

# How we did it: Fix automation "zombie" runs — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened not with a task but with a challenge to the spec: **"Is there anything to clarify?"** The user handed the AI a fully drafted OpenSpec change (`fix-automation-stop-zombie-runs`) and asked it to find the holes before any code was written. The real objective, once the steering turns landed, was a full spec-driven fix: automation runs spawn `pi --mode rpc` sessions that never self-exit, so the plugin leaks persistent "zombie" processes. The AI had to (1) pressure-test the proposal against the actual code, (2) apply the change end-to-end via `openspec-apply-change`, and (3) ship it via `ship-change` — commit, PR, CI, CodeRabbit, squash-merge, worktree cleanup.

## 2. TL;DR playbook

1. **Don't trust the spec — verify its claims against source.** Open the proposal/design/tasks, then `grep` for every primitive it names (`killBySessionId`, `spawnToken`, `{type:"shutdown"}`) and confirm each behaves as asserted.
2. **Trace the one risky assumption to ground truth.** Here: *does `{type:"shutdown"}` actually exit an rpc session?* Follow it to `bridge.ts` (`setTimeout(()=>process.exit(0),500)`) and to the production manual-close path (`handleShutdown`).
3. **Fix the spec's under-decided Open Questions in `design.md` + `tasks.md`** before coding — record the evidence inline, then `openspec validate <change> --strict`.
4. **Apply via `/skill:openspec-apply-change <change>`** — read every file you'll edit first, then implement task-by-task, matching existing test conventions.
5. **Run affected tests with an ephemeral HOME:** `HOME=$(mktemp -d) npx vitest run <files>` — avoids polluting `~/.pi`.
6. **In a worktree, materialize worktree-local workspace symlinks** so `tsc` resolves *your* cross-package edits, not the main repo's stale copies.
7. **Ship via `ship-change`:** archive+sync specs, revert spurious codegen (`plugin-registry.tsx`), commit via a message *file* (dodges backtick pitfalls), PR against `develop`, watch CI.
8. **Triage CodeRabbit against the codebase's own tested contract** — a "real bug" suggestion can conflict with a deliberate, documented sibling contract. Apply the valid part, reason-skip the rest, reply on every thread.

## 3. How the collaboration unfolded

**Phase 1 — Adversarial spec review (Discovery).** The AI read the change artifacts, then verified each concrete claim against code by grepping the named primitives. It surfaced two *substantive* under-decisions the tasks silently resolved: soft-abort-vs-hard-kill on Stop, and whether graceful `{type:"shutdown"}` is guaranteed to exit a keeper rpc session. **Decision point:** the human answered "yes" (steering #1), authorizing the AI to resolve both in the spec.

**Phase 2 — Trace to ground truth.** Rather than assume, the AI traced the shutdown path: bridge-side `process.exit(0)` safety net (fires ~500 ms *only if the WS is OPEN*), and the production `handleShutdown` that never trusts graceful alone — it sends `{type:"shutdown"}` **and** `killBySessionId` (SIGTERM→2 s→SIGKILL). This flipped the recommendation to **mandatory escalation**, recorded in `design.md` D3/D3b + Open Questions, then `openspec validate --strict`.

**Phase 3 — Apply (`openspec-apply-change`).** Steering #2 (`/skill:openspec-apply-change`) launched the 14-task implementation: `killByToken` in the registry (shared kill-ladder helper), a trust-gated `abortAutomationRun` host hook, engine `spawnToken` capture + async `stopRun`, and every test/fixture. The AI read all edit targets first, then went task-by-task.

**Phase 4 — Verify.** Affected tests via ephemeral HOME (all green), then a worktree `tsc` snag: the worktree shared the main repo's `node_modules`, so `tsc` resolved cross-package types from *unedited* main source. The AI diagnosed it as a resolution artifact and materialized worktree-local symlinks. Full suite: one pre-existing env-only failure (`node-electron-resolution`, sensitive to the installed `PI-Dashboard.app`) — confirmed identical on clean `develop`.

**Phase 5 — Ship (`ship-change`).** Steering #3 drove archive+sync, commit, PR #223, CI (green, and the electron test *passed* on CI — proving the local failure environmental). **Decision point:** CodeRabbit flagged a "real bug" in `killEntry`'s return value; the AI first applied `.ok`, then discovered a deliberate sibling contract (`killBySessionId` returns `true` for a dead-but-known entry = "kill issued"), reverted the conflicting change, kept the valid test-shape fix, and reply-documented the skip. Squash-merged, branches + worktree removed.

## 4. Prompts that worked

- **The goal prompt — "Is there anything to clarify?"** Deceptively strong: it framed the AI as a spec *critic*, not an order-taker, which surfaced two substantive under-decisions before a line of code was written. A future user should open review work exactly this way.
- **"yes" (high-leverage follow-up).** One word authorized the AI to resolve *both* open questions it had just enumerated — because the AI had already stated its recommended resolution and the evidence, "yes" carried full intent.
- **`/skill:openspec-apply-change fix-automation-stop-zombie-runs`** and **"Use ship-change skill"** — terse skill-invocations that handed off cleanly *because the prior phase had already de-risked the plan*. The lesson: front-load the clarification, then the build/ship prompts can be one line.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Present open questions and pause | "yes" — authorize resolving all of them | State "resolve every open question you find, with evidence" in the kickoff |
| Stop after spec review | `/skill:openspec-apply-change …` | Chain the apply skill in the same session once the spec is sound |
| Stop after implementation | "Use ship-change skill" | Name the terminal skill (`ship-change`) up front so the AI runs the full pipeline |
| Accept a reviewer's "real bug" fix | (self-corrected) check it against the tested sibling contract | Always grep the existing contract before applying a reviewer's semantic change |

## 6. Skills, tools & memory created — and why they're effective

No new skill was created — the session *composed* three existing ones (`openspec-apply-change`, `ship-change`, implicit doubt-driven review). The reusable pattern worth capturing: **"verify-then-apply-then-ship" for a pre-drafted OpenSpec change** — always trace the single riskiest spec claim to source before touching the design, resolve open questions with recorded evidence, then run apply→ship without re-litigating. If this recurs, a `verify-openspec-proposal` skill (grep every named primitive, trace the risky assumption, resolve Open Questions inline, `validate --strict`) would remove the manual discipline.

## 7. Pitfalls & dead ends

- **Worktree `tsc` resolves stale main-repo types.** A worktree sharing the main `node_modules` resolves cross-package `import`s from unedited main source → phantom type errors. Fix: materialize worktree-local workspace symlinks; the code was correct all along.
- **`node-electron-resolution.test.ts` fails locally, passes on CI.** Environment-sensitive to the installed `PI-Dashboard.app`. Confirm it fails identically on clean `develop` HEAD before blaming your diff.
- **`plugin-registry.tsx` regenerates spuriously.** `npm install`/`npm run build` in a worktree lacking the `demo-plugin` fixture drops it from codegen. `git checkout --` it before committing.
- **A reviewer's "correct" fix can break a deliberate contract.** `killBySessionId` intentionally returns `true` for a dead-but-known entry ("kill issued"). Grep the sibling's tested contract before applying `.ok`-style changes.
- **`HOME` pollution + backtick-in-`$()` commit messages.** Use `HOME=$(mktemp -d)` for vitest; write commit messages to a *file* to dodge shell-escaping traps.
- **`gh pr merge` fails the local `develop` checkout in a parent worktree** even when the remote merge succeeds — verify MERGED state on the remote before retrying.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a drafted OpenSpec change dir, `gh` auth, the worktree checked out.

- [ ] Read proposal/design/tasks; `grep` every primitive the spec names; confirm behavior.
- [ ] Trace the single riskiest claim to source (here: shutdown → `bridge.ts` + `handleShutdown`).
- [ ] Resolve Open Questions in `design.md`/`tasks.md` with inline evidence; `openspec validate <change> --strict`.
- [ ] `/skill:openspec-apply-change <change>` — read edit targets first, implement task-by-task, match test conventions.
- [ ] `HOME=$(mktemp -d) npx vitest run <affected>`; materialize worktree symlinks for `tsc`.
- [ ] `ship-change`: archive+sync, revert spurious codegen, commit via file, PR vs `develop`, watch CI.
- [ ] Triage CodeRabbit vs the tested contract; apply valid, reason-skip conflicts, reply on all threads; squash-merge; remove worktree.

**Final artifacts:** PR #223 (squash-merged to `develop`, commit `d3ce851`); archived change `openspec/changes/archive/2026-07-03-fix-automation-stop-zombie-runs/`; live spec `openspec/specs/automation-run-lifecycle/spec.md`; new test `packages/server/src/__tests__/headless-pid-registry-kill-by-token.test.ts`.

---

_Generated from session `019f28f1-af63-7e18-9425-7ed722c9c435` · `pi-agent-dashboard` · 2026-07-03. Source extract: session facts sheet._
