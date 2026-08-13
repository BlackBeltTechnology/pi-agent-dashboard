# Keep the model selector openable when the catalogue is empty

## Why

`ModelSelector` computes `hasModels = !!models && models.length > 0` and then renders the
trigger as `onClick={() => hasModels && setOpen(!open)}` with `disabled={!hasModels}`
(`packages/client/src/components/settings/ModelSelector.tsx:139,310,316`). With an empty
catalogue the control cannot be opened at all.

That interacts badly with how the catalogue is delivered: models are pushed at session start.
An operator who configures a provider **after** the session started sees an empty list, a dead
button, and no way forward — the session appears to have no models and never recovers.

The recovery action already exists but is unreachable in exactly this state:

- change `reload-models-on-selector-open` (treated here as **already applied**) makes opening
  the dropdown request a fresh model list — but opening is what's disabled;
- the manual ↻ refresh control lives **inside** the popover footer
  (`ModelSelector.tsx:408`), so it is behind the same closed door.

Net: the empty state is the one state where refresh matters most, and the only state where
every refresh affordance is unreachable.

## What Changes

- **Always openable.** The trigger SHALL no longer be `disabled` when the model list is empty.
  Opening with an empty catalogue is allowed.
- **Explicit empty state.** An opened-but-empty popover SHALL show an empty state (refreshing /
  "no models found") together with the refresh control, instead of an empty pane or a dead button.
- **Open triggers the refresh in the empty case.** The existing reload-on-open transition SHALL
  fire when the list is empty too (once per open transition, not per render), so the operator's
  first click is the recovery action: configure provider → open selector → catalogue re-fetched
  → models appear without restarting the session.

**Out of scope (follow-ups):**
- Changing *when* the bridge pushes `models_list` beyond the open-triggered refresh already
  covered by `reload-models-on-selector-open` (e.g. pushing on provider save).
- Redesigning the selector's loading/empty visual language beyond a minimal empty state.
- Removing the manual ↻ control.

## Capabilities

### Modified Capabilities

- `model-selector`: the trigger is openable with an empty catalogue (currently `disabled` when
  `models.length === 0`), an opened-empty popover renders an empty state plus the refresh
  control, and the reload-on-open transition fires in the empty case.

## Impact

- `packages/client/src/components/settings/ModelSelector.tsx` — drop the `hasModels` disable on
  the trigger; empty-state body; ensure the open-transition refresh runs when the list is empty.
- Tests: `packages/client/src/components/__tests__/ModelSelector.test.tsx` — openable with
  `models: []`; empty state rendered with the refresh control; open transition fires the refresh
  exactly once.
- Additive and reversible. No server, extension, or protocol change. No behaviour change once a
  catalogue is populated.
- Depends on `reload-models-on-selector-open` being applied (this change assumes the
  reload-on-open transition exists and only extends it to the empty case).

## Discipline Skills

- `review-code` — non-trivial client component change before commit.
