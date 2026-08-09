## Why

The `pi-blackhole` extension (algorithmic compaction + observational memory) keeps every setting in one JSON file and its per-session pipeline state in another, but both are only reachable from inside a pi TUI session via `/blackhole configure` and `/blackhole-memory`. From the dashboard a user cannot see whether a session's memory workers are healthy, whether a model has fallen back to a cooling-down alternative, whether unflushed batches are waiting in manual mode, or how close a session is to compaction — nor change any of it.

Two facts make this cheap to fix now. First, blackhole re-reads its config from disk after every write, so a dashboard save applies immediately to running sessions with no restart. Second, `MEMORY` is an already-reserved session-card subcard whose `session-card-memory` slot has **no claimant** — the socket exists and is empty.

## What Changes

- **New package** `packages/blackhole-plugin/` — a pi-dashboard plugin, id `blackhole`, gated on `requires.piExtensions: ["pi-blackhole"]` so it stays invisible unless the extension is installed.
- **Global configuration surface** via a `settings-section` claim: reads/writes `~/.pi/agent/pi-blackhole/pi-blackhole-config.json` through validated `GET`/`PUT /api/plugins/blackhole/config` routes. Grouped accordion form covering the scalar keys, plus an ordered fallback-chain editor for the `observer`/`reflector`/`dropper` worker models and the base `model`.
- **Per-session pipeline surface** via a `session-card-memory` claim: a compact strip showing worker health pips, exact cursor lag, an explicitly-approximate compaction-proximity meter, and — only when abnormal — a degraded/pending note. Reads `~/.pi/agent/pi-blackhole/<sessionId>-pending.json` and `pi-blackhole-cooldown.json` through a `GET /api/plugins/blackhole/session/:id` route.
- **Drill-in detail** via a `content-view` claim: worker cursors, resolved model per worker, and why each resolved that way.
- Config type is **re-declared, not imported** — the plugin takes no dependency on the `pi-blackhole` package, mirroring `hermes-memory-plugin` (D3) and `goal-plugin`. A `SOURCE-VERSION PIN` comment plus a drift test guard the copy.
- **Not included**: observation/reflection counts, in-flight flags, and last-error strings. These exist only in the running session's memory (`StatusInfo`) and are never persisted; surfacing them would require bridge forwarding and is deliberately out of scope.
- **Included with a stated caveat**: the compaction-proximity meter. Blackhole's own counter (`rawTokensSinceLastCompaction`) is in-memory only, so the meter uses the dashboard's `contextTokens` as a proxy. The two are **different quantities**, not two estimates of one quantity — measured on a real session they differed by 299k tokens with the proxy reading *lower*, the opposite of the naive expectation. The meter is therefore specified as an explicit approximation, is barred from driving definite claims, and is rendered alongside an exact cursor-lag figure.

## Capabilities

### New Capabilities

- `blackhole-plugin-settings`: The global configuration surface — config file discovery, read/validate/write semantics, unknown-key preservation, invalid-JSON fail-closed behaviour, and the fallback-chain editing contract.
- `blackhole-plugin-session-pipeline`: The per-session surface — the `session-card-memory` contribution, its states (healthy, degraded, workers-off, pending-unflushed, no-activity-yet), the session-id join to blackhole's per-session file, and the `content-view` drill-in.

### Modified Capabilities

<!-- None. `dashboard-shell-slots` already reserves `session-card-memory` with the
     required multiplicity and payload tier; `session-card-subcards` already
     specifies that the MEMORY subcard renders when a plugin claims that slot;
     `dashboard-plugin-loader` already specifies `settings-section` claim routing
     and `requires.piExtensions` gating. This change is a new consumer of
     existing contracts, not a change to them. -->

## Impact

**New code**
- `packages/blackhole-plugin/` — manifest, `src/client/` (settings form, chain editor, subcard, drill-in), `src/server/` (config + session routes), `src/shared/` (re-declared config type, field descriptors, validator), `src/configSchema.json`, `src/i18n.ts`.

**Files read/written at runtime** (all under `~/.pi/agent/pi-blackhole/`)
- `pi-blackhole-config.json` — read + write. Read-modify-write; unknown keys preserved.
- `pi-blackhole-cooldown.json` — read only.
- `<sessionId>-pending.json` — read only.

**Existing code**
- No changes to `packages/client/`, `packages/server/`, `packages/shared/`, or `packages/extension/`. Both slots and both claim types already exist and are consumed.
- Workspace registration only: root `package.json` / `pnpm-workspace.yaml` if the package list is enumerated.

**Dependencies**
- No dependency on `pi-blackhole` (npm or git). Runtime coupling is the filesystem plus the `requires.piExtensions` activation gate.

**Verified assumptions and measurements**
- `DashboardSession.id` is pi's own session id — both `packages/extension/src/bridge.ts` and pi-blackhole call `ctx.sessionManager.getSessionId()`. Measured across 3,260 dashboard sessions: 100% of live sessions and 100% of sessions that ever produced a transcript match a pi session file. The join key is sound.
- Blackhole hot-reloads config after every successful write, so saved changes reach running sessions without a restart.
- The dashboard's `contextTokens` (provider `usage.totalTokens`, includes system prompt + tool schemas + injected memory) and blackhole's `rawTokensSinceLastCompaction` (locally estimated sum over transcript entries after the last compaction's `firstKeptEntryId`) are not convertible. Measured on a live 255-entry session: 283,622 vs 583,047 — a 2× divergence whose sign is opposite to the intuitive one, because pi elides history before sending. No offset or scale factor reconciles them.

**Risks**
- *Config drift* (accepted, mirrors hermes D-R1): the re-declared type can fall behind a blackhole release. Mitigated by a `SOURCE-VERSION PIN` comment and a test asserting the known-key set still covers blackhole's published `example-config.json`.
- *Destructive write*: a naive serialize-and-replace would drop `_comment`/`_notes` and any key the form doesn't manage. Mitigated by a mandated read-modify-write and a fail-closed rule on unparseable input.
- *QA gating*: `requires.piExtensions` hides the plugin unless `pi-blackhole` is installed, so local verification needs it present.
- *Approximate meter misread as exact* (accepted, deliberately): a user could act on the proximity meter as though it were blackhole's real counter. Mitigated by mandatory approximation marking, a coarse rather than precise readout, a ban on threshold-triggered calls-to-action, and an adjacent exact cursor-lag figure. The clean fix is upstream — if blackhole persisted its counter into the per-session file it already maintains, the meter becomes exact with no dashboard change.

## Discipline Skills

- `security-hardening` — the `PUT /api/plugins/blackhole/config` route accepts untrusted input and writes a file that controls which models run and where; the validator is the security boundary.
- `review-code` — non-trivial multi-surface change across client, server, and shared.
- `scenario-design` — the value is concentrated in state coverage (invalid JSON, missing pending file, cooling model, manual-mode pending, workers off), not the happy path.
- `observability-instrumentation` — two new server routes reading external files that may be absent or malformed.
