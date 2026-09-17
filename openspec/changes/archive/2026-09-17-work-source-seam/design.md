# Design — work-source seam

## Context

`develop` already ships the base work-source fan-out
(`automation-work-source-fanout`): `WorkSourceRegistry`, the `schedule.batch`
trigger, and the engine's fan-out path. What is missing is the **cross-plugin**
half — a plugin outside `automation` cannot register a source — plus a targeted
single-item run. This change adds both, and makes `/list` validate against the
live registries.

## Change surface (against `origin/develop`)

| File | Delta | Method |
|---|---|---|
| `server/work-source-contributions.ts` | NEW (+78) | new collector |
| `server/work-source-registry.ts` | +54 / −8 | provider path added |
| `shared/work-source.ts` | +54 / −7 | `WorkSourceContext` + `take` |
| `server/routes.ts` | +16 / −4 | `FALLBACK_KINDS` + live hooks |
| `server/index.ts` | +81 / −0 | `consumeAll` wire + route hooks + `runWorkItemViaEngine` |
| `server/engine.ts` | +90 / −0 | `runWorkItem` (additive) |
| `server/scanner.ts` | 0 | already on develop |
| `server/automation-schema.ts` | 0 | already on develop |

## The engine.ts change (the only non-trivial part)

`develop` ships `detach-automation-goal-from-core` (PR #618), which rewrote
`SpawnLike` and the child-spawn call:

```
OLD shape (pre-detach):
  automationRun?: { name, runId, visibility, idempotencyKey }
  spawnSession({ ..., automationRun: {...} })

CURRENT shape (develop today, MUST be preserved):
  name?: string
  pluginRef?: Record<string, unknown>          // { kind, automationRun, lifecyclePolicy }
  lifecycle?: { recover?, finalizeOnSocketClose? }
  spawnSession({ ..., name, pluginRef: {...}, lifecycle: {...} })
```

So the engine change is **additive only** — no spawn-shape edit:

- add `runWorkItem` to the `Engine` interface, implement the function, and export
  it in the returned object;
- thread the `WorkSourceContext` (`{ cwd }`) at lease time;
- **keep the `name` / `pluginRef` / `lifecycle` spawn shape untouched** —
  `runWorkItem` spawns through the SAME `spawnChild` path as a batch fire, so it
  inherits the correct spawn stamp for free.

`next` stays synchronous (the batch path is unchanged); only the optional
targeted `take` may return a promise, which `runWorkItem` awaits. This keeps the
change free of any propagation into `startWorkSourceFire`.

`noteRunActivity` and the stall-reaping timers belong to a separate change
(`bound-stalled-event-run-settle`) and are **out of scope** here.

## Doctrine applied

Mirrors `automation-action-registry` / `automation-folder-scope-contribution`:
owner (automation) owns the *mechanism* (registry, collector, dispatch);
contributor (any plugin) owns the *payload* (its lease-stateful source instance);
collect lazily at read time so load order is irrelevant; validate each
contribution structurally and fail-open. Neither side imports the other.

## Verification

Two unit suites are the guard:
- `work-source-registration-seam.test.ts` — late publish, duplicate/malformed
  drop, throwing-provider isolation, local-wins-collision.
- `run-work-item.test.ts` — one child for the named item, `in_flight` refusal on
  a live lease, `unsupported` without `take`, lease released on dead run, guard
  shared with batch fan-out.

Plus the existing `work-source-fanout` suite on develop must stay green.
