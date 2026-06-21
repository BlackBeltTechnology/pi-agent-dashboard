# Design — add-automation-plugin

## Context

Two reference points:
- **OpenSpec** (this repo) = structural template: folder on disk → watcher → poll → broadcast → content view.
- **Codex Automations** = behavioral template: trigger → background run → triage inbox.

Automation = OpenSpec's plumbing carrying Codex's payload, packaged as a slot-claiming plugin (not core) to align with `extract-openspec-as-plugin` / `extract-flows-as-plugin`.

## Folder format

```
  <scope>/.pi/automation/
    <name>/
      automation.yaml      # trigger, action, model, mode, sandbox, concurrency
      prompt.md            # durable prompt (when action.kind == prompt)
    runs/
      2026-06-19-<name>/
        result.md          # findings; empty → auto-archived
```

`<scope>` = repo root (per-folder) OR `~` (global). Both scanned; merged in the view with a scope badge.

```yaml
on:
  kind: schedule            # phase-1 only kind
  cron: "0 9 * * 1"
mode: worktree              # worktree | local
sandbox: workspace-write    # read-only | workspace-write | full-access
concurrency: skip           # skip | queue | parallel
visibility: hidden          # hidden | shown — override of the settings default
action:
  kind: prompt              # prompt | skill
  prompt: ./prompt.md
  # kind: skill
  # skill: $recent-code-bugfix
model: "@fast"              # @role OR bare "provider/model-id"
```

## Trigger registry (the extensibility seam)

```
interface TriggerType<Cfg> {
  kind: string                       // "schedule" (core); later events/plugins
  parse(rawYaml: unknown): Cfg       // validate the `on:` block
  arm(cfg: Cfg, fire: (ctx) => void): Disposable  // subscribe; dispose to re-arm
}
```

- Plugin server entry holds `TriggerRegistry = Map<kind, TriggerType>`.
- Phase 1: `register("schedule", scheduleTrigger)` only.
- `arm()` returns a `Disposable` so the scheduler re-arms cleanly on config change / restart.
- Phase 2/3 add kinds via the SAME interface — folder format never churns.

```
   ┌───────────────────────────────┐
   │ TriggerRegistry               │
   ├───────────────────────────────┤
   │ schedule  (core, phase 1)     │──► central cron ticker
   │ session.ended   (phase 2)     │──► dashboard event bus
   │ openspec.complete (phase 2)   │──► dashboard event bus  ← the moat
   │ slack.message   (phase 3)     │──► plugin-registered
   └───────────────────────────────┘
```

## Central scheduler

- One server-owned ticker in the plugin server entry (decision: central, not per-bridge — required for future cross-session event triggers).
- On boot: scan both scopes, parse each `automation.yaml`, `arm()` its trigger, compute next-fire.
- **Restart catch-up = skip**: missed fires while the server was down are NOT backfilled. Next-fire recomputed forward from now.
- fs.watch on `.pi/automation/` (clone `openspec-change-watcher.ts`, 300 ms debounce) re-arms on edit/create/delete.

## Run lifecycle — hidden but monitored

```
  trigger fires
     │
     ▼
  resolve model (@role → roles plugin; else bare id)
     │
     ▼
  spawn pi session via ServerPluginContext spawn hook
     env: PI_DASHBOARD_AUTOMATION_RUN="<name>:<runId>"
     prompt|skill, mode (worktree|local), sandbox
     │
     ▼
  event-wiring stamps session.kind="automation" + automationRun{name,runId}
     │                                  visibility resolved:
     │                                  per-automation field ?? settings default
     ├─ BOARD: shown IF visibility=="shown", else excluded (default hidden)
     └─ AUTOMATION VIEW: ALWAYS filter IN (regardless of visibility)
            ├─ run list / Triage (status running|done|error)
            └─ shell-overlay-route → ChatView(run.sessionId)  ← reuse, no new code
     │
     ▼
  run ends → write runs/<date>-<name>/result.md
             empty findings → auto-archive
             prune: keep last 100 runs per automation
```

### Concurrency (`concurrency` field)

When a trigger fires and the prior run for that automation is still active:
- `skip` (default): drop the new fire, log it.
- `queue`: enqueue; start when the active run ends.
- `parallel`: start immediately alongside.

## The one core touch

The plugin cannot be fully self-contained for spawning. Two minimal core additions:

1. **`ServerPluginContext` spawn hook** — expose the shell's session-spawn machinery (today `handleSpawnSession` / `spawnPiSession`, gated by `PI_DASHBOARD_SPAWN_TOKEN`) to plugin server entries. Without this the plugin can't launch runs.

2. **`kind="automation"` session field** — add optional `kind?: "automation"` + `automationRun?: { name; runId }` to `DashboardSession` (shared). Core board/order filtering excludes `kind==="automation"`; the spawn path stamps it from `PI_DASHBOARD_AUTOMATION_RUN`. This is cross-cutting but small (type + event-wiring stamp + board filter + `.meta.json` persistence), and the user accepted this surface.

Everything else (scheduler, registry, run store, UI) lives entirely in `packages/automation-plugin/`.

## Model `@role` resolution

- `@fast` etc. resolved at **spawn time** (not save time) via the roles plugin (role → concrete provider/model from `~/.pi/agent/providers.json`). Keeps automations dynamic: reassign a role, every automation follows.
- Bare ids pass through unchanged.
- Editor: `ModelSelector.tsx` (direct) + role dropdown (`@`).

## Slot mapping

| Need | Slot | Component |
|---|---|---|
| "Automations (N) →" nav | `sidebar-folder-section` | `FolderAutomationSection` |
| board + run list (Triage) | `command-route` | `AutomationBoard` |
| watch a run live | `shell-overlay-route` | `AutomationRunMonitor` (wraps ChatView) |
| running indicator on card | `session-card-badge` | `AutomationBadge` (predicate) |
| scopes + retention config | `settings-section` (tab `general`) | `AutomationSettings` |
| Create Automation editor | shell action + dialog | `CreateAutomationDialog` |

## Decisions log

| # | Decision | Choice |
|---|---|---|
| 1 | core vs plugin | **plugin** (reversed from initial "core" after coherence check found extract-* direction) |
| 2 | scheduler ownership | **central**, server-owned |
| 3 | trigger scope phase 1 | **match Codex** — schedule only; registry seam built |
| 4 | action + model | **both** prompt+skill; model = direct id AND `@role` |
| 5 | run visibility | **configurable** (`visibility: hidden`\|`shown`), default hidden, set in automation settings + per-automation override; always **monitored** via ChatView in the Automation view |
| 6 | restart catch-up | **skip** |
| 7 | overlap | per-automation `concurrency` (skip default) |
| 8 | retention | prune, **keep last 100** |
| 9 | location | per-folder **and** global, both selectable; "Create Automation" button |

## Open risks

- **Spawn-hook security**: exposing spawn to plugins widens the plugin trust surface. Gate to first-party plugins (priority/trust) per existing loader policy.
- **Worktree sprawl**: frequent schedules in `mode: worktree` create many worktrees (Codex warns of this). Retention prune covers run records; worktree cleanup needs its own sweep (note for impl).
- **@role unresolvable at spawn** (role deleted): fall back to a configured default model + surface a run error, don't silently pick.
