## Why

The `pi-hermes-memory` extension is configured entirely through a hand-edited
`~/.pi/agent/hermes-memory-config.json` — there is no UI. Every knob (child-LLM
model override, background-review cadence, char limits, correction detection,
failure injection, flush behavior) is invisible unless the user knows the file
exists and knows the field names from the extension's TypeScript source. A
dashboard settings page makes the full config discoverable and editable in place,
writing the exact file the extension already loads.

## What Changes

- Add a new dashboard plugin package `packages/hermes-memory-plugin` that
  contributes a **settings-section** surface for hermes-memory configuration.
- Server entry registers two Fastify routes on the shared instance:
  - `GET /api/plugins/hermes-memory/config` — read the on-disk config file and
    return, for every `MemoryConfig` field: the **effective** value (user value
    when set, else the default), the **default** value, and an `isDefault` flag
    marking whether the field is currently unset on disk — plus the resolved
    file path and a file-level `exists` flag.
  - `PUT /api/plugins/hermes-memory/config` — validate the submitted config and
    atomically write it back to the file.
- Client settings component renders a grouped form covering **every** settable
  `MemoryConfig` field, including the four advanced correction-regex arrays
  (raw multiline text editors), plus a per-field **Reset to default** and a
  read-only **raw JSON** view.
- **Each field shows its current value; when a field is unset on disk, the form
  shows the resolved default value** and marks it as a default (e.g. a "default"
  badge) so the user can tell user-set fields apart from defaults.
- **On save the full resolved config is written** to the file (every field with
  its effective value), making the on-disk state explicit.
- Path resolution mirrors the extension exactly: `PI_CODING_AGENT_DIR` env when
  set, else `~/.pi/agent`, then `hermes-memory-config.json` — so the page edits
  the identical file the extension consumes.
- **No hermes API is used** (none exists): the extension only *reads* config via
  `loadConfig()` at load time and exposes no config read/write command, tool,
  `provide()`, or HTTP route — and it is an external published package, not
  modifiable here. The on-disk file is therefore the sole interface, and the
  plugin re-declares the `MemoryConfig` shape + defaults in its shared module.
- Surface a **"applies to new sessions"** notice: hermes reads config at
  extension load, so edits do not hot-reload running sessions.
- The plugin declares `requires.piExtensions: ["pi-hermes-memory"]` so it only
  activates when the extension is installed.

## Discipline Skills

- `security-hardening` — the PUT route accepts browser-supplied JSON and writes
  it to a file on the server host; must validate the schema, reject unknown/
  unsafe fields, resolve the path without traversal, and write atomically.
- `observability-instrumentation` — two new HTTP endpoints need structured
  request/error logging so a failed read/write is diagnosable.
- `review-code` — non-trivial new package (server routes + client form + tests)
  reviewed before commit.

## Capabilities

### New Capabilities
- `hermes-memory-settings`: A dashboard-plugin surface that reads and writes the
  `pi-hermes-memory` extension's on-disk configuration file through validated
  server routes and a full-coverage settings form.

### Modified Capabilities
<!-- none — this is a self-contained new plugin; no existing spec requirements change. -->

## Impact

- **New package**: `packages/hermes-memory-plugin` (client + server + shared),
  added to the workspace and the generated plugin registry.
- **New HTTP routes**: `GET`/`PUT /api/plugins/hermes-memory/config` registered
  via the plugin server context's `fastify` instance.
- **Filesystem**: reads/writes `~/.pi/agent/hermes-memory-config.json` on the
  host where the dashboard server runs (same host as pi; correct for local +
  docker).
- **No change** to the `pi-hermes-memory` extension itself — it is not a
  dependency; the `MemoryConfig` shape + defaults are re-declared in the plugin's
  shared module (mirrors how `goal-plugin` treats `pi-goal-hermes`).
- **Runtime caveat**: config changes apply to newly started sessions, not
  already-running ones.
