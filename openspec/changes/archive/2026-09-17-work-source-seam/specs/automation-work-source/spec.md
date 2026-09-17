# automation-work-source (delta)

## ADDED Requirements

### Requirement: A plugin outside automation registers a work-source through publish/collect

The work-source registry SHALL accept sources from two population paths, both
yielding **stable** instances: `register(id, source)` for sources the automation
plugin constructs itself, and `addProvider(provider)` for the **cross-plugin
seam** where another plugin owns the instance (and therefore its lease state).
A publishing plugin SHALL contribute `{ id, source }` (or an array) under the
key prefix `automation.worksource.`; the collector SHALL validate only the
structural contract (`next`/`ack`/`nack`) and drop a malformed, id-less, or
duplicate entry with a warning, never throwing. Providers SHALL be consulted
**lazily** on every `get`/`has`/`ids`, so registration before the owning plugin
has activated begins resolving as soon as it does (load-order independent). A
locally-registered id SHALL win a collision with a provider id, and a provider
that throws on a read SHALL be isolated so one bad provider never denies the
others their sources.

#### Scenario: A foreign plugin's published source resolves

- **WHEN** a plugin publishes `{ id: "z", source }` under `automation.worksource.z`
  and the automation registry collects contributions into a provider
- **THEN** `registry.get("z")` resolves that plugin's instance
- **AND** `registry.ids()` includes `z` so schema validation accepts `on.source: z`

#### Scenario: A malformed or duplicate contribution is dropped, not fatal

- **WHEN** contributions include an entry with an empty id, an object missing
  `next`/`ack`/`nack`, and a duplicate id
- **THEN** each invalid entry is ignored with a warning
- **AND** the remaining valid contributions are still collected

#### Scenario: Lazy consult is load-order independent

- **WHEN** a provider is added before the owning plugin has published its source,
  then the source is published later
- **THEN** a `get`/`ids` call made after publication resolves the source
- **AND** no re-registration of the provider is required

#### Scenario: A throwing provider is isolated

- **WHEN** one provider throws from `get`/`ids` and another resolves `good`
- **THEN** the registry still resolves `good`
- **AND** the throw does not propagate to the caller

#### Scenario: Local registration wins a collision

- **WHEN** an id is both locally `register`ed and offered by a provider
- **THEN** `get(id)` returns the locally-registered instance

### Requirement: A work-source receives per-call context and MAY resolve a targeted lease asynchronously

The engine SHALL pass a **per-call context** carrying the firing automation's
scope base (`cwd`) at lease time, so one registered source id can serve N
workspaces; a source MAY ignore the context. The optional targeted `take` MAY
return a promise, which the engine SHALL await; a rejection SHALL lease
**nothing**. Batch vend (`next`) SHALL remain synchronous, so every existing
`WorkSource` implementation SHALL remain valid unchanged.

#### Scenario: Async take is awaited

- **WHEN** a source's `take` returns a promise resolving to one handle
- **THEN** the targeted run binds one child to that item after the await

#### Scenario: take rejection leases nothing

- **WHEN** a source's `take` returns a rejected promise
- **THEN** the run reports an error and no item is left leased

#### Scenario: A synchronous source is unaffected

- **WHEN** a source returns handles synchronously from `next`/`take`
- **THEN** the engine uses them without change (the context arg is optional)

### Requirement: A targeted single-item run leases exactly one named item

The engine SHALL expose `runWorkItem(automation, key)` that leases the ONE
available item whose stable idempotency key is `key`, via the source's OPTIONAL
`take(key, ctx)`, and starts exactly one child for it through the same child path
as a batch fire. The **lease** SHALL be the single-flight guard: when `take`
returns `null` (already leased or gone) the run SHALL be refused as `in_flight`;
when the automation has no work-source or the source implements no `take` the run
SHALL report `unsupported`. A targeted run SHALL be exposed to other plugins as a
provided `automation:runWorkItem` capability.

#### Scenario: Targeted run starts one child for the named item

- **WHEN** `runWorkItem(auto, "a")` is called and the source can `take("a")`
- **THEN** exactly one child is spawned bound to item `a`
- **AND** it runs the automation's single action for that item

#### Scenario: A second targeted run for a leased item is refused

- **WHEN** item `a` is already leased and `runWorkItem(auto, "a")` is called again
- **THEN** the run is refused with reason `in_flight`
- **AND** no second child is spawned

#### Scenario: A source without take reports unsupported

- **WHEN** `runWorkItem` targets an automation whose source implements no `take`
  (or has no work-source at all)
- **THEN** the run reports `unsupported`
- **AND** no child is spawned

### Requirement: /list validates on.source and on.kind against the live registries

The `/list` and `/definition` routes SHALL validate an automation's `on.kind` and
`on.source` against the **live** engine registries — `hooks.triggerKinds()` and
`hooks.workSourceIds()` — rather than a frozen constant, so a valid
`schedule.batch` naming a registered source is reported valid. A frozen fallback
set SHALL be used ONLY when no engine registry is supplied (a bare route mount in
a test).

#### Scenario: A registered batch source is reported valid

- **WHEN** `/list` scans a `schedule.batch` automation whose `on.source` is a
  registered work-source id and the engine supplies live registries
- **THEN** the automation is reported valid (not isolated)

#### Scenario: Bare mount falls back to the frozen kinds

- **WHEN** the routes are mounted with no engine hooks
- **THEN** validation falls back to the frozen `{"schedule"}` kind set
- **AND** no crash occurs from a missing registry
