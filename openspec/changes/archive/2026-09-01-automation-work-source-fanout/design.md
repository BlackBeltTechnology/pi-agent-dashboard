## Context

The automation plugin already fans out one trigger fire into N child sessions
(`add-automation-concurrent-spawn`, shipped). Today children are homogeneous
copies (`count`) or per-`actions:` entries, and each child is handed the same
input — a folder or a single per-fire `${{trigger}}` value — then **discovers
its own work**. Parallel children scanning the same source select the same item
and process it multiple times.

Three seams already exist and are reused unchanged in shape:

- **Templating** — `interpolate.ts` resolves the single `${{trigger}}` token in
  an action's `payload`. One token, whole-value or embedded. Not a general
  expression language; no new templating is added.
- **Per-fire value** — `FireContext.value` carries one value per fire (the file
  trigger's path; absent for `schedule`), substituted into `${{trigger}}` at
  dispatch in `buildRunDispatch`.
- **Extensible triggers** — `trigger-registry.ts` registers trigger kinds
  (`schedule`, `file`); new kinds plug in without churning `automation.yaml`.

The engine is domain-free today (`grep invoiceId engine.ts` = 0). This change
must keep it so: selection logic and item vocabulary live behind an injected
seam, never in the engine.

## Goals / Non-Goals

**Goals**
- One fire → N children, each bound to a **distinct** work item, with no
  double-processing across concurrent children or overlapping fires.
- A crashed/failed child's item is automatically reprocessed on a later fire.
- Excess work beyond the concurrency bound is **deferred**, never dropped.
- The engine references items only through a generic seam; no domain literals.
- Reuse the `${{trigger}}` token verbatim — authors keep writing
  `input: "${{trigger}}"`.

**Non-Goals**
- Not changing the action side. Actions stay fully detached and receive an
  opaque payload.
- Not adding a general template/expression language.
- Not changing the legacy `count` / `actions:` static fan-out semantics
  (those keep truncate-and-warn). Only work-source fan-out defers.
- Not implementing concrete production sources here beyond what the automated
  scenarios need (a folder-backed reference source suffices for tests).

## Decisions

### D1 — Coordination model: competing-consumers lease with a fenced ack

The engine talks to a generic **work-source** with a message-queue consumer
contract and a visibility-timeout lease. Leasing hands back a **handle**, not a
bare item, so acknowledgement can be fenced:

- `next(n)` → up to `n` **leased handles** `{ item, leaseToken }`, each reserved
  so no other child/fire can receive that item while the lease is held.
- `ack(leaseToken)` → mark the item done, **conditional on the token still being
  the current lease**. An `ack` presented with a stale/expired token is a no-op.
- `nack(leaseToken)` → return the item to the available pool, **also conditional
  on the token being current** (a stale-token `nack` is a no-op, so a slow child
  cannot recall an item already re-vended to another). Lease expiry returns the
  item regardless.

**Distinctness invariant, stated precisely (corrects two over-claims).** The
guarantee is **no two *concurrently-valid* leases on one item** — NOT "the same
item id is never handed out twice across all time." Under lease expiry a slow
child's item is deliberately re-vended to a second child; that is the crash-
recovery path, not a violation. At any instant at most one lease is valid.

**Exactly-once is a JOINT property of engine + action — the engine alone cannot
deliver it for an opaque action (corrects the central over-claim).** A
visibility-timeout lease gives *at-least-once* delivery: a child can stall past
expiry, get its item re-vended, then wake and finish — double-processing. Because
actions are **fully detached and opaque** (the engine injects a payload and
cannot see inside or atomically coordinate the action's external side effect),
the engine **cannot** fence the action's terminal commit. It can only:

1. deliver **at-least-once** with single-valid-lease distinctness, and
2. inject a **stable per-item idempotency key** (derived from the item identity /
   lease) alongside `${{trigger}}`, that the action forwards to its downstream
   resource.

Exactly-once is then achieved by the **action being idempotent on that key** — a
fencing token / idempotency key checked atomically **at the side-effect resource**
(the payment API's idempotency key, a DB unique constraint), which is the only
place the generation check can be atomic with the commit. This is the industry
position (Stripe idempotency keys; Kleppmann fencing tokens): the queue reduces
the duplicate window and owns distribution + crash recovery; the consumer's
idempotency seals exactly-once. The engine therefore **promises at-least-once +
a stable idempotency key**, and documents that exactly-once requires an
idempotent action. Where an action is neither idempotent nor fenceable, the
residual double-fire window MUST be documented for that source — the engine does
not silently promise exactly-once it cannot deliver. This is the load-bearing
correctness decision and the primary target of doubt-review.

**Why over alternatives:**
- *Hard lock* — needs a manual reaper and can strand items forever on crash.
  Lease + visibility-timeout auto-recovers. ✓
- *Partition (`hash % N`)* — zero shared state, but breaks when overlapping
  fires resolve different N over an overlapping set → collision. ✗
- *Offset/cursor (Kafka-style)* — needs an ordered append-only log; a folder of
  deletable files is unordered and any-order. ✗
- *Idempotent + at-least-once (no lock)* — simplest, but assumes the action is
  idempotent. Target actions include real payments (not idempotent), so this is
  unsafe to assume. Rejected as the default; a provider MAY still be
  idempotent-backed, but the engine does not depend on it. ✗ as default.

"Claim" is thus expressed at the right altitude: `next/ack/nack` is the frozen
contract; "lease-by-rename", "lease table", "SKIP LOCKED", or "queue pop" are
provider implementations of it.

### D2 — Selection moves to the trigger; child does no discovery

The engine resolves + leases items **once per fire** before spawn and injects
each child's item into that child's dispatch. The child processes exactly its
injected item. This is what eliminates the collision at the root: one dealer,
N hands — intra-fire distinctness is free; the lease covers cross-fire + crash.

### D3 — Injection reuses `${{trigger}}`, upgraded per-fire → per-child

`buildRunDispatch` currently interpolates one `FireContext.value` for the whole
fire. It changes to resolve a **per-child** value (the child's leased item). No
new syntax: `interpolate.ts` is called once per child with that child's item.

### D4 — New `schedule.batch` trigger kind; dynamic width; single action only

`schedule.batch` fires on cron, then asks its `on.source` work-source for up to
*bound* items and spawns **one child per leased item**. Width is dynamic (= items
vended, capped by `maxConcurrentSpawns`); `count` is not used for this kind.
Existing `schedule` and `file` kinds are untouched.

**A `schedule.batch` automation requires exactly one `action:`** (the work to do
per item). `actions:` and `count` are **rejected at parse** for this kind —
pairing M actions × N items is a combinatorial, semantically ambiguous product
(replicate per item? zip? cross?) with no use case here. One item → one child
running the single action with that item injected. This resolves the
`actions[]×count`-vs-item ambiguity the review flagged.

### D4b — Manual run-now of a batch automation also vends from the source

Manual "run now" calls `startRunFor` directly, bypassing trigger arming. For a
`schedule.batch` automation a manual run MUST still resolve + lease from the
`on.source` (leasing up to the bound, same path as a scheduled fire) — it does
NOT spawn an item-less child. An empty source on a manual run is the same no-op
fast-fail as a scheduled fire.

### D4c — Lease acquisition happens AFTER the concurrency-policy decision

Leasing MUST occur only for a fire that actually proceeds to spawn. A fire
dropped by the automation's `concurrency: skip` (overlapping parent still
running) or deferred by `queue` MUST lease **nothing** — otherwise a skipped
fire would hold leases with no child to `ack`/`nack` them, stranding items until
visibility-timeout expiry. Order: evaluate concurrency policy → (proceed) →
`next()` → spawn; never `next()` before the policy gate.

### D4d — Ack on success, nack on failure, from terminal run status

The engine finalizes a child today by session termination alone, with no
success/failure distinction. The lease decision needs one: a child that reaches
terminal status **`done`** → `ack` (drop the item); **`error`** or **`stopped`**,
or death before a terminal status → `nack` (return the item). Release MUST be
wired into every existing finalize path — `finalizeChild`, `stopChild`,
`onSessionDeath`, the stale-run reaper, and the pre-register spawn-failure guard
— not only the happy path. Visibility-timeout expiry is the backstop when even
`nack` is missed.

### D7 — Work-source registration seam (was open)

Work-sources register through a **dedicated `work-source` contribution point**,
mirroring `trigger-registry.ts` (a `WorkSourceRegistry` keyed by source id),
not the action/trigger seam. `automation-schema.ts` validates `on.source`
against registered source ids at parse (unknown source id → isolate the
automation, same as an unknown trigger kind). The `schedule.batch` trigger kind
registers in `trigger-registry.ts` alongside `schedule`/`file`.

### D5 — Bound defers, does not truncate (work-source path only)

For work-source fan-out the engine leases **at most** `maxConcurrentSpawns`
items and leaves the rest **unleased and available**, so the next fire drains
them. The legacy static `count`/`actions` path keeps its existing
truncate-and-warn behavior (no work-item concept there to defer).

### D6 — Bound is deployment-configurable, with defined precedence

`maxConcurrentSpawns` resolves by precedence **per-automation value → deployment
`.env` default → dashboard-settings default (4)**. The `.env` key is
`PI_AUTOMATION_MAX_CONCURRENT_SPAWNS`, read by the plugin config layer
(`index.ts`) and threaded into `EngineConfig`, so the Docker deployment can raise
the floor without editing dashboard settings. The bound is **per-fire**; see the
global-concurrency trade-off below.

## Risks / Trade-offs

- **[Lease race under overlapping fires]** two fires call `next()` concurrently
  and could double-lease the same item → **Mitigation**: `next()` is
  single-flight/atomic at the source (e.g. atomic rename; `SKIP LOCKED`); the
  contract requires it and the L1 tests assert it under concurrency.
- **[Stranded lease on crash]** a child dies mid-item and never `ack`/`nack`s →
  **Mitigation**: visibility-timeout expiry auto-releases; a later fire
  reprocesses. Tested via forced child death.
- **[Clock/expiry vs late ack]** an item's lease expires, it is re-vended, then
  the original slow child `ack`s → double-process → **Mitigation**: `ack` is
  fenced on the lease token (D1); a stale token's `ack` is a no-op. For a
  non-idempotent action the terminal side effect must itself be lease-fenced, or
  the guarantee is at-least-once (documented per source).
- **[Global concurrency across overlapping parallel fires]** `maxConcurrentSpawns`
  bounds spawns **per fire**; with `concurrency: parallel`, two overlapping fires
  can each spawn up to `bound`, so total live children may reach `2×bound` →
  **Trade-off accepted**: the *correctness* invariant still holds (leasing keeps
  every item distinct and processed once regardless of how many fires overlap);
  only the *resource* bound is per-fire. Invoice-style automations use
  `concurrency: skip`, so overlap does not arise. A global cap is out of scope;
  documented so an operator choosing `parallel` understands the multiplier.
- **[Deferral liveness]** "defer to the next fire" assumes a next fire occurs;
  cron downtime, a disabled/removed automation, or a paused schedule leaves
  deferred items unprocessed → **Mitigation**: deferred items are **not lost** —
  they persist unleased in the source and are drained whenever firing resumes.
  Liveness (not safety) depends on the schedule continuing; this is inherent to
  a scheduled drain and acceptable.
- **[Source resolution error]** `next()` throws (folder unreadable, DB down) →
  **Mitigation**: the fire settles as **errored, leasing nothing** and spawning
  no child; no partial lease is leaked. The next fire retries.
- **[Behavior split]** two bound semantics (defer for work-source, truncate for
  static) risk author confusion → **Mitigation**: the split is keyed on trigger
  kind and documented; only `schedule.batch` defers.

## Migration Plan

Additive and opt-in. Existing automations keep working: `schedule`/`file`
triggers and static `count`/`actions` fan-out are unchanged. A team adopts the
new behavior only by writing `on.kind: schedule.batch` + `on.source`. Rollback =
revert the change; no persisted-state migration (leases are transient runtime
state owned by each source).

## Open Questions

- **Reference-source fencing mechanism**: the *contract* is fixed (fenced ack,
  D1) but the folder-backed reference source's concrete fence — lease file with a
  monotonic token vs. rename-into-`inflight/<token>/` — is an implementation
  choice to settle when the source is built. Both satisfy "stale-token `ack` is a
  no-op"; pick during apply.
- **Whether a production (non-reference) source ships in this change** or the
  folder reference source is the only concrete source for now (leaning:
  reference-only; production sources are follow-ups behind the stable contract).
