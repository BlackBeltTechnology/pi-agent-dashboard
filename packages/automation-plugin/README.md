# @blackbelt-technology/pi-dashboard-automation-plugin

Schedule-triggered background agent runs for pi-dashboard — a Codex-Automations-style
capability built entirely on the dashboard shell slots (no core conditional rendering).

## What it does

- Reads automation definitions from disk in two scopes:
  - per-folder: `<repo>/.pi/automation/<name>/automation.yaml` (+ `prompt.md`)
  - global: `~/.pi/automation/<name>/automation.yaml`
- Runs a single server-owned scheduler that arms each automation's trigger
  (phase 1: `schedule` / cron only) through an extensible trigger registry.
- When a trigger fires, spawns a pi session stamped `kind="automation"` with the
  resolved model (`@role` or bare id), action (`prompt` | `skill`), `mode`, and `sandbox`.
- Runs are always watchable live in the Automation view (reusing `ChatView`); whether
  they also appear on the main board is governed by an effective `visibility`
  (per-automation override ?? settings default, default `hidden`).
- Run results land in `<scope>/.pi/automation/runs/<date>-<name>/result.md`. Empty
  runs auto-archive; the store keeps the last 100 runs per automation.

## Slots claimed

| Slot | Component | Purpose |
|---|---|---|
| `sidebar-folder-section` | `FolderAutomationSection` | "Automations (N) →" folder nav entry |
| `command-route` (`/automation`) | `AutomationBoard` | run list / Triage |
| `shell-overlay-route` | `AutomationRunMonitor` | live run transcript (wraps ChatView) |
| `session-card-badge` | `AutomationBadge` | running-automation indicator (predicate-gated) |
| `settings-section` (general) | `AutomationSettings` | scopes + retention + default visibility |

See `openspec/changes/add-automation-plugin/` for the full spec.
