# @blackbelt-technology/pi-dashboard-context-mode-settings-plugin

Dashboard settings surface for the [`context-mode`](https://www.npmjs.com/package/context-mode)
pi extension, which is otherwise tuned only through environment variables.

- Persists settings to the fixed file `~/.pi/context-mode/settings.json`, keyed by
  **logical, engine-neutral keys** (`search.windowMs`, `fetch.strict`, …) — never env-var names.
- `GET|PUT /api/plugins/context-mode-settings/config` — effective value + default + `isDefault`
  per key; PUT validates every key before an atomic write (400 with one error per bad key).
- A single descriptor table (`src/shared/settings-descriptors.ts`) drives validation, the form
  and the env projection. The `env` column is the only context-mode-specific part.
- **Dashboard-spawned sessions** get all settings (storage + runtime scope) through the host's
  spawn-env contributor hook, read fresh at every spawn.
- **Terminal-launched sessions** get *runtime-scope* settings through the plugin's bridge entry,
  which sets absent env vars before context-mode starts its tool server. Storage-scope keys are
  spawn-only: context-mode opens its stores at its own load, so late delivery would split them.
- An already-exported variable always wins (the form says so).

Declares `requires.piExtensions: ["context-mode"]` (status report, not a hard gate).
Rollback: disable the plugin and delete `~/.pi/context-mode/settings.json`.

See change: `add-context-mode-settings-plugin`.
