## Why

`packages/hermes-memory-plugin` re-declares the external `pi-hermes-memory`
`MemoryConfig` + `DEFAULT_CONFIG` instead of depending on the package (design
D3 of `add-hermes-memory-settings-plugin`), pinned to `pi-hermes-memory@0.8.1`.
The recommended extension installs `npm:pi-hermes-memory` at latest — now
**0.9.10** — and the accepted drift risk (D-R1) has materialised:

- **12 fields missing** from the plugin: `lazyInitialization`,
  `flushCompactTimeoutMs`, `quickCheckOnOpen`, `llmFallbackModels`,
  `overflowGraceMs`, `consolidationChunking`, `consolidationChunkChars`,
  `usageHitTrackingEnabled`, `consolidationUsageSignals`,
  `autoConsolidationWarnOnFailure`, `standingInstructionsEnabled`,
  `sessionRetentionDays`.
- **Enum drift**: upstream `ThinkingLevel` = pi-ai `ModelThinkingLevel`, which
  adds `"max"`; the PUT validator rejects `llmThinkingOverride: "max"`.
- **Default drift**: `consolidationTimeoutMs` default 60000 → 180000.
- **Data loss (worst)**: `readEffectiveConfig` builds `raw` from `KNOWN_KEYS`
  only and `PUT` writes that object over the whole file. Saving from the
  dashboard silently **deletes** every on-disk key the plugin does not know —
  today all 12 fields above, and any future upstream field.

## What Changes

- Re-mirror `MemoryConfig`, field descriptors, enums and `DEFAULTS` in
  `src/shared/hermes-config.ts` from `pi-hermes-memory@0.9.10`
  (`src/types.ts`, `src/config.ts`, `src/constants.ts`); bump the
  SOURCE-VERSION PIN comments in `hermes-config.ts` + `server/config-path.ts`
  (`paths.ts` unchanged 0.8.1 → 0.9.10 — pin bump only).
- Add the 12 fields to the settings form (`client/field-groups.ts`) with
  labels/descriptions + i18n catalog entries.
- Accept `"max"` for `llmThinkingOverride`.
- **Preserve unknown on-disk keys on write**: PUT merges the validated body
  over the on-disk object so keys outside `KNOWN_KEYS` survive a save. The PUT
  *body* unknown-key rejection stays (security boundary unchanged).
- Add a drift-guard test: a checked-in fixture of the upstream field list
  (0.9.10) asserted equal to `KNOWN_KEYS`, so the next re-mirror is a
  deliberate, reviewed diff.

No dependency on `pi-hermes-memory` is added (D3 stands).

## Discipline Skills

- `security-hardening` — the PUT validator is the write boundary for a file
  the hermes extension trusts; new fields need type/bound checks, and the
  merge-preserve path must not let a body smuggle keys past validation.
- `review-code` — before commit.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `hermes-memory-settings`: write preserves unknown on-disk keys; field set +
  defaults track `pi-hermes-memory@0.9.10`.

## Impact

- Code: `packages/hermes-memory-plugin/src/{shared/hermes-config.ts,
  server/config-io.ts, server/config-path.ts, client/field-groups.ts,
  client/settings-model.ts}`, i18n catalog, tests.
- No server/protocol change outside the plugin; no migration — the config file
  format is owned by hermes and only gains preserved keys.
- Rollback: revert the commit; files written by the new code remain valid for
  the old plugin (old plugin would again drop unknown keys on its next save).
