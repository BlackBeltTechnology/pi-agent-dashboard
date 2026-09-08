## MODIFIED Requirements

### Requirement: Default model applied only to brand-new sessions

The bridge extension SHALL apply `config.defaultModel` (via `pi.setModel()`) only when the spawned pi process represents a brand-new session — i.e. when `ctx.sessionManager.buildSessionContext().messages.length === 0` at the time the bridge handles `session_start`. For sessions with existing messages (resumed via `--session`, forked via `--fork`, or reloaded mid-process), the bridge SHALL NOT call `pi.setModel()` and SHALL leave the session's existing model untouched.

The detection signal SHALL be the count of `message` entries returned by `ctx.sessionManager.buildSessionContext().messages`, NOT the raw entry count from `ctx.sessionManager.getEntries()`. This mirrors pi's own `hasExistingSession` predicate in `pi-coding-agent/dist/core/sdk.js` (`existingSession.messages.length > 0`). Pi auto-appends `model_change` and `thinking_level_change` setup entries to a brand-new session BEFORE emitting `session_start`, so `getEntries().length` is ≥ 2 even for sessions with no user history; only `buildSessionContext().messages` correctly distinguishes "brand-new" from "has history".

If `ctx.sessionManager.buildSessionContext` is unavailable (older pi versions), the bridge SHALL fall back to `0` (apply the default model) rather than `Infinity` (skip it) — preferring a one-time model overwrite on resume over silent failure on new sessions.

In addition, the bridge SHALL suppress default application for literal `--model`, presence of `PI_SUBAGENT_CHILD`, or a startup model differing from the complete global Pi configured default pair, as specified by `bridge-default-model-gate`. Unmarked SDK choices equal to Pi's default remain subject to ordinary default application.

This rule SHALL apply to both call sites of the default-model application:

1. The direct call inside the `session_start` handler.
2. The deferred retry path that fires when a previously-unavailable custom provider becomes ready after `session_start` (`pendingDefaultModel`).

The pre-existing gate on `event.reason === "startup"` SHALL remain in place; the message-count check is an additional AND condition, not a replacement.

#### Scenario: Brand-new session gets default model

- **WHEN** the dashboard spawns pi without `--session` or `--fork` and `session_start` fires with `reason === "startup"`
- **AND** `ctx.sessionManager.buildSessionContext().messages.length === 0`
- **AND** `config.defaultModel` is set and the model is resolvable in the model registry
- **AND** none of the protected startup signals above is present
- **THEN** the bridge SHALL call `pi.setModel()` with the resolved default model

#### Scenario: Brand-new session with pre-emit setup entries gets default model

- **WHEN** the dashboard spawns pi without `--session` or `--fork` and `session_start` fires with `reason === "startup"`
- **AND** pi has auto-appended `model_change` and `thinking_level_change` entries to the session via `sdk.js` (so `ctx.sessionManager.getEntries().length === 2`)
- **AND** `ctx.sessionManager.buildSessionContext().messages.length === 0` (those setup entries are not messages)
- **AND** `config.defaultModel` is set and resolvable
- **AND** none of the protected startup signals above is present
- **THEN** the bridge SHALL call `pi.setModel()` with the resolved default model
- **AND** the bridge SHALL NOT be misled by the non-zero `getEntries()` count

#### Scenario: Resumed session keeps its existing model

- **WHEN** the dashboard spawns pi with `--session <file>` and `session_start` fires with `reason === "startup"`
- **AND** `ctx.sessionManager.buildSessionContext().messages.length > 0` (the persisted session had prior user/assistant messages)
- **THEN** the bridge SHALL NOT call `pi.setModel()`
- **AND** the session SHALL continue with whatever model pi loaded from the persisted session

#### Scenario: Forked session inherits parent's model

- **WHEN** the dashboard spawns pi with `--fork <file>` and `session_start` fires with `reason === "startup"`
- **AND** `ctx.sessionManager.buildSessionContext().messages.length > 0` (parent messages copied by `SessionManager.forkFrom`)
- **THEN** the bridge SHALL NOT call `pi.setModel()`
- **AND** the forked session SHALL run with the model inherited from the parent session

#### Scenario: Bridge reload of in-flight session keeps model

- **WHEN** the bridge reloads (e.g. via `/reload`) while a session has prior messages
- **AND** `session_start` re-fires with `reason === "startup"` (or `"reload"`, which is also filtered by the reason gate)
- **AND** `ctx.sessionManager.buildSessionContext().messages.length > 0`
- **THEN** the bridge SHALL NOT call `pi.setModel()`

#### Scenario: Custom provider readiness retry respects the gate

- **WHEN** a brand-new session (`messages.length === 0`) passes all startup guards and triggers default-model application but the configured model's provider is not yet registered, so `pendingDefaultModel` is set
- **AND** later the provider becomes ready and the retry fires
- **THEN** the bridge SHALL apply the default model

- **WHEN** a resumed or forked session (`messages.length > 0`) reaches `session_start` and `pendingDefaultModel` is left null (because the message-count gate returned false)
- **AND** the provider becomes ready later
- **THEN** no default-model application SHALL occur

#### Scenario: Default model not configured

- **WHEN** any session starts and `config.defaultModel` is unset
- **THEN** the bridge SHALL NOT call `pi.setModel()` regardless of message count

#### Scenario: Older pi without buildSessionContext falls back to apply

- **WHEN** the bridge runs against a pi version where `ctx.sessionManager.buildSessionContext` is undefined
- **AND** `session_start` fires with `reason === "startup"`
- **AND** `config.defaultModel` is set and resolvable
- **AND** no explicit `--model` token or `PI_SUBAGENT_CHILD` marker is present
- **THEN** the bridge SHALL treat the message count as `0` (via optional-chaining `?? 0`)
- **AND** the bridge SHALL call `pi.setModel()` with the resolved default model
- **AND** the bridge SHALL prefer this "apply on resume" failure mode over the alternative "silently skip on new"

