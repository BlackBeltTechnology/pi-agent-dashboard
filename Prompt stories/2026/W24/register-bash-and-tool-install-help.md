---
session: 019ec733
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "yes — heavy steering (9 user prompts); large facts sheet (~13271 tok)"
upgrade_status: pending
openspec_changes: [register-bash-and-tool-install-help]
proposal_excerpt: "The dashboard relies on a small set of external CLIs — `jj`, `openspec`, `git`, `bash`, `gh`, `zrok`, `npx` — across the bridge extension, server, build scripts, and assistant chat. Six of the seven are already regist…"
---

# How we did it: Validate → apply → ship a stale OpenSpec change (register-bash-and-tool-install-help) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single terse line:

> **"Validate spec because lot of changes have been made on the codebase"**

The literal ask was *"run `openspec validate`."* The **real** objective — surfaced by that
"lot of changes have been made" clause — was: **prove the change is still coherent with a
codebase that moved underneath it**, then carry it all the way to merged. Over nine prompts
the goal expanded into a full landing pipeline: validate → rescope the stale spec → apply
(implement 33 tasks across 5 packages) → open a PR with green CI → archive + sync specs →
resolve CodeRabbit → merge → clean up branch and worktree.

## 2. TL;DR playbook

1. **Validate twice.** Run `openspec validate <change> --strict` for schema, then **grep the codebase for every anchor the proposal cites** (line numbers, file paths, "OUT OF SCOPE / tracked in X" claims). Schema-valid ≠ coherent.
2. **Quantify the drift** in a table: `Proposal claim | Current reality`. Flag anything already-shipped, already-archived, or moved (line numbers rot fastest).
3. **Rescope across ALL artifacts at once** — `proposal.md`, `tasks.md`, `specs/*/spec.md`, `design.md` — dropping obsolete work and fixing every stale `file.ts:NNN` ref. Re-run `--strict` until green.
4. **Apply via `/skill:openspec-apply-change`.** Read the source surfaces first (`kb agents` / read), implement in package-order phases (shared → bridge → server → client), run each package's tests in isolation with an ephemeral `HOME=$(mktemp -d)`.
5. **Install the worktree** (`npm install`) *before* cross-package tests — a fresh worktree has no `node_modules`, so imports silently resolve to the **main repo's** stale `packages/*`.
6. **Delegate every `docs/` write to a subagent** in caveman style (AGENTS.md rule) — FAQ anchors, file-index rows.
7. **Commit surgically, rebase onto `origin/develop`**, resolve real conflicts (e.g. develop i18n'd a file you touched — keep both), push, open PR against `develop`.
8. **Monitor CI to the test step**, then `/skill:openspec-archive-change`, resolve CodeRabbit threads, squash-merge, delete branch + worktree.

## 3. How the collaboration unfolded

**Phase 1 · Validate for coherence, not just schema (Prompt 1).**
The AI ran `openspec validate --strict` (✅ valid) but did **not** stop there — it grepped every
anchor the proposal named. It found the `npx` half of the change was **obsolete**: `npx` was
already registered (`definitions.ts:91`), its Electron-bundled-node blocker already shipped via
the archived `fix-node-resolution-under-electron`, and three cited line numbers
(`command-handler.ts:605`, `process-manager.ts:475`) had moved or been extracted. It reported the
drift as a `claim | reality` table. *Why it worked:* treating "validate" as "prove coherence
against live code" caught a half-obsolete spec that would otherwise have been implemented as-written.

**Phase 2 · Rescope all four artifacts (Prompt 2 · "yes, apply").**
On a one-word go-ahead the AI edited `proposal.md`, `tasks.md`, `spec.md`, and `design.md`
together: reframed "7 CLIs" → "six already registered, only `bash` missing", deleted the two `npx`
spec scenarios, marked task 1.3 (register npx) removed, and corrected every stale line/file ref
(`:605`→`:728`). Re-validated `--strict` after each sweep.

**Phase 3 · Apply / implement (Prompt 3 · `/skill:openspec-apply-change`).**
The AI loaded the apply skill, read every source surface first, then implemented in package-order
phases: **shared** (new `InstallHints`/`ToolListEntry`/`MissingToolError` types, `bash` registered,
`INSTALL_HINTS` data) → **bridge** (`handleBashCommand` resolves bash via registry, emits structured
`missingTool` on a miss instead of spawning) → **server** (`/api/tools` carries hints, `/api/health`
gains `platform`) → **client** (`[Install ▾]` dropdown, host-OS filtering, deep-linked inline chat
error). Tests were written alongside each phase and run per-package in isolation.

**Phase 4 · PR + CI + archive (Prompts 4–6).**
"create a PR and tests with CI" → committed surgically (excluded incidental `.pi/settings.json`
churn), **rebased onto `origin/develop`** (dropping a redundant abandoned-proposal commit),
resolved a real `ToolsSection.tsx` conflict where develop had i18n'd the file (kept both), pushed,
opened PR #125, watched CI to the `npm test` step. "I will do manual tests later, so mark tasks as
done" → checked the QA-only tasks. `/skill:openspec-archive-change` → the AI caught a **sync-safety
bug**: the delta's MODIFIED requirement would *replace the whole requirement* and silently drop the
main spec's node/npm/npx scenarios — it restored them verbatim before running `openspec archive -y`.

**Phase 5 · Review, merge, cleanup (Prompts 7–9).**
"resolve coderabbit issues" → fetched 2 unresolved threads, applied both minimal fixes (clipboard
`finally`, one-shot dropdown), re-validated, pushed. "monitor CI" → confirmed green for the HEAD
commit specifically. "merge PR, delete branch and worktree" → squash-merged; when `gh`'s post-merge
local sync failed (develop checked out elsewhere) and the shell's cwd vanished with the deleted
worktree, the AI finished cleanup via the sandboxed executor.

## 4. Prompts that worked

- **The goal prompt** — *"Validate spec because lot of changes have been made on the codebase."*
  Effective because it **named the risk** ("changes have been made") rather than just "validate",
  which licensed the AI to check coherence, not just schema. A stronger version:
  *"Validate `<change>` for both schema AND coherence — grep every line-number/path/‘out of scope'
  claim in the proposal against current code and report the drift before doing anything."*
- **High-leverage follow-ups** — each was 1–5 words and unlocked a whole phase:
  - *"yes, apply"* → rescope all four artifacts.
  - *"create a PR and tests with CI"* → commit + rebase + PR + CI watch.
  - *"I will do manual tests later, so mark tasks as done"* → unblocked archive without waiting on manual QA.
  - *"monitor CI"*, *"merge PR, delete branch and worktree"* → drove the finish line.
  The `/skill:openspec-apply-change` and `/skill:openspec-archive-change` invocations were the two
  biggest levers — they loaded the exact procedure so the AI didn't improvise the workflow.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust `--strict` "valid" as done | naming "lot of changes" in the goal | always ask for *coherence* validation (grep anchors), not just schema |
| Wait on manual/QA tasks before archiving | "I will do manual tests later, so mark tasks as done" | state QA policy up front: "manual tasks → check now, I'll verify post-merge" |
| Report CI as green generically | "monitor CI" | pin the assertion to the **HEAD commit SHA**, not "the run passed" |
| Risk silently dropping scenarios on spec sync | (AI self-caught) | when a delta MODIFIES a requirement, diff it against the main spec first — MODIFIED *replaces the whole block* |

Scope expansions the human imposed implicitly: "create a PR **and tests with CI**" folded a
full green-CI expectation into a two-word clause; the AI correctly read that as "don't just push,
prove it passes."

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session **consumed** existing project skills rather
than producing new ones:

- **`openspec-apply-change`** — loaded to drive the 33-task implementation. Effective because it
  enforces read-surfaces-first + task-status discipline so a 5-package change stays coherent.
- **`openspec-archive-change`** — drove the delta→main spec sync + archive move, and its "verify
  the delta doesn't drop scenarios" framing is what caught the sync-safety bug.
- **Two `general-purpose` subagents** — one added FAQ install sections, one added file-index rows.
  Both honor the AGENTS.md rule that all `docs/` writes go through a caveman-style subagent.

**Skill that SHOULD exist:** a `validate-stale-openspec-change` skill capturing the
*schema-valid ≠ coherent* check — grep every proposal anchor (line numbers, paths, "out of
scope / tracked in X" claims) against live code and emit a `claim | reality` drift table before
touching artifacts. This session performed that dance manually and it was the highest-value move.

## 7. Pitfalls & dead ends

- **Fresh worktree has no `node_modules`.** Cross-package tests silently resolved `@blackbelt-technology/*`
  to the **main repo's** stale `packages/*` — server/client tests saw `bash` missing and `installHints`
  undefined. Fix: run `npm install` in the worktree *before* any cross-package test.
- **Test suite flakes under parallel load.** 8/744 files failed in the full run (server-spawn/port/timeout
  flakes, e.g. `elapsed 3812 < 3000`, `ECONNREFUSED`). None were regressions — confirmed by re-running
  the changed packages in isolation. Don't chase load-induced timeouts; isolate the suspects.
- **Vite build ≠ typecheck.** `npm run build` (esbuild) skips full type-checking; the real gate is
  `npm run lint` (`tsc --noEmit`), which caught one bad cast the build passed.
- **`gh pr merge --delete-branch` aborts cleanup** when the base branch (`develop`) is checked out in
  another worktree — the merge still succeeds, but you must delete the branches manually afterward.
- **Deleting the worktree pulls the rug from the shell.** The cwd vanished; the Bash tool couldn't spawn.
  Finish cleanup from the main repo or via the sandboxed executor.
- **Ephemeral HOME needed for vitest.** Tests needed `HOME=$(mktemp -d) npx vitest run -r <pkg> <spec>`.

## 8. Reproduce it faster — checklist

- [ ] `openspec validate <change> --strict` → schema gate.
- [ ] **Grep every proposal anchor** (line numbers, paths, "out of scope / tracked in X") vs live code → drift table.
- [ ] Rescope `proposal.md` + `tasks.md` + `spec.md` + `design.md` together; re-validate `--strict`.
- [ ] `/skill:openspec-apply-change <change>`; read surfaces first; implement shared→bridge→server→client.
- [ ] `npm install` in the worktree BEFORE cross-package tests. Run per-package: `HOME=$(mktemp -d) npx vitest run -r <pkg> <spec>`.
- [ ] Delegate all `docs/` writes to a caveman-style subagent.
- [ ] Gate on `npm run lint` (tsc), not just `npm run build`.
- [ ] Commit surgically (exclude incidental churn) → rebase onto `origin/develop` → resolve conflicts (keep develop's i18n + your additions) → push → PR vs `develop`.
- [ ] Watch CI to the `npm test` step; assert green against the **HEAD SHA**.
- [ ] `/skill:openspec-archive-change <change>` — verify the delta's MODIFIED reqs don't drop main-spec scenarios before sync.
- [ ] Resolve CodeRabbit threads; squash-merge; delete branch + worktree (manually if `gh` cleanup aborts).

**Inputs to have ready:** the OpenSpec change name, write access + `gh` auth, a worktree forked from `develop`.
**Artifacts produced:** rescoped 4-artifact change, 22 code files across 5 packages, PR #125 (merged as `00d8c4d1` on `develop`), archived change `2026-06-14-register-bash-and-tool-install-help`, synced `tool-registry` spec (+7 requirements).

---

_Generated from session `019ec733-1460-7e89-9db1-566c8c85ac81` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-14. Source extract: `/tmp/facts-session-guideline-41442.md`._
