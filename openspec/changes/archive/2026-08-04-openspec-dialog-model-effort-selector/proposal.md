## Why

Choosing which model and thinking effort runs an OpenSpec workflow is a deliberate decision — `openspec-explore` benefits from a high-reasoning model, a routine `new-change` scaffold does not. Today that choice lives only in the composer toolbar, far from the OpenSpec dialogs, so users either forget to set it and burn a run on the wrong model, or abandon the dialog, change the model, and reopen it. The dialogs already collect every other parameter for the run; the model and effort belong in the same place.

## What Changes

- Add a **run-config row** to the footer of `ExploreDialog`, `ProposeDialog`, and `NewChangeDialog`: a model selector plus a thinking-effort selector, always visible, defaulting to the session's current values.
- Changing either control is **sticky** — it sets the session's model / thinking level via the existing `set_model` / `set_thinking_level` messages, exactly as the composer toolbar does. It is not a per-run override, and the dialog discloses this in text before Send.
- Gate the prompt on confirmation: when the user changed a control, the dialog sends `set_model` / `set_thinking_level` first, waits for the session to confirm, and only then sends the prompt — with a bounded timeout that sends anyway rather than trapping the user.
- Request the model list on dialog open (`request_models`) so the selector is populated; degrade to a read-only chip showing the current model when the list has not arrived.
- Expose the session's model/effort state and setters to the dialogs through a shared context rather than drilling five props through `SessionOpenSpecActions`' three mount sites (`SessionCard`, `ComposerSessionActions`, `MobileActionMenu`).
- Unify the three dialogs on one header anatomy — icon tile → title (+ change-name chip) → hint → fields — using `Dialog`'s existing but unused `icon` prop. **BREAKING (cosmetic, test-visible)**: the Explore dialog title changes from `Explore: <name>` to `Explore` plus a separate name chip, and the paste affordance moves out of the placeholder into a persistent field note.

Out of scope: the folder-level "New Spec" button, which spawns a session via `spawn_session` and therefore has no session to mutate. Carrying a model through spawn is a separate change.

## Capabilities

### New Capabilities
- `openspec-dialog-run-config`: model + thinking-effort selection inside the OpenSpec dialogs — default inheritance from the session, sticky apply semantics, the confirm-before-send ordering gate, and the degraded state when the model list is unavailable.

### Modified Capabilities
- `openspec-dialogs`: the Explore and NewChange dialog requirements change — Explore's title/placeholder structure is restated (title + name chip, paste hint as a field note), and all three dialogs gain the footer run-config row.

## Impact

- **Code**: `packages/client/src/components/openspec/{ExploreDialog,ProposeDialog,NewChangeDialog,SessionOpenSpecActions}.tsx`; `packages/client/src/App.tsx` (provide the model-control context); `packages/client/src/components/session/ComposerSessionActions.tsx` and `shell/MobileActionMenu.tsx` (mount sites); reuses `settings/{ModelSelector,ThinkingLevelSelector}.tsx` unchanged.
- **Protocol**: none. Reuses `set_model`, `set_thinking_level`, `request_models`, and the `model_update` confirmation already defined in `packages/shared/src/browser-protocol.ts` (the spike corrected this from the originally-assumed `session_updated` — see `design.md` Spike Findings).
- **Server / extension**: none.
- **Tests**: `packages/client/src/components/__tests__/Dialogs.test.tsx` asserts current Explore dialog markup and will need updating; Playwright specs covering the OpenSpec dialogs likewise.
- **Risk**: the ordering guarantee between `set_model` and the following prompt is unverified in the bridge — see `design.md`. This is the change's primary technical risk, and a failure is silent (the run uses the old model and looks correct).
