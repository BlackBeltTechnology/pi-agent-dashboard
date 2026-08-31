## Why

Automation fan-out today lets one fire spawn N children, but every child is
handed the **same** input (a whole folder or a single per-fire trigger value)
and independently discovers its own work. When several children scan the same
folder they all select the **same** item and process it multiple times — a
correctness defect for non-idempotent actions (e.g. an invoice that gets paid
N times). Selection lives in the child; it must live in the trigger.

This change moves work selection into the trigger via a generic, ack-able
**work-source** (the competing-consumers pattern): the trigger resolves and
leases a **distinct** item per child before spawn and injects it through the
**existing `${{trigger}}` templating seam**. No two children — of the same fire
or of overlapping fires — ever receive the same item, and a crashed child's
item is automatically reprocessed.

## What Changes

- Add a generic **work-source contract** (`next` / `ack` / `nack` with a
  visibility-timeout lease) that vends distinct, leased work items. The
  automation engine speaks only this contract and carries **no domain
  vocabulary** — a folder, a queue, or a DB table all implement it behind a
  registered source id.
- Add a **`schedule.batch` trigger kind**: on a cron tick it asks the named
  work-source for up to *bound* available items and fans out **one child per
  leased item** (dynamic width). Existing `schedule` and `file` triggers are
  unchanged.
- **Route selection through the trigger, not the child.** The engine resolves +
  leases items once per fire and injects each child's item into that child's
  `${{trigger}}` token (per-child, replacing the current per-fire single value).
  The child's action processes exactly the injected item and performs no
  discovery.
- **BREAKING (spec-level, opt-in): the bound now defers, not drops.** For a
  work-source fan-out, items beyond `maxConcurrentSpawns` are **left available
  for the next fire** instead of truncated-with-warning. Excess work is never
  discarded. (The legacy `count`/`actions` static fan-out keeps its
  truncate-and-warn behavior; only work-source fan-out defers.)
- Add **lease lifecycle**: a leased item excludes itself from concurrent/next
  resolution while its lease is valid; a child that dies or fails **releases** its
  lease (visibility-timeout expiry or explicit `nack`) so a later fire
  redispatches it. The engine delivers **at-least-once** with single-valid-lease
  distinctness and injects a **stable per-item idempotency key**; exactly-once
  for a non-idempotent action (e.g. a payment) is sealed by the action being
  idempotent on that key — the engine cannot fence an opaque action's side
  effect on its behalf.
- Empty resolution (source vends zero items) **fast-fails**: no child is
  spawned and the fire settles as a completed no-op.

## Capabilities

### New Capabilities
- `automation-work-source`: the generic vend/ack/nack lease contract, the
  work-source registry (named sources), and the resolve-and-lease-before-spawn
  path the engine drives. Domain-free; concrete sources register behind it.

### Modified Capabilities
- `automation-fanout-spawn`: the existing "Concurrent spawns per fire SHALL be
  bounded" requirement changes for work-source fan-out from **truncate-and-warn**
  to **claim-up-to-bound-and-defer-the-rest**; a new requirement makes trigger
  the owner of distinct per-child item selection (children perform no
  discovery); and the per-fire `${{trigger}}` substitution becomes per-child.

## Impact

- **Code**: `packages/automation-plugin/src/server/` — new `work-source-registry`
  + `schedule-batch-trigger`; `engine.ts` dispatch (per-child `${{trigger}}`
  value, defer-excess); `resolve-children.ts` (vend-and-lease path alongside the
  static count expansion); `trigger-registry.ts` (`FireContext` gains a per-child
  resolver); `automation-schema.ts` (`on.kind: schedule.batch` + `on.source`).
  `interpolate.ts` is **reused unchanged** — no new templating.
- **Config**: `automation.yaml` gains `on.kind: schedule.batch` + `on.source`;
  `maxConcurrentSpawns` becomes the per-fire lease bound (sourceable from
  deployment config incl. Docker `.env`, falling back to the dashboard default).
- **No impact** on the action side: actions remain fully detached from the
  automation engine and receive their (now per-child) payload as an opaque bag.
- **Back-compat**: existing `schedule`/`file` automations and static
  `count`/`actions` fan-out are unchanged.

## Discipline Skills

- `doubt-driven-review` — the single-flight lease invariant ("no two children,
  across concurrent or overlapping fires, ever hold the same item") is the load-
  bearing correctness claim and an irreversible-by-double-payment risk; stress-
  test it before it stands.
- `systematic-debugging` — lease races (concurrent fires, expiry-vs-ack timing,
  release-on-death) are the classic flaky-under-concurrency surface; root-cause
  evidence-first rather than guessing.
- `observability-instrumentation` — the vend → lease → ack/nack/expiry lifecycle
  is opaque runtime state; instrument each transition so a stranded or
  double-vended item is diagnosable in production.
