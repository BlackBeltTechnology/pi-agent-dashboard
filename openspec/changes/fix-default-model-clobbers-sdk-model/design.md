## Context

See proposal.md for the failure. Pi's installed `dist/core/sdk.js` takes `options.model` or resolves Pi's default, then appends the same `model_change` entry in both cases before `session_start`. `buildSessionContext().model` exposes that provider/modelId pair. Neither the entry nor `SessionStartEvent` exposes choice provenance.

Installed pi-subagents 0.66.0 `src/runs/shared/child-session.ts` resolves `launch.model` with `resolveCliModel` and passes the model to `createAgentSession`. Its `child-runtime-config.ts` declares `PI_SUBAGENT_CHILD` for processes hosting child sessions. This is an existing signal, not a new spawner contract.

## Goals / Non-Goals

Preserve models for marked children and non-default SDK choices without changing ordinary new-session defaults or resume/fork/reload behavior. Do not change Pi SDK, global settings, installed extensions, shared services, or launch arguments. No global startup gate applies because no global mutation is permitted.

## Decisions

Firstmate approved this bounded scope in inbox 001 on 2026-09-08 (`sdk-model-provenance`): any of three signals suppresses the Dashboard default: literal `--model`, presence of `PI_SUBAGENT_CHILD` (including an empty value), or startup model differing from the complete global Pi default pair.

Keep `shouldApplyDefaultModel` pure and keep its existing inputs. Keep `hasExplicitModel` as the argv signal. After that gate passes, call a small shared `hasProtectedSdkModel` helper that short-circuits child-marker checks before reading settings. The helper reads only `defaultProvider` and `defaultModel` from the supplied global settings path. Compare provider and modelId separately, without splitting model IDs on slashes. No provider resolution, authentication access, network call, or settings write is needed.

Capture `buildSessionContext().model` synchronously on entry to `session_start`, before awaits in bridge setup. Keep message-history derivation and default application in their current location. The helper is called only after the existing basic gate passes, so resume/fork/reload and absent Dashboard defaults require no settings read. A suppressed application never assigns `pendingDefaultModel`, and therefore cannot apply either the model or coupled thinking level when a provider registers later.

Missing settings or an incomplete default pair means no configured comparison is possible; argv and marker protection still applies, otherwise retain ordinary default behavior. Invalid JSON or unreadable settings is an error, not permission to guess a model: throw a path-specific error through the bridge's existing error reporting and skip default application.

### Alternatives and library choice

A startup-model comparison alone cannot protect explicit choices equal to Pi's default. A child marker alone misses arbitrary SDK callers. An SDK provenance field could give a universal guarantee, but Pi publishes none and Firstmate rejected that upstream scope. Use all three existing signals.

Pi's SDK documentation and installed code establish the entry shape. `SettingsManager.create()` merges project settings and can migrate configuration, which is not the approved global-only, read-only comparison. Node's filesystem reader and JSON parser suffice for this small settings projection; no new library or generic protocol implementation is warranted. Vitest's existing assertions and real temporary files cover it.

## Risks / Trade-offs

- An arbitrary SDK caller that explicitly chooses a model identical to Pi's own configured default, without `PI_SUBAGENT_CHILD` or `--model`, is indistinguishable from an unchosen default and will still receive the Dashboard default when configured. Firstmate explicitly accepted this limitation.
- This is a global configured-pair comparison, not a reconstruction of Pi's project overrides, custom SDK settings, authentication-dependent initial-model selection, or model aliases. A different startup pair is preserved conservatively, even if automatically selected by Pi.
- If the global configured pair is missing or incomplete, unmarked SDK callers have only argv protection. This retains existing plain-new-session behavior rather than inventing a default.
- The environment marker identifies the hosting process, not an individual session. All sessions in a marked process skip the Dashboard default, as approved.
- No shared-service reload or provider prompt is run in this lane. Deterministic tests cover the gate and its input derivation; deployment belongs to the owner after review.

## Validation and delivery

Write regression cases before implementation and observe failures for child and non-default SDK inputs. Independently cover argv, empty child marker, provider-only differences, plain startup, the accepted same-default limitation, absent/invalid settings, resume/fork/reload, and deferred-provider no-op. Run focused tests and the extension suite, inspect TypeScript diagnostics, validate OpenSpec, simplify current changes, and obtain fresh independent review. Sync active specs, architecture documentation, and source rows. Commit and push only the task branch; open a direct PR to the requested repository default branch. Do not merge.
