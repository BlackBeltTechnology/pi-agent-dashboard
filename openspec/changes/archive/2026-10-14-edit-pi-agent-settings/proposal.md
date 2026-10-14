## Why

The dashboard has TWO "default model" settings that never meet: its own `defaultModel` /
`defaultThinkingLevel` in `~/.pi/dashboard/config.json` (Settings → Sessions), and pi's own
`defaultProvider` / `defaultModel` / `defaultThinkingLevel` in `~/.pi/agent/settings.json`, which
no dashboard surface shows. The bridge applies the dashboard default only to brand-new spawned
sessions, so anything pi creates itself — SDK child sessions (subagents), plain `pi` runs —
silently uses pi's file. Observed: Settings showed `claude-opus-5-5` while subagents ran
`claude-opus-5`. Beyond the default model, every other pi setting (compaction, steering mode,
project trust, …) is editable only by hand-editing JSON on the host, which a remote/mobile
dashboard user cannot do. Only the `retry` block has an editor today (`pi-retry-settings`).

## What Changes

- **Mirror the default model into pi.** Saving a changed dashboard `defaultModel` SHALL also write
  pi's `defaultProvider` + `defaultModel` (split from `provider/id`); saving a changed
  `defaultThinkingLevel` SHALL write pi's `defaultThinkingLevel`. Clearing the dashboard value
  leaves pi's keys untouched. A mirror that cannot be applied is shown as a warning, never hidden,
  and an explicit "Apply dashboard default to pi" action repairs drift that already exists.
- **New "pi settings" editor on Settings → Sessions** (below the retry editor) for the GLOBAL
  `~/.pi/agent/settings.json`:
  - **Typed form** for a curated set of common pi settings (compaction, branch summary, steering /
    follow-up mode, default project trust, thinking-block visibility, quiet startup). The pi
    default-model keys are shown read-only, labelled as mirrored from the Default model control.
  - **Raw JSON editor** (Monaco, already a client dependency) for the whole file, so every key —
    including ones the dashboard does not know about — is reachable.
  - Both commit through the existing unified Settings Save; no private Save button.
- **Safe writes.** Every write is merge-preserving for the typed form, validated (must parse as a
  JSON object; known keys type-checked against pi's `Settings` shape), guarded by optimistic
  concurrency (stale base → `409`, nothing written), and taken under the same `proper-lockfile`
  lock pi's own `SettingsManager` uses, so dashboard and pi writes never interleave.
- **Apply to running sessions** the same way the retry editor does: reload connected sessions
  after a successful write (pi reads settings only at session construction).
- The project-scoped `<cwd>/.pi/settings.json` is NEVER written by this change.

## Capabilities

### New Capabilities
- `pi-agent-settings-editor`: GLOBAL pi `settings.json` (honouring `PI_CODING_AGENT_DIR`) read/write API (typed + raw),
  validation, optimistic concurrency, lock-coordinated writes, session reload, and the Settings →
  Sessions editor UI (typed form + raw JSON).

### Modified Capabilities
- `settings-panel`: the Default model / default thinking level controls additionally mirror their
  saved values into pi's global settings; the Sessions page section order gains "pi settings (global)"
  after Retry.
- `pi-retry-settings`: retry saves take pi's settings lock (`503` when held), refuse an unparseable
  file, and preserve unrelated keys' values (deep-equal) rather than their exact bytes.

## Impact

- **Server:** `packages/server/src/pi-agent-settings.ts` (extend: generic read/merge/raw write,
  lock, hash), new `packages/server/src/routes/pi-settings-routes.ts`, `routes/system-routes.ts`
  `PUT /api/config` (mirror hook), `routes/pi-retry-routes.ts` (`503` on a held lock), `server.ts`
  route registration.
- **Shared:** `packages/shared/src/rest-api.ts` request/response types.
- **Client:** new `packages/client/src/components/settings/PiSettingsSection.tsx`, `SettingsPanel.tsx`
  (mount + unified-save wiring), i18n strings.
- **APIs:** new `GET /api/pi-settings`, `PUT /api/pi-settings` (typed patch), `PUT
  /api/pi-settings/raw`, `POST /api/pi-settings/sync-defaults`; all behind the existing
  `networkGuard` like `/api/config` and `/api/pi-retry`. `PUT /api/config` responses gain an
  optional `piMirror` field.
- **Compatibility:** additive. `/api/pi-retry` now takes the shared lock, answers `503` when it is
  held, and refuses (instead of silently overwriting) an unparseable `settings.json` — delta on
  `pi-retry-settings`.
  `settings.json` keeps pi's format; unknown keys survive. No migration.
- **Rollback:** revert the change; `settings.json` stays valid JSON in pi's shape (whitespace, key
  order, and BOM are not preserved by dashboard writes), so nothing needs undoing on disk.
- **Security:** the raw editor can set code-executing keys (`packages`, `extensions`, `shellPath`,
  `shellCommandPrefix`, `npmCommand`). The dashboard already exposes equivalent capability
  (package install, terminals) behind the same guard; this change adds no weaker path, but it is
  reviewed under `security-hardening`.

## Discipline Skills

- `security-hardening` — raw writes of a host config file that holds code-executing keys,
  reachable over the network behind `networkGuard`.
- `doubt-driven-review` — writes the user's global pi config; a bad write breaks every pi start.
- `observability-instrumentation` — new endpoints and a new write path (log write/conflict/reload
  outcomes).
- `review-code` — before commit.
