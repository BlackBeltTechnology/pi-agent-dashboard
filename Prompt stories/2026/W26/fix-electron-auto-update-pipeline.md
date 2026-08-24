---
session: 019f103d
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "yes — heavy steering (9 user prompts); large facts sheet (~15327 tok)"
upgrade_status: pending
openspec_changes: [macos-notarization, fix-electron-auto-update-pipeline, windows-authenticode-signing]
proposal_excerpt: "Every macOS DMG published by `.github/workflows/publish.yml` ships **unsigned and un-notarised**. Two distinct user-visible failures result:"
---

# How we did it: Fix the Electron auto-update pipeline — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was two sentences:

> _"Current proposal is: fix-electron-auto-update-pipeline. The code improved a lot from the proposal. Validate."_

The **real objective** that emerged over 9 steering turns: don't just re-audit the
OpenSpec change — *reconcile* the proposal/design/tasks against the code that had
drifted ahead of them, then **actually implement, CI-validate, and ship** the whole
auto-update fix end-to-end. That meant fixing the runtime bug where Electron updates
never reached users, unifying the mac/linux/windows build config so every platform
emits `latest*.yml` + embeds `app-update.yml`, splitting macOS signing into its own
change, and squash-merging the PR into `develop` — a ~11-hour marathon that touched
runtime code, the CI build matrix, docs, skills, and two OpenSpec changes.

## 2. TL;DR playbook

1. **Validate before trusting the spec.** Read proposal/design/tasks, then diff every
   claim against the actual files. Produce a "proposal assumption vs current reality"
   table — the code had moved on, and several tasks were already done.
2. **Reconcile the artifacts first.** Update `tasks.md` (done/partial/open with
   line-level evidence) and `design.md` (reconciliation banner + inline deltas) so the
   spec matches reality *before* writing code. Re-run `openspec validate --strict`.
3. **Implement the verifiable runtime slice with TDD** (`/skill:openspec-apply-change`).
   Sections 1–2 (error logging, the `update-available → downloadAndInstall()` bug fix,
   menu items) are locally testable → write tests, add a `__setTestAutoUpdater()`
   injection seam, prove 10 green + 0 regressions (stash to confirm pre-existing fails).
4. **Pause at the unverifiable boundary.** Surface real design issues (appId drift,
   Windows in-place-upgrade hazard) via `ask_user` and let the human pick the direction
   before touching the CI build matrix.
5. **Unify the build config.** One `electron-builder.yml` for mac/linux following the
   proven Windows `--prepackaged` pattern; add a `build-config-parity.test.ts` to guard
   drift; delete the now-obsolete DMG-naming test your change orphaned.
6. **Split signing out.** Create the `macos-notarization` OpenSpec change (the name was
   already referenced as "planned" in 4 places), cross-link it bidirectionally with §4.
7. **CI-validate the parts you can't run locally.** Dispatch the on-demand `ci-electron`
   matrix, download artifacts, *mount the DMG locally*, and confirm `latest-mac.yml` +
   embedded `app-update.yml`. Two real bugs surfaced only here (see §7).
8. **Ship with `ship-change`.** Archive + sync specs, resolve the develop merge conflict
   as a union, triage CodeRabbit (apply the valid one, reject the CI-outdated ones with
   evidence), get `ci.yml` green, squash-merge, remove the worktree.

## 3. How the collaboration unfolded

**Phase A — Validate & reconcile (prompts 1–3).** The AI read all three OpenSpec
artifacts and diffed each claim against `forge.config.ts`, `publish.yml`,
`app-updater.ts`, etc. Verdict: scaffolding had improved but the *load-bearing failure
chain still existed*. It rewrote `tasks.md` and `design.md` with a reconciliation banner
and line-level evidence (`main.ts:309` still wrongly called `quitAndInstall()`), then
re-validated. **Why it worked:** treating the spec as a hypothesis to be checked against
code — not gospel — caught 5+ already-done tasks and stale line references.

**Phase B — TDD the runtime slice (prompt 4, `openspec-apply-change`).** The AI
implemented only the locally-verifiable Sections 1–2: a `classifyUpdateError()` severity
classifier, file logging to `electron-main.log`, the download-not-quit fix, and menu
items. It hit a harness snag — `require("electron-updater")` couldn't be `vi.doMock`'d —
and solved it with an explicit `__setTestAutoUpdater()` seam. It **stashed its work** to
prove the 5 failing tests were pre-existing. Then it **paused** per AGENTS.md.

**Phase C — Human decision points (ask_user ×2).** Implementation surfaced genuine
design issues the spec didn't foresee: `appId` drift (`com.blackbelt-technology…` vs
`hu.blackbelt…`) with a Windows in-place-upgrade hazard. The human chose "canonicalize
on `com.blackbelt-technology.pi-dashboard` + full mac/linux swap now." This is the
key move — the AI *did not silently pick*; it presented the trade-off and got the call.

**Phase D — Unify build + split signing (prompts 5–7).** A unified `electron-builder.yml`,
a parity test, obsolete-test cleanup, docs (delegated to a caveman-style subagent), and
skill edits. Then it created the `macos-notarization` change mirroring the
`windows-authenticode-signing` sibling, cross-linked to §4.

**Phase E — CI-validate & ship (prompts 8–9).** PR #192, dispatched the `ci-electron`
matrix, and — critically — downloaded and mounted artifacts to verify the real goal.
Then ran `ship-change`: union-merged the develop conflict, triaged 3 CodeRabbit comments
against actual CI evidence, fixed a merge-surfaced tsc break, got `ci.yml` green, and
squash-merged.

## 4. Prompts that worked

- **Goal prompt — "The code improved a lot from the proposal. Validate."** Effective
  because it framed the task as *reconciliation*, not blind implementation. A stronger
  version bakes in the follow-through: _"Validate the change against the current code,
  reconcile the OpenSpec artifacts to reality, then implement and CI-validate what's
  actually still broken."_
- **"update" / "yes" / "all three"-style one-word steers.** These worked only because
  the AI had *first* laid out a clear, enumerated set of options or a status table — the
  human could approve a direction in one token. High-leverage precisely because the AI
  front-loaded the structure.
- **"Create proposal for signing - maybe already there."** Great because the hedge
  ("maybe already there") told the AI to *check first* — it found the `macos-notarization`
  name already referenced as planned and reused it instead of inventing a new one.
- **"create PR and CI validate."** Forced the honesty of real artifacts over local
  confidence — which is exactly where the two real build bugs were caught.
- **"I will test it later, use ship-change skill."** Cleanly delegated the manual-QA
  deferral decision and named the exact skill to run.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Trust the OpenSpec tasks as current | "Validate" | Always diff spec claims vs code before implementing; produce an assumption-vs-reality table |
| Want to plow through all 41 tasks | Implicit approval gates ("update", "yes") | Split into locally-verifiable vs CI-only tiers; pause at the boundary via `ask_user` |
| Silently pick a config direction (appId) | Chose canonicalization explicitly | Present irreversible/user-impacting trade-offs (in-place-upgrade hazard) as a decision, never a default |
| Trust local test green as "done" for build changes | "create PR and CI validate" | Treat build/pipeline work as unverified until the CI matrix + a mounted artifact confirm it |
| Apply every CodeRabbit comment | Verify against CI reality first | Reject outdated review comments *with evidence* (arm64 AppImage built fine); apply only the valid localized one |
| Leak an invalid `type:` field into `tasks.md` edits repeatedly | Remove it each time | Know the tasks.md line schema; don't add a `type` field |

Also imposed: docs writes **must** be delegated to a subagent in caveman style
(AGENTS.md rule); skills (`.pi/skills`) the AI may edit directly.

## 6. Skills, tools & memory created — and why they're effective

No new reusable skill was saved, but the session leaned on and validated several:

- **`openspec-apply-change`** — drove the TDD implementation loop; effective because it
  keeps tasks.md as the single source of progress truth.
- **`ship-change`** — owned archive → sync-specs → conflict-resolve → CodeRabbit triage →
  green-CI → squash-merge → worktree cleanup. Removed a dozen manual git/gh steps.
- **`__setTestAutoUpdater()` injection seam** (in `app-updater.ts`) — the reusable
  pattern worth remembering: when a module `require()`s a dep the test harness can't mock,
  add an explicit test-injection setter rather than fighting the mocker.
- **Two `general-purpose` subagents** for docs writes (caveman style) — enforces the
  repo's docs-delegation rule and keeps prose out of the main context.

**Skill that should exist:** a "CI-validate Electron build artifacts" procedure —
dispatch `ci-electron`, download the arch-tagged artifact, mount the DMG, assert
`latest-mac.yml` + embedded `app-update.yml`. It was reconstructed from scratch here and
caught the two real bugs; worth codifying.

## 7. Pitfalls & dead ends

- **`electron-builder --mac --prepackaged` needs the `.app` path, not its parent dir**
  (unlike `--win`/`--linux`). The parent-dir form produced a malformed bundle that failed
  the deployment-target verify. Point it at the `.app`.
- **`--prepackaged` skips the phase that writes `app-update.yml`.** So `latest-mac.yml`
  (release metadata) generated but the runtime config the updater reads at startup was
  **missing on all three platforms**. Fix: ship `app-update.yml` as a Forge
  `extraResource` so it embeds on every platform. Only caught by mounting the DMG.
- **The deployment-target verify step hardcoded `$APP/Contents/Info.plist`** against the
  old bundle name — a pre-existing step your rename breaks. Make it dynamically discover
  the plist + binary.
- **Pre-existing failures masquerade as your regressions.** The 5 `server-lifecycle-spawn-options`
  fails and the win32-arm64 NSIS smoke fail were red on `develop` too — always `git stash`
  or diff against `develop` before blaming your change.
- **A develop merge surfaced a tsc break in dead `osxSign` code.** Since it was dead
  (CI never sets `APPLE_IDENTITY`) and split to `macos-notarization`, the fix was to
  *remove* it and let that change re-add it correctly — not patch types locally.
- **Stale local `node_modules` (Jimp skew) flags tsc errors CI won't see.** Run the exact
  CI lint command to distinguish real breaks from local install skew.
- **Heredocs choke on apostrophes** (`can't`) — write PR body/comment to a file instead.
- **Removing your own session's worktree kills your shell's cwd.** The final `git worktree
  remove` succeeded but left cosmetic branch-prune to run from the parent repo.
- **`openspec archive` aborted on a pre-existing malformed main spec** (`ci-cd-pipeline`
  had `### Requirement:` blocks with no `## Requirements`/`## Purpose` wrapper). Minimal
  content-preserving header fix unblocked it.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; `gh` authed; the repo owner
(`BlackBeltTechnology`); ability to dispatch `ci-electron.yml`; a macOS machine to mount
the DMG.

- [ ] Diff spec claims vs code → assumption-vs-reality table.
- [ ] Reconcile `tasks.md` + `design.md`; `openspec validate --strict`.
- [ ] TDD the locally-verifiable runtime slice; stash to confirm pre-existing fails.
- [ ] `ask_user` at every irreversible/user-impacting config choice (appId, in-place upgrade).
- [ ] Unify build in one `electron-builder.yml` (`--prepackaged`; mac → `.app` path); add parity test; delete orphaned tests.
- [ ] Ship `app-update.yml` as a Forge `extraResource` (all platforms).
- [ ] Split signing into its own change; cross-link bidirectionally.
- [ ] Dispatch `ci-electron`, download + **mount** artifacts, assert `latest*.yml` + embedded `app-update.yml`.
- [ ] `ship-change`: union-merge conflict, triage CodeRabbit vs CI evidence, green `ci.yml`, squash-merge, worktree cleanup.

**Final artifacts:** PR #192 (squash `431c26d3` → `develop`); `app-updater.ts`,
`electron-builder.yml`, `build-config-parity.test.ts`, `resources/app-update.yml`;
`macos-notarization` OpenSpec change; docs (`architecture.md`, `faq.md`,
`file-index-electron.md`) + `release-cut`/`release-revoke` skills updated.

---

_Generated from session `019f103d-4bb9-7bc9-851c-ea6d0c1cb9b9` · `pi-agent-dashboard` · 2026-06-29. Source extract: `/tmp/facts-story-run.md`._
