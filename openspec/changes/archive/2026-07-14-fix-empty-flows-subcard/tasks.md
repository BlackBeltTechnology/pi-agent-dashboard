# Tasks

## 1. Realign the gate predicate

- [x] 1.1 In `packages/flows-plugin/src/client/shouldRender.ts`, replace the
      `getFlowsAvailabilitySync() || sessionHasFlowEvents()` body with
      `flowsList.length > 0 || editMode || sessionHasFlowEvents(session.id)`,
      reading `flowsList` via `getSessionData<FlowInfo[]>` and `editMode` via
      `getPluginConfig("flows").editFlow ?? false`. Update the doc comment.
      → verify: `SessionFlowActionsClaim` render condition and this predicate
      are the same boolean expression.

## 2. Retire the dead availability path

- [x] 2.1 Grep for consumers of `getFlowsAvailabilitySync`, `computeAvailability`,
      `setFlowsAvailability`, `installFlowsAvailabilitySubscriber`, and the
      `availability` cache. → verify: only `shouldRender.ts` (now removed) + the
      client entry + tests reference them.
- [x] 2.2 In `packages/flows-plugin/src/client/flowsAvailability.ts`, delete the
      unused availability cache, `computeAvailability`, `getFlowsAvailabilitySync`,
      `setFlowsAvailability`, and `installFlowsAvailabilitySubscriber`. Keep
      `sessionHasFlowEvents` + its memo + `__resetFlowsAvailabilityForTests`
      (trimmed to what remains). → verify: `tsc --noEmit` clean.
- [x] 2.3 Remove the `installFlowsAvailabilitySubscriber()` call from the
      flows-plugin client entry (`index.tsx`) if present. → verify: no dangling
      import; plugin still registers.

## Tests

- [x] T.1 Rewrite `packages/flows-plugin/src/__tests__/flowsAvailability.test.ts`
      as predicate tests for `shouldRenderFlowsSubcard`:
  - hidden when `flowsList` empty + edit mode off + no flow events (the bug state)
  - visible when `flowsList.length > 0`
  - visible when `editMode` (edit-mode / author-first, zero flows)
  - visible when a flow event exists (running/completed, zero listed flows)
  - `false` for `null`/`undefined` session
      → verify: red before the fix (bug-state case), green after.
- [x] T.2 Confirm `packages/flows-plugin/src/__tests__/manifest-discoverability.test.ts`
      still passes; adjust only if it asserts the retired subscriber.
      → verify: `npm test` green for flows-plugin suites.

## Validate

- [x] V.1 `npm test 2>&1 | tee /tmp/pi-test.log` → flows-plugin suites all green
      (175/175). Remaining 19 failures are pre-existing, env-only, in untouched
      packages (pi-image-fit `Jimp is not a constructor`; shared publish-allowlist
      gap for nano-banana/video-production; web perf-smoke timing).
- [x] V.2 Manual: a session where pi-flows is loaded, cwd has zero flows, edit
      mode off, no flow ran → **no FLOWS pill/box** on the card. Toggle edit mode
      on → FLOWS subcard appears with New/Edit. Run a flow → badge appears.
- [x] V.3 `openspec validate fix-empty-flows-subcard --strict` passes.
