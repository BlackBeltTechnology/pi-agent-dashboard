# Add Playwright browser-E2E QA against the Docker test container

## Why

QA today splits in two and neither layer drives the browser end-to-end:

1. **VM-based QA** (`qa/`) — Packer VMs + `qa/tests/*.sh,*.ps1`. Process/CLI smoke only: install, server-start, a raw `/ws` connect, terminal spawn, git ops. No rendered-UI assertions.
2. **Docker test harness** (`docker/`) — a disposable, fully isolated dashboard on `:18000` (overlayfs lower = host project ro, tmpfs upper, ephemeral `~/.pi`). Its only automated check is the entrypoint smoke probe (`GET /api/health` + one WS connect). Real browser QA is **manual** via `agent-browser`.

There is no automated coverage that actually opens the dashboard in a real browser, navigates panels, and asserts on rendered DOM/behaviour. Regressions in routing, panel render, WebSocket-driven live updates, terminal UI, and VCS panels can only be caught by a human clicking around.

The Docker test harness is the ideal target: structurally incapable of colliding with a host dashboard, ephemeral state every run, baked git/jj fixtures, fail-fast smoke check before ready. Pointing Playwright at `http://localhost:18000` gives reproducible browser-E2E with zero host coupling.

## What Changes

- **Add a Playwright E2E suite at `tests/e2e/`** (repo root, new). Kept **alongside** the existing VM smoke tests in `qa/` — neither replaces the other. VM tests verify clean-install + process runtime across OSes; Playwright verifies rendered-UI behaviour against a known-good container.
- **Lifecycle owned by Playwright.** `globalSetup` spins up the Docker test container (`docker/test-up.sh`, detached) and waits for `:18000` `/api/health` → 200; `globalTeardown` runs `docker/test-down.sh` (discards all state). A `PW_E2E_USE_RUNNING=1` escape hatch skips lifecycle management and targets an already-running container (faster local iteration).
- **`baseURL = http://localhost:18000`** in `playwright.config.ts`, single chromium project to start.
- **No application code changes.** This is purely additive test infrastructure. The container image, server, and bridge are unchanged.
- **AGENTS.md convention.** Record that new browser-level QA scenarios are authored as Playwright specs under `tests/e2e/`, target the Docker test container, and that VM `qa/` smoke tests stay for install/runtime coverage. Add a per-file row to the matching `docs/file-index-*` split (delegated, caveman style).
- **Scenarios are NOT written in this change.** This change lands the harness + config + lifecycle + one trivial smoke spec proving the wiring. Each real scenario (panel render, live WS update, terminal, git/jj panels) is its own follow-up task tracked in `tasks.md` §5.

## Capabilities

### Added Capabilities

- `playwright-e2e-qa`: browser-level E2E suite at `tests/e2e/`, lifecycle-managed against the Docker test harness on `:18000`, additive to VM QA.

## Impact

- **Scope**: new `tests/e2e/` dir (config + globalSetup/teardown + one smoke spec + helpers), `@playwright/test` devDependency, one `package.json` script (`test:e2e`), AGENTS.md convention rows, one file-index row. ~150 LOC + deps.
- **Depends on**: `docker/test-up.sh` / `docker/test-down.sh` (shipped, archive `2026-06-21-docker-test-harness`). No new image build.
- **CI**: out of scope for this change. The suite is runnable locally and CI-ready (needs Docker + `npx playwright install chromium`); wiring a CI leg is a deliberate follow-up so we don't pay container-boot time on every push before the suite has real coverage.
- **Runtime cost**: first run builds the image (minutes, cached after); each run boots a container (~seconds) unless `PW_E2E_USE_RUNNING=1`.
- **Non-goals**:
  - Replacing or porting `qa/tests/*.sh,*.ps1` — they stay as-is.
  - Multi-browser (firefox/webkit) matrix — chromium only to start.
  - Visual-regression / screenshot diffing — the `site/` Playwright pipeline already owns screenshots; this is behavioural E2E.
  - Seeding provider keys for live agent runs — UI-only by default (mirrors the harness default); opt-in later via `docker/.env`.
  - Authoring the actual scenario specs — tracked as follow-up tasks, not implemented here.
