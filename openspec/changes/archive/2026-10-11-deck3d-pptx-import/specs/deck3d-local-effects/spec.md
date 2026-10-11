## MODIFIED Requirements

### Requirement: Runtime isolation and error containment
Inside a local module these identifiers SHALL evaluate to `undefined`: `window`, `document`, `globalThis`, `self`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Image`, `Worker`, `WebAssembly`, `navigator`, `location`, `localStorage`, `sessionStorage`, `indexedDB`, `postMessage`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask`, `Promise`, `Date`, `performance`, `crypto`, `eval`, `Function`, `importScripts`. `Math.random` SHALL return the deck's seeded per-slide generator, so a module using it is deterministic across loads.

The module receives `params` and `ctx = { THREE, palette, mode, quality, rng, slide: { id, title, kind }, assets }`. `assets.get(id)` SHALL return the decoded deck asset (bitmap, parsed JSON or text; see deck3d-slide-layers) synchronously, and SHALL throw for an unknown id. `assets` SHALL be read-only.

A throw from `create`, `tick` or `dispose` SHALL disable that effect for that slide only, leave the slide rendering, and be recorded as `{ slide, effectId, phase }` in `window.__deck3d.effects().errors`. This isolation is a determinism/offline guardrail, not a security boundary.

#### Scenario: Effect throws in tick
- **WHEN** a local effect's `tick` throws on the third frame
- **THEN** the slide's title, bullets and other effects keep rendering and `__deck3d.effects().errors` contains `{ slide: "<id>", effectId: "local:<name>", phase: "tick" }`

#### Scenario: Deterministic random
- **WHEN** a local effect scatters 200 points with `Math.random()`
- **THEN** the point positions are identical on every load of the same deck

#### Scenario: Timer unavailable
- **WHEN** a local effect calls `setTimeout(...)`
- **THEN** it throws a TypeError, is disabled for that slide with `phase: "create"`, and no timer is scheduled

#### Scenario: Asset read from a local effect
- **WHEN** a local effect calls `ctx.assets.get("icon-mic")` for an image asset listed in `overrides.assets`
- **THEN** it receives a decoded bitmap synchronously, and the module source stays under the 64 KiB cap

#### Scenario: Unknown asset id
- **WHEN** a local effect calls `ctx.assets.get("nope")` in `create`
- **THEN** the effect is disabled for that slide with `phase: "create"` and the slide keeps rendering
