## 1. Resolve the ordering risk (BLOCKING — do this first)

- [x] 1.1 Spike: determine whether the bridge reports a new model only AFTER `pi.setModel()` has taken effect, or optimistically on receipt. **RESOLVED: truthful.** `bridge.ts:1149` awaits `pi.setModel()` then schedules `sendModelUpdateIfChanged()` at +50ms; `model-tracker.ts:15` re-reads live state and emits `model_update` only on a real diff. Signal is `model_update`, NOT `session_updated`.
- [x] 1.2 Spike: determine whether a `send_prompt` arriving immediately after `set_model` races the model change. **RESOLVED: it races.** `connection.ts:201` invokes the async `onMessage` handler without `await`, so handlers run concurrently; `set_model` yields at its first `await` and the prompt is submitted on the old model.
- [x] 1.3 Record findings in `design.md`. **Done** — added a Spike Findings section, amended Decision 4 (wait on the `(model, thinkingLevel)` pair), resolved Risk 1, added Risk 6 (silent failure paths). Decision 4 SURVIVES and is now load-bearing rather than defensive.
- [x] 1.4 Per design Decision 7 (option a — client gate only): add a comment at `packages/extension/src/connection.ts` `onmessage` recording that handler dispatch is intentionally concurrent and that ordering between `set_model` and a following prompt is NOT guaranteed bridge-side, pointing at the client gate as the only current protection.
- [ ] 1.5 File a follow-up OpenSpec change (`serialize-bridge-message-pump`) covering option (b): chain `onMessage` behind a promise queue so ordering holds for every caller. Reference the spike evidence in this change's `design.md`. Do NOT implement it here.

## 2. Shared run-config context

- [x] 2.1 Write failing tests for a `useOpenSpecRunConfig()` hook: returns session model/effort/models/favorites plus setters, and throws when rendered outside its provider.
- [x] 2.2 Implement the context + provider in `packages/client/src/`, sourcing state from `App.tsx`'s existing `selectedState.model`, `selectedState.thinkingLevel`, `modelsMap`, and `favoriteModels`.
- [x] 2.3 Mount the provider in `App.tsx` so it covers all three `SessionOpenSpecActions` mount sites (`SessionCard`, `ComposerSessionActions`, `MobileActionMenu`).
- [x] 2.4 Verify the provider-missing case fails loudly (test from 2.1 passes).

## 3. Run-config row component

- [x] 3.1 Write failing tests: row renders `ModelSelector` + `ThinkingLevelSelector` seeded from the session, labelled "Runs with", both enabled.
- [x] 3.2 Implement the row, reusing `settings/ModelSelector.tsx` and `settings/ThinkingLevelSelector.tsx` unmodified; pass `boundaryRef` so the popover flips upward at the dialog's bottom edge.
- [x] 3.3 Write failing tests for the dirty state: disclosure text appears when a control differs from the session value, disappears when reverted, and is absent (with no reserved space) in the clean state.
- [x] 3.4 Implement the dirty/disclosure behavior.
- [x] 3.5 Write failing tests for the degraded state: no model list → model trigger disabled showing the current model + explanation, effort still enabled, send not blocked; list arriving mid-open re-enables without losing typed input.
- [x] 3.6 Implement the degraded state.

## 4. Send gating

- [x] 4.1 Write failing tests for the unchanged path: no `set_model` / `set_thinking_level` emitted, prompt sent immediately.
- [x] 4.2 Write failing tests for the changed path: `set_model` emitted first; prompt NOT sent until the session reports the new value; then prompt sent and dialog closes.
- [x] 4.3 Write failing tests for the timeout path: no confirmation within the window → prompt sent anyway, user informed the model may not have applied.
- [x] 4.4 Write failing tests for cancel-during-pending: dialog closes without sending the prompt; the emitted model change stays in effect.
- [x] 4.5 Implement the gate per design Decision 4, keying off whatever signal task 1.1 validated. Disable both selectors and the send action while pending; render the status via `role="status"` + `aria-live="polite"`.

## 5. Wire the row into the three dialogs

- [x] 5.1 Write failing tests asserting `request_models` is emitted on open for each of Explore, Propose, New Change. (Covered by the shared row hook test: `refreshModels`/`request_models` emitted once on mount for all three dialogs.)
- [x] 5.2 Add the row + `request_models`-on-open to `ExploreDialog.tsx`.
- [x] 5.3 Add the row + `request_models`-on-open to `ProposeDialog.tsx`.
- [x] 5.4 Add the row + `request_models`-on-open to `NewChangeDialog.tsx`.
- [x] 5.5 Verify all three render correctly from all three mount sites. (SessionOpenSpecActions + MobileActionMenu tests exercise the dialogs through the provider.)

## 6. Shared header anatomy

- [x] 6.1 Update `Dialogs.test.tsx` expectations: Explore title is "Explore" with a separate name chip, not `Explore: <name>`. Keep every `data-testid` stable.
- [x] 6.2 Apply the icon tile via `Dialog`'s existing `icon` prop to all three dialogs (`mdiCompassOutline` / `mdiSend` / `mdiPlusBoxOutline`).
- [x] 6.3 Restructure the Explore header: title + name chip + hint line; reserve header padding so the chip cannot run under the close (X) control; truncate long names with an ellipsis.
- [x] 6.4 Add hint lines to Explore and New Change (Propose already has one).
- [x] 6.5 Move Explore's paste affordance out of the placeholder into a persistent field note that also discloses `Cmd/Ctrl+Enter`; shorten the placeholder to a single question.
- [x] 6.6 Confirm no accelerator note is added to Propose.

## 7. Accessibility verification

- [x] 7.1 Verify every control has an accessible name and correct `aria-haspopup` / `aria-expanded` / `aria-controls`. (Deviates minimally from design Decision 5: added purely-additive `aria-haspopup="listbox"` / `aria-expanded` / `aria-controls` + `role="listbox"`+`id` to the shared `ModelSelector`/`ThinkingLevelSelector` triggers, which also improves the composer. Locked in by an automated test in `OpenSpecRunConfig.test.tsx`.)
- [ ] 7.2 Verify contrast >= 4.5:1 for all new text in every shipped theme; compute, do not eyeball. Cross-check against `mockups/ux-test.md`.
- [ ] 7.3 Verify targets are >= 24x24 CSS px, and >= 44x44 in the stacked narrow-viewport layout (including the close control).
- [ ] 7.4 Verify keyboard operability: tab reaches both triggers with a visible focus ring; Escape closes the popover before the dialog.
- [ ] 7.5 Verify the row stacks without horizontal overflow at 375px.

## 8. Validate

- [x] 8.1 Update any Playwright specs asserting the old Explore title or placeholder text. (Grep confirmed no e2e spec asserts the OpenSpec Explore title/placeholder; none to update.)
- [x] 8.2 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm no failures. (All feature tests green; 2 remaining failures are pre-existing env/flaky — docker-shim port-derivation + git-remote resolveRemoteBase — unrelated to this client-only change.)
- [x] 8.3 Run `npm run quality:changed` and clear any new findings. (Biome clean on all changed feature files.)
- [ ] 8.4 Manual check in an isolated environment (per the `debug-dashboard` isolated-verification reference — never against the live :8000 server): change the model in the Explore dialog, send, and confirm from the session transcript that the run actually used the selected model.
- [ ] 8.5 Run the `review-code` discipline on the full diff before committing.

## Discipline Skills

- `systematic-debugging` — task group 1, root-causing the ordering guarantee rather than assuming it.
- `node-inspect-debugger` — tasks 1.1/1.2, inspecting opaque bridge runtime state.
- `doubt-driven-review` — after task 1.3, before the design's Decision 4 is treated as settled.
- `review-code` — task 8.5, non-trivial change before commit.
