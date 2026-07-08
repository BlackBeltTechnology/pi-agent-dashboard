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

## Run finalization + concurrency

A run finalizes on the first of: `agent_end`, its action-declared completion
event, an explicit Stop, its session dying (connection close / heartbeat
timeout, no reconnect), or the stale-run reaper. Finalization is idempotent —
later signals are no-ops. A headless `kind="automation"` session is one-shot and
never reconnects, so a WebSocket close is treated as terminal immediately (no
reconnect-grace wait). See change: finalize-automation-run-on-session-death.

- **Session-death finalize (primary):** a run whose session ends before a
  terminal event is finalized once — with its buffered result if any, else
  `error` ("session ended before completion") — and its concurrency slot freed.
- **Stale-run reaper (backstop):** any run stuck `running` past `maxRunAgeMs`
  (plugin config, default 30 min; `<= 0` disables) is finalized `error` and its
  slot freed. Also clears pre-existing on-disk `running` orphans on first sweep.
- **`concurrency: skip` amplifier:** a code-only `flows.run` automation can
  finish + tear down its session in the same tick its terminal event is
  forwarded. Before the session-death finalize, a lost terminal event left the
  run `running` forever and `skip` dropped every later fire. Operator stopgap:
  set `concurrency: queue|parallel` so the next fire self-heals the schedule —
  it masks the freeze but leaves the orphaned record for the reaper.

## Slots claimed

| Slot | Component | Purpose |
|---|---|---|
| `sidebar-folder-section` | `FolderAutomationSection` | "Automations (N) →" folder nav entry |
| `command-route` (`/automation`) | `AutomationBoard` | run list / Triage |
| `shell-overlay-route` | `AutomationRunMonitor` | live run transcript (wraps ChatView) |
| `session-card-badge` | `AutomationBadge` | running-automation indicator (predicate-gated) |
| `settings-section` (general) | `AutomationSettings` | scopes + retention + default visibility |

See `openspec/changes/add-automation-plugin/` for the full spec.
