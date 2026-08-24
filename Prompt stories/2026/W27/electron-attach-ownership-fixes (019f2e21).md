---
session: 019f2e21
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "yes — created 0 skill(s) / 2 memory(ies); heavy steering (22 user prompts); large facts sheet (~25623 tok)"
upgrade_status: pending
openspec_changes: [run-electron-e2e-native-surface, electron-attach-ownership-fixes]
proposal_excerpt: "electron-attach-ownership-fixes added four behaviours whose only faithful verification is launching the real packaged Electron app — they live on native surfaces (or in the real main process) that unit tests, th…"
---

# How we did it: Land the Electron attach-ownership feature and its real-app E2E suite — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change electron-attach-ownership-fixes
```

Plainly: *finish implementing an already-scoped OpenSpec change* that hardens how the
Electron shell decides who owns the dashboard server (spawned-by-us vs. attached-to-a-
foreign-server vs. an orphaned "zombie"). But the real objective only emerged through
steering: the four new behaviours — health-endpoint ownership fields, the tray
"Server managed externally" row, the zombie-adoption modal, and the Doctor
version-skew row — **can only be faithfully verified by launching the real packaged
Electron app**. So the session grew from "apply the change" into a full arc: implement
→ build a Playwright-Electron E2E harness that exercises native surfaces → wire CI
across ubuntu+windows → fix every real bug the real-app launch surfaced → ship through
five stacked PRs → process the CodeRabbit review → archive the OpenSpec changes.

## 2. TL;DR playbook

1. **Apply the change first.** Run `/skill:openspec-apply-change <name>`, then honour
   the steering "remove stale" — prune dead tasks/artifacts before adding new ones.
2. **Push automatability to its limit.** When tasks look "manual/native-only", ask the
   model *"can this be tested with docker + Playwright or Electron CDP?"* — most can.
3. **Stub the OS, don't drive it.** For native surfaces (tray menu, Job Object),
   **monkeypatch the electron module in-process via `electronApp.evaluate`** (e.g.
   record every `Menu.buildFromTemplate` template) instead of `osascript`/UIAutomation.
   No production test-seam, runs on both ubuntu and windows legs.
4. **Create the PR and let CI find the truth.** `create PR and test on CI`. The real
   packaged-app launch surfaces bugs no unit test can (binary resolution, sandbox,
   lockfile desync).
5. **When CI blocks on someone else's bug, fix it in its own PR.** A pre-existing
   colon-named path broke *every* Windows checkout — split it into a separate one-file
   PR off `develop`, merge, then rebase/merge the feature.
6. **Merge develop in (don't rebase) when history is pushed + divergent.** Re-apply the
   feature onto develop's rewritten `main.ts` by hand rather than replaying hunks.
7. **Process the review as fix-forward.** Turn each CodeRabbit finding into a concrete
   fix + a regression test; land them in one follow-up PR.
8. **Debug CI iteratively with evidence.** Download the Playwright report artifact,
   read the page snapshot, name the root cause, fix, re-dispatch — repeat until two
   consecutive green runs.
9. **Archive last.** Fold spec deltas into the main specs, repair any pre-existing spec
   corruption you hit, `openspec archive`, PR, merge, clean up worktrees.

## 3. How the collaboration unfolded

**Phase A — Apply & prune (prompts 1–2).** The model ran the OpenSpec apply skill,
implemented the health-endpoint ownership fields (`bootParentAlive`,
`activeBridgeCount`, `launchSourceEffective`), the tray/zombie/Doctor wiring, and the
supporting server modules (`boot-parent-liveness.ts`, `launch-source-effective.ts`)
with unit tests. The human's *"remove stale"* kept the task list honest.

**Phase B — Automate the "unautomatable" (prompts 3–10).** The pivotal stretch. The
human repeatedly pushed on testability: *"If it can be tested with docker test and
playwright or Electron CDP do it"* → *"Is it possible to automate tests on CI?"* →
*"7.2 and 7.4a cannot use that way that emulates that event? For example firing another
program…"* The model landed on the winning technique: **launch the packaged app under
Playwright-Electron and monkeypatch `electron`'s `Menu.buildFromTemplate` inside the
main process** to capture the tray templates, plus a Windows Job Object smoke driven by
`taskkill /F`. This produced `electron-lifecycle.ts`, `playwright.electron.config.ts`,
three `.electron.spec.ts` files, `windows-liveness-smoke.ts`,
`windows-job-object-smoke.ts`, and the `ci-e2e-electron.yml` matrix workflow.

**Phase C — PR, CI, and a foreign blocker (prompts 11–13).** *"create PR and test on
CI"* → PR #238. CI immediately exposed real bugs: a **koffi lockfile desync** (`npm ci`
failed) and a **pre-existing colon-named path** (`.pi/flows/handlers/test:capabilities/`)
that made `actions/checkout` fail on Windows repo-wide. Decision point: the human chose
option `1` — fix the colon bug in its own PR (#239) off `develop`. It was an
unreferenced, byte-identical duplicate; deleting it unblocked all Windows CI.

**Phase D — Integrate onto a moved develop (prompts 14–15).** Meanwhile develop had
*deleted the wizard flow* the feature's old base imported. A rebase would replay broken
hunks, so the model **aborted the rebase and merged develop in**, then re-applied the
feature by hand onto develop's rewritten `main.ts`. Also created a follow-up OpenSpec
proposal (#240) with already-delivered tasks pre-checked.

**Phase E — Review & real-app stabilization (prompts 16–17).** *"process coderabbit
issues"* → five valid findings fixed forward in #241 (health-path `execSync` → `/proc`
read + `execFileSync` with timeout; reload-gating; unknown `launchSource` fallback +
regression test; markdown-table pipe escape; literal unicode escapes). *"execute CI
Electron tests"* kicked off five iterations of evidence-driven debugging — the biggest
being `resolvePackagedBinary` grabbing `chrome-sandbox` instead of the `pi-dashboard`
executable on Linux (the real cause of "Process failed to launch"), plus `--no-sandbox`,
`playwright install-deps`, and the noble AppArmor userns sysctl.

**Phase F — Finalize, merge, archive (prompts 18–22).** Wired an advisory
`pull_request` path-filter cadence for the E2E workflow (validated with
`doubt-driven-review`: reversible, low-stakes, bounded), confirmed two consecutive
green runs, merged #241+#240, cleaned up worktrees, then archived both OpenSpec
changes (#242) — repairing a pre-existing corrupted `electron-shell` main spec along
the way.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change electron-attach-ownership-fixes`.
  Effective because it handed the model a *scoped* change with tasks; the model didn't
  have to invent requirements, only execute and verify them.
- **"If it can be tested with docker test and playwright or Electron CDP do it"** —
  high-leverage: converted vague "manual" tasks into an automation mandate and named
  the exact tools, which the model then matched to a technique.
- **"7.2 and 7.4a cannot use that way that emulates that event? For example firing
  another program…"** — a *probing* prompt that rejected the first (native-clicker)
  answer and nudged toward the in-process monkeypatch. Worth imitating: when the AI's
  first automation idea is heavy, ask "is there a lighter emulation?"
- **"create PR and test on CI"** — short, decisive; let the real environment become the
  test oracle instead of arguing about hypotheticals locally.
- **One-character steers (`3`, `1`, `a`, `yes`, `both`)** — these answered the model's
  own enumerated options. They work *because the AI presented crisp numbered choices
  first*; keep offering the human a small option menu so a single keystroke unblocks.
- **"process coderabbit issues"** — turned an external review into a fix-forward task
  list without re-explaining anything.

Weak-prompt rewrite: instead of the bare *"both"*, a stronger kickoff would be *"build
both 7.2 (tray) and 7.4a (Job Object) using the in-process electron monkeypatch — no
osascript — and wire each into ci-e2e-electron.yml"*, front-loading the constraint.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat native-surface tasks as manual/unverifiable | "If it can be tested with docker + playwright or Electron CDP do it" | State up front: *every* behaviour needs an automated check; prefer in-process stubs |
| Reach for a heavy native clicker (osascript/UIAutomation) | "cannot use that way that emulates that event?" | Default to `electronApp.evaluate` monkeypatching the `electron` module |
| Leave stale tasks/artifacts in the change | "remove stale" | Prune dead tasks before adding new ones during apply |
| Mix a foreign blocker (colon path) into the feature PR | choosing option `1` (separate PR) | One concern = one PR off `develop`; don't smuggle unrelated fixes |
| Rebase pushed history across a divergent base | choosing `a` (abort→merge) | Merge develop *in* when history is pushed + `main.ts` was rewritten |
| Call CI "done" after one green run | "yes" to a confirmation run | Require **two consecutive green** runs for a flaky-prone E2E suite |

Also watch: the model initially added an unnecessary `npm run build` to the job-object
CI job (the server serves `/api/health` without the client) — trim CI steps to the
minimum the assertion needs.

## 6. Skills, tools & memory created — and why they're effective

No skill was created, but **two durable project memories** were — both high-value
tool-quirks that will save future sessions real time:

- **Worktree cross-package resolution gotcha** (tool-quirk): git worktrees under
  `.worktrees/` share the MAIN repo's `node_modules` because `npx` walks up to the repo
  root; the `@blackbelt-technology/pi-dashboard-*` symlinks resolve to the main
  checkout, not the worktree. *Why effective:* explains phantom "my export isn't found"
  tsc errors during worktree development — a genuinely confusing failure mode.
- **`pi-dashboard stop --port <N>` is not port-scoped** (failure): it also sweeps the
  config default port (8000) via `lsof`, so cleaning up a test server on port 8137 can
  kill a live dashboard on 8000. *Why effective:* prevents accidentally nuking the
  running dashboard during isolated test runs.

**Skill that SHOULD exist:** an `electron-native-surface-e2e` skill capturing the
in-process monkeypatch pattern (record `Menu.buildFromTemplate` templates via
`electronApp.evaluate`, resolve the packaged binary by `executableName`, stub a fake
`/api/health` to drive attach/foreign/zombie arms, and the ubuntu `--no-sandbox` +
AppArmor-userns + `install-deps` CI trio). This session re-derived all of it from
scratch; a skill would collapse Phase B+E to minutes.

Three `general-purpose` subagents were used to write `docs/` prose in caveman style
(the repo's Rule-6 delegation), returning tree rows for the main agent to apply.

## 7. Pitfalls & dead ends

- **"Process failed to launch" on ubuntu CI** — *not* just `--no-sandbox`. The real
  cause was `resolvePackagedBinary` picking `chrome-sandbox` (an extensionless
  executable in the app dir). **Fix:** target forge's `executableName: "pi-dashboard"`,
  exclude Chromium helpers. `--no-sandbox` + `install-deps` + the AppArmor sysctl are
  correct hardening but weren't the blocker.
- **koffi lockfile desync** — adding `koffi` to a `package.json` without regenerating
  `package-lock.json` fails `npm ci` in ~34s. Regenerate lockfile-only and commit.
- **Colon in a tracked path** (`test:capabilities/`) — illegal on NTFS; breaks
  `actions/checkout` (exit 128) *before any step runs*, blocking all Windows CI.
- **`ci.yml` didn't auto-trigger on the PR** — GitHub suppresses `pull_request`
  workflows for PRs opened via `GITHUB_TOKEN` (anti-recursion). Add `workflow_dispatch`
  or validate locally.
- **New workflow not dispatchable** — `workflow_dispatch` only works once the workflow
  exists on the *default* branch (404 until merged).
- **Tray spec flakiness** — a 1200 ms fake-health delay exceeded the 1 s ownership-probe
  timeout → ownership resolved `"unknown"` not `"foreign"`. Keep stub latency under the
  probe budget (dropped to 600 ms).
- **Doctor `#doctor-btn` is transient** — the loading page redirects to the fake
  server once healthy, so drive the doctor window via the `dashboard:open-doctor` IPC
  instead of clicking the button.
- **Job Object smoke needs a real bundled Node** — `electron-forge package` skips it, so
  spawn-mode can't boot a server; made that job `continue-on-error` (advisory).
- **Pre-existing corrupted `electron-shell` main spec** — stray `## ADDED Requirements`
  delta headers + missing `## Purpose` blocked `openspec archive`; had to consolidate to
  a single `## Requirements` section before archiving (`--skip-specs` where deltas were
  already partially folded).
- **Rebase across a rewritten `main.ts`** — develop deleted the wizard flow the feature
  imported; abort the rebase and merge develop in instead.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A scoped OpenSpec change with a `tasks.md` (`/skill:openspec-apply-change <name>`).
- `gh` authenticated; ability to dispatch and read Actions runs + download artifacts.
- Knowledge of forge's `executableName` for packaged-binary resolution.

**Checklist:**
1. Apply the change; prune stale tasks.
2. For every native-surface behaviour, write a Playwright-Electron spec that
   monkeypatches `electron` in-process (`electronApp.evaluate`) — no native clicker.
3. Resolve the packaged binary by `executableName`; add `--no-sandbox`,
   `playwright install-deps`, and the AppArmor-userns sysctl for ubuntu.
4. Keep fake-`/api/health` stub latency under the ownership-probe timeout.
5. Wire an advisory `ci-e2e-electron.yml` matrix (ubuntu+windows) + a `continue-on-error`
   Job Object job.
6. Create the PR; let CI find bugs. Fix lockfile desyncs; split *foreign* blockers into
   their own PR off `develop`.
7. If develop diverged with a rewritten `main.ts`, merge develop in and re-apply by hand.
8. Process review findings as fix-forward + regression tests.
9. Require two consecutive green E2E runs, then merge the stack, clean up worktrees,
   fold spec deltas, and `openspec archive`.

**Final artifacts produced (paths, relative to repo root):**
- `packages/server/src/boot-parent-liveness.ts`, `launch-source-effective.ts`
- `packages/electron/src/lib/zombie-adoption-dialog.ts` (+ tray/main/doctor edits)
- `tests/e2e-electron/electron-lifecycle.ts`,
  `{zombie-adoption,doctor-version-skew,tray-ownership}.electron.spec.ts`
- `playwright.electron.config.ts`
- `scripts/windows-liveness-smoke.ts`, `scripts/windows-job-object-smoke.ts`
- `.github/workflows/ci-e2e-electron.yml`
- Shipped via PRs #238 (feature), #239 (colon fix), #240 (E2E proposal), #241
  (CodeRabbit fixes), #242 (OpenSpec archive) — all merged to `develop`.

---

_Generated from session `019f2e21-ddb6-7749-8117-2a888e98a80d` · `pi-agent-dashboard` · 2026-07-05. Source extract: `/tmp/facts-sheet.md`._
