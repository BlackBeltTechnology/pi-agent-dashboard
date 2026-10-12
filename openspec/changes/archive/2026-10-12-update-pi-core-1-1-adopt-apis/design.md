## Context

- Governed pins today:
  - `packages/server/package.json:19-20` (`piCompatibility` `1.0.0`/`1.0.0`) and `:74` (`^1.0.0`);
  - root `package.json` peers and devDependencies;
  - `pnpm-workspace.yaml:55-57` (overrides `1.0.0`) and `:114-124` (`minimumReleaseAgeExclude`);
  - `docker/Dockerfile:116`;
  - `scripts/verify-release-deps.mjs:54` (pi entry), `:77` (`minVersion: "1.0.0"`).

  Pin-encoding fixtures: `packages/server/src/__tests__/pi-version-skew.test.ts:28` (`PINNED_PI`), `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts:37-57,96-104` (exact-key `PI_MIN_TO_NODE_FLOOR`, which throws without a row), `scripts/__tests__/verify-release-deps-pi-coherence.test.mjs:20`. The coherence rule lives in `pi-core-version-check`.
- Runtime (operator-machine observation, environment-dependent): dashboard sessions here spawn the nvm-global pi 1.1.0 (`PI_KEEPER_PI_CMD`).
- pi 1.0.0 → 1.1.0 manifests:
  - `@earendil-works/*` sibling ranges move to `^1.1.0` (pi-agent-core, pi-ai, pi-tui, pi-codemode, pi-mcp, chord);
  - `brace-expansion@5.0.12` becomes direct;
  - engines `>=22.19.0` and `typebox 1.3.27` are unchanged;
  - pi-ai `exports` keys are unchanged.

  Extension types diff additively only.
- OAuth registry: `ModelRuntime.create({}).getProviders()` gives the same 9 OAuth ids on 1.0.0 and 1.1.0 (executed against both during planning; recorded in `evidence.md`). The only provider-id change is `azure-openai-responses` → `azure`. `KnownApi` still lists `azure-openai-responses` as an API type (`pi-ai/dist/types.d.ts:15`).
- Tool duration today:
  - Top-level end: `packages/client/src/lib/chat/event-reducer.ts:2638` sets `duration = event.timestamp - msgStartedAt`. Nested events branch off earlier (`isNestedToolEvent`, `:2556`).
  - Live nested ends compute their own span (`packages/client/src/lib/chat/nested-tool-calls.ts:125`); the recorded value is read on replay (`:162,174,190`).
  - Replay synthesizes `tool_execution_end` from tool-result messages in `packages/shared/src/state-replay.ts:180-192`, copying `nestedCalls`.
  - pi-ai 1.1.0 `ToolResultMessage.durationMs` is stored in the session file.
- Status, unread and push: `agent_end` → `status: "idle"` (`packages/server/src/session/event-status-extraction.ts:94-95`). Unread trigger 1 is the streaming→idle edge (`:282-286`), stamped by `stampUnreadIfTriggered` (`packages/server/src/event-wiring.ts:780-788`), which drives push. `agent_settled` arrives later.
- Credential reads: `readAuthJson` (`packages/server/src/auth/provider-auth-storage.ts:104-109`) goes through `readJsonChecked`, which quarantines corrupt content by **writing** `auth.json.corrupt-<stamp>` (`packages/server/src/auth/locked-json-file.ts:196-219`) and rethrows non-ENOENT errors. `tryReadJson` (`locked-json-file.ts:267`) has no side effects.
- Sampling passthrough: the bridge re-registers `models.json` models, carrying `samplingParams` (`packages/extension/src/provider-register.ts:80,264`; `packages/shared/src/models-json-reader.ts:43`; `packages/server/src/model-proxy/internal-registry.ts:46,108,321`). pi 1.0.2 added `samplingParamsByThinkingLevel` (`dist/core/model-config.d.ts:52`).

## Goals / Non-Goals

**Goals:** lockstep pin and floor at 1.1.0; recorded tool durations; no loss of `samplingParamsByThinkingLevel`; a visible signal for the Azure rename; an honest audit record.

**Non-Goals:** consuming `agent_settled.aborted`; moving unread/push to the settle edge; managed-installer discovery; rewriting user config files; MODIFYING live requirements that use "pi 1.0.0" as a version anchor where behaviour is verified identical on 1.1.0 (`provider-auth-server` registry / handler-id / Radius, `command-routing` `expandPromptTemplates`, `nano-banana-pi-backend` ≥ 1.0.0 gate). These stay true under a 1.1.0 floor and are justified in `evidence.md`, following the 1.0 bump's precedent for historical anchors.

## Decisions

**D1: Floor = pin = 1.1.0 (lockstep).** Fixtures move first. This also covers `spawn-scope-no-mcp`'s `--no-mcp` precondition (≥ 1.0.4).

**D2: Duration precedence for top-level rows (`!isNestedToolEvent`): `data.durationMs` (a finite number ≥ 0) > timestamp difference > undefined.** Live nested calls keep their existing span rule. Replay copies `msg.durationMs` onto the synthesized end event under the same guard. Top-level numeric fields survive event-store truncation (`truncateStrings` caps strings only).

**D3: `aborted` is not consumed (audited).** The bridge's `extractSerializable` keeps boolean fields. Whether the server→browser broadcast carries it is pinned by a tolerance test. Unread and push fire on the `agent_end` edge before the settle, and user aborts are already visible (`stopReason: "aborted"`, `retryCancelled`).

**D4: Azure rename: a side-effect-free scan, ids only.** `scanLegacyProviderIds()` in `packages/server/src/auth/` reads all three files from pi's agent dir (`getAgentDir` from the runtime handle, honouring `PI_CODING_AGENT_DIR`). It uses `tryReadJson` (`locked-json-file.ts:267-283`: no lock, no write; corrupt → `{ok:false}`, missing → `{}`, other errors throw) inside a per-file try/catch. A missing, unreadable, unparseable or torn file contributes nothing until the next poll. The guarantee covers the **scan** only: the status route's existing `readAuthJson` quarantine behaviour (`provider-auth-storage.ts:503-504`) is unchanged and out of scope. It matches:
- `auth.json`: top-level key `=== "azure-openai-responses"`;
- `settings.json` (agent dir):
  - `defaultProvider === id` or `startsWith(id + "/")`;
  - `enabledModels` entries `=== id` or `startsWith(id + "/")`;
  - `modelThinkingLevels` keys `startsWith(id + "/")` or `=== id`;
- `models.json`: a `providers` key `=== id`. pi's 1.0.3 rename note says to rename the key in `models.json` too (`CHANGELOG.md:87`).

The `/` boundary prevents `azure-openai-responses2` matches. Glob or fuzzy `enabledModels` patterns (for example `azure*`) are not interpreted (documented gap). `providers.json` (the dashboard's custom-provider store) is excluded: it only holds dashboard-created custom providers, which never used the built-in id. The result carries ids and location tokens only, never values. The notice text includes pi's consequence (fallback model, prompt cache not reused), quoted from pi 1.0.3 `CHANGELOG.md:87`.

**D5: The audit record is an ADDED requirement in `pi-api-feature-detection`** (1.0.1–1.1.0 items), so the 0.87–1.0 requirement stays untouched.

**D6: `samplingParamsByThinkingLevel` is an opaque passthrough**, same as `samplingParams`: omitted when absent, carried when present, never validated (pi owns validation). It is an ADDED requirement in `pi-api-feature-detection`, next to the existing `samplingParams` scenarios.

## Risks / Trade-offs

- [Below-floor users on 1.0.x after release] → The red advisory names `1.1.0`, `CHANGELOG.md` announces it, and team spawns on pi < 1.0.4 fail closed on `--no-mcp`.
- [`durationMs` differs from wall clock] → Intended. It matches pi's own "Took".
- [Scan polling cost] → Three small JSON reads per status request, with no locks taken (`tryReadJson` is lock-free). Accepted.
- [Glob `enabledModels` entries are missed] → Documented. pi's own fallback still happens, and the notice covers the common cases.

## Migration Plan

Fixtures first (red), then pins, `pnpm install` and green. Then the verification matrix from the 1.0 change: unit, docker-harness E2E smoke, `verify-release-deps`. Rollback: revert and `pnpm install`. No data migrates.

## Late finding (implementation / CI): pi-ai 1.1.0 changes OAuth refresh cancellation

The changelog triage missed a **pi-ai 1.1.0** change (`dist/auth/resolve.js`, no changelog line): the caller's signal now cancels only the wait for the credential lock. A refresh that has started ignores it (bounded by `AbortSignal.timeout(15s)`) and persists the rotated credential, "otherwise a cancelled caller could discard the only valid refresh token". CI `unit (4)` caught it: `internal-auth-storage-refresh` X14 (×2) failed on 1.1.0; the nightly full suite on develop (pi 1.0.0) passes it.

**D7 (user decision): adopt pi's semantics.** The facade's per-provider shared flight no longer carries any caller's signal; each caller races its OWN signal (`raceSignal`); an already-aborted request starts nothing. This also removes the old "joiner restarts when its initiator aborted" path, which on 1.1.0 would start a SECOND concurrent refresh with a possibly already-rotated refresh token while the first still runs. `model-proxy-credential-routing` › "Aborted refresh stops cleanly" is MODIFIED accordingly (delta in this change). Rollback: revert; on pi < 1.1.0 the old contract still held, but the floor is 1.1.0.

