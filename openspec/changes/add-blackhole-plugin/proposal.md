## Why

> **Scope note.** This change ships the **global settings surface** only. The per-session pipeline surface was split into `add-blackhole-session-pipeline` after five doubt-review cycles found its visibility gate blocked on a platform gap; that change carries the blocker and the five-mechanism post-mortem.

The `pi-blackhole` extension (algorithmic compaction + observational memory) keeps every setting in a single JSON file that is only editable from inside a pi TUI session via `/blackhole configure`. From the dashboard a user cannot change the compaction mode or thresholds, and cannot see or edit the per-worker model fallback chains at all — the chains are the most intricate part of the configuration and have no surface outside that overlay.

One fact makes this cheap: blackhole re-reads its config from disk after every write, so a dashboard save reaches running sessions with no restart. The filesystem is the entire integration surface.

## What Changes

- **New package** `packages/blackhole-plugin/` — a pi-dashboard plugin, id `blackhole`. It declares `requires.piExtensions: ["pi-blackhole"]` for the Packages-page install prompt. An unsatisfied `requires` does NOT deactivate a plugin (design D3), so the settings component renders its own not-installed state rather than relying on the host to withhold it.
- **Global configuration surface** via a `settings-section` claim: reads/writes `~/.pi/agent/pi-blackhole/pi-blackhole-config.json` through validated `GET`/`PUT /api/plugins/blackhole/config` routes. Grouped accordion form covering the scalar keys, plus an ordered fallback-chain editor for the `observer`/`reflector`/`dropper` worker models and the base `model`.
- Config type is **re-declared, not imported** — the plugin takes no dependency on the `pi-blackhole` package, mirroring `hermes-memory-plugin` (D3) and `goal-plugin`. A `SOURCE-VERSION PIN` comment plus a drift test guard the copy.
- **Not included**: any per-session surface. The `session-card-memory` claim, the `content-view` drill-in, the per-session route and the compaction-proximity meter all moved to `add-blackhole-session-pipeline`.

## Capabilities

### New Capabilities

- `blackhole-plugin-settings`: The global configuration surface — config file discovery, read/validate/write semantics, unknown-key preservation, invalid-JSON fail-closed behaviour, and the fallback-chain editing contract.

### Modified Capabilities

<!-- None. `dashboard-plugin-loader` already specifies `settings-section` claim
     routing and `requires.piExtensions` handling. This change is a new consumer
     of an existing contract, not a change to it. Verified across five adversarial
     review cycles. -->

## Impact

**New code**
- `packages/blackhole-plugin/` — manifest, `src/client/` (settings form, chain editor), `src/server/` (config routes), `src/shared/` (re-declared config type, field descriptors, validator), `src/configSchema.json`, `src/i18n.ts`. The package is scaffolded here and extended by `add-blackhole-session-pipeline`.

**Files read/written at runtime** (all under `~/.pi/agent/pi-blackhole/`)
- `pi-blackhole-config.json` — read + write. Read-modify-write; unknown keys preserved.
- `pi-blackhole-cooldown.json` — read only (surfaced as model cooldown state in the settings form).

**Existing code**
- No changes to `packages/client/`, `packages/server/`, `packages/shared/`, or `packages/extension/`. The `settings-section` slot already exists and is consumed; the not-installed state is rendered by the plugin's own component rather than by changing the host.
- Workspace registration only: root `package.json` / `pnpm-workspace.yaml` if the package list is enumerated.

**Dependencies**
- No dependency on `pi-blackhole` (npm or git). Runtime coupling is the filesystem; `requires.piExtensions` only drives the Packages-page install prompt.

**Verified assumptions and measurements**
- Blackhole hot-reloads config after every successful write, so saved changes reach running sessions without a restart. Observed on the pinned version; not a dashboard guarantee.
- Blackhole resolves its agent directory from `PI_CODING_AGENT_DIR` (`src/pi-base/paths.ts`), so dashboard path resolution can mirror it, as `hermes-memory-plugin` mirrors hermes'.
- An unsatisfied `requires.piExtensions` does **not** deactivate a plugin or drop its claims (`loader.ts`). Assumed and false in the original draft; corrected in D3.

> Session-id and token-accounting measurements moved with the per-session surface to `add-blackhole-session-pipeline`, which is where they are load-bearing.

**Risks**
- *Config drift* (accepted, mirrors hermes D-R1): the re-declared type can fall behind a blackhole release. Mitigated by a `SOURCE-VERSION PIN` comment and a test asserting the known-key set still covers blackhole's published `example-config.json`.
- *Destructive write*: a naive serialize-and-replace would drop `_comment`/`_notes` and any key the form doesn't manage. Mitigated by a mandated read-modify-write and a fail-closed rule on unparseable input.
- *QA gating*: verification of the populated form needs `pi-blackhole` installed locally; the not-installed and parse-error states are verifiable without it.
- *Cross-process config race*: blackhole writes the same config file. Read-modify-write narrows but does not close the window; simultaneous TUI and dashboard edits can lose one. Accepted — no file lock exists.

## Discipline Skills

- `security-hardening` — the `PUT /api/plugins/blackhole/config` route accepts untrusted input and writes a file that controls which models run and where; the validator is the security boundary.
- `review-code` — non-trivial change spanning client, server and shared modules.
- `scenario-design` — the value is concentrated in state coverage (invalid JSON, absent file, unknown-key preservation, chain reordering, concurrent write), not the happy path.
- `observability-instrumentation` — new server routes reading an external file that may be absent or malformed.
- `doubt-driven-review` — already applied; five cycles, 24 findings, all reconciled.
