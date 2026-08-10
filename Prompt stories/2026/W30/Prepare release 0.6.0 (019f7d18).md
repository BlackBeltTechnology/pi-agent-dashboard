---
session: 019f7d18
week: 2026/W30
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); heavy steering (5 user prompts); large facts sheet (~17824 tok)"
upgrade_status: pending
openspec_changes: [add-nightly-verdaccio-build]
proposal_excerpt: "Every artifact this project ships — 31 npm packages + a 6-leg Electron installer matrix — is only ever exercised end-to-end at release time, against the public npm registry. There is no scheduled build that an…"
---

# How we did it: Prepare release 0.6.0 — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with: *"I would like to prepare the release of pi-dashboard. From
start is a best practice to make the version updates everywhere in code base?"*

The surface question was "should I hand-bump versions everywhere?" — but the *real*
objective was **cut a full production release of the pi-agent-dashboard monorepo**:
promote the CHANGELOG, bump ~35 workspaces in lockstep, tag `v0.6.0`, and drive the
Release pipeline until **every npm package + the Electron installer matrix + the
GitHub Release** ship. The honest answer to the literal question is *no* — the repo
has a scripted `release-cut` procedure precisely so no human sweeps versions by hand.
What turned a "quick tag-and-push" into a **16-hour, 6-blocker odyssey** was that the
release pipeline itself had rotted: a 2-month/906-commit CHANGELOG gap, a stale gate,
an orphaned import, an npm-version tightrope, and missing publish metadata — each only
observable *at release time*.

## 2. TL;DR playbook

1. **Read the canonical procedure first.** `cat .pi/skills/release-cut/SKILL.md` — do
   NOT hand-edit versions. The bump is one scripted step.
2. **Pass pre-flight gates on a clean tree**: `git status --porcelain` empty, on
   `develop`, not behind origin, `npm test` green, `npm run build` green,
   `node scripts/verify-release-deps.mjs` exit 0. Commit or stash stray work first.
3. **Curate the CHANGELOG against reality**: `git log <lasttag>..HEAD --oneline`. If
   the `[Unreleased]` section is far behind, delegate grouped bullet-drafting to a
   subagent (feed it undocumented `feat:`/`fix:`/`perf:` subjects minus already-tagged
   changes), then merge programmatically — never hand-invent behaviour.
4. **Bump in lockstep**: `npm version <v> --workspaces --include-workspace-root
   --no-git-tag-version --ignore-scripts` → `node scripts/sync-versions.js` →
   `npm install --package-lock-only`. Stage ONLY CHANGELOG + package.json + lockfile.
5. **Validate `develop` via the smoke matrix BEFORE tagging** (`gh workflow run
   ci-smoke.yml --ref develop`) so a red leg never leaves a dangling tag.
6. **Tag HEAD, not the release commit**, when a gate-fix landed after it — the
   release-gate re-runs against the tagged tree.
7. **Watch the Release run through publish**; treat `ci-checks` flakes (leaked async
   timers) as re-runnable, not regressions.
8. **When publish breaks, the cause is almost always release-infra, not your content** —
   pin the npm version, add missing `repository.url`, make the publish loop non-fatal.

## 3. How the collaboration unfolded

**Phase 1 · Framing (correct the premise).** The AI's first move was to read
`release-cut/SKILL.md` rather than answer from memory, then push back on the user's
"bump everywhere?" premise: the monorepo bumps via `npm version --workspaces` +
`sync-versions.js` + lockfile regen, not a manual sweep. *Why it worked:* grounding the
answer in the repo's own procedure prevented the exact drift bug the user feared.

**Phase 2 · Pre-flight & first blocker.** Clean-tree gate failed (stray docs + an
unpushed electron fix). The AI surfaced each pending file for a decision, committed the
docs, then hit **Blocker 1**: `verify-release-deps` false-positived because it does a
*substring* check for the `0.74.0` floor while the pin had been deliberately bumped to
`^0.80.10`. The AI traced the intentional bump commit, updated the stale floor in two
places, and moved on. *Decision point:* fix the floor now vs. rewrite the fragile gate —
chose the minimal correct fix, flagged the rewrite as a follow-up.

**Phase 3 · CHANGELOG reckoning.** The AI discovered the `[Unreleased]` section had
only 24 of ~234 changes — a **2-month, 906-commit** backlog. It stopped and flagged
this as a judgment call, then chose *pragmatic curation*: generated the undocumented
`feat:`/`fix:`/`perf:` subjects, **delegated grouped drafting to a subagent**, and
merged the ~45 new bullets programmatically under matching headings (final: 79 bullets).
*Why it worked:* neither shipping 24 stale entries nor dumping 200 raw subjects — a
subagent kept the drafting quality high without polluting the main context.

**Phase 4 · Lockstep bump.** `npm version --workspaces` bumped 35 packages +
lockfile; a transient rollup error from a workspace `prepare` script was reproduced-and-
dismissed (the client build passed standalone). `sync-versions.js` rewrote 44 inter-
package specifiers. Committed `e87770c6f chore(release): v0.6.0`.

**Phase 5 · Smoke-before-tag (the payoff).** Pushed `develop` (branch only), dispatched
the 7-leg smoke matrix. **Blocker 2**: the Windows leg failed on an orphaned import —
`defaultGetCmdline` from `editor-pid-registry.ts`, a module PR #342 had *deleted*. The
AI proved zero live callers, made a surgical probe fix, re-ran → **Blocker 3** a flaky
5s web-UI timeout on the cold Windows runner → re-ran just that leg → 7/7 green. *Why
it worked:* validating before the tag meant no dangling tag needed revoking.

**Phase 6 · Tag & the publish gauntlet.** Tagged HEAD `0f8f1ce41` (so the smoke fix was
in the tagged tree). The Release run then exposed a **cascade of release-infra bugs**,
each ~20 min per cycle (edit → force-move tag → re-run):
- **Blocker 4 — npm version tightrope.** `npm install -g npm@latest` (for OIDC) now
  refuses git deps (`EALLOWGIT` on `@electron/node-gyp` via `@electron/rebuild`). Pinned
  `11.5.1` → hit a lightningcss optional-native-dep bug. Traced the exact npm that
  shipped v0.5.4 and pinned **`11.12.1`** (newer than the buggy 11.5.1, older than the
  EALLOWGIT `@latest`).
- **Blocker 5 — provenance metadata.** `bus-client` + `kb` had empty `repository.url`;
  sigstore provenance 422'd. Added the field to both.
- **Blocker 6 — publish loop `set -e`.** The loop aborted on the first failure instead
  of enumerating all gaps; made per-package failures non-fatal.

**Phase 7 · The strategic pivot (human-led).** After 31/32 packages published,
`eng-disciplines@0.6.0` was **permanently burned** (published+unpublished on 2026-07-04;
npm never lets that version string return). The user reasoned: *one re-run drives the
whole pipeline anyway — so bump everyone to `0.6.1` for consistency instead of leaving
one package forever ahead.* The AI verified `0.6.1` was free for all 32, agreed it was
sharper than its own "skip the burned version" plan, and — on the final steer — **committed
`88a0cf3cc chore(release): v0.6.1` locally without tagging or pushing**, leaving the
actual cut for a fresh session.

## 4. Prompts that worked

- **The goal prompt** (*"prepare the release… is it best practice to update versions
  everywhere?"*) — effective because it embedded a *checkable assumption*. That let the
  AI correct the premise immediately instead of blindly sweeping versions. A stronger
  version: *"Cut a production release of pi-dashboard following the release-cut skill —
  tell me each blocker before you fix it."*
- **"yes"** (steering #1) — a one-word green-light to proceed through the pre-flight
  gates after the AI had laid out the plan. High-leverage because the plan was already
  concrete.
- **"patch the skill and watch release"** (steering #2) — folded a *durability* action
  (capture the learnings into `release-cut/SKILL.md`) into the watch loop, so the fixes
  outlive the session.
- **"Is it worth updating all to 0.6.1 — one package triggers the whole pipeline
  anyway… Think about"** (steering #3) — the highest-leverage prompt in the session. It
  reframed the endgame: same CI cost, but version consistency + un-stick the burned
  package. The *"Think about"* invited the AI to stress-test rather than comply.
- **"Only commit things, I would like to make in fresh session"** (steering #4) — a
  clean scope boundary that prevented the AI from tagging/pushing prematurely.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Drive toward the fix without pausing on judgment calls | Implicitly trusted, but the AI *self-corrected* to stop-and-flag on the CHANGELOG gap and burned version | Make "stop & flag before irreversible/large-scope steps" an explicit rule in release-cut |
| Solve the burned-version problem tactically (skip it, publish rest at 0.6.0) | *"Is it worth updating all to 0.6.1… one package always ahead… Think about"* | Add a release-cut rule: if any package's target version is burned, bump the whole set to the next patch |
| Keep going toward tag+push+complete the release | *"Only commit things, I would like to make in fresh session"* | Confirm the stop boundary (commit-only vs. tag vs. push) before the final phase |
| Trust `verify-release-deps` / smoke as authoritative | Not steered — but the gates themselves were stale/orphaned | Rewrite the substring dep-gate to real semver; delete orphaned probes when their module is removed |

The quality bar the user imposed throughout: **version consistency across all packages**
(no package permanently one minor ahead), and **durability** (patch the skill so the
next release doesn't re-derive these blockers).

## 6. Skills, tools & memory created — and why they're effective

- **`release-cut/SKILL.md` patched** — captured the accurate publishable-package count
  (~32, not "10"), the `npm@latest` EALLOWGIT false-start (pin to a known-good version),
  and the *tag-HEAD-when-a-gate-fix-lands-after-the-release-commit* guardrail. Effective
  because the three most expensive blockers (npm version, tag target, package count) are
  now one-read-away instead of one-CI-cycle-away.
- **2 project memories saved** (tool-quirk) — the publish.yml gotchas: pin the OIDC npm
  upgrade to `11.12.1`; `@latest` refuses git deps; `11.5.1` has the lightningcss bug.
  Effective because these are non-obvious, cost ~20 min each to rediscover, and recur on
  every release.
- **Handoff docs** (`RELEASE-v0.6.0-HANDOFF.md`, `RELEASE-v0.6.1-HANDOFF.md`) — precise
  state + next-steps so a fresh session resumes without re-deriving the 6 blockers.
- **Recommended new skill** (not yet created): a **`release-preflight-audit`** that,
  *before* any tag, runs the whole gauntlet locally — dep-gate semver, orphaned-import
  scan, `repository.url` presence on every non-private package, and a burned-version
  check against the registry — turning 6 sequential 20-min CI cycles into one local pass.

## 7. Pitfalls & dead ends

- **If `verify-release-deps` fails but the pin is newer than the floor** → it's a stale
  *substring* floor, not a real violation. Update the floor (two places:
  `scripts/verify-release-deps.mjs` + `scripts/AGENTS.md`); don't downgrade the pin.
- **If the Windows smoke leg errors on `Cannot find module …editor-pid-registry.js`** →
  orphaned import left by PR #342. `defaultGetCmdline` is intentionally gone; drop the
  dead assertion in `scripts/_windows-introspection-probe.ts`, keep the live checks.
- **If the Windows leg times out fetching the web UI (5s)** → flaky cold-runner cost of
  serving the ~4.8 MB bundle; re-run the single leg, don't "fix" anything.
- **If `ci-checks` fails but `npm test` passed locally (10949/0)** → a leaked async timer
  (TanStack react-virtual `setTimeout` in `ChatView.test.tsx` firing post-teardown).
  Re-run the job; it's a flake, not a regression.
- **If publish `npm ci` dies with `EALLOWGIT`** → hardened `npm@latest` refuses the
  `@electron/node-gyp` git dep. Pin the OIDC upgrade step to `npm@11.12.1`.
- **If a package publish 422s on sigstore provenance** → missing/empty `repository.url`
  in that package.json. Add it matching the repo URL + `directory`.
- **If the publish loop stops at the first failing package** → `set -euo pipefail`
  aborts it; make per-package failures non-fatal so the gap report enumerates ALL gaps
  in one run.
- **If a target version was ever published then unpublished** → it's **burned forever**;
  bumping only that package won't help (publish forces every workspace to the tag
  version). Bump the *whole set* to the next patch.
- **Transient traps that are NOT real failures**: a rollup error during
  `npm version --workspaces` (a `prepare` script firing — use `--ignore-scripts`); a
  git `index.lock` from the dashboard's periodic git poll (wait, it clears).

## 8. Reproduce it faster — checklist

**Inputs to have ready:** write access to `develop`; `gh` authed; npm publish rights +
Trusted Publisher configured for every non-private package; the `release-cut` skill.

- [ ] `cat .pi/skills/release-cut/SKILL.md` — follow it; don't hand-bump.
- [ ] Pre-flight: clean tree · on `develop` · not behind · `npm test` green ·
      `npm run build` green · `node scripts/verify-release-deps.mjs` exit 0.
- [ ] CHANGELOG: `git log <lasttag>..HEAD --oneline`; if far behind, subagent-draft
      grouped bullets from undocumented `feat:`/`fix:`/`perf:` subjects, merge
      programmatically; promote `[Unreleased]` → `[X.Y.Z]`.
- [ ] Bump: `npm version <v> --workspaces --include-workspace-root --no-git-tag-version
      --ignore-scripts` → `node scripts/sync-versions.js` → `npm install
      --package-lock-only`. Stage ONLY CHANGELOG + package.json + lockfile.
- [ ] Commit `chore(release): vX.Y.Z`.
- [ ] `gh workflow run ci-smoke.yml --ref develop` → **7/7 green before tagging**.
- [ ] Confirm no target version is burned on the registry; if any is, bump the whole set.
- [ ] Confirm publish.yml pins `npm@11.12.1` and the publish loop is non-fatal per-package.
- [ ] `git tag vX.Y.Z <HEAD-with-all-fixes>` → `git push origin vX.Y.Z`.
- [ ] Watch Release → gate → publish → electron → github-release; re-run `ci-checks`
      flakes.

**Final artifacts produced this session:** `e87770c6f`/`0f8f1ce41` release+fix commits,
tag `v0.6.0` (31/32 packages published), patched `release-cut/SKILL.md`, 2 publish.yml
fixes, and the prepared-but-unpushed `88a0cf3cc chore(release): v0.6.1` for a clean
consistent cut in a fresh session.

---

_Generated from session `019f7d18-2fc9-79f8-85e9-107aa45e6579` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-24. Source extract: `/tmp/facts-1784863705N.md`._
