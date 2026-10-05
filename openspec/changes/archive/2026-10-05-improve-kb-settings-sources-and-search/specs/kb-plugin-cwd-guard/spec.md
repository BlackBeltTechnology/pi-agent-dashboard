## MODIFIED Requirements

### Requirement: Uniform enforcement across entry points

The cwd guard SHALL apply the same admission logic to every cwd-scoped operation that opens a store, reads source status, grants trust, or writes config. This holds whether the operation arrives as a REST route (`GET /api/kb/stats`, `POST /api/kb/reindex`, `GET`/`PUT /api/kb/config`, `GET /api/kb/search`, `GET /api/kb/sources`, `POST /api/kb/source-trust`) or as a browser `plugin_action` message. The guard SHALL run before the operation's core is invoked. The global, non-cwd-scoped trust revocation route `DELETE /api/kb/source-trust` is outside this requirement and unchanged.

#### Scenario: REST route guarded before store open
- **WHEN** any cwd-scoped `/api/kb/*` route receives a request
- **THEN** the guard validates `cwd` first
- **AND** returns the rejection status without opening a store, reading the trust store, or touching config when the `cwd` is missing or not admitted

#### Scenario: plugin_action guarded before core invocation
- **WHEN** a `plugin_action` message for the kb plugin carries a `cwd` that is not admitted
- **THEN** the handler logs a warning and returns without running reindex, config mutation, or trust grants

## ADDED Requirements

### Requirement: Trust grants limited to saved config specs

`POST /api/kb/source-trust?cwd=<abs>` with `{ ref }`, and the `trustRefs: string[]` field accepted by both `PUT /api/kb/config` and the `config.set` plugin action, SHALL grant trust only for a remote source spec in the admitted folder's effective saved config whose `ref` equals the given ref. The effective saved config is the project config merged over the global config, the source list the reindex job walks.

- A spec is remote when its `kind`, or the engine `classifyRef` of its `ref` when `kind` is absent, is `git`, `https`, or `npm`.
- Trust SHALL be recorded for the saved spec exactly as stored, never for client-supplied fields.
- A grant SHALL be reported as successful only when it was persisted.

#### Scenario: Grant for a saved remote spec

- **WHEN** `ref` matches exactly one remote source in the folder's saved config
- **THEN** trust is recorded for that saved spec, so a reindex resolving the same saved spec finds it trusted
- **AND** the response is `200 { hash, subject }`

#### Scenario: Ambiguous ref

- **WHEN** more than one saved source carries the given `ref`
- **THEN** the response is `409 { error }` and no trust is recorded

#### Scenario: No matching saved spec

- **WHEN** `ref` matches no source in the folder's saved config
- **THEN** the response is `404 { error }` and no trust is recorded

#### Scenario: Filesystem spec

- **WHEN** `ref` matches a filesystem source
- **THEN** the response is `400 { error }` and no trust is recorded

#### Scenario: Persist failure reported

- **WHEN** the trust store cannot be written
- **THEN** the grant endpoint responds `500 { error }`

#### Scenario: trustRefs on config write, REST and plugin_action alike

- **WHEN** `PUT /api/kb/config` or `config.set` succeeds with `trustRefs`
- **THEN** each ref matching exactly one remote source in the merged saved config is trusted through the same core
- **AND** refs that are unmatched, ambiguous, filesystem, or failed to persist are not trusted
- **AND** `PUT` returns them in `untrustedRefs`, while `config.set` logs them as a warning
- **AND** when the config write fails validation, no trust is recorded
