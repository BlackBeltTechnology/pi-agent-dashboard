# Tasks

## 1. Provider-ready harness (gated)

- [x] 1.1 `docker/test-entrypoint.sh`: when `PI_E2E_SEED=1`, before the base entrypoint, seed fake `anthropic` oauth `auth.json` (flips `providersReady`) + RFC1918 `trustedNetworks` `config.json` (clears network guard). No-op if files exist.
- [x] 1.2 `docker/compose.test.yml`: pass `PI_E2E_SEED: "${PI_E2E_SEED:-}"` to the container. Default empty → manual `test-up.sh` stays UI-only.
- [x] 1.3 `tests/e2e/global-setup.ts`: set `PI_E2E_SEED=1` in the managed spawn env; blank `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` so host keys never leak into the container.
- [x] 1.4 `tests/e2e/README.md`: document `PI_E2E_SEED=1 docker/test-up.sh` for the `PW_E2E_USE_RUNNING=1` fast path.

## 2. Shared helpers

- [x] 2.1 `helpers/index.ts`: `pinDirectory(page, absPath)` — open pin dialog via onboarding CTA (fresh) or sidebar button (warm), fill PathPicker, wait for the listed entry, Select.
- [x] 2.2 `helpers/index.ts`: `ensureGitSession(page)` — idempotent; reuse a visible card (bounded wait) else pin `FIXTURE_GIT` + spawn. Returns the card locator.
- [x] 2.3 Add new testids to the map: `gitBranchBtn`, `dashboardAddFolderBtn`, `folderSpawnSessionBtn`, `settingsContent`, `openspecBoard`, `archiveBrowser`, `specsBrowser`.

## 3. Scenario specs

- [x] 3.1 §5.1 `session-spawn.spec.ts` — refactor onto `ensureGitSession`; assert the card is visible (authoritative WS round-trip).
- [x] 3.2 §5.2 `git-panel.spec.ts` — assert `git-branch-btn` visible (re-scoped from the worktree-only `composer-git-group`).
- [x] 3.3 §5.4 `terminal.spec.ts` — select session, click `open-inline-terminal-button`, assert the xterm "Terminal input" textarea is visible.
- [x] 3.4 §5.6 `navigation.spec.ts` — open settings, assert `settings-content` mounts AND no uncaught `pageerror` fired.

## 4. Verification

- [x] 4.1 `PW_E2E_USE_RUNNING=1` run against a warm container: all four scenarios reuse state and pass.
- [x] 4.2 Clean managed `npm run test:e2e`: fresh boot, first spec performs the real pin+spawn, all 6 specs pass, container torn down.
- [x] 4.3 `tsc --noEmit` clean for `tests/e2e/*` (pre-existing unrelated package errors out of scope).

## 5. Documentation

- [x] 5.1 Delegate file-index row updates to a subagent (caveman style): new `git-panel.spec.ts` / `terminal.spec.ts` / `navigation.spec.ts` rows + updated `helpers/index.ts` / `session-spawn.spec.ts` rows in `docs/file-index-skills-misc.md`.

## 6. Deferred (NOT in this change)

- [ ] 6.1 §5.3 jj panel (`composer-jj-group`, `fixtures/sample-jj`).
- [ ] 6.2 §5.5 live bridge-event UI update.
- [ ] 6.3 Folder-scoped routes (openspec board / archive / specs) — need a fixture with an openspec dir.
- [ ] 6.4 §5.7 CI leg wiring; §5.8 positive `ws-status` testid.
