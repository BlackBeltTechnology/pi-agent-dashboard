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

A gate sentinel that guards a generated asset which can exist while empty — notably the kb index database, whose file is written the instant the store opens (`CREATE TABLE IF NOT EXISTS`) — SHALL be coherent. Coherence is achieved at the *producer*: when `kb index` guarantees no committed file at `dbPath` on failure (see `markdown-knowledge-base` › "kb index is atomic on failure"), a file at `dbPath` reflects a successful run and `test ! -f <index.db>` is a coherent sentinel. The gate SHALL NOT probe non-emptiness as a coherence mechanism: a *legitimately* empty index (0 chunks from a source set with no markdown) is a valid, fully-initialized index and is indistinguishable from — and MUST NOT be conflated with — a failure husk. The husk is eliminated at the source (atomicity), so a present index — empty or populated — SHALL NOT be treated as needing init.

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

#### Scenario: Interrupted init leaves no index and re-fires

- **GIVEN** a `run` that produces a kb index and a gate `test ! -f index.db` meant to detect its absence
- **WHEN** init was interrupted before the index committed, and the producer's atomicity guarantee left no file at `dbPath`
- **THEN** the gate SHALL exit `0` (needs init) so the run re-fires and builds the index

#### Scenario: Legitimately empty index does not re-fire

- **GIVEN** a checkout whose configured sources contain no markdown
- **WHEN** a successful `kb index` leaves a present, valid 0-chunk `index.db`
- **THEN** the gate `test ! -f index.db` SHALL exit non-zero (no init) — the empty index is a valid successful result, not a husk, and SHALL NOT re-fire the run

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

Before running a hook for a checkout, the server SHALL require trust keyed by `configRoot + sha256(canonical(worktreeInit))` (the hash component is `hookDefHash`). Trust SHALL carry a **scope**, one of `session` or `project`:

- `project` scope SHALL be persisted to `~/.pi/dashboard/worktree-init-trust.json` (durable across restarts) — the pre-existing behavior.
- `session` scope SHALL be held only in server process memory and SHALL NOT be written to disk; it SHALL be lost when the dashboard server process restarts.

`recordTrust(configRoot, hash, scope)` SHALL record trust in the store selected by `scope`. The in-memory session store and the persisted project store SHALL derive the trust key identically to the pre-existing store (`path.resolve(configRoot)` joined with `hash`), so a session grant and a project grant for the same checkout+hook are interchangeable at read time and neither store can produce a false negative from divergent key forms. `isTrusted(configRoot, hash)` SHALL return `true` when a grant for that key exists in **either** the in-memory session store **or** the persisted project store, and `false` otherwise.

The server SHALL accept only the exact scope tokens `session` and `project`. Scope validation SHALL NOT coerce an unrecognized value upward into greater durability: when a confirm request omits `scope`, the server SHALL treat it as `project` (backward compatibility); when a confirm request carries a `scope` value that is present but is neither exactly `session` nor exactly `project`, the server SHALL reject the request with a `bad_request` error and SHALL NOT record trust or run the hook.

A run request for an untrusted hook SHALL NOT execute; it SHALL return an `init_untrusted` response carrying the hook definition and hash so the client can prompt for confirmation. On confirm, the client SHALL send `confirmHash` together with the chosen `scope`; when `confirmHash` matches the computed hash and the scope is valid, the server SHALL call `recordTrust(configRoot, hash, scope)` before running.

Editing any part of `worktreeInit` changes the hash and SHALL require re-confirmation regardless of scope. This trust gate SHALL apply identically whether the run is triggered manually (via `WorktreeInitButton`) or automatically (via the `autoInitWorktreeOnSpawn` preference); no caller may cause an untrusted hook to run without an explicit user trust grant. The scope choice SHALL apply identically to git checkouts and to external (non-git) config roots resolved via `resolveConfigRoot`.

#### Scenario: Untrusted hook blocks run

- **WHEN** a run is requested for a hook whose `configRoot + hash` is not trusted in either store
- **THEN** the server SHALL NOT execute the hook
- **AND** SHALL respond `init_untrusted` with the hook definition and hash

#### Scenario: Project-scope trust persists across restart

- **WHEN** the client confirms with `scope: "project"` and the server records trust
- **THEN** `recordTrust` SHALL write the grant to `worktree-init-trust.json`
- **AND** `isTrusted(configRoot, hash)` SHALL return `true` after a simulated reload of the persisted store

#### Scenario: Session-scope trust is memory-only and not persisted

- **WHEN** the client confirms with `scope: "session"` and the server records trust
- **THEN** `recordTrust` SHALL add the grant to the in-memory session store and SHALL NOT write `worktree-init-trust.json`
- **AND** `isTrusted(configRoot, hash)` SHALL return `true` while the process lives
- **AND** a fresh read of the persisted store alone SHALL NOT contain the grant

#### Scenario: Session trust satisfies isTrusted without a persisted grant

- **GIVEN** a `configRoot + hash` present only in the in-memory session store
- **WHEN** a run is requested for that hook
- **THEN** `isTrusted` SHALL return `true` (session store alone satisfies the OR-combined read)
- **AND** the run SHALL proceed without an `init_untrusted` response

#### Scenario: Recording trust permits run

- **WHEN** the client confirms and the server records trust for `configRoot + hash` in either scope
- **THEN** subsequent run requests with the same hash SHALL execute without prompting

#### Scenario: Omitted scope defaults to project

- **WHEN** a confirm request matches the hash but omits `scope`
- **THEN** the server SHALL record trust with `project` scope (persisted) — identical to pre-change behavior
- **AND** SHALL NOT treat the request as untrusted

#### Scenario: Unrecognized scope is rejected, not coerced

- **WHEN** a confirm request matches the hash but carries a `scope` value present yet not exactly `session` or `project` (e.g. `"Session"`, `"permanent"`, `""`, a non-string)
- **THEN** the server SHALL respond `bad_request`
- **AND** SHALL NOT record trust in either store (it SHALL NOT coerce the value to `project`)
- **AND** SHALL NOT run the hook

#### Scenario: Editing the hook re-prompts regardless of scope

- **WHEN** the `worktreeInit` definition changes (gate, command, prompt, or model) after a session- or project-scope grant
- **THEN** the computed hash SHALL differ
- **AND** `isTrusted` SHALL return `false` for the new hash until trust is recorded for it

#### Scenario: Session scope applies to an external (non-git) config root

- **GIVEN** an external non-git directory whose `resolveConfigRoot` yields the directory itself and whose hook is untrusted
- **WHEN** the client confirms with `scope: "session"`
- **THEN** the server SHALL record the session grant keyed by that config root and run the hook
- **AND** the grant SHALL NOT be written to `worktree-init-trust.json`

#### Scenario: Auto-trigger cannot bypass trust

- **WHEN** the `autoInitWorktreeOnSpawn` preference is ON and a spawned checkout's hook is untrusted in both stores
- **THEN** the auto-trigger SHALL NOT call the init endpoint with any forged or implied trust
- **AND** initialization SHALL only proceed via the manual, user-confirmed path

### Requirement: Gate SHALL cover every asset the run restores

A declared hook's `gate` SHALL evaluate to needs-init (exit 0) whenever ANY asset that its `run` produces is absent, not merely a single sentinel asset. Because `evaluateGate` reports `{ needsInit: true }` iff the gate exits 0, a gate that under-detects its run's outputs makes the run un-runnable: a checkout missing some-but-not-all restored assets reports `needsInit: false` and the run is silently skipped, leaving those assets permanently missing until the gate's single sentinel also disappears.

This is a coherence property of the project's declared hook, not new engine behavior: the engine still runs whatever bash the project declares. Projects MUST author the `gate` to test every asset the `run` restores.

#### Scenario: Partially-initialized checkout still needs init

- **GIVEN** a `run` that restores multiple assets (e.g. `node_modules`, generated skills, a kb index)
- **WHEN** the gate runs in a checkout where `node_modules` exists but a generated skill directory or the kb index is absent
- **THEN** a coherent gate SHALL exit `0` (needs init)
- **AND** `evaluateGate` SHALL return `{ needsInit: true }` so the run re-fires and restores the missing assets

#### Scenario: Fully-initialized checkout does not need init

- **WHEN** the gate runs in a checkout where every asset the `run` produces is present
- **THEN** the gate SHALL exit non-zero
- **AND** `evaluateGate` SHALL return `{ needsInit: false }`

#### Scenario: Sentinel-only gate under-detects (anti-pattern)

- **GIVEN** a gate that tests only `node_modules` while its `run` also produces generated skills and a kb index
- **WHEN** a checkout has `node_modules` but is missing the generated skills or kb index
- **THEN** the gate exits non-zero and the run is skipped — the missing assets are NOT restored
- **AND** this configuration SHALL be treated as incoherent and corrected to test all restored assets

### Requirement: Config-root resolution decoupled from git

The server SHALL resolve the directory that holds a checkout's worktree-init
configuration via `resolveConfigRoot(cwd)`, independent of whether the cwd is a
git repository:

- WHEN `cwd` is inside a git repository or worktree, `resolveConfigRoot` SHALL
  return `resolveMainPath(cwd)` (the git common-dir's parent), preserving the
  existing worktree→main-repo mapping.
- WHEN `cwd` is NOT a git repository AND `cwd/.pi/settings.json` exists,
  `resolveConfigRoot` SHALL return `cwd`.
- WHEN `cwd` is NOT a git repository AND `cwd/.pi/settings.json` does not exist,
  `resolveConfigRoot` SHALL return `null`.

For a non-git directory the config root SHALL be exactly `cwd`; the server SHALL
NOT walk upward to a parent directory's `.pi/settings.json`. `resolveConfigRoot`
only locates a config file: its git branch MAY run read-only git discovery probes
(`isGitRepo`/`resolveMainPath` shell out to `git rev-parse`), but it SHALL NOT
execute any repo-declared hook command (`gate`/`run`).

The init-status (`GET /api/git/worktree/init-status`) and init
(`POST /api/git/worktree/init`) endpoints SHALL use `resolveConfigRoot` in place
of the previous `isGitRepo` guard plus `resolveMainPath` call. Worktree
creation, removal, and lifecycle endpoints SHALL continue to require a git
repository and SHALL be unaffected by this requirement.

#### Scenario: Git checkout resolves to main repo root

- **WHEN** `resolveConfigRoot(cwd)` is called for a cwd inside a git worktree
- **THEN** it SHALL return the same path as `resolveMainPath(cwd)`

#### Scenario: Non-git dir with settings resolves to itself

- **WHEN** `cwd` is not a git repository and `cwd/.pi/settings.json` exists
- **THEN** `resolveConfigRoot(cwd)` SHALL return `cwd`

#### Scenario: Non-git dir without settings resolves to null

- **WHEN** `cwd` is not a git repository and `cwd/.pi/settings.json` does not exist
- **THEN** `resolveConfigRoot(cwd)` SHALL return `null`

#### Scenario: Git dir with unresolvable common-dir resolves to null

- **GIVEN** a cwd where `isGitRepo` is true but `resolveMainPath` returns `null` (degenerate git state)
- **WHEN** `resolveConfigRoot(cwd)` is called
- **THEN** it SHALL return `null`
- **AND** it SHALL NOT fall through to the non-git `cwd/.pi/settings.json` check
- **AND** init-status SHALL report `{ success: true, data: { hasHook: false } }` rather than `not_a_repo`

#### Scenario: No upward walk for non-git dir

- **GIVEN** a parent directory `P` that is not a git repository and contains `P/.pi/settings.json`
- **AND** a child directory `P/child` that is not a git repository and has no `P/child/.pi/settings.json`
- **WHEN** `resolveConfigRoot("P/child")` is called
- **THEN** it SHALL return `null` (it SHALL NOT inherit `P`'s settings)

### Requirement: Init endpoints read a hook in a non-git directory

The init-status and init endpoints SHALL report a declared hook for a non-git
directory whose config root `resolveConfigRoot` yields. A non-git directory with
a valid `.pi/settings.json#worktreeInit` SHALL NOT be reported as `not_a_repo`.
When `resolveConfigRoot` returns `null`, init-status SHALL report
`{ hasHook: false }` (a successful response) rather than a `not_a_repo` error,
and `POST /init` SHALL return the endpoint's existing no-hook envelope
`{ success: true, data: { ran: false, skippedReason: "no_hook" } }` (no new
response shape). A non-git dir's untrusted hook SHALL return the existing
`{ success: false, code: "init_untrusted", data: { hook, hash } }` from
`POST /init`, unchanged from the git path.

TOFU trust SHALL apply identically to a non-git config root: an untrusted hook
in a non-git directory SHALL report `{ hasHook: true, trusted: false }` and the
server SHALL NOT spawn its gate or run until trust is recorded.

#### Scenario: Non-git dir with untrusted hook reports presence only

- **WHEN** init-status is requested for a non-git directory whose `.pi/settings.json` declares a `worktreeInit` hook that is not yet trusted
- **THEN** the response SHALL be `{ success: true, data: { hasHook: true, trusted: false } }`
- **AND** the server SHALL NOT spawn the gate

#### Scenario: Non-git dir with no hook is not an error

- **WHEN** init-status is requested for a non-git directory with no `.pi/settings.json`
- **THEN** the response SHALL be `{ success: true, data: { hasHook: false } }`
- **AND** the response SHALL NOT be `not_a_repo`

#### Scenario: Non-git dir with settings.json but no worktreeInit

- **GIVEN** a non-git directory that HAS `.pi/settings.json` but the file has no (or a malformed) `worktreeInit` key
- **WHEN** init-status is requested
- **THEN** `resolveConfigRoot` SHALL return the directory (root resolves) and `readInitHook` SHALL fail-open to `null`
- **AND** the response SHALL be `{ success: true, data: { hasHook: false } }` (same as a git repo without a hook)

#### Scenario: Non-git dir with trusted hook evaluates the gate

- **WHEN** init-status is requested for a non-git directory whose hook is trusted
- **THEN** the gate SHALL be evaluated (cached) in that directory
- **AND** the response SHALL be `{ hasHook: true, needsInit, trusted: true }`

#### Scenario: POST init on non-git dir with untrusted hook does not execute

- **WHEN** `POST /api/git/worktree/init` is called for a non-git directory whose declared hook is not trusted
- **THEN** the server SHALL NOT run the hook (no gate spawn, no run spawn)
- **AND** the response SHALL be `{ success: false, code: "init_untrusted", data: { hook, hash } }`

#### Scenario: POST init on non-git dir with no hook returns the no-hook envelope

- **WHEN** `POST /api/git/worktree/init` is called for a non-git directory with no `.pi/settings.json`
- **THEN** the response SHALL be `{ success: true, data: { ran: false, skippedReason: "no_hook" } }`
- **AND** the response SHALL NOT be `not_a_repo`

