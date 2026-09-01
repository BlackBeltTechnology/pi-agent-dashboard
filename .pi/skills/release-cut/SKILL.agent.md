# SKILL.md — release-cut index

Pull-only condensed map. Source: .pi/skills/release-cut/SKILL.md. Cut pi-agent-dashboard release: CHANGELOG promote → version bump → tag → push → drive Release pipeline.

Triggers: "cut a release", "release vX.Y.Z", "publish a new version", "tag a release". Canonical ref `docs/release-process.md` (skill automates steps 1–5). Production tags `vX.Y.Z` publish Release automatically; pre-release `vX.Y.Z-rc.N` stays draft.

## Pre-flight (MUST pass before touching anything)
- In order; any fail → stop + report: `git status --porcelain` empty; `git rev-parse --abbrev-ref HEAD` = `develop` (no `main`); `git fetch origin && git status -sb` not behind; `pnpm test`; `pnpm run build`.
- Dependency-shape gate — `node scripts/verify-release-deps.mjs`; asserts jiti/pinned node-pty still declared in publishable package.json. False-positive: naive `String.includes(minVersion)`; pin above floor fails → bump rule `minVersion` (+ evidence note + `scripts/AGENTS.md` row), NOT downgrade pin. Recurs every pi bump.
- Smoke matrix first — `gh workflow run ci-smoke.yml --ref develop` + `gh run watch`; all 7 legs green. Skip only if change provably installer-irrelevant.

## Step 1 — Read current state
- `git describe --tags --abbrev=0` ↔ `node -p "require('./package.json').version"` must match (v0.2.9 ↔ 0.2.9).

## Step 2 — Curate `## [Unreleased]`
- `git log <last-tag>..HEAD --oneline`; every feat:/fix: commit ↔ bullet under Added/Changed/Fixed; gaps → AskUserQuestion; never invent behaviour.
- Far-behind escape — dedupe feat|fix|perf log minus change-tags already in `[Unreleased]`, delegate grouped drafting to subagent, append existing-first, cap tail "Additional fixes" line.

## Step 3 — Decide next version (SemVer)
- Breaking/removal → major; any `### Added` → minor; only Fixed/Changed → patch. Always AskUserQuestion confirm — never auto-select.

## Step 4 — Promote `## [Unreleased]` → versioned section
- Rename to `## [<version>] - <YYYY-MM-DD>` (`date +%Y-%m-%d`, no leading v); insert fresh empty `[Unreleased]` above. Verify `grep -n "^## " CHANGELOG.md`.

## Step 5 — Bump all workspace versions + sync inter-package dep specifiers
- `npm version <version> --workspaces --include-workspace-root --no-git-tag-version`; `node scripts/sync-versions.js`; `pnpm install --lockfile-only`. Why sync: npm lacks `workspace:` protocol.
- Skew guard — `pi-dashboard-distill-session-knowledge` deps engine `pi-dashboard-session-distiller`; publish together, never one alone.
- Verify `git diff --stat package.json packages/*/package.json pnpm-lock.yaml` — bumps + synced `@blackbelt-technology/pi-dashboard-*` + regenerated lock only.

## Step 6 — Commit
- `git add CHANGELOG.md package.json pnpm-lock.yaml packages/*/package.json`; `git commit -m "chore(release): v<version>"`. AskUserQuestion confirm message + file list first.

## Step 7 — Tag and push
- `git tag v<version>`; `git push origin develop`; `git push origin v<version>`. Confirm first; warn push triggers Release immediately; revert = `git push --delete origin v<version>` + re-tag.

## Step 8 — Post-push instructions (print to user)
- Watch CI: ~32 non-private workspaces via `npm publish -ws --include-workspace-root`; Electron artifacts ×7 (DMG arm64+x64, DEB amd64+arm64, AppImage, Setup.exe+.zip+portable x64, .zip+portable arm64); GitHub Release + `latest*.yml`. Production → already published, nothing to click; pre-release → review draft, click "Publish release".

## Step 9 — Drive the post-tag Release pipeline
- Gates: `release-gate (ci-checks + 7-leg smoke) → publish (npm, OIDC) → electron (6-leg matrix) → github-release`. Fail before `github-release` = no Release.
- Recovery — fix on develop, `git tag -f v<version> && git push -f origin v<version>`; `npm publish` idempotent. NEVER `gh run rerun --failed` for gate failures (skipped downstream reusable-workflow jobs not re-dispatched).
- Triage — ci-checks vitest flake → rerun job; smoke `ECONNRESET`/network aborted/Windows 5s timeout → rerun leg; `ERR_PNPM_EXOTIC_SUBDEP` → keep `blockExoticSubdeps:false` in pnpm-workspace.yaml; publish 422 sigstore `repository.url is ""` → add `repository` block to non-private package.json; publish E404 → Trusted Publisher mismatch (repo `BlackBeltTechnology/pi-agent-dashboard`, workflow filename `publish.yml` not display name, env `npm-publish`), web-UI only; electron/github-release skipped <1s → workflow-if poison (`if: !cancelled() && needs.publish.result == 'success'`); koffi GO/NO-GO → koffi 3.x per-platform packages; arm64 NSIS "not found after 150s" → arm64 can't run x64 runner, skip smoke.

## Guardrails
- Never skip pre-flight. Gate-fix after `chore(release)` → tag HEAD, not release commit (version files in ancestor).
- Force-move tag = standard recovery UNTIL GitHub Release published; then STOP → hand off to `release-revoke`.
- Verify tag SHA after tagging — `git rev-parse v<version>` + `git log -1 --oneline v<version>` (`.git/index.lock` race with dashboard git-poll).
- One version at a time — two releases = run skill twice. Human clicks Publish (`docs/release-process.md` checkpoint), not the skill.
