---
session: 019f1064
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-macos-electron-launch-smoke]
proposal_excerpt: "macOS is the only build leg with **no runtime launch test** — in CI *or* QA. CI's macOS coverage is build + a **static** `otool` `minos` assertion (`_electron-build.yml` \"Verify deployment target floor\"). That proves…"
---

# How we did it: add-macos-electron-launch-smoke — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change add-macos-electron-launch-smoke`. The **real** objective, once the change artifacts were read: macOS was the only Electron build leg with **no runtime launch test** — CI's macOS coverage was a build plus a *static* `otool minos` deployment-floor assertion, which proves the binary *would* run on old macOS but never proves it *actually boots*. The task was to add an in-CI launch smoke that direct-execs the packaged `.app`, waits for the bundled server's `/api/health`, and asserts a healthy launch — then ship it through the real CI so the smoke runs for real, not just locally.

## 2. TL;DR playbook

1. Run `/skill:openspec-apply-change add-macos-electron-launch-smoke` to load the change and its tasks.md.
2. Read the sibling smoke scripts first — clone `qa/tests/08-electron-real-launch.sh` structure rather than inventing one.
3. **Verify the real bundle/binary names before writing assertions** (`grep executableName|name packages/electron/forge.config.ts`) — the spec had them wrong (`pi-dashboard`, not `PI Dashboard`).
4. Write `qa/tests/09-electron-mac-launch.sh`: resolve artifact → wipe `server.log` → direct-exec the Mach-O → poll `/api/health` → 4-point contract → process-tree cleanup trap. Syntax-check with `bash -n` and verify the skip-clean path (exit 0) locally.
5. Wire a `darwin`-gated `Launch-smoke the .app` step into `_electron-build.yml` right after the floor check; on failure dump Electron stdout/stderr + `server.log` tail. Validate the YAML with `js-yaml`.
6. Delegate the docs rows to a subagent in caveman style (file-index + electron-session note).
7. Defer QA-only tasks (green-on-both-arches, negative-check) to the live CI run; ship via `ship-change`.
8. **Dispatch the darwin legs explicitly** (`gh workflow run ci-electron.yml --ref <branch> -f legs=darwin`) — PRs don't trigger the electron build.
9. Watch the run, read the failure dump, fix, re-dispatch. Loop until both arches are green.
10. Merge the PR (squash + delete branch). Leave the worktree removal for **after** the session ends.

## 3. How the collaboration unfolded

**Discovery → Implement.** The AI loaded the OpenSpec change, read the Linux/Windows smoke scripts and the CI workflow, then caught the first landmine immediately: the spec claimed the inner Mach-O was `Contents/MacOS/PI Dashboard`, but `forge.config.ts` showed `executableName: "pi-dashboard"` and bundle `PI-Dashboard.app`. It resolved the binary robustly (known name first, single-Mach-O fallback) and flagged the discrepancy rather than trusting the spec. *Why it worked:* it validated the environment's ground truth before writing brittle string assertions.

**Wire + document.** CI step added on the darwin legs after the floor check, with a failure dump. Docs rows (file-index + electron-session) delegated to a subagent in caveman style per the repo's Documentation Update Protocol. The AI paused at 13/15, correctly leaving the two "green on real macOS runner" tasks for the live CI run — they can't be verified locally.

**Ship + the CI truth test.** The human said "Use shup-change and run the tests on CI" — the AI mapped the typo to `ship-change` and, crucially, understood the *intent*: the point was to make the smoke run on a real runner. It flipped the deferred QA tasks, ran the local verify gate, correctly diagnosed **two local test failures as environment contamination** (a live `:8000` server + a locally-generated extension manifest) by proving the identical commit was green on develop's CI, then archived, pushed, opened PR #191, and — the key move — **explicitly dispatched `ci-electron.yml -f legs=darwin`** because PRs don't trigger the electron build.

**The bug-hunt the CI run exposed.** The first darwin run failed on arm64: 90 seconds of silence, then a GPU crash and a *late* server spawn at exactly the 90s deadline. The AI (with an `Explore` subagent) root-caused it precisely: a **first-run wizard window** (`isFirstRun()` → `showWelcomeStep()`) blocked the server spawn on a fresh CI runner with empty `~/.pi`; it only unblocked when the crashing GPU process took the wizard window down. Fix: pre-seed `~/.pi/dashboard/first-run-done`, add `--disable-gpu`, widen to 120s. Re-dispatch surfaced a *second* real bug: the health JSON had no `starter` field — the correct key was `launchSource == "electron"`; the spec had inherited a stale field name from the Linux `08` script. Fixed, re-dispatched, **both arches green**. Merged.

## 4. Prompts that worked

- **The goal prompt** (`/skill:openspec-apply-change add-macos-electron-launch-smoke`) — a clean skill kickoff that hands the AI a fully-specified change with tasks. Effective because all context lives in the OpenSpec artifacts; the operator doesn't have to re-explain.
- **"Use ship-change and run the tests on CI"** — a high-leverage follow-up. Short, but it carries the real acceptance bar: *the smoke must run on a real runner*, not just pass `bash -n` locally. This is what forced the explicit `ci-electron.yml` dispatch and surfaced two genuine bugs.
- **"2"** (choosing "defer 3.1/3.2 to the live CI run") — a one-token decision that kept the implementation honest instead of faking local verification of CI-only tasks.
- **"remove worktree, branch"** — clean teardown instruction.

*Stronger rewrite of the ship prompt:* "Ship via ship-change, and explicitly dispatch the darwin electron-build legs so the new macOS smoke actually runs on a real runner before merge."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause at 13/15 and wait rather than push to CI | "run the tests on CI" | State up front that CI-only QA tasks are validated by a real dispatched run, not deferred indefinitely |
| Treat local `npm test` failures as a blocker | (implicit) the AI self-corrected by proving them env-contamination | Note that a live `:8000` server + local extension manifest cause `doctor-route` + `recommended-routes` false failures |
| Trust the spec's field/binary names | (the AI caught these itself) | Always `grep forge.config.ts` for real bundle/binary names and probe `/api/health` for the real field (`launchSource`, not `starter`) before writing assertions |
| Nearly leave the electron smoke untriggered (PRs don't run it) | "run the tests on CI" | Remember: `_electron-build.yml` runs via `ci-electron.yml` workflow_dispatch — dispatch `-f legs=darwin` manually |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created, but this session is a textbook case for one. **Recommended skill: `run-electron-mac-launch-smoke-on-ci`** — capturing (a) the three stale-spec traps (binary name `pi-dashboard`, health field `launchSource`, first-run wizard blocking spawn on empty `~/.pi`), (b) the mandatory manual `ci-electron.yml -f legs=darwin` dispatch, and (c) the `--disable-gpu` + `first-run-done` pre-seed needed for headless macOS runners. It would remove a full round of CI-failure archaeology next time. Invoke it whenever adding or debugging any macOS Electron launch test.

Two subagents *were* used well: a `general-purpose` agent for the caveman-style docs rows (per the Documentation Update Protocol) and an `Explore` agent to hunt the Electron startup spawn delay — isolating the root-cause search from the main context.

## 7. Pitfalls & dead ends

- **Spec said `Contents/MacOS/PI Dashboard`; the real binary is `pi-dashboard`.** If a bundle-path assertion fails, grep `forge.config.ts` for `executableName`/`name` — don't trust the spec.
- **The worktree had no `node_modules`.** `vitest` wasn't on PATH; run `npm ci` in the worktree before the verify gate.
- **Local `npm test` shows 2 failures that aren't yours.** `doctor-route` "probeServer never spawns" and `recommended-routes` "expects 15 got 18" are contamination from a live local `:8000` server + local extension manifest — confirm the same commit is green on develop's CI before worrying.
- **PRs don't run the electron smoke.** It only executes under `_electron-build.yml`, dispatched via `ci-electron.yml`. You must `gh workflow run ci-electron.yml -f legs=darwin` manually.
- **90s silence then a late spawn = the first-run wizard is blocking.** On a fresh runner `~/.pi` is empty → `isFirstRun()` true → wizard window awaits its own close → server never spawns. Pre-seed `~/.pi/dashboard/first-run-done` and pass `--disable-gpu`.
- **`/api/health` has no `starter` field.** Assert `launchSource == "electron"`.
- **Never remove your own live worktree mid-session.** `git worktree remove` deleted the session's cwd and stranded the shell harness. Do the teardown from the parent checkout *after* the session ends.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change add-macos-electron-launch-smoke`
- [ ] `grep -niE 'executableName|name' packages/electron/forge.config.ts` — confirm binary = `pi-dashboard`, bundle = `PI-Dashboard.app`
- [ ] Clone `qa/tests/08-electron-real-launch.sh` → `09-electron-mac-launch.sh`; assert `launchSource == "electron"`; pre-seed `first-run-done`; `--disable-gpu`; 120s poll
- [ ] `bash -n` + skip-clean path (exit 0) locally
- [ ] Add `darwin`-gated launch-smoke step to `_electron-build.yml` after the floor check; validate YAML with `js-yaml`
- [ ] Docs rows via subagent (caveman style)
- [ ] `npm ci` in the worktree before the verify gate
- [ ] `ship-change`; then **`gh workflow run ci-electron.yml --ref <branch> -f legs=darwin`**
- [ ] `gh run watch <id>`; read the failure dump; fix; re-dispatch until both arches green
- [ ] Squash-merge + delete branch; remove the worktree from the **parent** checkout after the session ends

**Key inputs:** a GitHub-hosted macOS runner (via `ci-electron.yml`), `gh` auth, the OpenSpec change already scaffolded.
**Final artifacts:** `qa/tests/09-electron-mac-launch.sh`, edited `.github/workflows/_electron-build.yml`, docs rows in `docs/file-index-skills-misc.md` + `docs/electron-session.md`, PR #191 (merged to `develop`, SHA `2f0b9e57`), 2 requirements added to the `electron-qa-coverage` spec.

---

_Generated from session `019f1064-3773-79e2-ab35-775e0055db67` · `pi-agent-dashboard` · 2026-07-24. Source extract: `/tmp/facts-1784864109N.md`._
