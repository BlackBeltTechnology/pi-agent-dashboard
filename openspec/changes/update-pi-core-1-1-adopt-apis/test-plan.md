# Test Plan — update-pi-core-1-1-adopt-apis

Stage: design   Generated: 2026-10-11

No open clarifications.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | pi-core-version-check: lockstep floor | BVA | L1 | automated | `piCompatibility` min `1.1.0`, rec `1.1.0`; running `1.0.4` / `1.1.0` / `1.1.1` | `computeCompatibility()` | `1.0.4` → `error` naming `1.0.4` and `1.1.0`; `1.1.0` → no error, no hint; `1.1.1` → no error |
| E2 | pi-core-version-check: governed pins coherent | decision-table | L1 | automated | repo after the bump; then fixtures drifting one pin (pi-tui override `1.0.0`; a peer `>=1.0.0`; `minimum` `1.0.0`) | `verify-release-deps.mjs` / `pi-version-skew.test.ts` | coherent → pass; each drift → fail naming exactly that location |
| E3 | Node floor row for the new minimum | EP | L1 | automated | `piCompatibility.minimum = "1.1.0"` | `bundled-node-meets-pi-floor` lookup | row `{major:22, minor:19}` found; bundled Node satisfies it |
| E4 | below-floor session flag | BVA | L1 | automated | minimum `1.1.0`; reported `1.0.0` / `1.1.0` / undefined | server session update | flag only for `1.0.0`; card text names `1.0.0` and `1.1.0` |
| E5 | event-reducer: recorded duration wins | EP | L1 | automated | top-level row started at ts `1000`; `tool_execution_end` at ts `5000` with `durationMs:1200` | reduce | row `duration === 1200` |
| E6 | event-reducer: fallback to timestamps | EP | L1 | automated | same, no `durationMs` | reduce | `duration === 4000` |
| E7 | event-reducer: invalid durationMs ignored | EP | L1 | automated | `durationMs` = `-5`, `"1200"`, `null` | reduce | `duration === 4000` each time |
| E8 | event-reducer: nested events untouched | EP | L1 | automated | nested `tool_execution_end` (`parentToolCallId:"call_1/1"`) with `durationMs:50`, live span 300 | reduce | nested entry keeps its existing span rule (300); the root row's `duration` is unaffected |
| E9 | replay copies recorded duration | EP | L1 | automated | transcript with a toolResult message `durationMs:850` | `state-replay` synthesize → reduce | synthesized end carries `durationMs:850`; row `duration === 850` |
| E10 | burst total picks it up | EP | L1 | automated | two rows with recorded 1200 + 800, no start timestamps | `ToolBurstGroup` total | renders `2.0s` (sum of members) |
| E11 | sampling passthrough (bridge) | EP | L1 | automated | `models.json` model with `samplingParamsByThinkingLevel:{high:{temperature:0.2}}`; and one without | native-model re-registration | registered model carries the identical object; the other has no key |
| E12 | sampling passthrough (server registry) | EP | L1 | automated | same entries | internal registry build | same as E11 |
| E13 | Azure scan: locations | decision-table | L1 | automated | temp agent dir: `auth.json {"azure-openai-responses":{…}}`; `settings.json {defaultProvider:"azure-openai-responses/gpt-5", enabledModels:["azure-openai-responses/gpt-5","openai/gpt-6"], modelThinkingLevels:{"azure-openai-responses/gpt-5":"high"}}`; `models.json providers.azure-openai-responses` | `scanLegacyProviderIds()` | one entry; `locations` = `auth.json`, `settings.json:defaultProvider`, `settings.json:enabledModels`, `settings.json:modelThinkingLevels`, `models.json:providers` |
| E14 | Azure scan: boundary | EP | L1 | automated | `enabledModels:["azure-openai-responses2/gpt-5"]`; `defaultProvider:"azure"` | scan | empty list |
| E15 | Azure scan: API type not reported | EP | L1 | automated | `models.json providers.my-azure {api:"azure-openai-responses"}` | scan | empty list |
| E16 | Azure scan: no values serialized | EP | L1 | automated | `auth.json` value `{"key":"sk-SECRET-123"}` | scan → `JSON.stringify(result)` and the status response | neither contains `sk-SECRET-123` |
| E17 | Azure scan: honours PI_CODING_AGENT_DIR | EP | L1 | automated | `PI_CODING_AGENT_DIR` = temp dir with the old id; `~/.pi/agent` clean | scan via runtime `getAgentDir` | entry found in the temp dir |
| E18 | aborted forwarded and ignored | EP | L1 | automated | pi `agent_settled {aborted:true}` | bridge forward → server → client reduce | forwarded event has `aborted:true`; resulting status equals the `aborted:false` case |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Azure scan: corrupt file, no side effects | fault-injection | L1 | automated | `auth.json` = `{not json` | `scanLegacyProviderIds()` | no throw; nothing reported for `auth.json`; file byte-identical; directory listing unchanged (no `.corrupt-*`) |
| X2 | Azure scan: unreadable file | fault-injection | L1 | automated | `settings.json` mode `000` (skip on Windows) | scan | no throw; other files still scanned |
| X3 | Azure scan: missing files | fault-injection | L1 | automated | empty agent dir | scan | empty list |
| X4 | install with new pins | fault-injection | L2 | automated | clean checkout after the bump | `pnpm install --frozen-lockfile` then `node scripts/verify-release-deps.mjs` | both exit 0; one resolved copy of pi-coding-agent / pi-ai / pi-tui at 1.1.0 |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | provider-auth-ui: rename notice | state-transition | L1 | automated | status with `legacyProviderIds` (two locations); then a refresh returning `[]` | render `ProviderAuthSection` | notice with the word "Warning" (or icon + text), both locations, the fallback/prompt-cache consequence and the fix; gone after the refresh |
| F2 | provider-auth-ui: no notice | EP | L1 | automated | `legacyProviderIds` absent / `[]` | render | no notice node |
| F3 | docker smoke on 1.1.0 | state-transition | L3 | automated | docker harness built with the new Dockerfile pin | spawn a session, send a prompt with a tool call | session registers; `/api/health` reports pi `1.1.0`; tool row shows a duration |
| M1 | real Azure user migration | — | — | manual-only | a machine with an old `azure-openai-responses` login | open Settings → Providers | notice visible; after renaming the key and refreshing, the notice disappears |

## Coverage

| Requirement | Scenarios |
|---|---|
| pi-core-version-check (3 modified) | E1–E4, X4, F3 |
| event-reducer: recorded execution time | E5–E10 |
| provider-auth-server: legacy Azure id | E13–E17, X1–X3 |
| provider-auth-ui: rename notice | F1, F2, M1 |
| pi-api-feature-detection: audit + sampling passthrough | E11, E12, E18 |

## Exemplars

- E1, E4: `packages/server/src/__tests__/pi-version-skew.test.ts`
- E2: `scripts/__tests__/verify-release-deps-pi-coherence.test.mjs`
- E3: `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts`
- E5–E8: `packages/client/src/__tests__/event-reducer.test.ts`
- E9: `packages/shared/src/__tests__/state-replay.test.ts`
- E10: `packages/client/src/components/__tests__/ToolBurstGroup.test.tsx`
- E11: `packages/extension/src/__tests__/provider-register-native-models.test.ts`
- E12: `packages/server/src/model-proxy/__tests__/internal-registry.test.ts`
- E13–E17, X1–X3: `packages/server/src/__tests__/provider-auth-routes-corrupt.test.ts` and `build-auth-status.test.ts`
- E18: `packages/extension/src/__tests__/event-forwarder.test.ts`
- F1, F2: `packages/client/src/__tests__/ProviderAuthSection.test.tsx`
- X4: `qa/tests/01-install.sh`
- F3: `tests/e2e/mcp-session-token.spec.ts` (harness glue)

## New infra needed

None.
