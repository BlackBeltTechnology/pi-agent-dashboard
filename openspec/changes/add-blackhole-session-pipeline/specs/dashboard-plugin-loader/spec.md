## ADDED Requirements

### Requirement: `ServerPluginContext` exposes an installed-extension probe

`ServerPluginContext` SHALL expose `isPiExtensionInstalled?(name: string): Promise<boolean>`, answering whether a pi extension is installed from the host's package registry (`packageManagerWrapper.listInstalled`, union of global and local scopes — deliberately a superset of the `piExtensions` probe's current global-only wiring), matched with the probe's `installedMatchesName` logic (id/name/displayName/source, including `sourcesMatch`). The capability SHALL be optional on the type so contexts constructed without it (older hosts, injected test contexts) remain valid.

#### Scenario: Registry union across scopes

- **WHEN** a plugin calls `isPiExtensionInstalled("pi-blackhole")`
- **THEN** the host SHALL answer from the union of `listInstalled("global")` and `listInstalled("local")`
- **AND** matching SHALL use the same `installedMatchesName` logic as the `piExtensions` requirement probe, not a weaker source-only comparison

#### Scenario: Answer is boolean-only and ungated

- **WHEN** any plugin, trusted or not, invokes the capability
- **THEN** it SHALL receive only a boolean
- **AND** no installed-package records SHALL be exposed through this capability

#### Scenario: A registry scan failure rejects rather than resolving false

- **WHEN** the underlying package-manager scan throws
- **THEN** the capability's promise SHALL reject
- **AND** SHALL NOT resolve `false`, which callers could not distinguish from an authoritative not-installed answer

#### Scenario: Answers are cached

- **WHEN** the capability is invoked repeatedly within the cache window
- **THEN** the host SHALL NOT re-run the package-manager scan on every call
- **AND** the cache duration SHALL be comparable to the requirement-probe cache (~30 s)
- **AND** only successful scans SHALL be cached — a rejection SHALL NOT occupy the cache, so a recovered registry answers on the next call

#### Scenario: Absent capability degrades, never throws

- **WHEN** a plugin runs against a context that does not provide the capability
- **THEN** reading the property SHALL yield `undefined` rather than throwing
- **AND** the calling plugin remains responsible for a fallback

### Requirement: Client runtime provides a slot-claims invalidation store

The client-side plugin runtime SHALL provide a module-level slot-claims version store with an exported `bumpSlotClaimsVersion(): void`. `useSlotHasClaimsForSession` and slot consumers that evaluate `shouldRender` SHALL subscribe to the store (via `useSyncExternalStore`) so that a bump re-evaluates every gate, including for sessions that emit no further broadcasts.

#### Scenario: Bump re-evaluates gates without a session broadcast

- **WHEN** a plugin's late-arriving global signal resolves and the plugin calls `bumpSlotClaimsVersion()`
- **THEN** every mounted gate wrapper SHALL re-invoke `shouldRender`
- **AND** this SHALL occur for idle and ended sessions that will never emit `session_updated`

#### Scenario: Unbumped store changes nothing

- **WHEN** no plugin ever calls `bumpSlotClaimsVersion()`
- **THEN** gate evaluation behaviour SHALL be identical to the pre-change behaviour

#### Scenario: `shouldRender` stays synchronous

- **WHEN** a gate is re-evaluated after a bump
- **THEN** `shouldRender` SHALL still be called synchronously during render
- **AND** the store SHALL NOT introduce an async gate path
