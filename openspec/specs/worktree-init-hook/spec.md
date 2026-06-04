# Worktree Init Hook

## Purpose

Project-declared, gated initialization hook (`.pi/settings.json#worktreeInit`). Bash `gate` (exit 0 = needs init) + `run` spec (`script` | detached `agent`). TOFU trust keyed by `repoRoot + hash(def)`. Cached gate evaluation. Applies uniformly to new worktrees and the primary checkout.

## Requirements

### Requirement: Project-declared worktree-init hook

A project MAY declare a single worktree-init hook in `.pi/settings.json` under the key `worktreeInit`. The hook shape SHALL be:

```jsonc
{
  "worktreeInit": {
    "gate": "<bash command>",
    "run": { "type": "script", "command": "<bash command>" }
         // OR
         // { "type": "agent", "prompt": "<text>", "model": "<id>", "settings": { ... } }
  }
}
```

The server SHALL read `worktreeInit` via a pure `readInitHook(repoRoot)` that returns the parsed hook or `null`. Any read error, parse error, missing key, or unrecognized shape SHALL return `null` (fail-open). When `readInitHook` returns `null`, the checkout has no hook and the init-status / init endpoints SHALL report `hasHook: false`.

#### Scenario: Hook declared with script run

- **WHEN** `.pi/settings.json` contains `{ "worktreeInit": { "gate": "test ! -d node_modules", "run": { "type": "script", "command": "npm ci" } } }`
- **THEN** `readInitHook(repoRoot)` SHALL return a hook with `gate` and a `script` run

#### Scenario: Hook declared with agent run

- **WHEN** `worktreeInit.run` is `{ "type": "agent", "prompt": "set up", "model": "claude-sonnet-4" }`
- **THEN** `readInitHook(repoRoot)` SHALL return a hook whose run type is `agent` carrying `prompt` and `model`

#### Scenario: No hook declared

- **WHEN** `.pi/settings.json` has no `worktreeInit` key, or is missing, or is malformed JSON
- **THEN** `readInitHook(repoRoot)` SHALL return `null`

### Requirement: Gate evaluation determines init need

The server SHALL evaluate `worktreeInit.gate` as a bash command in the target checkout's cwd via `evaluateGate(cwd, hook)`. The result SHALL be `{ needsInit: true }` if and only if the gate process exits with code `0`. Any non-zero exit SHALL yield `{ needsInit: false }`. A spawn error or timeout SHALL fail closed (`{ needsInit: false }`) and be logged.

The same evaluation SHALL be used for a freshly created worktree and for the primary checkout (main / develop); the gate is unaware of which kind of checkout it runs in.

Because the gate is repo-declared bash, the server SHALL NOT evaluate it until the hook is trusted (TOFU). Init-status for an untrusted hook SHALL report hook presence without running the gate, and `needsInit` SHALL be unknown until trust is recorded. This closes a trust-boundary hole where merely viewing a directory would execute repo-declared code.

#### Scenario: Untrusted hook does not run the gate

- **WHEN** init-status is requested for a checkout whose hook is not yet trusted
- **THEN** the server SHALL NOT spawn the gate
- **AND** SHALL report `{ hasHook: true, trusted: false }` without a `needsInit` value

#### Scenario: Gate exits 0 means needs init

- **WHEN** the gate `test ! -d node_modules` runs in a checkout with no `node_modules/`
- **THEN** the gate exits `0`
- **AND** `evaluateGate` SHALL return `{ needsInit: true }`

#### Scenario: Gate exits non-zero means no init

- **WHEN** the gate `test ! -d node_modules` runs in a checkout that has `node_modules/`
- **THEN** the gate exits non-zero
- **AND** `evaluateGate` SHALL return `{ needsInit: false }`

#### Scenario: Gate spawn failure fails closed

- **WHEN** the gate command cannot be spawned
- **THEN** `evaluateGate` SHALL return `{ needsInit: false }`
- **AND** SHALL log the failure

### Requirement: Gate evaluation is cached and invalidated on run

The server SHALL cache the gate result per resolved checkout path as `{ needsInit, evaluatedAt }`. A cached entry SHALL be reused for repeated init-status fetches within a short TTL. The server SHALL invalidate the cached entry for a checkout when a hook run starts or exits for that checkout.

#### Scenario: Repeated status fetch reuses cache

- **WHEN** init-status is fetched twice for the same checkout within the TTL
- **THEN** the gate command SHALL be spawned at most once
- **AND** both fetches SHALL return the same `needsInit` value

#### Scenario: Running the hook invalidates the cache

- **WHEN** a hook run completes for a checkout
- **THEN** the cached gate entry for that checkout SHALL be invalidated
- **AND** the next init-status fetch SHALL re-evaluate the gate

### Requirement: Script-flavor hook execution

When `run.type === "script"`, the server SHALL execute `run.command` as a bash command in the checkout cwd using the streaming executor (combined stdout/stderr ring buffer ≤ 4 KB, throttled progress, default timeout). The result SHALL be `{ ok, durationMs, code?, stderr? }`. On non-zero exit, `ok` SHALL be `false` and `stderr` SHALL carry the tail.

#### Scenario: Script success

- **WHEN** `run.command` exits `0`
- **THEN** the result SHALL be `{ ok: true, durationMs }`

#### Scenario: Script failure carries stderr tail

- **WHEN** `run.command` exits non-zero
- **THEN** the result SHALL be `{ ok: false, code, stderr }` with the ≤ 4 KB output tail

### Requirement: Agent-flavor hook runs detached

When `run.type === "agent"`, the server SHALL spawn a DETACHED headless pi process in the checkout cwd, configured with `run.prompt`, `run.model`, and optional `run.settings`. The process SHALL NOT be registered as a dashboard session (no transcript in the session list, no abort control). Combined stdout/stderr SHALL be written to `<cwd>/.pi/worktree-init.log`. Completion SHALL be determined by re-evaluating the gate after the process exits; if the gate still reports `needsInit: true`, the run SHALL be treated as failed and the server SHALL surface the log tail.

#### Scenario: Agent run spawns detached, not a session

- **WHEN** an `agent` hook runs
- **THEN** the server SHALL spawn a detached headless pi with the configured prompt + model
- **AND** SHALL NOT create a dashboard session entry for it

#### Scenario: Agent run completion detected via gate

- **WHEN** the detached agent process exits and the gate then reports `needsInit: false`
- **THEN** the run SHALL be reported done

#### Scenario: Agent run failure surfaced from log

- **WHEN** the detached agent process exits and the gate still reports `needsInit: true`
- **THEN** the run SHALL be reported failed
- **AND** the server SHALL include the tail of `<cwd>/.pi/worktree-init.log`

### Requirement: First-use trust (TOFU) gates hook execution

Before running a hook for a checkout, the server SHALL require trust keyed by `repoRoot + sha256(canonical(worktreeInit))`. `isTrusted(repoRoot, hash)` SHALL be false until `recordTrust(repoRoot, hash)` is called. A run request for an untrusted hook SHALL NOT execute; it SHALL return an `init_untrusted` response carrying the hook definition so the client can prompt for confirmation. Editing any part of `worktreeInit` changes the hash and SHALL require re-confirmation.

#### Scenario: Untrusted hook blocks run

- **WHEN** a run is requested for a hook whose `repoRoot + hash` is not trusted
- **THEN** the server SHALL NOT execute the hook
- **AND** SHALL respond `init_untrusted` with the hook definition

#### Scenario: Recording trust permits run

- **WHEN** the client confirms and the server records trust for `repoRoot + hash`
- **THEN** subsequent run requests with the same hash SHALL execute without prompting

#### Scenario: Editing the hook re-prompts

- **WHEN** the `worktreeInit` definition changes (gate, command, prompt, or model)
- **THEN** the computed hash SHALL differ
- **AND** `isTrusted` SHALL return false until trust is recorded for the new hash
