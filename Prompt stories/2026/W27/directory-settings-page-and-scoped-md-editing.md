---
session: 019f1654
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts); large facts sheet (~15745 tok)"
upgrade_status: pending
openspec_changes: [directory-settings-page-and-scoped-md-editing, add-internal-monaco-editor-pane]
proposal_excerpt: "The dashboard has two \"settings\" surfaces with wildly different polish. Global settings (SettingsPanel.tsx, route /settings/:page?) is a cog-iconed page with a grouped left-nav, 10 pages, dual-URL routing, and…"
---

# How we did it: Directory Settings page + scoped Markdown editing — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with `/skill:openspec-apply-change directory-settings-page-and-scoped-md-editing` — a single command to implement a 25-task OpenSpec change end to end. The real objective, once the steering turns landed, was: **ship a full feature** in one worktree session — a new cog-entry "Directory Settings" page (Packages/Resources/Instructions), plus in-app scoped Markdown editing (edit `AGENTS.md`/instruction files through a security-bounded write path), verified with tests, docs, code review, and merged to `develop` via the ship pipeline. The apply command was only the kickoff; the value was in navigating a *dependency that wasn't applied yet*, delegating cohesive UI slices, and driving the change all the way through CodeRabbit to a squash-merge.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change>` inside the change's worktree.
2. Before writing code, ask for **mockups** — build one self-contained HTML file using the real dashboard CSS tokens, serve it, screenshot it. Cheap design validation.
3. Read `tasks.md` Task 0.x for **dependency preconditions**. If a dependency spec is unapplied, STOP and surface the fork instead of guessing.
4. When a dependency turns out to already be on `develop`, **rebase/fast-forward onto develop** rather than re-implementing it (`git merge-base --is-ancestor` confirms a clean FF).
5. Build **security-critical core first, TDD**: one shared guard (`isWritableMdTarget`) with exhaustive symlink/traversal tests, then the write/read/list endpoints that all route through it (the "picker ⊆ guard" invariant).
6. Delegate cohesive **client slices to `react-expert`** with a precise brief carrying the exact backend contracts you locked down; then independently verify (tests + tsc) — never trust the subagent's self-report.
7. Keep heavy chunks (Monaco) behind a **`React.lazy` boundary**; a vitest transform error on `?worker` imports is the tell it went eager.
8. Delegate all `docs/` writes to a subagent in **caveman style** (mandatory per AGENTS.md).
9. Run the **code-review gate** (CodeRabbit) on the uncommitted diff, triage every finding with a written disposition, then run `ship-change`.
10. In `ship-change`, expect a **mid-flight merge conflict** in `docs/file-index-*.md` — resolve "keep both", re-run the full gate, push, loop on CodeRabbit threads until 0 unresolved, squash-merge, clean up the worktree from the **parent** repo.

## 3. How the collaboration unfolded

**Phase 1 — Mockup-first design.** Before any implementation, the operator asked for mockups (`Make mockups for change`, then `run with mockup server`). The AI read the real components + theme tokens and built one self-contained HTML file with 8 screens mapped to the change's 4 parts (Directory Settings shell, dirty/clean Save Bar, 409 conflict, 403 reject, global scope, mobile hierarchy), served it, and screenshotted every screen. *Why it worked:* validating layout/states in a throwaway HTML file — using the actual CSS variables — is far cheaper than discovering layout problems mid-implementation.

**Phase 2 — Dependency blocker + the rebase unlock.** Re-invoking apply, the AI hit a genuine fork: the change assumed a Monaco editor primitive (`add-internal-monaco-editor-pane`) that was **completely absent** — not even its v1 read-only pane existed. Rather than guess, the AI laid out blocked-vs-unblocked tasks and asked. The operator's one-line steer — `rebase to develop, because monaco implemented for other purpose` — collapsed the blocker: Monaco had already landed and been archived on `develop`, and the branch was a strict ancestor (clean fast-forward, no conflicts possible). *Decision point:* the human held the missing context (Monaco shipped elsewhere); the AI supplied the git proof it was a safe FF.

**Phase 3 — Security core, bottom-up, TDD.** The AI built the self-contained testable core first: a shared `isWritableMdTarget` guard (realpath-normalized, markdown-only, scope-bounded allowlist) with 14 exhaustive tests (traversal, symlink-escape, sibling-bypass, missing-home), then `POST /api/file/write` (guard→403, mtime→409, atomic tmp+rename), `GET /api/file/md-read`, and the `md-candidates` enumerator — all filtered through the *same* guard so the picker is a strict subset of what the guard permits.

**Phase 4 — Delegated UI slices + verify.** The deeply-woven client work (3 `PiResourcesView` mount sites in `App.tsx`, routing, mobile-depth) was delegated to `react-expert` in two briefs (Part 1 shell/routing; Part 2+4 editor + FilePicker), each carrying the locked backend contracts. The AI then independently ran the affected tests + tsc every time. Two subagent regressions were caught this way: an eager Monaco import (broke lazy boundary + vitest) and a missing global-read endpoint (spec required global editing but `/api/file` was session-cwd-gated).

**Phase 5 — Quality gates.** Full suite (8599 pass; 2 flaky server-spawn timeouts confirmed pre-existing by running in isolation), Biome `--changed`, and a disciplined complexity refactor: every new `noExcessiveCognitiveComplexity` warning was fixed by extracting helpers/subcomponents (repo convention = zero suppressions), while pre-existing `App.tsx` complexity was left untouched per Surgical Changes.

**Phase 6 — Code review + ship.** `code review and use ship-change skill` triggered CodeRabbit (19 findings → 8 fixed incl. the Critical fail-closed realpath, rest skipped with reasons), then the full ship pipeline: archive+sync specs, commit, PR #209, a mid-flight `develop` merge conflict in the file-index docs (resolved keep-both, programmatically), two more CodeRabbit review rounds resolved to 0 unresolved threads, squash-merge (`397be989`), and worktree cleanup from the parent repo.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change <change>`.** Effective because the change was already fully specced (proposal/design/tasks.md); the slash-skill carries the whole apply discipline. A bare "build the settings page" would have skipped the dependency-precondition gate.
- **`Make mockups for change` → `run with mockup server`.** High-leverage: forced a design pass before code, catching layout/state coverage early for a 4-part change.
- **`rebase to develop, because monaco implemented for other purpose`.** The single most valuable steer — one sentence of missing context turned a "there's nothing to reuse, should we build the editor?" blocker into a clean fast-forward. *Stronger reusable form:* "Dependency X already landed on develop — rebase onto it and confirm it's a clean fast-forward before proceeding."
- **`code review and use ship-change skill`.** Chained the review gate before the merge pipeline in one instruction — the right ordering (never ship an un-reviewed diff).

Weak prompts to rewrite: `its okay` and `go on` were fine as low-friction unlocks here, but a future operator should prefer an explicit "proceed with Part N" so the transcript records the decision.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Treat a dependency spec as if it were applied and risk building on a phantom primitive | (AI self-caught, then the human supplied) `rebase to develop, because monaco implemented for other purpose` | State up front where each dependency actually lives (applied? on develop? unbuilt?) in the kickoff |
| Want to jump straight into implementation | `Make mockups for change` / `run with mockup server` | Add a "mockup-first" step to the apply flow for any multi-screen UI change |
| Have a subagent import a heavy chunk eagerly (Monaco) | (AI caught via vitest transform error, fixed with `React.lazy`) | Put "keep Monaco behind a lazy boundary" in the react-expert brief verbatim |
| Leave a global-scope read gap the spec required | (AI caught after subagent flag, added `md-read` under the same guard) | Enumerate every scope (dir + global) in the contract before delegating |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session — it *consumed* the existing pipeline (`openspec-apply-change`, `ship-change`, `serve_mockup`, `react-expert`, the caveman-docs subagent protocol) rather than producing a new asset. The reusable pattern worth extracting: **"backend-contract-first, delegate cohesive UI to react-expert with the locked contract, then independently verify"** — it kept a 25-task change coherent while offloading the interlocking React work, and every delegation was gated by the parent re-running tests+tsc (the subagent's self-report was never trusted). If this recurs, a `delegate-ui-slice-with-verified-contract` skill would capture the brief template + the mandatory verify-after-delegate step.

## 7. Pitfalls & dead ends

- **Phantom dependency.** A `tasks.md` can assume a primitive that doesn't exist. If Task 0.x's precondition is unmet, STOP and surface blocked-vs-unblocked — don't guess an approach.
- **Subagent self-reports lie by omission.** `react-expert` reported "complete" twice while introducing an eager Monaco import and missing a required endpoint. Always re-run affected tests + `tsc` in the parent after any delegation.
- **`?worker` imports break vitest** when Monaco goes eager — the fix is `React.lazy` + `Suspense`, matching the existing `MonacoBuffer` boundary.
- **`biome check --changed` finds nothing without a git base** — fall back to an explicit file list of what you touched.
- **`gh pr merge` fails to check out `develop`** when the parent worktree occupies it — the merge still succeeds; finish branch/worktree cleanup manually from the parent.
- **You can't remove the worktree you're running in** — after `git worktree remove` from the parent, the Bash cwd is gone; use the sandbox for the final verification commands.
- **`-d` won't delete a squash-merged branch** (git doesn't see the merge) — force with `-D`, it's safe once the PR is MERGED.
- **Full-suite flakes:** 2 server-spawn/doctor timeout tests fail under parallel load but pass in isolation — confirm in isolation before blaming your change.

## 8. Reproduce it faster — checklist

- [ ] Confirm you're in the change's **worktree**; kick off with `/skill:openspec-apply-change <change>`.
- [ ] Build + serve **mockups** (one HTML file, real CSS tokens) and screenshot before coding.
- [ ] Read **Task 0.x preconditions**; if a dependency is unapplied, check whether it's on `develop` and fast-forward (`git merge-base --is-ancestor`).
- [ ] Build the **shared security guard first, TDD** (symlink/traversal/sibling tests), then route every read/write/list endpoint through it (picker ⊆ guard).
- [ ] **Delegate cohesive UI to `react-expert`** with the locked backend contract; keep Monaco **lazy**; re-run affected tests + tsc yourself after each delegation.
- [ ] Fix every **new** Biome complexity warning by extraction (leave pre-existing alone); delegate `docs/` writes in **caveman style**.
- [ ] Run **CodeRabbit** on the uncommitted diff; triage each finding with a written disposition; fix the Critical/Majors.
- [ ] Run **`ship-change`**: expect a `develop` merge conflict in `docs/file-index-*.md` (keep both), re-gate, push, loop CodeRabbit to 0 unresolved, squash-merge, clean up worktree **from the parent**.

**Key inputs:** the OpenSpec change dir (`proposal.md`/`design.md`/`tasks.md`), a clean worktree, `develop` up to date, `gh` auth, CodeRabbit access.
**Final artifacts:** PR #209 (merged, `397be989`), `writable-md-target.ts` + guard tests, `md-candidates.ts`, `POST /api/file/write` + `GET /api/file/md-read`, `DirectorySettings/` client tree, `InstructionsEditorPane.tsx`, archived change + synced specs.

---

_Generated from session `019f1654` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-30. Source extract: deterministic facts sheet._
