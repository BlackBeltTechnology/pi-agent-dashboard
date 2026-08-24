---
session: 019f819e
week: 2026/W30
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); heavy steering (7 user prompts); large facts sheet (~16880 tok)"
upgrade_status: pending
openspec_changes: [adopt-pnpm-for-dev-ci]
proposal_excerpt: "`npm` is used across the repo in **three distinct roles** with different constraints:"
---

# How we did it: Adopt pnpm for dev + CI — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation — `/skill:ship-it` on the
`adopt-pnpm-for-dev-ci` worktree. The real objective, once ship-it oriented on the
change: **migrate the entire monorepo's dev + CI tooling from npm to pnpm** — pin
`pnpm@11.15.1` via corepack, add `pnpm-workspace.yaml`, declare phantom workspace
deps, migrate all 6 GitHub Actions workflows, both Dockerfiles, and the electron
`bundle-server.mjs`, then **swap `package-lock.json` → `pnpm-lock.yaml` as the sole
lockfile** — while keeping npm alive in its three legitimate surviving roles (global
tool installs, the `site/` sub-project, OIDC publish path). The design gated the
irreversible lockfile swap (§9.2) behind a **real green `ci-electron.yml` run** (X4)
because the release path (`publish→electron→github-release`) is unpublish-blocked
after 72h.

This was a large, high-risk infra change: 10 phases, 16 automated scenarios,
completely unimplemented at start (every task `- [ ]`).

## 2. TL;DR playbook

1. **Orient before applying.** Confirm filesystem reality vs the tasks.md checkboxes
   (`ls pnpm-workspace.yaml pnpm-lock.yaml`, grep `packageManager`). Everything was
   `- [ ]` and reality agreed — a genuine from-zero apply.
2. **Fix the local env first.** `corepack` isn't on the default PATH and PATH `node`
   is the PI-Dashboard bundled build. Prepend nvm's node v24.15.0, `corepack enable`,
   activate `pnpm@11.15.1`. Save this as a memory — you'll need it every session.
3. **Apply phase-by-phase with a verify after each** (config → phantom-deps →
   bundle-server filter → local build/electron gate). Never batch-apply a 10-phase
   infra change blind.
4. **Declare every phantom dep pnpm exposes.** npm's accidental hoisting hid missing
   root/workspace deps; pnpm's strict linker surfaces them. Add each to the right
   `dependencies`/`devDependencies` with a caret matching existing siblings.
5. **Migrate all 6 workflows with one pattern:** `pnpm/action-setup@v4` *before*
   `setup-node` with `cache: pnpm`, then `pnpm install --frozen-lockfile`. Update
   the contract tests that pin `npm run …` commands **in lockstep**.
6. **Run the full local electron gate before touching CI** (`pnpm -r build`, web
   build, `bundle-server.mjs`, `electron-forge package` → `.app`). The design says
   this must be green before CI — honor it.
7. **Dispatch X4** (`gh workflow run ci-electron.yml --ref <branch>`), **poll to
   completion**, and only after the full 6-tuple installer matrix is green do the
   `git rm package-lock.json` swap (§9.2).
8. **Fold `E4` (single-lockfile hygiene) into the contract test** right after the
   swap so the green stays enforced.
9. **Open the PR** against `develop` last; leave CodeRabbit/merge to the human unless
   asked.

## 3. How the collaboration unfolded

**Phase A — Orient & de-risk (00:28).** ship-it checked filesystem reality: no
`pnpm-workspace.yaml`, no lockfile, no `packageManager` field — a true from-zero
apply. The AI flagged two blockers up front: `corepack: command not found` locally,
and that §9/X4 is gated on a CI run that **cannot close inside the worktree**. It
proposed a scope: apply phases 1–8 + tests, merge develop, verify locally, **STOP
before §9**. *Why it worked:* naming the irreversible boundary before doing anything
prevented a headless run from blindly deleting the lockfile.

**Phase B — Fix the env (00:30).** Mixed node environment untangled: nvm's node
v24.15.0 carries corepack → `pnpm@11.15.1`. The fact was saved to project memory
immediately.

**Phase C — Apply with per-phase verification (00:32–00:57).** Config + 8 phantom-dep
declarations → first `pnpm install` (exit 0, workspace links resolve locally = E1).
Then the load-bearing checks: `pnpm -r build`, web build (5264 modules),
`bundle-server.mjs` (6/6 node-pty prebuild triples, GO/NO-GO passed = E5/E6),
`electron-forge package` → runnable `.app` (E7). The bundle-server needed a
Windows-safe `/[\\/]/` `node_modules`-excluding cpSync filter so pnpm's store-symlink
`node_modules` weren't copied into the bundle.

**Phase D — CI migration (00:58–01:20).** All 6 workflows migrated to the
action-setup pattern; `verify-lockfile-versions.mjs` rewritten as a focused
pnpm-lock line-parser (no YAML-lib phantom dep on the release gate); the two
`publish-workflow-contract.test.ts` assertions pinning `npm run …` updated in
lockstep. A new `pnpm-migration-contract.test.ts` covered X3/X5/X6/X7/E8.

**Phase E — Merge develop & harden (01:24–01:46).** The integration merge conflicted
(`ci.yml` touched on both sides + add/add on own openspec artifacts) — resolved
mechanically (take develop's structure, re-apply the npm→pnpm flip). Post-merge `tsc`
surfaced two **real pnpm-resolution regressions**: `bonjour-service` patch-bumped
1.4.2→1.4.3 with a types-breaking change (pinned back via a `pnpm-workspace.yaml`
override), and `ERR_PNPM_IGNORED_BUILDS` making `pnpm install --frozen-lockfile`
exit 1 in CI (fixed with `strictDepBuilds: false`).

**Phase F — Docs, then the CI gate (02:03–03:28).** On *"draft doc updates"* then
*"ok, can you perform?"* the AI updated README/skills/AGENTS directly and delegated
`docs/` prose to DocScribe (caveman style). On *"Dispatch X4 on ci?"* → *"poll"* it
pushed the branch, dispatched `ci-electron.yml`, polled to green (all 6 installer
legs), then landed §9.2 (`git rm package-lock.json`) and folded E4 into the test.

**Phase G — Leftover tasks & a found bug (02:42–03:28).** On *"can you perform the
leftover tasks?"* it dispatched `ci-smoke.yml` (X8) and ran the E3/10.4 config-key
falsify in a scratch dir. The Windows smoke leg went **red** — a real regression:
`scripts/windows-introspection-smoke.ts` imported `pi-dashboard-shared` which was
never a declared root dep (npm hoisted it, pnpm doesn't). Fixed with the same
phantom-dep pattern + a regression guard, re-dispatched, went green.

**Phase H — PR (08:14).** On *"only just open pr"* it opened PR #381 against develop
and stopped, leaving CodeRabbit/merge to the human.

## 4. Prompts that worked

- **The goal prompt** — `/skill:ship-it` on the worktree. Effective because the skill
  carries the whole implementation contract (apply → merge → harness → ship) and the
  irreversible-boundary discipline. For a change this size, invoke the orchestrating
  skill rather than hand-narrating steps.
- **`draft doc updates`** — a 3-word prompt that unlocked the entire §10 doc sweep
  (README + skills + AGENTS + DocScribe-delegated `docs/`). High leverage because the
  AI already knew the migration surface.
- **`ok, can you perform?`** — flipped the AI from *drafting* to *executing* the doc
  edits. A clean scope-expansion trigger.
- **`Dispatch X4 on ci?`** then **`poll`** — two tiny prompts that drove the entire
  gate: push branch → `gh workflow run` → poll to green → land the swap. The AI had
  proposed polling; the human just said `poll`.
- **`can you perform the leftover tasks?`** — expanded scope to the CI-dispatchable
  remainder (X8, E3 falsify) and, incidentally, surfaced the Windows bug.

Weak-prompt rewrite: instead of `stuck`-style terse redirects, a future operator can
front-load *"apply phases 1–8, STOP before the lockfile swap, dispatch X4 and poll,
then land §9.2 only if green"* — the AI reconstructed exactly this, but stating it up
front saves a round-trip.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at the worktree boundary and hand off (correctly conservative) | `ok, can you perform?` / `can you perform the leftover tasks?` | State up front which CI-dispatchable tasks it may perform headless |
| Wait for permission before dispatching CI | `Dispatch X4 on ci?` | Pre-authorize `gh workflow run` for the named gate workflow |
| Hand off polling to the human | `poll` | Say "dispatch AND poll to completion, then land the gated step if green" |
| Cargo-cult a stale task (4.2 `pnpm rebuild macos-alias`) | (AI caught it: DMG is electron-builder/hdiutil now, module dead) | Trust the AI's design-vs-reality checks; it flagged the obsolete task itself |
| Do everything itself | (project protocol) delegate `docs/` prose to DocScribe | Keep the "docs/ → DocScribe caveman style" rule in AGENTS.md |

The quality bar the human imposed implicitly: **never delete the lockfile until X4 is
actually green** — respected throughout (`§9.1 gate satisfied` only after run
29790048118 passed all 6 legs).

## 6. Skills, tools & memory created — and why they're effective

No new skill was created (the workflow rode existing `ship-it`/`ship-change`/
`ci-troubleshoot`/`doctor` skills). Two durable **project memories** were saved:

- **corepack/pnpm local-env recipe** — *"corepack is NOT on the default PATH, and the
  PATH `node` is the PI-Dashboard bundled build. Prepend nvm's node v24.15.0 to get
  pinned pnpm 11.15.1."* Effective because every future pnpm session in this repo hits
  the same PATH trap; the memory removes a 5-minute rediscovery each time.
- **pnpm 11 gotchas** — `ERR_PNPM_IGNORED_BUILDS` is FATAL (exit 1) → CI reds; fix is
  `strictDepBuilds: false` in `pnpm-workspace.yaml`. Plus the bonjour-service 1.4.3
  types-break override. Effective because these are non-obvious pnpm-11-specific
  failure modes that would otherwise re-block any future migration or upgrade.

One subagent: **DocScribe** for the `docs/architecture.md` + `docs/AGENTS.md` prose
(caveman style, per the repo's Documentation Update Protocol).

If anything *should* be a skill: a **"migrate-monorepo-npm-to-pnpm"** procedure
capturing the action-setup CI pattern, the phantom-dep sweep, the
`strictDepBuilds/blockExoticSubdeps` config keys, and the X4-gated lockfile swap.

## 7. Pitfalls & dead ends

- **`corepack: command not found`** → the PATH node is the bundled build. Prepend
  nvm's node v24.15.0; don't assume `pnpm` on PATH is the pinned version (local was
  11.0.8, not 11.15.1).
- **`pnpm install --frozen-lockfile` exits 1** on `ERR_PNPM_IGNORED_BUILDS` — pnpm 11
  makes ignored build scripts fatal. `onlyBuiltDependencies`/`ignoredBuiltDependencies`
  did **not** suppress it; the working switch was `strictDepBuilds: false` in
  `pnpm-workspace.yaml` (not `dangerously-allow-all-builds`, which runs phantomjs and
  fails).
- **`tsc` breaks on a *patch* bump** — `bonjour-service` 1.4.3 turned `Service`/
  `Browser` from types into value consts. Pin back to 1.4.2 via a
  `pnpm-workspace.yaml` `overrides` entry (note: pnpm 11 reads overrides from the yaml,
  not `package.json#pnpm`, when a workspace yaml exists; and `_comment` keys are
  invalid there).
- **A test that passed under npm fails under pnpm** — `pi-changelog-routes.test.ts`
  asserted empty releases, but pnpm's full hoist surfaced a transitive
  `@mariozechner/pi-coding-agent/CHANGELOG.md` at repo-root `node_modules` where the
  Strategy-3 walk-up found it. Fix: assert against a package genuinely absent from
  `node_modules` (layout-independent), not a hoisting accident.
- **Flaky full-suite failures** (`doctor-route`, `SettingsPanel`) — different test
  red each run, always green in isolation = parallel-load timing flakiness, not a
  regression. Confirm in isolation before "fixing".
- **Windows CI red** — a root script importing a workspace package that npm hoisted
  but pnpm doesn't link at root (`pi-dashboard-shared`). Fix = declare it in root
  `devDependencies` (phantom-dep pattern) + add a regression guard test.
- **Merge conflict on `ci.yml`** — develop touched it too. Resolve by taking
  develop's structure and re-applying the npm→pnpm flip, not blindly `--ours`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the worktree checked out, `gh` authed, nvm node v24.15.0,
the design.md that names the X4 gate and the npm survivors.

- [ ] `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" && corepack enable && corepack prepare pnpm@11.15.1 --activate`
- [ ] Add `packageManager`, `pnpm-workspace.yaml` (`nodeLinker: hoisted`, `strictDepBuilds: false`, `blockExoticSubdeps`, bonjour override), 8 phantom-dep decls.
- [ ] `pnpm install` → exit 0; confirm workspace links resolve local; add Windows-safe cpSync filter to `bundle-server.mjs`.
- [ ] Local gate: `pnpm -r build`, web build, `bundle-server.mjs` (node-pty triples), `electron-forge package` → `.app`.
- [ ] Migrate all 6 workflows (`pnpm/action-setup@v4` before `setup-node`, `cache: pnpm`, `pnpm install --frozen-lockfile`); rewrite `verify-lockfile-versions.mjs`; update contract tests in lockstep.
- [ ] Migrate `docker/Dockerfile` + `Dockerfile.build` (corepack + frozen install); keep `npm i -g` tool installs and `site/` on npm.
- [ ] Merge develop; fix any pnpm-resolution regressions (`tsc`, changelog test).
- [ ] `gh workflow run ci-electron.yml --ref <branch>` → **poll to green (6 legs)**.
- [ ] Only then: `git rm package-lock.json`; fold E4 into the contract test; commit.
- [ ] Dispatch `ci-smoke.yml` (X8); run E3/10.4 falsify in a scratch dir.
- [ ] Open PR against develop; leave CodeRabbit/merge to the human.

**Artifacts produced:** `pnpm-workspace.yaml`, `pnpm-lock.yaml` (sole lockfile),
`scripts/verify-lockfile-versions.mjs` (rewritten), `pnpm-migration-contract.test.ts`,
6 migrated workflows, 2 Dockerfiles, updated README/skills/docs, PR
[#381](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/381).

---

_Generated from session `019f819e-494a-7e92-b839-398b82d463d8` · `pi-agent-dashboard` · 2026-07-24. Source extract: `/tmp/facts-adopt-pnpm-mine.md`._
