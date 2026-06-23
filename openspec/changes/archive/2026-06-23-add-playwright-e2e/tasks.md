# Tasks

## 1. Dependency + scripts

- [x] 1.1 Add `@playwright/test` (pin a recent `^1.x`, match `site/` if practical) as a root devDependency. Run `npx playwright install chromium` documented as a one-time prerequisite (do NOT vendor browsers).
- [x] 1.2 Add root `package.json` script `"test:e2e": "playwright test"` and `"test:e2e:ui": "playwright test --ui"`. Keep separate from `npm test` (vitest) — E2E is opt-in, needs Docker.
- [x] 1.3 Add `tests/e2e/` outputs to `.gitignore`: `playwright-report/`, `test-results/`, `.playwright/`.

## 2. Playwright config

- [x] 2.1 Create `playwright.config.ts` at repo root. `testDir: "tests/e2e"`, `baseURL: "http://localhost:18000"`, single `chromium` project, `globalSetup`/`globalTeardown` pointing at the files in §3, sane timeouts (container boot is slow — `expect` timeout ~10s, `globalTimeout` generous).
- [x] 2.2 `reporter`: `list` locally + `html` to `playwright-report/`. `retries: process.env.CI ? 1 : 0`.
- [x] 2.3 Read `PW_E2E_USE_RUNNING` env in config/globalSetup to decide whether lifecycle is managed (see §3).

## 3. Container lifecycle (globalSetup / globalTeardown)

- [x] 3.1 `tests/e2e/global-setup.ts`: when `PW_E2E_USE_RUNNING` unset → spawn `docker/test-up.sh` detached (export `HOST_CWD` to a throwaway tmp dir, NOT the repo, to avoid overlaying the repo). Capture the compose project so teardown can target it.
- [x] 3.2 Poll `GET http://localhost:18000/api/health` until 200 or timeout (~180s for first-run image build; ~60s warm). Fail setup with a clear message naming `docker/test-up.sh` and `change add-playwright-e2e` if it never goes healthy.
- [x] 3.3 When `PW_E2E_USE_RUNNING=1` → skip spin-up, only assert `:18000` `/api/health` is already 200; do NOT tear it down in teardown (caller owns the container).
- [x] 3.4 `tests/e2e/global-teardown.ts`: when lifecycle was managed → run `docker/test-down.sh` (`compose down -v`), discard state. When `PW_E2E_USE_RUNNING=1` → no-op.
- [x] 3.5 Persist a tiny lifecycle marker (e.g. `test-results/.e2e-managed`) so teardown knows whether setup booted the container, even across crash/retry.

## 4. Smoke spec (proves wiring only)

- [x] 4.1 `tests/e2e/smoke.spec.ts`: navigate to `/`, assert the dashboard shell renders (a stable root selector / title). This is the wiring proof, NOT real coverage.
- [x] 4.2 Assert one WebSocket-backed signal is live (e.g. health/connection indicator reaches connected state) to prove `/ws` works through the browser, not just the entrypoint probe.
- [x] 4.3 Add `tests/e2e/helpers/` with a `gotoDashboard(page)` helper + a testid→locator map (ride the existing 693 `data-testid`s — see `design.md`; do NOT add app testids).
- [x] 4.4 Smoke WS proof is light only (option A, negative-hold): assert no `role="alert"` disconnect banner within a short hold window. The authoritative WS round-trip is scenario B in §5 — see `design.md`. Do NOT assert a positive "connected" element; none exists.

## 5. Follow-up scenario backlog (authored later, NOT in this change)

> Precondition for every workspace-dependent spec (5.1–5.5): the harness boots fixtures **unpinned** with ephemeral `~/.pi`. Each such spec MUST start with a pin-fixture arrange step (folder-pin / `git-init-btn` testids) and assume NO pre-existing session/folder/VCS root. See `design.md` § Fresh-container determinism.

- [ ] 5.1 **(first — authoritative WS round-trip, scenario B)** Pin baked `fixtures/sample-git` → spawn a session → assert `session-card-desktop` appears (card requires a live WS round-trip). This is the real connectivity proof; smoke §4.4 only does the light negative-hold.
- [ ] 5.2 VCS panel: with `fixtures/sample-git` pinned, assert git status/log render (`composer-git-group`).
- [ ] 5.3 VCS panel: pin baked `fixtures/sample-jj`, assert jj panel renders (`composer-jj-group`).
- [ ] 5.4 Terminal: open a terminal pane (`open-inline-terminal-button` → `terminal-card`), assert xterm mounts and echoes input.
- [ ] 5.5 Live update: trigger a bridge event, assert the UI reflects it without reload (WS-driven).
- [ ] 5.6 Navigation: each top-level route mounts without console errors (collect `page.on('console')` errors, assert none).
- [ ] 5.7 (Deferred) CI leg wiring in a separate change once §5.1–5.6 have real coverage.
- [ ] 5.8 (Deferred) Option C: add `data-testid="ws-status"` + `data-status={status}` to the shell for a deterministic positive connected assert. Do ONLY if §4.4's negative-hold proves flaky. See `design.md`.

## 6. Documentation

- [x] 6.1 Update `AGENTS.md`: under the QA section, add the convention — new browser-level QA scenarios authored as Playwright specs in `tests/e2e/`, lifecycle-managed against the Docker test container (`:18000`); VM `qa/tests/*` retained for install/runtime smoke. Keep rows ≤200 chars, no per-file index inline.
- [x] 6.2 Delegate to a general-purpose subagent (caveman style): add `docs/file-index.md` split row if a new area is needed, and per-file rows for `tests/e2e/*` + `playwright.config.ts` in the matching `docs/file-index-*` split, path-alphabetical.
- [x] 6.3 Add `tests/e2e/README.md`: prerequisites (Docker, `npx playwright install chromium`), how to run (`npm run test:e2e`), the `PW_E2E_USE_RUNNING=1` fast path, and the relationship to `qa/` and `site/` Playwright.

## 7. Verification

- [x] 7.1 `npm run test:e2e` from a clean checkout (Docker available) boots the container, smoke spec passes, container torn down, `~/.pi` byte-identical, repo untouched.
- [x] 7.2 `PW_E2E_USE_RUNNING=1 npm run test:e2e` against a manually `test-up.sh`'d container passes and leaves it running.
- [x] 7.3 `npm test` (vitest) unaffected — E2E not pulled into the unit run.
- [x] 7.4 `openspec validate add-playwright-e2e` passes.
