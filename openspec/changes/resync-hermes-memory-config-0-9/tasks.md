## 1. Tests first (red)

- [ ] 1.1 Add `src/shared/__tests__/fixtures/hermes-0.9.10-fields.json` (44 `MemoryConfig` keys + defaults extracted from `pi-hermes-memory@0.9.10` `src/types.ts`/`src/config.ts`/`src/constants.ts`) and a drift-guard test asserting `KNOWN_KEYS` equals it
- [ ] 1.2 Validator tests: `llmThinkingOverride: "max"` passes; each new field rejects wrong type / out-of-bound value (`consolidationChunkChars` ≥ upstream `CONSOLIDATION_CHUNK_CHARS_MIN`, timeouts/days non-negative, `llmFallbackModels` string array)
- [ ] 1.3 `config-io` test: on-disk unknown key (`futureHermesKey`) survives a PUT; PUT body with unknown key still 400 and file unchanged
- [ ] 1.4 GET test: `consolidationTimeoutMs` default 180000

## 2. Implementation

- [ ] 2.1 `src/shared/hermes-config.ts`: add 12 fields to `MemoryConfig`, descriptors, `DEFAULTS`; add `"max"` to thinking enum; `consolidationTimeoutMs` default 180000; bump SOURCE-VERSION PIN to 0.9.10
- [ ] 2.2 `src/server/config-path.ts`: bump SOURCE-VERSION PIN to 0.9.10 (`paths.ts` unchanged upstream)
- [ ] 2.3 `src/server/config-io.ts`: `writeResolvedConfig` merges validated known fields over the on-disk object (unknown on-disk keys preserved); atomic write unchanged
- [ ] 2.4 `src/client/field-groups.ts` + i18n catalog: place the 12 fields in their groups with label/description
- [ ] 2.5 Update `AGENTS.md` rows (`shared/`, `server/`, `client/`) with `See change: resync-hermes-memory-config-0-9`

## 3. Verify

- [ ] 3.1 `npm test -- packages/hermes-memory-plugin` green
- [ ] 3.2 `security-hardening` pass over the PUT validator + merge path
- [ ] 3.3 `review-code` before commit
- [ ] 3.4 Manual: set `lazyInitialization: true` by hand, save another field from the dashboard, confirm key retained
