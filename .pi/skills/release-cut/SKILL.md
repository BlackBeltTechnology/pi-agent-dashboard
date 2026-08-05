---
name: release-cut
description: 'Cut a new pi-agent-dashboard release: promote `## [Unreleased]` in CHANGELOG.md, bump every workspace package.json per SemVer, commit, tag `v<version>`, and push — triggering the Release workflow that publishes every non-private workspace, builds the Electron artifacts, and creates a GitHub Release. Use on "cut a release", "release vX.Y.Z", "publish a new version", "tag a release".'
license: MIT
metadata:
  author: pi-dashboard
  version: "1.0"
---

# Cut a pi-agent-dashboard Release

Canonical reference: [`docs/release-process.md`](../../../docs/release-process.md).
This skill automates steps 1–5 of that doc. **Production tags (`vX.Y.Z`)
publish the GitHub Release automatically** — electron-updater's default
GitHub provider only resolves published, non-draft releases, so a draft
would silently block auto-update. **Pre-release tags (`vX.Y.Z-rc.N`) stay
drafts** so a maintainer can eyeball artifacts before flipping to published.
See change: fix-electron-auto-update-pipeline.

## Pre-flight (MUST pass before touching anything)

Run these in order. If any fails, **stop and report** — do not continue.

1. **Clean working tree**
   ```bash
   git status --porcelain
   ```
   Must be empty. If not, ask the user to commit or stash.

2. **On the release branch**
   ```bash
   git rev-parse --abbrev-ref HEAD
   ```
   Must be `develop` (this repo has no `main`). If elsewhere, ask user to
   confirm before continuing.

3. **Up to date with origin**
   ```bash
   git fetch origin && git status -sb
   ```
   Branch must NOT be "behind". If behind, ask user to pull first.

4. **Tests pass**
   ```bash
   pnpm test
   ```

5. **Build succeeds**
   ```bash
   pnpm run build
   ```

6. **Dependency-shape gate** (introduced by `enable-standalone-npm-install` to prevent regressions of v0.5.3 publish-time bugs)
   ```bash
   node scripts/verify-release-deps.mjs
   ```
   Asserts critical runtime deps (`jiti`, pinned `node-pty`, etc.) are still declared in the publishable workspace `package.json` files. Failure means the next published tarball would be broken — STOP and fix the workspace before cutting.

   > **Known false-positive (substring gate).** `verify-release-deps.mjs` checks the declared range with a naive `String.includes(minVersion)` — NOT semver math. So a legitimate pi bump ABOVE the floor (e.g. floor `0.74.0`, pin `^0.80.10`) fails the gate because `"^0.80.10"` does not contain the substring `"0.74.0"`. When this fires and the pin is genuinely newer than the rule's `minVersion`, the FIX is to bump that rule's `minVersion` (+ its evidence note in the RULES array, and the `scripts/AGENTS.md` row) to the new floor — do NOT downgrade the pin. This recurs on every pi version bump. See change: fix-release-lockfile-drift (gate lives in `scripts/verify-release-deps.mjs`).

7. **Dispatch `ci-smoke.yml` against `develop`** (recommended; catches installer regressions BEFORE the tag exists)

   The release pipeline (`publish.yml`) gates `publish` on a `release-gate` that runs the full 7-leg standalone-install-smoke matrix. If that gate fails on `workflow_dispatch`, `tag-and-push` is skipped — clean abort, no commit, no tag. But on a `git push --tags` cut, the tag already exists when the gate fires; failure leaves a dangling tag requiring `release-revoke`.

   Operators SHOULD run the smoke matrix first against `develop`:

   ```bash
   gh workflow run ci-smoke.yml --ref develop
   gh run watch  # or open the Actions UI
   ```

   All 7 legs must be green before cutting. If any leg fails, fix the regression on `develop` first — do NOT cut a tag that you know will fail the gate. Skip this step only when the change since the last release is provably installer-irrelevant (no lockfile, bundle-server, native dep, or preload-fastify touch). See change: gate-publish-on-smoke-and-tests.

If any pre-flight step fails, stop and surface the exact error to the user.

## Step 1 — Read current state

```bash
git describe --tags --abbrev=0        # last tag, e.g. v0.2.9
node -p "require('./package.json').version"   # current pkg version
```

Confirm they match (e.g. tag `v0.2.9` ↔ pkg `0.2.9`). If they diverge,
surface the mismatch and ask the user how to proceed.

## Step 2 — Curate `## [Unreleased]`

1. List commits since last tag:
   ```bash
   git log <last-tag>..HEAD --oneline
   ```
2. Read `CHANGELOG.md` and extract the current `## [Unreleased]` section.
3. Cross-check: every `feat:` / `fix:` commit should have a corresponding
   user-visible bullet under Added / Changed / Fixed.
4. If gaps exist, **use AskUserQuestion** to list missing items and
   confirm whether the user wants to add them now. If yes, draft bullets
   in end-user language (not commit-subject shorthand) and insert them.
5. Never invent behaviour — only summarise what the commits actually did.

> **Far-behind escape hatch (long release cycle).** If `[Unreleased]` was not
> maintained per-change and the tag→HEAD span is huge (v0.6.0 was a 2-month,
> 906-commit release with only 24 of ~234 feat/fix changes documented), do NOT
> re-audit hundreds of commits by hand and do NOT dump raw commit subjects.
> Generate the deduped input set — `git log <last-tag>..HEAD --oneline` filtered
> to `feat|fix|perf`, minus the change-tags already in `[Unreleased]` — then
> **delegate grouped drafting to a subagent** (keeps quality high + your context
> focused). Merge the returned bullets under the existing headings
> programmatically (existing bullets first, new appended), scoped to the
> `[Unreleased]` section only, and cap the long tail with one rolled-up
> "Additional fixes" line. This is the exact path that worked for v0.6.0.

## Step 3 — Decide next version (SemVer)

Propose per this decision tree, then **use AskUserQuestion to confirm**:

| `## [Unreleased]` contains                         | Bump    |
|----------------------------------------------------|---------|
| Any breaking change / removal (call it out)        | major   |
| Any `### Added` bullet (new user-visible feature)  | minor   |
| Only `### Fixed` / `### Changed` internals         | patch   |

Current version `X.Y.Z` → propose `X.(Y+1).0` for minor, etc.
**Do NOT auto-select** — always ask the user to confirm the target version
(offer the proposal as default).

## Step 4 — Promote `## [Unreleased]` → versioned section

In `CHANGELOG.md`:

1. Rename `## [Unreleased]` to `## [<version>] - <YYYY-MM-DD>` (use
   today's date from `date +%Y-%m-%d`, no leading `v`).
2. Insert a fresh empty `## [Unreleased]` section **above** it:

   ```markdown
   ## [Unreleased]

   ### Added

   ### Changed

   ### Fixed

   ## [<version>] - <YYYY-MM-DD>
   ...existing bullets...
   ```

Verify afterwards with:
```bash
grep -n "^## " CHANGELOG.md | head
```

## Step 5 — Bump all workspace versions + sync inter-package dep specifiers

```bash
npm version <version> --workspaces --include-workspace-root --no-git-tag-version
node scripts/sync-versions.js
pnpm install --lockfile-only
```

The first command bumps the `version` field on the root + every workspace
(`npm version` only edits package.json — no lockfile, no install — so it
stays npm even under the pnpm migration). The second rewrites every
inter-package `dependencies` specifier (e.g.
`"@blackbelt-technology/pi-dashboard-shared": "^<old>"`) to the new version.
The third regenerates `pnpm-lock.yaml` so its recorded cross-ref specifiers
match the bumped versions — without it, strict prerelease semver causes
consumer installs to fall back to stale registry tarballs. The CI
`tag-and-push` job runs the same three commands; doing it locally keeps the
commit honest. See changes: fix-release-lockfile-drift, adopt-pnpm-for-dev-ci.

> **Why the second step?** The npm CLI does not implement the `workspace:`
> protocol (it's a pnpm/yarn feature). We use plain semver ranges and
> synchronise them at bump time so the published tarballs have consistent
> metadata. CI's `publish.yml` runs `sync-versions.js` defensively too, but
> running it locally keeps the commit honest.

> **Skew guard for `distill-session-knowledge` → `session-distiller`.** The
> thin skill package `@blackbelt-technology/pi-dashboard-distill-session-knowledge`
> deps on the engine `@blackbelt-technology/pi-dashboard-session-distiller`.
> Both are non-private, so `npm publish -ws` publishes them in the SAME run
> (engine first — `-ws` walks in topological/dependency order) and
> `sync-versions.js` pins the dep specifier to the just-cut version. Never
> publish one without the other; that is what prevents cross-package skew.

Verify with:
```bash
git diff --stat package.json packages/*/package.json pnpm-lock.yaml
```

Should show `version` bumps in `package.json` and every
`packages/*/package.json` plus synchronised `@blackbelt-technology/pi-dashboard-*`
dependency specifiers, plus a regenerated `pnpm-lock.yaml`. No other files.

## Step 6 — Commit

```bash
git add CHANGELOG.md package.json pnpm-lock.yaml packages/*/package.json
git commit -m "chore(release): v<version>"
```

**Use AskUserQuestion (confirm)** before committing — show the user the
exact message + file list.

## Step 7 — Tag and push

```bash
git tag v<version>
git push origin develop
git push origin v<version>
```

**Use AskUserQuestion (confirm)** before pushing. Surface this warning:
pushing the tag triggers the Release workflow immediately. Reverting
requires `git push --delete origin v<version>` + re-tag.

## Step 8 — Post-push instructions (print to user)

Give the user this summary:

```
✅ Tag v<version> pushed.

Next steps (human):
1. Watch CI:  https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions
   The Release workflow will:
     • publish every non-private workspace (~32 @blackbelt-technology/*
       packages via `npm publish -ws --include-workspace-root`) to npm
     • build Electron installers (macOS DMG × 2 — Apple Silicon +
       Intel, Linux DEB+AppImage, Windows NSIS+ZIP+portable per arch)
     • create a GitHub Release with artifacts + latest*.yml metadata.
       PRODUCTION tags (vX.Y.Z) publish immediately; PRE-RELEASE tags
       (vX.Y.Z-rc.N) land as a draft.
2. Open the release:
   https://github.com/BlackBeltTechnology/pi-agent-dashboard/releases
3. Verify the body (auto-extracted from CHANGELOG.md [<version>] section)
   and all 7 platform artifacts are attached:
     • PI-Dashboard-<ver>-arm64.dmg  (Apple Silicon)
     • PI-Dashboard-<ver>-x64.dmg    (Intel)
     • pi-dashboard_<ver>_amd64.deb         (Linux x64)
     • pi-dashboard_<ver>_arm64.deb         (Linux arm64)
     • PI-Dashboard-<ver>.AppImage          (Linux x64)
     • PI-Dashboard-<ver> Setup.exe + .zip + portable.exe (Windows x64)
     • .zip + portable.exe (Windows arm64)
4. PRODUCTION tag: the release is already published — nothing to click;
   `release: published` fires automatically and redeploys GitHub Pages.
   PRE-RELEASE tag: review the draft, then click "Publish release".

If something is wrong, see `.pi/skills/release-revoke/SKILL.md`.
```

## Step 9 — Drive the post-tag Release pipeline (the tag push is the START, not the end)

Pushing the tag begins a gated pipeline in `publish.yml` that fails in ways you
cannot see until release time. Both v0.6.0 and v0.6.1 needed MANY tag moves
before a Release was published. Stay on it until `github-release` is green.

**Pipeline shape (each is a gate; a failure before `github-release` means NO
GitHub Release exists yet):**
```
release-gate ( ci-checks + 7-leg smoke ) → publish (npm, OIDC) → electron (6-leg matrix) → github-release
```
**Latent-bug warning:** the FIRST release where `publish` finally goes green
exposes CI bugs that never ran before (v0.6.1's `electron` job had been silently
skipped every prior cut because `publish` had never succeeded). Expect the
electron/publish legs to surface never-before-exercised failures.

### Recovery loop (the normal rhythm)
Fix on `develop` → **force-move the tag to the fix commit** → re-run. `npm publish`
is idempotent (skips already-published packages), so a partial publish + tag move
is safe. This is the expected loop **until a GitHub Release is published** — see
the reconciled guardrail below.

```bash
git commit ... && git push origin develop
git tag -f v<version> && git push -f origin v<version>   # re-triggers a clean single-pass run
```

### Do NOT use `gh run rerun --failed` for gate failures
GitHub does **not** re-dispatch skipped downstream *reusable-workflow* jobs
(`electron`, `github-release`) on a `--failed` rerun — even after `publish` turns
green. You get npm published but no installers / no Release, repeatedly. A fresh
(or force-moved) **tag push** runs the pipeline top-to-bottom in one pass.
`rerun` is fine ONLY for an isolated flaky leg whose downstream hasn't been
reached yet (e.g. a single red smoke leg).

### Failure triage

| Symptom | Class | Action |
|---|---|---|
| `ci-checks` red but all tests passed — vitest "Uncaught Exception" (`window is not defined`, react-virtual `setTimeout` after jsdom teardown, `ChatView.test.tsx`) | **flake** | re-run the `ci-checks` job |
| One smoke leg: `ECONNRESET` / `network aborted` during `pnpm install`, or Windows "web UI not reachable" 5s timeout on a cold runner | **flake** | re-run just that leg |
| `publish` install fails resolving the `@electron/node-gyp` git dep (`ERR_PNPM_EXOTIC_SUBDEP`) | **config** | `pnpm-workspace.yaml` must keep `blockExoticSubdeps: false`. (The old `npm@11.12.1` EALLOWGIT pin is GONE — post-migration the publish job installs with pnpm and upgrades to `npm@latest` only for the OIDC `npm publish --provenance` step. See change: adopt-pnpm-for-dev-ci §8.3.) |
| `publish` 422 `Error verifying sigstore provenance bundle: repository.url is ""` | **metadata** | the offending non-private `package.json` is missing a `repository` block (url + `directory`). Add it, matching a sibling like `shared`. Pre-check: `for f in package.json packages/*/package.json; do node -e "const p=require('./$f'); if(!p.private && !p.repository) console.log(p.name)"; done` |
| `publish` **E404** (not 403) on one package's `npm publish` | **human / npmjs.com** | Trusted Publisher not configured OR mismatched for THAT package. Since the other packages published with the same OIDC token, the config differs in one field. It must match EXACTLY: repo `BlackBeltTechnology/pi-agent-dashboard`, workflow **filename** `publish.yml` (NOT the display name "Release"), environment `npm-publish`. Web-UI action only — hand off to the user. |
| `electron`/`github-release` skipped instantly (<1s) even though `publish` is green | **workflow-if** (fixed in-repo; watch for regressions) | a skipped `tag-and-push` in needs-ancestry poisons the default `if: success()`. Those jobs now carry explicit `if: !cancelled() && needs.publish.result == 'success'`. |
| Windows electron leg: `koffi prebuild GO/NO-GO failed` | **guard-path** (fixed) | koffi 3.x ships per-platform packages (`@koromix/koffi-win32-x64/win32_x64/koffi.node`), not the koffi-2.x `koffi/build/...` path. Guard lives in `scripts/windows-liveness-smoke.ts`. |
| Windows **arm64** electron leg: NSIS install smoke "pi-dashboard.exe not found after 150s" | **arch** (fixed) | an arm64 binary can't execute on the x64 GitHub runner; install/uninstall smoke must be skipped on arm64 (needs a windows-11-arm runner). |
| The smoke matrix false-positives a stale import (e.g. a symbol deleted by an earlier PR still imported by a probe) | **latent develop bug** | fix on `develop`, force-move the tag. The 7-leg smoke only runs at release time, so these surface here. |

## Guardrails

- **Never skip pre-flight.** A failing test or dirty tree means the
  release is not ready.
- **If a gate-fix commit lands AFTER `chore(release)`, tag `HEAD`, not the
  release commit.** When the pre-tag smoke matrix (step 7) surfaces a latent
  `develop` bug, you fix it in a follow-up commit on top of `chore(release)`.
  The Release workflow re-runs the release-gate against the TAGGED tree, so
  the tag MUST include that fix — tag current `HEAD`. The version files
  (`0.6.0`) live in the ancestor `chore(release)` commit, so the tagged tree
  still carries the right version. Tagging the release commit instead would
  re-run the gate WITHOUT the fix and fail the publish (dangling tag).
- **Production tags publish automatically** (electron-updater needs a
  published release). Only pre-release tags (`-rc.N`, `-beta.N`) stay
  drafts for manual review — never hand-edit a production release to draft.
- **Force-moving the tag is the STANDARD post-tag recovery — UNTIL a GitHub
  Release is published.** Before `github-release` completes, no Release exists
  and `npm publish` is idempotent, so fixing a publish/electron-phase bug on
  `develop` and `git push -f origin v<version>` to the fix commit is the expected
  loop (Step 9), not a violation. Once a GitHub Release IS published, STOP
  force-moving — surface the conflict and hand off to `release-revoke`.
- **After tagging, always verify the tag SHA.** The dashboard git-polls and
  concurrent pi sessions can hold `.git/index.lock`; a blocked commit can
  silently drop your fix and leave the tag on a sibling session's commit.
  Confirm: `git rev-parse v<version>` == the intended fix commit, and
  `git log -1 --oneline v<version>` shows YOUR change — before watching the run.
- **One version at a time.** If the user asks to release two versions
  in a row, run this skill twice.
- **Respect the checkpoint in `docs/release-process.md`** — human clicks
  Publish, not the skill.
