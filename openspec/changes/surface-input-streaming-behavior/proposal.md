# Proposal — surface-input-streaming-behavior

> **Status: stub.** Scaffolded alongside `bump-pi-compat-to-0-78` to track the
> follow-up. Do not implement until the 0.78 pin bump has merged and the
> design decision below ("status row vs. inline badge") is settled.

## Why

Pi 0.77 added an optional `streamingBehavior?: "steer" | "followUp"` field to `InputEvent`:

- `undefined` → user input arrived while the agent was idle
- `"steer"` → user input arrived mid-stream; pi will interrupt the current generation
- `"followUp"` → user input arrived mid-stream; pi will queue the input for after the current generation

The dashboard already receives this field today via the schema-blind pass-through pipeline:

```
pi InputEvent
  → bridge passThroughEventTypes (bridge.ts:1144)
  → mapEventToProtocol (event-forwarder.ts:25, serializes ALL fields)
  → server forwards opaque
  → client reducer renders as `rawEvent` JSON card (no `input` handler)
```

Once the dashboard is on pi ≥ 0.77 (via `bump-pi-compat-to-0-78`), `streamingBehavior` is **already visible** to the user — buried inside the expandable JSON of a rawEvent card. This proposal upgrades that from "data flows" to "user can tell at a glance whether their message interrupted or queued behind the current turn."

Concrete user value: in dashboard workflows where the user types a follow-up while the agent is mid-tool-call (common during long flows), the transcript currently gives no signal about whether the message will steer or queue. The bridge already knows; surfacing it removes a class of "why didn't my message take effect immediately?" confusion.

## What Changes

> The exact UI shape is a **design.md open question** (see Decision 1 stub
> below). Two competing shapes — status row vs. user-message badge — have
> different scopes. tasks.md is left empty until the shape is chosen.

### Option A — Status row (smaller, recommended starting point)

- **MODIFY** `packages/client/src/lib/event-reducer.ts`: add a handler for `eventType === "input"`. When `data.streamingBehavior` is `"steer"` or `"followUp"`, append a new `ChatMessage` of role `"systemNote"` (or similar typed status row) with the appropriate label. When `streamingBehavior` is `undefined`, skip the input event entirely — the subsequent `message_start { role: "user" }` already covers it.
- **MODIFY** `packages/client/src/components/...` rendering for the new typed status row.
- **ADD** reducer tests for both `streamingBehavior` values + the idle skip.

### Option B — Inline badge on user-message row (bigger, deferred)

- **MODIFY** reducer to correlate the `input` event with the next `message_start { role: "user" }` and stamp `streamingBehavior` onto the user-message row.
- **MODIFY** user-message UI component to render a "(steered)" / "(queued)" badge with a tooltip.
- **MODIFY** protocol types (optional) to give the field a stable type on `ChatMessage`.
- **ADD** correlation tests covering input arriving before / after / orphaned-from message_start.

## Open design questions

1. **Status row vs. inline badge** — A keeps reducer state simple (no correlation), B is the higher-fidelity UX. Pick before tasks.md.
2. **Show on `source: "rpc"` / `source: "extension"` inputs?** — InputEvent fires for all sources, not just interactive user typing. The dashboard transcript probably only wants to surface `source: "interactive"` to avoid noise from extension-driven inputs. Confirm in design.md.
3. **Idle inputs (streamingBehavior undefined)** — show no annotation at all, or a faint "(typed while idle)" affordance? Default: no annotation (matches today's UX).
4. **Reconciliation with the existing rawEvent card** — once the reducer handles `input` explicitly, the rawEvent JSON card disappears for that event type. Confirm no downstream tests depend on its presence.

## Capabilities

### Modified Capabilities

- `event-reducer`:
  - The reducer SHALL recognize `eventType === "input"` from pi 0.77+ and render `streamingBehavior` non-idle states (`"steer"`, `"followUp"`) as user-visible state in the transcript. Exact rendering (status row vs. user-message badge) is decided in design.md.

## Impact

- **Code**: 2–4 files in `packages/client/src/lib/` and `packages/client/src/components/` depending on chosen shape.
- **Tests**: reducer test additions for `input` event handling.
- **Migration**: depends on `bump-pi-compat-to-0-78` merging first — `InputEvent.streamingBehavior` is undefined on pi ≤ 0.76 and the reducer must tolerate `undefined` gracefully (it should anyway since the field is optional in the type).
- **Bridge**: no change — pass-through already carries the field.
- **Protocol**: no change unless Option B's typed `ChatMessage.streamingBehavior` is preferred.

## Dependencies

- **Blocks on**: `bump-pi-compat-to-0-78` (the floor needs to be ≥ 0.77 for the field to be populated). Without the bump, the reducer code runs but the field is always `undefined` — harmless dead path, but the value-add is zero.
