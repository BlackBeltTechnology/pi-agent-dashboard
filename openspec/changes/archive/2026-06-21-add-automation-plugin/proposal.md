## Why

The dashboard has no way to run agent tasks **on a trigger** — every pi session today starts from a human clicking "New Session". OpenAI Codex ships "Automations": background runs fired on a schedule (and, via plugins, on events) whose results land in a triage inbox. We want the same capability, plus the cross-session leverage the dashboard uniquely has (it already aggregates an event stream from every bridge).

The natural structural template is OpenSpec: a folder-backed feature with its own content view (folder nav entry → board → artifact reader). But OpenSpec lives in core today, and the team is actively dismantling that pattern — `extract-openspec-as-plugin` and `extract-flows-as-plugin` move folder-backed features OUT of core into `packages/<name>-plugin/` packages that claim shell **slots**. The OpenSpec extraction proposal names this exact scenario as its motivation:

> "Adding a sibling concept (e.g. ragger, judo workspace explorer) means accreting more conditional branches and imports in the same files."

Automation is precisely such a sibling concept. Building it in core would add the accretion the team is removing. The slot infrastructure it needs (`sidebar-folder-section`, `command-route`, `shell-overlay-route`, `session-card-badge`, `settings-section`, `content-view`) already shipped via `dashboard-shell-slots` + `dashboard-plugin-loader`. So a plugin is now both the consistent AND the lower-friction path.

## What Changes

- **NEW**: `packages/automation-plugin/` package with a `pi-dashboard-plugin` manifest (id `automation`), mirroring the `flows-plugin` layout (`src/{client,server,bridge}/index`, `package.json` exports, manifest-discoverability test).

- **NEW folder format** — automation definitions live on disk in two scopes:
  - per-folder: `<repo>/.pi/automation/<name>/automation.yaml` (+ `prompt.md`)
  - global: `~/.pi/automation/<name>/automation.yaml`
  - run/triage store: `<scope>/.pi/automation/runs/<date>-<name>/result.md`

- **NEW central scheduler** (plugin server entry): a single server-owned cron ticker that arms every automation's trigger. Phase 1 ships only the `schedule` trigger kind.

- **NEW extensible trigger registry**: `Map<kind, TriggerType>` where `TriggerType = { kind, parse(rawYaml), arm(cfg, fire): Disposable }`. Core registers `schedule`. The seam exists in phase 1 so future native-event triggers (e.g. `openspec.complete`, `session.ended`) and plugin-registered triggers slot in WITHOUT changing the folder format.

- **NEW run lifecycle — monitored, visibility configurable**: a fired trigger spawns a pi session stamped `kind="automation"`. Whether the run also appears on the normal board is governed by a `visibility` setting (`hidden` | `shown`, default `hidden`) set in the automation settings, overridable per automation. Regardless of visibility, the run ALWAYS appears in the Automation view, where users watch it live by reusing the existing `ChatView` pointed at the run's session id (same as inspecting a subagent — no new transcript rendering).

- **NEW model selection**: each automation's `model` field accepts a bare provider/model id OR an `@role` alias (e.g. `@fast`) resolved at spawn time via the existing roles plugin. Editor UI reuses `ModelSelector.tsx` for direct picks and a role dropdown for `@`.

- **NEW action types**: `prompt` (durable `prompt.md`) AND `skill` (`$skill-name`). Both supported.

- **NEW "Create Automation" entry point** presented alongside "New Session", opening the automation editor (trigger + action + model/@role + scope + mode + concurrency).

- **NEW slot claims** in the manifest:
  - `sidebar-folder-section` → `FolderAutomationSection` ("Automations (N) →")
  - `command-route` → automation board + run list (Triage)
  - `shell-overlay-route` → run monitor (ChatView for a run's session)
  - `session-card-badge` → optional running-automation indicator (predicate-gated)
  - `settings-section` (tab `general`) → scopes + retention + default run visibility config

- **NEW engine semantics** (not per-automation):
  - restart catch-up: **skip** missed runs (recompute next-fire on boot, never backfill).
  - run retention: **prune, keep last 100** runs per automation (oldest-first trim).
  - empty-findings run → **auto-archive** (Codex behavior).

- **NEW per-automation `concurrency`** field: `skip | queue | parallel` (default `skip`) governing what happens when a trigger fires while the previous run is still active.

- **CORE TOUCH (minimal, unavoidable)**: expose a spawn capability + the `kind="automation"` session stamp to the plugin via `ServerPluginContext`. This is the one place the plugin cannot be fully self-contained — it needs the shell's session-spawn machinery and the board-filter to honor the new kind. Detailed in `design.md`.

## Capabilities

### New Capabilities

- `automation-folder-format` — on-disk schema, dual scope (per-folder + global), run/triage store layout, retention.
- `automation-trigger-registry` — extensible `TriggerType` registry; `schedule` kind; arm/dispose lifecycle; restart catch-up = skip.
- `automation-run-lifecycle` — hidden `kind="automation"` session spawn, monitoring via ChatView, concurrency policy, model `@role`/id resolution, action prompt/skill, auto-archive empty.
- `automation-content-view` — slot-based UI: folder section, board/triage, run monitor, create-automation entry, settings section (incl. default run visibility).

### Modified Capabilities

- `dashboard-plugin-loader` / `dashboard-shell-slots` — unchanged contracts; this change is a consumer. The only addition is a `ServerPluginContext` spawn hook + `kind="automation"` session field (see design); spec deltas captured under the run-lifecycle capability.

## Impact

- NEW `packages/automation-plugin/` — entire package.
- `packages/shared/src/types.ts` — add optional `kind?: "automation"` + `automationRun?: { name; runId }` to `DashboardSession`.
- `packages/server/` — board/order filtering honors `kind==="automation"`; `ServerPluginContext` gains a spawn hook; session-spawn stamps `kind` from a new env var (e.g. `PI_DASHBOARD_AUTOMATION_RUN`).
- `packages/client/` — board filter excludes `kind==="automation"`; "Create Automation" action surfaced next to "New Session".
- Docs: `docs/file-index-plugins.md` (+ new package rows), `docs/architecture.md` (automation section pointer).

## Out of Scope (follow-ups)

- Phase 2: native-event triggers (`openspec.complete`, `session.ended`, `flow.completed`, idle-timeout) on the dashboard event bus — the registry seam ships now, the kinds come later.
- Phase 3: plugin-registered trigger kinds (e.g. `slack.message`) via the trigger registry's public registration API.
- Inbound webhook triggers.

## References

- **Attached research**: [`research.md`](./research.md) — Codex Automations study, full trigger-event analysis (general / pi-dashboard-native / plugin tiers), decision log with rationale.
- Structural template: OpenSpec feature (folder → watcher → poll → broadcast → content view).
- Behavioral template: Codex Automations (https://developers.openai.com/codex/app/automations) — schedule/thread/standalone shapes, triage inbox, worktree vs local, sandbox modes, `$skill` actions, "make the prompt durable", manual-test-first.
- Plugin pattern: `packages/flows-plugin/` (manifest, `registerPlugin(ctx)`, slot claims).
- Slot contracts: `openspec/specs/dashboard-shell-slots/spec.md`, `packages/shared/src/dashboard-plugin/slot-props.ts`, `slot-types.ts`.
- Architectural-direction conflict resolved: chose plugin over core to align with `extract-openspec-as-plugin` / `extract-flows-as-plugin`.
