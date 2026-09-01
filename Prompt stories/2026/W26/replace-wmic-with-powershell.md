---
session: 019f103f
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts); large facts sheet (~11527 tok)"
upgrade_status: pending
openspec_changes: [replace-wmic-with-powershell]
proposal_excerpt: "Windows 11 22H2+ ships without `wmic.exe` by default. Microsoft deprecated it in 2021 and removed it from the default installable feature set in 22H2 (server) and the optional-component matrix on client."
---

# How we did it: Replace `wmic` with PowerShell — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a single line: *"Current proposal is: replace-wmic-with-powershell. The code improved a lot from the proposal. Validate."* On its face this was a verification request — confirm the OpenSpec change had landed. The **real** objective surfaced within the first minute: the change had *not* landed at all (clean working tree, zero diff vs main, `wmic` still in every runtime call site), so the session pivoted from *validate* → *implement the whole change* → *review it* → *add CI coverage* → *ship it end-to-end*. The end state: every `wmic.exe` shell-out in shipped code replaced with PowerShell `Get-CimInstance` invoked via `spawnSync` (argv, no shell, `windowsHide:true`), backed by unit tests, two new Windows CI gates, updated docs, and a squash-merged PR.

## 2. TL;DR playbook

1. **Validate before trusting the premise.** Run `git diff main --stat` + `grep -rn wmic packages/ --include=*.ts` before believing "the code improved." Here the claim was false — nothing was applied.
2. **Kick off the apply skill:** `/skill:openspec-apply-change replace-wmic-with-powershell`. Read spec + design + every target file *first*, then implement task-by-task.
3. **Replace each `wmic` site with an injectable `spawnSync` + PowerShell `Get-CimInstance`**, keeping failure semantics identical (`false` / `null` / `[]`) and extracting a pure parser (`parseVmProbeOutput`) you can unit-test without a Windows box.
4. **Force `process.platform = "win32"` and stub `spawnSync` in tests** so the Windows branches run on ubuntu CI. Run targeted files with the `HOME=$(mktemp -d)` env guard.
5. **Grep for the second, un-listed `wmic` site.** The spec banned *all* invocations; `tasks.md` missed `listDashboardCodeServerProcesses`. Trust the spec scenario over the task list.
6. **Ask "can CI test this?"** Add (A) a Node-native bundle grep gate (`assert-no-wmic-in-bundle.mjs`) and (B) a real-PowerShell integration smoke on `windows-latest` — using `pwsh`/`node` steps only, never `shell: bash`.
7. **Run the review gate** (`review-changes.ts` / CodeRabbit). Fix the actionable comments — including a Major hole *in your own gate* (per-line scan misses multiline `spawnSync(\n"wmic")`).
8. **Ship:** `/skill:ship-change` — archive + sync specs, commit, merge `origin/develop` to clear branch lag, push, open PR, watch CI green, resolve CodeRabbit, squash-merge.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / disprove the premise.** The AI ran `git status`, `git diff main --stat`, and grepped `wmic` across `packages/`. It found a clean tree and zero diff, and produced a blunt verdict table: *"❌ Not implemented"* with every call site pinned to its pre-change line. *Why it worked:* it refused to accept "the code improved a lot" at face value and gathered evidence first. **Decision point:** the human implicitly accepted the reversal by issuing the apply skill next.

**Phase 2 — Implement.** Triggered by `/skill:openspec-apply-change`. The AI read spec, design, and all target files before editing, then worked task-by-task: `commands.ts` (`isVirtualMachine` → PowerShell probe + `parseVmProbeOutput`), `editor-pid-registry.ts` (`defaultGetCmdline`, now exported + injectable), `process-scanner.ts` (deleted the wmic fast-path and orphaned helpers, promoted the CIM path), `definitions.ts` (dropped the `wmic` binary registration). *Why it worked:* every rewrite kept an **injectable** `spawnSync` and a **pure parser**, so the logic was unit-testable on Linux. **Decision point (self-driven):** it refused to mark tasks 7.3/7.4 (manual Windows-VM smoke) as done — "Marking them done would be dishonest."

**Phase 3 — Review.** Prompted by `review`. CodeRabbit deferred (cloud rate-limit), so the AI did a manual diff review and caught a real inconsistency: the now-primary CIM scan (runs every 10s) lacked `-NonInteractive` while the other two hardened sites had it. It added the flag.

**Phase 4 — CI coverage.** Prompted by *"Is it possible to test on CI?"* then `A + B`. The AI mapped the three test tiers (ubuntu unit branches ✅ already; windows electron-build + smoke jobs available but unwired), then built both gates as Node/`pwsh` steps to satisfy the repo's `no-bash-on-windows` invariant. **Decision point:** the human's terse `A + B` authorized building *both* gates at once.

**Phase 5 — Ship.** Prompted by *"yes, use ship-change"*. Archive + spec-sync via `openspec archive`, commit, merge `origin/develop` (branch was 3 commits behind — the lag explained a deterministic `recommended-routes` failure), push, PR #188, three green CI rounds, a *real* 6-comment CodeRabbit review triaged and fixed, squash-merge. The worktree removal at the end deleted the session's own cwd — an expected terminal side effect.

## 4. Prompts that worked

- **The goal prompt** — *"...The code improved a lot from the proposal. Validate."* Effective because it named the exact OpenSpec change and asked for validation, which licensed the AI to check reality first. A stronger version bakes in the doubt: *"Verify whether change X is actually applied (diff vs main + grep the call sites); if not, apply it."*
- **`/skill:openspec-apply-change replace-wmic-with-powershell`** — high-leverage: one line switched the session from analysis to a structured, task-tracked implementation.
- **`review`** — one word triggered the review gate and surfaced the missing `-NonInteractive` flag.
- **`Is it possible to test on CI?`** — a *question*, not an order. It made the AI enumerate options (tiers A/B) instead of guessing, so the human could choose.
- **`A + B`** — three characters that authorized the full CI-hardening scope. Terse follow-ups work *because* the prior turn laid out labeled choices.
- **`yes, use ship-change`** — named the exact skill, so the ship pipeline ran without further prompting.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| stop at "validate" and report status | issuing `openspec-apply-change` to continue into implementation | phrase the goal as "verify, and if not applied, implement" |
| treat `tasks.md` as the complete scope | (self-corrected) grepping and finding the un-listed 2nd wmic site | trust the **spec scenario** ("zero wmic in shipped code") over the checklist |
| consider the diff done after code | `review` | make review a standing step, not a request |
| assume unit tests were enough | `Is it possible to test on CI?` | ask the CI-coverage question for every platform-specific change |
| want to mark all tasks done | (self-corrected) leaving 7.3/7.4 unchecked as manual VM smoke | keep a "manual-only" tag on tasks a headless box cannot run |
| trust local red tests | prove them environmental (jimp not installed; 5s-timeout flakes under load) then defer to CI | run touched packages **in isolation** before blaming your change |

## 6. Skills, tools & memory created — and why they're effective

No new pi skill or memory was persisted this session, but the workflow leaned on existing ones in a repeatable chain worth codifying:

- **`openspec-apply-change`** — turned a spec into a task-tracked implementation with progress counts. Invoke whenever a change's `tasks.md` exists and code needs to land.
- **`ship-change`** — the archive → commit → merge-develop → PR → CI-watch → CodeRabbit-resolve → squash-merge pipeline. Invoke once implementation + review are green.
- **Two durable CI artifacts** (the reusable output): `packages/electron/scripts/assert-no-wmic-in-bundle.mjs` (Node-native whole-file bundle grep, exit 0/1/2) and `scripts/windows-introspection-smoke.ts` + `_windows-introspection-probe.ts` (real-`Get-CimInstance` contract check on `windows-latest`). These convert a spec *scenario* into a permanent per-build gate.

**Recommended skill to create:** *"platform-shellout-migration"* — the pattern of replacing a shelled-out OS utility with an injectable `spawnSync` + pure parser, unit-tested via forced `process.platform`, plus a bundle-grep CI gate. It recurred implicitly and would save the whole discovery loop next time.

## 7. Pitfalls & dead ends

- **`sed -i '' 's/- \[ \]/- [x]/g'` to bulk-check tasks failed** and would have been dishonest anyway — some tasks are manual VM smoke. Don't auto-check; flag manual ones.
- **Root PATH lacked `vitest`.** Use `npx vitest run ...` with the `HOME=$(mktemp -d) NODE_OPTIONS=--localstorage-file=$(mktemp)` guard that `npm test` sets — bare `vitest` won't resolve.
- **`biome check --changed` needs VCS state**; on a fresh worktree run Biome on explicit file paths instead.
- **Local test reds were noise:** `jimp` wasn't installed in the worktree (image-fit failures) and server tests hit 5s timeouts under machine thrash. Prove environmental by running one file alone; CI's clean `npm ci` is the authoritative gate.
- **Branch lag bites silently:** the worktree was 3 commits behind `origin/develop`, causing a deterministic `recommended-routes` manifest mismatch (15 vs 18). Merge develop *before* trusting the suite.
- **`gh pr merge` collides with worktrees** — it tried to switch to `develop` (checked out in the parent) and failed the local branch-delete even though the PR merged. Do branch/worktree cleanup from the parent repo.
- **Removing the worktree kills the session's cwd.** Expected — everything was already committed/merged; only a dangling local branch ref remained, deletable from the parent.
- **Your own CI gate can have the bug you're gating against:** the first `assert-no-wmic-in-bundle.mjs` scanned per-line and would miss a multiline `spawnSync(\n"wmic")`. CodeRabbit's Major caught it; the fix was whole-file scanning + a multiline canary test.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an OpenSpec change with `tasks.md` + `spec.md`; a clean worktree that's current with `origin/develop`; `gh` auth for the PR; the `HOME=$(mktemp -d)` test-env guard.

- [ ] `git diff main --stat` + `grep -rn wmic packages/ --include=*.ts` — confirm the actual start state.
- [ ] `/skill:openspec-apply-change <change>`; read spec/design/all targets before editing.
- [ ] Replace each shell-out with injectable `spawnSync` + PowerShell `Get-CimInstance`; extract a pure parser; keep failure semantics identical.
- [ ] Grep the whole tree for the utility name — catch call sites `tasks.md` omits.
- [ ] Add tests that force `process.platform="win32"` + stub `spawnSync`; run with the mktemp `HOME` guard, isolated per package.
- [ ] Add CI gates: Node-native bundle grep (whole-file, multiline-safe) + a real-`pwsh` integration smoke on `windows-latest` (no `shell: bash`).
- [ ] Run the review gate; fix actionable comments *including* gaps in your own gate.
- [ ] Merge `origin/develop`, then `/skill:ship-change`; watch CI green, resolve CodeRabbit, squash-merge; clean up worktree **from the parent repo**.

**Final artifacts produced:** rewritten `packages/shared/src/platform/commands.ts`, `packages/server/src/editor-pid-registry.ts`, `packages/extension/src/process-scanner.ts`, `packages/shared/src/tool-registry/definitions.ts`; new `packages/electron/scripts/assert-no-wmic-in-bundle.mjs`, `scripts/windows-introspection-smoke.ts`, `scripts/_windows-introspection-probe.ts`, `packages/server/src/__tests__/editor-pid-registry-cmdline.test.ts`; wired `_electron-build.yml` + `_smoke.yml`; merged PR #188.

---

_Generated from session `019f103f-4aa1-7848-add3-27857d4739df` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-29. Source extract: `/tmp/facts-48017-29.md`._
