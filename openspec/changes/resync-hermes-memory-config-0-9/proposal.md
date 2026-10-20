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
- **Data loss (worst)**: the client's `buildResolvedConfig` emits `KNOWN_KEYS`
  only and `PUT` writes that body verbatim over the whole file. Saving from the
  dashboard silently **deletes** every on-disk key the plugin does not know —
  today all 12 fields above, and any future upstream field.

## What Changes

- Re-mirror `MemoryConfig`, field descriptors, enums, bounds and `DEFAULTS` in
  `src/shared/hermes-config.ts` from `pi-hermes-memory@0.9.10`
  (`src/types.ts`, `src/config.ts`, `src/constants.ts`); bump the
  SOURCE-VERSION PIN comments in `hermes-config.ts` + `server/config-path.ts`
  (`paths.ts` verified byte-identical 0.8.1 → 0.9.10 — pin bump only).
- Add the 12 fields to the settings form (`client/field-groups.ts`) with
  labels/descriptions (presentation data, like every existing field — not
  i18n keys; design D8).
- Accept `"max"` for `llmThinkingOverride`.
- **Preserve unknown on-disk keys on write**: the written file = on-disk keys
  outside `KNOWN_KEYS` + the validated body. Known keys come from the body
  only, so a cleared/reset override stays absent (design D1). The PUT *body*
  unknown-key rejection stays (security boundary unchanged).
- **Stop pinning defaults**: a submitted known field equal to its default is
  omitted from the file (except `memoryOverflowStrategy`, kept authoritative),
  so upstream default changes reach users; a one-time heal drops the legacy
  pinned `consolidationTimeoutMs: 60000` from 0.8.1-era write-all files
  (design D1, D6).
- **Corrupt file safety**: an unreadable file → 500, no write; a malformed
  (non-object JSON) file is quarantined to `*.corrupt-<stamp>` (repo
  convention, as for `auth.json`) before being overwritten (design D3).
- GET `raw` and the raw-JSON dialog also show preserved unknown keys (design D4).
- GET mirrors two upstream derivations so a no-touch save never changes the
  effective config: strategy-absent `autoConsolidate` → derived
  `memoryOverflowStrategy`; array-form `llmModelOverride` → primary + fallbacks
  (design D1, D9).
- Unreadable file → GET/PUT 500 with `{ error, code }` (design D3).
- Drift guard: a checked-in 0.9.10 fixture (keys + defaults) replaces the
  inline `EXPECTED_KEYS` list; a local-only test (skipped when hermes is not
  installed) compares it to the installed upstream `MemoryConfig` (design D5).

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
  defaults track `pi-hermes-memory@0.9.10`; default-valued fields are
  omitted on write; GET `raw` includes preserved unknown keys.

## Impact

- Code: `packages/hermes-memory-plugin/src/{shared/hermes-config.ts,
  server/config-io.ts, server/config-path.ts, client/field-groups.ts}`, tests.
  `client/settings-model.ts` needs no change (iterates `KNOWN_KEYS`).
- No server/protocol change outside the plugin; no migration beyond the one-shot
  `consolidationTimeoutMs` heal (design D6) — the file format is owned by hermes.
- Rollback: revert the commit; files written by the new code stay readable by
  the old plugin (it would again drop unknown keys and pin defaults on its next
  save; a file holding `llmThinkingOverride: "max"` makes its validator 400
  until hand-edited).
