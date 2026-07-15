## MODIFIED Requirements

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
