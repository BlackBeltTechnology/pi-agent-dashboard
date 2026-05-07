## 1. Seed data — fake developer workspaces

- [x] 1.1 Create `seed/active-project/` workspace: 3 sessions (waiting on ask_user, streaming, completed), `.meta.json` sidecars, `preferences.json` with 2 pinned directories, `README.md` documenting covered UI states.
- [x] 1.2 Create `seed/empty-workspace/` workspace: 0 sessions, `preferences.json` with 1 pinned directory, landing-page state coverage.
- [x] 1.3 Create `seed/openspec-heavy/` workspace: 3 active OpenSpec changes, 2 archived, sessions with `attachedProposal` and `openspecChange` metadata, `preferences.json` with `openspec/` pinned.
- [x] 1.4 Create `seed/multi-folder/` workspace: 4 pinned directories with 2-4 sessions each, exercising folder focus/compaction and cross-folder session search.
- [x] 1.5 Create `seed/error-states/` workspace: disconnected session card, failed tool call with retry, error banner, terminal in dead state.
- [x] 1.6 Verify: start `pi-dashboard --dev` manually, point `PI_HOME` at `seed/active-project/`, confirm all 3 sessions render correctly in the sidebar.

## 2. Docker sandbox infrastructure

- [x] 2.1 Create `sandbox/Dockerfile`: base `node:22-bookworm-slim`, install `pi` + `openspec` globally, install dashboard npm deps, copy dashboard source, expose port 8000.
- [x] 2.2 Create `sandbox/docker-compose.yml`: two services — `dashboard` (build from sandbox/Dockerfile, health check on /api/health, seed volume mount) and `browser` (chromedp/headless-shell, port 9222, --no-sandbox, --disable-gpu).
- [x] 2.3 Create `sandbox/entrypoint.sh`: start `pi-dashboard --dev`, poll `/api/health` until 200 (max 30s), then tail logs (keep container alive).
- [x] 2.4 Verify: docker compose up --wait, health check, CDP, confirm `/api/health` returns 200, confirm browser CDP endpoint responds on port 9222.
- [x] 2.5 Verify: docker compose down cleans up cleans up both containers.

## 3. Browser automation — `--sandbox` + `--scenario` modes

- [x] 3.1 Modify `.pi/skills/browser-visual-debug/scripts/detect-dashboard.sh`: add `--sandbox` flag that outputs `DASHBOARD_URL=http://localhost:8000 MODE=sandbox` and exits 0 without probing.
- [x] 3.2 Modify `.pi/skills/browser-visual-debug/SKILL.md`: add "Sandbox Mode" section documenting `--sandbox`, `--scenario <path>`, the 10-step vocabulary (`open`, `click`, `fill`, `type`, `select`, `press`, `wait`, `screenshot`, `scroll`, `snapshot`), and the sequential halt-on-error contract.
- [x] 3.3 Add `references/sandbox-recipes.md` to `browser-visual-debug`: recipe for running sandbox scenarios end-to-end (docker-compose up → browser open → execute scenario → screenshot output → docker-compose down).
- [x] 3.4 Verify: detect-dashboard.sh --sandbox — assert output is `DASHBOARD_URL=http://localhost:8000 MODE=sandbox`.
- [x] 3.5 Verify: create a minimal scenario file (open dashboard → wait networkidle → screenshot), run `browser-visual-debug --sandbox --scenario <path>`, assert `screenshots/*.png` is created and non-empty.

## 4. Sandbox-designer skill

- [x] 4.1 Create `.pi/skills/sandbox-designer/SKILL.md`: skill for vision-capable design agent. Documents:
  - Recommended model: Claude Sonnet/Opus with vision.
  - Input: user story (prose) + before-screenshots (PNG attachments) + optional design.md context.
  - Output: `mockup.html` with Tailwind classes and `<!-- state: ... -->` HTML comments for every visual state.
  - Validation step: open mockup.html in browser, screenshot, compare against before-screenshots.
  - Constraints: use Tailwind utility classes only; annotate all states (default, empty, loading, error, hover, focused, disabled); label regions with HTML comments matching the user story's described UI elements.
- [x] 4.2 Verify: give the skill a simple user story ("add a green status pill next to the session name") + a before-screenshot of the sidebar → assert output is valid HTML with Tailwind classes and at least one `<!-- state: ... -->` comment.

## 5. openspec-propose — Design Phase integration

- [x] 5.1 Modify `.pi/skills/openspec-propose/SKILL.md`: add "Design Phase" section between spec creation and task creation. Gated on `docker info` exit code.
- [x] 5.2 Design Phase steps in the skill:
  - Docker gate: `docker info > /dev/null 2>&1` — if fails, emit "Design sandbox unavailable (Docker not found). Proceeding with text-only proposal." and skip to tasks.
  - `docker compose -f sandbox/docker-compose.yml up -d --wait`
  - Derive browser scenarios from user stories in the proposal.
  - Write scenario file to `<change-dir>/screenshots/scenario.json`.
  - Run `browser-visual-debug --sandbox --scenario <change-dir>/screenshots/scenario.json`.
  - Invoke `sandbox-designer` agent with user story + screenshots → `<change-dir>/mockup.html`.
  - `docker compose -f sandbox/docker-compose.yml down`
  - Reference `mockup.html` in the generated `design.md` as the visual contract.
- [x] 5.3 Verify: run `openspec-propose` for a test change with Docker available → assert `mockup.html` is created, screenshots are captured in `screenshots/`, Docker containers are cleaned up.
- [x] 5.4 Verify: run `openspec-propose` with Docker unavailable (/var/run/docker.sock absent or docker not on PATH) → assert notice is emitted, proposal is created text-only, no error.

## 6. openspec-archive-change — Seed merge

- [x] 6.1 Modify `.pi/skills/openspec-archive-change/SKILL.md`: add "Seed Merge" step after `openspec archive` succeeds and before final commit.
- [x] 6.2 Seed Merge steps in the skill (BEFORE `openspec archive`):
  - If `<change-dir>/seed.patch` exists: copy to temp, apply with `git apply --directory=seed/ <temp>/seed.patch`. On conflict: emit error, abort archive, leave seed unchanged.
  - If `<change-dir>/Dockerfile.patch` exists: copy to temp, apply to `sandbox/Dockerfile` with `git apply <temp>/Dockerfile.patch`. On conflict: emit error, abort.
  - `git add seed/ sandbox/Dockerfile` to stage merged changes.
  - Proceed with `openspec archive <change>`.
  - If Docker available: `docker compose -f sandbox/docker-compose.yml build` to rebuild sandbox image. Build failure emits warning but does not abort.
  - `git commit --amend --no-edit` to include seed changes in archive commit.
- [x] 6.3 Verify: create a test change with `seed.patch` adding a new session to `seed/active-project/` → run `openspec-archive-change` → assert the new session appears in `seed/active-project/` and is committed.
- [x] 6.4 Verify: create a test change with a conflicting `seed.patch` → run `openspec-archive-change` → assert error message, archive aborted, seed unchanged.

## 7. Documentation

- [x] 7.1 Add Key Files rows to `AGENTS.md` for: `seed/`, `sandbox/Dockerfile`, `sandbox/docker-compose.yml`, `sandbox/entrypoint.sh`, `.pi/skills/sandbox-designer/SKILL.md`. Each row ≤ 200 characters.
- [x] 7.2 Add per-file rows for seed workspace directories in `docs/file-index.md` or a new `docs/file-index-infra.md` split.
- [x] 7.3 Add "Design Sandbox" section to `docs/architecture.md`: describe the seed → sandbox → screenshot → mockup pipeline, its role in the OpenSpec workflow, and Docker composition.
- [x] 7.4 Add CHANGELOG entry under `## [Unreleased]` describing the new design sandbox infrastructure (no user-facing changes — developer tooling).

## 8. End-to-end validation

- [x] 8.1 Create a test UI change proposal using the full pipeline: `openspec-propose` → verify `mockup.html` + screenshots + all artifacts created → `openspec-apply` → verify implementation model reads mockup.html → open dashboard URL, confirm UI matches mockup structure.
- [x] 8.2 Archive the test change: verify `seed.patch` (if any) is applied, Dockerfile updated, image rebuilt.
- [x] 8.3 Run `npm test` — confirm no existing tests regress (this change adds no dashboard source code, so no existing tests should be affected).
- [x] 8.4 Run `npm run build` — confirm client builds without errors.
