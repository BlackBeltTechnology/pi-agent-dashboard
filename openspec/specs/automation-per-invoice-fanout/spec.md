# automation-per-invoice-fanout Specification

## Purpose

Per-invoice automation fan-out: ONE spawned session per queued invoice, each
bound to a DISTINCT invoice, driven by the automation plugin's generic
work-source seam.

The capability moved. It used to live in the automation engine as a payload
discriminator (`scope: per-invoice`) plus an injected queued-invoice enumerator,
which put invoice knowledge inside a domain-free package. It now sits in two
cleanly separated halves:

- **the generic half (automation plugin)** — a fenced competing-consumers
  work-source seam (`WorkSource`: lease N distinct items, `ack`/`nack`), the
  `schedule.batch` trigger, `${{trigger}}` substitution, and the spawn bound. The
  automation plugin knows nothing about invoices; the requirements stated of it
  below are domain-free and use only work-item vocabulary.
- **the invoice half (invoicebot plugin)** — a queued-invoice work source over
  the InvoiceEngine's queued list, registered through the generic seam. Every
  invoice-shaped guarantee is stated of THAT source.

The retired `scope: per-invoice` / `${invoice_id}` / per-key vocabulary is not
part of this capability. The generic mechanics of the seam itself are specified
by `automation-work-source`; this capability specifies the additions that let a
domain plugin own a source, and the invoice source that does.

## Requirements

### Requirement: Cross-plugin work-source registration

The automation plugin SHALL let ANOTHER plugin supply a work-source, so a source
backed by that plugin's own state can drive `schedule.batch` fan-out without the
automation plugin gaining any knowledge of the domain. A plugin SHALL publish a
`{ id, source }` descriptor under the `automation.worksource.` service-key prefix
and SHALL retain ownership of the instance (a work-source carries lease state, so
it MUST be constructed once by its owner). The automation plugin SHALL collect
published descriptors LAZILY on every registry read, so plugin load order is
irrelevant, and a published id SHALL be accepted by `on.source` schema validation
exactly as a locally configured one is. A descriptor with a missing/empty id, a
value that is not a work-source, or a duplicate id SHALL be ignored with a
warning without affecting other descriptors. A source registered from the
automation plugin's own configuration SHALL win an id collision.

#### Scenario: A published source drives fan-out

- **WHEN** a plugin publishes `{ id, source }` under `automation.worksource.<name>`
- **AND** an automation declares `on: { kind: schedule.batch, cron, source: <id> }`
- **THEN** the automation SHALL validate as a known source
- **AND** a fire SHALL lease from that published source and spawn one child per leased item

#### Scenario: Registration is order-independent

- **WHEN** a descriptor is published AFTER the automation engine initialized
- **THEN** the next registry read SHALL resolve it (no restart, no re-registration)

#### Scenario: A malformed or duplicate descriptor is isolated

- **WHEN** several descriptors are published and one has an empty id, one is not a work-source, and one duplicates an accepted id
- **THEN** each invalid descriptor SHALL be ignored with a warning
- **AND** every valid descriptor SHALL still resolve

### Requirement: A work-source may vend asynchronously

A work-source's `next(n, ctx?)` MAY return either leased handles or a promise of
them, so a source whose availability lives behind an asynchronous port can
participate. The engine SHALL await an asynchronous vend. The widening SHALL be
strictly additive: a synchronous source SHALL satisfy the contract unchanged, and
`ctx` (carrying the firing automation's workspace, so one registered id can serve
several workspaces) MAY be ignored by an implementation.

For an asynchronous vend the engine SHALL write the parent occurrence record and
return its identity IMMEDIATELY (a manual run must yield a run id without
awaiting), and SHALL then settle that occurrence exactly once:

- an EMPTY vend SHALL spawn ZERO children and settle the occurrence `done`;
- a REJECTED vend SHALL leave NOTHING leased, spawn ZERO children, and settle the
  occurrence with an error;
- a child whose spawn fails after its item was leased SHALL return (nack) THAT
  item, leaving no item stranded and no occurrence counter unresolved.

#### Scenario: Asynchronous vend fans out

- **WHEN** a `schedule.batch` automation fires against a source whose `next` resolves three items
- **THEN** the engine SHALL spawn exactly three children, one per item, each bound to a DISTINCT item

#### Scenario: Empty asynchronous vend spawns nothing

- **WHEN** the vend resolves zero items
- **THEN** no session SHALL be spawned
- **AND** the occurrence SHALL settle `done` with zero children and release the automation's concurrency slot

#### Scenario: Rejected vend strands nothing

- **WHEN** the vend rejects
- **THEN** no session SHALL be spawned, nothing SHALL remain leased, and the occurrence SHALL settle with an error

#### Scenario: Failed spawn returns its item

- **WHEN** an item is leased and the spawn for its child fails
- **THEN** that item SHALL be nacked back to the source and the occurrence SHALL still settle

#### Scenario: A synchronous source is unaffected

- **WHEN** a source vends synchronously
- **THEN** its fan-out, empty-vend and vend-failure behaviour SHALL be unchanged

### Requirement: Targeted single-item run

The automation plugin SHALL expose starting EXACTLY ONE run for a single work
item addressed by its idempotency key, through the same child path a batch fire
uses (so the item rides `${{trigger}}` into the payload and the action `env`
resolves against it). It SHALL lease that item via the source's OPTIONAL
`take(key, ctx?)` and SHALL NOT enumerate or fan out.

The LEASE SHALL be the single-flight guard, in both directions: a key already
leased — whether by a batch fire or an earlier targeted run — SHALL be refused
with a distinct `in_flight` verdict and no second spawn, and an item leased by a
targeted run SHALL NOT be vended to a later batch fire. An automation with no
work source, or a source that does not implement `take`, SHALL report
`unsupported`. This capability SHALL be published on the cross-plugin service
board as `automation:runWorkItem(cwd, key)`, resolving the workspace's
`schedule.batch` automation and delegating to the engine; when none exists, or
the engine is not ready, it SHALL return a not-started verdict.

#### Scenario: One run for the named item

- **WHEN** a targeted run is requested for key `k` while other items are available
- **THEN** exactly one child SHALL be spawned, bound to `k`, with `k` resolved in both the payload and the action `env`
- **AND** no child SHALL be spawned for any other item

#### Scenario: A leased item is refused

- **WHEN** a targeted run is requested for a key that already holds a live lease
- **THEN** the request SHALL be refused `in_flight` and no second session SHALL be spawned

#### Scenario: The guard is shared with batch fan-out

- **WHEN** a batch fire holds a lease for `k` and a targeted run is requested for `k`
- **THEN** the request SHALL be refused `in_flight`
- **AND** when a targeted run holds `k`, a later batch fire SHALL NOT dispatch `k` again

#### Scenario: A source without targeted lease reports unsupported

- **WHEN** a targeted run is requested against an automation with no work source, or a source that cannot address items by key
- **THEN** the request SHALL report `unsupported` and spawn nothing

### Requirement: Per-run action env forwarding

An automation action payload MAY carry an `env` map. For each spawned child the
engine SHALL resolve that map with the SAME per-fire substitution as the rest of
the payload (so a fan-out child's env is scoped to ITS work item) and SHALL
forward the result to the spawn as an arbitrary, NON-namespaced string map, which
the host folds beneath its own guard-managed keys (a guard-managed key wins a
collision). An action with no `env` map SHALL spawn with unchanged env.

The keys are opaque to the automation plugin: a consumer may use them for profile
selection OR for authorization narrowing, and dropping, renaming or namespacing
the channel fails OPEN (a wider surface, no error and no failing assertion). The
forwarding is therefore a required behaviour, not an optimization.

#### Scenario: Env resolved per child

- **WHEN** a fan-out action declares `env: { PROFILE: "scoped", ITEM: "${{trigger}}" }` and three items are vended
- **THEN** each spawn SHALL carry `env.PROFILE` = `"scoped"` and `env.ITEM` equal to ITS OWN item

#### Scenario: No env map, no env change

- **WHEN** an action declares no `env` map
- **THEN** the spawn SHALL carry no caller-supplied env

### Requirement: Queued-invoice work source

The invoicebot plugin SHALL register a work source over the InvoiceEngine's
queued-invoice list, through the generic registration seam, and SHALL own its
instance. It vends invoice ids, so ONE leased handle is ONE invoice and therefore
ONE spawned session is bound to exactly one invoice, ALWAYS.

The source SHALL:

- lease up to `n` DISTINCT queued invoices per vend, so concurrent children of
  one fire never race for the same record;
- carry each invoice's OWN id as the `idempotencyKey` (never the lease token), so
  a redelivered invoice is recognisably the same work;
- NEVER re-vend an invoice that holds a live lease, and refuse a targeted
  `take` for it — the single-flight guarantee, shared by the scheduled drain and
  a run-this-invoice-now request;
- vend ZERO handles when no invoice is queued (so no session is spawned at all)
  and when the engine supplies no workspace (rather than guessing one);
- leave the excess unleased when more invoices are queued than the bound allows,
  deferring them to a later fire;
- release an invoice on `nack` (making it immediately dispatchable again), drop
  the lease on `ack`, and treat a stale/unknown lease token as a no-op;
- reclaim a lease whose visibility window elapsed, so an invoice whose run died
  without any terminal signal is never stranded.

Read failures of the underlying queued list SHALL yield an empty vend (never a
throw, never a spawn).

#### Scenario: One session per invoice, each distinct

- **WHEN** three invoices are queued and a fire leases three items
- **THEN** three handles SHALL be vended, one per invoice, all distinct
- **AND** each handle's idempotency key SHALL be its invoice id

#### Scenario: Empty queue spawns nothing

- **WHEN** no invoice is queued
- **THEN** the vend SHALL be empty and the fire SHALL spawn no session

#### Scenario: An in-flight invoice is never dispatched twice

- **WHEN** an invoice holds a live lease
- **THEN** a later vend SHALL NOT include it
- **AND** a targeted `take` for it SHALL be refused

#### Scenario: Bound respected, excess deferred

- **WHEN** three invoices are queued and the bound is two
- **THEN** two SHALL be leased and the third SHALL remain queued for a later fire

#### Scenario: A dead run releases its invoice

- **WHEN** a leased invoice's run finalizes with any non-`done` status, or its lease expires without a terminal signal
- **THEN** the invoice SHALL become dispatchable again

### Requirement: Per-invoice run parallelism is a deployment setting

The number of invoices processed concurrently per fire SHALL be the automation
plugin's spawn bound: the automation's own `maxConcurrentSpawns` when declared,
else the dashboard setting, else the `PI_AUTOMATION_MAX_CONCURRENT_SPAWNS`
environment value, else the built-in default. The deployed intake automation
SHALL NOT declare its own bound, so the deployment environment governs.

#### Scenario: Environment-supplied bound caps the fan-out

- **WHEN** the effective bound is two and three invoices are queued
- **THEN** exactly two sessions SHALL be spawned for that fire
- **AND** the third invoice SHALL be leased by a later fire

### Requirement: Deployed intake automation is migrated on touch

A deployed intake `automation.yaml` is authored by the invoice engine and, once
written, is never rewritten by it — so a deployed workspace would keep the
retired fan-out shape and silently stop draining. The invoicebot plugin SHALL
therefore migrate it IN PLACE, on the same first-touch path that ensures it
exists, and SHALL be the party that does so (the automation plugin must not learn
the retired invoice vocabulary).

The migration SHALL convert the trigger to `on: { kind: schedule.batch, cron, source }`
naming the queued-invoice source, remove the retired payload discriminator, and
rewrite the retired per-invoice token to `${{trigger}}` throughout the payload —
including the `env` map, whose keys SHALL all survive because that map is
authorization-bearing. The `cron` cadence, comments, and every unrelated field
SHALL be preserved, the result SHALL be re-validated before replacing the file,
and the write SHALL be atomic. The migration SHALL be IDEMPOTENT (an
already-migrated file is left byte-identical), SHALL leave a file that is not the
retired shape untouched, and SHALL degrade quietly (never fail a request) on an
absent or unparseable file.

#### Scenario: Legacy automation migrated

- **WHEN** a workspace is touched and its intake automation still declares the retired schedule + per-invoice payload shape
- **THEN** its trigger SHALL become `schedule.batch` naming the queued-invoice source
- **AND** the retired discriminator SHALL be gone, the retired token SHALL be replaced by `${{trigger}}`, and the cron, comments, env keys and all other fields SHALL be preserved

#### Scenario: Migration is idempotent

- **WHEN** an already-migrated automation is touched again
- **THEN** the file SHALL be left byte-identical

#### Scenario: Unrelated automation untouched

- **WHEN** the file is not the retired shape, is absent, or does not parse
- **THEN** no rewrite SHALL occur and the touch SHALL still succeed

### Requirement: Run settling bounds are domain-free

A child run that never reached delivery SHALL be finalized as an error and its
concurrency slot freed once it passes the undelivered bound, and a DELIVERED
event-dispatched child (one whose action declared a completion event) SHALL be
finalized as an error once it goes quiet past the stall bound, with its spawned
process terminated in both cases. Observed session activity SHALL reset the stall
clock. A delivered PROMPT-dispatched child SHALL NOT be subject to the stall
bound. Parent occurrence records SHALL NOT be swept by either bound — a parent
settles solely via its child counter.

#### Scenario: Undelivered child does not starve the schedule

- **WHEN** a child's stamped session never registers and the undelivered bound elapses
- **THEN** that child SHALL be finalized as an error, its process terminated, and the automation's slot freed for the next fire

#### Scenario: A live event run is not reaped

- **WHEN** a delivered event-dispatched child keeps producing observed activity
- **THEN** it SHALL NOT be reaped, and it SHALL still settle normally on its real completion

#### Scenario: A delivered prompt run may think long

- **WHEN** a delivered prompt-dispatched child is quiet well past the stall bound
- **THEN** it SHALL be left untouched
