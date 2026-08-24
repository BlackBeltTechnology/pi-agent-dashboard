---
session: 019ec774
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "yes — created 0 skill(s) / 1 memory(ies); heavy steering (9 user prompts); large facts sheet (~15216 tok)"
upgrade_status: pending
openspec_changes: [embed-git-bash-on-windows, restore-windows-nsis-installer]
proposal_excerpt: "On Windows the pi agent cannot operate without two host-supplied tools:"
---

# How we did it: Embed git+bash on Windows — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The opening prompt was tiny: **"Recheck proposal, because current code can make some changes related."** The real objective, which the steering turns made explicit, was much bigger: **take a stale OpenSpec change (`embed-git-bash-on-windows`) all the way from proposal-recheck → CI-verified spike → full 34-task implementation → docs → spec sync → archive → PR → CodeRabbit fixes → merge → cleanup.** The change bundles git + bash into the Windows Electron build (via `dugite-native`) so the pi agent can run `!`/`!!` shell commands and git worktrees without a host-installed Git for Windows. The session ran ~2h48m on Opus, 24 code files, 34 tasks, one merged PR (#124).

## 2. TL;DR playbook

1. **Recheck the proposal against current code before writing anything.** Delegate a read-only pass over every path the proposal names; expect drift (repo had migrated `src/server/` → `packages/server/src/`).
2. **Fix the *wiring-model* drift, not just paths.** The real injection point was `ToolResolver.buildSpawnEnv` (a single chokepoint), and the PTY path (`terminal-manager.ts`) **bypasses it** — that needed a separate hook.
3. **Turn the risky assumption into a CI spike, not a manual VM.** Push a throwaway `.github/workflows/spike-git-bash.yml` that on `windows-latest` + `windows-11-arm` downloads the pinned tarball → SHA-256 verify → Node-`tar` extract → probe → ZIP round-trip → re-probe.
4. **Let the spike correct the proposal.** It found: no `bash.exe` (ships `sh.exe` = GNU bash), arch-specific libdir (`mingw64` x64 / `clangarm64` arm64), and no symlinks. Fold each finding back into proposal/specs/tasks.
5. **Implement the testable runtime core first, TDD.** `selectGitSource()` truth-table + `ensureBundledGitOnPath()`/`resolveBundledGitDir()` with unit tests, then wire into `buildSpawnEnv` + PTY.
6. **Fan out to config → API → UI → build pipeline → docs**, marking each `tasks.md` checkbox as its tests pass.
7. **Verify in the worktree by symlinking workspace packages** (worktrees have no local `node_modules`), so cross-package tests resolve *your* code, not the main repo's.
8. **Archive + sync specs, open PR, validate CodeRabbit findings against real code before applying, rebase, merge, delete branch + worktree.**

## 3. How the collaboration unfolded

**Phase 1 — Recheck & drift-hunt (Prompt 1).** The AI delegated a verification read over the proposal's referenced paths and found two-tier drift: cosmetic (`src/server/` → `packages/server/src/`) and substantive (`ensureWindowsSystemPath` was *not* called where the proposal claimed; it lived at one chokepoint, `buildSpawnEnv`, and the PTY path bypassed it entirely). It also caught two *pre-existing* openspec validation errors (SHALL/MUST must land on the requirement's first line). Why it worked: **treating the proposal as a hypothesis to falsify against current code** surfaced a bug that would have wasted the whole implementation.

**Phase 2 — Apply, then a reality-check STOP (Prompt 2).** `openspec-apply-change` ran; the AI read all 34 tasks and *stopped* to flag that several tasks were environmentally blocked on a macOS host (needed a real Windows box). Decision point: the human asked **"Is it possible to create a PR for that and perform the spike on CI?"** — redirecting from "manual VM" to "CI as the clean Windows box."

**Phase 3 — CI spike (Prompt 3).** The AI built a throwaway spike workflow honoring the repo's *no-`shell: bash`-on-Windows* invariant (`pwsh`/`node` only), pushed, opened PR #124, and iterated the probe from hardcoded paths → **self-discovering** layout mapping. The spike went green on x64 + arm64 and produced three concrete corrections, all folded back into the spec. Why it worked: **the spike was faithful to production packaging** (ZIP round-trip, where Windows symlink loss actually happens), so its findings were trustworthy.

**Phase 4 — Full implementation, TDD (Prompt 4).** Runtime core first (`selectGitSource`, `ensureBundledGitOnPath` — 30 unit tests), then wiring (`buildSpawnEnv` + separate PTY hook), config/API/UI, build pipeline (`_git-version.json` real hashes, `download-git-windows.mjs` with fail-closed SHA-256, GO/NO-GO in `bundle-server.mjs`), repo-lint test, docs (delegated to a subagent in caveman style). Each milestone was committed.

**Phase 5 — Archive & sync (Prompt 5).** `openspec archive` aborted on a *pre-existing* malformed main spec (a prior archive had left a `## ADDED Requirements` header with no `## Purpose`). The AI fixed the header + added Purpose, then synced 6 requirements and archived.

**Phase 6 — Ship: rebase, CodeRabbit, merge, cleanup (Prompts 6–9).** Rebased onto `develop` (one `docs/faq.md` conflict, kept both sides), validated all 6 CodeRabbit threads *against the actual code* before fixing (found a real POST-vs-PUT no-op bug), force-pushed, merged via the repo's merge-commit convention, deleted branch + worktree.

## 4. Prompts that worked

- **Goal prompt — "Recheck proposal, because current code can make some changes related."** Weak as written (vague), but effective because it framed the proposal as *suspect*. **Stronger version:** *"Recheck the `embed-git-bash-on-windows` proposal against current code — verify every referenced path and the wiring model still hold, and fix any drift before we implement."*
- **"Is it possible to create a PR for that and perform the spike on CI?"** — High leverage. Converted a blocked manual step into an automatable one and unblocked the whole change.
- **"/skill:openspec-apply-change …" (twice)** — Reused the same skill invocation to resume after the spike; clean checkpoints.
- **"1. archive and sync 2. create PR …" style numbered lists** (seen in sibling sessions) and **"merge PR, delete branch and worktree"** — terse imperative sequences that let the AI batch the endgame without re-confirming each step.
- **"rebase develop and fix coderabbit issues"** — one line that triggered rebase + a validate-then-fix loop over review threads.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust the proposal's stated file paths/wiring | Prompt 1 "recheck… current code" | Always start a stale change with a drift-verification pass |
| Treat Windows-only tasks as blocked on macOS | "perform the spike on CI?" | Default to CI runners (`windows-latest`/`windows-11-arm`) as the clean Windows box |
| Hardcode expected binary paths (`usr/bin/bash.exe`, `mingw64`) | Spike output forced self-discovery | Make probes *discover* layout; never assume MinGit tree shape |
| Assume `bash.exe` exists | Spike found only `sh.exe` (= GNU bash) | Target `sh.exe`; pi's `!`/`!!` call `pi.exec("sh")` anyway |
| Emit stray keys in edit calls (7 edit errors) | Retried with exact matches | Read exact text before editing; keep `oldText` minimal + unique |
| Apply CodeRabbit fixes blindly | Validate each against real code first | Confirm the claim (e.g. `/api/config` is PUT-only) before patching |

Scope expansions the human imposed: **spike on CI** (Prompt 3), **full apply not just recheck** (Prompt 4), and the whole **archive→PR→merge→cleanup** endgame (Prompts 5–9).

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved (project · tool-quirk):** *"pi-agent-dashboard git worktrees (`.worktrees/<name>`) have NO local `node_modules/@blackbelt-technology` — cross-package imports resolve to the **main repo's** packages, not the worktree's."* **Why effective:** it explains a whole class of phantom test failures (38 → 9 failed files were pure resolution artifacts). Next time you run cross-package tests in a worktree, symlink the workspace packages locally first — this memory tells you to.
- **Subagent spawned:** `general-purpose` — "Write docs for embed-git-bash-on-windows" (docs delegated in caveman style per AGENTS.md). **Why effective:** keeps `docs/` prose out of the main agent's context and honors the repo's DocScribe convention.
- **Skill that *should* exist (and now does):** a *"verify worktree code by symlinking workspace packages"* procedure — the manual `ln -s` dance to make package-subpath imports resolve to worktree code. Worth a project skill so future worktree QA doesn't rediscover the resolution artifact.
- **Tools leaned on:** `gh` (PR + `gh run watch`/`gh run view --log`), `openspec validate/status/archive`, `vitest` with `HOME=$(mktemp -d)` for test isolation, and CI itself as a hardware substitute.

## 7. Pitfalls & dead ends

- **Worktree resolution trap.** New shared files were invisible to package-subpath imports because the worktree resolved to the main repo's `packages/shared`. Fix: symlink worktree-local workspace packages; CI (fresh checkout) is unaffected. *If your new module "doesn't exist" in a worktree, check where the import resolves before debugging the code.*
- **`node:child_process` lint violation.** A direct import tripped a repo guard; route through the `exec.js` wrapper instead.
- **`shell: bash` on Windows is banned** (unit-tested invariant). Any Windows-reachable CI step must be `pwsh`/`node` only.
- **openspec validator only checks the requirement's first line for SHALL/MUST.** Wrapped requirements fail; reflow so SHALL lands on line 1.
- **`openspec archive` aborts on a malformed *existing* main spec** (`## ADDED Requirements` header, no `## Purpose`). Fix the header → `## Requirements` and add a Purpose block.
- **Test-suite timeout flakes under parallel load.** ~9 files failed in batch but passed solo — don't chase them as regressions; re-run solo to confirm.
- **PR title said "spike:" at merge time** — rename before merging so the merge commit is accurate.
- **`gh pr merge` tried to switch *this* worktree to `develop`** (already checked out in main worktree) — the remote merge still succeeded; verify PR state rather than trusting the CLI exit.
- **Asset filename ≠ release tag** for dugite-native: the URL path uses tag `v2.53.0-3` but the filename infix is a git short-SHA (`v2.53.0-f49d009`). `_git-version.json` needs *two* fields.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** authed `gh` CLI, the OpenSpec change dir, a worktree on a feature branch, the pinned `dugite-native` release + real SHA-256 hashes, and Windows CI runners available (`windows-latest`, `windows-11-arm`).

- [ ] Recheck the proposal against current code; fix path + wiring drift first.
- [ ] Identify the real env chokepoint (`buildSpawnEnv`) *and* any bypass (PTY `terminal-manager.ts`).
- [ ] Write a throwaway CI spike (`pwsh`/`node` only) that mirrors production packaging (ZIP round-trip); run on x64 + arm64.
- [ ] Fold every spike finding back into proposal/specs/tasks (`sh.exe`, arch libdir, no symlinks).
- [ ] TDD the runtime core (`selectGitSource`, `ensureBundledGitOnPath`) before wiring.
- [ ] Fan out config → API → UI → build pipeline → docs (docs via subagent, caveman style); check off tasks as tests pass.
- [ ] In a worktree, symlink workspace packages before running cross-package tests.
- [ ] `openspec validate` → archive + sync → PR → validate CodeRabbit findings vs code → rebase → merge → delete branch + worktree.

**Final artifacts:** PR #124 (merged, commit `c0496886`); runtime core under `packages/shared/src/platform/` (`select-git-source.ts`, `ensure-bundled-git.ts`, `git-source.ts` + tests); build pipeline `packages/electron/scripts/{_git-version.json,download-git-windows.mjs}`; synced specs `openspec/specs/{electron-build-pipeline,windows-git-bash-runtime}`.

---

_Generated from session `019ec774-fad3-755c-8c15-453b6226c719` · `pi-agent-dashboard` · 2026-06-14. Source extract: `/tmp/facts-embed-git-bash.md`._
