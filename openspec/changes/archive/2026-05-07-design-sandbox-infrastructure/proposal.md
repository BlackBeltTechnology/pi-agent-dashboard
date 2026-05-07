## Why

Every OpenSpec change that touches UI currently relies on prose to describe visual intent: "add a dropdown next to the branch picker," "show a warning banner above the session card." The implementation model then interprets these descriptions and produces JSX — with no visual feedback loop before the human reviews the result. This causes:

- **Visual drift**: spacing, alignment, and color choices that don't match intent survive until review.
- **Iteration loops**: "move it 8px left" → rebuild → "actually 12px" → rebuild — each cycle costs a full turn.
- **Missed states**: empty, loading, error, and edge-case states that weren't described in prose are discovered in QA, not during implementation.

A vision-capable model can read screenshots of the current UI and produce Tailwind HTML mockups that serve as **visual contracts** — the implementation model translates HTML+Tailwind directly to JSX, eliminating guesswork. The mockup's invariant is structural: all annotated visual states are represented, and element ordering/regions are preserved. Spacing, colors, and exact pixel values may be adjusted by the implementation model to match existing dashboard patterns. The problem is infrastructure: there's no reproducible way to generate "before" screenshots of the dashboard in all the states the change affects.

This change builds that infrastructure: a Docker sandbox seeded with fake-but-realistic workspace data covering every dashboard UI state, a browser automation driver to capture precise screenshots, and a vision-capable design agent that produces lossless Tailwind mockups.

## What Changes

### New files and directories

- **`seed/`** — version-controlled repository of fake developer workspaces (projects, sessions, git repos, OpenSpec changes, pinned directories, plugin configs) that render all dashboard UI states. Each workspace is a self-contained subdirectory with a `README.md` describing which UI states it covers. Seed data is JSON blobs compatible with the dashboard's `.meta.json` / session JSONL formats so the dashboard server loads them natively — no mock server, no fixtures, real `pi-dashboard` rendering real data.

- **`sandbox/Dockerfile`** — Docker image for the dashboard service only:
  - Base `node:22-bookworm-slim`.
  - Installs `pi` and `openspec` globally.
  - Installs dashboard npm dependencies, copies dashboard source.
  - Seed data is mounted at runtime via docker-compose volume (not baked into the image).
  - Exposes port 8000. Image is cacheable; seed changes don't invalidate layers (volume mount).

- **`sandbox/docker-compose.yml`** — two-service composition:
  - `dashboard` service: builds from `sandbox/Dockerfile`, health check on `/api/health`, seed volume mounted at `~/.pi/agent/sessions/`.
  - `browser` service: `chromedp/headless-shell` image, exposes port 9222 (Chrome DevTools Protocol), `--no-sandbox --disable-gpu`.
  - Both services share a Docker network; the browser reaches the dashboard at `http://dashboard:8000`.

- **`sandbox/entrypoint.sh`** — dashboard container entrypoint: starts `pi-dashboard --dev`, polls `/api/health` until 200 (max 30s timeout), then tails logs to keep the container alive.

- **`.pi/skills/sandbox-designer/SKILL.md`** — new pi skill for the vision-capable design agent. Consumes a user story + before-screenshots (from sandbox browser automation), returns a Tailwind HTML file with all visual states annotated via HTML comments (`<!-- state: empty -->`, `<!-- state: error -->`, `<!-- state: hover -->`). This HTML file lives in the change directory as `mockup.html` and serves as the visual contract for the implementation model.

- **Per-change artifacts** (`seed.patch`, `Dockerfile.patch`): when a change introduces new UI that exercises a previously uncovered state, the change includes a `seed.patch` (unified diff against `seed/`) and optionally a `Dockerfile.patch` (if new system dependencies are needed). These are applied at archive time.

### Example: seed workspace

A `seed/active-project/` workspace might contain:

```
seed/active-project/
├── README.md                  # "Covers: multi-session sidebar, flows dashboard, settings panel"
├── .meta.json                 # session metadata (name, cwd, status, attachedProposal)
├── session-abc123.jsonl       # 15-turn session: initial prompt → tool calls → ask_user waiting
├── session-def456.jsonl       # 8-turn session: streaming, active, with subagent calls
├── session-ghi789.jsonl       # 3-turn session: completed, with token stats
└── preferences.json           # pinned directories, session order
```

The dashboard server reads these JSONL files and `.meta.json` sidecars natively — the same format it uses for real sessions. No mock adapter, no fixtures. The fake data is hand-crafted to exercise specific UI states:

| Workspace | UI states covered |
|---|---|
| `seed/active-project/` | Multi-session sidebar (3 sessions: waiting, streaming, completed), flows dashboard (2 flows), settings panel |
| `seed/empty-workspace/` | Empty state (no sessions), landing page, "spawn your first session" prompt |
| `seed/openspec-heavy/` | OpenSpec folder section (3 active changes, 2 archived), attach/detach flow, change-state toggles |
| `seed/multi-folder/` | 4 pinned directories, folder focus/compaction, cross-folder session search |
| `seed/error-states/` | Disconnected session card, failed tool call, error banner, terminal dead state |

### Example: scenario file

A scenario file (`screenshots/scenario.json`) is a JSON array of steps. Each step maps to a `browser` tool command:

```json
[
  { "action": "open",   "url": "http://localhost:8000" },
  { "action": "wait",   "condition": "networkidle" },
  { "action": "screenshot", "name": "01-sidebar-initial" },
  { "action": "click",  "selector": "text=Flows" },
  { "action": "wait",   "ms": 500 },
  { "action": "screenshot", "name": "02-flows-dashboard" },
  { "action": "click",  "selector": "text=Settings" },
  { "action": "wait",   "ms": 500 },
  { "action": "screenshot", "name": "03-settings-panel" }
]
```

Screenshots are written to `<change-dir>/screenshots/` as PNG files. The scenario file is derived from user stories by the `openspec-propose` skill during the design phase.

### Example: mockup.html (visual contract)

The `sandbox-designer` agent receives the before-screenshots and the user story, then produces a Tailwind HTML file. Example structure:

```html
<!-- state: default -->
<div class="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b">
  <span class="text-sm font-medium text-gray-700">Branch:</span>
  <select class="text-sm border rounded px-2 py-1 bg-white">
    <option>main</option>
    <option>feat/new-ui</option>
  </select>
  <span class="text-xs text-green-600 ml-auto">✓ up to date</span>
</div>

<!-- state: dirty (unstaged changes) -->
<div class="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200">
  <span class="text-sm font-medium text-amber-800">Branch:</span>
  <select class="text-sm border rounded px-2 py-1 bg-white">
    <option>feat/new-ui</option>
  </select>
  <span class="text-xs text-amber-700 ml-auto">⚠ 3 files modified</span>
</div>

<!-- state: detached HEAD -->
<div class="flex items-center gap-2 px-3 py-2 bg-red-50 border-b border-red-200">
  <span class="text-sm font-medium text-red-700">Detached HEAD @ a1b2c3d</span>
  <button class="text-xs text-red-600 underline ml-auto">Create branch</button>
</div>
```

The implementation model reads this file, translates each `<!-- state: ... -->` block to a JSX component variant, and maps Tailwind classes to the dashboard's existing utility patterns. The mockup is a contract, not production code — spacing/color adjustments are expected; structure and state coverage are the invariant.

### Modified files

- **`.pi/skills/browser-visual-debug/SKILL.md`** — add `--sandbox` mode section:
  - `--sandbox` skips the `detect-dashboard.sh` URL probe and uses `http://localhost:8000` (the sandbox's known port).
  - Accepts a scenario file path (`--scenario <path>`): JSON array of `{ action, url?, selector?, value?, wait?, name? }` steps.
  - Captures screenshots at each `screenshot` step, writing to `screenshots/{name}.png` in the change directory.
  - Step vocabulary: `open`, `click`, `fill`, `type`, `select`, `press`, `wait`, `screenshot`, `scroll`, `snapshot`.

- **`.pi/skills/browser-visual-debug/scripts/detect-dashboard.sh`** — add `--sandbox` flag; when set, outputs `DASHBOARD_URL=http://localhost:8000 MODE=sandbox` without probing.

- **`.pi/skills/openspec-propose/SKILL.md`** — add "Design Phase" (optional, gated on Docker availability) between spec creation and task creation:
  1. Check Docker availability (`docker info > /dev/null 2>&1`). If unavailable: emit notice, skip to tasks.
  2. Spin up Docker sandbox (`docker compose -f sandbox/docker-compose.yml up -d --wait`).
  3. Derive browser scenarios from user stories in the proposal — which pages to visit, which UI states to capture before/after.
  4. Write scenario file to `<change-dir>/screenshots/scenario.json`.
  5. Run `browser-visual-debug --sandbox --scenario <change-dir>/screenshots/scenario.json` to capture before-screenshots.
  6. Run `sandbox-designer` agent with the user story + all before-screenshots as attachments → produces `<change-dir>/mockup.html`.
  7. Include `mockup.html` in the change directory as the visual contract alongside `design.md`.
  8. Tear down sandbox (`docker compose -f sandbox/docker-compose.yml down`).

- **`.pi/skills/openspec-archive-change/SKILL.md`** — add seed merge step (runs BEFORE `openspec archive` moves the change directory):
  1. If `<change-dir>/seed.patch` exists: copy it to a temp location, apply with `git apply --directory=seed/ <temp>/seed.patch`. On conflict: abort archive with error message, leave seed unchanged.
  2. If `<change-dir>/Dockerfile.patch` exists: copy to temp, apply to `sandbox/Dockerfile` with `git apply <temp>/Dockerfile.patch`. On conflict: abort.
  3. If Docker available and patches were applied: `docker compose -f sandbox/docker-compose.yml build` to rebuild sandbox image.
  4. `git add seed/ sandbox/Dockerfile` to stage merged changes.
  5. Proceed with `openspec archive <change>` (moves change to archive/).
  6. Amend archive commit to include seed changes: `git commit --amend --no-edit`.

  **Timing rationale**: patches are read BEFORE `openspec archive` moves the change directory. This avoids the ambiguity of accessing `<change-dir>/seed.patch` after the directory has been relocated.

- **`AGENTS.md`** — add Key Files rows:
  - `seed/` — fake developer workspace data covering all dashboard UI states
  - `sandbox/Dockerfile` — Docker image for reproducible pi-dashboard + headless Chromium
  - `sandbox/docker-compose.yml` — sandbox orchestration (dashboard + browser services)
  - `sandbox/entrypoint.sh` — startup script: pi-dashboard → health → Chromium
  - `.pi/skills/sandbox-designer/SKILL.md` — vision-capable design agent: screenshots + story → mockup.html

- **`docs/architecture.md`** — add "Design Sandbox" section describing the seed → sandbox → screenshot → mockup pipeline and its role in the OpenSpec workflow.

### No changes to

- Dashboard server code (`src/server/`, `packages/server/`).
- Dashboard client code (`src/client/`, `packages/client/`).
- Bridge extension (`src/extension/`, `packages/extension/`).
- Protocol (`src/shared/protocol.ts`, `src/shared/browser-protocol.ts`).
- Plugin system (`packages/dashboard-plugin-runtime/`).

This is purely infrastructure + skill changes. The dashboard itself runs unmodified inside the sandbox.

## Capabilities

### New Capabilities

- **`design-sandbox-seed`**: shared repository of fake developer workspace data covering all dashboard UI states. Grows organically via archive-merge.

- **`design-sandbox-docker`**: Docker infrastructure to run pi-dashboard with seed data + headless Chromium for reproducible screenshot capture.

- **`design-sandbox-scenarios`**: scenario-based browser automation — JSON step files → browser actions → screenshots. Drives `browser-visual-debug --sandbox`.

- **`design-mockup-generation`**: vision-capable `sandbox-designer` agent receives screenshots + user story → produces Tailwind HTML mockup with labeled visual states.

- **`design-sandbox-archive-merge`**: applies `seed.patch` and `Dockerfile.patch` from completed changes back into the shared base during archival. Rebuilds sandbox image.

- **`design-sandbox-propose-integration`**: optional Docker-gated Design Phase in `openspec-propose` — sandbox startup, scenario derivation, screenshot capture, `sandbox-designer` invocation, teardown, and graceful fallback when Docker is unavailable.

### Modified Capabilities

- **`browser-visual-debug`**: new requirement — the detect-dashboard script SHALL support `--sandbox` mode returning a fixed `DASHBOARD_URL=http://localhost:8000` without probing. The SKILL.md SHALL document `--scenario` file-driven automation with a step vocabulary (`open`, `click`, `fill`, `screenshot`, `wait`).

  Delta spec: `specs/browser-visual-debug/spec.md` in this change adds the `--sandbox` requirement to the existing `openspec/specs/browser-visual-debug/spec.md`.

## Impact

- **Code**: no dashboard source code changes. All changes are in:
  - `seed/` — new directory with fake workspace data
  - `sandbox/` — new directory with Dockerfile, entrypoint.sh, docker-compose.yml
  - `.pi/skills/sandbox-designer/SKILL.md` — new skill
  - `.pi/skills/browser-visual-debug/SKILL.md` — `--sandbox` mode
  - `.pi/skills/browser-visual-debug/scripts/detect-dashboard.sh` — `--sandbox` flag
  - `.pi/skills/openspec-propose/SKILL.md` — design phase integration
  - `.pi/skills/openspec-archive-change/SKILL.md` — seed merge step
  - `AGENTS.md` — Key Files entries
  - `docs/architecture.md` — Design Sandbox section

- **APIs**: none. The sandbox dashboard exposes the same REST/WS API as production; browser automation uses Chrome DevTools Protocol (not a new API surface).

- **Dependencies**: Docker (`docker` CLI + `docker compose`), `pi-agent-browser` (already a dependency of `browser-visual-debug`), headless Chromium (bundled in Docker image).

- **Behavior**: no change to dashboards running in production. No change to existing OpenSpec workflows until `openspec-propose` is invoked — and even then, the design phase is additive (existing proposal artifacts are still created; `mockup.html` is an additional output).

- **Persistence**: `seed/` is git-tracked. Sandbox Docker image is cached locally (`~/.pi/dashboard/sandbox-image.tar` or Docker's build cache). Per-change screenshots are ephemeral (not committed — too large; `mockup.html` is the persisted artifact).

- **Tests**: Docker sandbox startup/shutdown smoke test. Browser automation scenario execution test. `sandbox-designer` mockup generation test (vision model output validation — structure, not pixel-perfect). Seed archive-merge integration test.

## Migration Risks

- **[Risk] Docker not installed on developer machine.** The design phase in `openspec-propose` is optional — if Docker is unavailable, the skill skips the sandbox and falls back to text-only proposals (today's behavior). The skill documents the skip with a notice: "Design sandbox unavailable (Docker not found). Proceeding with text-only proposal."

- **[Risk] Seed data becomes stale vs. dashboard UI.** Dashboard UI evolves, and seed data must reflect current component states. Mitigation: archive-merge grows seed data alongside dashboard changes. When a seed workspace is updated, the change's author is responsible for updating `seed/<workspace>/README.md` to reflect new coverage.

- **[Risk] Vision model variability.** Different vision models interpret the same screenshot differently, producing mockups with varying fidelity. Mitigation: `sandbox-designer` skill documents the recommended model (Claude Sonnet/Opus with vision). The mockup is a contract, not production code — minor spacing/color differences are acceptable; structure and state coverage are what matter.

- **[Risk] Docker build time on first run.** The initial sandbox image build (installing pi, openspec, npm deps) may take 2-5 minutes. Mitigation: Docker layer caching. Subsequent builds only invalidate the COPY layer when `seed/` changes. Pre-built image shipping (future — not in this change).

- **[Risk] `seed.patch` conflicts.** Two archived changes may patch the same seed file. Mitigation: archive-merge applies patches sequentially in archive order. If a patch fails, the archival process fails with a clear message — the author resolves the conflict manually and re-archives.

## References

- `openspec/specs/browser-visual-debug/spec.md` — existing spec for browser automation (modified by this change).
- `.pi/skills/browser-visual-debug/SKILL.md` — current skill implementation.
- `.pi/skills/openspec-propose/SKILL.md` — skill being modified.
- `.pi/skills/openspec-archive-change/SKILL.md` — skill being modified.
- `docs/architecture.md` — dashboard architecture (Design Sandbox section to be added).

## End-to-End Flow

```
User: "/opsx-propose add branch-status-pill"
  │
  ▼
openspec-propose skill
  ├─ 1. Create change directory + proposal.md + specs (as today)
  ├─ 2. [NEW] Design Phase (optional, gated on Docker)
  │     ├─ docker compose up -d              # start sandbox (dashboard + headless Chromium)
  │     ├─ Derive scenarios from user story  # "visit /flows → click session → screenshot"
  │     ├─ Write scenarios.json
  │     ├─ browser-visual-debug --sandbox    # execute scenarios → capture before-screenshots
  │     ├─ sandbox-designer agent            # screenshots + user story → mockup.html
  │     └─ docker compose down               # tear down sandbox
  ├─ 3. Create design.md (references mockup.html as visual contract)
  └─ 4. Create tasks.md
  │
  ▼
User reviews mockup.html → approves → "/opsx-apply"
  │
  ▼
Implementation model:
  ├─ Reads design.md + mockup.html
  ├─ Translates each <!-- state: ... --> block to JSX
  ├─ Maps Tailwind classes to dashboard utility patterns
  └─ Produces .tsx files
  │
  ▼
User reviews implementation → approves → "/opsx-archive"
  │
  ▼
openspec-archive-change skill
  ├─ [NEW] git apply seed.patch             # merge new seed data (BEFORE archive move)
  ├─ [NEW] git apply Dockerfile.patch       # merge Docker changes (BEFORE archive move)
  ├─ [NEW] git add seed/ sandbox/Dockerfile # stage merged changes
  ├─ openspec archive <change>              # move to archive/ (as today)
  ├─ [NEW] docker compose build             # rebuild sandbox image with updated seed
  └─ git commit --amend                     # include seed/Dockerfile changes in archive commit
```

## Dependencies

This change has no dependencies on other in-flight OpenSpec changes. It is self-contained.

- **Docker** must be installed on the developer machine for the sandbox to work. The design phase is optional — `openspec-propose` falls back to text-only when Docker is absent.
- **`pi-agent-browser`** is already a project dependency (registered in `.pi/settings.json`). No new package installation required.
- **`pi` and `openspec`** are already part of the dashboard's bootstrap toolchain. The sandbox Dockerfile installs them independently; no bootstrap changes needed.

## Non-Goals (explicitly out of scope)

- **Pre-built sandbox image shipping in Electron installer.** The sandbox is a developer tool for OpenSpec workflows, not a user-facing feature.
- **Automated visual regression testing.** This change provides infrastructure for design-time mockup generation, not CI-driven screenshot diffs.
- **Seed data covering 100% of UI states on day 1.** The initial `seed/` covers the most common states (5 workspaces listed above). Edge cases are added organically via archive-merge as changes exercise them.
- **Mockup → JSX code generation.** The mockup is a visual contract for a human review loop, not an input to a code generator. The implementation model translates it manually.
- **Sandbox running on CI.** The sandbox is local-only. CI does not run Docker sandboxes.
